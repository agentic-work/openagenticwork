/**
 * Health Check and Monitoring Routes
 * 
 * Provides system health checks, database connectivity tests, and
 * comprehensive monitoring endpoints for AI models and services.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';
import { RAGHealthCheckService } from '../services/RAGHealthCheck.js';
import { MCPHealthCheckService } from '../services/MCPHealthCheck.js';
import { VectorBackupService } from '../services/VectorBackupService.js';
// TODO: AzureOpenAIConfigService - Direct Azure OpenAI backup controller
// import { AzureOpenAIConfigService } from '../services/azureOpenAIConfigService.js';
const healthRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // Use fastify.log directly without casting
  const logger = fastify.log;

  // Initialize health check services
  const ragHealthCheck = new RAGHealthCheckService(logger as Logger);

  // Model health check is initialized in server.ts with ProviderManager
  // Use global.modelHealthCheck instead of creating a new instance

  const mcpHealthCheck = new MCPHealthCheckService(logger as Logger);
  const vectorBackupService = new VectorBackupService(logger as Logger);
  // TODO: Direct Azure OpenAI backup controller (disabled for now)
  // const azureConfigService = new AzureOpenAIConfigService('/app/data', logger, prisma);

  /**
   * GET /api/health - Basic health check
   */
  fastify.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Basic health check',
      description: 'Quick health status check with database connectivity test',
      response: {
        200: { type: 'object', additionalProperties: true },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string', const: 'unhealthy' },
            timestamp: { type: 'string', format: 'date-time' },
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      // Simple database connectivity test using Prisma
      const userCount = await prisma.user.count();

      const response = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          status: 'connected',
          method: 'prisma'
        },
        users: {
          count: userCount
        }
      };

      return reply.code(200).send(response);
    } catch (error) {
      logger.error({ error }, 'Health check failed');

      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Database connection failed'
      });
    }
  });

  /**
   * GET /api/health/detailed - Detailed health with database statistics
   */
  fastify.get('/health/detailed', async (request, reply) => {
    try {
      // Test various queries using Prisma
      const tests = [];
      
      // Test 1: Session count
      try {
        const sessionCount = await prisma.chatSession.count();
        tests.push({
          test: 'session_count',
          result: sessionCount,
          success: true
        });
      } catch (error) {
        tests.push({
          test: 'session_count', 
          success: false,
          error: error.message
        });
      }
      
      // Test 2: Recent messages
      try {
        const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentMessageCount = await prisma.chatMessage.count({
          where: { created_at: { gte: date } }
        });
        tests.push({
          test: 'recent_messages',
          result: recentMessageCount,
          success: true
        });
      } catch (error) {
        tests.push({
          test: 'recent_messages',
          success: false,
          error: error.message
        });
      }

      return reply.send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          status: 'connected',
          method: 'prisma'
        },
        tests,
        environment: {
          node_env: process.env.NODE_ENV,
          database_url: process.env.DATABASE_URL ? '[SET]' : '[NOT SET]'
        }
      });
    } catch (error) {
      logger.error({ error }, 'Detailed health check failed');
      return reply.code(503).send({ 
        status: 'unhealthy',
        error: error.message 
      });
    }
  });

  /**
   * GET /api/health/comprehensive - Comprehensive health including AI models and RAG
   */
  fastify.get('/health/comprehensive', {
    schema: {
      tags: ['Health'],
      summary: 'Comprehensive system health check',
      description: 'Full system health check including database, AI models, embeddings, MCP orchestrator, and vector storage',
      response: {
        200: { type: 'object', additionalProperties: true },
        503: { type: 'object', additionalProperties: true }
      }
    }
  }, async (request, reply) => {
    const startTime = Date.now();
    const results = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      overall_healthy: true,
      checks: {
        database: { healthy: false, details: {} },
        chat_model: { healthy: false, details: {} },
        embedding_model: { healthy: false, details: {} },
        mcp_orchestrator: { healthy: false, details: {} },
        vector_backup: { healthy: false, details: {} }
      }
    };

    // Database check
    try {
      const userCount = await prisma.user.count();
      results.checks.database = {
        healthy: true,
        details: {
          status: 'connected',
          method: 'prisma',
          user_count: userCount
        }
      };
    } catch (error) {
      results.checks.database = {
        healthy: false,
        details: {
          error: error.message,
          status: 'disconnected'
        }
      };
      results.overall_healthy = false;
    }

    // Chat model health check
    // IMPORTANT: Use forceRefresh=true to ensure fresh UUID validation
    // Without this, cached responses may fail UUID check causing BOT_HEALTHCHECK failures
    try {
      const modelHealth = await global.modelHealthCheck?.checkModelHealth(true);
      results.checks.chat_model = {
        healthy: modelHealth?.healthy || false,
        details: {
          model: modelHealth?.model,
          response_time: modelHealth?.responseTime,
          error: modelHealth?.error,
          test_uuid: modelHealth?.testUuid,
          fresh_check: true  // Indicates this was not from cache
        }
      };
      if (!modelHealth?.healthy) {
        results.overall_healthy = false;
      }
    } catch (error) {
      results.checks.chat_model = {
        healthy: false,
        details: {
          error: error.message,
          status: 'check_failed'
        }
      };
      results.overall_healthy = false;
    }

    // RAG/Embedding model health check
    try {
      const ragHealth = await ragHealthCheck.checkRAGHealth();
      results.checks.embedding_model = {
        healthy: ragHealth.healthy,
        details: {
          model: ragHealth.embeddingModel,
          response_time: ragHealth.responseTime,
          embedding_dimension: ragHealth.embeddingDimension,
          error: ragHealth.error,
          test_uuid: ragHealth.testUuid
        }
      };
      if (!ragHealth.healthy) {
        results.overall_healthy = false;
      }
    } catch (error) {
      results.checks.embedding_model = {
        healthy: false,
        details: {
          error: error.message,
          status: 'check_failed'
        }
      };
      results.overall_healthy = false;
    }

    // MCP Orchestrator health check
    try {
      const mcpHealth = await mcpHealthCheck.checkMCPHealth();
      results.checks.mcp_orchestrator = {
        healthy: mcpHealth.healthy,
        details: {
          orchestrator_url: mcpHealth.orchestratorUrl,
          servers: mcpHealth.servers,
          tools: mcpHealth.tools,
          response_time: mcpHealth.responseTime,
          error: mcpHealth.error
        }
      };
      if (!mcpHealth.healthy) {
        results.overall_healthy = false;
      }
    } catch (error) {
      results.checks.mcp_orchestrator = {
        healthy: false,
        details: {
          error: error.message,
          status: 'check_failed'
        }
      };
      results.overall_healthy = false;
    }

    // Vector Backup Service health check
    try {
      const backupHealth = await vectorBackupService.healthCheck();
      results.checks.vector_backup = {
        healthy: backupHealth.healthy,
        details: backupHealth.details
      };
      if (!backupHealth.healthy) {
        results.overall_healthy = false;
      }
    } catch (error) {
      results.checks.vector_backup = {
        healthy: false,
        details: {
          error: error.message,
          status: 'check_failed',
          backupDir: '/app/data/backups',
          backupDirExists: false,
          activeBackups: 0,
          totalBackups: 0
        }
      };
      results.overall_healthy = false;
    }

    // TODO: Azure OpenAI Config Service health check - Direct Azure backup
    // Disabled for now - only needed if we decide to use direct Azure calls
    /*
    try {
      const azureHealth = await azureConfigService.healthCheck();
      const mockTenantConfig = await azureConfigService.getTenantConfig('default');
      results.checks.azure_openai_config = {
        healthy: azureHealth,
        details: {
          service_active: azureHealth,
          model_capabilities: azureConfigService.getModelCapabilities('gpt-4') ? 'loaded' : 'not_loaded',
          tenant_config: mockTenantConfig ? 'available' : 'unavailable',
          deployment_count: mockTenantConfig?.deployments.length || 0,
          default_model: mockTenantConfig?.defaultModel || 'none'
        }
      };
      if (!azureHealth) {
        results.overall_healthy = false;
      }
    } catch (error) {
      results.checks.azure_openai_config = {
        healthy: false,
        details: {
          error: error.message,
          status: 'check_failed'
        }
      };
      results.overall_healthy = false;
    }
    */

    results.status = results.overall_healthy ? 'healthy' : 'unhealthy';
    const statusCode = results.overall_healthy ? 200 : 503;
    
    logger.info({
      overall_healthy: results.overall_healthy,
      response_time: Date.now() - startTime,
      database: results.checks.database.healthy,
      chat_model: results.checks.chat_model.healthy,
      embedding_model: results.checks.embedding_model.healthy,
      mcp_orchestrator: results.checks.mcp_orchestrator.healthy,
      vector_backup: results.checks.vector_backup.healthy
    }, 'Comprehensive health check completed');

    return reply.code(statusCode).send(results);
  });
};

export default healthRoutes;