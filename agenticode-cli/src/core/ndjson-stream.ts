/**
 * NDJSON Stream Mode
 *
 * Provides NDJSON (Newline-Delimited JSON) streaming for integration with
 * web UIs like AgenticWork's Code Mode.
 *
 * Output format (stdout):
 *   {"type":"system","subtype":"init","tools":["Read","Write","Bash",...]}
 *   {"type":"assistant","subtype":"text","text":"Hello..."}
 *   {"type":"assistant","subtype":"thinking","text":"Let me think..."}
 *   {"type":"assistant","subtype":"tool_use","id":"123","name":"Read","input":{"path":"foo.ts"}}
 *   {"type":"user","subtype":"tool_result","tool_use_id":"123","content":"file contents..."}
 *   {"type":"result","subtype":"success","cost_usd":0.02,"duration_ms":1234}
 *
 * Input format (stdin):
 *   {"type":"human","content":"Write a hello world in Go"}
 */

import * as readline from 'readline';
import type { StreamEvent, ToolDefinition } from './types.js';

// ============================================================================
// NDJSON Output Types (what we emit to stdout)
// ============================================================================

export interface NDJSONSystemInit {
  type: 'system';
  subtype: 'init';
  session_id?: string;
  tools: string[];
  model?: string;
  cwd?: string;
}

export interface NDJSONAssistantText {
  type: 'assistant';
  subtype: 'text';
  text: string;
}

export interface NDJSONAssistantThinking {
  type: 'assistant';
  subtype: 'thinking';
  text: string;
}

export interface NDJSONAssistantToolUse {
  type: 'assistant';
  subtype: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface NDJSONUserToolResult {
  type: 'user';
  subtype: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface NDJSONResult {
  type: 'result';
  subtype: 'success' | 'error';
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  error?: string;
}

export type NDJSONOutput =
  | NDJSONSystemInit
  | NDJSONAssistantText
  | NDJSONAssistantThinking
  | NDJSONAssistantToolUse
  | NDJSONUserToolResult
  | NDJSONResult;

// ============================================================================
// NDJSON Input Types (what we read from stdin)
// ============================================================================

export interface NDJSONHumanMessage {
  type: 'human';
  content: string;
}

export type NDJSONInput = NDJSONHumanMessage;

// ============================================================================
// NDJSON Emitter - writes to stdout
// ============================================================================

export class NDJSONEmitter {
  private sessionId?: string;
  private startTime: number = Date.now();
  private turnCount: number = 0;

  constructor(sessionId?: string) {
    this.sessionId = sessionId;
  }

  /**
   * Emit a single NDJSON line to stdout
   */
  emit(event: NDJSONOutput): void {
    const line = JSON.stringify(event);
    process.stdout.write(line + '\n');
  }

  /**
   * Emit system init event with available tools
   */
  emitInit(tools: ToolDefinition[], model?: string, cwd?: string): void {
    this.startTime = Date.now();
    this.emit({
      type: 'system',
      subtype: 'init',
      session_id: this.sessionId,
      tools: tools.map(t => t.name),
      model,
      cwd,
    });
  }

  /**
   * Emit text content from assistant
   */
  emitText(text: string): void {
    this.emit({
      type: 'assistant',
      subtype: 'text',
      text,
    });
  }

  /**
   * Emit thinking content from assistant
   */
  emitThinking(text: string): void {
    this.emit({
      type: 'assistant',
      subtype: 'thinking',
      text,
    });
  }

  /**
   * Emit tool use from assistant
   */
  emitToolUse(id: string, name: string, input: Record<string, unknown>): void {
    this.emit({
      type: 'assistant',
      subtype: 'tool_use',
      id,
      name,
      input,
    });
  }

  /**
   * Emit tool result (after execution)
   */
  emitToolResult(toolUseId: string, content: string, isError?: boolean): void {
    this.emit({
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: toolUseId,
      content,
      is_error: isError,
    });
  }

  /**
   * Emit result (success or error)
   */
  emitResult(success: boolean, error?: string, costUsd?: number): void {
    this.turnCount++;
    this.emit({
      type: 'result',
      subtype: success ? 'success' : 'error',
      cost_usd: costUsd,
      duration_ms: Date.now() - this.startTime,
      num_turns: this.turnCount,
      error,
    });
  }

  /**
   * Convert a StreamEvent to NDJSON and emit it
   */
  emitStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'text':
        if (event.text) {
          this.emitText(event.text);
        }
        break;
      case 'thinking':
        if (event.text) {
          this.emitThinking(event.text);
        }
        break;
      case 'tool_pending':
      case 'tool_start':
        if (event.tool) {
          this.emitToolUse(event.tool.id, event.tool.name, event.tool.args);
        }
        break;
      case 'tool_complete':
        if (event.tool) {
          this.emitToolResult(event.tool.id, event.tool.output || '', false);
        }
        break;
      case 'tool_error':
        if (event.tool) {
          this.emitToolResult(event.tool.id, event.tool.error || 'Unknown error', true);
        }
        break;
      case 'done':
        // Don't emit result on 'done' - wait for explicit call
        break;
      case 'error':
        this.emitResult(false, event.error);
        break;
    }
  }
}

