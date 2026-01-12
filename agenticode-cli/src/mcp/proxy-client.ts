/**
 * MCP Proxy Client
 * Connects to AgenticWork's MCP Proxy service for access to all MCP tools
 * This enables the CLI to use Azure, AWS, web browsing, Flowise, etc.
 */

import type { ToolDefinition, ToolContext, ToolOutput, JsonSchema } from '../core/types.js';

export interface MCPProxyConfig {
  baseUrl: string;
  apiKey?: string;
  oboToken?: string;  // On-behalf-of token for user-specific access (Azure AD)
  timeout?: number;
}

export interface MCPServer {
  name: string;
  status: 'running' | 'stopped' | 'error';
  tools: MCPProxyTool[];
}

export interface MCPProxyTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  server: string;
}

export interface ToolCallRequest {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  oboToken?: string;
}

export interface ToolCallResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Client for connecting to the AgenticWork MCP Proxy service
 */
export class MCPProxyClient {
  private config: MCPProxyConfig;
  private tools: Map<string, MCPProxyTool> = new Map();
  private servers: Map<string, MCPServer> = new Map();

  constructor(config: MCPProxyConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Initialize connection and fetch available tools
   */
  async connect(): Promise<void> {
    try {
      // Fetch server list
      const serversResponse = await this.request<{ servers: MCPServer[] }>('/servers');

      for (const server of serversResponse.servers) {
        this.servers.set(server.name, server);

        // Register tools from this server
        for (const tool of server.tools) {
          this.tools.set(`${server.name}__${tool.name}`, {
            ...tool,
            server: server.name,
          });
        }
      }

      console.log(`[MCP Proxy] Connected. ${this.tools.size} tools available from ${this.servers.size} servers.`);
    } catch (error) {
      console.error('[MCP Proxy] Failed to connect:', error);
      throw error;
    }
  }

  /**
   * Refresh tool list from proxy
   */
  async refresh(): Promise<void> {
    this.tools.clear();
    this.servers.clear();
    await this.connect();
  }

  /**
   * Get all available tools as ToolDefinitions
   */
  getTools(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];

    for (const [fullName, tool] of this.tools) {
      definitions.push({
        name: fullName,
        description: `[MCP:${tool.server}] ${tool.description}`,
        inputSchema: tool.inputSchema,
        handler: async (args, context) => this.executeTool(fullName, args, context),
      });
    }

    return definitions;
  }

  /**
   * Get tools from a specific server
   */
  getServerTools(serverName: string): ToolDefinition[] {
    return this.getTools().filter(t => t.name.startsWith(`${serverName}__`));
  }

  /**
   * Execute a tool via the proxy
   */
  async executeTool(
    fullName: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> {
    const tool = this.tools.get(fullName);
    if (!tool) {
      return {
        content: `Tool not found: ${fullName}`,
        isError: true,
      };
    }

    const [serverName, toolName] = fullName.split('__');

    try {
      context.onProgress?.(`Calling ${toolName} on ${serverName}...`);

      const response = await this.request<ToolCallResponse>('/tools/call', {
        method: 'POST',
        body: {
          server: serverName,
          tool: toolName,
          arguments: args,
          oboToken: this.config.oboToken,
        },
      });

      if (!response.success) {
        return {
          content: response.error || 'Unknown error',
          isError: true,
        };
      }

      // Format result
      let content: string;
      if (typeof response.result === 'string') {
        content = response.result;
      } else if (Array.isArray(response.result)) {
        // MCP standard content format
        content = response.result
          .map((item: any) => {
            if (item.type === 'text') return item.text;
            if (item.type === 'image') return `[Image: ${item.mimeType}]`;
            if (item.type === 'resource') return `[Resource: ${item.uri}]`;
            return JSON.stringify(item);
          })
          .join('\n');
      } else {
        content = JSON.stringify(response.result, null, 2);
      }

      return {
        content,
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `MCP proxy error: ${message}`,
        isError: true,
      };
    }
  }

  /**
   * List available servers
   */
  listServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Check if a specific server is available
   */
  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  /**
   * Set OBO token for user-specific access
   */
  setOboToken(token: string): void {
    this.config.oboToken = token;
  }

  /**
   * Make an HTTP request to the proxy
   */
  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
    } = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    if (this.config.oboToken) {
      headers['X-OBO-Token'] = this.config.oboToken;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Create MCP proxy client from environment or config
 */
export function createMCPProxyClient(config?: Partial<MCPProxyConfig>): MCPProxyClient {
  return new MCPProxyClient({
    baseUrl: config?.baseUrl || process.env.MCP_PROXY_URL || 'http://localhost:8001',
    apiKey: config?.apiKey || process.env.MCP_PROXY_API_KEY,
    oboToken: config?.oboToken,
    timeout: config?.timeout,
  });
}
