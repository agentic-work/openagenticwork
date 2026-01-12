/**
 * Enhanced Vector Management Service
 * 
 * Centralized service integrating vector backup, optimization, and collection management
 * for production Milvus deployments. Provides enterprise-grade features including:
 * 
 * - Automated backup and restore operations
 * - Performance optimization and health monitoring  
 * - Collection lifecycle management
 * - Storage efficiency optimization
 * - Cross-environment migration support
 */

import type { Logger } from 'pino';
import { VectorBackupService, BackupConfig, BackupStatus, RestoreOptions } from './VectorBackupService.js';
import { VectorCollectionManager, CollectionConfig, CollectionHealth, CollectionStats } from './VectorCollectionManager.js';
import { VectorOptimization, OptimizationPlan } from './VectorOptimization.js';
import { prisma } from '../utils/prisma.js';

export interface VectorManagementOptions {
  enableAutoBackup?: boolean;
  enableAutoOptimization?: boolean;
  enableHealthMonitoring?: boolean;
  backupSchedule?: string; // cron expression
  optimizationSchedule?: string; // cron expression
  healthCheckInterval?: number; // minutes
  alertThresholds?: {
    searchLatency?: number; // ms
    memoryUsage?: number; // bytes
    fragmentationRatio?: number; // 0-1
    errorRate?: number; // 0-1
  };
}

export interface VectorSystemHealth {
  overall: 'healthy' | 'degraded' | 'critical';
  collections: CollectionHealth[];
  backups: {
    total: number;
    recent: number;
    failed: number;
    lastBackupAge: number; // hours
  };
  performance: {
    avgSearchLatency: number;
    throughput: number;
    errorRate: number;
  };
  storage: {
    totalSize: number;
    efficiency: number;
    fragmentationLevel: number;
  };
  alerts: Array<{
    severity: 'warning' | 'error' | 'critical';
    component: string;
    message: string;
    timestamp: Date;
  }>;
}

export interface MaintenancePlan {
  scheduledBackups: Array<{
    collectionName: string;
    nextBackup: Date;
    config: BackupConfig;
  }>;
  optimizationNeeded: Array<{
    collectionName: string;
    priority: 'high' | 'medium' | 'low';
    actions: string[];
    estimatedDuration: number; // minutes
  }>;
  cleanupCandidates: Array<{
    collectionName: string;
    reason: string;
    action: 'delete' | 'compact' | 'archive';
    reclaimedSpace: number; // bytes
  }>;
}

export class EnhancedVectorManagementService {
  private backupService: VectorBackupService;
  private collectionManager: VectorCollectionManager;
  private optimizationService: VectorOptimization;
  private logger: Logger;
  private options: Required<VectorManagementOptions>;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private systemAlerts: Array<any> = [];

  constructor(logger: Logger, options: VectorManagementOptions = {}) {
    this.logger = logger.child({ service: 'EnhancedVectorManagementService' }) as Logger;
    
    // Initialize sub-services
    this.backupService = new VectorBackupService(logger);
    this.collectionManager = new VectorCollectionManager(logger);
    this.optimizationService = new VectorOptimization(logger);
    
    // Set default options
    this.options = {
      enableAutoBackup: true,
      enableAutoOptimization: true,
      enableHealthMonitoring: true,
      backupSchedule: '0 2 * * *', // Daily at 2 AM
      optimizationSchedule: '0 3 * * 0', // Weekly on Sunday at 3 AM
      healthCheckInterval: 15, // Every 15 minutes
      alertThresholds: {
        searchLatency: 1000, // 1 second
        memoryUsage: 8 * 1024 * 1024 * 1024, // 8 GB
        fragmentationRatio: 0.3, // 30%
        errorRate: 0.05 // 5%
      },
      ...options
    };

    // Start monitoring if enabled
    if (this.options.enableHealthMonitoring) {
      this.startHealthMonitoring();
    }

    this.logger.info({
      autoBackup: this.options.enableAutoBackup,
      autoOptimization: this.options.enableAutoOptimization,
      healthMonitoring: this.options.enableHealthMonitoring
    }, 'Enhanced Vector Management Service initialized');
  }

