/**
 * LLM Provider Interface
 *
 * Defines the contract for all LLM providers (Azure OpenAI, AWS Bedrock, Google Vertex AI)
 */

import type { Logger } from 'pino';

/**
 * Provider configuration
 */
export interface ProviderConfig {
  provider: 'azure-openai' | 'aws-bedrock' | 'google-vertex' | 'ollama' | 'azure-ai-foundry' | 'anthropic';
  enabled: boolean;
  priority?: number;
  config: Record<string, any>;
}

/**
 * Chat completion request
 */
export interface CompletionRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
  response_format?: any;
  user?: string;
}

/**
 * Chat completion response
 */
export interface CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: any[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  status: 'healthy' | 'unhealthy' | 'not_initialized';
  provider: string;
  endpoint?: string;
  error?: string;
  lastChecked: Date;
}

/**
 * Provider metrics
 */
export interface ProviderMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  totalTokens: number;
  totalCost: number;
  lastUsed?: Date;
}

/**
 * LLM Provider Interface
 */
export interface ILLMProvider {
  /** Provider name */
  readonly name: string;

  /** Provider type */
  readonly type: ProviderConfig['provider'];

  /** Initialize the provider */
  initialize(config: ProviderConfig['config']): Promise<void>;

  /** Check if provider is initialized */
  isInitialized(): boolean;

  /** Create chat completion */
  createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>>;

  /** List available models */
  listModels(): Promise<Array<{
    id: string;
    name: string;
    provider: string;
  }>>;

  /** Get provider health status */
  getHealth(): Promise<ProviderHealth>;

  /** Get provider metrics */
  getMetrics(): ProviderMetrics;

  /** Reset metrics */
  resetMetrics(): void;

  /** Generate text embeddings (optional - for embedding models) */
  embedText?(text: string | string[]): Promise<number[] | number[][]>;
}

/**
 * Base LLM Provider abstract class
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  protected logger: Logger;
  protected initialized: boolean = false;
  protected metrics: ProviderMetrics;

  constructor(protected providerLogger: Logger, providerName: string) {
    this.logger = providerLogger;
    this.metrics = {
      provider: providerName,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      totalTokens: 0,
      totalCost: 0
    };
  }

  abstract readonly name: string;
  abstract readonly type: ProviderConfig['provider'];
  abstract initialize(config: ProviderConfig['config']): Promise<void>;
  abstract createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>>;
  abstract listModels(): Promise<Array<{ id: string; name: string; provider: string }>>;
  abstract getHealth(): Promise<ProviderHealth>;

  isInitialized(): boolean {
    return this.initialized;
  }

  getMetrics(): ProviderMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      provider: this.name,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      totalTokens: 0,
      totalCost: 0
    };
    this.logger.info({ provider: this.name }, 'Metrics reset');
  }

  /**
   * Track a successful request
   */
  protected trackSuccess(latency: number, tokens: number, cost: number): void {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.metrics.totalTokens += tokens;
    this.metrics.totalCost += cost;
    this.metrics.lastUsed = new Date();

    // Update average latency
    const totalLatency = this.metrics.averageLatency * (this.metrics.successfulRequests - 1) + latency;
    this.metrics.averageLatency = totalLatency / this.metrics.successfulRequests;
  }

  /**
   * Track a failed request
   */
  protected trackFailure(): void {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
  }
}
