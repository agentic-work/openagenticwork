/**
 * AWS Bedrock Provider
 *
 * Implements ILLMProvider for AWS Bedrock models (Claude, Titan, Jurassic, etc.)
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand
} from '@aws-sdk/client-bedrock-runtime';
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';
import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type ProviderConfig,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth
} from './ILLMProvider.js';

export interface BedrockConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
  // Standardized model config (from database or environment)
  chatModel?: string;
  embeddingModel?: string;
  visionModel?: string;
  imageModel?: string;
  compactionModel?: string;
  modelId?: string; // Legacy fallback
  // Secondary model for fallback when primary is throttled
  secondaryModel?: string;
  // Retry configuration
  maxRetries?: number;
  initialRetryDelayMs?: number;
  // Inference profile prefix (us, eu, apac) - defaults to 'us' for cross-region
  inferenceProfilePrefix?: string;
}

/**
 * AWS Bedrock now requires inference profiles for on-demand model invocation.
 * This map converts direct model IDs to cross-region inference profile IDs.
 *
 * Format: Direct Model ID → Inference Profile ID
 *
 * Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
 */
const MODEL_TO_INFERENCE_PROFILE: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.5 SERIES (Latest - All support thinking, tools, vision)
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.5 - Premium model, best quality
  'anthropic.claude-opus-4-5-20251101-v1:0': 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  // Claude Sonnet 4.5 - Balanced quality/cost
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  // Claude Haiku 4.5 - Fast/cheap, supports thinking/tools/vision
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.x SERIES
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.1
  'anthropic.claude-opus-4-1-20250805-v1:0': 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  // Claude Opus 4
  'anthropic.claude-opus-4-20250514-v1:0': 'us.anthropic.claude-opus-4-20250514-v1:0',
  // Claude Sonnet 4
  'anthropic.claude-sonnet-4-20250514-v1:0': 'us.anthropic.claude-sonnet-4-20250514-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 3.x SERIES
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude 3.7 Sonnet
  'anthropic.claude-3-7-sonnet-20250219-v1:0': 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  // Claude 3.5 Sonnet v2
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  // Claude 3.5 Sonnet v1
  'anthropic.claude-3-5-sonnet-20240620-v1:0': 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
  // Claude 3.5 Haiku (does NOT support thinking)
  'anthropic.claude-3-5-haiku-20241022-v1:0': 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  // Claude 3 Opus
  'anthropic.claude-3-opus-20240229-v1:0': 'us.anthropic.claude-3-opus-20240229-v1:0',
  // Claude 3 Sonnet
  'anthropic.claude-3-sonnet-20240229-v1:0': 'us.anthropic.claude-3-sonnet-20240229-v1:0',
  // Claude 3 Haiku
  'anthropic.claude-3-haiku-20240307-v1:0': 'us.anthropic.claude-3-haiku-20240307-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // AMAZON NOVA MODELS
  // ═══════════════════════════════════════════════════════════════════════════
  'amazon.nova-micro-v1:0': 'us.amazon.nova-micro-v1:0',
  'amazon.nova-lite-v1:0': 'us.amazon.nova-lite-v1:0',
  'amazon.nova-pro-v1:0': 'us.amazon.nova-pro-v1:0',
};

export class AWSBedrockProvider extends BaseLLMProvider {
  readonly name = 'AWS Bedrock';
  readonly type = 'aws-bedrock' as const;

  private runtimeClient?: BedrockRuntimeClient;
  private bedrockClient?: BedrockClient;
  private config?: BedrockConfig;

  // Retry configuration with defaults
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly secondaryModel?: string;

  constructor(logger: Logger) {
    super(logger, 'aws-bedrock');
    // Default retry configuration
    this.maxRetries = 5; // More retries for throttling
    this.initialRetryDelayMs = 1000; // Start with 1 second
    // Use inference profile format for secondary model
    this.secondaryModel = process.env.SECONDARY_MODEL || 'us.amazon.nova-micro-v1:0';
  }

  /**
   * Check if an error is a throttling/rate limit error from Bedrock
   */
  private isThrottlingError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    const errorName = error.name || '';
    const statusCode = error.$metadata?.httpStatusCode || 0;

