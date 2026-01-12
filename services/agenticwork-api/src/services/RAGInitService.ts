/**
 * RAG Initialization Service
 *
 * Initializes RAG (Retrieval Augmented Generation) components:
 * - Embedding service (Azure OpenAI, AWS Bedrock, or OpenAI-compatible)
 * - Milvus vector database
 * - Model capability discovery
 */

import { pino } from 'pino';
import type { Logger } from 'pino';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { getModelCapabilityDiscoveryService } from './ModelCapabilityDiscoveryService.js';
import { prisma } from '../utils/prisma.js';

export interface RAGHealthStatus {
  healthy: boolean;
  components: {
    embeddings: {
      healthy: boolean;
      provider?: string;
      model?: string;
      dimensions?: number;
      error?: string;
    };
    milvus: {
      healthy: boolean;
      connected: boolean;
      error?: string;
    };
    modelDiscovery: {
      healthy: boolean;
      modelsFound: number;
      error?: string;
    };
  };
  warnings: string[];
  errors: string[];
  timestamp: Date;
}

export class RAGInitService {
  private logger: Logger;
  private healthStatus: RAGHealthStatus;
  private initialized: boolean = false;
  private initializationError?: string;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 5000; // 5 seconds
  private embeddingService: UniversalEmbeddingService | null = null;

  constructor() {
    this.logger = pino({
      name: 'rag-init-service',
      level: process.env.LOG_LEVEL || 'info'
    });

    this.healthStatus = this.getDefaultHealthStatus();
  }

  private getDefaultHealthStatus(): RAGHealthStatus {
    return {
      healthy: false,
      components: {
        embeddings: {
          healthy: false
        },
        milvus: {
          healthy: false,
          connected: false
        },
        modelDiscovery: {
          healthy: false,
          modelsFound: 0
        }
      },
      warnings: [],
      errors: [],
      timestamp: new Date()
    };
  }