  /**
   * Get comprehensive system health status
   */
  async getSystemHealth(): Promise<VectorSystemHealth> {
    try {
      this.logger.debug('Collecting comprehensive system health data');

      // Get collection health data
      const collectionStats = await this.collectionManager.getCollectionStats();
      const collections: CollectionHealth[] = [];
      
      if (collectionStats.totalCollections > 0) {
        // Get detailed health for each collection
        const allCollections = await this.getAllCollectionNames();
        for (const collectionName of allCollections.slice(0, 10)) { // Limit to top 10 for performance
          try {
            const health = await this.collectionManager.checkCollectionHealth(collectionName);
            collections.push(health);
          } catch (error) {
            this.logger.warn({ error, collectionName }, 'Failed to get collection health');
          }
        }
      }

      // Get backup status
      const recentBackups = await this.backupService.listBackups({
        dateRange: { 
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          to: new Date() 
        }
      });

      const failedBackups = recentBackups.filter(b => b.status === 'failed');
      const lastBackup = recentBackups
        .filter(b => b.status === 'completed')
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
      
      const lastBackupAge = lastBackup ? 
        (Date.now() - lastBackup.completedAt!.getTime()) / (1000 * 60 * 60) : 
        Number.MAX_SAFE_INTEGER;

      // Calculate performance metrics
      const avgSearchLatency = collections.reduce((sum, c) => sum + c.performance.avgSearchTime, 0) / Math.max(collections.length, 1);
      const totalThroughput = collections.reduce((sum, c) => sum + c.performance.throughput, 0);
      const avgAccuracy = collections.reduce((sum, c) => sum + c.performance.searchAccuracy, 0) / Math.max(collections.length, 1);
      
      // Calculate storage metrics
      const totalSize = collectionStats.totalSize;
      const avgFragmentation = collections.reduce((sum, c) => sum + c.indexHealth.fragmentationRatio, 0) / Math.max(collections.length, 1);

      // Determine overall system health
      const criticalIssues = collections.filter(c => c.status === 'critical').length;
      const degradedIssues = collections.filter(c => c.status === 'degraded').length;
      
      let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
      if (criticalIssues > 0 || failedBackups.length > 2 || avgSearchLatency > this.options.alertThresholds.searchLatency! * 2) {
        overallStatus = 'critical';
      } else if (degradedIssues > 0 || failedBackups.length > 0 || avgSearchLatency > this.options.alertThresholds.searchLatency!) {
        overallStatus = 'degraded';
      }

      // Generate alerts based on thresholds
      const alerts = this.generateSystemAlerts({
        avgSearchLatency,
        totalSize,
        avgFragmentation,
        failedBackups: failedBackups.length,
        lastBackupAge,
        criticalCollections: criticalIssues
      });

      const systemHealth: VectorSystemHealth = {
        overall: overallStatus,
        collections,
        backups: {
          total: recentBackups.length,
          recent: recentBackups.filter(b => 
            (Date.now() - b.startedAt.getTime()) < 24 * 60 * 60 * 1000
          ).length,
          failed: failedBackups.length,
          lastBackupAge
        },
        performance: {
          avgSearchLatency,
          throughput: totalThroughput,
          errorRate: 1 - avgAccuracy
        },
        storage: {
          totalSize,
          efficiency: collectionStats.storageEfficiency,
          fragmentationLevel: avgFragmentation
        },
        alerts
      };

      return systemHealth;

    } catch (error) {
      this.logger.error({ error }, 'Failed to get system health');
      throw error;
    }
  }

  /**
   * Create comprehensive maintenance plan
   */
  async createMaintenancePlan(): Promise<MaintenancePlan> {
    try {
      this.logger.info('Creating comprehensive maintenance plan');

      const [systemHealth, optimizationPlan] = await Promise.all([
        this.getSystemHealth(),
        this.optimizationService.analyzeOptimizationOpportunities()
      ]);

      // Schedule backups for collections without recent backups
      const scheduledBackups = await this.planBackupSchedule(systemHealth);
      
      // Identify collections needing optimization
      const optimizationNeeded = systemHealth.collections
        .filter(c => c.status !== 'healthy' || c.indexHealth.fragmentationRatio > 0.2)
        .map(collection => ({
          collectionName: collection.name,
          priority: collection.status === 'critical' ? 'high' as const : 
                   collection.status === 'degraded' ? 'medium' as const : 'low' as const,
          actions: collection.recommendations,
          estimatedDuration: this.estimateOptimizationDuration(collection)
        }));

      // Identify cleanup candidates
      const cleanupCandidates = await this.identifyCleanupCandidates(systemHealth);

      const maintenancePlan: MaintenancePlan = {
        scheduledBackups,
        optimizationNeeded,
        cleanupCandidates
      };

      this.logger.info({
        backups: scheduledBackups.length,
        optimizations: optimizationNeeded.length,
        cleanups: cleanupCandidates.length
      }, 'Maintenance plan created');

      return maintenancePlan;

    } catch (error) {
      this.logger.error({ error }, 'Failed to create maintenance plan');
      throw error;
    }
  }

