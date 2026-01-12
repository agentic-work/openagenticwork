/**
 * Model Management and Discovery Routes
 *
 * Discovers and manages available AI models through ProviderManager.
 * Provides unified access to AWS Bedrock, Azure OpenAI, and Google Vertex AI models.
 *
 * @see {@link https://docs.agenticwork.io/api/ai-ml-services/models}
 */

import { FastifyPluginAsync } from 'fastify';
import type { ProviderManager } from '../../services/llm-providers/ProviderManager.js';

export interface ModelsRouteOptions {
  providerManager?: ProviderManager;
}

export const modelsRoutes: FastifyPluginAsync<ModelsRouteOptions> = async (fastify, options) => {
  const logger = fastify.log;
  const providerManager = options.providerManager;

  /**
   * GET /models - Returns chat models available for the model selector
   * Filters out embedding-only, vision-only models and respects AVAILABLE_MODELS env var
   */
  fastify.get('/', async (request, reply) => {
    try {
      const defaultModel = process.env.DEFAULT_MODEL;

      // Check if AVAILABLE_MODELS is explicitly set - if so, use only those
      const availableModelsEnv = process.env.AVAILABLE_MODELS;
      if (availableModelsEnv) {
        const allowedModels = availableModelsEnv.split(',').map(m => m.trim()).filter(m => m);

        logger.info({
          allowedModels,
          defaultModel
        }, 'Using explicit AVAILABLE_MODELS from environment');

        // Create models list from explicit configuration
        const models = allowedModels.map(modelId => ({
          id: modelId,
          name: modelId,
          provider: determineProvider(modelId),
          type: 'chat',
          capabilities: ['text', 'chat', 'function_calling', 'vision', 'tool_use'],
          status: 'active',
          description: `Chat model: ${modelId}`,
          metadata: {
            created: Date.now(),
            owned_by: determineProvider(modelId),
            model_id: modelId
          }
        }));

        const providers = [...new Set(models.map(m => m.provider))];

        return reply.send({
          models,
          total: models.length,
          providers,
          capabilities: ['text', 'chat', 'function_calling', 'vision', 'tool_use'],
          defaultModel: defaultModel || models[0]?.id,
          provider_status: 'configured'
        });
      }

      // Fallback: get models from ProviderManager but filter for chat-capable only
      if (!providerManager) {
        logger.warn('ProviderManager not available, returning fallback with DEFAULT_MODEL only');
        const fallbackModels = defaultModel ? [{
          id: defaultModel,
          name: defaultModel,
          provider: determineProvider(defaultModel),
          type: 'chat',
          capabilities: ['text', 'chat', 'function_calling'],
          status: 'active',
          description: `Default model: ${defaultModel}`,
          metadata: { created: Date.now(), owned_by: 'system', model_id: defaultModel }
        }] : [];

        return reply.send({
          models: fallbackModels,
          total: fallbackModels.length,
          providers: fallbackModels.map(m => m.provider),
          capabilities: ['text', 'chat'],
          defaultModel,
          provider_status: 'not_initialized'
        });
      }

      logger.info('Fetching models from ProviderManager with chat filter');

      // Get actual models from ProviderManager
      const providerModels = await providerManager.listModels();

      // Filter to only include chat-capable models (exclude embedding/vision-only)
      const chatModels = providerModels.filter(model => {
        const id = model.id.toLowerCase();
        const name = (model.name || '').toLowerCase();

        // Exclude embedding-only models
        if (id.includes('embed') || name.includes('embed')) return false;
        if (id.includes('titan-embed')) return false;

        // Exclude vision-only models (but keep multimodal chat models)
        if (id.includes('vision') && !id.includes('chat')) return false;

        return true;
      });

      // Transform to API format
      const models = chatModels.map(model => ({
        id: model.id,
        name: model.name || model.id,
        provider: model.provider,
        type: 'chat',
        capabilities: ['text', 'chat', 'function_calling', 'vision', 'tool_use'],
        status: 'active',
        description: `${model.provider} model: ${model.name}`,
        metadata: {
          created: Date.now(),
          owned_by: model.provider,
          model_id: model.id
        }
      }));

      const providers = [...new Set(models.map(m => m.provider))];

      logger.info({
        total: models.length,
        filtered: providerModels.length - chatModels.length,
        providers,
        defaultModel
      }, 'Successfully fetched chat models from ProviderManager');

      return reply.send({
        models,
        total: models.length,
        providers,
        capabilities: ['text', 'chat', 'function_calling', 'vision', 'tool_use'],
        defaultModel: defaultModel || models[0]?.id,
        provider_status: 'connected'
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get models from ProviderManager');

      // Return minimal fallback response
      return reply.code(500).send({
        error: 'Failed to fetch models',
        models: [],
        total: 0,
        providers: [],
        capabilities: ['text', 'chat'],
        defaultModel: process.env.DEFAULT_MODEL,
        provider_status: 'error'
      });
    }
  });

  /**
   * Helper to determine provider from model ID
   */
  function determineProvider(modelId: string): string {
    const id = modelId.toLowerCase();
    if (id.includes('gemini') || id.includes('imagen')) return 'google-vertex';
    if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'azure-openai';
    if (id.includes('claude') || id.includes('anthropic')) return 'aws-bedrock';
    if (id.includes('llama') || id.includes('qwen') || id.includes('mistral')) return 'ollama';
    return 'unknown';
  }

  /**
   * GET /models/:id - Get specific model information from Azure OpenAI
   */
  fastify.get('/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;
      const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL;

      // Check if requested model matches our deployment
      if (id === azureDeployment) {
        return reply.send({
          id: azureDeployment,
          object: 'model',
          created: Date.now(),
          owned_by: 'azure-openai',
          provider: 'azure-openai',
          type: 'chat',
          capabilities: ['text', 'chat', 'function_calling', 'vision'],
          status: 'active'
        });
      }

      return reply.code(404).send({
        error: 'Model not found',
        modelId: id,
        availableModels: [azureDeployment]
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get model info');
      return reply.code(500).send({
        error: 'Failed to get model information'
      });
    }
  });
};