/**
 * MessageBubble - Memoized message rendering component
 * Wrapped with React.memo to prevent unnecessary re-renders
 * when other messages in the list change or streaming content updates.
 */

import React, { memo, useCallback, useMemo, useState, Component, ErrorInfo, ReactNode } from 'react';
import { Edit2, Send, FileText, Image as ImageIcon, AlertTriangle, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw } from '@/shared/icons';
import { ChatMessage } from '@/types/index';
import EnhancedMessageContent from './MessageContent/EnhancedMessageContent';
import { InlineSteps, InlineStep } from './InlineSteps';
import { AgenticActivityStream, useInlineStepsAdapter } from './AgenticActivityStream';

// Debug Error Boundary to catch and log render errors with details
class MessageErrorBoundary extends Component<
  { children: ReactNode; messageId: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; messageId: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[MessageBubble] RENDER ERROR:', {
      messageId: this.props.messageId,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg m-2">
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <AlertTriangle size={16} />
            <span className="font-medium">Message Render Error (ID: {this.props.messageId})</span>
          </div>
          <pre className="text-xs text-red-300 whitespace-pre-wrap break-all">
            {this.state.error?.message}
          </pre>
          <details className="mt-2">
            <summary className="text-xs text-red-400 cursor-pointer">Stack Trace</summary>
            <pre className="text-[10px] text-red-300/70 mt-1 overflow-auto max-h-32">
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Thumbnail component for attached files
 */
const AttachedFileThumbnail = memo(function AttachedFileThumbnail({
  name,
  data,
  mimeType
}: {
  name: string;
  data: string;
  mimeType: string;
}) {
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  // Build data URL for images
  const imageUrl = isImage ? `data:${mimeType};base64,${data}` : undefined;

  return (
    <div className="relative group">
      {isImage && imageUrl ? (
        <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/20 bg-black/20">
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="w-16 h-16 rounded-lg border border-white/20 bg-black/20 flex items-center justify-center">
          {isPdf ? (
            <FileText size={24} className="text-white/70" />
          ) : (
            <ImageIcon size={24} className="text-white/70" />
          )}
        </div>
      )}
      {/* File name tooltip on hover */}
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
        <div className="bg-black/80 text-white text-xs px-2 py-1 rounded whitespace-nowrap max-w-[150px] truncate">
          {name}
        </div>
      </div>
    </div>
  );
});

/**
 * FeedbackRow - Claude.ai style action row with copy, feedback, retry
 */
interface FeedbackRowProps {
  content: string;
  onCopy?: () => void;
  onThumbsUp?: (messageId: string) => void;
  onThumbsDown?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  messageId: string;
  isStreaming?: boolean;
}

const FeedbackRow = memo(function FeedbackRow({
  content,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  onRetry,
  messageId,
  isStreaming,
}: FeedbackRowProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content, onCopy]);

  const handleThumbsUp = useCallback(() => {
    setFeedback(feedback === 'up' ? null : 'up');
    onThumbsUp?.(messageId);
  }, [feedback, messageId, onThumbsUp]);

  const handleThumbsDown = useCallback(() => {
    setFeedback(feedback === 'down' ? null : 'down');
    onThumbsDown?.(messageId);
  }, [feedback, messageId, onThumbsDown]);

  const handleRetry = useCallback(() => {
    onRetry?.(messageId);
  }, [messageId, onRetry]);

  // Don't show during streaming
  if (isStreaming) return null;

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 8px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    transition: 'color 0.15s, background 0.15s',
  };

  const activeStyle: React.CSSProperties = {
    ...buttonStyle,
    color: 'var(--color-primary)',
    background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
  };

  return (
    <div
      className="feedback-row opacity-0 group-hover:opacity-100 transition-opacity"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginTop: 8,
        paddingTop: 8,
      }}
    >
      {/* Copy button */}
      <button
        onClick={handleCopy}
        style={copied ? activeStyle : buttonStyle}
        className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy message content'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>

      {/* Thumbs up */}
      <button
        onClick={handleThumbsUp}
        style={feedback === 'up' ? activeStyle : buttonStyle}
        className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
        title="Good response"
        aria-label="Rate as good response"
      >
        <ThumbsUp size={14} />
      </button>

      {/* Thumbs down */}
      <button
        onClick={handleThumbsDown}
        style={feedback === 'down' ? activeStyle : buttonStyle}
        className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
        title="Bad response"
        aria-label="Rate as bad response"
      >
        <ThumbsDown size={14} />
      </button>

      {/* Retry */}
      {onRetry && (
        <button
          onClick={handleRetry}
          style={buttonStyle}
          className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
          title="Retry this message"
          aria-label="Retry generating this response"
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
});

