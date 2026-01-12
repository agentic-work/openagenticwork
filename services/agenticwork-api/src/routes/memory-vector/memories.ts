/**
 * User Memory Management Routes
 * 
 * Provides comprehensive memory operations including storage, retrieval, 
 * semantic clustering, and multi-modal processing. Features advanced 
 * search capabilities and cross-session memory synthesis.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import * as jwt from 'jsonwebtoken';
import { VectorAnalytics } from '../../services/VectorAnalytics.js';
import { EnhancedMemoryService } from '../../services/EnhancedMemoryService.js';
import { FileAttachmentService } from '../../services/FileAttachmentService.js';
import { MemoryService } from '../../services/MemoryService.js';
import { UnifiedVectorStorage } from '../../services/UnifiedVectorStorage.js';
import { UnifiedVectorSearch } from '../../services/UnifiedVectorSearch.js';
import { getRedisClient } from '../../utils/redis-client.js';
import { MilvusService } from '../../services/MilvusService.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for memory routes');
}

export const memoriesRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Initialize services
  const vectorAnalytics = new VectorAnalytics(logger as any);
  const fileService = new FileAttachmentService({}, logger as any);
  const redisClient = getRedisClient();
  
  // Initialize Milvus service for vector operations
  let milvusService = null;
  try {
    milvusService = new MilvusService(logger as any);
    logger.info('MilvusService initialized for advanced memory features');
  } catch (error) {
    logger.warn('MilvusService unavailable, advanced memory features will be limited');
  }
  
  const memoryService = new MemoryService(logger as any, prisma, null);
  const enhancedMemoryService = new EnhancedMemoryService(
    logger as any, 
    prisma, 
    memoryService, 
    null, // LLM client not needed for basic operations
    redisClient, // Enable caching for memory operations
    milvusService, // Enable vector operations for semantic clustering
    fileService
  );
  
  // Initialize vector services for real vector operations (only if embeddings are enabled)
  const embeddingsEnabled = process.env.EMBEDDING_ENABLED !== 'false' &&
                            process.env.ENABLE_VECTOR_SEARCH !== 'false';

  let vectorStorage: UnifiedVectorStorage | null = null;
  let vectorSearch: UnifiedVectorSearch | null = null;

  if (embeddingsEnabled) {
    try {
      vectorStorage = new UnifiedVectorStorage(logger as any);
      vectorSearch = new UnifiedVectorSearch(vectorStorage, logger as any);
      logger.info('Vector services initialized for memory routes');
    } catch (error) {
      logger.warn({ error }, 'Failed to initialize vector services, vector operations will be disabled');
    }
  } else {
    logger.info('Vector services disabled (EMBEDDING_ENABLED=false or ENABLE_VECTOR_SEARCH=false)');
  }

  // Helper to get user from token
  const getUserFromToken = (request: any): string | null => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return decoded.userId || decoded.id || decoded.oid;
    } catch (error) {
      logger.warn({ error }, 'Failed to decode user token');
      return null;
    }
  };

  /**
   * List user memories
   * GET /api/memories
   */
  fastify.get('/', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { 
        search, 
        category, 
        limit = 50, 
        offset = 0,
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = request.query as {
        search?: string;
        category?: string;
        limit?: number;
        offset?: number;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
      };

      const where: any = { user_id: userId };
      
      if (search) {
        where.OR = [
          { content: { contains: search, mode: 'insensitive' } },
          { memory_key: { contains: search, mode: 'insensitive' } }
        ];
      }
      
      if (category) {
        where.category = category;
      }

      const [memories, totalCount] = await Promise.all([
        prisma.userMemory.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          take: parseInt(limit.toString()),
          skip: parseInt(offset.toString())
        }),
        
        prisma.userMemory.count({ where })
      ]);

      // Get categories for filter options
      const categories = await prisma.userMemory.groupBy({
        by: ['category'],
        where: { user_id: userId },
        _count: true
      });

      return reply.send({
        memories: memories.map(memory => ({
          id: memory.id,
          memoryKey: memory.memory_key,
          content: memory.content,
          category: memory.category,
          importance: memory.importance,
          metadata: memory.metadata as Record<string, any> || {},
          createdAt: memory.created_at,
          updatedAt: memory.updated_at,
          lastAccessed: memory.last_accessed_at
        })),
        pagination: {
          total: totalCount,
          limit: parseInt(limit.toString()),
          offset: parseInt(offset.toString()),
          hasMore: totalCount > parseInt(offset.toString()) + parseInt(limit.toString())
        },
        categories: categories.map(cat => ({
          name: cat.category,
          count: cat._count
        }))
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list memories');
      return reply.code(500).send({ error: 'Failed to retrieve memories' });
    }
  });

  /**
   * Create enhanced memory with multi-modal processing and clustering
   * POST /api/memories
   */
  fastify.post('/', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        memoryKey,
        content,
        category = 'general',
        importance = 5,
        metadata = {},
        imageId,
        fileId,
        enableClustering = true,
        enableDecay = true,
        enableMultiModal = true
      } = request.body as {
        memoryKey: string;
        content: string;
        category?: string;
        importance?: number;
        metadata?: Record<string, any>;
        imageId?: string;
        fileId?: string;
        enableClustering?: boolean;
        enableDecay?: boolean;
        enableMultiModal?: boolean;
      };

      if (!memoryKey || !content) {
        return reply.code(400).send({ error: 'Memory key and content are required' });
      }

      // Use enhanced memory service
      const result = await enhancedMemoryService.createEnhancedMemory({
        userId,
        memoryKey,
        content,
        category,
        importance,
        metadata,
        imageId,
        fileId,
        enableClustering,
        enableDecay,
        enableMultiModal
      });

      const responseCode = result.created ? 201 : 200;
      const response: any = {
        memory: result.memory,
        created: result.created,
        enhanced: {
          multiModalProcessed: !!result.processing,
          clustersUpdated: result.clustering?.length || 0,
          processingTime: result.processing?.processing_time
        }
      };

      // Include processing results if available
      if (result.processing && result.processing.success) {
        response.enhanced.multiModal = {
          type: result.processing.multiModalMemory?.type,
          confidence: result.processing.multiModalMemory?.metadata.confidence_score,
          extractedEntities: result.processing.multiModalMemory?.metadata.extracted_entities?.slice(0, 10),
          modalityWeights: result.processing.multiModalMemory?.metadata.modality_weights
        };
      }

      // Include top clusters if available
      if (result.clustering && result.clustering.length > 0) {
        response.enhanced.topClusters = result.clustering.slice(0, 3).map(cluster => ({
          topic: cluster.topic,
          confidence: cluster.confidence,
          memoryCount: cluster.memories.length
        }));
      }

      return reply.code(responseCode).send(response);

    } catch (error) {
      logger.error({ error }, 'Failed to create enhanced memory');
      return reply.code(500).send({ error: 'Failed to create memory' });
    }
  });

  /**
   * Get specific memory
   * GET /api/memories/:id
   */
  fastify.get('/:id', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };

      const memory = await prisma.userMemory.findFirst({
        where: {
          id,
          user_id: userId
        }
      });

      if (!memory) {
        return reply.code(404).send({ error: 'Memory not found' });
      }

      // Update last accessed timestamp
      await prisma.userMemory.update({
        where: { id },
        data: { last_accessed_at: new Date() }
      });

      return reply.send({
        memory: {
          id: memory.id,
          memoryKey: memory.memory_key,
          content: memory.content,
          category: memory.category,
          importance: memory.importance,
          metadata: memory.metadata as Record<string, any> || {},
          createdAt: memory.created_at,
          updatedAt: memory.updated_at,
          lastAccessed: memory.last_accessed_at
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get memory');
      return reply.code(500).send({ error: 'Failed to retrieve memory' });
    }
  });

  /**
   * Update memory
   * PUT /api/memories/:id
   */
  fastify.put('/:id', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const {
        content,
        category,
        importance,
        metadata
      } = request.body as {
        content?: string;
        category?: string;
        importance?: number;
        metadata?: Record<string, any>;
      };

      const updateData: any = { updated_at: new Date() };
      if (content) updateData.content = content;
      if (category) updateData.category = category;
      if (typeof importance === 'number') updateData.importance = importance;
      if (metadata) updateData.metadata = metadata;

      const updatedMemory = await prisma.userMemory.updateMany({
        where: {
          id,
          user_id: userId
        },
        data: updateData
      });

      if (updatedMemory.count === 0) {
        return reply.code(404).send({ error: 'Memory not found' });
      }

      // Get updated memory
      const memory = await prisma.userMemory.findFirst({
        where: { id, user_id: userId }
      });

      return reply.send({
        memory: memory ? {
          id: memory.id,
          memoryKey: memory.memory_key,
          content: memory.content,
          category: memory.category,
          importance: memory.importance,
          metadata: memory.metadata as Record<string, any> || {},
          createdAt: memory.created_at,
          updatedAt: memory.updated_at
        } : null
      });
    } catch (error) {
      logger.error({ error }, 'Failed to update memory');
      return reply.code(500).send({ error: 'Failed to update memory' });
    }
  });

  /**
   * Delete memory
   * DELETE /api/memories/:id
   */
  fastify.delete('/:id', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };

      const deletedMemory = await prisma.userMemory.deleteMany({
        where: {
          id,
          user_id: userId
        }
      });

      if (deletedMemory.count === 0) {
        return reply.code(404).send({ error: 'Memory not found' });
      }

      return reply.send({ success: true, message: 'Memory deleted successfully' });
    } catch (error) {
      logger.error({ error }, 'Failed to delete memory');
      return reply.code(500).send({ error: 'Failed to delete memory' });
    }
  });

  /**
   * Enhanced memory search with semantic clustering and contextual prioritization
   * POST /api/memories/search
   */
  fastify.post('/search', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        query,
        category,
        minImportance,
        limit = 10,
        semanticSearch = false,
        useSemanticSearch = false,
        useContextualPrioritization = false
      } = request.body as {
        query: string;
        category?: string;
        minImportance?: number;
        limit?: number;
        semanticSearch?: boolean; // Legacy support
        useSemanticSearch?: boolean;
        useContextualPrioritization?: boolean;
      };

      if (!query) {
        return reply.code(400).send({ error: 'Search query is required' });
      }

      // Use enhanced memory service for search
      const searchResult = await enhancedMemoryService.enhancedMemorySearch({
        userId,
        query,
        category,
        minImportance,
        limit,
        useSemanticSearch: useSemanticSearch || semanticSearch,
        useContextualPrioritization
      });

      const response: any = {
        query,
        results: searchResult.results,
        totalResults: searchResult.totalResults,
        searchType: searchResult.searchType,
        enhanced: {
          clustersFound: searchResult.clusters?.length || 0,
          prioritizationApplied: !!searchResult.prioritization,
          searchCapabilities: {
            semanticClustering: useSemanticSearch || semanticSearch,
            contextualPrioritization: useContextualPrioritization,
            textSearch: true
          }
        }
      };

      // Include cluster information if semantic search was used
      if (searchResult.clusters && searchResult.clusters.length > 0) {
        response.enhanced.clusters = searchResult.clusters.slice(0, 5).map(cluster => ({
          topic: cluster.topic,
          confidence: cluster.confidence,
          keyInsights: cluster.keyInsights.slice(0, 3),
          memoryCount: cluster.memories.length
        }));
      }

      // Include prioritization info if contextual search was used
      if (searchResult.prioritization && searchResult.prioritization.length > 0) {
        response.enhanced.prioritization = {
          topFactors: searchResult.prioritization.slice(0, 5).map(p => ({
            memoryId: p.memory_id,
            score: p.contextual_score,
            factors: p.relevance_factors
          }))
        };
      }

      return reply.send(response);

    } catch (error) {
      logger.error({ error }, 'Failed to perform enhanced memory search');
      return reply.code(500).send({ error: 'Memory search failed' });
    }
  });

  /**
   * Get memory clusters for a user
   * GET /api/memories/clusters
   */
  fastify.get('/clusters', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const clusters = await enhancedMemoryService.getMemoryClusters(userId);

      return reply.send({
        userId,
        clusters: clusters.map(cluster => ({
          id: cluster.clusterId,
          topic: cluster.topic,
          confidence: cluster.confidence,
          memoryCount: cluster.memories.length,
          keyInsights: cluster.keyInsights,
          topMemories: cluster.memories.slice(0, 3).map(memory => ({
            id: memory.id,
            memoryKey: memory.memoryKey,
            content: memory.content.substring(0, 200) + (memory.content.length > 200 ? '...' : ''),
            relevanceScore: memory.relevanceScore
          }))
        })),
        summary: {
          totalClusters: clusters.length,
          highConfidenceClusters: clusters.filter(c => c.confidence > 0.8).length,
          topTopics: clusters.slice(0, 5).map(c => c.topic)
        }
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get memory clusters');
      return reply.code(500).send({ error: 'Failed to retrieve memory clusters' });
    }
  });

  /**
   * Get comprehensive memory analytics
   * GET /api/memories/analytics
   */
  fastify.get('/analytics', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const analytics = await enhancedMemoryService.getMemoryAnalytics(userId);

      return reply.send({
        userId,
        analytics: {
          overview: {
            totalMemories: analytics.totalMemories,
            activeClusters: analytics.activeClusters,
            multiModalMemories: analytics.multiModalMemories,
            memoryDecayRate: analytics.memoryDecayRate
          },
          categories: {
            distribution: analytics.topCategories,
            topCategory: analytics.topCategories[0]?.category || 'general'
          },
          importance: {
            distribution: analytics.importanceDistribution,
            averageImportance: Object.entries(analytics.importanceDistribution)
              .reduce((acc, [importance, count]) => acc + (parseInt(importance) * count), 0) / 
              Object.values(analytics.importanceDistribution).reduce((acc, count) => acc + count, 0) || 0
          },
          patterns: {
            crossSessionTopics: analytics.crossSessionTopics,
            temporalPatterns: analytics.temporalPatterns
          }
        },
        insights: {
          mostActiveTopics: analytics.crossSessionTopics.slice(0, 3),
          clusteringEffectiveness: analytics.activeClusters / Math.max(analytics.totalMemories, 1),
          multiModalAdoption: analytics.multiModalMemories / Math.max(analytics.totalMemories, 1),
          memoryHealth: analytics.memoryDecayRate < 0.2 ? 'good' : 'needs_attention'
        }
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get memory analytics');
      return reply.code(500).send({ error: 'Failed to retrieve memory analytics' });
    }
  });

  /**
   * Cross-session memory synthesis
   * POST /api/memories/synthesize
   */
  fastify.post('/synthesize', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { topic } = request.body as { topic: string };

      if (!topic) {
        return reply.code(400).send({ error: 'Topic is required for synthesis' });
      }

      const synthesis = await enhancedMemoryService.synthesizeMemoriesAcrossSessions(userId, topic);

      if (!synthesis) {
        return reply.code(404).send({ 
          error: 'No cross-session memories found for the specified topic',
          topic,
          suggestion: 'Try a more general topic or ensure you have memories from multiple sessions'
        });
      }

      return reply.send({
        userId,
        topic,
        synthesis: {
          synthesizedContext: synthesis.synthesized_context,
          confidenceScore: synthesis.confidence_score,
          keyInsights: synthesis.key_insights,
          sourceSessions: synthesis.source_sessions,
          createdAt: new Date(synthesis.created_at).toISOString()
        },
        metadata: {
          sessionsInvolved: synthesis.source_sessions.length,
          insightsExtracted: synthesis.key_insights.length,
          qualityScore: synthesis.confidence_score > 0.7 ? 'high' : 
                       synthesis.confidence_score > 0.5 ? 'medium' : 'low'
        }
      });

    } catch (error) {
      logger.error({ error }, 'Failed to synthesize memories');
      return reply.code(500).send({ error: 'Memory synthesis failed' });
    }
  });

  /**
   * List vector collections
   * GET /api/vectors/collections
   */
  fastify.get('/vectors/collections', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const collections = await prisma.userVectorCollections.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' }
      });

      // Get actual vector counts from vector storage
      const enhancedCollections = await Promise.all(
        collections.map(async (collection) => {
          let vectorCount = 0;
          try {
            // Get actual vector count using vector storage service (if available)
            if (vectorStorage) {
              const stats = await vectorStorage.getStorageStats(userId);
              vectorCount = stats.totalVectors || 0;
            }
          } catch (error) {
            logger.debug({ error, collectionName: collection.collection_name }, 'Failed to get vector count, using 0');
          }
          
          return {
            id: collection.id,
            name: collection.collection_name,
            userId: collection.user_id,
            vectorCount,
            dimensions: 1536, // Default embedding dimension
            indexType: 'HNSW',
            metricType: 'COSINE',
            createdAt: collection.created_at,
            updatedAt: collection.updated_at,
            description: collection.metadata ? 
              (collection.metadata as any).description : 
              `Vector collection for ${collection.collection_name}`,
            status: 'active'
          };
        })
      );

      return reply.send({
        collections: enhancedCollections,
        summary: {
          totalCollections: collections.length,
          totalVectors: enhancedCollections.reduce((sum, c) => sum + c.vectorCount, 0)
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list vector collections');
      return reply.code(500).send({ error: 'Failed to retrieve vector collections' });
    }
  });

  /**
   * Vector similarity search
   * POST /api/vectors/search
   */
  fastify.post('/vectors/search', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        query,
        collectionName,
        topK = 10,
        threshold = 0.7,
        includeMetadata = true
      } = request.body as {
        query: string;
        collectionName?: string;
        topK?: number;
        threshold?: number;
        includeMetadata?: boolean;
      };

      if (!query) {
        return reply.code(400).send({ error: 'Search query is required' });
      }

      // Perform real vector search using UnifiedVectorSearch
      logger.info({ query, userId, collectionName, topK, threshold }, 'Performing vector search');

      const startTime = Date.now();

      // Check if vector search is available
      if (!vectorSearch) {
        logger.info('Vector search not available, using text fallback');

        // Fallback to basic text search in user memories
        const fallbackResults = await prisma.userMemory.findMany({
          where: {
            user_id: userId,
            OR: [
              { content: { contains: query, mode: 'insensitive' } },
              { memory_key: { contains: query, mode: 'insensitive' } }
            ]
          },
          orderBy: { importance: 'desc' },
          take: topK
        });

        const fallbackMapped = fallbackResults.map((memory, index) => ({
          id: memory.id,
          score: Math.max(0.7 - (index * 0.1), 0.3),
          content: memory.content,
          metadata: includeMetadata ? {
            source: 'user_memory_text_search',
            type: 'memory',
            timestamp: memory.created_at.toISOString(),
            category: memory.category || 'general',
            memoryKey: memory.memory_key,
            importance: memory.importance
          } : undefined
        }));

        const searchTime = Date.now() - startTime;

        return reply.send({
          query,
          collectionName: collectionName || 'text_search',
          results: fallbackMapped,
          searchParams: { topK, threshold, includeMetadata },
          totalResults: fallbackMapped.length,
          searchTime,
          searchType: 'text_search',
          info: 'Vector search disabled, using text search',
          enhanced: { queryExpansion: false, multiModalSearch: false, semanticReranking: false }
        });
      }

      try {
        const searchResults = await vectorSearch.semanticSearch(query, userId, {
          expandQuery: true,
          contextualKeywords: [],
          domainFocus: collectionName || undefined,
          multiModalSearch: true
        });
        
        // Filter results based on threshold
        const filteredResults = searchResults
          .filter(result => result.score >= threshold)
          .slice(0, topK)
          .map(result => ({
            id: result.id,
            score: result.score,
            content: result.content,
            metadata: includeMetadata ? {
              source: result.source,
              type: result.type,
              timestamp: result.createdAt?.toISOString() || new Date().toISOString(),
              category: result.metadata?.category || 'general',
              userId: result.userId,
              ...result.metadata
            } : undefined
          }));
        
        const searchTime = Date.now() - startTime;
        
        return reply.send({
          query,
          collectionName: collectionName || 'unified_search',
          results: filteredResults,
          searchParams: {
            topK,
            threshold,
            includeMetadata
          },
          totalResults: filteredResults.length,
          searchTime,
          searchType: 'semantic_vector_search',
          enhanced: {
            queryExpansion: true,
            multiModalSearch: true,
            semanticReranking: true
          }
        });
        
      } catch (searchError) {
        logger.error({ error: searchError, query, userId }, 'Vector search failed');
        
        // Fallback to basic text search in user memories if vector search fails
        const fallbackResults = await prisma.userMemory.findMany({
          where: {
            user_id: userId,
            OR: [
              { content: { contains: query, mode: 'insensitive' } },
              { memory_key: { contains: query, mode: 'insensitive' } }
            ]
          },
          orderBy: { importance: 'desc' },
          take: topK
        });
        
        const fallbackMapped = fallbackResults.map((memory, index) => ({
          id: memory.id,
          score: Math.max(0.7 - (index * 0.1), 0.3), // Decreasing scores
          content: memory.content,
          metadata: includeMetadata ? {
            source: 'user_memory_fallback',
            type: 'memory',
            timestamp: memory.created_at.toISOString(),
            category: memory.category || 'general',
            memoryKey: memory.memory_key,
            importance: memory.importance
          } : undefined
        }));
        
        const searchTime = Date.now() - startTime;
        
        return reply.send({
          query,
          collectionName: collectionName || 'fallback_search',
          results: fallbackMapped,
          searchParams: {
            topK,
            threshold,
            includeMetadata
          },
          totalResults: fallbackMapped.length,
          searchTime,
          searchType: 'text_fallback_search',
          warning: 'Vector search failed, using text fallback',
          enhanced: {
            queryExpansion: false,
            multiModalSearch: false,
            semanticReranking: false
          }
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to perform vector search');
      return reply.code(500).send({ error: 'Vector search failed' });
    }
  });

  /**
   * Vector usage analytics
   * GET /api/vectors/analytics
   */
  fastify.get('/vectors/analytics', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { timeRange = '30d' } = request.query as { timeRange?: string };

      // Calculate time range
      const now = new Date();
      let fromDate = new Date();
      
      switch (timeRange) {
        case '7d':
          fromDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          fromDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          fromDate.setDate(now.getDate() - 90);
          break;
        default:
          fromDate.setDate(now.getDate() - 30);
      }

      const analytics = await vectorAnalytics.getUserMetrics(userId, {
        from: fromDate,
        to: now
      });

      return reply.send({
        userId,
        timeRange,
        analytics: {
          storage: analytics.storage,
          search: analytics.search,
          collections: analytics.collections,
          recommendations: analytics.recommendations
        },
        summary: {
          totalVectors: analytics.storage.totalVectors,
          totalSearches: analytics.search.totalSearches,
          storageUsed: `${Math.round(analytics.storage.totalSizeBytes / (1024 * 1024))} MB`,
          avgSearchTime: `${Math.round(analytics.search.avgSearchTime)}ms`
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get vector analytics');
      return reply.code(500).send({ error: 'Failed to retrieve analytics' });
    }
  });
};