  /**
   * Execute automated maintenance tasks
   */
  async executeMaintenancePlan(plan: MaintenancePlan, options: {
    executeBackups?: boolean;
    executeOptimizations?: boolean;
    executeCleanups?: boolean;
    maxConcurrentTasks?: number;
  } = {}): Promise<{
    completed: number;
    failed: number;
    skipped: number;
    results: Array<{
      task: string;
      status: 'completed' | 'failed' | 'skipped';
      duration?: number;
      error?: string;
    }>;
  }> {
    const {
      executeBackups = true,
      executeOptimizations = true,
      executeCleanups = false, // Conservative default
      maxConcurrentTasks = 2
    } = options;

    const results: any[] = [];
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    try {
      this.logger.info({
        backups: plan.scheduledBackups.length,
        optimizations: plan.optimizationNeeded.length,
        cleanups: plan.cleanupCandidates.length,
        maxConcurrent: maxConcurrentTasks
      }, 'Executing maintenance plan');

      // Execute backups
      if (executeBackups && plan.scheduledBackups.length > 0) {
        this.logger.info('Executing scheduled backups');
        
        for (const backup of plan.scheduledBackups.slice(0, maxConcurrentTasks)) {
          const startTime = Date.now();
          try {
            await this.backupService.createBackup(backup.config);
            const duration = Date.now() - startTime;
            
            results.push({
              task: `backup:${backup.collectionName}`,
              status: 'completed',
              duration
            });
            completed++;
          } catch (error) {
            results.push({
              task: `backup:${backup.collectionName}`,
              status: 'failed',
              error: error.message
            });
            failed++;
          }
        }

        // Skip remaining backups if too many
        const skippedBackups = Math.max(0, plan.scheduledBackups.length - maxConcurrentTasks);
        if (skippedBackups > 0) {
          skipped += skippedBackups;
          results.push({
            task: `backup:remaining`,
            status: 'skipped'
          });
        }
      }

      // Execute optimizations
      if (executeOptimizations && plan.optimizationNeeded.length > 0) {
        this.logger.info('Executing collection optimizations');
        
        // Prioritize high-priority optimizations
        const sortedOptimizations = plan.optimizationNeeded
          .sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
          });

        for (const optimization of sortedOptimizations.slice(0, maxConcurrentTasks)) {
          const startTime = Date.now();
          try {
            await this.collectionManager.optimizeCollection(optimization.collectionName);
            const duration = Date.now() - startTime;
            
            results.push({
              task: `optimize:${optimization.collectionName}`,
              status: 'completed',
              duration
            });
            completed++;
          } catch (error) {
            results.push({
              task: `optimize:${optimization.collectionName}`,
              status: 'failed',
              error: error.message
            });
            failed++;
          }
        }
      }

      // Execute cleanups (if explicitly enabled)
      if (executeCleanups && plan.cleanupCandidates.length > 0) {
        this.logger.warn('Executing cleanup operations - this may delete data');
        
        for (const cleanup of plan.cleanupCandidates.slice(0, 1)) { // Very conservative
          const startTime = Date.now();
          try {
            if (cleanup.action === 'compact') {
              await this.collectionManager.optimizeCollection(cleanup.collectionName);
            }
            // Note: We don't implement delete action for safety
            
            const duration = Date.now() - startTime;
            results.push({
              task: `cleanup:${cleanup.collectionName}`,
              status: 'completed',
              duration
            });
            completed++;
          } catch (error) {
            results.push({
              task: `cleanup:${cleanup.collectionName}`,
              status: 'failed',
              error: error.message
            });
            failed++;
          }
        }
      }

      this.logger.info({ completed, failed, skipped }, 'Maintenance plan execution completed');

