/**
 * Chat Processing Pipeline
 * 
 * Orchestrates the flow of chat messages through multiple processing stages:
 * 1. Authentication - Validate user and extract context
 * 2. Validation - Sanitize and validate input
 * 3. Prompt Engineering - Select and enhance system prompt
 * 4. MCP Integration - Execute tools and gather results
 * 5. Completion - Generate AI response
 * 6. Response Processing - Format and stream output
 */

import { EventEmitter } from 'events';
import type { Logger } from 'pino';
import {
  PipelineContext,
  PipelineStage,
  PipelineConfig,
  PipelineError,
  PipelineMetrics
} from './pipeline.types.js';
import { ChatRequest, ChatUser, StreamContext, ChatErrorCode } from '../interfaces/chat.types.js';
// REMOVED: import { generateStageThinking } from '../utils/thinkingMessageGenerator.js';
// Fake thinking removed - now using real LLM reasoning from completion stage
import { AuthStage } from './auth.stage.js';
import { ValidationStage } from './validation.stage.js';
import { RAGStage } from './rag.stage.js';
import { MemoryStage } from './memory.stage.js';
import { PromptStage } from './prompt.stage.js';
import { MCPStage } from './mcp.stage.js';
import { MessagePreparationStage } from './message-preparation.stage.js';
import { CompletionStage } from './completion-simple.stage.js';
import { MultiModelOrchestrationStage } from './multi-model.stage.js';
// REMOVED: import { generateThinkingMessage } from '../utils/thinkingMessageGenerator.js';
// Now using real LLM thinking instead of generated fake messages
import { ResponseStage } from './response.stage.js';
import { AuditLogger } from '../../../services/AuditLogger.js';
import { executeToolCalls, formatToolResultsAsMessages } from './tool-execution.helper.js';
import { LargeResultStorageService } from '../../../services/LargeResultStorageService.js';
import { enrichErrorForAdmin, getDefaultRecommendations, isRetryableError } from './error-handling.helper.js';
import { getPipelineConfigService } from '../../../services/PipelineConfigService.js';
import { contextManagementService } from '../../../services/ContextManagementService.js';

export class ChatPipeline extends EventEmitter {
  private stages: PipelineStage[];
  private config: PipelineConfig;
  private logger: any;
  private services: any;
  private auditLogger: AuditLogger;
  private resultStorageService: LargeResultStorageService;
  private isRunning: boolean = false;
  private activeContexts: Map<string, PipelineContext> = new Map();

  constructor(services: any, logger: any, config: Partial<PipelineConfig> = {}) {
    super();
    
    this.services = services;
    this.logger = logger.child({ component: 'ChatPipeline' }) as Logger;
    this.auditLogger = new AuditLogger(this.logger);
    this.resultStorageService = new LargeResultStorageService(this.logger);
    this.config = this.buildConfig(config);
    
    // Debug log to check if milvus is available
    this.logger.info({ 
      hasMilvus: !!services.milvus,
      milvusType: typeof services.milvus,
      servicesKeys: Object.keys(services)
    }, 'ChatPipeline initialized with services');
    
    // Initialize pipeline stages with all enhanced services
    const stages: PipelineStage[] = [
      new AuthStage(services.auth, this.logger),
      new ValidationStage(
        services.validation,
        this.logger,
        services.redis,
        services.milvus,
        services.semanticCache,
        services.fileAttachmentService
      )
    ];

    // Add RAG stage if enabled and service available
    if (this.config.enableRAG && (services.knowledgeIngestionService || services.milvus)) {
      stages.push(new RAGStage(
        services.knowledgeIngestionService,
        services.milvus,
        this.logger,
        { enabled: true }
      ));
    }

    // Add Memory stage if enabled and service available
    if (this.config.enableMemory && (services.redis || services.prisma)) {
      stages.push(new MemoryStage(
        services.redis,
        services.prisma,
        this.logger,
        { enabled: true }
      ));
    }

    // Continue with remaining stages
    stages.push(
      new PromptStage(
        services.prompt,
        this.logger,
        services.promptTechniqueService,
        services.directiveService,
        services.knowledgeIngestionService
      ),
      new MCPStage(), // Semantic MCP stage - gets services from context
      new MessagePreparationStage() // NEW: Deduplicate and validate messages
    );

    // Multi-model collaboration: Use orchestration stage if feature flag enabled
    // The multi-model stage internally handles fallback to single model based on:
    // - ENABLE_MULTI_MODEL env var (build-time feature flag)
    // - Runtime toggle from SystemConfiguration
    // - Intelligence slider position threshold
    // - Task complexity analysis
    const enableMultiModel = process.env.ENABLE_MULTI_MODEL === 'true';
    if (enableMultiModel) {
      this.logger.info('[PIPELINE] Multi-model collaboration ENABLED - using MultiModelOrchestrationStage');
      stages.push(new MultiModelOrchestrationStage()); // Can use multiple models per request
    } else {
      stages.push(new CompletionStage()); // SIMPLIFIED: Single model - AI decides when to generate images
    }

    stages.push(
      new ResponseStage(
        services.session,
        this.logger,
        services.titleService
      )
    );

    this.stages = stages;

    this.logger.info({ 
      stageCount: this.stages.length,
      config: this.config 
    }, 'Chat pipeline initialized');
  }

