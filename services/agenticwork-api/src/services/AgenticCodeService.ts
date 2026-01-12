/**
 * Agentic Code Service
 * Handles the agentic coding loop for AI-assisted development
 *
 * This service provides:
 * - Session management for isolated coding slices (Landlock sandboxed)
 * - Agentic loop execution with file manipulation and shell commands
 * - Integration with AgenticWorkCode Runtime for slice lifecycle
 * - LLM-based code generation and modification
 * - Git operations and workspace management
 *
 * Updated for Landlock-based sandboxing (Option A architecture):
 * - Single runtime container with multiple user slices
 * - Slices use Landlock for filesystem isolation
 * - Slices use seccomp for syscall filtering
 */

import axios, { AxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';
import { ProviderManager } from './llm-providers/ProviderManager.js';

// SECURITY: Internal API key for code-manager authentication
const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';

/**
 * Code session interface
 */
interface CodeSession {
  id: string;
  userId: string;
  sliceId: string;  // Changed from containerId - now using Landlock slices
  model: string;
  workspacePath: string;
  securityLevel: 'strict' | 'permissive' | 'minimal';
  networkEnabled: boolean;
  createdAt: Date;
  lastActivity: Date;
}

/**
 * Agentic event types for streaming updates
 */
interface AgenticEvent {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'file_change' | 'error' | 'done';
  content?: string;
  tool?: string;
  toolId?: string;  // Tool call ID for UI matching
  params?: any;
  result?: any;
  path?: string;
}

/**
 * Tool definition interface
 */
interface AgenticTool {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any, session: CodeSession) => Promise<any>;
}

/**
 * AgenticCodeService
 *
 * Manages code sessions and executes agentic coding loops
 */
export class AgenticCodeService {
  private logger: Logger;
  private runtimeUrl: string;  // Changed from managerUrl
  private providerManager: ProviderManager;
  private defaultModel: string;
  private defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
  private defaultNetworkEnabled: boolean;

  /**
   * Create axios config with internal authentication
   * SECURITY: All requests to code-manager must include the internal API key
   */
  private createInternalAuthConfig(timeout = 10000): AxiosRequestConfig {
    const config: AxiosRequestConfig = { timeout };
    if (CODE_MANAGER_INTERNAL_KEY) {
      config.headers = {
        'X-Internal-API-Key': CODE_MANAGER_INTERNAL_KEY,
      };
    }
    return config;
  }

  constructor(
    logger: Logger,
    providerManager: ProviderManager,
    config?: {
      managerUrl?: string;  // Kept for backwards compatibility
      runtimeUrl?: string;
      defaultModel?: string;
      defaultSecurityLevel?: 'strict' | 'permissive' | 'minimal';
      defaultNetworkEnabled?: boolean;
    }
  ) {
    this.logger = logger;
    this.providerManager = providerManager;
    // Use runtimeUrl if provided, fall back to managerUrl for backwards compatibility
    this.runtimeUrl = config?.runtimeUrl || config?.managerUrl ||
      process.env.CODE_RUNTIME_URL || process.env.CODE_MANAGER_URL ||
      'http://agenticode-manager:3050';  // BUG-002 fix: correct hostname
    // Note: defaultModel is now fetched from database in getAWCodeSettings()
    // This is just a fallback if database is unavailable - uses env vars only, no hardcoding
    this.defaultModel = config?.defaultModel || process.env.DEFAULT_CODE_MODEL || process.env.DEFAULT_MODEL || '';
    this.defaultSecurityLevel = config?.defaultSecurityLevel ||
      (process.env.DEFAULT_SECURITY_LEVEL as any) || 'permissive';
    this.defaultNetworkEnabled = config?.defaultNetworkEnabled ??
      (process.env.DEFAULT_NETWORK_ENABLED === 'true');
  }

