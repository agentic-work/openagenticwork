/**
 * Ollama Provider
 *
 * Implements ILLMProvider for Ollama local models
 * Supports function calling via native Ollama tool support
 */

import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth,
  type ProviderConfig
} from './ILLMProvider.js';

export class OllamaProvider extends BaseLLMProvider {
  readonly name = 'ollama';
  readonly type = 'azure-openai' as const; // Type constraint workaround
  private baseUrl: string;
  private healthCheckModel: string;
  private pullingModels: Set<string> = new Set();
  private apiKey?: string; // Optional API key for authenticated Ollama endpoints

  constructor(logger: Logger, config?: { baseUrl?: string; healthCheckModel?: string; apiKey?: string }) {
    super(logger, 'ollama');
    // No hardcoded defaults - all values must come from config or environment
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || '';
    this.healthCheckModel = config?.healthCheckModel || process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || '';
    this.apiKey = config?.apiKey || process.env.OLLAMA_API_KEY;

    if (!this.baseUrl) {
      this.logger.warn('[OllamaProvider] OLLAMA_BASE_URL not configured');
    }
    if (!this.healthCheckModel) {
      this.logger.warn('[OllamaProvider] OLLAMA_CHAT_MODEL not configured');
    }

    this.initialized = true; // Ollama doesn't require async init

    this.logger.info({
      baseUrl: this.baseUrl,
      healthCheckModel: this.healthCheckModel,
      hasApiKey: !!this.apiKey
    }, '[OllamaProvider] Initialized (no hardcoded defaults)');
  }

