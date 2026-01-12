/**
 * AgenticActivityStream - Claude.ai-style Agentic Activity Display
 *
 * REDESIGNED to match Claude.ai patterns:
 * 1. "X steps" collapsible container with step count
 * 2. Vertical timeline connector between steps
 * 3. Nested thinking blocks per step
 * 4. Tool result previews (search results, file counts, etc.)
 * 5. Summary line showing what was accomplished
 * 6. Auto-collapse when complete
 *
 * This is the SOURCE OF TRUTH for activity display.
 *
 * @copyright 2026 Agenticwork LLC
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Check,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Globe,
  FileText,
  Code,
  Terminal,
  Edit3,
  Eye,
  Folder,
  Brain,
  XCircle,
} from '@/shared/icons';

import type {
  AgenticActivityStreamProps,
  ToolCall,
  AgenticTask,
  ContentBlock,
  StreamingState,
} from './types/activity.types';

// ============================================================================
// Utility Functions
// ============================================================================

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const getToolIcon = (toolName: string): React.ReactNode => {
  const iconProps = { size: 14, strokeWidth: 2 };
  const name = toolName.toLowerCase();

  if (name.includes('search') || name.includes('web')) return <Globe {...iconProps} />;
  if (name.includes('read') || name.includes('view')) return <Eye {...iconProps} />;
  if (name.includes('write') || name.includes('create')) return <FileText {...iconProps} />;
  if (name.includes('edit') || name.includes('modify')) return <Edit3 {...iconProps} />;
  if (name.includes('bash') || name.includes('shell') || name.includes('exec')) return <Terminal {...iconProps} />;
  if (name.includes('glob') || name.includes('grep') || name.includes('find')) return <Folder {...iconProps} />;
  return <Code {...iconProps} />;
};

const getToolSummary = (toolCall: ToolCall): string | null => {
  if (!toolCall.output) return null;

  const output = typeof toolCall.output === 'string'
    ? toolCall.output
    : JSON.stringify(toolCall.output);

  // For file reads, count lines
  if (toolCall.toolName.toLowerCase().includes('read')) {
    const lines = (output.match(/\n/g) || []).length + 1;
    return `Read ${lines} lines`;
  }

  // For searches, count results
  if (toolCall.toolName.toLowerCase().includes('search') || toolCall.toolName.toLowerCase().includes('grep')) {
    const matches = output.match(/Found (\d+)/i);
    if (matches) return `Found ${matches[1]} results`;
  }

  // Truncate long outputs
  if (output.length > 80) {
    return output.slice(0, 80) + '...';
  }

  return output;
};

// ============================================================================
// Step Status Indicator (Timeline Dot)
// ============================================================================

interface StepStatusDotProps {
  status: 'pending' | 'running' | 'success' | 'error';
  isActive?: boolean;
}

const StepStatusDot: React.FC<StepStatusDotProps> = memo(({ status, isActive }) => {
  let color = 'var(--color-text-muted)';
  if (status === 'success') color = 'var(--color-success, #34C759)';
  else if (status === 'running' || isActive) color = 'var(--color-primary, #0A84FF)';
  else if (status === 'error') color = 'var(--color-error, #FF3B30)';

  return (
    <span style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 20,
      height: 20,
      borderRadius: '50%',
      backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
      border: `2px solid ${color}`,
      flexShrink: 0,
    }}>
      {status === 'running' ? (
        <Loader2 size={10} className="animate-spin" style={{ color }} />
      ) : status === 'success' ? (
        <Check size={10} style={{ color }} />
      ) : status === 'error' ? (
        <AlertCircle size={10} style={{ color }} />
      ) : (
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }} />
      )}
    </span>
  );
});

StepStatusDot.displayName = 'StepStatusDot';

// ============================================================================
// Thinking Block (Claude.ai style - collapsible)
// ============================================================================

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  duration?: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = memo(({
  content,
  isStreaming,
  duration,
  isExpanded,
  onToggle
}) => {
  if (!content) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--color-bg-tertiary, #252525)',
          border: '1px solid var(--color-border, #333)',
          borderRadius: isExpanded ? '8px 8px 0 0' : 8,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
        <Brain size={14} style={{ color: 'var(--color-primary)' }} />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        {isStreaming && (
          <span className="animate-pulse" style={{
            display: 'inline-block',
            width: 2,
            height: 14,
            backgroundColor: 'var(--color-primary)',
            marginLeft: 4,
          }} />
        )}
        <span style={{ flex: 1 }} />
        {duration && !isStreaming && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {formatDuration(duration)}
          </span>
        )}
      </button>

      {isExpanded && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--color-bg-tertiary, #252525)',
          border: '1px solid var(--color-border, #333)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
        }}>
          <pre style={{
            margin: 0,
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
            lineHeight: 1.6,
          }}>
            {content}
            {isStreaming && (
              <span className="animate-pulse" style={{
                display: 'inline-block',
                width: 2,
                height: 14,
                marginLeft: 2,
                backgroundColor: 'var(--color-primary)',
                verticalAlign: 'text-bottom',
              }} />
            )}
          </pre>
        </div>
      )}
    </div>
  );
});

ThinkingBlock.displayName = 'ThinkingBlock';

// ============================================================================
// Single Step Item (Claude.ai style with timeline)
// ============================================================================

interface StepItemProps {
  toolCall: ToolCall;
  isLast: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  showTimeline: boolean;
}

const StepItem: React.FC<StepItemProps> = memo(({
  toolCall,
  isLast,
  isExpanded,
  onToggle,
  showTimeline
}) => {
  const status = toolCall.status === 'calling' ? 'running' : toolCall.status;
  const summary = getToolSummary(toolCall);
  const hasOutput = Boolean(toolCall.output);

  const outputText = useMemo(() => {
    if (!toolCall.output) return null;
    return typeof toolCall.output === 'string'
      ? toolCall.output
      : JSON.stringify(toolCall.output, null, 2);
  }, [toolCall.output]);

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {/* Timeline column */}
      {showTimeline && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: 20,
        }}>
          <StepStatusDot status={status} isActive={status === 'running'} />
          {!isLast && (
            <div style={{
              width: 2,
              flex: 1,
              minHeight: 24,
              backgroundColor: 'var(--color-border, #333)',
              marginTop: 4,
            }} />
          )}
        </div>
      )}

      {/* Content column */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 12 }}>
        {/* Step header */}
        <button
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: hasOutput ? 'pointer' : 'default',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--color-text-muted)' }}>
            {getToolIcon(toolCall.toolName)}
          </span>
          <span style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {toolCall.displayName || toolCall.toolName}
          </span>

          {toolCall.duration && status !== 'running' && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {formatDuration(toolCall.duration)}
            </span>
          )}

          {hasOutput && (
            isExpanded ? (
              <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
            )
          )}
        </button>

        {/* Summary line (when collapsed) */}
        {!isExpanded && summary && status !== 'running' && (
          <p style={{
            margin: '4px 0 0 22px',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {summary}
          </p>
        )}

        {/* Expanded content */}
        {isExpanded && outputText && (
          <div style={{
            marginTop: 8,
            marginLeft: 22,
            padding: '12px',
            background: 'var(--color-bg-tertiary, #252525)',
            border: '1px solid var(--color-border, #333)',
            borderRadius: 8,
          }}>
            <pre style={{
              margin: 0,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflowY: 'auto',
            }}>
              {outputText.slice(0, 2000)}{outputText.length > 2000 ? '...' : ''}
            </pre>
          </div>
        )}

        {/* Running indicator */}
        {status === 'running' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 4,
            marginLeft: 22,
          }}>
            <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Executing...</span>
          </div>
        )}
      </div>
    </div>
  );
});