// ============================================================================
// NDJSON Reader - reads from stdin
// ============================================================================

export class NDJSONReader {
  private rl: readline.Interface | null = null;
  private messageQueue: string[] = [];
  private resolvers: Array<(value: NDJSONInput | null) => void> = [];
  private closed = false;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // If there's a waiting resolver, resolve it immediately
      if (this.resolvers.length > 0) {
        const resolver = this.resolvers.shift()!;
        try {
          const parsed = this.parseLine(trimmed);
          resolver(parsed);
        } catch (err) {
          // Invalid JSON - try as plain text
          resolver({ type: 'human', content: trimmed });
        }
      } else {
        // Queue the message for later
        this.messageQueue.push(trimmed);
      }
    });

    this.rl.on('close', () => {
      this.closed = true;
      // Resolve all waiting readers with null
      for (const resolver of this.resolvers) {
        resolver(null);
      }
      this.resolvers = [];
    });
  }

  /**
   * Parse a line of input
   */
  private parseLine(line: string): NDJSONInput {
    try {
      const parsed = JSON.parse(line);
      // Accept various formats:
      // { "type": "human", "content": "..." }
      // { "message": "..." }
      // { "content": "..." }
      // { "prompt": "..." }
      if (parsed.type === 'human' && parsed.content) {
        return { type: 'human', content: parsed.content };
      }
      if (parsed.message) {
        return { type: 'human', content: parsed.message };
      }
      if (parsed.content) {
        return { type: 'human', content: parsed.content };
      }
      if (parsed.prompt) {
        return { type: 'human', content: parsed.prompt };
      }
      // Unknown format, stringify it
      return { type: 'human', content: JSON.stringify(parsed) };
    } catch {
      // Not JSON, treat as plain text
      return { type: 'human', content: line };
    }
  }

  /**
   * Read the next message from stdin
   * Returns null when stdin is closed
   */
  async read(): Promise<NDJSONInput | null> {
    if (this.closed) {
      return null;
    }

    // Check if there's a queued message
    if (this.messageQueue.length > 0) {
      const line = this.messageQueue.shift()!;
      return this.parseLine(line);
    }

    // Wait for the next message
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  /**
   * Close the reader
   */
  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

// ============================================================================
// Convenience function to run a session in NDJSON mode
// ============================================================================

export async function runNDJSONSession(options: {
  session: {
    chatEvents(message: string): AsyncGenerator<StreamEvent>;
  };
  tools: ToolDefinition[];
  model?: string;
  cwd?: string;
  sessionId?: string;
}): Promise<void> {
  const { session, tools, model, cwd, sessionId } = options;
  const emitter = new NDJSONEmitter(sessionId);
  const reader = new NDJSONReader();

  // Emit init event
  emitter.emitInit(tools, model, cwd);

  // Read messages from stdin and process them
  while (true) {
    const input = await reader.read();
    if (input === null) {
      // Stdin closed
      break;
    }

    if (input.type === 'human') {
      try {
        // Process the message through the session
        const startTime = Date.now();
        for await (const event of session.chatEvents(input.content)) {
          emitter.emitStreamEvent(event);
        }
        // Emit success result
        emitter.emitResult(true, undefined, undefined);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitter.emitResult(false, message);
      }
    }
  }

  reader.close();
}
