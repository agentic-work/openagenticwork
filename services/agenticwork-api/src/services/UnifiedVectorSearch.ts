/**
 * UnifiedVectorSearch - Cross-service vector search and ranking
 * 
 * Provides unified search across memories, artifacts, and documents simultaneously,
 * with intelligent ranking, faceted search, and permission-aware results.
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { UnifiedVectorStorage, UnifiedSearchResult, UnifiedSearchOptions } from './UnifiedVectorStorage.js';
import { prisma } from '../utils/prisma.js';

export interface FacetedSearchOptions extends UnifiedSearchOptions {
  facets?: {
    types?: ('memory' | 'artifact' | 'document')[];
    sources?: ('milvus_memory' | 'milvus_vector' | 'milvus_basic')[];
    dateRanges?: {
      name: string;
      from: Date;
      to: Date;
    }[];
    metadata?: {
      field: string;
      values: any[];
    }[];
  };
  ranking?: {
    strategy: 'relevance' | 'recency' | 'popularity' | 'hybrid';
    weights?: {
      relevance: number;
      recency: number;
      popularity: number;
      userPreference: number;
    };
  };
  pagination?: {
    offset: number;
    limit: number;
  };
  permissions?: {
    userId: string;
    includeShared: boolean;
    requiredPermissions?: string[];
  };
}

export interface SearchFacets {
  types: Array<{
    type: string;
    count: number;
    avgScore: number;
  }>;
  sources: Array<{
    source: string;
    count: number;
    avgScore: number;
  }>;
  dateRanges: Array<{
    range: string;
    count: number;
    from: Date;
    to: Date;
  }>;
  metadata: Array<{
    field: string;
    values: Array<{
      value: any;
      count: number;
    }>;
  }>;
}

export interface FacetedSearchResponse {
  results: UnifiedSearchResult[];
  facets: SearchFacets;
  totalResults: number;
  searchTime: number;
  query: string;
  appliedFilters: Record<string, any>;
  suggestions?: string[];
  pagination: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface SearchAnalytics {
  queryId: string;
  userId: string;
  query: string;
  resultsFound: number;
  searchTime: number;
  clickedResults: string[];
  satisfactionRating?: number;
  timestamp: Date;
}

export class UnifiedVectorSearch {
  private vectorStorage: UnifiedVectorStorage;
  private logger: Logger;
  private searchCache: Map<string, { result: FacetedSearchResponse; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(vectorStorage: UnifiedVectorStorage, logger: Logger) {
    this.vectorStorage = vectorStorage;
    this.logger = logger.child({ service: 'UnifiedVectorSearch' }) as Logger;
  }

  /**
   * Perform faceted search with intelligent ranking
   */
  async facetedSearch(options: FacetedSearchOptions): Promise<FacetedSearchResponse> {
    const startTime = Date.now();
    const queryId = this.generateQueryId(options);
    
    try {
      this.logger.info({ queryId, userId: options.userId, query: options.query }, 'Starting faceted search');

      // Check cache first
      const cached = this.getCachedResult(queryId);
      if (cached) {
        this.logger.debug({ queryId }, 'Returning cached search results');
        return cached;
      }

      // Apply permission filtering
      const permissionFilteredOptions = await this.applyPermissionFilters(options);

      // Extract UnifiedSearchOptions from FacetedSearchOptions
      const searchOptions: UnifiedSearchOptions = {
        query: permissionFilteredOptions.query,
        userId: permissionFilteredOptions.userId,
        limit: permissionFilteredOptions.limit || 50, // Higher initial limit for faceting
        threshold: permissionFilteredOptions.threshold,
        includeMemories: permissionFilteredOptions.includeMemories,
        includeArtifacts: permissionFilteredOptions.includeArtifacts,
        includeDocuments: permissionFilteredOptions.includeDocuments,
        timeFilter: permissionFilteredOptions.timeFilter,
        metadataFilters: permissionFilteredOptions.metadataFilters
      };

      // Perform base search
      const baseResults = await this.vectorStorage.search(searchOptions);

      // Apply faceted filtering
      const filteredResults = this.applyFacetFilters(baseResults, options.facets);

      // Generate facets from all results (before pagination)
      const facets = this.generateFacets(baseResults, options.facets);

      // Apply ranking strategy
      const rankedResults = await this.applyRankingStrategy(filteredResults, options.ranking);

      // Apply pagination
      const paginatedResults = this.applyPagination(rankedResults, options.pagination);

      // Generate suggestions
      const suggestions = await this.generateSearchSuggestions(options.query, baseResults.length);

      const searchTime = Date.now() - startTime;
      
      const response: FacetedSearchResponse = {
        results: paginatedResults,
        facets,
        totalResults: filteredResults.length,
        searchTime,
        query: options.query,
        appliedFilters: this.extractAppliedFilters(options),
        suggestions,
        pagination: {
          offset: options.pagination?.offset || 0,
          limit: options.pagination?.limit || 20,
          hasMore: filteredResults.length > (options.pagination?.offset || 0) + (options.pagination?.limit || 20)
        }
      };

      // Cache the result
      this.cacheResult(queryId, response);

      // Log analytics
      await this.logSearchAnalytics({
        queryId,
        userId: options.userId,
        query: options.query,
        resultsFound: response.totalResults,
        searchTime,
        clickedResults: [],
        timestamp: new Date()
      });

      this.logger.info({ 
        queryId, 
        userId: options.userId, 
        resultsFound: response.totalResults,
        searchTime 
      }, 'Faceted search completed');

      return response;

    } catch (error) {
      this.logger.error({ error, queryId, userId: options.userId }, 'Faceted search failed');
      throw error;
    }
  }

  /**
   * Search similar vectors to a given result
   */
  async findSimilar(
    resultId: string,
    userId: string,
    options: {
      limit?: number;
      excludeOriginal?: boolean;
      sameType?: boolean;
      minScore?: number;
    } = {}
  ): Promise<UnifiedSearchResult[]> {
    try {
      this.logger.debug({ resultId, userId }, 'Finding similar vectors');

      // Get the original result to extract its embedding/content
      const originalResult = await this.getResultById(resultId, userId);
      if (!originalResult) {
        throw new Error('Original result not found');
      }

      // Use the content of the original result as query
      const similarResults = await this.vectorStorage.search({
        query: originalResult.content,
        userId,
        limit: (options.limit || 10) + (options.excludeOriginal ? 1 : 0),
        threshold: options.minScore || 0.7,
        includeMemories: !options.sameType || originalResult.type === 'memory',
        includeArtifacts: !options.sameType || originalResult.type === 'artifact',
        includeDocuments: !options.sameType || originalResult.type === 'document'
      });

      let filtered = similarResults;

      // Remove original result if requested
      if (options.excludeOriginal) {
        filtered = filtered.filter(r => r.id !== resultId);
      }

      // Limit results
      if (options.limit) {
        filtered = filtered.slice(0, options.limit);
      }

      return filtered;

    } catch (error) {
      this.logger.error({ error, resultId, userId }, 'Failed to find similar vectors');
      throw error;
    }
  }

  /**
   * Advanced semantic search with query expansion
   */
  async semanticSearch(
    query: string,
    userId: string,
    options: {
      expandQuery?: boolean;
      contextualKeywords?: string[];
      domainFocus?: string;
      multiModalSearch?: boolean;
    } = {}
  ): Promise<UnifiedSearchResult[]> {
    try {
      this.logger.info({ query, userId, options }, 'Performing semantic search');

      let expandedQuery = query;

      // Query expansion
      if (options.expandQuery) {
        expandedQuery = await this.expandQuery(query, options.contextualKeywords, options.domainFocus);
        this.logger.debug({ originalQuery: query, expandedQuery }, 'Query expanded');
      }

      // Base search with expanded query
      const results = await this.vectorStorage.search({
        query: expandedQuery,
        userId,
        includeMemories: true,
        includeArtifacts: true,
        includeDocuments: true,
        limit: 50 // Get more results for reranking
      });

      // Semantic reranking based on context
      const rerankedResults = await this.semanticRerank(results, query, options);

      return rerankedResults.slice(0, 20); // Return top 20

    } catch (error) {
      this.logger.error({ error, query, userId }, 'Semantic search failed');
      throw error;
    }
  }

  /**
   * Real-time search with streaming results
   */
  async *streamingSearch(
    query: string,
    userId: string,
    options: Partial<UnifiedSearchOptions> = {}
  ): AsyncIterableIterator<{
    batch: UnifiedSearchResult[];
    progress: number;
    isComplete: boolean;
  }> {
    try {
      this.logger.info({ query, userId }, 'Starting streaming search');

      // Search different sources in batches
      const sources = ['memory', 'artifact', 'document'] as const;
      const batchSize = Math.ceil((options.limit || 20) / sources.length);
      
      let allResults: UnifiedSearchResult[] = [];
      let completedSources = 0;

      for (const sourceType of sources) {
        try {
          const sourceOptions: UnifiedSearchOptions = {
            query: options.query || '',
            userId: options.userId,
            limit: batchSize,
            includeMemories: sourceType === 'memory',
            includeArtifacts: sourceType === 'artifact',
            includeDocuments: sourceType === 'document',
            artifactTypes: options.artifactTypes,
            threshold: options.threshold,
            timeFilter: options.timeFilter
          };

          const batchResults = await this.vectorStorage.search(sourceOptions);
          allResults.push(...batchResults);
          completedSources++;

          // Sort current results
          allResults.sort((a, b) => b.score - a.score);

          yield {
            batch: batchResults,
            progress: completedSources / sources.length,
            isComplete: false
          };

        } catch (error) {
          this.logger.warn({ error, sourceType }, 'Source search failed in streaming mode');
        }
      }

      // Final sorted results
      allResults.sort((a, b) => b.score - a.score);
      if (options.limit) {
        allResults = allResults.slice(0, options.limit);
      }

      yield {
        batch: allResults,
        progress: 1.0,
        isComplete: true
      };

    } catch (error) {
      this.logger.error({ error, query, userId }, 'Streaming search failed');
      throw error;
    }
  }

  /**
   * Track search result interactions for learning
   */
  async trackInteraction(
    queryId: string,
    resultId: string,
    interaction: 'click' | 'view' | 'bookmark' | 'share' | 'rate',
    metadata?: any
  ): Promise<void> {
    try {
      // Store search interaction using Prisma
      // Since there's no specific search_interactions table in our schema,
      // we'll store it as JSON metadata in chat messages or user activity
      
      // For now, we'll just log it and update popularity scores
      this.logger.info({ queryId, resultId, interaction, metadata }, 'Search interaction recorded');

      // Update result popularity scores
      await this.updatePopularityScores(resultId, interaction);

      this.logger.debug({ queryId, resultId, interaction }, 'Search interaction tracked');

    } catch (error) {
      this.logger.warn({ error, queryId, resultId }, 'Failed to track search interaction');
    }
  }

  // Private helper methods

  private generateQueryId(options: FacetedSearchOptions): string {
    const hash = require('crypto').createHash('md5');
    hash.update(JSON.stringify(options));
    return hash.digest('hex');
  }

  private getCachedResult(queryId: string): FacetedSearchResponse | null {
    const cached = this.searchCache.get(queryId);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.result;
    }
    this.searchCache.delete(queryId);
    return null;
  }

  private cacheResult(queryId: string, result: FacetedSearchResponse): void {
    this.searchCache.set(queryId, { result, timestamp: Date.now() });
  }

  private async applyPermissionFilters(options: FacetedSearchOptions): Promise<UnifiedSearchOptions> {
    // Apply permission-based filtering for search results
    const baseOptions: UnifiedSearchOptions = {
      query: options.query,
      userId: options.userId,
      limit: options.limit || 20,
      includeMemories: options.includeMemories,
      includeArtifacts: options.includeArtifacts,
      includeDocuments: options.includeDocuments,
      artifactTypes: options.artifactTypes,
      threshold: options.threshold,
      timeFilter: options.timeFilter,
      metadataFilters: options.metadataFilters
    };
    
    if (options.permissions) {
      const { userId, includeShared, requiredPermissions } = options.permissions;
      
      // Add permission filters to metadata filters
      const permissionFilters = baseOptions.metadataFilters || {};
      
      // Filter by user ownership
      if (!includeShared) {
        permissionFilters.userId = userId;
      }
      
      // Add required permissions filter
      if (requiredPermissions && requiredPermissions.length > 0) {
        permissionFilters.permissions = requiredPermissions;
      }
      
      baseOptions.metadataFilters = permissionFilters;
      baseOptions.userId = userId;
      
      this.logger.debug({ userId, includeShared, requiredPermissions }, 'Applied permission filters');
    }
    
    return baseOptions;
  }

  private applyFacetFilters(results: UnifiedSearchResult[], facets?: FacetedSearchOptions['facets']): UnifiedSearchResult[] {
    if (!facets) return results;

    let filtered = results;

    // Filter by types
    if (facets.types && facets.types.length > 0) {
      filtered = filtered.filter(r => facets.types!.includes(r.type));
    }

    // Filter by sources
    if (facets.sources && facets.sources.length > 0) {
      filtered = filtered.filter(r => facets.sources!.includes(r.source));
    }

    // Filter by date ranges
    if (facets.dateRanges && facets.dateRanges.length > 0) {
      filtered = filtered.filter(r => {
        if (!r.createdAt) return true;
        return facets.dateRanges!.some(range => 
          r.createdAt! >= range.from && r.createdAt! <= range.to
        );
      });
    }

    // Filter by metadata
    if (facets.metadata && facets.metadata.length > 0) {
      filtered = filtered.filter(r => {
        return facets.metadata!.every(metaFilter => 
          metaFilter.values.includes(r.metadata?.[metaFilter.field])
        );
      });
    }

    return filtered;
  }

  private generateFacets(results: UnifiedSearchResult[], facetConfig?: FacetedSearchOptions['facets']): SearchFacets {
    // Generate type facets
    const typeGroups = this.groupBy(results, 'type');
    const types = Object.entries(typeGroups).map(([type, items]) => ({
      type,
      count: (items as UnifiedSearchResult[]).length,
      avgScore: (items as UnifiedSearchResult[]).reduce((sum, item) => sum + item.score, 0) / (items as UnifiedSearchResult[]).length
    }));

    // Generate source facets
    const sourceGroups = this.groupBy(results, 'source');
    const sources = Object.entries(sourceGroups).map(([source, items]) => ({
      source,
      count: (items as UnifiedSearchResult[]).length,
      avgScore: (items as UnifiedSearchResult[]).reduce((sum, item) => sum + item.score, 0) / (items as UnifiedSearchResult[]).length
    }));

    // Generate date range facets
    const dateRanges = this.generateDateRangeFacets(results);

    // Generate metadata facets
    const metadata = this.generateMetadataFacets(results, facetConfig?.metadata);

    return { types, sources, dateRanges, metadata };
  }

  private async applyRankingStrategy(
    results: UnifiedSearchResult[],
    ranking?: FacetedSearchOptions['ranking']
  ): Promise<UnifiedSearchResult[]> {
    if (!ranking || ranking.strategy === 'relevance') {
      return results.sort((a, b) => b.score - a.score);
    }

    const weights = ranking.weights || {
      relevance: 0.4,
      recency: 0.3,
      popularity: 0.2,
      userPreference: 0.1
    };

    // Calculate composite scores
    const rankedResults = await Promise.all(
      results.map(async (result) => {
        const relevanceScore = result.score;
        const recencyScore = this.calculateRecencyScore(result.createdAt);
        const popularityScore = await this.getPopularityScore(result.id);
        const userPreferenceScore = this.calculateUserPreferenceScore(result);

        const compositeScore = 
          relevanceScore * weights.relevance +
          recencyScore * weights.recency +
          popularityScore * weights.popularity +
          userPreferenceScore * weights.userPreference;

        return { ...result, compositeScore };
      })
    );

    // Sort by composite score
    return rankedResults.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  private applyPagination(
    results: UnifiedSearchResult[],
    pagination?: FacetedSearchOptions['pagination']
  ): UnifiedSearchResult[] {
    if (!pagination) return results.slice(0, 20);

    const { offset, limit } = pagination;
    return results.slice(offset, offset + limit);
  }

  private async generateSearchSuggestions(query: string, resultCount: number): Promise<string[]> {
    // Generate search suggestions based on query patterns and result counts
    const suggestions: string[] = [];
    
    if (resultCount === 0) {
      // No results - suggest broader or alternative queries
      suggestions.push(
        query.toLowerCase(),                    // Try lowercase
        query.replace(/s$/, ''),               // Remove plural
        `${query} guide`,                      // Add guide
        `${query} tutorial`,                   // Add tutorial
        `${query} documentation`               // Add documentation
      );
    } else if (resultCount < 5) {
      // Few results - suggest broader queries
      suggestions.push(
        `${query} overview`,
        `${query} introduction`,
        `${query} basics`
      );
    } else {
      // Many results - suggest more specific queries
      suggestions.push(
        `${query} advanced`,
        `${query} examples`,
        `${query} best practices`,
        `${query} troubleshooting`
      );
    }
    
    // Remove duplicates and limit to 5 suggestions
    return [...new Set(suggestions)].slice(0, 5);
  }

  private extractAppliedFilters(options: FacetedSearchOptions): Record<string, any> {
    const filters: Record<string, any> = {};
    
    if (options.facets?.types) filters.types = options.facets.types;
    if (options.facets?.sources) filters.sources = options.facets.sources;
    if (options.facets?.dateRanges) filters.dateRanges = options.facets.dateRanges.map(range => range.name);
    if (options.facets?.metadata) filters.metadata = options.facets.metadata;
    if (options.timeFilter) filters.timeFilter = options.timeFilter;
    if (options.metadataFilters) filters.metadataFilters = options.metadataFilters;

    return filters;
  }

  private async getResultById(resultId: string, userId: string): Promise<UnifiedSearchResult | null> {
    // Retrieve a specific result by ID across all vector sources
    try {
      // Try to find the result by searching with the ID as a content filter
      // This assumes the ID is stored in metadata or can be matched directly
      const results = await this.vectorStorage.search({
        query: resultId, // Use ID as query for exact match
        userId,
        limit: 100, // Higher limit to ensure we find it
        threshold: 0, // Lower threshold to include exact matches
        includeMemories: true,
        includeArtifacts: true,
        includeDocuments: true
      });
      
      // Find exact ID match
      const exactMatch = results.find(r => r.id === resultId);
      if (exactMatch) {
        return exactMatch;
      }
      
      // If no exact match, try searching by content similarity
      // This is a fallback for cases where the ID isn't directly searchable
      const fallbackResults = await this.vectorStorage.search({
        query: `id:${resultId}`, // Try structured query
        userId,
        limit: 10,
        threshold: 0.9,
        includeMemories: true,
        includeArtifacts: true,
        includeDocuments: true
      });
      
      return fallbackResults.find(r => r.id === resultId) || null;
      
    } catch (error) {
      this.logger.debug({ error, resultId, userId }, 'Failed to get result by ID');
      return null;
    }
  }

  private async expandQuery(
    query: string,
    contextualKeywords?: string[],
    domainFocus?: string
  ): Promise<string> {
    // Simple query expansion - in production, use NLP models
    let expanded = query;
    
    if (contextualKeywords && contextualKeywords.length > 0) {
      expanded += ' ' + contextualKeywords.join(' ');
    }

    if (domainFocus) {
      expanded += ` ${domainFocus} domain`;
    }

    return expanded;
  }

  private async semanticRerank(
    results: UnifiedSearchResult[],
    originalQuery: string,
    options: any
  ): Promise<UnifiedSearchResult[]> {
    // Implement semantic reranking using content analysis and context matching
    try {
      const rankedResults = results.map(result => {
        let semanticScore = result.score;
        
        // Boost score based on query-content semantic similarity
        const queryTerms = originalQuery.toLowerCase().split(/\s+/);
        const contentTerms = result.content.toLowerCase().split(/\s+/);
        
        // Calculate term overlap bonus
        const overlapCount = queryTerms.filter(term => 
          contentTerms.some(contentTerm => 
            contentTerm.includes(term) || term.includes(contentTerm)
          )
        ).length;
        const overlapBonus = (overlapCount / queryTerms.length) * 0.2;
        
        // Context matching bonus
        let contextBonus = 0;
        if (options.contextualKeywords) {
          const contextMatches = options.contextualKeywords.filter((keyword: string) =>
            result.content.toLowerCase().includes(keyword.toLowerCase())
          ).length;
          contextBonus = (contextMatches / options.contextualKeywords.length) * 0.15;
        }
        
        // Domain focus bonus  
        let domainBonus = 0;
        if (options.domainFocus) {
          const domainTerms = options.domainFocus.toLowerCase().split(/\s+/);
          const domainMatches = domainTerms.filter(term =>
            result.content.toLowerCase().includes(term) ||
            result.metadata?.category?.toLowerCase().includes(term)
          ).length;
          domainBonus = (domainMatches / domainTerms.length) * 0.1;
        }
        
        // Metadata relevance bonus
        let metadataBonus = 0;
        if (result.metadata) {
          const metadataText = Object.values(result.metadata).join(' ').toLowerCase();
          const metadataOverlap = queryTerms.filter(term =>
            metadataText.includes(term)
          ).length;
          metadataBonus = (metadataOverlap / queryTerms.length) * 0.1;
        }
        
        // Calculate final semantic score
        semanticScore = Math.min(1.0, semanticScore + overlapBonus + contextBonus + domainBonus + metadataBonus);
        
        return {
          ...result,
          score: semanticScore,
          semanticBreakdown: {
            originalScore: result.score,
            overlapBonus,
            contextBonus,
            domainBonus,
            metadataBonus
          }
        };
      });
      
      // Sort by new semantic scores
      return rankedResults.sort((a, b) => b.score - a.score);
      
    } catch (error) {
      this.logger.warn({ error, query: originalQuery }, 'Semantic reranking failed, returning original results');
      return results;
    }
  }

  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((groups, item) => {
      const groupKey = String(item[key]);
      groups[groupKey] = groups[groupKey] || [];
      groups[groupKey].push(item);
      return groups;
    }, {} as Record<string, T[]>);
  }

  private generateDateRangeFacets(results: UnifiedSearchResult[]): Array<{
    range: string;
    count: number;
    from: Date;
    to: Date;
  }> {
    // Generate date ranges (last hour, day, week, month, year)
    const now = new Date();
    const ranges = [
      { name: 'Last Hour', from: new Date(now.getTime() - 60 * 60 * 1000), to: now },
      { name: 'Last Day', from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now },
      { name: 'Last Week', from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now },
      { name: 'Last Month', from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now }
    ];

    return ranges.map(range => ({
      range: range.name,
      count: results.filter(r => 
        r.createdAt && r.createdAt >= range.from && r.createdAt <= range.to
      ).length,
      from: range.from,
      to: range.to
    }));
  }

  private generateMetadataFacets(
    results: UnifiedSearchResult[],
    metadataConfig?: Array<{ field: string; values: any[] }>
  ): Array<{
    field: string;
    values: Array<{
      value: any;
      count: number;
    }>;
  }> {
    // Generate metadata facets based on common metadata fields found in results
    const metadataFields = new Map<string, Map<string, number>>();
    
    // Collect all metadata values from results
    results.forEach(result => {
      if (result.metadata) {
        Object.entries(result.metadata).forEach(([field, value]) => {
          if (!metadataFields.has(field)) {
            metadataFields.set(field, new Map());
          }
          const valueStr = String(value);
          const fieldValues = metadataFields.get(field)!;
          fieldValues.set(valueStr, (fieldValues.get(valueStr) || 0) + 1);
        });
      }
    });
    
    // Convert to facet format
    const facets = Array.from(metadataFields.entries())
      .map(([field, values]) => ({
        field,
        values: Array.from(values.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count) // Sort by frequency
          .slice(0, 10) // Limit to top 10 values per field
      }))
      .filter(facet => facet.values.length > 0)
      .sort((a, b) => {
        // Prioritize fields with more diverse values
        const aDiversity = a.values.length;
        const bDiversity = b.values.length;
        return bDiversity - aDiversity;
      });
    
    // If metadata config is provided, filter to only requested fields
    if (metadataConfig && metadataConfig.length > 0) {
      const requestedFields = new Set(metadataConfig.map(config => config.field));
      return facets.filter(facet => requestedFields.has(facet.field));
    }
    
    return facets;
  }

  private calculateRecencyScore(createdAt?: Date): number {
    if (!createdAt) return 0.5;

    const now = Date.now();
    const created = createdAt.getTime();
    const age = now - created;
    const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year

    return Math.max(0, 1 - (age / maxAge));
  }

  private async getPopularityScore(resultId: string): Promise<number> {
    try {
      // Since we don't have a specific popularity tracking table in our schema,
      // we'll return a default score based on result ID hash for consistency
      
      // For now, return a simple score based on the result ID
      // In a real implementation, this would query interaction counts and ratings
      const hash = this.hashString(resultId);
      const score = (hash % 100) / 100; // Normalize to 0-1
      
      return Math.max(0.1, score); // Ensure minimum score

    } catch (error) {
      this.logger.debug({ error, resultId }, 'Failed to get popularity score');
      return 0.5;
    }
  }

  private async updatePopularityScores(resultId: string, interaction: string): Promise<void> {
    try {
      // Update popularity scores based on interaction type
      // Different interactions have different weights (click < bookmark < share)
      const weights = {
        'view': 1,
        'click': 2, 
        'bookmark': 5,
        'share': 8,
        'rate': 10
      };
      
      const weight = weights[interaction as keyof typeof weights] || 1;
      
      // In a real implementation, this would update a popularity tracking table
      // For now, we just log the interaction with its weight
      this.logger.debug({ 
        resultId, 
        interaction, 
        weight 
      }, 'Updated popularity score');
      
    } catch (error) {
      this.logger.warn({ error, resultId, interaction }, 'Failed to update popularity scores');
    }
  }

  private async logSearchAnalytics(analytics: SearchAnalytics): Promise<void> {
    try {
      // Since we don't have a specific search_analytics table in our schema,
      // we'll just log the analytics for now
      // In a real implementation, this would be stored in a dedicated table
      
      this.logger.info({
        queryId: analytics.queryId,
        userId: analytics.userId,
        query: analytics.query,
        resultsFound: analytics.resultsFound,
        searchTime: analytics.searchTime,
        clickedResults: analytics.clickedResults,
        satisfactionRating: analytics.satisfactionRating,
        timestamp: analytics.timestamp
      }, 'Search analytics logged');
      
    } catch (error) {
      this.logger.debug({ error, queryId: analytics.queryId }, 'Failed to log search analytics');
    }
  }

  private hashString(str: string): number {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  private calculateUserPreferenceScore(result: UnifiedSearchResult): number {
    // Calculate user preference score based on result type and metadata
    // In production, this would use user history and ML models
    
    let score = 0.5; // Base score
    
    // Prefer certain types based on simple heuristics
    switch (result.type) {
      case 'memory':
        score += 0.1;
        break;
      case 'artifact':
        score += 0.2;
        break;
      case 'document':
        score += 0.15;
        break;
    }
    
    return Math.min(1, score);
  }
}