/**
 * AgenticWork Chat API Server
 * 
 * Main Fastify server implementation with comprehensive middleware stack,
 * route registration, database initialization, and health monitoring.
 * Supports both REST API and Server-Sent Events (SSE) for real-time chat.
 * 
 */

import { prisma } from './utils/prisma.js';
import { getSecrets, logSecrets } from './config/secrets.config.js';

import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import axios from 'axios';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { swaggerOptions, swaggerUiOptions } from './config/swagger.config.js';
// Security
import { securityPlugin } from './middleware/security.js';
import { authMiddleware, adminMiddleware } from './middleware/unifiedAuth.js';
import { adminGuard } from './middleware/adminGuard.js';
// Routes (WebSocket-based chat-postgres.js removed)
import { settingsRoutes } from './routes/settings.js';
// admin-orchestrator deleted - auth handled in chat routes
// import { authRoutes } from './routes/auth.js';
import { ChatStorageService } from './services/ChatStorageService.js';
import { ModelHealthCheckService } from './services/ModelHealthCheck.js';
import { ChatCompletionService } from './routes/chat/services/ChatCompletionService.js';
import { ChatCacheService } from './routes/chat/services/ChatCacheService.js';
import { RAGService } from './services/RAGService.js';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { MilvusVectorService } from './services/MilvusVectorService.js';
import ToolSemanticCacheService from './services/ToolSemanticCacheService.js';
import { getToolSuccessTrackingService } from './services/ToolSuccessTrackingService.js';
import { getIntentLinkingService } from './services/IntentLinkingService.js';
import { createRepositoryContainer, getRepositoryContainer, shutdownRepositoryContainer } from './repositories/RepositoryContainer.js';
import { logger, loggers, logServiceStartup, logServiceShutdown } from './utils/logger.js';
import { setupMetrics, startMetricsUpdates } from './metrics/index.js';
import { CachedPromptService } from './services/CachedPromptService.js';
import { UserService } from './services/UserService.js';
import { InitializationService } from './services/InitializationService.js';
import { getRedisClient, initializeRedis } from './utils/redis-client.js';
import { EnhancedVectorManagementService } from './services/EnhancedVectorManagementService.js';
import { validateAdminPortalConfiguration } from './startup/validateAdminPortal.js';
import { ragInitService } from './services/RAGInitService.js';
import { MCPToolIndexingService } from './services/MCPToolIndexingService.js';
import { JobCompletionWatcher } from './services/JobCompletionWatcher.js';
import { ProviderManager } from './services/llm-providers/ProviderManager.js';
import { SmartModelRouter, setSmartModelRouter, getSmartModelRouter } from './services/SmartModelRouter.js';
import { ProviderConfigService } from './services/llm-providers/ProviderConfigService.js';
import ModelCapabilityRegistry, { setModelCapabilityRegistry } from './services/ModelCapabilityRegistry.js';
// Auth and permissions for WebSocket handlers
import { validateAnyToken } from './auth/tokenValidator.js';
import { UserPermissionsService } from './services/UserPermissionsService.js';

// Global provider manager, smart model router, and chat storage - initialized in start() function
let providerManager: ProviderManager | null = null;
let smartModelRouter: SmartModelRouter | null = null;
let chatStorage: ChatStorageService;

// Initialize model health check service (will be updated with Fastify logger later)
let modelHealthCheck: ModelHealthCheckService;

// Prisma client imported from utils/prisma

// Pool removed - services now use Prisma ORM

// Initialize Milvus client for RAG service (REQUIRED)
let milvusClient;
let ragService;
let milvusVectorService;
let documentIndexingService: any = null;
let enhancedVectorManagement: EnhancedVectorManagementService;
let toolSemanticCache: ToolSemanticCacheService;
let toolSemanticCacheInitialized = false;
let repositoryContainer: any = null;
let jobCompletionWatcher: JobCompletionWatcher;

// Milvus connection retry logic with extended retries for container startup
async function connectToMilvus(retries = 3, delay = 2000): Promise<MilvusClient> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Use MILVUS_ADDRESS if available, otherwise construct from HOST and PORT
      const milvusAddress = process.env.MILVUS_ADDRESS || 
        `${process.env.MILVUS_HOST || 'milvus-standalone'}:${process.env.MILVUS_PORT || '19530'}`;
      
      if (attempt === 1 || attempt % 5 === 0) {
        loggers.services.info(`🔄 Attempting to connect to Milvus at: ${milvusAddress} (attempt ${attempt}/${retries})`);
      }
      
      const client = new MilvusClient({
        address: milvusAddress,
        username: process.env.MILVUS_USERNAME || process.env.MILVUS_USER,
        password: process.env.MILVUS_PASSWORD,
        timeout: 30000 // 30 second timeout
      });
      
      // Test connection with health check
      const healthCheck = await client.checkHealth();
      if (healthCheck.isHealthy) {
        loggers.services.info(`✅ Milvus connected successfully on attempt ${attempt}`);
        return client;
      } else {
        throw new Error(`Milvus health check failed: ${JSON.stringify(healthCheck)}`);
      }
    } catch (error) {
      // Only log every 5th attempt to reduce noise
      if (attempt % 5 === 0 || attempt === 1) {
        loggers.services.warn({ 
          err: error, 
          attempt, 
          maxRetries: retries,
          nextRetryIn: delay
        }, `❌ Milvus connection attempt ${attempt}/${retries} failed`);
      }
      
      if (attempt === retries) {
        loggers.services.error({ err: error }, '🚨 CRITICAL: Failed to connect to Milvus after all retry attempts');
        throw new Error(`Milvus connection failed after ${retries} attempts: ${error.message}`);
      }
      
      // Wait before next retry - use consistent delay for stability
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Milvus connection failed');
}

// Milvus will be initialized during service startup with retry logic

// Initialize Redis client early for use in services
const redisClient = getRedisClient();

// Declare promptService - will be initialized after Milvus is ready
let promptService: CachedPromptService;

// Initialize UserService for admin user creation
const userService = new UserService(loggers.services);

