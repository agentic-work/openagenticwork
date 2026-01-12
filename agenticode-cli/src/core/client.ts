/**
 * AWCode LLM Client
 * Connects to AgenticWork's ProviderManager API for LLM calls
 */

// Using native fetch for HTTP requests
import type {
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  TokenUsage,
  FinishReason,
} from './types.js';

export interface ClientConfig {
  apiEndpoint: string;
  apiKey?: string;
  timeout?: number;
}

export class AWCodeClient {
  private config: ClientConfig;

  constructor(config: ClientConfig) {
    this.config = {
      timeout: 120000, // 2 minutes default
      ...config,
    };
  }

  /**
   * Send a chat completion request (non-streaming)
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.makeRequest('/v1/chat/completions', {
      model: request.model,
      messages: this.formatMessages(request.messages),
      tools: request.tools ? this.formatTools(request.tools) : undefined,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: false,
    });

    return this.parseResponse(response);
  }

  /**
   * Send a streaming chat completion request
   */
  async *chatStream(
    request: ChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const formattedTools = request.tools ? this.formatTools(request.tools) : undefined;
    const body = JSON.stringify({
      model: request.model,
      messages: this.formatMessages(request.messages),
      tools: formattedTools,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true,
    });

    console.error(`[Client DEBUG] Making request to ${this.config.apiEndpoint}/api/v1/chat/completions`);
    console.error(`[Client DEBUG] Tools count: ${formattedTools?.length || 0}`);
    if (formattedTools) {
      console.error(`[Client DEBUG] Tool names: ${formattedTools.map((t: any) => t.function?.name).join(', ')}`);
    }
    console.error(`[Client DEBUG] API Key: ${this.config.apiKey ? 'present' : 'missing'}`);

    // Use /api/v1/chat/completions for AgenticWork API compatibility
    let response;
    try {
      response = await fetch(
        `${this.config.apiEndpoint}/api/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey && {
              Authorization: `Bearer ${this.config.apiKey}`,
            }),
          },
          body,
          signal,
        }
      );
      console.error(`[Client DEBUG] Response status: ${response.status}`);
    } catch (fetchError) {
      console.error(`[Client DEBUG] Fetch error: ${fetchError}`);
      throw fetchError;
    }

    const responseBody = response.body;

    if (!responseBody) {
      console.error('[Client DEBUG] No response body!');
      throw new Error('No response body');
    }
    console.error('[Client DEBUG] Got response body, starting iteration...');

    let buffer = '';
    let currentToolCall: {
      id: string;
      name: string;
      arguments: string;
    } | null = null;

    // Use reader API for more reliable stream handling
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.error('[Client DEBUG] Stream reader done');
          break;
        }

        const text = decoder.decode(value, { stream: true });
        console.error(`[Client DEBUG] Received chunk: ${text.slice(0, 100)}...`);
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

      for (const line of lines) {
        console.error(`[Client DEBUG] Processing line: ${line.slice(0, 80)}...`);
        if (!line.startsWith('data: ')) {
          console.error(`[Client DEBUG] Skipping non-data line`);
          continue;
        }
        const data = line.slice(6);
        console.error(`[Client DEBUG] Data after slice: ${data.slice(0, 80)}...`);

        if (data === '[DONE]') {
          console.error(`[Client DEBUG] Got [DONE] marker`);
          if (currentToolCall) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: currentToolCall.id,
                name: currentToolCall.name,
                arguments: JSON.parse(currentToolCall.arguments),
              },
            };
          }
          yield { type: 'done' };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          console.error(`[Client DEBUG] Parsed JSON: ${JSON.stringify(parsed).slice(0, 200)}...`);
          const choice = parsed.choices?.[0];

          if (!choice) {
            console.error(`[Client DEBUG] No choice in parsed data`);
            continue;
          }

          const delta = choice.delta;
          console.error(`[Client DEBUG] Delta: ${JSON.stringify(delta)}`);

          // Handle text content
          if (delta?.content) {
            console.error(`[Client DEBUG] Yielding text: ${delta.content.slice(0, 50)}...`);
            yield { type: 'text', text: delta.content };
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.id) {
                // New tool call
                if (currentToolCall) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: currentToolCall.id,
                      name: currentToolCall.name,
                      arguments: JSON.parse(currentToolCall.arguments),
                    },
                  };
                }
                currentToolCall = {
                  id: tc.id,
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                };
              } else if (currentToolCall) {
                // Continue building tool call
                if (tc.function?.name) {
                  currentToolCall.name += tc.function.name;
                }
                if (tc.function?.arguments) {
                  currentToolCall.arguments += tc.function.arguments;
                }
              }
            }
          }

          // Handle finish reason
          if (choice.finish_reason) {
            if (currentToolCall) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  arguments: JSON.parse(currentToolCall.arguments || '{}'),
                },
              };
              currentToolCall = null;
            }

            yield {
              type: 'done',
              finishReason: this.mapFinishReason(choice.finish_reason),
              usage: parsed.usage
                ? {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  }
                : undefined,
            };
          }
        } catch (e) {
          // Skip malformed JSON
        }
      }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Format messages for the API
   */
  private formatMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      const formatted: Record<string, unknown> = {
        role: msg.role === 'tool' ? 'tool' : msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(part => {
              if (part.type === 'text') return { type: 'text', text: part.text };
              if (part.type === 'image') return { type: 'image_url', image_url: { url: part.imageUrl } };
              return part;
            }),
      };

      if (msg.toolCallId) {
        formatted.tool_call_id = msg.toolCallId;
      }

      if (msg.toolCalls) {
        formatted.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      return formatted;
    });
  }

  /**
   * Format tools for the API
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

  /**
   * Make an HTTP request to the API
   */
  private async makeRequest(path: string, body: unknown): Promise<unknown> {
    // Prepend /api for AgenticWork API compatibility
    const apiPath = path.startsWith('/api') ? path : `/api${path}`;
    const response = await fetch(
      `${this.config.apiEndpoint}${apiPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`,
          }),
        },
        body: JSON.stringify(body),
      }
    );

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${text}`);
    }

    return JSON.parse(text);
  }

  /**
   * Parse API response into ChatResponse
   */
  private parseResponse(response: unknown): ChatResponse {
    const r = response as {
      id: string;
      model: string;
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

    const choice = r.choices[0];
    const msg = choice.message;

    const message: Message = {
      role: msg.role as 'assistant',
      content: msg.content || '',
    };

    if (msg.tool_calls) {
      message.toolCalls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return {
      id: r.id,
      model: r.model,
      message,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: r.usage
        ? {
            promptTokens: r.usage.prompt_tokens,
            completionTokens: r.usage.completion_tokens,
            totalTokens: r.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * Map API finish reason to our type
   */
  private mapFinishReason(reason: string): FinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
