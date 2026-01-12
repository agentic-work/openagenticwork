/**
 * Chat Artifacts and Outputs Routes
 * 
 * Manages document, image, and file artifacts generated during chat sessions.
 * Provides vector-enhanced storage, search, and retrieval capabilities.
 * 
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ArtifactService, UploadArtifactRequest, SearchArtifactsRequest, ArtifactType } from '../services/ArtifactService.js';
import { loggers } from '../utils/logger.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { MultipartFile } from '@fastify/multipart';

// JSON Schema definitions
const UploadArtifactSchema = {
  type: 'object',
  required: ['file'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    isPublic: { type: 'boolean' }
  }
};

const SearchArtifactsSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string' },
    type: { 
      type: 'string',
      enum: Object.values(ArtifactType)
    },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    limit: { type: 'number', minimum: 1, maximum: 100 },
    threshold: { type: 'number', minimum: 0, maximum: 1 },
    includePublic: { type: 'boolean' }
  }
};

const ArtifactListSchema = {
  type: 'object',
  properties: {
    type: { 
      type: 'string',
      enum: Object.values(ArtifactType)
    },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    limit: { type: 'number', minimum: 1, maximum: 100 },
    offset: { type: 'number', minimum: 0 },
    sortBy: {
      type: 'string',
      enum: ['created', 'accessed', 'title']
    },
    sortOrder: {
      type: 'string',
      enum: ['asc', 'desc']
    }
  }
};

export const artifactsRoutes = async (fastify: FastifyInstance) => {
  // Check if embeddings are enabled before initializing ArtifactService
  const embeddingsEnabled = process.env.EMBEDDING_ENABLED !== 'false' &&
                            process.env.ENABLE_VECTOR_SEARCH !== 'false';

  let artifactService: ArtifactService | null = null;

  if (embeddingsEnabled) {
    try {
      artifactService = new ArtifactService(loggers.services);
      loggers.services.info('ArtifactService initialized for artifact routes');
    } catch (error) {
      loggers.services.warn({ error }, 'Failed to initialize ArtifactService, artifact routes will return limited functionality');
    }
  } else {
    loggers.services.info('ArtifactService disabled (EMBEDDING_ENABLED=false or ENABLE_VECTOR_SEARCH=false)');
  }

  // Helper to check if artifacts are available - returns the error response if not available
  const checkArtifactService = (reply: FastifyReply): FastifyReply | null => {
    if (!artifactService) {
      return reply.status(503).send({
        error: 'Artifact service unavailable',
        message: 'Vector embeddings are disabled. Configure EMBEDDING_PROVIDER to enable artifact features.'
      });
    }
    return null; // Service is available
  };

  // Helper to get user ID
  const getUserId = (request: FastifyRequest): string => {
    const user = (request as any).user;
    return user?.userId || user?.id || request.headers['x-user-id'] as string;
  };
  // Upload artifact endpoint
  fastify.post('/api/artifacts/upload', {
    preHandler: authMiddleware,
    schema: {
      // consumes: ['multipart/form-data'], // Not supported in Fastify schema
      body: UploadArtifactSchema
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const serviceError = checkArtifactService(reply);
    if (serviceError) return serviceError;

    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      // Handle multipart file upload
      const data = await (request as any).file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      const uploadRequest: UploadArtifactRequest = {
        file: buffer,
        filename: data.filename || 'unknown',
        mimeType: data.mimetype || 'application/octet-stream',
        title: (data.fields as any)?.title?.value,
        description: (data.fields as any)?.description?.value,
        tags: (data.fields as any)?.tags?.value ? JSON.parse((data.fields as any).tags.value) : [],
        isPublic: (data.fields as any)?.isPublic?.value === 'true'
      };

      const result = await artifactService!.uploadArtifact(userId, uploadRequest);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error }, 'Failed to upload artifact');
      return reply.status(500).send({ 
        error: 'Failed to upload artifact',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Search artifacts endpoint
  fastify.post('/api/artifacts/search', {
    preHandler: authMiddleware,
    schema: {
      body: SearchArtifactsSchema
    }
  }, async (request: FastifyRequest<{ Body: SearchArtifactsRequest }>, reply: FastifyReply) => {
    const serviceError = checkArtifactService(reply);
    if (serviceError) return serviceError;

    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const result = await artifactService!.searchArtifacts(userId, request.body);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error }, 'Failed to search artifacts');
      return reply.status(500).send({ 
        error: 'Failed to search artifacts',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // List artifacts endpoint
  fastify.get('/api/artifacts', {
    preHandler: authMiddleware,
    schema: {
      querystring: ArtifactListSchema
    }
  }, async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
    const serviceError = checkArtifactService(reply);
    if (serviceError) return serviceError;

    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const options = {
        type: (request.query as any).type,
        tags: (request.query as any).tags,
        limit: (request.query as any).limit ? parseInt((request.query as any).limit) : undefined,
        offset: (request.query as any).offset ? parseInt((request.query as any).offset) : undefined,
        sortBy: (request.query as any).sortBy,
        sortOrder: (request.query as any).sortOrder
      };

      const result = await artifactService!.listArtifacts(userId, options);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error }, 'Failed to list artifacts');
      return reply.status(500).send({ 
        error: 'Failed to list artifacts',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Delete artifact endpoint
  fastify.delete('/api/artifacts/:id', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const serviceError = checkArtifactService(reply);
    if (serviceError) return serviceError;

    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      await artifactService!.deleteArtifact(userId, request.params.id);
      return reply.send({ message: 'Artifact deleted successfully' });
    } catch (error) {
      request.log.error({ error }, 'Failed to delete artifact');
      
      if (error instanceof Error && error.message.includes('not found')) {
        return reply.status(404).send({ error: 'Artifact not found' });
      }
      
      return reply.status(500).send({ 
        error: 'Failed to delete artifact',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get artifact statistics endpoint
  fastify.get('/api/artifacts/stats', {
    preHandler: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const serviceError = checkArtifactService(reply);
    if (serviceError) return serviceError;

    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const stats = await artifactService!.getArtifactStats(userId);
      return reply.send(stats);
    } catch (error) {
      request.log.error({ error }, 'Failed to get artifact stats');
      return reply.status(500).send({ 
        error: 'Failed to get artifact stats',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Health check endpoint
  fastify.get('/api/artifacts/health', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!artifactService) {
      return reply.send({
        healthy: false,
        message: 'Artifact service disabled (embeddings not configured)'
      });
    }
    try {
      const health = await artifactService.healthCheck();
      return reply.send(health);
    } catch (error) {
      request.log.error({ error }, 'Artifact service health check failed');
      return reply.status(500).send({
        healthy: false,
        error: 'Health check failed'
      });
    }
  });
};

export default artifactsRoutes;