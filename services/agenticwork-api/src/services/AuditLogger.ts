/**
 * Comprehensive User Activity Audit Logger
 * 
 * Captures ALL user interactions for admin visibility:
 * - Chat queries and responses
 * - MCP tool calls and results  
 * - Admin actions and system changes
 * - Request/response payloads for debugging
 */

import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

export interface AuditLogEntry {
  userId: string;
  sessionId?: string;
  messageId?: string;
  
  // Query details
  rawQuery: string;
  queryType: 'chat' | 'mcp_tool' | 'admin_action' | 'api_call';
  intent?: string;
  
  // Context
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
  
  // MCP/Tool execution  
  mcpServer?: string;
  toolsCalled?: any[];
  toolResults?: any[];
  
  // Request/Response payloads
  requestPayload?: any;
  responsePayload?: any;
  responseTimeMs?: number;
  
  // Success/Error tracking
  success?: boolean;
  errorCode?: string;
  errorMessage?: string;
  
  // Metadata
  modelUsed?: string;
  tokensConsumed?: number;
  costEstimate?: number;
  
  // ML Training Structure - optimized for model fine-tuning
  mlTrainingData?: {
    input: {
      userQuery: string;
      context: any;
      intent: string;
      userBehaviorPattern: string[];
    };
    output: {
      response: string;
      toolsUsed: string[];
      reasoningSteps: string[];
      confidenceScore: number;
    };
    metadata: {
      sessionFlow: string[];
      userExpertiseLevel: string;
      taskComplexity: string;
      satisfactionIndicators: any;
    };
  };
}