  /**
   * Process a chat request through the entire pipeline
   */
  async process(request: ChatRequest, user: ChatUser, streamCallback: (event: any) => void | Promise<void>): Promise<void> {
    const context = this.createContext(request, user, streamCallback);

    // Load pipeline configuration for personality system and other dynamic settings
    try {
      const pipelineConfigService = getPipelineConfigService(this.services.prisma, this.services.redis);
      context.pipelineConfig = await pipelineConfigService.getConfiguration();
      this.logger.debug({
        messageId: context.messageId,
        hasPersonality: context.pipelineConfig?.stages?.prompt?.enablePersonality,
        personalityId: context.pipelineConfig?.stages?.prompt?.activePersonalityId
      }, '[PIPELINE] Loaded pipeline configuration');
    } catch (configError: any) {
      this.logger.warn({
        messageId: context.messageId,
        error: configError.message
      }, '[PIPELINE] Failed to load pipeline config, personality features will be disabled');
    }

    const startTime = Date.now();
    let auditEntry: any = {
      userId: context.user.id,
      sessionId: context.request.sessionId,
      messageId: context.messageId,
      rawQuery: context.request.content || context.request.message || '',
      queryType: 'chat' as const,
      ipAddress: context.request.ipAddress,
      userAgent: context.request.userAgent,
      requestPayload: {
        content: context.request.content || context.request.message || '',
        model: context.request.model,
        sessionId: context.request.sessionId
      }
    };

    try {
      this.activeContexts.set(context.messageId, context);
      this.emit('pipeline:start', { context });

      // CONTEXT MANAGEMENT: Check and silently compact if approaching limits
      // This runs in background without blocking the request
      if (context.request.sessionId) {
        contextManagementService.checkAndCompact(
          context.request.sessionId,
          context.request.model
        ).catch(err => {
          this.logger.warn({ err, sessionId: context.request.sessionId }, 'Context compaction check failed');
        });
      }

      // REMOVED: Fake thinking messages - now only show REAL LLM reasoning
      // The completion stage (completion-simple.stage.ts) captures actual thinking from:
      // - Claude: delta.thinking (native extended thinking API)
      // - Gemini: delta.reasoning, thinking_config (native thinking)
      // - OpenAI/Ollama: <thinking> tags extracted from prompt-based reasoning
      // See lines 968-979 and 1080-1135 in completion-simple.stage.ts

      const metrics = await this.executeStages(context);
      
      // Update audit entry with results
      auditEntry.responseTimeMs = Date.now() - startTime;
      auditEntry.success = true;
      auditEntry.tokensConsumed = metrics.tokenUsage?.totalTokens;
      auditEntry.modelUsed = context.request.model;
      auditEntry.responsePayload = {
        content: context.response || '',
        toolCalls: context.mcpCalls,
        metrics: {
          totalTime: metrics.totalTime,
          mcpCalls: metrics.mcpCalls,
          cacheHits: metrics.cacheHits
        }
      };
      
      // Log successful completion
      await this.auditLogger.logUserQuery(auditEntry);
      
      this.emit('pipeline:complete', { context, metrics });
      this.logger.info({ 
        messageId: context.messageId,
        totalTime: metrics.totalTime,
        stageTimings: metrics.stageTimings 
      }, 'Pipeline completed successfully');

    } catch (error) {
      // Update audit entry with error details
      auditEntry.responseTimeMs = Date.now() - startTime;
      auditEntry.success = false;
      auditEntry.errorMessage = error.message;
      auditEntry.errorCode = error.code || 'PIPELINE_ERROR';
      
      // Log failed execution
      await this.auditLogger.logUserQuery(auditEntry);
      
      await this.handleError(context, error);
    } finally {
      this.activeContexts.delete(context.messageId);
    }
  }