StepItem.displayName = 'StepItem';

// ============================================================================
// Steps Container (Claude.ai style - "X steps" collapsible)
// ============================================================================

interface StepsContainerProps {
  toolCalls: ToolCall[];
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming: boolean;
  totalDuration?: number;
}

const StepsContainer: React.FC<StepsContainerProps> = memo(({
  toolCalls,
  isExpanded,
  onToggle,
  isStreaming,
  totalDuration
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const completedCount = toolCalls.filter(t => t.status === 'success').length;
  const allComplete = completedCount === toolCalls.length && !isStreaming;

  const toggleStep = useCallback((stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  // Get last step summary for collapsed view
  const lastStep = toolCalls[toolCalls.length - 1];
  const lastStepSummary = lastStep ? getToolSummary(lastStep) : null;

  // Collapsed state (Claude.ai style)
  if (!isExpanded && allComplete) {
    return (
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '12px 16px',
          background: 'var(--color-bg-secondary, #1a1a1a)',
          border: '1px solid var(--color-border, #333)',
          borderRadius: 8,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
            {toolCalls.length} step{toolCalls.length !== 1 ? 's' : ''}
          </span>
          <span style={{ flex: 1 }} />
          {totalDuration && totalDuration > 0 && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {formatDuration(totalDuration)}
            </span>
          )}
        </div>

        {/* Last step preview */}
        {lastStep && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginLeft: 22,
          }}>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {getToolIcon(lastStep.toolName)}
            </span>
            <span style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {lastStep.displayName || lastStep.toolName}
            </span>
          </div>
        )}

        {/* Summary line */}
        {lastStepSummary && (
          <p style={{
            margin: '4px 0 0 22px',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {lastStepSummary}
          </p>
        )}
      </button>
    );
  }

  // Expanded state
  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--color-bg-secondary, #1a1a1a)',
      border: '1px solid var(--color-border, #333)',
      borderRadius: 8,
    }}>
      {/* Header */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 0,
          paddingBottom: 12,
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--color-border, #333)',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          marginBottom: 12,
        }}
      >
        <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          {toolCalls.length} step{toolCalls.length !== 1 ? 's' : ''}
        </span>
        <span style={{ flex: 1 }} />
        {totalDuration && totalDuration > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {formatDuration(totalDuration)}
          </span>
        )}
      </button>

      {/* Steps with timeline */}
      <div>
        {toolCalls.map((toolCall, idx) => (
          <StepItem
            key={toolCall.id}
            toolCall={toolCall}
            isLast={idx === toolCalls.length - 1}
            isExpanded={expandedSteps.has(toolCall.id)}
            onToggle={() => toggleStep(toolCall.id)}
            showTimeline={toolCalls.length > 1}
          />
        ))}
      </div>
    </div>
  );
});