// Initialize all services with first-time deployment tracking
async function initializeServices() {
  try {
    // Database schema is already initialized in start() function
    loggers.services.info('📋 Initializing system services and configurations...');
    
    // Initialize Redis client connection
    loggers.services.info('🔄 Initializing Redis client connection...');
    await initializeRedis(loggers.services);
    if (redisClient.isConnected()) {
      loggers.services.info('✅ Redis client connected successfully');

      // Start JobCompletionWatcher for autonomous job monitoring
      loggers.services.info('🔄 Starting JobCompletionWatcher for autonomous monitoring...');
      jobCompletionWatcher = new JobCompletionWatcher(redisClient, loggers.services);
      jobCompletionWatcher.start();
      loggers.services.info('✅ JobCompletionWatcher started - AI will auto-detect completed jobs');

      // Wire watcher events to SSE broadcasts for real-time notifications
      jobCompletionWatcher.on('job:completed', async (statusChange: any) => {
        loggers.services.info({
          jobId: statusChange.jobId,
          sessionId: statusChange.sessionId,
          status: statusChange.newStatus
        }, '📢 Broadcasting job completion to SSE clients');

        try {
          // Dynamic import to avoid circular dependencies
          const { broadcastJobCompletion } = await import('./routes/chat/handlers/stream.handler.js');
          broadcastJobCompletion({
            jobId: statusChange.jobId,
            sessionId: statusChange.sessionId,
            userId: statusChange.userId,
            result: statusChange.result,
            error: statusChange.error
          });

          loggers.services.info({
            jobId: statusChange.jobId,
            sessionId: statusChange.sessionId
          }, '✅ Job completion broadcasted to active SSE connections');
        } catch (error) {
          loggers.services.error({
            error: error.message,
            jobId: statusChange.jobId
          }, '❌ Failed to broadcast job completion');
        }
      });
    } else {
      loggers.services.warn('⚠️ Redis client failed to connect - continuing without cache');
    }

    // System prompts will be initialized by InitializationService in correct order
    loggers.services.info('📋 Prompt initialization will be handled by InitializationService');

    // Initialize CachedPromptService early (without Milvus initially)
    // Will be re-initialized with Milvus support later if Milvus connects
    promptService = new CachedPromptService(loggers.services, {
      enableCache: true,
      cacheTTL: 1800,
      cacheUserAssignments: true,
      cacheTemplates: true,
      milvusService: undefined // No Milvus yet
    });
    loggers.services.info('✅ CachedPromptService initialized (Milvus semantic search will be enabled if Milvus connects)');

    // Create InitializationService to handle first-time deployment
    const initService = new InitializationService(prisma, loggers.services);
    
    // Vault already initialized at startup - just verify it's available
    const vaultService = (global as any).vaultService;
    if (vaultService) {
      loggers.services.info('✅ Using Vault service initialized at startup');
    } else {
      loggers.services.warn('⚠️ Vault service not available - using environment variables');
    }
    
    // Check if system has been initialized
    const currentStatus = await initService.getInitializationStatus();
    loggers.services.info({
      isInitialized: currentStatus.isInitialized,
      completedComponents: currentStatus.completedComponents,
      lastInitialized: currentStatus.lastInitialized,
      version: currentStatus.version
    }, 'Current system initialization status');

    // Initialize RAG services (embedding models, vector DBs, etc.)
    loggers.services.info('🚀 Initializing RAG services...');
    const ragInitialized = await ragInitService.initialize();
    
    if (ragInitialized) {
      const ragHealth = ragInitService.getHealthStatus();
      loggers.services.info({
        healthy: ragHealth.healthy,
        embeddingProvider: ragHealth.components.embeddings.provider,
        embeddingModel: ragHealth.components.embeddings.model,
        milvusHealthy: ragHealth.components.milvus.healthy
      }, '✅ RAG services initialized successfully');

      // Semantic template routing is now handled by PromptTemplateSemanticService
      // (integrated into ChatPromptService and indexed during Milvus init)
      loggers.services.info('✅ Semantic template routing ready (Milvus-based)');

    } else {
      const ragError = ragInitService.getInitializationError();
      loggers.services.warn({ error: ragError }, '⚠️ RAG services failed to initialize - system will operate with limited capabilities');
      loggers.services.warn('💡 Set AZURE_OPENAI_EMBEDDING_DEPLOYMENT or AWS_EMBEDDING_MODEL_ID to enable embeddings');
    }

    // Initialize Bedrock Pricing Service (fetches live pricing from AWS API)
    if (process.env.AWS_BEDROCK_ENABLED === 'true') {
      loggers.services.info('💰 Initializing Bedrock Pricing Service...');
      try {
        const { bedrockPricingService } = await import('./services/BedrockPricingService.js');
        await bedrockPricingService.initialize();
        loggers.services.info({
          cachedModels: bedrockPricingService.getAllPricing().length
        }, '✅ Bedrock Pricing Service initialized (live AWS pricing)');
      } catch (err) {
        loggers.services.warn({ err }, '⚠️ Bedrock Pricing Service failed - using fallback pricing');
      }
    }

    // Initialize Azure AI Foundry Metrics Service (optional)
    loggers.services.info('📊 Initializing Azure AI Foundry Metrics Service...');
    try {
      const azureSubscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
      const azureResourceGroup = process.env.AZURE_RESOURCE_GROUP;
      const azureOpenAIAccount = process.env.AZURE_OPENAI_ACCOUNT_NAME;

      if (azureSubscriptionId && azureResourceGroup && azureOpenAIAccount) {
        const { initializeAIFoundryMetricsService } = await import('./services/AzureAIFoundryMetricsService.js');
        const aifMetricsService = initializeAIFoundryMetricsService({
          subscriptionId: azureSubscriptionId,
          resourceGroupName: azureResourceGroup,
          accountName: azureOpenAIAccount,
          metricsTimeRangeMinutes: parseInt(process.env.AIF_METRICS_TIME_RANGE_MINUTES || '10080'), // 7 days default
          refreshIntervalMinutes: parseInt(process.env.AIF_METRICS_REFRESH_INTERVAL_MINUTES || '5')
        }, loggers.services);

        // Start periodic collection
        await aifMetricsService.startPeriodicCollection();
        loggers.services.info({
          subscriptionId: azureSubscriptionId,
          resourceGroup: azureResourceGroup,
          account: azureOpenAIAccount
        }, '✅ Azure AI Foundry Metrics Service initialized and collecting metrics');
      } else {
        loggers.services.info('⏭️  Azure AI Foundry Metrics Service not configured (optional)');
        loggers.services.info('💡 Set AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, and AZURE_OPENAI_ACCOUNT_NAME to enable AIF metrics');
      }
    } catch (error) {
      loggers.services.warn({ error }, '⚠️ Failed to initialize Azure AI Foundry Metrics Service - continuing without AIF metrics');
    }

    // MCP tool indexing will be initialized later after Milvus connection
    // to enable semantic search capabilities

    // Run first-time initialization with tracking (skips if already done)
    const finalStatus = await initService.initializeSystem({
      skipIfDone: true,  // Skip if already initialized
      forceReinit: process.env.FORCE_REINIT === 'true', // Allow force reinit via env var
      components: {
        prompts: true,
        adminUser: true,
        mcpServers: true,
        milvusCollections: true,
        mcpToolIndexing: true,
        azureValidation: true,
        systemSettings: true,
        databaseSchema: true
      }
    });

    loggers.services.info({
      isInitialized: finalStatus.isInitialized,
      completedComponents: finalStatus.completedComponents,
      componentCount: finalStatus.completedComponents.length
    }, '🎉 System initialization completed');

    // Legacy validation for backward compatibility
    // Validate admin user exists
    const userValidation = await userService.validateAdminUser();
    if (userValidation.configured && !userValidation.healthy) {
      loggers.services.error({
        adminEmail: userValidation.adminEmail,
        exists: userValidation.exists,
        isAdmin: userValidation.isAdmin
      }, '❌ CRITICAL: Admin user validation FAILED after initialization');
      throw new Error(`Admin user not properly configured: ${userValidation.adminEmail}`);
    }

    // Validate system prompts exist
    const promptValidation = await promptService.validateSystemPrompts();
    if (!promptValidation.healthy) {
      loggers.services.error({
        missing: promptValidation.missing,
        details: promptValidation.details
      }, '❌ CRITICAL: System prompt templates validation FAILED after initialization');
      throw new Error(`Missing system prompts: ${promptValidation.missing.join(', ')}`);
    }
    
    // Embedding models are discovered dynamically from providers
    loggers.services.info('🔄 Embedding models will be discovered from configured providers...');

    // Initialize Flowise System Admin (if Flowise is configured)
    if (process.env.FLOWISE_URL && process.env.FLOWISE_ADMIN_EMAIL && process.env.FLOWISE_ADMIN_PASSWORD) {
      loggers.services.info('🔄 Initializing Flowise system admin account...');
      try {
        const { FlowiseUserService } = await import('./services/FlowiseUserService.js');
        const flowiseService = new FlowiseUserService(prisma, loggers.services);

        const adminEmail = process.env.FLOWISE_ADMIN_EMAIL;
        const adminPassword = process.env.FLOWISE_ADMIN_PASSWORD;
        const adminName = process.env.FLOWISE_ADMIN_NAME || 'System Administrator';

        // Check if admin already exists
        const existingAdmin = await flowiseService.getFlowiseUserByEmail(adminEmail);

        if (!existingAdmin) {
          loggers.services.info({ adminEmail, adminName }, 'Creating Flowise system admin account...');

          const adminUserId = await flowiseService.createFlowiseUser(
            adminEmail,
            adminName,
            adminPassword,
            undefined // Self-referencing
          );

          // Create organization and workspace for admin
          const orgId = await flowiseService.ensureFlowiseOrganization(
            adminUserId,
            'System Administration'
          );

          await flowiseService.ensureFlowiseWorkspace(
            adminUserId,
            orgId,
            'Admin Workspace'
          );

          loggers.services.info({
            adminEmail,
            adminUserId,
            organizationId: orgId
          }, '✅ Flowise system admin account created successfully');
        } else {
          loggers.services.info({
            adminEmail,
            adminUserId: existingAdmin.id
          }, '✅ Flowise system admin account already exists');
        }
      } catch (error) {
        loggers.services.warn({
          error: error.message
        }, '⚠️ Failed to initialize Flowise system admin - Flowise may not be available');
      }
    } else {
      loggers.services.info('⏭️  Flowise system admin initialization skipped (FLOWISE_URL, FLOWISE_ADMIN_EMAIL, or FLOWISE_ADMIN_PASSWORD not configured)');
    }

    // Initialize Milvus connection with retry logic (OPTIONAL - don't fail startup)
    loggers.services.info('🔄 Attempting to connect to Milvus vector database (optional)...');
    try {
      milvusClient = await connectToMilvus();
      
      // Initialize RAG service for prompt template semantic search
      ragService = new RAGService(milvusClient, loggers.services);
      loggers.services.info('✅ Milvus client and RAG service initialized successfully');
      
      // Initialize the RAG collection
      const initResult = await ragService.initializeCollection();
      if (initResult.success) {
        loggers.services.info('RAG collection initialized successfully');
        
        // Sync all templates from database to Milvus
        const syncResult = await ragService.syncAllTemplates();
        if (syncResult.success) {
          loggers.services.info(`RAG templates synced: ${syncResult.synced} templates indexed`);
        } else {
          loggers.services.error(`Failed to sync RAG templates: ${syncResult.error}`);
        }
      } else {
        loggers.services.error(`Failed to initialize RAG collection: ${initResult.error}`);
      }
      
      // Initialize MilvusVectorService for user artifacts and embeddings
      loggers.services.info('🔄 Initializing MilvusVectorService for user artifacts...');
      milvusVectorService = new MilvusVectorService(providerManager);
      await milvusVectorService.initialize();
      loggers.services.info('✅ MilvusVectorService initialized with global collections');

      // Re-initialize CachedPromptService with Milvus semantic search support
      loggers.services.info('🔄 Re-initializing CachedPromptService with Milvus semantic search...');
      promptService = new CachedPromptService(loggers.services, {
        enableCache: true,
        cacheTTL: 1800, // 30 minutes
        cacheUserAssignments: true,
        cacheTemplates: true,
        milvusService: milvusVectorService // Enable semantic prompt template search
      });
      loggers.services.info('✅ CachedPromptService re-initialized with Milvus semantic search enabled');

      // Initialize Document Indexing Service for uploaded file vector storage
      loggers.services.info('🔄 Initializing Document Indexing Service for file uploads...');
      try {
        const { DocumentIndexingService } = await import('./services/DocumentIndexingService.js');
        documentIndexingService = new DocumentIndexingService(milvusClient, prisma, loggers.services);
        await documentIndexingService.initializeCollection();
        loggers.services.info('✅ Document Indexing Service initialized successfully');
      } catch (error) {
        loggers.services.warn({ error: error.message }, '⚠️ Document Indexing Service initialization failed - file uploads will not be indexed');
        documentIndexingService = null;
      }

      // NOTE: Tool Semantic Cache initialization moved to after ProviderManager initialization
      // (see below after line 1650) to ensure embeddings work properly

      // Initialize Repository Container for data layer pattern
      loggers.services.info('🔄 Initializing Repository Container...');
      try {
        repositoryContainer = createRepositoryContainer({
          prisma,
          logger: loggers.services,
          cache: {
            defaultTTL: 3600,
            keyPrefix: 'repo',
            enableCaching: true
          }
        });
        loggers.services.info('✅ Repository Container initialized with data layer pattern');
      } catch (error) {
        loggers.services.warn({ error: error.message }, '⚠️ Repository Container initialization failed');
        repositoryContainer = null;
      }

      // Initialize Enhanced Vector Management Service for production vector operations
      loggers.services.info('🔄 Initializing Enhanced Vector Management Service...');
      enhancedVectorManagement = new EnhancedVectorManagementService(loggers.services, {
        enableAutoBackup: process.env.ENABLE_AUTO_BACKUP !== 'false',
        enableAutoOptimization: process.env.ENABLE_AUTO_OPTIMIZATION !== 'false',
        enableHealthMonitoring: process.env.ENABLE_HEALTH_MONITORING !== 'false',
        healthCheckInterval: parseInt(process.env.VECTOR_HEALTH_CHECK_INTERVAL || '15'),
        alertThresholds: {
          searchLatency: parseInt(process.env.VECTOR_SEARCH_LATENCY_THRESHOLD || '1000'),
          memoryUsage: parseInt(process.env.VECTOR_MEMORY_USAGE_THRESHOLD || String(8 * 1024 * 1024 * 1024)),
          fragmentationRatio: parseFloat(process.env.VECTOR_FRAGMENTATION_THRESHOLD || '0.3'),
          errorRate: parseFloat(process.env.VECTOR_ERROR_RATE_THRESHOLD || '0.05')
        }
      });

      // Export for use in routes
      global.milvusVectorService = milvusVectorService;
      global.documentIndexingService = documentIndexingService;
      global.enhancedVectorManagement = enhancedVectorManagement;
      global.toolSemanticCache = toolSemanticCache;
      global.toolSemanticCacheInitialized = toolSemanticCacheInitialized;
      global.repositoryContainer = repositoryContainer;

      loggers.services.info('✅ Enhanced Vector Management Service initialized with production features');

      // Initialize Conversation Compaction Worker for background summarization
      loggers.services.info('🔄 Initializing Conversation Compaction Worker...');
      try {
        const { ConversationCompactionWorker } = await import('./services/ConversationCompactionWorker.js');
        const compactionWorker = new ConversationCompactionWorker({
          prisma,
          redis: redisClient,
          logger: loggers.services
        });

        await compactionWorker.start();
        global.compactionWorker = compactionWorker;
        loggers.services.info('✅ Conversation Compaction Worker started successfully');
      } catch (error) {
        loggers.services.warn({ error: error.message }, '⚠️ Conversation Compaction Worker failed to initialize - old conversations will not be summarized');
        global.compactionWorker = null;
      }
      
    } catch (error) {
      loggers.services.warn({ err: error }, '⚠️ Milvus connection failed - continuing without vector search capabilities');
      // Continue without Milvus - RAG features will be disabled
      milvusClient = null;
      ragService = null;
      milvusVectorService = null;
      documentIndexingService = null;
      enhancedVectorManagement = null;
      toolSemanticCacheInitialized = false;
      repositoryContainer = null;
      global.milvusVectorService = null;
      global.documentIndexingService = null;
      global.enhancedVectorManagement = null;
      global.toolSemanticCache = null;
      global.toolSemanticCacheInitialized = false;
      global.repositoryContainer = null;
    }

    loggers.services.info('🚀 All services initialized successfully');
  } catch (error) {
    loggers.services.error({ err: error }, 'Service initialization failed - this is critical');
    throw error; // Re-throw to prevent service startup
  }
}

// Service initialization is now done after server starts successfully

const server = Fastify({
  pluginTimeout: 60000, // 60 second plugin timeout
  bodyLimit: 52428800, // 50MB body limit for all requests (including file uploads)
  // Trust proxy headers (X-Forwarded-Proto, X-Forwarded-For, etc.)
  // Required when running behind reverse proxy (nginx, k8s ingress) for:
  // - Correct HTTPS detection for secure cookies
  // - Proper client IP detection
  trustProxy: true,
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    serializers: {
      req: (req: any) => {
        // Skip serialization for health and metrics endpoints
        if (req.url === '/health' || req.url === '/api/health' ||
            req.url?.startsWith('/health/') ||
            req.url === '/metrics' || req.url === '/api/metrics') {
          return undefined;
        }
        return {
          method: req.method,
          url: req.url,
          hostname: req.hostname,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort
        };
      },
      res: (res: any) => ({
        statusCode: res.statusCode
      })
    },
    // Ignore noisy endpoints in request logging to reduce log spam
    hooks: {
      logMethod(inputArgs: any[], method: any) {
        const url = inputArgs[0]?.req?.url;

        // Skip ALL logging for health checks and metrics endpoints
        if (url === '/health' || url === '/api/health' ||
            url?.startsWith('/health/') ||
            url === '/metrics' || url === '/api/metrics') {
          // Completely skip logging for these endpoints
          return;
        }
        return method.apply(this, inputArgs);
      }
    }
  },
  disableRequestLogging: false,
  requestIdLogLabel: 'reqId',
});

// Custom JSON content type parser that handles empty bodies gracefully
// This fixes FST_ERR_CTP_EMPTY_JSON_BODY errors when clients send Content-Type: application/json with empty body
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body: string, done) => {
  try {
    // Handle empty body - return empty object instead of error
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    const json = JSON.parse(body);
    done(null, json);
  } catch (err: any) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

// Custom request hook to handle metrics logging
server.addHook('onRequest', async (request, reply) => {
  const start = Date.now();
  
  // Add finish handler for custom logging
  reply.raw.on('finish', () => {
    const duration = Date.now() - start;
    
    // Special handling for metrics endpoint - minimal logging
    if (request.url === '/metrics' || request.url === '/api/metrics') {
      // Only log if there's an error or it's slow
      if (reply.statusCode >= 400 || duration > 100) {
        loggers.server.warn({
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          duration
        }, `Metrics scrape: ${reply.statusCode} in ${duration}ms`);
      }
      // Skip normal logging for successful, fast metrics requests
      return;
    }
    
    // Skip health check and metrics logging for successful requests to reduce noise
    if (!request.url.startsWith('/health') && !request.url.startsWith('/api/health') && !request.url.startsWith('/metrics')) {
      const logMethod = reply.statusCode >= 500 ? 'error' : 
                        reply.statusCode >= 400 ? 'warn' : 
                        'debug'; // Use debug for normal requests to reduce noise
      
      loggers.server[logMethod]({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration,
        userAgent: request.headers['user-agent'],
        ip: request.ip
      }, `${request.method} ${request.url} ${reply.statusCode} ${duration}ms`);
    }
  });
});

// Register plugins
// Configure CORS to only allow frontend
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
      process.env.FRONTEND_URL || 'http://agenticworkchat-ui:3000',
      `http://agenticworkchat-ui:${process.env.UI_PORT || '3000'}`,
      `http://${process.env.API_HOST || 'agenticworkchat-api'}:${process.env.API_PORT || '8000'}`,
      'http://localhost',       // Local through Caddy (port 80)
      'http://localhost:3000',  // Local development
      'http://localhost:3001',  // Alternative local port
      'http://127.0.0.1',       // IP-based through Caddy (port 80)
      'http://127.0.0.1:3000',  // IP-based local access
      'http://127.0.0.1:3001'   // Alternative IP-based local port
    ].filter((origin): origin is string => Boolean(origin));

