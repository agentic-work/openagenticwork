/**
 * Tool Success Tracking Service
 *
 * Provides structured semantic tracking of successful tool executions.
 * Uses a dedicated Milvus collection to store tool usage patterns with
 * embeddings, enabling semantic search for similar queries and intents.
 *
 * Key Features:
 * - Semantic storage: Queries are embedded for similarity matching
 * - Structured tracking: Tool name, server, context tags, success metrics
 * - Cross-user learning: Optional aggregation of successful patterns
 * - Intent linking: Tags connect tools to user intents and memory contexts
 *
 * This replaces the text-based "Tool success: ..." pattern in memory MCP
 * with a proper structured approach that enables:
 * - Better tool recommendations based on semantic similarity
 * - Multi-dimensional filtering (by tool, server, tags, user)
 * - Analytics on tool usage patterns
 */

import { MilvusClient, DataType, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';
import { loggers } from '../utils/logger.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { randomUUID } from 'crypto';

const COLLECTION_NAME = 'tool_success_tracking';
const serviceLogger = loggers.services.child({ service: 'tool-success-tracking' });

// Vector dimensions - populated dynamically
let EMBEDDING_DIMENSIONS = 768;

/**
 * Represents a successful tool execution to be tracked
 */
export interface ToolSuccessRecord {
  id?: string;
  userId: string;
  sessionId?: string;
  query: string;              // The user query that triggered the tool
  queryEmbedding?: number[];  // Embedding of the query for semantic search
  toolName: string;           // Name of the tool that was used
  serverName: string;         // MCP server that provides the tool
  intentTags: string[];       // Tags describing the intent (e.g., "azure", "list", "resources")
  contextTags: string[];      // Additional context tags from memory/session
  executionTimeMs?: number;   // How long the tool took to execute
  resultSummary?: string;     // Brief summary of what the tool returned
  successScore: number;       // 0-1 score of how successful the execution was
  createdAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Search options for finding relevant tool success patterns
 */
export interface ToolSuccessSearchOptions {
  query: string;              // Query to search for semantically
  userId?: string;            // Filter by user (optional for cross-user patterns)
  serverFilter?: string[];    // Filter by specific MCP servers
  tagFilter?: string[];       // Filter by intent/context tags
  limit?: number;             // Max results (default 10)
  minScore?: number;          // Minimum similarity score (default 0.5)
  includeAllUsers?: boolean;  // Include patterns from all users (privacy consideration)
}

/**
 * Result from tool success search
 */
export interface ToolSuccessSearchResult {
  toolName: string;
  serverName: string;
  query: string;
  intentTags: string[];
  successScore: number;
  similarity: number;         // Semantic similarity to search query
  usageCount?: number;        // How many times this pattern was successful
}

/**
 * Tool Success Tracking Service
 * Manages structured tracking of successful tool executions in Milvus
 */
export class ToolSuccessTrackingService {
  private client: MilvusClient;
  private embeddingService: UniversalEmbeddingService;
  private _isInitialized: boolean = false;
  private readonly instanceId: string = `tracker-${process.env.HOSTNAME || randomUUID().substring(0, 8)}`;

  constructor() {
    const milvusHost = process.env.MILVUS_HOST || 'milvus';
    const milvusPort = process.env.MILVUS_PORT || '19530';

    this.client = new MilvusClient({
      address: `${milvusHost}:${milvusPort}`,
      timeout: 30000
    });

    // UniversalEmbeddingService requires a logger
    this.embeddingService = new UniversalEmbeddingService(serviceLogger);
  }

  /**
   * Initialize the service and create collection if needed
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    try {
      serviceLogger.info('[ToolSuccessTracking] Initializing service...');

      // Get embedding dimensions (UniversalEmbeddingService auto-detects on first use)
      EMBEDDING_DIMENSIONS = await this.embeddingService.getInfo().dimensions;

      // Check if collection exists
      const hasCollection = await this.client.hasCollection({
        collection_name: COLLECTION_NAME
      });

      if (!hasCollection.value) {
        await this.createCollection();
      } else {
        // Verify collection schema matches expected dimensions
        const collectionInfo = await this.client.describeCollection({
          collection_name: COLLECTION_NAME
        });

        const vectorField = collectionInfo.schema.fields.find(
          f => f.name === 'query_embedding'
        );

        if (vectorField && vectorField.type_params) {
          // type_params can be an array or object - handle both
          let existingDim = 0;
          if (Array.isArray(vectorField.type_params)) {
            const dimParam = vectorField.type_params.find((p: any) => p.key === 'dim');
            existingDim = dimParam ? parseInt(String(dimParam.value) || '0') : 0;
          } else if (typeof vectorField.type_params === 'object') {
            existingDim = parseInt(String((vectorField.type_params as any).dim) || '0');
          }
          if (existingDim !== EMBEDDING_DIMENSIONS) {
            serviceLogger.warn({
              existingDim,
              expectedDim: EMBEDDING_DIMENSIONS
            }, '[ToolSuccessTracking] Dimension mismatch - recreating collection');
            await this.client.dropCollection({ collection_name: COLLECTION_NAME });
            await this.createCollection();
          }
        }
      }

      // Load collection into memory
      await this.client.loadCollection({ collection_name: COLLECTION_NAME });

      this._isInitialized = true;
      serviceLogger.info('[ToolSuccessTracking] Service initialized successfully');
    } catch (error) {
      serviceLogger.error({ error }, '[ToolSuccessTracking] Failed to initialize');
      throw error;
    }
  }

  /**
   * Create the Milvus collection with proper schema
   */
  private async createCollection(): Promise<void> {
    serviceLogger.info('[ToolSuccessTracking] Creating collection...');

    await this.client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 64
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'session_id',
          data_type: DataType.VarChar,
          max_length: 64
        },
        {
          name: 'query',
          data_type: DataType.VarChar,
          max_length: 2048
        },
        {
          name: 'tool_name',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'server_name',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'intent_tags',
          data_type: DataType.VarChar,
          max_length: 1024  // Comma-separated tags
        },
        {
          name: 'context_tags',
          data_type: DataType.VarChar,
          max_length: 1024
        },
        {
          name: 'success_score',
          data_type: DataType.Float
        },
        {
          name: 'execution_time_ms',
          data_type: DataType.Int64
        },
        {
          name: 'result_summary',
          data_type: DataType.VarChar,
          max_length: 512
        },
        {
          name: 'created_at',
          data_type: DataType.Int64  // Unix timestamp
        },
        {
          name: 'metadata_json',
          data_type: DataType.VarChar,
          max_length: 4096
        },
        {
          name: 'query_embedding',
          data_type: DataType.FloatVector,
          dim: EMBEDDING_DIMENSIONS
        }
      ]
    });

    // Create vector index for semantic search
    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'query_embedding',
      index_type: IndexType.HNSW,
      metric_type: MetricType.COSINE,
      params: { M: 16, efConstruction: 256 }
    });

    // Create scalar indexes for filtering
    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'user_id',
      index_type: 'INVERTED'
    });

    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'tool_name',
      index_type: 'INVERTED'
    });

    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'server_name',
      index_type: 'INVERTED'
    });

    serviceLogger.info('[ToolSuccessTracking] Collection created with indexes');
  }

  /**
   * Record a successful tool execution
   */
  async recordSuccess(record: ToolSuccessRecord): Promise<string> {
    await this.ensureInitialized();

    try {
      // Generate embedding for the query
      const result = await this.embeddingService.generateEmbedding(record.query);
      const embedding = result.embedding;

      const id = record.id || randomUUID();
      const now = Date.now();

      await this.client.insert({
        collection_name: COLLECTION_NAME,
        data: [{
          id,
          user_id: record.userId,
          session_id: record.sessionId || '',
          query: record.query.substring(0, 2048),
          tool_name: record.toolName,
          server_name: record.serverName,
          intent_tags: record.intentTags.join(','),
          context_tags: record.contextTags.join(','),
          success_score: record.successScore,
          execution_time_ms: record.executionTimeMs || 0,
          result_summary: (record.resultSummary || '').substring(0, 512),
          created_at: now,
          metadata_json: JSON.stringify(record.metadata || {}),
          query_embedding: embedding
        }]
      });

      serviceLogger.debug({
        id,
        toolName: record.toolName,
        serverName: record.serverName,
        userId: record.userId.substring(0, 8) + '...',
        intentTags: record.intentTags
      }, '[ToolSuccessTracking] Recorded successful tool execution');

      return id;
    } catch (error) {
      serviceLogger.error({ error, record }, '[ToolSuccessTracking] Failed to record success');
      throw error;
    }
  }

  /**
   * Search for successful tool patterns similar to a query
   * Returns tools that worked well for similar queries in the past
   */
  async searchSuccessfulTools(options: ToolSuccessSearchOptions): Promise<ToolSuccessSearchResult[]> {
    await this.ensureInitialized();

    try {
      // Generate embedding for search query
      const queryResult = await this.embeddingService.generateEmbedding(options.query);
      const queryEmbedding = queryResult.embedding;

      // Build filter expression
      const filters: string[] = [];

      if (options.userId && !options.includeAllUsers) {
        filters.push(`user_id == "${options.userId}"`);
      }

      if (options.serverFilter && options.serverFilter.length > 0) {
        const serverConditions = options.serverFilter.map(s => `server_name == "${s}"`);
        filters.push(`(${serverConditions.join(' || ')})`);
      }

      const filterExpr = filters.length > 0 ? filters.join(' && ') : undefined;

      // Perform semantic search
      const searchResults = await this.client.search({
        collection_name: COLLECTION_NAME,
        data: [queryEmbedding],
        limit: options.limit || 10,
        filter: filterExpr || '',
        output_fields: [
          'tool_name', 'server_name', 'query', 'intent_tags',
          'success_score', 'context_tags'
        ],
        params: { ef: 128 }
      });

      if (!searchResults.results || searchResults.results.length === 0) {
        return [];
      }

      // Filter by minimum score and tag filter
      const minScore = options.minScore || 0.5;
      const results: ToolSuccessSearchResult[] = [];

      for (const result of searchResults.results) {
        const similarity = result.score || 0;

        if (similarity < minScore) continue;

        const intentTags = (result.intent_tags as string || '').split(',').filter(Boolean);

        // Apply tag filter if specified
        if (options.tagFilter && options.tagFilter.length > 0) {
          const hasMatchingTag = options.tagFilter.some(tag =>
            intentTags.includes(tag) ||
            (result.context_tags as string || '').includes(tag)
          );
          if (!hasMatchingTag) continue;
        }

        results.push({
          toolName: result.tool_name as string,
          serverName: result.server_name as string,
          query: result.query as string,
          intentTags,
          successScore: result.success_score as number,
          similarity
        });
      }

      serviceLogger.debug({
        queryPreview: options.query.substring(0, 50),
        resultsFound: results.length,
        topTool: results[0]?.toolName
      }, '[ToolSuccessTracking] Search completed');

      return results;
    } catch (error) {
      serviceLogger.error({ error }, '[ToolSuccessTracking] Search failed');
      return [];
    }
  }

  /**
   * Get aggregated tool success patterns for a user
   * Returns tools with their success counts and average scores
   */
  async getUserToolPatterns(userId: string, limit: number = 20): Promise<{
    toolName: string;
    serverName: string;
    usageCount: number;
    avgSuccessScore: number;
    topIntentTags: string[];
  }[]> {
    await this.ensureInitialized();

    try {
      // Query all records for user
      const queryResult = await this.client.query({
        collection_name: COLLECTION_NAME,
        filter: `user_id == "${userId}"`,
        output_fields: ['tool_name', 'server_name', 'success_score', 'intent_tags'],
        limit: 1000  // Get up to 1000 records for aggregation
      });

      if (!queryResult.data || queryResult.data.length === 0) {
        return [];
      }

      // Aggregate by tool
      const toolStats = new Map<string, {
        serverName: string;
        count: number;
        totalScore: number;
        tagCounts: Map<string, number>;
      }>();

      for (const record of queryResult.data) {
        const key = record.tool_name as string;
        const stats = toolStats.get(key) || {
          serverName: record.server_name as string,
          count: 0,
          totalScore: 0,
          tagCounts: new Map()
        };

        stats.count++;
        stats.totalScore += record.success_score as number;

        // Count intent tags
        const tags = (record.intent_tags as string || '').split(',').filter(Boolean);
        for (const tag of tags) {
          stats.tagCounts.set(tag, (stats.tagCounts.get(tag) || 0) + 1);
        }

        toolStats.set(key, stats);
      }

      // Convert to sorted array
      const results = Array.from(toolStats.entries())
        .map(([toolName, stats]) => ({
          toolName,
          serverName: stats.serverName,
          usageCount: stats.count,
          avgSuccessScore: stats.totalScore / stats.count,
          topIntentTags: Array.from(stats.tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tag]) => tag)
        }))
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, limit);

      return results;
    } catch (error) {
      serviceLogger.error({ error, userId }, '[ToolSuccessTracking] Failed to get user patterns');
      return [];
    }
  }

  /**
   * Extract intent tags from a query using keyword analysis
   * This provides immediate tags without LLM overhead
   */
  extractIntentTags(query: string): string[] {
    const queryLower = query.toLowerCase();
    const tags: string[] = [];

    // Cloud provider detection
    const cloudPatterns: Record<string, string[]> = {
      'aws': ['aws', 'amazon', 's3', 'ec2', 'lambda', 'iam', 'dynamodb', 'rds', 'eks', 'cloudwatch', 'bedrock'],
      'azure': ['azure', 'microsoft', 'subscription', 'resource group', 'aks', 'blob', 'cosmos', 'entra'],
      'gcp': ['gcp', 'google cloud', 'gke', 'bigquery', 'cloud run', 'vertex', 'compute engine'],
      'kubernetes': ['kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'service', 'namespace', 'helm']
    };

    for (const [provider, keywords] of Object.entries(cloudPatterns)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        tags.push(provider);
      }
    }

    // Action detection
    const actionPatterns: Record<string, string[]> = {
      'list': ['list', 'show', 'get all', 'display', 'enumerate'],
      'create': ['create', 'make', 'new', 'add', 'provision'],
      'delete': ['delete', 'remove', 'destroy', 'terminate'],
      'update': ['update', 'modify', 'change', 'edit', 'patch'],
      'describe': ['describe', 'details', 'info', 'information about'],
      'search': ['search', 'find', 'look for', 'query', 'browse'],
      'analyze': ['analyze', 'audit', 'check', 'review', 'assess']
    };

    for (const [action, keywords] of Object.entries(actionPatterns)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        tags.push(action);
      }
    }

    // Resource type detection
    const resourcePatterns: Record<string, string[]> = {
      'compute': ['vm', 'virtual machine', 'instance', 'server', 'container'],
      'storage': ['storage', 'bucket', 'blob', 'disk', 'volume'],
      'database': ['database', 'db', 'sql', 'nosql', 'table'],
      'network': ['network', 'vpc', 'subnet', 'firewall', 'load balancer'],
      'identity': ['user', 'role', 'permission', 'policy', 'identity', 'iam'],
      'monitoring': ['log', 'metric', 'alert', 'monitor', 'trace']
    };

    for (const [resource, keywords] of Object.entries(resourcePatterns)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        tags.push(resource);
      }
    }

    return [...new Set(tags)]; // Remove duplicates
  }

  /**
   * Check if service is initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Ensure service is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this._isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{
    totalRecords: number;
    uniqueTools: number;
    uniqueUsers: number;
  }> {
    await this.ensureInitialized();

    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: COLLECTION_NAME
      });

      return {
        totalRecords: parseInt(stats.data.row_count || '0'),
        uniqueTools: 0,  // Would need aggregation query
        uniqueUsers: 0
      };
    } catch (error) {
      serviceLogger.error({ error }, '[ToolSuccessTracking] Failed to get stats');
      return { totalRecords: 0, uniqueTools: 0, uniqueUsers: 0 };
    }
  }
}

// Singleton instance
let instance: ToolSuccessTrackingService | null = null;

export function getToolSuccessTrackingService(): ToolSuccessTrackingService {
  if (!instance) {
    instance = new ToolSuccessTrackingService();
  }
  return instance;
}
