/**
 * Azure OpenAI Provider
 *
 * Implements ILLMProvider for Azure OpenAI with proper 2025 SDK patterns
 * Supports both Entra ID (recommended) and API key authentication
 *
 * SDK: openai@4.x with Azure OpenAI v1 API (August 2025+)
 * Auth: @azure/identity for Entra ID
 */

import { AzureOpenAI } from 'openai';
import { ClientSecretCredential, getBearerTokenProvider } from '@azure/identity';
import {
  BaseLLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderHealth,
  ProviderConfig
} from './ILLMProvider.js';
import type { Logger } from 'pino';

export class AzureOpenAIProvider extends BaseLLMProvider {
  readonly name = 'Azure OpenAI';
  readonly type = 'azure-openai' as const;

  private client?: AzureOpenAI;
  private embeddingClient?: AzureOpenAI;
  private credential?: ClientSecretCredential;
  private endpoint?: string;
  private deployment?: string;
  private apiVersion?: string;

  constructor(logger: Logger) {
    super(logger, 'Azure OpenAI');
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    try {
      const {
        endpoint,
        tenantId,
        clientId,
        clientSecret,
        apiKey,
        deployment,
        apiVersion = '2024-10-21' // Latest GA version as of 2025
      } = config;

      if (!endpoint || !deployment) {
        throw new Error('Azure OpenAI configuration missing. Required: endpoint, deployment');
      }

      this.endpoint = endpoint;
      this.deployment = deployment;
      this.apiVersion = apiVersion;

      // Ensure endpoint ends with slash
      const normalizedEndpoint = this.endpoint.endsWith('/') ? this.endpoint : `${this.endpoint}/`;

      // Choose authentication method: Entra ID (preferred) or API Key
      if (tenantId && clientId && clientSecret) {
        // Entra ID (Service Principal) authentication using 2025 best practices
        // Use getBearerTokenProvider for automatic token refresh
        this.credential = new ClientSecretCredential(
          tenantId,
          clientId,
          clientSecret
        );

        const azureADTokenProvider = getBearerTokenProvider(
          this.credential,
          'https://cognitiveservices.azure.com/.default'
        );

        // Create AzureOpenAI client with token provider
        // IMPORTANT: Temporarily remove AZURE_OPENAI_API_KEY from env to prevent SDK from auto-loading it
        // The SDK throws an error if both apiKey and azureADTokenProvider are provided
        const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_API_KEY;

        try {
          this.client = new AzureOpenAI({
            azureADTokenProvider, // Token provider auto-refreshes
            deployment: this.deployment,
            apiVersion: this.apiVersion,
            endpoint: normalizedEndpoint
          });
        } finally {
          // Restore the API key for other services (like EmbeddingService) that need it
          if (savedApiKey) {
            process.env.AZURE_OPENAI_API_KEY = savedApiKey;
          }
        }

        this.logger.info({
          authType: 'entra-id',
          endpoint: normalizedEndpoint,
          deployment: this.deployment,
          apiVersion: this.apiVersion,
          baseURL: `${normalizedEndpoint}openai/v1/`
        }, 'Azure OpenAI provider initialized with Entra ID (2025 SDK pattern)');

      } else if (apiKey) {
        // API Key authentication (not recommended for production)
        this.client = new AzureOpenAI({
          apiKey: apiKey,
          deployment: this.deployment,
          apiVersion: this.apiVersion,
          endpoint: normalizedEndpoint
        });

        this.logger.info({
          authType: 'api-key',
          endpoint: normalizedEndpoint,
          deployment: this.deployment,
          apiVersion: this.apiVersion,
          baseURL: `${normalizedEndpoint}openai/v1/`
        }, 'Azure OpenAI provider initialized with API key (2025 SDK pattern)');

      } else {
        throw new Error(
          'Azure OpenAI authentication missing. Provide either (tenantId, clientId, clientSecret) for Entra ID or (apiKey) for API key authentication'
        );
      }

      // Initialize separate embedding client if different endpoint is configured
      await this.initializeEmbeddingClient();

      this.initialized = true;

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize Azure OpenAI provider');
      throw error;
    }
  }

