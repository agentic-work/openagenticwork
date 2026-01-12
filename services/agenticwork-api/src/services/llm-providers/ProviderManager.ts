/**
 * LLM Provider Manager
 *
 * Central service for managing multiple LLM providers (Azure OpenAI, AWS Bedrock, Google Vertex AI)
 * Handles provider registration, routing, failover, and load balancing
 */

import type { Logger } from 'pino';
import { ILLMProvider, CompletionRequest, CompletionResponse, ProviderHealth } from './ILLMProvider.js';
import { AzureOpenAIProvider } from './AzureOpenAIProvider.js';
import { AWSBedrockProvider } from './AWSBedrockProvider.js';
import { GoogleVertexProvider } from './GoogleVertexProvider.js';

export interface ProviderConfig {
  name: string;
  type: 'azure-openai' | 'aws-bedrock' | 'google-vertex' | 'ollama' | 'azure-ai-foundry';
  enabled: boolean;
  priority: number; // Lower number = higher priority
  config: Record<string, any>;
}

export interface ProviderManagerConfig {
  providers: ProviderConfig[];
  defaultProvider?: string;
  enableFailover: boolean;
  failoverTimeout: number; // ms
  enableLoadBalancing: boolean;
  loadBalancingStrategy: 'round-robin' | 'least-latency' | 'priority';
}

export interface ProviderMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  totalTokens: number;
  totalCost: number;
  lastHealthCheck?: ProviderHealth;
  uptime: number; // percentage
}

/**
 * Failover metadata returned when a provider fails and another takes over
 */
export interface FailoverMetadata {
  occurred: boolean;
  originalProvider: string;
  failedProvider?: string;
  failoverProvider?: string;
  failureReason?: string;
  failoverTime?: number; // ms
  attemptCount?: number;
}

export class ProviderManager {
  private logger: Logger;
  private providers: Map<string, ILLMProvider> = new Map();
  private config: ProviderManagerConfig;
  private metrics: Map<string, ProviderMetrics> = new Map();
  private roundRobinIndex = 0;
  private initialized = false;

  constructor(logger: Logger, config: ProviderManagerConfig) {
    this.logger = logger;
    this.config = config;
  }

  /**
   * Initialize all configured providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('ProviderManager already initialized');
      return;
    }

    this.logger.info({
      providerCount: this.config.providers.length,
      enableFailover: this.config.enableFailover,
      loadBalancingStrategy: this.config.loadBalancingStrategy
    }, 'Initializing ProviderManager');

    // Sort providers by priority
    const sortedProviders = [...this.config.providers].sort((a, b) => a.priority - b.priority);

    for (const providerConfig of sortedProviders) {
      if (!providerConfig.enabled) {
        this.logger.info({ provider: providerConfig.name }, 'Provider disabled, skipping');
        continue;
      }

      try {
        const provider = await this.createProvider(providerConfig);
        await provider.initialize(providerConfig.config);

        this.providers.set(providerConfig.name, provider);

        // Initialize metrics
        this.metrics.set(providerConfig.name, {
          provider: providerConfig.name,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          averageLatency: 0,
          totalTokens: 0,
          totalCost: 0,
          uptime: 100
        });

        this.logger.info({
          provider: providerConfig.name,
          type: providerConfig.type
        }, 'Provider initialized successfully');

      } catch (error) {
        this.logger.error({
          provider: providerConfig.name,
          error: error instanceof Error ? error.message : error
        }, 'Failed to initialize provider');
      }
    }

    // Allow initialization even if no providers are available
    // The admin UI can show warnings instead of completely failing
    if (this.providers.size === 0) {
      this.logger.warn('No providers initialized successfully - admin UI will show warnings');
    }

    // Build model-to-provider mapping from configurations
    this.buildModelToProviderMap();

    this.initialized = true;
    this.logger.info({
      initializedProviders: Array.from(this.providers.keys())
    }, 'ProviderManager initialized');
  }

  /**
   * Create a provider instance based on type
   */
  private async createProvider(config: ProviderConfig): Promise<ILLMProvider> {
    switch (config.type) {
      case 'azure-openai':
        return new AzureOpenAIProvider(this.logger);

      case 'aws-bedrock':
        return new AWSBedrockProvider(this.logger);

      case 'google-vertex':
        return new GoogleVertexProvider(this.logger);

      case 'ollama':
        const { OllamaProvider } = await import('./OllamaProvider.js');
        return new OllamaProvider(this.logger);

      case 'azure-ai-foundry':
        const { AzureAIFoundryProvider } = await import('./AzureAIFoundryProvider.js');
        return new AzureAIFoundryProvider(this.logger);

      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  // Track last failover metadata for retrieval
  private lastFailoverMetadata: FailoverMetadata | null = null;

  /**
   * Get the last failover metadata (for the completion stage to emit to client)
   */
  getLastFailoverMetadata(): FailoverMetadata | null {
    return this.lastFailoverMetadata;
  }

  /**
   * Clear the last failover metadata
   */
  clearFailoverMetadata(): void {
    this.lastFailoverMetadata = null;
  }

  /**
   * Create a completion using the appropriate provider
   */
  async createCompletion(request: CompletionRequest, targetProvider?: string): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized) {
      throw new Error('ProviderManager not initialized');
    }

    // Clear previous failover metadata
    this.lastFailoverMetadata = null;

    // If target provider specified, use it directly
    if (targetProvider) {
      const provider = this.providers.get(targetProvider);
      if (!provider) {
        throw new Error(`Provider not found: ${targetProvider}`);
      }
      return this.executeCompletion(provider, targetProvider, request);
    }

    // Select provider based on strategy
    const provider = this.selectProvider(request);
    if (!provider) {
      throw new Error('No available providers');
    }

    const [providerInstance, providerName] = provider;

    // Execute with failover if enabled
    if (this.config.enableFailover) {
      return this.executeWithFailover(providerInstance, providerName, request);
    }

    return this.executeCompletion(providerInstance, providerName, request);
  }

