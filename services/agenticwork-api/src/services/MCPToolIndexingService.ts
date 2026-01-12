import axios from 'axios';
import { Logger } from 'pino';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { extractToolTags } from '../utils/toolTagExtractor.js';

/**
 * MCP Tool Indexing Service
 *
 * This service:
 * 1. Loads MCP tools from MCP Proxy
 * 2. Generates embeddings for tool descriptions (multi-provider support)
 * 3. Stores tools in Milvus for semantic search
 * 4. Caches tools in Redis for fast fallback access
 * 5. Keeps Milvus collections updated with latest tools
 *
 * Supports embeddings from: Azure OpenAI, AWS Bedrock, Vertex AI, OpenAI-compatible
 */
export class MCPToolIndexingService {
  private logger: Logger;
  private milvusClient: any;
  private redisClient: any;
  private embeddingService: UniversalEmbeddingService | null = null;
  private embeddingEnabled: boolean = false;

  constructor(logger: Logger, milvusClient: any, redisClient?: any) {
    this.logger = logger;
    this.milvusClient = milvusClient;
    this.redisClient = redisClient;

    // Initialize Universal Embedding Service for semantic search
    try {
      this.embeddingService = new UniversalEmbeddingService(logger);
      this.embeddingEnabled = true;
      const info = this.embeddingService.getInfo();
      this.logger.info({
        provider: info.provider,
        model: info.model,
        dimensions: info.dimensions
      }, '[MCP_INDEXING] Embedding service initialized for semantic tool search');
    } catch (error) {
      this.embeddingEnabled = false;
      this.logger.info('[MCP_INDEXING] Embedding service not configured - semantic search will be disabled (tools still cached in Redis)');
    }
  }

