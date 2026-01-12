/**
 * @agenticwork/sdk Core Types
 *
 * Unified types for multi-provider LLM access
 */

import { z } from 'zod';

// ============================================
// Message Types
// ============================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    mediaType?: string;
    data?: string;
    url?: string;
  };
}

export type ContentPart = TextContent | ImageContent;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

// ============================================
// Tool Types
// ============================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown> | Record<string, unknown>;
}

export interface ToolContext {
  workingDirectory: string;
  signal: AbortSignal;
  onProgress?: (output: string) => void;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<string>;

export interface Tool extends ToolDefinition {
  execute: ToolExecutor;
}

// ============================================
// Completion Types
// ============================================

export interface CompletionOptions {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
}

export interface CompletionChoice {
  index: number;
  message: Message;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CompletionResponse {
  id: string;
  model: string;
  choices: CompletionChoice[];
  usage?: TokenUsage;
}

// ============================================
// Streaming Types
// ============================================

export interface TextDelta {
  type: 'text_delta';
  text: string;
}

export interface ToolCallDelta {
  type: 'tool_call_delta';
  // During streaming, arguments come as partial JSON strings that need accumulation
  toolCall: Partial<Omit<ToolCall, 'arguments'>> & { index: number; arguments?: string | Record<string, unknown> };
}

export interface StreamDone {
  type: 'done';
  finishReason?: string;
  usage?: TokenUsage;
}

export interface StreamError {
  type: 'error';
  error: string;
}

export type StreamChunk = TextDelta | ToolCallDelta | StreamDone | StreamError;

// ============================================
// Real-time Streaming Events (for CLI-style display)
// ============================================

/**
 * Event types for CLI streaming UI
 * More granular than StreamChunk for rich terminal display
 */
export type StreamEventType =
  | 'text'           // Text content streaming
  | 'thinking'       // Model thinking (extended thinking)
  | 'tool_start'     // Tool execution started
  | 'tool_progress'  // Tool output progress (streaming output)
  | 'tool_complete'  // Tool execution completed
  | 'tool_error'     // Tool execution failed
  | 'usage'          // Token usage update
  | 'done'           // Stream complete
  | 'error';         // Error occurred

/**
 * Rich streaming event for CLI display
 * Provides detailed information about tool execution state
 */
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

// ============================================
// Provider Types
// ============================================

export type ProviderType = 'anthropic' | 'openai' | 'google' | 'ollama' | 'azure-openai' | 'vertex-ai' | 'bedrock' | 'aws-bedrock';

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  // Provider-specific options
  projectId?: string;  // Google Cloud
  location?: string;   // Vertex AI
  resourceName?: string; // Azure
}

export interface Provider {
  readonly type: ProviderType;

  /**
   * Create a completion (non-streaming)
   */
  complete(options: CompletionOptions): Promise<CompletionResponse>;

  /**
   * Create a streaming completion
   */
  stream(options: CompletionOptions): AsyncGenerator<StreamChunk>;

  /**
   * List available models
   */
  listModels(): Promise<string[]>;

  /**
   * Check if provider is healthy
   */
  healthCheck(): Promise<boolean>;
}

// ============================================
// Agentic Loop Types
// ============================================

export interface AgentConfig {
  provider: Provider;
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  maxIterations?: number;
  maxToolCalls?: number;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onText?: (text: string) => void;
}

export interface AgentRunOptions {
  prompt: string;
  context?: ToolContext;
  signal?: AbortSignal;
}

export interface AgentResult {
  messages: Message[];
  finalResponse: string;
  toolCallCount: number;
  usage?: TokenUsage;
}
