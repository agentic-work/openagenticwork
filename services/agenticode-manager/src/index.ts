/**
 * AgenticWorkCode Manager Service
 * Handles per-user PTY-based AWCode CLI sessions
 *
 * This service provides:
 * - Real PTY terminal sessions with xterm.js support
 * - WebSocket for direct terminal I/O (like SSH)
 * - REST API for session management
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { config } from './config';
import { SessionManager } from './sessionManager';
import { initializeStorage } from './storageClient';
import { AgenticodeEventEmitter, AgenticodeStreamEvent } from './eventEmitter';
import { metricsService, SystemMetrics } from './metricsService';
import { workspaceSyncService, FileChangeEvent } from './workspaceSyncService';
import { getCodeServerService, CodeServerInstance } from './codeServerService';

const execAsync = promisify(exec);

// Get versions from bundled packages
function getPackageVersions(): { cliVersion: string; sdkVersion: string } {
  let cliVersion = 'unknown';
  let sdkVersion = 'unknown';

  try {
    // CLI package.json is at /app/agenticode/package.json in container
    const cliPackagePath = join('/app', 'agenticode', 'package.json');
    if (existsSync(cliPackagePath)) {
      const cliPkg = JSON.parse(readFileSync(cliPackagePath, 'utf-8'));
      cliVersion = cliPkg.version || 'unknown';
    }
  } catch (err) {
    console.warn('Could not read CLI package.json:', err);
  }

  try {
    // SDK package.json is in CLI's node_modules
    const sdkPackagePath = join('/app', 'agenticode', 'node_modules', '@agentic-work', 'sdk', 'package.json');
    if (existsSync(sdkPackagePath)) {
      const sdkPkg = JSON.parse(readFileSync(sdkPackagePath, 'utf-8'));
      sdkVersion = sdkPkg.version || 'unknown';
    }
  } catch (err) {
    console.warn('Could not read SDK package.json:', err);
  }

  return { cliVersion, sdkVersion };
}

const { cliVersion, sdkVersion } = getPackageVersions();

const app = express();
const server = createServer(app);

// WebSocket servers with noServer mode - we handle upgrade manually to support multiple paths
const wss = new WebSocketServer({ noServer: true });
const wssEvents = new WebSocketServer({ noServer: true });
const wssMetrics = new WebSocketServer({ noServer: true });

// Track metrics WebSocket clients
const metricsClients: Set<WebSocket> = new Set();

// Handle HTTP upgrade manually to route to correct WebSocket server
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

  if (pathname === '/ws/terminal') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/events') {
    wssEvents.handleUpgrade(request, socket, head, (ws) => {
      wssEvents.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/metrics') {
    wssMetrics.handleUpgrade(request, socket, head, (ws) => {
      wssMetrics.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Track event emitters and WebSocket clients per session
const sessionEventEmitters: Map<string, AgenticodeEventEmitter> = new Map();
const sessionEventClients: Map<string, Set<WebSocket>> = new Map();
// Track which sessions were created with API mode (vs Ollama mode)
const apiModeSessions: Set<string> = new Set();

const sessionManager = new SessionManager(config);

app.use(express.json());

// ===========================================
// SECURITY: Internal API Key Authentication
// ===========================================
// Only the AgenticWork API can access this service.
// All requests must include the internal API key.
// Health endpoint is exempt for load balancer health checks.

const validateInternalAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Health endpoint is always accessible (for load balancers/k8s probes)
  if (req.path === '/health') {
    return next();
  }

  // If no internal key configured, allow all (dev mode warning)
  if (!config.internalApiKey) {
    console.warn('[SECURITY] No INTERNAL_API_KEY configured - running in INSECURE mode');
    return next();
  }

  // Check for internal API key in headers
  const authHeader = req.headers['authorization'];
  const internalKeyHeader = req.headers['x-internal-api-key'];

  let providedKey: string | undefined;

  if (internalKeyHeader) {
    providedKey = Array.isArray(internalKeyHeader) ? internalKeyHeader[0] : internalKeyHeader;
  } else if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (authHeader?.startsWith('Internal ')) {
    providedKey = authHeader.slice(9);
  }

  if (!providedKey || providedKey !== config.internalApiKey) {
    console.warn(`[SECURITY] Unauthorized request to ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized - internal API key required' });
  }

  next();
};

// Apply authentication middleware to all routes
app.use(validateInternalAuth);

// Health check with full config for Admin Portal
app.get('/health', (req, res) => {
  // Build storage display info based on provider type
  const storageProvider = config.storage.provider;
  let storageDisplay = 'Unknown Storage';

  switch (storageProvider) {
    case 'minio':
      storageDisplay = `MinIO - ${config.storage.bucket}`;
      break;
    case 's3':
      storageDisplay = `AWS S3 - ${config.storage.bucket}`;
      break;
    case 'azure':
      // Azure uses container name from bucket field
      const accountName = process.env.AZURE_STORAGE_ACCOUNT || 'unknown';
      storageDisplay = `Azure Storage - ${accountName}/${config.storage.bucket}`;
      break;
    case 'gcs':
      const projectId = process.env.GCP_PROJECT_ID || 'unknown';
      storageDisplay = `GCS - ${projectId}/${config.storage.bucket}`;
      break;
    default:
      storageDisplay = `${storageProvider} - ${config.storage.bucket}`;
  }

  res.json({
    status: 'healthy',
    activeSessions: sessionManager.getActiveCount(),
    versions: {
      cli: cliVersion,
      sdk: sdkVersion,
    },
    config: {
      defaultModel: config.defaultModel,
      defaultUi: config.defaultUi,
      sessionIdleTimeout: config.sessionIdleTimeout,
      sessionMaxLifetime: config.sessionMaxLifetime,
      maxSessionsPerUser: config.maxSessionsPerUser,
      workspacesPath: config.workspacesPath,
      ollamaHost: config.ollamaHost,
    },
    storage: {
      provider: storageProvider,
      bucket: config.storage.bucket,
      endpoint: config.storage.endpoint,
      display: storageDisplay,
    },
  });
});

// Create session for user
app.post('/sessions', async (req, res) => {
  try {
    const { userId, workspacePath, model, apiKey, storageLimitMb } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // Check if user already has an active session
    const existing = sessionManager.getSessionsByUser(userId)
      .filter(s => s.status === 'running');

    if (existing.length > 0) {
      return res.json({
        sessionId: existing[0].id,
        status: 'existing',
        session: existing[0],
      });
    }

    // Create session with optional API key and storage limit from admin settings
    const session = await sessionManager.createSession(userId, workspacePath, model, apiKey, storageLimitMb);
    res.json({
      sessionId: session.id,
      status: 'created',
      session,
    });
  } catch (error) {
    console.error('Failed to create session:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Get session status
app.get('/sessions/:sessionId', async (req, res) => {
  try {
    const status = sessionManager.getSessionStatus(req.params.sessionId);
    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// List user sessions
app.get('/users/:userId/sessions', async (req, res) => {
  try {
    const sessions = sessionManager.getSessionsByUser(req.params.userId);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// List ALL sessions (admin endpoint for monitoring)
app.get('/sessions', async (req, res) => {
  try {
    // Check if metrics are requested
    const withMetrics = req.query.metrics === 'true';
    if (withMetrics) {
      const sessions = await sessionManager.getAllSessionsWithMetrics();
      res.json(sessions);
    } else {
      const sessions = sessionManager.getAllSessionsWithOutput();
      res.json(sessions);
    }
  } catch (error) {
    console.error('Failed to list all sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Stats endpoint for admin dashboard metrics
app.get('/stats', async (req, res) => {
  try {
    const sessions = sessionManager.getAllSessions();
    const activeSessions = sessions.filter(s => s.status === 'running');

    // Count WebSocket connections
    let totalEventClients = 0;
    let totalTerminalClients = 0;
    sessionEventClients.forEach((clients) => {
      totalEventClients += clients.size;
    });
    // Terminal clients tracked by wss.clients
    totalTerminalClients = wss.clients.size;

    // Count activity states across sessions
    const activityCounts: Record<string, number> = {
      idle: 0,
      thinking: 0,
      writing: 0,
      editing: 0,
      executing: 0,
      artifacts: 0,
      error: 0,
    };

    // Get activity states from event emitters
    sessionEventEmitters.forEach((emitter) => {
      const state = emitter.getState();
      if (state && activityCounts[state] !== undefined) {
        activityCounts[state]++;
      } else {
        activityCounts.idle++;
      }
    });

    // Also count sessions not yet in event emitters as idle
    const emitterSessionIds = new Set(sessionEventEmitters.keys());
    activeSessions.forEach(s => {
      if (!emitterSessionIds.has(s.id)) {
        activityCounts.idle++;
      }
    });

    res.json({
      sessions: {
        total: sessions.length,
        active: activeSessions.length,
        stopped: sessions.filter(s => s.status === 'stopped').length,
        error: sessions.filter(s => s.status === 'error').length,
      },
      websockets: {
        eventClients: totalEventClients,
        terminalClients: totalTerminalClients,
        totalClients: totalEventClients + totalTerminalClients,
      },
      codeMode: {
        thinking: activityCounts.thinking,
        writing: activityCounts.writing,
        editing: activityCounts.editing,
        executing: activityCounts.executing,
        artifacts: activityCounts.artifacts,
        idle: activityCounts.idle,
        error: activityCounts.error,
      },
      runtime: {
        status: 'healthy',
        versions: {
          cli: cliVersion,
          sdk: sdkVersion,
        },
      },
    });
  } catch (error) {
    console.error('Failed to get stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get process metrics for a specific session
app.get('/sessions/:sessionId/metrics', async (req, res) => {
  try {
    const metrics = await sessionManager.getProcessMetrics(req.params.sessionId);
    if (!metrics) {
      return res.status(404).json({ error: 'Session not found or process exited' });
    }
    res.json(metrics);
  } catch (error) {
    console.error('Failed to get session metrics:', error);
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Get ENHANCED metrics for a specific session (includes network I/O, disk I/O, tokens, storage)
app.get('/sessions/:sessionId/metrics/enhanced', async (req, res) => {
  try {
    const metrics = await sessionManager.getEnhancedMetrics(req.params.sessionId);
    if (!metrics) {
      return res.status(404).json({ error: 'Session not found or process exited' });
    }
    res.json(metrics);
  } catch (error) {
    console.error('Failed to get enhanced session metrics:', error);
    res.status(500).json({ error: 'Failed to get enhanced metrics' });
  }
});

// Get ALL sessions with ENHANCED metrics (admin dashboard endpoint)
app.get('/sessions/all/metrics/enhanced', async (req, res) => {
  try {
    const sessions = await sessionManager.getAllSessionsWithEnhancedMetrics();
    res.json({ sessions });
  } catch (error) {
    console.error('Failed to get all sessions with enhanced metrics:', error);
    res.status(500).json({ error: 'Failed to get enhanced metrics' });
  }
});

// Get system-wide aggregated metrics
app.get('/metrics/system', async (req, res) => {
  try {
    const sessions = sessionManager.getAllSessions().map(s => ({
      id: s.id,
      userId: s.userId,
      pid: s.pid,
      workspacePath: s.workspacePath,
    }));

    const systemMetrics = await metricsService.getSystemMetrics(sessions);
    res.json(systemMetrics);
  } catch (error) {
    console.error('Failed to get system metrics:', error);
    res.status(500).json({ error: 'Failed to get system metrics' });
  }
});

// Record token usage for a session (called by event emitter when parsing NDJSON)
app.post('/sessions/:sessionId/tokens', async (req, res) => {
  try {
    const { inputTokens, outputTokens, model } = req.body;
    sessionManager.recordTokenUsage(
      req.params.sessionId,
      inputTokens || 0,
      outputTokens || 0,
      model
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to record token usage:', error);
    res.status(500).json({ error: 'Failed to record tokens' });
  }
});

// ========================================
// Workspace Sync Endpoints
// ========================================

// Get sync status for all sessions
app.get('/workspace/sync/status', async (req, res) => {
  try {
    const status = workspaceSyncService.getSyncStatus();
    const result: Record<string, any> = {};
    for (const [sessionId, s] of status) {
      result[sessionId] = s;
    }
    res.json({ syncing: result, totalWatchers: status.size });
  } catch (error) {
    console.error('Failed to get sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// Trigger full sync for a session
app.post('/sessions/:sessionId/sync', async (req, res) => {
  try {
    const session = sessionManager.getSessionStatus(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.workspacePath || !session.userId) {
      return res.status(400).json({ error: 'Session missing required data (userId or workspacePath)' });
    }

    const result = await workspaceSyncService.fullSync(
      session.id,
      session.userId,
      session.workspacePath
    );

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to trigger sync:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

// Restart session (stop and start with same config)
app.post('/sessions/:sessionId/restart', async (req, res) => {
  try {
    const newSession = await sessionManager.restartSession(req.params.sessionId);
    res.json({
      status: 'restarted',
      oldSessionId: req.params.sessionId,
      newSession,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Send message to session (REST API - legacy, non-streaming)
app.post('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    const response = await sessionManager.sendMessage(req.params.sessionId, message);
    res.json({ response });
  } catch (error) {
    console.error('Message failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Stop session
app.delete('/sessions/:sessionId', async (req, res) => {
  try {
    await sessionManager.stopSession(req.params.sessionId);
    // Also stop code-server if running
    const codeServerService = getCodeServerService();
    await codeServerService.stopInstance(req.params.sessionId).catch(() => {});
    res.json({ status: 'stopped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ========================================
// Code Server (VS Code Web IDE) API
// ========================================

// Start/get code-server URL for a session
app.post('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const codeServerService = getCodeServerService();
    // Get sandbox username so code-server runs as the correct user (not root)
    const sandboxUsername = sessionManager.getSandboxUsername(sessionId);
    const instance = await codeServerService.startInstance(
      session.userId,
      sessionId,
      session.workspacePath || `/workspaces/${session.userId}/${sessionId}`,
      sandboxUsername
    );

    res.json({
      status: 'available',
      url: instance.url,
      workspacePath: instance.workspacePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[CodeServer] Failed to get URL for session ${req.params.sessionId}:`, message);
    res.status(500).json({ error: message });
  }
});

// Get code-server status for a session
app.get('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId);
    const codeServerService = getCodeServerService();

    // Check if code-server container is healthy
    const isHealthy = await codeServerService.checkHealth();

    if (!session) {
      return res.json({ status: 'no_session', url: null, healthy: isHealthy });
    }

    // Get or create instance URL
    let instance = codeServerService.getInstance(sessionId);
    if (!instance) {
      // Get sandbox username so code-server runs as the correct user (not root)
      const sandboxUsername = sessionManager.getSandboxUsername(sessionId);
      instance = await codeServerService.startInstance(
        session.userId,
        sessionId,
        session.workspacePath || `/workspaces/${session.userId}/${sessionId}`,
        sandboxUsername
      );
    }

    res.json({
      status: instance.status,
      url: instance.url,
      workspacePath: instance.workspacePath,
      healthy: isHealthy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Stop code-server for a session
app.delete('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const codeServerService = getCodeServerService();
    await codeServerService.stopInstance(sessionId);
    res.json({ status: 'stopped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Get all code-server instances (admin)
app.get('/code-servers', async (req, res) => {
  try {
    const codeServerService = getCodeServerService();
    const instances = codeServerService.getAllInstances();
    const isHealthy = await codeServerService.checkHealth();
    res.json({
      count: instances.length,
      healthy: isHealthy,
      instances: instances.map(i => ({
        sessionId: i.sessionId,
        userId: i.userId,
        status: i.status,
        url: i.url,
        workspacePath: i.workspacePath,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ========================================
// /slices API - Compatibility with AgenticCodeService
// ========================================

app.post('/slices', async (req, res) => {
  try {
    const { userId, model } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const existing = sessionManager.getSessionsByUser(userId)
      .filter(s => s.status === 'running');

    if (existing.length > 0) {
      return res.json({
        sliceId: existing[0].id,
        workspacePath: existing[0].workspacePath || `/workspaces/${userId}`,
        status: 'existing',
      });
    }

    const session = await sessionManager.createSession(userId, undefined, model);
    res.json({
      sliceId: session.id,
      workspacePath: session.workspacePath || `/workspaces/${userId}`,
      status: 'created',
    });
  } catch (error) {
    console.error('Failed to create slice:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post('/slices/:sliceId/exec', async (req, res) => {
  try {
    const { command, workDir, timeout } = req.body;
    const { sliceId } = req.params;

    if (!command) {
      return res.status(400).json({ error: 'command required' });
    }

    const response = await sessionManager.sendMessage(sliceId, command);

    res.json({
      stdout: response,
      stderr: '',
      exitCode: 0,
    });
  } catch (error) {
    console.error('Exec failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    res.json({
      stdout: '',
      stderr: message,
      exitCode: 1,
    });
  }
});

app.delete('/slices/:sliceId', async (req, res) => {
  try {
    await sessionManager.stopSession(req.params.sliceId);
    res.json({ status: 'deleted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ========================================
// WebSocket Terminal Handler
// Real PTY I/O for xterm.js frontend
// ========================================

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  const token = url.searchParams.get('token');
  const internalKey = url.searchParams.get('internalKey');

  // SECURITY: Validate internal API key for WebSocket connections
  if (config.internalApiKey) {
    if (!internalKey || internalKey !== config.internalApiKey) {
      console.warn(`[SECURITY] Unauthorized WebSocket connection attempt from ${req.socket.remoteAddress}`);
      ws.close(4000, 'Unauthorized - internal API key required');
      return;
    }
  }

  if (!sessionId) {
    ws.close(4001, 'Missing sessionId');
    return;
  }

  // Get session and PTY
  const session = sessionManager.getSessionStatus(sessionId);
  if (!session || session.status !== 'running') {
    ws.close(4002, 'Session not found or not running');
    return;
  }

  const pty = sessionManager.getPty(sessionId);
  if (!pty) {
    ws.close(4003, 'PTY not available');
    return;
  }

  console.log(`WebSocket terminal connected to session ${sessionId}`);

  // Forward PTY output to WebSocket
  const dataDisposable = pty.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Forward WebSocket input to PTY
  ws.on('message', (data: Buffer | string) => {
    try {
      const message = data.toString();

      // Check if it's a control message (JSON)
      if (message.startsWith('{')) {
        try {
          const control = JSON.parse(message);
          if (control.type === 'resize' && control.cols && control.rows) {
            sessionManager.resize(sessionId, control.cols, control.rows);
            return;
          }
        } catch {
          // Not JSON, send as input
        }
      }

      // Send raw input to PTY
      sessionManager.write(sessionId, message);
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    console.log(`WebSocket terminal disconnected from session ${sessionId}`);
    dataDisposable.dispose();
  });

  // Handle WebSocket error
  ws.on('error', (error) => {
    console.error(`WebSocket error for session ${sessionId}:`, error);
    dataDisposable.dispose();
  });
});

// ========================================
// WebSocket Structured Events Handler
// For new Code Mode UI with real-time activity visualization
// ========================================

wssEvents.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId');
  const requestedSessionId = url.searchParams.get('sessionId');
  const internalKey = url.searchParams.get('internalKey');
  // Auth token for API mode - CLI will use this to call platform LLM providers
  const userToken = url.searchParams.get('token');

  // SECURITY: Validate authentication for WebSocket connections
  // Accept either internal API key (service-to-service) OR user token (UI connections)
  const hasValidInternalKey = config.internalApiKey && internalKey === config.internalApiKey;
  const hasUserToken = !!userToken && userToken.length > 0;

  if (config.internalApiKey && !hasValidInternalKey && !hasUserToken) {
    console.warn(`[SECURITY] Unauthorized event WebSocket connection attempt from ${req.socket.remoteAddress}`);
    ws.close(4000, 'Unauthorized - internal API key or user token required');
    return;
  }

  if (hasUserToken && !hasValidInternalKey) {
    console.log(`[Events] User token authentication from ${req.socket.remoteAddress} for user ${userId}`);
  }

  if (!userId) {
    ws.close(4001, 'Missing userId');
    return;
  }

  console.log(`[Events] WebSocket connected for user ${userId}${userToken ? ' (API mode - token provided)' : ' (Ollama mode - no token)'}`);

  // Find or create session
  let sessionId = requestedSessionId;
  let session = sessionId ? sessionManager.getSessionStatus(sessionId) : null;
  const wantApiMode = !!userToken;

  // If no session, find existing or create new
  if (!session) {
    const userSessions = sessionManager.getSessionsByUser(userId);
    const runningSession = userSessions.find(s => s.status === 'running');

    if (runningSession) {
      // Check if the running session matches the requested mode (API vs Ollama)
      // Don't reuse Ollama sessions when API mode is requested and vice versa
      const sessionHasApiMode = apiModeSessions.has(runningSession.id);
      if (sessionHasApiMode === wantApiMode) {
        session = sessionManager.getSessionStatus(runningSession.id);
        sessionId = runningSession.id;
        console.log(`[Events] Reusing existing ${wantApiMode ? 'API' : 'Ollama'} mode session: ${sessionId}`);
      } else {
        console.log(`[Events] Mode mismatch: existing session is ${sessionHasApiMode ? 'API' : 'Ollama'} mode, requested ${wantApiMode ? 'API' : 'Ollama'} mode. Stopping old session.`);
        // Stop the old session and create a new one with the correct mode
        sessionManager.stopSession(runningSession.id).catch(err => {
          console.error('[Events] Failed to stop old session:', err);
        });
        apiModeSessions.delete(runningSession.id);
      }
    }

    // Create new session if we don't have one
    if (!session) {
      // Create new session with user's auth token for API mode
      // If token is provided, CLI will use platform LLM providers instead of Ollama
      try {
        const newSession = await sessionManager.createSession(userId, undefined, undefined, userToken || undefined);
        session = sessionManager.getSessionStatus(newSession.id);
        sessionId = newSession.id;
        // Track API mode sessions
        if (wantApiMode) {
          apiModeSessions.add(sessionId);
        }
        console.log(`[Events] Created new ${wantApiMode ? 'API' : 'Ollama'} mode session: ${sessionId}`);
      } catch (err) {
        console.error('[Events] Failed to create session:', err);
        ws.close(4004, 'Failed to create session');
        return;
      }
    }
  }

  if (!session || !sessionId) {
    ws.close(4002, 'Session not available');
    return;
  }

  // Get or create event emitter for this session
  let eventEmitter = sessionEventEmitters.get(sessionId);
  if (!eventEmitter) {
    eventEmitter = new AgenticodeEventEmitter(sessionId);
    sessionEventEmitters.set(sessionId, eventEmitter);

    // Connect event emitter to PTY output
    const pty = sessionManager.getPty(sessionId);
    if (pty) {
      pty.onData((data: string) => {
        eventEmitter!.processOutput(data);
      });
    } else {
      // PTY not ready yet - set up a listener for when session PTY becomes available
      const checkPtyInterval = setInterval(() => {
        const delayedPty = sessionManager.getPty(sessionId!);
        if (delayedPty) {
          delayedPty.onData((data: string) => {
            const emitter = sessionEventEmitters.get(sessionId!);
            if (emitter) {
              emitter.processOutput(data);
            }
          });
          clearInterval(checkPtyInterval);
        }
      }, 100);
      // Stop checking after 30 seconds
      setTimeout(() => clearInterval(checkPtyInterval), 30000);
    }

    // Emit session started event
    eventEmitter.emitSessionStarted(
      session.workspacePath || `/workspaces/${userId}`,
      session.model || 'default'
    );
  }

  // Add client to session's client set
  if (!sessionEventClients.has(sessionId)) {
    sessionEventClients.set(sessionId, new Set());
  }
  sessionEventClients.get(sessionId)!.add(ws);

  // Forward events to this client
  const eventHandler = (event: AgenticodeStreamEvent) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };
  eventEmitter.on('event', eventHandler);

  // Send initial session info
  ws.send(JSON.stringify({
    type: 'session_started',
    timestamp: Date.now(),
    sessionId,
    workspacePath: session.workspacePath || `/workspaces/${userId}`,
    model: session.model || 'default',
  }));

  // Handle incoming messages (user prompts)
  ws.on('message', async (data: Buffer | string) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'user_message' && message.content) {
        let finalContent = message.content;

        // Handle file attachments if present
        if (message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0) {
          const attachedFilePaths: string[] = [];

          for (const attachment of message.attachments) {
            try {
              const { name, type, content } = attachment;
              if (!name || !content) continue;

              // Write file to user's workspace
              const userWorkspace = session.workspacePath || join(config.workspacesPath, userId);
              const uploadDir = join(userWorkspace, 'uploads');

              // Ensure uploads directory exists
              await import('fs').then(fs => fs.promises.mkdir(uploadDir, { recursive: true }));

              // Decode base64 content and write file
              const fileBuffer = Buffer.from(content, 'base64');
              const filePath = join(uploadDir, name);
              await import('fs').then(fs => fs.promises.writeFile(filePath, fileBuffer));

              const relativePath = `uploads/${name}`;
              attachedFilePaths.push(relativePath);
            } catch (err) {
              console.error(`[Events] Failed to save attachment:`, err);
            }
          }

          // Add file references to the message content
          if (attachedFilePaths.length > 0) {
            finalContent = `${message.content}\n\n[Attached files saved to workspace: ${attachedFilePaths.join(', ')}]`;
          }
        }

        // Send NDJSON-formatted message to CLI
        // The CLI in --output-format stream-json mode expects {"type":"human","content":"..."}
        const ndjsonMessage = JSON.stringify({ type: 'human', content: finalContent }) + '\n';

        // Write message to PTY stdin
        sessionManager.write(sessionId!, ndjsonMessage);
      } else if (message.type === 'stop_execution') {
        // Send Ctrl+C to PTY
        sessionManager.write(sessionId!, '\x03');
      }
    } catch (err) {
      console.error('[Events] Failed to parse message:', err);
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    console.log(`[Events] WebSocket disconnected for session ${sessionId}`);
    eventEmitter?.off('event', eventHandler);
    sessionEventClients.get(sessionId!)?.delete(ws);

    // Clean up if no more clients
    if (sessionEventClients.get(sessionId!)?.size === 0) {
      sessionEventClients.delete(sessionId!);
      // Keep event emitter for session continuity
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`[Events] WebSocket error for session ${sessionId}:`, error);
    eventEmitter?.off('event', eventHandler);
  });
});

// ========================================
// Agentic Workflow Events API
// Receives events from awp-agenticwork-cli-mcp and broadcasts to WebSocket clients
// ========================================

app.post('/events', async (req, res) => {
  try {
    const event = req.body;

    if (!event || !event.type) {
      return res.status(400).json({ error: 'event with type required' });
    }

    const { sessionId, userId } = event;

    // Find the session's WebSocket clients to broadcast to
    if (sessionId && sessionEventClients.has(sessionId)) {
      const clients = sessionEventClients.get(sessionId)!;
      const eventJson = JSON.stringify(event);

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(eventJson);
        }
      }

      console.log(`[Events] Broadcast ${event.type} to ${clients.size} clients for session ${sessionId}`);
    }

    // Also emit through the event emitter if one exists
    if (sessionId && sessionEventEmitters.has(sessionId)) {
      const emitter = sessionEventEmitters.get(sessionId)!;
      emitter.emit('event', event);
    }

    res.json({ success: true, broadcast: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Events] Failed to broadcast event:', message);
    res.status(500).json({ success: false, error: message });
  }
});

// ========================================
// Direct File Operations (bypass CLI)
// For reliable file I/O without AI processing
// ========================================

// Validate path is within workspace (security)
function validateWorkspacePath(workspacesPath: string, userId: string, filePath: string): string {
  const userWorkspace = join(workspacesPath, userId);
  const fullPath = filePath.startsWith('/')
    ? filePath
    : join(userWorkspace, filePath);

  // Ensure the resolved path is within the user's workspace
  const resolved = join(userWorkspace, filePath.replace(/^\/workspaces\/[^/]+\//, ''));
  if (!resolved.startsWith(userWorkspace)) {
    throw new Error('Access denied: path outside workspace');
  }

  return resolved;
}

// Direct write file endpoint
app.post('/direct/write', async (req, res) => {
  try {
    const { userId, filepath, content } = req.body;

    if (!userId || !filepath || content === undefined) {
      return res.status(400).json({ error: 'userId, filepath, and content required' });
    }

    const fullPath = validateWorkspacePath(config.workspacesPath, userId, filepath);

    // Ensure directory exists
    await fs.mkdir(dirname(fullPath), { recursive: true });

    // Write file
    await fs.writeFile(fullPath, content, 'utf-8');

    console.log(`[Direct] Wrote file: ${fullPath}`);
    res.json({ success: true, filepath: fullPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Direct] Write failed:', message);
    res.status(500).json({ success: false, error: message });
  }
});

// Direct read file endpoint
app.post('/direct/read', async (req, res) => {
  try {
    const { userId, filepath } = req.body;

    if (!userId || !filepath) {
      return res.status(400).json({ error: 'userId and filepath required' });
    }

    const fullPath = validateWorkspacePath(config.workspacesPath, userId, filepath);

    // Read file
    const content = await fs.readFile(fullPath, 'utf-8');

    res.json({ success: true, content, filepath: fullPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message, content: '' });
  }
});

// Direct list files endpoint (supports recursive listing)
app.post('/direct/list', async (req, res) => {
  try {
    const { userId, directory = '.', recursive = false } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const fullPath = validateWorkspacePath(config.workspacesPath, userId, directory);

    interface FileEntry {
      name: string;
      type: 'file' | 'directory';
      path: string;
      size?: number;
    }

    // Recursive function to list all files
    const listRecursive = async (dir: string, basePath: string): Promise<FileEntry[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const results: FileEntry[] = [];

      for (const entry of entries) {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          results.push({
            name: entry.name,
            type: 'directory',
            path: entryPath,
          });

          if (recursive) {
            const subEntries = await listRecursive(fullEntryPath, entryPath);
            results.push(...subEntries);
          }
        } else {
          let size: number | undefined;
          try {
            const stat = await fs.stat(fullEntryPath);
            size = stat.size;
          } catch {
            // Ignore stat errors
          }
          results.push({
            name: entry.name,
            type: 'file',
            path: entryPath,
            size,
          });
        }
      }

      return results;
    };

    const files = await listRecursive(fullPath, directory === '.' ? '' : directory);

    res.json({ success: true, files, directory: fullPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message, files: [] });
  }
});

// Direct execute command endpoint
app.post('/direct/exec', async (req, res) => {
  try {
    const { userId, command, timeout = 60000 } = req.body;

    if (!userId || !command) {
      return res.status(400).json({ error: 'userId and command required' });
    }

    const workDir = join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Execute command with timeout
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, HOME: workDir }
    });

    console.log(`[Direct] Executed: ${command.substring(0, 50)}...`);
    res.json({
      success: true,
      stdout,
      stderr,
      exitCode: 0
    });
  } catch (error: any) {
    // exec errors include stdout/stderr
    res.json({
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1
    });
  }
});

// Direct git clone endpoint
app.post('/direct/git-clone', async (req, res) => {
  try {
    const { userId, repoUrl, targetDir } = req.body;

    if (!userId || !repoUrl) {
      return res.status(400).json({ error: 'userId and repoUrl required' });
    }

    const workDir = join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Extract repo name for target directory
    const repoName = targetDir || repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
    const clonePath = join(workDir, repoName);

    // Check if target already exists
    try {
      await fs.access(clonePath);
      return res.status(409).json({ error: `Directory '${repoName}' already exists` });
    } catch {
      // Directory doesn't exist - good
    }

    console.log(`[Direct] Cloning ${repoUrl} to ${clonePath}`);

    // Clone the repository
    const { stdout, stderr } = await execAsync(`git clone --depth 1 "${repoUrl}" "${repoName}"`, {
      cwd: workDir,
      timeout: 300000, // 5 minutes for large repos
      maxBuffer: 50 * 1024 * 1024, // 50MB
      env: { ...process.env, HOME: workDir, GIT_TERMINAL_PROMPT: '0' }
    });

    console.log(`[Direct] Clone completed: ${repoName}`);

    res.json({
      success: true,
      message: `Repository cloned to ${repoName}`,
      targetDir: repoName,
      stdout,
      stderr
    });
  } catch (error: any) {
    console.error('[Direct] Git clone failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.stderr || error.message,
      stdout: error.stdout || ''
    });
  }
});

// ========================================
// Serverless AgentiCode CLI Execution
// One-shot CLI calls for chat mode users (no persistent PTY session)
// ========================================

/**
 * Execute agenticode-cli as a serverless one-shot command.
 * This is for chat mode users who want to use agentic capabilities
 * without maintaining a persistent session.
 *
 * Usage from MCP:
 *   POST /serverless/exec
 *   {
 *     "userId": "user123",
 *     "prompt": "create a hello world python script",
 *     "apiKey": "awc_xxx",  // User's API key for authentication
 *     "apiEndpoint": "https://chat-dev.agenticwork.io",
 *     "yolo": true,  // Auto-approve tool executions
 *     "timeout": 120000
 *   }
 */