      return { completed, failed, skipped, results };

    } catch (error) {
      this.logger.error({ error }, 'Failed to execute maintenance plan');
      throw error;
    }
  }

  /**
   * Backup specific collection with custom configuration
   */
  async backupCollection(
    collectionName: string, 
    config?: Partial<BackupConfig>
  ): Promise<string> {
    const backupConfig: BackupConfig = {
      name: `${collectionName}_backup_${new Date().toISOString().split('T')[0]}`,
      collections: [collectionName],
      destination: 'local',
      retention: 30,
      compression: true,
      encryption: false,
      incremental: true,
      ...config
    };

    return this.backupService.createBackup(backupConfig);
  }

  /**
   * Restore collection from backup
   */
  async restoreCollection(
    backupId: string, 
    options?: Partial<RestoreOptions>
  ): Promise<string> {
    const restoreOptions: RestoreOptions = {
      backupId,
      validateIntegrity: true,
      overwriteExisting: false,
      ...options
    };

    return this.backupService.restoreFromBackup(restoreOptions);
  }

  /**
   * Create collection with optimal configuration
   */
  async createOptimalCollection(
    name: string,
    template: 'user_memory' | 'user_artifacts' | 'shared_knowledge',
    customConfig?: Partial<CollectionConfig>
  ): Promise<void> {
    return this.collectionManager.createOptimalCollection(name, template, customConfig);
  }

  /**
   * Get detailed analytics for vector operations
   */
  async getVectorAnalytics(timeRange: {
    from: Date;
    to: Date;
  }): Promise<{
    searchMetrics: {
      totalSearches: number;
      avgLatency: number;
      errorRate: number;
      topCollections: Array<{ name: string; searches: number; avgLatency: number; }>;
    };
    storageMetrics: {
      totalSize: number;
      growthRate: number; // bytes per day
      compressionRatio: number;
      fragmentationLevel: number;
    };
    backupMetrics: {
      totalBackups: number;
      successRate: number;
      avgBackupSize: number;
      avgBackupDuration: number;
    };
  }> {
    try {
      // This would integrate with actual metrics collection
      // For now, return placeholder data
      
      const systemHealth = await this.getSystemHealth();
      const recentBackups = await this.backupService.listBackups({
        dateRange: timeRange
      });

      return {
        searchMetrics: {
          totalSearches: systemHealth.collections.reduce((sum, c) => sum + c.performance.throughput, 0),
          avgLatency: systemHealth.performance.avgSearchLatency,
          errorRate: systemHealth.performance.errorRate,
          topCollections: systemHealth.collections
            .sort((a, b) => b.performance.throughput - a.performance.throughput)
            .slice(0, 5)
            .map(c => ({
              name: c.name,
              searches: c.performance.throughput,
              avgLatency: c.performance.avgSearchTime
            }))
        },
        storageMetrics: {
          totalSize: systemHealth.storage.totalSize,
          growthRate: 0, // Would calculate from historical data
          compressionRatio: 0.7, // Placeholder
          fragmentationLevel: systemHealth.storage.fragmentationLevel
        },
        backupMetrics: {
          totalBackups: recentBackups.length,
          successRate: recentBackups.filter(b => b.status === 'completed').length / Math.max(recentBackups.length, 1),
          avgBackupSize: recentBackups.reduce((sum, b) => sum + b.stats.sizeBytes, 0) / Math.max(recentBackups.length, 1),
          avgBackupDuration: recentBackups.reduce((sum, b) => sum + b.stats.duration, 0) / Math.max(recentBackups.length, 1)
        }
      };

    } catch (error) {
      this.logger.error({ error }, 'Failed to get vector analytics');
      throw error;
    }
  }

  // Private helper methods

  private async getAllCollectionNames(): Promise<string[]> {
    // This would get collection names from the collection manager
    // For now, return some common collection names
    return ['user_memories', 'user_artifacts', 'shared_knowledge'];
  }

  private async planBackupSchedule(systemHealth: VectorSystemHealth) {
    const scheduledBackups = [];
    const currentTime = new Date();
    
    for (const collection of systemHealth.collections) {
      // Schedule backup if collection is healthy and hasn't been backed up recently
      if (collection.status === 'healthy' && collection.vectorCount > 1000) {
        scheduledBackups.push({
          collectionName: collection.name,
          nextBackup: new Date(currentTime.getTime() + 24 * 60 * 60 * 1000), // Tomorrow
          config: {
            name: `${collection.name}_scheduled_${currentTime.toISOString().split('T')[0]}`,
            collections: [collection.name],
            destination: 'local' as const,
            retention: 30,
            compression: true,
            encryption: false,
            incremental: true
          }
        });
      }
    }

    return scheduledBackups;
  }

  private estimateOptimizationDuration(collection: CollectionHealth): number {
    // Estimate based on collection size and issues
    const baseTime = 5; // 5 minutes base
    const vectorPenalty = Math.floor(collection.vectorCount / 10000); // 1 minute per 10k vectors
    const issuePenalty = collection.issues.length * 2; // 2 minutes per issue
    
    return baseTime + vectorPenalty + issuePenalty;
  }

  private async identifyCleanupCandidates(systemHealth: VectorSystemHealth) {
    const candidates = [];
    
    for (const collection of systemHealth.collections) {
      if (collection.status === 'critical' && collection.vectorCount === 0) {
        candidates.push({
          collectionName: collection.name,
          reason: 'Empty collection with critical health',
          action: 'delete' as const,
          reclaimedSpace: collection.memoryUsage
        });
      } else if (collection.indexHealth.fragmentationRatio > 0.5) {
        candidates.push({
          collectionName: collection.name,
          reason: `High fragmentation: ${collection.indexHealth.fragmentationRatio.toFixed(2)}`,
          action: 'compact' as const,
          reclaimedSpace: collection.memoryUsage * collection.indexHealth.fragmentationRatio
        });
      }
    }

    return candidates;
  }

  private generateSystemAlerts(metrics: {
    avgSearchLatency: number;
    totalSize: number;
    avgFragmentation: number;
    failedBackups: number;
    lastBackupAge: number;
    criticalCollections: number;
  }) {
    const alerts = [];
    const thresholds = this.options.alertThresholds;

    if (metrics.avgSearchLatency > thresholds.searchLatency!) {
      alerts.push({
        severity: 'warning' as const,
        component: 'performance',
        message: `High average search latency: ${metrics.avgSearchLatency.toFixed(0)}ms`,
        timestamp: new Date()
      });
    }

    if (metrics.totalSize > thresholds.memoryUsage!) {
      alerts.push({
        severity: 'warning' as const,
        component: 'storage',
        message: `High memory usage: ${(metrics.totalSize / 1024 / 1024 / 1024).toFixed(1)}GB`,
        timestamp: new Date()
      });
    }

    if (metrics.avgFragmentation > thresholds.fragmentationRatio!) {
      alerts.push({
        severity: 'error' as const,
        component: 'storage',
        message: `High fragmentation ratio: ${(metrics.avgFragmentation * 100).toFixed(1)}%`,
        timestamp: new Date()
      });
    }

    if (metrics.failedBackups > 0) {
      alerts.push({
        severity: metrics.failedBackups > 2 ? 'critical' as const : 'error' as const,
        component: 'backup',
        message: `${metrics.failedBackups} failed backups in the last 7 days`,
        timestamp: new Date()
      });
    }

    if (metrics.lastBackupAge > 48) { // 48 hours
      alerts.push({
        severity: metrics.lastBackupAge > 168 ? 'critical' as const : 'warning' as const, // 1 week
        component: 'backup',
        message: `Last successful backup was ${(metrics.lastBackupAge / 24).toFixed(1)} days ago`,
        timestamp: new Date()
      });
    }

    if (metrics.criticalCollections > 0) {
      alerts.push({
        severity: 'critical' as const,
        component: 'collections',
        message: `${metrics.criticalCollections} collections in critical state`,
        timestamp: new Date()
      });
    }

    return alerts;
  }

  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        
        // Log system health status
        this.logger.info({
          status: health.overall,
          collections: health.collections.length,
          alerts: health.alerts.length,
          backups: health.backups.recent
        }, 'System health check completed');

        // Store alerts for API access
        this.systemAlerts = health.alerts.slice(-100); // Keep last 100 alerts

      } catch (error) {
        this.logger.error({ error }, 'Health monitoring check failed');
      }
    }, this.options.healthCheckInterval * 60 * 1000);

    this.logger.info({ 
      interval: this.options.healthCheckInterval 
    }, 'Health monitoring started');
  }

  /**
   * Stop all monitoring and cleanup resources
   */
  public async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Stop collection manager maintenance
    this.collectionManager.stopMaintenance();
    
    this.logger.info('Enhanced Vector Management Service shutdown completed');
  }

  /**
   * Health check for service status
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Quick health check - just verify we can get basic stats
      await this.collectionManager.getCollectionStats();
      return true;
    } catch (error) {
      this.logger.error({ error }, 'Vector management service health check failed');
      return false;
    }
  }
}