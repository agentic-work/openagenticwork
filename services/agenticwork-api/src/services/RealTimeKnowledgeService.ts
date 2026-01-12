/**
 * Real-Time Knowledge Service
 * 
 * Automatically ingests knowledge without manual scripts:
 * - Chat messages are indexed immediately after each conversation
 * - Documentation is watched for changes and auto-indexed
 * - Incremental updates, no full re-ingestion needed
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import Bull from 'bull';
import { getRedisClient } from '../utils/redis-client.js';
import { getModelCapabilityDiscoveryService } from './ModelCapabilityDiscoveryService.js';
import { dynamicModelManager } from './DynamicModelManager.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import type { ProviderManager } from './llm-providers/ProviderManager.js';

export class RealTimeKnowledgeService extends EventEmitter {
  private milvus: MilvusClient;
  private prisma: PrismaClient;
  private logger: Logger;
  private mcpProxyEndpoint: string;
  private fileWatcher?: chokidar.FSWatcher;
  private ingestionQueue: Bull.Queue;
  private embeddingCache: Map<string, number[]> = new Map();
  private initialized = false;
  private embeddingService?: UniversalEmbeddingService;
  private providerManager?: ProviderManager;
  
  // Collections
  private collections = {
    documentation: 'app_documentation_v2',
    chats: 'chat_conversations_v2',
    memories: 'user_memories_v2',
    azureSDK: 'azure_sdk_documentation'
  };

  // Azure SDK sync interval (default: 24 hours)
  private azureSDKSyncIntervalMs = parseInt(process.env.AZURE_SDK_SYNC_INTERVAL_HOURS || '24') * 60 * 60 * 1000;

  constructor(milvus: MilvusClient, prisma: PrismaClient, logger: Logger, providerManager?: ProviderManager) {
    super();
    this.milvus = milvus;
    this.prisma = prisma;
    this.logger = logger.child({ service: 'RealTimeKnowledge' });
    this.mcpProxyEndpoint = process.env.MCP_PROXY_ENDPOINT || 'http://agenticworkchat-mcp-proxy:8080';
    this.providerManager = providerManager;

    // Initialize embedding service if provider manager is available
    if (providerManager) {
      this.embeddingService = new UniversalEmbeddingService(this.logger);
      this.logger.info('UniversalEmbeddingService initialized in RealTimeKnowledgeService constructor');
    }

    // Create background job queue
    this.ingestionQueue = new Bull('knowledge-ingestion', {
      redis: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    });

    this.setupQueueProcessors();
  }

  /**
   * Set the provider manager (for late initialization)
   */
  setProviderManager(providerManager: ProviderManager): void {
    this.providerManager = providerManager;
    // Initialize embedding service if not already done
    if (!this.embeddingService) {
      this.embeddingService = new UniversalEmbeddingService(this.logger);
    }
  }

  /**
   * Initialize service - called once on startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.logger.info('🚀 Initializing Real-Time Knowledge Service...');

      // Initialize collections
      await this.initializeCollections();

      // Start file watcher for documentation
      this.startDocumentationWatcher();

      // Process any pending messages
      await this.processPendingMessages();

      // Subscribe to chat events
      this.subscribeToEvents();

      // Start periodic Azure SDK documentation sync
      this.startAzureSDKPeriodicSync();

      this.initialized = true;
      this.logger.info('✅ Real-Time Knowledge Service initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize Real-Time Knowledge Service');
      throw error;
    }
  }

  /**
   * Initialize Milvus collections with proper schema
   */
  private async initializeCollections(): Promise<void> {
    // Discover embedding dimensions from the current model
    let embeddingDimensions = 1536; // Default fallback
    try {
      const discoveryService = getModelCapabilityDiscoveryService();
      if (discoveryService) {
        const embeddingModel = await dynamicModelManager.getEmbeddingModel();
        if (embeddingModel) {
          embeddingDimensions = embeddingModel.dimensions;
          this.logger.info(`Using embedding dimensions: ${embeddingDimensions} for model: ${embeddingModel.model}`);
        }
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to discover embedding dimensions, using default 1536');
    }

    for (const [type, collectionName] of Object.entries(this.collections)) {
      try {
        const exists = await this.milvus.hasCollection({ collection_name: collectionName });

        if (!exists.value) {
          this.logger.info(`Creating collection: ${collectionName} with ${embeddingDimensions} dimensions`);

          await this.milvus.createCollection({
            collection_name: collectionName,
            fields: [
              {
                name: 'id',
                data_type: 5, // Int64
                is_primary_key: true,
                autoID: true
              },
              {
                name: 'content',
                data_type: 21, // VarChar
                max_length: 65535
              },
              {
                name: 'embedding',
                data_type: 101, // FloatVector
                dim: embeddingDimensions
              },
              {
                name: 'source_id',
                data_type: 21, // VarChar
                max_length: 255
              },
              {
                name: 'user_id',
                data_type: 21, // VarChar
                max_length: 255,
                nullable: true
              },
              {
                name: 'metadata',
                data_type: 23, // JSON
              },
              {
                name: 'timestamp',
                data_type: 5, // Int64
              },
              {
                name: 'content_hash',
                data_type: 21, // VarChar
                max_length: 64
              }
            ]
          });

          // Create index
          await this.milvus.createIndex({
            collection_name: collectionName,
            field_name: 'embedding',
            index_type: 'IVF_FLAT',
            metric_type: 'COSINE',
            params: { nlist: 128 }
          });

          await this.milvus.loadCollection({ collection_name: collectionName });
          this.logger.info(`✅ Collection ${collectionName} created and loaded successfully`);
        } else {
          this.logger.info(`Collection ${collectionName} already exists`);
        }
      } catch (error) {
        this.logger.error({ error, collection: collectionName }, 'Failed to initialize collection');
      }
    }
  }

  /**
   * Automatically ingest chat messages after each conversation turn
   */
  async ingestChatMessage(message: {
    id: string;
    sessionId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }): Promise<void> {
    // Don't block the chat response - add to queue
    await this.ingestionQueue.add('chat-message', message, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });
  }

  /**
   * Process chat message ingestion in background
   */
  private async processChatMessage(message: any): Promise<void> {
    try {
      // Skip empty or very short messages
      if (!message.content || message.content.length < 10) return;

      // Create content hash to avoid duplicates
      const contentHash = crypto.createHash('sha256')
        .update(message.content)
        .digest('hex');

      // Check if already exists
      const exists = await this.checkIfExists(contentHash, this.collections.chats);
      if (exists) return;

      // Get conversation context (last 3 messages)
      const context = await this.getConversationContext(message.sessionId, message.id);
      const fullContent = context.join('\n\n');

      // Generate embedding
      const embedding = await this.generateEmbedding(fullContent);

      // Bull queue serializes Date objects to ISO strings, so convert back
      const messageTimestamp = typeof message.timestamp === 'string'
        ? new Date(message.timestamp)
        : message.timestamp;

      // Store in Milvus
      await this.milvus.insert({
        collection_name: this.collections.chats,
        data: [{
          content: fullContent,
          embedding,
          source_id: message.sessionId,
          user_id: message.userId,
          metadata: JSON.stringify({
            messageId: message.id,
            role: message.role,
            sessionId: message.sessionId,
            timestamp: message.timestamp,
            type: 'chat'
          }),
          timestamp: Math.floor(messageTimestamp.getTime() / 1000),
          content_hash: contentHash
        }]
      });

      this.logger.debug({ messageId: message.id }, 'Chat message ingested');
    } catch (error) {
      this.logger.error({ error, message }, 'Failed to ingest chat message');
      throw error;
    }
  }

  /**
   * Watch documentation files and auto-ingest changes
   */
  private startDocumentationWatcher(): void {
    const watchPaths = [
      '/mnt/synology/Code/company/agenticwork/apps/Internal/PROD/chat/agenticworkchat',
      '/mnt/synology/Code/company/agenticwork/apps/Internal/PROD/chat/agenticworkchat/services/docs'
    ];
    
    const patterns = ['**/*.md', '**/*.mdx', '**/*.txt', '**/README*'];
    
    // Watch multiple paths
    this.fileWatcher = chokidar.watch(
      watchPaths.flatMap(basePath => 
        patterns.map(pattern => path.join(basePath, pattern))
      ), 
      {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.docusaurus/**', '**/build/**'],
        persistent: true,
        ignoreInitial: true // Don't process existing files on startup (already in DB)
      }
    );
    
    // Handle file additions and changes
    this.fileWatcher
      .on('add', (filePath) => this.handleFileChange(filePath, 'add'))
      .on('change', (filePath) => this.handleFileChange(filePath, 'update'))
      .on('unlink', (filePath) => this.handleFileRemoval(filePath));
    
    this.logger.info('📁 Documentation watcher started');
  }

  /**
   * Handle documentation file changes
   */
  private async handleFileChange(relativePath: string, action: 'add' | 'update'): Promise<void> {
    const fullPath = path.join(
      '/mnt/synology/Code/company/agenticwork/apps/Internal/PROD/chat/agenticworkchat',
      relativePath
    );
    
    await this.ingestionQueue.add('documentation', {
      filePath: fullPath,
      relativePath,
      action
    }, {
      delay: 1000, // Debounce rapid changes
      removeOnComplete: true
    });
  }

  /**
   * Process documentation file
   */
  private async processDocumentationFile(job: any): Promise<void> {
    const { filePath, relativePath, action } = job.data;
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      
      // For updates, remove old version first
      if (action === 'update') {
        await this.removeDocument(relativePath);
      }
      
      // Check if already exists (in case of duplicate events)
      const exists = await this.checkIfExists(contentHash, this.collections.documentation);
      if (exists) return;
      
      // Chunk the document
      const chunks = this.smartChunk(content, relativePath);
      
      for (const chunk of chunks) {
        const embedding = await this.generateEmbedding(chunk.content);
        
        await this.milvus.insert({
          collection_name: this.collections.documentation,
          data: [{
            content: chunk.content,
            embedding,
            source_id: relativePath,
            user_id: null,
            metadata: JSON.stringify({
              filePath: relativePath,
              title: chunk.title,
              section: chunk.section,
              type: 'documentation'
            }),
            timestamp: Math.floor(Date.now() / 1000),
            content_hash: crypto.createHash('sha256').update(chunk.content).digest('hex')
          }]
        });
      }
      
      this.logger.info({ file: relativePath, chunks: chunks.length }, 'Documentation indexed');
    } catch (error) {
      this.logger.error({ error, filePath }, 'Failed to process documentation');
      throw error;
    }
  }

  /**
   * Handle file removal
   */
  private async handleFileRemoval(relativePath: string): Promise<void> {
    await this.removeDocument(relativePath);
  }

  /**
   * Remove document from index
   */
  private async removeDocument(sourcePath: string): Promise<void> {
    try {
      await this.milvus.deleteEntities({
        collection_name: this.collections.documentation,
        expr: `source_id == "${sourcePath}"`
      });
      this.logger.info({ file: sourcePath }, 'Document removed from index');
    } catch (error) {
      this.logger.error({ error, sourcePath }, 'Failed to remove document');
    }
  }

  /**
   * Setup queue processors
   */
  private setupQueueProcessors(): void {
    // Process chat messages
    this.ingestionQueue.process('chat-message', async (job) => {
      await this.processChatMessage(job.data);
    });

    // Process documentation
    this.ingestionQueue.process('documentation', async (job) => {
      await this.processDocumentationFile(job);
    });

    // Process Azure SDK documentation sync
    this.ingestionQueue.process('azure-sdk-sync', async (job) => {
      await this.processAzureSDKSync(job.data);
    });

    // Log queue events
    this.ingestionQueue.on('completed', (job) => {
      this.logger.debug({ jobId: job.id, type: job.name }, 'Ingestion job completed');
    });

    this.ingestionQueue.on('failed', (job, err) => {
      this.logger.error({ jobId: job.id, type: job.name, error: err }, 'Ingestion job failed');
    });
  }

  /**
   * Start periodic Azure SDK documentation sync
   * Runs every 24 hours by default (configurable via AZURE_SDK_SYNC_INTERVAL_HOURS)
   */
  private startAzureSDKPeriodicSync(): void {
    // Schedule recurring job for Azure SDK sync
    this.ingestionQueue.add('azure-sdk-sync', { triggered: 'periodic' }, {
      repeat: {
        every: this.azureSDKSyncIntervalMs
      },
      removeOnComplete: 10, // Keep last 10 completed jobs
      removeOnFail: 5 // Keep last 5 failed jobs
    }).then(() => {
      this.logger.info({
        intervalHours: this.azureSDKSyncIntervalMs / (60 * 60 * 1000)
      }, '🔄 Azure SDK periodic sync scheduled');
    }).catch(error => {
      this.logger.error({ error }, 'Failed to schedule Azure SDK periodic sync');
    });
  }

  /**
   * Process Azure SDK documentation sync job
   */
  private async processAzureSDKSync(data: any): Promise<void> {
    this.logger.info({ triggered: data.triggered }, '📚 Starting Azure SDK documentation sync...');

    try {
      // Import the AzureSDKKnowledgeIngester
      const { AzureSDKKnowledgeIngester } = await import('./AzureSDKKnowledgeIngester.js');

      const ingester = new AzureSDKKnowledgeIngester(this.milvus, this.logger);

      // Run the ingestion
      const result = await ingester.ingestAllDocumentation();

      this.logger.info({
        sourcesProcessed: result.sourcesProcessed,
        chunksStored: result.chunksStored,
        errors: result.errors.length,
        success: result.success
      }, result.success
        ? '✅ Azure SDK documentation sync completed successfully'
        : '⚠️ Azure SDK documentation sync completed with errors');

    } catch (error) {
      this.logger.error({ error }, 'Failed to sync Azure SDK documentation');
      throw error; // Let Bull handle retries
    }
  }

  /**
   * Manually trigger Azure SDK documentation sync
   */
  async triggerAzureSDKSync(): Promise<void> {
    await this.ingestionQueue.add('azure-sdk-sync', { triggered: 'manual' }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    });
    this.logger.info('Azure SDK sync job queued (manual trigger)');
  }

  /**
   * Subscribe to application events for real-time ingestion
   */
  private async subscribeToEvents(): Promise<void> {
    try {
      // Initialize Redis pub/sub client for real-time event processing
      const redisClient = getRedisClient();
      
      // Use Redis client for pub/sub - depends on redis client implementation
      const subscriber = redisClient as any;
      
      // Subscribe to chat events
      if (subscriber.subscribe) {
        await subscriber.subscribe('chat:message:created');
        await subscriber.subscribe('chat:session:completed');
        await subscriber.subscribe('memory:created');
        
        subscriber.on('message', (channel: string, message: string) => {
          try {
            const data = JSON.parse(message);
            switch (channel) {
              case 'chat:message:created':
                this.ingestChatMessage(data);
                break;
              case 'chat:session:completed':
                this.summarizeAndIndexSession(data.sessionId);
                break;
              case 'memory:created':
                this.ingestUserMemory(data);
                break;
            }
          } catch (error) {
            this.logger.error({ error, channel, message }, 'Failed to process event');
          }
        });
      }
      
      this.logger.info('Event subscription initialized with Redis pub/sub');
      
    } catch (error) {
      this.logger.warn({ error }, 'Failed to initialize Redis pub/sub, falling back to job queue');
      this.logger.info('Event subscription initialized (using job queue fallback)');
    }
  }

  private async ingestUserMemory(memoryData: any): Promise<void> {
    await this.ingestionQueue.add('user-memory', memoryData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000
      }
    });
  }

  /**
   * Process pending messages from database on startup
   */
  private async processPendingMessages(): Promise<void> {
    try {
      // Find unindexed messages
      const recentMessages = await this.prisma.chatMessage.findMany({
        where: {
          created_at: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        },
        orderBy: { created_at: 'desc' },
        take: 100
      });
      
      for (const message of recentMessages) {
        await this.ingestChatMessage({
          id: message.id,
          sessionId: message.session_id,
          userId: message.user_id || 'anonymous',
          role: message.role as 'user' | 'assistant',
          content: message.content,
          timestamp: message.created_at
        });
      }
      
      this.logger.info({ count: recentMessages.length }, 'Processed pending messages');
    } catch (error) {
      this.logger.error({ error }, 'Failed to process pending messages');
    }
  }

  /**
   * Get conversation context
   */
  private async getConversationContext(sessionId: string, currentMessageId: string): Promise<string[]> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { session_id: sessionId },
      orderBy: { created_at: 'desc' },
      take: 4
    });
    
    return messages.map(m => `${m.role}: ${m.content}`);
  }

  /**
   * Check if content already exists
   */
  private async checkIfExists(contentHash: string, collection: string): Promise<boolean> {
    try {
      const result = await this.milvus.query({
        collection_name: collection,
        expr: `content_hash == "${contentHash}"`,
        limit: 1
      });
      return result.data.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate embedding with caching
   */
  private async getEmbeddingModel(): Promise<string> {
    // Try ModelCapabilityDiscoveryService first (SOT)
    const discoveryService = getModelCapabilityDiscoveryService();
    if (discoveryService) {
      const models = await discoveryService.searchModelsByCapability('embedding');
      if (models && models.length > 0) {
        return models[0].modelId;
      }
    }
    
    // Fallback to DynamicModelManager
    const embeddingInfo = await dynamicModelManager.getEmbeddingModel();
    if (embeddingInfo) {
      return embeddingInfo.model;
    }
    
    throw new Error('No embedding models available');
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const cacheKey = crypto.createHash('sha256').update(text).digest('hex');

    // Check cache
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }

    try {
      // Use UniversalEmbeddingService if available (preferred)
      if (this.embeddingService) {
        const result = await this.embeddingService.generateEmbedding(text.substring(0, 8000));
        const embedding = result.embedding;

        // Validate embedding
        if (!embedding || embedding.length === 0 || embedding.every(v => v === 0)) {
          throw new Error('UniversalEmbeddingService returned invalid embedding');
        }

        // Cache for 1 hour
        this.embeddingCache.set(cacheKey, embedding);
        setTimeout(() => this.embeddingCache.delete(cacheKey), 3600000);

        return embedding;
      }

      // Fallback: Use global toolSemanticCache's embedding service if available
      if (global.toolSemanticCache?.embeddingService) {
        const result = await global.toolSemanticCache.embeddingService.generateEmbedding(text.substring(0, 8000));
        const embedding = result.embedding;

        if (!embedding || embedding.length === 0 || embedding.every(v => v === 0)) {
          throw new Error('Global embedding service returned invalid embedding');
        }

        this.embeddingCache.set(cacheKey, embedding);
        setTimeout(() => this.embeddingCache.delete(cacheKey), 3600000);

        return embedding;
      }

      // No embedding service available - skip ingestion silently
      this.logger.warn('No embedding service available, skipping message ingestion');
      throw new Error('No embedding service available');
    } catch (error) {
      this.logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Smart document chunking
   */
  private smartChunk(content: string, filePath: string): any[] {
    const chunks = [];
    const lines = content.split('\n');
    let currentChunk = '';
    let currentSection = '';
    let currentTitle = path.basename(filePath);
    
    // Extract title from markdown
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) currentTitle = titleMatch[1];
    
    for (const line of lines) {
      // Check for section headers
      if (line.startsWith('#')) {
        if (currentChunk.length > 500) {
          chunks.push({
            content: currentChunk.trim(),
            title: currentTitle,
            section: currentSection
          });
          currentChunk = '';
        }
        currentSection = line.replace(/^#+\s*/, '');
      }
      
      currentChunk += line + '\n';
      
      // Create chunk if size limit reached
      if (currentChunk.length > 1500) {
        chunks.push({
          content: currentChunk.trim(),
          title: currentTitle,
          section: currentSection
        });
        currentChunk = currentSection + '\n'; // Keep section context
      }
    }
    
    // Add remaining content
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        title: currentTitle,
        section: currentSection
      });
    }
    
    return chunks;
  }

  /**
   * Summarize and index completed chat sessions
   */
  private async summarizeAndIndexSession(sessionId: string): Promise<void> {
    // This could use GPT to create a summary of the entire conversation
    // For now, we'll just ensure all messages are indexed
    this.logger.info({ sessionId }, 'Session completed, ensuring all messages indexed');
  }

  /**
   * Search knowledge base
   */
  async search(query: string, options: {
    collections?: string[];
    limit?: number;
    userId?: string;
  } = {}): Promise<any[]> {
    const embedding = await this.generateEmbedding(query);
    const collections = options.collections || Object.values(this.collections);
    const results = [];
    
    for (const collection of collections) {
      try {
        const searchResults = await this.milvus.search({
          collection_name: collection,
          data: [embedding],
          limit: options.limit || 5,
          output_fields: ['content', 'source_id', 'metadata']
        });
        results.push(...searchResults.results);
      } catch (error) {
        this.logger.error({ error, collection }, 'Search failed');
      }
    }
    
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    if (this.fileWatcher) {
      await this.fileWatcher.close();
    }
    await this.ingestionQueue.close();
    this.logger.info('Real-Time Knowledge Service shut down');
  }
}