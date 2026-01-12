/**
 * RAG (Retrieval-Augmented Generation) Pipeline Stage
 *
 * This stage handles knowledge retrieval from vector databases to enhance
 * AI responses with relevant context from documentation and previous chats.
 *
 * Features:
 * - Document retrieval from Milvus vector database
 * - Previous chat context retrieval
 * - User artifact/report retrieval (reports, exports, saved files)
 * - User-specific knowledge scoping
 * - Admin access to all knowledge bases
 * - Relevance scoring and ranking
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ArtifactService } from '../../../services/ArtifactService.js';
import type { Logger } from 'pino';

interface RAGConfig {
  enabled: boolean;
  maxDocs: number;
  maxChats: number;
  maxArtifacts: number;
  minRelevanceScore: number;
  collections: string[];
  enableArtifactSearch: boolean;
}

interface RetrievedKnowledge {
  docs: Array<{
    content: string;
    metadata: {
      source?: string;
      title?: string;
      url?: string;
      timestamp?: Date;
    };
    score: number;
  }>;
  chats: Array<{
    content: string;
    metadata: {
      sessionId: string;
      userId: string;
      timestamp: Date;
    };
    score: number;
  }>;
  artifacts: Array<{
    content: string;
    metadata: {
      id: string;
      title: string;
      filename: string;
      mimeType: string;
      type: string;
      tags?: string[];
      createdAt: Date;
    };
    score: number;
  }>;
  metadata: {
    retrievalTime: number;
    totalResults: number;
    collections: string[];
    artifactsRetrieved?: number;
  };
}

export class RAGStage implements PipelineStage {
  name = 'rag';
  private logger: Logger;
  private artifactService: ArtifactService | null = null;
  private defaultConfig: RAGConfig = {
    enabled: true, // ENABLED: Artifact search works independently of doc collections
    maxDocs: 5,
    maxChats: 3,
    maxArtifacts: 5,
    minRelevanceScore: 0.3,  // Lower threshold for better recall (0.6 was too strict)
    collections: ['app_documentation', 'user_chats', 'knowledge_base'],
    enableArtifactSearch: true  // Always search user artifacts (reports, exports)
  };

  constructor(
    private knowledgeService: any,
    private milvusService: any,
    logger: any,
    private config?: Partial<RAGConfig>
  ) {
    this.logger = logger.child({ stage: this.name });
    this.config = { ...this.defaultConfig, ...config };

    // Initialize artifact service for report/export retrieval
    try {
      this.artifactService = new ArtifactService(this.logger);
      this.logger.info('[RAG] ArtifactService initialized for report retrieval');
    } catch (error) {
      this.logger.warn({ error: error.message }, '[RAG] ArtifactService unavailable, artifact search disabled');
    }
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    try {
      // Check if RAG is enabled
      if (!context.config.enableRAG && !this.config?.enabled) {
        this.logger.debug('RAG disabled, skipping stage');
        return context;
      }

      // Check if any services are available (artifact service can work alone)
      if (!this.knowledgeService && !this.milvusService && !this.artifactService) {
        this.logger.warn('No knowledge services available, skipping RAG');
        return context;
      }

      this.logger.info({
        userId: context.user?.id,
        message: context.request.message.substring(0, 100),
        isAdmin: context.user?.isAdmin
      }, '[RAG] Starting knowledge retrieval');

      // Retrieve relevant knowledge
      const knowledge = await this.retrieveKnowledge(context);

      const hasKnowledge = knowledge && (
        knowledge.docs.length > 0 ||
        knowledge.chats.length > 0 ||
        knowledge.artifacts.length > 0
      );

      if (hasKnowledge) {
        // Store in context for prompt enhancement
        context.ragContext = knowledge;

        // Add metadata for tracking
        context.metadata = {
          ...context.metadata,
          ragEnabled: true,
          ragDocsRetrieved: knowledge.docs.length,
          ragChatsRetrieved: knowledge.chats.length,
          ragArtifactsRetrieved: knowledge.artifacts.length,
          ragRetrievalTime: Date.now() - startTime
        };

        // Emit RAG status for UI
        context.emit('rag_status', {
          docsRetrieved: knowledge.docs.length,
          chatsRetrieved: knowledge.chats.length,
          artifactsRetrieved: knowledge.artifacts.length,
          collections: knowledge.metadata.collections,
          retrievalTime: knowledge.metadata.retrievalTime
        });

        this.logger.info({
          userId: context.user?.id,
          docsRetrieved: knowledge.docs.length,
          chatsRetrieved: knowledge.chats.length,
          artifactsRetrieved: knowledge.artifacts.length,
          retrievalTime: Date.now() - startTime
        }, '[RAG] Knowledge retrieval completed');
      } else {
        this.logger.info({
          userId: context.user?.id
        }, '[RAG] No relevant knowledge found');
      }

      return context;

    } catch (error) {
      this.logger.error({
        error: error.message,
        userId: context.user?.id,
        executionTime: Date.now() - startTime
      }, '[RAG] Knowledge retrieval failed');

      // RAG failures shouldn't block the pipeline
      context.emit('warning', {
        message: 'Knowledge retrieval unavailable',
        code: 'RAG_RETRIEVAL_FAILED'
      });

      return context;
    }
  }

  private async retrieveKnowledge(context: PipelineContext): Promise<RetrievedKnowledge | null> {
    const startTime = Date.now();
    const isAdmin = context.user?.isAdmin === true;
    const userId = context.user?.id;
    const message = context.request.message;

    const results: RetrievedKnowledge = {
      docs: [],
      chats: [],
      artifacts: [],
      metadata: {
        retrievalTime: 0,
        totalResults: 0,
        collections: []
      }
    };

    try {
      // Parallel retrieval from different sources
      const retrievalPromises: Promise<any>[] = [];

      // 1. Retrieve from documentation
      if (this.knowledgeService) {
        retrievalPromises.push(
          this.knowledgeService.search(message, {
            collections: ['app_documentation'],
            limit: isAdmin ? this.config!.maxDocs : Math.floor(this.config!.maxDocs! / 2),
            minScore: this.config!.minRelevanceScore
          }).then((docs: any[]) => {
            results.docs = docs || [];
            results.metadata.collections.push('app_documentation');
          }).catch((error: any) => {
            this.logger.warn({ error: error.message }, 'Failed to retrieve documentation');
          })
        );
      }

      // 2. Retrieve from Milvus if available
      if (this.milvusService) {
        // Search in knowledge base collection
        retrievalPromises.push(
          this.searchMilvusCollection('knowledge_base', message, this.config!.maxDocs!).then(docs => {
            if (docs && docs.length > 0) {
              results.docs.push(...docs);
              results.metadata.collections.push('knowledge_base');
            }
          }).catch(error => {
            this.logger.warn({ error: error.message }, 'Failed to search knowledge_base collection');
          })
        );

        // Search in user chats (only for the user's own chats unless admin)
        if (userId) {
          const chatFilter = isAdmin ? {} : { userId };
          retrievalPromises.push(
            this.searchMilvusCollection('user_chats', message, this.config!.maxChats!, chatFilter).then(chats => {
              if (chats && chats.length > 0) {
                results.chats = chats;
                results.metadata.collections.push('user_chats');
              }
            }).catch(error => {
              this.logger.warn({ error: error.message }, 'Failed to search user_chats collection');
            })
          );
        }
      }

      // 3. Search user artifacts (reports, exports, saved files)
      if (this.artifactService && this.config!.enableArtifactSearch && userId) {
        retrievalPromises.push(
          this.artifactService.searchArtifacts(userId, {
            query: message,
            limit: this.config!.maxArtifacts!,
            threshold: this.config!.minRelevanceScore
          }).then((response: { results: any[]; total: number }) => {
            const artifacts = response.results || [];
            if (artifacts.length > 0) {
              results.artifacts = artifacts.map(a => ({
                content: a.extractedText || a.description || `[${a.filename}]`,
                metadata: {
                  id: a.id,
                  title: a.title || a.filename,
                  filename: a.filename,
                  mimeType: a.mimeType,
                  type: a.type || 'file',
                  tags: a.tags,
                  createdAt: a.createdAt
                },
                score: a.score || 0.8
              }));
              results.metadata.collections.push('artifacts');
              results.metadata.artifactsRetrieved = results.artifacts.length;
            }
          }).catch((error: any) => {
            this.logger.warn({ error: error.message }, 'Failed to search artifacts');
          })
        );
      }

      // Wait for all retrievals to complete
      await Promise.all(retrievalPromises);

      // Sort by relevance score
      results.docs.sort((a, b) => b.score - a.score);
      results.chats.sort((a, b) => b.score - a.score);
      results.artifacts.sort((a, b) => b.score - a.score);

      // Limit results
      results.docs = results.docs.slice(0, this.config!.maxDocs!);
      results.chats = results.chats.slice(0, this.config!.maxChats!);
      results.artifacts = results.artifacts.slice(0, this.config!.maxArtifacts!);

      // Update metadata
      results.metadata.retrievalTime = Date.now() - startTime;
      results.metadata.totalResults = results.docs.length + results.chats.length + results.artifacts.length;

      return results.metadata.totalResults > 0 ? results : null;

    } catch (error) {
      this.logger.error({
        error: error.message,
        userId
      }, '[RAG] Failed to retrieve knowledge');
      return null;
    }
  }

  private async searchMilvusCollection(
    collection: string,
    query: string,
    limit: number,
    filter?: any
  ): Promise<any[]> {
    try {
      // Check if collection exists
      const hasCollection = await this.milvusService.hasCollection({
        collection_name: collection
      });

      if (!hasCollection.value) {
        this.logger.debug(`Collection ${collection} does not exist`);
        return [];
      }

      // Generate embedding for query
      const embedding = await this.generateEmbedding(query);
      if (!embedding) {
        return [];
      }

      // Search in Milvus
      const searchParams: any = {
        collection_name: collection,
        vectors: [embedding],
        vector_type: 101, // Float vector
        limit,
        output_fields: ['content', 'metadata'],
        params: JSON.stringify({ nprobe: 10 })
      };

      if (filter) {
        searchParams.filter = this.buildMilvusFilter(filter);
      }

      const searchResult = await this.milvusService.search(searchParams);

      if (searchResult.status.error_code === 'Success' && searchResult.results.length > 0) {
        return searchResult.results[0].map((result: any) => ({
          content: result.content,
          metadata: JSON.parse(result.metadata || '{}'),
          score: result.score
        }));
      }

      return [];

    } catch (error) {
      this.logger.error({
        error: error.message,
        collection
      }, 'Failed to search Milvus collection');
      return [];
    }
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      // Use the embedding service if available
      if (this.knowledgeService?.generateEmbedding) {
        return await this.knowledgeService.generateEmbedding(text);
      }

      // Fallback to a simple embedding (this should be replaced with actual embedding service)
      this.logger.warn('No embedding service available, using fallback');
      return null;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to generate embedding');
      return null;
    }
  }

  private buildMilvusFilter(filter: any): string {
    const conditions: string[] = [];

    if (filter.userId) {
      conditions.push(`userId == "${filter.userId}"`);
    }

    if (filter.sessionId) {
      conditions.push(`sessionId == "${filter.sessionId}"`);
    }

    if (filter.afterDate) {
      conditions.push(`timestamp > ${filter.afterDate.getTime()}`);
    }

    return conditions.join(' && ');
  }

  async rollback(context: PipelineContext): Promise<void> {
    // Clean up RAG context
    delete context.ragContext;

    if (context.metadata) {
      delete context.metadata.ragEnabled;
      delete context.metadata.ragDocsRetrieved;
      delete context.metadata.ragChatsRetrieved;
      delete context.metadata.ragArtifactsRetrieved;
      delete context.metadata.ragRetrievalTime;
    }

    this.logger.debug({
      messageId: context.messageId
    }, '[RAG] RAG stage rollback completed');
  }
}