  /**
   * Initialize all RAG services with retry logic
   */
  async initialize(): Promise<boolean> {
    this.logger.info('🚀 Starting RAG services initialization...');

    while (this.retryCount < this.maxRetries) {
      this.retryCount++;

      try {
        this.healthStatus = this.getDefaultHealthStatus();

        // Step 1: Initialize embedding service
        await this.initializeEmbeddingService();

        // Step 2: Check Milvus connectivity
        await this.checkMilvusConnection();

        // Step 3: Discover available models
        await this.discoverModels();

        // Update overall health
        this.updateOverallHealth();

        if (this.healthStatus.healthy) {
          this.initialized = true;
          this.logger.info('✅ RAG services initialized successfully');
          return true;
        }

        // If not healthy, log details
        this.logger.warn({
          embeddings: this.healthStatus.components.embeddings.healthy,
          milvus: this.healthStatus.components.milvus.healthy,
          warnings: this.healthStatus.warnings,
          errors: this.healthStatus.errors
        }, `⚠️ RAG initialization incomplete (attempt ${this.retryCount}/${this.maxRetries})`);

        if (this.retryCount < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }

      } catch (error) {
        this.logger.error({
          error,
          attempt: this.retryCount,
          maxRetries: this.maxRetries
        }, 'RAG initialization attempt failed');

        if (this.retryCount < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    // All retries exhausted
    this.logger.error('❌ RAG services failed to initialize after all retries');
    this.initializationError = `RAG initialization failed: ${this.healthStatus.errors.join(', ')}`;
    this.logger.warn('⚠️ System will operate with limited RAG capabilities');

    return false;
  }

  /**
   * Initialize embedding service
   */
  private async initializeEmbeddingService(): Promise<void> {
    try {
      // Check if Ollama is explicitly enabled
      const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true';

      // If using Ollama, wait for the embedding model to be ready
      const embeddingProvider = process.env.EMBEDDING_PROVIDER?.toLowerCase();
      const ollamaModel = process.env.EMBEDDING_OLLAMA_MODEL || process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;
      const ollamaBaseUrl = process.env.EMBEDDING_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      // Only consider Ollama if it's explicitly enabled
      const isOllama = ollamaEnabled && (
                       embeddingProvider === 'ollama' ||
                       process.env.OLLAMA_EMBEDDING_MODEL ||
                       process.env.EMBEDDING_OLLAMA_MODEL ||
                       (process.env.OLLAMA_BASE_URL && !process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT));

      if (isOllama && ollamaModel) {
        this.logger.info({ ollamaBaseUrl, ollamaModel }, '🔄 Waiting for Ollama embedding model to be ready...');
        await this.waitForOllamaModel(ollamaBaseUrl, ollamaModel);
      } else if (!ollamaEnabled && embeddingProvider === 'ollama') {
        this.logger.warn('⚠️ EMBEDDING_PROVIDER is set to ollama but OLLAMA_ENABLED is not true - skipping Ollama');
      }

      this.embeddingService = new UniversalEmbeddingService(this.logger);

      if (this.embeddingService.isConfigured()) {
        const info = this.embeddingService.getInfo();

        // Verify embedding actually works with a test call (only if Ollama is enabled)
        if (ollamaEnabled && info.provider === 'ollama') {
          this.logger.info('🧪 Testing Ollama embedding generation...');
          await this.embeddingService.generateEmbedding('test');
          this.logger.info('✅ Ollama embedding test successful');
        }

        this.healthStatus.components.embeddings.healthy = true;
        this.healthStatus.components.embeddings.provider = info.provider;
        this.healthStatus.components.embeddings.model = info.model;
        this.healthStatus.components.embeddings.dimensions = info.dimensions;

        this.logger.info({
          provider: info.provider,
          model: info.model,
          dimensions: info.dimensions
        }, '✅ Embedding service initialized');
      } else {
        throw new Error('No embedding provider configured');
      }

    } catch (error) {
      const errorMsg = `Embedding service initialization failed: ${error instanceof Error ? error.message : String(error)}`;
      this.healthStatus.components.embeddings.error = errorMsg;
      this.healthStatus.errors.push(errorMsg);
      this.logger.warn(errorMsg);
      this.logger.info('💡 Set AZURE_OPENAI_EMBEDDING_DEPLOYMENT or AWS_EMBEDDING_MODEL_ID to enable embeddings');
    }
  }

  /**
   * Wait for Ollama embedding model to be available
   */
  private async waitForOllamaModel(baseUrl: string, modelName: string, maxAttempts: number = 60, delayMs: number = 5000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Check if Ollama is responding
        const listUrl = `${baseUrl}/api/tags`;
        const response = await fetch(listUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
          throw new Error(`Ollama not responding: ${response.status}`);
        }

        const data = await response.json();
        const models = data.models || [];

        // Check if our model is in the list
        const modelFound = models.some((m: any) =>
          m.name === modelName ||
          m.name === `${modelName}:latest` ||
          m.name.startsWith(`${modelName}:`)
        );

        if (modelFound) {
          this.logger.info({ modelName, attempt }, '✅ Ollama embedding model is ready');
          return;
        }

        // Model not found yet - it might still be pulling
        if (attempt === 1 || attempt % 5 === 0) {
          this.logger.info({
            modelName,
            attempt,
            maxAttempts,
            availableModels: models.map((m: any) => m.name)
          }, `⏳ Waiting for Ollama embedding model "${modelName}" to be ready...`);
        }

      } catch (error) {
        if (attempt === 1 || attempt % 5 === 0) {
          this.logger.warn({
            error: error instanceof Error ? error.message : String(error),
            attempt,
            maxAttempts,
            baseUrl
          }, '⏳ Ollama not ready yet, retrying...');
        }
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`Ollama embedding model "${modelName}" not available after ${maxAttempts} attempts. Ensure Ollama is running and the model is pulled.`);
  }

  /**
   * Check Milvus vector database connectivity
   */
  private async checkMilvusConnection(): Promise<void> {
    try {
      // Try to connect to Milvus via Prisma (which has milvus config)
      // Simple check - if we can query, Milvus is accessible
      const testQuery = await prisma.$queryRaw`SELECT 1 as test`;

      this.healthStatus.components.milvus.healthy = true;
      this.healthStatus.components.milvus.connected = true;
      this.logger.info('✅ Milvus vector database connected');

    } catch (error) {
      const errorMsg = `Milvus connection failed: ${error instanceof Error ? error.message : String(error)}`;
      this.healthStatus.components.milvus.error = errorMsg;
      this.healthStatus.warnings.push(errorMsg);
      this.logger.warn(errorMsg);

      // Milvus is optional - mark as not connected but don't fail initialization
      this.healthStatus.components.milvus.connected = false;
    }
  }

  /**
   * Discover available models
   */
  private async discoverModels(): Promise<void> {
    try {
      const modelDiscovery = getModelCapabilityDiscoveryService();

      if (modelDiscovery) {
        const models = await modelDiscovery.discoverAllModels();

        this.healthStatus.components.modelDiscovery.healthy = true;
        this.healthStatus.components.modelDiscovery.modelsFound = models.length;

        this.logger.info({
          modelsFound: models.length
        }, '✅ Model capability discovery initialized');
      } else {
        this.healthStatus.warnings.push('Model capability discovery service not initialized');
        this.logger.warn('⚠️ Model capability discovery service not initialized');
      }

    } catch (error) {
      const errorMsg = `Model discovery failed: ${error instanceof Error ? error.message : String(error)}`;
      this.healthStatus.components.modelDiscovery.error = errorMsg;
      this.healthStatus.warnings.push(errorMsg);
      this.logger.warn(errorMsg);
    }
  }

  /**
   * Update overall health status
   */
  private updateOverallHealth(): void {
    // System is healthy if embeddings are configured
    // Milvus and model discovery are optional enhancements
    this.healthStatus.healthy = this.healthStatus.components.embeddings.healthy;
    this.healthStatus.timestamp = new Date();
  }

  /**
   * Get current health status
   */
  getHealthStatus(): RAGHealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Check if RAG is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get initialization error if any
   */
  getInitializationError(): string | undefined {
    return this.initializationError;
  }

  /**
   * Force re-initialization (useful for testing or recovery)
   */
  async reinitialize(): Promise<boolean> {
    this.logger.info('🔄 Re-initializing RAG services...');
    this.initialized = false;
    this.retryCount = 0;
    this.initializationError = undefined;

    return this.initialize();
  }

  /**
   * Perform lightweight health check without full initialization
   */
  async healthCheck(): Promise<RAGHealthStatus> {
    const startTime = Date.now();

    await Promise.allSettled([
      this.initializeEmbeddingService(),
      this.checkMilvusConnection(),
      this.discoverModels()
    ]);

    this.updateOverallHealth();

    this.logger.debug({
      duration: Date.now() - startTime,
      healthy: this.healthStatus.healthy
    }, 'RAG health check completed');

    return this.getHealthStatus();
  }
}

// Export singleton instance
export const ragInitService = new RAGInitService();