  /**
   * Initialize a separate embedding client to bypass ModelRouter for embeddings
   * Always creates dedicated client for embedding operations
   */
  private async initializeEmbeddingClient(): Promise<void> {
    try {
      const embeddingEndpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || this.endpoint;

      // ALWAYS create a dedicated embedding client to bypass ModelRouter
      // ModelRouter only supports chat completions, not embeddings
      // For embedding operations, always construct a direct baseURL to bypass ModelRouter
      // This ensures embeddings don't go through ModelRouter which only supports chat completions
      const baseURL = `${embeddingEndpoint.replace(/\/+$/, '')}/openai/v1/`;

      this.logger.info({
        embeddingEndpoint,
        baseURL,
        usingDedicatedClient: true,
        reason: 'Bypassing ModelRouter for embeddings'
      }, 'Creating dedicated embedding client');

      if (this.credential) {
        // Use Entra ID authentication for embedding client
        // Temporarily remove API key from env to prevent SDK conflicts
        const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
        delete process.env.AZURE_OPENAI_API_KEY;

        try {
          this.embeddingClient = new AzureOpenAI({
            azureADTokenProvider: getBearerTokenProvider(this.credential, 'https://cognitiveservices.azure.com/.default'),
            apiVersion: this.apiVersion,
            baseURL: baseURL // Direct baseURL to bypass ModelRouter
          });
        } finally {
          // Restore API key for other services
          if (savedApiKey) {
            process.env.AZURE_OPENAI_API_KEY = savedApiKey;
          }
        }
      } else {
        // Use API key authentication
        const apiKey = process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY;

        if (!apiKey) {
          throw new Error('No API key available for embedding client');
        }

        this.embeddingClient = new AzureOpenAI({
          apiKey,
          apiVersion: this.apiVersion,
          baseURL: baseURL // Direct baseURL to bypass ModelRouter
        });
      }

      this.logger.info({
        embeddingEndpoint,
        baseURL,
        usingDedicatedClient: true
      }, 'Azure OpenAI embedding client configured successfully');

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize embedding client');
      throw error;
    }
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.client) {
      throw new Error('Azure OpenAI provider not initialized');
    }

    const startTime = Date.now();

    try {
      // Note: Token refresh is automatic with getBearerTokenProvider (2025 SDK pattern)
      // No manual refresh needed

      // Prepare parameters (model/deployment handled via baseURL)
      const params: any = {
        model: this.deployment, // For Azure v1 API
        messages: request.messages,
        stream: request.stream !== false
      };

      // Add optional parameters only if provided
      if (request.temperature !== undefined) params.temperature = request.temperature;
      if (request.max_tokens !== undefined) params.max_completion_tokens = request.max_tokens;
      if (request.top_p !== undefined) params.top_p = request.top_p;
      if (request.frequency_penalty !== undefined) params.frequency_penalty = request.frequency_penalty;
      if (request.presence_penalty !== undefined) params.presence_penalty = request.presence_penalty;
      if (request.user) params.user = request.user;

      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        params.tools = request.tools;
        params.tool_choice = request.tool_choice || 'auto';
      }

      // Add response format if provided
      if (request.response_format) {
        params.response_format = request.response_format;
      }

      // Make request
      const response = await this.client.chat.completions.create(params);

      const latency = Date.now() - startTime;

      // Track metrics for non-streaming
      if (request.stream === false && 'usage' in response) {
        const tokens = response.usage?.total_tokens || 0;
        const cost = this.calculateCost(tokens);
        this.trackSuccess(latency, tokens, cost);

        this.logger.info({
          model: this.deployment,
          usage: response.usage,
          latency
        }, 'Azure OpenAI completion successful');
      }

      return response as any;

    } catch (error) {
      this.trackFailure();
      this.logger.error({
        error: error instanceof Error ? error.message : error,
        endpoint: this.endpoint,
        deployment: this.deployment
      }, 'Azure OpenAI completion failed');
      throw error;
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    return [{
      id: this.deployment || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL,
      name: this.deployment || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL,
      provider: 'azure-openai'
    }];
  }

  async getHealth(): Promise<ProviderHealth> {
    try {
      if (!this.client) {
        return {
          status: 'not_initialized',
          provider: this.name,
          error: 'Provider not initialized',
          lastChecked: new Date()
        };
      }

      // Test with a simple model list call
      await this.listModels();

      return {
        status: 'healthy',
        provider: this.name,
        endpoint: this.endpoint,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.endpoint,
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Note: Token refresh is automatic with getBearerTokenProvider (2025 SDK pattern)
   * Manual refresh methods are deprecated and no longer needed
   */

  /**
   * Generate text embeddings using Azure OpenAI embedding model
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    if (!this.embeddingClient) {
      throw new Error('Azure OpenAI embedding client not initialized');
    }

    try {
      const input = Array.isArray(text) ? text : [text];

      // Use the embedding deployment from environment or fallback
      const embeddingModel = process.env.DEFAULT_EMBEDDING_DEPLOYMENT || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || process.env.EMBEDDING_MODEL;

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        usingDirectClient: true,
        embeddingEndpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT
      }, 'Generating Azure OpenAI embeddings with dedicated client');

      const response = await this.embeddingClient.embeddings.create({
        input,
        model: embeddingModel
      });

      const embeddings = response.data.map(item => item.embedding);

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        dimensions: embeddings[0]?.length,
        usingDirectClient: this.embeddingClient !== this.client
      }, 'Azure OpenAI embeddings generated successfully');

      return Array.isArray(text) ? embeddings : embeddings[0];

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : error,
        endpoint: this.endpoint
      }, 'Azure OpenAI embedding generation failed');
      throw error;
    }
  }

  /**
   * Calculate cost based on tokens
   * TODO: Implement proper pricing based on model
   */
  private calculateCost(tokens: number): number {
    // Placeholder - implement actual pricing
    return tokens * 0.00001;
  }
}