  /**
   * Model-to-provider mapping cache (built from provider configurations)
   * This is populated during initialization from each provider's configured models
   */
  private modelToProviderMap: Map<string, string> = new Map();

  /**
   * Build the model-to-provider mapping from provider configurations
   * Called during initialization to create a lookup table
   */
  private buildModelToProviderMap(): void {
    this.modelToProviderMap.clear();

    for (const providerConfig of this.config.providers) {
      if (!providerConfig.enabled) continue;

      const providerName = providerConfig.name;
      const config = providerConfig.config || {};

      // Collect all model IDs configured for this provider
      const modelIds: string[] = [];

      // Standard model configurations (check all possible model config keys)
      const modelConfigKeys = [
        'modelId', 'model', 'deployment',
        'chatModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel',
        'functionCallingModel', 'healthCheckModel'
      ];

      for (const key of modelConfigKeys) {
        if (config[key] && typeof config[key] === 'string') {
          modelIds.push(config[key]);
        }
      }

      // Register each model ID to this provider
      for (const modelId of modelIds) {
        const normalizedModelId = modelId.toLowerCase();

        // Don't overwrite if already registered (first provider wins based on priority)
        if (!this.modelToProviderMap.has(normalizedModelId)) {
          this.modelToProviderMap.set(normalizedModelId, providerName);
          this.logger.debug({
            model: modelId,
            provider: providerName
          }, '[ProviderManager] Registered model-to-provider mapping');
        }
      }
    }

    this.logger.info({
      mappingCount: this.modelToProviderMap.size,
      mappings: Object.fromEntries(this.modelToProviderMap)
    }, '[ProviderManager] Built model-to-provider mapping from configuration');
  }

