/**
 * Tool Execution Helper
 *
 * Handles execution of tool calls via MCP Proxy integration
 * Also handles System MCP tools (like create_diagram) that run locally
 */

import axios from 'axios';
import type { Logger } from 'pino';
import { prisma } from '../../../utils/prisma.js';
import os from 'os';
import crypto from 'crypto';
// TODO: System MCPs moved to MCP Proxy (awp-diagram-mcp) - keeping import for future use
// import { isSystemMcpTool, processSystemMcpToolCall } from '../../../services/system-mcps/index.js';
import { getToolSuccessTrackingService, type ToolSuccessRecord } from '../../../services/ToolSuccessTrackingService.js';
import { mcpAccessControlService } from '../../../services/MCPAccessControlService.js';
import { getRedisClient } from '../../../utils/redis-client.js';
import { getToolResultCacheService, initializeToolResultCache, type SemanticCacheHit } from '../../../services/ToolResultCacheService.js';
// Invisible Agent: Code execution routing to agenticode-manager
import {
  isCodeTool,
  executeCodeToolCall,
  getOrCreateAgenticodeSession,
  type CodeExecutionContext
} from './code-execution.helper.js';

// Flag to track if semantic cache initialization has been attempted
let semanticCacheInitialized = false;
let semanticCacheInitPromise: Promise<void> | null = null;

/**
 * Ensure the Milvus semantic cache is initialized (called once at startup)
 * This is critical - without calling initialize(), isReady() always returns false!
 */
async function ensureSemanticCacheInitialized(logger: Logger): Promise<void> {
  if (semanticCacheInitialized) return;
  if (semanticCacheInitPromise) return semanticCacheInitPromise;

  semanticCacheInitPromise = (async () => {
    try {
      const service = getToolResultCacheService(logger);
      await service.initialize();
      semanticCacheInitialized = true;
      logger.info('[SEMANTIC-CACHE] ✅ Milvus semantic cache initialized successfully');
    } catch (error) {
      logger.warn({ error }, '[SEMANTIC-CACHE] ⚠️ Failed to initialize Milvus semantic cache - using Redis only');
      semanticCacheInitialized = true; // Mark as attempted to avoid retry loops
    }
  })();

  return semanticCacheInitPromise;
}

// =================================================================
// 🚀 TOOL RESULT CACHING - Redis Layer
// =================================================================
// Cache tool results to avoid redundant MCP calls for the same data.
// GET operations are cacheable; mutations (POST/PUT/DELETE) are not.
// Cache key: mcp:tool:{toolName}:{userId}:{argsHash}
// TTL: 5-10 minutes for user-specific, 1 hour for tenant-wide static data

/**
 * Cacheable tool patterns - these are READ operations that return stable data
 * Pattern matching is case-insensitive
 */
const CACHEABLE_TOOL_PATTERNS = [
  // Azure - List operations (subscriptions, resource groups, resources)
  /azure.*list/i,
  /azure.*get/i,
  /azure_arm_execute.*method.*GET/i,  // ARM GET operations
  /azmcp.*list/i,
  /azmcp.*get/i,

  // AWS - List/Describe operations
  /aws.*list/i,
  /aws.*describe/i,
  /aws.*get/i,

  // General read patterns
  /list_subscriptions/i,
  /list_resource_groups/i,
  /list_resources/i,
  /get_subscription/i,
  /get_resource_group/i,
  /fetch/i,
  /search/i,
  /query/i,
];

/**
 * Non-cacheable tool patterns - mutations that change state
 */
const NON_CACHEABLE_PATTERNS = [
  /create/i,
  /delete/i,
  /update/i,
  /modify/i,
  /put/i,
  /post/i,
  /remove/i,
  /start/i,
  /stop/i,
  /restart/i,
  /deploy/i,
  /execute_command/i,  // Commands that run arbitrary code
];

/**
 * Determine if a tool call is cacheable based on tool name and arguments
 */
function isToolCacheable(toolName: string, toolArgs: any): boolean {
  const normalizedName = toolName.toLowerCase();

  // First check non-cacheable patterns (mutations)
  for (const pattern of NON_CACHEABLE_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return false;
    }
  }

  // Special handling for azure_arm_execute - check HTTP method
  if (normalizedName.includes('arm_execute') || normalizedName.includes('arm-execute')) {
    const method = toolArgs?.method?.toUpperCase() || 'GET';
    // Only cache GET requests
    return method === 'GET';
  }

  // Check cacheable patterns
  for (const pattern of CACHEABLE_TOOL_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return true;
    }
  }

  // Default: cache read-like operations
  return normalizedName.includes('list') ||
         normalizedName.includes('get') ||
         normalizedName.includes('fetch') ||
         normalizedName.includes('search') ||
         normalizedName.includes('query');
}

/**
 * Generate a cache key hash from tool arguments
 * Uses SHA-256 for consistent, collision-resistant hashing
 */
function generateArgsHash(toolArgs: any): string {
  const argsString = JSON.stringify(toolArgs || {});
  return crypto.createHash('sha256').update(argsString).digest('hex').substring(0, 16);
}

/**
 * Get cache TTL based on tool type (in seconds)
 * Static data (subscriptions, accounts) gets longer TTL
 * Dynamic data (costs, metrics) gets shorter TTL
 */
function getCacheTTL(toolName: string): number {
  const normalizedName = toolName.toLowerCase();

  // Static data - 1 hour TTL (subscriptions, accounts, resource groups)
  if (normalizedName.includes('subscription') ||
      normalizedName.includes('account') ||
      normalizedName.includes('resource_group') ||
      normalizedName.includes('resourcegroup')) {
    return 3600; // 1 hour
  }

  // Semi-static data - 30 min TTL (resource lists, configurations)
  if (normalizedName.includes('list') ||
      normalizedName.includes('config') ||
      normalizedName.includes('setting')) {
    return 1800; // 30 minutes
  }

  // Dynamic data - 5 min TTL (costs, metrics, status)
  if (normalizedName.includes('cost') ||
      normalizedName.includes('metric') ||
      normalizedName.includes('status') ||
      normalizedName.includes('health')) {
    return 300; // 5 minutes
  }

  // Default: 10 minutes
  return 600;
}

