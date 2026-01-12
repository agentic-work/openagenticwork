/**
 * Chat Messages Component - Gemini Style
 *
 * Simple chronological message rendering like Google Gemini
 * - Messages render in order they were created (timestamp-based)
 * - User messages appear AFTER they're sent
 * - Assistant responses stream in real-time
 * - No complex grouping or turn-based logic
 * - Tool calls display inline with their parent message
 */

import React, { useMemo, useState, useCallback } from 'react';
import { ChatMessage } from '@/types/index';
import { normalizeMessages } from '../utils/messageNormalizer';
import EnhancedMessageContent from './MessageContent/EnhancedMessageContent';
import { SmoothStreamingText } from './SmoothStreamingText';
import { InlineThinkingDisplay } from './InlineThinkingDisplay';
import InlineMCPIndicator from './InlineMCPIndicator';
import { COTStep } from './ChainOfThoughtDisplay';
import SSEErrorBoundary from '@/shared/components/SSEErrorBoundary';
import MessageBubble from './MessageBubble';
import { type AgentState } from './UnifiedAgentActivity';
import { InlineSteps } from './InlineSteps';
import { InterleavedContent } from './InterleavedContent';
import { ContentBlock } from '../hooks/useSSEChat';

// Pipeline state interface
interface PipelineState {
  currentStage: string | null;
  stageStartTime: number | null;
  stageTiming: Record<string, number>;
  isToolExecutionPhase: boolean;
  activeToolRound: number;
  maxToolRounds: number;
  bufferedContent: string;
  shouldSuppressContent: boolean;
}

// Thinking metrics interface
interface ThinkingMetrics {
  tokens: number;
  elapsedMs: number;
  tokensPerSecond: number;
}

