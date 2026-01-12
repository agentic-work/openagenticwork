/**
 * @agenticwork/sdk Platform Client
 *
 * Full integration with the AgenticWork platform:
 * - Authentication & RBAC
 * - User context and permissions
 * - MCP server access
 * - Flowise workflow management
 * - Direct LLM provider access (NOT through /api/v1/chat/completions)
 * - Observability & telemetry
 *
 * ARCHITECTURE:
 * - Config/credentials: fetched from API (/api/agenticode/config)
 * - LLM calls: DIRECT to providers using credentials from config
 * - MCP: through API (for auth context)
 * - Flowise: through API (for auth context)
 */

import type {
  Provider,
  ProviderConfig,
  ProviderType,
  Tool,
  ToolDefinition,
  Message,
  CompletionOptions,
  CompletionResponse,
  StreamChunk,
} from './types.js';
import { createProvider, type ProviderCredentials } from '../providers/factory.js';

// ============================================
// Platform Types
// ============================================

export interface PlatformConfig {
  /** AgenticWork API endpoint */
  apiEndpoint: string;
  /** Authentication token (JWT or API key) */
  authToken?: string;
  /** OAuth client credentials */
  clientId?: string;
  clientSecret?: string;
  /** User ID for impersonation (admin only) */
  impersonateUserId?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  groups: string[];
  permissions: string[];
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  userId: string;
  createdAt: Date;
}

export interface MCPServer {
  name: string;
  description: string;
  tools: ToolDefinition[];
  status: 'connected' | 'disconnected' | 'error';
}

