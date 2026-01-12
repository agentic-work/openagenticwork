/**
 * XML Tool Call Parser
 *
 * Fallback parser for when LLMs generate XML tool calls in text output
 * instead of using native tool calling.
 *
 * Handles formats like:
 * <invoke name="write_file">
 *   <parameter name="path">file.txt</parameter>
 *   <parameter name="content">hello</parameter>
 * </invoke>
 *
 * Also handles malformed formats where model wraps params in "value":
 * <parameter name="value">{"path": "file.txt", "content": "hello"}</parameter>
 */

import type { ToolCall } from './types.js';

/**
 * Check if text contains XML tool call patterns
 */
export function containsXMLToolCalls(text: string): boolean {
  // Check for common XML tool patterns
  return (
    text.includes('<invoke') ||
    text.includes('<tool_call') ||
    text.includes('<function_call') ||
    text.includes('<tool>') && text.includes('</tool>')
  );
}

/**
 * Parse XML tool calls from text output
 * Returns extracted tool calls and the text with tool calls removed
 */
export function parseXMLToolCalls(text: string): {
  toolCalls: ToolCall[];
  cleanedText: string;
} {
  const toolCalls: ToolCall[] = [];
  let cleanedText = text;

  // Pattern 1: <invoke name="tool_name">...</invoke>
  const invokePattern = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  let match: RegExpExecArray | null;

  while ((match = invokePattern.exec(text)) !== null) {
    const [fullMatch, toolName, content] = match;
    const args = parseInvokeParameters(content);

    if (toolName && Object.keys(args).length > 0) {
      toolCalls.push({
        id: `xml_${Date.now()}_${toolCalls.length}`,
        name: toolName,
        arguments: args,
      });
    }

    // Remove from text
    cleanedText = cleanedText.replace(fullMatch, '');
  }

  // Pattern 2: <tool>name</tool><tool_input>...</tool_input> (XMLAgent format)
  const xmlAgentPattern = /<tool>([^<]+)<\/tool>\s*<tool_input>([\s\S]*?)<\/tool_input>/g;

  while ((match = xmlAgentPattern.exec(text)) !== null) {
    const [fullMatch, toolName, toolInput] = match;

    // Try to parse tool_input as JSON, otherwise use as string value
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolInput.trim());
    } catch {
      // If not JSON, use as input parameter
      args = { input: toolInput.trim() };
    }

    if (toolName) {
      toolCalls.push({
        id: `xml_${Date.now()}_${toolCalls.length}`,
        name: toolName.trim(),
        arguments: args,
      });
    }

    cleanedText = cleanedText.replace(fullMatch, '');
  }

  // Pattern 3: <function_call name="...">...</function_call>
  const funcPattern = /<function_call\s+name="([^"]+)">([\s\S]*?)<\/function_call>/g;

  while ((match = funcPattern.exec(text)) !== null) {
    const [fullMatch, toolName, content] = match;

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(content.trim());
    } catch {
      args = parseInvokeParameters(content);
    }

    if (toolName && Object.keys(args).length > 0) {
      toolCalls.push({
        id: `xml_${Date.now()}_${toolCalls.length}`,
        name: toolName,
        arguments: args,
      });
    }

    cleanedText = cleanedText.replace(fullMatch, '');
  }

  // Clean up extra whitespace from removed tool calls
  cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanedText };
}

/**
 * Parse parameters from inside an <invoke> block
 * Handles both proper format and "value" wrapper format
 */
function parseInvokeParameters(content: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  // Pattern: <parameter name="paramName">value</parameter>
  const paramPattern = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;
  let match: RegExpExecArray | null;

  while ((match = paramPattern.exec(content)) !== null) {
    const [, paramName, paramValue] = match;

    if (paramName === 'value') {
      // Handle the malformed "value" wrapper pattern
      // <parameter name="value">{"path": "...", "content": "..."}</parameter>
      try {
        const parsed = JSON.parse(paramValue.trim());
        if (typeof parsed === 'object' && parsed !== null) {
          // Merge the parsed object into args
          Object.assign(args, parsed);
        } else {
          args.value = parsed;
        }
      } catch {
        // If not valid JSON, store as-is
        args.value = paramValue.trim();
      }
    } else {
      // Normal parameter
      // Try to parse as JSON in case it's a complex value
      try {
        args[paramName] = JSON.parse(paramValue.trim());
      } catch {
        // Store as string
        args[paramName] = paramValue.trim();
      }
    }
  }

  return args;
}

/**
 * Unwrap common wrapper patterns in tool arguments
 * Handles: {"value": {...}}, {"input": {...}}, {"arguments": {...}}, etc.
 */
export function unwrapToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const wrapperKeys = ['value', 'input', 'arguments', 'params', 'parameters'];

  for (const wrapperKey of wrapperKeys) {
    if (
      args[wrapperKey] &&
      typeof args[wrapperKey] === 'object' &&
      !Array.isArray(args[wrapperKey]) &&
      Object.keys(args).length === 1
    ) {
      // This looks like a wrapper - unwrap it
      console.error(`[XML Parser] Unwrapping "${wrapperKey}" wrapper from tool arguments`);
      return args[wrapperKey] as Record<string, unknown>;
    }
  }

  return args;
}
