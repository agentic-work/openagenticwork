/**
 * AWCode Core Types
 * Provider-agnostic types for LLM interactions
 */

// =============================================================================
// Message Types
// =============================================================================

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
  name?: string;           // For tool messages
  toolCallId?: string;     // For tool responses
  toolCalls?: ToolCall[];  // For assistant tool calls
}

export interface ContentPart {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  imageUrl?: string;
  toolUse?: ToolCall;
  toolResult?: ToolResult;
}

// =============================================================================
// Tool Types
// =============================================================================

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolOutput>;
}

export interface ToolContext {
  workingDirectory: string;
  signal: AbortSignal;
  onProgress?: (output: string) => void;
  sessionId?: string;  // Optional session identifier for per-session state
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  items?: JsonSchema;
  enum?: string[];
  default?: unknown;
}

// =============================================================================
// LLM Request/Response Types
// =============================================================================

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
}

export interface ChatResponse {
  id: string;
  model: string;
  message: Message;
  usage?: TokenUsage;
  finishReason: FinishReason;
}

export interface StreamChunk {
  type: 'text' | 'thinking' | 'tool_call' | 'done' | 'error';
  text?: string;           // For 'text' and 'thinking' types
  toolCall?: ToolCall;     // For 'tool_call' type
  error?: string;          // For 'error' type
  usage?: TokenUsage;      // For 'done' type
  finishReason?: FinishReason;  // For 'done' type
}

// =============================================================================
// Real-time Streaming Events
// =============================================================================

export type StreamEventType =
  | 'text'           // Text content streaming
  | 'thinking'       // Model thinking (extended thinking)
  | 'tool_pending'   // LLM decided to call a tool (shows immediately)
  | 'tool_start'     // Tool execution started
  | 'tool_progress'  // Tool output progress (streaming output)
  | 'tool_complete'  // Tool execution completed
  | 'tool_error'     // Tool execution failed
  | 'usage'          // Token usage update
  | 'done'           // Stream complete
  | 'error';         // Error occurred

export interface StreamEvent {
  type: StreamEventType;

  // For text/thinking events
  text?: string;

  // For tool events
  tool?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    status: 'pending' | 'running' | 'success' | 'error';
    output?: string;
    error?: string;
    startTime?: number;
    endTime?: number;
    duration?: number;
  };

  // For usage events
  usage?: TokenUsage;

  // For error events
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

// =============================================================================
// Session Types
// =============================================================================

export interface Session {
  id: string;
  userId: string;
  workingDirectory: string;
  messages: Message[];
  createdAt: Date;
  lastActivity: Date;
  metadata?: Record<string, unknown>;
}

export interface SessionConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: string[];  // Tool names to enable
  mcpServers?: McpServerConfig[];
}

// =============================================================================
// MCP Types
// =============================================================================

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  serverName: string;
}

// =============================================================================
// Config Types
// =============================================================================

export interface AWCodeConfig {
  apiEndpoint: string;
  apiKey?: string;
  defaultModel: string;
  workingDirectory: string;
  maxHistoryLength: number;
  telemetryEnabled: boolean;
  mcpServers: McpServerConfig[];
}