app.post('/serverless/exec', async (req, res) => {
  try {
    const {
      userId,
      prompt,
      apiKey,
      apiEndpoint = 'https://chat-dev.agenticwork.io',
      yolo = true,
      timeout = 120000,
      workingDirectory
    } = req.body;

    if (!userId || !prompt) {
      return res.status(400).json({ error: 'userId and prompt required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey required for serverless execution' });
    }

    const workDir = workingDirectory
      ? join(config.workspacesPath, userId, workingDirectory)
      : join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Build the agenticode-cli command
    // Uses --provider api to route through the platform's LLM providers
    const cliArgs = [
      '--provider', 'api',
      '--api-endpoint', apiEndpoint,
      '--api-key', apiKey,
      '--print',  // Output result to stdout
      '--no-interactive',  // Non-interactive mode
    ];

    if (yolo) {
      cliArgs.push('-y');  // Auto-approve tool executions
    }

    // Add the prompt as the final argument
    cliArgs.push(prompt);

    // Build command string - escape properly
    const cliPath = config.agenticodePath || '/app/agenticode/dist/cli.js';
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `node ${cliPath} ${cliArgs.slice(0, -1).join(' ')} '${escapedPrompt}'`;

    console.log(`[Serverless] Executing for user ${userId}: ${prompt.substring(0, 50)}...`);
    console.log(`[Serverless] Command: node ${cliPath} --provider api --api-endpoint ${apiEndpoint} --api-key *** --print --no-interactive ${yolo ? '-y' : ''} '...'`);

    // Execute the CLI command
    const startTime = Date.now();
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout,
      maxBuffer: 50 * 1024 * 1024, // 50MB for large outputs
      env: {
        ...process.env,
        HOME: workDir,
        AGENTICODE_API_KEY: apiKey,
        AGENTICODE_API_ENDPOINT: apiEndpoint,
        // Disable interactive prompts
        CI: 'true',
        TERM: 'dumb'
      }
    });

    const duration = Date.now() - startTime;
    console.log(`[Serverless] Completed for user ${userId} in ${duration}ms`);

    res.json({
      success: true,
      output: stdout,
      stderr: stderr || '',
      exitCode: 0,
      duration,
      workingDirectory: workDir
    });

  } catch (error: any) {
    const duration = error.killed ? 'timeout' : 'error';
    console.error(`[Serverless] Failed (${duration}):`, error.message);

    res.json({
      success: false,
      output: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      error: error.killed ? 'Execution timed out' : error.message
    });
  }
});

