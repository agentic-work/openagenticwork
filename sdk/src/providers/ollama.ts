/**
 * @agenticwork/sdk Ollama Provider
 *
 * Direct connection to Ollama for local LLM inference
 * Supports tool calling via OpenAI-compatible API
 */

import type {
  Provider,
  ProviderConfig,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  ToolCall,
} from '../core/types.js';

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class OllamaProvider implements Provider {
  readonly type = 'ollama' as const;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.defaultModel = config.defaultModel || 'llama3.2';
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages: this.formatMessages(options.messages),
        tools: options.tools ? this.formatTools(options.tools) : undefined,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return this.parseResponse(data, options.model || this.defaultModel);
  }

  async *stream(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || this.defaultModel,
        messages: this.formatMessages(options.messages),
        tools: options.tools ? this.formatTools(options.tools) : undefined,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `Ollama API error: ${response.status} - ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall: { index: number; id?: string; name?: string; arguments?: string } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          if (data === '[DONE]') {
            // Finalize any pending tool call
            if (currentToolCall?.id) {
              yield {
                type: 'tool_call_delta',
                toolCall: {
                  index: currentToolCall.index,
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  arguments: currentToolCall.arguments ? JSON.parse(currentToolCall.arguments) : {},
                },
              };
            }
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Handle text content
            if (delta?.content) {
              yield { type: 'text_delta', text: delta.content };
            }

            // Handle tool calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  // New tool call starting
                  if (currentToolCall?.id) {
                    yield {
                      type: 'tool_call_delta',
                      toolCall: {
                        index: currentToolCall.index,
                        id: currentToolCall.id,
                        name: currentToolCall.name,
                        arguments: currentToolCall.arguments ? JSON.parse(currentToolCall.arguments) : {},
                      },
                    };
                  }
                  currentToolCall = {
                    index: tc.index ?? 0,
                    id: tc.id,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  };
                } else if (currentToolCall) {
                  // Accumulate tool call parts
                  if (tc.function?.name) {
                    currentToolCall.name = (currentToolCall.name || '') + tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    currentToolCall.arguments = (currentToolCall.arguments || '') + tc.function.arguments;
                  }
                }
              }
            }

            // Handle finish reason
            if (choice.finish_reason) {
              if (currentToolCall?.id) {
                yield {
                  type: 'tool_call_delta',
                  toolCall: {
                    index: currentToolCall.index,
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: currentToolCall.arguments ? JSON.parse(currentToolCall.arguments) : {},
                  },
                };
                currentToolCall = null;
              }

              yield {
                type: 'done',
                finishReason: choice.finish_reason,
                usage: parsed.usage ? {
                  promptTokens: parsed.usage.prompt_tokens || 0,
                  completionTokens: parsed.usage.completion_tokens || 0,
                  totalTokens: parsed.usage.total_tokens || 0,
                } : undefined,
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

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }
    const data = await response.json() as { models?: Array<{ name: string }> };
    return data.models?.map((m) => m.name) || [];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private formatMessages(messages: Message[]): OllamaMessage[] {
    return messages.map((msg) => {
      const formatted: OllamaMessage = {
        role: msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(p => p.type === 'text' ? p.text : '').join(''),
      };

      if (msg.toolCallId) {
        formatted.tool_call_id = msg.toolCallId;
      }

      if (msg.toolCalls) {
        formatted.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      return formatted;
    });
  }

  private formatTools(tools: ToolDefinition[]): OllamaTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: typeof tool.inputSchema === 'object' && 'shape' in tool.inputSchema
          ? this.zodToJsonSchema(tool.inputSchema)
          : tool.inputSchema as Record<string, unknown>,
      },
    }));
  }

  private zodToJsonSchema(schema: unknown): Record<string, unknown> {
    // Simple conversion - in production use zod-to-json-schema
    if (typeof schema === 'object' && schema !== null && '_def' in schema) {
      const def = (schema as { _def: { typeName: string; shape?: unknown } })._def;
      if (def.typeName === 'ZodObject' && def.shape) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) {
          const propDef = (value as { _def: { typeName: string; description?: string } })._def;
          properties[key] = { type: this.zodTypeToJsonType(propDef.typeName) };
          if (propDef.description) {
            (properties[key] as Record<string, unknown>).description = propDef.description;
          }
          if (propDef.typeName !== 'ZodOptional') {
            required.push(key);
          }
        }

        return { type: 'object', properties, required };
      }
    }
    return schema as Record<string, unknown>;
  }

  private zodTypeToJsonType(zodType: string): string {
    const mapping: Record<string, string> = {
      ZodString: 'string',
      ZodNumber: 'number',
      ZodBoolean: 'boolean',
      ZodArray: 'array',
      ZodObject: 'object',
    };
    return mapping[zodType] || 'string';
  }

  private parseResponse(data: unknown, model: string): CompletionResponse {
    const d = data as {
      id?: string;
      choices: Array<{
        message: {
          role: string;
          content?: string;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const choice = d.choices[0];
    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}'),
    }));

    return {
      id: d.id || `ollama-${Date.now()}`,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: choice.message.content || '',
          toolCalls,
        },
        finishReason: choice.finish_reason as 'stop' | 'tool_calls' | null,
      }],
      usage: d.usage ? {
        promptTokens: d.usage.prompt_tokens,
        completionTokens: d.usage.completion_tokens,
        totalTokens: d.usage.total_tokens,
      } : undefined,
    };
  }
}
