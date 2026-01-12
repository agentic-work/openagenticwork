/**
 * @agenticwork/sdk
 *
 * The official SDK for the AgenticWork platform.
 *
 * Features:
 * - Direct LLM provider access (no pipeline overhead)
 * - Platform authentication & RBAC
 * - MCP server integration
 * - Flowise workflow management
 * - Agentic loop with tool execution
 * - Workspace management
 * - Observability & telemetry
 *
 * @example
 * ```typescript
 * import { AgenticWork, Agent } from '@agenticwork/sdk';
 *
 * // Initialize with platform access
 * const aw = new AgenticWork({
 *   apiEndpoint: 'https://api.agenticwork.io',
 *   authToken: process.env.AGENTICWORK_TOKEN,
 * });
 *
 * // Authenticate and load user context
 * await aw.init();
 *
 * // Create an agent with MCP tools
 * const agent = aw.createAgent({
 *   model: 'gpt-oss',
 *   tools: [...aw.getMCPTools(), ...myLocalTools],
 * });
 *
 * // Run the agent
 * for await (const text of agent.run({ prompt: 'Create a hello world app' })) {
 *   process.stdout.write(text);
 * }
 * ```
 */

// Core types
export type {
  Message,
  MessageRole,
  ContentPart,
  TextContent,
  ImageContent,
  ToolCall,
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolExecutor,
  Tool,
  CompletionOptions,
  CompletionResponse,
  CompletionChoice,
  TokenUsage,
  StreamChunk,
  TextDelta,
  ToolCallDelta,
  StreamDone,
  StreamError,
  // CLI streaming types
  StreamEvent,
  StreamEventType,
  Provider,
  ProviderType,
  ProviderConfig,
  AgentConfig,
  AgentRunOptions,
  AgentResult,
} from './core/types.js';

// Platform types
export type {
  PlatformConfig,
  User,
  Workspace,
  MCPServer,
  FlowiseWorkflow,
  LLMModel,
} from './core/platform.js';

// Core classes
export { Agent } from './core/agent.js';
export { AgenticWorkPlatform } from './core/platform.js';

// Providers
export { OllamaProvider } from './providers/ollama.js';

// Re-export for convenience
import { AgenticWorkPlatform, type PlatformConfig } from './core/platform.js';
import { Agent, } from './core/agent.js';
import type { Tool, AgentConfig } from './core/types.js';

/**
 * Main SDK class - unified entry point for AgenticWork platform
 */
export class AgenticWork {
  private platform: AgenticWorkPlatform;
  private initialized = false;

  constructor(config: PlatformConfig) {
    this.platform = new AgenticWorkPlatform(config);
  }

  /**
   * Initialize the SDK - authenticate and load user context
   */
  async init(): Promise<void> {
    await this.platform.authenticate();
    // MCP servers are optional - don't fail init if endpoint doesn't exist
    try {
      await this.platform.getMCPServers();
    } catch (err) {
      // MCP endpoint may not exist - that's OK, continue without MCP
      console.warn('MCP servers not available:', err instanceof Error ? err.message : String(err));
    }
    this.initialized = true;
  }

  /**
   * Get the underlying platform client
   */
  getPlatform(): AgenticWorkPlatform {
    return this.platform;
  }

  /**
   * Get current user
   */
  get user() {
    return this.platform.getCurrentUser();
  }

  /**
   * Check permission
   */
  can(permission: string): boolean {
    return this.platform.hasPermission(permission);
  }

  /**
   * Get all MCP tools available to the user
   */
  getMCPTools(): Tool[] {
    return this.platform.getMCPTools();
  }

  /**
   * Create an agent with platform integration
   */
  createAgent(config: Omit<AgentConfig, 'provider'> & {
    /** Use platform LLM routing instead of direct provider */
    usePlatformRouting?: boolean;
  }): Agent {
    // Create a platform-backed provider
    const platformProvider = {
      type: 'agenticwork' as const,
      complete: async (options: Parameters<AgenticWorkPlatform['complete']>[0]) => {
        return this.platform.complete(options);
      },
      stream: (options: Parameters<AgenticWorkPlatform['streamComplete']>[0]) => {
        return this.platform.streamComplete(options);
      },
      listModels: async () => {
        const models = await this.platform.listModels();
        return models.map(m => m.id);
      },
      healthCheck: async () => true,
    };

    return new Agent({
      ...config,
      provider: platformProvider as unknown as AgentConfig['provider'],
    });
  }

  // ==========================================
  // Convenience methods
  // ==========================================

  /**
   * List available models
   */
  async listModels() {
    return this.platform.listModels();
  }

  /**
   * List MCP servers
   */
  async getMCPServers() {
    return this.platform.getMCPServers();
  }

  /**
   * Execute an MCP tool directly
   */
  async executeMCPTool(serverName: string, toolName: string, args: Record<string, unknown>) {
    return this.platform.executeMCPTool(serverName, toolName, args);
  }

  /**
   * List Flowise workflows
   */
  async listWorkflows() {
    return this.platform.listWorkflows();
  }

  /**
   * Create a Flowise workflow
   */
  async createWorkflow(options: Parameters<AgenticWorkPlatform['createWorkflow']>[0]) {
    return this.platform.createWorkflow(options);
  }

  /**
   * Execute a Flowise workflow
   */
  async executeWorkflow(id: string, input: Record<string, unknown>) {
    return this.platform.executeWorkflow(id, input);
  }

  /**
   * List workspaces
   */
  async listWorkspaces() {
    return this.platform.listWorkspaces();
  }

  /**
   * Create a workspace
   */
  async createWorkspace(name: string) {
    return this.platform.createWorkspace(name);
  }

  /**
   * Simple completion (no agent loop)
   */
  async complete(options: Parameters<AgenticWorkPlatform['complete']>[0]) {
    return this.platform.complete(options);
  }

  /**
   * Streaming completion (no agent loop)
   */
  streamComplete(options: Parameters<AgenticWorkPlatform['streamComplete']>[0]) {
    return this.platform.streamComplete(options);
  }
}

// Default export
export default AgenticWork;
