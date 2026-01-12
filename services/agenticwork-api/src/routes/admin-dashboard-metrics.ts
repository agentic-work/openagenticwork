/**
 * Admin Dashboard Metrics API
 *
 * Provides comprehensive time-series metrics for the admin dashboard
 * Supports Grafana-style time ranges: 1h, 6h, 12h, 24h, 7d, 30d, 90d
 *
 * IMPORTANT: Cost and token data comes from llm_request_logs (SOT)
 * via LLMMetricsService, NOT from chat_messages.cost which is often incomplete
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { PrismaClient, Prisma } from '@prisma/client';
import { loggers } from '../utils/logger.js';
import { LLMMetricsService } from '../services/LLMMetricsService.js';

const logger = loggers.routes.child({ component: 'AdminDashboardMetrics' });
const prisma = new PrismaClient();
const llmMetricsService = new LLMMetricsService();

interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

interface MetricSeries {
  name: string;
  data: TimeSeriesPoint[];
  total: number;
  change?: number; // Percentage change from previous period
}

// Cost data is stored in the database (msg.cost field) - no hardcoded pricing needed
// Costs are calculated by LLMMetricsService at request time and stored in llm_request_logs

const adminDashboardMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/dashboard/metrics
   * Returns comprehensive time-series metrics for the admin dashboard
   */
  fastify.get('/api/admin/dashboard/metrics', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { timeRange = '24h' } = request.query as { timeRange?: string };

    try {
      // Parse time range
      const rangeMs = parseTimeRange(timeRange);
      const startDate = new Date(Date.now() - rangeMs);
      const previousStartDate = new Date(Date.now() - (rangeMs * 2));

      // Determine bucket size for time-series grouping
      const bucketMs = getBucketSize(rangeMs);
      const bucketCount = Math.ceil(rangeMs / bucketMs);

      // Fetch all relevant data including embedding usage and code mode
      const [
        sessionsData,
        messagesData,
        usersData,
        imagesData,
        embeddingUsage,
        contextWindowData,
        flowiseUsersData,
        perUserSessionData,
        // NEW: Code Mode data from AWCodeMessage
        codeMessagesData
      ] = await Promise.all([
        // Sessions with timestamps
        prisma.chatSession.findMany({
          where: { created_at: { gte: startDate } },
          select: { id: true, created_at: true, user_id: true }
        }),

        // Messages with token data and session info
        prisma.chatMessage.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            role: true,
            model: true,
            tokens_input: true,
            tokens_output: true,
            cost: true,
            mcp_calls: true,
            created_at: true,
            session_id: true
          }
        }),

        // Active users with Flowise status
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            name: true,
            created_at: true,
            last_login_at: true,
            flowise_enabled: true,
            flowise_user_id: true
          }
        }),

        // Generated images (from chat messages with image content)
        prisma.chatMessage.findMany({
          where: {
            created_at: { gte: startDate },
            role: 'assistant',
            content: { contains: '![Generated Image]' }
          },
          select: { id: true, created_at: true, model: true }
        }),

        // Embedding usage - get user memories with timestamps for time series
        prisma.userMemory.findMany({
          where: { created_at: { gte: startDate } },
          select: { id: true, created_at: true }
        }),

        // Context window metrics from sessions
        prisma.chatSession.findMany({
          where: {
            created_at: { gte: startDate },
            context_tokens_total: { gt: 0 }
          },
          select: {
            id: true,
            user_id: true,
            model: true,
            context_tokens_input: true,
            context_tokens_output: true,
            context_tokens_total: true,
            context_window_size: true,
            context_utilization_pct: true,
            created_at: true
          }
        }),

        // Flowise enabled users count
        prisma.user.count({
          where: { flowise_enabled: true }
        }),

        // Per-user session and message data for usage breakdown
        prisma.chatSession.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            user_id: true,
            created_at: true,
            message_count: true,
            user: {
              select: {
                email: true,
                name: true
              }
            }
          }
        }),

        // NEW: Code Mode messages with token data
        prisma.aWCodeMessage.findMany({
          where: { created_at: { gte: startDate } },
          select: {
            id: true,
            tokens_input: true,
            tokens_output: true,
            tokens: true,
            cost: true,
            created_at: true,
            session_id: true
          }
        })
      ]);

      // Also get previous period data for change calculation
      const [prevSessions, prevMessages] = await Promise.all([
        prisma.chatSession.count({
          where: {
            created_at: { gte: previousStartDate, lt: startDate }
          }
        }),
        prisma.chatMessage.count({
          where: {
            created_at: { gte: previousStartDate, lt: startDate }
          }
        })
      ]);

      // NEW: Fetch agenticode-specific metrics from LLMRequestLog where source = 'code'
      const agenticodeRequestLogs = await prisma.lLMRequestLog.findMany({
        where: {
          source: 'code',
          created_at: { gte: startDate }
        },
        select: {
          id: true,
          api_key_id: true,
          model: true,
          prompt_tokens: true,
          completion_tokens: true,
          total_tokens: true,
          reasoning_tokens: true,
          total_cost: true,
          created_at: true
        }
      });

      // Fetch API key names for the agenticode requests
      const agenticodeApiKeyIds = [...new Set(agenticodeRequestLogs.map(r => r.api_key_id).filter(Boolean))] as string[];
      const apiKeysData = agenticodeApiKeyIds.length > 0 ? await prisma.apiKey.findMany({
        where: { id: { in: agenticodeApiKeyIds } },
        select: { id: true, name: true, user: { select: { email: true, name: true } } }
      }) : [];
      const apiKeyMap = new Map(apiKeysData.map(k => [k.id, k]));

      // Build time series data
      const buckets = createTimeBuckets(startDate, bucketMs, bucketCount);

      // Process sessions time series
      const sessionsTimeSeries = createTimeSeries(
        sessionsData,
        buckets,
        (item) => item.created_at
      );

      // Process messages time series
      const messagesTimeSeries = createTimeSeries(
        messagesData,
        buckets,
        (item) => item.created_at
      );

      // Process token usage time series (Chat Mode)
      const tokenUsageTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: messagesData
          .filter(m => m.created_at >= bucket.start && m.created_at < bucket.end)
          .reduce((sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0), 0)
      }));

      // NEW: Process Code Mode token usage time series
      const codeTokenUsageTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: codeMessagesData
          .filter(m => m.created_at >= bucket.start && m.created_at < bucket.end)
          .reduce((sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0) + (m.tokens || 0), 0)
      }));

      // NEW: Calculate Code Mode totals
      const totalCodeTokens = codeMessagesData.reduce(
        (sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0) + (m.tokens || 0), 0
      );
      const totalCodeCost = codeMessagesData.reduce(
        (sum, m) => sum + (Number(m.cost) || 0), 0
      );

      // Process images generated time series
      const imagesTimeSeries = createTimeSeries(
        imagesData,
        buckets,
        (item) => item.created_at
      );

      // Process embeddings time series
      const embeddingsTimeSeries = createTimeSeries(
        embeddingUsage,
        buckets,
        (item) => item.created_at
      );

      // Calculate model usage breakdown
      const modelUsage = new Map<string, { count: number; tokens: number; cost: number }>();
      for (const msg of messagesData) {
        if (msg.role === 'assistant') {
          const model = msg.model || 'unknown';
          const existing = modelUsage.get(model) || { count: 0, tokens: 0, cost: 0 };
          const inputTokens = msg.tokens_input || 0;
          const outputTokens = msg.tokens_output || 0;
          const cost = msg.cost ? Number(msg.cost) : 0;

          modelUsage.set(model, {
            count: existing.count + 1,
            tokens: existing.tokens + inputTokens + outputTokens,
            cost: existing.cost + cost
          });
        }
      }

      // Calculate MCP tool usage
      const mcpToolUsage = new Map<string, number>();
      for (const msg of messagesData) {
        if (msg.mcp_calls && Array.isArray(msg.mcp_calls)) {
          for (const call of msg.mcp_calls as any[]) {
            const toolName = call?.name || call?.toolName || 'unknown';
            mcpToolUsage.set(toolName, (mcpToolUsage.get(toolName) || 0) + 1);
          }
        }
      }

      // Calculate cost by model time series
      const costByModelTimeSeries: { model: string; data: TimeSeriesPoint[] }[] = [];
      const topModels = Array.from(modelUsage.entries())
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 5)
        .map(([model]) => model);

      for (const model of topModels) {
        const series = buckets.map(bucket => {
          const modelMessages = messagesData.filter(
            m => m.model === model &&
                 m.created_at >= bucket.start &&
                 m.created_at < bucket.end
          );
          const cost = modelMessages.reduce((sum, m) => {
            return sum + (m.cost ? Number(m.cost) : 0);
          }, 0);
          return { timestamp: bucket.timestamp, value: cost };
        });
        costByModelTimeSeries.push({ model, data: series });
      }

      // Calculate totals
      const totalSessions = sessionsData.length;
      const totalMessages = messagesData.length;

      // IMPORTANT: Get accurate token and cost data from llm_request_logs (SOT)
      // This is the same source as LLM Performance Metrics for consistency
      const llmMetrics = await llmMetricsService.getAggregatedMetrics({
        startDate,
        endDate: new Date()
      });

      // Use LLM metrics as primary source (accurate)
      // Fall back to chat_messages if llm_request_logs is empty (legacy data)
      const chatMessageTokens = messagesData.reduce(
        (sum, m) => sum + (m.tokens_input || 0) + (m.tokens_output || 0), 0
      );
      const chatMessageCost = messagesData.reduce((sum, m) => {
        return sum + (m.cost ? Number(m.cost) : 0);
      }, 0);

      // Use llm_request_logs data if available, otherwise fall back to chat_messages
      const totalTokens = llmMetrics.totalTokens > 0 ? llmMetrics.totalTokens : chatMessageTokens;
      const totalCost = llmMetrics.totalCost > 0 ? llmMetrics.totalCost : chatMessageCost;

      const totalImages = imagesData.length;
      const totalMcpCalls = messagesData.reduce((sum, m) => {
        return sum + (Array.isArray(m.mcp_calls) ? m.mcp_calls.length : 0);
      }, 0);
      const totalEmbeddings = embeddingUsage.length;

      // Active users (users with activity in time range)
      const activeUserIds = new Set(sessionsData.map(s => s.user_id));
      const totalUsers = usersData.length;
      const activeUsers = activeUserIds.size;

      // Calculate change percentages
      const sessionChange = prevSessions > 0
        ? ((totalSessions - prevSessions) / prevSessions) * 100
        : 0;
      const messageChange = prevMessages > 0
        ? ((totalMessages - prevMessages) / prevMessages) * 100
        : 0;

      // Calculate per-user usage metrics
      const perUserUsage = new Map<string, {
        userId: string;
        email: string;
        name: string;
        sessions: number;
        messages: number;
        tokens: number;
        cost: number;
        lastActive: Date;
      }>();

      // Aggregate user data from sessions and messages
      for (const session of perUserSessionData) {
        const userId = session.user_id;
        const existing = perUserUsage.get(userId) || {
          userId,
          email: session.user?.email || 'Unknown',
          name: session.user?.name || 'Unknown',
          sessions: 0,
          messages: 0,
          tokens: 0,
          cost: 0,
          lastActive: session.created_at
        };
        existing.sessions++;
        existing.messages += session.message_count || 0;
        if (session.created_at > existing.lastActive) {
          existing.lastActive = session.created_at;
        }
        perUserUsage.set(userId, existing);
      }

      // Add token and cost data from messages
      for (const msg of messagesData) {
        if (msg.role === 'assistant') {
          // Find the session's user
          const session = perUserSessionData.find(s => s.id === msg.session_id);
          if (session) {
            const userId = session.user_id;
            const existing = perUserUsage.get(userId);
            if (existing) {
              const inputTokens = msg.tokens_input || 0;
              const outputTokens = msg.tokens_output || 0;
              const cost = msg.cost ? Number(msg.cost) : 0;
              existing.tokens += inputTokens + outputTokens;
              existing.cost += cost;
              perUserUsage.set(userId, existing);
            }
          }
        }
      }

      // Per-user time series (top 10 users by usage)
      const topUsers = Array.from(perUserUsage.entries())
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 10);

      const perUserTimeSeries: { userId: string; name: string; data: TimeSeriesPoint[] }[] = [];
      for (const [userId, userData] of topUsers) {
        const userMessages = messagesData.filter(m => {
          const session = perUserSessionData.find(s => s.id === m.session_id);
          return session?.user_id === userId && m.role === 'assistant';
        });

        const series = buckets.map(bucket => {
          const cost = userMessages
            .filter(m => m.created_at >= bucket.start && m.created_at < bucket.end)
            .reduce((sum, m) => sum + (m.cost ? Number(m.cost) : 0), 0);
          return { timestamp: bucket.timestamp, value: Math.round(cost * 100) / 100 };
        });
        perUserTimeSeries.push({ userId, name: userData.name || userData.email, data: series });
      }

      // Calculate context window metrics summary
      const contextWindowMetrics = {
        sessionsWithData: contextWindowData.length,
        avgUtilization: contextWindowData.length > 0
          ? contextWindowData.reduce((sum, s) => sum + (Number(s.context_utilization_pct) || 0), 0) / contextWindowData.length
          : 0,
        maxUtilization: contextWindowData.length > 0
          ? Math.max(...contextWindowData.map(s => Number(s.context_utilization_pct) || 0))
          : 0,
        highUtilizationCount: contextWindowData.filter(s => Number(s.context_utilization_pct) >= 80).length,
        totalContextTokens: contextWindowData.reduce((sum, s) => sum + (s.context_tokens_total || 0), 0),
        avgTokensPerSession: contextWindowData.length > 0
          ? contextWindowData.reduce((sum, s) => sum + (s.context_tokens_total || 0), 0) / contextWindowData.length
          : 0
      };

      // Context utilization time series
      const contextUtilizationTimeSeries = buckets.map(bucket => {
        const sessionsInBucket = contextWindowData.filter(
          s => s.created_at >= bucket.start && s.created_at < bucket.end
        );
        const avgUtil = sessionsInBucket.length > 0
          ? sessionsInBucket.reduce((sum, s) => sum + (Number(s.context_utilization_pct) || 0), 0) / sessionsInBucket.length
          : 0;
        return { timestamp: bucket.timestamp, value: Math.round(avgUtil * 100) / 100 };
      });

      // NEW: Calculate Agenticode CLI metrics
      const agenticodeMetrics = {
        totalRequests: agenticodeRequestLogs.length,
        totalTokens: agenticodeRequestLogs.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
        totalPromptTokens: agenticodeRequestLogs.reduce((sum, r) => sum + (r.prompt_tokens || 0), 0),
        totalCompletionTokens: agenticodeRequestLogs.reduce((sum, r) => sum + (r.completion_tokens || 0), 0),
        totalThinkingTokens: agenticodeRequestLogs.reduce((sum, r) => sum + (r.reasoning_tokens || 0), 0),
        totalCost: agenticodeRequestLogs.reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0),
        uniqueApiKeys: agenticodeApiKeyIds.length
      };

      // Agenticode time series
      const agenticodeTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: agenticodeRequestLogs.filter(
          r => r.created_at >= bucket.start && r.created_at < bucket.end
        ).length
      }));

      // Agenticode token usage time series
      const agenticodeTokenTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: agenticodeRequestLogs
          .filter(r => r.created_at >= bucket.start && r.created_at < bucket.end)
          .reduce((sum, r) => sum + (r.total_tokens || 0), 0)
      }));

      // Agenticode cost time series
      const agenticodeCostTimeSeries: TimeSeriesPoint[] = buckets.map(bucket => ({
        timestamp: bucket.timestamp,
        value: Math.round(agenticodeRequestLogs
          .filter(r => r.created_at >= bucket.start && r.created_at < bucket.end)
          .reduce((sum, r) => sum + (Number(r.total_cost) || 0), 0) * 100) / 100
      }));

      // Agenticode usage by API key
      const agenticodeByApiKey = new Map<string, {
        apiKeyId: string;
        keyName: string;
        userName: string;
        userEmail: string;
        requests: number;
        tokens: number;
        thinkingTokens: number;
        cost: number;
      }>();

      for (const log of agenticodeRequestLogs) {
        const keyId = log.api_key_id || 'unknown';
        const apiKeyInfo = apiKeyMap.get(keyId);
        const existing = agenticodeByApiKey.get(keyId) || {
          apiKeyId: keyId,
          keyName: apiKeyInfo?.name || 'Unknown Key',
          userName: apiKeyInfo?.user?.name || 'Unknown',
          userEmail: apiKeyInfo?.user?.email || 'Unknown',
          requests: 0,
          tokens: 0,
          thinkingTokens: 0,
          cost: 0
        };
        existing.requests++;
        existing.tokens += log.total_tokens || 0;
        existing.thinkingTokens += log.reasoning_tokens || 0;
        existing.cost += Number(log.total_cost) || 0;
        agenticodeByApiKey.set(keyId, existing);
      }

      // Agenticode model usage
      const agenticodeModelUsage = new Map<string, { count: number; tokens: number; cost: number; thinkingTokens: number }>();
      for (const log of agenticodeRequestLogs) {
        const model = log.model || 'unknown';
        const existing = agenticodeModelUsage.get(model) || { count: 0, tokens: 0, cost: 0, thinkingTokens: 0 };
        existing.count++;
        existing.tokens += log.total_tokens || 0;
        existing.cost += Number(log.total_cost) || 0;
        existing.thinkingTokens += log.reasoning_tokens || 0;
        agenticodeModelUsage.set(model, existing);
      }

      // Flowise metrics
      const flowiseMetrics = {
        enabledUsers: flowiseUsersData,
        totalUsers: usersData.length,
        adoptionRate: usersData.length > 0
          ? Math.round((flowiseUsersData / usersData.length) * 100)
          : 0
      };

      return reply.send({
        success: true,
        timeRange,
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          bucketSize: formatBucketSize(bucketMs)
        },
        summary: {
          totalUsers,
          activeUsers,
          totalSessions,
          sessionChange: Math.round(sessionChange * 10) / 10,
          totalMessages,
          messageChange: Math.round(messageChange * 10) / 10,
          totalTokens,
          totalCost: Math.round(totalCost * 100) / 100,
          totalImages,
          totalMcpCalls,
          totalEmbeddings,
          flowiseUsers: flowiseUsersData,
          contextWindowAvgUtil: Math.round(contextWindowMetrics.avgUtilization * 100) / 100,
          // NEW: Code Mode metrics
          totalCodeTokens,
          totalCodeCost: Math.round(totalCodeCost * 100) / 100,
          totalCodeMessages: codeMessagesData.length
        },
        timeSeries: {
          sessions: sessionsTimeSeries,
          messages: messagesTimeSeries,
          tokenUsage: tokenUsageTimeSeries,
          images: imagesTimeSeries,
          embeddings: embeddingsTimeSeries,
          contextUtilization: contextUtilizationTimeSeries,
          // NEW: Code Mode token usage time series
          codeTokenUsage: codeTokenUsageTimeSeries
        },
        modelUsage: Array.from(modelUsage.entries()).map(([model, data]) => ({
          model,
          ...data,
          cost: Math.round(data.cost * 100) / 100
        })).sort((a, b) => b.count - a.count),
        costByModel: costByModelTimeSeries,
        mcpToolUsage: Array.from(mcpToolUsage.entries())
          .map(([tool, count]) => ({ tool, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20),
        // NEW: Per-user usage breakdown
        perUserUsage: Array.from(perUserUsage.values())
          .map(u => ({
            ...u,
            cost: Math.round(u.cost * 100) / 100,
            lastActive: u.lastActive.toISOString()
          }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 20),
        // NEW: Per-user time series (top 10 users)
        perUserTimeSeries,
        // NEW: Context window metrics
        contextWindowMetrics,
        // NEW: Flowise adoption metrics
        flowiseMetrics,
        // NEW: Agenticode CLI metrics
        agenticodeMetrics: {
          ...agenticodeMetrics,
          totalCost: Math.round(agenticodeMetrics.totalCost * 100) / 100
        },
        agenticodeTimeSeries: {
          requests: agenticodeTimeSeries,
          tokens: agenticodeTokenTimeSeries,
          cost: agenticodeCostTimeSeries
        },
        agenticodeByApiKey: Array.from(agenticodeByApiKey.values())
          .map(k => ({
            ...k,
            cost: Math.round(k.cost * 100) / 100
          }))
          .sort((a, b) => b.cost - a.cost),
        agenticodeModelUsage: Array.from(agenticodeModelUsage.entries())
          .map(([model, data]) => ({
            model,
            ...data,
            cost: Math.round(data.cost * 100) / 100
          }))
          .sort((a, b) => b.cost - a.cost)
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch dashboard metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch dashboard metrics'
      });
    }
  });

  logger.info('Admin dashboard metrics routes registered');
};

