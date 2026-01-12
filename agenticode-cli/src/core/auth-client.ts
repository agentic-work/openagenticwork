/**
 * AgentiCode Authenticated Client
 *
 * Wraps the AgenticWork SDK for authenticated API access.
 * All agenticode operations go through this client to ensure:
 * - User authentication and authorization
 * - Proper model routing based on user permissions
 * - Access to MCP tools configured for the user
 * - Context/memory stored in user's space (Milvus/Redis)
 */

import { AgenticWork } from '@agentic-work/sdk';
import type { Tool as SDKTool, StreamChunk as SDKStreamChunk, Message as SDKMessage, ToolDefinition as SDKToolDefinition } from '@agentic-work/sdk';
import type { ModeConfig } from './mode.js';

export interface AuthClientConfig {
  apiEndpoint: string;
  authToken?: string;
  userId?: string;
  tenantId?: string;
}

export interface AuthClientState {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  userEmail?: string;
  userName?: string;
  isAdmin: boolean;
  availableModels: string[];
  defaultModel?: string;
}

/**
 * Authenticated client for AgentiCode
 * Manages SDK initialization and provides typed access to platform features
 */
export class AuthClient {
  private sdk: AgenticWork | null = null;
  private config: AuthClientConfig;
  private state: AuthClientState = {
    authenticated: false,
    isAdmin: false,
    availableModels: [],
  };

  constructor(config: AuthClientConfig) {
    this.config = config;
  }

  /**
   * Create from mode config
   */
  static fromMode(modeConfig: ModeConfig): AuthClient {
    return new AuthClient({
      apiEndpoint: modeConfig.apiEndpoint,
      authToken: modeConfig.authToken,
      userId: modeConfig.userId,
      tenantId: modeConfig.tenantId,
    });
  }

  /**
   * Initialize and authenticate
   * Must be called before using any other methods
   */
  async init(): Promise<AuthClientState> {
    if (!this.config.authToken) {
      throw new Error('Authentication required. Please login first.');
    }

    try {
      // Initialize SDK with platform config
      this.sdk = new AgenticWork({
        apiEndpoint: this.config.apiEndpoint,
        authToken: this.config.authToken,
      });

      // Authenticate and load user context
      await this.sdk.init();

      // Get user info
      const user = this.sdk.user;
      if (user) {
        this.state = {
          authenticated: true,
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          isAdmin: user.isAdmin,
          availableModels: [],
        };
      }

      // Load available models
      const models = await this.sdk.listModels();
      this.state.availableModels = (models || []).map(m => m.id);

      // Fetch agenticode config to get the correct defaultModel
      // The API returns defaultModel based on smart priority (Claude Opus > Sonnet > Haiku > Gemini)
      try {
        const configResponse = await fetch(`${this.config.apiEndpoint}/api/agenticode/config`, {
          headers: {
            'Authorization': `Bearer ${this.config.authToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (configResponse.ok) {
          const agenticodeConfig = await configResponse.json() as { defaultModel?: string };
          if (agenticodeConfig.defaultModel) {
            this.state.defaultModel = agenticodeConfig.defaultModel;
          }
        }
      } catch (err) {
        // Fall back to first model if config fetch fails
        if (models && models.length > 0) {
          this.state.defaultModel = models[0].id;
        }
      }

      // Final fallback to first model if still not set
      if (!this.state.defaultModel && models && models.length > 0) {
        this.state.defaultModel = models[0].id;
      }

      return this.state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Authentication failed: ${message}`);
    }
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.state.authenticated;
  }

  /**
   * Get current state
   */
  getState(): AuthClientState {
    return { ...this.state };
  }

  /**
   * Get available models
   */
  getAvailableModels(): string[] {
    return [...this.state.availableModels];
  }

  /**
   * Get default model
   */
  getDefaultModel(): string {
    return this.state.defaultModel || 'gpt-oss';
  }

  /**
   * Check permission
   */
  can(permission: string): boolean {
    if (!this.sdk) return false;
    return this.sdk.can(permission);
  }

  /**
   * Get MCP tools available to this user
   * Returns SDK Tool type for compatibility with tool registry
   */
  getMCPTools(): SDKTool[] {
    if (!this.sdk) return [];
    return this.sdk.getMCPTools();
  }

  /**
   * Stream a completion using SDK types
   */
  async *streamComplete(options: {
    model: string;
    messages: SDKMessage[];
    tools?: SDKToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): AsyncGenerator<SDKStreamChunk> {
    if (!this.sdk) {
      throw new Error('Not authenticated. Call init() first.');
    }

    yield* this.sdk.streamComplete({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  /**
   * Simple completion (non-streaming) using SDK types
   */
  async complete(options: {
    model: string;
    messages: SDKMessage[];
    tools?: SDKToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }) {
    if (!this.sdk) {
      throw new Error('Not authenticated. Call init() first.');
    }

    return this.sdk.complete({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  /**
   * Get MCP servers
   */
  async getMCPServers() {
    if (!this.sdk) return [];
    return this.sdk.getMCPServers();
  }

  /**
   * Execute MCP tool
   */
  async executeMCPTool(serverName: string, toolName: string, args: Record<string, unknown>) {
    if (!this.sdk) {
      throw new Error('Not authenticated');
    }
    return this.sdk.executeMCPTool(serverName, toolName, args);
  }

  /**
   * Get underlying SDK for advanced operations
   */
  getSDK(): AgenticWork | null {
    return this.sdk;
  }
}

/**
 * Create auth client from environment
 */
export function createAuthClientFromEnv(): AuthClient {
  return new AuthClient({
    apiEndpoint: process.env.AGENTICWORK_API_ENDPOINT ||
      process.env.AGENTICWORK_API_URL ||
      'http://localhost:8000',
    authToken: process.env.AGENTICODE_AUTH_TOKEN ||
      process.env.AGENTICWORK_API_TOKEN,
    userId: process.env.AGENTICODE_USER_ID,
    tenantId: process.env.AGENTICODE_TENANT_ID,
  });
}
