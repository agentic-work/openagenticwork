import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ChatMessage, ChatErrorCode } from '../interfaces/chat.types.js';
import { StreamDelta } from '../interfaces/streaming.types.js';
import { trackChatMessage, chatResponseTime } from '../../../metrics/index.js';
import { extractErrorMessage, isRetryableError } from './error-handling.helper.js';
import { detectImageIntent } from './image-intent.helper.js';
import { ImageGenerationService } from '../../../services/ImageGenerationService.js';
import { ImageStorageService } from '../../../services/ImageStorageService.js';
import { ArtifactService } from '../../../services/ArtifactService.js';
import { llmMetricsService, LLMRequestMetrics } from '../../../services/LLMMetricsService.js';
import { TaskAnalysisService } from '../../../services/TaskAnalysisService.js';
import { validateContentSafety } from './content-safety.helper.js';
import { getTieredFunctionCallingService, initializeTieredFunctionCalling } from '../../../services/TieredFunctionCallingService.js';
import { getModelCapabilityRegistry } from '../../../services/ModelCapabilityRegistry.js';
import { ModelConfigurationService } from '../../../services/ModelConfigurationService.js';

/**
 * Completion Stage (Simplified)
 *
 * Focused ONLY on:
 * - Building LLM provider request
 * - Making streaming request
 * - Processing stream
 * - Error handling
 * - Image generation detection and routing
 *
 * Message prep is handled by message-preparation.stage.ts
 */
export class CompletionStage implements PipelineStage {
  readonly name = 'completion';
  readonly priority = 50;

  /**
   * Detect provider type from model name
   * Uses ModelCapabilityRegistry for centralized provider detection
   * Used for metrics tracking and cost calculation
   */
  private detectProviderType(model: string): string {
    // Safety guard for undefined/null model
    if (!model) {
      return 'unknown';
    }

    // Use centralized ModelCapabilityRegistry for provider detection
    const registry = getModelCapabilityRegistry();
    if (registry) {
      return registry.detectProviderType(model);
    }

    // Fallback: basic pattern matching if registry not initialized
    const modelLower = model.toLowerCase();
    if (modelLower.includes('claude')) return 'vertex-claude';
    if (modelLower.includes('gpt')) return 'azure-openai';
    if (modelLower.includes('gemini')) return 'vertex-ai';
    return 'unknown';
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    const requestStartTime = new Date();
    let timeToFirstToken: number | null = null;
    let firstTokenReceived = false;

    try {
      // Check if completion should be skipped (e.g., image generation already handled)
      if (context.skipCompletion) {
        context.logger.info({
          messageId: context.messageId
        }, '[COMPLETION] Skipping completion - already handled by previous stage');
        return context;
      }

      // Get prepared messages from message-preparation stage
      const messages = context.preparedMessages || [];

      // Check for image generation intent BEFORE LLM call
      // Get the user's message from the request or the last user message in messages array
      const lastUserMessage = context.messages?.filter(m => m.role === 'user').pop();
      const userMessageContent: any = context.request?.message || lastUserMessage?.content || '';
      let userMessageText = '';
      if (typeof userMessageContent === 'string') {
        userMessageText = userMessageContent;
      } else if (Array.isArray(userMessageContent) && userMessageContent.length > 0) {
        userMessageText = userMessageContent[0]?.text || '';
      }

      const imageIntent = detectImageIntent(userMessageText);

      if (imageIntent.isImageRequest) {
        context.logger.info({
          imagePrompt: imageIntent.imagePrompt?.substring(0, 100),
          originalMessage: imageIntent.originalMessage?.substring(0, 50)
        }, '[COMPLETION] Detected image generation intent - routing to image generation');

        return await this.handleImageGeneration(context, imageIntent.imagePrompt || userMessageText);
      }

      if (messages.length === 0) {
        throw new Error('No prepared messages found - message-preparation stage may have failed');
      }

      // Build request (now async for intelligent model routing)
      const request = await this.buildRequest(context, messages);

      context.logger.info({
        model: request.model,
        messageCount: request.messages.length,
        toolCount: request.tools?.length || 0,
        hasToolChoice: !!request.tool_choice
      }, '[COMPLETION] Starting LLM request');

      // DATABASE-FIRST: Save placeholder assistant message to PostgreSQL BEFORE streaming
      let savedAssistantMessageId: string | null = null;
      const chatStorage = (context as any).chatStorage;
      const sessionId = (context as any).sessionId || context.session?.id;

      if (chatStorage && sessionId) {
        context.logger.info('┌─────────────────────────────────────────────────────────────');
        context.logger.info('│ [DB-FIRST] 💾 STEP 2: Saving placeholder assistant message BEFORE streaming');
        context.logger.info('└─────────────────────────────────────────────────────────────');

        try {
          const placeholderMessage = {
            role: 'assistant' as const,
            content: '', // Empty placeholder - will be updated after streaming
            timestamp: new Date(),
            model: request.model
          };

          const saveStartTime = Date.now();
          // CRITICAL FIX: addMessage() expects (sessionId, messageObject) and returns full ChatMessage, not just ID
          const placeholderWithUserId = {
            ...placeholderMessage,
            userId: context.user.id
          };
          const savedMessage = await chatStorage.addMessage(sessionId, placeholderWithUserId);
          savedAssistantMessageId = savedMessage.id; // Extract ID from returned message object
          const saveTime = Date.now() - saveStartTime;

          context.logger.info({
            messageId: savedAssistantMessageId,
            sessionId,
            userId: context.user.id,
            saveTimeMs: saveTime,
            performance: saveTime < 50 ? '🚀 FAST' : saveTime < 200 ? '✅ OK' : '⚠️  SLOW'
          }, '│ [DB-FIRST] ✅ Placeholder assistant message saved with confirmed DB ID');

          // Emit confirmation to frontend that assistant message is starting (with DB ID)
          context.emit('message_saved', {
            messageId: savedAssistantMessageId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            source: 'database',
            confirmed: true,
            streaming: true  // Indicates this message will be streamed
          });

          context.logger.info({
            messageId: savedAssistantMessageId
          }, '│ [DB-FIRST] 📡 Emitted message_saved event with confirmed assistant message ID');

          // Store the confirmed DB ID for use during streaming
          (context as any).assistantMessageId = savedAssistantMessageId;

        } catch (error) {
          context.logger.error({
            error: error.message,
            errorStack: error.stack,
            sessionId,
            userId: context.user.id
          }, '│ [DB-FIRST] ⚠️  WARNING: Failed to save placeholder message, falling back to post-stream save');
          // Don't throw - fall back to original behavior
        }
      } else {
        context.logger.warn({
          hasChatStorage: !!chatStorage,
          hasSessionId: !!sessionId
        }, '[DB-FIRST] ⚠️  ChatStorage not available, skipping pre-stream save');
      }

      // Make request using ProviderManager or ChatCompletionService
      const completionService = context.completionService;
      if (!completionService) {
        throw new Error('Completion service not available in context');
      }

      // Check if using ProviderManager (has createCompletion method) or legacy ChatCompletionService (has createChatCompletion)
      const isProviderManager = typeof completionService.createCompletion === 'function';

      // Auto-detect vision requirements and switch to vision model if needed
      const hasImages = this.hasImageContent(request.messages);
      if (hasImages && !this.isVisionCapableModel(request.model)) {
        // Try to find a vision model from env vars (check all providers)
        const visionModel = process.env.OLLAMA_VISION_MODEL ||
                           process.env.AZURE_VISION_MODEL ||
                           process.env.VERTEX_VISION_MODEL;

        if (visionModel) {
          context.logger.info({
            originalModel: request.model,
            visionModel,
            reason: 'Image content detected, switching to vision-capable model'
          }, '🔄 [VISION-ROUTING] Auto-switching to vision model');
          request.model = visionModel;
        } else {
          context.logger.warn({
            originalModel: request.model,
            reason: 'Image content detected but no vision model configured (OLLAMA_VISION_MODEL, AZURE_VISION_MODEL, or VERTEX_VISION_MODEL)'
          }, '⚠️ [VISION-ROUTING] Cannot auto-switch - no vision model configured');
        }
      }

      context.logger.info({
        model: request.model,
        messageCount: request.messages.length,
        toolCount: request.tools?.length || 0,
        hasImages,
        serviceType: isProviderManager ? 'ProviderManager' : 'ChatCompletionService'
      }, '[COMPLETION] Making completion request');

      let stream;
      if (isProviderManager) {
        // Use ProviderManager (multi-provider support)
        // CRITICAL: Pass through thinking config for Gemini/Claude native thinking support
        stream = await completionService.createCompletion({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          tools: request.tools,
          stream: true,
          // Pass through thinking configuration for native API support (Gemini, Claude)
          thinking: (request as any).thinking,
          reasoning_effort: (request as any).reasoning_effort
        });

        // Check for failover and emit notification to client
        const failoverMetadata = completionService.getLastFailoverMetadata?.();
        if (failoverMetadata?.occurred) {
          context.logger.info({
            originalProvider: failoverMetadata.originalProvider,
            failoverProvider: failoverMetadata.failoverProvider,
            failureReason: failoverMetadata.failureReason,
            failoverTime: failoverMetadata.failoverTime
          }, '⚠️ [FAILOVER] Provider failover occurred');

          // Emit failover notification to client via SSE
          context.emit('provider_failover', {
            occurred: true,
            originalProvider: failoverMetadata.originalProvider,
            failoverProvider: failoverMetadata.failoverProvider,
            failureReason: failoverMetadata.failureReason,
            failoverTime: failoverMetadata.failoverTime,
            message: `⚠️ Primary provider (${failoverMetadata.originalProvider}) failed. Using ${failoverMetadata.failoverProvider} instead.`
          });

          // Clear the metadata after emitting
          completionService.clearFailoverMetadata?.();
        }
      } else {
        // Use legacy ChatCompletionService (Azure OpenAI only)
        stream = await completionService.createChatCompletion(
          request,
          undefined, // userToken - not used with direct Azure
          {
            userId: context.user.id,
            sessionId: context.session?.id,
            messageId: savedAssistantMessageId || context.messageId
          }
        );
      }

      // DIAGNOSTIC: Log what we received from createCompletion
      context.logger.info({
        streamType: typeof stream,
        isAsyncGenerator: Symbol.asyncIterator in Object(stream),
        streamConstructorName: stream?.constructor?.name,
        hasNext: typeof stream?.next === 'function',
        hasReturn: typeof stream?.return === 'function'
      }, '[COMPLETION] 📍 DIAGNOSTIC: Stream received from provider');

      // Process stream (now with confirmed DB ID if available)
      // Check if stream is an AsyncGenerator (from ProviderManager) or response object (from ChatCompletionService)
      if (Symbol.asyncIterator in Object(stream)) {
        // AsyncGenerator from ProviderManager
        await this.processProviderStream(context, stream as AsyncGenerator, savedAssistantMessageId, request.model);
      } else {
        // Legacy response object from ChatCompletionService
        await this.processStream(context, stream, savedAssistantMessageId);
      }

      const executionTime = Date.now() - startTime;

      if (typeof chatResponseTime !== 'undefined') {
        chatResponseTime.observe({ model: request.model }, executionTime / 1000);
      }

      context.logger.info({
        processingTime: executionTime,
        model: request.model
      }, '[COMPLETION] Completed successfully');

      return context;

    } catch (error: any) {
      const errorMessage = extractErrorMessage(error);
      const errorDuration = Date.now() - startTime;

      // Check for Gemini "too many states" schema complexity error
      // This happens when too many tools with complex schemas are sent
      const isSchemaComplexityError = errorMessage.includes('too many states for serving') ||
        errorMessage.includes('schema produces a constraint');

      if (isSchemaComplexityError && context.availableTools && context.availableTools.length > 20) {
        const originalToolCount = context.availableTools.length;
        // Reduce tools by 50% and retry (minimum 20 tools)
        const reducedToolCount = Math.max(20, Math.floor(originalToolCount / 2));

        context.logger.warn({
          originalToolCount,
          reducedToolCount,
          model: context.config.model,
          error: 'Gemini schema complexity limit hit'
        }, '[COMPLETION] ⚠️ GEMINI SCHEMA LIMIT: Reducing tools and retrying');

        // Reduce available tools (prioritize first N tools which should be most relevant)
        context.availableTools = context.availableTools.slice(0, reducedToolCount);

        // Store retry info to prevent infinite loops
        const retryCount = (context as any)._schemaRetryCount || 0;
        if (retryCount < 2) {
          (context as any)._schemaRetryCount = retryCount + 1;

          // Emit warning to client
          context.emit('warning', {
            code: 'TOOL_LIMIT_EXCEEDED',
            message: `Reduced available tools from ${originalToolCount} to ${reducedToolCount} due to model schema limits`,
            model: context.config.model
          });

          // Retry with reduced tools
          return this.execute(context);
        }
      }

      context.logger.error({
        error: errorMessage,
        stack: error.stack,
        processingTime: errorDuration
      }, '[COMPLETION] Failed');

      // 📊 LLM METRICS: Log error metrics for tracking and alerting
      try {
        const model = context.config.model;
        const providerType = this.detectProviderType(model);
        const sessionId = (context as any).sessionId || context.session?.id;

        const errorMetrics: LLMRequestMetrics = {
          userId: context.user.id,
          sessionId: sessionId,
          messageId: context.messageId,

          providerType: providerType,
          model: model,

          requestType: 'chat',
          source: 'chat',  // Differentiate from code mode requests
          streaming: true,
          temperature: context.config.temperature,
          maxTokens: context.config.maxTokens,

          latencyMs: errorDuration,
          totalDurationMs: errorDuration,

          status: error.code === 'TIMEOUT' ? 'timeout' : (error.code === 'RATE_LIMITED' ? 'rate_limited' : 'error'),
          errorCode: error.code || 'UNKNOWN',
          errorMessage: errorMessage,

          requestStartedAt: context.startTime,
          requestCompletedAt: new Date()
        };

        // Log error metrics asynchronously
        llmMetricsService.logRequest(errorMetrics).catch(err => {
          context.logger.warn({ error: err.message }, '[METRICS] Failed to log error metrics');
        });
      } catch (metricsErr: any) {
        context.logger.warn({ error: metricsErr.message }, '[METRICS] Failed to create error metrics');
      }

      const completionError = new Error(errorMessage);
      completionError.name = 'CompletionError';
      Object.assign(completionError, {
        code: error.code || ChatErrorCode.COMPLETION_FAILED,
        retryable: isRetryableError(error),
        stage: this.name,
        originalError: error
      });

      throw completionError;
    }
  }

