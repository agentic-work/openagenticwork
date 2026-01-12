/**
 * Session Manager
 * Manages AWCode CLI processes with real PTY terminals
 */

import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import pidusage from 'pidusage';
import { Config } from './config';
import type { UserSession, SessionStatus } from './types';
import {
  OutputMessageParser
} from './persistenceClient';
import {
  saveSession,
  updateSessionStatus,
  saveMessage,
  saveTerminalOutput,
} from './storageClient';
import {
  metricsService,
  EnhancedProcessMetrics,
  TokenUsage,
  StorageUsage,
  SessionMetrics,
} from './metricsService';
import {
  getWorkspaceStorageService,
  WorkspaceStorageService,
  FileChangeEvent,
} from './workspaceStorageService';
import {
  createSandboxUser,
  deleteSandboxUser,
  getSandboxEnv,
  initializeSandbox,
  canCreateUsers,
  SandboxUser,
} from './userSandbox';
import { getUlimitPrefix, checkCommand } from './securityPolicy';

// Process metrics interface (legacy - kept for backwards compatibility)
export interface ProcessMetrics {
  cpu: number;      // CPU usage percentage
  memory: number;   // Memory usage in bytes
  memoryMB: number; // Memory usage in MB (for display)
  elapsed: number;  // Process elapsed time in ms
}

// Enhanced session metrics
export interface EnhancedSessionMetrics extends ProcessMetrics {
  networkRx: number;
  networkTx: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  tokenUsage: TokenUsage;
  storageUsage: StorageUsage | null;
}

// Max lines to keep in output buffer per session
const MAX_OUTPUT_LINES = 100;

/**
 * AGENTICODE.md template - provides context to the LLM at session start
 * Similar to .cursorrules, .github/copilot-instructions.md
 */
function generateAgenticodeMd(userId: string, workspacePath: string): string {
  return `# AGENTICODE.md - Workspace Context

This file provides context to Agenticode AI assistant when working in this workspace.
Edit this file to customize how the AI helps you.

## Workspace Info

- **User**: ${userId}
- **Path**: ${workspacePath}
- **Created**: ${new Date().toISOString()}

## Project Overview

<!-- Describe your project here -->
This workspace is managed by AgenticWork's Agenticode feature.

## Code Style & Conventions

- Follow existing code style in the project
- Use meaningful variable and function names
- Add comments for complex logic
- Write clean, maintainable code

## Preferred Technologies

<!-- List your preferred languages, frameworks, libraries -->
- Languages: (edit to add your preferences)
- Frameworks: (edit to add your preferences)
- Tools: (edit to add your preferences)

## Important Context

<!-- Add any important context the AI should know -->
- This is a cloud-hosted development environment
- Files are synced to persistent storage
- You have access to terminal commands and file operations

## Tasks to Avoid

- Don't modify system files
- Don't store secrets in plain text
- Don't create files larger than 100MB without warning

## Custom Instructions

<!-- Add your own custom instructions for the AI -->

---
*This file is read by Agenticode at session start. Modify it to improve AI assistance.*
`;
}

/**
 * Ensure AGENTICODE.md exists in the workspace
 * Creates it with default template if it doesn't exist
 */
async function ensureAgenticodeMd(workspacePath: string, userId: string): Promise<void> {
  const agenticodePath = join(workspacePath, 'AGENTICODE.md');

  if (!existsSync(agenticodePath)) {
    const content = generateAgenticodeMd(userId, workspacePath);
    await writeFile(agenticodePath, content, 'utf-8');
    console.log(`[SessionManager] Created AGENTICODE.md in ${workspacePath}`);
  } else {
    console.log(`[SessionManager] AGENTICODE.md already exists in ${workspacePath}`);
  }
}

/**
 * Check workspace size and enforce 5GB limit
 */
async function getWorkspaceSize(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const { execSync } = await import('child_process');
    // Use du for efficient directory size calculation
    const output = execSync(`du -sb "${dirPath}" 2>/dev/null || echo "0"`, { encoding: 'utf-8' });
    const size = parseInt(output.split('\t')[0], 10);
    return isNaN(size) ? 0 : size;
  } catch {
    return 0; // Return 0 if we can't determine size
  }
}

