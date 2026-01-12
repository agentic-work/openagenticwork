/**
 * Chat Models API Route
 * 
 * Dynamically discovers available Azure OpenAI deployments
 * NO HARDCODED MODELS - Everything is discovered dynamically from Azure
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../middleware/unifiedAuth.js';
import { AzureTokenService } from '../../services/AzureTokenService.js';
import { IChatStorageService } from './index.js';
import { logger } from '../../utils/logger.js';

interface ModelCapabilities {
  vision: boolean;
  reasoning: boolean;
  functionCalling: boolean;
  imageGeneration: boolean;
  audio: boolean;
  code: boolean;
  mathematics: boolean;
}

interface AzureDeploymentInfo {
  deployment: string;
  model: string;
  modelVersion?: string;
  capabilities: ModelCapabilities;
  contextWindow: number;
  maxTokens: number;
}

/**
 * Get model capabilities from API response or return safe defaults
 * NO HARDCODING - just safe defaults when API doesn't provide info
 */
function getModelCapabilities(deploymentData: any): ModelCapabilities {
  // If Azure API provides capabilities, use them
  if (deploymentData?.properties?.capabilities) {
    return deploymentData.properties.capabilities;
  }
  
  // Otherwise return conservative defaults - no hardcoded model names
  return {
    vision: false,
    reasoning: false,
    functionCalling: true,  // Most deployments support this
    imageGeneration: false,
    audio: false,
    code: true,  // Most deployments support this
    mathematics: false
  };
}

/**
 * Get context limits from API response or return safe defaults
 * NO HARDCODING - just safe defaults when API doesn't provide info
 */
function getModelLimits(deploymentData: any): { contextWindow: number; maxTokens: number } {
  // If Azure API provides limits, use them
  if (deploymentData?.properties?.limits) {
    return {
      contextWindow: deploymentData.properties.limits.contextWindow || 4096,
      maxTokens: deploymentData.properties.limits.maxTokens || 2048
    };
  }
  
  // Otherwise return conservative defaults
  return { 
    contextWindow: 4096,
    maxTokens: 2048
  };
}

/**
 * Discover actual Azure OpenAI deployments via Azure Management API
 */
async function discoverAzureDeployments(
  endpoint: string,
  subscriptionId: string,
  resourceGroup: string,
  resourceName: string,
  accessToken: string
): Promise<AzureDeploymentInfo[]> {
  try {
    const azureManagementUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${resourceName}/deployments`;
    
    const response = await fetch(`${azureManagementUrl}?api-version=2023-05-01`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Azure API responded with ${response.status}`);
    }

    const data = await response.json() as any;
    const deployments: AzureDeploymentInfo[] = [];

    if (data.value && Array.isArray(data.value)) {
      for (const deployment of data.value) {
        const deploymentName = deployment.name;
        const model = deployment.properties?.model?.name || 'unknown';
        const modelVersion = deployment.properties?.model?.version;
        
        // Get capabilities and limits from API data, not hardcoded
        const capabilities = getModelCapabilities(deployment);
        const limits = getModelLimits(deployment);

        deployments.push({
          deployment: deploymentName,
          model: model,
          modelVersion: modelVersion,
          capabilities: capabilities,
          contextWindow: limits.contextWindow,
          maxTokens: limits.maxTokens
        });
      }
    }

    return deployments;
  } catch (error) {
    logger.error('Failed to discover Azure deployments:', error);
    return [];
  }
}

/**
 * Test deployment availability by making a minimal chat completion call
 */
async function testDeploymentAvailability(
  endpoint: string,
  deployment: string,
  apiKey: string
): Promise<boolean> {
  try {
    const testUrl = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;
    
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1
      })
    });

    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Get available chat models from Azure OpenAI deployments
 * FULLY DYNAMIC - NO HARDCODED MODELS
 */