// Turn info for message aggregation
interface TurnInfo {
  turnId: string;
  isFirst: boolean;
  isLast: boolean;
  turnToolCount: number;
  roundCount?: number;
}

// Streaming ContentBlock type (from useSSEChat)
interface StreamingContentBlock {
  index: number;
  type: 'thinking' | 'text' | 'tool_use';
  content: string;
  isComplete: boolean;
  toolName?: string;
  toolId?: string;
}

interface MessageBubbleProps {
  message: ChatMessage;
  theme: 'light' | 'dark';
  showMCPIndicators: boolean;
  showModelBadges: boolean;
  showThinkingInline: boolean;
  thinkingContent?: string;
  activeMcpCalls?: any[];
  isEditing: boolean;
  editContent: string;
  onEditStart: (message: ChatMessage) => void;
  onEditChange: (content: string) => void;
  onEditSubmit: (messageId: string) => void;
  onEditCancel: () => void;
  onExpandToCanvas?: (code: string, language: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  // Turn aggregation props
  turnInfo?: TurnInfo;
  aggregatedMessages?: ChatMessage[];
  // New activity stream toggle
  useAgenticActivityStream?: boolean;
  onInterrupt?: () => void;
  // Live streaming content blocks for interleaved thinking
  streamingContentBlocks?: StreamingContentBlock[];
}

/**
 * Determine step type based on tool name
 */
const getStepType = (toolName: string): InlineStep['type'] => {
  const nameLower = toolName.toLowerCase();
  if (nameLower.includes('bash') || nameLower.includes('shell') || nameLower.includes('execute')) {
    return 'bash';
  } else if (nameLower.includes('search') || nameLower.includes('web') || nameLower.includes('grep')) {
    return 'search';
  } else if (nameLower.includes('read') || nameLower.includes('glob')) {
    return 'read';
  } else if (nameLower.includes('write') || nameLower.includes('edit')) {
    return 'write';
  }
  return 'tool';
};

/**
 * Convert MCP calls to Step format
 * @param isHistorical - true if this is from a saved message (not currently streaming)
 */
const mcpCallToStep = (mcpCall: any, index: number, model?: string, isHistorical: boolean = false): InlineStep => {
  const toolName = mcpCall.tool || mcpCall.name || mcpCall.function?.name || 'tool';
  const args = mcpCall.args || mcpCall.arguments || mcpCall.function?.arguments;
  // CRITICAL FIX: For historical messages, default to 'completed' since conversation continued
  // Only show 'running' for actively streaming MCP calls
  const status = mcpCall.status === 'completed' || mcpCall.result || isHistorical ? 'completed' : 'running';

  // Get result summary
  let summary = '';
  if (mcpCall.result) {
    if (typeof mcpCall.result === 'string') {
      summary = mcpCall.result.substring(0, 100) + (mcpCall.result.length > 100 ? '...' : '');
    } else if (mcpCall.result.content?.[0]?.text) {
      const text = mcpCall.result.content[0].text;
      summary = text.substring(0, 100) + (text.length > 100 ? '...' : '');
    }
  }

  return {
    id: `mcp-${index}-${mcpCall.id || Date.now()}`,
    type: getStepType(toolName),
    title: toolName,
    summary: status === 'completed' ? summary : undefined,
    status,
    model,
    details: {
      args,
      result: mcpCall.result,
      command: getStepType(toolName) === 'bash' ? (args?.command || args?.script) : undefined,
      output: mcpCall.result?.content?.[0]?.text || (typeof mcpCall.result === 'string' ? mcpCall.result : undefined),
    },
    startTime: mcpCall.startTime,
    endTime: mcpCall.endTime || (status === 'completed' ? Date.now() : undefined),
  };
};

/**
 * Convert standard toolCalls (like Gemini function calls) to Step format
 * @param isHistorical - true if this is from a saved message (not currently streaming)
 */
const toolCallToStep = (toolCall: any, index: number, toolResult?: any, model?: string, isHistorical: boolean = false): InlineStep => {
  const toolName = toolCall.function?.name || toolCall.name || 'tool';
  const argsRaw = toolCall.function?.arguments || toolCall.arguments;
  let args = argsRaw;

  // Parse arguments if they're a string
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // Keep as string if parsing fails
    }
  }

  const hasResult = toolResult !== undefined;

  // Get result summary
  let summary = '';
  if (hasResult && toolResult) {
    if (typeof toolResult === 'string') {
      summary = toolResult.substring(0, 100) + (toolResult.length > 100 ? '...' : '');
    } else if (toolResult.content?.[0]?.text) {
      const text = toolResult.content[0].text;
      summary = text.substring(0, 100) + (text.length > 100 ? '...' : '');
    }
  }

  // CRITICAL FIX: For historical messages, default to 'completed' since conversation continued
  // Only show 'running' for actively streaming tool calls
  const status = hasResult || isHistorical ? 'completed' : 'running';

  return {
    id: `tool-${index}-${toolCall.id || Date.now()}`,
    type: getStepType(toolName),
    title: toolName,
    summary: hasResult ? summary : undefined,
    status,
    model,
    details: {
      args,
      result: toolResult,
      command: getStepType(toolName) === 'bash' ? (args?.command || args?.script) : undefined,
      output: toolResult?.content?.[0]?.text || (typeof toolResult === 'string' ? toolResult : undefined),
    },
  };
};