export class SessionManager {
  private config: Config;
  private sessions: Map<string, UserSession> = new Map();
  private ptys: Map<string, pty.IPty> = new Map();
  private userToSessions: Map<string, Set<string>> = new Map();
  // Output buffers for admin monitoring (last N lines per session)
  private outputBuffers: Map<string, string[]> = new Map();
  // Current activity indicator per session
  private currentActivity: Map<string, string> = new Map();
  // Message parsers for database persistence
  private messageParsers: Map<string, OutputMessageParser> = new Map();
  // Cloud-first workspace storage service
  private workspaceService: WorkspaceStorageService;
  // Sandbox users per session (for security isolation)
  private sandboxUsers: Map<string, SandboxUser> = new Map();
  // Whether sandboxing is enabled (requires root or CAP_SETUID)
  private sandboxEnabled: boolean = false;

  constructor(config: Config) {
    this.config = config;
    this.workspaceService = getWorkspaceStorageService(config.workspacesPath);
  }

  /**
   * Initialize the session manager (must be called before creating sessions)
   */
  async initialize(): Promise<void> {
    await this.workspaceService.initialize();

    // Initialize user sandboxing
    this.sandboxEnabled = await initializeSandbox();
    if (this.sandboxEnabled) {
      console.log('[SessionManager] User sandboxing ENABLED - each session runs as isolated user');
    } else {
      console.warn('[SessionManager] User sandboxing DISABLED - sessions share node user');
      console.warn('[SessionManager] To enable: run container with --privileged or add CAP_SETUID,CAP_SETGID');
    }

    console.log('[SessionManager] Initialized with cloud-first workspace storage');
  }

