/**
 * Centralized Secrets Management Configuration
 * 
 * This file provides a single source of truth for all application secrets.
 * Secrets are loaded from environment variables or secure vaults.
 * 
 * SECURITY: Never commit actual secret values to this file!
 */

import { Logger } from 'pino';

export interface SecretsConfig {
  // Database
  database: {
    url: string;
    password: string;
    poolSize: number;
  };
  
  // Redis
  redis: {
    url: string;
    password?: string;
  };
  
  // Authentication
  auth: {
    jwtSecret: string;
    azureClientId: string;
    azureClientSecret: string;
    azureTenantId: string;
    apiKey: string;
  };
  
  // External Services
  services: {
    mcpProxyUrl: string;
    vaultToken: string;
    vaultAddress: string;
    milvusPassword: string;
    minioAccessKey: string;
    minioSecretKey: string;
  };
  
  // Monitoring
  monitoring: {
    sentryDsn?: string;
    datadogApiKey?: string;
  };
}

/**
 * Validates that a required secret is present
 */
function validateSecret(name: string, value: string | undefined, allowEmpty = false): string {
  if (!value || value.trim() === '') {
    if (allowEmpty) {
      return '';
    }
    throw new Error(`Missing required secret: ${name}`);
  }
  
  // Check for default/placeholder values that should not be in production
  const placeholders = [
    'change_me',
    'change-me',
    'changeme',
    'default',
    'password',
    'secret',
    'xxx',
    'todo',
    'fixme',
    'dev-token'
  ];
  
  const lowerValue = value.toLowerCase();
  if (process.env.NODE_ENV === 'production') {
    for (const placeholder of placeholders) {
      if (lowerValue.includes(placeholder)) {
        throw new Error(`Secret ${name} contains placeholder value: ${placeholder}. This is not allowed in production.`);
      }
    }
  }
  
  return value;
}

/**
 * Loads secrets from environment variables with validation
 */
export function loadSecrets(logger?: Logger): SecretsConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  try {
    // In production, all secrets must be properly configured
    // In development, we allow some defaults for ease of development
    
    const secrets: SecretsConfig = {
      database: {
        url: validateSecret('DATABASE_URL', process.env.DATABASE_URL),
        password: validateSecret('DB_PASSWORD', process.env.DB_PASSWORD || 
          (isDevelopment ? 'dev_password_only' : undefined)),
        poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10)
      },
      
      redis: {
        url: validateSecret('REDIS_URL', process.env.REDIS_URL || 
          (isDevelopment ? 'redis://localhost:6379' : undefined)),
        password: validateSecret('REDIS_PASSWORD', process.env.REDIS_PASSWORD, true)
      },
      
      auth: {
        jwtSecret: validateSecret('JWT_SECRET', process.env.JWT_SECRET ||
          (isDevelopment ? generateDevSecret('jwt') : undefined)),
        // Azure AD is optional for open source version
        azureClientId: validateSecret('AZURE_CLIENT_ID', process.env.AZURE_CLIENT_ID || 'not-configured', true),
        azureClientSecret: validateSecret('AZURE_CLIENT_SECRET', process.env.AZURE_CLIENT_SECRET, true), // Allow empty for public client
        azureTenantId: validateSecret('AZURE_TENANT_ID', process.env.AZURE_TENANT_ID || 'not-configured', true),
        apiKey: validateSecret('API_KEY', process.env.API_KEY ||
          (isDevelopment ? generateDevSecret('api') : undefined))
      },
      
      services: {
        // MCP Proxy configuration
        mcpProxyUrl: process.env.MCP_PROXY_URL || 'http://mcp-proxy:3100',

        vaultToken: validateSecret('VAULT_TOKEN', process.env.VAULT_TOKEN ||
          (isDevelopment ? 'dev-vault-token' : undefined)),
        vaultAddress: process.env.VAULT_ADDRESS || 'http://vault:8200',
        milvusPassword: validateSecret('MILVUS_PASSWORD', process.env.MILVUS_PASSWORD ||
          (isDevelopment ? 'milvus_dev_password' : undefined)),
        minioAccessKey: validateSecret('MINIO_ACCESS_KEY', process.env.MINIO_ACCESS_KEY ||
          (isDevelopment ? 'minioadmin' : undefined)),
        minioSecretKey: validateSecret('MINIO_SECRET_KEY', process.env.MINIO_SECRET_KEY ||
          (isDevelopment ? 'minioadmin' : undefined))
      },
      
      monitoring: {
        sentryDsn: process.env.SENTRY_DSN,
        datadogApiKey: process.env.DATADOG_API_KEY
      }
    };
    
    logger?.info('Secrets loaded and validated successfully');
    return secrets;
    
  } catch (error: any) {
    logger?.error({ error: error.message }, 'Failed to load secrets');
    
    // In production, fail fast if secrets are not properly configured
    if (isProduction) {
      throw error;
    }
    
    // In development, log warning but continue
    logger?.warn({ error: error.message }, 'Using development defaults for missing secrets');
    throw error;
  }
}

/**
 * Generates a development-only secret
 */
function generateDevSecret(type: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `dev_${type}_${timestamp}_${random}`;
}

/**
 * Singleton instance of secrets
 */
let secretsInstance: SecretsConfig | null = null;

/**
 * Gets the singleton secrets instance
 */
export function getSecrets(logger?: Logger): SecretsConfig {
  if (!secretsInstance) {
    secretsInstance = loadSecrets(logger);
  }
  return secretsInstance;
}

/**
 * Refreshes secrets (useful for rotation)
 */
export function refreshSecrets(logger?: Logger): SecretsConfig {
  secretsInstance = null;
  return getSecrets(logger);
}

/**
 * Masks sensitive data for logging
 */
export function maskSecret(secret: string, visibleChars = 4): string {
  if (!secret || secret.length <= visibleChars) {
    return '***';
  }
  return secret.substring(0, visibleChars) + '***';
}

/**
 * Safe secret logging
 */
export function logSecrets(secrets: SecretsConfig, logger: Logger): void {
  logger.info({
    database: {
      url: maskSecret(secrets.database.url, 10),
      hasPassword: !!secrets.database.password
    },
    redis: {
      url: maskSecret(secrets.redis.url, 10),
      hasPassword: !!secrets.redis.password
    },
    auth: {
      hasJwtSecret: !!secrets.auth.jwtSecret,
      azureClientId: maskSecret(secrets.auth.azureClientId),
      hasAzureSecret: !!secrets.auth.azureClientSecret
    },
    services: {
      hasMcpProxyUrl: !!secrets.services.mcpProxyUrl,
      vaultAddress: secrets.services.vaultAddress,
      hasVaultToken: !!secrets.services.vaultToken
    }
  }, 'Secrets configuration loaded (masked)');
}