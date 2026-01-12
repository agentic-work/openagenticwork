/**
 * UnifiedVectorStorage - Orchestrates all vector operations
 * 
 * This service provides a unified interface for all vector storage operations
 * by coordinating between MilvusService, MilvusVectorService, and MilvusMemoryService.
 * It enables cross-service operations like searching memories and artifacts simultaneously.
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { MilvusService, MemoryEntry, MemorySearchResult } from './MilvusService.js';
import MilvusVectorService, { ArtifactType, ArtifactMetadata } from './MilvusVectorService.js';
import { MilvusMemoryService, getMilvusMemoryService } from './MilvusMemoryService.js';
import { RankedMemory } from '../memory/types/Memory.js';
import { prisma } from '../utils/prisma.js';

export interface UnifiedSearchOptions {
  query: string;
  userId: string;
  limit?: number;
  includeMemories?: boolean;
  includeArtifacts?: boolean;
  includeDocuments?: boolean;
  artifactTypes?: ArtifactType[];
  threshold?: number;
  timeFilter?: {
    from?: Date;
    to?: Date;
  };
  metadataFilters?: Record<string, any>;
}

export interface UnifiedSearchResult {
  id: string;
  type: 'memory' | 'artifact' | 'document';
  title: string;
  content: string;
  score: number;
  metadata: any;
  source: 'milvus_memory' | 'milvus_vector' | 'milvus_basic';
  userId: string;
  createdAt?: Date;
  relevanceReasons?: string[];
}

export interface VectorStorageStats {
  userId: string;
  totalVectors: number;
  memoryCollections: {
    name: string;
    vectorCount: number;
    lastAccessed?: Date;
  }[];
  artifactCollections: {
    name: string;
    vectorCount: number;
    storageUsed: number;
    typeDistribution: Record<string, number>;
  }[];
  searchStats: {
    totalSearches: number;
    avgResponseTime: number;
    mostSearchedTerms: string[];
  };
  storageHealth: {
    status: 'healthy' | 'warning' | 'error';
    issues: string[];
    recommendations: string[];
  };
}

export class UnifiedVectorStorage {
  private milvusService: MilvusService;
  private milvusVectorService: MilvusVectorService;
  private milvusMemoryService: MilvusMemoryService;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'UnifiedVectorStorage' }) as Logger;
    
    // Initialize existing services - removed Pool parameters
    this.milvusService = new MilvusService();
    this.milvusVectorService = new MilvusVectorService();
    this.milvusMemoryService = getMilvusMemoryService(logger);
  }

  /**
   * Initialize all vector services
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing unified vector storage...');
      
      await this.milvusService.connect();
      await this.milvusVectorService.initialize();
      
      this.logger.info('Unified vector storage initialized successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize unified vector storage');
      throw error;
    }
  }

  /**
   * Unified search across all vector types
   */
  async search(options: UnifiedSearchOptions): Promise<UnifiedSearchResult[]> {
    const {
      query,
      userId,
      limit = 20,
      includeMemories = true,
      includeArtifacts = true,
      includeDocuments = true,
      artifactTypes,
      threshold = 0.7,
      timeFilter,
      metadataFilters
    } = options;

    this.logger.info({ userId, query, options }, 'Performing unified vector search');

    const allResults: UnifiedSearchResult[] = [];

    try {
      // Search memories if requested
      if (includeMemories) {
        const memoryResults = await this.searchMemories(userId, query, Math.ceil(limit / 3));
        allResults.push(...this.convertMemoryResults(memoryResults, userId));
      }

      // Search artifacts if requested
      if (includeArtifacts) {
        const artifactResults = await this.searchArtifacts(userId, query, {
          limit: Math.ceil(limit / 3),
          types: artifactTypes,
          threshold
        });
        allResults.push(...this.convertArtifactResults(artifactResults, userId));
      }

      // Search basic documents if requested
      if (includeDocuments) {
        // Use basic MilvusService for simple document search
        await this.ensureUserCollection(userId);
        
        // Generate embedding for search (simplified for now)
        const queryEmbedding = await this.generateBasicEmbedding(query);
        const documentResults = await this.milvusService.searchMemories(
          userId, 
          queryEmbedding, 
          Math.ceil(limit / 3)
        );
        allResults.push(...this.convertDocumentResults(documentResults, userId));
      }

      // Apply filters and sorting
      let filteredResults = this.applyFilters(allResults, {
        timeFilter,
        metadataFilters,
        threshold
      });

      // Sort by relevance score and limit
      filteredResults.sort((a, b) => b.score - a.score);
      filteredResults = filteredResults.slice(0, limit);

      // Log search analytics
      await this.logSearchAnalytics(userId, query, filteredResults.length);

      this.logger.info({ 
        userId, 
        query, 
        resultsCount: filteredResults.length,
        sources: this.getResultSourceCounts(filteredResults)
      }, 'Unified search completed');

      return filteredResults;

    } catch (error) {
      this.logger.error({ error, userId, query }, 'Unified search failed');
      throw error;
    }
  }

  /**
   * Store content in the appropriate vector service
   */
  async store(
    userId: string,
    content: {
      type: 'memory' | 'artifact' | 'document';
      data: any;
      metadata?: any;
    }
  ): Promise<string> {
    try {
      this.logger.info({ userId, type: content.type }, 'Storing content in vector storage');

      let id: string;

      switch (content.type) {
        case 'memory':
          // Store in MilvusMemoryService via basic MilvusService
          await this.ensureUserCollection(userId);
          const memoryId = await this.milvusService.storeMemory(userId, content.data as MemoryEntry);
          id = memoryId.toString();
          break;

        case 'artifact':
          // Store in MilvusVectorService
          id = await this.milvusVectorService.storeArtifact(userId, content.data);
          break;

        case 'document':
          // Store as simple document in basic MilvusService
          await this.ensureUserCollection(userId);
          const docId = await this.milvusService.storeMemory(userId, {
            content: content.data.content,
            embedding: await this.generateBasicEmbedding(content.data.content),
            metadata: { type: 'document', ...content.metadata }
          });
          id = docId.toString();
          break;

        default:
          throw new Error(`Unsupported content type: ${content.type}`);
      }

      this.logger.info({ userId, id, type: content.type }, 'Content stored successfully');
      return id;

    } catch (error) {
      this.logger.error({ error, userId, contentType: content.type }, 'Failed to store content');
      throw error;
    }
  }

  /**
   * Get comprehensive storage statistics
   */
  async getStorageStats(userId: string): Promise<VectorStorageStats> {
    try {
      this.logger.debug({ userId }, 'Gathering storage statistics');

      // Get memory stats
      const memoryStats = await this.milvusMemoryService.getMemoryStats(userId);
      
      // Get artifact stats
      const artifactStats = await this.milvusVectorService.getUserArtifactStats(userId);
      
      // Get basic document stats
      const basicStats = await this.milvusService.getMemoryStats(userId);

      // Get search analytics
      const searchAnalytics = await this.getSearchAnalytics(userId);

      const stats: VectorStorageStats = {
        userId,
        totalVectors: memoryStats.totalMemories + artifactStats.totalArtifacts + basicStats.totalMemories,
        memoryCollections: [{
          name: memoryStats.collections[0] || `user_${userId}_memory`,
          vectorCount: memoryStats.totalMemories,
          lastAccessed: new Date()
        }],
        artifactCollections: [{
          name: `user_artifacts`,
          vectorCount: artifactStats.totalArtifacts,
          storageUsed: artifactStats.storageUsed,
          typeDistribution: artifactStats.typeDistribution
        }],
        searchStats: searchAnalytics,
        storageHealth: await this.assessStorageHealth(userId)
      };

      return stats;

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get storage statistics');
      throw error;
    }
  }

  /**
   * Delete all vectors for a user
   */
  async deleteUserVectors(userId: string, options?: {
    types?: ('memory' | 'artifact' | 'document')[];
    olderThan?: Date;
  }): Promise<void> {
    try {
      this.logger.info({ userId, options }, 'Deleting user vectors');

      const { types = ['memory', 'artifact', 'document'], olderThan } = options || {};

      if (types.includes('memory')) {
        // Delete memory collections
        try {
          await this.milvusService.deleteUserCollection(userId);
        } catch (error) {
          this.logger.warn({ error, userId }, 'Failed to delete memory collection');
        }
      }

      if (types.includes('artifact')) {
        // Delete artifacts
        await this.milvusVectorService.deleteUserArtifacts(userId);
      }

      if (types.includes('document')) {
        // Documents are part of basic memory collection, already handled above
      }

      // Clean up metadata
      await this.cleanupUserMetadata(userId, types);

      this.logger.info({ userId, types }, 'User vectors deleted successfully');

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to delete user vectors');
      throw error;
    }
  }

  // Private helper methods

  private async searchMemories(userId: string, query: string, limit: number): Promise<RankedMemory[]> {
    return await this.milvusMemoryService.searchUserMemories(userId, {
      text: query,
      limit
    });
  }

  private async searchArtifacts(userId: string, query: string, options: any) {
    return await this.milvusVectorService.searchArtifacts(userId, query, options);
  }

  private async ensureUserCollection(userId: string): Promise<void> {
    if (!this.milvusService.isConnected()) {
      await this.milvusService.connect();
    }
    await this.milvusService.createUserMemoryCollection(userId);
  }

  private convertMemoryResults(memories: RankedMemory[], userId: string): UnifiedSearchResult[] {
    return memories.map(memory => ({
      id: memory.id,
      type: 'memory' as const,
      title: `Memory: ${memory.entities?.[0] || 'Entity'}`,
      content: memory.content,
      score: memory.relevanceScore,
      metadata: memory.metadata,
      source: 'milvus_memory' as const,
      userId,
      createdAt: new Date(memory.createdAt),
      relevanceReasons: memory.reasons
    }));
  }

  private convertArtifactResults(artifacts: any[], userId: string): UnifiedSearchResult[] {
    return artifacts.map(artifact => ({
      id: artifact.id,
      type: 'artifact' as const,
      title: artifact.title,
      content: artifact.content,
      score: artifact.score,
      metadata: artifact.metadata,
      source: 'milvus_vector' as const,
      userId,
      createdAt: artifact.metadata?.createdAt ? new Date(artifact.metadata.createdAt) : undefined
    }));
  }

  private convertDocumentResults(documents: MemorySearchResult[], userId: string): UnifiedSearchResult[] {
    return documents.map(doc => ({
      id: doc.id.toString(),
      type: 'document' as const,
      title: `Document`,
      content: doc.content,
      score: doc.score,
      metadata: doc.metadata,
      source: 'milvus_basic' as const,
      userId
    }));
  }

  private applyFilters(results: UnifiedSearchResult[], filters: any): UnifiedSearchResult[] {
    let filtered = results;

    // Apply threshold filter
    if (filters.threshold) {
      filtered = filtered.filter(r => r.score >= filters.threshold);
    }

    // Apply time filter
    if (filters.timeFilter && (filters.timeFilter.from || filters.timeFilter.to)) {
      filtered = filtered.filter(r => {
        if (!r.createdAt) return true;
        if (filters.timeFilter.from && r.createdAt < filters.timeFilter.from) return false;
        if (filters.timeFilter.to && r.createdAt > filters.timeFilter.to) return false;
        return true;
      });
    }

    // Apply metadata filters
    if (filters.metadataFilters) {
      filtered = filtered.filter(r => {
        return Object.entries(filters.metadataFilters).every(([key, value]) => {
          return r.metadata?.[key] === value;
        });
      });
    }

    return filtered;
  }

  private getResultSourceCounts(results: UnifiedSearchResult[]): Record<string, number> {
    const counts: Record<string, number> = {};
    results.forEach(r => {
      counts[r.source] = (counts[r.source] || 0) + 1;
    });
    return counts;
  }

  private async generateBasicEmbedding(text: string): Promise<number[]> {
    // For now, use a simple hash-based embedding
    const hash = require('crypto').createHash('sha256').update(text).digest();
    const embedding = new Array(1536).fill(0);
    for (let i = 0; i < hash.length && i < embedding.length; i++) {
      embedding[i] = (hash[i] - 128) / 128;
    }
    return embedding;
  }

  private async logSearchAnalytics(userId: string, query: string, resultsCount: number): Promise<void> {
    try {
      // Store search analytics in vector search logs
      await prisma.vectorSearchLogs.create({
        data: {
          user_id: userId,
          query_text: query,
          results_count: resultsCount,
          metadata: { search_type: 'unified', timestamp: new Date().toISOString() },
          timestamp: new Date()
        }
      });
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to log search analytics');
    }
  }

  private async getSearchAnalytics(userId: string) {
    try {
      // Get search analytics from vector search logs
      const totalSearches = await prisma.vectorSearchLogs.count({
        where: { user_id: userId }
      });

      // Get recent queries for most searched terms
      const recentSearches = await prisma.vectorSearchLogs.findMany({
        where: { user_id: userId },
        orderBy: { timestamp: 'desc' },
        take: 100,
        select: { query_text: true }
      });

      const queryFreq = recentSearches.reduce((acc, search) => {
        acc[search.query_text] = (acc[search.query_text] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const mostSearchedTerms = Object.entries(queryFreq)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([query]) => query);

      return {
        totalSearches,
        avgResponseTime: 500, // Placeholder - would need actual timing data
        mostSearchedTerms
      };
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to get search analytics');
      return {
        totalSearches: 0,
        avgResponseTime: 0,
        mostSearchedTerms: []
      };
    }
  }

  private async assessStorageHealth(userId: string) {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check collection health
      const collections = await this.milvusService.listCollections();
      const userCollectionName = this.milvusService.getUserCollectionName(userId);
      
      if (!collections.includes(userCollectionName)) {
        issues.push('User memory collection not found');
        recommendations.push('Initialize user memory collection');
      }

      // Check vector storage usage
      const stats = await this.milvusVectorService.getUserArtifactStats(userId);
      if (stats.storageUsed > 1024 * 1024 * 1024) { // > 1GB
        issues.push('High storage usage detected');
        recommendations.push('Consider cleaning up old artifacts');
      }

    } catch (error) {
      issues.push('Failed to assess storage health');
      recommendations.push('Check vector service connections');
    }

    return {
      status: issues.length === 0 ? 'healthy' as const : 'warning' as const,
      issues,
      recommendations
    };
  }

  private async cleanupUserMetadata(userId: string, types: string[]): Promise<void> {
    try {
      if (types.includes('artifact')) {
        await prisma.artifactMetadata.deleteMany({ 
          where: { created_by: userId } 
        });
        
        // Delete artifact shares - check schema for correct field name
        try {
          // Use the correct field name from Prisma schema
          await prisma.artifactShares.deleteMany({ 
            where: { 
              OR: [
                { shared_with: userId },
                { shared_by: userId }
              ]
            } 
          });
        } catch (error) {
          this.logger.warn({ error, userId }, 'Failed to delete artifact shares - check schema field names');
        }
      }
      
      // Clean up search logs for this user
      await prisma.vectorSearchLogs.deleteMany({ 
        where: { user_id: userId } 
      });
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to cleanup user metadata');
    }
  }
}