/**
 * Chat Authentication Service
 *
 * Handles authentication, authorization, and rate limiting for chat operations
 */

import { prisma } from '../../../utils/prisma.js';
import type { Logger } from 'pino';
import { AzureTokenService } from '../../../services/AzureTokenService.js';

export class ChatAuthService {
  private prisma = prisma;
  private azureTokenService: AzureTokenService;

  constructor(private logger: any) {
    this.logger = logger.child({ service: 'ChatAuthService' }) as Logger;
    this.azureTokenService = new AzureTokenService(this.logger);
  }

  /**
   * Check rate limiting for user
   */
  async checkRateLimit(
    userId: string, 
    rateLimitPerMinute: number, 
    rateLimitPerHour: number
  ): Promise<boolean> {
    try {
      // This would integrate with Redis or another rate limiting service
      // For now, return false (not rate limited)
      
      // TODO: Implement actual rate limiting logic
      // - Check Redis for user request counts in the last minute/hour
      // - Return true if user has exceeded limits
      
      this.logger.debug({ 
        userId,
        rateLimitPerMinute,
        rateLimitPerHour 
      }, 'Rate limit check (placeholder)');
      
      return false;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Rate limit check failed');
      
      // If rate limiting service is down, don't block requests
      return false;
    }
  }

  /**
   * Get Azure token information for user
   * Automatically refreshes expired tokens using MSAL if refresh token is available
   */
  async getAzureTokenInfo(userId: string): Promise<any | null> {
    try {
      // Use AzureTokenService which handles auto-refresh
      const tokenInfo = await this.azureTokenService.getOrRefreshToken(userId);

      if (!tokenInfo) {
        this.logger.debug({ userId }, 'No Azure token found for user');
        return null;
      }

      this.logger.debug({
        userId,
        hasToken: true,
        hasIdToken: !!tokenInfo.id_token,
        isExpired: tokenInfo.is_expired,
        wasRefreshed: !tokenInfo.is_expired,
        expiresAt: tokenInfo.expires_at
      }, 'Azure token info retrieved (with auto-refresh)');

      return {
        hasToken: true,
        isExpired: tokenInfo.is_expired,
        accessToken: tokenInfo.access_token, // For Azure ARM OBO (aud: management.azure.com)
        idToken: tokenInfo.id_token,         // For AWS IC OBO (aud: app's client ID)
        expiresAt: tokenInfo.expires_at,
        scope: 'https://management.azure.com/.default',
        updatedAt: new Date()
      };

    } catch (error) {
      this.logger.error({
        userId,
        error: error.message
      }, 'Azure token info retrieval failed');

      return null;
    }
  }

  /**
   * Validate user permissions for specific operations
   */
  async validatePermissions(userId: string, operation: string): Promise<boolean> {
    try {
      // Get user with groups and roles
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          is_admin: true,
          groups: true
        }
      });
      
      if (!user) {
        this.logger.warn({ userId }, 'User not found for permission check');
        return false;
      }
      
      // Admin users have all permissions
      if (user.is_admin) {
        this.logger.debug({ userId, operation }, 'Admin user - permission granted');
        return true;
      }
      
      // Define operation permission requirements
      const operationPermissions: Record<string, string[]> = {
        'admin.read': ['admin', 'moderator'],
        'admin.write': ['admin'],
        'mcp.execute': ['admin', 'developer', 'user'],
        'chat.create': ['admin', 'developer', 'user'],
        'chat.delete': ['admin', 'moderator'],
        'user.manage': ['admin'],
        'system.configure': ['admin']
      };
      
      // Check if operation requires specific roles
      const requiredRoles = operationPermissions[operation];
      if (!requiredRoles) {
        // Unknown operation - allow by default for backward compatibility
        this.logger.debug({ userId, operation }, 'Unknown operation - allowing');
        return true;
      }
      
      // Check if user has any of the required roles
      const userGroups = user.groups || [];
      const userRoles = userGroups; // Use groups as roles for now
      const hasPermission = requiredRoles.some(role => 
        userRoles.includes(role) || userGroups.includes(role)
      );
      
      this.logger.debug({ 
        userId,
        operation,
        requiredRoles,
        userRoles,
        userGroups,
        hasPermission
      }, 'Permission validation completed');
      
      return hasPermission;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        operation,
        error: error.message 
      }, 'Permission validation failed');
      
      return false;
    }
  }

  /**
   * Health check for auth service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if auth services are available
      // For now, always return healthy
      
      return true;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Auth service health check failed');
      
      return false;
    }
  }
}