/**
 * Try to get cached tool result from Redis
 */
async function getCachedToolResult(
  toolName: string,
  userId: string,
  argsHash: string,
  logger: Logger
): Promise<any | null> {
  try {
    const redis = getRedisClient();
    const cacheKey = `mcp:tool:${toolName}:${userId}:${argsHash}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      logger.info({
        toolName,
        cacheKey,
        userId
      }, '[TOOL-CACHE] 🎯 Cache HIT - returning cached result');
      return cached;
    }

    return null;
  } catch (error) {
    logger.warn({
      error,
      toolName,
      userId
    }, '[TOOL-CACHE] Failed to get cached result (non-fatal)');
    return null;
  }
}

/**
 * Store tool result in Redis cache
 */
async function cacheToolResult(
  toolName: string,
  userId: string,
  argsHash: string,
  result: any,
  ttlSeconds: number,
  logger: Logger
): Promise<void> {
  try {
    const redis = getRedisClient();
    const cacheKey = `mcp:tool:${toolName}:${userId}:${argsHash}`;
    await redis.set(cacheKey, result, ttlSeconds);

    logger.info({
      toolName,
      cacheKey,
      ttlSeconds,
      resultSize: JSON.stringify(result).length
    }, '[TOOL-CACHE] 💾 Cached tool result');
  } catch (error) {
    logger.warn({
      error,
      toolName,
      userId
    }, '[TOOL-CACHE] Failed to cache result (non-fatal)');
  }
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: any;
  error?: string;
  serverName?: string;  // MCP server that executed the tool (admin, fetch, azure_mcp, etc.)
  executedOn?: string;  // MCP Proxy pod/container hostname for K8s traceability
  executionTimeMs?: number;  // Tool execution time in milliseconds
  requestSize?: number;      // Size of request in bytes
  responseSize?: number;     // Size of response in bytes
}

/**
 * Comprehensive MCP audit logging
 */
interface MCPAuditLog {
  userId: string;
  userName?: string;
  userEmail?: string;
  sessionId?: string;
  messageId?: string;
  toolCallId: string;
  toolName: string;
  resolvedToolName: string;
  mcpServer: string;
  mcpProxyHost: string;
  requestPayload: any;
  responsePayload: any;
  executionTimeMs: number;
  requestSizeBytes: number;
  responseSizeBytes: number;
  success: boolean;
  errorMessage?: string;
  userToken?: boolean;
  ipAddress?: string;
  userAgent?: string;
  modelUsed?: string;        // LLM model that triggered the tool call
  modelProvider?: string;    // Provider (vertex-ai, ollama, etc.)
}

/**
 * Log detailed MCP call information to multiple audit tables
 */
async function logMCPCall(auditData: MCPAuditLog, logger: Logger): Promise<void> {
  try {
    const timestamp = new Date();

    // 1. Log to MCPUsage table for usage tracking
    // CRITICAL: Store BOTH request AND response data for full audit trail
    await prisma.mCPUsage.create({
      data: {
        user_id: auditData.userId,
        user_name: auditData.userName,
        user_email: auditData.userEmail,
        server_name: auditData.mcpServer,
        tool_name: auditData.resolvedToolName,
        method: 'tools/call',
        execution_time_ms: auditData.executionTimeMs,
        request_size: auditData.requestSizeBytes,
        response_size: auditData.responseSizeBytes,
        success: auditData.success,
        error_message: auditData.errorMessage,
        request_metadata: {
          toolCallId: auditData.toolCallId,
          originalToolName: auditData.toolName,
          mcpServer: auditData.mcpServer,
          mcpProxyHost: auditData.mcpProxyHost,
          requestPayload: auditData.requestPayload,
          hasUserToken: auditData.userToken,
          sessionId: auditData.sessionId,
          messageId: auditData.messageId,
          ipAddress: auditData.ipAddress,
          userAgent: auditData.userAgent,
          apiHost: os.hostname(),
          modelUsed: auditData.modelUsed,
          modelProvider: auditData.modelProvider,
          timestamp: timestamp.toISOString()
        },
        // Store the full response data for audit trail
        response_data: auditData.responsePayload ? {
          result: auditData.responsePayload,
          mcpProxyHost: auditData.mcpProxyHost,
          executionTimeMs: auditData.executionTimeMs
        } : null,
        timestamp
      }
    });

    // 2. Log to UserQueryAudit table for admin query tracking
    if (auditData.sessionId || auditData.messageId) {
      await prisma.userQueryAudit.create({
        data: {
          user_id: auditData.userId,
          session_id: auditData.sessionId || '',
          message_id: auditData.messageId || auditData.toolCallId,
          query_type: 'MCP_TOOL_CALL',
          raw_query: `${auditData.toolName}(${JSON.stringify(auditData.requestPayload)})`,
          intent: `Execute ${auditData.toolName} via ${auditData.mcpServer} MCP server`,
          mcp_server: auditData.mcpServer,
          tools_called: [
            {
              name: auditData.resolvedToolName,
              arguments: auditData.requestPayload,
              result: auditData.success ? auditData.responsePayload : null,
              error: auditData.errorMessage,
              executionTimeMs: auditData.executionTimeMs,
              server: auditData.mcpServer
            }
          ],
          success: auditData.success,
          error_message: auditData.errorMessage,
          error_code: auditData.success ? null : 'MCP_TOOL_EXECUTION_FAILED',
          ip_address: auditData.ipAddress,
          user_agent: auditData.userAgent,
          created_at: timestamp
        }
      });
    }

    logger.info({
      userId: auditData.userId,
      toolName: auditData.resolvedToolName,
      mcpServer: auditData.mcpServer,
      executionTimeMs: auditData.executionTimeMs,
      success: auditData.success
    }, '[MCP-AUDIT] MCP call logged to audit tables');

  } catch (auditError) {
    // Don't fail the main operation if audit logging fails
    logger.error({
      error: auditError,
      auditData: {
        ...auditData,
        requestPayload: '[TRUNCATED]',
        responsePayload: '[TRUNCATED]'
      }
    }, '[MCP-AUDIT] Failed to log MCP call audit data');
  }
}

/**
 * Resolve tool name by matching against available tools
 *
 * LLMs often invent simplified names (e.g., "list_subscriptions")
 * instead of using actual MCP tool names (e.g., "azure_mcp-azmcp_subscription_list")
 *
 * This function performs fuzzy matching to find the correct tool name.
 */
function resolveToolName(
  llmToolName: string,
  availableTools: any[] | undefined,
  logger: Logger
): string {
  // No tools available - return original name
  if (!availableTools || availableTools.length === 0) {
    logger.warn({
      llmToolName,
      reason: 'no_available_tools'
    }, '[TOOL-EXEC] ⚠️ Cannot resolve tool name - no available tools provided');
    return llmToolName;
  }

  // Extract all tool names from available tools
  const toolNames = availableTools
    .map(t => t?.function?.name)
    .filter(Boolean) as string[];

  // Exact match (case-sensitive)
  if (toolNames.includes(llmToolName)) {
    return llmToolName;
  }

  logger.info({
    llmToolName,
    availableToolCount: toolNames.length,
    sampleTools: toolNames.slice(0, 5)
  }, '[TOOL-EXEC] 🔍 Tool name not found, attempting fuzzy match...');

  // Fuzzy matching strategies
  const normalizedLlmName = normalizeName(llmToolName);
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const toolName of toolNames) {
    const normalizedToolName = normalizeName(toolName);

    // Strategy 1: Exact match after normalization
    if (normalizedLlmName === normalizedToolName) {
      logger.info({
        llmToolName,
        matchedTool: toolName,
        strategy: 'normalized_exact'
      }, '[TOOL-EXEC] ✅ Found exact match after normalization');
      return toolName;
    }

    // Strategy 2: LLM name is contained in tool name (e.g., "list_subscriptions" in "azure_mcp-azmcp_subscription_list")
    if (normalizedToolName.includes(normalizedLlmName)) {
      const score = normalizedLlmName.length / normalizedToolName.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = toolName;
      }
    }

    // Strategy 3: Tool name is contained in LLM name (less common)
    if (normalizedLlmName.includes(normalizedToolName)) {
      const score = normalizedToolName.length / normalizedLlmName.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = toolName;
      }
    }

    // Strategy 4: Calculate similarity score based on common words
    const similarityScore = calculateSimilarity(normalizedLlmName, normalizedToolName);
    if (similarityScore > bestScore && similarityScore > 0.5) {
      bestScore = similarityScore;
      bestMatch = toolName;
    }
  }

  if (bestMatch && bestScore > 0.3) {
    logger.info({
      llmToolName,
      matchedTool: bestMatch,
      score: bestScore,
      strategy: 'fuzzy_match'
    }, '[TOOL-EXEC] ✅ Found fuzzy match');
    return bestMatch;
  }

  // No match found - log warning and return original
  logger.warn({
    llmToolName,
    availableTools: toolNames.slice(0, 10),
    totalAvailable: toolNames.length
  }, '[TOOL-EXEC] ❌ No matching tool found - LLM invented tool name not in cache');

  return llmToolName;
}

/**
 * Normalize tool name for comparison
 * - Convert to lowercase
 * - Replace dashes with underscores
 * - Remove special characters
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Calculate tool success score based on execution results
 */
function calculateToolSuccessScore(
  executionError: boolean,
  executionTimeMs: number,
  resultLength: number
): number {
  // Execution error = complete failure
  if (executionError) return 0.0;

  let score = 1.0;

  // Execution time penalty (>5s = slower, >30s = significantly slower)
  if (executionTimeMs > 30000) score *= 0.5;
  else if (executionTimeMs > 10000) score *= 0.7;
  else if (executionTimeMs > 5000) score *= 0.9;

  // Result quality: penalize empty/minimal results
  if (resultLength < 10) score *= 0.4;
  else if (resultLength < 50) score *= 0.7;

  return Math.max(0, Math.min(1, score));
}

/**
 * Record successful tool execution to Milvus for semantic learning
 */
async function recordToolSuccess(
  userId: string,
  sessionId: string | undefined,
  query: string,
  toolName: string,
  serverName: string,
  executionTimeMs: number,
  result: any,
  logger: Logger
): Promise<void> {
  try {
    const tracker = getToolSuccessTrackingService();

    // Calculate result length for scoring
    const resultStr = result ? JSON.stringify(result) : '';
    const resultLength = resultStr.length;

    // Calculate success score
    const successScore = calculateToolSuccessScore(false, executionTimeMs, resultLength);

    // Extract intent tags from query
    const intentTags = tracker.extractIntentTags(query);

    // Build context tags from session/tool metadata
    const contextTags: string[] = [];
    if (serverName) contextTags.push(`server:${serverName}`);

    const record: ToolSuccessRecord = {
      userId,
      sessionId,
      query,
      toolName,
      serverName: serverName || 'unknown',
      intentTags,
      contextTags,
      successScore,
      executionTimeMs,
      resultSummary: resultStr.substring(0, 512),
      createdAt: new Date()
    };

    await tracker.recordSuccess(record);

    logger.debug({
      toolName,
      serverName,
      successScore,
      intentTags,
      executionTimeMs
    }, '[TOOL-SUCCESS] Recorded successful tool execution to Milvus');

  } catch (error) {
    // Don't fail the main operation if tracking fails
    logger.warn({
      error,
      toolName,
      serverName
    }, '[TOOL-SUCCESS] Failed to record tool success (non-fatal)');
  }
}

/**
 * Calculate similarity between two strings based on word overlap
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.split('_').filter(Boolean);
  const words2 = str2.split('_').filter(Boolean);

  if (words1.length === 0 || words2.length === 0) return 0;

  // Count matching words
  let matches = 0;
  for (const word1 of words1) {
    if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
      matches++;
    }
  }

  // Return ratio of matches to total unique words
  return matches / Math.max(words1.length, words2.length);
}

/**
 * Execute tool calls via MCP Proxy
 *
 * @param toolCalls - Array of tool calls from LLM response
 * @param logger - Pino logger instance
 * @param availableTools - Array of available tools for name resolution
 * @param userToken - Optional user token for OBO auth (Azure access token for ARM, API key for service auth)
 * @param idToken - Optional Azure AD ID token for AWS Identity Center OBO (has app client ID as audience)
 * @param userId - User ID for audit logging
 * @param sessionId - Session ID for audit tracking
 * @param messageId - Message ID for audit tracking
 * @param ipAddress - User IP address for audit logging
 * @param userAgent - User agent for audit logging
 * @param emitEvent - Optional event emitter function to keep SSE stream alive during tool execution
 * @param originalQuery - The original user query that triggered the tool calls (for success tracking)
 * @param userGroups - User's Azure AD groups for access control
 * @param isAdmin - Whether user is admin for access control
 * @param modelUsed - LLM model that triggered the tool calls (for audit logging)
 * @param modelProvider - LLM provider (for audit logging)
 * @param userName - User's display name (for audit logging)
 * @param userEmail - User's email (for audit logging)
 * @param codeExecutionContext - Optional context for persisting agenticode sessions across tool calls
 * @returns Object with tool results and updated code execution context
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  logger: Logger,
  availableTools?: any[],
  userToken?: string,
  idToken?: string,
  userId?: string,
  sessionId?: string,
  messageId?: string,
  ipAddress?: string,
  userAgent?: string,
  emitEvent?: (event: string, data: any) => void,
  originalQuery?: string,
  userGroups?: string[],
  isAdmin?: boolean,
  modelUsed?: string,
  modelProvider?: string,
  userName?: string,
  userEmail?: string,
  codeExecutionContext?: CodeExecutionContext
): Promise<{ results: ToolResult[]; codeExecutionContext?: CodeExecutionContext }> {
  const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

  const results: ToolResult[] = [];

  // Track effective user ID for caching and session management
  const effectiveUserId = userId || 'anonymous';

  // Mutable context for agenticode sessions - will be updated if new session is created
  let updatedCodeExecutionContext: CodeExecutionContext | undefined = codeExecutionContext;

  logger.info({
    toolCallCount: toolCalls.length,
    toolNames: toolCalls.map(tc => tc.function.name),
    hasUserToken: !!userToken,
    hasIdToken: !!idToken
  }, '[TOOL-EXEC] Executing tool calls via MCP Proxy');

  // Execute each tool call
  for (const toolCall of toolCalls) {
    // Resolve tool name (LLM may invent simplified names)
    const resolvedToolName = resolveToolName(
      toolCall.function.name,
      availableTools,
      logger
    );

    if (resolvedToolName !== toolCall.function.name) {
      logger.info({
        toolCallId: toolCall.id,
        llmToolName: toolCall.function.name,
        resolvedToolName
      }, '[TOOL-EXEC] ✅ Tool name resolved via fuzzy matching');
    }

    // REMOVED HARDCODED SERVER ROUTING - EXTRACT SERVER FROM TOOL METADATA INSTEAD
    // The LLM chose a tool from availableTools, which includes serverId metadata.
    // We extract the actual MCP server from the tool's metadata instead of guessing from keywords.
    // This allows the LLM to make intelligent tool selection without hardcoded overrides.

    let targetServer: string | undefined = undefined;

    // Find the tool in availableTools to get its serverId and originalToolName
    let mcpToolName = resolvedToolName; // Default to resolved name

    if (availableTools && availableTools.length > 0) {
      const matchedTool = availableTools.find(t =>
        t?.function?.name === resolvedToolName
      );

      if (matchedTool && (matchedTool as any).serverId) {
        targetServer = (matchedTool as any).serverId;

        // CRITICAL: Use originalToolName for MCP proxy if available
        // The LLM sees sanitized name (aws_search_documentation) but MCP expects original (aws___search_documentation)
        if ((matchedTool as any).originalToolName) {
          mcpToolName = (matchedTool as any).originalToolName;
          logger.info({
            sanitizedName: resolvedToolName,
            originalName: mcpToolName,
            targetServer
          }, '[TOOL-EXEC] ✅ Using original tool name for MCP proxy');
        }

        logger.info({
          toolName: resolvedToolName,
          mcpToolName,
          extractedServer: targetServer
        }, '[TOOL-EXEC] ✅ Extracted server from tool metadata');
      } else {
        logger.warn({
          toolName: resolvedToolName,
          hasMatchedTool: !!matchedTool,
          serverId: matchedTool ? (matchedTool as any).serverId : undefined
        }, '[TOOL-EXEC] ⚠️ Could not extract server from tool metadata - MCP proxy will auto-detect');
      }
    }

    // Parse tool arguments (declare outside try block for access in catch)
    let toolArgs: any = {};
    try {
      toolArgs = toolCall.function.arguments
        ? JSON.parse(toolCall.function.arguments)
        : {};
    } catch (error) {
      logger.warn({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        arguments: toolCall.function.arguments
      }, '[TOOL-EXEC] Failed to parse tool arguments, using empty object');
    }

    // =================================================================
    // 🔐 AGENTICODE USER CONTEXT INJECTION
    // =================================================================
    // For AgentiCode MCP tools, inject the chat user's ID into the arguments
    // so the MCP server can use the user's credentials/workspace
    // The LLM may omit or use default values for user_id - we override with actual user
    // Dynamic check: any server/tool with "agenticode" in name needs user context
    const isAgenticodeServer = targetServer &&
      targetServer.toLowerCase().includes('agenticode');

    if (isAgenticodeServer && userId) {
      // Override user_id with actual chat user ID
      const originalUserId = toolArgs.user_id;
      toolArgs.user_id = userId;

      logger.info({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        targetServer,
        originalUserId,
        injectedUserId: userId
      }, '[TOOL-EXEC] 🔐 AGENTICODE: Injected chat user ID into tool arguments');
    }

    try {
      // =================================================================
      // 🛡️ ACCESS CONTROL CHECK - Enforce runtime MCP access policies
      // =================================================================
      // Check if user has access to execute tools from this MCP server
      if (userId && targetServer && userGroups && isAdmin !== undefined) {
        const accessResult = await mcpAccessControlService.checkToolExecution(
          userId,
          userGroups,
          isAdmin,
          resolvedToolName,
          targetServer,
          logger
        );

        if (!accessResult.allowed) {
          logger.error({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            serverId: targetServer,
            userId,
            reason: accessResult.reason
          }, '[TOOL-EXEC] ❌ ACCESS DENIED - User does not have permission to execute this tool');

          // Return access denied error
          results.push({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: null,
            error: `Access denied: ${accessResult.reason}`,
            serverName: targetServer,
            executedOn: os.hostname(),
            executionTimeMs: 0
          });

          // Log failed access attempt to audit
          if (userId) {
            await logMCPCall({
              userId,
              userName,
              userEmail,
              sessionId,
              messageId,
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              resolvedToolName,
              mcpServer: targetServer,
              mcpProxyHost: os.hostname(),
              requestPayload: toolArgs,
              responsePayload: null,
              executionTimeMs: 0,
              requestSizeBytes: 0,
              responseSizeBytes: 0,
              success: false,
              errorMessage: `Access denied: ${accessResult.reason}`,
              userToken: !!userToken,
              ipAddress,
              userAgent,
              modelUsed,
              modelProvider
            }, logger);
          }

          // Skip to next tool - access denied
          continue;
        }

        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          serverId: targetServer,
          userId,
          reason: accessResult.reason
        }, '[TOOL-EXEC] ✅ ACCESS GRANTED - User has permission to execute this tool');
      }

      // =================================================================
      // 🤖 INVISIBLE AGENT: CODE TOOL ROUTING TO AGENTICODE-MANAGER
      // =================================================================
      // Route code-related tools (write_file, execute_command, etc.) to
      // agenticode-manager for execution instead of MCP Proxy.
      // IMPORTANT: Reuses the same agenticode session for the user's chat session
      // to maintain workspace state across multiple code tool calls.
      if (isCodeTool(resolvedToolName)) {
        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          arguments: toolArgs,
          existingSessionId: updatedCodeExecutionContext?.sessionId
        }, '[TOOL-EXEC] 🤖 Routing code tool to agenticode-manager');

        try {
          // Get or create agenticode session - REUSE existing session if available
          // This ensures workspace state persists across multiple tool calls
          const agenticodeSession = await getOrCreateAgenticodeSession(
            effectiveUserId,
            sessionId || 'standalone',
            logger,
            updatedCodeExecutionContext?.sessionId // Pass existing session ID if available
          );

          // Update the context with session info if it's a new session
          if (!updatedCodeExecutionContext?.sessionId ||
              updatedCodeExecutionContext.sessionId !== agenticodeSession.sessionId) {
            updatedCodeExecutionContext = {
              sessionId: agenticodeSession.sessionId,
              workspacePath: agenticodeSession.workspacePath,
              executions: updatedCodeExecutionContext?.executions || [],
              artifacts: updatedCodeExecutionContext?.artifacts || []
            };
            logger.info({
              sessionId: agenticodeSession.sessionId,
              workspacePath: agenticodeSession.workspacePath,
              isNewSession: true
            }, '[TOOL-EXEC] 📁 Created/updated agenticode session context');
          }

          // Execute the code tool
          const codeResult = await executeCodeToolCall(
            toolCall,
            agenticodeSession.sessionId,
            logger,
            emitEvent
          );

          // Track this execution in the context
          if (updatedCodeExecutionContext) {
            updatedCodeExecutionContext.executions.push({
              toolCallId: toolCall.id,
              toolName: resolvedToolName,
              output: codeResult.result?.output || '',
              exitCode: codeResult.result?.exitCode,
              executionTimeMs: codeResult.executionTimeMs || 0,
              timestamp: new Date()
            });
          }

          results.push(codeResult);

          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            agenticodeSessionId: agenticodeSession.sessionId,
            success: !codeResult.error,
            executionTimeMs: codeResult.executionTimeMs,
            totalExecutions: updatedCodeExecutionContext?.executions.length
          }, '[TOOL-EXEC] ✅ Code tool executed via agenticode-manager');

          // Skip to next tool - code tool handled
          continue;

        } catch (codeError: any) {
          logger.error({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            error: codeError.message
          }, '[TOOL-EXEC] ❌ Code tool execution failed');

          results.push({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: null,
            error: `Code execution failed: ${codeError.message}`,
            serverName: 'agenticode-manager',
            executedOn: os.hostname(),
            executionTimeMs: 0
          });

          // Skip to next tool
          continue;
        }
      }

      // =================================================================
      // TODO: SYSTEM MCP CHECK - MOVED TO MCP PROXY (awp-diagram-mcp)
      // =================================================================
      // System MCPs like 'create_diagram' are now handled by the awp-diagram-mcp
      // server in the MCP Proxy, not locally in the API.
      // Keeping this code commented out for reference in case we need server-side
      // system MCPs in the future.
      //
      // if (isSystemMcpTool(resolvedToolName)) {
      //   logger.info({
      //     toolCallId: toolCall.id,
      //     toolName: resolvedToolName,
      //     arguments: toolArgs
      //   }, '[TOOL-EXEC] 🔧 Executing SYSTEM MCP tool locally');
      //
      //   const systemResult = await processSystemMcpToolCall(resolvedToolName, toolArgs);
      //
      //   if (systemResult.success) {
      //     logger.info({
      //       toolCallId: toolCall.id,
      //       toolName: resolvedToolName,
      //       resultType: (systemResult.result as any)?.type
      //     }, '[TOOL-EXEC] ✅ System MCP tool executed successfully');
      //
      //     results.push({
      //       toolCallId: toolCall.id,
      //       toolName: resolvedToolName,
      //       result: systemResult.result,
      //       serverName: 'system-mcp',
      //       executedOn: os.hostname(),
      //       executionTimeMs: 0
      //     });
      //   } else {
      //     logger.error({
      //       toolCallId: toolCall.id,
      //       toolName: resolvedToolName,
      //       error: systemResult.error
      //     }, '[TOOL-EXEC] ❌ System MCP tool execution failed');
      //
      //     results.push({
      //       toolCallId: toolCall.id,
      //       toolName: resolvedToolName,
      //       result: null,
      //       error: systemResult.error,
      //       serverName: 'system-mcp',
      //       executedOn: os.hostname(),
      //       executionTimeMs: 0
      //     });
      //   }
      //
      //   // Continue to next tool - skip MCP Proxy
      //   continue;
      // }

      // =================================================================
      // 🚀 REDIS CACHE LOOKUP - Check for cached tool result
      // =================================================================
      const cacheableCheck = isToolCacheable(resolvedToolName, toolArgs);
      const argsHash = generateArgsHash(toolArgs);
      // effectiveUserId is already defined at function start

      // DEBUG: Log cache check entry point (use INFO to ensure visibility)
      logger.info({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        cacheable: cacheableCheck,
        argsHash,
        effectiveUserId,
        hasToolArgs: Object.keys(toolArgs).length > 0,
        toolArgsMethod: toolArgs?.method
      }, '[TOOL-CACHE] 🔍 Cache check entry point');

      if (cacheableCheck && effectiveUserId) {
        const cachedResult = await getCachedToolResult(
          resolvedToolName,
          effectiveUserId,
          argsHash,
          logger
        );

        if (cachedResult !== null) {
          // Cache HIT - return cached result without calling MCP Proxy
          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            argsHash,
            userId: effectiveUserId
          }, '[TOOL-CACHE] 🎯 Cache HIT - skipping MCP Proxy call');

          // Emit cache hit event for SSE
          if (emitEvent) {
            emitEvent('tool_cache_hit', {
              name: resolvedToolName,
              toolCallId: toolCall.id,
              cached: true,
              timestamp: new Date().toISOString()
            });
          }

          results.push({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: cachedResult,
            serverName: targetServer || 'redis-cache',
            executedOn: 'redis-cache',
            executionTimeMs: 0  // Instant from cache
          });

          // Skip MCP Proxy - continue to next tool
          continue;
        } else {
          logger.debug({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            argsHash
          }, '[TOOL-CACHE] Cache MISS - will call MCP Proxy');
        }
      } else {
        logger.debug({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          cacheable: cacheableCheck,
          userId: effectiveUserId
        }, '[TOOL-CACHE] Tool not cacheable or no userId - skipping cache');
      }

      // =================================================================
      // 🔍 MILVUS SEMANTIC CACHE LOOKUP (Layer 2) - CROSS-USER semantic matching
      // =================================================================
      // If Redis cache missed but tool is cacheable, try Milvus semantic cache
      // This enables CROSS-USER caching: User B can benefit from User A's cached results
      // if both have RBAC access to the same resource (subscription, account, etc.)
      let semanticCacheHit: SemanticCacheHit | null = null;
      const tenantId = effectiveUserId.split('_')[0] || 'default'; // Extract tenant from userId

      if (cacheableCheck && effectiveUserId) {
        try {
          // CRITICAL: Ensure Milvus semantic cache is initialized before use
          // Without this, isReady() always returns false and cache is never used!
          await ensureSemanticCacheInitialized(logger);

          const semanticCache = getToolResultCacheService(logger);
          if (semanticCache.isReady()) {
            const semanticSearchStart = Date.now();

            // Pass userId, userGroups, and isAdmin for CROSS-USER RBAC verification
            // The semantic cache will:
            // 1. Search for semantically similar queries across ALL users
            // 2. If found, verify the requesting user has RBAC access to the resource
            // 3. Only return if RBAC check passes
            semanticCacheHit = await semanticCache.searchCache(
              tenantId,
              resolvedToolName,
              toolArgs,
              originalQuery,
              effectiveUserId,     // For RBAC verification
              userGroups,          // For MCP access control check
              isAdmin              // Admin bypass for RBAC
            );

            const semanticSearchMs = Date.now() - semanticSearchStart;

            if (semanticCacheHit) {
              const isCrossUser = semanticCacheHit.crossUserHit;

              logger.info({
                toolCallId: toolCall.id,
                toolName: resolvedToolName,
                cacheId: semanticCacheHit.cacheId,
                similarity: semanticCacheHit.similarity.toFixed(4),
                hitCount: semanticCacheHit.hitCount,
                cachedAt: semanticCacheHit.cachedAt.toISOString(),
                crossUserHit: isCrossUser,
                originalUserId: semanticCacheHit.originalUserId,
                resourceScope: semanticCacheHit.resourceScope,
                searchTimeMs: semanticSearchMs
              }, `[SEMANTIC-CACHE] 🎯 Cache HIT${isCrossUser ? ' (CROSS-USER)' : ''} - ${semanticSearchMs}ms vs ~45000ms Azure call`);

              // Emit semantic cache hit event for SSE
              if (emitEvent) {
                emitEvent('tool_semantic_cache_hit', {
                  name: resolvedToolName,
                  toolCallId: toolCall.id,
                  cached: true,
                  semantic: true,
                  crossUser: isCrossUser,
                  similarity: semanticCacheHit.similarity,
                  resourceScope: semanticCacheHit.resourceScope,
                  timeSavedMs: 45000, // Approximate Azure API call time
                  timestamp: new Date().toISOString()
                });
              }

              results.push({
                toolCallId: toolCall.id,
                toolName: resolvedToolName,
                result: semanticCacheHit.result,
                serverName: targetServer || 'milvus-semantic-cache',
                executedOn: isCrossUser ? 'milvus-cross-user-cache' : 'milvus-semantic-cache',
                executionTimeMs: semanticSearchMs
              });

              // Skip MCP Proxy - continue to next tool
              continue;
            }
          }
        } catch (semanticError) {
          logger.debug({
            error: semanticError,
            toolName: resolvedToolName
          }, '[SEMANTIC-CACHE] Semantic cache lookup failed (non-fatal)');
        }
      }

      // =================================================================
      // EXTERNAL MCP PROXY - For all other tools
      // =================================================================
      logger.info({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        originalName: toolCall.function.name,
        targetServer,
        arguments: toolArgs
      }, '[TOOL-EXEC] Executing tool call via MCP Proxy');

      // CRITICAL: Emit tool_executing event to keep SSE stream alive
      // This prevents frontend thinking animation from disappearing during tool execution
      if (emitEvent) {
        const toolExecutingEvent = {
          name: resolvedToolName,
          arguments: toolArgs,
          toolCallId: toolCall.id,
          targetServer,
          timestamp: new Date().toISOString()
        };

        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          targetServer,
          hasEmitCallback: !!emitEvent
        }, '🔧 [TOOL-SSE] Emitting tool_executing event');

        emitEvent('tool_executing', toolExecutingEvent);
      } else {
        logger.warn({
          toolCallId: toolCall.id,
          toolName: resolvedToolName
        }, '⚠️  [TOOL-SSE] No emitEvent callback - tool events will NOT stream');
      }

      // Prepare headers for MCP Proxy
      const headers: any = {
        'Content-Type': 'application/json'
      };

      // Add authentication for MCP Proxy
      // Support three token types:
      // 1. JWT (Azure AD token) - 3 parts separated by dots
      // 2. AgenticWork API key - starts with 'awc_'
      // 3. Fallback to internal API key for service-to-service auth
      const isValidJwt = userToken && userToken.split('.').length === 3;
      const isAgenticWorkApiKey = userToken && userToken.startsWith('awc_');

      if (isValidJwt || isAgenticWorkApiKey) {
        // Pass user's actual token (JWT or API key) for OBO authentication
        headers['Authorization'] = `Bearer ${userToken}`;
      } else {
        // Use API internal key for service-to-service auth when no valid user token
        const apiInternalKey = process.env.API_INTERNAL_KEY || '';
        headers['Authorization'] = `Bearer ${apiInternalKey}`;
      }

      // Pass ID token for OBO (On-Behalf-Of) authentication
      // CRITICAL: ID token has audience = app's client ID, which is required for OBO
      // The access token has audience = https://management.azure.com which is WRONG for OBO
      // Both AWS and Azure MCP servers need the ID token for OBO to work!
      if (idToken) {
        headers['X-AWS-ID-Token'] = idToken;     // For AWS Identity Center
        headers['X-Azure-ID-Token'] = idToken;   // For Azure ARM MCP
      }

      // Prepare audit data
      // CRITICAL: Use mcpToolName (original name) for MCP proxy, not resolvedToolName (sanitized)
      // The MCP server expects the original name like "aws___search_documentation"
      const requestPayload = {
        server: targetServer,
        tool: mcpToolName, // Use original tool name for MCP proxy
        arguments: toolArgs,
        id: toolCall.id
      };
      const requestSizeBytes = new TextEncoder().encode(JSON.stringify(requestPayload)).length;
      const startTime = Date.now();

      // Call MCP Proxy to execute the tool
      const response = await axios.post(
        `${mcpProxyUrl}/mcp/tool`,
        requestPayload,
        {
          headers,
          timeout: 600000 // 10 minute timeout for long-running Azure operations (AKS, VMs, etc.)
        }
      );

      const executionTimeMs = Date.now() - startTime;
      const responseData = response.data;
      const responseSizeBytes = new TextEncoder().encode(JSON.stringify(responseData)).length;
      const mcpProxyHost = response.headers?.['x-mcp-proxy-host'] || 'mcp-proxy';

      logger.info({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        targetServer,
        statusCode: response.status,
        hasResult: !!response.data,
        executionTime: executionTimeMs,
        resultPreview: JSON.stringify(responseData?.result || responseData).substring(0, 200)
      }, '[TOOL-EXEC] Tool execution completed via MCP Proxy');

      // Handle MCP Proxy response format
      let toolResult;
      let isSuccess = true;
      let errorMessage: string | undefined;

      if (responseData?.error) {
        // MCP Proxy returned an error
        isSuccess = false;
        errorMessage = responseData.error.message || 'MCP tool execution failed';
        throw new Error(errorMessage);
      } else {
        // Extract result from MCP Proxy response
        toolResult = responseData?.result;
      }

      // Handle nested result structures from Azure MCP
      if (toolResult && typeof toolResult === 'object' && toolResult.result) {
        toolResult = toolResult.result;
      }

      // Log successful MCP call audit data
      if (userId) {
        await logMCPCall({
          userId,
          userName,
          userEmail,
          sessionId,
          messageId,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          resolvedToolName,
          mcpServer: targetServer,
          mcpProxyHost,
          requestPayload: toolArgs,
          responsePayload: toolResult,
          executionTimeMs,
          requestSizeBytes,
          responseSizeBytes,
          success: isSuccess,
          errorMessage,
          userToken: !!userToken,
          ipAddress,
          userAgent,
          modelUsed,
          modelProvider
        }, logger);
      }

      // CRITICAL: Emit tool_result event to keep SSE stream alive
      // This shows the frontend that the tool execution completed successfully
      if (emitEvent) {
        const toolResultEvent = {
          name: resolvedToolName,
          result: toolResult,
          toolCallId: toolCall.id,
          executionTimeMs,
          targetServer,
          timestamp: new Date().toISOString()
        };

        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          executionTimeMs,
          resultSizeBytes: responseSizeBytes
        }, '🔧 [TOOL-SSE] Emitting tool_result event');

        emitEvent('tool_result', toolResultEvent);
      }

      results.push({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,  // Use resolved name
        result: toolResult,
        serverName: targetServer,  // MCP server that executed the tool
        executedOn: mcpProxyHost,
        executionTimeMs,
        requestSize: requestSizeBytes,
        responseSize: responseSizeBytes
      });

      // =================================================================
      // 💾 CACHE TOOL RESULT - Store in Redis for future lookups
      // =================================================================
      if (cacheableCheck && effectiveUserId && toolResult) {
        const ttl = getCacheTTL(resolvedToolName);
        cacheToolResult(
          resolvedToolName,
          effectiveUserId,
          argsHash,
          toolResult,
          ttl,
          logger
        ).catch(() => {}); // Fire and forget - don't block on caching

        // =================================================================
        // 🧠 MILVUS SEMANTIC CACHE STORAGE (Layer 2) - Cross-user caching
        // =================================================================
        // Store result in Milvus for semantic matching by other users
        try {
          // Ensure semantic cache is initialized (should already be from lookup above)
          await ensureSemanticCacheInitialized(logger);

          const semanticCache = getToolResultCacheService(logger);
          const cacheReady = semanticCache.isReady();
          logger.info({
            toolName: resolvedToolName,
            cacheReady,
            tenantId,
            userId: effectiveUserId
          }, `[SEMANTIC-CACHE] Attempting to store result (cache ready: ${cacheReady})`);

          if (cacheReady) {
            semanticCache.cacheResult(
              tenantId,
              effectiveUserId,
              resolvedToolName,
              toolArgs,
              toolResult,
              originalQuery
            ).then(cached => {
              if (cached) {
                logger.debug({
                  toolName: resolvedToolName,
                  tenantId
                }, '[SEMANTIC-CACHE] 💾 Result stored in semantic cache');
              }
            }).catch(() => {}); // Fire and forget
          }
        } catch (semanticCacheError) {
          logger.debug({ error: semanticCacheError }, '[SEMANTIC-CACHE] Failed to store in semantic cache (non-fatal)');
        }
      }

      // Record successful tool execution to Milvus for semantic learning
      if (userId && originalQuery) {
        recordToolSuccess(
          userId,
          sessionId,
          originalQuery,
          resolvedToolName,
          targetServer || 'unknown',
          executionTimeMs,
          toolResult,
          logger
        ).catch(() => {}); // Fire and forget - don't block on tracking
      }

    } catch (error: any) {
      const errorMessage = error.message || 'Tool execution failed';
      const errorResponseHost = error.response?.headers?.['x-mcp-proxy-host'] || 'mcp-proxy';

      logger.error({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        targetServer,
        error: errorMessage,
        responseData: error.response?.data,
        statusCode: error.response?.status
      }, '[TOOL-EXEC] Tool execution failed');

      // CRITICAL: Emit tool_error event to keep SSE stream alive
      // This shows the frontend that the tool execution failed
      if (emitEvent) {
        const toolErrorEvent = {
          name: resolvedToolName,
          error: errorMessage,
          toolCallId: toolCall.id,
          targetServer,
          timestamp: new Date().toISOString()
        };

        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          error: errorMessage
        }, '🔧 [TOOL-SSE] Emitting tool_error event');

        emitEvent('tool_error', toolErrorEvent);
      }

      // Log failed MCP call audit data
      if (userId) {
        await logMCPCall({
          userId,
          userName,
          userEmail,
          sessionId,
          messageId,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          resolvedToolName,
          mcpServer: targetServer,
          mcpProxyHost: errorResponseHost,
          requestPayload: toolArgs || {},
          responsePayload: error.response?.data || null,
          executionTimeMs: 0, // No timing data for failed calls
          requestSizeBytes: toolArgs ? new TextEncoder().encode(JSON.stringify(toolArgs)).length : 0,
          responseSizeBytes: error.response?.data ? new TextEncoder().encode(JSON.stringify(error.response.data)).length : 0,
          success: false,
          errorMessage,
          userToken: !!userToken,
          ipAddress,
          userAgent,
          modelUsed,
          modelProvider
        }, logger);
      }

      // Add error result
      results.push({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        result: null,
        error: errorMessage,
        serverName: targetServer,  // Include server name even on error for traceability
        executedOn: errorResponseHost,
        executionTimeMs: 0,
        requestSize: toolArgs ? new TextEncoder().encode(JSON.stringify(toolArgs)).length : 0,
        responseSize: error.response?.data ? new TextEncoder().encode(JSON.stringify(error.response.data)).length : 0
      });
    }
  }

  logger.info({
    totalToolCalls: toolCalls.length,
    successfulCalls: results.filter(r => !r.error).length,
    failedCalls: results.filter(r => r.error).length,
    hasCodeExecutionContext: !!updatedCodeExecutionContext,
    agenticodeSessionId: updatedCodeExecutionContext?.sessionId
  }, '[TOOL-EXEC] Tool execution batch completed');

  return { results, codeExecutionContext: updatedCodeExecutionContext };
}

/**
 * Format tool results - just pass raw JSON to the LLM
 * The LLM is smart enough to parse any JSON structure from any MCP
 */
function formatToolResult(toolName: string, result: any): string {
  // Handle null/undefined
  if (result === null || result === undefined) {
    return 'No data returned from tool';
  }

  // Already a string - return as-is
  if (typeof result === 'string') {
    return result;
  }

  // For everything else (objects, arrays, primitives), just return JSON
  // The LLM is smart enough to parse JSON - don't hardcode MCP-specific formatting
  return JSON.stringify(result, null, 2);
}

/**
 * Convert tool results to OpenAI tool message format with smart formatting
 *
 * @param toolResults - Array of tool execution results
 * @returns Array of tool messages for conversation
 */
export function formatToolResultsAsMessages(toolResults: ToolResult[]): any[] {
  return toolResults.map(result => {
    const content = result.error
      ? `Error: ${result.error}`
      : formatToolResult(result.toolName, result.result);

    return {
      role: 'tool',
      tool_call_id: result.toolCallId,
      name: result.toolName,
      content: content
    };
  });
}