  /**
   * Get AWCode settings from the database
   * Settings are stored in SystemConfiguration with 'awcode.' prefix
   */
  private async getAWCodeSettings(): Promise<{
    defaultModel: string;
    defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
    defaultNetworkEnabled: boolean;
    maxSessionsPerUser: number;
    storageQuotaEnabled: boolean;
    defaultStorageLimitMb: number;
  }> {
    try {
      const settings = await prisma.systemConfiguration.findMany({
        where: {
          key: {
            startsWith: 'awcode.',
          },
        },
      });

      // Build settings map
      const settingsMap: Record<string, any> = {};
      for (const setting of settings) {
        const key = setting.key.replace('awcode.', '');
        const val = setting.value;
        if (typeof val === 'string') {
          try {
            settingsMap[key] = JSON.parse(val);
          } catch {
            settingsMap[key] = val;
          }
        } else {
          settingsMap[key] = val;
        }
      }

      // Use the configured model from database, or fall back to env var default
      // No validation here - the agenticode config endpoint handles model availability
      return {
        defaultModel: settingsMap.defaultModel || this.defaultModel,
        defaultSecurityLevel: settingsMap.defaultSecurityLevel || this.defaultSecurityLevel,
        defaultNetworkEnabled: settingsMap.defaultNetworkEnabled ?? this.defaultNetworkEnabled,
        maxSessionsPerUser: settingsMap.maxSessionsPerUser || 3,
        storageQuotaEnabled: settingsMap.storageQuotaEnabled ?? true,
        defaultStorageLimitMb: settingsMap.defaultStorageLimitMb || 5120, // 5GB default
      };
    } catch (error) {
      this.logger.warn({ error }, 'Failed to fetch AWCode settings from database, using defaults');
      return {
        defaultModel: this.defaultModel,
        defaultSecurityLevel: this.defaultSecurityLevel,
        defaultNetworkEnabled: this.defaultNetworkEnabled,
        maxSessionsPerUser: 3,
        storageQuotaEnabled: true,
        defaultStorageLimitMb: 5120, // 5GB default
      };
    }
  }

  /**
   * Create a new code session (using Landlock slices)
   */
  async createSession(
    userId: string,
    model?: string,
    options?: {
      securityLevel?: 'strict' | 'permissive' | 'minimal';
      networkEnabled?: boolean;
      apiKey?: string;  // API key for managed mode (routes LLM calls through AgenticWork API)
    }
  ): Promise<CodeSession> {
    this.logger.info({ userId, model, options: { ...options, apiKey: options?.apiKey ? '[redacted]' : undefined } }, 'Creating code session');

    const sessionId = uuidv4();

    // Fetch settings from database (includes admin-configured defaults)
    const dbSettings = await this.getAWCodeSettings();

    // Use provided values, fall back to database settings
    const securityLevel = options?.securityLevel || dbSettings.defaultSecurityLevel;
    const networkEnabled = options?.networkEnabled ?? dbSettings.defaultNetworkEnabled;
    const effectiveModel = model || dbSettings.defaultModel;

    // Storage limit (only if quota enforcement is enabled)
    const storageLimitMb = dbSettings.storageQuotaEnabled ? dbSettings.defaultStorageLimitMb : undefined;

    this.logger.info({
      userId,
      model: effectiveModel,
      securityLevel,
      networkEnabled,
      storageLimitMb,
      source: model ? 'user' : 'database'
    }, 'Using session configuration');

    try {
      // Request session from agenticode-manager service (PTY-based)
      // SECURITY: Include internal API key for authentication
      const response = await axios.post(
        `${this.runtimeUrl}/sessions`,
        {
          userId,
          model: effectiveModel,
          // Pass API key for managed mode - CLI will use AgenticWork API for LLM calls
          apiKey: options?.apiKey,
          // Pass storage limit from admin settings for quota enforcement
          storageLimitMb,
          // Note: securityLevel and networkEnabled handled by manager
        },
        this.createInternalAuthConfig()
      );

      // Manager returns: { sessionId, status, session: { id, workspacePath, model, ... } }
      const sessionData = response.data.session || response.data;
      const session: CodeSession = {
        id: sessionId,
        userId,
        sliceId: response.data.sessionId || sessionData.id,
        model: sessionData.model || model || this.defaultModel,
        workspacePath: sessionData.workspacePath || `/workspaces/${userId}`,
        securityLevel,
        networkEnabled,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      // Store session in database
      await prisma.codeSession.create({
        data: {
          id: session.id,
          user_id: session.userId,
          slice_id: session.sliceId,
          container_id: null,  // Deprecated - using slices now
          model: session.model,
          workspace_path: session.workspacePath,
          security_level: session.securityLevel,
          network_enabled: session.networkEnabled,
          created_at: session.createdAt,
          last_activity: session.lastActivity,
          status: 'active'
        }
      });

      this.logger.info({ sessionId, sliceId: session.sliceId }, 'Code session created');
      return session;

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to create code session');
      throw new Error('Failed to create code session');
    }
  }

  /**
   * Get an existing session
   */
  async getSession(sessionId: string, userId: string): Promise<CodeSession | null> {
    try {
      const result = await prisma.codeSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
          status: 'active'
        }
      });

