/**
 * System Configuration Routes
 *
 * Provides endpoints for discovering system configuration.
 * Flowise is the default and only workflow engine.
 */

import { FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import axios from 'axios';

// Check if a service is available by trying to connect to it
async function checkServiceAvailable(url: string, timeout = 3000): Promise<boolean> {
  try {
    const response = await axios.get(url, { timeout });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

export const systemConfigRoutes: FastifyPluginAsync = async (fastify, opts) => {

  /**
   * Get system configuration including deployed workflow engine
   * No authentication required - public configuration endpoint
   */
  fastify.get('/config', async (request, reply) => {
    try {
      // Flowise is the default workflow engine
      const flowiseUrl = process.env.FLOWISE_URL || 'http://agenticwork-flowise:3000';
      const flowiseAvailable = await checkServiceAvailable(`${flowiseUrl}/api/v1/ping`);

      return reply.send({
        workflowEngine: {
          type: 'flowise' as const,
          name: 'Flowise',
          available: flowiseAvailable,
          url: flowiseAvailable ? flowiseUrl : null
        },
        features: {
          // Core features - default to enabled
          agenticode: process.env.AGENTICODE_ENABLED !== 'false',
          mcp: process.env.ENABLE_MCP !== 'false',
          vectorSearch: process.env.ENABLE_VECTOR_SEARCH !== 'false',
          // Optional services - require explicit enabling
          ollama: process.env.OLLAMA_ENABLED === 'true',
          flowise: process.env.FLOWISE_ENABLED === 'true' && flowiseAvailable,
          multiModel: process.env.ENABLE_MULTI_MODEL === 'true',
          slider: process.env.ENABLE_INTELLIGENCE_SLIDER !== 'false' // Default enabled
        },
        version: process.env.APP_VERSION || '1.0.0'
      });
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get system config');
      return reply.status(500).send({ error: 'Failed to get system configuration' });
    }
  });
};

export default systemConfigRoutes;