  /**
   * Detect which provider should handle a given model
   * Uses ONLY the configured model mappings - NO hardcoded patterns
   */
  private detectProviderForModel(model: string): string | null {
    if (!model) return null;

    const modelLower = model.toLowerCase();

    // Direct match from configuration
    if (this.modelToProviderMap.has(modelLower)) {
      return this.modelToProviderMap.get(modelLower)!;
    }

    // Try without version suffix (e.g., "gpt-oss:latest" -> "gpt-oss")
    const modelWithoutVersion = modelLower.split(':')[0];
    if (modelWithoutVersion !== modelLower && this.modelToProviderMap.has(modelWithoutVersion)) {
      this.logger.debug({
        originalModel: model,
        strippedModel: modelWithoutVersion
      }, '[ProviderManager] Matched model after stripping version suffix');
      return this.modelToProviderMap.get(modelWithoutVersion)!;
    }

    // Pattern-based provider detection for well-known model ID formats
    // AWS Bedrock models use formats like:
    // - us.anthropic.claude-* (Anthropic Claude on Bedrock)
    // - amazon.titan-* (Amazon Titan models)
    // - ai21.*, cohere.*, meta.*, mistral.* (other Bedrock providers)
    if (modelLower.startsWith('us.anthropic.') ||
        modelLower.startsWith('anthropic.') ||
        modelLower.startsWith('amazon.') ||
        modelLower.startsWith('ai21.') ||
        modelLower.startsWith('cohere.') ||
        modelLower.startsWith('meta.') ||
        modelLower.startsWith('mistral.')) {
      if (this.providers.has('aws-bedrock')) {
        this.logger.debug({
          model: model,
          pattern: 'bedrock-model-id'
        }, '[ProviderManager] Detected AWS Bedrock model by ID pattern');
        return 'aws-bedrock';
      }
    }

    // Vertex AI / Google models
    if (modelLower.startsWith('gemini') ||
        modelLower.startsWith('palm') ||
        modelLower.startsWith('imagen') ||
        modelLower.includes('vertex')) {
      if (this.providers.has('vertex-ai')) {
        this.logger.debug({
          model: model,
          pattern: 'vertex-model-id'
        }, '[ProviderManager] Detected Vertex AI model by ID pattern');
        return 'vertex-ai';
      }
    }

    // OpenAI models
    if (modelLower.startsWith('gpt-') ||
        modelLower.startsWith('o1-') ||
        modelLower.startsWith('o3-') ||
        modelLower.startsWith('text-davinci') ||
        modelLower.startsWith('text-embedding')) {
      // Check for Azure OpenAI first
      if (this.providers.has('azure-openai')) {
        this.logger.debug({
          model: model,
          pattern: 'openai-model-id'
        }, '[ProviderManager] Detected OpenAI model, routing to Azure OpenAI');
        return 'azure-openai';
      }
      if (this.providers.has('openai')) {
        return 'openai';
      }
    }

    // Ollama models (local)
    if (modelLower.includes(':latest') ||
        modelLower.startsWith('llama') ||
        modelLower.startsWith('codellama') ||
        modelLower.startsWith('qwen') ||
        modelLower.startsWith('deepseek') ||
        modelLower.startsWith('phi')) {
      if (this.providers.has('ollama')) {
        this.logger.debug({
          model: model,
          pattern: 'ollama-model-id'
        }, '[ProviderManager] Detected Ollama model by ID pattern');
        return 'ollama';
      }
    }

    // No match found - return null to use default provider routing
    return null;
  }

  /**
   * PUBLIC method to get the provider for a model
   * Can be called by completion stage to determine routing
   */
  public getProviderForModel(model: string): string | null {
    return this.detectProviderForModel(model);
  }

