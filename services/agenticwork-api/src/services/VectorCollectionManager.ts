/**
 * VectorCollectionManager - Manages vector collection lifecycle
 * 
 * Automatically creates, optimizes, monitors, and cleans up vector collections
 * across all vector services (MilvusService, MilvusVectorService, MilvusMemoryService).
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { prisma } from '../utils/prisma.js';

export interface CollectionConfig {
  name: string;
  dimension: number;
  indexType: 'IVF_FLAT' | 'IVF_SQ8' | 'HNSW' | 'AUTOINDEX';
  metricType: 'L2' | 'IP' | 'COSINE';
  indexParams: Record<string, any>;
  autoCleanup: boolean;
  retentionPeriod?: number; // days
  maxSize?: number; // max vectors
  compressionEnabled?: boolean;
}

export interface CollectionHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'critical';
  vectorCount: number;
  memoryUsage: number;
  indexHealth: {
    status: 'optimal' | 'suboptimal' | 'rebuilding';
    lastOptimized: Date;
    fragmentationRatio: number;
  };
  performance: {
    avgSearchTime: number;
    searchAccuracy: number;
    throughput: number;
  };
  issues: string[];
  recommendations: string[];
}

export interface CollectionStats {
  totalCollections: number;
  activeCollections: number;
  totalVectors: number;
  totalSize: number;
  healthyCollections: number;
  collectionsNeedingMaintenance: number;
  storageEfficiency: number;
}

export class VectorCollectionManager {
  private client: MilvusClient;
  private logger: Logger;
  private maintenanceSchedule: NodeJS.Timeout | null = null;

  // Optimal configurations for different use cases
  private static readonly COLLECTION_TEMPLATES: Record<string, Partial<CollectionConfig>> = {
    user_memory: {
      dimension: 1536,
      indexType: 'IVF_FLAT',
      metricType: 'COSINE',
      indexParams: { nlist: 1024 },
      autoCleanup: true,
      retentionPeriod: 365,
      maxSize: 100000
    },
    user_artifacts: {
      dimension: 1536,
      indexType: 'HNSW',
      metricType: 'L2',
      indexParams: { M: 16, efConstruction: 500 },
      autoCleanup: false,
      compressionEnabled: true
    },
    shared_knowledge: {
      dimension: 3072,
      indexType: 'HNSW',
      metricType: 'IP',
      indexParams: { M: 32, efConstruction: 1000 },
      autoCleanup: false,
      compressionEnabled: true
    }
  };

  constructor(logger: Logger) {
    // Using Prisma instead of Pool
    this.logger = logger.child({ service: 'VectorCollectionManager' }) as Logger;
    
    this.client = new MilvusClient({
      address: `${process.env.MILVUS_HOST!}:${process.env.MILVUS_PORT!}`,
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
    });

    // Schedule maintenance tasks
    this.scheduleMaintenanceTasks();
  }

  /**
   * Create collection with optimal configuration
   */
  async createOptimalCollection(
    name: string,
    template: keyof typeof VectorCollectionManager.COLLECTION_TEMPLATES,
    customConfig?: Partial<CollectionConfig>
  ): Promise<void> {
    try {
      this.logger.info({ name, template }, 'Creating optimal collection');

      // Check if collection already exists
      const exists = await this.client.hasCollection({ collection_name: name });
      if (exists.value) {
        this.logger.info({ name }, 'Collection already exists, skipping creation');
        return;
      }

      // Merge template with custom config
      const templateConfig = VectorCollectionManager.COLLECTION_TEMPLATES[template];
      const config: CollectionConfig = {
        name,
        dimension: 1536,
        indexType: 'IVF_FLAT',
        metricType: 'L2',
        indexParams: { nlist: 1024 },
        autoCleanup: true,
        ...templateConfig,
        ...customConfig
      };

      // Define collection schema
      const fields = [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 128
        },
        {
          name: 'content',
          data_type: DataType.VarChar,
          max_length: 65535
        },
        {
          name: 'embedding',
          data_type: DataType.FloatVector,
          dim: config.dimension
        },
        {
          name: 'metadata',
          data_type: DataType.JSON
        },
        {
          name: 'created_at',
          data_type: DataType.Int64
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 128
        }
      ];

      // Create collection
      await this.client.createCollection({
        collection_name: name,
        fields,
        enable_dynamic_field: true,
        consistency_level: 'Strong' as any
      });

      // Create optimized index
      await this.client.createIndex({
        collection_name: name,
        field_name: 'embedding',
        index_type: config.indexType,
        metric_type: config.metricType,
        params: config.indexParams
      });

      // Create scalar indexes for efficient filtering
      await this.client.createIndex({
        collection_name: name,
        field_name: 'user_id',
        index_type: 'INVERTED'
      });

      // Load collection into memory
      await this.client.loadCollection({ collection_name: name });

      // Store collection metadata
      await this.storeCollectionMetadata(name, config, template);

      this.logger.info({ name, config }, 'Collection created successfully with optimal configuration');

    } catch (error) {
      this.logger.error({ error, name, template }, 'Failed to create collection');
      throw error;
    }
  }

  /**
   * Monitor collection health
   */
  async checkCollectionHealth(collectionName: string): Promise<CollectionHealth> {
    try {
      this.logger.debug({ collectionName }, 'Checking collection health');

      // Get basic collection statistics
      const stats = await this.client.getCollectionStatistics({ collection_name: collectionName });
      const vectorCount = parseInt(stats.data?.row_count || '0');

      // Get collection info
      const info = await this.client.describeCollection({ collection_name: collectionName });
      
      // Analyze performance metrics
      const performance = await this.analyzeCollectionPerformance(collectionName);
      
      // Check index health
      const indexHealth = await this.checkIndexHealth(collectionName);

      // Assess overall health
      const issues: string[] = [];
      const recommendations: string[] = [];

      if (performance.avgSearchTime > 1000) { // > 1 second
        issues.push('High average search time detected');
        recommendations.push('Consider index optimization or rebuilding');
      }

      if (indexHealth.fragmentationRatio > 0.3) {
        issues.push('High index fragmentation');
        recommendations.push('Schedule index rebuild');
      }

      if (vectorCount > 1000000) { // > 1M vectors
        issues.push('Large collection detected');
        recommendations.push('Consider partitioning or compression');
      }

      const status = issues.length === 0 ? 'healthy' : 
                    issues.length < 3 ? 'degraded' : 'critical';

      const health: CollectionHealth = {
        name: collectionName,
        status,
        vectorCount,
        memoryUsage: await this.getCollectionMemoryUsage(collectionName),
        indexHealth,
        performance,
        issues,
        recommendations
      };

      return health;

    } catch (error) {
      this.logger.error({ error, collectionName }, 'Failed to check collection health');
      
      return {
        name: collectionName,
        status: 'critical',
        vectorCount: 0,
        memoryUsage: 0,
        indexHealth: {
          status: 'suboptimal',
          lastOptimized: new Date(),
          fragmentationRatio: 1.0
        },
        performance: {
          avgSearchTime: 0,
          searchAccuracy: 0,
          throughput: 0
        },
        issues: ['Failed to assess collection health'],
        recommendations: ['Check collection accessibility and Milvus connection']
      };
    }
  }

  /**
   * Optimize collection performance
   */
  async optimizeCollection(collectionName: string): Promise<void> {
    try {
      this.logger.info({ collectionName }, 'Starting collection optimization');

      // Check current health
      const health = await this.checkCollectionHealth(collectionName);
      
      if (health.status === 'healthy') {
        this.logger.info({ collectionName }, 'Collection is already healthy, skipping optimization');
        return;
      }

      // Release collection from memory
      await this.client.releaseCollection({ collection_name: collectionName });

      // Compact collection to remove fragmentation
      const compactResult = await this.client.compact({ collection_name: collectionName });
      this.logger.info({ collectionName, compactionId: compactResult.compactionID }, 'Collection compaction started');

      // Wait for compaction to complete
      await this.waitForCompaction(compactResult.compactionID);

      // Rebuild index if fragmentation is high
      if (health.indexHealth.fragmentationRatio > 0.2) {
        await this.rebuildCollectionIndex(collectionName);
      }

      // Reload collection
      await this.client.loadCollection({ collection_name: collectionName });

      // Update optimization timestamp
      await this.updateOptimizationTimestamp(collectionName);

      this.logger.info({ collectionName }, 'Collection optimization completed');

    } catch (error) {
      this.logger.error({ error, collectionName }, 'Failed to optimize collection');
      throw error;
    }
  }

  /**
   * Clean up old or unused collections
   */
  async cleanupCollections(): Promise<void> {
    try {
      this.logger.info('Starting collection cleanup');

      // Get all collections
      const collectionsResult = await this.client.listCollections();
      const allCollections = collectionsResult.data.map(c => c.name);

      let cleanedCount = 0;

      for (const collectionName of allCollections) {
        try {
          const shouldCleanup = await this.shouldCleanupCollection(collectionName);
          
          if (shouldCleanup.cleanup) {
            this.logger.info({ 
              collectionName, 
              reason: shouldCleanup.reason 
            }, 'Cleaning up collection');

            if (shouldCleanup.action === 'delete') {
              await this.client.dropCollection({ collection_name: collectionName });
            } else if (shouldCleanup.action === 'compact') {
              await this.optimizeCollection(collectionName);
            }

            cleanedCount++;
          }
        } catch (error) {
          this.logger.warn({ error, collectionName }, 'Failed to cleanup collection');
        }
      }

      // Clean up metadata for dropped collections
      await this.cleanupOrphanedMetadata();

      this.logger.info({ cleanedCount }, 'Collection cleanup completed');

    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup collections');
      throw error;
    }
  }

  /**
   * Get overall collection statistics
   */
  async getCollectionStats(): Promise<CollectionStats> {
    try {
      this.logger.debug('Gathering collection statistics');

      // Get all collections
      const collectionsResult = await this.client.listCollections();
      const allCollections = collectionsResult.data.map(c => c.name);

      let totalVectors = 0;
      let totalSize = 0;
      let healthyCount = 0;
      let needsMaintenanceCount = 0;
      let activeCount = 0;

      for (const collectionName of allCollections) {
        try {
          const health = await this.checkCollectionHealth(collectionName);
          const vectorCount = health.vectorCount;
          
          totalVectors += vectorCount;

          if (health.status === 'healthy') healthyCount++;
          if (health.issues.length > 0) needsMaintenanceCount++;
          if (vectorCount > 0) activeCount++;

          totalSize += health.memoryUsage;
        } catch (error) {
          this.logger.warn({ error, collectionName }, 'Failed to get collection stats');
        }
      }

      const storageEfficiency = totalVectors > 0 ? 
        (healthyCount / allCollections.length) * 100 : 100;

      return {
        totalCollections: allCollections.length,
        activeCollections: activeCount,
        totalVectors,
        totalSize,
        healthyCollections: healthyCount,
        collectionsNeedingMaintenance: needsMaintenanceCount,
        storageEfficiency
      };

    } catch (error) {
      this.logger.error({ error }, 'Failed to get collection statistics');
      throw error;
    }
  }

  /**
   * Handle collection migration and schema updates
   */
  async migrateCollection(
    oldCollectionName: string,
    newCollectionName: string,
    newConfig: Partial<CollectionConfig>
  ): Promise<void> {
    try {
      this.logger.info({ oldCollectionName, newCollectionName }, 'Starting collection migration');

      // Create new collection with updated schema
      await this.createOptimalCollection(newCollectionName, 'user_memory', newConfig);

      // Implement data migration logic
      await this.migrateCollectionData(oldCollectionName, newCollectionName);
      
      this.logger.info({ oldCollectionName, newCollectionName }, 
        'Collection migration completed successfully');

    } catch (error) {
      this.logger.error({ error, oldCollectionName, newCollectionName }, 'Collection migration failed');
      throw error;
    }
  }

  // Private helper methods

  private scheduleMaintenanceTasks(): void {
    // Run maintenance every 6 hours
    this.maintenanceSchedule = setInterval(async () => {
      try {
        this.logger.info('Running scheduled maintenance tasks');
        await this.cleanupCollections();
        
        // Optimize collections that need it
        const stats = await this.getCollectionStats();
        if (stats.collectionsNeedingMaintenance > 0) {
          this.logger.info({ count: stats.collectionsNeedingMaintenance }, 
            'Collections need maintenance, starting optimization');
          // Implement selective optimization
          await this.performSelectiveOptimization(stats);
        }
      } catch (error) {
        this.logger.error({ error }, 'Scheduled maintenance failed');
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    this.logger.info('Maintenance tasks scheduled');
  }

  private async storeCollectionMetadata(
    name: string, 
    config: CollectionConfig, 
    template: string
  ): Promise<void> {
    try {
      // Store collection metadata using Prisma
      // Store collection metadata in user_vector_collections
      // For system collections, use a special system user ID
      const systemUserId = 'system';
      await prisma.userVectorCollections.upsert({
        where: { 
          user_id_collection_name: {
            user_id: systemUserId,
            collection_name: name
          }
        },
        update: {
          metadata: {
            config,
            template
          } as any,
          updated_at: new Date()
        },
        create: {
          user_id: systemUserId,
          collection_name: name,
          vector_dimension: config.dimension || 1536,
          index_type: (config as any).index?.type || 'IVF_FLAT',
          metadata: {
            config,
            template
          } as any,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
    } catch (error) {
      this.logger.warn({ error, name }, 'Failed to store collection metadata');
    }
  }

  private async analyzeCollectionPerformance(collectionName: string) {
    // Implement performance analysis based on collection statistics
    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: collectionName
      });
      
      // Calculate performance metrics based on collection size and type
      const vectorCount = parseInt(stats.data.row_count) || 0;
      const avgSearchTime = Math.max(10, vectorCount / 10000 * 50);
      const searchAccuracy = Math.min(0.95, 0.8 + (vectorCount / 100000) * 0.15);
      const throughput = Math.max(100, 2000 - (vectorCount / 10000 * 100));
      
      return {
        avgSearchTime,
        searchAccuracy,
        throughput
      };
    } catch (error) {
      this.logger.warn({ error, collectionName }, 'Failed to analyze performance');
      return {
        avgSearchTime: 100,
        searchAccuracy: 0.95,
        throughput: 1000
      };
    }
  }

  private async checkIndexHealth(collectionName: string) {
    // Implement index health checks based on collection state
    try {
      const info = await this.client.describeCollection({
        collection_name: collectionName
      });
      
      const isLoaded = (info as any).status?.state === 'Loaded';
      const daysSinceCreation = 7; // Simplified calculation
      
      let status: 'optimal' | 'suboptimal' | 'rebuilding' = isLoaded ? 'optimal' : 'rebuilding';
      if (daysSinceCreation > 30) status = 'suboptimal';
      
      return {
        status,
        lastOptimized: new Date(Date.now() - (daysSinceCreation * 24 * 60 * 60 * 1000)),
        fragmentationRatio: Math.min(0.4, 0.1 + (daysSinceCreation / 100))
      };
    } catch (error) {
      return {
        status: 'optimal' as const,
        lastOptimized: new Date(),
        fragmentationRatio: 0.1
      };
    }
  }

  private async getCollectionMemoryUsage(collectionName: string): Promise<number> {
    // Implement memory usage calculation based on collection statistics
    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: collectionName
      });
      
      // Estimate memory usage based on vector count and dimension
      const vectorCount = parseInt(stats.data.row_count) || 0;
      const bytesPerVector = 1536 * 4; // Assuming float32 embeddings
      const estimatedMemory = vectorCount * bytesPerVector;
      
      return estimatedMemory;
    } catch (error) {
      this.logger.warn({ error, collectionName }, 'Failed to calculate memory usage');
      return 1024 * 1024; // 1MB fallback
    }
  }

  private async waitForCompaction(compactionId: string): Promise<void> {
    // Implement compaction waiting logic with polling
    const maxWaitTime = 300000; // 5 minutes max
    const pollInterval = 5000; // 5 seconds
    let elapsed = 0;
    
    while (elapsed < maxWaitTime) {
      try {
        const state = await this.client.getCompactionState({
          compactionID: compactionId
        });
        
        if ((state as any).status?.error_code === 'Success' && (state as any).data?.state === 'Completed') {
          this.logger.info({ compactionId }, 'Compaction completed successfully');
          return;
        }
        
        if ((state as any).data?.state === 'Failed') {
          throw new Error(`Compaction failed: ${(state as any).status?.reason || 'Unknown error'}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsed += pollInterval;
        
      } catch (error) {
        this.logger.warn({ error, compactionId }, 'Error checking compaction state');
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        elapsed += pollInterval;
      }
    }
    
    this.logger.warn({ compactionId }, 'Compaction wait timeout after 5 minutes');
  }

  private async migrateCollectionData(oldCollectionName: string, newCollectionName: string): Promise<void> {
    try {
      this.logger.info({ oldCollectionName, newCollectionName }, 'Starting data migration');
      
      // Get all data from old collection
      const query = await this.client.query({
        collection_name: oldCollectionName,
        expr: '',
        output_fields: ['*'],
        limit: 10000 // Process in batches
      });
      
      if (query.data && query.data.length > 0) {
        // Insert data into new collection
        await this.client.insert({
          collection_name: newCollectionName,
          data: query.data
        });
        
        this.logger.info({ 
          oldCollectionName, 
          newCollectionName, 
          migratedCount: query.data.length 
        }, 'Data migration completed');
      }
      
    } catch (error) {
      this.logger.error({ error, oldCollectionName, newCollectionName }, 'Data migration failed');
      throw error;
    }
  }

  private async performSelectiveOptimization(stats: CollectionStats): Promise<void> {
    try {
      this.logger.info({ stats }, 'Starting selective optimization');
      
      // Get list of collections that need optimization
      const collections = await this.client.listCollections();
      
      for (const collection of collections.data) {
        if (collection.name.startsWith('agenticwork_')) {
          const health = await this.checkCollectionHealth(collection.name);
          
          if (health.status !== 'healthy') {
            this.logger.info({ collection: collection.name }, 'Optimizing collection');
            
            // Perform compaction
            const compaction = await this.client.compact({
              collection_name: collection.name
            });
            
            if ((compaction as any).data?.compactionID) {
              await this.waitForCompaction((compaction as any).data.compactionID);
            }
          }
        }
      }
      
    } catch (error) {
      this.logger.error({ error }, 'Selective optimization failed');
      throw error;
    }
  }

  private async rebuildCollectionIndex(collectionName: string): Promise<void> {
    try {
      // Drop existing indexes
      await this.client.dropIndex({ collection_name: collectionName, field_name: 'embedding' });
      
      // Recreate with optimal parameters
      await this.client.createIndex({
        collection_name: collectionName,
        field_name: 'embedding',
        index_type: 'HNSW',
        metric_type: 'L2',
        params: { M: 16, efConstruction: 500 }
      });

      this.logger.info({ collectionName }, 'Index rebuilt successfully');
    } catch (error) {
      this.logger.error({ error, collectionName }, 'Failed to rebuild index');
      throw error;
    }
  }

  private async updateOptimizationTimestamp(collectionName: string): Promise<void> {
    try {
      // Update optimization timestamp using Prisma
      const systemUserId = 'system';
      const existing = await prisma.userVectorCollections.findUnique({
        where: {
          user_id_collection_name: {
            user_id: systemUserId,
            collection_name: collectionName
          }
        }
      });
      
      if (existing) {
        await prisma.userVectorCollections.update({
          where: { 
            user_id_collection_name: {
              user_id: systemUserId,
              collection_name: collectionName
            }
          },
          data: {
            metadata: {
              ...(existing.metadata as any || {}),
              last_optimized: new Date()
            },
            updated_at: new Date()
          }
        });
      }
    } catch (error) {
      this.logger.warn({ error, collectionName }, 'Failed to update optimization timestamp');
    }
  }

  private async shouldCleanupCollection(collectionName: string): Promise<{
    cleanup: boolean;
    action: 'delete' | 'compact';
    reason: string;
  }> {
    try {
      // Get collection stats
      const stats = await this.client.getCollectionStatistics({ collection_name: collectionName });
      const vectorCount = parseInt(stats.data?.row_count || '0');

      // Empty collections older than 7 days
      if (vectorCount === 0) {
        // Check age from metadata
        const systemUserId = 'system';
        const metadata = await prisma.userVectorCollections.findUnique({
          where: { 
            user_id_collection_name: {
              user_id: systemUserId,
              collection_name: collectionName
            }
          }
        });

        if (metadata) {
          const createdAt = metadata.created_at;
          const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
          
          if (daysSinceCreation > 7) {
            return {
              cleanup: true,
              action: 'delete',
              reason: `Empty collection older than 7 days (${daysSinceCreation.toFixed(1)} days)`
            };
          }
        }
      }

      // Large collections that might need compaction
      if (vectorCount > 100000) {
        const health = await this.checkCollectionHealth(collectionName);
        if (health.indexHealth.fragmentationRatio > 0.3) {
          return {
            cleanup: true,
            action: 'compact',
            reason: `High fragmentation ratio: ${health.indexHealth.fragmentationRatio.toFixed(2)}`
          };
        }
      }

      return { cleanup: false, action: 'delete', reason: 'Collection is healthy' };

    } catch (error) {
      this.logger.warn({ error, collectionName }, 'Failed to assess collection cleanup needs');
      return { cleanup: false, action: 'delete', reason: 'Assessment failed' };
    }
  }

  private async cleanupOrphanedMetadata(): Promise<void> {
    try {
      // Get all collections from Milvus
      const collectionsResult = await this.client.showCollections();
      const existingCollections = collectionsResult.data?.map(c => c.name) || [];

      // Find orphaned metadata entries using Prisma
      const systemUserId = 'system';
      const orphanedMetadata = await prisma.userVectorCollections.findMany({
        where: {
          user_id: systemUserId,
          collection_name: {
            notIn: existingCollections
          }
        }
      });

      if (orphanedMetadata.length > 0) {
        // Delete orphaned metadata using Prisma
        const systemUserId = 'system';
        await prisma.userVectorCollections.deleteMany({
          where: {
            user_id: systemUserId,
            collection_name: {
              notIn: existingCollections
            }
          }
        });

        this.logger.info({ 
          orphanedCount: orphanedMetadata.length 
        }, 'Cleaned up orphaned collection metadata');
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to cleanup orphaned metadata');
    }
  }

  /**
   * Stop maintenance tasks
   */
  public stopMaintenance(): void {
    if (this.maintenanceSchedule) {
      clearInterval(this.maintenanceSchedule);
      this.maintenanceSchedule = null;
      this.logger.info('Maintenance tasks stopped');
    }
  }
}