/**
 * Streaming serverless execution with SSE
 * For real-time output from agenticode-cli
 */
app.post('/serverless/stream', async (req, res) => {
  try {
    const {
      userId,
      prompt,
      apiKey,
      apiEndpoint = 'https://chat-dev.agenticwork.io',
      yolo = true,
      timeout = 300000,
      workingDirectory
    } = req.body;

    if (!userId || !prompt) {
      return res.status(400).json({ error: 'userId and prompt required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey required for serverless execution' });
    }

    const workDir = workingDirectory
      ? join(config.workspacesPath, userId, workingDirectory)
      : join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Build the agenticode-cli command
    const cliPath = config.agenticodePath || '/app/agenticode/dist/cli.js';
    const args = [
      cliPath,
      '--provider', 'api',
      '--api-endpoint', apiEndpoint,
      '--api-key', apiKey,
      '--output-format', 'stream-json',  // NDJSON streaming output
      '--no-interactive',
    ];

    if (yolo) {
      args.push('-y');
    }

    args.push(prompt);

    console.log(`[Serverless/Stream] Starting for user ${userId}: ${prompt.substring(0, 50)}...`);

    // Spawn the CLI process
    const cliProcess = spawn('node', args, {
      cwd: workDir,
      env: {
        ...process.env,
        HOME: workDir,
        AGENTICODE_API_KEY: apiKey,
        AGENTICODE_API_ENDPOINT: apiEndpoint,
        CI: 'true',
        TERM: 'dumb'
      }
    });

    const startTime = Date.now();
    let outputBuffer = '';

    // Stream stdout as SSE events
    cliProcess.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      outputBuffer += chunk;

      // Try to parse as NDJSON and emit events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            // Not JSON, send as raw output
            res.write(`data: ${JSON.stringify({ type: 'output', content: line })}\n\n`);
          }
        }
      }
    });

    // Stream stderr as error events
    cliProcess.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      res.write(`data: ${JSON.stringify({ type: 'stderr', content: chunk })}\n\n`);
    });

    // Handle process completion
    cliProcess.on('close', (code) => {
      const duration = Date.now() - startTime;
      console.log(`[Serverless/Stream] Completed for user ${userId} in ${duration}ms (exit ${code})`);

      res.write(`data: ${JSON.stringify({
        type: 'complete',
        exitCode: code,
        duration,
        success: code === 0
      })}\n\n`);

      res.end();
    });

    // Handle process errors
    cliProcess.on('error', (error) => {
      console.error(`[Serverless/Stream] Process error:`, error);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      console.warn(`[Serverless/Stream] Timeout for user ${userId}`);
      cliProcess.kill('SIGTERM');
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Execution timed out' })}\n\n`);
      res.end();
    }, timeout);

    // Clean up on client disconnect
    req.on('close', () => {
      clearTimeout(timeoutId);
      if (!cliProcess.killed) {
        cliProcess.kill('SIGTERM');
      }
    });

  } catch (error: any) {
    console.error(`[Serverless/Stream] Error:`, error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * Check if serverless execution is available
 */
app.get('/serverless/status', async (req, res) => {
  try {
    const cliPath = config.agenticodePath || '/app/agenticode/dist/cli.js';
    const cliExists = existsSync(cliPath);

    // Try to get CLI version
    let cliVersion = 'unknown';
    if (cliExists) {
      try {
        const { stdout } = await execAsync(`node ${cliPath} --version`, { timeout: 5000 });
        cliVersion = stdout.trim();
      } catch {
        // Version check failed, but CLI exists
      }
    }

    res.json({
      available: cliExists,
      cliPath,
      cliVersion,
      supportedProviders: ['api', 'ollama'],
      features: {
        streaming: true,
        yolo: true,
        customEndpoint: true
      }
    });
  } catch (error: any) {
    res.status(500).json({
      available: false,
      error: error.message
    });
  }
});

// ========================================
// WebSocket Live Metrics Handler
// Real-time resource usage streaming for admin dashboard
// ========================================

wssMetrics.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const internalKey = url.searchParams.get('internalKey');

  // SECURITY: Validate internal API key for WebSocket connections
  if (config.internalApiKey) {
    if (!internalKey || internalKey !== config.internalApiKey) {
      console.warn(`[SECURITY] Unauthorized metrics WebSocket connection attempt from ${req.socket.remoteAddress}`);
      ws.close(4000, 'Unauthorized - internal API key required');
      return;
    }
  }

  console.log('[Metrics] WebSocket client connected');
  metricsClients.add(ws);

  // Send initial system metrics
  try {
    const sessions = sessionManager.getAllSessions().map(s => ({
      id: s.id,
      userId: s.userId,
      pid: s.pid,
      workspacePath: s.workspacePath,
    }));
    const systemMetrics = await metricsService.getSystemMetrics(sessions);
    ws.send(JSON.stringify({ type: 'system_metrics', data: systemMetrics, timestamp: Date.now() }));
  } catch (err) {
    console.error('[Metrics] Failed to send initial metrics:', err);
  }

  // Handle client messages (e.g., subscribe to specific session)
  ws.on('message', async (data: Buffer | string) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'subscribe_session' && message.sessionId) {
        // Send enhanced metrics for specific session
        const metrics = await sessionManager.getEnhancedMetrics(message.sessionId);
        ws.send(JSON.stringify({
          type: 'session_metrics',
          sessionId: message.sessionId,
          data: metrics,
          timestamp: Date.now(),
        }));
      }
    } catch (err) {
      console.error('[Metrics] Failed to parse message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[Metrics] WebSocket client disconnected');
    metricsClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('[Metrics] WebSocket error:', error);
    metricsClients.delete(ws);
  });
});