// Register cookie parser for cookie-based auth (used by Flowise iframe)
await server.register(fastifyCookie, {
  secret: process.env.JWT_SECRET || 'cookie-secret',
  parseOptions: {}
});

await server.register(cors as any, {
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return cb(null, true);
    
    // Check if origin is allowed
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-User-ID',
    'X-AgenticWork-Frontend',
    'X-Timestamp',
    'X-Signature',
  ],
});

// Register Prisma client
server.decorate('prisma', prisma);

// Register Swagger/OpenAPI documentation
await server.register(swagger, swaggerOptions);
await server.register(swaggerUi, swaggerUiOptions);
loggers.server.info('📚 Swagger/OpenAPI documentation registered at /api/swagger');

// Register shared schemas with Fastify so $ref works in route schemas
// These schemas are also defined in swagger.config.ts for OpenAPI spec
const sharedSchemas = swaggerOptions.openapi?.components?.schemas;
if (sharedSchemas) {
  for (const [schemaName, schemaDefinition] of Object.entries(sharedSchemas)) {
    server.addSchema({
      $id: `#/components/schemas/${schemaName}`,
      ...(schemaDefinition as object)
    });
  }
  loggers.server.info(`📐 Registered ${Object.keys(sharedSchemas).length} shared schemas with Fastify`);
}

// NOTE: OpenAPI spec generation moved to after all routes are registered
// See generateOpenAPISpec() function called in start() after registerAllRoutes()

// Function to generate OpenAPI spec - called after server.ready() in start()
async function generateOpenAPISpec() {
  try {
    const spec = server.swagger();
    const outputDir = join(process.cwd(), 'docs');
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, 'openapi.json');
    writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
    loggers.server.info({ path: outputPath, paths: Object.keys(spec.paths || {}).length }, '📄 OpenAPI spec generated');
  } catch (error) {
    loggers.server.warn({ error }, 'Failed to generate static OpenAPI spec - will be available at /api/swagger/json');
  }
}

// Initialize services that need Fastify logger
// Create cache and completion services (legacy - kept for backward compatibility)
const redisClientForCache = getRedisClient();
const cacheService = new ChatCacheService(redisClientForCache, server.log);
const completionService = new ChatCompletionService(server.log, cacheService);
// Model health check will be initialized after providerManager is created

// WebSocket support removed - using HTTP POST + SSE instead

// Register multipart for file uploads
await server.register(import('@fastify/multipart') as any, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit - increased for image uploads
    files: 10 // Max 10 files per request
  }
});

// Register WebSocket support for real-time MCP monitoring
await server.register(import('@fastify/websocket') as any);

// Register security plugin AFTER CORS but BEFORE routes
await server.register(securityPlugin);

// Setup metrics (before routes so /metrics endpoint is available)
setupMetrics();

// Health check (not protected by security middleware)
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Metrics endpoint for Prometheus scraping
server.get('/metrics', async (request, reply) => {
  const { register } = await import('./metrics/index.js');
  reply.type(register.contentType);
  const metrics = await register.metrics();
  return metrics;
});

// Also expose metrics at /api/metrics for compatibility
server.get('/api/metrics', async (request, reply) => {
  const { register } = await import('./metrics/index.js');
  reply.type(register.contentType);
  const metrics = await register.metrics();
  return metrics;
});

// OpenAPI spec JSON endpoint for Admin Portal embedding (requires admin auth)
server.get('/api/openapi.json', { preHandler: [adminGuard] }, async (request, reply) => {
  reply.type('application/json');
  return server.swagger();
});

// Model health check endpoint
server.get('/model-health', async () => {
  const healthResult = await modelHealthCheck.checkModelHealth();
  return healthResult;
});

// Prompt validation health check - MUST validate prompts are loaded
server.get('/prompt-health', async (request, reply) => {
  try {
    // Check for default prompt template using Prisma
    const defaultPrompt = await prisma.promptTemplate.findFirst({
      where: { 
        is_default: true, 
        is_active: true
      }
    });
    
    // Check for admin prompts using Prisma
    const adminPromptsCount = await prisma.promptTemplate.count({
      where: { 
        is_active: true,
        name: {
          contains: 'admin',
          mode: 'insensitive'
        }
      }
    });
    
    // Check for system prompts using Prisma
    const systemPromptsCount = await prisma.systemPrompt.count({
      where: { is_active: true }
    });
    
    // Check for user assignments using Prisma
    const assignmentsCount = await prisma.userPromptAssignment.count();
    
    const hasDefaultPrompt = !!defaultPrompt;
    const hasAdminPrompts = adminPromptsCount > 0;
    const hasSystemPrompts = systemPromptsCount > 0;
    const hasAssignments = assignmentsCount > 0;
    
    const isHealthy = hasDefaultPrompt && (hasAdminPrompts || hasSystemPrompts);
    
    if (!isHealthy) {
      loggers.server.error({
        hasDefaultPrompt,
        hasAdminPrompts,
        hasSystemPrompts,
        hasAssignments,
        defaultPrompt: defaultPrompt || null
      }, '❌ CRITICAL: Prompts NOT properly loaded in database!');
      
      return reply.code(503).send({
        status: 'CRITICAL ERROR',
        error: 'Prompts NOT loaded in database',
        details: {
          hasDefaultPrompt,
          defaultPromptName: defaultPrompt?.name || 'MISSING',
          adminPromptCount: adminPromptsCount,
          systemPromptCount: systemPromptsCount,
          assignmentCount: assignmentsCount,
          message: 'Database seed needs to be run to populate prompts!'
        }
      });
    }
    
    loggers.server.info({
      defaultPrompt: defaultPrompt?.name,
      adminPrompts: adminPromptsCount,
      systemPrompts: systemPromptsCount,
      assignments: assignmentsCount
    }, '✅ Prompts properly loaded and validated');
    
    return {
      status: 'healthy',
      prompts: {
        defaultPrompt: defaultPrompt ? {
          id: defaultPrompt.id,
          name: defaultPrompt.name,
          isActive: defaultPrompt.is_active
        } : null,
        adminPromptCount: adminPromptsCount,
        systemPromptCount: systemPromptsCount,
        assignmentCount: assignmentsCount
      }
    };
  } catch (error) {
    loggers.server.error({ err: error }, '❌ Failed to check prompt health');
    return reply.code(500).send({
      status: 'error',
      error: 'Failed to validate prompts',
      details: error.message
    });
  }
});

// Endpoint to show actual prompt content from database
server.get('/prompts/debug', async (request, reply) => {
  try {
    // Get the default prompt with content using Prisma
    const defaultPrompt = await prisma.promptTemplate.findFirst({
      where: {
        is_default: true,
        is_active: true
      },
      select: {
        id: true,
        name: true,
        content: true
      }
    });
    
    // Get admin prompts with content using Prisma
    const adminPrompts = await prisma.promptTemplate.findMany({
      where: {
        is_active: true,
        name: {
          contains: 'admin',
          mode: 'insensitive'
        }
      },
      select: {
        id: true,
        name: true,
        content: true
      },
      take: 5
    });
    
    const response = {
      status: 'Prompts loaded from database',
      defaultPrompt: defaultPrompt ? {
        id: defaultPrompt.id,
        name: defaultPrompt.name,
        contentPreview: defaultPrompt.content.substring(0, 200) + '...',
        fullContent: defaultPrompt.content
      } : null,
      adminPrompts: adminPrompts.map(p => ({
        id: p.id,
        name: p.name,
        contentPreview: p.content.substring(0, 200) + '...'
      }))
    };
    
    loggers.server.info('✅ Prompts debug info retrieved successfully');
    return reply.send(response);
    } catch (error) {
    loggers.server.error({ err: error }, '❌ Failed to get prompt debug info');
    return reply.code(500).send({
      status: 'error',
      error: 'Failed to retrieve prompt content',
      details: error.message
    });
  }
});

// Route registration will happen after database initialization

