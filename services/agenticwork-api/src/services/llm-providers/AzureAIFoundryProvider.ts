/**
 * Azure AI Foundry Provider
 *
 * Implements ILLMProvider for Azure AI Foundry serverless models (Mistral, Llama, Claude, etc.)
 * Supports BOTH OpenAI-compatible and Anthropic API formats
 * PAYG billing with no quota limits - 200K TPM per deployment
 *
 * API Format Auto-Detection:
 * - If endpoint contains '/anthropic/', uses Anthropic Messages API format
 * - Otherwise, uses OpenAI-compatible Azure AI Model Inference API
 *
 * Supports BOTH authentication methods:
 * - API Key authentication (api-key header)
 * - Entra ID authentication (Azure AD bearer token)
 */

import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth,
  type ProviderConfig
} from './ILLMProvider.js';
import AnthropicFoundry from '@anthropic-ai/foundry-sdk';
import { getBearerTokenProvider, DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';

export class AzureAIFoundryProvider extends BaseLLMProvider {
  readonly name = 'azure-ai-foundry';
  readonly type = 'azure-openai' as const; // Type constraint workaround
  private endpointUrl: string;
  private apiKey: string;
  private model: string;
  private requestTimeout: number; // Timeout for fetch requests in milliseconds

  // API format detection
  private isAnthropicFormat: boolean;
  private anthropicClient?: AnthropicFoundry;

  // Smart model selection configuration
  private functionCallingModel: string; // GPT-5 or specific model for function calling
  private preferSpecificModel: boolean; // If true, avoid model-router for function calling
  private excludedModels: string[]; // Models to exclude from selection (e.g., DeepSeek)

  // Entra ID (Azure AD) authentication
  private useEntraAuth: boolean;
  private tenantId?: string;
  private clientId?: string;
  private clientSecret?: string;
  private tokenCache?: { token: string; expiresAt: number };

  constructor(logger: Logger, config?: {
    endpointUrl?: string;
    apiKey?: string;
    model?: string;
    functionCallingModel?: string;
    preferSpecificModel?: boolean;
    excludedModels?: string[];
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    requestTimeout?: number;
  }) {
    super(logger, 'azure-ai-foundry');
    this.endpointUrl = config?.endpointUrl || process.env.AIF_ENDPOINT_URL || '';
    this.apiKey = config?.apiKey || process.env.AIF_API_KEY || '';
    this.model = config?.model || process.env.AIF_MODEL || process.env.DEFAULT_MODEL;

    // Timeout configuration - default 120 seconds (Anthropic Claude with many tools can be slow)
    // Can be overridden via config or environment variable
    this.requestTimeout = config?.requestTimeout ||
                          parseInt(process.env.AIF_REQUEST_TIMEOUT || '120000', 10);

    // Detect API format from endpoint URL
    this.isAnthropicFormat = this.endpointUrl.includes('/anthropic/');

    // Smart model selection for function calling
    // Use a specific model (like gpt-5) for function calling instead of model-router
    // Research shows model-router may select gpt-5-mini which has poor function calling
    this.functionCallingModel = config?.functionCallingModel || process.env.AIF_FUNCTION_CALLING_MODEL || process.env.DEFAULT_MODEL;
    this.preferSpecificModel = config?.preferSpecificModel ?? (process.env.AIF_PREFER_SPECIFIC_MODEL === 'true');

    // Model exclusions (e.g., to avoid DeepSeek if tool call parsing is problematic)
    // Can be configured via environment variable: AIF_EXCLUDED_MODELS=deepseek,other-model
    const excludedModelsEnv = process.env.AIF_EXCLUDED_MODELS?.split(',').map(m => m.trim().toLowerCase()) || [];
    this.excludedModels = config?.excludedModels?.map(m => m.toLowerCase()) || excludedModelsEnv;

    // Entra ID credentials (optional - falls back to API key if not provided)
    this.tenantId = config?.tenantId || process.env.AIF_TENANT_ID;
    this.clientId = config?.clientId || process.env.AIF_CLIENT_ID;
    this.clientSecret = config?.clientSecret || process.env.AIF_CLIENT_SECRET;

    // Determine auth method: Entra ID if credentials present, otherwise API key
    this.useEntraAuth = !!(this.tenantId && this.clientId && this.clientSecret);

    // Initialize Anthropic client if using Anthropic format
    if (this.isAnthropicFormat) {
      // Normalize endpoint URL - should end with /anthropic/ not /anthropic/v1/messages
      let baseURL = this.endpointUrl;
      if (baseURL.includes('/v1/messages')) {
        baseURL = baseURL.replace(/\/v1\/messages.*$/, '/');
      } else if (!baseURL.endsWith('/')) {
        baseURL += '/';
      }

      if (this.useEntraAuth && this.tenantId && this.clientId && this.clientSecret) {
        // Use Azure AD authentication with token provider
        const credential = new ClientSecretCredential(
          this.tenantId,
          this.clientId,
          this.clientSecret
        );
        const tokenProvider = getBearerTokenProvider(
          credential,
          'https://cognitiveservices.azure.com/.default'
        );

        this.anthropicClient = new AnthropicFoundry({
          azureADTokenProvider: tokenProvider,
          baseURL: baseURL,
          timeout: this.requestTimeout,
          maxRetries: 0 // Disable retries - fail fast
        });

        this.logger.info({
          baseURL: baseURL.replace(/https:\/\/([^.]+)/, 'https://***'),
          authMethod: 'Azure AD Token Provider',
          timeout: this.requestTimeout
        }, '[AzureAIFoundryProvider] Initialized Anthropic client with Azure AD');
      } else if (this.apiKey) {
        // Fallback to API key (may not work for Azure AI Foundry)
        this.anthropicClient = new AnthropicFoundry({
          apiKey: this.apiKey,
          baseURL: baseURL,
          timeout: this.requestTimeout,
          maxRetries: 0 // Disable retries - fail fast
        });

        this.logger.warn({
          baseURL: baseURL.replace(/https:\/\/([^.]+)/, 'https://***'),
          authMethod: 'API Key (may not work)',
          timeout: this.requestTimeout
        }, '[AzureAIFoundryProvider] Initialized Anthropic client with API key - Azure AD recommended');
      }
    }

    if (!this.endpointUrl) {
      this.logger.warn('[AzureAIFoundryProvider] Missing endpoint URL - provider will not be functional');
    } else if (!this.useEntraAuth && !this.apiKey) {
      this.logger.warn('[AzureAIFoundryProvider] Missing both API key and Entra ID credentials - provider will not be functional');
    } else {
      this.initialized = true;
    }

    this.logger.info({
      endpointUrl: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
      model: this.model,
      apiFormat: this.isAnthropicFormat ? 'Anthropic Messages API' : 'OpenAI Compatible',
      authMethod: this.useEntraAuth ? 'Entra ID (Azure AD)' : 'API Key',
      hasApiKey: !!this.apiKey,
      hasEntraCredentials: this.useEntraAuth,
      requestTimeoutMs: this.requestTimeout,
      excludedModels: this.excludedModels.length > 0 ? this.excludedModels : 'none'
    }, '[AzureAIFoundryProvider] Initialized');
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    // AIF doesn't require initialization if credentials are present
    if (this.endpointUrl && (this.apiKey || this.useEntraAuth)) {
      this.initialized = true;
    }
  }

  /**
   * Get Azure AD access token for Entra ID authentication
   */
  private async getEntraToken(): Promise<string> {
    // Check cache first
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    if (!this.tenantId || !this.clientId || !this.clientSecret) {
      throw new Error('Entra ID credentials not configured');
    }

    try {
      const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://cognitiveservices.azure.com/.default'
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get Entra token: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // Cache token (expires_in is in seconds, cache for 5 minutes before expiry)
      const expiresAt = Date.now() + (data.expires_in - 300) * 1000;
      this.tokenCache = { token: data.access_token, expiresAt };

      this.logger.debug('[AzureAIFoundryProvider] Entra ID token obtained and cached');
      return data.access_token;

    } catch (error) {
      this.logger.error({ error }, '[AzureAIFoundryProvider] Failed to get Entra token');
      throw error;
    }
  }

  /**
   * Get authentication headers (API key or Entra ID bearer token)
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.useEntraAuth) {
      // Use Entra ID (Azure AD) authentication
      const token = await this.getEntraToken();
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Use API key authentication
      headers['api-key'] = this.apiKey;
    }

    return headers;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    // Return all configured models from environment (no hardcoded defaults)
    const models: Array<{ id: string; name: string; provider: string }> = [];
    const addedModels = new Set<string>();

    // Helper to add model if not already added
    const addModel = (modelId: string | undefined) => {
      if (modelId && !addedModels.has(modelId)) {
        addedModels.add(modelId);
        models.push({
          id: modelId,
          name: modelId,
          provider: 'azure-ai-foundry'
        });
      }
    };

    // Standardized model config (no hardcoded defaults)
    addModel(process.env.AIF_CHAT_MODEL || process.env.AIF_MODEL);
    addModel(process.env.AIF_EMBEDDING_MODEL);
    addModel(process.env.AIF_VISION_MODEL);
    addModel(process.env.AIF_IMAGE_MODEL);
    addModel(process.env.AIF_COMPACTION_MODEL);
    addModel(process.env.AIF_FUNCTION_CALLING_MODEL);

    // If no models configured, add the instance model if set
    if (models.length === 0 && this.model) {
      addModel(this.model);
    }

    return models;
  }

  /**
   * Convert OpenAI messages format to Anthropic Messages API format
   */
  private convertToAnthropicMessages(messages: CompletionRequest['messages']): {
    system?: string;
    messages: any[];
  } {
    let system: string | undefined;
    const anthropicMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic uses a separate system parameter
        system = msg.content;
      } else if (msg.role === 'tool') {
        // Tool result message
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content
          }]
        });
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        // Assistant message with tool calls
        const content: any[] = [];

        // Add text content if present
        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content
          });
        }

        // Add tool use blocks
        for (const toolCall of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments)
          });
        }

        anthropicMessages.push({
          role: 'assistant',
          content
        });
      } else {
        // Regular user or assistant message
        // Skip messages with empty content (Anthropic requires non-empty content)
        if (msg.content && msg.content.trim()) {
          anthropicMessages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }

    return { system, messages: anthropicMessages };
  }

  /**
   * Convert OpenAI tools format to Anthropic tools format
   */
  private convertToAnthropicTools(tools: any[] | undefined): any[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }));
  }

  /**
   * Convert Anthropic response to OpenAI format
   */
  private convertAnthropicResponseToOpenAI(anthropicResponse: any, modelName: string): CompletionResponse {
    const toolCalls: any[] = [];
    let textContent = '';

    // Extract content blocks
    for (const block of anthropicResponse.content || []) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      }
    }

    const message: any = {
      role: 'assistant',
      content: textContent
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: anthropicResponse.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{
        index: 0,
        message,
        finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' :
                      anthropicResponse.stop_reason === 'tool_use' ? 'tool_calls' :
                      anthropicResponse.stop_reason || 'stop'
      }],
      usage: {
        prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
        completion_tokens: anthropicResponse.usage?.output_tokens || 0,
        total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0)
      }
    };
  }

  /**
   * Detect and parse DeepSeek's proprietary tool call format
   * DeepSeek uses Unicode markers like: <｜tool▁calls▁begin｜>...<｜tool▁calls▁end｜>
   */
  private parseDeepSeekToolCalls(content: string): {
    toolCalls: any[];
    cleanedContent: string;
    hasDeepSeekMarkers: boolean;
  } {
    // DeepSeek tool call markers (Unicode full-width characters)
    const MARKERS = {
      toolCallsBegin: '<｜tool▁calls▁begin｜>',
      toolCallsEnd: '<｜tool▁calls▁end｜>',
      toolCallBegin: '<｜tool▁call▁begin｜>',
      toolCallEnd: '<｜tool▁call▁end｜>',
      toolSep: '<｜tool▁sep｜>'
    };

    // Check if content contains DeepSeek markers
    const hasDeepSeekMarkers = content.includes(MARKERS.toolCallsBegin) ||
                                content.includes(MARKERS.toolCallBegin);

    if (!hasDeepSeekMarkers) {
      return { toolCalls: [], cleanedContent: content, hasDeepSeekMarkers: false };
    }

    this.logger.info('[AzureAIFoundryProvider] Detected DeepSeek tool call markers - parsing');

    const toolCalls: any[] = [];
    let cleanedContent = content;

    try {
      // Extract the entire tool calls block
      const toolCallsPattern = new RegExp(
        `${MARKERS.toolCallsBegin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${MARKERS.toolCallsEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'g'
      );

      const toolCallsMatches = content.matchAll(toolCallsPattern);

      for (const match of toolCallsMatches) {
        const toolCallsBlock = match[1];

        // Extract individual tool calls from the block
        const toolCallPattern = new RegExp(
          `${MARKERS.toolCallBegin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${MARKERS.toolCallEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          'g'
        );

        const toolCallMatches = toolCallsBlock.matchAll(toolCallPattern);

        for (const toolCallMatch of toolCallMatches) {
          const toolCallContent = toolCallMatch[1];

          // Split by separator to get name and arguments
          const parts = toolCallContent.split(MARKERS.toolSep);

          if (parts.length >= 2) {
            const toolName = parts[0].trim();
            const toolArgsJson = parts[1].trim();

            try {
              // Parse the JSON arguments
              const toolArgs = JSON.parse(toolArgsJson);

              // Generate a unique ID for this tool call
              const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

              // Convert to OpenAI tool_calls format
              toolCalls.push({
                id: toolCallId,
                type: 'function',
                function: {
                  name: toolName,
                  arguments: toolArgsJson
                }
              });

              this.logger.info({
                toolName,
                toolCallId,
                argsLength: toolArgsJson.length
              }, '[AzureAIFoundryProvider] Parsed DeepSeek tool call');

            } catch (parseError) {
              this.logger.warn({
                error: parseError,
                toolCallContent
              }, '[AzureAIFoundryProvider] Failed to parse DeepSeek tool call JSON');
            }
          }
        }

        // Remove the entire tool calls block from content
        cleanedContent = cleanedContent.replace(match[0], '');
      }

      // Clean up any remaining markers that might be left over
      Object.values(MARKERS).forEach(marker => {
        cleanedContent = cleanedContent.replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      });

      // Trim whitespace
      cleanedContent = cleanedContent.trim();

      this.logger.info({
        toolCallsFound: toolCalls.length,
        originalLength: content.length,
        cleanedLength: cleanedContent.length
      }, '[AzureAIFoundryProvider] DeepSeek tool calls parsed successfully');

    } catch (error) {
      this.logger.error({
        error
      }, '[AzureAIFoundryProvider] Error parsing DeepSeek tool calls');
    }

    return { toolCalls, cleanedContent, hasDeepSeekMarkers: true };
  }

  /**
   * Convert Anthropic streaming chunk to OpenAI format
   */
  private convertAnthropicStreamChunkToOpenAI(event: any, modelName: string): any {
    if (event.type === 'message_start') {
      return {
        id: event.message.id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: { content: '' },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: { content: event.delta.text },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: event.content_block.id,
              type: 'function',
              function: {
                name: event.content_block.name,
                arguments: ''
              }
            }]
          },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: event.delta.partial_json
              }
            }]
          },
          finish_reason: null
        }]
      };
    } else if (event.type === 'message_delta') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: event.delta?.stop_reason === 'end_turn' ? 'stop' :
                        event.delta?.stop_reason === 'tool_use' ? 'tool_calls' :
                        event.delta?.stop_reason || null
        }],
        usage: event.usage ? {
          prompt_tokens: event.usage.input_tokens || 0,
          completion_tokens: event.usage.output_tokens || 0,
          total_tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
        } : undefined
      };
    }

    return null;
  }

  /**
   * Get the endpoint URL
   *
   * NOTE: We always use the model-router endpoint because that's the only deployment
   * that exists in Azure AI Foundry. The model-router internally routes to different
   * models based on the 'model' field in the request body.
   *
   * DO NOT try to change the deployment name in the URL - there are no separate
   * deployments for gpt-5, gpt-5-mini, etc. They are all accessed through model-router.
   * The model selection happens via the 'model' field in the request JSON body.
   */
  private getEndpointUrl(): string {
    return this.endpointUrl;
  }

  /**
   * Detect if a model uses max_completion_tokens instead of max_tokens
   * Based on environment configuration or version parsing (NO HARDCODED MODELS)
   */
  private modelUsesMaxCompletionTokens(model: string): boolean {
    // Check if model is in env-configured list
    const maxCompletionTokensModels = (process.env.MAX_COMPLETION_TOKENS_MODELS || '').split(',').map(m => m.trim().toLowerCase());
    const modelLower = model.toLowerCase();

    if (maxCompletionTokensModels.some(m => m && modelLower.includes(m))) {
      return true;
    }

    // Parse version from model name (e.g., gpt-5.1, gpt-6)
    const gptMatch = modelLower.match(/gpt-?(\d+)\.?(\d*)/);
    if (gptMatch) {
      const major = parseInt(gptMatch[1]);
      const minor = parseInt(gptMatch[2] || '0');

      // Version-based detection: GPT-5.1+ uses max_completion_tokens
      if (major > 5 || (major === 5 && minor >= 1)) {
        return true;
      }
    }

    // Default to max_tokens
    return false;
  }

  /**
   * Intelligent model selection based on request characteristics
   * Azure model-router cannot be controlled via API parameters, so we implement
   * application-level routing to ensure optimal model selection
   *
   * NOTE: DeepSeek models use proprietary tool call format with Unicode markers.
   * If model-router selects DeepSeek, the parseDeepSeekToolCalls() method will
   * automatically detect and convert the markers to standard OpenAI format.
   * Alternatively, you can exclude DeepSeek via AIF_EXCLUDED_MODELS env var.
   */
  private selectModel(request: CompletionRequest): { model: string; reason: string } {
    const hasTools = request.tools && request.tools.length > 0;
    const toolCount = request.tools?.length || 0;
    const isComplexFunctionCalling = toolCount > 3; // More than 3 tools = complex

    // If preferSpecificModel is enabled and request has tools, use dedicated function calling model
    if (this.preferSpecificModel && hasTools) {
      return {
        model: this.functionCallingModel,
        reason: `Function calling detected (${toolCount} tools) - using dedicated model for 96.7% accuracy`
      };
    }

    // If complex function calling (many tools), always use specific model
    if (isComplexFunctionCalling) {
      return {
        model: this.functionCallingModel,
        reason: `Complex function calling (${toolCount} tools) - using ${this.functionCallingModel} for best results`
      };
    }

    // Use model-router for simple queries or when specific model not preferred
    const requestedModel = request.model || this.model;
    return {
      model: requestedModel,
      reason: hasTools
        ? `Simple function calling (${toolCount} tools) - using ${requestedModel}`
        : `No tools - using ${requestedModel} for cost optimization`
    };
  }

  /**
   * Create chat completion (supports both OpenAI and Anthropic formats)
   */
  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();

    try {
      this.metrics.totalRequests++;

      // Route to appropriate implementation based on API format
      if (this.isAnthropicFormat) {
        return await this.createAnthropicCompletion(request, startTime);
      } else {
        return await this.createOpenAICompletion(request, startTime);
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Completion failed');
      throw error;
    }
  }

  /**
   * Create chat completion using Anthropic Messages API
   */
  private async createAnthropicCompletion(
    request: CompletionRequest,
    startTime: number
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    const { system, messages } = this.convertToAnthropicMessages(request.messages);
    const tools = this.convertToAnthropicTools(request.tools);

    // Anthropic doesn't support "model-router" - use configured Claude model instead
    let modelToUse = request.model || this.model;
    if (modelToUse === 'model-router' || modelToUse.includes('router')) {
      modelToUse = this.model === 'model-router' ? (process.env.AIF_ANTHROPIC_MODEL || process.env.DEFAULT_MODEL) : this.model;
      this.logger.debug({
        requestedModel: request.model,
        actualModel: modelToUse
      }, '[AzureAIFoundryProvider] Overriding model-router for Anthropic API');
    }

    // Anthropic doesn't allow both temperature and top_p
    // Prefer temperature if both are provided
    const anthropicRequest: any = {
      model: modelToUse,
      messages,
      max_tokens: request.max_tokens ?? 8192,
      stream: request.stream ?? true
    };

    // Only set temperature (Anthropic doesn't support both temperature and top_p)
    // Use environment variable for default, no hardcoded fallback
    const anthropicDefaultTemp = parseFloat(process.env.AIF_TEMPERATURE || '1.0');
    anthropicRequest.temperature = request.temperature ?? anthropicDefaultTemp;

    if (system) {
      anthropicRequest.system = system;
    }

    if (tools && tools.length > 0) {
      anthropicRequest.tools = tools;

      // Convert tool_choice
      if (request.tool_choice) {
        if (request.tool_choice === 'auto') {
          anthropicRequest.tool_choice = { type: 'auto' };
        } else if (request.tool_choice === 'required') {
          anthropicRequest.tool_choice = { type: 'any' };
        } else if (typeof request.tool_choice === 'object' && request.tool_choice.function) {
          anthropicRequest.tool_choice = {
            type: 'tool',
            name: request.tool_choice.function.name
          };
        }
      }
    }

    // Calculate payload size for diagnostics
    const payloadSize = JSON.stringify(anthropicRequest).length;
    const totalMessageChars = messages.reduce((sum: number, msg: any) =>
      sum + (typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length), 0);

    this.logger.info({
      model: anthropicRequest.model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      hasSystem: !!system,
      systemLength: system?.length || 0,
      stream: request.stream,
      payloadSizeKB: Math.round(payloadSize / 1024),
      totalMessageChars,
      maxTokens: anthropicRequest.max_tokens
    }, '[AzureAIFoundryProvider] Creating Anthropic completion');

    if (request.stream) {
      return this.streamAnthropicCompletion(anthropicRequest, startTime);
    } else {
      return await this.nonStreamAnthropicCompletion(anthropicRequest, startTime);
    }
  }

  /**
   * Create chat completion using OpenAI-compatible API
   */
  private async createOpenAICompletion(
    request: CompletionRequest,
    startTime: number
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    // Smart model selection based on request characteristics
    const { model: selectedModel, reason } = this.selectModel(request);

    // IMPORTANT: Azure model-router deployment IGNORES the 'model' field in API requests.
    // The model-router makes its own decision about which underlying model to use.
    // To actually control model selection, you need SEPARATE DEPLOYMENTS for each model.
    //
    // This selection is still useful for:
    // 1. Logging which model SHOULD be used for this request
    // 2. Future support when separate deployments are available
    // 3. Other providers (Anthropic, Ollama) that DO respect the model field

    // Build OpenAI-compatible request - adapt parameters based on model
    const maxTokens = request.max_tokens ?? 8192;

    // GPT-5.x models only support temperature=1, so don't include temperature for those
    const isGPT5 = selectedModel.toLowerCase().includes('gpt-5');
    const defaultTemperature = parseFloat(process.env.AIF_TEMPERATURE || '1.0');

    const aifRequest: any = {
      model: selectedModel,
      messages: request.messages,
      top_p: request.top_p ?? 1,
      stream: request.stream ?? true
    };

    // Only include temperature if NOT a GPT-5 model (they only support default=1)
    if (!isGPT5) {
      aifRequest.temperature = request.temperature ?? defaultTemperature;
    }

    // GPT-5.1+ and o1/o3 models use max_completion_tokens instead of max_tokens
    // Detect based on model name pattern
    const usesMaxCompletionTokens = this.modelUsesMaxCompletionTokens(selectedModel);
    if (usesMaxCompletionTokens) {
      aifRequest.max_completion_tokens = maxTokens;
    } else {
      aifRequest.max_tokens = maxTokens;
    }

    // Add tools if present (OpenAI tool format)
    if (request.tools && request.tools.length > 0) {
      aifRequest.tools = request.tools;

      // Optimize tool_choice for better function calling
      // "auto" = model decides (best for GPT-5)
      // "required" = force function call (not supported by all models)
      aifRequest.tool_choice = request.tool_choice || 'auto';
    }

    // Pass through reasoning_effort if provided (let the API handle unsupported params)
    if ((request as any).reasoning_effort) {
      aifRequest.reasoning_effort = (request as any).reasoning_effort;
      this.logger.info({
        model: selectedModel,
        reasoning_effort: aifRequest.reasoning_effort
      }, '[AzureAIFoundryProvider] 🧠 Reasoning effort parameter included');
    }

    this.logger.info({
      requestedModel: request.model,
      selectedModel,
      selectionReason: reason,
      messageCount: request.messages.length,
      toolCount: request.tools?.length || 0,
      preferSpecificModel: this.preferSpecificModel,
      stream: request.stream,
      endpoint: this.endpointUrl.includes('model-router') ? 'model-router (WARNING: ignores model field)' : 'direct'
    }, '[AzureAIFoundryProvider] Creating OpenAI completion');

    // Warn if using model-router with tools - model-router may select a less capable model
    if (this.endpointUrl.includes('model-router') && request.tools && request.tools.length > 0) {
      this.logger.warn({
        selectedModel,
        toolCount: request.tools.length,
        note: 'model-router may select gpt-5-nano which has ~65% function calling accuracy'
      }, '[AzureAIFoundryProvider] ⚠️ Using model-router with tools - consider separate deployments for reliable function calling');
    }

    if (request.stream) {
      return this.streamCompletion(aifRequest, selectedModel, startTime);
    } else {
      return await this.nonStreamCompletion(aifRequest, selectedModel, startTime);
    }
  }

  /**
   * Stream Anthropic completion (returns AsyncGenerator)
   */
  private async *streamAnthropicCompletion(
    anthropicRequest: any,
    startTime: number
  ): AsyncGenerator<any> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const streamParams: any = {
        model: anthropicRequest.model,
        messages: anthropicRequest.messages,
        max_tokens: anthropicRequest.max_tokens,
        temperature: anthropicRequest.temperature
      };

      // Only add optional params if they exist
      if (anthropicRequest.system) streamParams.system = anthropicRequest.system;
      if (anthropicRequest.tools) streamParams.tools = anthropicRequest.tools;
      if (anthropicRequest.tool_choice) streamParams.tool_choice = anthropicRequest.tool_choice;

      const stream = this.anthropicClient.messages.stream(streamParams);

      let totalTokens = 0;
      const modelName = anthropicRequest.model;

      for await (const event of stream) {
        const chunk = this.convertAnthropicStreamChunkToOpenAI(event, modelName);
        if (chunk) {
          yield chunk;

          // Track tokens from usage events
          if (chunk.usage) {
            totalTokens = chunk.usage.total_tokens || 0;
          }

          // Check if done
          if (chunk.choices?.[0]?.finish_reason) {
            const latency = Date.now() - startTime;
            this.trackSuccess(latency, totalTokens, 0);

            this.logger.info({
              model: modelName,
              duration: latency,
              totalTokens
            }, '[AzureAIFoundryProvider] Anthropic stream completed');
          }
        }
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Anthropic stream failed');
      throw error;
    }
  }

  /**
   * Non-streaming Anthropic completion
   */
  private async nonStreamAnthropicCompletion(
    anthropicRequest: any,
    startTime: number
  ): Promise<CompletionResponse> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const response = await this.anthropicClient.messages.create({
        ...anthropicRequest,
        stream: false
      });

      const totalTokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      const latency = Date.now() - startTime;
      this.trackSuccess(latency, totalTokens, 0);

      this.logger.info({
        model: anthropicRequest.model,
        duration: latency,
        totalTokens
      }, '[AzureAIFoundryProvider] Anthropic completion completed');

      return this.convertAnthropicResponseToOpenAI(response, anthropicRequest.model);
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Anthropic non-stream completion failed');
      throw error;
    }
  }

  /**
   * Stream completion (returns AsyncGenerator)
   */
  private async *streamCompletion(
    aifRequest: any,
    modelName: string,
    startTime: number
  ): AsyncGenerator<any> {
    try {
      const headers = await this.getAuthHeaders();
      const endpointUrl = this.getEndpointUrl();
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(aifRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AIF API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body from AIF');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalTokens = 0;
      let accumulatedContent = ''; // Accumulate content to detect DeepSeek markers

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          if (line.includes('[DONE]')) continue;

          try {
            const data = line.slice(6); // Remove 'data: ' prefix
            const chunk = JSON.parse(data);

            // Accumulate content from deltas to detect DeepSeek markers
            if (chunk.choices?.[0]?.delta?.content) {
              accumulatedContent += chunk.choices[0].delta.content;
            }

            // Extract reasoning content for o3-mini and other reasoning models
            // OpenAI returns reasoning in message.reasoning_content (non-streaming)
            // or delta.reasoning_content (streaming)
            const reasoningContent = chunk.choices?.[0]?.delta?.reasoning_content ||
                                     chunk.choices?.[0]?.message?.reasoning_content;

            if (reasoningContent) {
              // Emit reasoning as thinking content
              const thinkingChunk = {
                ...chunk,
                choices: [{
                  ...chunk.choices[0],
                  delta: {
                    ...chunk.choices[0].delta,
                    thinking: reasoningContent,
                    reasoning: reasoningContent
                  }
                }],
                thinking_content: reasoningContent,
                reasoning_content: reasoningContent
              };
              yield thinkingChunk;
              continue; // Don't yield the original chunk, we've yielded the thinking version
            }

            // Check if we have a complete message (finish_reason present)
            if (chunk.choices?.[0]?.finish_reason) {
              // Parse DeepSeek tool calls if present
              const { toolCalls, cleanedContent, hasDeepSeekMarkers } =
                this.parseDeepSeekToolCalls(accumulatedContent);

              if (hasDeepSeekMarkers) {
                // Create a corrected chunk with parsed tool calls
                const correctedChunk = {
                  ...chunk,
                  choices: [{
                    ...chunk.choices[0],
                    delta: {
                      content: cleanedContent,
                      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    },
                    finish_reason: toolCalls.length > 0 ? 'tool_calls' : chunk.choices[0].finish_reason
                  }]
                };

                yield correctedChunk;
              } else {
                yield chunk;
              }

              // Track tokens
              if (chunk.usage) {
                totalTokens = chunk.usage.total_tokens || 0;
              }

              // Track success
              const latency = Date.now() - startTime;
              this.trackSuccess(latency, totalTokens, 0);

              this.logger.info({
                model: modelName,
                duration: latency,
                totalTokens,
                hadDeepSeekMarkers: hasDeepSeekMarkers
              }, '[AzureAIFoundryProvider] Stream completed');
            } else {
              // Not done yet, yield the chunk as-is
              yield chunk;

              // Track tokens
              if (chunk.usage) {
                totalTokens = chunk.usage.total_tokens || 0;
              }
            }
          } catch (parseError) {
            this.logger.warn({ line, error: parseError }, '[AzureAIFoundryProvider] Failed to parse chunk');
          }
        }
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Stream failed');
      throw error;
    }
  }

  /**
   * Non-streaming completion
   */
  private async nonStreamCompletion(
    aifRequest: any,
    modelName: string,
    startTime: number
  ): Promise<CompletionResponse> {
    try {
      const headers = await this.getAuthHeaders();
      const endpointUrl = this.getEndpointUrl();
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...aifRequest, stream: false })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AIF API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      // Check for DeepSeek markers in the response content
      if (data.choices?.[0]?.message?.content) {
        const { toolCalls, cleanedContent, hasDeepSeekMarkers } =
          this.parseDeepSeekToolCalls(data.choices[0].message.content);

        if (hasDeepSeekMarkers) {
          // Update the response with parsed tool calls and cleaned content
          data.choices[0].message.content = cleanedContent;

          if (toolCalls.length > 0) {
            data.choices[0].message.tool_calls = toolCalls;
            data.choices[0].finish_reason = 'tool_calls';
          }

          this.logger.info({
            model: modelName,
            toolCallsFound: toolCalls.length
          }, '[AzureAIFoundryProvider] DeepSeek markers detected and parsed in non-streaming response');
        }
      }

      const totalTokens = data.usage?.total_tokens || 0;
      const latency = Date.now() - startTime;
      this.trackSuccess(latency, totalTokens, 0);

      this.logger.info({
        model: modelName,
        duration: latency,
        totalTokens
      }, '[AzureAIFoundryProvider] Completion completed');

      return data;
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Non-stream completion failed');
      throw error;
    }
  }

  /**
   * Generate text embeddings using Azure OpenAI embedding API
   * Note: Azure AI Foundry doesn't have a dedicated embedding endpoint,
   * so we use the Azure OpenAI embedding service directly
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    try {
      const input = Array.isArray(text) ? text : [text];

      // Get embedding configuration from environment
      const embeddingEndpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
      const embeddingModel = process.env.DEFAULT_EMBEDDING_DEPLOYMENT ||
                            process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
                            process.env.EMBEDDING_MODEL;
      const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || '2024-10-21';

      if (!embeddingEndpoint) {
        throw new Error('Embedding endpoint not configured. Set AZURE_OPENAI_EMBEDDING_ENDPOINT or AZURE_OPENAI_ENDPOINT');
      }

      // Build the embeddings API URL
      // If AZURE_OPENAI_EMBEDDING_ENDPOINT already contains /embeddings, use it directly
      // Otherwise build the full URL from base endpoint + deployment
      let url: string;
      if (embeddingEndpoint.includes('/embeddings')) {
        // Full endpoint URL provided (e.g., https://xxx.cognitiveservices.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-10-21)
        url = embeddingEndpoint;
      } else {
        // Base endpoint provided, build full URL
        url = `${embeddingEndpoint}/openai/deployments/${embeddingModel}/embeddings?api-version=${apiVersion}`;
      }

      const headers = await this.getAuthHeaders();

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        endpoint: embeddingEndpoint.replace(/https:\/\/([^.]+)/, 'https://***')
      }, '[AzureAIFoundryProvider] Generating embeddings via Azure OpenAI');

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const embeddings = data.data.map((item: any) => item.embedding);

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        dimensions: embeddings[0]?.length
      }, '[AzureAIFoundryProvider] Embeddings generated successfully');

      return Array.isArray(text) ? embeddings : embeddings[0];

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : error
      }, '[AzureAIFoundryProvider] Embedding generation failed');
      throw error;
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<ProviderHealth> {
    try {
      if (!this.endpointUrl) {
        return {
          status: 'not_initialized',
          provider: this.name,
          error: 'Missing endpoint URL',
          lastChecked: new Date()
        };
      }

      if (!this.useEntraAuth && !this.apiKey) {
        return {
          status: 'not_initialized',
          provider: this.name,
          error: 'Missing both API key and Entra ID credentials',
          lastChecked: new Date()
        };
      }

      // Simple health check with minimal request
      // Use the appropriate API format
      if (this.isAnthropicFormat && this.anthropicClient) {
        // Anthropic Messages API health check
        try {
          await this.anthropicClient.messages.create({
            model: this.model,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1
          });

          return {
            status: 'healthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            lastChecked: new Date()
          };
        } catch (error: any) {
          return {
            status: 'unhealthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            error: error.message || 'Anthropic API error',
            lastChecked: new Date()
          };
        }
      } else {
        // OpenAI-compatible API health check
        const headers = await this.getAuthHeaders();
        const response = await fetch(this.endpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1,
            stream: false
          }),
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          return {
            status: 'healthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            lastChecked: new Date()
          };
        } else {
          return {
            status: 'unhealthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            error: `HTTP ${response.status}`,
            lastChecked: new Date()
          };
        }
      }
    } catch (error) {
      this.logger.error({ error }, '[AzureAIFoundryProvider] Health check failed');
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date()
      };
    }
  }
}
