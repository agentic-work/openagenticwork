/**
 * Code Routes
 * API endpoints for AgenticWorkCode functionality
 *
 * Adapted for Fastify from the AgenticWorkCode specification
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { AgenticCodeService } from '../services/AgenticCodeService.js';
import { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import { UserPermissionsService } from '../services/UserPermissionsService.js';
import { prisma } from '../utils/prisma.js';

// SECURITY: Internal API key for code-manager authentication
const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';

/**
 * Create fetch headers with internal authentication
 * SECURITY: All requests to code-manager must include the internal API key
 */
function createInternalHeaders(contentType = false): HeadersInit {
  const headers: HeadersInit = {};
  if (CODE_MANAGER_INTERNAL_KEY) {
    headers['X-Internal-API-Key'] = CODE_MANAGER_INTERNAL_KEY;
  }
  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

// Types for request bodies
interface CreateSessionBody {
  model?: string;
}

interface ExecuteBody {
  sessionId: string;
  prompt: string;
  model?: string;
}

interface WriteFileBody {
  sessionId?: string;
  content: string;
}

interface FilesQuery {
  sessionId?: string;
  path?: string;
}

interface CodeRoutesOptions {
  providerManager?: ProviderManager;
}

/**
 * Register code routes
 */
export default async function codeRoutes(fastify: FastifyInstance, options: CodeRoutesOptions) {
  // Initialize permissions service
  const permissionsService = new UserPermissionsService(prisma, fastify.log as Logger);

  // Get providerManager from options (passed from server.ts)
  const providerManager = options.providerManager;

  if (!providerManager) {
    fastify.log.warn('ProviderManager not available, AgenticCodeService will have limited functionality');
  }

  const managerUrl = process.env.CODE_MANAGER_URL || 'http://agenticode-manager:3050';

  // Middleware to check AWCode permission
  // Admins always have access, non-admins need explicit canUseAwcode permission
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip permission check for health endpoint (unauthenticated)
    if (request.url.endsWith('/health')) {
      return;
    }

    // Skip permission check for access-check endpoint (internal MCP use)
    if (request.url.includes('/access-check')) {
      return;
    }

    // Ensure user is authenticated
    if (!request.user || !request.user.id) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const userId = request.user.id;
    const isAdmin = request.user.isAdmin || false;
    const userGroups = request.user.groups || [];

    // Check AWCode access permission
    const canAccess = await permissionsService.canAccessAwcode(userId, isAdmin, userGroups);

    if (!canAccess) {
      request.log.warn({ userId, isAdmin }, 'AWCode access denied - user lacks permission');
      reply.code(403).send({
        error: 'AWCode access denied',
        message: 'You do not have permission to use AgenticWork Code. Please contact an administrator to enable this feature.'
      });
      return;
    }
  });

  // Only create codeService if providerManager is available
  // The execute endpoint requires LLM access
  const codeService = providerManager ? new AgenticCodeService(
    fastify.log as Logger,
    providerManager,
    {
      managerUrl,
      defaultModel: process.env.DEFAULT_CODE_MODEL || process.env.DEFAULT_MODEL
    }
  ) : null;

  // NOTE: access-check endpoint moved to server.ts (outside auth wrapper for internal MCP use)
  // NOTE: Health check endpoint is registered at server level (no auth required)
  // See server.ts for /api/code/health and /api/code/access-check endpoints

  /**
   * Create or get existing code session
   * POST /api/code/sessions
   *
   * For managed mode, the auth token is passed to the CLI so it can
   * route LLM calls through the AgenticWork API.
   */
  fastify.post<{ Body: CreateSessionBody }>(
    '/sessions',
    async (request: FastifyRequest<{ Body: CreateSessionBody }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { model } = request.body;

        // Extract auth token for managed mode - CLI will use this to call AgenticWork API
        const authHeader = request.headers.authorization;
        const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

        const session = await codeService.createSession(userId, model, { apiKey });
        return reply.send(session);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to create code session');
        return reply.code(500).send({ error: 'Failed to create session' });
      }
    }
  );

  /**
   * Get session status
   * GET /api/code/sessions/:sessionId
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.params;

        const session = await codeService.getSession(sessionId, userId);
        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }
        return reply.send(session);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to get session');
        return reply.code(500).send({ error: 'Failed to get session' });
      }
    }
  );

  /**
   * Delete session and cleanup container
   * DELETE /api/code/sessions/:sessionId
   */
  fastify.delete<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.params;

        await codeService.deleteSession(sessionId, userId);
        return reply.send({ status: 'deleted' });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to delete session');
        return reply.code(500).send({ error: 'Failed to delete session' });
      }
    }
  );

  /**
   * Execute agentic code loop (SSE streaming)
   * POST /api/code/execute
   */
  fastify.post<{ Body: ExecuteBody }>(
    '/execute',
    async (request: FastifyRequest<{ Body: ExecuteBody }>, reply: FastifyReply): Promise<void> => {
      try {
        if (!codeService) {
          reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
          return;
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          reply.code(401).send({ error: 'Unauthorized' });
          return;
        }

        const userId = request.user.id;
        const { sessionId, prompt, model } = request.body;

        if (!sessionId || !prompt) {
          reply.code(400).send({ error: 'sessionId and prompt required' });
          return;
        }

        // Hijack the connection for SSE streaming
        reply.hijack();

        // Set up SSE headers
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no' // CRITICAL: Disable NGINX buffering for SSE streaming
        });

        try {
          await codeService.executeAgenticLoop(
            sessionId,
            userId,
            prompt,
            model,
            (event) => {
              reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          );
          reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        } catch (error: any) {
          request.log.error({ err: error }, 'Agentic loop error');
          reply.raw.write(`data: ${JSON.stringify({
            type: 'error',
            content: error.message || 'Execution failed'
          })}\n\n`);
        }
        reply.raw.end();
      } catch (error) {
        request.log.error({ err: error }, 'Agentic loop setup error');
        if (!reply.raw.headersSent) {
          reply.hijack();
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // CRITICAL: Disable NGINX buffering for SSE streaming
          });
        }
        reply.raw.write(`data: ${JSON.stringify({
          type: 'error',
          message: 'Execution failed'
        })}\n\n`);
        reply.raw.end();
      }
    }
  );

  /**
   * List files in workspace
   * GET /api/code/files
   */
  fastify.get<{ Querystring: FilesQuery }>(
    '/files',
    async (request: FastifyRequest<{ Querystring: FilesQuery }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId, path = '.' } = request.query;

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        const files = await codeService.listFiles(sessionId, userId, path);
        return reply.send(files);
      } catch (error) {
        request.log.error({ err: error }, 'Failed to list files');
        return reply.code(500).send({ error: 'Failed to list files' });
      }
    }
  );

  /**
   * Read file content
   * GET /api/code/files/*
   */
  fastify.get<{ Params: { '*': string }, Querystring: { sessionId?: string } }>(
    '/files/*',
    async (request: FastifyRequest<{ Params: { '*': string }, Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.query;
        const filePath = request.params['*'];

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        const content = await codeService.readFile(sessionId, userId, filePath);
        return reply.send({ path: filePath, content });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to read file');
        return reply.code(500).send({ error: 'Failed to read file' });
      }
    }
  );

  /**
   * Write file content
   * PUT /api/code/files/*
   */
  fastify.put<{ Params: { '*': string }, Querystring: { sessionId?: string }, Body: WriteFileBody }>(
    '/files/*',
    async (request: FastifyRequest<{ Params: { '*': string }, Querystring: { sessionId?: string }, Body: WriteFileBody }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.query;
        const { content } = request.body;
        const filePath = request.params['*'];

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        await codeService.writeFile(sessionId, userId, filePath, content);
        return reply.send({ status: 'written', path: filePath });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to write file');
        return reply.code(500).send({ error: 'Failed to write file' });
      }
    }
  );

  /**
   * Delete file
   * DELETE /api/code/files/*
   */
  fastify.delete<{ Params: { '*': string }, Querystring: { sessionId?: string } }>(
    '/files/*',
    async (request: FastifyRequest<{ Params: { '*': string }, Querystring: { sessionId?: string } }>, reply: FastifyReply) => {
      try {
        if (!codeService) {
          return reply.code(503).send({ error: 'AWCode service unavailable - ProviderManager not initialized' });
        }

        // Ensure user is authenticated
        if (!request.user || !request.user.id) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        const userId = request.user.id;
        const { sessionId } = request.query;
        const filePath = request.params['*'];

        if (!sessionId) {
          return reply.code(400).send({ error: 'sessionId required' });
        }

        await codeService.deleteFile(sessionId, userId, filePath);
        return reply.send({ status: 'deleted', path: filePath });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to delete file');
        return reply.code(500).send({ error: 'Failed to delete file' });
      }
    }
  );

}
