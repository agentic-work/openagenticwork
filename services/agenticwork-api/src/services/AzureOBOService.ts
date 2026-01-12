/**
 * Azure On-Behalf-Of (OBO) Service
 * 
 * Handles Azure AD On-Behalf-Of token flow to allow the API to access Azure
 * resources on behalf of authenticated users. Manages token exchange, scope
 * validation, and secure credential handling using MSAL.
 * 
 * Features:
 * - Secure On-Behalf-Of token exchange using MSAL
 * - Multi-scope token acquisition for different Azure services
 * - Token caching and automatic renewal
 * - Test mode support for development environments
 * - Comprehensive error handling and logging
 * - Support for Azure Management API and other resource scopes
 */

// Import @azure/msal-node if available
let msalModule: any;
try {
  msalModule = require('@azure/msal-node');
} catch (e) {
  // @azure/msal-node not available
}
import type { FastifyBaseLogger } from 'fastify';

export interface OBOTokenRequest {
  userAccessToken: string;
  scopes: string[];
}

export interface OBOTokenResponse {
  accessToken: string;
  expiresOn: Date;
  tokenType: string;
  scopes: string[];
}

/**
 * Service for handling Azure AD On-Behalf-Of (OBO) token flow
 * This allows the API to act on behalf of a user to access Azure resources
 */
export class AzureOBOService {
  private msalClient: any = null;
  private logger: FastifyBaseLogger;
  private isTestMode: boolean;
  
  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
    this.isTestMode = process.env.AUTH_MODE === 'test';
    
    if (!this.isTestMode && msalModule) {
      // Initialize MSAL for OBO flow using app registration credentials
      // This uses the app's credentials to exchange user tokens, not to directly access resources
      try {
        const msalConfig = {
          auth: {
            clientId: process.env.AAD_CLIENT_ID || process.env.AZURE_CLIENT_ID,
            clientSecret: process.env.AZURE_CLIENT_SECRET,
            authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
          }
        };
        
        this.msalClient = new msalModule.ConfidentialClientApplication(msalConfig);
        this.logger.info('AzureOBOService initialized for On-Behalf-Of token exchange');
      } catch (error) {
        this.logger.error({ error }, 'Failed to initialize MSAL client for OBO');
        this.msalClient = null;
      }
    } else if (this.isTestMode) {
      this.logger.info('AzureOBOService running in test mode - Azure AD disabled');
    } else {
      this.logger.warn('AzureOBOService: @azure/msal-node not available');
    }
  }
  
  /**
   * Exchange a user's access token for a new token with different scopes
   * using the On-Behalf-Of flow
   */
  async acquireTokenOnBehalfOf(request: OBOTokenRequest): Promise<OBOTokenResponse | null> {
    try {
      if (this.isTestMode) {
        this.logger.info({ scopes: request.scopes }, 'Returning test OBO token');
        
        // Create a proper JWT format for test mode
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const exp = Math.floor((Date.now() + 3600000) / 1000); // 1 hour from now in seconds
        const payload = Buffer.from(JSON.stringify({
          sub: 'test-user',
          aud: request.scopes[0],
          exp: exp,
          iat: Math.floor(Date.now() / 1000),
          nbf: Math.floor(Date.now() / 1000)
        })).toString('base64url');
        const signature = 'test-signature';
        
        return {
          accessToken: `${header}.${payload}.${signature}`,
          expiresOn: new Date(exp * 1000),
          tokenType: 'Bearer',
          scopes: request.scopes
        };
      }

      if (!this.msalClient) {
        throw new Error('MSAL client not initialized');
      }
      
      this.logger.info({ scopes: request.scopes }, 'Acquiring OBO token');
      
      const oboRequest = {
        oboAssertion: request.userAccessToken,
        scopes: request.scopes
      };
      
      const response = await this.msalClient.acquireTokenOnBehalfOf(oboRequest);
      
      if (!response) {
        this.logger.error('No response from OBO token request');
        return null;
      }
      
      this.logger.info({ 
        scopes: response.scopes,
        expiresOn: response.expiresOn
      }, 'OBO token acquired successfully');
      
      return {
        accessToken: response.accessToken,
        expiresOn: response.expiresOn!,
        tokenType: response.tokenType,
        scopes: response.scopes
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to acquire OBO token');
      return null;
    }
  }
  
  /**
   * Get an OBO token for Azure Resource Manager (ARM) API
   */
  async getAzureManagementToken(userAccessToken: string): Promise<string | null> {
    const response = await this.acquireTokenOnBehalfOf({
      userAccessToken,
      scopes: ['https://management.azure.com/.default']
    });
    
    return response?.accessToken || null;
  }
  
  /**
   * Get an OBO token for Microsoft Graph API
   */
  async getGraphToken(userAccessToken: string): Promise<string | null> {
    const response = await this.acquireTokenOnBehalfOf({
      userAccessToken,
      scopes: ['https://graph.microsoft.com/.default']
    });
    
    return response?.accessToken || null;
  }
  
  /**
   * Get an OBO token for Azure Key Vault
   */
  async getKeyVaultToken(userAccessToken: string): Promise<string | null> {
    const response = await this.acquireTokenOnBehalfOf({
      userAccessToken,
      scopes: ['https://vault.azure.net/.default']
    });
    
    return response?.accessToken || null;
  }
  
  /**
   * Validate that a token has the required scopes for Azure operations
   */
  validateTokenScopes(token: string, requiredScopes: string[]): boolean {
    try {
      // Decode the token to check scopes
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) return false;
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const tokenScopes = payload.scp?.split(' ') || [];
      
      return requiredScopes.every(scope => tokenScopes.includes(scope));
    } catch (error) {
      this.logger.error({ error }, 'Failed to validate token scopes');
      return false;
    }
  }
}