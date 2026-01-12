/**
 * Authentication Pipeline Stage
 * 
 * Responsibilities:
 * - Validate authentication tokens
 * - Extract user information
 * - Check permissions and rate limits
 * - Handle Azure AD vs local auth
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ChatErrorCode } from '../interfaces/chat.types.js';
import type { Logger } from 'pino';
import { SliderService } from '../../../services/SliderService.js';
import { getUserBudgetService, UserBudgetService } from '../../../services/UserBudgetService.js';
import { prisma } from '../../../utils/prisma.js';

export class AuthStage implements PipelineStage {
  name = 'auth';
  private sliderService: SliderService;
  private budgetService: UserBudgetService;

  constructor(
    private authService: any,
    private logger: any
  ) {
    this.logger = logger.child({ stage: this.name }) as Logger;
    this.sliderService = new SliderService(prisma, this.logger);
    this.budgetService = getUserBudgetService(prisma);
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    
    try {
      // User should already be authenticated by middleware, but let's validate
      if (!context.user) {
        throw new Error('User not authenticated');
      }

      // Check if user is active
      if (!context.user.groups || context.user.groups.length === 0) {
        this.logger.warn({ 
          userId: context.user.id 
        }, 'User has no groups assigned');
      }

      // Rate limiting check
      await this.checkRateLimit(context);

      // Azure AD token validation for MCP access
      await this.validateAzureToken(context);

      // Load intelligence slider configuration
      await this.loadSliderConfig(context);

      // Check budget and auto-adjust slider if needed
      await this.checkBudget(context);

      // Log successful authentication
      this.logger.info({
        userId: context.user.id,
        isAdmin: context.user.isAdmin,
        groupCount: context.user.groups.length,
        sliderPosition: context.sliderConfig?.position,
        sliderSource: context.sliderConfig?.source,
        budgetPercent: context.budgetStatus?.percentUsed,
        budgetAutoAdjusted: context.budgetStatus?.wasAutoAdjusted,
        executionTime: Date.now() - startTime
      }, 'Authentication stage completed');

      return context;

    } catch (error) {
      this.logger.error({ 
        error: error.message,
        executionTime: Date.now() - startTime
      }, 'Authentication stage failed');

      throw {
        ...error,
        code: ChatErrorCode.AUTHENTICATION_REQUIRED,
        retryable: false,
        stage: this.name
      };
    }
  }

  private async checkRateLimit(context: PipelineContext): Promise<void> {
    try {
      const isRateLimited = await this.authService.checkRateLimit(
        context.user.id,
        context.config.rateLimitPerMinute,
        context.config.rateLimitPerHour
      );

      if (isRateLimited) {
        throw {
          code: ChatErrorCode.RATE_LIMITED,
          message: 'Rate limit exceeded. Please try again later.',
          retryable: true
        };
      }
    } catch (error) {
      if (error.code === ChatErrorCode.RATE_LIMITED) {
        throw error;
      }
      // If rate limiting service is down, log but don't block
      this.logger.warn({ 
        userId: context.user.id,
        error: error.message 
      }, 'Rate limiting check failed, allowing request');
    }
  }

  private async validateAzureToken(context: PipelineContext): Promise<void> {
    // Check if this is a system-level API key (awc_system_*)
    // System keys bypass Azure token loading and use SP credentials in MCP proxy
    if (context.user.accessToken && context.user.accessToken.startsWith('awc_system_')) {
      this.logger.info({
        userId: context.user.id
      }, 'System-level API key detected - will use SP credentials for MCP operations');
      return;
    }

    // Check if user is an Azure AD user by:
    // 1. Having azureOid set explicitly, OR
    // 2. Having a user ID that starts with 'azure_' (deterministic ID format)
    const isAzureUser = context.user.azureOid ||
                        context.user.id?.startsWith('azure_') ||
                        !context.user.localAccount;

    if (!isAzureUser) {
      this.logger.debug({
        userId: context.user.id,
        hasAzureOid: !!context.user.azureOid,
        localAccount: context.user.localAccount
      }, 'User is not an Azure AD user, skipping Azure token loading');
      return;
    }

    this.logger.debug({
      userId: context.user.id,
      hasAzureOid: !!context.user.azureOid,
      localAccount: context.user.localAccount
    }, 'Azure AD user detected, attempting to load token from database');

    try {
      const tokenInfo = await this.authService.getAzureTokenInfo(context.user.id);

      if (!tokenInfo || this.isTokenExpired(tokenInfo.expiresAt)) {
        this.logger.warn({
          userId: context.user.id
        }, 'Azure token expired or missing, MCP functionality may be limited');

        // Don't block the request, but MCP features may not work
        context.emit('warning', {
          message: 'Azure token expired. Some features may be unavailable.',
          code: 'AZURE_TOKEN_EXPIRED'
        });
      } else {
        // CRITICAL: Set the Azure AD tokens for MCP tool calls
        // accessToken: For Azure ARM MCP (aud: management.azure.com)
        // idToken: For AWS Identity Center MCP (aud: app's client ID)
        context.user.accessToken = tokenInfo.accessToken;
        if (tokenInfo.idToken) {
          (context.user as any).idToken = tokenInfo.idToken;
        }

        this.logger.info({
          userId: context.user.id,
          tokenPreview: tokenInfo.accessToken.substring(0, 20) + '...',
          hasIdToken: !!tokenInfo.idToken,
          expiresAt: tokenInfo.expiresAt
        }, 'Azure AD tokens loaded for MCP access');
      }
    } catch (error) {
      this.logger.error({
        userId: context.user.id,
        error: error.message
      }, 'Azure token validation failed');

      // Don't block, but warn
      context.emit('warning', {
        message: 'Could not validate Azure credentials. Some features may be unavailable.',
        code: 'AZURE_TOKEN_VALIDATION_FAILED'
      });
    }
  }

  private isTokenExpired(expiresAt: Date): boolean {
    return new Date() >= new Date(expiresAt);
  }

  /**
   * Load intelligence slider configuration for the user
   * Resolution order: Per-user → Global → Default (50)
   */
  private async loadSliderConfig(context: PipelineContext): Promise<void> {
    try {
      const sliderConfig = await this.sliderService.getSliderConfig(context.user.id);
      context.sliderConfig = sliderConfig;

      this.logger.debug({
        userId: context.user.id,
        position: sliderConfig.position,
        source: sliderConfig.source,
        enableThinking: sliderConfig.enableThinking,
        maxThinkingBudget: sliderConfig.maxThinkingBudget
      }, 'Loaded intelligence slider config');
    } catch (error) {
      // Don't fail the request if slider loading fails, use default
      this.logger.warn({
        userId: context.user.id,
        error: error.message
      }, 'Failed to load slider config, using default');

      context.sliderConfig = {
        position: 50,
        costWeight: 0.5,
        qualityWeight: 0.5,
        enableThinking: true,
        enableCascading: false,
        maxThinkingBudget: 8000,
        source: 'default'
      };
    }
  }

  /**
   * Check user budget and auto-adjust slider if approaching limit
   */
  private async checkBudget(context: PipelineContext): Promise<void> {
    try {
      const budgetResult = await this.budgetService.checkBudget(context.user.id);

      // Set budget status on context
      context.budgetStatus = {
        budgetDollars: budgetResult.budgetStatus.budgetCents !== null
          ? budgetResult.budgetStatus.budgetCents / 100
          : null,
        spentDollars: budgetResult.budgetStatus.spentCents / 100,
        remainingDollars: budgetResult.budgetStatus.remainingCents !== null
          ? budgetResult.budgetStatus.remainingCents / 100
          : null,
        percentUsed: budgetResult.budgetStatus.percentUsed,
        isOverBudget: budgetResult.budgetStatus.isOverBudget,
        isApproachingLimit: budgetResult.budgetStatus.isApproachingLimit,
        wasAutoAdjusted: budgetResult.adjustedSlider !== undefined,
        originalSlider: budgetResult.budgetStatus.originalSlider,
      };

      // If budget hard limit is hit, block the request
      if (!budgetResult.allowed) {
        throw {
          code: ChatErrorCode.BUDGET_EXCEEDED,
          message: budgetResult.reason || 'Monthly budget limit reached',
          retryable: false
        };
      }

      // Auto-adjust slider if budget is approaching limit
      if (budgetResult.adjustedSlider !== undefined && context.sliderConfig) {
        const originalSlider = context.sliderConfig.position;
        context.sliderConfig.position = budgetResult.adjustedSlider;
        context.sliderConfig.source = 'budget-auto-adjust';

        // Apply the adjustment to the database
        await this.budgetService.applyAutoAdjustedSlider(context.user.id, budgetResult.adjustedSlider);

        this.logger.info({
          userId: context.user.id,
          originalSlider,
          adjustedSlider: budgetResult.adjustedSlider,
          budgetPercent: budgetResult.budgetStatus.percentUsed,
          reason: budgetResult.reason
        }, 'Auto-adjusted slider for budget constraints');

        // Emit warning to user
        context.emit('warning', {
          message: budgetResult.reason,
          code: 'BUDGET_SLIDER_ADJUSTED',
          data: {
            originalSlider,
            newSlider: budgetResult.adjustedSlider,
            percentUsed: budgetResult.budgetStatus.percentUsed
          }
        });
      }

      // Emit warning if approaching limit
      if (budgetResult.budgetStatus.isApproachingLimit && !budgetResult.adjustedSlider) {
        context.emit('warning', {
          message: `You have used ${budgetResult.budgetStatus.percentUsed?.toFixed(1)}% of your monthly budget`,
          code: 'BUDGET_WARNING',
          data: {
            percentUsed: budgetResult.budgetStatus.percentUsed,
            remainingDollars: budgetResult.budgetStatus.remainingCents !== null
              ? budgetResult.budgetStatus.remainingCents / 100
              : null
          }
        });
      }

    } catch (error: any) {
      // If it's a budget exceeded error, re-throw
      if (error.code === ChatErrorCode.BUDGET_EXCEEDED) {
        throw error;
      }

      // Otherwise, log and continue - don't block on budget service failure
      this.logger.warn({
        userId: context.user.id,
        error: error.message
      }, 'Budget check failed, continuing without budget constraints');
    }
  }

  async rollback(context: PipelineContext): Promise<void> {
    // Nothing to rollback for auth stage
    this.logger.debug({ 
      messageId: context.messageId 
    }, 'Auth stage rollback (no action needed)');
  }
}
