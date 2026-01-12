/**
 * Stream Parser Utilities
 * Parses streaming content to extract tool calls, thinking, and text
 */

export interface ParsedToolCall {
  id: string;
  name: string;
  args: string;
  output: string;
  status: 'running' | 'complete';
  startTime: number;
  endTime?: number;
}

export interface ParsedStream {
  text: string;
  toolCalls: ParsedToolCall[];
  thinking: string;
}

/**
 * Parse streaming content for tool execution markers
 * Format: ● ToolName(args)
 *         ⎿ output
 */
export function parseStreamContent(content: string): ParsedStream {
  const toolCalls: ParsedToolCall[] = [];
  let text = '';
  let thinking = '';

  // Split by lines for processing
  const lines = content.split('\n');
  let currentToolCall: ParsedToolCall | null = null;
  let isInToolOutput = false;

  for (const line of lines) {
    // Check for tool call header: ● ToolName(args)
    const toolCallMatch = line.match(/^●\s+(\w+)\((.*)\)/);
    if (toolCallMatch) {
      // Save previous tool call if any
      if (currentToolCall) {
        currentToolCall.status = 'complete';
        currentToolCall.endTime = Date.now();
        toolCalls.push(currentToolCall);
      }

      // Start new tool call
      currentToolCall = {
        id: `tool_${Date.now()}_${toolCalls.length}`,
        name: toolCallMatch[1],
        args: toolCallMatch[2],
        output: '',
        status: 'running',
        startTime: Date.now(),
      };
      isInToolOutput = false;
      continue;
    }

    // Check for tool output: ⎿ output
    const outputMatch = line.match(/^\s*⎿\s+(.*)$/);
    if (outputMatch && currentToolCall) {
      currentToolCall.output += outputMatch[1] + '\n';
      isInToolOutput = true;
      continue;
    }

    // Continuation of tool output (indented lines)
    if (isInToolOutput && currentToolCall && line.match(/^\s{5,}/)) {
      currentToolCall.output += line.trim() + '\n';
      continue;
    }

    // Regular text or thinking
    if (!currentToolCall) {
      // Check for thinking tags
      if (line.includes('<thinking>') || line.includes('THINKING')) {
        thinking += line + '\n';
      } else {
        text += line + '\n';
      }
    } else {
      // We're in a tool call but this line doesn't match output format
      isInToolOutput = false;
    }
  }

  // Save last tool call if any
  if (currentToolCall) {
    currentToolCall.status = 'complete';
    currentToolCall.endTime = Date.now();
    toolCalls.push(currentToolCall);
  }

  return {
    text: text.trim(),
    toolCalls,
    thinking: thinking.trim(),
  };
}

/**
 * Extract tool calls that are still streaming (incomplete)
 */
export function extractStreamingToolCalls(content: string): ParsedToolCall[] {
  const allToolCalls: ParsedToolCall[] = [];
  const lines = content.split('\n');
  let currentToolCall: ParsedToolCall | null = null;

  for (const line of lines) {
    const toolCallMatch = line.match(/^●\s+(\w+)\((.*)\)/);
    if (toolCallMatch) {
      if (currentToolCall) {
        // Previous tool is complete
        currentToolCall.status = 'complete';
        currentToolCall.endTime = Date.now();
        allToolCalls.push(currentToolCall);
      }

      currentToolCall = {
        id: `tool_${Date.now()}_${allToolCalls.length}`,
        name: toolCallMatch[1],
        args: toolCallMatch[2],
        output: '',
        status: 'running',
        startTime: Date.now(),
      };
    } else if (currentToolCall) {
      const outputMatch = line.match(/^\s*⎿\s+(.*)$/);
      if (outputMatch) {
        currentToolCall.output += outputMatch[1] + '\n';
      } else if (line.match(/^\s{5,}/)) {
        currentToolCall.output += line.trim() + '\n';
      }
    }
  }

  // Add last tool call (still running)
  if (currentToolCall) {
    allToolCalls.push(currentToolCall);
  }

  return allToolCalls;
}