/**
 * Memoized message bubble component
 * Only re-renders when its own props change
 */
const MessageBubble = memo(function MessageBubble({
  message,
  theme,
  showMCPIndicators,
  showModelBadges,
  showThinkingInline,
  thinkingContent,
  activeMcpCalls,
  isEditing,
  editContent,
  onEditStart,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onExpandToCanvas,
  onExecuteCode,
  turnInfo,
  aggregatedMessages,
  useAgenticActivityStream = true,  // AgenticActivityStream is the SOT
  onInterrupt,
  streamingContentBlocks,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';
  const isStreaming = message.status === 'streaming';

  // Skip tool messages - they're shown inline with their parent
  if (message.role === 'tool') {
    return null;
  }

  // Skip system messages
  if (isSystem) {
    return null;
  }

  // TURN AGGREGATION: Skip non-first messages in a turn (they're aggregated into the first)
  // But don't skip if it has substantial content to display
  const hasSubstantialContent = message.content && message.content.trim().length > 50;
  if (turnInfo && !turnInfo.isFirst && !hasSubstantialContent && !isStreaming) {
    return null;
  }

  // Handle keyboard events for edit
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onEditSubmit(message.id);
    }
    if (e.key === 'Escape') {
      onEditCancel();
    }
  }, [message.id, onEditSubmit, onEditCancel]);

  // Build steps from thinking content, tool calls, and MCP calls
  // TURN AGGREGATION: If aggregatedMessages provided, build from ALL messages in turn
  const steps = useMemo(() => {
    const result: InlineStep[] = [];

    // Determine which messages to process: aggregated or just this one
    const messagesToProcess = aggregatedMessages || [message];

    messagesToProcess.forEach((msg, msgIdx) => {
      const messageModel = msg.model;
      const idPrefix = aggregatedMessages ? `${msgIdx}-` : '';

      // Add standard toolCalls (like Gemini function calls)
      // CRITICAL: For historical (non-streaming) messages, mark as completed
      const isHistoricalMsg = msg.status !== 'streaming';
      if (showMCPIndicators && msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach((toolCall: any, idx: number) => {
          // Try to find matching result from toolResults array
          const toolResult = msg.toolResults?.[idx];
          const step = toolCallToStep(toolCall, idx, toolResult, messageModel, isHistoricalMsg);
          step.id = `${idPrefix}${step.id}`;
          result.push(step);
        });
      }

      // Add completed MCP calls from message
      if (showMCPIndicators && msg.mcpCalls && msg.mcpCalls.length > 0) {
        msg.mcpCalls.forEach((mcpCall: any, idx: number) => {
          const step = mcpCallToStep(mcpCall, idx, messageModel, isHistoricalMsg);
          step.id = `${idPrefix}${step.id}`;
          result.push(step);
        });
      }
    });

    // Add active MCP calls (for streaming - only for current message)
    // These are NOT historical - they are actively executing
    if (showMCPIndicators && activeMcpCalls && activeMcpCalls.length > 0) {
      const messageModel = message.model;
      activeMcpCalls.forEach((mcpCall: any, idx: number) => {
        // Don't add duplicates
        const existingIds = result.map(s => s.id);
        // Pass isHistorical=false for active calls
        const newStep = mcpCallToStep(mcpCall, idx + 1000, messageModel, false);
        if (!existingIds.includes(newStep.id)) {
          result.push(newStep);
        }
      });
    }

    // Add thinking steps only from the primary message (not aggregated)
    const messageModel = message.model;

    // Add thinkingSteps if available (structured thinking from streaming)
    // DEFENSIVE: Ensure thinkingSteps is a valid array before iterating
    if (showThinkingInline && Array.isArray(message.thinkingSteps) && message.thinkingSteps.length > 0) {
      message.thinkingSteps.forEach((step: any, idx: number) => {
        // DEFENSIVE: Skip if step is not a valid object
        if (!step || typeof step !== 'object') return;
        result.unshift({
          id: `thinking-step-${message.id}-${idx}`,
          type: 'thinking',
          title: String(step.title || step.description || `Step ${idx + 1}`),
          status: 'completed',
          model: messageModel,
          details: {
            content: String(step.content || step.thinking || step.description || ''),
          },
        });
      });
    }

    // Add thinking content as a completed step (ONE source only - avoid duplicates)
    // Priority: reasoningTrace > metadata.thinkingContent
    // DEFENSIVE: Only process if thinking content exists and is valid
    if (showThinkingInline && !isStreaming) {
      let thinkingContentToShow: string | null = null;

      // First try reasoningTrace (preferred - newer format)
      if (message.reasoningTrace) {
        try {
          thinkingContentToShow = typeof message.reasoningTrace === 'string'
            ? message.reasoningTrace
            : (message.reasoningTrace as any)?.reasoning || JSON.stringify(message.reasoningTrace);
        } catch {
          thinkingContentToShow = String(message.reasoningTrace);
        }
      }

      // Fall back to metadata.thinkingContent (legacy format) only if no reasoningTrace
      if (!thinkingContentToShow && message.metadata?.thinkingContent) {
        thinkingContentToShow = message.metadata.thinkingContent;
      }

      // Add the thinking step if we have content
      if (thinkingContentToShow && thinkingContentToShow.length > 0) {
        result.unshift({
          id: `thinking-${message.id}`,
          type: 'thinking',
          title: 'Reasoning',
          status: 'completed',
          model: messageModel,
          details: {
            content: thinkingContentToShow,
          },
        });
      }
    }

    return result;
  }, [message.toolCalls, message.toolResults, message.mcpCalls, message.thinkingSteps, message.reasoningTrace, message.metadata?.thinkingContent, message.id, message.model, activeMcpCalls, showMCPIndicators, showThinkingInline, isStreaming, aggregatedMessages]);

  // Determine if we should show the steps display
  const hasSteps = steps.length > 0 || (showThinkingInline && isStreaming && thinkingContent);

  // Convert steps to AgenticActivityStream format when enabled
  const activityStreamData = useInlineStepsAdapter({
    steps,
    currentThinking: isStreaming && showThinkingInline ? thinkingContent : undefined,
    isStreaming,
    currentModel: message.model,
  });

  return (
    <MessageErrorBoundary messageId={message.id}>
    <div
      data-message-id={message.id}
      data-message-role={message.role}
      className="w-full"
      style={{ willChange: 'contents' }}
    >
      {/* Message container */}
      <div className={`flex gap-4 p-4 ${isUser ? 'justify-end' : 'justify-center'}`}>
        {/* Message content */}
        <div className={`flex-1 w-full ${isUser ? 'text-right' : ''}`}>
          {/* User message bubble - uses user's accent color */}
          {isUser && (
            <div className="inline-block max-w-prose">
              {isEditing ? (
                <div className="flex items-end gap-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => onEditChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Edit message content"
                    className="flex-1 px-4 py-2 rounded-2xl resize-none"
                    style={{
                      background: 'var(--user-accent-primary, rgb(124, 58, 237))',
                      color: 'white',
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      minHeight: '44px'
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => onEditSubmit(message.id)}
                    aria-label="Submit edited message"
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    style={{ color: 'var(--user-accent-primary, rgb(124, 58, 237))' }}
                  >
                    <Send size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="group relative inline-block">
                  {/* Attached file thumbnails - shown above message */}
                  {message.attachedImages && message.attachedImages.length > 0 && (
                    <div className="flex gap-2 justify-end mb-2">
                      {message.attachedImages.map((file, idx) => (
                        <AttachedFileThumbnail
                          key={`${file.name}-${idx}`}
                          name={file.name}
                          data={file.data}
                          mimeType={file.mimeType}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    className="text-white rounded-2xl px-4 py-2"
                    style={{
                      background: 'var(--user-accent-primary, rgb(124, 58, 237))'
                    }}
                  >
                    {message.content}
                  </div>
                  {/* Edit button - shows on hover */}
                  <button
                    onClick={() => onEditStart(message)}
                    aria-label="Edit message and resubmit"
                    className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-white/10"
                    style={{ color: 'var(--color-text-secondary)' }}
                    title="Edit message (resubmit)"
                  >
                    <Edit2 size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assistant message */}
          {isAssistant && (
            <div className="group space-y-2">
              {/* Activity display - either new AgenticActivityStream or legacy InlineSteps */}
              {/* Use live streamingContentBlocks when available (for streaming messages) */}
              {(hasSteps || (isStreaming && streamingContentBlocks && streamingContentBlocks.length > 0)) && (
                useAgenticActivityStream ? (
                  <AgenticActivityStream
                    isStreaming={isStreaming}
                    streamingState={activityStreamData.streamingState}
                    contentBlocks={isStreaming && streamingContentBlocks && streamingContentBlocks.length > 0
                      ? streamingContentBlocks.map(block => ({
                          id: `stream-${block.index}`,
                          type: block.type === 'tool_use' ? 'tool_call' : block.type,
                          timestamp: Date.now(),
                          content: block.content,
                          metadata: block.toolName ? { toolName: block.toolName } : undefined,
                        }))
                      : activityStreamData.contentBlocks}
                    tasks={activityStreamData.tasks}
                    toolCalls={activityStreamData.toolCalls}
                    theme={theme}
                    onInterrupt={onInterrupt}
                  />
                ) : (
                  <InlineSteps
                    steps={steps}
                    isStreaming={isStreaming}
                    currentThinking={isStreaming && showThinkingInline ? thinkingContent : undefined}
                    mode="verbose"
                    turnInfo={turnInfo}
                  />
                )
              )}

              {/* Message content - appears BELOW steps */}
              {message.content && (
                <div className="max-w-none">
                  <EnhancedMessageContent
                    message={message}
                    content={message.content}
                    theme={theme}
                    showModelBadges={showModelBadges}
                    onExpandToCanvas={onExpandToCanvas}
                    onExecuteCode={onExecuteCode}
                    isStreaming={isStreaming}
                  />
                </div>
              )}

              {/* Feedback row - Claude.ai style actions */}
              {message.content && (
                <FeedbackRow
                  content={message.content}
                  messageId={message.id}
                  isStreaming={isStreaming}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </MessageErrorBoundary>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for optimal memoization
  // Return true if props are equal (no re-render needed)

  // Always re-render if the message itself changed
  if (prevProps.message !== nextProps.message) {
    // Deep check relevant message properties
    if (
      prevProps.message.id !== nextProps.message.id ||
      prevProps.message.content !== nextProps.message.content ||
      prevProps.message.status !== nextProps.message.status ||
      prevProps.message.role !== nextProps.message.role ||
      prevProps.message.mcpCalls !== nextProps.message.mcpCalls ||
      prevProps.message.toolCalls !== nextProps.message.toolCalls ||
      prevProps.message.toolResults !== nextProps.message.toolResults ||
      prevProps.message.thinkingSteps !== nextProps.message.thinkingSteps ||
      prevProps.message.reasoningTrace !== nextProps.message.reasoningTrace ||
      prevProps.message.model !== nextProps.message.model ||
      prevProps.message.attachedImages !== nextProps.message.attachedImages
    ) {
      return false;
    }
  }

  // Re-render if editing state changed for this message
  if (prevProps.isEditing !== nextProps.isEditing) {
    return false;
  }

  // Re-render if edit content changed while editing
  if (nextProps.isEditing && prevProps.editContent !== nextProps.editContent) {
    return false;
  }

  // Re-render if theme changed
  if (prevProps.theme !== nextProps.theme) {
    return false;
  }

  // Re-render if thinking content changed for streaming messages
  if (
    nextProps.message.status === 'streaming' &&
    prevProps.thinkingContent !== nextProps.thinkingContent
  ) {
    return false;
  }

  // Re-render if active MCP calls changed
  if (prevProps.activeMcpCalls !== nextProps.activeMcpCalls) {
    return false;
  }

  // Re-render if display options changed
  if (
    prevProps.showMCPIndicators !== nextProps.showMCPIndicators ||
    prevProps.showModelBadges !== nextProps.showModelBadges ||
    prevProps.showThinkingInline !== nextProps.showThinkingInline
  ) {
    return false;
  }

  // Re-render if turn info changed
  if (prevProps.turnInfo !== nextProps.turnInfo) {
    return false;
  }

  // Re-render if aggregated messages changed
  if (prevProps.aggregatedMessages !== nextProps.aggregatedMessages) {
    return false;
  }

  // Re-render if streaming content blocks changed (for live interleaved thinking display)
  if (prevProps.streamingContentBlocks !== nextProps.streamingContentBlocks) {
    // Check if content actually changed (not just array reference)
    const prevBlocks = prevProps.streamingContentBlocks || [];
    const nextBlocks = nextProps.streamingContentBlocks || [];
    if (prevBlocks.length !== nextBlocks.length) {
      return false;
    }
    // Check if any block content changed
    for (let i = 0; i < nextBlocks.length; i++) {
      if (prevBlocks[i]?.content !== nextBlocks[i]?.content ||
          prevBlocks[i]?.type !== nextBlocks[i]?.type) {
        return false;
      }
    }
  }

  // Props are equal, no re-render needed
  return true;
});

export default MessageBubble;
