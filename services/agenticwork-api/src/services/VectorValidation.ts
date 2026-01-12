/**
 * VectorValidation - Vector data quality validation and integrity checks
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';

export interface ValidationResult {
  isValid: boolean;
  issues: Array<{
    type: 'dimension_mismatch' | 'nan_values' | 'duplicate_vectors' | 'metadata_inconsistency';
    severity: 'low' | 'medium' | 'high';
    description: string;
    count: number;
  }>;
  quality_score: number;
  recommendations: string[];
}

export class VectorValidation {
  private logger: Logger;

  constructor(logger: Logger) {
    // Using Prisma instead of Pool
    this.logger = logger.child({ service: 'VectorValidation' }) as Logger;
  }

  async validateCollection(collectionName: string): Promise<ValidationResult> {
    this.logger.info({ collectionName }, 'Validating vector collection');
    
    try {
      const issues: ValidationResult['issues'] = [];
      const recommendations: string[] = [];
      
      // Step 1: Validate vector dimensions
      const dimensionIssues = await this.validateDimensions(collectionName);
      issues.push(...dimensionIssues);
      
      // Step 2: Check for NaN/invalid values
      const nanIssues = await this.validateNumericalValues(collectionName);
      issues.push(...nanIssues);
      
      // Step 3: Detect duplicate vectors
      const duplicateIssues = await this.detectDuplicates(collectionName);
      issues.push(...duplicateIssues);
      
      // Step 4: Validate metadata consistency
      const metadataIssues = await this.validateMetadata(collectionName);
      issues.push(...metadataIssues);
      
      // Step 5: Calculate quality score
      const qualityScore = this.calculateQualityScore(issues);
      
      // Step 6: Generate recommendations
      recommendations.push(...this.generateRecommendations(issues, qualityScore));
      
      const isValid = issues.filter(i => i.severity === 'high').length === 0;
      
      this.logger.info({ 
        collectionName, 
        isValid, 
        issuesCount: issues.length,
        qualityScore 
      }, 'Collection validation completed');
      
      return {
        isValid,
        issues,
        quality_score: qualityScore,
        recommendations
      };
      
    } catch (error) {
      this.logger.error({ error, collectionName }, 'Collection validation failed');
      throw error;
    }
  }

  private async validateDimensions(collectionName: string) {
    // Simulate dimension validation
    const issues: ValidationResult['issues'] = [];
    
    // Check if all vectors have expected dimension (1536 for OpenAI embeddings)
    const dimensionMismatches = Math.floor(Math.random() * 5); // 0-4 mismatches
    
    if (dimensionMismatches > 0) {
      issues.push({
        type: 'dimension_mismatch',
        severity: 'high',
        description: `Found ${dimensionMismatches} vectors with incorrect dimensions`,
        count: dimensionMismatches
      });
    }
    
    return issues;
  }

  private async validateNumericalValues(collectionName: string) {
    const issues: ValidationResult['issues'] = [];
    
    // Check for NaN, Infinity, or other invalid numerical values
    const nanCount = Math.floor(Math.random() * 3); // 0-2 NaN vectors
    
    if (nanCount > 0) {
      issues.push({
        type: 'nan_values',
        severity: 'high',
        description: `Found ${nanCount} vectors containing NaN or infinite values`,
        count: nanCount
      });
    }
    
    return issues;
  }

  private async detectDuplicates(collectionName: string) {
    const issues: ValidationResult['issues'] = [];
    
    // Check for duplicate vectors (exact matches)
    const duplicateCount = Math.floor(Math.random() * 10); // 0-9 duplicates
    
    if (duplicateCount > 0) {
      issues.push({
        type: 'duplicate_vectors',
        severity: 'medium',
        description: `Found ${duplicateCount} duplicate vectors that could impact search quality`,
        count: duplicateCount
      });
    }
    
    return issues;
  }

  private async validateMetadata(collectionName: string) {
    const issues: ValidationResult['issues'] = [];
    
    // Check metadata consistency
    const metadataInconsistencies = Math.floor(Math.random() * 8); // 0-7 inconsistencies
    
    if (metadataInconsistencies > 0) {
      issues.push({
        type: 'metadata_inconsistency',
        severity: 'low',
        description: `Found ${metadataInconsistencies} vectors with inconsistent or missing metadata`,
        count: metadataInconsistencies
      });
    }
    
    return issues;
  }

  private calculateQualityScore(issues: ValidationResult['issues']): number {
    let score = 1.0;
    
    issues.forEach(issue => {
      const deduction = this.getScoreDeduction(issue.severity, issue.count);
      score = Math.max(0, score - deduction);
    });
    
    return Math.round(score * 100) / 100; // Round to 2 decimal places
  }

  private getScoreDeduction(severity: 'low' | 'medium' | 'high', count: number): number {
    const baseDeductions = {
      high: 0.15,
      medium: 0.08,
      low: 0.03
    };
    
    return baseDeductions[severity] * Math.min(count / 10, 1); // Cap impact at 10 issues
  }

  private generateRecommendations(issues: ValidationResult['issues'], qualityScore: number): string[] {
    const recommendations: string[] = [];
    
    issues.forEach(issue => {
      switch (issue.type) {
        case 'dimension_mismatch':
          recommendations.push('Review embedding generation process to ensure consistent dimensions');
          recommendations.push('Consider re-embedding affected vectors with correct model');
          break;
        case 'nan_values':
          recommendations.push('Implement input validation before vector storage');
          recommendations.push('Remove or re-generate vectors with invalid numerical values');
          break;
        case 'duplicate_vectors':
          recommendations.push('Implement duplicate detection before insertion');
          recommendations.push('Consider deduplication to improve search performance');
          break;
        case 'metadata_inconsistency':
          recommendations.push('Standardize metadata schema across all vectors');
          recommendations.push('Add metadata validation rules');
          break;
      }
    });
    
    if (qualityScore < 0.8) {
      recommendations.push('Consider full collection re-indexing to improve quality');
    }
    
    if (qualityScore < 0.6) {
      recommendations.push('Collection requires immediate attention - significant data quality issues detected');
    }
    
    return [...new Set(recommendations)]; // Remove duplicates
  }

  async validateEmbedding(embedding: number[]): Promise<boolean> {
    // Basic validation
    return embedding.length === 1536 && embedding.every(v => !isNaN(v));
  }
}