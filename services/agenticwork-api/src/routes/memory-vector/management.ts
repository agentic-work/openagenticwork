/**
 * Vector Database Management Routes
 * 
 * Advanced vector database management including backup, optimization,
 * health monitoring, and maintenance operations for Milvus collections.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { EnhancedVectorManagementService } from '../../services/EnhancedVectorManagementService.js';

declare global {
  var enhancedVectorManagement: EnhancedVectorManagementService;
}

interface SystemHealthQuery {
  includeCollections?: boolean;
  includeAlerts?: boolean;
  timeRange?: string; // '1h', '24h', '7d', '30d'
}

interface MaintenanceRequest {
  executeBackups?: boolean;
  executeOptimizations?: boolean;
  executeCleanups?: boolean;
  maxConcurrentTasks?: number;
  dryRun?: boolean;
}

interface BackupRequest {
  collectionName: string;
  destination?: 'local' | 's3' | 'gcs' | 'azure_blob';
  retention?: number;
  compression?: boolean;
  encryption?: boolean;
  incremental?: boolean;
}

interface RestoreRequest {
  backupId: string;
  targetCollections?: Record<string, string>;
  validateIntegrity?: boolean;
  overwriteExisting?: boolean;
}

export const managementRoutes: FastifyPluginAsync = async (fastify) => {
  
  // Get comprehensive system health status
  fastify.get<{
    Querystring: SystemHealthQuery;
  }>('/health', async (request, reply) => {
    try {
      if (!global.enhancedVectorManagement) {
        return reply.code(503).send({
          error: 'Vector management service not available',
          details: 'Milvus connection required for vector management'
        });
      }

      const { includeCollections = true, includeAlerts = true } = request.query;
      
      const systemHealth = await global.enhancedVectorManagement.getSystemHealth();
      
      // Filter response based on query parameters
      const response = {
        overall: systemHealth.overall,
        collections: includeCollections ? systemHealth.collections : systemHealth.collections.length,
        backups: systemHealth.backups,
        performance: systemHealth.performance,
        storage: systemHealth.storage,
        alerts: includeAlerts ? systemHealth.alerts : systemHealth.alerts.length,
        timestamp: new Date()
      };

      return reply.send(response);

    } catch (error) {
      fastify.log.error({ error }, 'Failed to get vector system health');
      return reply.code(500).send({
        error: 'Failed to get system health',
        details: error.message
      });
    }
  });

  // Create comprehensive maintenance plan
  fastify.get('/maintenance/plan', async (request, reply) => {
    try {
      if (!global.enhancedVectorManagement) {
        return reply.code(503).send({
          error: 'Vector management service not available'
        });
      }

      const maintenancePlan = await global.enhancedVectorManagement.createMaintenancePlan();
      
      return reply.send({
        plan: maintenancePlan,
        summary: {
          backupsScheduled: maintenancePlan.scheduledBackups.length,
          optimizationsNeeded: maintenancePlan.optimizationNeeded.length,
          cleanupCandidates: maintenancePlan.cleanupCandidates.length,
          estimatedDuration: maintenancePlan.optimizationNeeded.reduce((sum, opt) => sum + opt.estimatedDuration, 0),
          potentialSpaceReclaimed: maintenancePlan.cleanupCandidates.reduce((sum, cleanup) => sum + cleanup.reclaimedSpace, 0)
        },
        generatedAt: new Date()
      });

    } catch (error) {
      fastify.log.error({ error }, 'Failed to create maintenance plan');
      return reply.code(500).send({
        error: 'Failed to create maintenance plan',
        details: error.message
      });
    }
  });

  // Execute maintenance plan
  fastify.post<{
    Body: MaintenanceRequest;
  }>('/maintenance/execute', async (request, reply) => {
    try {
      if (!global.enhancedVectorManagement) {
        return reply.code(503).send({
          error: 'Vector management service not available'
        });
      }

      const {
        executeBackups = true,
        executeOptimizations = true,
        executeCleanups = false, // Conservative default
        maxConcurrentTasks = 2,
        dryRun = false
      } = request.body;

      if (dryRun) {
        // Just return the plan without executing
        const maintenancePlan = await global.enhancedVectorManagement.createMaintenancePlan();
        return reply.send({
          dryRun: true,
          plan: maintenancePlan,
          wouldExecute: {
            backups: executeBackups ? maintenancePlan.scheduledBackups.length : 0,
            optimizations: executeOptimizations ? maintenancePlan.optimizationNeeded.length : 0,
            cleanups: executeCleanups ? maintenancePlan.cleanupCandidates.length : 0
          }
        });
      }

      // Get maintenance plan first
      const maintenancePlan = await global.enhancedVectorManagement.createMaintenancePlan();
      
      // Execute the plan
      const results = await global.enhancedVectorManagement.executeMaintenancePlan(maintenancePlan, {
        executeBackups,
        executeOptimizations,
        executeCleanups,
        maxConcurrentTasks
      });

      return reply.send({
        execution: results,
        completed: results.completed,
        failed: results.failed,
        skipped: results.skipped,
        details: results.results,
        executedAt: new Date()
      });

    } catch (error) {
      fastify.log.error({ error }, 'Failed to execute maintenance plan');
      return reply.code(500).send({
        error: 'Failed to execute maintenance plan',
        details: error.message
      });
    }
  });

  // Backup specific collection
  fastify.post<{
    Body: BackupRequest;
  }>('/backup', async (request, reply) => {
    try {
      if (!global.enhancedVectorManagement) {
        return reply.code(503).send({
          error: 'Vector management service not available'
        });
      }

      const {
        collectionName,
        destination = 'local',
        retention = 30,
        compression = true,
        encryption = false,
        incremental = true
      } = request.body;

      const backupId = await global.enhancedVectorManagement.backupCollection(collectionName, {
        destination,
        retention,
        compression,
        encryption,
        incremental
      });

      return reply.send({
        backupId,
        collectionName,
        status: 'initiated',
        message: 'Backup process started successfully',
        config: {
          destination,
          retention,
          compression,
          encryption,
          incremental
        },
        startedAt: new Date()
      });

    } catch (error) {
      fastify.log.error({ error }, 'Failed to initiate collection backup');
      return reply.code(500).send({
        error: 'Failed to initiate backup',
        details: error.message
      });
    }
  });

  // Restore collection from backup
  fastify.post<{
    Body: RestoreRequest;
  }>('/restore', async (request, reply) => {
    try {
      if (!global.enhancedVectorManagement) {
        return reply.code(503).send({
          error: 'Vector management service not available'
        });
      }

      const {
        backupId,
        targetCollections,
        validateIntegrity = true,
        overwriteExisting = false
      } = request.body;

      const restoreId = await global.enhancedVectorManagement.restoreCollection(backupId, {
        targetCollections,
        validateIntegrity,
        overwriteExisting
      });

      return reply.send({
        restoreId,
        backupId,
        status: 'initiated',
        message: 'Restore process started successfully',
        options: {
          validateIntegrity,
          overwriteExisting,
          targetCollections: targetCollections || 'original locations'
        },
        startedAt: new Date()
      });

    } catch (error) {
      fastify.log.error({ error }, 'Failed to initiate collection restore');
      return reply.code(500).send({
        error: 'Failed to initiate restore',
        details: error.message
      });
    }
  });

  // Get vector analytics and insights
  fastify.get<{
    Querystring: {
      timeRange?: '1h' | '24h' | '7d' | '30d';
      from?: string;
      to?: string;
    };
  }>('/analytics', async (request, reply) => {
    try {
      if (!global.enhancedVectorManagement) {
        return reply.code(503).send({
          error: 'Vector management service not available'
        });
      }

      const { timeRange = '24h', from, to } = request.query;
      
      // Calculate time range
      let timeRangeObj: { from: Date; to: Date };
      
      if (from && to) {
        timeRangeObj = {
          from: new Date(from),
          to: new Date(to)
        };
      } else {
        const now = new Date();
        const ranges = {
          '1h': 60 * 60 * 1000,
          '24h': 24 * 60 * 60 * 1000,
          '7d': 7 * 24 * 60 * 60 * 1000,
          '30d': 30 * 24 * 60 * 60 * 1000
        };
        
        timeRangeObj = {
          from: new Date(now.getTime() - ranges[timeRange]),
          to: now
        };
      }

      const analytics = await global.enhancedVectorManagement.getVectorAnalytics(timeRangeObj);
      
      return reply.send({
        analytics,
        timeRange: timeRangeObj,
        generatedAt: new Date()
      });

    } catch (error) {
      fastify.log.error({ error }, 'Failed to get vector analytics');
      return reply.code(500).send({
        error: 'Failed to get analytics',
        details: error.message
      });
    }
  });

  // Create optimal collection
  fastify.post<{
    Body: {
      name: string;
      template: 'user_memory' | 'user_artifacts' | 'shared_knowledge';
      customConfig?: any;
    };
  }>('/collections', async (request, reply) => {
    try {
      if (!global.enhancedVectorManagement) {
        return reply.code(503).send({
          error: 'Vector management service not available'
        });
      }

      const { name, template, customConfig } = request.body;

      await global.enhancedVectorManagement.createOptimalCollection(name, template, customConfig);

      return reply.send({
        collectionName: name,
        template,
        status: 'created',
        message: 'Collection created with optimal configuration',
        customConfig: customConfig || 'none',
        createdAt: new Date()
      });

    } catch (error) {
      fastify.log.error({ error }, 'Failed to create optimal collection');
      return reply.code(500).send({
        error: 'Failed to create collection',
        details: error.message
      });
    }
  });

  // Health check for vector management service
  fastify.get('/status', async (request, reply) => {
    try {
      const isHealthy = global.enhancedVectorManagement ? 
        await global.enhancedVectorManagement.healthCheck() : false;
      
      return reply.send({
        status: isHealthy ? 'healthy' : 'unhealthy',
        service: 'Enhanced Vector Management Service',
        available: !!global.enhancedVectorManagement,
        milvusRequired: true,
        features: {
          autoBackup: isHealthy,
          autoOptimization: isHealthy,
          healthMonitoring: isHealthy,
          analytics: isHealthy
        },
        timestamp: new Date()
      });

    } catch (error) {
      return reply.send({
        status: 'error',
        error: error.message,
        timestamp: new Date()
      });
    }
  });

  fastify.log.info('Vector Management routes registered');
};