  /**
   * Get headers for Ollama API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    // Ollama doesn't require initialization
    this.initialized = true;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders()
      });
      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }
      const data = await response.json();
      return (data.models || []).map((m: any) => ({
        id: m.name,
        name: m.name,
        provider: 'ollama'
      }));
    } catch (error) {
      this.logger.error({ error }, '[OllamaProvider] Failed to list models');
      return [];
    }
  }

  /**
   * Check if model exists locally
   */
  private async modelExists(modelName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.getHeaders()
      });
      if (!response.ok) {
        return false;
      }
      const data = await response.json();
      const models = data.models || [];
      return models.some((m: any) => m.name === modelName);
    } catch (error) {
      this.logger.error({ error, modelName }, '[OllamaProvider] Failed to check if model exists');
      return false;
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  private async pullModel(modelName: string): Promise<void> {
    try {
      this.logger.info({ modelName }, '[OllamaProvider] Pulling model from registry');

      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body from Ollama pull');
      }

      // Stream the pull progress
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line);
            if (chunk.status) {
              this.logger.debug({ modelName, status: chunk.status }, '[OllamaProvider] Pull progress');
            }
            if (chunk.error) {
              throw new Error(chunk.error);
            }
          } catch (parseError) {
            // Ignore parse errors, continue streaming
          }
        }
      }

      this.logger.info({ modelName }, '[OllamaProvider] Model pulled successfully');
    } catch (error) {
      this.logger.error({ error, modelName }, '[OllamaProvider] Failed to pull model');
      throw error;
    }
  }

  /**
   * Ensure model exists, pull if necessary
   */
  private async ensureModelExists(modelName: string): Promise<void> {
    try {
      // Check if model exists
      const exists = await this.modelExists(modelName);
      if (exists) {
        this.logger.debug({ modelName }, '[OllamaProvider] Model already exists locally');
        return;
      }

      // Check if already pulling this model
      if (this.pullingModels.has(modelName)) {
        this.logger.info({ modelName }, '[OllamaProvider] Model is already being pulled, waiting...');
        // Wait for the pull to complete (poll every 5 seconds for up to 10 minutes)
        const maxWaitTime = 600000; // 10 minutes
        const pollInterval = 5000; // 5 seconds
        const startTime = Date.now();

        while (this.pullingModels.has(modelName)) {
          if (Date.now() - startTime > maxWaitTime) {
            throw new Error(`Timeout waiting for model ${modelName} to be pulled`);
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Check if model exists after waiting
        const existsAfterWait = await this.modelExists(modelName);
        if (!existsAfterWait) {
          throw new Error(`Model ${modelName} was not pulled successfully`);
        }
        return;
      }

      // Mark as pulling and pull the model
      this.pullingModels.add(modelName);
      this.logger.info({ modelName }, '[OllamaProvider] Model not found locally, pulling from registry');

      try {
        await this.pullModel(modelName);
      } finally {
        this.pullingModels.delete(modelName);
      }
    } catch (error) {
      this.logger.error({ error, modelName }, '[OllamaProvider] Failed to ensure model exists');
      throw error;
    }
  }

  /**
   * Create chat completion
   */
  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();

    try {
      this.metrics.totalRequests++;
      // Strip 'ollama/' prefix if present - the API may receive "ollama/devstral" but Ollama needs just "devstral"
      let modelName = request.model || this.healthCheckModel;
      if (modelName.startsWith('ollama/')) {
        modelName = modelName.substring(7);
      }

      // Ensure model exists, pull if necessary
      await this.ensureModelExists(modelName);

      // Convert OpenAI-style tools to Ollama format
      const tools = request.tools ? this.convertToolsToOllama(request.tools) : undefined;

      // Detect models that support native thinking (NO HARDCODED MODELS)
      // See: https://docs.ollama.com/capabilities/thinking
      // Configure via OLLAMA_THINKING_MODELS env var (comma-separated list)
      const thinkingModels = (process.env.OLLAMA_THINKING_MODELS || '').split(',').map(m => m.trim().toLowerCase());
      const modelLower = modelName.toLowerCase();
      const supportsThinking = thinkingModels.some(m => m && modelLower.includes(m)) ||
                               (request as any).thinking?.type === 'enabled';

      // Build Ollama request
      const ollamaRequest: any = {
        model: modelName,
        messages: this.convertMessages(request.messages),
        options: {
          temperature: request.temperature ?? 0.7,
          top_p: request.top_p ?? 1,
          num_predict: request.max_tokens ?? 8192
        },
        stream: request.stream ?? true
      };

      // Enable thinking for supported models
      // This will cause Ollama to return message.thinking field with reasoning content
      if (supportsThinking) {
        ollamaRequest.think = true;
        this.logger.info({
          model: modelName,
          thinkingEnabled: true
        }, '[OllamaProvider] 🧠 Thinking mode enabled for Ollama model');
      }

      // Add tools if present
      if (tools && tools.length > 0) {
        ollamaRequest.tools = tools;
      }

      this.logger.info({
        model: modelName,
        messageCount: request.messages.length,
        toolCount: tools?.length || 0,
        stream: request.stream,
        thinkingEnabled: supportsThinking
      }, '[OllamaProvider] Creating completion');

      if (request.stream) {
        return this.streamCompletion(ollamaRequest, modelName, startTime);
      } else {
        return await this.nonStreamCompletion(ollamaRequest, modelName, startTime);
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[OllamaProvider] Completion failed');
      throw error;
    }
  }

  /**
   * Stream completion (returns AsyncGenerator)
   */
  private async *streamCompletion(
    ollamaRequest: any,
    modelName: string,
    startTime: number
  ): AsyncGenerator<any> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(ollamaRequest)
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body from Ollama');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalTokens = 0;
      let accumulatedContent = ''; // Accumulate content for gpt-oss tool call parsing
      let hasNativeToolCalls = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line);

            // Track if we have native tool calls
            if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
              hasNativeToolCalls = true;
            }

            // Accumulate content for potential gpt-oss tool call parsing
            if (chunk.message?.content) {
              accumulatedContent += chunk.message.content;
            }

            // Convert Ollama chunk to OpenAI format
            const openAIChunk = this.convertOllamaChunkToOpenAI(chunk, modelName);
            if (openAIChunk) {
              yield openAIChunk;
            }

            // Check if done
            if (chunk.done) {
              totalTokens = (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0);
              const latency = Date.now() - startTime;
              this.trackSuccess(latency, totalTokens, 0); // Ollama is free

              // If no native tool calls, try to parse gpt-oss channel-based tool calls
              if (!hasNativeToolCalls && accumulatedContent) {
                const parsed = this.parseGptOssToolCalls(accumulatedContent);
                if (parsed && parsed.toolCalls.length > 0) {
                  this.logger.info({
                    model: modelName,
                    toolCount: parsed.toolCalls.length,
                    tools: parsed.toolCalls.map(t => t.function.name)
                  }, '[OllamaProvider] Detected gpt-oss tool calls in streamed content');

                  // Emit a final chunk with the parsed tool calls
                  yield {
                    id: `chatcmpl-${Date.now()}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: modelName,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: parsed.toolCalls.map((tc, index) => ({
                          index,
                          ...tc
                        }))
                      },
                      finish_reason: 'tool_calls'
                    }],
                    // Include cleaned content info
                    _gptoss_clean_content: parsed.cleanContent,
                    usage: {
                      prompt_tokens: chunk.prompt_eval_count || 0,
                      completion_tokens: chunk.eval_count || 0,
                      total_tokens: totalTokens
                    }
                  };
                }
              }

              this.logger.info({
                model: modelName,
                duration: latency,
                totalTokens,
                hadGptOssToolCalls: !hasNativeToolCalls && accumulatedContent.includes('<|start|>')
              }, '[OllamaProvider] Stream completed');
            }
          } catch (parseError) {
            this.logger.warn({ line, error: parseError }, '[OllamaProvider] Failed to parse chunk');
          }
        }
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[OllamaProvider] Stream failed');
      throw error;
    }
  }

  /**
   * Non-streaming completion
   */
  private async nonStreamCompletion(
    ollamaRequest: any,
    modelName: string,
    startTime: number
  ): Promise<CompletionResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ ...ollamaRequest, stream: false })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const totalTokens = (data.prompt_eval_count || 0) + (data.eval_count || 0);
      const latency = Date.now() - startTime;
      this.trackSuccess(latency, totalTokens, 0);

      this.logger.info({
        model: modelName,
        duration: latency,
        totalTokens
      }, '[OllamaProvider] Completion completed');

      // Convert to OpenAI format
      return this.convertOllamaResponseToOpenAI(data, modelName);
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[OllamaProvider] Non-stream completion failed');
      throw error;
    }
  }

  /**
   * Convert OpenAI messages to Ollama format (handles multimodal content with images)
   */
  private convertMessages(messages: CompletionRequest['messages']): any[] {
    return messages.map(msg => {
      const ollamaMsg: any = {
        role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user'
      };

      // Handle multimodal content (text + images)
      if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const images: string[] = [];

        for (const part of msg.content) {
          if (part.type === 'text') {
            textParts.push(part.text);
          } else if (part.type === 'image_url' || part.type === 'image') {
            // Extract base64 image data
            const imageUrl = part.image_url?.url || part.url;
            if (imageUrl) {
              // Remove data:image/...;base64, prefix if present
              const base64Data = imageUrl.replace(/^data:image\/[a-z]+;base64,/, '');
              images.push(base64Data);
            }
          }
        }

        // Ollama format: content is string, images is separate array
        ollamaMsg.content = textParts.join('\n');
        if (images.length > 0) {
          ollamaMsg.images = images;
        }
      } else {
        // Simple string content
        ollamaMsg.content = msg.content;
      }

      // Handle tool calls in assistant messages
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        ollamaMsg.tool_calls = msg.tool_calls.map(tc => {
          // Parse arguments if it's a string, otherwise use as-is
          let args: any;
          if (typeof tc.function.arguments === 'string' && tc.function.arguments.trim()) {
            try {
              args = JSON.parse(tc.function.arguments);
            } catch (e) {
              // If parse fails, use empty object
              args = {};
            }
          } else if (!tc.function.arguments) {
            args = {};
          } else {
            // Already an object
            args = tc.function.arguments;
          }

          return {
            function: {
              name: tc.function.name,
              arguments: args
            }
          };
        });
      }

      return ollamaMsg;
    });
  }

  /**
   * Convert OpenAI tools to Ollama format
   */
  private convertToolsToOllama(tools: any[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }
    }));
  }

  /**
   * Parse gpt-oss channel-based tool calls from content
   * gpt-oss format for non-built-in tools:
   * <|start|>assistant<|channel|>commentary to=functions.{tool_name} <|constrain|>json<|message|>{json}<|call|>
   * gpt-oss format for built-in tools:
   * <|start|>assistant<|channel|>analysis to={tool_name} <|constrain|>json<|message|>{json}<|call|>
   */
  private parseGptOssToolCalls(content: string): { cleanContent: string; toolCalls: any[] } | null {
    if (!content) return null;

    // Log the content we're trying to parse
    if (content.includes('<|start|>') || content.includes('<|channel|>')) {
      this.logger.info({
        contentLength: content.length,
        hasStartTag: content.includes('<|start|>'),
        hasChannelTag: content.includes('<|channel|>'),
        preview: content.substring(0, 500)
      }, '[OllamaProvider] Attempting to parse gpt-oss tool calls');
    }

    // Pattern to match gpt-oss tool call format
    // For non-built-in: <|start|>assistant<|channel|>commentary to=functions.tool_name <|constrain|>json<|message|>{...}<|call|>
    // For built-in: <|start|>assistant<|channel|>analysis to=tool_name <|constrain|>json<|message|>{...}<|call|>
    // Also handle "to= " with space after equals
    const toolCallPattern = /<\|start\|>assistant<\|channel\|>(?:analysis|commentary)\s+to=\s*(?:functions\.)?(\w+)(?:\s+code)?(?:\s*<\|constrain\|>json)?<\|message\|>(\{[\s\S]*?\})(?:<\|call\|>)?/g;

    const toolCalls: any[] = [];
    let match;
    let cleanContent = content;

    while ((match = toolCallPattern.exec(content)) !== null) {
      const toolName = match[1];
      const argsJson = match[2];

      this.logger.info({
        toolName,
        argsJsonLength: argsJson.length,
        argsPreview: argsJson.substring(0, 200)
      }, '[OllamaProvider] Found gpt-oss tool call match');

      try {
        const args = JSON.parse(argsJson);
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(args)
          }
        });

        // Remove the tool call syntax from content
        cleanContent = cleanContent.replace(match[0], '').trim();
      } catch (e) {
        // Failed to parse JSON, skip this match
        this.logger.warn({ toolName, argsJson, error: e }, '[OllamaProvider] Failed to parse gpt-oss tool call JSON');
      }
    }

    if (toolCalls.length > 0) {
      this.logger.info({
        toolCount: toolCalls.length,
        tools: toolCalls.map(t => t.function.name)
      }, '[OllamaProvider] Parsed gpt-oss channel-based tool calls');
      return { cleanContent, toolCalls };
    }

    return null;
  }

  /**
   * Convert Ollama streaming chunk to OpenAI format
   */
  private convertOllamaChunkToOpenAI(chunk: any, model: string): any | null {
    if (!chunk.message) return null;

    const delta: any = {};

    // Handle thinking content from Ollama (when think=true is set)
    // See: https://docs.ollama.com/capabilities/thinking
    // Ollama returns thinking in message.thinking field for models like DeepSeek, Qwen3
    if (chunk.message.thinking) {
      delta.thinking = chunk.message.thinking;
    }

    // Handle content delta
    if (chunk.message.content) {
      delta.content = chunk.message.content;
    }

    // Handle tool calls (native Ollama format)
    if (chunk.message.tool_calls) {
      delta.tool_calls = chunk.message.tool_calls.map((tc: any, index: number) => ({
        index,
        id: `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments)
        }
      }));
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        delta,
        finish_reason: chunk.done ? 'stop' : null
      }],
      usage: chunk.done ? {
        prompt_tokens: chunk.prompt_eval_count || 0,
        completion_tokens: chunk.eval_count || 0,
        total_tokens: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0)
      } : undefined
    };
  }

  /**
   * Convert Ollama response to OpenAI format
   */
  private convertOllamaResponseToOpenAI(data: any, model: string): CompletionResponse {
    let content = data.message.content || '';
    let toolCalls: any[] | undefined;

    // Handle thinking content from Ollama (when think=true is set)
    const thinking = data.message.thinking;

    // Handle native Ollama tool calls first
    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      toolCalls = data.message.tool_calls.map((tc: any, index: number) => ({
        id: `call_${Date.now()}_${index}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments)
        }
      }));
    } else {
      // Try to parse gpt-oss channel-based tool calls from content
      const parsed = this.parseGptOssToolCalls(content);
      if (parsed) {
        content = parsed.cleanContent;
        toolCalls = parsed.toolCalls;
      }
    }

    const message: any = {
      role: 'assistant',
      content
    };

    if (thinking) {
      message.thinking = thinking;
    }

    if (toolCalls && toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop'
      }],
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
      }
    };
  }

  /**
   * Embed text (optional)
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    try {
      const model = process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;

      // Ensure embedding model exists, pull if necessary
      await this.ensureModelExists(model);

      const inputs = Array.isArray(text) ? text : [text];
      const embeddings = [];

      for (const input of inputs) {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ model, prompt: input })
        });

        if (!response.ok) {
          throw new Error(`Ollama embeddings API error: ${response.status}`);
        }

        const data = await response.json();
        embeddings.push(data.embedding);
      }

      return Array.isArray(text) ? embeddings : embeddings[0];
    } catch (error) {
      this.logger.error({ error }, '[OllamaProvider] Embedding creation failed');
      throw error;
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<ProviderHealth> {
    try {
      // Check if Ollama is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return {
          status: 'unhealthy',
          provider: this.name,
          endpoint: this.baseUrl,
          error: `HTTP ${response.status}`,
          lastChecked: new Date()
        };
      }

      const data = await response.json();
      const models = data.models || [];
      const hasHealthCheckModel = models.some((m: any) => m.name.includes(this.healthCheckModel.split(':')[0]));

      return {
        status: hasHealthCheckModel ? 'healthy' : 'unhealthy',
        provider: this.name,
        endpoint: this.baseUrl,
        error: hasHealthCheckModel ? undefined : `Model ${this.healthCheckModel} not found`,
        lastChecked: new Date()
      };
    } catch (error) {
      this.logger.error({ error }, '[OllamaProvider] Health check failed');
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.baseUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date()
      };
    }
  }
}
