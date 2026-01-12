/**
 * AgenticActivityStream Type Definitions
 *
 * Types for the agentic activity visualization system that transforms
 * monolithic thinking blocks into structured, progressive displays.
 */

// =============================================================================
// Content Blocks
// =============================================================================

export type ContentBlockType =
  | 'thinking'
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'task_update'
  | 'summary';

export interface ContentBlock {
  id: string;
  type: ContentBlockType;
  timestamp: number;
  content: string;
  metadata?: ContentBlockMetadata;
}

export interface ContentBlockMetadata {
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  taskId?: string;
  sectionTitle?: string;
  isRepetitive?: boolean;
  repetitionCount?: number;
  duration?: number;
  status?: 'pending' | 'executing' | 'success' | 'error';
}

// =============================================================================
// Activity Sections
// =============================================================================

export interface ActivitySection {
  id: string;
  title: string;
  content: string;
  type: 'thinking' | 'analysis' | 'planning' | 'executing';
  isCollapsed: boolean;
  isRepetitive: boolean;
  repetitionCount?: number;
  timestamp: number;
}

// =============================================================================
// Tasks
// =============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AgenticTask {
  id: string;
  title: string;
  status: TaskStatus;
  progress?: number; // 0-100 for partial progress
  subtasks?: AgenticTask[];
  startedAt?: number;
  completedAt?: number;
  activeForm?: string; // Present tense version shown when in progress
}

// =============================================================================
// Tool Calls
// =============================================================================

export type ToolCallStatus = 'calling' | 'success' | 'error';

export interface ToolCall {
  id: string;
  toolName: string;
  displayName: string;
  input: unknown;
  output?: unknown;
  status: ToolCallStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  isCollapsed: boolean;
}

// =============================================================================
// Response Summary
// =============================================================================

export interface KeyFinding {
  label: string;
  value: string;
  icon?: string;
}

export interface SuggestedAction {
  id: string;
  label: string;
  description?: string;
  prompt?: string; // Pre-filled prompt when clicked
  icon?: string;
  variant?: 'primary' | 'secondary' | 'outline';
}

export interface ResponseSummary {
  accomplishments: string[];
  keyFindings?: KeyFinding[];
  caveats?: string[];
  suggestedActions: SuggestedAction[];
}

// =============================================================================
// Parsed Activity
// =============================================================================

export interface ParsedActivity {
  sections: ActivitySection[];
  tasks: AgenticTask[];
  toolCalls: ToolCall[];
  summary: ResponseSummary | null;
}

// =============================================================================
// Streaming State
// =============================================================================

export type StreamingState =
  | 'idle'
  | 'thinking'
  | 'tool_use'
  | 'streaming'
  | 'complete'
  | 'error';

// =============================================================================
// Component Props
// =============================================================================

export interface AgenticActivityStreamProps {
  // Streaming state
  isStreaming: boolean;
  streamingState: StreamingState;

  // Content blocks (thinking, text, etc.)
  contentBlocks: ContentBlock[];

  // Tasks/todos from the AI
  tasks?: AgenticTask[];

  // Tool calls
  toolCalls?: ToolCall[];

  // Theme
  theme?: 'light' | 'dark';

  // Callbacks
  onInterrupt?: () => void;
  onToggleSection?: (sectionId: string) => void;

  // Display options
  showTimestamps?: boolean;
  autoCollapseRepetitive?: boolean;
  maxVisibleLines?: number;

  // Additional class names
  className?: string;
}

export interface ThinkingSectionProps {
  content: string;
  isStreaming: boolean;
  autoCollapse?: boolean;
  maxVisibleLines?: number;
  onToggle?: () => void;
  isCollapsed?: boolean;
  className?: string;
}

export interface TaskProgressProps {
  tasks: AgenticTask[];
  animate?: boolean;
  showTimestamps?: boolean;
  collapsible?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

export interface ToolCallCardProps {
  toolName: string;
  displayName?: string;
  toolInput: unknown;
  toolOutput?: unknown;
  status: ToolCallStatus;
  duration?: number;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  theme?: 'light' | 'dark';
  className?: string;
}

export interface ResponseSummaryProps {
  accomplishments: string[];
  keyFindings?: KeyFinding[];
  caveats?: string[];
  suggestedActions: SuggestedAction[];
  onActionClick?: (action: SuggestedAction) => void;
  className?: string;
}

export interface SuggestedActionsProps {
  actions: SuggestedAction[];
  onActionClick?: (action: SuggestedAction) => void;
  className?: string;
}
