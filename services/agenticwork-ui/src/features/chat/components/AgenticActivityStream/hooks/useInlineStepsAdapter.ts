/**
 * useInlineStepsAdapter - Bridge InlineSteps data to AgenticActivityStream format
 *
 * Converts existing InlineStep data format to the ContentBlock/ToolCall/AgenticTask
 * format used by AgenticActivityStream. This allows gradual migration from
 * InlineSteps to AgenticActivityStream.
 *
 * Usage:
 * ```tsx
 * const { contentBlocks, toolCalls, tasks, streamingState } = useInlineStepsAdapter({
 *   steps,
 *   currentThinking,
 *   isStreaming,
 *   thinkingDuration,
 * });
 *
 * <AgenticActivityStream
 *   contentBlocks={contentBlocks}
 *   toolCalls={toolCalls}
 *   tasks={tasks}
 *   streamingState={streamingState}
 *   isStreaming={isStreaming}
 * />
 * ```
 */

import { useMemo } from 'react';
import type { InlineStep } from '../../InlineSteps';
import type {
  ContentBlock,
  ToolCall,
  AgenticTask,
  StreamingState,
  ToolCallStatus,
} from '../types/activity.types';

interface UseInlineStepsAdapterOptions {
  steps: InlineStep[];
  currentThinking?: string;
  isStreaming?: boolean;
  thinkingDuration?: number;
  currentModel?: string;
}

interface UseInlineStepsAdapterReturn {
  contentBlocks: ContentBlock[];
  toolCalls: ToolCall[];
  tasks: AgenticTask[];
  streamingState: StreamingState;
}

/**
 * Map InlineStep status to ToolCallStatus
 */
const mapStepStatusToToolStatus = (status: InlineStep['status']): ToolCallStatus => {
  switch (status) {
    case 'running':
      return 'calling';
    case 'complete':
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'calling';
  }
};

/**
 * Map InlineStep status to AgenticTask status
 */
const mapStepStatusToTaskStatus = (status: InlineStep['status']): AgenticTask['status'] => {
  switch (status) {
    case 'running':
      return 'in_progress';
    case 'complete':
    case 'completed':
      return 'completed';
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
};

/**
 * Convert InlineStep type to a display name
 */
const getToolDisplayName = (step: InlineStep): string => {
  const typeDisplayNames: Record<InlineStep['type'], string> = {
    thinking: 'Thinking',
    tool: 'Tool',
    search: 'Search',
    read: 'Read File',
    write: 'Write File',
    bash: 'Run Command',
    edit: 'Edit File',
    glob: 'Find Files',
    grep: 'Search Code',
    handoff: 'Handoff',
    web_search: 'Web Search',
    mcp: 'MCP Tool',
  };

  return typeDisplayNames[step.type] || 'Tool';
};

export function useInlineStepsAdapter({
  steps,
  currentThinking,
  isStreaming = false,
  thinkingDuration = 0,
  currentModel,
}: UseInlineStepsAdapterOptions): UseInlineStepsAdapterReturn {
  // Convert steps to content blocks
  const contentBlocks = useMemo<ContentBlock[]>(() => {
    const blocks: ContentBlock[] = [];
    let blockIndex = 0;

    // Add current streaming thinking as a content block
    if (currentThinking) {
      blocks.push({
        id: `thinking-streaming-${Date.now()}`,
        type: 'thinking',
        content: currentThinking,
        timestamp: Date.now(),
      });
      blockIndex++;
    }

    // Add thinking steps from completed messages
    steps
      .filter(step => step.type === 'thinking')
      .forEach((step, idx) => {
        if (step.content && !blocks.some(b => b.content === step.content)) {
          blocks.push({
            id: step.id || `thinking-${idx}-${blockIndex}`,
            type: 'thinking',
            content: step.content,
            timestamp: step.startTime || Date.now(),
          });
          blockIndex++;
        }
      });

    return blocks;
  }, [steps, currentThinking]);

  // Convert tool steps to ToolCall format
  const toolCalls = useMemo<ToolCall[]>(() => {
    return steps
      .filter(step => step.type !== 'thinking')
      .map(step => ({
        id: step.id,
        toolName: step.type,
        displayName: step.title || step.content || getToolDisplayName(step),
        status: mapStepStatusToToolStatus(step.status),
        input: step.request || step.details?.args,
        output: step.response || step.details?.result || step.summary,
        duration: step.duration,
        startTime: step.startTime,
        isCollapsed: step.status === 'complete' || step.status === 'completed',
      }));
  }, [steps]);

  // Create tasks from steps for the task progress view
  // This provides a high-level view of what the agent is working on
  const tasks = useMemo<AgenticTask[]>(() => {
    // Only show tasks if there are multiple steps (indicates a complex operation)
    if (steps.length < 2) return [];

    return steps
      .filter(step => step.type !== 'thinking')
      .map(step => ({
        id: `task-${step.id}`,
        title: step.title || step.content || getToolDisplayName(step),
        activeForm: step.type === 'thinking'
          ? 'Analyzing...'
          : `Running ${getToolDisplayName(step).toLowerCase()}...`,
        status: mapStepStatusToTaskStatus(step.status),
        progress: step.status === 'complete' || step.status === 'completed' ? 100 : undefined,
        startedAt: step.startTime,
        completedAt: step.endTime,
      }));
  }, [steps]);

  // Determine streaming state
  const streamingState = useMemo<StreamingState>(() => {
    if (!isStreaming) return 'complete';

    const hasActiveThinking = currentThinking && currentThinking.length > 0;
    const hasRunningTool = steps.some(s => s.status === 'running');
    const hasError = steps.some(s => s.status === 'error');

    if (hasError) return 'error';
    if (hasRunningTool) return 'tool_use';
    if (hasActiveThinking) return 'thinking';

    return 'streaming';
  }, [isStreaming, currentThinking, steps]);

  return {
    contentBlocks,
    toolCalls,
    tasks,
    streamingState,
  };
}

export default useInlineStepsAdapter;
