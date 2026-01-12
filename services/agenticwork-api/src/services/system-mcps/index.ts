/**
 * SYSTEM MCPs
 *
 * System MCPs are internal MCPs that provide specialized capabilities to the LLM
 * without being exposed as user-visible tools. They inject system prompts and
 * tool definitions to enable specific functionality.
 *
 * Unlike regular MCPs (which connect to external services), system MCPs are
 * built-in capabilities that enhance the LLM's abilities.
 *
 * NOTE: The diagram MCP has been DEPRECATED in favor of the artifact system.
 * LLMs should now generate Mermaid diagrams using ```mermaid code blocks
 * or ```artifact:mermaid for live rendering in the UI.
 */

// All registered system MCPs (diagram MCP removed - use artifacts instead)
export const SYSTEM_MCPS = {} as const;

// Get system prompts for active MCPs based on user message context
export function getSystemMcpPrompts(_userMessage: string): string[] {
  // Diagram MCP deprecated - use artifact system with Mermaid instead
  return [];
}

// Get tool definitions for active MCPs
export function getSystemMcpTools(_userMessage: string): any[] {
  // Diagram MCP deprecated - use artifact system with Mermaid instead
  return [];
}

// Check if a tool call is for a system MCP
export function isSystemMcpTool(_toolName: string): boolean {
  // Diagram MCP deprecated
  return false;
}

// Process a system MCP tool call
export async function processSystemMcpToolCall(
  toolName: string,
  _toolInput: unknown
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  // All system MCP tools have been deprecated
  return {
    success: false,
    error: `System MCP tool '${toolName}' has been deprecated. Use the artifact system instead.`,
  };
}

// Legacy exports for backwards compatibility (all deprecated)
export const DIAGRAM_MCP_NAME = 'diagram-generator-deprecated';
export const DIAGRAM_SYSTEM_PROMPT = '';
export const DIAGRAM_TOOL_DEFINITION = null;
export function isDiagramRequest(_message: string): boolean {
  return false; // Deprecated - always return false
}
export function validateDiagram(_diagram: unknown): { valid: boolean; errors: string[] } {
  return { valid: false, errors: ['Diagram MCP is deprecated. Use artifact:mermaid instead.'] };
}

export default SYSTEM_MCPS;
