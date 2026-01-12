/**
 * LLM Provider Management API Routes
 *
 * Admin routes for monitoring and managing LLM providers
 * Requires admin authentication
 */

import { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { ProviderManager } from '../../services/llm-providers/ProviderManager.js';
import { ProviderConfigService } from '../../services/llm-providers/ProviderConfigService.js';

interface ProviderRoutesOptions {
  providerManager?: ProviderManager;
}

const llmProviderRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;

  if (!providerManager) {
    logger.warn('ProviderManager not provided - LLM provider routes will return mock data');
  }

  /**
   * GET /api/admin/llm-providers
   * List all configured providers
   */
  fastify.get('/llm-providers', async (request, reply) => {
    try {
      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider management is not available'
        });
      }

      const providerNames = providerManager.getProviderNames();
      const models = await providerManager.listModels();

      // Build name-to-type mapping since config names differ from provider types
      // e.g., 'vertex-ai' (config name) vs 'google-vertex' (provider type)
      const nameToType: Record<string, string> = {};
      for (const name of providerNames) {
        const provider = providerManager.getProvider(name);
        if (provider) {
          nameToType[name] = (provider as any).type || name;
        }
      }

      // Get database-configured models
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const dbConfigs = await prisma.systemConfiguration.findMany({
        where: { key: { startsWith: 'llm_provider_' } }
      });
      await prisma.$disconnect();

      // Parse database configurations
      const dbModelsByProvider: Record<string, any[]> = {};
      for (const config of dbConfigs) {
        const providerName = config.key.replace('llm_provider_', '').replace('_models', '');
        dbModelsByProvider[providerName] = (config.value as any)?.models || [];
      }

      return reply.send({
        providers: providerNames.map(name => {
          const providerType = nameToType[name] || name;
          // Match models by both configured name and provider type
          const envModels = models.filter(m =>
            m.provider === name || m.provider === providerType
          );

          // Add database-configured models
          const dbModels = dbModelsByProvider[name] || [];

          // Merge models (db models take precedence)
          const allModels = [...envModels];
          for (const dbModel of dbModels) {
            if (!allModels.find(m => m.id === dbModel.id)) {
              allModels.push({
                ...dbModel,
                source: 'database'
              });
            }
          }

          return {
            name,
            type: providerType,
            models: allModels.map(model => ({
              ...model,
              capabilities: (model as any).capabilities || {
                chat: true,
                embeddings: false,
                tools: true,
                vision: false
              },
              maxTokens: (model as any).maxTokens || 8192
            }))
          };
        }),
        totalProviders: providerNames.length,
        totalModels: models.length + Object.values(dbModelsByProvider).flat().length
      });

    } catch (error) {
      logger.error({ error }, 'Failed to list LLM providers');
      return reply.code(500).send({
        error: 'Failed to list providers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/health
   * Get health status for all providers
   */
  fastify.get('/llm-providers/health', async (request, reply) => {
    try {
      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider health check is not available'
        });
      }

      const healthStatus = await providerManager.getHealthStatus();

      const results = Array.from(healthStatus.entries()).map(([name, health]) => ({
        provider: name,
        status: health.status,
        healthy: health.status === 'healthy',
        endpoint: health.endpoint,
        error: health.error,
        lastChecked: health.lastChecked
      }));

      const allHealthy = results.every(r => r.healthy);

      return reply.code(allHealthy ? 200 : 503).send({
        overall: allHealthy ? 'healthy' : 'degraded',
        providers: results,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to check provider health');
      return reply.code(500).send({
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/metrics
   * Get performance metrics for all providers
   */
  fastify.get('/llm-providers/metrics', async (request, reply) => {
    try {
      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider metrics are not available'
        });
      }

      const metrics = providerManager.getMetrics();

      const results = Array.from(metrics.entries()).map(([name, metric]) => ({
        provider: name,
        requests: {
          total: metric.totalRequests,
          successful: metric.successfulRequests,
          failed: metric.failedRequests,
          successRate: metric.totalRequests > 0
            ? ((metric.successfulRequests / metric.totalRequests) * 100).toFixed(2)
            : '0.00'
        },
        performance: {
          averageLatency: Math.round(metric.averageLatency),
          uptime: metric.uptime.toFixed(2)
        },
        usage: {
          totalTokens: metric.totalTokens,
          estimatedCost: metric.totalCost.toFixed(4)
        },
        lastHealthCheck: metric.lastHealthCheck
      }));

      // Calculate aggregate metrics
      const aggregate = {
        totalRequests: results.reduce((sum, r) => sum + r.requests.total, 0),
        totalSuccessful: results.reduce((sum, r) => sum + r.requests.successful, 0),
        totalFailed: results.reduce((sum, r) => sum + r.requests.failed, 0),
        averageLatency: results.length > 0
          ? Math.round(results.reduce((sum, r) => sum + r.performance.averageLatency, 0) / results.length)
          : 0,
        totalTokens: results.reduce((sum, r) => sum + r.usage.totalTokens, 0),
        totalCost: results.reduce((sum, r) => sum + parseFloat(r.usage.estimatedCost), 0).toFixed(4)
      };

      return reply.send({
        providers: results,
        aggregate,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get provider metrics');
      return reply.code(500).send({
        error: 'Failed to get metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/:name
   * Get details for a specific provider
   */
  fastify.get<{ Params: { name: string } }>('/llm-providers/:name', async (request, reply) => {
    try {
      const { name } = request.params;

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider details are not available'
        });
      }

      if (!providerManager.hasProvider(name)) {
        return reply.code(404).send({
          error: 'Provider not found',
          message: `Provider '${name}' is not configured`
        });
      }

      const provider = providerManager.getProvider(name);
      const metrics = providerManager.getProviderMetrics(name);
      const health = await provider?.getHealth();
      const models = await provider?.listModels();

      return reply.send({
        provider: name,
        health,
        metrics,
        models,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to get provider details');
      return reply.code(500).send({
        error: 'Failed to get provider details',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/config
   * Get current provider configuration
   */
  fastify.get('/llm-providers/config', async (request, reply) => {
    try {
      const configService = new ProviderConfigService(logger);
      const config = await configService.loadProviderConfig();
      const validation = configService.validateConfig(config);
      const summary = configService.getConfigSummary(config);

      return reply.send({
        config: {
          defaultProvider: config.defaultProvider,
          enableFailover: config.enableFailover,
          failoverTimeout: config.failoverTimeout,
          enableLoadBalancing: config.enableLoadBalancing,
          loadBalancingStrategy: config.loadBalancingStrategy,
          providers: config.providers.map(p => ({
            name: p.name,
            type: p.type,
            enabled: p.enabled,
            priority: p.priority,
            maxTokens: p.config.maxTokens,
            temperature: p.config.temperature
          }))
        },
        validation,
        summary,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get provider configuration');
      return reply.code(500).send({
        error: 'Failed to get configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:name/test
   * Comprehensive test of provider capabilities
   */
  fastify.post<{
    Params: { name: string };
    Body: {
      testType?: 'basic' | 'streaming' | 'tools' | 'vision' | 'all';
      prompt?: string;
      imageUrl?: string;
    };
  }>('/llm-providers/:name/test', async (request, reply) => {
    try {
      const { name } = request.params;
      const {
        testType = 'basic',
        prompt = 'Say "Hello, World!" and nothing else.',
        imageUrl
      } = request.body || {};

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider testing is not available'
        });
      }

      if (!providerManager.hasProvider(name)) {
        return reply.code(404).send({
          error: 'Provider not found',
          message: `Provider '${name}' is not configured`
        });
      }

      const provider = providerManager.getProvider(name);
      const models = await provider?.listModels();
      const capabilities = (models?.[0] as any)?.capabilities || {};
      const testModel = (models?.[0] as any)?.id || (models?.[0] as any)?.name ||
                       process.env.VERTEX_AI_MODEL ||
                       process.env.AZURE_OPENAI_MODEL ||
                       process.env.DEFAULT_MODEL;

      const testResults: any = {
        provider: name,
        timestamp: new Date().toISOString(),
        tests: {}
      };

      // Basic completion test
      if (testType === 'basic' || testType === 'all') {
        try {
          const startTime = Date.now();
          const response = await providerManager.createCompletion({
            model: testModel,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100,
            stream: false
          }, name);

          const latency = Date.now() - startTime;
          const content = (response as any).choices?.[0]?.message?.content || '';

          testResults.tests.basic = {
            success: true,
            latency,
            response: content,
            tokenCount: content.split(/\s+/).length
          };
        } catch (error) {
          testResults.tests.basic = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Streaming test
      if ((testType === 'streaming' || testType === 'all') && capabilities.chat) {
        try {
          const startTime = Date.now();
          const stream = await providerManager.createCompletion({
            model: testModel,
            messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
            max_tokens: 50,
            stream: true
          }, name);

          let chunks = 0;
          let firstChunkLatency = 0;
          let content = '';

          if (Symbol.asyncIterator in Object(stream)) {
            for await (const chunk of stream as AsyncGenerator) {
              if (chunks === 0) {
                firstChunkLatency = Date.now() - startTime;
              }
              chunks++;
              const delta = (chunk as any).choices?.[0]?.delta?.content || '';
              content += delta;
            }
          }

          const totalLatency = Date.now() - startTime;

          testResults.tests.streaming = {
            success: true,
            chunks,
            firstChunkLatency,
            totalLatency,
            response: content
          };
        } catch (error) {
          testResults.tests.streaming = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Tool calling test
      if ((testType === 'tools' || testType === 'all') && capabilities.tools) {
        try {
          const startTime = Date.now();
          const response = await providerManager.createCompletion({
            model: testModel,
            messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
            tools: [{
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get the current weather in a location',
                parameters: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'City name' },
                    unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                  },
                  required: ['location']
                }
              }
            }],
            max_tokens: 100,
            stream: false
          }, name);

          const latency = Date.now() - startTime;
          const toolCalls = (response as any).choices?.[0]?.message?.tool_calls || [];

          testResults.tests.tools = {
            success: toolCalls.length > 0,
            latency,
            toolCalls: toolCalls.map((tc: any) => ({
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }))
          };
        } catch (error) {
          testResults.tests.tools = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Vision test
      if ((testType === 'vision' || testType === 'all') && capabilities.vision && imageUrl) {
        try {
          const startTime = Date.now();
          const response = await providerManager.createCompletion({
            model: testModel,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'What do you see in this image?' },
                { type: 'image_url', image_url: { url: imageUrl } }
              ] as any
            }],
            max_tokens: 200,
            stream: false
          }, name);

          const latency = Date.now() - startTime;
          const content = (response as any).choices?.[0]?.message?.content || '';

          testResults.tests.vision = {
            success: true,
            latency,
            response: content
          };
        } catch (error) {
          testResults.tests.vision = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Calculate overall success
      const tests = Object.values(testResults.tests);
      const successfulTests = tests.filter((t: any) => t.success).length;
      testResults.summary = {
        totalTests: tests.length,
        successfulTests,
        successRate: tests.length > 0 ? (successfulTests / tests.length * 100).toFixed(1) + '%' : '0%',
        capabilities: capabilities
      };

      return reply.send(testResults);

    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Provider test failed');
      return reply.code(500).send({
        provider: request.params.name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * POST /api/admin/llm-providers
   * Create a new LLM provider configuration
   */
  fastify.post<{
    Body: {
      name: string;
      displayName: string;
      providerType: 'azure-openai' | 'vertex-ai' | 'aws-bedrock';
      enabled?: boolean;
      priority?: number;
      authConfig: any;
      providerConfig: any;
      modelConfig?: any;
      capabilities?: any;
      description?: string;
      tags?: string[];
    };
  }>('/llm-providers', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const {
        name,
        displayName,
        providerType,
        enabled = true,
        priority = 1,
        authConfig,
        providerConfig,
        modelConfig = {},
        capabilities = {},
        description,
        tags = []
      } = request.body;

      // Validate required fields
      if (!name || !displayName || !providerType || !authConfig || !providerConfig) {
        return reply.code(400).send({
          error: 'Missing required fields',
          required: ['name', 'displayName', 'providerType', 'authConfig', 'providerConfig']
        });
      }

      // Create provider
      const provider = await prisma.lLMProvider.create({
        data: {
          name,
          display_name: displayName,
          provider_type: providerType,
          enabled,
          priority,
          auth_config: authConfig,
          provider_config: providerConfig,
          model_config: modelConfig,
          capabilities,
          description,
          tags,
          created_by: (request as any).user?.id
        }
      });

      await prisma.$disconnect();

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider created');

      // Trigger hot-reload if providerManager exists
      if (providerManager) {
        await providerManager.reloadProviders();
        logger.info('Provider manager reloaded with new provider');
      }

      return reply.code(201).send({
        provider,
        message: 'Provider created successfully'
      });

    } catch (error) {
      logger.error({ error }, 'Failed to create LLM provider');
      return reply.code(500).send({
        error: 'Failed to create provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * PUT /api/admin/llm-providers/:id
   * Update an existing LLM provider
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      displayName?: string;
      enabled?: boolean;
      priority?: number;
      authConfig?: any;
      providerConfig?: any;
      modelConfig?: any;
      capabilities?: any;
      description?: string;
      tags?: string[];
    };
  }>('/llm-providers/:id', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const { id } = request.params;

      const updateData: any = {};

      if (request.body.displayName !== undefined) updateData.display_name = request.body.displayName;
      if (request.body.enabled !== undefined) updateData.enabled = request.body.enabled;
      if (request.body.priority !== undefined) updateData.priority = request.body.priority;
      if (request.body.authConfig !== undefined) updateData.auth_config = request.body.authConfig;
      if (request.body.providerConfig !== undefined) updateData.provider_config = request.body.providerConfig;
      if (request.body.modelConfig !== undefined) updateData.model_config = request.body.modelConfig;
      if (request.body.capabilities !== undefined) updateData.capabilities = request.body.capabilities;
      if (request.body.description !== undefined) updateData.description = request.body.description;
      if (request.body.tags !== undefined) updateData.tags = request.body.tags;

      updateData.updated_by = (request as any).user?.id;

      const provider = await prisma.lLMProvider.update({
        where: { id },
        data: updateData
      });

      await prisma.$disconnect();

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider updated');

      // Trigger hot-reload if providerManager exists
      if (providerManager) {
        await providerManager.reloadProviders();
        logger.info('Provider manager reloaded with updated configuration');
      }

      return reply.send({
        provider,
        message: 'Provider updated successfully'
      });

    } catch (error) {
      logger.error({ error, providerId: request.params.id }, 'Failed to update LLM provider');
      return reply.code(500).send({
        error: 'Failed to update provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/admin/llm-providers/:id
   * Soft delete an LLM provider
   */
  fastify.delete<{
    Params: { id: string };
  }>('/llm-providers/:id', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const { id } = request.params;

      // Soft delete by setting deleted_at timestamp
      const provider = await prisma.lLMProvider.update({
        where: { id },
        data: {
          deleted_at: new Date(),
          enabled: false, // Also disable it
          updated_by: (request as any).user?.id
        }
      });

      await prisma.$disconnect();

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider soft deleted');

      // Trigger hot-reload if providerManager exists
      if (providerManager) {
        await providerManager.reloadProviders();
        logger.info('Provider manager reloaded after provider deletion');
      }

      return reply.send({
        message: 'Provider deleted successfully',
        providerId: id
      });

    } catch (error) {
      logger.error({ error, providerId: request.params.id }, 'Failed to delete LLM provider');
      return reply.code(500).send({
        error: 'Failed to delete provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/database
   * List all providers from database (including disabled/deleted)
   * Also includes environment-based providers as read-only system providers
   */
  fastify.get('/llm-providers/database', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const dbProviders = await prisma.lLMProvider.findMany({
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' }
        ],
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          updater: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      await prisma.$disconnect();

      // Get environment-based providers from ProviderConfigService
      let envProviders: any[] = [];
      try {
        const { ProviderConfigService } = await import('../../services/llm-providers/ProviderConfigService.js');
        const configService = new ProviderConfigService(logger);
        const config = await configService.loadProviderConfig();

        // Convert environment providers to database format
        envProviders = config.providers.map((p: any) => ({
          id: `env-${p.name}`,
          name: p.name,
          display_name: p.name === 'azure-openai' ? 'Azure OpenAI' :
                        p.name === 'aws-bedrock' ? 'AWS Bedrock' :
                        p.name === 'google-vertex' ? 'Google Vertex AI' : p.name,
          provider_type: p.type,
          enabled: p.enabled,
          priority: p.priority,
          description: `Environment-configured ${p.type} provider (read-only)`,
          tags: ['system', 'environment'],
          auth_config: { type: 'environment' },
          provider_config: p.config || {},
          model_config: {
            maxTokens: p.config?.maxTokens,
            temperature: p.config?.temperature
          },
          capabilities: {
            chat: true,
            embeddings: false,
            tools: true,
            vision: false,
            streaming: true
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          created_by: 'system',
          updated_by: 'system',
          isEnvironmentProvider: true // Flag to indicate it's from env
        }));
      } catch (envError) {
        logger.warn({ error: envError }, 'Failed to load environment providers');
      }

      // Merge database and environment providers
      const allProviders = [...envProviders, ...dbProviders];

      return reply.send({
        providers: allProviders,
        total: allProviders.length,
        enabled: allProviders.filter(p => p.enabled && !p.deleted_at).length,
        disabled: allProviders.filter(p => !p.enabled || p.deleted_at).length,
        environmentProviders: envProviders.length,
        databaseProviders: dbProviders.length
      });

    } catch (error) {
      logger.error({ error }, 'Failed to list database providers');
      return reply.code(500).send({
        error: 'Failed to list providers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/ollama/models
   * List all models currently available in Ollama
   */
  fastify.get('/llm-providers/ollama/models', async (request, reply) => {
    try {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (!res.ok) throw new Error('Failed to fetch Ollama models');

      const data = await res.json();

      return reply.send({
        models: data.models || [],
        totalModels: data.models?.length || 0
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list Ollama models');
      return reply.code(500).send({
        error: 'Failed to list Ollama models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/ollama/models/pull
   * Pull (download) a new model from Ollama registry
   * Returns streaming progress updates
   */
  fastify.post<{
    Body: {
      model: string;
    };
  }>('/llm-providers/ollama/models/pull', async (request, reply): Promise<void> => {
    try {
      const { model } = request.body;

      if (!model) {
        reply.code(400).send({
          error: 'Missing model name',
          message: 'Please provide a model name to pull'
        });
        return;
      }

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      logger.info({ model }, 'Pulling Ollama model');

      // Start the pull (this is async and streams progress)
      const res = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: model })
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.statusText}`);
      }

      // Stream progress back to client
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked'
      });

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        reply.raw.write(chunk);
      }

      reply.raw.end();

      logger.info({ model }, 'Ollama model pull completed');
    } catch (error) {
      logger.error({ error, model: request.body?.model }, 'Failed to pull Ollama model');

      if (!reply.sent) {
        reply.code(500).send({
          error: 'Failed to pull model',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });

  /**
   * DELETE /api/admin/llm-providers/ollama/models/:model
   * Delete a model from Ollama
   */
  fastify.delete<{
    Params: { model: string };
  }>('/llm-providers/ollama/models/:model', async (request, reply) => {
    try {
      const { model } = request.params;

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      logger.info({ model }, 'Deleting Ollama model');

      const res = await fetch(`${ollamaUrl}/api/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: model })
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.statusText}`);
      }

      logger.info({ model }, 'Ollama model deleted');

      return reply.send({
        message: 'Model deleted successfully',
        model
      });
    } catch (error) {
      logger.error({ error, model: request.params.model }, 'Failed to delete Ollama model');
      return reply.code(500).send({
        error: 'Failed to delete model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/:name/models
   * Get configured models for a provider (from database)
   */
  fastify.get<{ Params: { name: string } }>('/llm-providers/:name/models', async (request, reply) => {
    try {
      const { name } = request.params;
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      // Get configured models from SystemConfiguration
      const configKey = `llm_provider_${name}_models`;
      const config = await prisma.systemConfiguration.findFirst({
        where: { key: configKey }
      });

      await prisma.$disconnect();

      const configuredModels = config?.value ? (config.value as any).models || [] : [];

      // Also get models from the provider instance
      let providerModels: any[] = [];
      if (providerManager?.hasProvider(name)) {
        try {
          const provider = providerManager.getProvider(name);
          providerModels = await provider?.listModels() || [];
        } catch (e) {
          logger.warn({ provider: name, error: e }, 'Failed to list models from provider instance');
        }
      }

      return reply.send({
        provider: name,
        configuredModels,  // From database
        providerModels,    // From environment/provider instance
        totalModels: configuredModels.length + providerModels.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to get provider models');
      return reply.code(500).send({
        error: 'Failed to get provider models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:name/models
   * Add a model to a provider's configuration (stored in database)
   */
  fastify.post<{
    Params: { name: string };
    Body: {
      id: string;
      name?: string;
      capabilities?: {
        chat?: boolean;
        vision?: boolean;
        tools?: boolean;
        embeddings?: boolean;
        imageGeneration?: boolean;
        streaming?: boolean;
      };
      maxTokens?: number;
      contextWindow?: number;
      description?: string;
      pricing?: { input?: number; output?: number; perImage?: number };
    };
  }>('/llm-providers/:name/models', async (request, reply) => {
    try {
      const { name: providerName } = request.params;
      const modelConfig = request.body;

      if (!modelConfig.id) {
        return reply.code(400).send({ error: 'Model id is required' });
      }

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const configKey = `llm_provider_${providerName}_models`;

      // Get existing config or create new
      let existingConfig = await prisma.systemConfiguration.findFirst({
        where: { key: configKey }
      });

      let models: any[] = existingConfig?.value ? (existingConfig.value as any).models || [] : [];

      // Check if model already exists
      const existingIndex = models.findIndex(m => m.id === modelConfig.id);
      if (existingIndex >= 0) {
        // Update existing
        models[existingIndex] = {
          ...models[existingIndex],
          ...modelConfig,
          updatedAt: new Date().toISOString()
        };
      } else {
        // Add new
        models.push({
          ...modelConfig,
          name: modelConfig.name || modelConfig.id,
          provider: providerName,
          capabilities: modelConfig.capabilities || {
            chat: true, vision: false, tools: true,
            embeddings: false, imageGeneration: false, streaming: true
          },
          createdAt: new Date().toISOString()
        });
      }

      // Upsert the configuration
      const result = existingConfig
        ? await prisma.systemConfiguration.update({
            where: { key: configKey },
            data: { value: { models } }
          })
        : await prisma.systemConfiguration.create({
            data: {
              key: configKey,
              value: { models },
              description: `Configured models for ${providerName} provider`
            }
          });

      await prisma.$disconnect();

      logger.info({ provider: providerName, modelId: modelConfig.id }, 'Model added/updated');

      return reply.code(201).send({
        message: existingIndex >= 0 ? 'Model updated' : 'Model added',
        model: models.find(m => m.id === modelConfig.id),
        totalModels: models.length
      });
    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to add model');
      return reply.code(500).send({
        error: 'Failed to add model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/admin/llm-providers/:name/models/:modelId
   * Remove a model from a provider's configuration
   */
  fastify.delete<{
    Params: { name: string; modelId: string };
  }>('/llm-providers/:name/models/:modelId', async (request, reply) => {
    try {
      const { name: providerName, modelId } = request.params;
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const configKey = `llm_provider_${providerName}_models`;
      const existingConfig = await prisma.systemConfiguration.findFirst({
        where: { key: configKey }
      });

      if (!existingConfig) {
        await prisma.$disconnect();
        return reply.code(404).send({ error: 'No models configured for this provider' });
      }

      let models: any[] = (existingConfig.value as any).models || [];
      const initialLength = models.length;
      models = models.filter(m => m.id !== modelId);

      if (models.length === initialLength) {
        await prisma.$disconnect();
        return reply.code(404).send({ error: 'Model not found in configuration' });
      }

      await prisma.systemConfiguration.update({
        where: { key: configKey },
        data: { value: { models } }
      });

      await prisma.$disconnect();

      logger.info({ provider: providerName, modelId }, 'Model removed');

      return reply.send({
        message: 'Model removed',
        remainingModels: models.length
      });
    } catch (error) {
      logger.error({ error, provider: request.params.name, modelId: request.params.modelId }, 'Failed to remove model');
      return reply.code(500).send({
        error: 'Failed to remove model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:name/models/add-from-catalog
   * Add a model from the catalog to the provider's configuration
   */
  fastify.post<{
    Params: { name: string };
    Body: { modelId: string };
  }>('/llm-providers/:name/models/add-from-catalog', async (request, reply) => {
    try {
      const { name: providerName } = request.params;
      const { modelId } = request.body;

      if (!modelId) {
        return reply.code(400).send({ error: 'modelId is required' });
      }

      // Get model info from catalog
      const catalogResponse = await fastify.inject({
        method: 'GET',
        url: '/admin/llm-providers/vertex-ai/catalog',
        headers: request.headers as any
      });

      const catalog = JSON.parse(catalogResponse.payload);
      let modelInfo: any = null;

      // Search in all categories
      for (const category of ['chat', 'imageGeneration', 'embeddings']) {
        const found = catalog.catalog?.[category]?.find((m: any) => m.id === modelId);
        if (found) {
          modelInfo = found;
          break;
        }
      }

      if (!modelInfo) {
        return reply.code(404).send({ error: `Model ${modelId} not found in catalog` });
      }

      // Add to provider configuration
      const addResponse = await fastify.inject({
        method: 'POST',
        url: `/admin/llm-providers/${providerName}/models`,
        headers: request.headers as any,
        payload: {
          id: modelInfo.id,
          name: modelInfo.name,
          capabilities: modelInfo.capabilities,
          maxTokens: modelInfo.maxTokens,
          contextWindow: modelInfo.contextWindow,
          description: modelInfo.description,
          pricing: modelInfo.pricing
        }
      });

      return reply.code(addResponse.statusCode).send(JSON.parse(addResponse.payload));
    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to add model from catalog');
      return reply.code(500).send({
        error: 'Failed to add model from catalog',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/vertex-ai/catalog
   * Get full Gemini model catalog with capabilities
   */
  fastify.get('/llm-providers/vertex-ai/catalog', async (request, reply) => {
    try {
      // Comprehensive Gemini model catalog
      const catalog = {
        chat: [
          {
            id: 'gemini-2.5-pro-preview-06-05',
            name: 'Gemini 2.5 Pro Preview',
            description: 'Most capable model for complex reasoning, coding, and multimodal tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 65536,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.5-flash-preview-05-20',
            name: 'Gemini 2.5 Flash Preview',
            description: 'Fast and efficient model with strong reasoning capabilities',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 65536,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.0-flash',
            name: 'Gemini 2.0 Flash',
            description: 'Fast multimodal model for everyday tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.0-flash-lite',
            name: 'Gemini 2.0 Flash Lite',
            description: 'Cost-effective model for high-volume tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-1.5-pro',
            name: 'Gemini 1.5 Pro',
            description: 'Powerful model with 2M token context window',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 2097152
          },
          {
            id: 'gemini-1.5-flash',
            name: 'Gemini 1.5 Flash',
            description: 'Fast and versatile multimodal model',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-1.5-flash-8b',
            name: 'Gemini 1.5 Flash-8B',
            description: 'Compact and efficient for high-frequency tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-3-flash-preview',
            name: 'Gemini 3 Flash Preview',
            description: 'Next-gen Flash preview with improved capabilities',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 32768,
            contextWindow: 1048576
          },
          {
            id: 'gemini-3-pro-preview',
            name: 'Gemini 3 Pro Preview',
            description: 'Next-gen Pro preview with advanced reasoning',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 32768,
            contextWindow: 1048576
          }
        ],
        imageGeneration: [
          {
            id: 'imagen-3.0-generate-002',
            name: 'Imagen 3.0',
            description: 'High-quality image generation model',
            capabilities: { imageGeneration: true }
          },
          {
            id: 'imagen-3.0-fast-generate-001',
            name: 'Imagen 3.0 Fast',
            description: 'Fast image generation for rapid iteration',
            capabilities: { imageGeneration: true }
          },
          {
            id: 'gemini-2.0-flash-preview-image-generation',
            name: 'Gemini 2.0 Flash Image Gen',
            description: 'Multimodal with native image generation',
            capabilities: { chat: true, vision: true, imageGeneration: true }
          }
        ],
        embeddings: [
          {
            id: 'text-embedding-004',
            name: 'Text Embedding 004',
            description: 'Latest text embedding model for semantic search',
            dimensions: 768
          },
          {
            id: 'text-embedding-005',
            name: 'Text Embedding 005',
            description: 'Improved text embedding with better performance',
            dimensions: 768
          },
          {
            id: 'text-multilingual-embedding-002',
            name: 'Multilingual Embedding 002',
            description: 'Multilingual embedding supporting 100+ languages',
            dimensions: 768
          }
        ]
      };

      return reply.send({
        catalog,
        totalModels: catalog.chat.length + catalog.imageGeneration.length + catalog.embeddings.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get Vertex AI model catalog');
      return reply.code(500).send({
        error: 'Failed to get model catalog',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/playground
   * Universal model playground - test any model with full configuration
   * Supports ALL SDK options for each provider type
   */
  fastify.post<{
    Body: {
      provider: string;
      model: string;
      testType: 'chat' | 'vision' | 'tools' | 'embedding' | 'image-generation' | 'thinking';
      config?: {
        // Universal options
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        topK?: number;
        stopSequences?: string[];
        stream?: boolean;

        // OpenAI/Azure OpenAI specific
        frequencyPenalty?: number;       // -2.0 to 2.0
        presencePenalty?: number;        // -2.0 to 2.0
        seed?: number;                   // For reproducibility
        responseFormat?: {
          type: 'text' | 'json_object' | 'json_schema';
          jsonSchema?: object;
        };
        logprobs?: boolean;
        topLogprobs?: number;            // 0-20
        logitBias?: Record<string, number>;

        // Anthropic/Claude specific (via Bedrock/Foundry)
        thinkingBudget?: number;         // Extended thinking token budget
        enableThinking?: boolean;        // Enable extended thinking mode

        // Google Vertex AI specific
        safetySettings?: Array<{
          category: 'HARM_CATEGORY_HARASSMENT' | 'HARM_CATEGORY_HATE_SPEECH' | 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | 'HARM_CATEGORY_DANGEROUS_CONTENT';
          threshold: 'BLOCK_NONE' | 'BLOCK_LOW_AND_ABOVE' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_ONLY_HIGH';
        }>;
        groundingConfig?: {
          googleSearchRetrieval?: {
            dynamicRetrievalConfig?: {
              mode: 'MODE_DYNAMIC';
              dynamicThreshold?: number;
            };
          };
        };

        // Ollama specific
        numCtx?: number;                 // Context length
        repeatPenalty?: number;          // 1.0 = no penalty
        numPredict?: number;             // Max tokens to predict
        mirostat?: number;               // 0, 1, or 2
        mirostatEta?: number;
        mirostatTau?: number;
      };
      input: {
        prompt?: string;
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        imageUrl?: string;
        imagePrompt?: string;
        textToEmbed?: string;
        tools?: Array<any>;
      };
    };
  }>('/llm-providers/playground', async (request, reply) => {
    try {
      const { provider, model, testType, config, input } = request.body;

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'Model playground is not available'
        });
      }

      const startTime = Date.now();
      let result: any = { success: false };

      switch (testType) {
        case 'chat': {
          const messages = input.messages || [
            ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
            { role: 'user' as const, content: input.prompt || 'Hello!' }
          ];

          // Build comprehensive completion request with all SDK options
          const completionRequest: any = {
            model,
            messages: messages as any,
            temperature: config?.temperature,
            max_tokens: config?.maxTokens || 1024,
            top_p: config?.topP,
            stream: config?.stream ?? false,
          };

          // Universal options
          if (config?.topK !== undefined) completionRequest.top_k = config.topK;
          if (config?.stopSequences) completionRequest.stop_sequences = config.stopSequences;

          // OpenAI/Azure specific options
          if (config?.frequencyPenalty !== undefined) completionRequest.frequency_penalty = config.frequencyPenalty;
          if (config?.presencePenalty !== undefined) completionRequest.presence_penalty = config.presencePenalty;
          if (config?.seed !== undefined) completionRequest.seed = config.seed;
          if (config?.responseFormat) completionRequest.response_format = config.responseFormat;
          if (config?.logprobs !== undefined) completionRequest.logprobs = config.logprobs;
          if (config?.topLogprobs !== undefined) completionRequest.top_logprobs = config.topLogprobs;
          if (config?.logitBias) completionRequest.logit_bias = config.logitBias;

          // Anthropic/Claude thinking options
          if (config?.enableThinking) {
            completionRequest.thinking = {
              type: 'enabled',
              budget_tokens: config.thinkingBudget || 8000
            };
          }

          // Google Vertex AI options
          if (config?.safetySettings) completionRequest.safety_settings = config.safetySettings;
          if (config?.groundingConfig) completionRequest.grounding_config = config.groundingConfig;

          // Ollama specific options
          if (config?.numCtx !== undefined) completionRequest.num_ctx = config.numCtx;
          if (config?.repeatPenalty !== undefined) completionRequest.repeat_penalty = config.repeatPenalty;
          if (config?.numPredict !== undefined) completionRequest.num_predict = config.numPredict;
          if (config?.mirostat !== undefined) completionRequest.mirostat = config.mirostat;
          if (config?.mirostatEta !== undefined) completionRequest.mirostat_eta = config.mirostatEta;
          if (config?.mirostatTau !== undefined) completionRequest.mirostat_tau = config.mirostatTau;

          const response = await providerManager.createCompletion(completionRequest, provider);

          const content = (response as any).choices?.[0]?.message?.content || '';
          const thinkingContent = (response as any).thinking || (response as any).choices?.[0]?.message?.thinking || null;

          result = {
            success: true,
            type: 'chat',
            response: content,
            thinking: thinkingContent,
            usage: (response as any).usage,
            latency: Date.now() - startTime,
            configApplied: {
              temperature: config?.temperature,
              maxTokens: config?.maxTokens,
              topP: config?.topP,
              topK: config?.topK,
              frequencyPenalty: config?.frequencyPenalty,
              presencePenalty: config?.presencePenalty,
              thinkingEnabled: config?.enableThinking,
              thinkingBudget: config?.thinkingBudget,
            }
          };
          break;
        }

        case 'thinking': {
          // Specialized extended thinking test for Claude/Gemini models
          const messages = input.messages || [
            { role: 'user' as const, content: input.prompt || 'Explain the implications of quantum computing on modern cryptography. Think through this step by step.' }
          ];

          const thinkingBudget = config?.thinkingBudget || 16000;

          const completionRequest: any = {
            model,
            messages: messages as any,
            temperature: config?.temperature || 1,
            max_tokens: config?.maxTokens || 4096,
            stream: false,
            thinking: {
              type: 'enabled',
              budget_tokens: thinkingBudget
            }
          };

          const response = await providerManager.createCompletion(completionRequest, provider);

          const content = (response as any).choices?.[0]?.message?.content || '';
          const thinkingContent = (response as any).thinking ||
                                  (response as any).choices?.[0]?.message?.thinking ||
                                  (response as any).thinkingContent || null;

          result = {
            success: true,
            type: 'thinking',
            response: content,
            thinking: thinkingContent,
            thinkingBudget,
            usage: (response as any).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'vision': {
          if (!input.imageUrl) {
            return reply.code(400).send({ error: 'imageUrl required for vision test' });
          }

          const response = await providerManager.createCompletion({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: input.prompt || 'What do you see in this image?' },
                { type: 'image_url', image_url: { url: input.imageUrl } }
              ] as any
            }],
            max_tokens: config?.maxTokens || 1024,
            stream: false
          }, provider);

          const content = (response as any).choices?.[0]?.message?.content || '';
          result = {
            success: true,
            type: 'vision',
            response: content,
            usage: (response as any).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'tools': {
          const tools = input.tools || [{
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather in a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                  unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                },
                required: ['location']
              }
            }
          }];

          const response = await providerManager.createCompletion({
            model,
            messages: [{ role: 'user', content: input.prompt || 'What is the weather in San Francisco?' }],
            tools,
            max_tokens: config?.maxTokens || 1024,
            stream: false
          }, provider);

          const toolCalls = (response as any).choices?.[0]?.message?.tool_calls || [];
          result = {
            success: toolCalls.length > 0,
            type: 'tools',
            toolCalls: toolCalls.map((tc: any) => ({
              name: tc.function?.name,
              arguments: tc.function?.arguments
            })),
            response: (response as any).choices?.[0]?.message?.content,
            usage: (response as any).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'image-generation': {
          // Image generation via Vertex AI Imagen
          const projectId = process.env.GOOGLE_CLOUD_PROJECT;
          const location = process.env.GCP_REGION || 'us-central1';

          if (!projectId) {
            return reply.code(400).send({ error: 'GOOGLE_CLOUD_PROJECT not configured' });
          }

          try {
            // Use the Vertex AI REST API for image generation
            const { GoogleAuth } = await import('google-auth-library');
            const auth = new GoogleAuth({
              scopes: ['https://www.googleapis.com/auth/cloud-platform']
            });
            const client = await auth.getClient();
            const accessToken = await client.getAccessToken();

            const imageGenEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

            const imageResponse = await fetch(imageGenEndpoint, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken.token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                instances: [{
                  prompt: input.imagePrompt || input.prompt || 'A beautiful sunset over mountains'
                }],
                parameters: {
                  sampleCount: 1,
                  aspectRatio: '1:1',
                  safetyFilterLevel: 'block_few'
                }
              })
            });

            if (!imageResponse.ok) {
              const errorText = await imageResponse.text();
              throw new Error(`Image generation failed: ${imageResponse.status} - ${errorText}`);
            }

            const imageData = await imageResponse.json();
            const predictions = imageData.predictions || [];

            result = {
              success: predictions.length > 0,
              type: 'image-generation',
              images: predictions.map((p: any) => ({
                base64: p.bytesBase64Encoded,
                mimeType: p.mimeType || 'image/png'
              })),
              latency: Date.now() - startTime
            };
          } catch (imageError) {
            logger.error({ error: imageError, model }, 'Image generation failed');
            result = {
              success: false,
              type: 'image-generation',
              error: imageError instanceof Error ? imageError.message : 'Image generation failed',
              latency: Date.now() - startTime
            };
          }
          break;
        }

        case 'embedding': {
          // Embedding test
          const textToEmbed = input.textToEmbed || input.prompt || 'Hello, world!';

          try {
            const providerInstance = providerManager.getProvider(provider);
            if (providerInstance && 'generateEmbedding' in providerInstance) {
              const embedding = await (providerInstance as any).generateEmbedding(textToEmbed);
              result = {
                success: true,
                type: 'embedding',
                dimensions: embedding.length,
                preview: embedding.slice(0, 10),
                latency: Date.now() - startTime
              };
            } else {
              result = {
                success: false,
                type: 'embedding',
                error: 'Provider does not support embeddings'
              };
            }
          } catch (embError) {
            result = {
              success: false,
              type: 'embedding',
              error: embError instanceof Error ? embError.message : 'Embedding failed',
              latency: Date.now() - startTime
            };
          }
          break;
        }

        default:
          return reply.code(400).send({ error: `Unknown test type: ${testType}` });
      }

      return reply.send({
        ...result,
        provider,
        model,
        config,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Playground test failed');
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/model-capabilities
   * Get model capabilities from the centralized ModelCapabilityRegistry
   * Returns context windows, provider types, and capabilities for all known models
   * This endpoint allows the UI to fetch model info dynamically instead of hardcoding
   */
  fastify.get('/llm-providers/model-capabilities', async (request, reply) => {
    try {
      const { getModelCapabilityRegistry } = await import('../../services/ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();

      if (!registry) {
        return reply.code(503).send({
          error: 'ModelCapabilityRegistry not initialized',
          message: 'The model capability registry is not available'
        });
      }

      // Get all registered models with their capabilities
      const allModels = registry.getAllModelCapabilities();

      // Group by provider type for easier UI consumption
      const modelsByProvider: Record<string, any[]> = {};
      for (const model of allModels) {
        const provider = model.providerType || 'unknown';
        if (!modelsByProvider[provider]) {
          modelsByProvider[provider] = [];
        }
        modelsByProvider[provider].push(model);
      }

      return reply.send({
        models: allModels,
        modelsByProvider,
        totalModels: allModels.length,
        providers: Object.keys(modelsByProvider),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get model capabilities');
      return reply.code(500).send({
        error: 'Failed to get model capabilities',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/model-capabilities/:modelId
   * Get capabilities for a specific model
   */
  fastify.get<{ Params: { modelId: string } }>('/llm-providers/model-capabilities/:modelId', async (request, reply) => {
    try {
      const { modelId } = request.params;
      const { getModelCapabilityRegistry } = await import('../../services/ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();

      if (!registry) {
        return reply.code(503).send({
          error: 'ModelCapabilityRegistry not initialized',
          message: 'The model capability registry is not available'
        });
      }

      const capabilities = registry.getCapabilities(modelId);
      const providerType = registry.detectProviderType(modelId);
      const contextWindow = registry.getContextWindow(modelId);

      return reply.send({
        modelId,
        providerType,
        contextWindow,
        capabilities,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, modelId: request.params.modelId }, 'Failed to get model capabilities');
      return reply.code(500).send({
        error: 'Failed to get model capabilities',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/slider-tiers
   * Get model recommendations for each intelligence slider tier
   * Used by SystemSettingsView to show tier configurations
   */
  fastify.get('/llm-providers/slider-tiers', async (request, reply) => {
    try {
      const { getModelCapabilityRegistry } = await import('../../services/ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();

      if (!registry) {
        return reply.code(503).send({
          error: 'ModelCapabilityRegistry not initialized',
          message: 'The model capability registry is not available'
        });
      }

      // Get tier recommendations from registry
      const tiers = registry.getSliderTierRecommendations();

      return reply.send({
        tiers,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get slider tier recommendations');
      return reply.code(500).send({
        error: 'Failed to get slider tiers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/discovery/status
   * Get status of model capability discovery service
   * Returns discovery mode, rate limit status, and cached model count
   */
  fastify.get('/llm-providers/discovery/status', async (request, reply) => {
    try {
      const { getModelCapabilityDiscoveryService } = await import('../../services/ModelCapabilityDiscoveryService.js');
      const discoveryService = getModelCapabilityDiscoveryService();

      if (!discoveryService) {
        return reply.send({
          mode: process.env.CAPABILITY_DISCOVERY_MODE || 'lazy',
          isDiscovering: false,
          lastDiscovery: null,
          cachedModels: 0,
          providers: [],
          message: 'Discovery service not initialized (DISABLE_MODEL_DISCOVERY=true or startup in progress)',
          timestamp: new Date().toISOString()
        });
      }

      const status = discoveryService.getDiscoveryStatus();

      return reply.send({
        ...status,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get discovery status');
      return reply.code(500).send({
        error: 'Failed to get discovery status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/sdk-options
   * Get all available SDK configuration options for each provider type
   * Used by UI to dynamically render provider-specific configuration controls
   */
  fastify.get('/llm-providers/sdk-options', async (request, reply) => {
    const sdkOptions = {
      // Common options available to all providers
      common: {
        temperature: { type: 'number', min: 0, max: 2, step: 0.1, default: 1, description: 'Controls randomness in responses' },
        maxTokens: { type: 'number', min: 1, max: 200000, default: 4096, description: 'Maximum tokens to generate' },
        topP: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, description: 'Nucleus sampling threshold' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 4, description: 'Stop generation on these sequences' },
        stream: { type: 'boolean', default: true, description: 'Enable streaming responses' },
      },

      // Azure OpenAI / OpenAI specific
      'azure-openai': {
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens based on frequency' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize tokens that have appeared at all' },
        seed: { type: 'number', min: 0, max: 2147483647, description: 'Seed for deterministic sampling (beta)' },
        responseFormat: {
          type: 'object',
          properties: {
            type: { type: 'enum', values: ['text', 'json_object', 'json_schema'], default: 'text', description: 'Response format type' },
            jsonSchema: { type: 'object', optional: true, description: 'JSON schema when type is json_schema' }
          },
          description: 'Output format (JSON mode)'
        },
        logprobs: { type: 'boolean', default: false, description: 'Return log probabilities of tokens' },
        topLogprobs: { type: 'number', min: 0, max: 20, default: 0, description: 'Number of top logprobs to return per token' },
        logitBias: { type: 'object', description: 'Token ID to bias value (-100 to 100) mapping' },
      },

      // AWS Bedrock (Anthropic Claude)
      'aws-bedrock': {
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Only sample from top K tokens' },
        enableThinking: { type: 'boolean', default: false, description: 'Enable extended thinking mode' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 8000, description: 'Token budget for thinking (requires enableThinking)' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 8191, description: 'Custom stop sequences' },
      },

      // Google Vertex AI (Gemini)
      'google-vertex': {
        topK: { type: 'number', min: 1, max: 40, default: 40, description: 'Only sample from top K tokens' },
        safetySettings: {
          type: 'array',
          itemType: 'object',
          properties: {
            category: {
              type: 'enum',
              values: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'],
              description: 'Content safety category'
            },
            threshold: {
              type: 'enum',
              values: ['BLOCK_NONE', 'BLOCK_LOW_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE', 'BLOCK_ONLY_HIGH'],
              default: 'BLOCK_MEDIUM_AND_ABOVE',
              description: 'Block threshold'
            }
          },
          description: 'Content safety filter settings'
        },
        enableThinking: { type: 'boolean', default: false, description: 'Enable Gemini thinking mode' },
        thinkingBudget: { type: 'number', min: 0, max: 24576, default: 8000, description: 'Token budget for thinking' },
        groundingConfig: {
          type: 'object',
          properties: {
            googleSearchRetrieval: {
              type: 'object',
              optional: true,
              description: 'Enable Google Search grounding'
            }
          },
          description: 'Configure grounding with Google Search'
        },
      },

      // Ollama (local models)
      'ollama': {
        numCtx: { type: 'number', min: 128, max: 131072, default: 4096, description: 'Context window size' },
        repeatPenalty: { type: 'number', min: 0, max: 2, step: 0.1, default: 1.1, description: 'Penalize repeated tokens' },
        numPredict: { type: 'number', min: -2, max: 131072, default: 128, description: 'Number of tokens to predict (-1 = infinite, -2 = fill context)' },
        mirostat: { type: 'enum', values: [0, 1, 2], default: 0, description: 'Mirostat sampling mode (0=disabled, 1=v1, 2=v2)' },
        mirostatEta: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, description: 'Mirostat learning rate' },
        mirostatTau: { type: 'number', min: 0, max: 10, step: 0.1, default: 5.0, description: 'Mirostat target entropy' },
        seed: { type: 'number', min: 0, default: 0, description: 'Random seed (0 = random)' },
        topK: { type: 'number', min: 1, max: 100, default: 40, description: 'Reduces the probability of generating nonsense' },
        tfsZ: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, description: 'Tail-free sampling (1=disabled)' },
      },

      // Azure AI Foundry (supports both Anthropic and OpenAI formats)
      'azure-ai-foundry': {
        // Inherits from both azure-openai and aws-bedrock
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens (OpenAI models)' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize token presence (OpenAI models)' },
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Top-K sampling (Claude models)' },
        enableThinking: { type: 'boolean', default: false, description: 'Enable extended thinking (Claude models)' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 8000, description: 'Thinking budget (Claude models)' },
      },
    };

    return reply.send({
      options: sdkOptions,
      providerTypes: Object.keys(sdkOptions).filter(k => k !== 'common'),
      timestamp: new Date().toISOString()
    });
  });

  /**
   * POST /api/admin/llm-providers/discover
   * Trigger manual model capability discovery
   * Respects rate limiting unless force=true is passed
   *
   * Query params:
   *   - force: boolean - Bypass rate limiting (use with caution)
   *   - provider: string - Only discover from specific provider
   */
  fastify.post<{
    Querystring: { force?: string; provider?: string };
  }>('/llm-providers/discover', async (request, reply) => {
    try {
      const { getModelCapabilityDiscoveryService } = await import('../../services/ModelCapabilityDiscoveryService.js');
      const discoveryService = getModelCapabilityDiscoveryService();

      if (!discoveryService) {
        return reply.code(503).send({
          error: 'Discovery service not initialized',
          message: 'Model capability discovery is not available. Check if DISABLE_MODEL_DISCOVERY=true',
          suggestion: 'Set CAPABILITY_DISCOVERY_MODE=lazy (default) to enable lazy discovery'
        });
      }

      const force = request.query.force === 'true';

      // Check rate limiting status before discovery
      const statusBefore = discoveryService.getDiscoveryStatus();
      const rateLimitedProviders = statusBefore.providers.filter(p => !p.canDiscover);

      if (!force && rateLimitedProviders.length > 0 && rateLimitedProviders.length === statusBefore.providers.length) {
        return reply.code(429).send({
          error: 'Rate limited',
          message: 'All providers are rate limited. Wait or use force=true to bypass',
          providers: rateLimitedProviders.map(p => ({
            name: p.name,
            waitTimeMs: p.waitTimeMs,
            waitTimeHuman: `${Math.ceil(p.waitTimeMs / 1000)}s`
          })),
          suggestion: 'Wait for the cooldown period or use ?force=true to bypass rate limiting'
        });
      }

      logger.info({ force, user: (request as any).user?.email }, 'Starting manual model discovery');

      const startTime = Date.now();
      const models = await discoveryService.discoverAllModels(force);
      const duration = Date.now() - startTime;

      const statusAfter = discoveryService.getDiscoveryStatus();

      return reply.send({
        success: true,
        modelsDiscovered: models.length,
        totalCached: statusAfter.cachedModels,
        durationMs: duration,
        providers: statusAfter.providers,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Manual discovery failed');
      return reply.code(500).send({
        error: 'Discovery failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/available-models
   * Fetch live list of available models from all configured providers
   * This allows admins to search and add models without knowing exact model IDs
   *
   * Query params:
   *   - provider: Filter by specific provider (aws-bedrock, google-vertex, azure-openai, ollama)
   *   - search: Search term to filter models by name
   *   - category: Filter by category (chat, embedding, image, code)
   *   - limit: Max number of models to return (default 50)
   */
  fastify.get<{
    Querystring: {
      provider?: string;
      search?: string;
      category?: string;
      limit?: string;
    };
  }>('/llm-providers/available-models', async (request, reply) => {
    try {
      const { provider, search, category, limit: limitStr } = request.query;
      const limit = parseInt(limitStr || '50', 10);

      const allModels: Array<{
        id: string;
        name: string;
        provider: string;
        category: string;
        description?: string;
        inputCostPer1M?: number;
        outputCostPer1M?: number;
        maxTokens?: number;
        capabilities?: string[];
      }> = [];

      // Fetch from AWS Bedrock if enabled and matches filter
      if ((!provider || provider === 'aws-bedrock') && process.env.AWS_BEDROCK_ENABLED === 'true') {
        try {
          const { BedrockClient, ListFoundationModelsCommand } = await import('@aws-sdk/client-bedrock');
          const client = new BedrockClient({ region: process.env.AWS_REGION || 'us-east-1' });
          const response = await client.send(new ListFoundationModelsCommand({}));

          for (const model of response.modelSummaries || []) {
            const modelId = model.modelId || '';
            const modelName = model.modelName || modelId;
            const providerName = model.providerName || 'Unknown';

            // Determine category
            let modelCategory = 'chat';
            if (modelId.includes('embed')) modelCategory = 'embedding';
            else if (modelId.includes('image') || modelId.includes('stable')) modelCategory = 'image';

            // Get pricing from BedrockPricingService
            const { bedrockPricingService } = await import('../../services/BedrockPricingService.js');
            const pricing = bedrockPricingService.getModelPricing(modelId);

            allModels.push({
              id: modelId,
              name: `${providerName} ${modelName}`,
              provider: 'aws-bedrock',
              category: modelCategory,
              description: `${providerName} model via AWS Bedrock`,
              inputCostPer1M: pricing.inputPricePer1k * 1000,
              outputCostPer1M: pricing.outputPricePer1k * 1000,
              capabilities: [
                ...(model.outputModalities || []),
                ...(model.inputModalities || []),
                model.responseStreamingSupported ? 'streaming' : ''
              ].filter(Boolean)
            });
          }
          logger.info({ count: response.modelSummaries?.length }, 'Fetched Bedrock models');
        } catch (bedrockError) {
          logger.warn({ error: bedrockError }, 'Failed to fetch Bedrock models');
        }
      }

      // Fetch from Google Vertex AI if enabled
      if ((!provider || provider === 'google-vertex') && process.env.GOOGLE_CLOUD_PROJECT) {
        try {
          // Use the Vertex AI publisher models API
          const accessToken = await getGoogleAccessToken();
          if (accessToken) {
            const project = process.env.GOOGLE_CLOUD_PROJECT;
            const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

            // Fetch Gemini models
            const geminiModels = [
              { id: 'gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', category: 'chat', inputCost: 0.10, outputCost: 0.40 },
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', category: 'chat', inputCost: 0.15, outputCost: 0.60 },
              { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', category: 'chat', inputCost: 0.075, outputCost: 0.30 },
              { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', category: 'chat', inputCost: 1.25, outputCost: 5.00 },
              { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash (Preview)', category: 'chat', inputCost: 0.15, outputCost: 0.60 },
              { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro (Preview)', category: 'chat', inputCost: 1.25, outputCost: 5.00 },
              { id: 'text-embedding-005', name: 'Text Embedding 005', category: 'embedding', inputCost: 0.025, outputCost: 0 },
              { id: 'text-embedding-004', name: 'Text Embedding 004', category: 'embedding', inputCost: 0.025, outputCost: 0 },
              { id: 'imagen-3.0-generate-001', name: 'Imagen 3.0', category: 'image', inputCost: 0, outputCost: 0 },
              { id: 'imagen-3.0-fast-generate-001', name: 'Imagen 3.0 Fast', category: 'image', inputCost: 0, outputCost: 0 },
            ];

            for (const model of geminiModels) {
              allModels.push({
                id: model.id,
                name: model.name,
                provider: 'google-vertex',
                category: model.category,
                description: `Google ${model.name} via Vertex AI`,
                inputCostPer1M: model.inputCost,
                outputCostPer1M: model.outputCost,
                capabilities: ['streaming', 'json-mode', model.category === 'chat' ? 'function-calling' : ''].filter(Boolean)
              });
            }
            logger.info({ count: geminiModels.length }, 'Added Vertex AI models');
          }
        } catch (vertexError) {
          logger.warn({ error: vertexError }, 'Failed to fetch Vertex AI models');
        }
      }

      // Fetch from Azure OpenAI if enabled
      if ((!provider || provider === 'azure-openai') && process.env.AZURE_OPENAI_ENDPOINT) {
        try {
          const { AzureOpenAI } = await import('openai');
          const client = new AzureOpenAI({
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
          });

          // Azure doesn't have a list models API, so we use known deployments
          const deployments = (process.env.AZURE_OPENAI_DEPLOYMENTS || '').split(',').filter(Boolean);
          for (const deployment of deployments) {
            allModels.push({
              id: deployment,
              name: deployment,
              provider: 'azure-openai',
              category: 'chat',
              description: `Azure OpenAI deployment: ${deployment}`,
              capabilities: ['streaming', 'function-calling']
            });
          }
          logger.info({ count: deployments.length }, 'Added Azure OpenAI models');
        } catch (azureError) {
          logger.warn({ error: azureError }, 'Failed to fetch Azure OpenAI models');
        }
      }

      // Fetch from Ollama if enabled
      if ((!provider || provider === 'ollama') && process.env.OLLAMA_BASE_URL) {
        try {
          const response = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`);
          if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
            for (const model of data.models || []) {
              allModels.push({
                id: model.name,
                name: model.name,
                provider: 'ollama',
                category: 'chat',
                description: `Local Ollama model (${Math.round((model.size || 0) / 1e9)}GB)`,
                inputCostPer1M: 0, // Free
                outputCostPer1M: 0,
                capabilities: ['streaming']
              });
            }
            logger.info({ count: data.models?.length }, 'Added Ollama models');
          }
        } catch (ollamaError) {
          logger.warn({ error: ollamaError }, 'Failed to fetch Ollama models');
        }
      }

      // Apply filters
      let filtered = allModels;

      // Category filter
      if (category) {
        filtered = filtered.filter(m => m.category === category);
      }

      // Search filter (case-insensitive)
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(m =>
          m.id.toLowerCase().includes(searchLower) ||
          m.name.toLowerCase().includes(searchLower) ||
          m.description?.toLowerCase().includes(searchLower)
        );
      }

      // Sort by provider, then name
      filtered.sort((a, b) => {
        if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
        return a.name.localeCompare(b.name);
      });

      // Apply limit
      const limited = filtered.slice(0, limit);

      return reply.send({
        models: limited,
        total: filtered.length,
        providers: [...new Set(allModels.map(m => m.provider))],
        categories: [...new Set(allModels.map(m => m.category))],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to fetch available models');
      return reply.code(500).send({
        error: 'Failed to fetch available models',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });
};

// Helper function to get Google access token
async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token || null;
  } catch {
    return null;
  }
}

export default llmProviderRoutes;
