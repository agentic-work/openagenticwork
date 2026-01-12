/**
 * Memory Pipeline Stage
 *
 * This stage manages conversation memory and context for enhanced AI interactions.
 * It provides short-term and long-term memory capabilities for maintaining context
 * across conversations and sessions.
 *
 * Features:
 * - Session memory (current conversation context)
 * - User memory (long-term user preferences and history)
 * - Semantic memory (important facts and learnings)
 * - Working memory (temporary context for current task)
 * - Memory consolidation and pruning
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import type { Logger } from 'pino';

interface MemoryConfig {
  enabled: boolean;
  maxSessionMemory: number;
  maxUserMemory: number;
  consolidationThreshold: number;
  pruneOldMemories: boolean;
  memoryTypes: string[];
}

interface MemoryEntry {
  type: 'session' | 'user' | 'semantic' | 'working';
  content: string;
  metadata: {
    timestamp: Date;
    importance: number;
    keywords?: string[];
    userId?: string;
    sessionId?: string;
  };
}

interface MemoryContext {
  sessionMemory: MemoryEntry[];
  userMemory: MemoryEntry[];
  semanticMemory: MemoryEntry[];
  workingMemory: MemoryEntry[];
  metadata: {
    totalMemories: number;
    memoryTypes: string[];
    lastAccessed: Date;
  };
}

export class MemoryStage implements PipelineStage {
  name = 'memory';
  private logger: Logger;
  private memoryStore: Map<string, MemoryContext> = new Map();
  private defaultConfig: MemoryConfig = {
    enabled: true,
    maxSessionMemory: 10,
    maxUserMemory: 50,
    consolidationThreshold: 100,
    pruneOldMemories: true,
    memoryTypes: ['session', 'user', 'semantic', 'working']
  };

  constructor(
    private cacheManager: any,
    private prisma: any,
    logger: any,
    private config?: Partial<MemoryConfig>
  ) {
    this.logger = logger.child({ stage: this.name });
    this.config = { ...this.defaultConfig, ...config };
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    try {
      // Check if Memory is enabled
      if (!context.config.enableMemory && !this.config?.enabled) {
        this.logger.debug('Memory system disabled, skipping stage');
        return context;
      }

      const userId = context.user?.id;
      const sessionId = context.session?.id;

      if (!userId) {
        this.logger.warn('No user ID available, skipping memory stage');
        return context;
      }

      this.logger.info({
        userId,
        sessionId,
        messageCount: context.messages.length
      }, '[Memory] Starting memory processing');

      // Load or initialize memory context
      const memoryContext = await this.loadMemoryContext(userId, sessionId);

      // Process current conversation for memory extraction
      await this.processConversation(context, memoryContext);

      // Retrieve relevant memories for current context
      const relevantMemories = await this.retrieveRelevantMemories(
        context.request.message,
        memoryContext,
        userId
      );

      // Add memories to context
      if (relevantMemories.length > 0) {
        context.memoryContext = {
          memories: relevantMemories,
          summary: this.summarizeMemories(relevantMemories)
        };

        // Add to system prompt or messages
        const memoryPrompt = this.formatMemoriesForPrompt(relevantMemories);
        if (memoryPrompt) {
          context.systemPrompt = context.systemPrompt
            ? `${context.systemPrompt}\n\n${memoryPrompt}`
            : memoryPrompt;
        }

        // Add metadata
        context.metadata = {
          ...context.metadata,
          memoryEnabled: true,
          memoriesRetrieved: relevantMemories.length,
          memoryTypes: [...new Set(relevantMemories.map(m => m.type))]
        };

        // Emit memory status
        context.emit('memory_status', {
          memoriesRetrieved: relevantMemories.length,
          memoryTypes: context.metadata.memoryTypes,
          processingTime: Date.now() - startTime
        });
      }

      // Save updated memory context
      await this.saveMemoryContext(userId, memoryContext);

      // Consolidate memories if needed
      if (memoryContext.metadata.totalMemories > this.config!.consolidationThreshold!) {
        this.scheduleMemoryConsolidation(userId, memoryContext);
      }

      this.logger.info({
        userId,
        memoriesRetrieved: relevantMemories.length,
        totalMemories: memoryContext.metadata.totalMemories,
        executionTime: Date.now() - startTime
      }, '[Memory] Memory processing completed');

      return context;

    } catch (error) {
      this.logger.error({
        error: error.message,
        userId: context.user?.id,
        executionTime: Date.now() - startTime
      }, '[Memory] Memory processing failed');

      // Memory failures shouldn't block the pipeline
      context.emit('warning', {
        message: 'Memory system unavailable',
        code: 'MEMORY_PROCESSING_FAILED'
      });

      return context;
    }
  }

  private async loadMemoryContext(userId: string, sessionId?: string): Promise<MemoryContext> {
    const cacheKey = `memory:${userId}`;

    try {
      // Try to load from cache first
      if (this.cacheManager) {
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          this.logger.debug({ userId }, 'Loaded memory from cache');
          return JSON.parse(cached);
        }
      }

      // Load from database
      if (this.prisma) {
        const userMemories = await this.prisma.memory.findMany({
          where: { user_id: userId },
          orderBy: { created_at: 'desc' },
          take: this.config!.maxUserMemory
        });

        const memoryContext: MemoryContext = {
          sessionMemory: [],
          userMemory: userMemories.map((m: any) => ({
            type: 'user',
            content: m.content,
            metadata: {
              timestamp: m.created_at,
              importance: m.importance || 0.5,
              keywords: m.keywords ? JSON.parse(m.keywords) : []
            }
          })),
          semanticMemory: [],
          workingMemory: [],
          metadata: {
            totalMemories: userMemories.length,
            memoryTypes: ['user'],
            lastAccessed: new Date()
          }
        };

        // Cache the loaded context
        if (this.cacheManager) {
          await this.cacheManager.set(cacheKey, JSON.stringify(memoryContext), 3600); // 1 hour TTL
        }

        return memoryContext;
      }

      // Return empty context if no storage available
      return this.createEmptyContext();

    } catch (error) {
      this.logger.error({ error: error.message, userId }, 'Failed to load memory context');
      return this.createEmptyContext();
    }
  }

  private createEmptyContext(): MemoryContext {
    return {
      sessionMemory: [],
      userMemory: [],
      semanticMemory: [],
      workingMemory: [],
      metadata: {
        totalMemories: 0,
        memoryTypes: [],
        lastAccessed: new Date()
      }
    };
  }

  private async processConversation(
    context: PipelineContext,
    memoryContext: MemoryContext
  ): Promise<void> {
    try {
      // Extract important information from current conversation
      const currentMessage = context.request.message;
      const lastAssistantMessage = context.messages
        .filter(m => m.role === 'assistant')
        .pop();

      // Add to session memory
      if (currentMessage) {
        memoryContext.sessionMemory.push({
          type: 'session',
          content: `User asked: ${currentMessage.substring(0, 200)}`,
          metadata: {
            timestamp: new Date(),
            importance: 0.7,
            sessionId: context.session?.id
          }
        });
      }

      // Extract key facts for semantic memory
      const facts = this.extractKeyFacts(currentMessage);
      if (facts.length > 0) {
        facts.forEach(fact => {
          memoryContext.semanticMemory.push({
            type: 'semantic',
            content: fact,
            metadata: {
              timestamp: new Date(),
              importance: 0.8,
              keywords: this.extractKeywords(fact)
            }
          });
        });
      }

      // Prune old session memories
      if (memoryContext.sessionMemory.length > this.config!.maxSessionMemory!) {
        memoryContext.sessionMemory = memoryContext.sessionMemory
          .slice(-this.config!.maxSessionMemory!);
      }

      // Update metadata
      memoryContext.metadata.totalMemories =
        memoryContext.sessionMemory.length +
        memoryContext.userMemory.length +
        memoryContext.semanticMemory.length +
        memoryContext.workingMemory.length;

    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to process conversation for memory');
    }
  }

  private async retrieveRelevantMemories(
    query: string,
    memoryContext: MemoryContext,
    userId: string
  ): Promise<MemoryEntry[]> {
    this.logger.info({ query: query.substring(0, 100) }, '╔═══════════════════════════════════════════════════════════════');
    this.logger.info('║ [MILVUS] 🔍 Starting Semantic Memory Search');
    this.logger.info('╚═══════════════════════════════════════════════════════════════');

    // OPTIMIZATION: Cache Milvus search results
    const cacheKey = `milvus:search:${Buffer.from(query).toString('base64').substring(0, 32)}`;

    // Try cache first if available
    if (this.cacheManager) {
      try {
        const cached = await this.cacheManager.get(cacheKey);
        if (cached) {
          const cachedResults = JSON.parse(cached);
          this.logger.info({
            cacheKey,
            resultCount: cachedResults.length,
            source: 'cache'
          }, '│ [MILVUS] ✨ Search results retrieved from cache');

          // Also include recent session memory
          const sessionMem = memoryContext.sessionMemory.slice(-3);
          cachedResults.push(...sessionMem);
          return cachedResults.slice(0, 10);
        }
      } catch (error) {
        this.logger.warn({ error: error.message }, '│ [MILVUS] Failed to get cached results');
      }
    }

    // CRITICAL: Check if Milvus is available for semantic search
    const milvusService = (global as any).milvusVectorService;

    if (!milvusService) {
      this.logger.warn('│ [MILVUS] ⚠️  UNAVAILABLE: Milvus not available, falling back to keyword matching');
      return this.keywordBasedRetrieval(query, memoryContext);
    }

    try {
      this.logger.info({ query: query.substring(0, 100) }, '│ [MILVUS] 🚀 Performing vector similarity search');

      // Use Milvus for semantic search
      const semanticResults = await milvusService.searchUserMemories(userId, {
        text: query,
        maxResults: 10
      });

      this.logger.info({
        resultsFound: semanticResults.length,
        topScores: semanticResults.slice(0, 3).map((r: any) => r.relevanceScore || 0),
        avgScore: semanticResults.length > 0
          ? (semanticResults.reduce((sum: number, r: any) => sum + (r.relevanceScore || 0), 0) / semanticResults.length).toFixed(3)
          : 0
      }, '│ [MILVUS] ✅ Semantic search complete');

      // Convert Milvus results to MemoryEntry format
      const relevantMemories: MemoryEntry[] = semanticResults.map((result: any) => ({
        type: 'semantic' as const,
        content: result.content || result.summary || '',
        metadata: {
          timestamp: result.timestamp ? new Date(result.timestamp) : new Date(),
          importance: result.relevanceScore || 0.5,
          keywords: result.entities || [],
          userId: result.userId,
          sessionId: result.sessionId
        }
      }));

      // Cache the results for 5 minutes
      if (this.cacheManager && relevantMemories.length > 0) {
        try {
          await this.cacheManager.set(cacheKey, JSON.stringify(relevantMemories), 300);
          this.logger.debug({
            cacheKey,
            ttl: 300,
            resultCount: relevantMemories.length
          }, '│ [MILVUS] 💾 Cached search results');
        } catch (error) {
          this.logger.warn({ error: error.message }, '│ [MILVUS] Failed to cache results');
        }
      }

      // Also include recent session memory (keyword-based)
      const sessionMem = memoryContext.sessionMemory.slice(-3);
      relevantMemories.push(...sessionMem);

      this.logger.info({
        semanticResults: semanticResults.length,
        sessionMemories: sessionMem.length,
        totalReturned: relevantMemories.length
      }, '│ [MILVUS] 📊 Combined semantic + session memories');

      return relevantMemories.slice(0, 10);

    } catch (error) {
      this.logger.error({
        error: error.message,
        errorStack: error.stack
      }, '│ [MILVUS] ❌ ERROR: Semantic search failed, falling back to keywords');

      return this.keywordBasedRetrieval(query, memoryContext);
    }
  }

  /**
   * Fallback keyword-based retrieval when Milvus is unavailable
   */
  private keywordBasedRetrieval(query: string, memoryContext: MemoryContext): MemoryEntry[] {
    this.logger.info('│ [KEYWORD] 🔍 Using keyword-based fallback');

    const relevantMemories: MemoryEntry[] = [];
    const queryKeywords = this.extractKeywords(query);

    // Score and filter memories based on relevance
    const allMemories = [
      ...memoryContext.sessionMemory,
      ...memoryContext.userMemory.slice(0, 10), // Limit user memories
      ...memoryContext.semanticMemory,
      ...memoryContext.workingMemory
    ];

    for (const memory of allMemories) {
      const score = this.calculateRelevanceScore(memory, query, queryKeywords);
      if (score > 0.5) {
        relevantMemories.push(memory);
      }
    }

    // Sort by relevance and importance
    relevantMemories.sort((a, b) => {
      const scoreA = a.metadata.importance;
      const scoreB = b.metadata.importance;
      return scoreB - scoreA;
    });

    this.logger.info({
      keywordsUsed: queryKeywords.slice(0, 5),
      memoriesFound: relevantMemories.length
    }, '│ [KEYWORD] ✅ Keyword search complete');

    // Limit to top memories
    return relevantMemories.slice(0, 5);
  }

  private calculateRelevanceScore(
    memory: MemoryEntry,
    query: string,
    queryKeywords: string[]
  ): number {
    let score = 0;

    // Check keyword overlap
    if (memory.metadata.keywords) {
      const overlap = memory.metadata.keywords.filter(k =>
        queryKeywords.includes(k.toLowerCase())
      ).length;
      score += overlap * 0.2;
    }

    // Check content similarity (simple substring match)
    const queryLower = query.toLowerCase();
    const contentLower = memory.content.toLowerCase();
    if (contentLower.includes(queryLower) || queryLower.includes(contentLower)) {
      score += 0.3;
    }

    // Boost recent memories
    const age = Date.now() - new Date(memory.metadata.timestamp).getTime();
    const ageHours = age / (1000 * 60 * 60);
    if (ageHours < 1) score += 0.3;
    else if (ageHours < 24) score += 0.2;
    else if (ageHours < 168) score += 0.1; // 1 week

    // Factor in importance
    score += memory.metadata.importance * 0.2;

    return Math.min(score, 1.0);
  }

  private formatMemoriesForPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) return '';

    const sections: string[] = [
      '## IMPORTANT: Information from Previous Conversations',
      '',
      '**You HAVE access to information from previous conversations with this user.**',
      'The following context was retrieved from your memory. USE THIS INFORMATION to answer questions about previous interactions.',
      ''
    ];

    // Group by type
    const byType = memories.reduce((acc, mem) => {
      if (!acc[mem.type]) acc[mem.type] = [];
      acc[mem.type].push(mem);
      return acc;
    }, {} as Record<string, MemoryEntry[]>);

    if (byType.session?.length > 0) {
      sections.push('### Current Session Context:');
      sections.push(...byType.session.map(m => `- ${m.content}`));
      sections.push('');
    }

    if (byType.user?.length > 0) {
      sections.push('### User History (from previous sessions):');
      sections.push(...byType.user.map(m => `- ${m.content}`));
      sections.push('');
    }

    if (byType.semantic?.length > 0) {
      sections.push('### Retrieved Information from Previous Conversations:');
      sections.push('This data was retrieved from your long-term memory. Reference it when the user asks about previous queries or results.');
      sections.push(...byType.semantic.map(m => `- ${m.content}`));
      sections.push('');
    }

    sections.push('---');
    sections.push('**REMEMBER**: When the user asks "what did I have" or "from our previous conversation", refer to the information above.');
    sections.push('Do NOT say you cannot retain information - you CAN and the above IS your memory of previous conversations.');

    return sections.join('\n');
  }

  private summarizeMemories(memories: MemoryEntry[]): string {
    const summary = memories
      .map(m => m.content)
      .join('; ')
      .substring(0, 500);
    return `Memory context: ${summary}${memories.length > 5 ? '...' : ''}`;
  }

  private extractKeyFacts(text: string): string[] {
    // Simple fact extraction (should be enhanced with NLP)
    const facts: string[] = [];

    // Look for statements with "is", "are", "was", "were"
    const sentences = text.split(/[.!?]+/);
    for (const sentence of sentences) {
      if (sentence.match(/\b(is|are|was|were|has|have|will|would)\b/i)) {
        facts.push(sentence.trim());
      }
    }

    return facts.slice(0, 3); // Limit to 3 facts
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction (should be enhanced with NLP)
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !this.isStopWord(w));

    return [...new Set(words)].slice(0, 10);
  }

  private isStopWord(word: string): boolean {
    const stopWords = ['the', 'and', 'but', 'for', 'with', 'from', 'this', 'that', 'what', 'when', 'where', 'which', 'who', 'how', 'why'];
    return stopWords.includes(word.toLowerCase());
  }

  private async saveMemoryContext(userId: string, memoryContext: MemoryContext): Promise<void> {
    try {
      const cacheKey = `memory:${userId}`;

      // Save to cache
      if (this.cacheManager) {
        await this.cacheManager.set(cacheKey, JSON.stringify(memoryContext), 3600);
      }

      // Persist important memories to database
      if (this.prisma && memoryContext.semanticMemory.length > 0) {
        // Save new semantic memories
        for (const memory of memoryContext.semanticMemory) {
          if (memory.metadata.importance >= 0.7) {
            await this.prisma.memory.create({
              data: {
                user_id: userId,
                type: 'semantic',
                content: memory.content,
                importance: memory.metadata.importance,
                keywords: JSON.stringify(memory.metadata.keywords || []),
                metadata: JSON.stringify(memory.metadata)
              }
            }).catch((error: any) => {
              this.logger.warn({ error: error.message }, 'Failed to persist memory');
            });
          }
        }
      }
    } catch (error) {
      this.logger.error({ error: error.message, userId }, 'Failed to save memory context');
    }
  }

  private scheduleMemoryConsolidation(userId: string, memoryContext: MemoryContext): void {
    // Schedule async consolidation
    setImmediate(() => {
      this.consolidateMemories(userId, memoryContext).catch(error => {
        this.logger.error({ error: error.message, userId }, 'Memory consolidation failed');
      });
    });
  }

  private async consolidateMemories(userId: string, memoryContext: MemoryContext): Promise<void> {
    this.logger.info({ userId }, 'Starting memory consolidation');

    // Remove duplicates
    const seen = new Set<string>();
    memoryContext.userMemory = memoryContext.userMemory.filter(m => {
      const key = m.content.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Prune old memories with low importance
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    memoryContext.userMemory = memoryContext.userMemory.filter(m =>
      m.metadata.importance >= 0.5 || m.metadata.timestamp > cutoffDate
    );

    // Update and save
    memoryContext.metadata.lastAccessed = new Date();
    await this.saveMemoryContext(userId, memoryContext);

    this.logger.info({
      userId,
      memoriesAfter: memoryContext.userMemory.length
    }, 'Memory consolidation completed');
  }

  async rollback(context: PipelineContext): Promise<void> {
    // Clean up memory context
    delete context.memoryContext;

    if (context.metadata) {
      delete context.metadata.memoryEnabled;
      delete context.metadata.memoriesRetrieved;
      delete context.metadata.memoryTypes;
    }

    this.logger.debug({
      messageId: context.messageId
    }, '[Memory] Memory stage rollback completed');
  }
}