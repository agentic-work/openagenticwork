/**
 * Configuration for AgenticWorkCode Manager
 * Process-based session management (not container-per-user)
 *
 * SECURITY: This service should ONLY be accessible from the AgenticWork API.
 * External access is blocked - API proxies all requests with internal auth key.
 *
 * STORAGE: Cloud storage (MinIO/S3/Azure/GCS) is PRIMARY storage for workspaces.
 * Local filesystem is only a working cache.
 */

export type StorageProvider = 'minio' | 's3' | 'azure' | 'gcs';

export interface StorageConfig {
  provider: StorageProvider;
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  // Azure
  azureAccountName?: string;
  azureAccountKey?: string;
  azureConnectionString?: string;
  // GCP
  gcpProjectId?: string;
  gcpKeyFile?: string;
}

export interface Config {
  port: number;
  agenticodePath: string;             // Path to agenticode CLI binary
  maxSessionsPerUser: number;
  sessionIdleTimeout: number;         // seconds
  sessionMaxLifetime: number;         // seconds
  maxWorkspaceSizeMb: number;         // Max workspace size per user in MB (default: 5120 = 5GB)
  workspacesPath: string;             // Base path for LOCAL workspace cache
  ollamaHost: string;                 // Ollama host URL for direct LLM calls
  defaultModel: string;               // Default model (gpt-oss recommended)
  defaultUi: string;                  // Default UI mode (ink, plain, json)
  internalApiKey: string;             // SECURITY: Internal key for API authentication
  storage: StorageConfig;             // Cloud storage configuration (PRIMARY storage)
}

/**
 * Get storage configuration from environment variables
 */
function getStorageConfig(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || 'minio') as StorageProvider;

  // Build endpoint URL
  let endpoint = process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT || 'minio:9000';
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `http://${endpoint}`;
  }

  return {
    provider,
    bucket: process.env.STORAGE_BUCKET || process.env.MINIO_BUCKET || 'agenticwork-workspaces',
    endpoint,
    region: process.env.STORAGE_REGION || process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.STORAGE_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.STORAGE_SECRET_KEY || process.env.MINIO_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
    // Azure
    azureAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
    azureAccountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
    azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    // GCP
    gcpProjectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    gcpKeyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3050'),
  agenticodePath: process.env.AGENTICODE_PATH || '/usr/local/bin/agenticode',
  maxSessionsPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '3'),
  sessionIdleTimeout: parseInt(process.env.SESSION_IDLE_TIMEOUT || '1800'),      // 30 min
  sessionMaxLifetime: parseInt(process.env.SESSION_MAX_LIFETIME || '14400'),     // 4 hours
  maxWorkspaceSizeMb: parseInt(process.env.MAX_WORKSPACE_SIZE_MB || '5120'),     // 5GB default
  workspacesPath: process.env.WORKSPACES_PATH || '/workspaces',  // LOCAL cache path
  ollamaHost: process.env.OLLAMA_HOST || 'http://ollama:11434',  // Internal Ollama service
  // Default model comes from env vars set by the API (from admin settings)
  // No hardcoded fallback - the API provides the validated default model
  defaultModel: process.env.AGENTICODE_MODEL || process.env.DEFAULT_MODEL || '',
  defaultUi: process.env.AGENTICODE_UI || 'ink',  // Ink UI provides modern terminal experience via PTY
  // SECURITY: Internal API key must match CODE_MANAGER_INTERNAL_KEY from AgenticWork API
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  // Cloud storage configuration - PRIMARY storage for workspaces
  storage: getStorageConfig(),
};