// Broadcast metrics to all connected clients every 2 seconds
setInterval(async () => {
  if (metricsClients.size === 0) return;

  try {
    const sessions = sessionManager.getAllSessions().map(s => ({
      id: s.id,
      userId: s.userId,
      pid: s.pid,
      workspacePath: s.workspacePath,
    }));

    const systemMetrics = await metricsService.getSystemMetrics(sessions);
    const message = JSON.stringify({
      type: 'system_metrics',
      data: systemMetrics,
      timestamp: Date.now(),
    });

    for (const client of metricsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  } catch (err) {
    console.error('[Metrics] Failed to broadcast metrics:', err);
  }
}, 2000); // Every 2 seconds

// Cleanup idle sessions periodically
setInterval(async () => {
  const cleaned = await sessionManager.cleanupIdleSessions();
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} idle sessions`);
  }
}, 60000); // Every minute

const PORT = config.port || 3050;

// Initialize storage and start server
async function start() {
  try {
    // Initialize blob storage (legacy - for session metadata)
    await initializeStorage();
    console.log('[Storage] Blob storage initialized');
  } catch (error) {
    console.error('[Storage] Failed to initialize storage:', error);
    // Continue anyway - storage is non-critical for basic operation
  }

  try {
    // Initialize cloud-first workspace storage
    // This initializes the workspace service with the configured cloud provider
    // (MinIO for local dev, S3/Azure/GCS for cloud deployments)
    await sessionManager.initialize();
    console.log('[WorkspaceStorage] Cloud-first workspace storage initialized');
  } catch (error) {
    console.error('[WorkspaceStorage] Failed to initialize cloud workspace storage:', error);
    console.warn('[WorkspaceStorage] Falling back to local-only workspace storage');
  }

  server.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  AgenticWorkCode Manager (PTY)');
    console.log('========================================');
    console.log(`  @agenticwork/agenticode (CLI): v${cliVersion}`);
    console.log(`  @agenticwork/sdk:              v${sdkVersion}`);
    console.log('----------------------------------------');
    console.log(`  Port:           ${PORT}`);
    console.log(`  CLI path:       ${config.agenticodePath}`);
    console.log(`  Local cache:    ${config.workspacesPath}`);
    console.log(`  Ollama host:    ${config.ollamaHost}`);
    console.log(`  Default model:  ${config.defaultModel}`);
    console.log('----------------------------------------');
    console.log('  Cloud Storage (PRIMARY):');
    console.log(`    Provider:     ${config.storage.provider}`);
    console.log(`    Bucket:       ${config.storage.bucket}`);
    if (config.storage.endpoint) {
      console.log(`    Endpoint:     ${config.storage.endpoint}`);
    }
    console.log('----------------------------------------');
    console.log('  WebSockets:');
    console.log('    /ws/terminal  - PTY I/O');
    console.log('    /ws/events    - Structured events');
    console.log('    /ws/metrics   - Live resource metrics');
    console.log('----------------------------------------');
    console.log('  Enhanced Metrics Endpoints:');
    console.log('    GET /sessions/:id/metrics/enhanced');
    console.log('    GET /sessions/all/metrics/enhanced');
    console.log('    GET /metrics/system');
    console.log('========================================');
    console.log('');
  });
}

start();