StepsContainer.displayName = 'StepsContainer';

// ============================================================================
// Main Component
// ============================================================================

export const AgenticActivityStream: React.FC<AgenticActivityStreamProps> = ({
  isStreaming,
  streamingState,
  contentBlocks,
  tasks = [],
  toolCalls = [],
  theme = 'dark',
  onInterrupt,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [thinkingExpanded, setThinkingExpanded] = useState(true);

  // Check if we have truly interleaved content (thinking + text blocks mixed)
  const hasInterleavedContent = useMemo(() => {
    const hasThinking = contentBlocks.some(b => b.type === 'thinking');
    const hasText = contentBlocks.some(b => b.type === 'text');
    return hasThinking && hasText && contentBlocks.length > 1;
  }, [contentBlocks]);

  // Extract thinking content from content blocks (only for non-interleaved display)
  const thinkingContent = useMemo(() => {
    if (hasInterleavedContent) return ''; // Don't merge when interleaved
    return contentBlocks
      .filter(b => b.type === 'thinking')
      .map(b => b.content)
      .join('\n');
  }, [contentBlocks, hasInterleavedContent]);

  const isThinkingActive = streamingState === 'thinking';

  // Calculate total duration
  const totalDuration = useMemo(() => {
    return toolCalls.reduce((sum, t) => sum + (t.duration || 0), 0);
  }, [toolCalls]);

  // Auto-expand during streaming
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true);
      setThinkingExpanded(true);
    }
  }, [isStreaming]);

  // Auto-collapse after streaming completes
  useEffect(() => {
    if (!isStreaming && streamingState === 'complete' && toolCalls.length > 0) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
        setThinkingExpanded(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, streamingState, toolCalls.length]);

  // Nothing to show
  if (toolCalls.length === 0 && !thinkingContent && !hasInterleavedContent) return null;

  return (
    <div
      className={className}
      data-theme={theme}
      style={{ marginBottom: 16 }}
    >
      {/* Interrupt button during streaming */}
      {isStreaming && onInterrupt && streamingState !== 'complete' && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 8,
        }}>
          <button
            onClick={onInterrupt}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--color-border, #333)',
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 12,
            }}
          >
            <XCircle size={14} />
            Stop
          </button>
        </div>
      )}

      {/* Interleaved content - render blocks in order like Claude */}
      {hasInterleavedContent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contentBlocks.map((block, index) => {
            if (block.type === 'thinking') {
              // Thinking block - collapsible with token count
              const isLastThinking = !contentBlocks.slice(index + 1).some(b => b.type === 'thinking');
              return (
                <ThinkingBlock
                  key={block.id}
                  content={block.content}
                  isStreaming={isThinkingActive && isLastThinking}
                  isExpanded={thinkingExpanded}
                  onToggle={() => setThinkingExpanded(prev => !prev)}
                />
              );
            } else if (block.type === 'text') {
              // Text block - render as markdown content
              return (
                <div
                  key={block.id}
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: 'var(--color-text)',
                  }}
                >
                  {block.content}
                </div>
              );
            }
            return null;
          })}
        </div>
      ) : (
        /* Legacy: Single merged thinking block */
        thinkingContent && (
          <ThinkingBlock
            content={thinkingContent}
            isStreaming={isThinkingActive}
            isExpanded={thinkingExpanded}
            onToggle={() => setThinkingExpanded(prev => !prev)}
          />
        )
      )}

      {/* Steps container */}
      {toolCalls.length > 0 && (
        <StepsContainer
          toolCalls={toolCalls}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(prev => !prev)}
          isStreaming={isStreaming}
          totalDuration={totalDuration}
        />
      )}
    </div>
  );
};

export default AgenticActivityStream;
