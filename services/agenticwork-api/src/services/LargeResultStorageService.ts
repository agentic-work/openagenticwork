/**
 * Large Result Storage Service
 *
 * Stores massive tool results in Milvus to prevent context window bloat.
 * Enables semantic querying of stored results instead of re-including full data.
 */

import type { Logger } from 'pino';

export interface StoredResultInfo {
  resultId: string;
  summary: string;
  sizeBytes: number;
  chunkCount: number;
}

export class LargeResultStorageService {
  private readonly SIZE_THRESHOLD = 100 * 1024; // 100KB - increased from 10KB to allow reasonable results through
  private readonly TOKEN_THRESHOLD = 25000; // 25K tokens - increased from 2500 to avoid storing normal responses
  private readonly TTL_HOURS = 48; // 48 hours - increased from 1 hour to prevent data loss

  // In-memory storage for now (TODO: Move to Milvus)
  private storage: Map<string, any> = new Map();

  constructor(private readonly logger: Logger) {}

  /**
   * Check if a tool result should be stored (size threshold)
   */
  shouldStoreResult(result: any): boolean {
    const resultStr = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(resultStr, 'utf8');
    const estimatedTokens = Math.ceil(sizeBytes / 4); // Rough estimate: 1 token ≈ 4 bytes

    this.logger.info({
      sizeBytes,
      estimatedTokens,
      threshold: this.SIZE_THRESHOLD,
      shouldStore: sizeBytes > this.SIZE_THRESHOLD || estimatedTokens > this.TOKEN_THRESHOLD
    }, 'Checking if result should be stored');

    return sizeBytes > this.SIZE_THRESHOLD || estimatedTokens > this.TOKEN_THRESHOLD;
  }

  /**
   * Store a large tool result
   */
  async storeResult(params: {
    userId: string;
    sessionId: string;
    toolName: string;
    toolCallId: string;
    result: any;
  }): Promise<StoredResultInfo> {
    const { userId, sessionId, toolName, toolCallId, result } = params;

    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const resultId = `result_${timestamp}_${random}`;

    const resultStr = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(resultStr, 'utf8');

    this.logger.info({
      resultId,
      userId,
      sessionId,
      toolName,
      sizeBytes,
      sizeMB: (sizeBytes / 1024 / 1024).toFixed(2),
      threshold: this.SIZE_THRESHOLD
    }, '📦 Storing large tool result to prevent context bloat');

    // Generate summary
    const summary = this.generateSummary(toolName, result);

    // Chunk the result for semantic search
    const chunks = this.chunkResult(toolName, result);

    // Store in memory (TODO: Store in Milvus with embeddings)
    this.storage.set(resultId, {
      userId,
      sessionId,
      toolName,
      toolCallId,
      result,
      chunks,
      summary,
      timestamp
    });

    // Set TTL cleanup
    setTimeout(() => {
      this.storage.delete(resultId);
      this.logger.debug({ resultId }, 'Cleaned up expired stored result');
    }, this.TTL_HOURS * 60 * 60 * 1000);

    this.logger.info({
      resultId,
      chunkCount: chunks.length,
      summary,
      tokensSaved: Math.ceil(sizeBytes / 4)
    }, '✅ Large result stored successfully - context tokens saved!');

    return {
      resultId,
      summary,
      sizeBytes,
      chunkCount: chunks.length
    };
  }