  /**
   * Execute all pipeline stages with optimized parallelization
   */
  private async executeStages(context: PipelineContext): Promise<PipelineMetrics> {
    const metrics: PipelineMetrics = {
      stageTimings: {},
      totalTime: 0,
      tokenUsage: null,
      mcpCalls: 0,
      cacheHits: 0,
      errors: 0
    };

    const startTime = Date.now();

    // OPTIMIZATION: Execute auth and validation in parallel (they're independent)
    const parallelStages = ['auth', 'validation'];
    const parallelStartTime = Date.now();

    // Find auth and validation stages
    const authStage = this.stages.find(s => s.name === 'auth');
    const validationStage = this.stages.find(s => s.name === 'validation');

    if (authStage && validationStage) {
      try {
        this.logger.info({
          messageId: context.messageId,
          stages: ['auth', 'validation']
        }, 'Executing auth and validation stages in parallel');

        const [authResult, validationResult] = await Promise.all([
          authStage.execute(context).catch(error => {
            metrics.errors++;
            throw error;
          }),
          validationStage.execute(context).catch(error => {
            metrics.errors++;
            throw error;
          })
        ]);

        // Merge results back to context (auth doesn't modify context much)
        context = validationResult; // Validation result has the session data

        const parallelTime = Date.now() - parallelStartTime;
        metrics.stageTimings['auth'] = parallelTime;
        metrics.stageTimings['validation'] = parallelTime;

        this.logger.info({
          messageId: context.messageId,
          executionTime: parallelTime
        }, 'Parallel auth/validation completed');

      } catch (error) {
        const parallelTime = Date.now() - parallelStartTime;
        metrics.stageTimings['parallel-auth-validation'] = parallelTime;

        this.logger.error({
          messageId: context.messageId,
          error: error.message
        }, 'Parallel auth/validation failed');

        throw error;
      }
    }

    // Execute remaining stages sequentially (they have dependencies)
    for (const stage of this.stages) {
      // Skip already executed stages
      if (parallelStages.includes(stage.name)) {
        continue;
      }

      if (context.aborted) {
        this.logger.warn({
          messageId: context.messageId,
          stage: stage.name
        }, 'Pipeline aborted, skipping remaining stages');
        break;
      }

      const stageStartTime = Date.now();

      try {
        this.logger.debug({
          messageId: context.messageId,
          stage: stage.name
        }, 'Executing pipeline stage');

        // REMOVED: Fake stage thinking messages
        // Real thinking now comes directly from LLM responses in completion-simple.stage.ts
        // See lines 968-979 (Claude/Gemini native thinking) and 1080-1135 (<thinking> tag extraction)

        context = await stage.execute(context);
        
        // Handle tool call loop after completion or multi-model orchestration stage
        if (stage.name === 'completion' || stage.name === 'multi-model-orchestration') {
          // Handle tool calls in a loop to support multiple rounds
          let toolCallRound = 0;

          // Load maxToolCallRounds from pipeline config (default 5 - reduced from 10 to prevent excessive loops)
          let maxToolCallRounds = 5;
          try {
            const pipelineConfigService = getPipelineConfigService(this.services.prisma, this.services.redis);
            const pipelineConfig = await pipelineConfigService.getConfiguration();
            maxToolCallRounds = Math.min(pipelineConfig.stages.toolExecution.maxToolCallRounds || 5, 10); // Cap at 10
            this.logger.info({
              messageId: context.messageId,
              maxToolCallRounds,
              source: 'pipeline-config'
            }, '[TOOL-EXECUTION] Loaded maxToolCallRounds from pipeline config');
          } catch (configError: any) {
            this.logger.warn({
              messageId: context.messageId,
              error: configError.message,
              defaultValue: maxToolCallRounds
            }, '[TOOL-EXECUTION] Failed to load pipeline config, using default maxToolCallRounds');
          }

          // Track reasoning-only tools that should only run once per session
          const reasoningOnlyTools = new Set(['sequentialthinking', 'sequential_thinking', 'reasoning', 'think']);
          let reasoningToolsUsed = new Set<string>();

          while (context.request.toolCalls && context.request.toolCalls.length > 0 && toolCallRound < maxToolCallRounds) {
            toolCallRound++;

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              hasToolCalls: !!(context.request.toolCalls),
              toolCallsLength: context.request.toolCalls?.length || 0,
              toolCallsType: Array.isArray(context.request.toolCalls) ? 'array' : typeof context.request.toolCalls,
              toolCallsStructure: context.request.toolCalls ? JSON.stringify(context.request.toolCalls).substring(0, 200) : null
            }, `Tool call round ${toolCallRound}: Processing tool calls`);

            // EARLY TERMINATION: Filter out reasoning-only tools that have already been called
            // This prevents the LLM from calling sequentialthinking 10+ times in a row
            const originalToolCalls = context.request.toolCalls;
            const filteredToolCalls = originalToolCalls.filter(tc => {
              const toolName = tc.function.name.toLowerCase();
              if (reasoningOnlyTools.has(toolName) && reasoningToolsUsed.has(toolName)) {
                this.logger.info({
                  messageId: context.messageId,
                  toolCallRound,
                  skippedTool: tc.function.name
                }, `[TOOL-OPTIMIZATION] Skipping duplicate reasoning tool: ${tc.function.name}`);
                return false;
              }
              return true;
            });

            // Track reasoning tools being used
            originalToolCalls.forEach(tc => {
              const toolName = tc.function.name.toLowerCase();
              if (reasoningOnlyTools.has(toolName)) {
                reasoningToolsUsed.add(toolName);
              }
            });

            // If all remaining tools were filtered out, exit the loop
            if (filteredToolCalls.length === 0) {
              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                filteredOut: originalToolCalls.length
              }, '[TOOL-OPTIMIZATION] All requested tools were duplicate reasoning tools - forcing final completion');
              context.request.toolCalls = undefined;
              break;
            }

            // Use filtered tool calls
            context.request.toolCalls = filteredToolCalls;

            // REQUEST USER APPROVAL FOR TOOL EXECUTION
            // Format tool calls for display
            const toolsForApproval = context.request.toolCalls.map(tc => ({
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments
            }));

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              toolCount: toolsForApproval.length,
              tools: toolsForApproval
            }, 'Requesting user approval for tool execution');

            // Emit approval request event to frontend
            context.emit('tool_approval_request', {
              toolCallRound,
              tools: toolsForApproval,
              messageId: context.messageId
            });

            // For now, AUTO-APPROVE all tools to maintain functionality
            // TODO: Implement proper two-way communication for approval
            // This requires either WebSocket or a separate approval endpoint
            const approved = true; // TEMPORARY AUTO-APPROVE

            this.logger.warn({
              messageId: context.messageId,
              toolCallRound,
              autoApproved: true
            }, '⚠️ TEMPORARY: Tools auto-approved - human approval UI shown but not enforced yet');

            if (!approved) {
              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                toolCount: context.request.toolCalls.length
              }, 'Tool execution rejected by user');

              // Add rejection message to conversation
              context.messages.push({
                id: `tool_rejection_${toolCallRound}`,
                role: 'system',
                content: 'Tool execution was denied by the user.',
                timestamp: new Date(),
                tokenUsage: null
              });

              // Clear tool calls and exit loop
              context.request.toolCalls = undefined;
              break;
            }

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              toolCount: context.request.toolCalls.length
            }, 'Tool execution approved by user - proceeding');

            // Execute tool calls via MCP Proxy with user's Azure AD token
            const toolExecutionStart = Date.now();

            // CRITICAL: Emit tool execution start event to keep SSE stream alive
            // This prevents frontend from showing flashing cursor/freeze during tool execution
            context.emit('tool_execution_start', {
              toolCallRound,
              toolCount: context.request.toolCalls.length,
              tools: context.request.toolCalls.map(tc => ({
                id: tc.id,
                name: tc.function.name
              })),
              timestamp: new Date().toISOString()
            });

            try {
              const toolExecutionResult = await executeToolCalls(
                context.request.toolCalls,
                this.logger,
                context.availableTools,  // Pass available tools for name resolution
                context.user.accessToken,  // Pass user's Azure AD token for OBO auth (Azure ARM)
                (context.user as any).idToken,  // Pass ID token for AWS Identity Center OBO
                context.user.id,  // User ID for audit logging
                context.request.sessionId,  // Session ID for audit tracking
                context.messageId,  // Message ID for audit tracking
                undefined,  // IP address (not available in pipeline context)
                undefined,  // User agent (not available in pipeline context)
                (event: string, data: any) => context.emit(event, data),  // Pass emit function to keep SSE alive
                context.request.message,  // Original user query for tool success tracking
                context.user.groups || [],  // User's Azure AD groups for access control
                context.user.isAdmin || false,  // User's admin status for access control
                context.config.model || context.request.model,  // Model used for audit logging
                context.config.provider,  // Model provider for audit logging
                context.user.displayName || context.user.name,  // User's display name for audit
                context.user.email,  // User's email for audit
                context.codeExecutionContext  // Pass existing agenticode session context (for invisible agent persistence)
              );

              // Extract results and update code execution context
              const toolResults = toolExecutionResult.results;
              if (toolExecutionResult.codeExecutionContext) {
                context.codeExecutionContext = toolExecutionResult.codeExecutionContext;
              }

              const toolExecutionTime = Date.now() - toolExecutionStart;

              // CRITICAL: Emit tool execution complete event
              context.emit('tool_execution_complete', {
                toolCallRound,
                toolCount: toolResults.length,
                executionTimeMs: toolExecutionTime,
                successCount: toolResults.filter(r => !r.error).length,
                errorCount: toolResults.filter(r => r.error).length,
                timestamp: new Date().toISOString()
              });
              metrics.stageTimings[`tool-execution-${toolCallRound}`] = toolExecutionTime;

              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                executionTime: toolExecutionTime,
                resultsCount: toolResults.length,
                successCount: toolResults.filter(r => !r.error).length,
                errorCount: toolResults.filter(r => r.error).length
              }, `Tool call round ${toolCallRound}: Tool execution completed`);

              // Convert tool results to messages and add to conversation
              const toolMessages = formatToolResultsAsMessages(toolResults);

              // OPTIMIZATION: Store large results to prevent context bloat
              const resultStorageService = (context as any).resultStorageService;

              // Add tool messages to context (with large result interception)
              for (let i = 0; i < toolMessages.length; i++) {
                const toolMessage = toolMessages[i];
                const toolResult = toolResults[i];

                // Check if this result is too large for context
                let messageContent = toolMessage.content;

                if (resultStorageService && !toolResult.error && toolResult.result) {
                  const shouldStore = resultStorageService.shouldStoreResult(toolResult.result);

                  if (shouldStore) {
                    // Store the result and replace message content with reference
                    const storedInfo = await resultStorageService.storeResult({
                      userId: context.user.id,
                      sessionId: context.request.sessionId,
                      toolName: toolResult.toolName,
                      toolCallId: toolResult.toolCallId,
                      result: toolResult.result
                    });

                    // Replace content with compact reference message
                    messageContent = resultStorageService.createStoredResultMessage({
                      resultId: storedInfo.resultId,
                      toolName: toolResult.toolName,
                      summary: storedInfo.summary,
                      sizeBytes: storedInfo.sizeBytes,
                      chunkCount: storedInfo.chunkCount
                    });

                    // CRITICAL: Update the toolMessage object itself so database gets compact content
                    toolMessage.content = messageContent;

                    this.logger.info({
                      toolName: toolResult.toolName,
                      originalSize: storedInfo.sizeBytes,
                      newSize: Buffer.byteLength(messageContent, 'utf8'),
                      savings: storedInfo.sizeBytes - Buffer.byteLength(messageContent, 'utf8'),
                      resultId: storedInfo.resultId
                    }, '💾 Large tool result intercepted and stored - context saved!');
                  }
                }

                context.messages.push({
                  id: `tool_${toolMessage.tool_call_id}`,
                  role: 'tool',
                  content: messageContent,
                  toolCallId: toolMessage.tool_call_id,
                  timestamp: new Date(),
                  tokenUsage: null
                });
              }

              // DATABASE-FIRST: Save tool messages to PostgreSQL IMMEDIATELY after execution
              // This ensures correct message order for follow-up questions
              const chatStorage = (context as any).chatStorage;
              const sessionId = (context as any).sessionId || context.session?.id;

              if (chatStorage && sessionId && toolMessages.length > 0) {
                this.logger.info('┌─────────────────────────────────────────────────────────────');
                this.logger.info('│ [DB-FIRST] 💾 Saving tool messages to PostgreSQL IMMEDIATELY');
                this.logger.info('└─────────────────────────────────────────────────────────────');

                try {
                  const saveStartTime = Date.now();

                  for (const toolMessage of toolMessages) {
                    const toolMessageData = {
                      role: 'tool' as const,
                      content: toolMessage.content,
                      toolCallId: toolMessage.tool_call_id,
                      timestamp: new Date(),
                      userId: context.user.id
                    };

                    const savedMessage = await chatStorage.addMessage(sessionId, toolMessageData);

                    this.logger.info({
                      messageId: savedMessage.id,
                      toolCallId: toolMessage.tool_call_id,
                      contentLength: toolMessage.content?.length || 0
                    }, `│ [SAVE] ✅ Message saved (tool) - ${savedMessage.id}`);

                    // Mark as saved in context to prevent duplicate saving in response stage
                    const contextMessage = context.messages.find(m => m.id === `tool_${toolMessage.tool_call_id}`);
                    if (contextMessage) {
                      contextMessage.id = savedMessage.id; // Use DB ID
                      contextMessage.metadata = { savedToDb: true };
                    }

                    // Emit to frontend
                    context.emit('message_saved', {
                      messageId: savedMessage.id,
                      role: 'tool',
                      content: toolMessage.content,
                      toolCallId: toolMessage.tool_call_id,
                      timestamp: new Date().toISOString(),
                      source: 'database',
                      confirmed: true
                    });
                  }

                  const saveTime = Date.now() - saveStartTime;

                  this.logger.info({
                    toolMessagesCount: toolMessages.length,
                    saveTimeMs: saveTime,
                    performance: saveTime < 100 ? '🚀 FAST' : saveTime < 500 ? '✅ OK' : '⚠️  SLOW'
                  }, '│ [DB-FIRST] ✅ All tool messages saved to PostgreSQL');

                } catch (error) {
                  this.logger.error({
                    error: error.message,
                    errorStack: error.stack,
                    sessionId,
                    userId: context.user.id,
                    toolMessagesCount: toolMessages.length
                  }, '│ [DB-FIRST] ❌ ERROR: Failed to save tool messages');
                  // Don't throw - tool messages are still in context for this request
                }
              }

              // Update MCP calls count in context
              const newMcpCalls = toolResults.map((r, index) => {
                // Parse arguments if string
                let parsedArgs;
                const argsString = context.request.toolCalls![index]?.function?.arguments || '{}';
                try {
                  parsedArgs = typeof argsString === 'string' ? JSON.parse(argsString) : argsString;
                } catch (e) {
                  parsedArgs = argsString;
                }

                return {
                  id: r.toolCallId,
                  name: r.toolName,
                  tool: r.toolName,
                  toolName: r.toolName,
                  serverId: r.serverName || 'mcp-proxy',  // Dynamic MCP server name (admin, fetch, azure_mcp, etc.)
                  serverName: r.serverName || 'MCP Proxy',  // Display name for the MCP server
                  executedOn: r.executedOn,  // K8s pod/container hostname for traceability
                  arguments: parsedArgs,
                  result: r.result, // Direct result data, not wrapped
                  error: r.error,
                  status: r.error ? 'failed' : 'completed',
                  startTime: Date.now() - toolExecutionTime,
                  endTime: Date.now(),
                  duration: toolExecutionTime,
                  timestamp: new Date()
                };
              });

              context.mcpCalls.push(...newMcpCalls);

              // Emit MCP calls to frontend for display
              context.emit('mcp_calls_data', {
                calls: newMcpCalls,
                totalCalls: context.mcpCalls.length,
                round: toolCallRound
              });

              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                messageCount: context.messages.length,
                toolMessagesAdded: toolMessages.length,
                mcpCallsCount: context.mcpCalls.length,
                emittedMcpCalls: newMcpCalls.length,
                lastThreeMessages: context.messages.slice(-3).map(m => ({
                  role: m.role,
                  hasContent: !!m.content,
                  hasToolCalls: !!m.toolCalls,
                  hasToolCallId: !!m.toolCallId,
                  toolCallId: m.toolCallId
                }))
              }, `Tool call round ${toolCallRound}: Tool results added to conversation and emitted to frontend`);

            } catch (error: any) {
              this.logger.error({
                messageId: context.messageId,
                toolCallRound,
                error: error.message,
                stack: error.stack
              }, `Tool call round ${toolCallRound}: Tool execution failed`);

              // Add error message to conversation
              context.messages.push({
                id: `tool_error_${toolCallRound}`,
                role: 'system',
                content: `Tool execution failed: ${error.message}`,
                timestamp: new Date(),
                tokenUsage: null
              });
            }

            // Clear tool calls before re-running completion
            context.request.toolCalls = undefined;

            // IMPORTANT: Do NOT set forceFinalCompletion here!
            // Let the AI decide if it needs more tools or wants to provide a final answer
            // Only force final completion when we hit max rounds (see below)

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              contextMessagesCount: context.messages.length,
              allowMoreTools: true
            }, 'Re-running completion with tools available - AI can call more tools if needed');

            // CRITICAL: Emit event that we're re-running completion
            // This keeps the SSE stream alive and informs frontend
            context.emit('completion_restart', {
              toolCallRound,
              reason: 'processing_tool_results',
              timestamp: new Date().toISOString()
            });

            // Re-run completion stage to get AI response to tool results
            // CRITICAL: Run MESSAGE-PREP first to build message array with tool results!
            // Never suppress streaming on the first tool response to maintain UX
            const originalSuppressStreaming = context.config.suppressStreaming;
            context.config.suppressStreaming = false; // Allow streaming for better UX

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              suppressStreaming: context.config.suppressStreaming,
              hasStreamCallback: typeof context.emit === 'function'
            }, '🔵 [MCP-STREAM-DEBUG] About to execute completion after tool results');

            const completionStartTime = Date.now();

            // CRITICAL FIX: Run MESSAGE-PREP before completion to include tool results in context
            const messagePrepStage = this.stages.find(s => s.name === 'message-preparation');
            if (messagePrepStage) {
              context = await messagePrepStage.execute(context);
              
              // ═══════════════════════════════════════════════════════════════════════════
              // SYNTHESIS READINESS CHECK: Ensure we have valid prepared messages
              // If message-prep stripped all messages, synthesis will fail silently
              // ═══════════════════════════════════════════════════════════════════════════
              const toolMessagesInContext = context.messages.filter((m: any) => m.role === 'tool').length;
              const toolMessagesInPrepared = context.preparedMessages?.filter((m: any) => m.role === 'tool').length || 0;
              const assistantWithToolsInPrepared = context.preparedMessages?.filter(
                (m: any) => m.role === 'assistant' && m.tool_calls?.length > 0
              ).length || 0;
              
              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                preparedMessagesCount: context.preparedMessages?.length || 0,
                toolMessagesInContext,
                toolMessagesInPrepared,
                assistantWithToolsInPrepared
              }, 'MESSAGE-PREP ran before synthesis completion - tool results included');
              
              // Warn if tool messages were stripped
              if (toolMessagesInContext > 0 && toolMessagesInPrepared === 0) {
                this.logger.error({
                  messageId: context.messageId,
                  toolCallRound,
                  toolMessagesInContext,
                  toolMessagesInPrepared,
                  preparedMessageRoles: context.preparedMessages?.map((m: any) => m.role)
                }, '🔴 [SYNTHESIS-ERROR] Tool messages were stripped from prepared messages - synthesis will fail!');
              }
            }

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              stageName: stage.name
            }, '🔵 [MCP-STREAM-DEBUG] Executing completion stage now...');

            context = await stage.execute(context);
            const completionTime = Date.now() - completionStartTime;
            metrics.stageTimings[`completion-followup-${toolCallRound}`] = completionTime;

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              completionTimeMs: completionTime
            }, '🔵 [MCP-STREAM-DEBUG] Completion stage finished');

            // Restore original streaming setting
            context.config.suppressStreaming = originalSuppressStreaming;

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              hasNewToolCalls: !!(context.request.toolCalls),
              newToolCallsLength: context.request.toolCalls?.length || 0
            }, `Tool call round ${toolCallRound} completed`);
          }
          
          if (toolCallRound >= maxToolCallRounds) {
            this.logger.warn({
              messageId: context.messageId,
              maxRounds: maxToolCallRounds
            }, 'Maximum tool call rounds reached, forcing final response');

            // Force a final completion without tools to get a response
            // NOTE: Look for either 'completion' or 'multi-model-orchestration' stage
            const completionStage = this.stages.find(s => s.name === 'completion' || s.name === 'multi-model-orchestration');
            if (completionStage) {
              // Clear tool calls to prevent more rounds
              context.request.toolCalls = undefined;

              // Set flag to indicate forced final completion (no tools should be included)
              context.forceFinalCompletion = true;

              // Add a synthesis instruction to help LLM understand it must generate a final response
              const toolsExecuted = context.mcpCalls?.length || 0;
              // Add as system message so it won't be saved to DB or shown in UI
              // Keep instruction simple and direct to avoid LLM confusion/repetition loops
              const synthesisInstruction = {
                id: `system_synthesis_${context.messageId}`,
                role: 'system' as const,
                content: `Provide your final answer now. Summarize the tool results concisely and answer the user's question.`,
                timestamp: new Date(),
                tokenUsage: null
              };
              context.messages.push(synthesisInstruction);

              this.logger.info({
                messageId: context.messageId,
                toolsExecuted,
                synthesisInstructionAdded: true
              }, 'Forcing final completion after max tool rounds - synthesis instruction added');

              const finalCompletionStart = Date.now();
              context = await completionStage.execute(context);
              metrics.stageTimings['completion-final-forced'] = Date.now() - finalCompletionStart;
            }
          }

          // ═══════════════════════════════════════════════════════════════════════════
          // SAFETY CHECK: Ensure a response is ALWAYS generated when tools were executed
          // BUG FIX: If MCP tools executed but no synthesis response was generated,
          // we must emit a fallback response so the user sees SOMETHING.
          // ═══════════════════════════════════════════════════════════════════════════
          if (context.mcpCalls && context.mcpCalls.length > 0) {
            // Check if we have a final assistant message with content
            const finalAssistantMessages = context.messages.filter(
              m => m.role === 'assistant' && m.content && m.content.trim().length > 0
            );
            const hasToolCalls = context.messages.some(
              m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
            );
            const toolsExecuted = context.mcpCalls.length;

            // If we have tool calls but no synthesis, emit a fallback response
            if (hasToolCalls && finalAssistantMessages.length === 0) {
              this.logger.warn({
                messageId: context.messageId,
                toolsExecuted,
                mcpCalls: context.mcpCalls.map((c: any) => c.name)
              }, '⚠️ [SYNTHESIS-FIX] Tools executed but no synthesis response - generating fallback');

              // Generate fallback response with tool execution summary
              const toolSummary = context.mcpCalls.map((call: any) => {
                const status = call.error ? '❌' : '✓';
                return `${status} ${call.name || call.toolName}`;
              }).join('\n');

              const fallbackContent = `I executed ${toolsExecuted} tool${toolsExecuted > 1 ? 's' : ''} to help answer your question:\n\n${toolSummary}\n\nHowever, I encountered an issue generating a complete response. The tool results have been collected. Please try rephrasing your question or asking me to summarize the results.`;

              // Emit the fallback response via SSE
              context.emit('stream', { content: fallbackContent, delta: false });
              context.emit('completion_complete', {
                content: fallbackContent,
                messageId: `fallback_${context.messageId}`,
                toolCalls: [],
                model: context.config.model,
                timestamp: Date.now(),
                fallback: true
              });

              this.logger.info({
                messageId: context.messageId,
                toolsExecuted,
                fallbackLength: fallbackContent.length
              }, '✅ [SYNTHESIS-FIX] Fallback response emitted');
            }
          }
        }
        
        const stageTime = Date.now() - stageStartTime;
        metrics.stageTimings[stage.name] = stageTime;

        this.emit('stage:complete', { 
          stage: stage.name, 
          context, 
          executionTime: stageTime 
        });

      } catch (error) {
        const stageTime = Date.now() - stageStartTime;
        metrics.stageTimings[stage.name] = stageTime;
        metrics.errors++;

        // Extract stack trace for better error location
        const stackLines = error.stack?.split('\n') || [];
        const relevantStack = stackLines.slice(0, 5).join('\n');
        const errorLocation = this.extractErrorLocation(error);

        this.logger.error({
          messageId: context.messageId,
          stage: stage.name,
          error: error instanceof Error ? error.message : String(error),
          errorType: error.constructor?.name || 'unknown',
          errorCode: error.code,
          errorLocation,
          errorStack: relevantStack,
          fullStack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          executionTime: stageTime,
          userId: context.user.id,
          sessionId: context.request.sessionId,
          stageFile: `${stage.constructor.name}.ts`,
          failedAt: `ChatPipeline.ts:${new Error().stack?.split('\n')[2]?.match(/:([0-9]+):([0-9]+)/)?.[1] || 'unknown'}`,
          requestDetails: {
            messageLength: context.request.message?.length || 0,
            hasMessages: !!(context.messages?.length),
            hasToolCalls: !!(context.request.toolCalls?.length),
            model: context.request.model,
            sessionId: context.request.sessionId
          },
          pipelineState: {
            totalErrors: context.errors.length,
            hasSystemPrompt: !!context.systemPrompt,
            mcpInstanceCount: context.mcpInstances.length,
            mcpCallCount: context.mcpCalls.length
          }
        }, `🔴 PIPELINE FAILURE [${stage.name}:${errorLocation}] ${error.message}`);

        // Add error to context
        const pipelineError: PipelineError = {
          stage: stage.name,
          code: error.code || ChatErrorCode.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
          details: error.details,
          retryable: error.retryable || false,
          timestamp: new Date()
        };
        
        context.errors.push(pipelineError);

        // FAIL FAST: All errors should be immediately visible and cause pipeline failure
        context.aborted = true;

        // Emit immediate error notification so user knows what's broken
        const immediateError = {
          code: error.code || 'PIPELINE_FAILURE',
          message: `⚡ INSTANT FAILURE in ${stage.name}: ${error.message}`,
          stage: stage.name,
          timestamp: new Date().toISOString(),
          critical: true,
          failFast: true
        };

        context.emit('error', immediateError);

        this.logger.error({
          CRITICAL_FAILURE: true,
          stage: stage.name,
          error: error.message,
          immediateAbort: true
        }, `💥 IMMEDIATE PIPELINE ABORT: ${stage.name} failed - ${error.message}`);

        throw error;
      }
    }

    metrics.totalTime = Date.now() - startTime;
    metrics.tokenUsage = this.extractTokenUsage(context);
    metrics.mcpCalls = context.mcpCalls?.length || 0;

    return metrics;
  }

  /**
   * Create initial pipeline context
   */
  private createContext(request: ChatRequest, user: ChatUser, streamCallback: (event: any) => void | Promise<void>): PipelineContext {
    const messageId = this.generateMessageId();
    const startTime = new Date();

    const streamContext: StreamContext = {
      sessionId: request.sessionId,
      userId: user.id,
      messageId,
      startTime,
      tokenCount: 0,
      toolCallCount: 0,
      mcpCallCount: 0
    };

    return {
      // Request data
      request,
      user,
      session: null as any, // Will be populated by stages
      
      // Processing state
      messageId,
      startTime,
      streamContext,
      
      // Accumulated data
      messages: [],
      systemPrompt: undefined,
      promptEngineering: undefined,
      mcpInstances: [],
      mcpCalls: [],
      
      // Configuration - CRITICAL: Override config model with request model if user explicitly selected one
      // This allows users to switch models on-the-fly via the toolbar
      config: {
        ...this.config,
        // User's model selection takes priority over default config
        model: request.model || this.config.model
      },

      // Services for stages to use - use getter if available to get latest service
      milvusService: this.services.getMilvus ? this.services.getMilvus() : this.services.milvus,
      redisService: this.services.redis,
      resultStorageService: this.resultStorageService,
      completionService: this.services.completion,

      // Utilities
      logger: this.logger.child({ messageId }) as Logger,
      emit: (event: string, data: any) => {
        // Map backend events to frontend-expected events
        let frontendEvent = event;
        if (event === 'content_delta') {
          frontendEvent = 'stream';
        }
        if (event === 'completion_complete') {
          frontendEvent = 'done';
        }
        if (event === 'thinking') {
          frontendEvent = 'thinking_event';
        }

        // Handle both sync and async callbacks
        const result = streamCallback({ type: frontendEvent, data, timestamp: new Date() });
        if (result instanceof Promise) {
          result.catch(error => {
            this.logger.error('Stream callback failed', { error: error instanceof Error ? error.message : String(error) });
          });
        }
        this.emit(event, { context: this, data });
      },
      
      // Error handling
      errors: [],
      aborted: false
    };
  }

  /**
   * Handle pipeline errors
   */
  private async handleError(context: PipelineContext, error: any): Promise<void> {
    const errorLocation = this.extractErrorLocation(error);
    const lastError = context.errors[context.errors.length - 1];

    this.logger.error({
      messageId: context.messageId,
      userId: context.user.id,
      sessionId: context.request.sessionId,
      error: error.message,
      errorLocation,
      failedStage: lastError?.stage || 'unknown',
      errorCode: error.code,
      errorType: error.constructor?.name,
      errors: context.errors
    }, `🔴 PIPELINE FAILED at ${errorLocation}: ${error.message}`);

    // Check if user is admin for enhanced error display
    const isAdmin = context.user?.isAdmin || false;
    const stage = lastError?.stage || 'unknown';

    // Get recommendations (Ollama-enhanced for admin, default for non-admin)
    let recommendations: string[] = [];
    if (isAdmin) {
      try {
        // Try to get Ollama-generated recommendations for admin
        const enrichedError = await enrichErrorForAdmin(
          error,
          stage,
          {
            model: context.request.model,
            userId: context.user?.id
          },
          this.logger
        );
        recommendations = enrichedError.recommendations;
      } catch (e) {
        // Fall back to default recommendations
        recommendations = getDefaultRecommendations(stage, error);
      }
    }

    // Send detailed error to client with better context
    const errorDetails = {
      code: error.code || ChatErrorCode.INTERNAL_ERROR,
      message: error.message || 'An unexpected error occurred',
      retryable: isRetryableError(error),
      stage,
      location: errorLocation,
      fallbackMode: true,
      timestamp: new Date().toISOString(),
      // Include admin-specific info
      isAdmin,
      recommendations: isAdmin ? recommendations : undefined,
      // Always include helpful debug info
      debugInfo: {
        failedAt: `${stage}:${errorLocation}`,
        errorType: error.constructor?.name || 'Error',
        model: context.request.model,
        hasToolCalls: !!(context.request.toolCalls?.length)
      },
      // Include detailed info for admin users (not just development mode)
      ...(isAdmin && {
        details: error.details,
        stack: error.stack?.split('\n').slice(0, 10).join('\n'),
        allErrors: context.errors.map(e => ({
          stage: e.stage,
          message: e.message,
          code: e.code,
          timestamp: e.timestamp
        }))
      })
    };
    
    // Also emit a special fallback mode notification
    context.emit('fallback_mode', {
      reason: `${errorDetails.stage}_failure`,
      originalError: error.message,
      capabilities: ['basic_math', 'simple_responses'],
      timestamp: new Date().toISOString()
    });
    
    context.emit('error', errorDetails);

    // Attempt rollback for stages that support it
    await this.rollbackStages(context);

    this.emit('pipeline:error', { context, error });
  }

  /**
   * Rollback stages in reverse order
   */
  private async rollbackStages(context: PipelineContext): Promise<void> {
    const reversedStages = [...this.stages].reverse();
    
    for (const stage of reversedStages) {
      if (stage.rollback) {
        try {
          await stage.rollback(context);
          this.logger.debug({ 
            messageId: context.messageId,
            stage: stage.name 
          }, 'Stage rollback completed');
        } catch (rollbackError) {
          this.logger.error({ 
            messageId: context.messageId,
            stage: stage.name,
            error: rollbackError
          }, 'Stage rollback failed');
        }
      }
    }
  }

  /**
   * Build pipeline configuration with defaults
   */
  private buildConfig(config: Partial<PipelineConfig>): PipelineConfig {
    return {
      // Model settings - Use provided model or default from environment (no hardcoded fallbacks)
      model: config.model || process.env.DEFAULT_MODEL,
      // LLM provider - from config, env var, or auto-detect from model. NEVER default to 'ollama'.
      provider: config.provider || process.env.DEFAULT_LLM_PROVIDER || undefined,
      temperature: config.temperature !== undefined ? config.temperature : parseFloat(process.env.DEFAULT_TEMPERATURE || '1.0'),
      maxTokens: config.maxTokens || parseInt(process.env.DEFAULT_MAX_TOKENS || '8192'), // Vertex AI max is 8192
      
      // Feature flags
      enableMCP: config.enableMCP !== false,
      enablePromptEngineering: config.enablePromptEngineering !== false,
      enableCoT: config.enableCoT === true, // Disabled by default
      enableRAG: config.enableRAG !== false && process.env.DISABLE_RAG !== 'true', // ENABLED by default for artifact search
      enableMemory: config.enableMemory === true || process.env.ENABLE_MEMORY === 'true', // Disabled by default
      enableCaching: config.enableCaching !== false,
      enableAnalytics: config.enableAnalytics !== false,
      
      // Timeouts and limits - FAIL FAST settings
      requestTimeout: config.requestTimeout || 30000, // 30 seconds max - fail fast!
      mcpTimeout: config.mcpTimeout || 10000, // 10 seconds for MCP - fail fast!
      maxHistoryLength: config.maxHistoryLength || 100, // Increased from 20 to 100 to preserve conversation context
      maxTokenBudget: config.maxTokenBudget || 100000,
      
      // Rate limiting
      rateLimitPerMinute: config.rateLimitPerMinute || 60,
      rateLimitPerHour: config.rateLimitPerHour || 1000
    };
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract token usage from context
   */
  private extractTokenUsage(context: PipelineContext): any {
    // Look for token usage in the last message or completion result
    return context.messages?.[context.messages.length - 1]?.tokenUsage || null;
  }

  /**
   * Extract error location from stack trace
   */
  private extractErrorLocation(error: any): string {
    if (!error?.stack) return 'Unknown location';

    const stackLines = error.stack.split('\n');

    // Find the first meaningful stack frame (skip error message and internal node frames)
    for (const line of stackLines.slice(1)) {
      // Match file paths with line/column numbers
      const match = line.match(/at\s+(?:.*?\s+)?[\(]?(.*?):(\d+):(\d+)\)?/);
      if (match) {
        const [, filePath, lineNum, colNum] = match;

        // Skip node internals and external modules
        if (!filePath.includes('node_modules') &&
            !filePath.includes('node:') &&
            !filePath.startsWith('internal/')) {

          // Extract just the relevant part of the path
          const relevantPath = filePath.includes('services/')
            ? filePath.substring(filePath.indexOf('services/'))
            : filePath.includes('src/')
            ? filePath.substring(filePath.indexOf('src/'))
            : filePath;

          return `${relevantPath}:${lineNum}:${colNum}`;
        }
      }
    }

    // Fallback to first non-message line if no good match found
    return stackLines[1]?.trim() || 'Unknown location';
  }

  /**
   * Health check for the pipeline
   */
  isHealthy(): boolean {
    return !this.isRunning || this.activeContexts.size < 100; // Arbitrary threshold
  }

  /**
   * Get pipeline statistics
   */
  getStats(): any {
    return {
      activeContexts: this.activeContexts.size,
      stageCount: this.stages.length,
      config: this.config,
      isHealthy: this.isHealthy()
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down chat pipeline...');
    
    // Wait for active contexts to complete (with timeout)
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeContexts.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Force abort remaining contexts  
    const activeContextsArray = Array.from(this.activeContexts.values());
    for (const context of activeContextsArray) {
      context.aborted = true;
    }
    
    this.activeContexts.clear();
    this.removeAllListeners();
    
    this.logger.info('Chat pipeline shutdown complete');
  }
}