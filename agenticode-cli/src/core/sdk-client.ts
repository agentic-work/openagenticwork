/**
 * SDK Client
 *
 * Wraps @agenticwork/sdk for CLI usage.
 * Fetches available models and providers from the API and routes requests
 * DIRECTLY to providers (not through chat completions pipeline).
 *
 * ARCHITECTURE:
 * - Config/credentials: fetched from API (/api/agenticode/config)
 * - LLM calls: DIRECT to providers using credentials from config
 * - MCP: through API (for auth context)
 * - Flowise: through API (for auth context)
 */

import { AgenticWorkPlatform } from '@agentic-work/sdk';
import type { StreamChunk, Message, ToolDefinition } from './types.js';

export interface SDKClientConfig {
  apiEndpoint: string;
  authToken?: string;
  ollamaHost?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  type: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
  defaultModel: string;
  providers: string[];
}

/**
 * SDK-backed client that:
 * 1. Fetches available providers/models from the API (/api/agenticode/config)
 * 2. Routes requests DIRECTLY to the appropriate provider (NOT through API pipeline)
 * 3. Uses the SDK's platform for MCP/Flowise (through API for auth context)
 */
export class SDKClient {
  private config: SDKClientConfig;
  private platform: AgenticWorkPlatform;
  private availableModels: ModelInfo[] = [];
  private defaultModel: string = '';
  private initialized = false;

  constructor(config: SDKClientConfig) {
    this.config = config;
    this.platform = new AgenticWorkPlatform({
      apiEndpoint: config.apiEndpoint,
      authToken: config.authToken,
    });
  }

  /**
   * Initialize the SDK client by fetching agenticode config from the API
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Fetch agenticode config (provider credentials + models)
      const agenticodeConfig = await this.platform.getAgenticodeConfig();

      // Build model list from agenticode config
      this.availableModels = agenticodeConfig.models.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.providerId,
        type: 'llm',
      }));

      this.defaultModel = agenticodeConfig.defaultModel || '';

      this.initialized = true;

      if (process.env.AWCODE_DEBUG) {
        console.error(`[SDKClient] Initialized with ${this.availableModels.length} models from ${agenticodeConfig.providers.length} providers`);
        console.error(`[SDKClient] Default model: ${this.defaultModel}`);
        console.error(`[SDKClient] Providers: ${agenticodeConfig.providers.map(p => p.id).join(', ')}`);
      }
    } catch (error) {
      // SDK initialization failed - this is expected if:
      // 1. No API endpoint configured
      // 2. Token expired/invalid
      // 3. API server not reachable
      // The CLI will fall back to direct Ollama which works without auth
      if (process.env.AWCODE_DEBUG) {
        console.error('[SDKClient] API config fetch failed (falling back to Ollama):', error);
      }
      // Allow partial initialization with Ollama fallback
      if (this.config.ollamaHost) {
        // Manually initialize Ollama as fallback
        this.availableModels = [
          { id: 'devstral', name: 'Devstral', provider: 'ollama-local', type: 'llm' },
          { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', provider: 'ollama-local', type: 'llm' },
        ];
        this.defaultModel = 'devstral';
      }
      this.initialized = true;
    }
  }

  /**
   * Get the default model from the API config
   */
  getDefaultModel(): string {
    return this.defaultModel || 'devstral'; // Fallback to devstral if API unavailable
  }

  /**
   * Get available models
   */
  getAvailableModels(): ModelInfo[] {
    return this.availableModels;
  }

  /**
   * Resolve model name to actual model and provider
   * Handles 'auto' by selecting the default from API
   */
  resolveModel(model: string): { model: string; provider: string } {
    if (model === 'auto' || !model) {
      // Use default from API
      const defaultModel = this.getDefaultModel();
      const modelInfo = this.availableModels.find(m => m.id === defaultModel);
      return {
        model: defaultModel,
        provider: modelInfo?.provider || this.detectProvider(defaultModel),
      };
    }

    // Handle ollama/* prefix
    if (model.startsWith('ollama/')) {
      return {
        model: model.substring(7), // Strip prefix
        provider: 'ollama',
      };
    }

    // Look up in available models
    const modelInfo = this.availableModels.find(m => m.id === model);
    if (modelInfo) {
      return { model: modelInfo.id, provider: modelInfo.provider };
    }

    // Detect provider from model name
    return { model, provider: this.detectProvider(model) };
  }

  /**
   * Detect provider from model name
   */
  private detectProvider(model: string): string {
    const modelLower = model.toLowerCase();

    // Ollama models
    if (modelLower.includes('gpt-oss') ||
        modelLower.includes('llama') ||
        modelLower.includes('mistral') ||
        modelLower.includes('devstral') ||
        modelLower.includes('codellama') ||
        modelLower.includes('phi') ||
        modelLower.includes('qwen') ||
        modelLower.includes('deepseek') ||
        modelLower.includes('codegemma') ||
        modelLower.includes('starcoder')) {
      return 'ollama';
    }

    // Claude models (Anthropic)
    if (modelLower.includes('claude')) {
      return 'anthropic';
    }

    // Google Vertex AI / Gemini
    if (modelLower.includes('gemini')) {
      return 'vertex-ai';
    }

    // OpenAI
    if (modelLower.includes('gpt-4') || modelLower.includes('gpt-35') || modelLower.includes('gpt-3.5')) {
      return 'openai';
    }

    // Default to ollama for unrecognized models (local-first)
    return 'ollama';
  }

