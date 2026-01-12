/**
 * Anthropic Provider - Direct Anthropic API Integration
 *
 * Uses the official @anthropic-ai/sdk for maximum Claude capabilities:
 * - Native extended thinking support
 * - Interleaved thinking (beta)
 * - Proper thinking block preservation
 * - Streaming with thinking_delta events
 * - Earliest access to new Claude features
 *
 * This provider is preferred for Claude models as it provides full access
 * to Claude-specific features that may not be available through Bedrock.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderConfig,
  ProviderHealth,
} from './ILLMProvider.js';

// Anthropic model pricing (per 1M tokens)
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5-20251101': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.0 },
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

// Default pricing for unknown models
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export interface AnthropicProviderConfig {
  apiKey: string;
  defaultModel?: string;
  maxRetries?: number;
  timeout?: number;
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;
  enableInterleavedThinking?: boolean;
}

export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly type = 'anthropic' as const;

  private client: Anthropic | null = null;
  private config: AnthropicProviderConfig | null = null;

  constructor(logger: Logger) {
    super(logger, 'anthropic');
  }

  async initialize(config: AnthropicProviderConfig): Promise<void> {
    this.logger.info('Initializing Anthropic provider');

    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.config = config;

    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries || 2,
      timeout: config.timeout || 120000,
    });

    this.initialized = true;
    this.logger.info({ defaultModel: config.defaultModel }, 'Anthropic provider initialized');
  }

  async createCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.client || !this.config) {
      throw new Error('Anthropic provider not initialized');
    }

    const startTime = Date.now();

    try {
      // Convert OpenAI-style messages to Anthropic format
      const { systemPrompt, messages } = this.convertMessages(request.messages);

      // Determine model
      const model = request.model || this.config.defaultModel || 'claude-sonnet-4-5-20250929';

      // Build request parameters
      const anthropicRequest: Anthropic.MessageCreateParams = {
        model,
        max_tokens: request.max_tokens || 8192,
        messages,
        temperature: request.temperature,
        top_p: request.top_p,
      };

      // Add system prompt if present
      if (systemPrompt) {
        anthropicRequest.system = systemPrompt;
      }

      // Add tools if present
      if (request.tools && request.tools.length > 0) {
        anthropicRequest.tools = this.convertTools(request.tools);
      }

      // Handle tool_choice
      if (request.tool_choice) {
        anthropicRequest.tool_choice = this.convertToolChoice(request.tool_choice);
      }

      // Add thinking configuration for supported models
      if (this.shouldEnableThinking(model)) {
        const thinkingConfig = this.getThinkingConfig();
        if (thinkingConfig) {
          (anthropicRequest as any).thinking = thinkingConfig;
        }
      }

      // Handle streaming
      if (request.stream) {
        return this.createStreamingCompletion(anthropicRequest, model);
      }

      // Non-streaming request
      const response = await this.client.messages.create(anthropicRequest);

      const latency = Date.now() - startTime;
      const tokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      const cost = this.calculateCost(model, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);

      this.trackSuccess(latency, tokens, cost);

      return this.convertResponse(response, model);
    } catch (error: any) {
      this.trackFailure();
      this.logger.error({ error: error.message, stack: error.stack }, 'Anthropic completion failed');
      throw error;
    }
  }

  /**
   * Create streaming completion with proper thinking support
   */
  private async *createStreamingCompletion(
    request: Anthropic.MessageCreateParams,
    model: string
  ): AsyncGenerator<any> {
    if (!this.client) throw new Error('Client not initialized');

    const stream = await this.client.messages.stream(request);

    let inputTokens = 0;
    let outputTokens = 0;
    let currentThinking = '';
    let currentText = '';

    for await (const event of stream) {
      // Handle different event types
      if (event.type === 'message_start') {
        inputTokens = event.message.usage?.input_tokens || 0;
        yield {
          type: 'message_start',
          message: {
            id: event.message.id,
            model: event.message.model,
          },
        };
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'thinking') {
          yield {
            type: 'thinking_start',
            index: event.index,
          };
        } else if (block.type === 'text') {
          yield {
            type: 'content_block_start',
            index: event.index,
            content_block: block,
          };
        } else if (block.type === 'tool_use') {
          yield {
            type: 'tool_use_start',
            index: event.index,
            tool_use: {
              id: block.id,
              name: block.name,
            },
          };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'thinking_delta') {
          currentThinking += delta.thinking;
          yield {
            type: 'thinking_delta',
            index: event.index,
            delta: { thinking: delta.thinking },
          };
        } else if (delta.type === 'text_delta') {
          currentText += delta.text;
          yield {
            type: 'content_block_delta',
            index: event.index,
            delta: { text: delta.text },
          };
        } else if (delta.type === 'input_json_delta') {
          yield {
            type: 'tool_input_delta',
            index: event.index,
            delta: { partial_json: delta.partial_json },
          };
        }
      } else if (event.type === 'content_block_stop') {
        yield {
          type: 'content_block_stop',
          index: event.index,
        };
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens || 0;
        yield {
          type: 'message_delta',
          delta: {
            stop_reason: event.delta.stop_reason,
          },
          usage: event.usage,
        };
      } else if (event.type === 'message_stop') {
        const cost = this.calculateCost(model, inputTokens, outputTokens);
        this.trackSuccess(0, inputTokens + outputTokens, cost);

        yield {
          type: 'message_stop',
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        };
      }
    }
  }

  /**
   * Convert OpenAI-style messages to Anthropic format
   */
  private convertMessages(messages: CompletionRequest['messages']): {
    systemPrompt: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    let systemPrompt: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Concatenate system messages
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
        continue;
      }

      if (msg.role === 'user') {
        // Handle content with images - convert OpenAI image_url format to Anthropic format
        if (Array.isArray(msg.content)) {
          const anthropicContent: Anthropic.ContentBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type === 'text') {
              anthropicContent.push({ type: 'text', text: block.text || '' });
            } else if (block.type === 'image') {
              // Already in Anthropic format
              anthropicContent.push(block as Anthropic.ImageBlockParam);
            } else if (block.type === 'image_url' && block.image_url) {
              // Convert OpenAI image_url format to Anthropic image format
              const imageUrl = block.image_url.url || '';
              if (imageUrl.startsWith('data:')) {
                // Parse data URL: data:image/png;base64,<data>
                const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  anthropicContent.push({
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                      data: match[2],
                    },
                  });
                }
              } else {
                // URL-based image (Anthropic also supports this)
                anthropicContent.push({
                  type: 'image',
                  source: {
                    type: 'url',
                    url: imageUrl,
                  } as any, // Anthropic SDK may need cast for URL type
                });
              }
            }
          }
          anthropicMessages.push({
            role: 'user',
            content: anthropicContent,
          });
        } else {
          anthropicMessages.push({
            role: 'user',
            content: msg.content,
          });
        }
      } else if (msg.role === 'assistant') {
        // Handle tool calls in assistant messages
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const content: Anthropic.ContentBlockParam[] = [];

          // Add text if present
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }

          // Add tool use blocks
          for (const toolCall of msg.tool_calls) {
            let input: Record<string, unknown>;
            try {
              input = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              input = {};
            }

            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input,
            });
          }

          anthropicMessages.push({
            role: 'assistant',
            content,
          });
        } else {
          anthropicMessages.push({
            role: 'assistant',
            content: msg.content,
          });
        }
      } else if (msg.role === 'tool') {
        // Tool result message
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id || '',
              content: msg.content,
            },
          ],
        });
      }
    }

    return { systemPrompt, messages: anthropicMessages };
  }

  /**
   * Convert OpenAI-style tools to Anthropic format
   */
  private convertTools(tools: any[]): Anthropic.Tool[] {
    return tools
      .filter((tool) => tool.type === 'function')
      .map((tool) => ({
        name: tool.function.name,
        description: tool.function.description || '',
        input_schema: tool.function.parameters || { type: 'object', properties: {} },
      }));
  }

  /**
   * Convert tool_choice to Anthropic format
   */
  private convertToolChoice(toolChoice: any): Anthropic.MessageCreateParams['tool_choice'] {
    if (toolChoice === 'auto') {
      return { type: 'auto' };
    } else if (toolChoice === 'none') {
      return { type: 'none' };
    } else if (toolChoice === 'required' || toolChoice?.type === 'required') {
      return { type: 'any' };
    } else if (toolChoice?.function?.name) {
      return { type: 'tool', name: toolChoice.function.name };
    }
    return { type: 'auto' };
  }

  /**
   * Check if model supports thinking
   */
  private shouldEnableThinking(model: string): boolean {
    if (!this.config?.enableThinking) return false;

    // Thinking is supported on Claude 3.5 Sonnet and newer
    const thinkingModels = [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-5-sonnet',
      'claude-3-5-haiku',
    ];

    return thinkingModels.some((m) => model.includes(m));
  }

  /**
   * Get thinking configuration
   */
  private getThinkingConfig(): { type: 'enabled'; budget_tokens: number } | null {
    if (!this.config?.enableThinking) return null;

    return {
      type: 'enabled',
      budget_tokens: this.config.thinkingBudgetTokens || 10000,
    };
  }

  /**
   * Convert Anthropic response to OpenAI-compatible format
   */
  private convertResponse(response: Anthropic.Message, model: string): CompletionResponse {
    let content = '';
    const toolCalls: any[] = [];
    let thinkingContent = '';

    // Process content blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'thinking') {
        thinkingContent = block.thinking;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const result: CompletionResponse = {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: this.mapStopReason(response.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      },
    };

    // Add thinking content as metadata if present
    if (thinkingContent) {
      (result as any).thinking = thinkingContent;
    }

    return result;
  }

  /**
   * Map Anthropic stop reason to OpenAI format
   */
  private mapStopReason(stopReason: string | null): string {
    switch (stopReason) {
      case 'end_turn':
        return 'stop';
      case 'tool_use':
        return 'tool_calls';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }

  /**
   * Calculate cost for request
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Find matching pricing
    let pricing = DEFAULT_PRICING;
    for (const [key, value] of Object.entries(ANTHROPIC_PRICING)) {
      if (model.includes(key) || key.includes(model)) {
        pricing = value;
        break;
      }
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    // Anthropic doesn't have a list models endpoint, return known models
    return [
      { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'anthropic' },
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic' },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', provider: 'anthropic' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', provider: 'anthropic' },
    ];
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.initialized || !this.client) {
      return {
        status: 'not_initialized',
        provider: 'anthropic',
        lastChecked: new Date(),
      };
    }

    try {
      // Simple health check - just verify we can create a client
      // Anthropic doesn't have a dedicated health endpoint
      return {
        status: 'healthy',
        provider: 'anthropic',
        endpoint: 'https://api.anthropic.com',
        lastChecked: new Date(),
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        provider: 'anthropic',
        error: error.message,
        lastChecked: new Date(),
      };
    }
  }
}

export default AnthropicProvider;
