/**
 * Admin Metrics Routes
 * Provides metrics for MCP tool execution and LLM usage
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { PrismaClient } from '@prisma/client';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes.child({ component: 'AdminMetrics' });
const prisma = new PrismaClient();

const adminMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get MCP execution metrics
   */
  fastify.get('/api/admin/metrics/mcp', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { timeRange = '24h' } = request.query as any;

    try {
      // Calculate date filter
      let dateFilter: Date;
      const now = new Date();
      switch (timeRange) {
        case '1h':
          dateFilter = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      // Fetch messages with MCP calls
      const messages = await prisma.chatMessage.findMany({
        where: {
          mcp_calls: { not: null },
          created_at: { gte: dateFilter }
        },
        select: {
          mcp_calls: true,
          created_at: true
        }
      });

      // Analyze MCP calls
      let totalCalls = 0;
      let successfulCalls = 0;
      let failedCalls = 0;
      let totalExecutionTime = 0;
      const toolExecutionTimes: Record<string, number[]> = {};
      const toolCallCounts: Record<string, { success: number; failed: number }> = {};
      const serverCounts: Record<string, number> = {};
      const hourlyActivity: Record<string, number> = {};

      for (const message of messages) {
        if (!message.mcp_calls) continue;
        const mcpCalls = Array.isArray(message.mcp_calls) ? message.mcp_calls : [message.mcp_calls];

        for (const call of mcpCalls) {
          const callData = call as any;
          totalCalls++;

          const isSuccess = !callData.error;
          if (isSuccess) {
            successfulCalls++;
          } else {
            failedCalls++;
          }

          const executionTime = callData.executionTime || 0;
          totalExecutionTime += executionTime;

          // Track tool execution times
          const toolName = callData.toolName || callData.name || 'unknown';
          if (!toolExecutionTimes[toolName]) {
            toolExecutionTimes[toolName] = [];
          }
          toolExecutionTimes[toolName].push(executionTime);

          // Track tool call counts
          if (!toolCallCounts[toolName]) {
            toolCallCounts[toolName] = { success: 0, failed: 0 };
          }
          if (isSuccess) {
            toolCallCounts[toolName].success++;
          } else {
            toolCallCounts[toolName].failed++;
          }

          // Track server counts
          const serverId = callData.serverId || callData.server || 'unknown';
          serverCounts[serverId] = (serverCounts[serverId] || 0) + 1;

          // Track hourly activity
          const hour = new Date(callData.timestamp || message.created_at).toISOString().slice(0, 13);
          hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
        }
      }

      // Calculate tool performance metrics
      const toolPerformance = Object.entries(toolExecutionTimes).map(([toolName, times]) => {
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const counts = toolCallCounts[toolName];

        return {
          toolName,
          avgExecutionTime: Math.round(avgTime),
          minExecutionTime: minTime,
          maxExecutionTime: maxTime,
          totalCalls: counts.success + counts.failed,
          successfulCalls: counts.success,
          failedCalls: counts.failed,
          successRate: ((counts.success / (counts.success + counts.failed)) * 100).toFixed(2)
        };
      }).sort((a, b) => b.totalCalls - a.totalCalls);

      // Top servers by call count
      const topServers = Object.entries(serverCounts)
        .map(([serverId, count]) => ({ serverId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Hourly activity timeline
      const activityTimeline = Object.entries(hourlyActivity)
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => a.hour.localeCompare(b.hour));

      return reply.send({
        success: true,
        timeRange,
        summary: {
          totalCalls,
          successfulCalls,
          failedCalls,
          successRate: totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(2) : '0.00',
          avgExecutionTime: Math.round(totalCalls > 0 ? totalExecutionTime / totalCalls : 0)
        },
        toolPerformance: toolPerformance.slice(0, 20),
        topServers,
        activityTimeline
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch MCP metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch MCP metrics'
      });
    }
  });

  /**
   * Get LLM usage metrics
   */
  fastify.get('/api/admin/metrics/llm', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { timeRange = '24h' } = request.query as any;

    try {
      // Calculate date filter
      let dateFilter: Date;
      const now = new Date();
      switch (timeRange) {
        case '1h':
          dateFilter = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      // Fetch messages with LLM usage
      const messages = await prisma.chatMessage.findMany({
        where: {
          created_at: { gte: dateFilter },
          role: 'assistant'
        },
        select: {
          model: true,
          tokens_input: true,
          tokens_output: true,
          cost: true,
          created_at: true,
          user_id: true
        }
      });

      // Analyze LLM usage
      let totalMessages = 0;
      let totalTokensInput = 0;
      let totalTokensOutput = 0;
      let totalTokens = 0;
      let totalCost = 0;
      const modelUsage: Record<string, {
        count: number;
        tokensInput: number;
        tokensOutput: number;
        cost: number;
      }> = {};
      const userUsage: Record<string, {
        messages: number;
        tokens: number;
        cost: number;
      }> = {};
      const hourlyUsage: Record<string, {
        messages: number;
        tokens: number;
        cost: number;
      }> = {};

      for (const message of messages) {
        totalMessages++;
        const tokensIn = message.tokens_input || 0;
        const tokensOut = message.tokens_output || 0;
        const tokens = tokensIn + tokensOut;
        const cost = Number(message.cost || 0);

        totalTokensInput += tokensIn;
        totalTokensOutput += tokensOut;
        totalTokens += tokens;
        totalCost += cost;

        // Track model usage
        const model = message.model || 'unknown';
        if (!modelUsage[model]) {
          modelUsage[model] = { count: 0, tokensInput: 0, tokensOutput: 0, cost: 0 };
        }
        modelUsage[model].count++;
        modelUsage[model].tokensInput += tokensIn;
        modelUsage[model].tokensOutput += tokensOut;
        modelUsage[model].cost += cost;

        // Track user usage
        const userId = message.user_id || 'unknown';
        if (!userUsage[userId]) {
          userUsage[userId] = { messages: 0, tokens: 0, cost: 0 };
        }
        userUsage[userId].messages++;
        userUsage[userId].tokens += tokens;
        userUsage[userId].cost += cost;

        // Track hourly usage
        const hour = message.created_at.toISOString().slice(0, 13);
        if (!hourlyUsage[hour]) {
          hourlyUsage[hour] = { messages: 0, tokens: 0, cost: 0 };
        }
        hourlyUsage[hour].messages++;
        hourlyUsage[hour].tokens += tokens;
        hourlyUsage[hour].cost += cost;
      }

      // Top models by usage
      const topModels = Object.entries(modelUsage)
        .map(([model, data]) => ({
          model,
          count: data.count,
          tokensInput: data.tokensInput,
          tokensOutput: data.tokensOutput,
          totalTokens: data.tokensInput + data.tokensOutput,
          cost: data.cost,
          avgTokensPerRequest: Math.round((data.tokensInput + data.tokensOutput) / data.count)
        }))
        .sort((a, b) => b.count - a.count);

      // Top users by token usage
      const topUsers = Object.entries(userUsage)
        .map(([userId, data]) => ({
          userId,
          messages: data.messages,
          tokens: data.tokens,
          cost: data.cost,
          avgTokensPerMessage: Math.round(data.tokens / data.messages)
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 10);

      // Hourly usage timeline
      const usageTimeline = Object.entries(hourlyUsage)
        .map(([hour, data]) => ({
          hour,
          messages: data.messages,
          tokens: data.tokens,
          cost: data.cost
        }))
        .sort((a, b) => a.hour.localeCompare(b.hour));

      return reply.send({
        success: true,
        timeRange,
        summary: {
          totalMessages,
          totalTokensInput,
          totalTokensOutput,
          totalTokens,
          totalCost: totalCost.toFixed(4),
          avgTokensPerMessage: Math.round(totalTokens / totalMessages),
          avgCostPerMessage: (totalCost / totalMessages).toFixed(4)
        },
        topModels,
        topUsers,
        usageTimeline
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch LLM metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch LLM metrics'
      });
    }
  });
};

export default adminMetricsRoutes;