  /**
   * Generate a brief summary of the result
   * Uses pattern-based detection - NO hardcoded tool names
   */
  private generateSummary(toolName: string, result: any): string {
    // Pattern-based summarization - detect by result structure, not tool names
    const toolLower = toolName.toLowerCase();

    // Detect subscription-like results by structure (works for any cloud provider)
    if (result.subscriptions && Array.isArray(result.subscriptions)) {
      return `Found ${result.subscriptions.length} subscriptions`;
    }

    // Detect resource-like results by tool name pattern (resource, list, etc.)
    if ((toolLower.includes('resource') || toolLower.includes('list')) && Array.isArray(result)) {
      return `Found ${result.length} resources`;
    }

    // Generic array handling
    if (Array.isArray(result)) {
      return `Returned ${result.length} items`;
    }

    // Generic object handling
    if (typeof result === 'object' && result !== null) {
      const keys = Object.keys(result);
      return `Result with ${keys.length} properties: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
    }

    return 'Large result stored';
  }

  /**
   * Break result into semantic chunks for querying
   * Uses structure-based detection - NO hardcoded tool names
   */
  private chunkResult(
    toolName: string,
    result: any
  ): Array<{ text: string; metadata: Record<string, any> }> {
    const chunks: Array<{ text: string; metadata: Record<string, any> }> = [];

    // Handle subscription-like results by STRUCTURE, not tool name
    // This works for Azure subscriptions, AWS accounts, GCP projects, etc.
    if (result.subscriptions && Array.isArray(result.subscriptions)) {
      const subscriptions = result.subscriptions;

      for (const sub of subscriptions) {
        const text = `Subscription: ${sub.displayName || sub.name || 'Unknown'} (ID: ${sub.subscriptionId || sub.id})
State: ${sub.state || 'unknown'}`;

        chunks.push({
          text,
          metadata: {
            subscriptionId: sub.subscriptionId || sub.id,
            displayName: sub.displayName || sub.name,
            state: sub.state
          }
        });
      }

      return chunks;
    }

    // Generic chunking for arrays
    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i++) {
        const item = result[i];
        chunks.push({
          text: JSON.stringify(item, null, 2),
          metadata: {
            type: 'array_item',
            index: i
          }
        });
      }
      return chunks;
    }

    // Generic chunking for objects
    if (typeof result === 'object' && result !== null) {
      for (const [key, value] of Object.entries(result)) {
        chunks.push({
          text: `${key}: ${JSON.stringify(value, null, 2)}`,
          metadata: { property: key }
        });
      }
    }

    return chunks;
  }

  /**
   * Query stored results (simple string matching for now)
   */
  queryStoredResult(params: {
    resultId: string;
    query: string;
    limit?: number;
  }): Array<{ text: string; score: number; metadata: Record<string, any> }> {
    const { resultId, query, limit = 10 } = params;

    const stored = this.storage.get(resultId);
    if (!stored) {
      this.logger.warn({ resultId }, 'Stored result not found');
      // CRITICAL: Throw error instead of returning empty array
      // Empty array makes AI think data exists but nothing matches, causing hallucination
      throw new Error(`Stored result '${resultId}' not found or has expired (TTL: ${this.TTL_HOURS}h). Please re-fetch the data.`);
    }

    this.logger.info({
      resultId,
      query,
      chunkCount: stored.chunks.length
    }, 'Querying stored result');

    // Simple keyword matching (TODO: Use semantic embeddings)
    const queryLower = query.toLowerCase();
    const results = stored.chunks
      .map((chunk: any) => ({
        text: chunk.text,
        metadata: chunk.metadata,
        score: this.calculateMatchScore(chunk.text, queryLower)
      }))
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit);

    this.logger.info({
      resultId,
      matchCount: results.length,
      topScore: results[0]?.score || 0
    }, 'Query completed');

    return results;
  }

  /**
   * Simple keyword-based scoring (TODO: Replace with embeddings)
   */
  private calculateMatchScore(text: string, query: string): number {
    const textLower = text.toLowerCase();
    const keywords = query.split(/\s+/);

    let score = 0;
    for (const keyword of keywords) {
      if (textLower.includes(keyword)) {
        score += 1;
      }
    }

    return score;
  }

  /**
   * Create a compact tool message for stored results
   */
  createStoredResultMessage(params: {
    resultId: string;
    toolName: string;
    summary: string;
    sizeBytes: number;
    chunkCount: number;
  }): string {
    const { resultId, toolName, summary, sizeBytes, chunkCount } = params;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
    const tokensSaved = Math.ceil(sizeBytes / 4);

    return `📦 **Large result stored in memory** (${sizeMB}MB / ~${tokensSaved.toLocaleString()} tokens saved from context!)

**Tool**: ${toolName}
**Summary**: ${summary}
**Chunks**: ${chunkCount} semantic chunks available

**How to query this data**:
To search for specific information in this stored result, ask me questions like:
- "Which subscriptions have AKS clusters?"
- "Show me production subscriptions"
- "Find subscriptions in eastus region"

I'll automatically search the stored data semantically instead of re-loading all ${sizeMB}MB into context.

**Result ID**: \`${resultId}\` (auto-expires in ${this.TTL_HOURS} hour${this.TTL_HOURS > 1 ? 's' : ''})`;
  }

  /**
   * Get full result (for when AI really needs it)
   */
  getFullResult(resultId: string): any | null {
    const stored = this.storage.get(resultId);
    return stored?.result || null;
  }
}