// Create function to register all routes after database is ready
async function registerAllRoutes() {
  loggers.routes.info('📝 Registering all application routes...');

  // Register Auth routes
  try {
    const { authRoutes } = await import('./routes/auth.js');
    await server.register(authRoutes);
    loggers.routes.info('Auth routes registered at /api/auth/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register auth routes');
  }

  // Register Local Authentication System
  try {
    const { localAuthRoutes } = await import('./routes/local-auth.js');
    await server.register(localAuthRoutes, { prefix: '/api/auth/local' });
    loggers.routes.info('Local authentication system registered at /api/auth/local/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register local auth system');
  }

  // Register OBO routes
  try {
    const { oboRoutes } = await import('./routes/obo.js');
    await server.register(oboRoutes);
    loggers.routes.info('OBO routes registered at /api/auth/obo/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register OBO routes');
  }

  // Register Google OAuth routes (conditionally based on AUTH_PROVIDER)
  const authProvider = process.env.AUTH_PROVIDER || 'azure-ad';
  if (authProvider === 'google') {
    try {
      const { googleAuthRoutes } = await import('./routes/google-auth/index.js');
      await server.register(googleAuthRoutes, { prefix: '/api/auth/google' });
      loggers.routes.info('Google OAuth routes registered at /api/auth/google/* (AUTH_PROVIDER=google)');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register Google OAuth routes');
    }
  } else {
    loggers.routes.info(`Google OAuth routes skipped (AUTH_PROVIDER=${authProvider})`);
  }

  // Register NEW modern chat system
  try {
    const { chatPlugin } = await import('./routes/chat/index.js');
    await server.register(chatPlugin, {
      prefix: '/api/chat',
      chatStorage,
      redis: redisClient as any,
      // Pass both milvus and getMilvus for ValidationStage MemoryContextService initialization
      milvus: milvusClient,
      getMilvus: () => global.milvusVectorService || milvusVectorService || milvusClient,
      providerManager: providerManager as any, // Pass ProviderManager for multi-provider LLM support
      config: {
        enableMCP: true,
        enablePromptEngineering: true,
        enableAnalytics: true,
        enableCaching: true,
        enableCoT: process.env.ENABLE_COT === 'true', // Enable Chain of Thought display (from docker-compose.yml)
        maxConcurrentRequests: 60,
        requestTimeoutMs: 120000
      }
    });
    loggers.routes.info('New modern chat system registered at /api/chat');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register new chat system');
  }

  // Register Settings routes
  await server.register(settingsRoutes, { prefix: '/api/settings' });

  // Register Orchestration routes (concurrent subagent execution)
  try {
    const orchestrateRoutes = (await import('./routes/orchestrate.js')).default;
    await server.register(orchestrateRoutes);
    loggers.routes.info('Orchestration routes registered at /api/orchestrate/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register orchestration routes');
  }

  // Register Admin routes
  try {
    const { adminRoutes } = await import('./routes/admin.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin routes registered at /api/admin with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin routes');
  }

  // Register Admin Portal Enhanced routes
  try {
    const { adminPortalEnhancedRoutes } = await import('./routes/admin-portal-enhanced.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminPortalEnhancedRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Enhanced admin portal routes registered at /api/admin with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register enhanced admin portal routes');
  }

  // Register Admin Flowise Management routes (only if FLOWISE_ENABLED)
  const flowiseEnabled = process.env.FLOWISE_ENABLED === 'true';
  if (flowiseEnabled) {
    try {
      const adminFlowiseRoutes = (await import('./routes/admin-flowise.js')).default;
      await server.register(async (instance) => {
        instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
        await instance.register(adminFlowiseRoutes);
      }, { prefix: '/api/admin' });
      loggers.routes.info('Admin Flowise management routes registered at /api/admin/users/:userId/flowise/* with admin middleware');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register admin Flowise routes');
    }
  } else {
    loggers.routes.info('Flowise admin routes skipped - FLOWISE_ENABLED is false');
  }

  // Register Admin Ollama routes for Ollama model management (only if enabled)
  const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true';
  if (ollamaEnabled) {
    try {
      const { adminOllamaRoutes } = await import('./routes/admin-ollama.js');
      await server.register(async (instance) => {
        instance.addHook('preHandler', adminMiddleware);
        await instance.register(adminOllamaRoutes);
      }, { prefix: '/api/admin' });
      loggers.routes.info('Admin Ollama routes registered at /api/admin/ollama/* with admin middleware');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register admin Ollama routes');
    }
  } else {
    loggers.routes.info('Ollama routes skipped - OLLAMA_ENABLED is false');
  }

  // Register Admin Missing Routes (MCP health, tools status)
  try {
    const { adminMissingRoutes, capabilitiesRoutes } = await import('./routes/admin-missing-routes.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMissingRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin missing routes registered at /api/admin/mcp/health, /api/admin/mcp-tools/status');

    // Register capabilities routes at /api/capabilities/*
    await server.register(capabilitiesRoutes, { prefix: '/api/capabilities' });
    loggers.routes.info('Capabilities routes registered at /api/capabilities/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin missing routes');
  }

  // Register Flowise Authentication Proxy routes
  // Note: /flowise/validate-token is a backend-to-backend call from Flowise SSO
  // and should NOT require auth middleware (token validation is done within the endpoint)
  try {
    const flowiseAuthRoutes = (await import('./routes/flowise-auth.js')).default;
    await server.register(async (instance) => {
      // Apply auth middleware conditionally - skip for validate-token endpoint
      instance.addHook('preHandler', async (request, reply) => {
        // Skip auth for validate-token (backend-to-backend SSO call)
        // Skip auth for launch (uses token query parameter for iframe authentication)
        const shouldSkipAuth = request.url.includes('/flowise/validate-token') || request.url.includes('/flowise/launch');

        loggers.routes.debug({
          url: request.url,
          routeUrl: request.routeOptions?.url,
          shouldSkipAuth
        }, `[FLOWISE AUTH HOOK] Request: ${request.method} ${request.url}`);

        if (shouldSkipAuth) {
          loggers.routes.info(`[FLOWISE AUTH HOOK] Skipping auth for ${request.url}`);
          return;
        }
        return authMiddleware(request, reply);
      });
      await instance.register(flowiseAuthRoutes);
    }, { prefix: '/api' });
    loggers.routes.info('Flowise authentication proxy routes registered at /api/flowise/* with auth middleware (validate-token excluded)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Flowise auth routes');
  }

  // Register Flowise OAuth 2.0 Provider routes
  // IMPORTANT: These routes handle OAuth authentication flow for Flowise SSO
  // The /authorize endpoint requires auth middleware (user must be logged in)
  // The /token and /userinfo endpoints use Bearer token authentication
  try {
    const flowiseOAuthRoutes = (await import('./routes/flowise-oauth.js')).default;
    await server.register(async (instance) => {
      // Only add auth middleware to /authorize endpoint
      instance.addHook('preHandler', async (request, reply) => {
        if (request.url.includes('/flowise/oauth/authorize')) {
          return authMiddleware(request, reply);
        }
      });
      await instance.register(flowiseOAuthRoutes);
    }, { prefix: '/api' });
    loggers.routes.info('Flowise OAuth 2.0 provider routes registered at /api/flowise/oauth/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Flowise OAuth routes');
  }

  // Register Flowise Integration routes (tools, models, health for Flowise nodes)
  try {
    const { flowiseIntegrationRoutes } = await import('./routes/flowise-integration.js');
    await server.register(flowiseIntegrationRoutes, { prefix: '/api/flowise' });
    loggers.routes.info('Flowise integration routes registered at /api/flowise/* (tools, models, health)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Flowise integration routes');
  }

  // Register Flowise Workspace Proxy routes (create resources as authenticated user)
  try {
    const { flowiseProxyRoutes } = await import('./routes/flowise-proxy.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(flowiseProxyRoutes);
    }, { prefix: '/api' });
    loggers.routes.info('Flowise workspace proxy routes registered at /api/flowise-workspace/* with auth middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Flowise workspace proxy routes');
  }

  // Register Flowise Prediction Proxy routes (execute chatflows as authenticated user)
  try {
    const { flowisePredictionRoutes } = await import('./routes/flowise-proxy.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(flowisePredictionRoutes);
    }, { prefix: '/api/v1' });
    loggers.routes.info('Flowise prediction proxy routes registered at /api/v1/prediction/:chatflowId with auth middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Flowise prediction proxy routes');
  }

  // n8n routes removed - functionality deprecated

  // Register OpenAI-Compatible API routes for external integrations (like Flowise)
  // This provides /api/v1/chat/completions and /api/v1/models endpoints
  // that route through the ProviderManager for multi-provider LLM support
  try {
    const openaiCompatibleRoutes = (await import('./routes/openai-compatible.js')).default;
    await server.register(async (instance) => {
      // Use internal API key auth for Flowise integration
      instance.addHook('preHandler', async (request, reply) => {
        const apiKey = request.headers['x-api-key'] || request.headers['authorization']?.replace('Bearer ', '');
        const flowiseInternalKey = process.env.FLOWISE_INTERNAL_API_KEY || 'flowise-internal';

        // Allow requests with valid internal API key (from Flowise)
        if (apiKey === flowiseInternalKey) {
          return; // Authorized
        }

        // Otherwise, require normal auth middleware
        return authMiddleware(request, reply);
      });
      await instance.register(openaiCompatibleRoutes, {
        providerManager: providerManager as any,
        logger: loggers.routes
      });
    }, { prefix: '/api' });
    loggers.routes.info('OpenAI-compatible routes registered at /api/v1/chat/completions, /api/v1/models');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register OpenAI-compatible routes');
  }

  // Register Flowise UI Proxy (proxies /flowise/* to Flowise container)
  try {
    server.all('/flowise/*', async (request, reply) => {
      const flowiseUrl = process.env.FLOWISE_INTERNAL_URL || 'http://flowise:3000';
      const path = request.url.replace('/flowise', '');
      const targetUrl = `${flowiseUrl}${path}`;

      try {
        const response = await fetch(targetUrl, {
          method: request.method,
          headers: {
            ...Object.fromEntries(
              Object.entries(request.headers).filter(([key]) =>
                !['host', 'connection'].includes(key.toLowerCase())
              )
            ),
            'X-Forwarded-For': request.ip,
            'X-Forwarded-Proto': request.protocol,
            'X-Forwarded-Host': request.hostname
          },
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body)
        });

        // Forward response headers
        response.headers.forEach((value, key) => {
          if (!['connection', 'transfer-encoding'].includes(key.toLowerCase())) {
            reply.header(key, value);
          }
        });

        reply.code(response.status);
        return reply.send(await response.text());
      } catch (proxyError: any) {
        loggers.routes.error({ error: proxyError.message, targetUrl }, 'Flowise proxy error');
        return reply.code(502).send({ error: 'Failed to proxy request to Flowise' });
      }
    });
    loggers.routes.info('Flowise UI proxy registered at /flowise/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Flowise UI proxy');
  }

  // Register Admin System routes for real-time system monitoring
  try {
    const { adminSystemRoutes } = await import('./routes/admin-system.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminSystemRoutes);
    }, { prefix: '/api/admin/system' });
    loggers.routes.info('Admin System monitoring routes registered at /api/admin/system/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin system routes');
  }

  // Register Admin Slider routes for intelligence slider management
  try {
    const { adminSliderRoutes } = await import('./routes/admin-slider.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminSliderRoutes);
    }, { prefix: '/api/admin/slider' });
    loggers.routes.info('Admin Slider routes registered at /api/admin/slider/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin slider routes');
  }

  // Register Tiered Function Calling routes for configurable model selection
  try {
    const { adminTieredFunctionCallingRoutes } = await import('./routes/admin-tiered-fc.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminTieredFunctionCallingRoutes);
    }, { prefix: '/api/admin/tiered-fc' });
    loggers.routes.info('Tiered Function Calling routes registered at /api/admin/tiered-fc/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register tiered function calling routes');
  }

  // Register Admin Prompts & Templates management routes
  try {
    const { adminPromptsRoutes } = await import('./routes/admin-prompts.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminPromptsRoutes);
    }, { prefix: '/api/admin/prompts' });
    loggers.routes.info('Admin Prompts & Templates routes registered at /api/admin/prompts/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin prompts routes');
  }

  // Register Admin Audit Chat routes for AI-powered log querying
  try {
    const { default: adminAuditChatRoutes } = await import('./routes/admin-audit-chat.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAuditChatRoutes);
    });
    loggers.routes.info('Admin Audit Chat routes registered at /api/admin/audit/chat with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit chat routes');
  }

  // Register Admin LLM Metrics routes for real-time token usage and cost analytics
  try {
    const { default: adminLLMMetricsRoutes } = await import('./routes/admin-llm-metrics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminLLMMetricsRoutes);
    });
    loggers.routes.info('Admin LLM Metrics routes registered at /api/admin/metrics/llm/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin LLM metrics routes');
  }

  // Register Admin MCP Logs routes for tracking tool executions
  try {
    const { default: adminMCPLogsRoutes } = await import('./routes/admin-mcp-logs.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminMCPLogsRoutes);
    });
    loggers.routes.info('Admin MCP Logs routes registered at /api/admin/mcp-logs with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP logs routes');
  }

  // Register Admin Context Window Metrics routes for tracking context window usage
  try {
    const { default: adminContextMetricsRoutes } = await import('./routes/admin-context-metrics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminContextMetricsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Context Window Metrics routes registered at /api/admin/context-metrics with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin context window metrics routes');
  }

  // Register Admin MCP Tools routes for tool cache management
  try {
    const { default: adminMCPToolsRoutes } = await import('./routes/admin-mcp-tools.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminMCPToolsRoutes);
    }, { prefix: '/api/admin/mcp/tools' });
    loggers.routes.info('Admin MCP Tools routes registered at /api/admin/mcp/tools/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP tools routes');
  }

  // DISABLED: Duplicate of admin/mcp-management.js routes registered below
  // Register Admin MCP Management routes for dynamic proxy configuration
  // try {
  //   const { default: adminMCPManagementRoutes } = await import('./routes/admin-mcp-management.js');
  //   await server.register(async (instance) => {
  //     instance.addHook('preHandler', authMiddleware);
  //     await instance.register(adminMCPManagementRoutes);
  //   }, { prefix: '/api/admin' });
  //   loggers.routes.info('Admin MCP Management routes registered at /api/admin/mcp/* with auth middleware');
  // } catch (error) {
  //   loggers.routes.error({ err: error }, 'Failed to register admin MCP management routes');
  // }

  // Register Admin Usage Analytics routes for usage metrics
  try {
    const { default: adminUsageAnalyticsRoutes } = await import('./routes/admin-usage-analytics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminUsageAnalyticsRoutes);
    });
    loggers.routes.info('Admin Usage Analytics routes registered at /api/admin/analytics/usage with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin usage analytics routes');
  }


  // Register Admin Audit Logs routes for comprehensive audit logging
  try {
    const { default: adminAuditLogsRoutes } = await import('./routes/admin-audit-logs.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAuditLogsRoutes);
    });
    loggers.routes.info('Admin Audit Logs routes registered at /api/admin/audit-logs with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit logs routes');
  }

  // Register Admin Metrics routes for MCP and LLM metrics
  try {
    const { default: adminMetricsRoutes } = await import('./routes/admin-metrics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminMetricsRoutes);
    });
    loggers.routes.info('Admin Metrics routes registered at /api/admin/metrics/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin metrics routes');
  }

  // Register Admin API Token Management routes
  try {
    const { default: adminApiTokenRoutes } = await import('./routes/admin-api-tokens.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminApiTokenRoutes);
    });
    loggers.routes.info('Admin API Token Management routes registered at /api/admin/tokens/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin API token routes');
  }

  // Register Admin Prompting routes (techniques like Few-Shot, ReAct, etc.)
  try {
    const { default: adminPromptingRoutes } = await import('./routes/admin-prompting.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminPromptingRoutes);
    }, { prefix: '/api/admin/prompting' });
    loggers.routes.info('Admin prompting techniques routes registered at /api/admin/prompting with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin prompting routes');
  }

  // Register Admin MCP Inspector Proxy (secure access to MCP Inspector UI)
  try {
    const { default: adminMCPInspectorRoutes } = await import('./routes/admin-mcp-inspector.js');
    // Register without instance-level auth hook so routes can control their own auth
    await server.register(adminMCPInspectorRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Admin MCP Inspector proxy routes registered at /api/admin/mcp-inspector');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP inspector routes');
  }

  // Register Admin MCP Logs (detailed MCP call logging)
  try {
    const { default: adminMCPLogsRoutes } = await import('./routes/admin-mcp-logs.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminMCPLogsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin MCP Logs routes registered at /api/admin/mcp-logs with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP logs routes');
  }

  // Register Admin MCP Access Control routes (manage which groups can access which MCPs)
  try {
    const { default: adminMCPAccessRoutes } = await import('./routes/admin-mcp-access.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminMCPAccessRoutes);
    }, { prefix: '/api/admin/mcp' });
    loggers.routes.info('Admin MCP Access Control routes registered at /api/admin/mcp with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP access control routes');
  }

  // Register Admin User Permissions routes
  try {
    const { default: adminUserPermissionsRoutes } = await import('./routes/admin-user-permissions.js');
    // NOTE: This route file needs internal adminMiddleware protection
    await server.register(adminUserPermissionsRoutes);
    loggers.routes.info('Admin User Permissions routes registered at /api/admin/user-management/*, /api/admin/groups/*, /api/admin/permissions/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin user permissions routes');
  }

  // Register Auth Access Control routes (manage allowed users/admins for OAuth)
  try {
    const { authAccessRoutes } = await import('./routes/admin/auth-access.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Admin-only access
      await instance.register(authAccessRoutes);
    }, { prefix: '/api/admin/auth' });
    loggers.routes.info('Auth Access Control routes registered at /api/admin/auth/* (users, domains, access-requests) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register auth access control routes');
  }

  // Register Pipeline Control routes
  try {
    const { default: pipelineControlRoutes } = await import('./routes/admin/pipeline-control.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(pipelineControlRoutes);
    }, { prefix: '/api/admin/pipeline' });
    loggers.routes.info('Pipeline control routes registered at /api/admin/pipeline with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline control routes');
  }

  // Register Pipeline Summary routes (legacy endpoints for compatibility)
  try {
    const { default: pipelineStatusRoutes } = await import('./routes/admin/pipeline.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(pipelineStatusRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Pipeline summary routes registered at /api/admin/pipeline/summary and /api/admin/pipeline/history with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline summary routes');
  }

  // Register Admin Semantic Prompts routes
  try {
    // Admin semantic prompts routes removed - semantic routing now handled by PromptTemplateSemanticService
    // Templates are automatically indexed in Milvus during initialization
    loggers.routes.info('Semantic template routing managed by PromptTemplateSemanticService (Milvus-based)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin semantic prompts routes');
  }

  // Register Prompt Templates routes
  try {
    const { default: promptTemplateRoutes } = await import('./routes/prompt-templates.js');
    await server.register(promptTemplateRoutes, { prefix: '/api/prompt-templates' });
    loggers.routes.info('Prompt templates routes registered at /api/prompt-templates');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register prompt templates routes');
  }

  // Register Azure AD Sync routes
  try {
    const { azureADSyncRoutes } = await import('./routes/azure-ad-sync.js');
    await server.register(azureADSyncRoutes);
    loggers.routes.info('Azure AD sync routes registered at /api/auth/azure/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Azure AD sync routes');
  }

  // Register Account Linking routes
  try {
    const { accountLinkingRoutes } = await import('./routes/account-linking.js');
    await server.register(accountLinkingRoutes);
    loggers.routes.info('Account linking routes registered at /api/accounts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register account linking routes');
  }

  // Register Storage routes for secure token/data storage (converted to Fastify)
  try {
    const storageRoutes = (await import('./routes/storage.js')).default;
    await server.register(storageRoutes, { prefix: '' });
    loggers.routes.info('Storage routes registered at /api/storage/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register storage routes');
  }

  // NOTE: Legacy diagram render routes (Mermaid/PlantUML/D2) removed
  // Diagrams are now generated client-side using React Flow via the system MCP

  // Register Image routes (Milvus-backed image storage with semantic search)
  try {
    const { imageRoutes } = await import('./routes/images.js');
    await server.register(imageRoutes, { prefix: '' });
    loggers.routes.info('Image routes registered at /api/images/* (Milvus vector storage with semantic search)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register image routes');
  }

  // Register Agenticode routes (config + chat endpoint for agenticode-cli)
  try {
    const { agenticodeRoutes } = await import('./routes/agenticode.js');
    await server.register(agenticodeRoutes, {
      prefix: '/api/agenticode',
      providerManager: providerManager as any,
    });
    loggers.routes.info('Agenticode routes registered at /api/agenticode/* (CLI config and chat)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register agenticode routes');
  }

  // MCP Inspector removed - no longer using orchestrator

  // Register Files routes - DISABLED: duplicate with file-attachment routes
  // try {
  //   const { default: filesRoutes } = await import('./routes/files.js');
  //   await server.register(filesRoutes, { prefix: '/api/files' });
  //   loggers.routes.info('Files routes registered at /api/files/*');
  // } catch (error) {
  //   loggers.routes.error({ err: error }, 'Failed to register files routes');
  // }

  // Register Health routes
  try {
    const { default: healthRoutes } = await import('./routes/health.js');
    await server.register(healthRoutes, { prefix: '/api' });
    loggers.routes.info('Health routes registered at /api/health/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register health routes');
  }

  // Register System Config routes (public - no auth required)
  try {
    const { systemConfigRoutes } = await import('./routes/system-config.js');
    await server.register(systemConfigRoutes, { prefix: '/api/system' });
    loggers.routes.info('System config routes registered at /api/system/config (workflow engine detection)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register system config routes');
  }

  // Register Embeddings routes (OpenAI-compatible endpoint using UniversalEmbeddingService)
  try {
    const { default: embeddingsRoutes } = await import('./routes/embeddings.js');
    await server.register(embeddingsRoutes, { prefix: '/api/embeddings' });
    loggers.routes.info('Embeddings routes registered at /api/embeddings (uses UniversalEmbeddingService)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register embeddings routes');
  }

  // Register Internal Result Storage routes (for MCP servers)
  try {
    const { registerResultStorageRoutes } = await import('./routes/internal/result-storage.js');
    await registerResultStorageRoutes(server);
    loggers.routes.info('Internal result storage routes registered at /api/internal/result-storage/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register internal result storage routes');
  }

  // Register MCP Logs routes (for mcp-proxy to send logs)
  try {
    const { default: mcpLogsRoutes } = await import('./routes/mcp-logs.js');
    await server.register(mcpLogsRoutes, { prefix: '/api' });
    loggers.routes.info('MCP logs routes registered at /api/mcp-logs/* (no auth for internal service)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register MCP logs routes');
  }

  // Register AWCode Internal routes (for awcode-manager to persist sessions/messages)
  // NOTE: No auth required for internal service communication
  try {
    const { default: awcodeRoutes } = await import('./routes/awcode.js');
    await server.register(awcodeRoutes, { prefix: '/api/awcode' });
    loggers.routes.info('AWCode internal routes registered at /api/awcode/* (no auth for internal service)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register AWCode routes');
  }

  // Register Documentation routes
  try {
    const { docsRoutes } = await import('./routes/docs/index.js');
    await server.register(docsRoutes, { prefix: '/api' });
    loggers.routes.info('Documentation routes registered at /api/docs/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register documentation routes');
  }

  // Register Background Jobs routes (with auth middleware)
  try {
    const backgroundJobsRoutes = await import('./routes/background-jobs.js');
    await server.register(async (instance) => {
      instance.addHook('onRequest', authMiddleware);
      await instance.register(backgroundJobsRoutes.default);
    });
    loggers.routes.info('Background jobs routes registered at /api/background-jobs/* with auth middleware and SSE support');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register background jobs routes');
  }

  // Register AI/ML Services routes (models, capabilities)
  try {
    const { aiMlServicesPlugin } = await import('./routes/ai-ml-services/index.js');
    await server.register(aiMlServicesPlugin, {
      prefix: '/api',
      providerManager: providerManager as any
    });
    loggers.routes.info('AI/ML Services routes registered at /api/models/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register AI/ML services routes');
  }

  // Proxy workflows requests to the dedicated workflows service
  // Handler function for both exact and wildcard routes
  const workflowsProxyHandler = async (request: any, reply: any) => {
    const workflowsServiceUrl = process.env.WORKFLOWS_SERVICE_URL || 'http://agenticworkflows:3002';
    const targetUrl = `${workflowsServiceUrl}${request.url}`;

    try {
      const response = await axios({
        method: request.method,
        url: targetUrl,
        headers: {
          'Authorization': request.headers.authorization,
          'Content-Type': request.headers['content-type'] || 'application/json',
          'Accept': request.headers.accept || 'application/json'
        },
        data: request.body,
        responseType: request.headers.accept?.includes('text/event-stream') ? 'stream' : 'json',
        validateStatus: () => true,
        timeout: 300000 // 5 minutes for long-running workflows
      });

      // Handle streaming responses (SSE)
      if (response.headers['content-type']?.includes('text/event-stream')) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        response.data.pipe(reply.raw);
        return reply;
      }

      // Handle regular responses
      return reply.code(response.status).send(response.data);
    } catch (error: any) {
      request.log.error({ error: error.message, url: targetUrl }, 'Workflows proxy error');
      return reply.code(500).send({
        error: 'Workflows service unavailable',
        message: error.message
      });
    }
  };

  // Register exact match for /api/workflows (list/create workflows)
  server.all('/api/workflows', {
    preHandler: authMiddleware
  }, workflowsProxyHandler);

  // Register wildcard for /api/workflows/* (specific workflow operations)
  server.all('/api/workflows/*', {
    preHandler: authMiddleware
  }, workflowsProxyHandler);

  loggers.routes.info('Workflows proxy registered at /api/workflows and /api/workflows/* -> workflows service');

  // MCP Management Services routes managed through provider manager

  // Register Monitoring WebSocket routes (for UI admin panel)
  try {
    const { monitoringWebSocketRoutes } = await import('./routes/monitoring-websocket.js');
    await server.register(monitoringWebSocketRoutes, { prefix: '/api/monitoring' });
    loggers.routes.info('Monitoring WebSocket routes registered at /api/monitoring/ws');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register monitoring WebSocket routes');
  }

  // Register proper MCP Tools API endpoint - fetches from MCP Proxy directly
  try {
    const MCP_PROXY_URL = process.env.MCP_PROXY_URL ||
                          `${process.env.MCP_PROXY_PROTOCOL || 'http'}://${process.env.MCP_PROXY_HOST || 'mcp-proxy'}:${process.env.MCP_PROXY_PORT || '3100'}`;

    // Import UserPermissionsService for MCP filtering
    const { UserPermissionsService } = await import('./services/UserPermissionsService.js');
    const userPermissionsService = new UserPermissionsService(prisma, loggers.services);

    // User permissions endpoint - returns the authenticated user's resolved permissions
    server.get('/api/user/permissions', {
      preHandler: authMiddleware
    }, async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const userGroups = user?.groups || [];
        const isAdmin = user?.isAdmin || false;

        if (!userId) {
          return reply.status(401).send({ error: 'User not authenticated' });
        }

        // Get resolved permissions for this user
        const permissions = await userPermissionsService.getUserPermissions(userId, userGroups);

        // Return permissions with admin status
        // Note: canUseAwcode is true for admins OR users with explicit permission
        return reply.send({
          ...permissions,
          isAdmin,
          // Admins always have AWCode access
          canUseAwcode: isAdmin || permissions.canUseAwcode,
          // Also include whether MCP panel should be visible (true if any MCP access)
          mcpPanelEnabled: permissions.allowedMcpServers.length === 0 || permissions.allowedMcpServers.length > 0,
        });
      } catch (error: any) {
        loggers.routes.error({ error }, 'Failed to get user permissions');
        return reply.status(500).send({
          error: 'Failed to get user permissions',
          message: error.message
        });
      }
    });

    loggers.routes.info('User Permissions API endpoint registered at /api/user/permissions');

    // Proper API endpoint for available tools (UI calls this, API fetches from MCP Proxy internally)
    server.get('/api/user/available-tools', {
      preHandler: authMiddleware
    }, async (request, reply) => {
      try {
        loggers.routes.debug('Fetching available MCP tools from MCP Proxy');

        // Get user info from auth middleware
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const userGroups = user?.groups || [];
        const isAdmin = user?.isAdmin || false;
        const isLocalAccount = user?.localAccount === true;

        // Get user permissions for MCP filtering
        let userPermissions: any = null;
        if (userId) {
          try {
            userPermissions = await userPermissionsService.getUserPermissions(userId, userGroups);
          } catch (permError) {
            loggers.routes.warn('Failed to get user permissions for MCP filtering, using defaults');
          }
        }

        // Build headers for MCP proxy request
        const headers: any = {
          'Content-Type': 'application/json'
        };

        // Only send Authorization header for Azure AD users
        // Local admin users will access MCP proxy without auth (internal network only)
        if (!isLocalAccount && user?.accessToken) {
          headers['Authorization'] = `Bearer ${user.accessToken}`;
          loggers.routes.debug('Using Azure AD token for MCP proxy auth');
        } else {
          loggers.routes.debug('Local admin user - accessing MCP proxy without token');
        }

        // Fetch MCP tools directly from MCP Proxy with no limit
        const response = await fetch(`${MCP_PROXY_URL}/v1/mcp/tools?limit=1000`, {
          method: 'GET',
          headers
        });

        if (!response.ok) {
          loggers.routes.warn(`MCP Proxy endpoint unavailable (${response.status}), returning empty tools list`);
          return reply.send({
            tools: {
              functions: [],
              toolsByServer: {}
            },
            servers: [],
            available: false
          });
        }

        const mcpData = await response.json();

        // Transform MCP Proxy response to match UI expectations
        // MCP Proxy returns tools grouped by server in different format
        const toolsByServer: Record<string, any[]> = {};
        const allFunctions: any[] = [];
        const servers: any[] = [];

        // Helper function to check if a server is admin-only
        // Dynamic check: servers with "admin" in name are admin-only
        // This avoids hardcoding specific server names
        const isAdminOnlyServer = (serverName: string): boolean => {
          const serverNameLower = serverName.toLowerCase();
          // Any server with "admin" in the name requires admin access
          return serverNameLower.includes('admin');
        };

        // Helper function to check if a server should be visible to this user
        const isServerAllowed = (serverName: string): boolean => {
          const serverNameLower = serverName.toLowerCase();

          // Admin-only servers are only visible to admins
          if (isAdminOnlyServer(serverNameLower)) {
            return isAdmin;
          }

          // If user has permissions, apply them
          if (userPermissions) {
            // Check if server is explicitly denied
            if (userPermissions.deniedMcpServers.includes(serverName) ||
                userPermissions.deniedMcpServers.includes(serverNameLower)) {
              return false;
            }

            // If allowed list is empty, allow all (except denied and admin-only)
            if (userPermissions.allowedMcpServers.length === 0) {
              return true;
            }

            // Check if in allowed list
            return userPermissions.allowedMcpServers.includes(serverName) ||
                   userPermissions.allowedMcpServers.includes(serverNameLower);
          }

          // Default: allow all non-admin servers
          return true;
        };

        // Group tools by server and create server objects
        if (mcpData.tools && Array.isArray(mcpData.tools)) {
          // Create a map of server names to tools
          const serverMap = new Map<string, any[]>();

          mcpData.tools.forEach((tool: any) => {
            const serverName = tool.server || tool.serverName || 'default';

            // Skip tools from servers the user shouldn't see
            if (!isServerAllowed(serverName)) {
              return;
            }

            if (!serverMap.has(serverName)) {
              serverMap.set(serverName, []);
            }
            serverMap.get(serverName)!.push(tool);
            allFunctions.push(tool);
          });

          // Create server objects from the map
          serverMap.forEach((tools, serverName) => {
            const serverId = serverName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            toolsByServer[serverId] = tools;
            servers.push({
              id: serverId,
              name: serverName,
              isConnected: true,
              status: 'connected',
              tools: tools,
              toolCount: tools.length
            });
          });
        }

        const transformedData = {
          tools: {
            functions: allFunctions,
            toolsByServer
          },
          servers,
          available: true,
          totalTools: allFunctions.length,
          connectedServers: servers.length
        };

        loggers.routes.info(`✅ Fetched ${allFunctions.length} tools from ${servers.length} MCP servers via MCP Proxy (filtered for user ${userId})`);
        return reply.send(transformedData);

      } catch (error) {
        loggers.routes.warn('MCP tools unavailable from MCP Proxy, returning empty list:', error.message);
        return reply.send({
          tools: {
            functions: [],
            toolsByServer: {}
          },
          servers: [],
          available: false,
          error: 'MCP services temporarily unavailable'
        });
      }
    });

    loggers.routes.info('MCP Tools API endpoint registered at /api/user/available-tools');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register MCP tools API endpoint');
  }

  // Register Memory & Vector Services routes
  try {
    const { memoryVectorPlugin } = await import('./routes/memory-vector/index.js');
    await server.register(memoryVectorPlugin, { prefix: '/api/memories' });
    loggers.routes.info('Memory & Vector Services routes registered at /api/memories/*, /api/vectors/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register memory & vector services routes');
  }

  // Register Admin Analytics routes
  try {
    const { default: adminAnalyticsRoutes } = await import('./routes/admin-analytics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAnalyticsRoutes);
    }, { prefix: '/api/admin/analytics' });
    loggers.routes.info('Admin Analytics routes registered at /api/admin/analytics/* (per-user cost & model usage) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin analytics routes');
  }

  // Register Admin Roles routes (RBAC)
  try {
    const { default: adminRolesRoutes } = await import('./routes/admin-roles.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminRolesRoutes);
    }, { prefix: '/api/admin/roles' });
    loggers.routes.info('Admin Roles routes registered at /api/admin/roles/* (RBAC) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin roles routes');
  }

  // Register Admin Messages routes
  try {
    const { default: adminMessagesRoutes } = await import('./routes/admin-messages.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMessagesRoutes);
    }, { prefix: '/api/admin/messages' });
    loggers.routes.info('Admin Messages routes registered at /api/admin/messages/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin messages routes');
  }

  // Register Admin Performance Metrics routes
  try {
    const { default: adminMetricsRoutes } = await import('./routes/admin-metrics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminMetricsRoutes);
    }, { prefix: '/api/admin/metrics' });
    loggers.routes.info('Admin Performance Metrics routes registered at /api/admin/metrics/* (Prometheus metrics, Redis, Milvus) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin metrics routes');
  }

  // Register Admin Azure AI Foundry Metrics routes
  try {
    const { default: adminAIFMetricsRoutes } = await import('./routes/admin-aif-metrics.js');
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAIFMetricsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Azure AI Foundry Metrics routes registered at /api/admin/aif-metrics/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin AIF metrics routes');
  }

  // Register Advanced Prompting Services routes
  try {
    const { advancedPromptingPlugin } = await import('./routes/advanced-prompting/index.js');
    await server.register(advancedPromptingPlugin, { prefix: '/api' });
    loggers.routes.info('Advanced Prompting Services routes registered at /api/prompts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register advanced prompting routes');
  }

  // Register File & Attachment Services routes
  try {
    const { fileAttachmentPlugin } = await import('./routes/file-attachment/index.js');
    await server.register(fileAttachmentPlugin, { prefix: '/api/files' });
    loggers.routes.info('File & Attachment Services routes registered at /api/files/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register file attachment routes');
  }

  // Register Azure Integration Services routes  
  try {
    const { azureIntegrationPlugin } = await import('./routes/azure-integration/index.js');
    await server.register(azureIntegrationPlugin, { prefix: '/api/azure' });
    loggers.routes.info('Azure Integration Services routes registered at /api/azure/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Azure integration routes');
  }

  // Register Admin Audit routes for comprehensive user activity monitoring
  try {
    const { default: adminAuditRoutes } = await import('./routes/admin-audit.js');
    await server.register(adminAuditRoutes);
    loggers.routes.info('Admin Audit routes registered at /api/admin/audit/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit routes');
  }

  // Register Admin Dashboard Metrics routes (Grafana-style time-series metrics)
  try {
    const { default: adminDashboardMetricsRoutes } = await import('./routes/admin-dashboard-metrics.js');
    await server.register(adminDashboardMetricsRoutes);
    loggers.routes.info('Admin Dashboard Metrics routes registered at /api/admin/dashboard/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin dashboard metrics routes');
  }

  // Register MCP Management routes
  try {
    const { default: mcpManagementRoutes } = await import('./routes/admin/mcp-management.js');
    await server.register(mcpManagementRoutes);
    loggers.routes.info('MCP Management routes registered at /api/admin/mcp/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register MCP management routes');
  }

  // NOTE: Old MCP proxy routes removed - replaced by:
  // 1. Unified MCP routes at /api/v1/mcp/* (see routes/v1/mcp.ts)
  // 2. 301 redirects from /mcp/* -> /api/v1/mcp/* (see bottom of this file)

  // Register Admin Prompt Techniques routes (ready to integrate)
  try {
    const { default: adminTechniqueRoutes } = await import('./routes/admin-techniques.js');
    await server.register(adminTechniqueRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Admin Prompt Techniques routes registered at /api/admin/techniques/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin technique routes');
  }

  // Register Model Capabilities routes (has service, needs integration)
  try {
    const { default: capabilityRoutes } = await import('./routes/capabilities.js');
    await server.register(capabilityRoutes, { prefix: '/api/models' });
    loggers.routes.info('Model Capabilities routes registered at /api/models/capabilities/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register model capability routes');
  }

  // Register Dynamic Model Selector routes (has service, needs integration)
  try {
    const { modelSelectorRoutes } = await import('./routes/model-selector.js');
    await server.register(modelSelectorRoutes, { prefix: '/api/models' });
    loggers.routes.info('Dynamic Model Selector routes registered at /api/models/selector/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register model selector routes');
  }

  // Image analysis removed - images are handled through chat interface
  // The model capabilities system determines which model to use for vision tasks

  // Register Artifacts routes (✅ COMPLETED - integrated with MilvusVectorService)
  try {
    const artifactsRoutes = (await import('./routes/artifacts.js')).default;
    await server.register(artifactsRoutes, { prefix: '' });
    loggers.routes.info('Artifacts routes registered at /api/artifacts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register artifacts routes');
  }

  // Register Export routes (PDF/DOCX export with artifact storage)
  try {
    const exportRoutes = (await import('./routes/export.js')).default;
    await server.register(async (instance) => {
      instance.addHook('onRequest', authMiddleware);
      await instance.register(exportRoutes);
    }, { prefix: '/api/export' });
    loggers.routes.info('Export routes registered at /api/export/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register export routes');
  }

  // Register User Settings routes (✅ COMPLETED - integrated with UserSettingsService)
  try {
    const userSettingsRoutes = (await import('./routes/user-settings.js')).default;
    await server.register(userSettingsRoutes, { prefix: '' });
    loggers.routes.info('User Settings routes registered at /api/user/settings/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user settings routes');
  }

  // Register Formatting Capabilities routes
  try {
    const { default: formattingRoutes } = await import('./routes/formatting.js');
    await server.register(formattingRoutes, { prefix: '/api/formatting' });
    loggers.routes.info('Formatting capabilities routes registered at /api/formatting/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register formatting routes');
  }

  // Register Rendering routes for Pure Frontend Architecture
  try {
    const { default: renderRoutes } = await import('./routes/render.js');
    await server.register(renderRoutes, { prefix: '/api/render' });
    loggers.routes.info('Rendering routes registered at /api/render/* (charts, diagrams, markdown, code)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register rendering routes');
  }

  // Note: metrics.js was skipped - conflicts with existing metrics system in server.ts

  // Register AgenticWorkCode routes (for sandboxed development environment)
  try {
    const codeRoutes = (await import('./routes/code.js')).default;
    const CODE_MANAGER_URL = process.env.CODE_MANAGER_URL || 'http://agenticode-manager:3050';

    // Health endpoint - NO auth required (for UI connectivity check)
    server.get('/api/code/health', async (request, reply) => {
      try {
        const response = await fetch(`${CODE_MANAGER_URL}/health`);
        if (response.ok) {
          const health = await response.json();
          return reply.send(health);
        }
        return reply.code(503).send({ status: 'unhealthy', error: 'Manager not responding' });
      } catch (error: any) {
        return reply.code(503).send({ status: 'unhealthy', error: error.message });
      }
    });

    // Access check endpoint - NO AUTH (internal MCP use)
    server.get('/api/code/access-check', async (request: any, reply: any) => {
      const userId = request.query?.userId;
      if (!userId) {
        return reply.code(400).send({ error: 'userId required', hasAccess: false });
      }
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, is_admin: true, code_enabled: true, groups: true }
        });
        if (!user) {
          return reply.send({ hasAccess: false, reason: 'user_not_found' });
        }
        // Grant access if code_enabled OR isAdmin
        const hasAccess = user.code_enabled || user.is_admin;
        loggers.routes.info({ userId, hasAccess, isAdmin: user.is_admin, codeEnabled: user.code_enabled }, 'MCP access check');
        return reply.send({ hasAccess, userId, isAdmin: user.is_admin });
      } catch (error: any) {
        return reply.code(500).send({ hasAccess: false, error: error.message });
      }
    });
    loggers.routes.info('Code access-check endpoint registered at /api/code/access-check (no auth - internal MCP use)');

    // Other code routes - with auth
    await server.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(codeRoutes, {
        providerManager: providerManager as any
      });
      // Workspace file management routes (MinIO)
      const { default: codeWorkspaceRoutes } = await import('./routes/code-workspace.js');
      await instance.register(codeWorkspaceRoutes);
      loggers.routes.info('Code workspace routes registered (MinIO file management)');

      // Code Mode provisioning routes (user environment setup)
      const { default: codeModeProvisioningRoutes } = await import('./routes/code-mode-provisioning.js');
      await instance.register(codeModeProvisioningRoutes, { prefix: '/provisioning' });
      loggers.routes.info('Code Mode provisioning routes registered at /api/code/provisioning/*');
    }, { prefix: '/api/code' });
    loggers.routes.info('AgenticWorkCode routes registered at /api/code/* with auth middleware (health endpoint unauthenticated)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code routes');
  }

  // WebSocket proxy for code manager terminal (MUST be outside the try/catch and register separately)
  // Proxies /api/code/ws/terminal to CODE_MANAGER_URL/ws/terminal
  // SECURITY: Includes internal API key for code-manager authentication
  try {
    const CODE_MANAGER_WS_URL = process.env.CODE_MANAGER_URL || 'http://agenticode-manager:3050';
    const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';
    const WebSocketModule = await import('ws');
    const WebSocket = WebSocketModule.default;

    server.get('/api/code/ws/terminal', { websocket: true } as any, async (connection: any, request: any) => {
      // Handle both @fastify/websocket v10 (connection.socket) and v11 (connection is the socket)
      const ws = connection?.socket || connection;
      const sessionId = (request.query as any)?.sessionId;
      const authToken = (request.query as any)?.token;
      loggers.routes.info({ sessionId, hasToken: !!authToken, hasSocket: !!ws, connectionType: typeof connection }, 'Code terminal WebSocket connection initiated');

      // Guard against undefined ws (can happen if connection failed during setup)
      if (!ws || typeof ws.send !== 'function') {
        loggers.routes.error({ sessionId, wsType: typeof ws }, 'Client WebSocket is undefined or invalid - connection may have failed during setup');
        return;
      }

      // SECURITY: Verify user authentication and AWCode permission
      // Token is required for WebSocket connections
      if (!authToken) {
        loggers.routes.warn({ sessionId }, 'AWCode terminal WebSocket denied - no auth token provided');
        ws.close(4001, 'Authentication required');
        return;
      }

      // Validate the token and get user info
      const tokenResult = await validateAnyToken(authToken, { logger: loggers.routes });
      if (!tokenResult.isValid || !tokenResult.user) {
        loggers.routes.warn({ sessionId, error: tokenResult.error }, 'AWCode terminal WebSocket denied - invalid token');
        ws.close(4001, 'Invalid authentication token');
        return;
      }

      // Check AWCode permission (admins always have access, others need explicit permission)
      const permissionsService = new UserPermissionsService(prisma, loggers.routes);
      const canAccess = await permissionsService.canAccessAwcode(
        tokenResult.user.userId,
        tokenResult.user.isAdmin,
        tokenResult.user.groups || []
      );

      if (!canAccess) {
        loggers.routes.warn({
          sessionId,
          userId: tokenResult.user.userId,
          email: tokenResult.user.email
        }, 'AWCode terminal WebSocket denied - user lacks permission');
        ws.close(4003, 'AWCode access denied - permission required');
        return;
      }

      loggers.routes.info({
        sessionId,
        userId: tokenResult.user.userId,
        email: tokenResult.user.email
      }, 'AWCode terminal WebSocket authorized');

      // CRITICAL FIX: Look up the sliceId from the session in database
      // The UI sends the session.id but the manager expects the sliceId (manager's session ID)
      let managerSessionId = sessionId;
      if (sessionId) {
        try {
          const session = await prisma.codeSession.findFirst({
            where: { id: sessionId, status: 'active' },
            select: { slice_id: true }
          });
          if (session?.slice_id) {
            managerSessionId = session.slice_id;
            loggers.routes.info({ sessionId, sliceId: managerSessionId }, 'Translated session ID to slice ID for manager');
          } else {
            loggers.routes.warn({ sessionId }, 'Session not found in database, using original sessionId');
          }
        } catch (dbError: any) {
          loggers.routes.error({ error: dbError.message, sessionId }, 'Failed to look up session, using original sessionId');
        }
      }

      // Connect to code manager WebSocket with the correct sliceId
      // SECURITY: Include internal API key for authentication
      const wsBaseUrl = `${CODE_MANAGER_WS_URL.replace(/^http/, 'ws')}/ws/terminal`;
      const wsParams = new URLSearchParams();
      if (managerSessionId) wsParams.set('sessionId', managerSessionId);
      if (CODE_MANAGER_INTERNAL_KEY) wsParams.set('internalKey', CODE_MANAGER_INTERNAL_KEY);
      const managerWsUrl = `${wsBaseUrl}?${wsParams.toString()}`;
      loggers.routes.info({ managerWsUrl: wsBaseUrl, sessionId, managerSessionId }, 'Connecting to code manager WebSocket');

      let managerWs: InstanceType<typeof WebSocket> | null = null;

      try {
        managerWs = new WebSocket(managerWsUrl);

        managerWs.on('open', () => {
          loggers.routes.info({ sessionId }, 'Connected to code manager WebSocket');
        });

        managerWs.on('message', (data: any) => {
          // Forward messages from code manager to client
          if (ws && ws.readyState === 1) { // WebSocket.OPEN
            ws.send(data.toString());
          }
        });

        managerWs.on('close', () => {
          loggers.routes.info({ sessionId }, 'Code manager WebSocket closed');
          if (ws && ws.readyState === 1) {
            ws.close();
          }
        });

        managerWs.on('error', (error: Error) => {
          loggers.routes.error({ error: error.message, sessionId }, 'Code manager WebSocket error');
          if (ws && ws.readyState === 1) {
            ws.close();
          }
        });

        // Forward messages from client to code manager
        ws.on('message', (message: any) => {
          if (managerWs && managerWs.readyState === 1) {
            managerWs.send(message.toString());
          }
        });

        ws.on('close', () => {
          loggers.routes.info({ sessionId }, 'Client WebSocket closed');
          if (managerWs && managerWs.readyState === 1) {
            managerWs.close();
          }
        });

        ws.on('error', (error: Error) => {
          loggers.routes.error({ error: error.message, sessionId }, 'Client WebSocket error');
          if (managerWs && managerWs.readyState === 1) {
            managerWs.close();
          }
        });

      } catch (error: any) {
        loggers.routes.error({ error: error.message, sessionId }, 'Failed to connect to code manager WebSocket');
        if (ws && ws.readyState === 1) {
          ws.close();
        }
      }
    });

    loggers.routes.info('Code terminal WebSocket proxy registered at /api/code/ws/terminal');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code terminal WebSocket proxy');
  }

  // WebSocket proxy for code manager events (for new Code Mode UI with real-time activity visualization)
  // Proxies /api/code/ws/events to CODE_MANAGER_URL/ws/events
  try {
    const CODE_MANAGER_WS_URL = process.env.CODE_MANAGER_URL || 'http://agenticode-manager:3050';
    const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';

    const WebSocketModule = await import('ws');
    const WebSocket = WebSocketModule.default;

    server.get('/api/code/ws/events', { websocket: true } as any, async (connection: any, request: any) => {
      // Handle both @fastify/websocket v10 (connection.socket) and v11 (connection is the socket)
      const ws = connection?.socket || connection;
      const userId = request.query.userId;
      const sessionId = request.query.sessionId;
      const userToken = request.query.token; // Auth token for API mode
      loggers.routes.info({ userId, sessionId, hasToken: !!userToken, hasSocket: !!ws, connectionType: typeof connection }, 'Code events WebSocket connection initiated');

      // Guard against undefined ws (can happen if connection failed during setup)
      if (!ws || typeof ws.send !== 'function') {
        loggers.routes.error({ userId, wsType: typeof ws }, 'Client WebSocket is undefined or invalid - connection may have failed during setup');
        return;
      }

      // SECURITY: Verify user authentication and AWCode permission
      // Token is required for WebSocket connections
      if (!userToken) {
        loggers.routes.warn({ userId, sessionId }, 'AWCode events WebSocket denied - no auth token provided');
        ws.close(4001, 'Authentication required');
        return;
      }

      // Validate the token and get user info
      const tokenResult = await validateAnyToken(userToken, { logger: loggers.routes });
      if (!tokenResult.isValid || !tokenResult.user) {
        loggers.routes.warn({ userId, sessionId, error: tokenResult.error }, 'AWCode events WebSocket denied - invalid token');
        ws.close(4001, 'Invalid authentication token');
        return;
      }

      // Check AWCode permission (admins always have access, others need explicit permission)
      const permissionsService = new UserPermissionsService(prisma, loggers.routes);
      const canAccess = await permissionsService.canAccessAwcode(
        tokenResult.user.userId,
        tokenResult.user.isAdmin,
        tokenResult.user.groups || []
      );

      if (!canAccess) {
        loggers.routes.warn({
          userId,
          sessionId,
          email: tokenResult.user.email
        }, 'AWCode events WebSocket denied - user lacks permission');
        ws.close(4003, 'AWCode access denied - permission required');
        return;
      }

      loggers.routes.info({
        userId: tokenResult.user.userId,
        email: tokenResult.user.email,
        sessionId
      }, 'AWCode events WebSocket authorized');

      // Connect to code manager WebSocket
      const wsBaseUrl = `${CODE_MANAGER_WS_URL.replace(/^http/, 'ws')}/ws/events`;
      const wsParams = new URLSearchParams();
      if (userId) wsParams.set('userId', userId);
      if (sessionId) wsParams.set('sessionId', sessionId);
      if (userToken) wsParams.set('token', userToken); // Forward auth token to code manager
      if (CODE_MANAGER_INTERNAL_KEY) wsParams.set('internalKey', CODE_MANAGER_INTERNAL_KEY);
      const managerWsUrl = `${wsBaseUrl}?${wsParams.toString()}`;
      loggers.routes.info({ managerWsUrl: wsBaseUrl, userId, sessionId, hasToken: !!userToken }, 'Connecting to code manager events WebSocket');

      let managerWs: InstanceType<typeof WebSocket> | null = null;

      try {
        managerWs = new WebSocket(managerWsUrl);

        managerWs.on('open', () => {
          loggers.routes.info({ userId, sessionId }, 'Connected to code manager events WebSocket');
        });

        managerWs.on('message', (data: any) => {
          // Forward events from manager to client
          if (ws && ws.readyState === 1) { // WebSocket.OPEN
            ws.send(data.toString());
          }
        });

        managerWs.on('close', () => {
          loggers.routes.info({ userId, sessionId }, 'Code manager events WebSocket closed');
          if (ws && ws.readyState === 1) {
            ws.close();
          }
        });

        managerWs.on('error', (error: Error) => {
          loggers.routes.error({ error: error.message, userId, sessionId }, 'Code manager events WebSocket error');
          if (ws && ws.readyState === 1) {
            ws.close();
          }
        });

        ws.on('message', (message: any) => {
          const msgStr = message.toString();
          loggers.routes.info({ userId, sessionId, msgPreview: msgStr.substring(0, 100) }, 'Forwarding client message to code manager');
          if (managerWs && managerWs.readyState === 1) {
            managerWs.send(msgStr);
          } else {
            loggers.routes.warn({ userId, sessionId, managerState: managerWs?.readyState }, 'Cannot forward - manager WebSocket not ready');
          }
        });

        ws.on('close', () => {
          loggers.routes.info({ userId, sessionId }, 'Client events WebSocket closed');
          if (managerWs && managerWs.readyState === 1) {
            managerWs.close();
          }
        });

        ws.on('error', (error: Error) => {
          loggers.routes.error({ error: error.message, userId, sessionId }, 'Client events WebSocket error');
          if (managerWs && managerWs.readyState === 1) {
            managerWs.close();
          }
        });

      } catch (error: any) {
        loggers.routes.error({ error: error.message, userId, sessionId }, 'Failed to connect to code manager events WebSocket');
        if (ws && ws.readyState === 1) {
          ws.close();
        }
      }
    });

    loggers.routes.info('Code events WebSocket proxy registered at /api/code/ws/events');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code events WebSocket proxy');
  }

  // Register Admin AgenticWorkCode routes (for admin management of code feature)
  try {
    const adminCodeRoutes = (await import('./routes/admin-code.js')).default;
    await server.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);  // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminCodeRoutes);
    }, { prefix: '/api/admin/code' });
    loggers.routes.info('Admin AgenticWorkCode routes registered at /api/admin/code/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin code routes');
  }

  // ============================================================================
  // API v1 Router - Standardized versioned API
  // ============================================================================
  // This is the NEW standardized API with versioning.
  // All new development should use /api/v1/* endpoints.
  // Legacy /api/* routes are kept for backward compatibility but will be deprecated.
  try {
    const { v1Router } = await import('./routes/v1/index.js');
    await server.register(v1Router, { prefix: '/api/v1' });
    loggers.routes.info('✅ API v1 router registered at /api/v1/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register API v1 router');
  }

  // ============================================================================
  // BACKWARD COMPATIBILITY REDIRECTS
  // ============================================================================
  // These redirect legacy routes to the new v1 endpoints.
  // Will be removed after 90 days (see API_ROUTING_STANDARDIZATION.md)

  // Redirect /mcp/* to /api/v1/mcp/* (replaces old proxy routes)
  server.get('/mcp/servers', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/servers');
  });

  // SDK compatibility: /api/mcp/* redirects to /api/v1/mcp/*
  server.get('/api/mcp/servers', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/servers');
  });
  server.get('/mcp/tools', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/tools');
  });
  server.get('/mcp/health', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/health');
  });
  server.get('/mcp/stats', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/stats');
  });
  server.get('/mcp/status', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/status');
  });
  loggers.routes.info('📌 Legacy /mcp/* redirects configured -> /api/v1/mcp/*');

  loggers.routes.info('✅ All application routes registered successfully');
}