  /**
   * Create a new AWCode session with PTY terminal
   * @param userId - The user ID for the session
   * @param workspacePath - Optional custom workspace path
   * @param model - Optional model override (defaults to gpt-oss)
   * @param apiKey - Optional API key for AgenticWork API mode
   * @param storageLimitMb - Optional storage limit override from admin settings
   */
  async createSession(
    userId: string,
    workspacePath?: string,
    model?: string,
    apiKey?: string,
    storageLimitMb?: number
  ): Promise<UserSession> {
    // Check session limit
    const userSessions = this.userToSessions.get(userId) || new Set();
    if (userSessions.size >= this.config.maxSessionsPerUser) {
      throw new Error(`Maximum sessions (${this.config.maxSessionsPerUser}) reached for user`);
    }

    const sessionId = randomUUID();

    // Cloud-first workspace initialization
    // 1. Creates workspace in cloud storage (MinIO/S3/Azure/GCS) first
    // 2. Downloads existing files to local cache (if resuming)
    // 3. Sets up real-time sync from local to cloud
    let workspace: string;
    let isNewWorkspace: boolean;
    let filesDownloaded: number;

    try {
      const result = await this.workspaceService.initializeWorkspace(userId, sessionId, model);
      workspace = result.localPath;
      isNewWorkspace = result.isNew;
      filesDownloaded = result.filesDownloaded;
      console.log(`[SessionManager] Workspace initialized: new=${isNewWorkspace}, downloaded=${filesDownloaded} files`);
    } catch (err) {
      // NO FALLBACK - Cloud storage MUST work in Kubernetes environments
      // With multiple replicas, local filesystem would be inconsistent across pods
      // Fail fast to force proper storage configuration
      console.error(`[SessionManager] FATAL: Cloud storage initialization failed:`, err);
      throw new Error(`Cloud storage initialization failed. Storage must be properly configured (MinIO/S3/Azure/GCS). Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Check workspace size limit (admin settings override > config > default 5GB)
    const effectiveLimitMb = storageLimitMb || this.config.maxWorkspaceSizeMb;
    const maxWorkspaceSizeBytes = effectiveLimitMb * 1024 * 1024;
    const workspaceSize = await getWorkspaceSize(workspace);
    if (workspaceSize > maxWorkspaceSizeBytes) {
      const sizeMB = Math.round(workspaceSize / (1024 * 1024));
      throw new Error(`Workspace size (${sizeMB}MB) exceeds limit (${effectiveLimitMb}MB). Please delete some files or use GitHub for storage.`);
    }

    // Ensure AGENTICODE.md exists in workspace (provides AI context)
    // This file provides context to the AI about the workspace and user preferences
    try {
      await ensureAgenticodeMd(workspace, userId);
    } catch (err) {
      console.warn(`[SessionManager] Failed to create AGENTICODE.md:`, err);
      // Don't fail session creation for this
    }

    // Create sandbox user for isolation (if sandboxing is enabled)
    let sandboxUser: SandboxUser | null = null;
    if (this.sandboxEnabled) {
      try {
        sandboxUser = await createSandboxUser(sessionId, workspace);
        this.sandboxUsers.set(sessionId, sandboxUser);
        console.log(`[Sandbox] Session ${sessionId} will run as user ${sandboxUser.username} (UID: ${sandboxUser.uid})`);
      } catch (err) {
        console.error(`[Sandbox] Failed to create sandbox user, falling back to shared user:`, err);
      }
    }

    // Build CLI arguments
    const cliArgs = [
      '--dangerously-skip-permissions',   // Auto-approve tool executions (yolo mode)
      '--non-interactive',                // Skip setup wizard in container mode
      '--directory', workspace,           // Working directory
      '--output-format', 'stream-json',   // CRITICAL: Output NDJSON for UI parsing
    ];

    // If API key is provided, use API mode for platform LLM providers
    // In API mode: CLI gets config from /api/agenticode/config, uses /api/agenticode/chat for LLM
    // In Ollama mode: CLI uses Ollama directly for LLM
    const apiEndpoint = process.env.AGENTICWORK_API_ENDPOINT || 'http://agenticwork-api:8000';
    if (apiKey) {
      cliArgs.push('--provider', 'api');
      cliArgs.push('--api-endpoint', apiEndpoint);
      cliArgs.push('--api-key', apiKey);
      // Model will be fetched from /api/agenticode/config - don't hardcode here
    } else {
      // Ollama mode - use local Ollama for LLM
      cliArgs.push('--model', model || this.config.defaultModel);
      cliArgs.push('--ollama-host', this.config.ollamaHost);
    }

    // Determine shell and args based on sandboxing
    let shell: string;
    let args: string[];

    if (sandboxUser) {
      // SANDBOXED: Run CLI as the sandbox user using 'su'
      // This ensures the CLI process runs with limited privileges
      // SECURITY: Apply resource limits (ulimits) to prevent DoS attacks
      shell = 'su';
      const cliCommand = [this.config.agenticodePath, ...cliArgs].join(' ');
      // Prepend ulimit commands to restrict resources (fork bombs, disk fill, etc.)
      const limitedCommand = `${getUlimitPrefix()}${cliCommand}`;
      args = ['-s', '/bin/bash', sandboxUser.username, '-c', limitedCommand];
      console.log(`[Sandbox] Spawning as ${sandboxUser.username} with resource limits`);
      console.log(`[Sandbox] Command: su -s /bin/bash ${sandboxUser.username} -c "${limitedCommand.substring(0, 200)}..."`);
    } else {
      // NON-SANDBOXED: Run CLI directly (less secure, but works without privileges)
      shell = this.config.agenticodePath;
      args = cliArgs;
      console.log(`Spawning Agenticode CLI: ${shell} ${args.join(' ')}`);
    }

    // Build clean environment for PTY - ensure NO_COLOR is completely removed
    let ptyEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AGENTICODE_SESSION_ID: sessionId,
      AGENTICODE_USER_ID: userId,
      // Container mode - skip setup wizard
      CONTAINER_MODE: '1',
      // Force color output even in PTY
      FORCE_COLOR: '1',
      // Enable ANSI colors and 256 color support
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
    };

    // Apply sandbox environment restrictions if sandboxing is enabled
    if (sandboxUser) {
      ptyEnv = getSandboxEnv(sandboxUser, ptyEnv);
    }

    // Configure based on mode (API vs Ollama)
    if (apiKey) {
      // API MODE: CLI uses AgenticWork API for LLM, MCP, storage
      // - Gets config from /api/agenticode/config (available models, MCP servers, etc.)
      // - Calls /api/agenticode/chat for LLM completions
      // - Uses platform's configured providers (Anthropic, OpenAI, Azure, Vertex, etc.)
      ptyEnv.AGENTICODE_API_KEY = apiKey;
      ptyEnv.AGENTICWORK_API_ENDPOINT = process.env.AGENTICWORK_API_ENDPOINT || 'http://agenticwork-api:8000';
      // Don't set AGENTICODE_MODEL - CLI will get default from /api/agenticode/config
      console.log(`[API MODE] CLI will use platform LLM via ${ptyEnv.AGENTICWORK_API_ENDPOINT}/api/agenticode/chat`);
    } else {
      // OLLAMA MODE: CLI uses local Ollama directly
      ptyEnv.OLLAMA_HOST = this.config.ollamaHost;
      ptyEnv.AGENTICODE_MODEL = model || this.config.defaultModel;
      console.log(`[OLLAMA MODE] CLI will use Ollama at ${this.config.ollamaHost} with model ${ptyEnv.AGENTICODE_MODEL}`);
    }

    // CRITICAL: Explicitly delete NO_COLOR to prevent color suppression
    // Setting to undefined doesn't work - must delete the key entirely
    delete ptyEnv.NO_COLOR;

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: workspace,
      env: ptyEnv,
    });

    const session: UserSession = {
      id: sessionId,
      userId,
      pid: ptyProcess.pid,
      workspacePath: workspace,
      model: model || this.config.defaultModel,
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
    };

    // Track session
    this.sessions.set(sessionId, session);
    this.ptys.set(sessionId, ptyProcess);
    if (!this.userToSessions.has(userId)) {
      this.userToSessions.set(userId, new Set());
    }
    this.userToSessions.get(userId)!.add(sessionId);

    // Initialize output buffer for this session
    this.outputBuffers.set(sessionId, []);

    // Initialize message parser for database persistence
    const messageParser = new OutputMessageParser(sessionId);
    this.messageParsers.set(sessionId, messageParser);

    // Capture PTY output for admin monitoring and persistence
    ptyProcess.onData((data: string) => {
      const buffer = this.outputBuffers.get(sessionId) || [];

      // Split data into lines and add to buffer
      const lines = data.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          buffer.push(line);
          // Keep only last N lines
          while (buffer.length > MAX_OUTPUT_LINES) {
            buffer.shift();
          }
        }
      }
      this.outputBuffers.set(sessionId, buffer);

      // Update current activity based on output patterns
      if (data.includes('Thinking') || data.includes('...')) {
        this.currentActivity.set(sessionId, 'thinking');
      } else if (data.includes('Reading') || data.includes('Searching')) {
        this.currentActivity.set(sessionId, 'reading');
      } else if (data.includes('Writing') || data.includes('Editing')) {
        this.currentActivity.set(sessionId, 'writing');
      } else if (data.includes('Running') || data.includes('Executing')) {
        this.currentActivity.set(sessionId, 'executing');
      } else if (data.includes('$') || data.includes('>')) {
        this.currentActivity.set(sessionId, 'idle');
      }

      // Add output to message parser for database persistence
      messageParser.addOutput(data);
    });

    // Handle PTY events
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`Session ${sessionId} PTY exited with code ${exitCode}`);
      session.status = 'stopped';
      this.cleanup(sessionId);
    });

    // Persist session to blob storage (async, non-blocking)
    saveSession(session).catch(err => {
      console.error(`Failed to persist session ${sessionId}:`, err);
    });

    // Note: Workspace sync is now handled by WorkspaceStorageService (cloud-first)
    // Real-time sync to cloud is started automatically in initializeWorkspace()

    console.log(`Created PTY session ${sessionId} for user ${userId} (PID: ${ptyProcess.pid})`);
    return session;
  }

  /**
   * Get PTY process for a session (for WebSocket I/O)
   */
  getPty(sessionId: string): pty.IPty | null {
    return this.ptys.get(sessionId) || null;
  }

  /**
   * Write to PTY stdin
   */
  write(sessionId: string, data: string): boolean {
    const ptyProcess = this.ptys.get(sessionId);
    if (!ptyProcess) return false;

    ptyProcess.write(data);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }

    return true;
  }

  /**
   * Resize PTY
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const ptyProcess = this.ptys.get(sessionId);
    if (!ptyProcess) return false;

    ptyProcess.resize(cols, rows);
    return true;
  }

  /**
   * Send a message and collect response (for REST API - legacy support)
   *
   * The CLI runs in interactive mode, so we send plain text messages.
   */
  async sendMessage(sessionId: string, message: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    const ptyProcess = this.ptys.get(sessionId);

    if (!session || !ptyProcess) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== 'running') {
      throw new Error(`Session is not running: ${session.status}`);
    }

    session.lastActivity = new Date();

    return new Promise((resolve, reject) => {
      let output = '';
      const timeout = 120000; // 2 minute timeout

      const dataHandler = (data: string) => {
        output += data;
      };

      ptyProcess.onData(dataHandler);

      // Send plain text message to PTY (interactive mode)
      ptyProcess.write(message + '\n');

      // Wait for response with timeout
      const timeoutId = setTimeout(() => {
        resolve(output || 'No response');
      }, timeout);

      // Check for completion marker periodically
      // In interactive mode, look for the prompt returning
      const checkInterval = setInterval(() => {
        // CLI shows prompt like ">" or "$" when ready for input
        if (output.includes('\n>') || output.includes('\n$') || output.match(/\n.*\$\s*$/)) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve(output);
        }
      }, 100);
    });
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): UserSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): SessionStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      status: session.status,
      running: session.status === 'running',
      userId: session.userId,
      model: session.model,
      workspacePath: session.workspacePath,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    };
  }

  /**
   * Get sessions by user ID
   */
  getSessionsByUser(userId: string): UserSession[] {
    const sessionIds = this.userToSessions.get(userId) || new Set();
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id)!)
      .filter(Boolean);
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const ptyProcess = this.ptys.get(sessionId);

    if (!session || !ptyProcess) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Kill PTY process
    ptyProcess.kill();

    await this.cleanup(sessionId);
    console.log(`Stopped PTY session ${sessionId}`);
  }

  /**
   * Restart a session - stops existing and creates new with same config
   */
  async restartSession(sessionId: string): Promise<UserSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Capture session config before stopping
    const { userId, workspacePath, model } = session;

    // Stop existing session
    await this.stopSession(sessionId);

    // Create new session with same config
    const newSession = await this.createSession(userId, workspacePath, model);
    console.log(`Restarted session ${sessionId} as ${newSession.id}`);

    return newSession;
  }

  /**
   * Clean up session resources
   */
  private async cleanup(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      const userSessions = this.userToSessions.get(session.userId);
      userSessions?.delete(sessionId);

      // Clear metrics for this session
      metricsService.clearSession(sessionId, session.pid);

      // Stop workspace and sync final changes to cloud
      try {
        await this.workspaceService.stopWorkspace(sessionId);
      } catch (err) {
        console.error(`[SessionManager] Failed to stop workspace ${sessionId}:`, err);
      }
    }

    // Clean up sandbox user (IMPORTANT: do this before deleting workspace)
    const sandboxUser = this.sandboxUsers.get(sessionId);
    if (sandboxUser) {
      try {
        // Keep workspace files - they're synced to cloud storage
        await deleteSandboxUser(sandboxUser, true);
        this.sandboxUsers.delete(sessionId);
        console.log(`[Sandbox] Deleted sandbox user ${sandboxUser.username} for session ${sessionId}`);
      } catch (err) {
        console.error(`[Sandbox] Failed to delete sandbox user for ${sessionId}:`, err);
      }
    }

    // Flush any pending messages before cleanup
    const messageParser = this.messageParsers.get(sessionId);
    if (messageParser) {
      await messageParser.cleanup();
      this.messageParsers.delete(sessionId);
    }

    // Mark session as stopped in blob storage
    if (session) {
      updateSessionStatus(session.userId, sessionId, 'stopped').catch(err => {
        console.error(`Failed to persist session stop for ${sessionId}:`, err);
      });
    }

    this.sessions.delete(sessionId);
    this.ptys.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.currentActivity.delete(sessionId);
  }

  /**
   * Get active session count
   */
  getActiveCount(): number {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'running')
      .length;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get process metrics for a session's PTY process
   */
  async getProcessMetrics(sessionId: string): Promise<ProcessMetrics | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pid) return null;

    try {
      const stats = await pidusage(session.pid);
      return {
        cpu: Math.round(stats.cpu * 100) / 100,
        memory: stats.memory,
        memoryMB: Math.round(stats.memory / (1024 * 1024) * 100) / 100,
        elapsed: stats.elapsed,
      };
    } catch (err) {
      // Process may have exited
      return null;
    }
  }


  /**
   * Get sandbox username for a session (used by code-server to run as correct user)
   */
  getSandboxUsername(sessionId: string): string | undefined {
    const sandboxUser = this.sandboxUsers.get(sessionId);
    return sandboxUser?.username;
  }

  /**
   * Get enhanced metrics including network I/O, disk I/O, tokens, and storage
   */
  async getEnhancedMetrics(sessionId: string): Promise<EnhancedSessionMetrics | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pid) return null;

    try {
      // Get enhanced process metrics from metricsService
      const processMetrics = await metricsService.getProcessMetrics(session.pid);
      if (!processMetrics) return null;

      // Get token usage
      const tokenUsage = metricsService.getTokenUsage(sessionId);

      // Get storage usage
      const storageUsage = session.workspacePath
        ? await metricsService.getStorageUsage(session.workspacePath)
        : null;

      return {
        cpu: processMetrics.cpu,
        memory: processMetrics.memory,
        memoryMB: processMetrics.memoryMB,
        elapsed: processMetrics.elapsed,
        networkRx: processMetrics.networkRx,
        networkTx: processMetrics.networkTx,
        diskReadBytes: processMetrics.diskReadBytes,
        diskWriteBytes: processMetrics.diskWriteBytes,
        tokenUsage,
        storageUsage,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Record token usage for a session (called when NDJSON 'result' event is received)
   */
  recordTokenUsage(sessionId: string, inputTokens: number, outputTokens: number, model?: string): void {
    metricsService.recordTokenUsage(sessionId, inputTokens, outputTokens, model);
  }

  /**
   * Get all sessions with enhanced metrics for admin dashboard
   */
  async getAllSessionsWithEnhancedMetrics(): Promise<Array<UserSession & {
    lastOutput: string;
    currentActivity: string;
    enhancedMetrics: EnhancedSessionMetrics | null;
  }>> {
    const sessions = Array.from(this.sessions.values());
    const results = await Promise.all(
      sessions.map(async (session) => {
        const enhancedMetrics = await this.getEnhancedMetrics(session.id);
        return {
          ...session,
          lastOutput: (this.outputBuffers.get(session.id) || []).slice(-20).join('\n'),
          currentActivity: this.currentActivity.get(session.id) || 'idle',
          enhancedMetrics,
        };
      })
    );
    return results;
  }

  /**
   * Get all sessions with output buffer for admin monitoring
   */
  getAllSessionsWithOutput(): Array<UserSession & { lastOutput: string; currentActivity: string }> {
    return Array.from(this.sessions.values()).map(session => ({
      ...session,
      lastOutput: (this.outputBuffers.get(session.id) || []).slice(-20).join('\n'),
      currentActivity: this.currentActivity.get(session.id) || 'idle',
    }));
  }

  /**
   * Get all sessions with output buffer AND process metrics for admin monitoring
   */
  async getAllSessionsWithMetrics(): Promise<Array<UserSession & {
    lastOutput: string;
    currentActivity: string;
    metrics: ProcessMetrics | null;
  }>> {
    const sessions = Array.from(this.sessions.values());
    const results = await Promise.all(
      sessions.map(async (session) => {
        const metrics = await this.getProcessMetrics(session.id);
        return {
          ...session,
          lastOutput: (this.outputBuffers.get(session.id) || []).slice(-20).join('\n'),
          currentActivity: this.currentActivity.get(session.id) || 'idle',
          metrics,
        };
      })
    );
    return results;
  }

  /**
   * Clean up idle sessions
   */
  async cleanupIdleSessions(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const session of this.sessions.values()) {
      const idleTime = (now - session.lastActivity.getTime()) / 1000;
      const lifetime = (now - session.createdAt.getTime()) / 1000;

      if (idleTime > this.config.sessionIdleTimeout || lifetime > this.config.sessionMaxLifetime) {
        await this.stopSession(session.id);
        cleaned++;
      }
    }

    return cleaned;
  }
}
