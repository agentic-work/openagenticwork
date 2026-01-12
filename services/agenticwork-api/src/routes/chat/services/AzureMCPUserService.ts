/**
 * Azure MCP User Service
 * Handles user-scoped Azure MCP operations with SSO tokens
 */

import { spawn } from 'child_process';

export class AzureMCPUserService {
  /**
   * Start Azure MCP with user's SSO token
   * The token comes from the user's SSO login and is exchanged for Azure Management access
   */
  async startUserScopedAzureMCP(userToken: string, userEmail: string, userGroups: string[]) {
    // Exchange SSO token for Azure Management token
    const azureManagementToken = await this.exchangeToken(userToken, userGroups);
    
    // Start Azure MCP with user's token
    const mcpProcess = spawn('node', ['/app/mcps/builtin/azure-user-scoped-mcp.js'], {
      env: {
        ...process.env,
        // Pass the Azure Management token that Azure MCP can use
        USER_AZURE_TOKEN: azureManagementToken,
        // This will be used as AZURE_ACCESS_TOKEN inside the wrapper
        AZURE_ACCESS_TOKEN: azureManagementToken,
        USER_EMAIL: userEmail,
        USER_AD_GROUPS: userGroups.join(','),
        // Clear service principal credentials to ensure user token is used
        AZURE_CLIENT_ID: '',
        AZURE_CLIENT_SECRET: '',
        // Keep tenant and subscription
        AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
        AZURE_SUBSCRIPTION_ID: process.env.AZURE_SUBSCRIPTION_ID
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    console.log(`[AzureMCPUser] Started Azure MCP for user ${userEmail} with groups ${userGroups}`);
    
    return mcpProcess;
  }

  /**
   * Exchange SSO token for Azure Management token using MSAL
   */
  private async exchangeToken(ssoToken: string, userGroups: string[]): Promise<string> {
    const msal = require('@azure/msal-node');
    
    const msalConfig = {
      auth: {
        clientId: process.env.AAD_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET, 
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
      }
    };

    const cca = new msal.ConfidentialClientApplication(msalConfig);
    
    // On-Behalf-Of flow to get Azure Management token
    const oboRequest = {
      oboAssertion: ssoToken,
      scopes: ['https://management.azure.com/.default']
    };

    try {
      const response = await cca.acquireTokenOnBehalfOf(oboRequest);
      console.log('[AzureMCPUser] Successfully exchanged SSO token for Azure Management token');
      return response.accessToken;
    } catch (error) {
      console.error('[AzureMCPUser] Token exchange failed:', error);
      
      // Fallback: If OBO fails, try using service principal based on user's group
      const adminGroups = process.env.AZURE_ADMIN_GROUPS?.split(',').map(g => g.trim()) || [];
      const isAdmin = adminGroups.some(group => userGroups.includes(group));

      if (isAdmin) {
        console.log('[AzureMCPUser] Falling back to admin service principal');
        return this.getServicePrincipalToken('admin');
      } else {
        console.log('[AzureMCPUser] Falling back to read-only service principal');
        return this.getServicePrincipalToken('readonly');
      }
    }
  }

  /**
   * Get service principal token as fallback
   */
  private async getServicePrincipalToken(level: 'admin' | 'readonly'): Promise<string> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const clientId = level === 'admin' 
      ? process.env.ADMIN_AZURE_MCP_SP_CLIENT_ID 
      : process.env.RO_AZURE_MCP_SP_CLIENT_ID;
    const clientSecret = level === 'admin'
      ? process.env.ADMIN_AZURE_MCP_SP_CLIENT_SECRET
      : process.env.RO_AZURE_MCP_SP_CLIENT_SECRET;
    
    const cmd = `az login --service-principal -u ${clientId} -p "${clientSecret}" --tenant ${process.env.AZURE_TENANT_ID} >/dev/null 2>&1 && az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv`;
    
    const { stdout } = await execAsync(cmd);
    return stdout.trim();
  }
}