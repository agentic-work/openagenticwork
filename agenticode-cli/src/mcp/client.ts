/**
 * MCP Client
 * Connects to Model Context Protocol servers
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig, McpTool, ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

export class MCPClient {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, McpTool> = new Map();

  /**
   * Connect to an MCP server
   */
  async connect(config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });

    const client = new Client({
      name: 'awcode',
      version: '1.0.0',
    }, {
      capabilities: {},
    });

    await client.connect(transport);

    // Store client
    this.clients.set(config.name, client);

    // Fetch and register tools
    await this.refreshTools(config.name);

    console.log(`Connected to MCP server: ${config.name}`);
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (client) {
      await client.close();
      this.clients.delete(serverName);

      // Remove tools from this server
      for (const [name, tool] of this.tools) {
        if (tool.serverName === serverName) {
          this.tools.delete(name);
        }
      }
    }
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    for (const serverName of this.clients.keys()) {
      await this.disconnect(serverName);
    }
  }

  /**
   * Refresh tools from a server
   */
  async refreshTools(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) return;

    const result = await client.listTools();

    for (const tool of result.tools) {
      const mcpTool: McpTool = {
        name: `${serverName}__${tool.name}`,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        serverName,
      };
      this.tools.set(mcpTool.name, mcpTool);
    }
  }

  /**
   * Get all available MCP tools as ToolDefinitions
   */
  getTools(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      definitions.push({
        name: tool.name,
        description: `[MCP:${tool.serverName}] ${tool.description || 'No description'}`,
        inputSchema: tool.inputSchema,
        handler: async (args, context) => this.executeTool(tool.name, args, context),
      });
    }

    return definitions;
  }

  /**
   * Execute an MCP tool
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        content: `MCP tool not found: ${toolName}`,
        isError: true,
      };
    }

    const client = this.clients.get(tool.serverName);
    if (!client) {
      return {
        content: `MCP server not connected: ${tool.serverName}`,
        isError: true,
      };
    }

    try {
      // Extract original tool name (remove server prefix)
      const originalName = toolName.replace(`${tool.serverName}__`, '');

      const result = await client.callTool({
        name: originalName,
        arguments: args,
      });

      // Format result
      let content: string;
      if (result.content && Array.isArray(result.content)) {
        content = result.content
          .map((c: any) => {
            if (c.type === 'text') return c.text;
            if (c.type === 'image') return `[Image: ${c.mimeType}]`;
            return JSON.stringify(c);
          })
          .join('\n');
      } else {
        content = JSON.stringify(result, null, 2);
      }

      return {
        content,
        isError: (result.isError as boolean | undefined) || false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `MCP tool error: ${message}`,
        isError: true,
      };
    }
  }

  /**
   * Check if connected to any servers
   */
  isConnected(): boolean {
    return this.clients.size > 0;
  }

  /**
   * Get list of connected servers
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }
}