  /**
   * Select a provider based on load balancing strategy
   * CRITICAL: First checks if the request.model requires a specific provider
   */
  private selectProvider(request: CompletionRequest): [ILLMProvider, string] | null {
    const availableProviders = Array.from(this.providers.entries());

    if (availableProviders.length === 0) {
      return null;
    }

    // CRITICAL: First, check if the model requires a specific provider
    // This ensures gpt-oss goes to Ollama, gemini goes to Vertex, etc.
    if (request.model) {
      const requiredProvider = this.detectProviderForModel(request.model);

      if (requiredProvider) {
        const matchedProvider = availableProviders.find(([name]) => name === requiredProvider);

        if (matchedProvider) {
          this.logger.info({
            model: request.model,
            detectedProvider: requiredProvider,
            available: true
          }, '[ProviderManager] Model-based provider routing');

          return [matchedProvider[1], matchedProvider[0]];
        } else {
          this.logger.warn({
            model: request.model,
            detectedProvider: requiredProvider,
            availableProviders: availableProviders.map(([name]) => name)
          }, '[ProviderManager] Required provider not available, falling back to default routing');
        }
      }
    }

    // Fall back to standard load balancing if no model-specific routing
    switch (this.config.loadBalancingStrategy) {
      case 'round-robin':
        return this.selectRoundRobin(availableProviders);

      case 'least-latency':
        return this.selectLeastLatency(availableProviders);

      case 'priority':
      default:
        // Return [provider, name] tuple - already sorted by priority
        const [name, provider] = availableProviders[0];
        return [provider, name];
    }
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(providers: [string, ILLMProvider][]): [ILLMProvider, string] {
    const [name, provider] = providers[this.roundRobinIndex % providers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % providers.length;
    return [provider, name];
  }

  /**
   * Select provider with lowest average latency
   */
  private selectLeastLatency(providers: [string, ILLMProvider][]): [ILLMProvider, string] {
    let bestProvider = providers[0];
    let lowestLatency = this.metrics.get(providers[0][0])?.averageLatency ?? Infinity;

    for (const [name, provider] of providers) {
      const metrics = this.metrics.get(name);
      if (metrics && metrics.averageLatency < lowestLatency) {
        lowestLatency = metrics.averageLatency;
        bestProvider = [name, provider];
      }
    }

    return [bestProvider[1], bestProvider[0]];
  }

  /**
   * Execute completion with a specific provider
   */
  private async executeCompletion(
    provider: ILLMProvider,
    providerName: string,
    request: CompletionRequest
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();
    const metrics = this.metrics.get(providerName)!;

    try {
      metrics.totalRequests++;
      const response = await provider.createCompletion(request);

      const latency = Date.now() - startTime;
      metrics.successfulRequests++;
      metrics.averageLatency = (metrics.averageLatency * (metrics.successfulRequests - 1) + latency) / metrics.successfulRequests;

      // Update uptime
      metrics.uptime = (metrics.successfulRequests / metrics.totalRequests) * 100;

      this.logger.debug({
        provider: providerName,
        latency,
        uptime: metrics.uptime.toFixed(2)
      }, 'Completion successful');

      return response;

    } catch (error) {
      metrics.failedRequests++;
      metrics.uptime = (metrics.successfulRequests / metrics.totalRequests) * 100;

      this.logger.error({
        provider: providerName,
        error: error instanceof Error ? error.message : error,
        uptime: metrics.uptime.toFixed(2)
      }, 'Completion failed');

      throw error;
    }
  }

  /**
   * Execute completion with automatic failover
   * Populates lastFailoverMetadata if failover occurs
   */
  private async executeWithFailover(
    provider: ILLMProvider,
    providerName: string,
    request: CompletionRequest
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();
    const originalProvider = providerName;

    try {
      // Try primary provider with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), this.config.failoverTimeout);
      });

      const completionPromise = this.executeCompletion(provider, providerName, request);

      const result = await Promise.race([completionPromise, timeoutPromise]);

      // Success - no failover occurred
      this.lastFailoverMetadata = {
        occurred: false,
        originalProvider: providerName
      };

      return result;

    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.warn({
        provider: providerName,
        error: errorMessage,
        elapsed
      }, 'Provider failed, attempting failover');

      // Try next available provider
      const providers = Array.from(this.providers.entries());
      const currentIndex = providers.findIndex(([name]) => name === providerName);
      let attemptCount = 1;

      for (let i = 1; i < providers.length; i++) {
        attemptCount++;
        const nextIndex = (currentIndex + i) % providers.length;
        const [nextName, nextProvider] = providers[nextIndex];

        try {
          this.logger.info({
            from: providerName,
            to: nextName,
            attemptCount
          }, 'Failing over to alternate provider');

          const failoverStartTime = Date.now();
          const result = await this.executeCompletion(nextProvider, nextName, request);
          const failoverTime = Date.now() - failoverStartTime;

          // Failover succeeded - populate metadata
          this.lastFailoverMetadata = {
            occurred: true,
            originalProvider: originalProvider,
            failedProvider: providerName,
            failoverProvider: nextName,
            failureReason: errorMessage,
            failoverTime: failoverTime,
            attemptCount: attemptCount
          };

          this.logger.info({
            from: providerName,
            to: nextName,
            failoverTime,
            attemptCount
          }, '✅ Failover succeeded');

          return result;

        } catch (failoverError) {
          const failoverErrorMessage = failoverError instanceof Error ? failoverError.message : String(failoverError);
          this.logger.error({
            provider: nextName,
            error: failoverErrorMessage,
            attemptCount
          }, 'Failover provider also failed');

          // Update providerName for next iteration's error tracking
          providerName = nextName;
          continue;
        }
      }

      // All providers failed - populate metadata with final state
      this.lastFailoverMetadata = {
        occurred: true,
        originalProvider: originalProvider,
        failedProvider: providerName,
        failoverProvider: undefined,
        failureReason: 'All providers failed',
        attemptCount: attemptCount
      };

      throw new Error(`All providers failed. Original error: ${errorMessage}`);
    }
  }

