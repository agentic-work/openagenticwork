/**
 * Direct Ollama Client
 * For standalone CLI usage without AgenticWork API auth
 */

import type {
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  FinishReason,
} from './types.js';

export interface OllamaClientConfig {
  baseUrl: string;  // e.g., http://localhost:11434
  timeout?: number;
}

export class OllamaClient {
  private config: OllamaClientConfig;

  constructor(config: OllamaClientConfig) {
    this.config = {
      timeout: 120000,
      ...config,
    };
  }

  /**
   * Check if a model supports Ollama's native thinking feature
   * See: https://ollama.com/blog/thinking
   *
   * Note: gpt-oss is our custom model that supports thinking via channels
   */
  private supportsThinking(model: string): boolean {
    const lowerModel = model.toLowerCase();
    // Models known to support think=true in Ollama
    return (
      lowerModel.includes('gpt-oss') ||       // Our custom GPT-4o model
      lowerModel.includes('qwen3') ||
      lowerModel.includes('qwen2.5') ||
      lowerModel.includes('deepseek') ||
      lowerModel.includes('deepseek-r1') ||
      lowerModel.includes('marco-o1') ||
      lowerModel.includes('qwq')
    );
  }

  /**
   * Send a streaming chat completion request to Ollama
   */
  async *chatStream(
    request: ChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    // Strip 'ollama/' prefix if present
    let model = request.model;
    if (model.startsWith('ollama/')) {
      model = model.substring(7);
    }

    // Check if this model supports native thinking
    const enableThinking = this.supportsThinking(model);

    const body = JSON.stringify({
      model,
      messages: this.formatMessages(request.messages),
      tools: request.tools ? this.formatTools(request.tools) : undefined,
      stream: true,
      think: enableThinking,  // Enable thinking for supported models
      options: {
        temperature: request.temperature || 0.3,
        num_predict: request.maxTokens || 8192,
      },
    });

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error ${response.status}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);

            // Handle thinking content (from Ollama's think=true feature)
            // See: https://ollama.com/blog/thinking
            if (parsed.message?.thinking) {
              yield { type: 'thinking', text: parsed.message.thinking };
            }

            // Handle streaming message content
            if (parsed.message?.content) {
              let content = parsed.message.content;

              // Some models (like gpt-oss) embed "THINKING" markers in content
              // or use <think>/<thinking> tags - strip all of these
              content = content.replace(/THINKING/g, '');
              content = content.replace(/<\/?think(?:ing)?>/gi, '');

              if (content.trim()) {
                yield { type: 'text', text: content };
              }
            }

            // Handle tool calls
            if (parsed.message?.tool_calls) {
              for (const tc of parsed.message.tool_calls) {
                // Unescape string values in arguments (Ollama streaming returns \\n instead of \n)
                const args = tc.function?.arguments || {};
                const unescapedArgs = this.unescapeArgs(args);
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id || `call_${Date.now()}`,
                    name: tc.function?.name,
                    arguments: unescapedArgs,
                  },
                };
              }
            }

            // Handle completion
            if (parsed.done) {
              yield {
                type: 'done',
                finishReason: parsed.done_reason === 'stop' ? 'stop' : 'stop',
                usage: {
                  promptTokens: parsed.prompt_eval_count || 0,
                  completionTokens: parsed.eval_count || 0,
                  totalTokens: (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0),
                },
              };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Non-streaming chat
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    let model = request.model;
    if (model.startsWith('ollama/')) {
      model = model.substring(7);
    }

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: this.formatMessages(request.messages),
        tools: request.tools ? this.formatTools(request.tools) : undefined,
        stream: false,
        options: {
          temperature: request.temperature || 0.3,
          num_predict: request.maxTokens || 8192,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error ${response.status}: ${text}`);
    }

    const data = await response.json() as {
      model: string;
      message?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: Record<string, unknown> };
        }>;
      };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const message: Message = {
      role: 'assistant',
      content: data.message?.content || '',
    };

    if (data.message?.tool_calls) {
      message.toolCalls = data.message.tool_calls.map((tc) => ({
        id: tc.id || `call_${Date.now()}`,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || {},
      }));
    }

    return {
      id: `ollama_${Date.now()}`,
      model: data.model,
      message,
      finishReason: 'stop' as const,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  /**
   * Unescape string values in tool arguments
   * Ollama streaming mode returns escaped sequences like \\n instead of \n
   */
  private unescapeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        // Unescape common escape sequences
        result[key] = value
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\\\/g, '\\');
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.unescapeArgs(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Format messages for Ollama API
   */
  private formatMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      const formatted: Record<string, unknown> = {
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      };

      if (msg.toolCalls) {
        formatted.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      return formatted;
    });
  }

  /**
   * Format tools for Ollama API
   */
  private formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}