// API v1 is now the standard - legacy routes redirect to v1

// Start server
const start = async () => {
  // Load and validate secrets configuration FIRST
  loggers.services.info('🔐 Loading secrets configuration...');
  try {
    const secrets = getSecrets(loggers.services);
    logSecrets(secrets, loggers.services);
    
    // Store secrets globally for other services to use
    (global as any).appSecrets = secrets;
    loggers.services.info('✅ Secrets configuration loaded and validated');
  } catch (error) {
    loggers.services.error({ err: error }, '🚨 CRITICAL: Failed to load secrets configuration');
    process.exit(1); // Cannot continue without proper secrets
  }
  
  // Initialize Vault for additional secret management
  loggers.services.info('🔐 Initializing Vault for secret rotation...');
  try {
    const { VaultInitService } = await import('./services/VaultInitService.js');
    const vaultService = new VaultInitService(loggers.services);
    await vaultService.initialize();
    // Store vault service globally for other services to use
    (global as any).vaultService = vaultService;
    loggers.services.info('✅ Vault service initialized for secret rotation');
  } catch (error) {
    loggers.services.warn({ err: error }, '⚠️ Vault initialization failed - using static secrets only');
  }

  // NOW initialize database schema after secrets are loaded
  loggers.database.info('🔄 Initializing database schema and structure...');
  try {
    const { DatabaseService } = await import('./services/DatabaseService.js');
    await DatabaseService.initialize();
    loggers.database.info('✅ Database schema initialization completed successfully');
    } catch (error) {
    loggers.database.error({ err: error }, '🚨 CRITICAL: Database schema initialization failed');
    process.exit(1); // Exit - we can't continue without the database schema
  }

  // Initialize LLM Provider Manager (needed for title generation)
  loggers.services.info('🤖 Initializing LLM Provider Manager...');
  try {
    const configService = new ProviderConfigService(loggers.services);
    const config = await configService.loadProviderConfig();
    providerManager = new ProviderManager(loggers.services, config);
    await providerManager.initialize();

    // Set global reference for route handlers (v1/models, flowise, etc.)
    (global as any).providerManager = providerManager;

    loggers.services.info('✅ LLM Provider Manager initialized successfully');

    // Initialize Model Capability Registry for dynamic model pricing and capabilities
    // CRITICAL: This is needed for LLMMetricsService to calculate costs properly
    loggers.services.info('📊 Initializing Model Capability Registry for pricing and capabilities...');
    try {
      const modelCapabilityRegistry = new ModelCapabilityRegistry(loggers.services, prisma);
      await modelCapabilityRegistry.initialize();
      setModelCapabilityRegistry(modelCapabilityRegistry);

      const allModels = modelCapabilityRegistry.getAllModels();
      loggers.services.info({
        cachedModels: allModels.length,
        modelsWithPricing: allModels.filter(m => m.inputCostPer1k !== undefined).length
      }, '✅ Model Capability Registry initialized - costs will be tracked accurately');
    } catch (registryError) {
      loggers.services.warn({ err: registryError }, '⚠️ Model Capability Registry initialization failed - using fallback pricing');
    }

    // Initialize model health check with providerManager
    modelHealthCheck = new ModelHealthCheckService(loggers.services, providerManager);
    loggers.services.info('✅ Model Health Check Service initialized with ProviderManager');

    // Initialize Smart Model Router for intelligent model selection
    // Routes simple queries to Ollama (FREE), complex/tool queries to Vertex AI
    try {
      smartModelRouter = new SmartModelRouter(loggers.services, {
        providerManager
      });
      await smartModelRouter.initialize();
      setSmartModelRouter(smartModelRouter);

      const models = smartModelRouter.getAllModels();
      loggers.services.info({
        modelCount: models.length,
        models: models.map(m => ({
          id: m.modelId,
          provider: m.provider,
          cost: `$${m.cost.inputPer1kTokens}/1k tokens`,
          functionCalling: m.capabilities.functionCalling ? `${(m.capabilities.functionCallingAccuracy * 100).toFixed(0)}%` : 'N/A'
        }))
      }, '✅ Smart Model Router initialized - Ollama preferred for simple queries (FREE)');
    } catch (routerError) {
      loggers.services.warn({ err: routerError }, '⚠️ Smart Model Router initialization failed - using default model selection');
    }
  } catch (error) {
    loggers.services.warn({ err: error }, '⚠️ LLM Provider Manager initialization failed - title generation will be disabled');
  }

  // Initialize Tool Semantic Cache for MCP tool indexing and semantic search
  // IMPORTANT: Must be initialized AFTER ProviderManager to ensure embeddings work
  // NOTE: Made non-critical for open source version - semantic search is optional
  const enableToolSemanticCache = process.env.ENABLE_TOOL_SEMANTIC_CACHE !== 'false' &&
                                   process.env.EMBEDDING_ENABLED !== 'false';

  if (enableToolSemanticCache) {
    loggers.services.info('🔄 Initializing Tool Semantic Cache for MCP tools...');
    try {
      toolSemanticCache = new ToolSemanticCacheService(providerManager);
      await toolSemanticCache.initialize();
      toolSemanticCacheInitialized = true;
      loggers.services.info('✅ Tool Semantic Cache initialized successfully');

      // Auto-index MCP tools during startup
      loggers.services.info('🔄 Auto-indexing MCP tools...');

      // Wait for MCP Proxy to be ready (5 second delay)
      await new Promise(resolve => setTimeout(resolve, 5000));

      try {
        await toolSemanticCache.autoIndexToolsWhenReady();
        loggers.services.info('✅ MCP tool indexing completed - semantic search operational');
      } catch (error) {
        loggers.services.warn({ error: error.message }, '⚠️ MCP tool indexing failed - falling back to basic tool selection');
        // Non-critical in open source version
      }
    } catch (error) {
      loggers.services.warn({ error: error.message }, '⚠️ Tool Semantic Cache initialization failed - semantic search disabled');
      // Non-critical in open source version - continue without semantic search
    }
  } else {
    loggers.services.info('ℹ️ Tool Semantic Cache disabled (ENABLE_TOOL_SEMANTIC_CACHE=false or EMBEDDING_ENABLED=false)');
  }

  // Initialize Tool Success Tracking Service for semantic learning from past tool executions
  loggers.services.info('🔄 Initializing Tool Success Tracking Service...');
  try {
    const toolSuccessTracker = getToolSuccessTrackingService();
    await toolSuccessTracker.initialize();
    loggers.services.info('✅ Tool Success Tracking Service initialized - semantic learning enabled');
  } catch (error) {
    loggers.services.warn({ error: error.message }, '⚠️ Tool Success Tracking initialization failed (non-critical)');
    // Non-critical - continue without success tracking
  }

  // Initialize Intent Linking Service for cross-collection tool/prompt routing
  loggers.services.info('🔄 Initializing Intent Linking Service...');
  try {
    const intentLinking = getIntentLinkingService();
    await intentLinking.initialize();
    loggers.services.info('✅ Intent Linking Service initialized - cross-collection routing enabled');
  } catch (error) {
    loggers.services.warn({ error: error.message }, '⚠️ Intent Linking initialization failed (non-critical)');
    // Non-critical - continue without intent linking
  }

  // Initialize chat storage service (migrated to Prisma)
  chatStorage = new ChatStorageService(
    {
      // Prisma uses DATABASE_URL env var, maxConnections still supported for compatibility
      maxConnections: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '10'),
      providerManager: providerManager || undefined  // Pass provider manager
    },
    loggers.storage
  );

  // Now initialize chat storage after schema exists
  loggers.database.info('Initializing PostgreSQL chat storage...');
  try {
    await chatStorage.initialize();
    loggers.database.info('PostgreSQL chat storage initialized successfully');
    
    // Start periodic metrics updates (using Prisma)
    startMetricsUpdates();
    loggers.server.info('Started periodic metrics updates');
    } catch (error) {
    loggers.database.error({ 
      err: error,
      databaseUrl: process.env.POSTGRES_URL ? '[SET]' : '[NOT SET]',
      host: process.env.POSTGRES_HOST || 'postgres',
      port: process.env.POSTGRES_PORT || '5432',
      database: process.env.POSTGRES_DB || 'agenticworkchat'
    }, 'Failed to initialize PostgreSQL chat storage - this is a critical error');
    process.exit(1); // Exit with error - database is required
  }

  // Log configuration
  loggers.server.info({
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_ENDPOINT || 'Not configured',
    azureOpenAIDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'Not configured',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
  }, 'API Key Authentication Configuration');
  
  // Check model health during startup
  console.log('\n' + '='.repeat(80));
  console.log('🤖 BOT_HEALTHCHECK: ASSISTANT RESPONSE TEST');
  console.log('='.repeat(80));
  
  loggers.services.info('Checking Azure OpenAI Model Health...');
  try {
    const healthResult = await modelHealthCheck.checkModelHealth();
    if (healthResult.healthy) {
      console.log(`✅ Model: ${healthResult.model}`);
      console.log(`⏱️  Response Time: ${healthResult.responseTime}ms`);
      console.log(`🆔 Test UUID: ${healthResult.testUuid}`);
      console.log('\n📝 POEM RESPONSE:');
      console.log('-'.repeat(40));
      console.log(healthResult.response);
      console.log('-'.repeat(40));
      console.log('✨ BOT_HEALTHCHECK PASSED - Assistant is creative and responsive!\n');
      console.log('='.repeat(80) + '\n');
      
      loggers.services.info({
        model: healthResult.model,
        responseTime: healthResult.responseTime,
        testResponse: healthResult.response
      }, 'Model health check passed');
    } else {
      console.log(`❌ BOT_HEALTHCHECK FAILED: ${healthResult.error}`);
      console.log('='.repeat(80) + '\n');
      loggers.services.warn({ error: healthResult.error }, 'Model health check failed');
    }
  } catch (error) {
    console.log(`❌ BOT_HEALTHCHECK ERROR: ${error}`);
    console.log('='.repeat(80) + '\n');
    loggers.services.error({ err: error }, 'Model health check error');
  }
  
  // Check prompt templates in database
  console.log('\n' + '='.repeat(80));
  console.log('📝 PROMPT_HEALTHCHECK: DATABASE PROMPT VERIFICATION');
  console.log('='.repeat(80));
  
  try {
    loggers.services.info('Retrieving all system prompts from database...');
    
    // Get all system prompts from the database
    const systemPrompts = await prisma.systemPrompt.findMany({
      where: { is_active: true },
      orderBy: { created_at: 'asc' }
    });
    
    // Get all prompt templates from the database  
    const promptTemplates = await prisma.promptTemplate.findMany({
      where: { is_active: true },
      orderBy: { is_default: 'desc' }
    });
    
    console.log(`📊 Found ${systemPrompts.length} system prompts and ${promptTemplates.length} prompt templates in database`);
    console.log('\n🔍 SYSTEM PROMPTS FROM DATABASE:');
    console.log('-'.repeat(80));
    
    if (systemPrompts.length === 0) {
      console.log('❌ NO SYSTEM PROMPTS FOUND IN DATABASE!');
    } else {
      systemPrompts.forEach((prompt, index) => {
        console.log(`  ${index + 1}. [${prompt.id}] ${prompt.name} (Default: ${prompt.is_default}, Active: ${prompt.is_active})`);
      });
    }
    
    console.log('\n🎯 PROMPT TEMPLATES FROM DATABASE:');
    console.log('-'.repeat(80));
    
    if (promptTemplates.length === 0) {
      console.log('❌ NO PROMPT TEMPLATES FOUND IN DATABASE!');
    } else {
      promptTemplates.forEach((template, index) => {
        console.log(`  ${index + 1}. [${template.id}] ${template.name} (Category: ${template.category || 'N/A'}, Default: ${template.is_default}, Active: ${template.is_active})`);
      });
    }
    
    // Summary
    const defaultSystemPrompt = systemPrompts.find(p => p.is_default);
    const defaultTemplate = promptTemplates.find(t => t.is_default);
    
    console.log('\n📋 PROMPT HEALTH SUMMARY:');
    console.log('-'.repeat(40));
    console.log(`✅ System Prompts: ${systemPrompts.length} found`);
    console.log(`✅ Prompt Templates: ${promptTemplates.length} found`);
    console.log(`${defaultSystemPrompt ? '✅' : '❌'} Default System Prompt: ${defaultSystemPrompt ? defaultSystemPrompt.name : 'MISSING'}`);
    console.log(`${defaultTemplate ? '✅' : '❌'} Default Template: ${defaultTemplate ? defaultTemplate.name : 'MISSING'}`);
    console.log('✨ PROMPT_HEALTHCHECK COMPLETED - Database content verified!\n');
    console.log('='.repeat(80) + '\n');
    
    loggers.services.info({
      systemPromptsCount: systemPrompts.length,
      promptTemplatesCount: promptTemplates.length,
      hasDefaultSystemPrompt: !!defaultSystemPrompt,
      hasDefaultTemplate: !!defaultTemplate
    }, 'Prompt healthcheck completed successfully');
    
    } catch (error) {
    console.log(`❌ PROMPT_HEALTHCHECK ERROR: ${error}`);
    console.log('='.repeat(80) + '\n');
    loggers.services.error({ err: error }, 'Prompt healthcheck failed');
  }

  // Database initialization is handled by entrypoint script
  loggers.server.info('Database initialization handled by entrypoint script');

  // CRITICAL FIX: Initialize all system services FIRST (including Redis and Milvus)
  // Routes depend on these services being initialized
  try {
    loggers.services.info('🔄 Initializing all system services (Redis, Milvus, etc.)...');
    await initializeServices();
    loggers.services.info('✅ All system services initialized successfully');
  } catch (err) {
    loggers.services.error({ err }, 'Service initialization failed - server cannot start');
    process.exit(1); // Exit if services can't initialize
  }

  // Register all routes AFTER services are initialized
  // Routes can now access initialized milvusClient and redisClient
  try {
    loggers.routes.info('🔄 Registering all routes with initialized services...');
    await registerAllRoutes();
    loggers.routes.info('✅ All routes registered successfully');
  } catch (err) {
    loggers.routes.error({ err }, 'Route registration failed - server cannot start');
    process.exit(1); // Exit if routes can't register
  }

  // CRITICAL: Validate admin portal SOT configuration BEFORE starting server
  try {
    loggers.services.info('🔍 Validating admin portal SOT configuration...');
    await validateAdminPortalConfiguration();
    loggers.services.info('✅ Admin portal SOT validation passed');
  } catch (err) {
    loggers.services.error({ err }, '❌ Admin portal SOT validation failed - server cannot start');
    loggers.services.error('SOLUTION: Initialize admin portal with proper prompt templates using initialization services');
    process.exit(1); // Exit if admin portal is not properly configured
  }

  try {
    const port = parseInt(process.env.PORT || process.env.API_PORT || '8000');
    await server.listen({ port, host: '0.0.0.0' });

    // Generate OpenAPI spec AFTER server is listening (server.ready() is called by listen)
    await generateOpenAPISpec();

    logServiceStartup(logger, port);
    loggers.server.info({
      endpoints: [
        `http://localhost:${port}/health`,
        `http://localhost:${port}/api/chat/*`,
        `http://localhost:${port}/settings`,
        `http://localhost:${port}/api/auth/local/*`
      ],
      authentication: 'API Key only',
      initializationComplete: true,
      authenticationSeeded: true
    }, '🤔 AgenticWorkChat API started successfully - all seeding complete, ready to think!');
  } catch (err) {
    loggers.server.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

start();

// Graceful shutdown
const gracefulShutdown = async () => {
  logServiceShutdown(logger, 'Graceful shutdown initiated');

  // Stop JobCompletionWatcher
  if (jobCompletionWatcher) {
    try {
      jobCompletionWatcher.stop();
      loggers.services.info('✅ JobCompletionWatcher stopped gracefully');
    } catch (error) {
      loggers.services.warn({ error }, '⚠️ Error stopping JobCompletionWatcher');
    }
  }

  // Shutdown Enhanced Vector Management Service
  if (enhancedVectorManagement) {
    try {
      await enhancedVectorManagement.shutdown();
      loggers.services.info('✅ Enhanced Vector Management Service shut down gracefully');
    } catch (error) {
      loggers.services.warn({ error }, '⚠️ Error during vector management service shutdown');
    }
  }

  await server.close();
  process.exit(0);
};

// These are already handled in logger.ts setupGlobalErrorHandlers
// but we need the graceful shutdown logic for server.close()
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
