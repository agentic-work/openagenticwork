/**
 * Internal Result Storage API
 *
 * Endpoints for MCPs to query stored results.
 * Not exposed publicly - only accessible via internal network.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LargeResultStorageService } from '../../services/LargeResultStorageService.js';

// Singleton storage service (shared across pipeline instances)
// TODO: Move this to a proper service container
let storageService: LargeResultStorageService | null = null;

export function getStorageService(logger: any): LargeResultStorageService {
  if (!storageService) {
    storageService = new LargeResultStorageService(logger);
  }
  return storageService;
}

export async function registerResultStorageRoutes(fastify: FastifyInstance) {
  const logger = fastify.log;

  // Query stored result
  fastify.post('/api/internal/result-storage/query', async (
    request: FastifyRequest<{
      Body: {
        resultId: string;
        query: string;
        limit?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { resultId, query, limit = 10 } = request.body;

      logger.info({
        resultId,
        query,
        limit
      }, 'Internal API: Querying stored result');

      const storage = getStorageService(logger);
      const results = storage.queryStoredResult({
        resultId,
        query,
        limit
      });

      return reply.send({
        success: true,
        resultId,
        query,
        results,
        count: results.length
      });
    } catch (error: any) {
      logger.error({
        error: error.message
      }, 'Failed to query stored result');

      // Return proper error status so AI knows data is unavailable
      // 404 = not found (expired), 500 = other errors
      const statusCode = error.message.includes('not found or has expired') ? 404 : 500;

      return reply.code(statusCode).send({
        success: false,
        error: error.message,
        expired: statusCode === 404
      });
    }
  });

  // Get stored result summary
  fastify.get('/api/internal/result-storage/summary/:resultId', async (
    request: FastifyRequest<{
      Params: {
        resultId: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { resultId } = request.params;

      logger.info({
        resultId
      }, 'Internal API: Getting stored result summary');

      const storage = getStorageService(logger);
      const fullResult = storage.getFullResult(resultId);

      if (!fullResult) {
        return reply.code(404).send({
          success: false,
          error: 'Result not found or expired'
        });
      }

      // Return minimal summary info
      return reply.send({
        success: true,
        resultId,
        summary: 'Stored result available',
        chunkCount: 0, // TODO: Get actual chunk count
        sizeBytes: JSON.stringify(fullResult).length,
        timestamp: Date.now()
      });
    } catch (error: any) {
      logger.error({
        error: error.message
      }, 'Failed to get stored result summary');

      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  logger.info('Result storage internal API routes registered');
}