  /**
   * Stream chat completion using DIRECT provider access
   * Does NOT go through /api/v1/chat/completions
   */
  async *chatStream(
    request: {
      model: string;
      messages: Message[];
      tools?: ToolDefinition[];
      temperature?: number;
      maxTokens?: number;
    },
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const { model, provider } = this.resolveModel(request.model);

    if (process.env.AWCODE_DEBUG) {
      console.error(`[SDKClient] Routing DIRECT to provider: ${provider}, model: ${model}`);
    }

    // Use the SDK platform's direct provider streaming
    try {
      // Cast tools to SDK format
      const sdkTools = request.tools?.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as unknown as Record<string, unknown>,
      }));

      // Stream DIRECTLY from platform (which routes to direct providers)
      const stream = this.platform.streamComplete({
        model,
        messages: request.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join(''),
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
        })),
        tools: sdkTools,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      });

      // Accumulate tool call deltas by id to avoid emitting partial tool calls
      const pendingToolCalls: Map<string, { id: string; name: string; argumentsStr: string }> = new Map();

      for await (const chunk of stream) {
        // Map SDK chunk types to CLI chunk types
        if (chunk.type === 'text_delta') {
          yield { type: 'text', text: chunk.text };
        } else if (chunk.type === 'tool_call_delta') {
          // Accumulate tool call deltas
          const toolId = chunk.toolCall.id || '';
          const toolName = chunk.toolCall.name || '';
          const argsChunk = typeof chunk.toolCall.arguments === 'string' ? chunk.toolCall.arguments : '';

          if (toolId) {
            // New tool call or update existing
            const existing = pendingToolCalls.get(toolId);
            if (existing) {
              existing.argumentsStr += argsChunk;
            } else {
              pendingToolCalls.set(toolId, {
                id: toolId,
                name: toolName,
                argumentsStr: argsChunk,
              });
            }
          } else if (pendingToolCalls.size > 0) {
            // Delta without id - append to the last tool call
            const lastEntry = Array.from(pendingToolCalls.values()).pop();
            if (lastEntry) {
              lastEntry.argumentsStr += argsChunk;
            }
          }
        } else if (chunk.type === 'done') {
          // Emit all accumulated tool calls before done
          for (const [id, toolCall] of pendingToolCalls) {
            let args: Record<string, unknown> = {};
            try {
              if (toolCall.argumentsStr) {
                args = JSON.parse(toolCall.argumentsStr);
                // CRITICAL: Unwrap common wrapper patterns that models incorrectly use
                const wrapperKeys = ['value', 'input', 'arguments', 'params', 'parameters'];
                for (const wrapperKey of wrapperKeys) {
                  if (args[wrapperKey] &&
                      typeof args[wrapperKey] === 'object' &&
                      Object.keys(args).length === 1) {
                    if (process.env.AWCODE_DEBUG) {
                      console.error(`[SDKClient] Unwrapping "${wrapperKey}" wrapper for ${toolCall.name}`);
                    }
                    args = args[wrapperKey] as Record<string, unknown>;
                    break;
                  }
                }
              }
            } catch {
              // Keep empty args if parsing fails
            }
            yield {
              type: 'tool_call',
              toolCall: {
                id: toolCall.id,
                name: toolCall.name,
                arguments: args,
              },
            };
          }
          pendingToolCalls.clear();

          yield {
            type: 'done',
            finishReason: chunk.finishReason as 'stop' | 'tool_calls' | undefined,
            usage: chunk.usage,
          };
        } else if (chunk.type === 'error') {
          yield { type: 'error', error: chunk.error };
        }
      }

      // Emit any remaining tool calls at the end
      for (const [id, toolCall] of pendingToolCalls) {
        let args: Record<string, unknown> = {};
        try {
          if (toolCall.argumentsStr) {
            args = JSON.parse(toolCall.argumentsStr);
            // CRITICAL: Unwrap common wrapper patterns that models incorrectly use
            const wrapperKeys = ['value', 'input', 'arguments', 'params', 'parameters'];
            for (const wrapperKey of wrapperKeys) {
              if (args[wrapperKey] &&
                  typeof args[wrapperKey] === 'object' &&
                  Object.keys(args).length === 1) {
                if (process.env.AWCODE_DEBUG) {
                  console.error(`[SDKClient] Unwrapping "${wrapperKey}" wrapper for ${toolCall.name}`);
                }
                args = args[wrapperKey] as Record<string, unknown>;
                break;
              }
            }
          }
        } catch {
          // Keep empty args if parsing fails
        }
        yield {
          type: 'tool_call',
          toolCall: {
            id: toolCall.id,
            name: toolCall.name,
            arguments: args,
          },
        };
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get the platform instance for MCP/Flowise access
   */
  getPlatform(): AgenticWorkPlatform {
    return this.platform;
  }
}

/**
 * Create an SDK client instance
 */
export function createSDKClient(config: SDKClientConfig): SDKClient {
  return new SDKClient(config);
}
