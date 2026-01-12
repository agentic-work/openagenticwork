/**
 * Unified Authentication Middleware
 *
 * SIMPLIFIED VERSION - Uses single token validator
 *
 * Provides authentication for all routes, supporting both local JWT and Azure AD tokens.
 */

import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import { validateAnyToken, extractBearerToken } from '../auth/tokenValidator.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

/**
 * Extended request type with authenticated user
 */
export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    id: string;
    userId: string;
    email: string;
    name?: string;
    isAdmin: boolean;
    groups: string[];
    oid?: string;
    azureOid?: string;
    localAccount: boolean;
    accessToken?: string;  // Optional for local accounts
  };
  requestId?: string;
}

/**
 * Main authentication hook that validates tokens and attaches user to request
 */
export async function unifiedAuthHook(request: FastifyRequest): Promise<void> {
  const requestId = (request as any).requestId || 'unknown';
  const startTime = Date.now();

  try {
    // DEV MODE BYPASS: Only enabled if explicitly configured
    // SECURITY WARNING: This bypass should NEVER be enabled in production!
    // Set ENABLE_DEV_AUTH_BYPASS=true in .env ONLY for local development
    const devBypassEnabled = process.env.ENABLE_DEV_AUTH_BYPASS === 'true';
    const apiKey = request.headers['x-api-key'] as string;
    const devApiKey = process.env.DEV_API_KEY;

    if (devBypassEnabled && devApiKey && apiKey === devApiKey) {
      loggers.auth.warn({
        requestId,
        duration: Date.now() - startTime,
        mode: 'dev-api-key',
        warning: 'DEV AUTH BYPASS ACTIVE - SHOULD NOT BE USED IN PRODUCTION'
      }, '[AUTH] !!! DEV MODE API KEY AUTHENTICATION - INSECURE !!!');

      (request as any).user = {
        id: 'dev-admin',
        userId: 'dev-admin',
        email: 'admin@localhost',
        name: 'Dev Admin',
        isAdmin: true,
        groups: ['AgenticWork-Admins'],
        localAccount: true,
        accessToken: 'dev-token'
      };

      return;
    }

    // INTERNAL SERVICE BYPASS: Allow internal services (Flowise, MCP Proxy) to call APIs
    // This is secure because these services are only accessible within the Docker network
    const requestFrom = request.headers['x-request-from'] as string;
    const internalServices = ['flowise', 'mcp-proxy', 'internal'];

    if (requestFrom && internalServices.includes(requestFrom.toLowerCase())) {
      // Verify request is from internal network (Docker DNS hostnames)
      const clientIp = request.ip || (request.headers['x-forwarded-for'] as string)?.split(',')[0];
      const isInternalNetwork = clientIp?.startsWith('172.') || clientIp?.startsWith('10.') ||
                                clientIp === '127.0.0.1' || clientIp === '::1';

      if (isInternalNetwork) {
        loggers.auth.debug({
          requestId,
          duration: Date.now() - startTime,
          mode: 'internal-service',
          service: requestFrom,
          clientIp
        }, '[AUTH] Internal service authentication bypass');

        (request as any).user = {
          id: `service-${requestFrom}`,
          userId: `service-${requestFrom}`,
          email: `${requestFrom}@internal.agenticwork.io`,
          name: `${requestFrom} Service`,
          isAdmin: false,
          groups: ['internal-services'],
          localAccount: true,
          accessToken: 'internal-service-token'
        };

        return;
      }
    }

    // Check for API key first (X-API-Key header)
    // API keys have format: awc_<64-hex-chars>
    let token = request.headers['x-api-key'] as string;

    // If no API key, extract bearer token from header OR query params (for SSE where EventSource can't send headers)
    if (!token) {
      token = extractBearerToken(request.headers.authorization);
    }

    // If no token in header, check query params (specifically for SSE endpoints)
    if (!token) {
      const queryParams = request.query as { token?: string };
      token = queryParams.token || null;
    }

    // If no token in header or query, check cookies (for iframe contexts like Flowise)
    // Check multiple cookie names for compatibility:
    // - agenticwork_token: Set by Google OAuth login flow
    // - accessToken: Legacy cookie name
    if (!token) {
      const cookies = (request as any).cookies as Record<string, string> | undefined;
      // Debug: Log raw cookie header and parsed cookies
      const rawCookieHeader = request.headers.cookie;
      loggers.auth.info({
        requestId,
        rawCookieHeader: rawCookieHeader?.substring(0, 100),
        cookieKeys: cookies ? Object.keys(cookies) : 'undefined',
        hasAgenticworkToken: !!cookies?.agenticwork_token
      }, '[AUTH DEBUG] Cookie parsing check');

      token = cookies?.agenticwork_token || cookies?.accessToken || null;
      if (token) {
        const cookieName = cookies?.agenticwork_token ? 'agenticwork_token' : 'accessToken';
        loggers.auth.debug({ requestId, cookieName }, '[AUTH] Token extracted from cookie');
      }
    }

    if (!token) {
      throw new Error('No authentication token provided');
    }

    // Validate token using unified validator
    const result = await validateAnyToken(token, {
      logger: loggers.auth
    });

    if (!result.isValid) {
      throw new Error(result.error || 'Invalid authentication token');
    }

    const user = result.user!;

    // Build unified user object
    (request as any).user = {
      id: user.userId,
      userId: user.userId,
      oid: (user as any).oid,
      email: user.email,
      name: user.name,
      groups: user.groups || [],
      isAdmin: user.isAdmin || false,
      azureOid: (user as any).azureOid || (user as any).oid,
      localAccount: result.tokenType === 'local',
      accessToken: token
    };

    // CRITICAL: For LOCAL auth, load azure_oid from database if available
    // This enables OBO authentication for users who have linked Azure AD accounts
    if (result.tokenType === 'local' && user.userId) {
      try {
        const dbUser = await prisma.user.findFirst({
          where: { id: user.userId },
          select: { azure_oid: true }
        });

        if (dbUser?.azure_oid) {
          (request as any).user.azureOid = dbUser.azure_oid;
          (request as any).user.oid = dbUser.azure_oid;

          loggers.auth.debug({
            requestId,
            userId: user.userId,
            azureOid: dbUser.azure_oid
          }, '[AUTH] Loaded azure_oid from database for local auth user');
        }
      } catch (dbError) {
        loggers.auth.warn({
          requestId,
          userId: user.userId,
          error: dbError
        }, '[AUTH] Failed to load azure_oid from database - OBO may not work');
      }
    }

    // Auto-sync Azure AD users to database
    if (result.tokenType === 'azure-ad' && user.email) {
      try {
        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              { azure_oid: (user as any).oid },
              { email: user.email }
            ]
          }
        });

        if (!existingUser) {
          // Auto-create Azure AD user in database
          const newUser = await prisma.user.create({
            data: {
              id: `azure_${(user as any).oid || user.userId}`,
              email: user.email,
              name: user.name || user.email,
              azure_oid: (user as any).oid,
              azure_tenant_id: user.tenantId || 'default-tenant',
              is_admin: user.isAdmin,
              groups: user.groups,
              created_at: new Date(),
              updated_at: new Date()
            }
          });

          // Update user ID to match database record
          (request as any).user.id = newUser.id;
          (request as any).user.userId = newUser.id;

          loggers.auth.info({
            requestId,
            userId: newUser.id,
            email: user.email,
            azureOid: (user as any).oid
          }, '[AUTH] Auto-created Azure AD user in database');
        } else {
          // Update user ID to match existing database record
          (request as any).user.id = existingUser.id;
          (request as any).user.userId = existingUser.id;

          // Update existing user's Azure AD info
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              azure_oid: (user as any).oid,
              name: user.name,
              is_admin: user.isAdmin,
              groups: user.groups,
              updated_at: new Date()
            }
          });
        }
      } catch (dbError) {
        loggers.auth.error({
          requestId,
          error: dbError,
          userEmail: user.email,
          azureOid: (user as any).oid
        }, '[AUTH] Failed to auto-sync Azure AD user to database');
        // Continue with authentication even if DB sync fails
      }
    }

    (request as any).requestId = requestId;

    // Store API key info on request for tracking
    if (result.tokenType === 'api-key' && result.apiKeyId) {
      (request as any).apiKeyId = result.apiKeyId;
      (request as any).apiKeyName = result.apiKeyName;

      // Log API key usage to AdminAuditLog for metrics
      // This is done async to not block the request
      prisma.adminAuditLog.create({
        data: {
          admin_user_id: (request as any).user.id,
          action: 'api_request',
          resource_type: 'api_key_usage',
          resource_id: result.apiKeyId || 'unknown',
          details: {
            tokenId: result.apiKeyId,
            tokenName: result.apiKeyName,
            endpoint: request.url,
            method: request.method,
            timestamp: new Date().toISOString()
          }
        }
      }).catch(err => {
        loggers.auth.warn({ error: err.message }, '[AUTH] Failed to log API request for metrics');
      });
    }

    loggers.auth.debug({
      requestId,
      userId: (request as any).user.id,
      email: (request as any).user.email,
      tokenType: result.tokenType,
      apiKeyId: result.apiKeyId,
      duration: Date.now() - startTime
    }, '[AUTH] Authentication successful');

  } catch (error: any) {
    loggers.auth.warn({
      requestId,
      error: error.message,
      duration: Date.now() - startTime
    }, '[AUTH] Authentication failed');

    // Clear any partial user data
    delete (request as any).user;

    throw error;
  }
}

/**
 * Middleware function for use with preHandler
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await unifiedAuthHook(request);
  } catch (error: any) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: error.message || 'Authentication required'
    });
  }
}

/**
 * Admin middleware function
 */
export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await unifiedAuthHook(request);
    const user = (request as any).user;
    if (!user?.isAdmin) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Administrator access required'
      });
      return;
    }
  } catch (error: any) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: error.message || 'Authentication required'
    });
  }
}

/**
 * Plugin registration for Fastify
 */
export const authMiddlewarePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', authMiddleware);
  fastify.decorate('authenticateAdmin', adminMiddleware);
};