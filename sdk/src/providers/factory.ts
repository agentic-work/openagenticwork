/**
 * @agenticwork/sdk Provider Factory
 *
 * Creates provider instances based on configuration.
 * Supports all providers from the AgenticWork platform:
 * - AWS Bedrock
 * - Azure AI Foundry
 * - Azure OpenAI
 * - Google Vertex AI
 * - Ollama
 */

import type { Provider, ProviderType, ProviderConfig } from '../core/types.js';
import { OllamaProvider } from './ollama.js';

// Provider configurations from platform
export interface ProviderCredentials {
  type: ProviderType;

  // Common
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;

  // AWS Bedrock
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;

  // Azure OpenAI
  azureEndpoint?: string;
  azureApiKey?: string;
  azureApiVersion?: string;
  azureDeploymentName?: string;

  // Azure AI Foundry
  azureAIEndpoint?: string;
  azureAIApiKey?: string;

  // Google Vertex AI
  googleProjectId?: string;
  googleLocation?: string;
  googleCredentials?: string | Record<string, unknown>;
}

/**
 * Create a provider instance from credentials
 */
export function createProvider(credentials: ProviderCredentials): Provider {
  switch (credentials.type) {
    case 'ollama':
      return new OllamaProvider({
        type: 'ollama',
        baseUrl: credentials.baseUrl,
        defaultModel: credentials.defaultModel,
      });

    case 'anthropic':
      return createAnthropicProvider(credentials);

    case 'openai':
      return createOpenAIProvider(credentials);

    case 'google':
    case 'vertex-ai':
      return createVertexAIProvider(credentials);

    case 'azure-openai':
      return createAzureOpenAIProvider(credentials);

    case 'bedrock':
    case 'aws-bedrock':
      return createBedrockProvider(credentials);

    default:
      throw new Error(`Unknown provider type: ${credentials.type}`);
  }
}

/**
 * Anthropic Provider (Claude)
 */
