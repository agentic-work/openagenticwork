/**
 * Prompt Technique Vector Service
 * 
 * Manages vector collections for prompt engineering techniques:
 * - Few-shot examples
 * - Chain-of-thought patterns
 * - Tree-of-thought structures
 * - Perspective-taking templates
 * - SWOT analysis frameworks
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';
import { VectorCollectionManager, CollectionConfig } from './VectorCollectionManager.js';
import { MilvusVectorService } from './MilvusVectorService.js';
// import { FewShotService } from './FewShotService.js'; // REMOVED: Prompt techniques disabled

export interface TechniqueVector {
  id: string;
  techniqueId: string;
  category: 'few-shot' | 'cot-pattern' | 'tot-structure' | 'perspective' | 'analysis' | 'brainstorm';
  content: string;
  embedding: number[];
  metadata: {
    quality: number;
    usage_count: number;
    success_rate: number;
    domain?: string;
    tags?: string[];
    created_by?: string;
    validated: boolean;
  };
  similarity?: number;
}

export interface TechniqueSearchParams {
  query: string;
  techniqueTypes: string[];
  minQuality?: number;
  maxResults?: number;
  domain?: string;
  includeMetadata?: boolean;
}

export interface TechniqueSearchResult {
  vectors: TechniqueVector[];
  totalFound: number;
  searchTime: number;
  qualityStats: {
    avgQuality: number;
    minQuality: number;
    maxQuality: number;
  };
}

export class PromptTechniqueVectorService {
  private logger: Logger;
  private collectionManager: VectorCollectionManager;
  private milvusService: MilvusVectorService;
  // private fewShotService: FewShotService; // REMOVED: Prompt techniques disabled
  
  // Collection configurations for different technique types
  private readonly TECHNIQUE_COLLECTIONS = {
    'few_shot_examples': {
      name: 'agenticwork_few_shot_examples',
      dimension: 1536,
      indexType: 'HNSW' as const,
      metricType: 'COSINE' as const,
      indexParams: {
        M: 16,
        efConstruction: 200
      },
      autoCleanup: true,
      retentionPeriod: 90,
      maxSize: 100000,
      compressionEnabled: true
    },
    'cot_patterns': {
      name: 'agenticwork_cot_patterns',
      dimension: 1536,
      indexType: 'IVF_FLAT' as const,
      metricType: 'COSINE' as const,
      indexParams: {
        nlist: 1024
      },
      autoCleanup: true,
      retentionPeriod: 60,
      maxSize: 50000,
      compressionEnabled: false
    },
    'tot_structures': {
      name: 'agenticwork_tot_structures',
      dimension: 1536,
      indexType: 'HNSW' as const,
      metricType: 'COSINE' as const,
      indexParams: {
        M: 16,
        efConstruction: 200
      },
      autoCleanup: true,
      retentionPeriod: 30,
      maxSize: 25000,
      compressionEnabled: true
    },
    'analysis_templates': {
      name: 'agenticwork_analysis_templates',
      dimension: 1536,
      indexType: 'IVF_SQ8' as const,
      metricType: 'COSINE' as const,
      indexParams: {
        nlist: 512
      },
      autoCleanup: true,
      retentionPeriod: 120,
      maxSize: 75000,
      compressionEnabled: true
    },
    'perspective_frameworks': {
      name: 'agenticwork_perspective_frameworks',
      dimension: 1536,
      indexType: 'HNSW' as const,
      metricType: 'COSINE' as const,
      indexParams: {
        M: 16,
        efConstruction: 200
      },
      autoCleanup: true,
      retentionPeriod: 60,
      maxSize: 30000,
      compressionEnabled: true
    }
  };

  constructor(
    logger: Logger,
    collectionManager: VectorCollectionManager,
    milvusService: MilvusVectorService,
    fewShotService?: any // REMOVED: FewShotService type
  ) {
    this.logger = logger.child({ service: 'PromptTechniqueVectorService' });
    this.collectionManager = collectionManager;
    this.milvusService = milvusService;
    // this.fewShotService = fewShotService; // REMOVED: Prompt techniques disabled
  }

  /**
   * Initialize all technique vector collections
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing prompt technique vector collections...');
    
    try {
      // Create all collections
      for (const [key, config] of Object.entries(this.TECHNIQUE_COLLECTIONS)) {
        this.logger.info({ collection: config.name }, 'Creating technique collection');
        await this.collectionManager.createOptimalCollection(config.name, 'user_memory', config);
      }
      
      // Load initial data for each collection
      await this.seedInitialData();
      
      this.logger.info('Prompt technique vector collections initialized successfully');
      
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to initialize technique vector collections');
      throw error;
    }
  }

  /**
   * Search for relevant few-shot examples
   */
  async searchFewShotExamples(
    query: string,
    domain: string = 'general',
    maxResults: number = 5
  ): Promise<TechniqueVector[]> {
    const searchParams: TechniqueSearchParams = {
      query,
      techniqueTypes: ['few-shot'],
      maxResults,
      domain,
      includeMetadata: true,
      minQuality: 0.7
    };
    
    const result = await this.searchTechniques(searchParams);
    return result.vectors;
  }

  /**
   * Search for chain-of-thought patterns
   */
  async searchCoTPatterns(
    query: string,
    maxResults: number = 3
  ): Promise<TechniqueVector[]> {
    const searchParams: TechniqueSearchParams = {
      query,
      techniqueTypes: ['cot-pattern'],
      maxResults,
      includeMetadata: true,
      minQuality: 0.8
    };
    
    const result = await this.searchTechniques(searchParams);
    return result.vectors;
  }

  /**
   * Search for tree-of-thought structures
   */
  async searchToTStructures(
    query: string,
    maxResults: number = 3
  ): Promise<TechniqueVector[]> {
    const searchParams: TechniqueSearchParams = {
      query,
      techniqueTypes: ['tot-structure'],
      maxResults,
      includeMetadata: true,
      minQuality: 0.75
    };
    
    const result = await this.searchTechniques(searchParams);
    return result.vectors;
  }

  /**
   * Search for perspective-taking frameworks
   */
  async searchPerspectiveFrameworks(
    query: string,
    maxResults: number = 4
  ): Promise<TechniqueVector[]> {
    const searchParams: TechniqueSearchParams = {
      query,
      techniqueTypes: ['perspective'],
      maxResults,
      includeMetadata: true,
      minQuality: 0.7
    };
    
    const result = await this.searchTechniques(searchParams);
    return result.vectors;
  }

  /**
   * Search for analysis templates (SWOT, pros/cons, etc.)
   */
  async searchAnalysisTemplates(
    query: string,
    analysisType: 'swot' | 'pros-cons' | 'general' = 'general',
    maxResults: number = 3
  ): Promise<TechniqueVector[]> {
    const searchParams: TechniqueSearchParams = {
      query: `${query} ${analysisType}`,
      techniqueTypes: ['analysis'],
      maxResults,
      includeMetadata: true,
      minQuality: 0.8
    };
    
    const result = await this.searchTechniques(searchParams);
    return result.vectors;
  }

  /**
   * Generic technique search
   */
  private async searchTechniques(params: TechniqueSearchParams): Promise<TechniqueSearchResult> {
    const startTime = Date.now();

    try {
      // REMOVED: FewShotService embedding generation - prompt techniques disabled
      // const queryEmbedding = await this.fewShotService.getEmbedding(params.query);
      
      // Search across relevant collections
      const results: TechniqueVector[] = [];
      
      for (const techniqueType of params.techniqueTypes) {
        const collectionName = this.getCollectionName(techniqueType);
        if (!collectionName) continue;
        
        // Use searchArtifacts method which is available
        const searchResults = await this.milvusService.searchArtifacts(
          'system', // Use system user for technique searches
          params.query,
          {
            limit: params.maxResults || 10,
            threshold: params.minQuality || 0.7
          }
        );
        
        // Transform results to TechniqueVector format
        const vectors = searchResults.map((result: any) => ({
          id: result.id,
          techniqueId: result.technique_id,
          category: techniqueType as TechniqueVector['category'],
          content: result.content,
          embedding: result.embedding,
          metadata: result.metadata,
          similarity: result.distance
        }));
        
        results.push(...vectors);
      }
      
      // Sort by similarity and limit results
      const sortedResults = results
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
        .slice(0, params.maxResults || 10);
      
      // Calculate quality stats
      const qualities = sortedResults.map(v => v.metadata.quality);
      const qualityStats = {
        avgQuality: qualities.reduce((sum, q) => sum + q, 0) / qualities.length,
        minQuality: Math.min(...qualities),
        maxQuality: Math.max(...qualities)
      };
      
      return {
        vectors: sortedResults,
        totalFound: results.length,
        searchTime: Date.now() - startTime,
        qualityStats
      };
      
    } catch (error) {
      this.logger.error({ error: error.message, params }, 'Failed to search techniques');
      throw error;
    }
  }

  /**
   * Add a new technique vector
   */
  async addTechnique(technique: Omit<TechniqueVector, 'embedding'>): Promise<void> {
    try {
      // REMOVED: FewShotService embedding generation - prompt techniques disabled
      // const embedding = await this.fewShotService.getEmbedding(technique.content);
      
      const collectionName = this.getCollectionName(technique.category);
      if (!collectionName) {
        throw new Error(`Unknown technique category: ${technique.category}`);
      }
      
      // Store as artifact in Milvus
      await this.milvusService.storeArtifact('system', {
        type: 'knowledge' as any, // Cast to available artifact type
        title: `${technique.category}: ${technique.techniqueId}`,
        content: technique.content,
        metadata: technique.metadata as any // Technique-specific metadata
      });
      
      this.logger.info({ 
        techniqueId: technique.techniqueId,
        category: technique.category,
        collection: collectionName
      }, 'Added technique to vector collection');
      
    } catch (error) {
      this.logger.error({ error: error.message, technique }, 'Failed to add technique');
      throw error;
    }
  }

  /**
   * Seed initial technique data
   */
  private async seedInitialData(): Promise<void> {
    this.logger.info('Seeding initial technique data...');
    
    // Few-shot examples
    const fewShotExamples = [
      {
        id: 'fs-1',
        techniqueId: 'few-shot',
        category: 'few-shot' as const,
        content: 'Question: What is 2+2? Answer: 4. Reasoning: Adding 2 and 2 gives us 4.',
        metadata: { quality: 0.9, usage_count: 0, success_rate: 0.95, domain: 'math', validated: true }
      },
      {
        id: 'fs-2',
        techniqueId: 'few-shot',
        category: 'few-shot' as const,
        content: 'Question: Explain photosynthesis. Answer: Photosynthesis is the process by which plants convert light energy into chemical energy.',
        metadata: { quality: 0.8, usage_count: 0, success_rate: 0.88, domain: 'science', validated: true }
      }
    ];

    // Chain-of-thought patterns
    const cotPatterns = [
      {
        id: 'cot-1',
        techniqueId: 'chain-of-thought',
        category: 'cot-pattern' as const,
        content: 'Let me think step by step: First, I need to identify the key components. Second, I will analyze each component. Finally, I will synthesize the results.',
        metadata: { quality: 0.85, usage_count: 0, success_rate: 0.87, validated: true }
      }
    ];

    // Analysis templates
    const analysisTemplates = [
      {
        id: 'swot-1',
        techniqueId: 'swot-analysis',
        category: 'analysis' as const,
        content: 'SWOT Analysis Framework: Strengths (internal positive factors), Weaknesses (internal negative factors), Opportunities (external positive factors), Threats (external negative factors).',
        metadata: { quality: 0.9, usage_count: 0, success_rate: 0.92, domain: 'business', validated: true }
      }
    ];

    // Add all seed data
    const allTechniques = [...fewShotExamples, ...cotPatterns, ...analysisTemplates];
    
    for (const technique of allTechniques) {
      await this.addTechnique(technique);
    }
    
    this.logger.info({ count: allTechniques.length }, 'Seeded initial technique data');
  }

  /**
   * Get collection name for technique category
   */
  private getCollectionName(category: string): string | null {
    const mapping: Record<string, string> = {
      'few-shot': 'few_shot_examples',
      'cot-pattern': 'cot_patterns',
      'tot-structure': 'tot_structures',
      'analysis': 'analysis_templates',
      'perspective': 'perspective_frameworks'
    };
    
    const key = mapping[category];
    return key ? this.TECHNIQUE_COLLECTIONS[key]?.name : null;
  }

  /**
   * Get health status of all technique collections
   */
  async getHealthStatus(): Promise<Record<string, any>> {
    const health: Record<string, any> = {};
    
    for (const [key, config] of Object.entries(this.TECHNIQUE_COLLECTIONS)) {
      try {
        const collectionHealth = await this.collectionManager.checkCollectionHealth(config.name);
        health[key] = collectionHealth;
      } catch (error) {
        health[key] = { status: 'error', error: error.message };
      }
    }
    
    return health;
  }

}