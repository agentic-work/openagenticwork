/**
 * Authentication Middleware for Fastify
 *
 * SIMPLIFIED - Uses unified token validator
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { validateAnyToken, extractBearerToken } from '../auth/tokenValidator.js';

/**
 * Basic authentication middleware
 * Validates JWT token and attaches user to request
 */
export const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  try {
    // DEV MODE BYPASS: Only enabled if explicitly configured
    // SECURITY WARNING: This bypass should NEVER be enabled in production!
    // Set ENABLE_DEV_AUTH_BYPASS=true in .env ONLY for local development
    const devBypassEnabled = process.env.ENABLE_DEV_AUTH_BYPASS === 'true';
    const apiKey = (request.headers as any)['x-api-key'];
    const devApiKey = process.env.DEV_API_KEY;

    if (devBypassEnabled && devApiKey && apiKey === devApiKey) {
      request.log.warn('[AUTH] !!! DEV MODE API KEY AUTHENTICATION - INSECURE !!!');
      (request as any).user = {
        id: 'dev-admin',
        email: 'admin@localhost',
        name: 'Dev Admin',
        isAdmin: true,
        groups: ['AgenticWork-Admins']
      };
      return;
    }

    // Extract token from header
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
      return;
    }

    // Validate token using unified validator
    const result = await validateAnyToken(token, {
      logger: request.log
    });

    if (!result.isValid) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: result.error || 'Invalid authentication token'
      });
      return;
    }

    // Attach user to request
    (request as any).user = {
      id: result.user!.userId,
      email: result.user!.email,
      name: result.user!.name,
      isAdmin: result.user!.isAdmin || false,
      groups: result.user!.groups || []
    };

    return;
  } catch (error) {
    request.log.error({ error }, 'Authentication error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to authenticate'
    });
  }
};