function createAnthropicProvider(credentials: ProviderCredentials): Provider {
  // Uses @anthropic-ai/sdk
  const Anthropic = require('@anthropic-ai/sdk').default;
  const client = new Anthropic({
    apiKey: credentials.apiKey,
  });

  return {
    type: 'anthropic',

    async complete(options) {
      const response = await client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        messages: options.messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : m.content.map(p =>
            p.type === 'text' ? { type: 'text', text: p.text } : p
          ),
        })),
        system: options.messages.find(m => m.role === 'system')?.content as string,
        tools: options.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        temperature: options.temperature,
      });

      return {
        id: response.id,
        model: response.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.content.map((c: { type: string; text?: string }) =>
              c.type === 'text' ? c.text : ''
            ).join(''),
            toolCalls: response.content.filter((c: { type: string }) => c.type === 'tool_use').map((c: { id: string; name: string; input: Record<string, unknown> }) => ({
              id: c.id,
              name: c.name,
              arguments: c.input,
            })),
          },
          finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
        }],
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    },

    async *stream(options) {
      const stream = await client.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        messages: options.messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : m.content.map(p =>
            p.type === 'text' ? { type: 'text', text: p.text } : p
          ),
        })),
        system: options.messages.find(m => m.role === 'system')?.content as string,
        tools: options.tools?.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        temperature: options.temperature,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta as { type: string; text?: string };
          if (delta.type === 'text_delta' && delta.text) {
            yield { type: 'text_delta', text: delta.text };
          }
        } else if (event.type === 'message_stop') {
          yield { type: 'done' };
        }
      }
    },

    async listModels() {
      return ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
    },

    async healthCheck() {
      try {
        await client.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * OpenAI Provider
 */
function createOpenAIProvider(credentials: ProviderCredentials): Provider {
  const OpenAI = require('openai').default;
  const client = new OpenAI({
    apiKey: credentials.apiKey,
    baseURL: credentials.baseUrl,
  });

  return {
    type: 'openai',

    async complete(options) {
      const response = await client.chat.completions.create({
        model: options.model,
        messages: options.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.map(p =>
            p.type === 'text' ? { type: 'text', text: p.text } : p
          ),
          tool_calls: m.toolCalls?.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
          tool_call_id: m.toolCallId,
        })),
        tools: options.tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: false,
      });

      const choice = response.choices[0];
      return {
        id: response.id,
        model: response.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: choice.message.content || '',
            toolCalls: choice.message.tool_calls?.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments),
            })),
          },
          finishReason: choice.finish_reason as 'stop' | 'tool_calls' | null,
        }],
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
      };
    },

    async *stream(options) {
      const stream = await client.chat.completions.create({
        model: options.model,
        messages: options.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.map(p =>
            p.type === 'text' ? { type: 'text', text: p.text } : p
          ),
          tool_calls: m.toolCalls?.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
          tool_call_id: m.toolCallId,
        })),
        tools: options.tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { type: 'text_delta', text: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield {
              type: 'tool_call_delta',
              toolCall: {
                index: tc.index,
                id: tc.id,
                name: tc.function?.name,
                arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined,
              },
            };
          }
        }
        if (chunk.choices[0]?.finish_reason) {
          yield { type: 'done', finishReason: chunk.choices[0].finish_reason };
        }
      }
    },

    async listModels() {
      const response = await client.models.list();
      return response.data.map((m: { id: string }) => m.id);
    },

    async healthCheck() {
      try {
        await client.models.list();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Google Vertex AI Provider (Gemini)
 */
function createVertexAIProvider(credentials: ProviderCredentials): Provider {
  // Uses @google/genai SDK
  const { GoogleGenAI } = require('@google/genai');
  const genAI = new GoogleGenAI({
    apiKey: credentials.apiKey,
    // For Vertex AI, would use vertexAI: true and projectId
  });

  return {
    type: 'vertex-ai',

    async complete(options) {
      const model = genAI.getGenerativeModel({ model: options.model });

      const result = await model.generateContent({
        contents: options.messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('') }],
        })),
        systemInstruction: options.messages.find(m => m.role === 'system')?.content as string,
        tools: options.tools ? [{
          functionDeclarations: options.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        }] : undefined,
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        },
      });

      const response = result.response;
      const text = response.text();
      const functionCalls = response.functionCalls();

      return {
        id: `gemini-${Date.now()}`,
        model: options.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: text || '',
            toolCalls: functionCalls?.map((fc: { name: string; args: Record<string, unknown> }, i: number) => ({
              id: `call_${i}`,
              name: fc.name,
              arguments: fc.args,
            })),
          },
          finishReason: functionCalls?.length ? 'tool_calls' : 'stop',
        }],
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
      };
    },

    async *stream(options) {
      const model = genAI.getGenerativeModel({ model: options.model });

      const result = await model.generateContentStream({
        contents: options.messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('') }],
        })),
        systemInstruction: options.messages.find(m => m.role === 'system')?.content as string,
        tools: options.tools ? [{
          functionDeclarations: options.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        }] : undefined,
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        },
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield { type: 'text_delta', text };
        }
      }

      yield { type: 'done' };
    },

    async listModels() {
      return ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'];
    },

    async healthCheck() {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        await model.generateContent('test');
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Azure OpenAI Provider
 */
function createAzureOpenAIProvider(credentials: ProviderCredentials): Provider {
  const OpenAI = require('openai').default;
  const client = new OpenAI({
    apiKey: credentials.azureApiKey,
    baseURL: `${credentials.azureEndpoint}/openai/deployments/${credentials.azureDeploymentName}`,
    defaultQuery: { 'api-version': credentials.azureApiVersion || '2024-02-15-preview' },
    defaultHeaders: { 'api-key': credentials.azureApiKey },
  });

  // Azure OpenAI uses the same API as OpenAI, so we can reuse the OpenAI provider logic
  const openaiProvider = createOpenAIProvider({
    ...credentials,
    type: 'openai',
    apiKey: credentials.azureApiKey,
    baseUrl: `${credentials.azureEndpoint}/openai/deployments/${credentials.azureDeploymentName}`,
  });

  return {
    ...openaiProvider,
    type: 'azure-openai',
  };
}

/**
 * AWS Bedrock Provider
 * Uses the Converse API for unified model access
 */
function createBedrockProvider(credentials: ProviderCredentials): Provider {
  const {
    BedrockRuntimeClient,
    ConverseCommand,
    ConverseStreamCommand,
  } = require('@aws-sdk/client-bedrock-runtime');

  const client = new BedrockRuntimeClient({
    region: credentials.awsRegion || 'us-east-1',
    credentials: credentials.awsAccessKeyId ? {
      accessKeyId: credentials.awsAccessKeyId,
      secretAccessKey: credentials.awsSecretAccessKey!,
      sessionToken: credentials.awsSessionToken,
    } : undefined, // Use default credential chain if not specified
  });

  return {
    type: 'bedrock',

    async complete(options) {
      // Convert messages to Bedrock Converse format
      const systemPrompts = options.messages
        .filter(m => m.role === 'system')
        .map(m => ({ text: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('') }));

      const messages = options.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: [{
            text: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join(''),
          }],
        }));

      // Convert tools to Bedrock format
      const toolConfig = options.tools?.length ? {
        tools: options.tools.map(t => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.inputSchema },
          },
        })),
      } : undefined;

      const command = new ConverseCommand({
        modelId: options.model,
        messages,
        system: systemPrompts.length ? systemPrompts : undefined,
        toolConfig,
        inferenceConfig: {
          maxTokens: options.maxTokens || 4096,
          temperature: options.temperature,
        },
      });

      const response = await client.send(command);

      // Extract text and tool use from response
      const outputMessage = response.output?.message;
      let textContent = '';
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      if (outputMessage?.content) {
        for (const block of outputMessage.content) {
          if (block.text) {
            textContent += block.text;
          }
          if (block.toolUse) {
            toolCalls.push({
              id: block.toolUse.toolUseId,
              name: block.toolUse.name,
              arguments: block.toolUse.input || {},
            });
          }
        }
      }

      return {
        id: `bedrock-${Date.now()}`,
        model: options.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: textContent,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finishReason: response.stopReason === 'tool_use' ? 'tool_calls' : 'stop',
        }],
        usage: {
          promptTokens: response.usage?.inputTokens || 0,
          completionTokens: response.usage?.outputTokens || 0,
          totalTokens: (response.usage?.inputTokens || 0) + (response.usage?.outputTokens || 0),
        },
      };
    },

    async *stream(options) {
      // Convert messages to Bedrock Converse format
      const systemPrompts = options.messages
        .filter(m => m.role === 'system')
        .map(m => ({ text: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('') }));

      const messages = options.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: [{
            text: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join(''),
          }],
        }));

      // Convert tools to Bedrock format
      const toolConfig = options.tools?.length ? {
        tools: options.tools.map(t => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.inputSchema },
          },
        })),
      } : undefined;

      const command = new ConverseStreamCommand({
        modelId: options.model,
        messages,
        system: systemPrompts.length ? systemPrompts : undefined,
        toolConfig,
        inferenceConfig: {
          maxTokens: options.maxTokens || 4096,
          temperature: options.temperature,
        },
      });

      const response = await client.send(command);

      // Track tool use blocks being built
      let currentToolUse: { id: string; name: string; input: string } | null = null;

      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          yield { type: 'text_delta', text: event.contentBlockDelta.delta.text };
        }

        // Tool use start
        if (event.contentBlockStart?.start?.toolUse) {
          currentToolUse = {
            id: event.contentBlockStart.start.toolUse.toolUseId,
            name: event.contentBlockStart.start.toolUse.name,
            input: '',
          };
        }

        // Tool use input delta
        if (event.contentBlockDelta?.delta?.toolUse?.input) {
          if (currentToolUse) {
            currentToolUse.input += event.contentBlockDelta.delta.toolUse.input;
          }
        }

        // Content block stop - finalize tool use
        if (event.contentBlockStop && currentToolUse) {
          try {
            yield {
              type: 'tool_call_delta',
              toolCall: {
                index: 0,
                id: currentToolUse.id,
                name: currentToolUse.name,
                arguments: currentToolUse.input ? JSON.parse(currentToolUse.input) : {},
              },
            };
          } catch {
            // JSON parse failed, yield raw
            yield {
              type: 'tool_call_delta',
              toolCall: {
                index: 0,
                id: currentToolUse.id,
                name: currentToolUse.name,
                arguments: {},
              },
            };
          }
          currentToolUse = null;
        }

        // Message stop
        if (event.messageStop) {
          yield {
            type: 'done',
            finishReason: event.messageStop.stopReason === 'tool_use' ? 'tool_calls' : 'stop',
          };
        }
      }
    },

    async listModels() {
      // Common Bedrock model IDs
      return [
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
        'anthropic.claude-3-5-haiku-20241022-v1:0',
        'anthropic.claude-3-opus-20240229-v1:0',
        'amazon.titan-text-premier-v1:0',
        'amazon.titan-text-express-v1',
        'meta.llama3-1-405b-instruct-v1:0',
        'meta.llama3-1-70b-instruct-v1:0',
        'mistral.mixtral-8x7b-instruct-v0:1',
        'cohere.command-r-plus-v1:0',
      ];
    },

    async healthCheck() {
      try {
        // Try a minimal request to verify credentials
        const command = new ConverseCommand({
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
          messages: [{ role: 'user', content: [{ text: 'test' }] }],
          inferenceConfig: { maxTokens: 1 },
        });
        await client.send(command);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export default createProvider;