  private async buildRequest(context: PipelineContext, messages: ChatMessage[]): Promise<any> {
    // Check for images from attachments
    const hasAttachmentImages = messages.some(msg =>
      msg.attachments?.some(att => att.mimeType?.startsWith('image/'))
    );

    // Check for image:// references in message content (from previously generated images)
    const hasImageReferences = messages.some(msg =>
      typeof msg.content === 'string' && msg.content.includes('image://')
    );

    const hasImages = hasAttachmentImages || hasImageReferences;

    // Resolve image:// references if target model is vision-capable
    // This enables cross-model image access - images generated by one model can be used by another
    let resolvedMessages = messages;
    if (hasImageReferences) {
      resolvedMessages = await this.resolveImageReferences(messages, context);
    }

    // Format messages (tool results will have parsing instructions prepended)
    let formattedMessages = resolvedMessages.map(msg => this.formatMessage(msg, context));

    // Use TaskAnalysisService for intelligent model routing
    // CRITICAL: Pass sliderConfig to enable slider-based model selection
    const taskAnalysisService = new TaskAnalysisService(context.logger);
    const taskAnalysis = await taskAnalysisService.analyzeTask({
      messages: formattedMessages,
      hasImages,
      tools: context.availableTools,
      sliderConfig: context.sliderConfig  // Pass slider for cost/quality tradeoff
    });

    // Determine model based on analysis OR use explicitly requested model
    // INTELLIGENT ROUTING PRIORITY (when ROUTE_SIMPLE_TO_OLLAMA=true):
    //   1. User explicitly requested model → use it
    //   2. TaskAnalysisService recommendation → use it (FREE Ollama for simple, Gemini for complex)
    //   3. Pipeline config model → fallback
    //   4. DEFAULT_MODEL → last resort (from centralized ModelConfigurationService)
    // Uses centralized ModelConfigurationService (DB → env var → fallback)
    const DEFAULT_MODEL = await ModelConfigurationService.getDefaultChatModel();
    if (!DEFAULT_MODEL || DEFAULT_MODEL === 'default') {
      throw new Error('No default model configured. Set chatModel in LLM Provider config or DEFAULT_CHAT_MODEL/DEFAULT_MODEL in environment.');
    }

    const intelligentRoutingEnabled = process.env.ROUTE_SIMPLE_TO_OLLAMA === 'true';
    let selectedModel: string | undefined;
    let modelSelectionReason: string;

    // If user explicitly requested a model, use it (unless it's just 'default')
    if (context.request.model && context.request.model !== 'default' && context.request.model !== 'model-router') {
      selectedModel = context.request.model;
      modelSelectionReason = `Using user-requested model: ${selectedModel}`;
    } else if (intelligentRoutingEnabled && taskAnalysis.suggestedModel) {
      // INTELLIGENT ROUTING: TaskAnalysis decides based on complexity
      // Simple queries → Ollama (FREE), Complex/tool queries → Gemini
      selectedModel = taskAnalysis.suggestedModel;
      modelSelectionReason = taskAnalysis.reasoning;

      context.logger.info({
        intelligentRouting: true,
        selectedModel,
        reason: modelSelectionReason,
        complexity: taskAnalysis.complexity,
        estimatedCost: taskAnalysis.estimatedCost
      }, '🧭 INTELLIGENT ROUTING: TaskAnalysis selected model');
    } else if (context.config.model && context.config.model !== 'default' && context.config.model !== 'model-router') {
      // Fallback to pipeline config model
      selectedModel = context.config.model;
      modelSelectionReason = `Using pipeline config model: ${selectedModel}`;
    } else {
      // Last resort: TaskAnalysisService recommendation (for backwards compatibility)
      selectedModel = taskAnalysis.suggestedModel;
      modelSelectionReason = taskAnalysis.reasoning;
    }

    // SAFETY: Ensure we always have a valid model - fallback to default if still undefined
    if (!selectedModel || selectedModel === 'default' || selectedModel === 'model-router') {
      context.logger.warn({
        originalModel: selectedModel,
        fallback: DEFAULT_MODEL
      }, '[COMPLETION] ⚠️ No valid model selected, using default');
      selectedModel = DEFAULT_MODEL;
      modelSelectionReason = `Fallback to default model: ${DEFAULT_MODEL}`;
    }

    context.logger.info({
      model: selectedModel,
      taskType: taskAnalysis.taskType,
      complexity: taskAnalysis.complexity,
      confidence: taskAnalysis.confidence,
      estimatedCost: taskAnalysis.estimatedCost,
      reason: modelSelectionReason,
      hasTools: context.availableTools?.length > 0,
      sliderPosition: context.sliderConfig?.position ?? 'not-set',
      sliderSource: context.sliderConfig?.source ?? 'default',
      sliderMode: context.sliderConfig
        ? (context.sliderConfig.position <= 40 ? 'ECONOMICAL' :
           context.sliderConfig.position > 60 ? 'PREMIUM' : 'BALANCED')
        : 'NO-SLIDER'
    }, '[COMPLETION] 🧠 Model routing decision (slider-aware)');

    const request: any = {
      model: selectedModel,
      messages: formattedMessages,
      temperature: context.config.temperature || 1.0,
      max_tokens: context.config.maxTokens || 8192, // Vertex AI max is 8192
      stream: true,
      stream_options: {
        include_usage: true // Request token usage stats in streaming mode
      },
      user: context.user.id
    };

    // Enable extended thinking/reasoning based on provider AND slider config
    const modelLower = selectedModel.toLowerCase();
    const isClaudeModel = modelLower.includes('claude');
    const isGeminiModel = modelLower.includes('gemini');
    const isOpenAIModel = modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('openai');
    const isOllamaModel = modelLower.includes('ollama') || modelLower.includes('llama') || modelLower.includes('mistral') || modelLower.includes('qwen') || modelLower.includes('deepseek');

    // Get slider-based thinking configuration
    const sliderConfig = context.sliderConfig;
    // User toggle overrides slider config when explicitly set
    // If enableExtendedThinking is explicitly false, disable thinking
    // If enableExtendedThinking is explicitly true, enable thinking (if model supports it)
    // If not set (undefined), fall back to slider config
    const userThinkingToggle = context.request.enableExtendedThinking;
    const enableThinking = userThinkingToggle !== undefined
      ? userThinkingToggle
      : (sliderConfig?.enableThinking ?? true);
    const thinkingBudget = sliderConfig?.maxThinkingBudget ?? 8000;

    context.logger.debug({
      sliderPosition: sliderConfig?.position,
      userThinkingToggle,
      enableThinking,
      thinkingBudget,
      source: userThinkingToggle !== undefined ? 'user_toggle' : sliderConfig?.source
    }, '[COMPLETION] Thinking config (user toggle overrides slider)');

    if (isClaudeModel && enableThinking) {
      // Claude: Native extended thinking API
      // CRITICAL: Check if this specific Claude model supports thinking
      // Only Sonnet 4+ and Opus models support extended thinking - NOT Haiku
      const modelSupportsThinking = ModelConfigurationService.supportsThinking(selectedModel);

      if (!modelSupportsThinking) {
        // GRACEFUL DEGRADATION: Model doesn't support thinking, but chat STILL WORKS
        // Just log a warning and continue without thinking
        context.logger.warn({
          model: selectedModel,
          reason: 'Model does not support extended thinking (Haiku, Nova Micro, etc.)',
          hint: 'Chat will work normally without thinking. Consider using Sonnet or Opus for thinking support.'
        }, '[COMPLETION] ⚠️ Model does not support thinking - continuing without it');
      } else {
        // CRITICAL: Claude requires ALL assistant messages to start with thinking blocks when thinking is enabled
        // The error "Expected 'thinking' or 'redacted_thinking', but found 'text'" means an assistant
        // message in history starts with 'text' content instead of a thinking block.
        //
        // We must disable thinking if ANY assistant message:
        // 1. Has tool_use/toolCalls without a thinking block
        // 2. Has content that doesn't start with a thinking block (starts with 'text' instead)
        // 3. Was generated by a different model that doesn't support thinking

        // Check raw messages for incompatible assistant messages
        const hasIncompatibleRawMessage = messages.some((msg: any) => {
          if (msg.role !== 'assistant') return false;

          // Check raw format: msg.toolCalls (OpenAI/internal format)
          const hasToolCallsProperty = msg.toolCalls && msg.toolCalls.length > 0;

          // If it has toolCalls property but no thinking content, it's incompatible
          if (hasToolCallsProperty) {
            const content = Array.isArray(msg.content) ? msg.content : [];
            const hasThinking = content.some((c: any) => c.type === 'thinking' || c.type === 'redacted_thinking');
            if (!hasThinking) return true;
          }

          // Check Claude format content
          const content = Array.isArray(msg.content) ? msg.content : [];
          if (content.length === 0) return false; // Empty content is ok

          // Check if first content block is NOT thinking
          const firstBlock = content[0];
          if (firstBlock && typeof firstBlock === 'object' && firstBlock.type) {
            // If first block is 'text' (not thinking), this message is incompatible
            if (firstBlock.type === 'text') {
              // Check if there's thinking elsewhere (shouldn't be, but check anyway)
              const hasThinking = content.some((c: any) => c.type === 'thinking' || c.type === 'redacted_thinking');
              if (!hasThinking) return true;
            }
            // If first block is tool_use without thinking, incompatible
            if (firstBlock.type === 'tool_use') {
              const hasThinking = content.some((c: any) => c.type === 'thinking' || c.type === 'redacted_thinking');
              if (!hasThinking) return true;
            }
          }

          return false;
        });

        // Check formatted messages for the same issues
        const hasIncompatibleFormattedMessage = formattedMessages.some((msg: any) => {
          if (msg.role !== 'assistant') return false;

          const content = Array.isArray(msg.content) ? msg.content : [];
          if (content.length === 0) return false;

          const firstBlock = content[0];
          if (firstBlock && typeof firstBlock === 'object' && firstBlock.type) {
            // First block is 'text' without any thinking blocks = incompatible
            if (firstBlock.type === 'text') {
              const hasThinking = content.some((c: any) => c.type === 'thinking' || c.type === 'redacted_thinking');
              if (!hasThinking) return true;
            }
            // First block is tool_use without thinking = incompatible
            if (firstBlock.type === 'tool_use') {
              const hasThinking = content.some((c: any) => c.type === 'thinking' || c.type === 'redacted_thinking');
              if (!hasThinking) return true;
            }
          }

          return false;
        });

        // Also check if there have been any tool results (indicating a tool call round happened)
        const hasToolResults = messages.some((msg: any) => msg.role === 'tool') ||
                              formattedMessages.some((msg: any) => msg.role === 'user' &&
                                Array.isArray(msg.content) &&
                                msg.content.some((c: any) => c.type === 'tool_result'));

        const shouldDisableThinking = hasIncompatibleRawMessage || hasIncompatibleFormattedMessage;

        if (shouldDisableThinking) {
          context.logger.warn({
            model: selectedModel,
            reason: 'Message history has assistant messages without required thinking blocks',
            rawCheck: hasIncompatibleRawMessage,
            formattedCheck: hasIncompatibleFormattedMessage,
            hasToolResults,
            hint: 'Claude requires all assistant messages to start with thinking blocks when thinking is enabled'
          }, '[COMPLETION] ⚠️ Disabling Claude thinking - incompatible message history');
        } else {
          request.thinking = {
            type: 'enabled',
            budget_tokens: thinkingBudget
          };
          context.logger.info({ model: selectedModel, budget: thinkingBudget }, '[COMPLETION] 🧠 Extended thinking enabled for Claude');
        }
      }
    } else if (isGeminiModel) {
      // CRITICAL DEBUG: Always log Gemini thinking check (even if enableThinking is false)
      console.log('\n' + '+'.repeat(60));
      console.log('🔍 GEMINI THINKING DECISION POINT');
      console.log('+'.repeat(60));
      console.log('Model:', selectedModel);
      console.log('modelLower:', modelLower);
      console.log('isGeminiModel:', isGeminiModel);
      console.log('enableThinking:', enableThinking);
      console.log('sliderPosition:', sliderConfig?.position);
      console.log('thinkingBudget:', thinkingBudget);
      console.log('+'.repeat(60) + '\n');

      if (!enableThinking) {
        context.logger.info({
          model: selectedModel,
          sliderPosition: sliderConfig?.position,
          enableThinking
        }, '[COMPLETION] ⚠️ Gemini thinking SKIPPED - slider position too low (needs > 40)');
      } else {
        // Gemini 2.5+ and Gemini 3 models support extended thinking via thinkingConfig
        // Flash models use 'minimal' thinking level for speed vs reasoning balance
        // Pro models use 'low'/'medium' for deeper reasoning
        // Gemini models that support thinking: 2.5-pro, 2.5-flash, gemini-exp, gemini-3.x
        // Support various naming conventions: gemini-3, gemini-3.0, gemini-3-pro, etc.
        const supportsThinking = modelLower.includes('2.5-pro') ||
                                 modelLower.includes('2.5-flash') ||
                                 modelLower.includes('gemini-exp') ||
                                 modelLower.includes('gemini-3') ||
                                 modelLower.includes('gemini-3.') ||
                                 modelLower.includes('3-pro') ||
                                 modelLower.includes('3.0-pro') ||
                                 modelLower.includes('3-flash') ||
                                 modelLower.includes('3.0-flash');

        context.logger.info({
          model: selectedModel,
          modelLower,
          isGeminiModel,
          supportsThinking,
          enableThinking
        }, '[COMPLETION] 🧠 Gemini thinking check');

        if (supportsThinking) {
          // Gemini 2.5 Pro: Uses unified 'thinking' parameter (same as Claude)
          // Translated to Gemini's thinking_budget internally
          request.thinking = {
            type: 'enabled',
            budget_tokens: thinkingBudget
          };
          // Also set reasoning_effort for additional compatibility
          const effort = thinkingBudget > 16000 ? 'high' : thinkingBudget > 8000 ? 'medium' : 'low';
          request.reasoning_effort = effort;
          context.logger.info({ model: selectedModel }, '[COMPLETION] 🧠 Thinking enabled for Gemini Pro (budget: 8000 tokens)');
        } else {
          context.logger.info({ model: selectedModel }, '[COMPLETION] Gemini model does not support extended thinking API');
        }
      }
    } else if (isOpenAIModel) {
      // OpenAI o-series models (o1, o3, o1-mini, o3-mini) have native reasoning with reasoning_effort parameter
      // Other OpenAI models (GPT-4, GPT-4o) don't have native thinking - use prompt-based tags
      const isOSeriesModel = modelLower.includes('o1') || modelLower.includes('o3');

      if (isOSeriesModel && enableThinking) {
        // Map slider thinking budget to OpenAI reasoning_effort (low, medium, high)
        const effort = thinkingBudget > 16000 ? 'high' : thinkingBudget > 8000 ? 'medium' : 'low';
        request.reasoning_effort = effort;
        context.logger.info({
          model: selectedModel,
          reasoning_effort: effort,
          thinkingBudget
        }, '[COMPLETION] 🧠 OpenAI o-series reasoning enabled with reasoning_effort');
      } else if (isOSeriesModel && !enableThinking) {
        context.logger.info({
          model: selectedModel,
          reason: 'Thinking disabled by slider'
        }, '[COMPLETION] ⏩ Skipping o-series reasoning (slider disabled)');
      } else {
        context.logger.info({ model: selectedModel }, '[COMPLETION] 🧠 Using prompt-based thinking for GPT model (no native API)');
      }
    } else if (isOllamaModel) {
      // Ollama: No native thinking API, rely on prompt-based <thinking> tags
      context.logger.info({ model: selectedModel }, '[COMPLETION] 🧠 Using prompt-based thinking for Ollama (no native API)');
    }

    // Store model selection reason for debugging
    context.modelSelectionReason = modelSelectionReason;

    // Add tools if available (not during forced final completion)
    if (context.availableTools && context.availableTools.length > 0 && !context.forceFinalCompletion) {
      // TIERED FUNCTION CALLING: Check if we should strip tools from this request
      // This saves ~2000+ tokens for pure chat messages that don't need tools
      let toolsToSend = context.availableTools;
      let tieredFCDecision = null;

      try {
        const tieredFCService = getTieredFunctionCallingService();
        if (tieredFCService) {
          // Get the user's message for analysis
          const lastUserMsg = messages.filter(m => m.role === 'user').pop();
          const messageContent = lastUserMsg?.content ?? '';

          tieredFCDecision = await tieredFCService.makeDecision(
            messageContent,
            context.availableTools,
            context.sliderConfig
          );

          // Strip tools if the service recommends it (pure chat mode)
          if (tieredFCDecision.stripTools) {
            context.logger.info({
              originalToolCount: context.availableTools.length,
              tier: tieredFCDecision.tier,
              reasoning: tieredFCDecision.reasoning,
              tokensSaved: '~2000+'
            }, '[COMPLETION] 🎯 TIERED FC: Stripping tools for pure chat (cost savings)');

            // Don't send tools at all - this is a pure chat request
            toolsToSend = [];
          } else {
            context.logger.debug({
              requiresTools: tieredFCDecision.requiresTools,
              tier: tieredFCDecision.tier,
              selectedModel: tieredFCDecision.selectedModel || '(default)'
            }, '[COMPLETION] 🎯 TIERED FC: Tools required, keeping in request');
          }
        }
      } catch (fcError: any) {
        context.logger.warn({ error: fcError.message }, '[COMPLETION] ⚠️ TIERED FC: Error in decision, proceeding with tools');
      }

      // Skip adding tools if they were stripped
      if (toolsToSend.length === 0) {
        context.logger.info({
          reason: tieredFCDecision?.reasoning || 'Tool stripping enabled',
          tier: tieredFCDecision?.tier || 'unknown'
        }, '[COMPLETION] 📦 No tools sent (pure chat mode)');
      } else {
        // CRITICAL: Azure OpenAI has a hard limit of 128 tools per request
        // If we exceed this, the request will fail with "tools array too long"
        // Use 127 to be extra safe, but this should rarely trigger since MCP stage limits to 125
        const AZURE_OPENAI_TOOL_LIMIT = 127;

        if (toolsToSend.length > AZURE_OPENAI_TOOL_LIMIT) {
          // Take the first 127 tools (MCP stage already sorted by relevance)
          toolsToSend = toolsToSend.slice(0, AZURE_OPENAI_TOOL_LIMIT);

          context.logger.warn({
            originalToolCount: context.availableTools.length,
            limitedToolCount: toolsToSend.length,
            limit: AZURE_OPENAI_TOOL_LIMIT,
            droppedTools: context.availableTools.length - AZURE_OPENAI_TOOL_LIMIT
          }, '[COMPLETION] ⚠️ AZURE LIMIT: Truncating tools to fit Azure OpenAI 128 tool limit');
        }

        request.tools = toolsToSend;

        // CRITICAL: Force background job tool when audit patterns detected
        // This ensures AI actually executes the tool instead of just saying it will
        // Check ALL user messages (not just latest) because tool results may be in between
        const allUserMessages = messages.filter(m => m.role === 'user').map(m => m.content?.toLowerCase() || '').join(' ');
        const hasBackgroundJobTool = toolsToSend.some(t => t.function?.name === 'submit_background_work');

        const auditPatterns = [
          'analyze each',
          'analyze all',
          'audit',
          'comprehensive',
          'security compliance',
          'subscriptions individually',
          'deep analysis',
          'per subscription',
          'subscription-by-subscription',
          'iterate over',
          'check each'
        ];

        const hasAuditPattern = auditPatterns.some(pattern => allUserMessages.includes(pattern));
        const mentionsMultipleResources = (allUserMessages.match(/\b\d{2,}\b/g) || []).length > 0; // e.g., "194 subscriptions"
        const shouldForceBackgroundJob = hasAuditPattern && mentionsMultipleResources && hasBackgroundJobTool;

        // DEBUG: Log pattern detection results
        context.logger.info({
          userMessageLength: allUserMessages.length,
          userMessagePreview: allUserMessages.substring(0, 200),
          hasAuditPattern,
          mentionsMultipleResources,
          hasBackgroundJobTool,
          shouldForceBackgroundJob,
          matchedPatterns: auditPatterns.filter(p => allUserMessages.includes(p))
        }, '[COMPLETION] 🔍 Pattern detection debug');

        if (shouldForceBackgroundJob) {
          // Force the AI to use submit_background_work tool
          request.tool_choice = {
            type: 'function',
            function: { name: 'submit_background_work' }
          };

          context.logger.info({
            patterns: auditPatterns.filter(p => allUserMessages.includes(p)),
            hasBackgroundJobTool,
            forcedTool: 'submit_background_work'
          }, '[COMPLETION] 🎯 FORCING background job tool for comprehensive audit request');
        } else {
          request.tool_choice = 'auto';
        }

        context.logger.info({
          toolCount: toolsToSend.length,
          originalCount: context.availableTools.length,
          wasLimited: context.availableTools.length > AZURE_OPENAI_TOOL_LIMIT,
          tool_choice: typeof request.tool_choice === 'string' ? request.tool_choice : 'forced'
        }, '[COMPLETION] Including tools in request (Azure limit enforced)');
      } // end else (tools not stripped)
    } // end if (context.availableTools)

    return request;
  }