interface ChatMessagesProps {
  theme: 'light' | 'dark';
  messages: ChatMessage[];
  streamingContent?: string;
  smoothStreaming?: boolean;
  isLoading?: boolean;
  thinkingTime?: number;
  thinkingMessage?: string;
  thinkingContent?: string;  // Streaming thinking content from models that support it (e.g., Ollama)
  thinkingMetrics?: ThinkingMetrics | null;
  messagesEndRef?: React.RefObject<HTMLDivElement>;
  activeMcpCalls?: any[];
  currentToolRound?: number;  // Current agentic loop round for visual indicator
  pipelineState?: PipelineState;
  showTypingIndicators?: boolean;
  showMCPIndicators?: boolean;  // New prop to control MCP indicator visibility
  showModelBadges?: boolean;  // Control model badge visibility on messages
  showThinkingInline?: boolean;  // Control inline thinking display visibility
  cotSteps?: COTStep[];  // Chain of Thought steps for streaming display
  agentState?: AgentState;  // Unified agent state for inline activity display
  contentBlocks?: ContentBlock[];  // Interleaved content blocks for thinking/text display
  onExpandToCanvas?: (code: string, language: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  onMessageUpdate?: (messageId: string, content: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  // New agentic activity stream
  useAgenticActivityStream?: boolean;  // Enable new structured activity display
  onInterrupt?: () => void;  // Interrupt callback for streaming
}

export default function ChatMessages({
  theme,
  messages,
  streamingContent = '',
  smoothStreaming = true,
  isLoading = false,
  thinkingMessage = '',
  thinkingContent = '',  // Streaming thinking from models that support it
  thinkingMetrics,
  messagesEndRef,
  activeMcpCalls = [],
  currentToolRound = 0,
  pipelineState,
  showMCPIndicators = true,  // Default to true for backwards compatibility
  showModelBadges = true,  // Default to true for backwards compatibility
  showThinkingInline = true,  // Default to true for backwards compatibility
  cotSteps = [],  // Chain of Thought steps
  agentState,  // Unified agent state for inline display
  contentBlocks = [],  // Interleaved content blocks
  onExpandToCanvas,
  onExecuteCode,
  onMessageUpdate,
  onEditMessage,
  useAgenticActivityStream = true,  // AgenticActivityStream is the SOT
  onInterrupt,
}: ChatMessagesProps) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Normalize messages once - sorts chronologically by timestamp
  const normalizedMessages = useMemo(() => {
    return normalizeMessages(messages);
  }, [messages]);

  /**
   * Group consecutive assistant messages with tool calls into "activity turns"
   * This allows us to render ONE aggregated InlineSteps per turn instead of 12+ separate pills
   *
   * Returns:
   * - turnGroups: Map of turnId -> array of message indices in that turn
   * - messageTurnInfo: Map of messageId -> { turnId, isFirst, isLast, turnToolCount }
   */
  const { turnGroups, messageTurnInfo } = useMemo(() => {
    const groups = new Map<string, number[]>();
    const info = new Map<string, { turnId: string; isFirst: boolean; isLast: boolean; turnToolCount: number; roundCount?: number }>();

    let currentTurnId: string | null = null;
    let currentTurnMessages: number[] = [];
    let turnCounter = 0;

    normalizedMessages.forEach((msg, idx) => {
      const hasToolCalls = (msg.mcpCalls && msg.mcpCalls.length > 0) ||
                          (msg.toolCalls && msg.toolCalls.length > 0);
      const isAssistant = msg.role === 'assistant';
      const hasSubstantialContent = msg.content && msg.content.trim().length > 50;
      const isStreaming = msg.status === 'streaming';

      // Determine if this message should be grouped with previous
      // Group if: assistant + has tool calls + (no substantial content OR streaming)
      const shouldGroup = isAssistant && hasToolCalls && (!hasSubstantialContent || isStreaming);

      if (shouldGroup) {
        // Start new turn or continue existing
        if (!currentTurnId) {
          currentTurnId = `turn-${++turnCounter}`;
          currentTurnMessages = [];
        }
        currentTurnMessages.push(idx);
      } else {
        // End current turn if any
        if (currentTurnId && currentTurnMessages.length > 0) {
          groups.set(currentTurnId, [...currentTurnMessages]);

          // Calculate total tool count for this turn
          let totalTools = 0;
          currentTurnMessages.forEach(i => {
            const m = normalizedMessages[i];
            totalTools += (m.mcpCalls?.length || 0) + (m.toolCalls?.length || 0);
          });

          // Mark messages with turn info
          const roundCount = currentTurnMessages.length;
          currentTurnMessages.forEach((i, turnIdx) => {
            info.set(normalizedMessages[i].id, {
              turnId: currentTurnId!,
              isFirst: turnIdx === 0,
              isLast: turnIdx === currentTurnMessages.length - 1,
              turnToolCount: totalTools,
              roundCount,
            });
          });
        }
        currentTurnId = null;
        currentTurnMessages = [];
      }
    });

    // Handle final turn
    if (currentTurnId && currentTurnMessages.length > 0) {
      groups.set(currentTurnId, [...currentTurnMessages]);

      let totalTools = 0;
      currentTurnMessages.forEach(i => {
        const m = normalizedMessages[i];
        totalTools += (m.mcpCalls?.length || 0) + (m.toolCalls?.length || 0);
      });

      const roundCount = currentTurnMessages.length;
      currentTurnMessages.forEach((i, turnIdx) => {
        info.set(normalizedMessages[i].id, {
          turnId: currentTurnId!,
          isFirst: turnIdx === 0,
          isLast: turnIdx === currentTurnMessages.length - 1,
          turnToolCount: totalTools,
          roundCount,
        });
      });
    }

    return { turnGroups: groups, messageTurnInfo: info };
  }, [normalizedMessages]);

  // Memoized edit handlers to prevent MessageBubble re-renders
  const handleEditStart = useCallback((message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditContent(message.content);
  }, []);

  const handleEditChange = useCallback((content: string) => {
    setEditContent(content);
  }, []);

  const handleEditSubmit = useCallback((messageId: string) => {
    if (editContent.trim() && onEditMessage) {
      onEditMessage(messageId, editContent.trim());
      setEditingMessageId(null);
      setEditContent('');
    }
  }, [editContent, onEditMessage]);

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditContent('');
  }, []);

  /**
   * Render streaming message (assistant response in progress)
   * Uses InterleavedContent for interleaved thinking/text display
   * Falls back to UnifiedAgentActivity/InlineSteps for legacy behavior
   */
  const renderStreamingMessage = () => {
    // CRITICAL FIX: Only render this section when ACTIVELY streaming.
    // `thinkingMessage` persists after completion (by design for user review),
    // but we should NOT render a separate streaming section after completion.
    // The completed message's MessageBubble will handle showing the persisted thinking.
    if (!isLoading) {
      return null; // Not actively loading - don't show streaming section
    }

    // Check if there's anything to show during active streaming
    // CRITICAL FIX: Exclude 'complete' phase - agent activity is only active during processing phases
    const hasAgentActivity = agentState &&
      agentState.phase !== 'idle' &&
      agentState.phase !== 'complete';
    const hasContentBlocks = contentBlocks && contentBlocks.length > 0;
    const hasContent = streamingContent || thinkingMessage || hasAgentActivity || hasContentBlocks;

    if (!hasContent) {
      return null;
    }

    // CRITICAL FIX: Don't render separate streaming message if there's already a streaming placeholder
    // in the messages array. This prevents duplicate image rendering AND duplicate thinking blocks.
    // The MessageBubble for the streaming placeholder will handle InlineSteps rendering.
    const hasStreamingPlaceholder = normalizedMessages.some(m => m.status === 'streaming');
    if (hasStreamingPlaceholder) {
      // When there's a streaming placeholder, MessageBubble handles all rendering
      // including InlineSteps for thinking/tool activity - no separate streaming indicator needed
      return null;
    }

    return (
      <div
        key="streaming-message"
        className="w-full"
        style={{ willChange: 'contents' }}
      >
        <div className="flex flex-col gap-2 p-4">
          {/* InterleavedContent - interleaved thinking/text display */}
          {/* Use InterleavedContent when we have content blocks from the streaming API */}
          {hasContentBlocks && showThinkingInline && (
            <InterleavedContent
              blocks={contentBlocks}
              isStreaming={isLoading}
              theme={theme}
            />
          )}

          {/* Legacy: InlineSteps - Claude-style inline steps (only when NO content blocks) */}
          {!hasContentBlocks && hasAgentActivity && agentState && (
            <InlineSteps
              agentState={agentState}
              currentThinking={thinkingContent}
              isStreaming={agentState.phase !== 'complete' && agentState.phase !== 'idle'}
              mode="verbose"
            />
          )}

          {/* Fallback: Legacy inline thinking display if no agentState and no content blocks */}
          {!hasContentBlocks && !hasAgentActivity && showThinkingInline && thinkingContent && (
            <InlineThinkingDisplay
              isThinking={true}
              isCompleted={false}
              thinkingContent={thinkingContent}
              theme={theme}
            />
          )}

          {/* Streaming content - only render if NOT using InterleavedContent */}
          {/* InterleavedContent handles text blocks, so we skip this when using it */}
          {!hasContentBlocks && streamingContent && (
            <div className="flex-1 w-full">
              <div className="max-w-none">
                {smoothStreaming ? (
                  <SmoothStreamingText
                    content={streamingContent}
                    speed={20}
                  />
                ) : (
                  <EnhancedMessageContent
                    content={streamingContent}
                    theme={theme}
                    showModelBadges={showModelBadges}
                    onExpandToCanvas={onExpandToCanvas}
                    onExecuteCode={onExecuteCode}
                    isStreaming={true}
                  />
                )}
              </div>
            </div>
          )}

          {/* Legacy: Active MCP calls (shown if no agentState or as backup) */}
          {!hasAgentActivity && showMCPIndicators && activeMcpCalls && activeMcpCalls.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30">
              <div className="text-xs text-muted mb-2 flex items-center gap-2">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
                Tool Execution
                {currentToolRound > 0 && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                      color: 'var(--color-primary)',
                      border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
                      fontSize: '10px'
                    }}
                  >
                    Round {currentToolRound}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {activeMcpCalls.map((mcpCall: any, idx: number) => (
                  <InlineMCPIndicator
                    key={`streaming-mcp-${idx}`}
                    mcpCall={mcpCall}
                    theme={theme}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full gpu-accelerated">
      <div
        className="w-full max-w-full px-3 sm:px-6 md:px-8 lg:px-12 xl:px-16"
        style={{
          maxWidth: 'min(1600px, 95vw)',
          margin: '0 auto',
          boxSizing: 'border-box'
        }}
      >
        <SSEErrorBoundary>
          {/* Render all messages in chronological order - using memoized MessageBubble */}
          {normalizedMessages.map((message, idx) => {
            const turnInfo = messageTurnInfo.get(message.id);
            const isPartOfTurn = !!turnInfo;

            // For grouped turns: get all messages in this turn to aggregate steps
            let aggregatedMessages: typeof normalizedMessages | undefined;
            if (turnInfo?.isFirst && turnGroups.has(turnInfo.turnId)) {
              const turnIndices = turnGroups.get(turnInfo.turnId)!;
              aggregatedMessages = turnIndices.map(i => normalizedMessages[i]);
            }

            return (
              <MessageBubble
                key={message.id}
                message={message}
                theme={theme}
                showMCPIndicators={showMCPIndicators}
                showModelBadges={showModelBadges}
                showThinkingInline={showThinkingInline}
                thinkingContent={message.status === 'streaming' ? thinkingContent : undefined}
                activeMcpCalls={message.status === 'streaming' ? activeMcpCalls : undefined}
                isEditing={editingMessageId === message.id}
                editContent={editingMessageId === message.id ? editContent : ''}
                onEditStart={handleEditStart}
                onEditChange={handleEditChange}
                onEditSubmit={handleEditSubmit}
                onEditCancel={handleEditCancel}
                onExpandToCanvas={onExpandToCanvas}
                onExecuteCode={onExecuteCode}
                // Turn aggregation props
                turnInfo={turnInfo}
                aggregatedMessages={aggregatedMessages}
                // New agentic activity stream
                useAgenticActivityStream={useAgenticActivityStream}
                onInterrupt={onInterrupt}
                // Pass live streaming contentBlocks for interleaved thinking display
                streamingContentBlocks={message.status === 'streaming' ? contentBlocks : undefined}
              />
            );
          })}

          {/* Render streaming message at the end */}
          {renderStreamingMessage()}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} className="h-4" />
        </SSEErrorBoundary>
      </div>
    </div>
  );
}
