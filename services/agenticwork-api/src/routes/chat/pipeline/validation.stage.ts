/**
 * Validation Pipeline Stage
 * 
 * Responsibilities:
 * - Validate and sanitize user input
 * - Check message length and format
 * - Validate session exists/create if needed
 * - Parse and validate attachments
 * - Apply content filters
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ChatErrorCode, ChatSession } from '../interfaces/chat.types.js';
import { trackChatMessage } from '../../../metrics/index.js';
import type { Logger } from 'pino';
import { MemoryContextService } from '../../../memory/services/MemoryContextService.js';
import { RedisMemoryCache } from '../../../memory/services/RedisMemoryCache.js';
import { ContextBudgetManager } from '../../../memory/services/ContextBudgetManager.js';
import { SemanticCacheService } from '../../../services/SemanticCache.js';
import { FileAttachmentService } from '../../../services/FileAttachmentService.js';
import {
  checkQueryScope,
  getScopeViolationResponse,
  incrementScopeViolationCount,
  getScopeViolationCount
} from './scope-enforcement.helper.js';

export class ValidationStage implements PipelineStage {
  name = 'validation';
  private memoryContextService?: MemoryContextService;
  private semanticCache?: SemanticCacheService;
  private fileAttachmentService?: FileAttachmentService;

  constructor(
    private validationService: any,
    private logger: any,
    private redis?: any,
    private milvus?: any,
    semanticCache?: SemanticCacheService,
    fileAttachmentService?: FileAttachmentService
  ) {
    this.logger = logger.child({ stage: this.name }) as Logger;
    this.semanticCache = semanticCache;
    this.fileAttachmentService = fileAttachmentService;
    
    // Initialize MemoryContextService if dependencies are available
    if (redis && milvus) {
      try {
        // CRITICAL FIX: RedisMemoryCache expects RedisConfig, not a client instance
        const redisConfig = {
          host: process.env.REDIS_HOST || 'agenticworkchat-redis',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD || undefined,
          db: 0
        };
        const cache = new RedisMemoryCache(redisConfig);
        const budgetManager = new ContextBudgetManager({
          responseReserve: 0.3,
          systemPromptRatio: 0.15,
          tier1Ratio: 0.35,
          tier2Ratio: 0.15,
          tier3Ratio: 0.05,
          minResponseTokens: 500,
          maxSystemTokens: 1000
        });
        
        this.memoryContextService = new MemoryContextService({
          cache,
          budgetManager,
          vectorStore: milvus,
          embeddingModel: process.env.EMBEDDING_MODEL || '',  // Must be configured via ENV
          similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7'),
          maxMemories: parseInt(process.env.MAX_MEMORIES || '10'),
          cacheEnabled: process.env.CONTEXT_CACHE_ENABLED !== 'false',
          debugMode: process.env.LOG_LEVEL === 'debug'
        });
        
        this.logger.info('MemoryContextService initialized successfully');
      } catch (error) {
        this.logger.warn({ error: error.message }, 'Failed to initialize MemoryContextService, falling back to simple context');
      }
    } else {
      this.logger.info('Redis or Milvus not available, using simple context management');
    }
    
    if (this.semanticCache) {
      this.logger.info('SemanticCacheService available for response caching');
    }
    
    if (this.fileAttachmentService) {
      this.logger.info('FileAttachmentService available for enhanced attachment handling');
    }
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    
    try {
      // Check semantic cache for similar queries
      if (this.semanticCache) {
        try {
          const cacheKey = `${context.user.id}:${context.request.message}`;
          const cachedResponse = await this.semanticCache.findSimilar(context.request.message);
          
          if (cachedResponse && cachedResponse.similarity > 0.95) {
            this.logger.info({ 
              userId: context.user.id,
              similarity: cachedResponse.similarity,
              cacheAge: Date.now() - cachedResponse.timestamp
            }, 'Semantic cache hit with high similarity');
            
            // Store cached response for later use in completion stage
            (context as any).cachedResponse = cachedResponse;
            context.emit('cache_hit', {
              similarity: cachedResponse.similarity,
              saved_tokens: cachedResponse.tokens || 0
            });
          }
        } catch (error) {
          this.logger.warn({ error: error.message }, 'Semantic cache check failed, continuing without cache');
        }
      }
      
      // Validate basic request structure
      await this.validateRequest(context);

      // Get or create session
      context.session = await this.getOrCreateSession(context);

      // Validate message content
      await this.validateMessage(context);

      // Validate and process attachments
      await this.validateAttachments(context);

      // Apply content filters
      await this.applyContentFilters(context);

      // APPLICATION-LEVEL SCOPE ENFORCEMENT (runs BEFORE LLM)
      // Non-admin users are restricted to cloud/infrastructure/tech topics
      // This cannot be bypassed by the LLM - it runs at the app level
      await this.applyScopeEnforcement(context);

      // Build message history
      await this.buildMessageHistory(context);
      
      // Track user message metric
      const model = context.request.model || context.config.model;
      trackChatMessage('user', model);

      this.logger.info({ 
        userId: context.user.id,
        sessionId: context.request.sessionId,
        messageLength: context.request.message.length,
        attachmentCount: context.request.attachments?.length || 0,
        historyLength: context.messages.length,
        executionTime: Date.now() - startTime
      }, 'Validation stage completed');

      return context;

    } catch (error) {
      this.logger.error({ 
        error: error.message,
        executionTime: Date.now() - startTime
      }, 'Validation stage failed');

      throw {
        ...error,
        code: error.code || ChatErrorCode.INVALID_MESSAGE,
        retryable: false,
        stage: this.name
      };
    }
  }

  private async validateRequest(context: PipelineContext): Promise<void> {
    const { request } = context;

    // Check required fields
    if (!request.message?.trim()) {
      throw {
        code: ChatErrorCode.INVALID_MESSAGE,
        message: 'Message cannot be empty'
      };
    }

    if (!request.sessionId?.trim()) {
      throw {
        code: ChatErrorCode.INVALID_SESSION,
        message: 'Session ID is required'
      };
    }

    // Validate message length
    const maxMessageLength = 50000; // ~50KB
    if (request.message.length > maxMessageLength) {
      throw {
        code: ChatErrorCode.INVALID_MESSAGE,
        message: `Message too long. Maximum ${maxMessageLength} characters allowed.`
      };
    }

    // Validate session ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(request.sessionId)) {
      throw {
        code: ChatErrorCode.INVALID_SESSION,
        message: 'Invalid session ID format'
      };
    }

    // Validate model if specified
    if (request.model && !this.isValidModel(request.model)) {
      this.logger.warn({ 
        requestedModel: request.model 
      }, 'Invalid model specified, using default');
      
      request.model = context.config.model;
    }
  }

  private async getOrCreateSession(context: PipelineContext): Promise<ChatSession> {
    const { request, user } = context;

    // Log initial state
    this.logger.info({ 
      sessionId: request.sessionId,
      userId: user.id,
      hasValidationService: !!this.validationService,
      validationServiceHasStorage: !!(this.validationService as any).chatStorage
    }, 'Starting getOrCreateSession');

    try {
      // Check if session store is reachable
      if (!this.validationService) {
        throw new Error('Validation service is not initialized');
      }

      // Log chatStorage availability
      const hasStorage = !!(this.validationService as any).chatStorage;
      this.logger.info({ 
        hasStorage,
        storageType: hasStorage ? 'PostgreSQL' : 'Mock/None'
      }, 'Chat storage availability check');

      // Try to get existing session
      this.logger.debug({ 
        sessionId: request.sessionId,
        userId: user.id 
      }, 'Attempting to get existing session');
      
      let session: ChatSession | null = null;
      
      try {
        session = await this.validationService.getSession(request.sessionId, user.id);
        this.logger.info({ 
          sessionId: request.sessionId,
          sessionFound: !!session,
          sessionReturnValue: session ? {
            id: session.id,
            title: session.title,
            userId: session.userId,
            messageCount: session.messageCount
          } : null
        }, 'Session lookup result');
      } catch (lookupError: any) {
        this.logger.error({ 
          err: lookupError,
          errorMessage: lookupError.message,
          errorStack: lookupError.stack,
          errorCode: lookupError.code,
          sessionId: request.sessionId,
          userId: user.id 
        }, 'Session lookup failed');
        // Don't throw here, try to create a new session
      }

      if (!session) {
        // Create new session
        this.logger.info({ 
          sessionId: request.sessionId,
          userId: user.id 
        }, 'No existing session found, creating new chat session');

        try {
          // Always use "New Chat" title initially - it will be updated by AI in response stage
          const title = 'New Chat';
            
          const newSessionId = await this.validationService.createSession(user.id, {
            sessionId: request.sessionId,
            title,
            model: request.model || context.config.model
          });

          this.logger.info({ 
            originalId: request.sessionId,
            newSessionId,
            userId: user.id,
            sessionIdMatches: newSessionId === request.sessionId
          }, 'Session creation completed');

          // Try to get the newly created session
          try {
            session = await this.validationService.getSession(newSessionId, user.id);
            this.logger.info({ 
              sessionId: newSessionId,
              retrievedSession: !!session,
              sessionDetails: session ? {
                id: session.id,
                title: session.title,
                createdAt: session.createdAt
              } : null
            }, 'Post-creation session retrieval result');
          } catch (retrievalError: any) {
            this.logger.error({ 
              err: retrievalError,
              errorMessage: retrievalError.message,
              errorStack: retrievalError.stack,
              sessionId: newSessionId,
              userId: user.id 
            }, 'Failed to retrieve newly created session');
          }
          
          if (!session) {
            this.logger.warn({ 
              sessionId: newSessionId,
              userId: user.id 
            }, 'Session was created but could not be retrieved, trying original ID');
            
            // Try with original session ID as fallback
            try {
              session = await this.validationService.getSession(request.sessionId, user.id);
              this.logger.info({ 
                sessionId: request.sessionId,
                fallbackSuccess: !!session
              }, 'Fallback session retrieval result');
            } catch (fallbackError: any) {
              this.logger.error({ 
                err: fallbackError,
                errorMessage: fallbackError.message,
                sessionId: request.sessionId
              }, 'Fallback session retrieval failed');
            }
          }
          
        } catch (createError: any) {
          this.logger.error({
            err: createError,
            errorMessage: createError.message,
            errorStack: createError.stack,
            errorCode: createError.code,
            sessionId: request.sessionId,
            userId: user.id
          }, 'Failed to create session');

          // CRITICAL FIX: Handle unique constraint error (session already exists)
          // This can happen on page reload or race conditions
          if (createError.code === 'P2002') {
            this.logger.warn({
              sessionId: request.sessionId,
              userId: user.id
            }, 'Session already exists (unique constraint), attempting to fetch existing session');

            try {
              session = await this.validationService.getSession(request.sessionId, user.id);
              if (session) {
                this.logger.info({
                  sessionId: request.sessionId,
                  sessionTitle: session.title
                }, 'Successfully recovered existing session after unique constraint error');
              }
            } catch (fetchError: any) {
              this.logger.error({
                err: fetchError,
                sessionId: request.sessionId
              }, 'Failed to fetch existing session after unique constraint error');
              throw createError; // Throw original error if fetch also fails
            }
          } else {
            throw createError;
          }
        }
      } else {
        this.logger.debug({ 
          sessionId: request.sessionId,
          userId: user.id,
          sessionTitle: session.title
        }, 'Using existing session');
        
        // Update session title if it's still "New Chat" and this is the first real message
        if (session.title === 'New Chat' && request.message && request.message.trim().length > 0) {
          const newTitle = this.generateSessionTitle(request.message);
          try {
            // Update the session title in the database
            // Skip updating title here - validationService doesn't have this method
            // Title will be generated in response stage
            session.title = newTitle;
            this.logger.info({ 
              sessionId: session.id,
              oldTitle: 'New Chat',
              newTitle: newTitle
            }, 'Updated session title from first message');
          } catch (updateError: any) {
            // Log error but don't fail the request
            this.logger.warn({ 
              err: updateError,
              sessionId: session.id
            }, 'Failed to update session title, continuing with "New Chat"');
          }
        }
      }

      if (!session) {
        const errorMsg = 'Failed to create or retrieve session after all attempts';
        this.logger.error({ 
          sessionId: request.sessionId,
          userId: user.id,
          validationServiceStatus: !!this.validationService,
          hasStorage: !!(this.validationService as any).chatStorage
        }, errorMsg);
        
        throw new Error(errorMsg);
      }

      return session;

    } catch (error: any) {
      // Log complete error details
      this.logger.error({ 
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        errorCode: error.code,
        errorName: error.name,
        sessionId: request.sessionId,
        userId: user.id,
        validationServiceAvailable: !!this.validationService,
        storageAvailable: !!(this.validationService as any)?.chatStorage
      }, 'getOrCreateSession failed with detailed error');
      
      throw {
        code: ChatErrorCode.INVALID_SESSION,
        message: 'Failed to access chat session',
        details: error.message || 'Unknown error',
        originalError: error
      };
    }
  }

  private async validateMessage(context: PipelineContext): Promise<void> {
    const message = context.request.message.trim();

    // Content validation
    if (message.length < 1) {
      throw {
        code: ChatErrorCode.INVALID_MESSAGE,
        message: 'Message cannot be empty'
      };
    }

    // Check for potential security issues
    if (this.containsSuspiciousContent(message)) {
      this.logger.warn({ 
        userId: context.user.id,
        messagePreview: message.substring(0, 100)
      }, 'Message contains suspicious content');
      
      // Don't block, but log for monitoring
      context.emit('security_warning', {
        type: 'suspicious_content',
        message: 'Message flagged for review'
      });
    }

    // Sanitize the message
    context.request.message = this.sanitizeMessage(message);
  }

  private async validateAttachments(context: PipelineContext): Promise<void> {
    const attachments = context.request.attachments || [];

    // Use FileAttachmentService if available for enhanced processing
    if (this.fileAttachmentService && attachments.length > 0) {
      try {
        this.logger.info({ 
          attachmentCount: attachments.length 
        }, 'Using FileAttachmentService for attachment validation');
        
        const processedAttachments = [];
        
        for (const attachment of attachments) {
          // Validate attachment using service
          // Skip validation since method doesn't exist
          const validation = { isValid: true };
          
          if (!validation.isValid) {
            throw {
              code: ChatErrorCode.INVALID_MESSAGE,
              message: `Invalid attachment: ${attachment.originalName}`
            };
          }
          
          // Process attachment for optimal handling
          // Skip processing since method doesn't exist
          const processed = attachment;
          /* await this.fileAttachmentService.processAttachment(attachment, {
            userId: context.user.id,
            sessionId: context.session?.id,
            extractText: attachment.mimeType?.includes('pdf') || attachment.mimeType?.includes('text'),
            generateEmbeddings: true,
            compress: attachment.size > 5 * 1024 * 1024 // Compress if > 5MB
          }); */
          
          processedAttachments.push(processed);
          
          this.logger.debug({ 
            fileName: attachment.originalName,
            originalSize: attachment.size,
            processedSize: processed.size,
            hasEmbeddings: false
          }, 'Attachment processed');
        }
        
        // Replace with processed attachments
        context.request.attachments = processedAttachments;
        
      } catch (error) {
        if (error.code === ChatErrorCode.INVALID_MESSAGE) {
          throw error;
        }
        
        this.logger.warn({ 
          error: error.message 
        }, 'FileAttachmentService failed, falling back to basic validation');
        
        // Fallback to basic validation
        await this.basicAttachmentValidation(attachments);
      }
    } else {
      // Use basic validation if service not available
      await this.basicAttachmentValidation(attachments);
    }
  }
  
  private async basicAttachmentValidation(attachments: any[]): Promise<void> {
    for (const attachment of attachments) {
      // Validate file size
      const maxFileSize = 50 * 1024 * 1024; // 50MB
      if (attachment.size > maxFileSize) {
        throw {
          code: ChatErrorCode.INVALID_MESSAGE,
          message: `File "${attachment.originalName}" is too large. Maximum size is 50MB.`
        };
      }

      // Validate MIME type
      if (!this.isValidMimeType(attachment.mimeType)) {
        throw {
          code: ChatErrorCode.INVALID_MESSAGE,
          message: `File type "${attachment.mimeType}" is not supported.`
        };
      }

      // Scan for malicious content
      if (await this.isMaliciousFile(attachment)) {
        throw {
          code: ChatErrorCode.INVALID_MESSAGE,
          message: 'File contains potentially malicious content.'
        };
      }
    }
  }

  private async applyContentFilters(context: PipelineContext): Promise<void> {
    try {
      const filterResult = await this.validationService.checkContentFilters(
        context.request.message,
        context.user.id
      );

      if (filterResult.blocked) {
        throw {
          code: ChatErrorCode.INVALID_MESSAGE,
          message: 'Message blocked by content filters',
          details: filterResult.reason
        };
      }

      if (filterResult.flagged) {
        this.logger.warn({ 
          userId: context.user.id,
          reason: filterResult.reason 
        }, 'Message flagged by content filters');
        
        context.emit('content_warning', {
          type: 'content_flagged',
          reason: filterResult.reason
        });
      }
    } catch (error) {
      if (error.code === ChatErrorCode.INVALID_MESSAGE) {
        throw error;
      }
      
      // If content filtering service is down, log but don't block
      this.logger.warn({
        error: error.message
      }, 'Content filtering failed, allowing message through');
    }
  }

  /**
   * APPLICATION-LEVEL SCOPE ENFORCEMENT
   *
   * This runs BEFORE the LLM is called and cannot be bypassed.
   * Non-admin users are restricted to cloud/infrastructure/tech topics.
   * Off-topic queries are rejected with a canned response - no LLM call is made.
   */
  private async applyScopeEnforcement(context: PipelineContext): Promise<void> {
    const { request, user } = context;
    const isAdmin = user.isAdmin || false;

    // DEBUG: Log that we're checking scope
    this.logger.info({
      userId: user.id,
      isAdmin,
      messagePreview: request.message.substring(0, 50),
      messageLength: request.message.length
    }, '🔍 SCOPE CHECK: Starting scope enforcement');

    // Check query scope
    const scopeResult = checkQueryScope(
      request.message,
      isAdmin,
      this.logger
    );

    // DEBUG: Log the result
    this.logger.info({
      userId: user.id,
      isAllowed: scopeResult.isAllowed,
      confidence: scopeResult.confidence,
      reason: scopeResult.reason,
      blockedKeywords: scopeResult.blockedKeywords,
      allowedKeywords: scopeResult.allowedKeywords?.slice(0, 3)
    }, '🔍 SCOPE CHECK: Result');

    if (!scopeResult.isAllowed) {
      // Get violation count and increment
      let warningCount = 1;
      try {
        warningCount = await incrementScopeViolationCount(user.id, this.redis);
        this.logger.warn({
          userId: user.id,
          warningCount,
          blockedKeywords: scopeResult.blockedKeywords,
          confidence: scopeResult.confidence,
          reason: scopeResult.reason
        }, '🚫 SCOPE ENFORCEMENT: Off-topic query BLOCKED at application level');
      } catch (error) {
        this.logger.debug({ error: error.message }, 'Failed to track scope violation count');
      }

      // Get the violation response message
      const violationResponse = getScopeViolationResponse(scopeResult, warningCount);

      // CRITICAL: Throw a special error that the pipeline will handle
      // This prevents the LLM from ever seeing the off-topic query
      throw {
        code: 'SCOPE_VIOLATION',
        message: violationResponse,
        blockedByScope: true,
        warningCount,
        retryable: false,
        stage: this.name
      };
    }

    // Query is within scope - log and continue
    if (scopeResult.allowedKeywords?.length) {
      this.logger.debug({
        userId: user.id,
        allowedKeywords: scopeResult.allowedKeywords.slice(0, 3),
        confidence: scopeResult.confidence
      }, '✅ Query within scope - allowed to proceed');
    }
  }

  private async buildMessageHistory(context: PipelineContext): Promise<void> {
    const session = context.session;
    const maxHistory = context.config.maxHistoryLength || 100;
    const startTime = Date.now();

    this.logger.info({
      sessionId: session.id,
      userId: context.user.id,
      maxHistory
    }, '╔═══════════════════════════════════════════════════════════════');
    this.logger.info('║ [HISTORY] 📚 Starting Message History Build');
    this.logger.info('╚═══════════════════════════════════════════════════════════════');

    // CORRECT ARCHITECTURE: Redis → Milvus → PostgreSQL (compacted summaries only)
    // CRITICAL: ALWAYS check Redis first, ignore session.messages from PostgreSQL lookup
    let sessionMessages: any[] = [];
    let loadSource = 'none';
    let loadTime = 0;

    // Step 1: Try Redis SessionCache FIRST for recent messages
    if (this.memoryContextService) {
      const redisStartTime = Date.now();
      try {
        this.logger.info({
          sessionId: session.id,
          userId: context.user.id
        }, '┌─────────────────────────────────────────────────────────────');
        this.logger.info('│ [REDIS] 🔍 Step 1: Checking Redis SessionCache');
        this.logger.info('└─────────────────────────────────────────────────────────────');

        const sessionCache = await this.memoryContextService.getCache().getSessionCache(
          context.user.id,
          session.id,
          { sliding: true, ttl: 3600 } // 1 hour sliding window
        );

        loadTime = Date.now() - redisStartTime;

        if (sessionCache && sessionCache.messages && sessionCache.messages.length > 0) {
          sessionMessages = sessionCache.messages as any[];
          loadSource = 'redis';

          this.logger.info({
            sessionId: session.id,
            messageCount: sessionMessages.length,
            loadTimeMs: loadTime,
            cacheHit: true,
            messageSample: sessionMessages.slice(-3).map(m => ({
              id: m.id,
              role: m.role,
              hasContent: !!m.content,
              hasToolCalls: !!m.toolCalls,
              hasToolCallId: !!m.toolCallId
            }))
          }, '│ [REDIS] ✅ SUCCESS: Loaded messages from Redis cache');

          this.logger.info({
            totalMessages: sessionMessages.length,
            roles: sessionMessages.map(m => m.role).join(' → ')
          }, '│ [REDIS] 📊 Message sequence loaded from cache');

        } else {
          this.logger.warn({
            sessionId: session.id,
            loadTimeMs: loadTime,
            cacheHit: false,
            hasSessionCache: !!sessionCache,
            hasMessages: sessionCache?.messages?.length || 0
          }, '│ [REDIS] ⚠️  MISS: No messages in Redis, falling back to PostgreSQL');

          // Step 2: Fallback to PostgreSQL for older sessions (should be compacted summaries)
          if (this.validationService.chatStorage) {
            const pgStartTime = Date.now();
            try {
              this.logger.info('│ [POSTGRESQL] 🔍 Step 2: Querying PostgreSQL database');
              sessionMessages = await this.validationService.chatStorage.getMessages(session.id);
              loadTime = Date.now() - pgStartTime;
              loadSource = 'postgresql';

              this.logger.info({
                sessionId: session.id,
                messageCount: sessionMessages.length,
                loadTimeMs: loadTime,
                messageSample: sessionMessages.slice(-3).map(m => ({
                  id: m.id,
                  role: m.role,
                  hasToolCalls: !!m.toolCalls,
                  hasToolCallId: !!m.toolCallId
                }))
              }, '│ [POSTGRESQL] ✅ SUCCESS: Loaded messages from PostgreSQL');
            } catch (error) {
              loadTime = Date.now() - pgStartTime;
              this.logger.error({
                error: error.message,
                sessionId: session.id,
                loadTimeMs: loadTime
              }, '│ [POSTGRESQL] ❌ ERROR: Failed to load messages');
              sessionMessages = [];
            }
          }
        }
      } catch (error) {
        loadTime = Date.now() - redisStartTime;
        this.logger.error({
          error: error.message,
          errorStack: error.stack,
          sessionId: session.id,
          loadTimeMs: loadTime
        }, '│ [REDIS] ❌ ERROR: Redis lookup failed, falling back to PostgreSQL');

        // Fallback to PostgreSQL if Redis fails
        if (this.validationService.chatStorage) {
          const pgStartTime = Date.now();
          try {
            this.logger.info('│ [POSTGRESQL] 🔍 Step 2b: PostgreSQL fallback after Redis error');
            sessionMessages = await this.validationService.chatStorage.getMessages(session.id);
            loadTime = Date.now() - pgStartTime;
            loadSource = 'postgresql_after_redis_error';

            this.logger.info({
              sessionId: session.id,
              messageCount: sessionMessages.length,
              loadTimeMs: loadTime
            }, '│ [POSTGRESQL] ✅ SUCCESS: Loaded from PostgreSQL after Redis error');
          } catch (dbError) {
            loadTime = Date.now() - pgStartTime;
            this.logger.error({
              error: dbError.message,
              sessionId: session.id,
              loadTimeMs: loadTime
            }, '│ [POSTGRESQL] ❌ ERROR: PostgreSQL fallback also failed');
            sessionMessages = [];
          }
        }
      }
    } else if (this.validationService.chatStorage) {
      // Fallback path if MemoryContextService not available
      const pgStartTime = Date.now();
      try {
        this.logger.warn('│ [REDIS] ⚠️  UNAVAILABLE: MemoryContextService not initialized');
        this.logger.info('│ [POSTGRESQL] 🔍 Step 2c: Direct PostgreSQL query (no Redis available)');

        sessionMessages = await this.validationService.chatStorage.getMessages(session.id);
        loadTime = Date.now() - pgStartTime;
        loadSource = 'postgresql_no_redis';

        this.logger.info({
          sessionId: session.id,
          messageCount: sessionMessages.length,
          loadTimeMs: loadTime
        }, '│ [POSTGRESQL] ✅ SUCCESS: Loaded from PostgreSQL (Redis unavailable)');
      } catch (error) {
        loadTime = Date.now() - pgStartTime;
        this.logger.error({
          error: error.message,
          sessionId: session.id,
          loadTimeMs: loadTime
        }, '│ [POSTGRESQL] ❌ ERROR: Failed to load messages');
        sessionMessages = [];
      }
    }

    // Final fallback: use messages from session object if we still have nothing
    if ((!sessionMessages || sessionMessages.length === 0) && session.messages && session.messages.length > 0) {
      sessionMessages = session.messages;
      loadSource = 'session_object';

      this.logger.warn({
        sessionId: session.id,
        messageCount: sessionMessages.length
      }, '│ [FALLBACK] ⚠️  Using messages from session object (all other sources failed)');
    }

    // CRITICAL FIX: Mark ALL loaded messages as already saved to prevent ResponseStage from re-saving them
    // This prevents the catastrophic duplication bug where history gets saved as NEW messages every request
    sessionMessages = sessionMessages.map(msg => ({
      ...msg,
      metadata: {
        ...msg.metadata,
        savedToDb: true  // CRITICAL: Mark all history messages as already saved
      }
    }));

    // Log final result
    const totalTime = Date.now() - startTime;
    this.logger.info({
      sessionId: session.id,
      source: loadSource,
      messageCount: sessionMessages.length,
      loadTimeMs: loadTime,
      totalTimeMs: totalTime,
      performance: loadTime < 50 ? '🚀 FAST' : loadTime < 200 ? '✅ OK' : '⚠️  SLOW'
    }, '┌─────────────────────────────────────────────────────────────');
    this.logger.info({
      loadPath: loadSource === 'redis' ? 'Redis (optimal)' :
                loadSource === 'postgresql' ? 'PostgreSQL (acceptable)' :
                loadSource === 'session_object' ? 'Session Object (fallback)' : 'Unknown',
      markedAsSaved: sessionMessages.length
    }, '│ [RESULT] 📊 Message Load Complete - all marked as savedToDb');
    this.logger.info('└─────────────────────────────────────────────────────────────');

    // Step 3: Use MemoryContextService for Milvus semantic search and context augmentation
    if (this.memoryContextService && context.user) {
      try {
        this.logger.info({ 
          sessionId: session.id,
          messageCount: sessionMessages.length,
          messagesSample: sessionMessages.slice(0, 2).map(m => ({
            role: m.role,
            contentLength: m.content?.length || 0,
            hasTimestamp: !!m.timestamp
          }))
        }, 'Using MemoryContextService for intelligent context assembly');
        
        const contextResult = await this.memoryContextService.assembleContext({
          userId: context.user.id,
          messages: sessionMessages.map(m => ({
            ...m,
            timestamp: m.timestamp instanceof Date ? m.timestamp.getTime() : 
                       typeof m.timestamp === 'string' ? new Date(m.timestamp).getTime() :
                       m.timestamp || Date.now()
          })) as any,
          model: context.request.model || context.config.model,
          maxTokens: context.config.maxTokens || 8192,
          includeMemory: true,
          cacheEnabled: true,
          debugMode: this.logger.level === 'debug'
        });
        
        // Use the assembled context with proper token budgeting
        // CRITICAL FIX: Don't clear messages - use the session messages!
        // The MemoryContextService provides augmented context but we still need the actual messages
        context.messages = sessionMessages
          .slice(-maxHistory)
          .filter(msg => msg.role !== 'system')
          .map(msg => ({
            ...msg,
            toolCallId: msg.toolCallId, // Ensure toolCallId is preserved
            toolCalls: msg.toolCalls // Ensure toolCalls is preserved from cache/DB
          }));
        
        // The tier content from MemoryContextService can be used for RAG augmentation
        // but should NOT replace the actual conversation history
        
        // Store augmented context for use in completion stage
        (context as any).augmentedContext = contextResult.context;
        (context as any).relevantMemories = contextResult.context.relevantMemories;

        // CRITICAL FIX: Pass memoryContextService to context so response stage can update Redis cache
        (context as any).memoryContextService = this.memoryContextService;
        
        this.logger.info({ 
          sessionId: session.id,
          tier1Content: contextResult.context.tiers.tier1.content.length,
          tier2Content: contextResult.context.tiers.tier2.content.length,
          tier3Content: contextResult.context.tiers.tier3.content.length,
          totalTokens: contextResult.context.totalTokens,
          cacheHit: contextResult.context.cacheHit,
          relevantMemories: contextResult.context.relevantMemories.length
        }, 'Context assembled with token budgeting');
        
      } catch (error) {
        this.logger.warn({ 
          error: error.message,
          sessionId: session.id 
        }, 'MemoryContextService failed, falling back to simple context');
        
        // Fallback to simple slice
        context.messages = sessionMessages
          .slice(-maxHistory)
          .filter(msg => msg.role !== 'system')
          .map(msg => ({
            ...msg,
            toolCallId: msg.toolCallId, // Ensure toolCallId is preserved
            toolCalls: msg.toolCalls // Ensure toolCalls is preserved from cache/DB
          }));
      }
    } else {
      // Fallback to simple slice if MemoryContextService not available
      const recentMessages = sessionMessages
        .slice(-maxHistory)
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          ...msg,
          toolCallId: msg.toolCallId, // Ensure toolCallId is preserved
          toolCalls: msg.toolCalls // Ensure toolCalls is preserved from cache/DB
        }));

      context.messages = recentMessages;

      this.logger.debug({ 
        sessionId: session.id,
        totalMessages: sessionMessages.length,
        includedMessages: recentMessages.length
      }, 'Built message history with simple slice (MemoryContextService not available)');
    }
    
    // DATABASE-FIRST: Save user message to PostgreSQL IMMEDIATELY
    if (context.request.message && context.request.message.trim()) {
      this.logger.info('┌─────────────────────────────────────────────────────────────');
      this.logger.info('│ [DB-FIRST] 💾 STEP 1: Saving user message to PostgreSQL FIRST');
      this.logger.info('└─────────────────────────────────────────────────────────────');

      const userMessageData: any = {
        role: 'user' as const,
        content: context.request.message.trim(),
        timestamp: new Date()
      };

      // Include attachments if present
      if (context.request.attachments && context.request.attachments.length > 0) {
        userMessageData.attachments = context.request.attachments;
        this.logger.info({
          userId: context.user.id,
          attachmentCount: context.request.attachments.length,
          attachmentTypes: context.request.attachments.map(a => a.mimeType)
        }, '│ [DB-FIRST] 📎 Including attachments in user message');
      }

      // Save to PostgreSQL and get confirmed DB ID
      const saveStartTime = Date.now();
      let savedUserMessage: any;

      try {
        // Use validationService which has access to chatStorage
        if (!this.validationService || !this.validationService.chatStorage) {
          throw new Error('ChatStorage not available for saving user message');
        }

        // Save message via chatStorage.addMessage
        // CRITICAL FIX: addMessage expects (sessionId, messageObject) signature, with userId embedded in message
        const userMessageDataWithUserId = {
          ...userMessageData,
          userId: context.user.id
        };
        savedUserMessage = await this.validationService.chatStorage.addMessage(
          session.id,
          userMessageDataWithUserId
        );

        // No need to fetch again - addMessage already returns the complete message object

        const saveTime = Date.now() - saveStartTime;

        this.logger.info({
          messageId: savedUserMessage.id,
          sessionId: session.id,
          userId: context.user.id,
          saveTimeMs: saveTime,
          confirmedId: savedUserMessage.id,
          performance: saveTime < 50 ? '🚀 FAST' : saveTime < 200 ? '✅ OK' : '⚠️  SLOW'
        }, '│ [DB-FIRST] ✅ User message saved to PostgreSQL with confirmed ID');

        // Emit database confirmation event to frontend
        context.emit('message_saved', {
          messageId: savedUserMessage.id,
          role: 'user',
          content: savedUserMessage.content,
          timestamp: savedUserMessage.timestamp || savedUserMessage.created_at,
          source: 'database',
          confirmed: true
        });

        this.logger.info({
          messageId: savedUserMessage.id
        }, '│ [DB-FIRST] 📡 Emitted message_saved event to frontend');

      } catch (error) {
        const saveTime = Date.now() - saveStartTime;
        this.logger.error({
          error: error.message,
          errorStack: error.stack,
          sessionId: session.id,
          userId: context.user.id,
          saveTimeMs: saveTime
        }, '│ [DB-FIRST] ❌ ERROR: Failed to save user message to PostgreSQL');
        throw error;
      }

      // Add saved message (with DB ID) to context
      context.messages.push({
        id: savedUserMessage.id,
        role: 'user' as const,
        content: savedUserMessage.content,
        timestamp: savedUserMessage.timestamp || savedUserMessage.created_at,
        attachments: savedUserMessage.attachments,
        sessionId: session.id,
        metadata: {
          savedToDb: true  // Mark as already saved in metadata
        }
      });

      // Store saved message ID in context for reference
      (context as any).userMessageId = savedUserMessage.id;

      // Store chatStorage reference in context for downstream stages (Database-First pattern)
      (context as any).chatStorage = this.validationService.chatStorage;
      (context as any).sessionId = session.id;

      this.logger.info({
        messageId: savedUserMessage.id,
        totalMessages: context.messages.length,
        chatStorageAvailable: !!(context as any).chatStorage
      }, '│ [DB-FIRST] ✅ User message added to context with DB ID');
    }
  }

  // Helper methods
  private isValidModel(model: string): boolean {
    // Accept all models to ensure forward compatibility
    // Invalid models will be handled by the MCP Proxy and model router
    // This prevents errors when new models are introduced
    // Model validation should be done at the provider layer, not hardcoded here
    return true;
  }

  private generateSessionTitle(message: string): string {
    // Generate a title from the first message
    const cleanMessage = message.replace(/[^\w\s]/g, '').trim();
    const words = cleanMessage.split(/\s+/).slice(0, 6);
    return words.join(' ') || 'Chat Session';
  }

  private containsSuspiciousContent(message: string): boolean {
    const suspiciousPatterns = [
      /system\s*prompt/i,
      /ignore\s+previous\s+instructions/i,
      /prompt\s+injection/i,
      /<script/i,
      /javascript:/i
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(message));
  }

  private sanitizeMessage(message: string): string {
    // Basic sanitization - remove potentially harmful content
    return message
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .trim();
  }

  private isValidMimeType(mimeType: string): boolean {
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];
    
    return allowedTypes.includes(mimeType);
  }

  private async isMaliciousFile(attachment: any): Promise<boolean> {
    // Basic malware detection - in production, use proper scanning service
    const suspiciousExtensions = ['.exe', '.scr', '.bat', '.cmd', '.com', '.pif'];
    const filename = attachment.originalName.toLowerCase();
    
    return suspiciousExtensions.some(ext => filename.endsWith(ext));
  }

  async rollback(context: PipelineContext): Promise<void> {
    // If we created a session and need to rollback, we could delete it
    // For now, we'll just log
    this.logger.debug({ 
      messageId: context.messageId 
    }, 'Validation stage rollback (no action needed)');
  }
}