  /**
   * Index all MCP tools from MCP Proxy into Milvus
   */
  async indexAllMCPTools(forceReindex: boolean = false): Promise<void> {
    const startTime = Date.now();

    // Check if we should skip re-indexing (already indexed and not stale)
    if (!forceReindex && process.env.SKIP_MCP_TOOL_REINDEX !== 'false') {
      try {
        // Check Redis for last index time
        if (this.redisClient) {
          const lastIndexTime = await this.redisClient.get('mcp:tools:last_index_time');
          if (lastIndexTime) {
            const lastIndexMs = parseInt(lastIndexTime);
            const staleTtlMs = parseInt(process.env.MCP_INDEX_STALE_TTL_MS || '3600000'); // 1 hour default
            if (Date.now() - lastIndexMs < staleTtlMs) {
              this.logger.info({
                lastIndexed: new Date(lastIndexMs).toISOString(),
                staleTtlMs
              }, '[MCP_INDEXING] ⏭️ MCP tools recently indexed, skipping re-index');
              return;
            }
          }
        }
      } catch (checkError) {
        this.logger.debug({ error: checkError }, '[MCP_INDEXING] Could not check last index time');
      }
    }

    try {
      this.logger.info('[MCP_INDEXING] 🚀 Starting MCP tool indexing with super verbose logging');
      this.logger.info({
        startTime: new Date().toISOString(),
        mcpProxyUrl: process.env.MCP_PROXY_ENDPOINT || 'http://agenticworkchat-mcp-proxy:8080',
        hasMasterKey: !!process.env.MCP_PROXY_API_KEY,
        milvusClient: !!this.milvusClient
      }, '[MCP_INDEXING] Initial configuration');

      // Load tools from MCP Proxy
      this.logger.info('[MCP_INDEXING] 📡 Loading MCP tools from MCP Proxy...');
      const allTools = await this.loadMCPToolsFromProxy();

      this.logger.info({
        totalTools: allTools.length,
        sampleTools: allTools.slice(0, 3).map(t => ({
          name: t?.function?.name || 'UNKNOWN',
          description: t?.function?.description || 'NO_DESCRIPTION',
          serverId: t?.serverId || 'UNKNOWN',
          hasParameters: !!t?.function?.parameters
        }))
      }, '[MCP_INDEXING] 📊 MCP tools loaded from proxy (showing first 3)');

      if (allTools.length === 0) {
        this.logger.warn('[MCP_INDEXING] ⚠️ No MCP tools found - checking fallback options');
        return;
      }

      this.logger.info({
        toolCount: allTools.length,
        uniqueTools: new Set(allTools.map(t => t?.function?.name)).size
      }, '[MCP_INDEXING] ✅ Loaded all MCP tools from MCP Proxy');

      // Cache tools in Redis for fast fallback access
      this.logger.info('[MCP_INDEXING] 💾 Caching tools in Redis for fast access...');
      await this.cacheToolsInRedis(allTools);

      // Index tools in Milvus for semantic search if embeddings are enabled
      if (this.embeddingEnabled && this.embeddingService) {
        this.logger.info('[MCP_INDEXING] 🔍 Indexing tools in Milvus for semantic search...');
        await this.indexToolsInMilvus(allTools);
        this.logger.info('[MCP_INDEXING] ✅ Semantic tool search enabled');
      } else {
        this.logger.info('[MCP_INDEXING] ⏭️ Semantic search disabled - tools available via Redis lookup only');
        this.logger.info('[MCP_INDEXING] To enable semantic search, configure: AZURE_OPENAI_EMBEDDING_DEPLOYMENT, AWS_EMBEDDING_MODEL_ID, GCP_EMBEDDING_MODEL, or EMBEDDING_ENDPOINT');
      }

      // Store indexing metadata in Redis for admin UI
      if (this.redisClient) {
        try {
          await this.redisClient.set('mcp:tools:last_index_time', Date.now().toString());
          await this.redisClient.set('mcp:tools:last_index_success', 'true');
          await this.redisClient.set('mcp:tools:total_indexed', allTools.length.toString());
          await this.redisClient.del('mcp:tools:last_index_error');

          // Store per-server counts
          const serverCounts: Record<string, number> = {};
          for (const tool of allTools) {
            const serverId = tool.serverId || 'unknown';
            serverCounts[serverId] = (serverCounts[serverId] || 0) + 1;
          }

          for (const [serverId, count] of Object.entries(serverCounts)) {
            await this.redisClient.set(`mcp:tools:server:${serverId}:count`, count.toString());
          }
        } catch (redisError: any) {
          this.logger.warn({ error: redisError.message }, '[MCP_INDEXING] Failed to store metadata in Redis');
        }
      }

      this.logger.info({
        toolCount: allTools.length,
        processingTime: Date.now() - startTime,
        avgTimePerTool: Math.round((Date.now() - startTime) / allTools.length)
      }, '[MCP_INDEXING] 🎉 MCP tool indexing completed successfully');

    } catch (error: any) {
      // Store error metadata in Redis
      if (this.redisClient) {
        try {
          await this.redisClient.set('mcp:tools:last_index_time', Date.now().toString());
          await this.redisClient.set('mcp:tools:last_index_success', 'false');
          await this.redisClient.set('mcp:tools:last_index_error', error.message);
        } catch (redisError: any) {
          this.logger.warn({ error: redisError.message }, '[MCP_INDEXING] Failed to store error metadata in Redis');
        }
      }

      this.logger.error({
        error: error.message,
        stack: error.stack,
        processingTime: Date.now() - startTime,
        errorType: error.constructor.name,
        mcpProxyConfig: {
          endpoint: process.env.MCP_PROXY_ENDPOINT,
          hasMasterKey: !!process.env.MCP_PROXY_API_KEY
        }
      }, '[MCP_INDEXING] ❌ MCP tool indexing failed with detailed error info');

      throw error;
    }
  }