  /**
   * Get list of available models from all providers
   */
  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    const models: Array<{ id: string; name: string; provider: string }> = [];

    for (const [name, provider] of this.providers.entries()) {
      try {
        const providerModels = await provider.listModels();
        models.push(...providerModels);
      } catch (error) {
        this.logger.error({
          provider: name,
          error: error instanceof Error ? error.message : error
        }, 'Failed to list models');
      }
    }

    return models;
  }

  /**
   * Get health status for all providers
   */
  async getHealthStatus(): Promise<Map<string, ProviderHealth>> {
    const healthStatus = new Map<string, ProviderHealth>();

    for (const [name, provider] of this.providers.entries()) {
      try {
        const health = await provider.getHealth();
        healthStatus.set(name, health);

        // Update metrics with health check result
        const metrics = this.metrics.get(name);
        if (metrics) {
          metrics.lastHealthCheck = health;
        }

      } catch (error) {
        healthStatus.set(name, {
          status: 'unhealthy',
          provider: name,
          error: error instanceof Error ? error.message : 'Unknown error',
          lastChecked: new Date()
        });
      }
    }

    return healthStatus;
  }

  /**
   * Get metrics for all providers
   */
  getMetrics(): Map<string, ProviderMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get metrics for a specific provider
   */
  getProviderMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }

  /**
   * Get list of registered provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all registered providers with their instances
   */
  getProviders(): Map<string, ILLMProvider> {
    return new Map(this.providers);
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(providerName: string): boolean {
    return this.providers.has(providerName);
  }

  /**
   * Get provider instance
   */
  getProvider(providerName: string): ILLMProvider | undefined {
    return this.providers.get(providerName);
  }

  /**
   * Reload providers from database configuration
   * This allows hot-reloading without service restart
   */
  async reloadProviders(): Promise<void> {
    this.logger.info('Reloading providers from configuration...');

    try {
      // Load fresh configuration from database + environment
      const { ProviderConfigService } = await import('./ProviderConfigService.js');
      const configService = new ProviderConfigService(this.logger);
      const newConfig = await configService.loadProviderConfig();

      // Store old providers for cleanup
      const oldProviders = new Map(this.providers);

      // Clear current providers
      this.providers.clear();
      this.metrics.clear();

      // Update config
      this.config = newConfig;

      // Re-initialize with new config
      this.initialized = false;
      await this.initialize();

      // Cleanup old providers that are no longer configured
      for (const [name, provider] of oldProviders.entries()) {
        if (!this.providers.has(name)) {
          this.logger.info({ provider: name }, 'Provider removed from configuration, cleaning up');
          // Provider-specific cleanup if needed
          try {
            if (typeof (provider as any).cleanup === 'function') {
              await (provider as any).cleanup();
            }
          } catch (cleanupError) {
            this.logger.warn({ provider: name, error: cleanupError }, 'Failed to cleanup old provider');
          }
        }
      }

      this.logger.info({
        providersLoaded: this.providers.size,
        providers: Array.from(this.providers.keys())
      }, 'Providers reloaded successfully');

    } catch (error) {
      this.logger.error({ error }, 'Failed to reload providers');
      throw error;
    }
  }
}
