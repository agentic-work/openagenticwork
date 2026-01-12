/**
 * Ollama Admin Routes
 *
 * Admin endpoints for managing Ollama models and configuration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Ollama } from 'ollama';
import { loggers } from '../utils/logger.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

export async function adminOllamaRoutes(fastify: FastifyInstance) {
  const client = new Ollama({ host: OLLAMA_BASE_URL });

  /**
   * GET /api/admin/ollama/status
   * Get Ollama server status and info
   */
  fastify.get('/ollama/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const models = await client.list();
      const running = await client.ps();

      return {
        success: true,
        status: 'connected',
        endpoint: OLLAMA_BASE_URL,
        models: models.models?.length || 0,
        runningModels: running.models?.length || 0
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to get status');
      return reply.code(503).send({
        success: false,
        status: 'disconnected',
        endpoint: OLLAMA_BASE_URL,
        error: error.message
      });
    }
  });

  /**
   * GET /api/admin/ollama/models
   * List all available models
   */
  fastify.get('/ollama/models', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await client.list();

      return {
        success: true,
        models: response.models.map(m => ({
          name: m.name,
          size: m.size,
          digest: m.digest,
          modifiedAt: m.modified_at,
          details: m.details
        }))
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to list models');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/admin/ollama/running
   * Get currently running models
   */
  fastify.get('/ollama/running', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await client.ps();

      return {
        success: true,
        models: response.models?.map(m => ({
          name: m.name,
          size: m.size,
          digest: m.digest,
          expiresAt: m.expires_at,
          sizeVram: m.size_vram
        })) || []
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to get running models');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/ollama/pull
   * Pull a model from Ollama registry
   */
  fastify.post('/ollama/pull', async (request: FastifyRequest<{ Body: { model: string } }>, reply: FastifyReply) => {
    try {
      const { model } = request.body;

      if (!model) {
        return reply.code(400).send({
          success: false,
          error: 'Model name is required'
        });
      }

      loggers.services.info({ model }, '[OllamaAdmin] Pulling model');

      // Start the pull (non-blocking for long pulls)
      const stream = await client.pull({ model, stream: true });

      // Collect progress updates
      const progress: any[] = [];
      for await (const chunk of stream) {
        progress.push(chunk);
        if (chunk.status === 'success') {
          break;
        }
      }

      loggers.services.info({ model }, '[OllamaAdmin] Model pulled successfully');

      return {
        success: true,
        model,
        message: `Model ${model} pulled successfully`
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to pull model');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * DELETE /api/admin/ollama/models/:model
   * Delete a model
   */
  fastify.delete('/ollama/models/:model', async (request: FastifyRequest<{ Params: { model: string } }>, reply: FastifyReply) => {
    try {
      const { model } = request.params;

      await client.delete({ model });

      loggers.services.info({ model }, '[OllamaAdmin] Model deleted');

      return {
        success: true,
        message: `Model ${model} deleted successfully`
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to delete model');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/admin/ollama/models/:model/info
   * Get detailed model information
   */
  fastify.get('/ollama/models/:model/info', async (request: FastifyRequest<{ Params: { model: string } }>, reply: FastifyReply) => {
    try {
      const { model } = request.params;

      const info = await client.show({ model });

      return {
        success: true,
        model,
        info: {
          license: info.license,
          modelfile: info.modelfile,
          parameters: info.parameters,
          template: info.template,
          details: info.details,
          modelInfo: info.model_info
        }
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to get model info');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/ollama/copy
   * Copy/alias a model
   */
  fastify.post('/ollama/copy', async (request: FastifyRequest<{ Body: { source: string; destination: string } }>, reply: FastifyReply) => {
    try {
      const { source, destination } = request.body;

      if (!source || !destination) {
        return reply.code(400).send({
          success: false,
          error: 'Source and destination are required'
        });
      }

      await client.copy({ source, destination });

      loggers.services.info({ source, destination }, '[OllamaAdmin] Model copied');

      return {
        success: true,
        message: `Model ${source} copied to ${destination}`
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to copy model');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/ollama/generate
   * Test generate with a model
   */
  fastify.post('/ollama/generate', async (request: FastifyRequest<{ Body: { model: string; prompt: string } }>, reply: FastifyReply) => {
    try {
      const { model, prompt } = request.body;

      if (!model || !prompt) {
        return reply.code(400).send({
          success: false,
          error: 'Model and prompt are required'
        });
      }

      const response = await client.generate({
        model,
        prompt,
        stream: false
      });

      return {
        success: true,
        model,
        response: response.response,
        context: response.context?.length || 0,
        totalDuration: response.total_duration,
        loadDuration: response.load_duration,
        promptEvalCount: response.prompt_eval_count,
        evalCount: response.eval_count
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to generate');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/admin/ollama/embed
   * Test embeddings with a model
   */
  fastify.post('/ollama/embed', async (request: FastifyRequest<{ Body: { model: string; input: string } }>, reply: FastifyReply) => {
    try {
      const { model, input } = request.body;

      if (!model || !input) {
        return reply.code(400).send({
          success: false,
          error: 'Model and input are required'
        });
      }

      const response = await client.embed({
        model,
        input
      });

      return {
        success: true,
        model,
        dimensions: response.embeddings[0]?.length || 0,
        embeddings: response.embeddings
      };
    } catch (error: any) {
      loggers.services.error({ error: error.message }, '[OllamaAdmin] Failed to embed');
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });
}