export async function getModelsHandler(
  request: AuthenticatedRequest,
  reply: FastifyReply,
  chatStorage: IChatStorageService
): Promise<void> {
  try {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    
    if (!endpoint) {
      request.log.warn('No Azure OpenAI endpoint configured');
      return reply.code(200).send({
        models: [],
        defaultModel: null,
        count: 0,
        availableCount: 0,
        capabilities: [],
        discoveryMethod: 'no-endpoint',
        metadata: {
          dynamicDiscovery: true,
          noHardcodedModels: true
        }
      });
    }

    let discoveredDeployments: AzureDeploymentInfo[] = [];
    let accessToken: string | null = null;

    // Try to get Azure access token for deployment discovery
    try {
      if (request.user) {
        const tokenService = new AzureTokenService(request.log);
        accessToken = await tokenService.getValidAzureTokenString(request.user.id);
        
        if (accessToken) {
          const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
          const resourceGroup = process.env.AZURE_RESOURCE_GROUP;
          const resourceName = process.env.AZURE_OPENAI_RESOURCE_NAME;
          
          if (subscriptionId && resourceGroup && resourceName) {
            discoveredDeployments = await discoverAzureDeployments(
              endpoint,
              subscriptionId,
              resourceGroup,
              resourceName,
              accessToken
            );
          }
        }
      }
    } catch (error) {
      request.log.warn({ error: error instanceof Error ? error.message : String(error) }, 
        'Failed to discover Azure deployments via management API');
    }

    // Build models array from discovered deployments
    const models = [];
    
    if (discoveredDeployments.length > 0) {
      // Use discovered deployments
      const authKey = apiKey || accessToken || '';
      const availabilityTests = await Promise.allSettled(
        discoveredDeployments.map(deployment =>
          testDeploymentAvailability(endpoint, deployment.deployment, authKey)
        )
      );

      for (let index = 0; index < discoveredDeployments.length; index++) {
        const deployment = discoveredDeployments[index];
        const isAvailable = availabilityTests[index].status === 'fulfilled' && 
                           (availabilityTests[index] as PromiseFulfilledResult<boolean>).value;

        models.push({
          id: deployment.deployment,
          name: `${deployment.model} (${deployment.deployment})`,
          description: `Azure OpenAI ${deployment.model}${deployment.modelVersion ? ` v${deployment.modelVersion}` : ''}`,
          contextWindow: deployment.contextWindow,
          maxOutputTokens: deployment.maxTokens,
          capabilities: Object.entries(deployment.capabilities)
            .filter(([_, enabled]) => enabled)
            .map(([capability]) => capability),
          endpoint: endpoint,
          deployment: deployment.deployment,
          provider: 'azure-openai',
          isAvailable,
          discoveredVia: 'azure-management-api'
        });
      }
    }

    // If no deployments discovered, try environment config as last resort
    if (models.length === 0) {
      const primaryDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
      
      if (primaryDeployment && apiKey) {
        const isAvailable = await testDeploymentAvailability(endpoint, primaryDeployment, apiKey);
        
        models.push({
          id: primaryDeployment,
          name: primaryDeployment,
          description: 'Deployment from environment configuration',
          contextWindow: 4096,  // Safe defaults
          maxOutputTokens: 2048,
          capabilities: ['functionCalling', 'code'],  // Conservative capabilities
          endpoint: endpoint,
          deployment: primaryDeployment,
          provider: 'azure-openai',
          isAvailable,
          discoveredVia: 'environment-config'
        });
      }
    }

    const defaultModel = models.find(m => m.isAvailable)?.id || models[0]?.id || null;

    reply.send({
      models,
      defaultModel,
      count: models.length,
      availableCount: models.filter(m => m.isAvailable).length,
      capabilities: [...new Set(models.flatMap(m => m.capabilities))].sort(),
      discoveryMethod: discoveredDeployments.length > 0 ? 'azure-api' : (models.length > 0 ? 'environment-config' : 'no-models-found'),
      lastUpdated: new Date(),
      metadata: {
        dynamicDiscovery: true,
        noHardcodedModels: true,
        endpoint: endpoint ? 'configured' : 'not-configured'
      }
    });

  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to get models');
    
    reply.code(500).send({
      error: {
        code: 'MODELS_ERROR',
        message: 'Failed to retrieve available models'
      }
    });
  }
}