  private formatMessage(msg: ChatMessage, context: PipelineContext): any {
    // Tool message - just pass the raw content, LLM can read JSON
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId
      };
    }

    // Assistant message with tool calls
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.toolCalls
      };
    }

    // User message with attachments (vision + document support)
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      // DEBUG: Log attachment structure
      context.logger.info({
        messageId: msg.id,
        attachmentCount: msg.attachments.length,
        attachmentStructure: msg.attachments.map(att => ({
          id: att.id,
          originalName: att.originalName,
          mimeType: att.mimeType,
          size: att.size,
          hasBase64Data: !!att.base64Data,
          base64Length: att.base64Data?.length,
          allKeys: Object.keys(att)
        }))
      }, '[COMPLETION] 🔍 DEBUG: Attachment structure in formatMessage');

      const images = msg.attachments.filter(att => att.mimeType?.startsWith('image/'));
      const textFiles = msg.attachments.filter(att =>
        att.mimeType?.startsWith('text/') ||
        att.mimeType === 'application/json'
      );

      // Handle images
      if (images.length > 0) {
        const contentArray: any[] = [];

        if (msg.content) {
          contentArray.push({ type: 'text', text: msg.content });
        }

        // Detect provider to use correct image format
        const selectedModel = context.config.model?.toLowerCase() || '';
        const isClaudeModel = selectedModel.includes('claude') || selectedModel.includes('anthropic');

        for (const img of images) {
          if (img.base64Data) {
            if (isClaudeModel) {
              // Anthropic format: type='image' with source object
              contentArray.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: img.mimeType,
                  data: img.base64Data
                }
              });
            } else {
              // OpenAI format: type='image_url' with image_url object
              contentArray.push({
                type: 'image_url',
                image_url: {
                  url: `data:${img.mimeType};base64,${img.base64Data}`,
                  detail: 'auto'
                }
              });
            }
          }
        }

        return { role: 'user', content: contentArray };
      }

      // Handle text files - decode base64 and include in message content
      if (textFiles.length > 0) {
        let textContent = msg.content || '';

        for (const file of textFiles) {
          if (file.base64Data) {
            try {
              // Decode base64 to get actual text content
              const decodedText = Buffer.from(file.base64Data, 'base64').toString('utf-8');

              // Add file content to message with clear labeling
              textContent += `\n\n--- FILE: ${file.originalName} (${file.mimeType}) ---\n${decodedText}\n--- END FILE ---`;

              context.logger.info({
                fileName: file.originalName,
                mimeType: file.mimeType,
                originalLength: file.base64Data.length,
                decodedLength: decodedText.length
              }, '[COMPLETION] Decoded text file for LLM context');
            } catch (error) {
              context.logger.warn({
                fileName: file.originalName,
                error: error.message
              }, '[COMPLETION] Failed to decode text file attachment');
            }
          }
        }

        return { role: 'user', content: textContent };
      }
    }

    // CRITICAL FIX: Strip base64 images from assistant messages to prevent token explosion
    // Base64 images can be 100KB-500KB which translates to hundreds of thousands of tokens
    // We keep the image in the database for UI display, but strip it from LLM context
    let content = msg.content || '';
    if (msg.role === 'assistant' && content.includes('data:image')) {
      // Replace base64 image markdown with a placeholder
      // Pattern: ![alt text](data:image/[type];base64,[huge base64 string])
      const base64ImageRegex = /!\[([^\]]*)\]\(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+\)/g;
      const matches = content.match(base64ImageRegex);

      if (matches && matches.length > 0) {
        context.logger.info({
          messageId: msg.id,
          imageCount: matches.length,
          originalLength: content.length
        }, '[COMPLETION] Stripping base64 images from assistant message to prevent token explosion');

        // Replace each base64 image with a placeholder
        content = content.replace(
          base64ImageRegex,
          '[Image generated - displayed to user]'
        );

        context.logger.info({
          messageId: msg.id,
          strippedLength: content.length,
          savedTokens: Math.floor((msg.content.length - content.length) / 4) // Rough token estimate
        }, '[COMPLETION] Base64 images stripped successfully');
      }
    }

    // Standard message
    return {
      role: msg.role,
      content: content
    };
  }

  /**
   * Helper to emit COT step events for Chain of Thought UI display
   */
  private emitCOTStep(
    context: PipelineContext,
    step: {
      id: string;
      type: 'thinking' | 'tool_call' | 'rag_lookup' | 'fetch' | 'memory' | 'reasoning';
      description: string;
      status: 'pending' | 'in_progress' | 'completed' | 'error';
      startTime?: number;
      endTime?: number;
      request?: any;
      response?: any;
      error?: string;
    }
  ): void {
    // COT: Always emit cot_step events for Chain of Thought visualization
    // These should NOT be blocked by suppressStreaming as they're user-facing UI updates
    context.logger.info({
      messageId: context.messageId,
      stepId: step.id,
      stepType: step.type,
      stepStatus: step.status,
      suppressStreaming: context.config.suppressStreaming
    }, '🔗 [COT] Emitting cot_step event');

    context.emit('cot_step', { step });
  }

  /**
   * Process AsyncGenerator stream from ProviderManager
   */
  private async processProviderStream(context: PipelineContext, stream: AsyncGenerator<any>, savedMessageId?: string | null, selectedModel?: string): Promise<void> {
    let currentMessage = '';
    let currentThinking = '';  // Track accumulated thinking content
    let currentToolCalls: any[] = [];
    let usage: any = null;
    let actualModel: string | null = null;

    const streamingStartTime = Date.now();

    // TTFT (Time to First Token) tracking
    const startTime = Date.now();
    let timeToFirstToken: number | null = null;
    let firstTokenReceived = false;

    // COT step tracking
    let thinkingStepId: string | null = null;
    let toolStepIds: Map<number, string> = new Map();

    // DEBUG: Chunk counter for verbose logging
    let chunkCount = 0;

    // INCREMENTAL PERSISTENCE: Track last save time and buffer
    let lastPersistTime = Date.now();
    const PERSIST_INTERVAL_MS = 1000; // Persist every 1 second during streaming
    const chatStorage = (context as any).chatStorage;
    const sessionId = (context as any).sessionId || context.session?.id;

    // Start streaming
    if (!context.config.suppressStreaming) {
      context.logger.info({
        messageId: context.messageId,
        savedMessageId,
        suppressStreaming: false,
        streamType: 'AsyncGenerator (ProviderManager)'
      }, '🔵 [MCP-STREAM-DEBUG] [PROVIDER] Emitting completion_start event');

      context.emit('completion_start', {
        model: selectedModel || context.config.model,  // Use the actually selected model
        messageId: savedMessageId || `assistant_${context.messageId}`,
        source: savedMessageId ? 'database' : 'optimistic'
      });

      context.logger.info({
        messageId: context.messageId
      }, '🔵 [MCP-STREAM-DEBUG] [PROVIDER] completion_start event emitted successfully');

      // COT: Emit initial thinking step
      thinkingStepId = `cot_thinking_${Date.now()}`;
      this.emitCOTStep(context, {
        id: thinkingStepId,
        type: 'thinking',
        description: 'Processing request',
        status: 'in_progress',
        startTime: Date.now()
      });
    } else {
      context.logger.warn({
        messageId: context.messageId,
        suppressStreaming: true,
        streamType: 'AsyncGenerator (ProviderManager)'
      }, '🔵 [MCP-STREAM-DEBUG] [PROVIDER] Streaming suppressed - completion_start NOT emitted');
    }

    try {
      // Iterate through async generator
      for await (const chunk of stream) {
        // Handle chunk from ProviderManager - it returns OpenAI-compatible format
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Increment chunk counter and log raw structure for first 5 chunks
        chunkCount++;
        if (chunkCount <= 5) {
          context.logger.info({
            chunkNum: chunkCount,
            deltaKeys: Object.keys(delta),
            chunkKeys: Object.keys(chunk),
            choicesKeys: chunk.choices?.[0] ? Object.keys(chunk.choices[0]) : [],
            deltaRaw: JSON.stringify(delta).substring(0, 500),
            chunkRaw: JSON.stringify(chunk).substring(0, 500)
          }, '[PROVIDER-STREAM] 🔍 RAW CHUNK STRUCTURE');
        }

        // Check for thinking/reasoning content in the delta
        const thinkingContent = delta.thinking || delta.reasoning || delta.thought ||
                                delta.thinking_content || chunk.thinking_content ||
                                chunk.reasoning_content;

        if (thinkingContent) {
          currentThinking += thinkingContent;  // Accumulate thinking content

          context.logger.info({
            thinkingLength: thinkingContent.length,
            thinkingPreview: thinkingContent.substring(0, 100)
          }, '[PROVIDER-STREAM] 🧠 THINKING CONTENT FOUND');

          // Emit thinking event
          context.emit('thinking', {
            content: thinkingContent,
            accumulated: currentThinking
          });
        }

        // Extract model info
        if (chunk.model && !actualModel) {
          actualModel = chunk.model;
        }

        // Handle content
        if (delta.content) {
          // Capture Time to First Token (TTFT) - KPI metric
          if (!firstTokenReceived) {
            timeToFirstToken = Date.now() - startTime;
            firstTokenReceived = true;
            context.logger.debug({ ttftMs: timeToFirstToken }, '[METRICS] Time to First Token captured');
          }

          currentMessage += delta.content;

          if (!context.config.suppressStreaming) {
            context.logger.info({
              messageId: context.messageId,
              contentLength: delta.content.length,
              contentPreview: delta.content.substring(0, 50)
            }, '🔵 [MCP-STREAM-DEBUG] [PROVIDER] Emitting stream chunk');

            context.emit('stream', {
              content: delta.content,
              delta: true
            });

            context.logger.debug({ content: delta.content.substring(0, 50) }, '[STREAM] Stream chunk emitted successfully');
          }

          // INCREMENTAL PERSISTENCE: Save to DB every second while streaming
          const now = Date.now();
          if (savedMessageId && chatStorage && sessionId && (now - lastPersistTime) >= PERSIST_INTERVAL_MS) {
            try {
              await chatStorage.updateMessage(savedMessageId, {
                content: currentMessage,
                model: actualModel || context.config.model,
                timestamp: new Date()
              });

              context.logger.debug({
                messageId: savedMessageId,
                contentLength: currentMessage.length,
                elapsedMs: now - lastPersistTime
              }, '[STREAM] 💾 Incremental persist - content saved to DB');

              lastPersistTime = now;
            } catch (error) {
              // Don't fail streaming if incremental save fails
              context.logger.warn({
                error: error.message,
                messageId: savedMessageId
              }, '[STREAM] ⚠️  Incremental persist failed, continuing stream');
            }
          }
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index || 0;

            if (!currentToolCalls[index]) {
              currentToolCalls[index] = {
                id: toolCall.id || `call_${index}`,
                type: 'function',
                function: {
                  name: toolCall.function?.name || '',
                  arguments: toolCall.function?.arguments || ''
                }
              };

              // CRITICAL: Preserve thought_signature for Gemini 3 models
              // Required for multi-turn function calling conversations
              if (toolCall.thought_signature) {
                currentToolCalls[index].thought_signature = toolCall.thought_signature;
                context.logger.debug({
                  toolIndex: index,
                  toolName: toolCall.function?.name,
                  hasThoughtSignature: true
                }, '[COMPLETION] 🧠 Preserved thought_signature from Gemini response');
              }

              // COT: Emit tool call step when first detected
              const toolStepId = `cot_tool_${index}_${Date.now()}`;
              toolStepIds.set(index, toolStepId);
              this.emitCOTStep(context, {
                id: toolStepId,
                type: 'tool_call',
                description: `Calling tool: ${toolCall.function?.name || 'unknown'}`,
                status: 'in_progress',
                startTime: Date.now(),
                request: { name: toolCall.function?.name }
              });
            } else {
              if (toolCall.function?.name) {
                currentToolCalls[index].function.name += toolCall.function.name;
                // Update COT step description with full tool name
                const toolStepId = toolStepIds.get(index);
                if (toolStepId) {
                  this.emitCOTStep(context, {
                    id: toolStepId,
                    type: 'tool_call',
                    description: `Calling tool: ${currentToolCalls[index].function.name}`,
                    status: 'in_progress',
                    request: { name: currentToolCalls[index].function.name }
                  });
                }
              }
              if (toolCall.function?.arguments) {
                currentToolCalls[index].function.arguments += toolCall.function.arguments;
              }
              // CRITICAL: Also preserve thought_signature if it comes in a later chunk
              if (toolCall.thought_signature && !currentToolCalls[index].thought_signature) {
                currentToolCalls[index].thought_signature = toolCall.thought_signature;
              }
            }
          }
        }

        // Extract usage if present
        if (chunk.usage) {
          usage = {
            prompt_tokens: chunk.usage.prompt_tokens,
            completion_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens
          };
        }
      }

      // Filter out undefined tool calls (sparse array issue)
      const validToolCalls = currentToolCalls.filter(tc => tc !== undefined && tc !== null);

      // COT: Mark thinking step as completed
      if (thinkingStepId) {
        this.emitCOTStep(context, {
          id: thinkingStepId,
          type: 'thinking',
          description: 'Processing complete',
          status: 'completed',
          endTime: Date.now()
        });
      }

      // COT: Mark all tool steps as completed
      for (const [index, stepId] of toolStepIds.entries()) {
        const toolCall = currentToolCalls[index];
        if (toolCall) {
          this.emitCOTStep(context, {
            id: stepId,
            type: 'tool_call',
            description: `Tool: ${toolCall.function?.name || 'unknown'}`,
            status: 'completed',
            endTime: Date.now(),
            request: { name: toolCall.function?.name, arguments: toolCall.function?.arguments }
          });
        }
      }

      // Finalize response with TTFT metric and thinking content
      await this.finalizeResponse(context, currentMessage, validToolCalls, usage, actualModel, savedMessageId, timeToFirstToken, currentThinking);

    } catch (error) {
      context.logger.error({ error }, '[COMPLETION] Stream processing error');
      throw error;
    }
  }

  private async processStream(context: PipelineContext, response: any, savedMessageId?: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      let currentMessage = '';
      let currentThinking = '';
      let currentToolCalls: any[] = [];
      let usage: any = null;
      let actualModel: string | null = null;

      // Thinking extraction state
      let insideThinkingTag = false;
      let thinkingBuffer = '';
      let thinkingStartTime: number | null = null;
      let thinkingTokenCount = 0;

      // Sentence buffer for reasoning pattern detection (GPT models are chatty)
      // Accumulates content until sentence boundary for better pattern matching
      let reasoningBuffer = '';
      let inReasoningMode = false;  // Track if we're in a reasoning sequence

      // LIVE TOKEN TRACKING - Track all tokens during streaming
      const streamingStartTime = Date.now();
      let totalCharactersProcessed = 0;
      let lastTokenEmitTime = Date.now();
      const TOKEN_UPDATE_INTERVAL_MS = 500; // Emit token updates every 500ms

      // TTFT TRACKING - Time to First Token
      let timeToFirstToken: number | null = null;
      let firstTokenReceived = false;

      // DEBUG: Chunk counter for verbose logging
      let chunkCount = 0;

      // INCREMENTAL PERSISTENCE: Track last save time
      let lastPersistTime = Date.now();
      const PERSIST_INTERVAL_MS = 1000; // Persist every 1 second during streaming
      const chatStorage = (context as any).chatStorage;
      const sessionId = (context as any).sessionId || context.session?.id;

      // Start streaming
      if (!context.config.suppressStreaming) {
        context.logger.info({
          messageId: context.messageId,
          savedMessageId,
          suppressStreaming: false
        }, '🔵 [MCP-STREAM-DEBUG] Emitting completion_start event');

        context.emit('completion_start', {
          model: context.config.model,  // Legacy path uses config model
          messageId: savedMessageId || `assistant_${context.messageId}`,  // Use DB ID if available
          source: savedMessageId ? 'database' : 'optimistic'
        });
      } else {
        context.logger.warn({
          messageId: context.messageId,
          suppressStreaming: true
        }, '🔵 [MCP-STREAM-DEBUG] Streaming suppressed - completion_start NOT emitted');
      }

      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            // Flush any remaining reasoning buffer as regular content
            if (reasoningBuffer.length > 0) {
              currentMessage += reasoningBuffer;
              reasoningBuffer = '';
            }

            // LIVE TOKEN TRACKING - Emit final metrics with actual usage data
            const finalElapsedMs = Date.now() - streamingStartTime;
            const finalTokens = usage?.total_tokens || Math.ceil(totalCharactersProcessed / 4);
            const finalTokensPerSecond = finalElapsedMs > 0 ? (finalTokens / finalElapsedMs) * 1000 : 0;

            // Emit final token metrics as separate event (not thinking)
            context.emit('token_metrics', {
              tokens: finalTokens,
              elapsedMs: finalElapsedMs,
              tokensPerSecond: finalTokensPerSecond,
              actualUsage: usage, // Include actual provider usage data if available
              final: true
            });

            this.finalizeResponse(context, currentMessage, currentToolCalls, usage, actualModel, savedMessageId, timeToFirstToken, currentThinking)
              .then(() => resolve())
              .catch(err => reject(err));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (!actualModel && parsed.model) {
              actualModel = parsed.model;
            }

            if (parsed.usage) {
              usage = parsed.usage;
            }

            if (!delta) continue;

            // Increment chunk counter for debug logging
            chunkCount++;

            // Thinking content - handle multiple provider formats
            // Claude: delta.thinking
            // Gemini: delta.reasoning, delta.thought, parsed.thinking_content
            // Check all variants for compatibility
            const thinkingContent = delta.thinking || delta.reasoning || delta.thought ||
                                    delta.thinking_content || parsed.thinking_content ||
                                    parsed.reasoning_content;

            // DEBUG: Log raw delta/parsed structure for first 5 chunks (VERBOSE)
            if (chunkCount <= 5) {
              context.logger.info({
                chunkNum: chunkCount,
                deltaKeys: Object.keys(delta),
                parsedKeys: Object.keys(parsed),
                choicesKeys: parsed.choices?.[0] ? Object.keys(parsed.choices[0]) : [],
                deltaRaw: JSON.stringify(delta).substring(0, 500),
                parsedRaw: JSON.stringify(parsed).substring(0, 500)
              }, '[COMPLETION] 🔍 RAW CHUNK STRUCTURE');
            }

            // DEBUG: Log thinking content when found
            if (thinkingContent) {
              context.logger.info({
                deltaKeys: Object.keys(delta),
                hasThinking: !!delta.thinking,
                hasReasoning: !!delta.reasoning,
                hasThought: !!delta.thought,
                thinkingContentLength: thinkingContent.length,
                thinkingPreview: thinkingContent.substring(0, 100)
              }, '[COMPLETION] 🧠 THINKING CONTENT FOUND');
            }

            if (thinkingContent) {
              currentThinking += thinkingContent;
              context.emit('thinking', {
                content: thinkingContent,
                accumulated: currentThinking
              });
              context.logger.info({
                thinkingLength: thinkingContent.length,
                totalAccumulated: currentThinking.length
              }, '[COMPLETION] 🧠 THINKING EMITTED');
            }

            // Regular content - extract <thinking> tags in real-time
            if (delta.content) {
              // Capture Time to First Token (TTFT) - KPI metric
              if (!firstTokenReceived) {
                timeToFirstToken = Date.now() - streamingStartTime;
                firstTokenReceived = true;
                context.logger.debug({ ttftMs: timeToFirstToken }, '[METRICS] Time to First Token captured');
              }

              let contentToProcess = delta.content;
              let contentToStream = '';

              // Track total characters for token estimation
              totalCharactersProcessed += contentToProcess.length;

              // 🧠 GPT/Ollama REASONING DETECTION: Route reasoning tokens to thinking animation
              // Uses sentence buffering for better pattern matching (chunks are often too small)
              const reasoningPatterns = [
                // Action patterns (tool use planning)
                /I'll\s+(retrieve|get|fetch|run|execute|check|query|list|pull|collect|gather|search|find|look|analyze|examine|investigate)/i,
                /I will\s+(now\s+)?(run|execute|check|query|list|pull|collect|gather|retrieve|search|find|look|analyze|examine|investigate)/i,
                /Let me\s+(retrieve|get|fetch|run|execute|check|query|list|pull|collect|gather|search|find|look|analyze|examine|investigate)/i,
                /I need to\s+(retrieve|get|fetch|run|execute|check|query|list|pull|collect|gather|search|find|look|analyze|examine|investigate)/i,
                /I should\s+(retrieve|get|fetch|run|execute|check|query|list|pull|collect|gather|search|find|look|analyze|examine|investigate)/i,

                // Process patterns
                /Proceeding\s+to\s+(query|run|execute|check|list|pull|collect|gather|search|find|look)/i,
                /Starting\s+(by|with|to)\s+(query|run|execute|check|list|pull|collect|gather|search|find|look)/i,
                /First,?\s+(I'll|let me|I will|I need to|I should)/i,
                /Next,?\s+(I'll|let me|I will|I need to|I should)/i,
                /Now\s+(I'll|let me|I will|I need to|I should)/i,

                // Tool-specific patterns
                /Querying\s+(Azure|AWS|for|now|the|to)/i,
                /Running\s+(the\s+)?(subscription|resource|group|queries|lookups|commands|analysis|search)/i,
                /Fetching\s+(subscription|resource|data|information|details)/i,
                /Pulling\s+(subscription|resource|data|information|from)/i,
                /Executing\s+(lookups|queries|request|command|search)/i,
                /Looking\s+up\s+(your|default|subscription|the|current)/i,
                /Gathering\s+(details|data|information)/i,
                /Searching\s+(for|through|in)/i,
                /Finding\s+(the|your|all)/i,
                /Analyzing\s+(the|your|current)/i,
                /Examining\s+(the|your|current)/i,
                /Investigating\s+(the|your|current)/i,

                // Status patterns
                /About\s+to\s+(run|execute|call|query|search|analyze)/i,
                /Getting\s+ready\s+to/i,
                /Preparing\s+to\s+(run|execute|call|query|search|analyze)/i,

                // Transition patterns
                /Thank\s+you.*running/i,
                /One\s+moment.*while/i,
                /Please\s+wait.*while/i,
                /Hold\s+on.*while/i,
                /Almost\s+(there|done|ready)/i,
                /Here\s+(we\s+)?go.*querying/i,
                /All\s+set.*running/i,
                /Stand\s+by.*fetching/i,

                // Planning patterns
                /To\s+(answer|help|solve|find|get)\s+(your|this|that)/i,
                /In\s+order\s+to\s+(answer|help|solve|find|get)/i,
                /My\s+(approach|plan|strategy)\s+(is|will be)/i,
                /The\s+(plan|approach|strategy)\s+(is|will be)/i,

                // Generic reasoning patterns
                /Based\s+on\s+(this|that|your)/i,
                /Given\s+(that|this|your)/i,
                /Since\s+(you|this|that)/i,
                /Looking\s+at\s+(this|that|your)/i,
                /Considering\s+(this|that|your)/i,
                /Taking\s+into\s+account/i,

                // Continuation patterns (when already in reasoning mode)
                /^(Then|After that|Once|Finally|Additionally|Also|Furthermore)/i,
                /I('ll| will) (then|next|also|additionally)/i
              ];

              // Sentence-ending detection patterns (to flush the buffer)
              const sentenceEndPattern = /[.!?]\s*$|\n\n|\n(?=[A-Z])/;
              const resultIndicatorPattern = /^(Here|Based on|The results?|I found|Found|Results?:|Output:)/i;

              // Add current chunk to reasoning buffer
              reasoningBuffer += contentToProcess;

              // Check if buffer contains a sentence end or result indicator
              const hasSentenceEnd = sentenceEndPattern.test(reasoningBuffer);
              const hasResultIndicator = resultIndicatorPattern.test(reasoningBuffer.trim());

              // If we hit a result indicator, exit reasoning mode and flush buffer as content
              if (hasResultIndicator && inReasoningMode) {
                inReasoningMode = false;
                // Flush buffer as regular content
                contentToProcess = reasoningBuffer;
                reasoningBuffer = '';
              } else if (hasSentenceEnd || reasoningBuffer.length > 200) {
                // Check buffer for reasoning patterns
                const bufferHasReasoning = reasoningPatterns.some(pattern => pattern.test(reasoningBuffer.trim()));

                if (bufferHasReasoning || inReasoningMode) {
                  // Enter/stay in reasoning mode
                  inReasoningMode = true;

                  // Route buffer to thinking
                  currentThinking += reasoningBuffer;
                  const elapsed = thinkingStartTime ? Date.now() - thinkingStartTime : Date.now() - streamingStartTime;
                  const tokens = Math.ceil(reasoningBuffer.length / 4);
                  thinkingTokenCount += tokens;
                  const tokensPerSecond = elapsed > 0 ? (thinkingTokenCount / elapsed) * 1000 : 0;

                  context.emit('thinking', {
                    content: reasoningBuffer,
                    accumulated: currentThinking,
                    tokens: thinkingTokenCount,
                    elapsedMs: elapsed,
                    tokensPerSecond: tokensPerSecond
                  });

                  reasoningBuffer = '';
                  // Skip further processing of this content
                  continue;
                } else {
                  // Exit reasoning mode if we were in it
                  inReasoningMode = false;
                  // Use buffered content for regular processing
                  contentToProcess = reasoningBuffer;
                  reasoningBuffer = '';
                }
              } else {
                // Still buffering - wait for more content
                continue;
              }

              // Process character by character to handle thinking tags
              for (let i = 0; i < contentToProcess.length; i++) {
                const char = contentToProcess[i];

                // Check for opening <thinking> tag
                if (!insideThinkingTag && contentToProcess.slice(i).startsWith('<thinking>')) {
                  insideThinkingTag = true;
                  thinkingBuffer = '';
                  thinkingStartTime = Date.now();
                  i += '<thinking>'.length - 1; // Skip the tag
                  continue;
                }

                // Check for closing </thinking> tag
                if (insideThinkingTag && contentToProcess.slice(i).startsWith('</thinking>')) {
                  insideThinkingTag = false;
                  currentThinking += thinkingBuffer;

                  // Emit complete thinking block with metrics
                  const elapsed = thinkingStartTime ? Date.now() - thinkingStartTime : 0;
                  // Rough token estimate: ~4 chars per token
                  const tokens = Math.ceil(thinkingBuffer.length / 4);
                  thinkingTokenCount += tokens;
                  const tokensPerSecond = elapsed > 0 ? (thinkingTokenCount / elapsed) * 1000 : 0;

                  context.emit('thinking', {
                    content: thinkingBuffer,
                    accumulated: currentThinking,
                    tokens: thinkingTokenCount,
                    elapsedMs: elapsed,
                    tokensPerSecond: tokensPerSecond
                  });

                  thinkingBuffer = '';
                  i += '</thinking>'.length - 1; // Skip the tag
                  continue;
                }

                // Add character to appropriate buffer
                if (insideThinkingTag) {
                  thinkingBuffer += char;

                  // Emit thinking updates every ~50 characters for real-time feel
                  if (thinkingBuffer.length % 50 === 0) {
                    const elapsed = thinkingStartTime ? Date.now() - thinkingStartTime : 0;
                    const tokens = Math.ceil(thinkingBuffer.length / 4);
                    const tokensPerSecond = elapsed > 0 ? (tokens / elapsed) * 1000 : 0;

                    context.emit('thinking', {
                      content: thinkingBuffer.slice(-50), // Last 50 chars
                      accumulated: currentThinking + thinkingBuffer,
                      tokens: thinkingTokenCount + tokens,
                      elapsedMs: elapsed,
                      tokensPerSecond: tokensPerSecond
                    });
                  }
                } else {
                  contentToStream += char;
                }
              }

              // Add non-thinking content to message
              currentMessage += contentToStream;

              // Only stream content that's not inside thinking tags
              if (contentToStream && !context.config.suppressStreaming) {
                context.logger.debug({
                  messageId: context.messageId,
                  contentLength: contentToStream.length,
                  contentPreview: contentToStream.substring(0, 50)
                }, '🔵 [MCP-STREAM-DEBUG] Emitting stream event with content');

                context.emit('stream', {
                  type: 'content',
                  content: contentToStream,
                  timestamp: new Date().toISOString()
                } as StreamDelta);
              }

              // INCREMENTAL PERSISTENCE: Save to DB every second while streaming
              const now = Date.now();
              if (savedMessageId && chatStorage && sessionId && (now - lastPersistTime) >= PERSIST_INTERVAL_MS) {
                // Use async IIFE to avoid blocking the stream
                (async () => {
                  try {
                    await chatStorage.updateMessage(savedMessageId, {
                      content: currentMessage,
                      model: actualModel || context.config.model,
                      timestamp: new Date()
                    });

                    context.logger.debug({
                      messageId: savedMessageId,
                      contentLength: currentMessage.length,
                      elapsedMs: now - lastPersistTime
                    }, '[STREAM] 💾 Incremental persist - content saved to DB');

                    lastPersistTime = now;
                  } catch (error) {
                    // Don't fail streaming if incremental save fails
                    context.logger.warn({
                      error: error.message,
                      messageId: savedMessageId
                    }, '[STREAM] ⚠️  Incremental persist failed, continuing stream');
                  }
                })();
              }
            }

            // LIVE TOKEN TRACKING - Emit periodic updates during streaming (moved outside content block)
            const now = Date.now();
            if (now - lastTokenEmitTime >= TOKEN_UPDATE_INTERVAL_MS) {
              const elapsedMs = now - streamingStartTime;
              // Rough token estimate: ~4 chars per token (will be replaced with actual usage at end)
              const estimatedTokens = Math.ceil(totalCharactersProcessed / 4);
              const tokensPerSecond = elapsedMs > 0 ? (estimatedTokens / elapsedMs) * 1000 : 0;

              // Emit token metrics as separate event (not thinking)
              context.emit('token_metrics', {
                tokens: estimatedTokens,
                elapsedMs: elapsedMs,
                tokensPerSecond: tokensPerSecond
              });

              lastTokenEmitTime = now;
            }

            // Tool calls
            if (delta.tool_calls) {
              this.processToolCallDeltas(delta.tool_calls, currentToolCalls);
              context.emit('tool_call_delta', {
                toolCalls: delta.tool_calls
              });
            }

          } catch (error: any) {
            context.logger.warn({
              error: error.message,
              line: data.substring(0, 100)
            }, '[COMPLETION] Failed to parse stream line');
          }
        }
      });

      response.data.on('error', (error: any) => {
        context.logger.error({ error: error.message }, '[COMPLETION] Stream error');
        context.emit('completion_error', { error: error.message });
        reject(error);
      });

      response.data.on('end', () => {
        this.finalizeResponse(context, currentMessage, currentToolCalls, usage, actualModel, savedMessageId, timeToFirstToken, currentThinking)
          .then(() => resolve())
          .catch(err => reject(err));
      });
    });
  }

  private processToolCallDeltas(toolCallDeltas: any[], currentToolCalls: any[]): void {
    for (const delta of toolCallDeltas) {
      const index = delta.index;

      if (!currentToolCalls[index]) {
        currentToolCalls[index] = {
          id: delta.id || '',
          type: 'function',
          function: {
            name: delta.function?.name || '',
            arguments: ''
          }
        };
      }

      if (delta.id) currentToolCalls[index].id = delta.id;
      if (delta.function?.name) currentToolCalls[index].function.name = delta.function.name;
      if (delta.function?.arguments) currentToolCalls[index].function.arguments += delta.function.arguments;

      // CRITICAL: Preserve thought_signature for Gemini 3 models
      // Required for multi-turn function calling conversations
      if (delta.thought_signature && !currentToolCalls[index].thought_signature) {
        currentToolCalls[index].thought_signature = delta.thought_signature;
      }
    }
  }

  private async finalizeResponse(
    context: PipelineContext,
    content: string,
    toolCalls: any[],
    usage: any,
    actualModel: string | null,
    savedMessageId?: string | null,
    timeToFirstTokenMs?: number | null,
    thinkingContent?: string
  ): Promise<void> {
    // Use confirmed DB ID if available, otherwise fall back to generated ID
    const messageId = savedMessageId || `assistant_${context.messageId}`;

    // CRITICAL: Check for empty response (no content AND no tool calls)
    // This indicates the LLM failed to generate anything - likely a provider error
    if (!content && toolCalls.length === 0) {
      context.logger.error({
        messageId,
        model: actualModel || context.config.model,
        hasUsage: !!usage,
        hasThinking: !!thinkingContent,
        savedMessageId
      }, '[COMPLETION] ⚠️ EMPTY RESPONSE: LLM returned no content and no tool calls!');

      // Emit error event so frontend knows something went wrong
      context.emit('completion_warning', {
        messageId,
        warning: 'empty_response',
        message: 'The AI model returned an empty response. This may indicate a provider issue.',
        model: actualModel || context.config.model
      });

      // If we have thinking content but no output, include that in a fallback message
      if (thinkingContent && thinkingContent.length > 0) {
        content = `*The AI model processed your request but returned no response text. Internal reasoning was captured but no final answer was generated.*`;
        context.logger.info({
          thinkingLength: thinkingContent.length
        }, '[COMPLETION] Using fallback message since thinking was captured but no output');
      }
    }

    // BUG-007 FIX: Validate content safety before saving
    // Detects: non-English content, repetition loops, excessive length
    let finalContent = content;
    const safetyResult = validateContentSafety(content, context.logger);

    if (!safetyResult.isValid) {
      context.logger.warn({
        issues: safetyResult.issues,
        hadNonEnglish: safetyResult.hadNonEnglish,
        hadRepetition: safetyResult.hadRepetition,
        truncated: safetyResult.truncated,
        originalLength: content?.length || 0,
        cleanedLength: safetyResult.cleanedContent?.length || 0
      }, '[CONTENT-SAFETY] ⚠️ Content validation failed - applying fixes');

      // Use cleaned content if available
      if (safetyResult.cleanedContent) {
        finalContent = safetyResult.cleanedContent;
      }

      // Emit safety warning event for frontend
      context.emit('content_safety_warning', {
        messageId,
        issues: safetyResult.issues,
        hadNonEnglish: safetyResult.hadNonEnglish,
        hadRepetition: safetyResult.hadRepetition,
        truncated: safetyResult.truncated
      });
    }

    const assistantMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: finalContent || '',
      timestamp: new Date(),
      tokenUsage: usage,
      model: actualModel || context.config.model,
      metadata: {
        savedToDb: !!savedMessageId,  // Mark as already saved if we have DB ID
        status: 'completed',
        thinkingContent: thinkingContent || undefined  // Store thinking content in metadata
      }
    };

    if (toolCalls.length > 0) {
      assistantMessage.toolCalls = toolCalls;
      context.request.toolCalls = toolCalls;

      context.logger.info({
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map(tc => tc.function?.name)
      }, '[COMPLETION] Tool calls detected');

      context.emit('tool_calls_required', {
        toolCalls,
        count: toolCalls.length
      });

      // Check for TodoWrite tool and emit todo_update event
      for (const tc of toolCalls) {
        const toolName = tc.function?.name?.toLowerCase();
        if (toolName === 'todowrite' || toolName === 'todo_write') {
          try {
            const args = JSON.parse(tc.function?.arguments || '{}');
            if (args.todos && Array.isArray(args.todos)) {
              const todos = args.todos.map((t: any, index: number) => ({
                id: t.id || `todo-${index}-${Date.now()}`,
                content: t.content || '',
                status: t.status || 'pending',
                activeForm: t.activeForm,
              }));

              context.logger.info({
                todoCount: todos.length,
                todos: todos.map((t: any) => ({ content: t.content, status: t.status }))
              }, '[COMPLETION] 📋 TodoWrite detected - emitting todo_update');

              context.emit('todo_update', { todos });
            }
          } catch (e) {
            context.logger.warn({ error: (e as Error).message }, '[COMPLETION] Failed to parse TodoWrite arguments');
          }
        }
      }
    }

    // DATABASE-FIRST: Update the message in PostgreSQL with final content
    if (savedMessageId) {
      const chatStorage = (context as any).chatStorage;
      const sessionId = (context as any).sessionId || context.session?.id;

      if (chatStorage && sessionId) {
        context.logger.info('┌─────────────────────────────────────────────────────────────');
        context.logger.info('│ [DB-FIRST] 💾 STEP 3: Updating assistant message with final content');
        context.logger.info('└─────────────────────────────────────────────────────────────');

        try {
          const updateStartTime = Date.now();

          // Update message with final content, metadata, and thinking content
          await chatStorage.updateMessage(savedMessageId, {
            content: finalContent || '',
            tokenUsage: usage,
            model: actualModel || context.config.model,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            mcpCalls: context.mcpCalls && context.mcpCalls.length > 0 ? context.mcpCalls : undefined,
            metadata: {
              thinkingContent: thinkingContent || undefined,
              status: 'completed'
            },
            timestamp: new Date()
          });

          const updateTime = Date.now() - updateStartTime;

          context.logger.info({
            messageId: savedMessageId,
            contentLength: finalContent?.length || 0,
            hasToolCalls: toolCalls.length > 0,
            hasThinking: !!(thinkingContent && thinkingContent.length > 0),
            thinkingLength: thinkingContent?.length || 0,
            updateTimeMs: updateTime,
            performance: updateTime < 50 ? '🚀 FAST' : updateTime < 200 ? '✅ OK' : '⚠️  SLOW'
          }, '│ [DB-FIRST] ✅ Assistant message updated in PostgreSQL');

          // 🧠 INTELLIGENT LEARNING: DISABLED - memory.stage.ts now handles per-user memories via Milvus
          // The old awp_memory MCP has been removed. Tool usage is tracked via LLMMetrics instead.
          // if (context.mcpCalls && context.mcpCalls.length > 0) {
          //   this.saveToolUsageToMemory(context, context.mcpCalls).catch(err => {
          //     context.logger.warn({ error: err.message }, '[LEARNING] Failed to save tool usage to memory');
          //   });
          // }

          // Emit final confirmation to frontend
          context.emit('message_updated', {
            messageId: savedMessageId,
            role: 'assistant',
            content: finalContent || '',
            timestamp: new Date().toISOString(),
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            mcpCalls: context.mcpCalls && context.mcpCalls.length > 0 ? context.mcpCalls : undefined,
            thinkingContent: thinkingContent || undefined,  // Include thinking content for UI
            tokenUsage: usage,
            model: actualModel || context.config.model,
            source: 'database',
            confirmed: true,
            final: true  // Streaming is complete
          });

          context.logger.info({
            messageId: savedMessageId
          }, '│ [DB-FIRST] 📡 Emitted message_updated event with final content');

        } catch (error) {
          context.logger.error({
            error: error.message,
            errorStack: error.stack,
            messageId: savedMessageId,
            sessionId,
            userId: context.user.id
          }, '│ [DB-FIRST] ❌ ERROR: Failed to update assistant message in PostgreSQL');
          // Don't throw - message is still in context
        }
      }
    }

    context.messages.push(assistantMessage);

    if (typeof trackChatMessage !== 'undefined') {
      trackChatMessage(context.user.id, actualModel || context.config.model, 'assistant');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SYNTHESIS RESPONSE CHECK: Ensure content is generated after tool execution
    // If we have tool results in context but empty content, log a warning
    // ═══════════════════════════════════════════════════════════════════════════
    const hasToolResults = context.messages.some(m => m.role === 'tool');
    const contentIsEmpty = !finalContent || finalContent.trim().length === 0;
    
    if (hasToolResults && contentIsEmpty && toolCalls.length === 0) {
      context.logger.warn({
        messageId: messageId,
        hasToolResults: true,
        contentLength: finalContent?.length || 0,
        toolCallsInResponse: toolCalls.length,
        mcpCallsCount: context.mcpCalls?.length || 0
      }, '⚠️ [SYNTHESIS-WARNING] Empty content after tool execution - LLM did not synthesize results');
      
      // Emit a warning event for debugging
      context.emit('synthesis_warning', {
        messageId: messageId,
        warning: 'Empty synthesis content after tool execution',
        toolResultCount: context.messages.filter(m => m.role === 'tool').length,
        timestamp: Date.now()
      });
    }

    // Only emit completion_complete if there are NO more tool calls to execute
    // This prevents the UI from closing the stream prematurely during multi-turn tool call rounds
    if (toolCalls.length === 0) {
      context.emit('completion_complete', {
        messageId: messageId,
        toolCalls,
        usage,
        finishReason: 'stop',
        model: actualModel || context.config.model,
        source: savedMessageId ? 'database' : 'context'
      });
    }

    // 📊 LLM METRICS: Log detailed request metrics for cost tracking and analytics
    const model = actualModel || context.config.model;
    const providerType = this.detectProviderType(model);
    const sessionId = (context as any).sessionId || context.session?.id;
    const totalDurationMs = Date.now() - context.startTime.getTime();

    // Calculate model-specific latency (total duration minus any TTFT)
    const modelLatencyMs = timeToFirstTokenMs
      ? totalDurationMs - timeToFirstTokenMs
      : totalDurationMs;

    try {
      const metrics: LLMRequestMetrics = {
        userId: context.user.id,
        sessionId: sessionId,
        messageId: messageId,

        providerType: providerType,
        model: model,

        requestType: 'chat',
        source: 'chat',  // Differentiate from code mode requests
        streaming: true,
        temperature: context.config.temperature,
        maxTokens: context.config.maxTokens,

        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        totalTokens: usage?.total_tokens || 0,
        cachedTokens: usage?.cached_tokens || 0,
        reasoningTokens: usage?.reasoning_tokens || 0,
        estimatedTokens: usage?.estimated || false, // Track if tokens are estimated vs actual from API

        // Performance KPIs (Issue 4l)
        latencyMs: totalDurationMs,
        totalDurationMs: totalDurationMs,
        timeToFirstTokenMs: timeToFirstTokenMs || undefined,
        modelLatencyMs: modelLatencyMs,
        tokensPerSecond: usage?.completion_tokens && totalDurationMs > 0
          ? (usage.completion_tokens / totalDurationMs) * 1000
          : undefined,
        queueWaitMs: 0, // TODO: Implement queue tracking
        concurrentRequests: undefined, // TODO: Track concurrent requests

        // Cache tracking (check if prompt tokens were cached)
        cacheHit: (usage?.cached_tokens || 0) > 0,
        retryCount: 0, // No retries in this success path
        rateLimitHit: false,

        requestSizeBytes: finalContent?.length || 0,
        responseSizeBytes: finalContent?.length || 0,

        toolCallsCount: toolCalls.length,
        toolNames: toolCalls.map(tc => tc.function?.name).filter(Boolean),

        status: 'success',

        providerMetadata: {
          finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          modelSelectionReason: context.modelSelectionReason
        },

        requestStartedAt: context.startTime,
        requestCompletedAt: new Date()
      };

      // Log metrics asynchronously to not block response
      llmMetricsService.logRequest(metrics).then(logId => {
        if (logId) {
          context.logger.debug({
            logId,
            model,
            providerType,
            totalTokens: usage?.total_tokens,
            promptTokens: usage?.prompt_tokens,
            completionTokens: usage?.completion_tokens
          }, '[METRICS] 📊 LLM request logged to database');
        }
      }).catch(err => {
        context.logger.warn({ error: err.message }, '[METRICS] Failed to log LLM request');
      });

    } catch (metricsError: any) {
      context.logger.warn({ error: metricsError.message }, '[METRICS] Failed to create metrics object');
    }

    context.logger.info({
      messageId: messageId,
      contentLength: finalContent?.length || 0,
      hasToolCalls: toolCalls.length > 0,
      model: actualModel || context.config.model,
      databaseFirst: !!savedMessageId
    }, '[COMPLETION] Response finalized');
  }

  private async handleImageGeneration(context: PipelineContext, imagePrompt: string): Promise<PipelineContext> {
    const startTime = Date.now();

    try {
      const imageService = new ImageGenerationService(context.logger);

      context.logger.info({
        imagePrompt: imagePrompt.substring(0, 100)
      }, '[IMAGE-GEN] Starting image generation');

      // Generate the image
      const result = await imageService.generateImage({
        prompt: imagePrompt,
        size: '1024x1024',
        n: 1
      });

      const executionTime = Date.now() - startTime;

      if (!result.success) {
        throw new Error(result.error || 'Image generation failed');
      }

      context.logger.info({
        success: result.success,
        hasImageUrl: !!result.imageUrl,
        hasImageBase64: !!result.imageBase64,
        responseTime: result.responseTime
      }, '[IMAGE-GEN] Image generated successfully');

      // Store image in Milvus instead of embedding in message
      let imageRefId: string | null = null;
      let imageMessageContent: string;

      if (result.imageBase64) {
        try {
          // Get Redis from context services for caching
          const redis = (context as any).services?.redis || (context as any).redis;
          const imageStorage = new ImageStorageService(context.logger, redis);
          await imageStorage.connect();

          imageRefId = await imageStorage.storeImage(
            result.imageBase64,
            result.revisedPrompt || imagePrompt,
            context.user.id,
            {
              model: 'imagen-fast',
              revisedPrompt: result.revisedPrompt,
              dimensions: '1024x1024',
              generationTime: result.responseTime,
              format: 'png'
            }
          );

          context.logger.info({
            imageRefId,
            promptLength: imagePrompt.length,
            userId: context.user.id
          }, '[IMAGE-GEN] Image stored in Milvus successfully');

          // ALSO store as user artifact for RAG context access across models
          // This ensures the image is available in context for subsequent model calls
          try {
            const artifactService = new ArtifactService(context.logger);
            const imageBuffer = Buffer.from(result.imageBase64, 'base64');
            const timestamp = Date.now();
            const sessionId = (context as any).sessionId || context.session?.id || 'unknown';
            await artifactService.uploadArtifact(context.user.id, {
              file: imageBuffer,
              filename: `generated-image-${timestamp}.png`,
              mimeType: 'image/png',
              title: result.revisedPrompt || imagePrompt,
              description: `AI-generated image in session ${sessionId}. Prompt: "${imagePrompt}". To reference this image, use: image://${imageRefId}`,
              tags: ['ai-generated', 'image', 'session:' + sessionId, imageRefId || '']
            });
            context.logger.info({
              imageRefId,
              sessionId,
              userId: context.user.id
            }, '[IMAGE-GEN] Image stored as user artifact for RAG context');
          } catch (artifactError) {
            // Non-blocking - artifact storage failure shouldn't fail the image generation
            context.logger.warn({
              error: artifactError instanceof Error ? artifactError.message : 'Unknown error',
              imageRefId
            }, '[IMAGE-GEN] Failed to store image as user artifact (non-blocking)');
          }

          // Create message with image reference instead of base64
          imageMessageContent = `Here's the image I generated based on your prompt:\n\n![Generated Image](image://${imageRefId})\n\n**Prompt:** ${result.revisedPrompt || imagePrompt}`;

        } catch (storageError) {
          context.logger.error({
            error: storageError instanceof Error ? storageError.message : 'Unknown error',
            imagePrompt
          }, '[IMAGE-GEN] Failed to store image in Milvus, falling back to base64');

          // Fallback to base64 if Milvus storage fails
          imageMessageContent = `Here's the image I generated based on your prompt:\n\n![Generated Image](data:image/png;base64,${result.imageBase64})\n\n**Prompt:** ${result.revisedPrompt || imagePrompt}`;
        }
      } else if (result.imageUrl) {
        imageMessageContent = `Here's the image I generated based on your prompt:\n\n![Generated Image](${result.imageUrl})\n\n**Prompt:** ${result.revisedPrompt || imagePrompt}`;
      } else {
        imageMessageContent = `I generated an image, but there was an issue retrieving it.`;
      }

      const messageId = `assistant_${context.messageId}`;
      const assistantMessage: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: imageMessageContent,
        timestamp: new Date(),
        tokenUsage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
        model: 'imagen-fast',
        metadata: {
          imageGeneration: true,
          imagePrompt: imagePrompt,
          revisedPrompt: result.revisedPrompt,
          generationTime: result.responseTime,
          imageRefId: imageRefId || undefined, // Include reference ID in metadata
          savedToDb: true // Mark as saved to prevent duplicate save in response stage
        }
      };

      // Save to database if available
      // CRITICAL FIX: Use the existing placeholder message ID to avoid duplicate messages
      const chatStorage = (context as any).chatStorage;
      const sessionId = (context as any).sessionId || context.session?.id;
      const existingMessageId = (context as any).assistantMessageId; // Placeholder ID from earlier

      if (chatStorage && sessionId) {
        try {
          if (existingMessageId) {
            // UPDATE the existing placeholder message instead of creating a new one
            // This prevents double image display on reload
            // CRITICAL FIX: updateMessage takes (messageId, updates), not (sessionId, messageId, updates)
            await chatStorage.updateMessage(existingMessageId, {
              content: imageMessageContent,
              model: 'imagen-fast',
              metadata: assistantMessage.metadata,
              tokenUsage: assistantMessage.tokenUsage
            });
            assistantMessage.id = existingMessageId;

            context.logger.info({
              messageId: existingMessageId,
              sessionId
            }, '[IMAGE-GEN] Updated existing placeholder message with image content');
          } else {
            // Fallback: create new message if no placeholder exists
            const savedMessage = await chatStorage.addMessage(sessionId, {
              ...assistantMessage,
              userId: context.user.id
            });
            assistantMessage.id = savedMessage.id;

            context.logger.info({
              messageId: savedMessage.id,
              sessionId
            }, '[IMAGE-GEN] Created new message (no placeholder existed)');
          }
        } catch (error) {
          context.logger.warn({
            error: error.message
          }, '[IMAGE-GEN] Failed to save to database, continuing');
        }
      }

      // Add to context
      context.messages.push(assistantMessage);

      // Emit completion events
      // CRITICAL FIX: For image generation, emit an 'image' event so the frontend can display
      // the image immediately during SSE streaming, not just after reload
      context.emit('completion_start', {
        model: 'imagen-fast',
        messageId: assistantMessage.id
      });

      // Emit 'image' event for real-time display during streaming
      // This allows the frontend to show the generated image immediately
      // The image reference uses the image:// protocol for Milvus-stored images
      context.emit('image', {
        imageUrl: imageRefId ? `image://${imageRefId}` : (result.imageBase64 ? `data:image/png;base64,${result.imageBase64}` : result.imageUrl),
        revisedPrompt: result.revisedPrompt || imagePrompt,
        messageId: assistantMessage.id
      });

      // Also emit as stream content so the markdown with image renders properly
      context.emit('stream', {
        content: imageMessageContent,
        delta: false // Not a delta, full content
      });

      // Emit message_saved to ensure frontend knows the message is ready
      context.emit('message_saved', {
        messageId: assistantMessage.id,
        role: 'assistant',
        content: imageMessageContent,
        timestamp: new Date().toISOString(),
        source: 'database',
        confirmed: true,
        imageGeneration: true
      });

      context.emit('completion_complete', {
        messageId: assistantMessage.id,
        toolCalls: [],
        usage: { total_tokens: 0 },
        finishReason: 'stop',
        model: 'imagen-fast',
        imageGeneration: true
      });

      if (typeof chatResponseTime !== 'undefined') {
        chatResponseTime.observe({ model: 'imagen-fast' }, executionTime / 1000);
      }

      if (typeof trackChatMessage !== 'undefined') {
        trackChatMessage(context.user.id, 'imagen-fast', 'assistant');
      }

      context.logger.info({
        messageId: assistantMessage.id,
        executionTime
      }, '[IMAGE-GEN] Image generation completed successfully');

      return context;

    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      context.logger.error({
        error: error.message,
        stack: error.stack,
        executionTime
      }, '[IMAGE-GEN] Image generation failed');

      // Return error message to user
      const errorMessage: ChatMessage = {
        id: `assistant_${context.messageId}`,
        role: 'assistant',
        content: `I apologize, but I encountered an error while trying to generate the image: ${error.message}\n\nPlease try again with a different prompt.`,
        timestamp: new Date(),
        tokenUsage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
        model: 'imagen-fast',
        metadata: {
          imageGeneration: true,
          error: error.message,
          status: 'error'
        }
      };

      context.messages.push(errorMessage);

      context.emit('completion_error', {
        error: error.message,
        stage: 'image_generation'
      });

      return context;
    }
  }

  /**
   * 🧠 INTELLIGENT LEARNING: DEPRECATED - awp_memory MCP removed
   * Memory is now handled by memory.stage.ts via Milvus vector store per user.
   * Tool usage analytics are tracked via LLMMetrics table.
   *
   * @deprecated Use memory.stage.ts for per-user memory management
   */
  // private async saveToolUsageToMemory(context: PipelineContext, mcpCalls: any[]): Promise<void> {
  //   // REMOVED: awp_memory MCP no longer exists
  //   // See memory.stage.ts for the new per-user memory implementation
  // }

  /**
   * Check if messages contain image content
   */
  private hasImageContent(messages: any[]): boolean {
    return messages.some(msg => {
      const content = msg.content;
      if (Array.isArray(content)) {
        return content.some(c => c.type === 'image_url' || c.type === 'image');
      }
      return false;
    });
  }

  /**
   * Check if a model is vision-capable
   * Uses env var VISION_CAPABLE_MODELS (comma-separated) - NO HARDCODED DEFAULTS
   */
  private isVisionCapableModel(modelName: string): boolean {
    // Safety guard for undefined/null model
    if (!modelName) {
      return false;
    }
    const visionModelsEnv = process.env.VISION_CAPABLE_MODELS || '';
    if (!visionModelsEnv) {
      // No vision models configured - cannot determine if model is vision-capable
      return false;
    }

    const modelLower = modelName.toLowerCase();
    const visionModels = visionModelsEnv.split(',').map(m => m.trim().toLowerCase());
    return visionModels.some(vm => vm && modelLower.includes(vm));
  }

  /**
   * Resolve image:// references in messages to actual image data
   * This enables cross-model image access - images generated by one model can be viewed by another
   * Returns messages with resolved image data as attachments for multimodal formatting
   */
  private async resolveImageReferences(messages: ChatMessage[], context: PipelineContext): Promise<ChatMessage[]> {
    const imageRefPattern = /image:\/\/([a-zA-Z0-9_-]+)/g;
    const resolvedMessages: ChatMessage[] = [];

    // Initialize ImageStorageService
    let imageStorage: ImageStorageService | null = null;
    try {
      const redis = (context as any).services?.redis || (context as any).redis;
      imageStorage = new ImageStorageService(context.logger, redis);
      await imageStorage.connect();
    } catch (error) {
      context.logger.warn({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, '[IMAGE-RESOLVE] Failed to connect to ImageStorageService, skipping image resolution');
      return messages; // Return original messages if we can't connect
    }

    for (const msg of messages) {
      // Only process messages with string content containing image:// references
      if (typeof msg.content !== 'string' || !msg.content.includes('image://')) {
        resolvedMessages.push(msg);
        continue;
      }

      const matches = [...msg.content.matchAll(imageRefPattern)];
      if (matches.length === 0) {
        resolvedMessages.push(msg);
        continue;
      }

      context.logger.info({
        messageId: msg.id,
        imageRefCount: matches.length,
        refs: matches.map(m => m[1])
      }, '[IMAGE-RESOLVE] Found image references to resolve');

      // Resolve each image reference
      const resolvedImages: Array<{ id: string; base64Data: string; mimeType: string }> = [];
      for (const match of matches) {
        const imageRefId = match[1];
        try {
          const storedImage = await imageStorage.getImage(imageRefId);
          if (storedImage && storedImage.imageData) {
            resolvedImages.push({
              id: imageRefId,
              base64Data: storedImage.imageData,
              mimeType: 'image/png'
            });
            context.logger.info({
              imageRefId,
              dataLength: storedImage.imageData.length
            }, '[IMAGE-RESOLVE] Successfully resolved image reference');
          }
        } catch (error) {
          context.logger.warn({
            imageRefId,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, '[IMAGE-RESOLVE] Failed to resolve image reference');
        }
      }

      // If we resolved any images, add them as attachments for multimodal processing
      if (resolvedImages.length > 0) {
        const existingAttachments = msg.attachments || [];
        const newAttachments = resolvedImages.map(img => ({
          id: img.id,
          originalName: `generated-image-${img.id}.png`,
          mimeType: img.mimeType,
          size: img.base64Data.length,
          base64Data: img.base64Data
        }));

        resolvedMessages.push({
          ...msg,
          attachments: [...existingAttachments, ...newAttachments]
        });

        context.logger.info({
          messageId: msg.id,
          resolvedCount: resolvedImages.length,
          totalAttachments: existingAttachments.length + newAttachments.length
        }, '[IMAGE-RESOLVE] Added resolved images as attachments for multimodal processing');
      } else {
        resolvedMessages.push(msg);
      }
    }

    return resolvedMessages;
  }

  async rollback(context: PipelineContext): Promise<void> {
    context.messages = context.messages.filter(msg =>
      msg.id !== `assistant_${context.messageId}`
    );

    context.logger.debug('[COMPLETION] Rollback completed');
  }
}