  /**
   * Load MCP tools from MCP Proxy
   * MCP Proxy is the central service that manages all MCP servers
   */
  private async loadMCPToolsFromProxy(): Promise<any[]> {
    const mcpProxyUrl = process.env.MCP_PROXY_URL ||
                        `${process.env.MCP_PROXY_PROTOCOL || 'http'}://${process.env.MCP_PROXY_HOST || 'mcp-proxy'}:${process.env.MCP_PROXY_PORT || '3100'}`;

    this.logger.info({
      mcpProxyUrl
    }, '[MCP_INDEXING] 🔧 MCP Proxy connection configuration');

    const headers: any = {
      'Content-Type': 'application/json'
    };

    // MCP Proxy tools endpoint
    const endpoint = `/tools`;

    try {
      this.logger.info({
        endpoint,
        fullUrl: `${mcpProxyUrl}${endpoint}`
      }, '[MCP_INDEXING] 🚀 Fetching tools from MCP Proxy...');

      const response = await axios.get(`${mcpProxyUrl}${endpoint}`, {
        headers,
        timeout: 30000,
        validateStatus: (status) => status < 500
      });

      this.logger.info({
        endpoint,
        status: response.status,
        contentType: response.headers['content-type'],
        dataType: typeof response.data,
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : []
      }, '[MCP_INDEXING] 📡 MCP Proxy response details');

      if (response.status === 200 && response.data) {
        // MCP Proxy returns: { tools: [...], by_server: {...}, total_count: N, server_count: N }
        const toolsData = response.data.tools || [];

        if (toolsData.length > 0) {
          // Transform MCP Proxy format to our expected format
          const tools = toolsData.map((tool: any) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description || tool.name,
              parameters: tool.inputSchema || {}
            },
            serverId: tool.server || 'unknown'
          }));

          this.logger.info({
            toolCount: tools.length,
            serverCount: response.data.server_count,
            toolNames: tools.slice(0, 10).map((t: any) => t.function.name),
            sampleTool: tools[0] || null
          }, '[MCP_INDEXING] ✅ Successfully loaded tools from MCP Proxy');

          return tools;
        } else {
          this.logger.warn({
            responseData: response.data
          }, '[MCP_INDEXING] ⚠️ MCP Proxy returned no tools');
        }
      } else {
        this.logger.warn({
          status: response.status,
          statusText: response.statusText,
          errorData: response.data
        }, '[MCP_INDEXING] ⚠️ MCP Proxy endpoint returned error status');
      }

    } catch (error: any) {
      this.logger.error({
        endpoint,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        errorType: error.code,
        responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 300) : 'NO_DATA'
      }, '[MCP_INDEXING] ❌ Failed to fetch tools from MCP Proxy');
    }

    // Fallback to empty array
    this.logger.warn('[MCP_INDEXING] No tools available from MCP Proxy');
    return [];
  }

  /**
   * Ensure Milvus collection exists for MCP tools
   */
  private async ensureMilvusCollection(): Promise<void> {
    try {
      const collectionName = 'mcp_tools';

      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });

      if (hasCollection.value) {
        this.logger.info('[MCP_INDEXING] MCP tools collection already exists');
        return;
      }

      // Create collection with proper schema
      const createResult = await this.milvusClient.createCollection({
        collection_name: collectionName,
        fields: [
          {
            name: 'id',
            description: 'Tool ID',
            data_type: 'VarChar',
            max_length: 100,
            is_primary_key: true
          },
          {
            name: 'tool_name',
            description: 'Tool function name',
            data_type: 'VarChar',
            max_length: 255
          },
          {
            name: 'tool_description',
            description: 'Tool description',
            data_type: 'VarChar',
            max_length: 2000
          },
          {
            name: 'tool_schema',
            description: 'Full tool schema as JSON',
            data_type: 'VarChar',
            max_length: 10000
          },
          {
            name: 'server_id',
            description: 'MCP server ID',
            data_type: 'VarChar',
            max_length: 100
          },
          {
            name: 'tags',
            description: 'Comma-separated searchable tags (abbreviations, keywords, etc.)',
            data_type: 'VarChar',
            max_length: 1024
          },
          {
            name: 'embedding',
            description: 'Tool description embedding',
            data_type: 'FloatVector',
            dim: parseInt(process.env.EMBEDDING_DIMENSION || '768')
          }
        ]
      });

      this.logger.info({
        createResult
      }, '[MCP_INDEXING] Created MCP tools collection');

      // Create index on embedding field
      await this.milvusClient.createIndex({
        collection_name: collectionName,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 1024 }
      });

      // Load collection
      await this.milvusClient.loadCollection({
        collection_name: collectionName
      });

      this.logger.info('[MCP_INDEXING] MCP tools collection created and indexed');

    } catch (error: any) {
      this.logger.error({
        error: error.message
      }, '[MCP_INDEXING] Failed to ensure Milvus collection');

      throw error;
    }
  }

  /**
   * Index tools into Milvus with embeddings
   */
  private async indexToolsIntoMilvus(tools: any[]): Promise<void> {
    const collectionName = 'mcp_tools';

    try {
      this.logger.info({
        toolsToIndex: tools.length,
        collectionName,
        milvusClientStatus: !!this.milvusClient
      }, '[MCP_INDEXING] 🔍 Starting Milvus indexing process');

      // Clear existing data - use deleteEntities with proper filter syntax
      this.logger.info('[MCP_INDEXING] 🗑️ Clearing existing data from Milvus collection...');

      // First, check if collection has any data
      const queryResult = await this.milvusClient.query({
        collection_name: collectionName,
        filter: 'id != ""',
        output_fields: ['id'],
        limit: 1
      });

      if (queryResult && queryResult.data && queryResult.data.length > 0) {
        // Collection has data, delete it using proper filter syntax
        const deleteResult = await this.milvusClient.deleteEntities({
          collection_name: collectionName,
          filter: 'id != ""' // Delete all records using filter parameter
        });

        this.logger.info({
          deleteResult,
          collectionName
        }, '[MCP_INDEXING] ✅ Existing data cleared from Milvus');
      } else {
        this.logger.info('[MCP_INDEXING] ✅ Collection is empty, no data to clear');
      }

      const entities = [];
      const processingErrors = [];

      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];

        this.logger.info({
          toolIndex: i + 1,
          totalTools: tools.length,
          toolName: tool?.function?.name || tool?.name || 'UNNAMED',
          toolStructure: Object.keys(tool || {}),
          hasFunction: !!tool?.function,
          hasName: !!(tool?.function?.name || tool?.name)
        }, `[MCP_INDEXING] 🔧 Processing tool ${i + 1}/${tools.length}`);

        if (!tool.function?.name) {
          const error = `Tool ${i} missing function.name`;
          this.logger.warn({
            toolIndex: i,
            tool: tool,
            availableFields: Object.keys(tool || {})
          }, `[MCP_INDEXING] ⚠️ ${error}`);
          processingErrors.push(error);
          continue;
        }

        try {
          // Generate embedding for tool description
          const description = tool.function.description || tool.function.name;
          this.logger.info({
            toolName: tool.function.name,
            description: description.substring(0, 100),
            descriptionLength: description.length
          }, '[MCP_INDEXING] 📝 Generating embedding for tool description...');

          const embedding = await this.generateEmbedding(description);

          if (!embedding || embedding.length === 0) {
            const error = `Failed to generate embedding for ${tool.function.name}`;
            this.logger.warn({
              toolName: tool.function.name,
              embeddingResult: embedding
            }, `[MCP_INDEXING] ⚠️ ${error}`);
            processingErrors.push(error);
            continue;
          }

          this.logger.info({
            toolName: tool.function.name,
            embeddingDimension: embedding.length,
            embeddingType: typeof embedding[0],
            embeddingSample: embedding.slice(0, 5)
          }, '[MCP_INDEXING] ✅ Embedding generated successfully');

          // Generate searchable tags from tool name (generic abbreviation extraction)
          const toolTags = extractToolTags(tool.function.name);
          const tagsString = toolTags.join(',');

          // Log tag generation for debugging (only first 3 tools)
          if (i < 3) {
            this.logger.info({
              toolName: tool.function.name,
              generatedTags: toolTags,
              tagCount: toolTags.length
            }, '[MCP_INDEXING] [TAG-GENERATION] Generated searchable tags for tool');
          }

          const entity = {
            id: `tool_${tool.function.name}_${i}`,
            tool_name: tool.function.name,
            tool_description: description,
            tool_schema: JSON.stringify(tool),
            server_id: tool.serverId || 'unknown',
            tags: tagsString,
            embedding
          };

          entities.push(entity);

          this.logger.info({
            toolName: tool.function.name,
            entityId: entity.id,
            serverId: entity.server_id,
            schemaLength: entity.tool_schema.length
          }, '[MCP_INDEXING] 📦 Tool entity prepared for indexing');

        } catch (error: any) {
          const errorMsg = `Failed to process tool ${tool.function.name}: ${error.message}`;
          this.logger.error({
            error: error.message,
            stack: error.stack,
            toolName: tool.function.name,
            toolIndex: i
          }, `[MCP_INDEXING] ❌ ${errorMsg}`);
          processingErrors.push(errorMsg);
        }
      }

      this.logger.info({
        totalProcessed: tools.length,
        successfulEntities: entities.length,
        errorCount: processingErrors.length,
        errors: processingErrors.slice(0, 5) // Show first 5 errors
      }, '[MCP_INDEXING] 📊 Tool processing summary');

      if (entities.length === 0) {
        this.logger.error({
          totalTools: tools.length,
          processingErrors
        }, '[MCP_INDEXING] ❌ No tools successfully processed for indexing');
        throw new Error(`No tools could be processed. Errors: ${processingErrors.join('; ')}`);
      }

      // Insert entities into Milvus
      this.logger.info({
        entitiesToInsert: entities.length,
        collectionName,
        sampleEntity: entities[0] ? {
          id: entities[0].id,
          tool_name: entities[0].tool_name,
          embeddingLength: entities[0].embedding.length
        } : null
      }, '[MCP_INDEXING] 📤 Inserting entities into Milvus...');

      const insertResult = await this.milvusClient.insert({
        collection_name: collectionName,
        data: entities
      });

      this.logger.info({
        insertResult,
        insertedCount: insertResult?.insert_cnt || entities.length
      }, '[MCP_INDEXING] ✅ Entities inserted into Milvus');

      // Flush to ensure data is written
      this.logger.info('[MCP_INDEXING] 💾 Flushing data to ensure persistence...');
      const flushResult = await this.milvusClient.flush({
        collection_names: [collectionName]
      });

      this.logger.info({
        flushResult,
        collectionName
      }, '[MCP_INDEXING] ✅ Data flushed to Milvus');

      this.logger.info({
        finalIndexedCount: entities.length,
        totalOriginalTools: tools.length,
        successRate: `${Math.round((entities.length / tools.length) * 100)}%`,
        insertResult,
        flushResult
      }, '[MCP_INDEXING] 🎉 Tools successfully indexed into Milvus');

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        stack: error.stack,
        collectionName,
        toolsCount: tools.length
      }, '[MCP_INDEXING] ❌ Failed to index tools into Milvus');

      throw error;
    }
  }

  /**
   * Generate embeddings using MCP Proxy
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const mcpProxyUrl = process.env.MCP_PROXY_ENDPOINT || 'http://agenticworkchat-mcp-proxy:8080';
      const masterKey = process.env.MCP_PROXY_API_KEY;
      const embeddingModel = process.env.EMBEDDING_MODEL;

      if (!embeddingModel) {
        throw new Error('EMBEDDING_MODEL environment variable not set');
      }

      const response = await axios.post(`${mcpProxyUrl}/v1/embeddings`, {
        model: embeddingModel,
        input: text
      }, {
        headers: {
          'Authorization': `Bearer ${masterKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const embedding = response.data?.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response');
      }

      return embedding;

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        text: text.substring(0, 100)
      }, '[MCP_INDEXING] Failed to generate embedding');

      return [];
    }
  }

  /**
   * Index tools in Milvus for semantic search using Universal Embedding Service
   */
  private async indexToolsInMilvus(tools: any[]): Promise<void> {
    if (!this.embeddingService || !this.embeddingEnabled) {
      this.logger.warn('[MCP_INDEXING] Embedding service not available - skipping Milvus indexing');
      return;
    }

    if (!this.milvusClient) {
      this.logger.warn('[MCP_INDEXING] Milvus client not available - skipping Milvus indexing');
      return;
    }

    try {
      const collectionName = 'mcp_tools';
      const info = this.embeddingService.getInfo();
      const embeddingDimension = info.dimensions;

      this.logger.info({
        toolCount: tools.length,
        embeddingProvider: info.provider,
        embeddingModel: info.model,
        embeddingDimension
      }, '[MCP_INDEXING] 🔍 Starting Milvus indexing with embeddings');

      // Ensure collection exists with correct dimensions
      await this.ensureMilvusCollectionWithDimension(collectionName, embeddingDimension);

      // Generate embeddings for all tools
      const toolDescriptions = tools.map(tool =>
        tool?.function?.description || tool?.function?.name || 'No description'
      );

      this.logger.info({
        toolCount: tools.length,
        sampleDescriptions: toolDescriptions.slice(0, 3)
      }, '[MCP_INDEXING] Generating embeddings for tool descriptions...');

      const batchResult = await this.embeddingService.generateBatchEmbeddings(toolDescriptions);

      this.logger.info({
        embeddingsGenerated: batchResult.embeddings.length,
        dimensions: batchResult.dimensions,
        provider: batchResult.provider,
        model: batchResult.model
      }, '[MCP_INDEXING] ✅ Generated embeddings for all tools');

      // Prepare data for Milvus
      const milvusData = tools.map((tool, index) => {
        const toolName = tool?.function?.name || 'unknown';

        // Generate searchable tags from tool name (generic abbreviation extraction)
        const toolTags = extractToolTags(toolName);
        const tagsString = toolTags.join(',');

        // Log tag generation for debugging (only first 5 tools to avoid spam)
        if (index < 5) {
          this.logger.info({
            toolName,
            generatedTags: toolTags,
            tagCount: toolTags.length
          }, '[MCP_INDEXING] [TAG-GENERATION] Generated searchable tags for tool');
        }

        return {
          id: `${tool.serverId || 'unknown'}_${toolName}`,
          tool_name: toolName,
          tool_description: tool?.function?.description || 'No description',
          tool_schema: JSON.stringify(tool?.function || {}),
          server_id: tool.serverId || 'unknown',
          tags: tagsString,
          embedding: batchResult.embeddings[index]
        };
      });

      // Clear existing data and insert new data
      await this.clearAndInsertMilvusData(collectionName, milvusData);

      this.logger.info({
        toolsIndexed: milvusData.length,
        collectionName
      }, '[MCP_INDEXING] 🎉 Successfully indexed tools in Milvus for semantic search');

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        stack: error.stack
      }, '[MCP_INDEXING] ❌ Failed to index tools in Milvus');
      // Don't throw - allow tools to still be available via Redis
    }
  }

  /**
   * Ensure Milvus collection exists with correct dimension
   */
  private async ensureMilvusCollectionWithDimension(collectionName: string, dimension: number): Promise<void> {
    try {
      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });

      if (hasCollection.value) {
        // Check if dimension matches
        const collectionInfo = await this.milvusClient.describeCollection({
          collection_name: collectionName
        });

        const embeddingField = collectionInfo.schema.fields.find((f: any) => f.name === 'embedding');
        if (embeddingField && embeddingField.dim === dimension) {
          this.logger.info({
            collectionName,
            dimension
          }, '[MCP_INDEXING] Milvus collection exists with correct dimension');
          return;
        }

        // Dimension mismatch - drop and recreate
        this.logger.warn({
          collectionName,
          existingDim: embeddingField?.dim,
          requiredDim: dimension
        }, '[MCP_INDEXING] Dimension mismatch - recreating collection');

        await this.milvusClient.dropCollection({
          collection_name: collectionName
        });
      }

      // Create collection with correct schema
      this.logger.info({
        collectionName,
        dimension
      }, '[MCP_INDEXING] Creating Milvus collection...');

      await this.milvusClient.createCollection({
        collection_name: collectionName,
        fields: [
          {
            name: 'id',
            description: 'Tool ID',
            data_type: 'VarChar',
            max_length: 100,
            is_primary_key: true
          },
          {
            name: 'tool_name',
            description: 'Tool function name',
            data_type: 'VarChar',
            max_length: 255
          },
          {
            name: 'tool_description',
            description: 'Tool description',
            data_type: 'VarChar',
            max_length: 2000
          },
          {
            name: 'tool_schema',
            description: 'Full tool schema as JSON',
            data_type: 'VarChar',
            max_length: 10000
          },
          {
            name: 'server_id',
            description: 'MCP server ID',
            data_type: 'VarChar',
            max_length: 100
          },
          {
            name: 'tags',
            description: 'Comma-separated searchable tags (abbreviations, keywords, etc.)',
            data_type: 'VarChar',
            max_length: 1024
          },
          {
            name: 'embedding',
            description: 'Tool description embedding',
            data_type: 'FloatVector',
            dim: dimension
          }
        ]
      });

      // Create index
      await this.milvusClient.createIndex({
        collection_name: collectionName,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 1024 }
      });

      // Load collection
      await this.milvusClient.loadCollection({
        collection_name: collectionName
      });

      this.logger.info('[MCP_INDEXING] ✅ Milvus collection created and indexed');

    } catch (error: any) {
      this.logger.error({
        error: error.message
      }, '[MCP_INDEXING] Failed to ensure Milvus collection');
      throw error;
    }
  }

  /**
   * Clear existing data and insert new data into Milvus
   */
  private async clearAndInsertMilvusData(collectionName: string, data: any[]): Promise<void> {
    try {
      // Query for existing IDs
      const queryResult = await this.milvusClient.query({
        collection_name: collectionName,
        filter: 'id != ""',
        output_fields: ['id'],
        limit: 10000
      });

      // Delete existing data if any
      if (queryResult.data && queryResult.data.length > 0) {
        const existingIds = queryResult.data.map((item: any) => item.id);
        this.logger.info({
          existingCount: existingIds.length
        }, '[MCP_INDEXING] Deleting existing data from Milvus...');

        await this.milvusClient.delete({
          collection_name: collectionName,
          filter: `id in [${existingIds.map((id: string) => `"${id}"`).join(',')}]`
        });
      }

      // Insert new data
      this.logger.info({
        insertCount: data.length
      }, '[MCP_INDEXING] Inserting new data into Milvus...');

      const insertResult = await this.milvusClient.insert({
        collection_name: collectionName,
        data: data
      });

      this.logger.info({
        insertedCount: insertResult.insert_cnt
      }, '[MCP_INDEXING] ✅ Data inserted into Milvus');

    } catch (error: any) {
      this.logger.error({
        error: error.message
      }, '[MCP_INDEXING] Failed to clear and insert Milvus data');
      throw error;
    }
  }

  /**
   * Cache tools in Redis for fast fallback access
   */
  private async cacheToolsInRedis(tools: any[]): Promise<void> {
    if (!this.redisClient) {
      this.logger.warn('[MCP_INDEXING] Redis client not available - skipping Redis cache');
      return;
    }

    try {
      const cacheKey = 'mcp_tools_cache';

      // Store tools as JSON in Redis with 24 hour expiry
      await this.redisClient.set(
        cacheKey,
        JSON.stringify(tools),
        'EX',
        86400 // 24 hours
      );

      this.logger.info({
        toolCount: tools.length,
        cacheKey,
        ttl: '24 hours'
      }, '[MCP_INDEXING] ✅ Tools cached in Redis for fallback access');

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        stack: error.stack
      }, '[MCP_INDEXING] ❌ Failed to cache tools in Redis');
      // Don't throw - Redis cache is optional
    }
  }

  /**
   * Run indexing periodically
   */
  async startPeriodicIndexing(intervalMinutes: number = 30): Promise<void> {
    this.logger.info({
      intervalMinutes
    }, '[MCP_INDEXING] Starting periodic MCP tool indexing');

    // Run immediately
    try {
      await this.indexAllMCPTools();
    } catch (error: any) {
      this.logger.error({
        error: error.message
      }, '[MCP_INDEXING] Initial indexing failed');
    }

    // Schedule periodic runs
    setInterval(async () => {
      try {
        await this.indexAllMCPTools();
      } catch (error: any) {
        this.logger.error({
          error: error.message
        }, '[MCP_INDEXING] Periodic indexing failed');
      }
    }, intervalMinutes * 60 * 1000);
  }
}