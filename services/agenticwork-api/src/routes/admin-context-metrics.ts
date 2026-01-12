/**
 * Admin Context Window Metrics API
 *
 * Provides endpoints for viewing context window usage metrics per chat session
 * Helps administrators monitor context window management effectiveness
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';

interface ContextMetricsQuery {
  limit?: string;
  offset?: string;
  sortBy?: 'utilization' | 'total_tokens' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  userId?: string;
  minUtilization?: string;
}

interface SessionMetricsParams {
  sessionId: string;
}

export const adminContextMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/context-metrics
   * Get context window metrics across all sessions
   */
  fastify.get<{ Querystring: ContextMetricsQuery }>(
    '/context-metrics',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Get context window metrics',
        description: 'Retrieve context window usage metrics across all chat sessions',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string', default: '50' },
            offset: { type: 'string', default: '0' },
            sortBy: {
              type: 'string',
              enum: ['utilization', 'total_tokens', 'created_at'],
              default: 'utilization'
            },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            userId: { type: 'string' },
            minUtilization: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              sessions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    userId: { type: 'string' },
                    userName: { type: 'string' },
                    userEmail: { type: 'string' },
                    title: { type: 'string' },
                    model: { type: 'string' },
                    messageCount: { type: 'number' },
                    contextTokensInput: { type: 'number' },
                    contextTokensOutput: { type: 'number' },
                    contextTokensTotal: { type: 'number' },
                    contextWindowSize: { type: 'number' },
                    contextUtilizationPct: { type: 'number' },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' }
                  }
                }
              },
              total: { type: 'number' },
              statistics: {
                type: 'object',
                properties: {
                  averageUtilization: { type: 'number' },
                  maxUtilization: { type: 'number' },
                  totalSessions: { type: 'number' },
                  highUtilizationSessions: { type: 'number' }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    async (request: FastifyRequest<{ Querystring: ContextMetricsQuery }>, reply: FastifyReply) => {
      try {
        const {
          limit = '50',
          offset = '0',
          sortBy = 'utilization',
          sortOrder = 'desc',
          userId,
          minUtilization
        } = request.query;

        const limitNum = Math.min(parseInt(limit, 10), 1000);
        const offsetNum = parseInt(offset, 10);
        const minUtil = minUtilization ? parseFloat(minUtilization) : undefined;

        // Build where clause
        const where: any = {
          deleted_at: null,
          context_tokens_total: { gt: 0 } // Only sessions with token data
        };

        if (userId) {
          where.user_id = userId;
        }

        if (minUtil !== undefined) {
          where.context_utilization_pct = { gte: minUtil };
        }

        // Build orderBy clause
        let orderBy: any;
        switch (sortBy) {
          case 'utilization':
            orderBy = { context_utilization_pct: sortOrder };
            break;
          case 'total_tokens':
            orderBy = { context_tokens_total: sortOrder };
            break;
          case 'created_at':
          default:
            orderBy = { created_at: sortOrder };
            break;
        }

        // Fetch sessions with context metrics
        const [sessions, total] = await Promise.all([
          prisma.chatSession.findMany({
            where,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            },
            orderBy,
            take: limitNum,
            skip: offsetNum
          }),
          prisma.chatSession.count({ where })
        ]);

        // Calculate statistics
        const stats = await prisma.chatSession.aggregate({
          where,
          _avg: {
            context_utilization_pct: true
          },
          _max: {
            context_utilization_pct: true
          },
          _count: true
        });

        const highUtilizationCount = await prisma.chatSession.count({
          where: {
            ...where,
            context_utilization_pct: { gte: 80 }
          }
        });

        // Format response
        const formattedSessions = sessions.map(session => ({
          id: session.id,
          userId: session.user_id,
          userName: session.user?.name || 'Unknown',
          userEmail: session.user?.email || 'Unknown',
          title: session.title || 'Untitled',
          model: session.model || 'Unknown',
          messageCount: session.message_count,
          contextTokensInput: session.context_tokens_input || 0,
          contextTokensOutput: session.context_tokens_output || 0,
          contextTokensTotal: session.context_tokens_total || 0,
          contextWindowSize: session.context_window_size || null,
          contextUtilizationPct: session.context_utilization_pct
            ? parseFloat(session.context_utilization_pct.toString())
            : null,
          createdAt: session.created_at.toISOString(),
          updatedAt: session.updated_at.toISOString()
        }));

        return reply.send({
          sessions: formattedSessions,
          total,
          statistics: {
            averageUtilization: stats._avg.context_utilization_pct
              ? parseFloat(stats._avg.context_utilization_pct.toString())
              : 0,
            maxUtilization: stats._max.context_utilization_pct
              ? parseFloat(stats._max.context_utilization_pct.toString())
              : 0,
            totalSessions: stats._count,
            highUtilizationSessions: highUtilizationCount
          }
        });

      } catch (error) {
        request.log.error({ error }, 'Failed to fetch context window metrics');
        return reply.code(500).send({
          error: 'Failed to fetch context window metrics',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/context-metrics/:sessionId
   * Get detailed context window metrics for a specific session
   */
  fastify.get<{ Params: SessionMetricsParams }>(
    '/context-metrics/:sessionId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Get session context metrics',
        description: 'Get detailed context window metrics for a specific chat session',
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              session: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  model: { type: 'string' },
                  messageCount: { type: 'number' },
                  contextTokensInput: { type: 'number' },
                  contextTokensOutput: { type: 'number' },
                  contextTokensTotal: { type: 'number' },
                  contextWindowSize: { type: 'number' },
                  contextUtilizationPct: { type: 'number' }
                }
              },
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    role: { type: 'string' },
                    tokensInput: { type: 'number' },
                    tokensOutput: { type: 'number' },
                    tokensTotal: { type: 'number' },
                    createdAt: { type: 'string' }
                  }
                }
              }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    async (request: FastifyRequest<{ Params: SessionMetricsParams }>, reply: FastifyReply) => {
      try {
        const { sessionId } = request.params;

        const session = await prisma.chatSession.findUnique({
          where: { id: sessionId },
          include: {
            messages: {
              where: { deleted_at: null },
              select: {
                id: true,
                role: true,
                tokens_input: true,
                tokens_output: true,
                tokens: true,
                created_at: true
              },
              orderBy: { created_at: 'asc' }
            }
          }
        });

        if (!session) {
          return reply.code(404).send({
            error: 'Session not found'
          });
        }

        // Format response
        const formattedSession = {
          id: session.id,
          title: session.title || 'Untitled',
          model: session.model || 'Unknown',
          messageCount: session.message_count,
          contextTokensInput: session.context_tokens_input || 0,
          contextTokensOutput: session.context_tokens_output || 0,
          contextTokensTotal: session.context_tokens_total || 0,
          contextWindowSize: session.context_window_size || null,
          contextUtilizationPct: session.context_utilization_pct
            ? parseFloat(session.context_utilization_pct.toString())
            : null
        };

        const formattedMessages = session.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          tokensInput: msg.tokens_input || 0,
          tokensOutput: msg.tokens_output || 0,
          tokensTotal: msg.tokens || 0,
          createdAt: msg.created_at.toISOString()
        }));

        return reply.send({
          session: formattedSession,
          messages: formattedMessages
        });

      } catch (error) {
        request.log.error({ error, sessionId: request.params.sessionId },
          'Failed to fetch session context metrics');
        return reply.code(500).send({
          error: 'Failed to fetch session context metrics',
          message: error.message
        });
      }
    }
  );
};

export default adminContextMetricsRoutes;