export class AuditLogger {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'AuditLogger' });
  }

  /**
   * Log user query with full audit trail
   */
  async logUserQuery(entry: AuditLogEntry): Promise<void> {
    const startTime = Date.now();

    // Validate required fields
    if (!entry.userId) {
      this.logger.warn({
        entry: { ...entry, userId: '[REDACTED]' }
      }, '[AUDIT] Skipping audit log - missing userId');
      return;
    }

    try {
      // Check if message exists before creating the audit record to avoid foreign key constraint error
      let messageExists = false;
      if (entry.messageId) {
        const message = await prisma.chatMessage.findUnique({
          where: { id: entry.messageId },
          select: { id: true }
        });
        messageExists = !!message;
      }

      await prisma.userQueryAudit.create({
        data: {
          user_id: entry.userId,
          session_id: entry.sessionId,
          message_id: messageExists ? entry.messageId : null,
          
          raw_query: entry.rawQuery,
          query_type: entry.queryType,
          intent: entry.intent,
          
          ip_address: entry.ipAddress,
          user_agent: entry.userAgent,
          referrer: entry.referrer,
          
          mcp_server: entry.mcpServer,
          tools_called: entry.toolsCalled ? JSON.stringify(entry.toolsCalled) : null,
          tool_results: entry.toolResults ? JSON.stringify(entry.toolResults) : null,
          
          request_payload: entry.requestPayload ? JSON.stringify(entry.requestPayload) : null,
          response_payload: entry.responsePayload ? JSON.stringify(entry.responsePayload) : null,
          response_time_ms: entry.responseTimeMs,
          
          success: entry.success ?? true,
          error_code: entry.errorCode,
          error_message: entry.errorMessage,
          
          model_used: entry.modelUsed,
          tokens_consumed: entry.tokensConsumed,
          cost_estimate: entry.costEstimate,
          ml_training_data: entry.mlTrainingData ? JSON.stringify(entry.mlTrainingData) : null
        }
      });
      
      const duration = Date.now() - startTime;
      this.logger.debug({ 
        userId: entry.userId, 
        queryType: entry.queryType, 
        duration,
        success: entry.success 
      }, '[AUDIT] User query logged');
      
    } catch (error) {
      this.logger.error({ 
        error, 
        userId: entry.userId, 
        queryType: entry.queryType 
      }, '[AUDIT] Failed to log user query');
    }
  }

  /**
   * Log MCP tool execution with detailed payloads
   */
  async logMCPExecution(
    userId: string, 
    sessionId: string,
    messageId: string,
    mcpServer: string,
    toolName: string,
    requestPayload: any,
    responsePayload: any,
    success: boolean,
    errorMessage?: string,
    executionTimeMs?: number
  ): Promise<void> {
    await this.logUserQuery({
      userId,
      sessionId,
      messageId,
      rawQuery: `MCP Tool Call: ${toolName}`,
      queryType: 'mcp_tool',
      mcpServer,
      toolsCalled: [{ name: toolName, arguments: requestPayload }],
      toolResults: [responsePayload],
      requestPayload,
      responsePayload,
      responseTimeMs: executionTimeMs,
      success,
      errorMessage
    });
  }

  /**
   * Log admin action for audit trail
   */
  async logAdminAction(
    adminUserId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    details?: any,
    ipAddress?: string
  ): Promise<void> {
    try {
      await prisma.adminAuditLog.create({
        data: {
          admin_user_id: adminUserId,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          details: details ? JSON.stringify(details) : null,
          ip_address: ipAddress
        }
      });
      
      this.logger.info({ 
        adminUserId, 
        action, 
        resourceType, 
        resourceId 
      }, '[AUDIT] Admin action logged');
      
    } catch (error) {
      this.logger.error({ 
        error, 
        adminUserId, 
        action 
      }, '[AUDIT] Failed to log admin action');
    }
  }

  /**
   * Query audit logs for admin portal
   */
  async getAuditLogs(options: {
    userId?: string;
    queryType?: string;
    mcpServer?: string;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    const where: any = {};
    
    if (options.userId) where.user_id = options.userId;
    if (options.queryType) where.query_type = options.queryType;
    if (options.mcpServer) where.mcp_server = options.mcpServer;
    if (options.success !== undefined) where.success = options.success;
    
    if (options.startDate || options.endDate) {
      where.created_at = {};
      if (options.startDate) where.created_at.gte = options.startDate;
      if (options.endDate) where.created_at.lte = options.endDate;
    }
    
    return await prisma.userQueryAudit.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            is_admin: true
          }
        },
        session: {
          select: {
            id: true,
            title: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: options.limit || 100,
      skip: options.offset || 0
    });
  }

  /**
   * Get user activity summary for admin dashboard
   */
  async getUserActivitySummary(userId: string, days: number = 30): Promise<any> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const [totalQueries, mcpCalls, successGroups, avgResponseTime] = await Promise.all([
      // Total queries
      prisma.userQueryAudit.count({
        where: {
          user_id: userId,
          created_at: { gte: startDate }
        }
      }),
      
      // MCP tool calls
      prisma.userQueryAudit.count({
        where: {
          user_id: userId,
          query_type: 'mcp_tool',
          created_at: { gte: startDate }
        }
      }),
      
      // Success rate (count successful vs total)
      prisma.userQueryAudit.groupBy({
        by: ['success'],
        where: {
          user_id: userId,
          created_at: { gte: startDate }
        },
        _count: true
      }),
      
      // Average response time
      prisma.userQueryAudit.aggregate({
        where: {
          user_id: userId,
          response_time_ms: { not: null },
          created_at: { gte: startDate }
        },
        _avg: {
          response_time_ms: true
        }
      })
    ]);
    
    return {
      userId,
      period: `${days} days`,
      totalQueries,
      mcpCalls,
      successRate: this.calculateSuccessRate(successGroups),
      avgResponseTimeMs: avgResponseTime._avg.response_time_ms
    };
  }

  private calculateSuccessRate(successGroups: any[]): number {
    if (!successGroups || successGroups.length === 0) return 0;
    
    const successCount = successGroups.find(g => g.success === true)?._count || 0;
    const failCount = successGroups.find(g => g.success === false)?._count || 0;
    const total = successCount + failCount;
    
    return total > 0 ? (successCount / total) * 100 : 0;
  }
}