    return (
      errorName === 'ThrottlingException' ||
      statusCode === 429 ||
      message.includes('throttlingexception') ||
      message.includes('too many tokens') ||
      message.includes('too many requests') ||
      message.includes('rate exceeded') ||
      message.includes('rate limit')
    );
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped)
    const exponentialDelay = this.initialRetryDelayMs * Math.pow(2, attempt);
    const maxDelay = 30000; // Cap at 30 seconds
    const baseDelay = Math.min(exponentialDelay, maxDelay);
    // Add jitter (±25%)
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(baseDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Convert a direct model ID to an inference profile ID for cross-region invocation.
   * AWS Bedrock now REQUIRES inference profiles for on-demand model invocation.
   *
   * If the model ID is already an inference profile (starts with us./eu./apac.),
   * it is returned as-is.
   *
   * If no mapping exists, returns the original model ID (may fail if Bedrock requires profile).
   */
  private toInferenceProfile(modelId: string): string {
    // Already an inference profile? Return as-is
    if (modelId.startsWith('us.') || modelId.startsWith('eu.') || modelId.startsWith('apac.')) {
      return modelId;
    }

    // Check explicit mapping
    const mappedProfile = MODEL_TO_INFERENCE_PROFILE[modelId];
    if (mappedProfile) {
      this.logger.info({
        originalModelId: modelId,
        inferenceProfile: mappedProfile
      }, '🔄 [BEDROCK] Converted model ID to inference profile');
      return mappedProfile;
    }

    // Try to auto-generate inference profile for known patterns
    // Format: us.<provider>.<model> for cross-region inference
    const prefix = this.config?.inferenceProfilePrefix || process.env.AWS_BEDROCK_INFERENCE_PREFIX || 'us';

    // Check if this looks like an Anthropic model that needs conversion
    if (modelId.startsWith('anthropic.')) {
      // Try the direct prefix approach
      const autoProfile = `${prefix}.${modelId}`;
      this.logger.warn({
        originalModelId: modelId,
        autoGeneratedProfile: autoProfile,
        warning: 'Model not in explicit mapping - auto-generating profile ID'
      }, '⚠️ [BEDROCK] Auto-generating inference profile for unmapped Anthropic model');
      return autoProfile;
    }

    // For Amazon models (Nova, Titan), try direct prefix
    if (modelId.startsWith('amazon.')) {
      const autoProfile = `${prefix}.${modelId}`;
      this.logger.info({
        originalModelId: modelId,
        inferenceProfile: autoProfile
      }, '🔄 [BEDROCK] Using cross-region profile for Amazon model');
      return autoProfile;
    }

    // Return original for other models (may fail if Bedrock requires profile)
    this.logger.warn({
      modelId,
      warning: 'Model not in inference profile mapping - using direct ID'
    }, '⚠️ [BEDROCK] No inference profile mapping for model');
    return modelId;
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    try {
      this.config = config as BedrockConfig;

      const clientConfig: any = {
        region: this.config.region || process.env.AWS_REGION || 'us-east-1'
      };

      // Add credentials if provided (otherwise uses default AWS credential chain)
      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
          sessionToken: this.config.sessionToken
        };
      }

      if (this.config.endpoint) {
        clientConfig.endpoint = this.config.endpoint;
      }

      this.runtimeClient = new BedrockRuntimeClient(clientConfig);
      this.bedrockClient = new BedrockClient(clientConfig);

      // IMPORTANT: Validate credentials by making a test API call
      // This prevents the provider from being added if credentials are invalid
      try {
        this.logger.info({ provider: this.name, region: clientConfig.region }, 'Validating AWS Bedrock credentials...');
        
        const testCommand = new ListFoundationModelsCommand({});
        const response = await this.bedrockClient.send(testCommand);
        
        const modelCount = response.modelSummaries?.length || 0;
        this.logger.info({ 
          provider: this.name, 
          modelsAvailable: modelCount,
          region: clientConfig.region
        }, 'AWS Bedrock credentials validated successfully');

      } catch (credentialError: any) {
        // Clear the clients since they won't work
        this.runtimeClient = undefined;
        this.bedrockClient = undefined;
        this.initialized = false;
        
        const errorMessage = credentialError.message || String(credentialError);
        const isCredentialError = 
          errorMessage.includes('Could not load credentials') ||
          errorMessage.includes('Missing credentials') ||
          errorMessage.includes('ExpiredToken') ||
          errorMessage.includes('InvalidIdentityToken') ||
          errorMessage.includes('AccessDenied') ||
          errorMessage.includes('UnrecognizedClientException') ||
          credentialError.name === 'CredentialsProviderError';

        if (isCredentialError) {
          this.logger.error({
            provider: this.name,
            error: errorMessage,
            region: clientConfig.region,
            hasAccessKeyId: !!this.config.accessKeyId,
            hasSecretAccessKey: !!this.config.secretAccessKey
          }, '❌ AWS Bedrock credentials are invalid or missing. Provider will NOT be available. ' +
             'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables, ' +
             'or configure IAM role/instance profile, or set AWS_BEDROCK_ENABLED=false to disable.');
          
          throw new Error(
            `AWS Bedrock credential validation failed: ${errorMessage}. ` +
            `Please configure valid AWS credentials or disable AWS Bedrock (AWS_BEDROCK_ENABLED=false).`
          );
        } else {
          // Non-credential error (network, service issue, etc.) - log but allow retry
          this.logger.warn({
            provider: this.name,
            error: errorMessage,
            errorType: credentialError.name
          }, 'AWS Bedrock validation call failed (non-credential error). Provider may work on retry.');
          throw credentialError;
        }
      }

      this.initialized = true;

      // Log model configuration
      this.logger.info({
        provider: this.name,
        region: clientConfig.region,
        chatModel: this.config.chatModel || this.config.modelId,
        embeddingModel: this.config.embeddingModel,
        visionModel: this.config.visionModel
      }, 'AWS Bedrock provider initialized with model config');
    } catch (error) {
      this.logger.error({ error, provider: this.name }, 'Failed to initialize AWS Bedrock provider');
      throw error;
    }
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    const startTime = Date.now();

    // Determine model from request or use default
    const requestedModelId = request.model || process.env.AWS_BEDROCK_DEFAULT_MODEL || process.env.ECONOMICAL_MODEL;
    const requestedSecondaryModelId = this.config?.secondaryModel || this.secondaryModel;

    // CRITICAL: Convert model IDs to inference profiles for AWS Bedrock
    // AWS Bedrock now REQUIRES inference profiles for on-demand model invocation
    const primaryModelId = this.toInferenceProfile(requestedModelId!);
    const secondaryModelId = requestedSecondaryModelId ? this.toInferenceProfile(requestedSecondaryModelId) : undefined;

    this.logger.info({
      requestedModel: requestedModelId,
      resolvedModel: primaryModelId,
      requestedSecondary: requestedSecondaryModelId,
      resolvedSecondary: secondaryModelId,
      wasConverted: requestedModelId !== primaryModelId
    }, '🎯 [BEDROCK] Model ID resolution for completion request');

    let lastError: Error | null = null;
    let currentModelId = primaryModelId;
    let totalRetries = 0;

    // Try with retry and model fallback
    for (let modelAttempt = 0; modelAttempt < 2; modelAttempt++) {
      // On second attempt, try secondary model if available
      if (modelAttempt === 1) {
        if (!secondaryModelId || secondaryModelId === currentModelId) {
          // No secondary model or same as primary, throw the last error
          break;
        }
        currentModelId = secondaryModelId;
        this.logger.info({
          primaryModel: primaryModelId,
          fallbackModel: currentModelId,
          reason: 'throttling'
        }, '🔄 [BEDROCK] Falling back to secondary model after throttling');
      }

      // Convert OpenAI-style messages to Bedrock format
      const body = this.convertToBedrock(request, currentModelId);

      // Retry loop with exponential backoff
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          if (request.stream) {
            return await this.streamCompletionWithRetry(currentModelId, body, startTime, attempt);
          } else {
            return await this.nonStreamCompletion(currentModelId, body, startTime);
          }
        } catch (error: any) {
          lastError = error;
          totalRetries++;

          // If not a throttling error, don't retry - throw immediately
          if (!this.isThrottlingError(error)) {
            this.trackFailure();
            this.logger.error({
              error: error.message,
              model: currentModelId,
              attempt,
              errorType: error.name,
              provider: this.name
            }, 'Bedrock completion failed (non-throttling error)');
            throw error;
          }

          // If we've exhausted retries for this model, break to try fallback
          if (attempt >= this.maxRetries) {
            this.logger.warn({
              model: currentModelId,
              attempts: attempt + 1,
              totalRetries,
              errorType: error.name,
              errorMessage: error.message
            }, '⚠️ [BEDROCK] Exhausted retries for throttling, trying fallback model');
            break;
          }

          // Calculate backoff delay
          const delayMs = this.calculateBackoffDelay(attempt);

          this.logger.warn({
            model: currentModelId,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delayMs,
            errorType: error.name,
            errorMessage: error.message
          }, `⏳ [BEDROCK] Throttling detected, retrying in ${delayMs}ms`);

          await this.sleep(delayMs);
        }
      }
    }

    // All attempts failed
    this.trackFailure();
    this.logger.error({
      primaryModel: primaryModelId,
      secondaryModel: secondaryModelId,
      totalRetries,
      error: lastError?.message,
      provider: this.name
    }, '❌ [BEDROCK] All retry attempts and model fallbacks failed');

    throw lastError || new Error('Bedrock completion failed after all retries');
  }

  /**
   * Stream completion with retry support
   * Returns the generator directly if successful
   */
  private async streamCompletionWithRetry(
    modelId: string,
    body: any,
    startTime: number,
    attempt: number
  ): Promise<AsyncGenerator<any>> {
    // For streaming, we need to handle throttling at the initial request level
    // The generator itself shouldn't need retry logic since throttling happens upfront
    return this.streamCompletion(modelId, body, startTime);
  }

  private async nonStreamCompletion(modelId: string, body: any, startTime: number): Promise<CompletionResponse> {
    const command = new InvokeModelCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const response = await this.runtimeClient!.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const latency = Date.now() - startTime;

    // Parse response based on model type
    const parsedResponse = this.parseBedrockResponse(modelId, responseBody);

    // Track metrics
    const tokens = parsedResponse.usage?.total_tokens || 0;
    const cost = this.estimateCost(modelId, tokens);
    this.trackSuccess(latency, tokens, cost);

    return parsedResponse;
  }

  private async *streamCompletion(modelId: string, body: any, startTime: number): AsyncGenerator<any> {
    const command = new InvokeModelWithResponseStreamCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const response = await this.runtimeClient!.send(command);

    if (!response.body) {
      throw new Error('No response body from Bedrock streaming');
    }

    let totalTokens = 0;

    for await (const event of response.body) {
      if (event.chunk) {
        const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));

        // Convert Bedrock streaming format to OpenAI-style chunks
        const converted = this.convertStreamChunk(modelId, chunk);
        if (converted) {
          yield converted;

          // Track tokens if available
          if (chunk.usage?.total_tokens) {
            totalTokens = chunk.usage.total_tokens;
          }
        }
      }
    }

    // Track metrics after streaming completes
    const latency = Date.now() - startTime;
    const cost = this.estimateCost(modelId, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);
  }

  private convertToBedrock(request: CompletionRequest, modelId: string): any {
    // Anthropic Claude models
    if (modelId.includes('anthropic.claude')) {
      const systemMessages = request.messages.filter(m => m.role === 'system');
      const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

      // Check if thinking mode is enabled for this request
      const thinkingEnabled = (request as any).thinking?.type === 'enabled';

      // Convert messages to Anthropic format with proper tool handling
      const convertedMessages: any[] = [];

      for (let i = 0; i < nonSystemMessages.length; i++) {
        const m = nonSystemMessages[i];

        // Check if content is already array-formatted (from previous turns with thinking/tool_use)
        const isArrayContent = Array.isArray(m.content);

        // Skip messages with empty content (except for assistant messages with tool_calls or last assistant message)
        const hasContent = isArrayContent ? m.content.length > 0 : (m.content && m.content.trim());
        const hasToolCalls = m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0;
        const isLastAssistant = i === nonSystemMessages.length - 1 && m.role === 'assistant';

        if (!hasContent && !hasToolCalls && !isLastAssistant) {
          continue;
        }

        // Handle assistant messages with array-format content (already has thinking/tool_use blocks)
        if (m.role === 'assistant' && isArrayContent) {
          let contentBlocks: any[] = [...m.content];

          // When thinking is enabled, Claude requires assistant messages to start with thinking block
          // Check if first block is already a thinking block
          const hasThinkingBlock = contentBlocks.some((b: any) =>
            b.type === 'thinking' || b.type === 'redacted_thinking'
          );
          const hasToolUseBlock = contentBlocks.some((b: any) => b.type === 'tool_use');

          // NOTE: We previously tried to inject fake redacted_thinking blocks here, but that fails
          // because redacted_thinking blocks require valid encrypted 'data' from actual API responses.
          // Instead, we should NOT inject any thinking blocks - the model will handle it.
          // If this causes issues, the solution is to disable thinking for requests with
          // message history that doesn't have thinking blocks (can't toggle mid-conversation).
          if (thinkingEnabled && hasToolUseBlock && !hasThinkingBlock) {
            this.logger.debug({ messageIndex: i }, 'Assistant message has tool_use but no thinking block - not injecting fake blocks');
          }

          // Sanitize content blocks before sending to Bedrock
          for (const block of contentBlocks) {
            // IMPORTANT: Keep 'data' field on existing redacted_thinking blocks!
            // When resending messages from previous turns, the 'data' field contains
            // encrypted thinking content that Claude needs for conversation continuity.
            // We do NOT delete block.data - it breaks multi-turn conversations.

            // CRITICAL: Ensure tool_use.input is ALWAYS a valid dictionary
            // Bedrock rejects requests where tool_use.input is not a plain object
            if (block.type === 'tool_use') {
              let input = block.input;

              if (typeof input === 'string') {
                // Try to parse JSON string
                try {
                  const parsed = JSON.parse(input);
                  input = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                    ? parsed
                    : { value: parsed };
                } catch {
                  input = { raw: input };
                }
              } else if (input === null || input === undefined) {
                input = {};
              } else if (Array.isArray(input)) {
                input = { items: input };
              } else if (typeof input !== 'object') {
                input = { value: input };
              } else {
                // Clone to ensure plain object (no prototype issues)
                try {
                  input = JSON.parse(JSON.stringify(input));
                } catch {
                  input = {};
                }
              }

              block.input = input;
            }
          }

          convertedMessages.push({
            role: 'assistant',
            content: contentBlocks
          });
          continue;
        }

        // Handle assistant messages with tool calls (from OpenAI format)
        if (m.role === 'assistant' && hasToolCalls) {
          const contentBlocks: any[] = [];

          // NOTE: We previously tried to inject fake redacted_thinking blocks here for
          // thinking-enabled requests, but that fails because redacted_thinking blocks
          // require valid encrypted 'data' from actual API responses.
          // OpenAI-format messages won't have thinking blocks - that's expected.
          // The model will handle this gracefully.
          if (thinkingEnabled) {
            this.logger.debug({ messageIndex: i }, 'OpenAI-format assistant message with tool_calls - not injecting fake thinking blocks');
          }

          // Add text content if present
          if (hasContent) {
            contentBlocks.push({
              type: 'text',
              text: m.content
            });
          }

          // Add tool use blocks
          for (const toolCall of m.tool_calls) {
            // Parse the arguments and SANITIZE to ensure valid dictionary
            let input: any;
            try {
              input = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              input = {};
            }

            // CRITICAL: Ensure input is a valid plain object (dictionary)
            // Bedrock rejects requests where tool_use.input is not a plain object
            if (input === null || input === undefined) {
              input = {};
            } else if (Array.isArray(input)) {
              input = { items: input };
            } else if (typeof input !== 'object') {
              input = { value: input };
            } else {
              // Clone to ensure plain object (no prototype issues)
              try {
                input = JSON.parse(JSON.stringify(input));
              } catch {
                input = {};
              }
            }

            contentBlocks.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input
            });
          }

          convertedMessages.push({
            role: 'assistant',
            content: contentBlocks
          });
          continue;
        }

        // Handle tool result messages
        if (m.role === 'tool') {
          // Tool results must follow assistant messages with tool_calls
          // We need to accumulate consecutive tool messages and send them together
          const toolResults: any[] = [];
          let j = i;

          while (j < nonSystemMessages.length && nonSystemMessages[j].role === 'tool') {
            const toolMsg = nonSystemMessages[j];
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolMsg.tool_call_id,
              content: toolMsg.content || ''
            });
            j++;
          }

          // Add all tool results as a single user message
          convertedMessages.push({
            role: 'user',
            content: toolResults
          });

          // Skip the processed tool messages
          i = j - 1;
          continue;
        }

        // Handle regular user and assistant messages
        convertedMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content || ''
        });
      }

      // Bedrock Claude doesn't allow both temperature and top_p - only use temperature
      const bedrockRequest: any = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature !== undefined ? request.temperature : 1.0,
        // top_p: not supported when temperature is set for Bedrock Claude
        messages: convertedMessages,
        ...(systemMessages.length > 0 && { system: systemMessages[0].content })
      };

      // Add extended thinking support for Claude (if requested via thinking parameter)
      // See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
      if ((request as any).thinking?.type === 'enabled') {
        // Priority: request.thinking.budget_tokens > provider config > default
        const thinkingBudget = (request as any).thinking?.budget_tokens ||
                              (this.config as any)?.thinkingBudget ||
                              10000;
        bedrockRequest.thinking = {
          type: 'enabled',
          budget_tokens: thinkingBudget
        };
        // CRITICAL: Claude requires temperature=1 when thinking is enabled
        // https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking
        bedrockRequest.temperature = 1;

        // CRITICAL: max_tokens MUST be greater than thinking.budget_tokens
        // https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size
        if (bedrockRequest.max_tokens <= thinkingBudget) {
          bedrockRequest.max_tokens = thinkingBudget + 4096; // Add 4096 for response tokens
        }

        this.logger.info({
          modelId,
          thinking_budget: bedrockRequest.thinking.budget_tokens,
          max_tokens: bedrockRequest.max_tokens,
          temperatureOverride: 'Set to 1 (required for extended thinking)'
        }, '[AWSBedrockProvider] 🧠 Extended thinking enabled for Claude via Bedrock');
      }

      // DEBUG: Log tool status at entry point
      if (!request.tools || request.tools.length === 0) {
        this.logger.warn({
          modelId,
          requestKeys: Object.keys(request),
          hasMessagesArray: Array.isArray(request.messages),
          messageCount: request.messages?.length || 0,
        }, '[AWSBedrockProvider] ⚠️ NO TOOLS in request - model may generate XML tool calls instead of using native tool_use');
      }

      // Add tools if provided (Claude supports tools via Bedrock)
      if (request.tools && request.tools.length > 0) {
        bedrockRequest.tools = request.tools.map((tool: any) => ({
          name: tool.function?.name || tool.name,
          description: tool.function?.description || tool.description || '',
          input_schema: tool.function?.parameters || tool.input_schema || {}
        }));

        // DEBUG: Log tool configuration for troubleshooting
        this.logger.info({
          toolCount: bedrockRequest.tools.length,
          toolNames: bedrockRequest.tools.map((t: any) => t.name),
          firstToolSchema: bedrockRequest.tools[0] ? {
            name: bedrockRequest.tools[0].name,
            hasInputSchema: !!bedrockRequest.tools[0].input_schema,
            inputSchemaType: bedrockRequest.tools[0].input_schema?.type,
          } : null,
        }, '[AWSBedrockProvider] 🔧 Tools configured for request');

        // Map tool_choice to Bedrock format
        if (request.tool_choice) {
          if (request.tool_choice === 'auto') {
            bedrockRequest.tool_choice = { type: 'auto' };
          } else if (request.tool_choice === 'none') {
            bedrockRequest.tool_choice = { type: 'none' };
          } else if (typeof request.tool_choice === 'object' && request.tool_choice.function) {
            bedrockRequest.tool_choice = {
              type: 'tool',
              name: request.tool_choice.function.name
            };
          }
        } else {
          bedrockRequest.tool_choice = { type: 'auto' };
        }
      }

      return bedrockRequest;
    }

    // Amazon Titan models
    if (modelId.includes('amazon.titan')) {
      const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');

      return {
        inputText: prompt,
        textGenerationConfig: {
          temperature: request.temperature || 0.7,
          topP: request.top_p || 1,
          maxTokenCount: request.max_tokens || 4096
        }
      };
    }

    // AI21 Jurassic models
    if (modelId.includes('ai21.j2')) {
      const prompt = request.messages.map(m => m.content).join('\n');

      return {
        prompt,
        temperature: request.temperature || 0.7,
        topP: request.top_p || 1,
        maxTokens: request.max_tokens || 4096
      };
    }

    // Meta Llama models
    if (modelId.includes('meta.llama')) {
      const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');

      return {
        prompt,
        temperature: request.temperature || 0.7,
        top_p: request.top_p || 1,
        max_gen_len: request.max_tokens || 4096
      };
    }

    // Default format (works for most models)
    return {
      prompt: request.messages.map(m => m.content).join('\n'),
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 4096
    };
  }

  private parseBedrockResponse(modelId: string, responseBody: any): CompletionResponse {
    // Anthropic Claude
    if (modelId.includes('anthropic.claude')) {
      const message: any = {
        role: 'assistant',
        content: ''
      };

      // Extract text content and tool calls from response
      if (responseBody.content && Array.isArray(responseBody.content)) {
        const textContent = responseBody.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('');

        message.content = textContent || responseBody.completion || '';

        // Extract tool calls
        const toolUseBlocks = responseBody.content.filter((block: any) => block.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          message.tool_calls = toolUseBlocks.map((block: any, index: number) => ({
            id: block.id || `call_${Date.now()}_${index}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          }));
        }
      } else {
        message.content = responseBody.completion || '';
      }

      return {
        id: responseBody.id || `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message,
          finish_reason: responseBody.stop_reason || 'stop'
        }],
        usage: {
          prompt_tokens: responseBody.usage?.input_tokens || 0,
          completion_tokens: responseBody.usage?.output_tokens || 0,
          total_tokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0)
        }
      };
    }

    // Amazon Titan
    if (modelId.includes('amazon.titan')) {
      return {
        id: `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: responseBody.results?.[0]?.outputText || ''
          },
          finish_reason: responseBody.results?.[0]?.completionReason || 'stop'
        }],
        usage: {
          prompt_tokens: responseBody.inputTextTokenCount || 0,
          completion_tokens: responseBody.results?.[0]?.tokenCount || 0,
          total_tokens: (responseBody.inputTextTokenCount || 0) + (responseBody.results?.[0]?.tokenCount || 0)
        }
      };
    }

    // Default format
    return {
      id: `bedrock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: responseBody.completion || responseBody.generated_text || ''
        },
        finish_reason: 'stop'
      }]
    };
  }

  private convertStreamChunk(modelId: string, chunk: any): any {
    if (modelId.includes('anthropic.claude')) {
      // Handle content_block_delta (actual content streaming)
      if (chunk.type === 'content_block_delta') {
        const delta: any = {};

        // Handle thinking content (extended thinking from Claude via Bedrock)
        // AWS Bedrock sends: delta.type === 'thinking_delta' with delta.thinking containing the text
        // See: https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html
        if (chunk.delta?.type === 'thinking_delta') {
          delta.thinking = chunk.delta.thinking;
          delta.reasoning = delta.thinking; // Also set reasoning for compatibility
          this.logger.debug({
            thinkingLength: delta.thinking?.length || 0
          }, '[AWSBedrockProvider] 🧠 Received thinking_delta');
        }

        // Handle signature delta (thinking block signature for verification)
        if (chunk.delta?.type === 'signature_delta') {
          // Signature is for verification, not displayed to user
          this.logger.debug({
            signatureLength: chunk.delta.signature?.length || 0
          }, '[AWSBedrockProvider] 🔐 Received thinking signature');
          return null; // Don't emit signature to frontend
        }

        // Handle text content (regular response)
        if (chunk.delta?.type === 'text_delta' || (chunk.delta?.text && !chunk.delta?.type)) {
          delta.content = chunk.delta.text;
        }

        // Handle tool use (partial function call arguments)
        if (chunk.delta?.type === 'input_json_delta' || chunk.delta?.partial_json) {
          // This is part of a tool_use block - we'll accumulate it
          delta.tool_calls = [{
            index: chunk.index || 0,
            function: {
              arguments: chunk.delta.partial_json || chunk.delta.input_json || ''
            }
          }];
        }

        // Only return if we have actual content
        if (Object.keys(delta).length === 0) {
          return null;
        }

        return {
          id: `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta,
            finish_reason: null
          }]
        };
      }

      // Handle content_block_start (start of thinking, text, or tool use block)
      if (chunk.type === 'content_block_start') {
        // Handle thinking block start (extended thinking feature)
        if (chunk.content_block?.type === 'thinking') {
          this.logger.debug({
            index: chunk.index,
            blockType: 'thinking'
          }, '[AWSBedrockProvider] 🧠 Starting thinking block');
          // Return a marker that thinking is starting (no content yet)
          return {
            id: `bedrock-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
              index: 0,
              delta: {
                thinking_started: true
              },
              finish_reason: null
            }]
          };
        }

        if (chunk.content_block?.type === 'tool_use') {
          // Starting a tool call
          return {
            id: `bedrock-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: chunk.index || 0,
                  id: chunk.content_block.id,
                  type: 'function',
                  function: {
                    name: chunk.content_block.name,
                    arguments: ''
                  }
                }]
              },
              finish_reason: null
            }]
          };
        }
        // Skip text content_block_start - we'll get the actual text in content_block_delta
        return null;
      }

      // Handle message_start (start of streaming)
      if (chunk.type === 'message_start') {
        return {
          id: chunk.message?.id || `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant'
            },
            finish_reason: null
          }]
        };
      }

      // Handle message_stop (end of streaming)
      if (chunk.type === 'message_stop') {
        return {
          id: `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: chunk.stop_reason || 'stop'
          }]
        };
      }

      // Handle message_delta (usage/metadata updates)
      if (chunk.type === 'message_delta') {
        const result: any = {
          id: `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: chunk.delta?.stop_reason || null
          }]
        };

        // Include usage if available
        if (chunk.usage) {
          result.usage = {
            prompt_tokens: chunk.usage.input_tokens || 0,
            completion_tokens: chunk.usage.output_tokens || 0,
            total_tokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0)
          };
        }

        return result;
      }

      // For other event types (content_block_start, content_block_stop), return empty delta
      // to keep the stream alive but don't emit content
      if (chunk.type === 'content_block_start' || chunk.type === 'content_block_stop') {
        return null; // Skip these events
      }
    }

    return null;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    if (!this.initialized || !this.bedrockClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    // Return all configured models from config (database) OR environment as fallback
    const models: Array<{ id: string; name: string; provider: string }> = [];
    const addedModels = new Set<string>();

    // Get models from config (set during initialize from database or environment)
    const chatModel = this.config?.chatModel || this.config?.modelId ||
                      process.env.AWS_BEDROCK_CHAT_MODEL || process.env.AWS_BEDROCK_MODEL_ID;
    const embeddingModel = this.config?.embeddingModel || process.env.AWS_BEDROCK_EMBEDDING_MODEL;
    const visionModel = this.config?.visionModel || process.env.AWS_BEDROCK_VISION_MODEL;
    const imageModel = this.config?.imageModel || process.env.AWS_BEDROCK_IMAGE_MODEL;
    const compactionModel = this.config?.compactionModel || process.env.AWS_BEDROCK_COMPACTION_MODEL;

    // Helper to add model if not already added
    const addModel = (modelId: string | undefined) => {
      if (modelId && !addedModels.has(modelId)) {
        addedModels.add(modelId);
        models.push({ id: modelId, name: modelId, provider: 'aws-bedrock' });
      }
    };

    addModel(chatModel);
    addModel(embeddingModel);
    addModel(visionModel);
    addModel(imageModel);
    addModel(compactionModel);

    // Add database-configured models from this.config.models array
    // These are stored when loaded from ProviderConfigService via admin API
    const dbConfiguredModels = (this.config as any)?.models as any[];
    if (Array.isArray(dbConfiguredModels)) {
      for (const dbModel of dbConfiguredModels) {
        if (dbModel.id && !addedModels.has(dbModel.id)) {
          addedModels.add(dbModel.id);
          models.push({
            id: dbModel.id,
            name: dbModel.name || dbModel.id,
            provider: 'aws-bedrock',
            capabilities: dbModel.capabilities || {
              chat: true,
              vision: true,
              tools: true,
              embeddings: false,
              imageGeneration: false,
              streaming: true
            },
            maxTokens: dbModel.maxTokens || 8192,
            contextWindow: dbModel.contextWindow || 200000,
            description: dbModel.description || `AWS Bedrock model: ${dbModel.id}`,
            configured: true
          } as any);
        }
      }
    }

    this.logger.debug({
      modelCount: models.length,
      models: models.map(m => m.id),
      fromConfig: !!this.config?.chatModel,
      dbModelsCount: dbConfiguredModels?.length || 0
    }, '[AWSBedrockProvider] Listed available models');

    return models;
  }

  /**
   * Generate text embeddings using Amazon Titan Embedding models
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    const embeddingModel = process.env.AWS_BEDROCK_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;
    if (!embeddingModel) {
      throw new Error('AWS Bedrock embedding model not configured (AWS_BEDROCK_EMBEDDING_MODEL)');
    }
    const texts = Array.isArray(text) ? text : [text];
    const embeddings: number[][] = [];

    for (const inputText of texts) {
      // Prepare request body for Titan embedding model
      const body = {
        inputText: inputText,
        dimensions: parseInt(process.env.AWS_BEDROCK_EMBEDDING_DIMENSION || process.env.EMBEDDING_DIMENSION || '1024'),
        normalize: true
      };

      const command = new InvokeModelCommand({
        modelId: embeddingModel,
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: 'application/json'
      });

      try {
        const response = await this.runtimeClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        // Titan returns: { embedding: number[], inputTextTokenCount: number }
        if (responseBody.embedding && Array.isArray(responseBody.embedding)) {
          embeddings.push(responseBody.embedding);
        } else {
          throw new Error('Invalid embedding response from Titan model');
        }
      } catch (error) {
        this.logger.error({
          error: error instanceof Error ? error.message : error,
          model: embeddingModel,
          textLength: inputText.length
        }, 'Failed to generate embedding');
        throw error;
      }
    }

    // Return single array if input was string, array of arrays if input was array
    return Array.isArray(text) ? embeddings : embeddings[0];
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.initialized || !this.bedrockClient) {
      return {
        status: 'not_initialized',
        provider: this.name,
        lastChecked: new Date()
      };
    }

    try {
      // Simple health check - list models
      await this.bedrockClient.send(new ListFoundationModelsCommand({}));

      return {
        status: 'healthy',
        provider: this.name,
        endpoint: this.config?.endpoint,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.config?.endpoint,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date()
      };
    }
  }

  private estimateCost(modelId: string, tokens: number): number {
    // Cost tracking is handled centrally by LLMMetricsService
    // Return 0 here - actual costs are calculated and stored when logging metrics
    return 0;
  }
}
