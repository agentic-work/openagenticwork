/**
 * AgenticWork API Client
 * Connects to AgenticWork platform for LLM completions
 * Uses the platform's configured providers (Claude, GPT-4, Gemini, etc.)
 */

import type { Message, StreamChunk, ToolDefinition } from './types.js';

export interface APIClientConfig {
  apiEndpoint: string;
  apiKey: string;
  timeout?: number;
}

export interface APIClientInfo {
  connected: boolean;
  availableModels: string[];
  defaultModel?: string;
  userId?: string;
  isAdmin?: boolean;
}

/**
 * Client for AgenticWork API LLM completions
 * This routes through the platform and uses configured providers
 */
export class APIClient {
  private config: APIClientConfig;
  private info: APIClientInfo = {
    connected: false,
    availableModels: [],
  };

  constructor(config: APIClientConfig) {
    this.config = {
      timeout: 120000,
      ...config,
    };
  }

  /**
   * Initialize connection and fetch available models
   */
  async connect(): Promise<APIClientInfo> {
    try {
      // Verify API key and get user info
      const userResponse = await this.request<{
        user: { id: string; email: string; isAdmin: boolean };
      }>('/api/auth/me');

      // Fetch available models
      const modelsResponse = await this.request<{
        models: Array<{ id: string; name: string; provider: string }>;
      }>('/api/models');

      this.info = {
        connected: true,
        availableModels: modelsResponse.models.map(m => m.id),
        defaultModel: modelsResponse.models[0]?.id,
        userId: userResponse.user.id,
        isAdmin: userResponse.user.isAdmin,
      };

      return this.info;
    } catch (error) {
      this.info = { connected: false, availableModels: [] };
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.info.connected;
  }

  /**
   * Get connection info
   */
  getInfo(): APIClientInfo {
    return { ...this.info };
  }

  /**
   * Get available models
   */
  getAvailableModels(): string[] {
    return [...this.info.availableModels];
  }

  /**
   * Stream chat completion through AgenticWork API
   * Uses the dedicated /api/agenticode/chat endpoint which accepts messages array format
   */
  async *chatStream(
    request: {
      model: string;
      messages: Message[];
      tools?: ToolDefinition[];
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
    },
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    // Use the dedicated agenticode chat endpoint (accepts messages array format)
    const url = `${this.config.apiEndpoint}/api/agenticode/chat`;

    const body = JSON.stringify({
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.toolCalls?.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
        tool_call_id: m.toolCallId,
      })),
      tools: request.tools?.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body,
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      yield { type: 'error', error: `API error ${response.status}: ${text}` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const reader = response.body.getReader();
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
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            yield { type: 'done', finishReason: 'stop' };
            return;
          }

          try {
            const event = JSON.parse(data);

            // Handle different event types from AgenticWork API
            if (event.type === 'thinking' && event.content) {
              yield { type: 'thinking', text: event.content };
            } else if (event.type === 'content' && event.content) {
              yield { type: 'text', text: event.content };
            } else if (event.type === 'tool_call' && event.tool_call) {
              let parsedArgs = typeof event.tool_call.function?.arguments === 'string'
                ? JSON.parse(event.tool_call.function.arguments)
                : event.tool_call.arguments || {};

              // CRITICAL FIX: Unwrap "value" wrapper if model made format error
              // Some models wrap all tool parameters in a "value" key: {"value": {"path": "...", "content": "..."}}
              // But tools expect direct parameters: {"path": "...", "content": "..."}
              if (parsedArgs && typeof parsedArgs === 'object' && parsedArgs.value && typeof parsedArgs.value === 'object') {
                const valueKeys = Object.keys(parsedArgs.value);
                const paramKeys = Object.keys(parsedArgs);
                // If only "value" key exists and value contains actual parameters, unwrap it
                if (paramKeys.length === 1 && valueKeys.length > 0) {
                  console.error('[APIClient] Unwrapping "value" wrapper from tool arguments - model used incorrect format');
                  parsedArgs = parsedArgs.value;
                }
              }

              yield {
                type: 'tool_call',
                toolCall: {
                  id: event.tool_call.id,
                  name: event.tool_call.function?.name || event.tool_call.name,
                  arguments: parsedArgs,
                },
              };
            } else if (event.type === 'error') {
              yield { type: 'error', error: event.error || event.message };
            } else if (event.type === 'done' || event.type === 'end') {
              yield { type: 'done', finishReason: event.finish_reason || 'stop' };
              return;
            }
            // Also handle OpenAI-style delta format
            else if (event.choices?.[0]?.delta) {
              const delta = event.choices[0].delta;
              if (delta.content) {
                yield { type: 'text', text: delta.content };
              }
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.function?.name) {
                    let tcArgs = tc.function.arguments
                      ? JSON.parse(tc.function.arguments)
                      : {};

                    // CRITICAL FIX: Unwrap "value" wrapper if model made format error
                    if (tcArgs && typeof tcArgs === 'object' && tcArgs.value && typeof tcArgs.value === 'object') {
                      const valueKeys = Object.keys(tcArgs.value);
                      const paramKeys = Object.keys(tcArgs);
                      if (paramKeys.length === 1 && valueKeys.length > 0) {
                        console.error('[APIClient] Unwrapping "value" wrapper from OpenAI delta tool arguments');
                        tcArgs = tcArgs.value;
                      }
                    }

                    yield {
                      type: 'tool_call',
                      toolCall: {
                        id: tc.id || `tool_${Date.now()}`,
                        name: tc.function.name,
                        arguments: tcArgs,
                      },
                    };
                  }
                }
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done', finishReason: 'stop' };
  }

  /**
   * Make an HTTP request to the API
   */
  private async request<T>(path: string, options: {
    method?: string;
    body?: unknown;
  } = {}): Promise<T> {
    const url = `${this.config.apiEndpoint}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Create API client from environment or config
 */
export function createAPIClient(config?: Partial<APIClientConfig>): APIClient | null {
  const apiEndpoint = config?.apiEndpoint ||
    process.env.AGENTICWORK_API_ENDPOINT ||
    process.env.AGENTICWORK_API_URL;

  const apiKey = config?.apiKey ||
    process.env.AGENTICODE_API_KEY ||
    process.env.AGENTICWORK_API_KEY ||
    process.env.AGENTICWORK_API_TOKEN;

  if (!apiEndpoint || !apiKey) {
    return null;
  }

  return new APIClient({
    apiEndpoint,
    apiKey,
    timeout: config?.timeout,
  });
}
