/**
 * Multi-Model Configuration API Routes
 *
 * Admin routes for managing multi-model orchestration configuration
 * Requires admin authentication
 *
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

import { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { ModelRole, getDefaultMultiModelConfig, MultiModelConfig } from '../../services/multi-model/index.js';

interface MultiModelRoutesOptions {
  // Options can be extended as needed
}

const multiModelRoutes: FastifyPluginAsync<MultiModelRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;

  /**
   * GET /api/admin/multi-model/config
   * Get current multi-model configuration (from environment and database)
   * Returns the full config object in the format the UI expects
   */
  fastify.get('/multi-model/config', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      // Get feature flag from environment
      const featureFlagEnabled = process.env.ENABLE_MULTI_MODEL === 'true';

      // Get runtime config from database
      const runtimeConfigRecord = await prisma.systemConfiguration.findFirst({
        where: { key: 'multi_model_config' }
      });

      // Get default config as base
      const defaultConfig = getDefaultMultiModelConfig();
      
      // Merge runtime config over defaults
      const runtimeConfig = runtimeConfigRecord?.value as Partial<MultiModelConfig> | null;
      
      // Build the complete config object
      const config: MultiModelConfig = {
        enabled: runtimeConfig?.enabled ?? featureFlagEnabled,
        source: runtimeConfigRecord ? 'runtime' : (featureFlagEnabled ? 'feature_flag' : 'default'),
        roles: {
          [ModelRole.REASONING]: {
            ...defaultConfig.roles[ModelRole.REASONING],
            ...(runtimeConfig?.roles?.[ModelRole.REASONING] || {})
          },
          [ModelRole.TOOL_EXECUTION]: {
            ...defaultConfig.roles[ModelRole.TOOL_EXECUTION],
            ...(runtimeConfig?.roles?.[ModelRole.TOOL_EXECUTION] || {})
          },
          [ModelRole.SYNTHESIS]: {
            ...defaultConfig.roles[ModelRole.SYNTHESIS],
            ...(runtimeConfig?.roles?.[ModelRole.SYNTHESIS] || {})
          },
          [ModelRole.FALLBACK]: {
            ...defaultConfig.roles[ModelRole.FALLBACK],
            ...(runtimeConfig?.roles?.[ModelRole.FALLBACK] || {})
          }
        },
        routing: {
          ...defaultConfig.routing,
          ...(runtimeConfig?.routing || {})
        },
        sliderOverrides: {
          ...defaultConfig.sliderOverrides,
          ...(runtimeConfig?.sliderOverrides || {})
        }
      };

      await prisma.$disconnect();

      return reply.send({
        config,
        featureFlags: {
          ENABLE_MULTI_MODEL: featureFlagEnabled,
          MULTI_MODEL_COMPLEXITY_THRESHOLD: process.env.MULTI_MODEL_COMPLEXITY_THRESHOLD || '60',
          MULTI_MODEL_MAX_HANDOFFS: process.env.MULTI_MODEL_MAX_HANDOFFS || '5',
          MULTI_MODEL_AUTO_FALLBACK: process.env.MULTI_MODEL_AUTO_FALLBACK || 'true',
          MULTI_MODEL_SLIDER_THRESHOLD: process.env.MULTI_MODEL_SLIDER_THRESHOLD || '70'
        },
        hasRuntimeOverride: !!runtimeConfigRecord,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get multi-model configuration');
      return reply.code(500).send({
        error: 'Failed to get configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * PUT /api/admin/multi-model/config
   * Update multi-model runtime configuration (accepts full config object)
   */
  fastify.put<{
    Body: {
      config: Partial<MultiModelConfig>;
    };
  }>('/multi-model/config', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const { config } = request.body;
      
      // Get existing config to merge with
      const existing = await prisma.systemConfiguration.findFirst({
        where: { key: 'multi_model_config' }
      });
      
      const existingConfig = existing?.value as Partial<MultiModelConfig> || {};
      
      // Deep merge the config
      const configData = {
        enabled: config.enabled ?? existingConfig.enabled,
        source: 'runtime',
        roles: {
          ...existingConfig.roles,
          ...config.roles
        },
        routing: {
          ...existingConfig.routing,
          ...config.routing
        },
        sliderOverrides: {
          ...existingConfig.sliderOverrides,
          ...config.sliderOverrides
        },
        updatedAt: new Date().toISOString(),
        updatedBy: (request as any).user?.id || 'admin'
      };

      // Convert to plain JSON for Prisma (removes TypeScript interfaces)
      const jsonValue = JSON.parse(JSON.stringify(configData));

      // Upsert the configuration
      const result = await prisma.systemConfiguration.upsert({
        where: { key: 'multi_model_config' },
        create: {
          key: 'multi_model_config',
          value: jsonValue,
          description: 'Multi-model orchestration runtime configuration'
        },
        update: {
          value: jsonValue
        }
      });

      await prisma.$disconnect();

      logger.info({ config: configData }, 'Multi-model configuration updated');

      return reply.send({
        message: 'Configuration updated successfully',
        config: result.value,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to update multi-model configuration');
      return reply.code(500).send({
        error: 'Failed to update configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/multi-model/toggle
   * Enable or disable multi-model orchestration at runtime
   */
  fastify.post<{
    Body: {
      enabled: boolean;
    };
  }>('/multi-model/toggle', async (request, reply) => {
    try {
      const { enabled } = request.body;

      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({
          error: 'Invalid request',
          message: 'enabled field must be a boolean'
        });
      }

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      // Get existing config or create new
      const existing = await prisma.systemConfiguration.findFirst({
        where: { key: 'multi_model_config' }
      });

      const configData = {
        ...(existing?.value as object || {}),
        enabled,
        toggledAt: new Date().toISOString(),
        toggledBy: (request as any).user?.id || 'admin'
      };

      await prisma.systemConfiguration.upsert({
        where: { key: 'multi_model_config' },
        create: {
          key: 'multi_model_config',
          value: configData,
          description: 'Multi-model orchestration runtime configuration'
        },
        update: {
          value: configData
        }
      });

      await prisma.$disconnect();

      logger.info({ enabled, user: (request as any).user?.email }, 'Multi-model orchestration toggled');

      return reply.send({
        message: `Multi-model orchestration ${enabled ? 'enabled' : 'disabled'}`,
        enabled,
        note: enabled && process.env.ENABLE_MULTI_MODEL !== 'true'
          ? 'Warning: ENABLE_MULTI_MODEL environment variable is not set to true. Runtime toggle may not take effect.'
          : undefined,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to toggle multi-model');
      return reply.code(500).send({
        error: 'Failed to toggle multi-model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/multi-model/roles
   * List all model role assignments
   */
  fastify.get('/multi-model/roles', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const roles = await prisma.modelRoleAssignment.findMany({
        orderBy: [
          { role: 'asc' },
          { priority: 'asc' }
        ],
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      // Get default config for comparison
      const defaultConfig = getDefaultMultiModelConfig();

      await prisma.$disconnect();

      // Group by role
      const roleGroups: Record<string, any[]> = {
        [ModelRole.REASONING]: [],
        [ModelRole.TOOL_EXECUTION]: [],
        [ModelRole.SYNTHESIS]: [],
        [ModelRole.FALLBACK]: []
      };

      for (const role of roles) {
        if (roleGroups[role.role]) {
          roleGroups[role.role].push(role);
        }
      }

      return reply.send({
        roles,
        roleGroups,
        defaults: {
          [ModelRole.REASONING]: defaultConfig.roles[ModelRole.REASONING],
          [ModelRole.TOOL_EXECUTION]: defaultConfig.roles[ModelRole.TOOL_EXECUTION],
          [ModelRole.SYNTHESIS]: defaultConfig.roles[ModelRole.SYNTHESIS],
          [ModelRole.FALLBACK]: defaultConfig.roles[ModelRole.FALLBACK]
        },
        totalRoles: roles.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to list model role assignments');
      return reply.code(500).send({
        error: 'Failed to list roles',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/multi-model/roles
   * Create or update a model role assignment
   */
  fastify.post<{
    Body: {
      role: 'reasoning' | 'tool_execution' | 'synthesis' | 'fallback';
      model: string;
      provider: string;
      priority?: number;
      enabled?: boolean;
      sliderMinPosition?: number;
      sliderMaxPosition?: number;
      costPerRequest?: number;
      temperature?: number;
      maxTokens?: number;
      thinkingBudget?: number;
      options?: Record<string, any>;
      description?: string;
    };
  }>('/multi-model/roles', async (request, reply) => {
    try {
      const {
        role,
        model,
        provider,
        priority = 0,
        enabled = true,
        sliderMinPosition = 0,
        sliderMaxPosition = 100,
        costPerRequest,
        temperature,
        maxTokens,
        thinkingBudget,
        options,
        description
      } = request.body;

      // Validate role
      const validRoles = Object.values(ModelRole);
      if (!validRoles.includes(role as ModelRole)) {
        return reply.code(400).send({
          error: 'Invalid role',
          message: `Role must be one of: ${validRoles.join(', ')}`
        });
      }

      if (!model || !provider) {
        return reply.code(400).send({
          error: 'Missing required fields',
          message: 'model and provider are required'
        });
      }

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      // Check if this role/model/provider combination already exists
      const existing = await prisma.modelRoleAssignment.findFirst({
        where: { role, model, provider }
      });

      let result;
      if (existing) {
        // Update existing
        result = await prisma.modelRoleAssignment.update({
          where: { id: existing.id },
          data: {
            priority,
            enabled,
            slider_min_position: sliderMinPosition,
            slider_max_position: sliderMaxPosition,
            cost_per_request: costPerRequest,
            temperature,
            max_tokens: maxTokens,
            thinking_budget: thinkingBudget,
            options: options || {},
            description
          }
        });
        logger.info({ roleId: result.id, role, model }, 'Model role assignment updated');
      } else {
        // Create new
        result = await prisma.modelRoleAssignment.create({
          data: {
            role,
            model,
            provider,
            priority,
            enabled,
            slider_min_position: sliderMinPosition,
            slider_max_position: sliderMaxPosition,
            cost_per_request: costPerRequest,
            temperature,
            max_tokens: maxTokens,
            thinking_budget: thinkingBudget,
            options: options || {},
            description,
            created_by: (request as any).user?.id || 'admin'
          }
        });
        logger.info({ roleId: result.id, role, model }, 'Model role assignment created');
      }

      await prisma.$disconnect();

      return reply.code(existing ? 200 : 201).send({
        message: existing ? 'Role assignment updated' : 'Role assignment created',
        roleAssignment: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to create/update role assignment');
      return reply.code(500).send({
        error: 'Failed to save role assignment',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/admin/multi-model/roles/:id
   * Delete a model role assignment
   */
  fastify.delete<{
    Params: { id: string };
  }>('/multi-model/roles/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const existing = await prisma.modelRoleAssignment.findFirst({
        where: { id }
      });

      if (!existing) {
        await prisma.$disconnect();
        return reply.code(404).send({
          error: 'Not found',
          message: 'Role assignment not found'
        });
      }

      await prisma.modelRoleAssignment.delete({
        where: { id }
      });

      await prisma.$disconnect();

      logger.info({ roleId: id, role: existing.role, model: existing.model }, 'Model role assignment deleted');

      return reply.send({
        message: 'Role assignment deleted',
        deletedId: id,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, id: request.params.id }, 'Failed to delete role assignment');
      return reply.code(500).send({
        error: 'Failed to delete role assignment',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/multi-model/metrics
   * Get multi-model orchestration metrics
   */
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      userId?: string;
      limit?: string;
    };
  }>('/multi-model/metrics', async (request, reply) => {
    try {
      const { startDate, endDate, userId, limit = '100' } = request.query;

      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      const where: any = {};

      if (startDate) {
        where.created_at = { ...where.created_at, gte: new Date(startDate) };
      }
      if (endDate) {
        where.created_at = { ...where.created_at, lte: new Date(endDate) };
      }
      if (userId) {
        where.user_id = userId;
      }

      const metrics = await prisma.multiModelMetrics.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: parseInt(limit, 10),
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          session: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });

      // Aggregate statistics
      const aggregates = await prisma.multiModelMetrics.aggregate({
        where,
        _count: true,
        _sum: {
          total_handoffs: true,
          total_input_tokens: true,
          total_output_tokens: true,
          total_thinking_tokens: true,
          total_duration_ms: true,
          total_cost: true
        },
        _avg: {
          total_handoffs: true,
          total_input_tokens: true,
          total_output_tokens: true,
          total_duration_ms: true,
          total_cost: true
        }
      });

      // Count by complexity
      const byComplexity = await prisma.multiModelMetrics.groupBy({
        by: ['complexity'],
        where,
        _count: true
      });

      // Count by success
      const bySuccess = await prisma.multiModelMetrics.groupBy({
        by: ['success'],
        where,
        _count: true
      });

      await prisma.$disconnect();

      return reply.send({
        metrics,
        aggregates: {
          totalRequests: aggregates._count,
          totalHandoffs: aggregates._sum.total_handoffs || 0,
          totalInputTokens: aggregates._sum.total_input_tokens || 0,
          totalOutputTokens: aggregates._sum.total_output_tokens || 0,
          totalThinkingTokens: aggregates._sum.total_thinking_tokens || 0,
          totalDurationMs: aggregates._sum.total_duration_ms || 0,
          totalCost: aggregates._sum.total_cost || 0,
          avgHandoffs: aggregates._avg.total_handoffs || 0,
          avgDurationMs: aggregates._avg.total_duration_ms || 0,
          avgCost: aggregates._avg.total_cost || 0
        },
        breakdown: {
          byComplexity: byComplexity.reduce((acc, item) => {
            acc[item.complexity || 'unknown'] = item._count;
            return acc;
          }, {} as Record<string, number>),
          bySuccess: {
            success: bySuccess.find(s => s.success)?._count || 0,
            failed: bySuccess.find(s => !s.success)?._count || 0
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get multi-model metrics');
      return reply.code(500).send({
        error: 'Failed to get metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/multi-model/status
   * Get current multi-model system status
   */
  fastify.get('/multi-model/status', async (request, reply) => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      // Check feature flag
      const featureFlagEnabled = process.env.ENABLE_MULTI_MODEL === 'true';

      // Get runtime config
      const runtimeConfig = await prisma.systemConfiguration.findFirst({
        where: { key: 'multi_model_config' }
      });

      // Get role assignment count
      const roleCount = await prisma.modelRoleAssignment.count({
        where: { enabled: true }
      });

      // Get recent metrics
      const recentMetrics = await prisma.multiModelMetrics.findFirst({
        orderBy: { created_at: 'desc' }
      });

      // Get last 24h stats
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const stats24h = await prisma.multiModelMetrics.aggregate({
        where: { created_at: { gte: last24h } },
        _count: true,
        _avg: {
          total_cost: true,
          total_duration_ms: true
        }
      });

      await prisma.$disconnect();

      const runtimeEnabled = (runtimeConfig?.value as any)?.enabled ?? false;
      const effectivelyEnabled = featureFlagEnabled && runtimeEnabled;

      return reply.send({
        status: effectivelyEnabled ? 'enabled' : 'disabled',
        featureFlag: featureFlagEnabled,
        runtimeToggle: runtimeEnabled,
        effectivelyEnabled,
        configuration: {
          hasRuntimeConfig: !!runtimeConfig,
          activeRoleAssignments: roleCount,
          sliderThreshold: parseInt(process.env.MULTI_MODEL_SLIDER_THRESHOLD || '70', 10),
          complexityThreshold: parseInt(process.env.MULTI_MODEL_COMPLEXITY_THRESHOLD || '60', 10),
          maxHandoffs: parseInt(process.env.MULTI_MODEL_MAX_HANDOFFS || '5', 10)
        },
        activity: {
          lastOrchestration: recentMetrics?.created_at || null,
          last24hRequests: stats24h._count || 0,
          last24hAvgCost: stats24h._avg.total_cost || 0,
          last24hAvgLatencyMs: stats24h._avg.total_duration_ms || 0
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get multi-model status');
      return reply.code(500).send({
        error: 'Failed to get status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
};

export default multiModelRoutes;
