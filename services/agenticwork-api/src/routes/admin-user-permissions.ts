/**
 * Admin User Permissions Routes
 *
 * Provides admin endpoints for managing user and group permissions including:
 * - LLM provider access
 * - MCP server access
 * - Flowise access
 * - Token/request limits
 * - Feature flags
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminGuard } from '../middleware/adminGuard.js';
import { AuthenticatedRequest } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';
import { UserPermissionsService, PermissionUpdate, GroupPermissionUpdate, PermissionTemplate } from '../services/UserPermissionsService.js';
import { loggers } from '../utils/logger.js';
import {
  getUserScopeStatus,
  unlockUserAccount,
  resetUserWarnings
} from '../services/ScopeEnforcementService.js';
import { SliderService } from '../services/SliderService.js';

// Admin request type
type AdminRequest = AuthenticatedRequest;

// ==========================================
// SWAGGER SCHEMA DEFINITIONS
// ==========================================

const permissionUpdateSchema = {
  type: 'object',
  properties: {
    allowedLlmProviders: { type: 'array', items: { type: 'string' }, description: 'List of allowed LLM provider IDs (empty = inherit defaults)' },
    deniedLlmProviders: { type: 'array', items: { type: 'string' }, description: 'List of denied LLM provider IDs' },
    allowedMcpServers: { type: 'array', items: { type: 'string' }, description: 'List of allowed MCP server IDs (empty = inherit defaults)' },
    deniedMcpServers: { type: 'array', items: { type: 'string' }, description: 'List of denied MCP server IDs' },
    flowiseEnabled: { type: 'boolean', description: 'Whether user can access Flowise workflows' },
    flowiseWorkflows: { type: 'array', items: { type: 'string' }, description: 'Allowed Flowise workflow IDs (empty = all)' },
    dailyTokenLimit: { type: 'integer', nullable: true, description: 'Daily token limit (null = unlimited)' },
    monthlyTokenLimit: { type: 'integer', nullable: true, description: 'Monthly token limit (null = unlimited)' },
    dailyRequestLimit: { type: 'integer', nullable: true, description: 'Daily request limit (null = unlimited)' },
    monthlyRequestLimit: { type: 'integer', nullable: true, description: 'Monthly request limit (null = unlimited)' },
    canUseImageGeneration: { type: 'boolean', description: 'Can use AI image generation' },
    canUseCodeExecution: { type: 'boolean', description: 'Can execute code via MCP' },
    canUseWebSearch: { type: 'boolean', description: 'Can use web search tools' },
    canUseFileUpload: { type: 'boolean', description: 'Can upload files' },
    canUseMemory: { type: 'boolean', description: 'Can use memory/context features' },
    canUseRag: { type: 'boolean', description: 'Can use RAG/knowledge base' },
    canUseAwcode: { type: 'boolean', description: 'Can use AgentiCode for code execution' },
    adminNotes: { type: 'string', description: 'Admin notes about this permission configuration' },
  },
} as const;

const userPermissionsResponseSchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
    allowedLlmProviders: { type: 'array', items: { type: 'string' } },
    deniedLlmProviders: { type: 'array', items: { type: 'string' } },
    allowedMcpServers: { type: 'array', items: { type: 'string' } },
    deniedMcpServers: { type: 'array', items: { type: 'string' } },
    flowiseEnabled: { type: 'boolean' },
    flowiseWorkflows: { type: 'array', items: { type: 'string' } },
    dailyTokenLimit: { type: 'integer', nullable: true },
    monthlyTokenLimit: { type: 'integer', nullable: true },
    dailyRequestLimit: { type: 'integer', nullable: true },
    monthlyRequestLimit: { type: 'integer', nullable: true },
    canUseImageGeneration: { type: 'boolean' },
    canUseCodeExecution: { type: 'boolean' },
    canUseWebSearch: { type: 'boolean' },
    canUseFileUpload: { type: 'boolean' },
    canUseMemory: { type: 'boolean' },
    canUseRag: { type: 'boolean' },
    canUseAwcode: { type: 'boolean' },
    adminNotes: { type: 'string' },
    source: { type: 'string', enum: ['user', 'group', 'default'], description: 'Where these permissions came from' },
  },
} as const;

const userWithPermissionsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string', nullable: true },
    is_admin: { type: 'boolean' },
    groups: { type: 'array', items: { type: 'string' } },
    flowise_enabled: { type: 'boolean' },
    last_login_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    hasCustomPermissions: { type: 'boolean' },
    customPermissions: { ...userPermissionsResponseSchema, nullable: true },
  },
} as const;

const groupPermissionsSchema = {
  type: 'object',
  properties: {
    azureGroupId: { type: 'string', description: 'Azure AD group ID' },
    azureGroupName: { type: 'string', description: 'Human-readable group name' },
    templateId: { type: 'string', description: 'Optional permission template ID' },
    priority: { type: 'integer', description: 'Priority (lower = higher precedence)' },
    ...permissionUpdateSchema.properties,
  },
  required: ['azureGroupId', 'azureGroupName'],
} as const;

const permissionTemplateSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    isDefault: { type: 'boolean' },
    ...permissionUpdateSchema.properties,
  },
} as const;

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    details: { type: 'string' },
  },
} as const;

export const adminUserPermissionsRoutes = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;
  const permissionsService = new UserPermissionsService(prisma, logger);

  // Helper to get admin user ID
  const getAdminUserId = (request: AdminRequest): string => {
    return request.user?.userId || request.user?.id || 'unknown';
  };

  // ==========================================
  // USER PERMISSIONS ENDPOINTS
  // ==========================================

  /**
   * GET /api/admin/user-management
   * List all users with their permissions status
   */
  fastify.get('/api/admin/user-management', {
    preHandler: adminGuard,
    schema: {
      description: 'List all users with their permission status. Returns both user info and any custom permissions configured.',
      tags: ['Admin', 'User Management'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            users: { type: 'array', items: userWithPermissionsSchema },
            total: { type: 'integer', description: 'Total number of users' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          is_admin: true,
          groups: true,
          flowise_enabled: true,
          last_login_at: true,
          created_at: true,
          // Scope enforcement fields
          is_locked: true,
          scope_warning_count: true,
          locked_at: true,
          locked_reason: true,
        },
        orderBy: { created_at: 'desc' },
      });

      // Get custom permissions for all users
      const customPerms = await permissionsService.getAllUserPermissions();
      const customPermsMap = new Map(customPerms.map((p) => [p.userId, p]));

      const usersWithPermissions = users.map((user) => ({
        ...user,
        hasCustomPermissions: customPermsMap.has(user.id),
        customPermissions: customPermsMap.get(user.id) || null,
      }));

      return reply.send({
        users: usersWithPermissions,
        total: users.length,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to list users');
      return reply.status(500).send({
        error: 'Failed to list users',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/admin/user-management/:userId/permissions
   * Get resolved permissions for a specific user
   */
  fastify.get('/api/admin/user-management/:userId/permissions', {
    preHandler: adminGuard,
    schema: {
      description: 'Get the resolved permissions for a specific user. Permissions are resolved in order: user-specific → group → default.',
      tags: ['Admin', 'User Management'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string', nullable: true },
                groups: { type: 'array', items: { type: 'string' } },
                isAdmin: { type: 'boolean' },
              },
            },
            permissions: userPermissionsResponseSchema,
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;

      // Get user info including groups
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          groups: true,
          is_admin: true,
        },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const permissions = await permissionsService.getUserPermissions(userId, user.groups);

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          groups: user.groups,
          isAdmin: user.is_admin,
        },
        permissions,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to get user permissions');
      return reply.status(500).send({
        error: 'Failed to get user permissions',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PUT /api/admin/user-management/:userId/permissions
   * Set user-specific permissions
   */
  fastify.put('/api/admin/user-management/:userId/permissions', {
    preHandler: adminGuard,
    schema: {
      description: 'Set or update user-specific permissions. These override any group or default permissions.',
      tags: ['Admin', 'User Management'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
        required: ['userId'],
      },
      body: permissionUpdateSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            permissions: userPermissionsResponseSchema,
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string }; Body: PermissionUpdate }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;
      const update = request.body as PermissionUpdate;
      const adminUserId = getAdminUserId(request);

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const permissions = await permissionsService.setUserPermissions(userId, update, adminUserId);

      // Also update flowise_enabled in User table for backwards compatibility
      if (update.flowiseEnabled !== undefined) {
        await prisma.user.update({
          where: { id: userId },
          data: { flowise_enabled: update.flowiseEnabled },
        });
      }

      logger.info({
        adminUserId,
        targetUserId: userId,
        targetEmail: user.email,
      }, '[ADMIN] User permissions updated');

      return reply.send({
        message: 'User permissions updated successfully',
        permissions,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to update user permissions');
      return reply.status(500).send({
        error: 'Failed to update user permissions',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/admin/user-management/:userId/permissions
   * Delete user-specific permissions (reverts to group/default)
   */
  fastify.delete('/api/admin/user-management/:userId/permissions', {
    preHandler: adminGuard,
    schema: {
      description: 'Delete user-specific permissions. User will revert to group or default permissions.',
      tags: ['Admin', 'User Management'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;

      await permissionsService.deleteUserPermissions(userId);

      logger.info({
        adminUserId: getAdminUserId(request),
        targetUserId: userId,
      }, '[ADMIN] User permissions deleted');

      return reply.send({
        message: 'User permissions deleted, now using group/default permissions',
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to delete user permissions');
      return reply.status(500).send({
        error: 'Failed to delete user permissions',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================
  // GROUP PERMISSIONS ENDPOINTS
  // ==========================================

  /**
   * GET /api/admin/groups/permissions
   * List all group permissions
   */
  fastify.get('/api/admin/groups/permissions', {
    preHandler: adminGuard,
    schema: {
      description: 'List all Azure AD group permission configurations. Groups with lower priority numbers take precedence.',
      tags: ['Admin', 'Group Permissions'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            groups: { type: 'array', items: groupPermissionsSchema },
            total: { type: 'integer' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      const groups = await permissionsService.getAllGroupPermissions();

      return reply.send({
        groups,
        total: groups.length,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to list group permissions');
      return reply.status(500).send({
        error: 'Failed to list group permissions',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PUT /api/admin/groups/:groupId/permissions
   * Set or update group permissions
   */
  fastify.put('/api/admin/groups/:groupId/permissions', {
    preHandler: adminGuard,
    schema: {
      description: 'Set or update permissions for an Azure AD group. All users in this group will inherit these permissions unless they have user-specific overrides.',
      tags: ['Admin', 'Group Permissions'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: 'Azure AD group ID' },
        },
        required: ['groupId'],
      },
      body: groupPermissionsSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{
      Params: { groupId: string };
      Body: GroupPermissionUpdate;
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { groupId } = request.params;
      const update = request.body as GroupPermissionUpdate;
      const adminUserId = getAdminUserId(request);

      // Ensure groupId in URL matches body
      if (update.azureGroupId && update.azureGroupId !== groupId) {
        return reply.status(400).send({
          error: 'Group ID in URL must match body',
        });
      }

      update.azureGroupId = groupId;

      await permissionsService.setGroupPermissions(update, adminUserId);

      logger.info({
        adminUserId,
        groupId,
        groupName: update.azureGroupName,
      }, '[ADMIN] Group permissions updated');

      return reply.send({
        message: 'Group permissions updated successfully',
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to update group permissions');
      return reply.status(500).send({
        error: 'Failed to update group permissions',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/admin/groups/:groupId/permissions
   * Delete group permissions
   */
  fastify.delete('/api/admin/groups/:groupId/permissions', {
    preHandler: adminGuard,
    schema: {
      description: 'Delete permissions for an Azure AD group.',
      tags: ['Admin', 'Group Permissions'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: 'Azure AD group ID' },
        },
        required: ['groupId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { groupId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { groupId } = request.params;

      await permissionsService.deleteGroupPermissions(groupId);

      logger.info({
        adminUserId: getAdminUserId(request),
        groupId,
      }, '[ADMIN] Group permissions deleted');

      return reply.send({
        message: 'Group permissions deleted',
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to delete group permissions');
      return reply.status(500).send({
        error: 'Failed to delete group permissions',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================
  // PERMISSION TEMPLATES ENDPOINTS
  // ==========================================

  /**
   * GET /api/admin/permissions/templates
   * List all permission templates
   */
  fastify.get('/api/admin/permissions/templates', {
    preHandler: adminGuard,
    schema: {
      description: 'List all permission templates. Templates provide reusable permission configurations.',
      tags: ['Admin', 'Permission Templates'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            templates: { type: 'array', items: permissionTemplateSchema },
            total: { type: 'integer' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      const templates = await permissionsService.getAllTemplates();

      return reply.send({
        templates,
        total: templates.length,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to list permission templates');
      return reply.status(500).send({
        error: 'Failed to list permission templates',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PUT /api/admin/permissions/templates/:name
   * Create or update a permission template
   */
  fastify.put('/api/admin/permissions/templates/:name', {
    preHandler: adminGuard,
    schema: {
      description: 'Create or update a permission template by name.',
      tags: ['Admin', 'Permission Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template name (used as unique identifier)' },
        },
        required: ['name'],
      },
      body: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          isDefault: { type: 'boolean' },
          ...permissionUpdateSchema.properties,
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            template: permissionTemplateSchema,
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{
      Params: { name: string };
      Body: Omit<PermissionTemplate, 'id' | 'name'>;
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { name } = request.params;
      const templateBody = request.body as any;
      const adminUserId = getAdminUserId(request);

      const template = {
        ...templateBody,
        name,
      };

      const result = await permissionsService.upsertPermissionTemplate(template, adminUserId);

      logger.info({
        adminUserId,
        templateName: name,
      }, '[ADMIN] Permission template updated');

      return reply.send({
        message: 'Permission template updated successfully',
        template: result,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to update permission template');
      return reply.status(500).send({
        error: 'Failed to update permission template',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================
  // UTILITY ENDPOINTS
  // ==========================================

  /**
   * GET /api/admin/permissions/check
   * Check if a user can access specific resources
   */
  fastify.get('/api/admin/permissions/check', {
    preHandler: adminGuard,
    schema: {
      description: 'Check if a specific user can access resources. Useful for debugging permission issues.',
      tags: ['Admin', 'Permissions Utility'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID to check' },
          llmProvider: { type: 'string', description: 'LLM provider ID to check access for' },
          mcpServer: { type: 'string', description: 'MCP server ID to check access for' },
          flowise: { type: 'string', enum: ['true', 'false'], description: 'Check Flowise access' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            canAccessLlmProvider: { type: 'boolean' },
            llmProvider: { type: 'string' },
            canAccessMcpServer: { type: 'boolean' },
            mcpServer: { type: 'string' },
            canAccessFlowise: { type: 'boolean' },
          },
        },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{
      Querystring: {
        userId: string;
        llmProvider?: string;
        mcpServer?: string;
        flowise?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId, llmProvider, mcpServer, flowise } = request.query;

      if (!userId) {
        return reply.status(400).send({ error: 'userId is required' });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { groups: true },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const results: any = { userId };

      if (llmProvider) {
        results.canAccessLlmProvider = await permissionsService.canAccessLlmProvider(
          userId,
          llmProvider,
          user.groups
        );
        results.llmProvider = llmProvider;
      }

      if (mcpServer) {
        results.canAccessMcpServer = await permissionsService.canAccessMcpServer(
          userId,
          mcpServer,
          user.groups
        );
        results.mcpServer = mcpServer;
      }

      if (flowise === 'true') {
        results.canAccessFlowise = await permissionsService.canAccessFlowise(userId, user.groups);
      }

      return reply.send(results);
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to check permissions');
      return reply.status(500).send({
        error: 'Failed to check permissions',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/admin/permissions/cache/clear
   * Clear the permissions cache
   */
  fastify.post('/api/admin/permissions/cache/clear', {
    preHandler: adminGuard,
    schema: {
      description: 'Clear the in-memory permissions cache. Use after making bulk permission changes.',
      tags: ['Admin', 'Permissions Utility'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      permissionsService.clearCache();

      logger.info({
        adminUserId: getAdminUserId(request),
      }, '[ADMIN] Permissions cache cleared');

      return reply.send({
        message: 'Permissions cache cleared',
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to clear cache');
      return reply.status(500).send({
        error: 'Failed to clear cache',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/admin/permissions/available-llms
   * Get list of available LLM providers for permission assignment
   */
  fastify.get('/api/admin/permissions/available-llms', {
    preHandler: adminGuard,
    schema: {
      description: 'Get list of available LLM providers that can be assigned in permissions.',
      tags: ['Admin', 'Permissions Utility'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            providers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  display_name: { type: 'string' },
                  provider_type: { type: 'string' },
                },
              },
            },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      const providers = await prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null },
        select: {
          id: true,
          name: true,
          display_name: true,
          provider_type: true,
        },
        orderBy: { display_name: 'asc' },
      });

      return reply.send({ providers });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to get available LLMs');
      return reply.status(500).send({
        error: 'Failed to get available LLMs',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/admin/permissions/available-mcps
   * Get list of available MCP servers for permission assignment
   */
  fastify.get('/api/admin/permissions/available-mcps', {
    preHandler: adminGuard,
    schema: {
      description: 'Get list of available MCP servers that can be assigned in permissions.',
      tags: ['Admin', 'Permissions Utility'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            servers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      const servers = await prisma.mCPServerConfig.findMany({
        where: { enabled: true },
        select: {
          id: true,
          name: true,
          description: true,
        },
        orderBy: { name: 'asc' },
      });

      return reply.send({ servers });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to get available MCPs');
      return reply.status(500).send({
        error: 'Failed to get available MCPs',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================
  // SCOPE ENFORCEMENT & LOCKOUT ENDPOINTS
  // ==========================================

  /**
   * GET /api/admin/user-management/:userId/scope-status
   * Get user's scope enforcement status (warnings, lockout)
   */
  fastify.get('/api/admin/user-management/:userId/scope-status', {
    preHandler: adminGuard,
    schema: {
      description: 'Get user scope enforcement status including warning count and lockout status.',
      tags: ['Admin', 'User Management', 'Scope Enforcement'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            warningCount: { type: 'integer', description: 'Number of scope violation warnings (0-3)' },
            isLocked: { type: 'boolean', description: 'Whether account is locked' },
            lockedAt: { type: 'string', format: 'date-time', nullable: true },
            lockedReason: { type: 'string', nullable: true },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;

      const status = await getUserScopeStatus(userId);

      if (!status) {
        return reply.status(404).send({ error: 'User not found' });
      }

      return reply.send(status);
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to get user scope status');
      return reply.status(500).send({
        error: 'Failed to get user scope status',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/admin/user-management/:userId/unlock
   * Unlock a user account that was locked due to scope violations
   */
  fastify.post('/api/admin/user-management/:userId/unlock', {
    preHandler: adminGuard,
    schema: {
      description: 'Unlock a user account that was locked due to repeated scope violations. This also resets their warning count.',
      tags: ['Admin', 'User Management', 'Scope Enforcement'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID to unlock' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            userId: { type: 'string' },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;
      const adminUserId = getAdminUserId(request);

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const success = await unlockUserAccount(userId);

      if (!success) {
        return reply.status(500).send({
          error: 'Failed to unlock user account',
        });
      }

      logger.info({
        adminUserId,
        targetUserId: userId,
        targetEmail: user.email,
      }, '[ADMIN] User account unlocked');

      return reply.send({
        message: `Account unlocked for ${user.email}. Warning count has been reset.`,
        userId,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to unlock user');
      return reply.status(500).send({
        error: 'Failed to unlock user',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/admin/user-management/:userId/reset-warnings
   * Reset a user's scope violation warning count (without unlocking)
   */
  fastify.post('/api/admin/user-management/:userId/reset-warnings', {
    preHandler: adminGuard,
    schema: {
      description: 'Reset a user\'s scope violation warning count without unlocking their account.',
      tags: ['Admin', 'User Management', 'Scope Enforcement'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID to reset warnings for' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            userId: { type: 'string' },
          },
        },
        404: { type: 'object', properties: { error: { type: 'string' } } },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;
      const adminUserId = getAdminUserId(request);

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const success = await resetUserWarnings(userId);

      if (!success) {
        return reply.status(500).send({
          error: 'Failed to reset user warnings',
        });
      }

      logger.info({
        adminUserId,
        targetUserId: userId,
        targetEmail: user.email,
      }, '[ADMIN] User warnings reset');

      return reply.send({
        message: `Warning count reset for ${user.email}.`,
        userId,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to reset user warnings');
      return reply.status(500).send({
        error: 'Failed to reset user warnings',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/admin/user-management/locked
   * List all locked users
   */
  fastify.get('/api/admin/user-management/locked', {
    preHandler: adminGuard,
    schema: {
      description: 'List all users who are currently locked due to scope violations.',
      tags: ['Admin', 'User Management', 'Scope Enforcement'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            users: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string', nullable: true },
                  warningCount: { type: 'integer' },
                  lockedAt: { type: 'string', format: 'date-time', nullable: true },
                  lockedReason: { type: 'string', nullable: true },
                },
              },
            },
            total: { type: 'integer' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      const lockedUsers = await prisma.user.findMany({
        where: { is_locked: true },
        select: {
          id: true,
          email: true,
          name: true,
          scope_warning_count: true,
          locked_at: true,
          locked_reason: true,
        },
        orderBy: { locked_at: 'desc' },
      });

      return reply.send({
        users: lockedUsers.map(u => ({
          id: u.id,
          email: u.email,
          name: u.name,
          warningCount: u.scope_warning_count,
          lockedAt: u.locked_at,
          lockedReason: u.locked_reason,
        })),
        total: lockedUsers.length,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to list locked users');
      return reply.status(500).send({
        error: 'Failed to list locked users',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================
  // INTELLIGENCE SLIDER ENDPOINTS
  // ==========================================

  const sliderService = new SliderService(prisma, logger);

  /**
   * GET /api/admin/settings/slider
   * Get global intelligence slider value
   */
  fastify.get('/api/admin/settings/slider', {
    preHandler: adminGuard,
    schema: {
      description: 'Get the global intelligence slider value (0-100). Controls cost/quality tradeoff for model routing.',
      tags: ['Admin', 'Settings'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            value: { type: 'integer', minimum: 0, maximum: 100, nullable: true },
            setBy: { type: 'string', nullable: true },
            setAt: { type: 'string', format: 'date-time', nullable: true },
            isDefault: { type: 'boolean' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request: AdminRequest, reply: FastifyReply) => {
    try {
      const sliderData = await sliderService.getGlobalSliderWithMeta();

      if (sliderData) {
        return reply.send({
          value: sliderData.value,
          setBy: sliderData.setBy,
          setAt: sliderData.setAt,
          isDefault: false,
        });
      }

      return reply.send({
        value: 50,
        setBy: null,
        setAt: null,
        isDefault: true,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to get global slider');
      return reply.status(500).send({
        error: 'Failed to get global slider',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PATCH /api/admin/settings/slider
   * Set global intelligence slider value
   */
  fastify.patch('/api/admin/settings/slider', {
    preHandler: adminGuard,
    schema: {
      description: 'Set the global intelligence slider value (0-100). Controls cost/quality tradeoff for all users.',
      tags: ['Admin', 'Settings'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          value: { type: 'integer', minimum: 0, maximum: 100, description: 'Slider value (0=cheapest, 100=best quality)' },
        },
        required: ['value'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            value: { type: 'integer' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Body: { value: number } }>,
    reply: FastifyReply
  ) => {
    try {
      const { value } = request.body;
      const adminUserId = getAdminUserId(request);

      await sliderService.setGlobalSlider(value, adminUserId);

      logger.info({ adminUserId, value }, '[ADMIN] Global slider updated');

      return reply.send({
        message: 'Global slider updated successfully',
        value,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to set global slider');
      return reply.status(500).send({
        error: 'Failed to set global slider',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/admin/users/:userId/slider
   * Get user-specific slider value
   */
  fastify.get('/api/admin/users/:userId/slider', {
    preHandler: adminGuard,
    schema: {
      description: 'Get a user\'s intelligence slider value and its source (user-specific, global, or default).',
      tags: ['Admin', 'User Management'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            value: { type: 'integer', minimum: 0, maximum: 100 },
            source: { type: 'string', enum: ['user', 'global', 'default'] },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;
      const sliderData = await sliderService.getUserSliderValue(userId);

      return reply.send({
        userId,
        value: sliderData.value,
        source: sliderData.source,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to get user slider');
      return reply.status(500).send({
        error: 'Failed to get user slider',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PATCH /api/admin/users/:userId/slider
   * Set user-specific slider value
   */
  fastify.patch('/api/admin/users/:userId/slider', {
    preHandler: adminGuard,
    schema: {
      description: 'Set a user-specific intelligence slider value. This overrides the global slider for this user.',
      tags: ['Admin', 'User Management'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
        },
        required: ['userId'],
      },
      body: {
        type: 'object',
        properties: {
          value: { type: 'integer', minimum: 0, maximum: 100, description: 'Slider value (0=cheapest, 100=best quality)' },
        },
        required: ['value'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            userId: { type: 'string' },
            value: { type: 'integer' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string }; Body: { value: number } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;
      const { value } = request.body;
      const adminUserId = getAdminUserId(request);

      await sliderService.setUserSlider(userId, value, adminUserId);

      logger.info({ adminUserId, userId, value }, '[ADMIN] User slider updated');

      return reply.send({
        message: 'User slider updated successfully',
        userId,
        value,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to set user slider');
      return reply.status(500).send({
        error: 'Failed to set user slider',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/admin/users/:userId/slider
   * Clear user-specific slider (revert to global/default)
   */
  fastify.delete('/api/admin/users/:userId/slider', {
    preHandler: adminGuard,
    schema: {
      description: 'Clear a user-specific slider, reverting them to use the global slider or default.',
      tags: ['Admin', 'User Management'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            userId: { type: 'string' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (
    request: AdminRequest & FastifyRequest<{ Params: { userId: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { userId } = request.params;
      const adminUserId = getAdminUserId(request);

      await sliderService.clearUserSlider(userId, adminUserId);

      logger.info({ adminUserId, userId }, '[ADMIN] User slider cleared');

      return reply.send({
        message: 'User slider cleared successfully',
        userId,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to clear user slider');
      return reply.status(500).send({
        error: 'Failed to clear user slider',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ==========================================
  // BUDGET ENDPOINTS
  // ==========================================

  /**
   * GET /api/admin/user-permissions/:userId/budget
   * Get user's budget status including spending and limits
   */
  fastify.get<{
    Params: { userId: string };
  }>('/user-permissions/:userId/budget', {
    preHandler: [adminGuard],
    schema: {
      tags: ['admin-user-permissions'],
      summary: 'Get user budget status',
      description: 'Get user budget status including current spending, limits, and auto-adjustment settings',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            budgetDollars: { type: 'number', nullable: true },
            spentDollars: { type: 'number' },
            remainingDollars: { type: 'number', nullable: true },
            percentUsed: { type: 'number', nullable: true },
            isOverBudget: { type: 'boolean' },
            isApproachingLimit: { type: 'boolean' },
            warningThreshold: { type: 'integer' },
            hardLimit: { type: 'boolean' },
            autoAdjustEnabled: { type: 'boolean' },
            currentSlider: { type: 'integer', nullable: true },
            originalSlider: { type: 'integer', nullable: true },
            wasAutoAdjusted: { type: 'boolean' },
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { userId } = request.params;

      // Import budget service dynamically to avoid circular deps
      const { getUserBudgetService } = await import('../services/UserBudgetService.js');
      const budgetService = getUserBudgetService(prisma);

      const status = await budgetService.getBudgetStatus(userId);

      return reply.send({
        userId: status.userId,
        budgetDollars: status.budgetCents !== null ? status.budgetCents / 100 : null,
        spentDollars: status.spentCents / 100,
        remainingDollars: status.remainingCents !== null ? status.remainingCents / 100 : null,
        percentUsed: status.percentUsed,
        isOverBudget: status.isOverBudget,
        isApproachingLimit: status.isApproachingLimit,
        warningThreshold: status.warningThreshold,
        hardLimit: status.hardLimit,
        autoAdjustEnabled: status.autoAdjustEnabled,
        currentSlider: status.currentSlider,
        originalSlider: status.originalSlider,
        wasAutoAdjusted: status.wasAutoAdjusted,
        periodStart: status.periodStart.toISOString(),
        periodEnd: status.periodEnd.toISOString(),
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to get user budget status');
      return reply.status(500).send({
        error: 'Failed to get user budget status',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * PUT /api/admin/user-permissions/:userId/budget
   * Set user's budget
   */
  fastify.put<{
    Params: { userId: string };
    Body: {
      budgetDollars: number | null;
      autoAdjust?: boolean;
      warningThreshold?: number;
      hardLimit?: boolean;
    };
  }>('/user-permissions/:userId/budget', {
    preHandler: [adminGuard],
    schema: {
      tags: ['admin-user-permissions'],
      summary: 'Set user budget',
      description: 'Set user monthly budget with auto-adjustment settings',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
        required: ['userId'],
      },
      body: {
        type: 'object',
        properties: {
          budgetDollars: { type: 'number', nullable: true, description: 'Monthly budget in dollars (null = unlimited)' },
          autoAdjust: { type: 'boolean', description: 'Auto-adjust slider when approaching budget' },
          warningThreshold: { type: 'integer', minimum: 1, maximum: 100, description: 'Percentage to start warning (1-100)' },
          hardLimit: { type: 'boolean', description: 'Block requests when budget is hit' },
        },
        required: ['budgetDollars'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            userId: { type: 'string' },
            budgetDollars: { type: 'number', nullable: true },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { userId } = request.params;
      const { budgetDollars, autoAdjust, warningThreshold, hardLimit } = request.body;
      const adminUserId = getAdminUserId(request as AdminRequest);

      // Import budget service dynamically
      const { getUserBudgetService } = await import('../services/UserBudgetService.js');
      const budgetService = getUserBudgetService(prisma);

      await budgetService.setBudget(userId, budgetDollars, {
        autoAdjust,
        warningThreshold,
        hardLimit,
      });

      logger.info({
        adminUserId,
        userId,
        budgetDollars,
        autoAdjust,
        warningThreshold,
        hardLimit,
      }, '[ADMIN] Set user budget');

      return reply.send({
        message: 'Budget set successfully',
        userId,
        budgetDollars,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to set user budget');
      return reply.status(500).send({
        error: 'Failed to set user budget',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/admin/user-permissions/:userId/budget/reset
   * Reset user's budget period (e.g., at start of new month)
   */
  fastify.post<{
    Params: { userId: string };
  }>('/user-permissions/:userId/budget/reset', {
    preHandler: [adminGuard],
    schema: {
      tags: ['admin-user-permissions'],
      summary: 'Reset user budget period',
      description: 'Reset user budget period and restore original slider if it was auto-adjusted',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
        required: ['userId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            userId: { type: 'string' },
          },
        },
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { userId } = request.params;
      const adminUserId = getAdminUserId(request as AdminRequest);

      const { getUserBudgetService } = await import('../services/UserBudgetService.js');
      const budgetService = getUserBudgetService(prisma);

      await budgetService.resetBudgetPeriod(userId);

      logger.info({ adminUserId, userId }, '[ADMIN] Reset user budget period');

      return reply.send({
        message: 'Budget period reset successfully',
        userId,
      });
    } catch (error) {
      logger.error({ error }, '[ADMIN] Failed to reset budget period');
      return reply.status(500).send({
        error: 'Failed to reset budget period',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

export default adminUserPermissionsRoutes;