      if (!result) return null;

      return {
        id: result.id,
        userId: result.user_id,
        sliceId: result.slice_id || result.container_id || '',  // Support both old and new
        model: result.model,
        workspacePath: result.workspace_path,
        securityLevel: (result.security_level as any) || 'permissive',
        networkEnabled: result.network_enabled || false,
        createdAt: result.created_at,
        lastActivity: result.last_activity
      };
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to get session');
      return null;
    }
  }

  /**
   * Delete a session and cleanup slice
   */
  async deleteSession(sessionId: string, userId: string, options?: { createSnapshot?: boolean }): Promise<void> {
    this.logger.info({ sessionId, userId }, 'Deleting code session');

    try {
      const session = await this.getSession(sessionId, userId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Remove slice from runtime
      // SECURITY: Include internal API key for authentication
      const snapshotParam = options?.createSnapshot !== false ? '?snapshot=true' : '?snapshot=false';
      await axios.delete(`${this.runtimeUrl}/slices/${session.sliceId}${snapshotParam}`, this.createInternalAuthConfig());

      // Mark session as deleted in database
      await prisma.codeSession.update({
        where: { id: sessionId },
        data: {
          status: 'deleted',
          last_activity: new Date()
        }
      });

      this.logger.info({ sessionId, sliceId: session.sliceId }, 'Code session deleted');
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to delete session');
      throw error;
    }
  }

  /**
   * Execute agentic loop
   *
   * This is the core agentic coding loop that:
   * 1. Takes user prompt
   * 2. Calls LLM with tools
   * 3. Executes tool calls
   * 4. Continues until task is complete
   */
  async executeAgenticLoop(
    sessionId: string,
    userId: string,
    prompt: string,
    model: string | undefined,
    onEvent: (event: AgenticEvent) => void
  ): Promise<void> {
    this.logger.info({ sessionId, userId, prompt: prompt.substring(0, 100) }, 'Starting agentic loop');

    const session = await this.getSession(sessionId, userId);
    if (!session) {
      throw new Error('Session not found');
    }

    const activeModel = model || session.model;

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt();

    // Define available tools
    const tools = this.getAgenticTools(session);

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    let iterations = 0;
    const MAX_ITERATIONS = 50;

    try {
      while (iterations < MAX_ITERATIONS) {
        iterations++;

        this.logger.debug({ iteration: iterations, sessionId }, 'Agentic loop iteration');

        // Call LLM via ProviderManager
        const response = await this.providerManager.createCompletion({
          messages,
          model: activeModel,
          tools: tools.map(t => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }
          })),
          stream: false
        }) as any;

        // Stream text content
        if (response.choices?.[0]?.message?.content) {
          onEvent({
            type: 'text',
            content: response.choices[0].message.content
          });
        }

        // Check if done
        const finishReason = response.choices?.[0]?.finish_reason;
        const toolCalls = response.choices?.[0]?.message?.tool_calls;

        if (finishReason === 'stop' || !toolCalls?.length) {
          this.logger.debug({ finishReason, iterations }, 'Agentic loop complete');
          break;
        }

        // Execute tool calls
        const toolResults = [];
        for (const toolCall of toolCalls) {
          const tool = tools.find(t => t.name === toolCall.function.name);
          if (!tool) {
            this.logger.warn({ toolName: toolCall.function.name }, 'Unknown tool requested');
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: `Unknown tool: ${toolCall.function.name}`
            });
            continue;
          }

          const params = JSON.parse(toolCall.function.arguments);

          onEvent({
            type: 'tool_call',
            tool: toolCall.function.name,
            toolId: toolCall.id,  // Include tool ID for UI matching
            params
          });

          try {
            const result = await tool.execute(params, session);

            onEvent({
              type: 'tool_result',
              tool: toolCall.function.name,
              toolId: toolCall.id,  // Include tool ID for UI matching
              result
            });

            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: typeof result === 'string' ? result : JSON.stringify(result)
            });

          } catch (error: any) {
            this.logger.error({ error, tool: toolCall.function.name }, 'Tool execution failed');

            onEvent({
              type: 'error',
              content: `Tool ${toolCall.function.name} failed: ${error.message}`
            });

            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: `Error: ${error.message}`
            });
          }
        }

        // Add assistant message and tool results to conversation
        messages.push({
          role: 'assistant',
          content: response.choices[0].message.content || '',
          tool_calls: toolCalls
        });

        // Add tool results
        for (const toolResult of toolResults) {
          messages.push(toolResult);
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        this.logger.warn({ sessionId, iterations }, 'Agentic loop reached max iterations');
        onEvent({
          type: 'error',
          content: 'Maximum iterations reached. Task may be incomplete.'
        });
      }

      // Update session activity
      await prisma.codeSession.update({
        where: { id: sessionId },
        data: { last_activity: new Date() }
      });

    } catch (error) {
      this.logger.error({ error, sessionId }, 'Agentic loop failed');
      throw error;
    }
  }

  /**
   * Build system prompt for agentic coding
   */
  private buildSystemPrompt(): string {
    return `You are AgenticWorkCode, an expert AI coding assistant integrated into the AgenticWork platform.

You have access to a sandboxed Linux workspace where you can:
- Read and write files
- Execute shell commands
- Use git for version control
- Install packages via pip and npm (within the container)

IMPORTANT GUIDELINES:
1. Always explain what you're about to do before doing it
2. Break complex tasks into steps
3. Use file_read to understand existing code before modifying
4. Use file_write for creating or completely replacing files
5. Use file_patch for surgical edits to existing files
6. Test your changes when possible
7. Commit meaningful changes to git with descriptive messages

SECURITY NOTES:
- You cannot access the internet directly
- You cannot install system packages (apt, etc.)
- You can only access internal AgenticWork services
- All actions are logged and auditable

When the user asks you to build something:
1. First, understand the requirements
2. Plan the implementation
3. Create necessary files
4. Test if possible
5. Explain what was created and how to use it

Be concise but thorough. Show your work.`;
  }

  /**
   * Get available agentic tools
   */
  private getAgenticTools(session: CodeSession): AgenticTool[] {
    return [
      {
        name: 'file_read',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file relative to workspace root' }
          },
          required: ['path']
        },
        execute: async (params: { path: string }, session: CodeSession) => {
          return this.execInContainer(session, `cat "${params.path}"`);
        }
      },
      {
        name: 'file_write',
        description: 'Write content to a file (creates or overwrites)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' }
          },
          required: ['path', 'content']
        },
        execute: async (params: { path: string; content: string }, session: CodeSession) => {
          // Ensure directory exists
          const dir = params.path.split('/').slice(0, -1).join('/');
          if (dir) {
            await this.execInContainer(session, `mkdir -p "${dir}"`);
          }
          // Write file using heredoc to handle special characters
          await this.execInContainer(
            session,
            `cat > "${params.path}" << 'AGENTICEOF'\n${params.content}\nAGENTICEOF`
          );
          return `File written: ${params.path}`;
        }
      },
      {
        name: 'file_patch',
        description: 'Apply a surgical edit to a file by replacing specific text',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
            search: { type: 'string', description: 'Exact text to find (must be unique in file)' },
            replace: { type: 'string', description: 'Text to replace with' }
          },
          required: ['path', 'search', 'replace']
        },
        execute: async (params: { path: string; search: string; replace: string }, session: CodeSession) => {
          // Read current content
          const content = await this.execInContainer(session, `cat "${params.path}"`);

          // Check if search text exists and is unique
          const occurrences = content.split(params.search).length - 1;
          if (occurrences === 0) {
            throw new Error('Search text not found in file');
          }
          if (occurrences > 1) {
            throw new Error(`Search text found ${occurrences} times, must be unique`);
          }

          // Apply patch
          const newContent = content.replace(params.search, params.replace);
          await this.execInContainer(
            session,
            `cat > "${params.path}" << 'AGENTICEOF'\n${newContent}\nAGENTICEOF`
          );
          return `File patched: ${params.path}`;
        }
      },
      {
        name: 'file_delete',
        description: 'Delete a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' }
          },
          required: ['path']
        },
        execute: async (params: { path: string }, session: CodeSession) => {
          await this.execInContainer(session, `rm -f "${params.path}"`);
          return `File deleted: ${params.path}`;
        }
      },
      {
        name: 'list_files',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path (default: current directory)' },
            recursive: { type: 'boolean', description: 'List recursively' }
          }
        },
        execute: async (params: { path?: string; recursive?: boolean }, session: CodeSession) => {
          const path = params.path || '.';
          const cmd = params.recursive
            ? `find "${path}" -type f | head -100`
            : `ls -la "${path}"`;
          return this.execInContainer(session, cmd);
        }
      },
      {
        name: 'shell_exec',
        description: 'Execute a shell command in the workspace',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            workDir: { type: 'string', description: 'Working directory (optional)' }
          },
          required: ['command']
        },
        execute: async (params: { command: string; workDir?: string }, session: CodeSession) => {
          return this.execInContainer(session, params.command, params.workDir);
        }
      },
      {
        name: 'git_status',
        description: 'Get git status of the workspace',
        parameters: { type: 'object', properties: {} },
        execute: async (_params: any, session: CodeSession) => {
          return this.execInContainer(session, 'git status');
        }
      },
      {
        name: 'git_diff',
        description: 'Show git diff of changes',
        parameters: {
          type: 'object',
          properties: {
            staged: { type: 'boolean', description: 'Show staged changes only' }
          }
        },
        execute: async (params: { staged?: boolean }, session: CodeSession) => {
          const cmd = params.staged ? 'git diff --staged' : 'git diff';
          return this.execInContainer(session, cmd);
        }
      },
      {
        name: 'git_commit',
        description: 'Stage all changes and commit',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' }
          },
          required: ['message']
        },
        execute: async (params: { message: string }, session: CodeSession) => {
          await this.execInContainer(session, 'git add -A');
          return this.execInContainer(session, `git commit -m "${params.message.replace(/"/g, '\\"')}"`);
        }
      },
      {
        name: 'search_code',
        description: 'Search for text/patterns in the codebase',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern (regex supported)' },
            path: { type: 'string', description: 'Path to search in (default: .)' }
          },
          required: ['pattern']
        },
        execute: async (params: { pattern: string; path?: string }, session: CodeSession) => {
          const searchPath = params.path || '.';
          return this.execInContainer(
            session,
            `grep -rn --include="*" "${params.pattern}" "${searchPath}" | head -50`
          );
        }
      }
    ];
  }

  /**
   * Execute command in sandboxed slice
   */
  private async execInSlice(
    session: CodeSession,
    command: string,
    workDir?: string
  ): Promise<string> {
    try {
      // SECURITY: Include internal API key for authentication
      const config = this.createInternalAuthConfig(35000);
      const response = await axios.post(
        `${this.runtimeUrl}/slices/${session.sliceId}/exec`,
        { command, workDir, timeout: 30000 },
        config
      );

      if (response.data.exitCode !== 0 && response.data.stderr) {
        throw new Error(response.data.stderr);
      }

      return response.data.stdout || response.data.stderr || '';
    } catch (error: any) {
      if (error.response?.data?.error) {
        throw new Error(error.response.data.error);
      }
      throw error;
    }
  }

  /**
   * @deprecated Use execInSlice instead
   */
  private async execInContainer(
    session: CodeSession,
    command: string,
    workDir?: string
  ): Promise<string> {
    return this.execInSlice(session, command, workDir);
  }

  /**
   * List files in workspace
   */
  async listFiles(sessionId: string, userId: string, path: string): Promise<any[]> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const output = await this.execInContainer(
      session,
      `find "${path}" -maxdepth 1 -printf '%y %s %f\\n' | tail -n +2`
    );

    return output.split('\n').filter(Boolean).map(line => {
      const [type, size, name] = line.split(' ');
      return {
        name,
        type: type === 'd' ? 'directory' : 'file',
        size: parseInt(size)
      };
    });
  }

  /**
   * Read file from workspace
   */
  async readFile(sessionId: string, userId: string, path: string): Promise<string> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');
    return this.execInContainer(session, `cat "${path}"`);
  }

  /**
   * Write file to workspace
   */
  async writeFile(sessionId: string, userId: string, path: string, content: string): Promise<void> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) {
      await this.execInContainer(session, `mkdir -p "${dir}"`);
    }
    await this.execInContainer(session, `cat > "${path}" << 'AGENTICEOF'\n${content}\nAGENTICEOF`);
  }

  /**
   * Delete file from workspace
   */
  async deleteFile(sessionId: string, userId: string, path: string): Promise<void> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');
    await this.execInContainer(session, `rm -rf "${path}"`);
  }
}