// Helper functions

function parseTimeRange(range: string): number {
  const units: Record<string, number> = {
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };

  const match = range.match(/^(\d+)([hd])$/);
  if (!match) return 24 * 60 * 60 * 1000; // Default to 24h

  return parseInt(match[1]) * (units[match[2]] || units['h']);
}

function getBucketSize(rangeMs: number): number {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  if (rangeMs <= 6 * hour) return 15 * 60 * 1000;     // 15 min buckets
  if (rangeMs <= 24 * hour) return hour;              // 1 hour buckets
  if (rangeMs <= 7 * day) return 4 * hour;            // 4 hour buckets
  if (rangeMs <= 30 * day) return day;                // 1 day buckets
  return 7 * day;                                      // 1 week buckets
}

function formatBucketSize(bucketMs: number): string {
  const minutes = bucketMs / (60 * 1000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours}h`;
  const days = hours / 24;
  if (days < 7) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

interface TimeBucket {
  start: Date;
  end: Date;
  timestamp: string;
}

function createTimeBuckets(startDate: Date, bucketMs: number, count: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const start = new Date(Math.floor(startDate.getTime() / bucketMs) * bucketMs);

  for (let i = 0; i < count; i++) {
    const bucketStart = new Date(start.getTime() + (i * bucketMs));
    const bucketEnd = new Date(bucketStart.getTime() + bucketMs);
    buckets.push({
      start: bucketStart,
      end: bucketEnd,
      timestamp: bucketStart.toISOString()
    });
  }

  return buckets;
}

function createTimeSeries<T>(
  items: T[],
  buckets: TimeBucket[],
  getTimestamp: (item: T) => Date
): TimeSeriesPoint[] {
  return buckets.map(bucket => ({
    timestamp: bucket.timestamp,
    value: items.filter(item => {
      const ts = getTimestamp(item);
      return ts >= bucket.start && ts < bucket.end;
    }).length
  }));
}

export default adminDashboardMetricsRoutes;
