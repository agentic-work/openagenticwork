/**
 * Agenticode Streaming Protocol
 *
 * Defines structured events for real-time UI updates from agenticode-manager.
 * These events drive the Code Mode UI visualization and inline tool displays.
 */

// Activity states for the canvas
export type ActivityState =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'editing'
  | 'executing'
  | 'artifact'
  | 'error';

// Base event interface
export interface AgenticodeEvent {
  type: AgenticodeEventType;
  timestamp: number;
  sessionId: string;
}

// All possible event types
export type AgenticodeEventType =
  | 'session_started'
  | 'session_ended'
  | 'thinking_start'
  | 'thinking_update'
  | 'thinking_end'
  | 'thinking_block'  // Legacy thinking event
  | 'text_block'      // Text response event
  | 'file_write_start'
  | 'file_write_chunk'
  | 'file_write_end'
  | 'file_edit_start'
  | 'file_edit_diff'
  | 'file_edit_end'
  | 'command_start'
  | 'command_output'
  | 'command_end'
  | 'artifact_detected'
  | 'artifact_ready'
  | 'tool_start'
  | 'tool_use_start'  // Legacy tool start event
  | 'tool_end'
  | 'tool_result'     // Legacy tool result event
  | 'todo_update'     // Todo list update
  | 'usage'
  | 'error'
  | 'message';

// Todo item status (like Agenticode CLI)
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

// Todo item structure
export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  activeForm?: string; // Present continuous form shown during execution
  createdAt: number;
  completedAt?: number;
}

// Todo update event
export interface TodoUpdateEvent extends AgenticodeEvent {
  type: 'todo_update';
  todos: TodoItem[];
}

// Session events
export interface SessionStartedEvent extends AgenticodeEvent {
  type: 'session_started';
  workspacePath: string;
  model: string;
}

export interface SessionEndedEvent extends AgenticodeEvent {
  type: 'session_ended';
  reason: 'user' | 'timeout' | 'error';
}

// Thinking events
export interface ThinkingStartEvent extends AgenticodeEvent {
  type: 'thinking_start';
  context?: string; // e.g., "Analyzing request", "Planning architecture"
}

export interface ThinkingUpdateEvent extends AgenticodeEvent {
  type: 'thinking_update';
  step: string; // Current thinking step
  progress?: number; // 0-100 if estimable
}

export interface ThinkingEndEvent extends AgenticodeEvent {
  type: 'thinking_end';
}

// File writing events (new file creation)
export interface FileWriteStartEvent extends AgenticodeEvent {
  type: 'file_write_start';
  path: string;
  language: string;
  estimatedLines?: number;
}

export interface FileWriteChunkEvent extends AgenticodeEvent {
  type: 'file_write_chunk';
  path: string;
  content: string; // Chunk of code to append
  lineStart: number;
  lineEnd: number;
}

export interface FileWriteEndEvent extends AgenticodeEvent {
  type: 'file_write_end';
  path: string;
  totalLines: number;
  totalBytes: number;
}

// File editing events (modifications)
export interface FileEditStartEvent extends AgenticodeEvent {
  type: 'file_edit_start';
  path: string;
  description?: string; // What's being changed
}

export interface FileEditDiffEvent extends AgenticodeEvent {
  type: 'file_edit_diff';
  path: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  removed: string[];
  added: string[];
}

export interface FileEditEndEvent extends AgenticodeEvent {
  type: 'file_edit_end';
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

// Command execution events
export interface CommandStartEvent extends AgenticodeEvent {
  type: 'command_start';
  command: string;
  cwd?: string;
}

export interface CommandOutputEvent extends AgenticodeEvent {
  type: 'command_output';
  output: string;
  stream: 'stdout' | 'stderr';
}

export interface CommandEndEvent extends AgenticodeEvent {
  type: 'command_end';
  exitCode: number;
  duration: number; // ms
}

// Artifact events
export interface ArtifactDetectedEvent extends AgenticodeEvent {
  type: 'artifact_detected';
  artifactType: ArtifactType;
  name: string;
  description?: string;
}

export interface ArtifactReadyEvent extends AgenticodeEvent {
  type: 'artifact_ready';
  artifactType: ArtifactType;
  name: string;
  url?: string; // For running apps
  port?: number;
  content?: string; // For inline artifacts (HTML, SVG)
  entryPoint?: string; // Main file path
}

export type ArtifactType =
  | 'react-app'
  | 'web-app'
  | 'html-page'
  | 'diagram'
  | 'chart'
  | 'game'
  | 'api-response'
  | 'document'
  | 'image'
  | 'script-output';

// Error event
export interface ErrorEvent extends AgenticodeEvent {
  type: 'error';
  message: string;
  code?: string;
  recoverable: boolean;
}

// Generic message (for conversation)
export interface MessageEvent extends AgenticodeEvent {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
}

// Tool execution events
export interface ToolStartEvent extends AgenticodeEvent {
  type: 'tool_start';
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent extends AgenticodeEvent {
  type: 'tool_end';
  toolId: string;
  toolName: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  duration: number; // ms
}

// Token usage event
export interface UsageEvent extends AgenticodeEvent {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
}

// Legacy thinking block event (from eventEmitter)
export interface ThinkingBlockEvent extends AgenticodeEvent {
  type: 'thinking_block';
  text: string;
}

// Text block event (from eventEmitter)
export interface TextBlockEvent extends AgenticodeEvent {
  type: 'text_block';
  text: string;
}

// Legacy tool use start event
export interface ToolUseStartEvent extends AgenticodeEvent {
  type: 'tool_use_start';
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

// Legacy tool result event
export interface ToolResultEvent extends AgenticodeEvent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

// Union type for all events
export type AgenticodeStreamEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | ThinkingStartEvent
  | ThinkingUpdateEvent
  | ThinkingEndEvent
  | ThinkingBlockEvent
  | TextBlockEvent
  | FileWriteStartEvent
  | FileWriteChunkEvent
  | FileWriteEndEvent
  | FileEditStartEvent
  | FileEditDiffEvent
  | FileEditEndEvent
  | CommandStartEvent
  | CommandOutputEvent
  | CommandEndEvent
  | ArtifactDetectedEvent
  | ArtifactReadyEvent
  | ToolStartEvent
  | ToolUseStartEvent
  | ToolEndEvent
  | ToolResultEvent
  | UsageEvent
  | ErrorEvent
  | MessageEvent;

// Activity canvas state
export interface ActivityCanvasState {
  state: ActivityState;
  // Thinking state data
  thinkingContext?: string;
  thinkingSteps?: string[];
  // Writing state data
  writingFile?: string;
  writingLanguage?: string;
  writingContent?: string;
  writingLines?: number;
  writingProgress?: number;
  // Editing state data
  editingFile?: string;
  editingDiff?: DiffHunk[];
  // Executing state data
  executingCommand?: string;
  executingOutput?: string[];
  executingExitCode?: number | null;
  // Artifact state data
  artifact?: {
    type: ArtifactType;
    name: string;
    url?: string;
    content?: string;
    port?: number;
  };
  // Error state data
  error?: {
    message: string;
    recoverable: boolean;
  };
}

// Helper to detect language from file extension
export function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    ps1: 'powershell',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    r: 'r',
    dockerfile: 'dockerfile',
  };
  return langMap[ext || ''] || 'plaintext';
}
