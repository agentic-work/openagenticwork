/**
 * Tool Registry
 * Manages available tools and their execution
 * Includes robust parameter validation and unwrapping
 */

import type { ToolDefinition, ToolContext, ToolOutput, ToolCall, JsonSchema } from '../core/types.js';

const DEBUG = !!process.env.AWCODE_DEBUG;

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions for API
   */
  getDefinitions(): ToolDefinition[] {
    return this.getAll();
  }

  /**
   * Normalize and validate tool arguments
   * Handles common model mistakes like wrapping params in "value" or "input"
   */
  private normalizeArguments(
    args: Record<string, unknown>,
    schema: JsonSchema,
    toolName: string
  ): { args: Record<string, unknown>; errors: string[] } {
    let normalizedArgs = { ...args };
    const errors: string[] = [];

    // CRITICAL: Unwrap common wrapper patterns that models incorrectly use
    // Pattern 1: {"value": {"path": "...", "content": "..."}}
    // Pattern 2: {"input": {"path": "...", "content": "..."}}
    // Pattern 3: {"arguments": {"path": "...", "content": "..."}}
    const wrapperKeys = ['value', 'input', 'arguments', 'params', 'parameters'];
    for (const wrapperKey of wrapperKeys) {
      if (normalizedArgs[wrapperKey] &&
          typeof normalizedArgs[wrapperKey] === 'object' &&
          Object.keys(normalizedArgs).length === 1) {
        if (DEBUG) {
          console.error(`[Registry] Unwrapping "${wrapperKey}" wrapper for ${toolName}`);
        }
        normalizedArgs = normalizedArgs[wrapperKey] as Record<string, unknown>;
        break;
      }
    }

    // Validate required parameters
    const required = schema.required || [];
    const properties = schema.properties || {};

    for (const param of required) {
      const value = normalizedArgs[param];
      if (value === undefined || value === null) {
        errors.push(`Missing required parameter: "${param}"`);
      } else if (typeof value === 'string' && value.trim() === '') {
        errors.push(`Empty value for required parameter: "${param}"`);
      }
    }

    // Check for completely empty args when we expect parameters
    if (Object.keys(normalizedArgs).length === 0 && required.length > 0) {
      errors.push(`No parameters provided. Required: ${required.join(', ')}`);
    }

    // Log debug info
    if (DEBUG) {
      console.error(`[Registry] ${toolName} normalized args:`, JSON.stringify(normalizedArgs));
      if (errors.length > 0) {
        console.error(`[Registry] ${toolName} validation errors:`, errors);
      }
    }

    return { args: normalizedArgs, errors };
  }

  /**
   * Execute a tool call with parameter validation
   */
  async execute(
    toolCall: ToolCall,
    context: ToolContext
  ): Promise<ToolOutput> {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      return {
        content: `Error: Unknown tool "${toolCall.name}". Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
        isError: true,
      };
    }

    // Normalize and validate arguments
    const { args, errors } = this.normalizeArguments(
      toolCall.arguments || {},
      tool.inputSchema,
      toolCall.name
    );

    // If there are validation errors, return them before executing
    if (errors.length > 0) {
      const errorMsg = [
        `Tool "${toolCall.name}" parameter errors:`,
        ...errors.map(e => `  - ${e}`),
        '',
        'Expected parameters:',
        ...Object.entries(tool.inputSchema.properties || {}).map(([name, prop]) => {
          const schema = prop as JsonSchema;
          const isRequired = (tool.inputSchema.required || []).includes(name);
          return `  - ${name}${isRequired ? ' (required)' : ''}: ${schema.description || schema.type}`;
        }),
        '',
        'Received:',
        `  ${JSON.stringify(toolCall.arguments)}`,
      ].join('\n');

      return {
        content: errorMsg,
        isError: true,
      };
    }

    try {
      return await tool.handler(args, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error executing ${toolCall.name}: ${message}`,
        isError: true,
      };
    }
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