export interface FlowiseWorkflow {
  id: string;
  name: string;
  description?: string;
  category?: string;
  deployed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LLMModel {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  maxTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

/**
 * Agenticode configuration returned from API
 * Contains provider credentials for direct LLM access
 */
export interface AgenticodeConfig {
  /** Available providers with credentials */
  providers: AgenticodeProvider[];
  /** Model routing configuration */
  models: AgenticodeModelConfig[];
  /** Default model to use */
  defaultModel?: string;
  /** MCP servers available to user */
  mcpServers?: string[];
  /** Flowise enabled */
  flowiseEnabled?: boolean;
}

export interface AgenticodeProvider {
  /** Provider type: ollama, anthropic, openai, azure-openai, vertex-ai, bedrock */
  type: ProviderType;
  /** Unique identifier for this provider config */
  id: string;
  /** Display name */
  name: string;
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Provider-specific credentials */
  credentials: ProviderCredentials;
}

export interface AgenticodeModelConfig {
  /** Model ID (e.g., "gpt-4o", "claude-3-5-sonnet") */
  id: string;
  /** Provider ID this model belongs to */
  providerId: string;
  /** Display name */
  name: string;
  /** Whether this model is available to the user */
  available: boolean;
}

// ============================================
// Platform Client
// ============================================

export class AgenticWorkPlatform {
  private config: PlatformConfig;
  private user: User | null = null;
  private mcpServers: Map<string, MCPServer> = new Map();
  private mcpTools: Map<string, Tool> = new Map();

  // Direct provider support
  private agenticodeConfig: AgenticodeConfig | null = null;
  private providers: Map<string, Provider> = new Map();
  private modelToProvider: Map<string, string> = new Map();

  constructor(config: PlatformConfig) {
    this.config = config;
  }

  // ==========================================
  // Agenticode Configuration (Direct Provider Access)
  // ==========================================

  /**
   * Fetch agenticode configuration from API
   * This includes provider credentials for direct LLM access
   */
  async getAgenticodeConfig(): Promise<AgenticodeConfig> {
    if (this.agenticodeConfig) {
      return this.agenticodeConfig;
    }

    const response = await this.request<AgenticodeConfig>('/api/agenticode/config');
    this.agenticodeConfig = response;

    // Initialize providers from config
    for (const providerConfig of response.providers) {
      if (providerConfig.enabled) {
        try {
          const provider = createProvider(providerConfig.credentials);
          this.providers.set(providerConfig.id, provider);
        } catch (err) {
          console.error(`Failed to initialize provider ${providerConfig.id}:`, err);
        }
      }
    }

    // Build model -> provider mapping
    for (const model of response.models) {
      if (model.available) {
        this.modelToProvider.set(model.id, model.providerId);
      }
    }

    return response;
  }

  /**
   * Get provider for a specific model
   */
  getProviderForModel(modelId: string): Provider | null {
    const providerId = this.modelToProvider.get(modelId);
    if (!providerId) return null;
    return this.providers.get(providerId) || null;
  }

  /**
   * Get all initialized providers
   */
  getProviders(): Map<string, Provider> {
    return this.providers;
  }

  // ==========================================
  // Authentication
  // ==========================================

  /**
   * Authenticate with the platform
   */
  async authenticate(): Promise<User> {
    if (this.config.authToken) {
      // Validate existing token
      const user = await this.validateToken(this.config.authToken);
      this.user = user;
      return user;
    }

    if (this.config.clientId && this.config.clientSecret) {
      // OAuth client credentials flow
      const token = await this.clientCredentialsAuth();
      this.config.authToken = token;
      const user = await this.validateToken(token);
      this.user = user;
      return user;
    }

    throw new Error('No authentication credentials provided');
  }

  /**
   * Get current authenticated user
   */
  getCurrentUser(): User | null {
    return this.user;
  }

  /**
   * Check if user has permission
   */
  hasPermission(permission: string): boolean {
    if (!this.user) return false;
    if (this.user.isAdmin) return true;
    return this.user.permissions.includes(permission);
  }

  /**
   * Check if user is in group
   */
  isInGroup(group: string): boolean {
    if (!this.user) return false;
    return this.user.groups.includes(group);
  }

  private async validateToken(token: string): Promise<User> {
    // Use /api/auth/me instead of /api/auth/validate to avoid admin validation requirements
    // /api/auth/me is a GET endpoint that returns user info directly
    const response = await this.request<{
      userId: string;
      tenantId: string;
      email?: string;
      name?: string;
      isAdmin: boolean;
      groups?: string[];
    }>('/api/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    // Map the response to User format
    return {
      id: response.userId,
      email: response.email || '',
      name: response.name || '',
      isAdmin: response.isAdmin,
      groups: response.groups || [],
      permissions: response.isAdmin ? ['*'] : [],
    };
  }

  private async clientCredentialsAuth(): Promise<string> {
    const response = await this.request<{ access_token: string }>('/api/auth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    return response.access_token;
  }

  // ==========================================
  // LLM Providers
  // ==========================================

  /**
   * List available LLM models for the current user
   */
  async listModels(): Promise<LLMModel[]> {
    const response = await this.request<{ data?: Array<{ id: string; owned_by?: string }>; models?: Array<{ id: string; owned_by?: string }> }>('/api/v1/models');
    // API may return models in 'data' or 'models' field
    const models = response?.data || response?.models || [];
    return models.map((m) => ({
      id: m.id,
      name: m.id,
      provider: m.owned_by || 'unknown',
      capabilities: [],
      maxTokens: 128000,
      supportsTools: true,
      supportsVision: String(m.id).includes('vision') || String(m.id).includes('4o'),
    }));
  }

  /**
   * Create a completion using DIRECT provider access
   * Does NOT go through /api/v1/chat/completions pipeline
   */
  async complete(options: {
    model: string;
    messages: Message[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  }): Promise<CompletionResponse> {
    // Ensure config is loaded
    if (!this.agenticodeConfig) {
      await this.getAgenticodeConfig();
    }

    // Get provider for this model
    const provider = this.getProviderForModel(options.model);
    if (!provider) {
      throw new Error(`No provider available for model: ${options.model}. Call getAgenticodeConfig() first or ensure model is configured.`);
    }

    // Call provider DIRECTLY - not through API
    return provider.complete({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  /**
   * Stream a completion using DIRECT provider access
   * Does NOT go through /api/v1/chat/completions pipeline
   */
  async *streamComplete(options: {
    model: string;
    messages: Message[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): AsyncGenerator<StreamChunk> {
    // Ensure config is loaded
    if (!this.agenticodeConfig) {
      await this.getAgenticodeConfig();
    }

    // Get provider for this model
    const provider = this.getProviderForModel(options.model);
    if (!provider) {
      throw new Error(`No provider available for model: ${options.model}. Call getAgenticodeConfig() first or ensure model is configured.`);
    }

    // Stream DIRECTLY from provider - not through API
    yield* provider.stream({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  // ==========================================
  // MCP Servers
  // ==========================================

  /**
   * Get available MCP servers for the current user
   */
  async getMCPServers(): Promise<MCPServer[]> {
    const response = await this.request<{ servers?: MCPServer[] }>('/api/mcp/servers');
    const servers: MCPServer[] = response.servers || [];

    // Cache servers and tools
    for (const server of servers) {
      this.mcpServers.set(server.name, server);
      for (const tool of server.tools) {
        this.mcpTools.set(`${server.name}:${tool.name}`, {
          ...tool,
          execute: async (args) => this.executeMCPTool(server.name, tool.name, args),
        } as Tool);
      }
    }

    return servers;
  }

  /**
   * Execute an MCP tool
   */
  async executeMCPTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.request<{ result: string }>('/api/mcp/execute', {
      method: 'POST',
      body: JSON.stringify({
        server: serverName,
        tool: toolName,
        arguments: args,
      }),
    });
    return response.result;
  }

  /**
   * Get all MCP tools as Tool[] for use in Agent
   */
  getMCPTools(): Tool[] {
    return Array.from(this.mcpTools.values());
  }

  // ==========================================
  // Flowise Workflows
  // ==========================================

  /**
   * List Flowise workflows for the current user
   */
  async listWorkflows(): Promise<FlowiseWorkflow[]> {
    const response = await this.request<{ workflows?: FlowiseWorkflow[] }>('/api/flowise/workflows');
    return response.workflows || [];
  }

  /**
   * Create a new Flowise workflow
   */
  async createWorkflow(options: {
    name: string;
    description?: string;
    category?: string;
    flowData: Record<string, unknown>;
  }): Promise<FlowiseWorkflow> {
    const response = await this.request<{ workflow: FlowiseWorkflow }>('/api/flowise/workflows', {
      method: 'POST',
      body: JSON.stringify(options),
    });
    return response.workflow;
  }

  /**
   * Update a Flowise workflow
   */
  async updateWorkflow(id: string, updates: {
    name?: string;
    description?: string;
    flowData?: Record<string, unknown>;
  }): Promise<FlowiseWorkflow> {
    const response = await this.request<{ workflow: FlowiseWorkflow }>(`/api/flowise/workflows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return response.workflow;
  }

  /**
   * Delete a Flowise workflow
   */
  async deleteWorkflow(id: string): Promise<void> {
    await this.request(`/api/flowise/workflows/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Execute a Flowise workflow
   */
  async executeWorkflow(id: string, input: Record<string, unknown>): Promise<unknown> {
    const response = await this.request(`/api/flowise/workflows/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
    return response.result;
  }

  // ==========================================
  // Workspaces
  // ==========================================

  /**
   * List workspaces for the current user
   */
  async listWorkspaces(): Promise<Workspace[]> {
    const response = await this.request<{ workspaces?: Workspace[] }>('/api/workspaces');
    return response.workspaces || [];
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(name: string): Promise<Workspace> {
    const response = await this.request<{ workspace: Workspace }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return response.workspace;
  }

  /**
   * Get workspace by ID
   */
  async getWorkspace(id: string): Promise<Workspace> {
    const response = await this.request<{ workspace: Workspace }>(`/api/workspaces/${id}`);
    return response.workspace;
  }

  // ==========================================
  // Telemetry & Observability
  // ==========================================

  /**
   * Log an event to the platform
   */
  async logEvent(event: {
    type: string;
    data: Record<string, unknown>;
    timestamp?: Date;
  }): Promise<void> {
    await this.request('/api/telemetry/events', {
      method: 'POST',
      body: JSON.stringify({
        ...event,
        timestamp: event.timestamp || new Date(),
      }),
    });
  }

  /**
   * Log tool execution metrics
   */
  async logToolExecution(metrics: {
    toolName: string;
    duration: number;
    success: boolean;
    error?: string;
  }): Promise<void> {
    await this.logEvent({
      type: 'tool_execution',
      data: metrics,
    });
  }

  // ==========================================
  // Internal Helpers
  // ==========================================

  private async request<T = Record<string, unknown>>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.apiEndpoint}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken && { Authorization: `Bearer ${this.config.authToken}` }),
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Platform API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }
}
