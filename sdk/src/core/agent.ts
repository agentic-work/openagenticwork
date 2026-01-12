/**
 * @agenticwork/sdk Agentic Loop
 *
 * Core agentic loop implementation that handles:
 * - Streaming responses
 * - Tool execution
 * - Conversation management
 * - Automatic iteration until task completion
 */

import type {
  Message,
  Tool,
  ToolCall,
  ToolResult,
  ToolContext,
  Provider,
  AgentConfig,
  AgentRunOptions,
  AgentResult,
  StreamChunk,
  TokenUsage,
} from './types.js';

// During streaming, tool call arguments are accumulated as strings before parsing
interface PendingToolCall {
  index: number;
  id?: string;
  name?: string;
  arguments?: string | Record<string, unknown>;
}

const DEFAULT_SYSTEM_PROMPT = `You are an AI coding assistant. You help developers by:
- Reading, writing, and editing files
- Running shell commands
- Searching codebases
- Explaining code

Guidelines:
- Be concise and direct
- Use tools to gather information before making assumptions
- After completing a task, summarize what was done in text
- Do NOT keep calling tools after the task is complete`;

export class Agent {
  private provider: Provider;
  private model: string;
  private systemPrompt: string;
  private tools: Map<string, Tool>;
  private maxIterations: number;
  private maxToolCalls: number;
  private onToolCall?: (toolCall: ToolCall) => void;
  private onToolResult?: (result: ToolResult) => void;
  private onText?: (text: string) => void;

  constructor(config: AgentConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.tools = new Map();
    this.maxIterations = config.maxIterations ?? 10;
    this.maxToolCalls = config.maxToolCalls ?? 25;
    this.onToolCall = config.onToolCall;
    this.onToolResult = config.onToolResult;
    this.onText = config.onText;

    // Register tools
    for (const tool of config.tools || []) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Run the agentic loop with streaming
   */
  async *run(options: AgentRunOptions): AsyncGenerator<string, AgentResult, unknown> {
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: options.prompt },
    ];

    const context: ToolContext = options.context || {
      workingDirectory: process.cwd(),
      signal: options.signal || new AbortController().signal,
    };

    let iterations = 0;
    let totalToolCalls = 0;
    let totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finalResponse = '';

    while (iterations < this.maxIterations) {
      iterations++;

      // Stream the completion
      let assistantContent = '';
      const toolCalls: ToolCall[] = [];
      let currentToolCall: PendingToolCall | null = null;

      const toolDefs = Array.from(this.tools.values()).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      const stream = this.provider.stream({
        model: this.model,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        stream: true,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'text_delta') {
          assistantContent += chunk.text;
          this.onText?.(chunk.text);
          yield chunk.text;
        } else if (chunk.type === 'tool_call_delta') {
          // Accumulate tool call
          const tc = chunk.toolCall;
          if (tc.id) {
            // New tool call starting
            if (currentToolCall && currentToolCall.id) {
              toolCalls.push(this.finalizeToolCall(currentToolCall));
            }
            currentToolCall = {
              index: tc.index,
              id: tc.id,
              name: tc.name || '',
              arguments: tc.arguments || {},
            };
          } else if (currentToolCall) {
            // Continue building current tool call
            if (tc.name) currentToolCall.name = (currentToolCall.name || '') + tc.name;
            if (tc.arguments) {
              // Arguments come as partial JSON strings, need to accumulate
              const existingArgs = typeof currentToolCall.arguments === 'string'
                ? currentToolCall.arguments
                : JSON.stringify(currentToolCall.arguments || {});
              const newArgs = typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments);
              currentToolCall.arguments = existingArgs + newArgs;
            }
          }
        } else if (chunk.type === 'done') {
          // Finalize any pending tool call
          if (currentToolCall && currentToolCall.id) {
            toolCalls.push(this.finalizeToolCall(currentToolCall));
          }

          if (chunk.usage) {
            totalUsage.promptTokens += chunk.usage.promptTokens;
            totalUsage.completionTokens += chunk.usage.completionTokens;
            totalUsage.totalTokens += chunk.usage.totalTokens;
          }
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error);
        }
      }

      // Add assistant message to history
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent,
      };
      if (toolCalls.length > 0) {
        assistantMessage.toolCalls = toolCalls;
      }
      messages.push(assistantMessage);

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        finalResponse = assistantContent;
        break;
      }

      // Execute tool calls
      totalToolCalls += toolCalls.length;

      for (const toolCall of toolCalls) {
        this.onToolCall?.(toolCall);

        const tool = this.tools.get(toolCall.name);
        if (!tool) {
          const errorResult: ToolResult = {
            toolCallId: toolCall.id,
            content: `Unknown tool: ${toolCall.name}`,
            isError: true,
          };
          this.onToolResult?.(errorResult);
          messages.push({
            role: 'tool',
            content: errorResult.content,
            toolCallId: toolCall.id,
          });
          continue;
        }

        try {
          const output = await tool.execute(toolCall.arguments, context);
          const result: ToolResult = {
            toolCallId: toolCall.id,
            content: output,
            isError: false,
          };
          this.onToolResult?.(result);
          messages.push({
            role: 'tool',
            content: output,
            toolCallId: toolCall.id,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const result: ToolResult = {
            toolCallId: toolCall.id,
            content: `Error: ${errorMessage}`,
            isError: true,
          };
          this.onToolResult?.(result);
          messages.push({
            role: 'tool',
            content: result.content,
            toolCallId: toolCall.id,
          });
        }
      }

      // Safety: force summary if too many tool calls
      if (totalToolCalls >= this.maxToolCalls) {
        messages.push({
          role: 'user',
          content: 'The task appears complete. Please provide a brief summary of what was done.',
        });
      }
    }

    return {
      messages,
      finalResponse,
      toolCallCount: totalToolCalls,
      usage: totalUsage,
    };
  }

  /**
   * Run without streaming - returns final result directly
   */
  async execute(options: AgentRunOptions): Promise<AgentResult> {
    const generator = this.run(options);
    let result: IteratorResult<string, AgentResult>;

    // Consume all yielded text
    do {
      result = await generator.next();
    } while (!result.done);

    return result.value;
  }

  /**
   * Finalize a partial tool call into a complete ToolCall
   */
  private finalizeToolCall(partial: PendingToolCall): ToolCall {
    let args: Record<string, unknown> = {};

    if (typeof partial.arguments === 'string') {
      try {
        args = JSON.parse(partial.arguments);
      } catch {
        args = { raw: partial.arguments };
      }
    } else if (partial.arguments) {
      args = partial.arguments;
    }

    return {
      id: partial.id || `call_${Date.now()}_${partial.index}`,
      name: partial.name || 'unknown',
      arguments: args,
    };
  }

  /**
   * Add a tool dynamically
   */
  addTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Remove a tool
   */
  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Update system prompt
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Update model
   */
  setModel(model: string): void {
    this.model = model;
  }
}
