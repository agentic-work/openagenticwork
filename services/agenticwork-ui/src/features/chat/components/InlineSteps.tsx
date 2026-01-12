/**
 * InlineSteps - Claude.ai-style Agentic Activity Display
 *
 * REDESIGNED to match Claude.ai's patterns:
 * 1. "X steps" collapsible container with step count
 * 2. Vertical timeline connector between steps
 * 3. Nested thinking blocks per step
 * 4. Tool result previews (search results, file counts, etc.)
 * 5. Summary line showing what was accomplished
 * 6. Auto-collapse when complete
 * 7. Artifact cards for code outputs
 *
 * @copyright 2026 Agenticwork LLC
 */

import React, { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { Check, Loader2, AlertCircle, ChevronRight, ChevronDown, Globe, FileText, Code, Terminal, Search, Edit3, Eye, Folder, ExternalLink } from '@/shared/icons';
import { AgentState, AgentActivity, AgentPhase } from './UnifiedAgentActivity/types';
import { ThinkingSphere } from './UnifiedAgentActivity/ThinkingSphere';

// ============================================================================
// Types
// ============================================================================

export interface InlineStep {
  id: string;
  type: 'thinking' | 'tool' | 'search' | 'read' | 'write' | 'bash' | 'edit' | 'glob' | 'grep' | 'handoff' | 'web_search' | 'mcp';
  status: 'pending' | 'running' | 'complete' | 'completed' | 'error';
  content?: string;
  title?: string;
  summary?: string;
  detail?: string;
  request?: string;
  response?: string;
  details?: {
    args?: any;
    result?: any;
    command?: string;
    output?: string;
    content?: string;
  };
  model?: string;
  round?: number;
  duration?: number;
  startTime?: number;
  endTime?: number;
  // New: for web search results
  resultCount?: number;
  searchResults?: Array<{ title: string; url: string; favicon?: string }>;
  // New: for nested thinking
  thinkingContent?: string;
}

export type DisplayMode = 'verbose' | 'compact';

interface TurnInfo {
  turnId: string;
  isFirst: boolean;
  isLast: boolean;
  turnToolCount: number;
  roundCount?: number;
}

interface InlineStepsProps {
  agentState?: AgentState;
  steps?: InlineStep[];
  currentThinking?: string;
  isStreaming?: boolean;
  mode?: DisplayMode;
  turnInfo?: TurnInfo;
}

// ============================================================================
// Utility Functions
// ============================================================================

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const getStepIcon = (step: InlineStep): React.ReactNode => {
  const iconProps = { size: 14, strokeWidth: 2 };
  switch (step.type) {
    case 'web_search':
    case 'search':
      return <Globe {...iconProps} />;
    case 'read':
      return <Eye {...iconProps} />;
    case 'write':
      return <FileText {...iconProps} />;
    case 'edit':
      return <Edit3 {...iconProps} />;
    case 'bash':
      return <Terminal {...iconProps} />;
    case 'glob':
    case 'grep':
      return <Folder {...iconProps} />;
    case 'mcp':
      return <Code {...iconProps} />;
    default:
      return <Code {...iconProps} />;
  }
};

const getStepTitle = (step: InlineStep): string => {
  const content = step.content || step.title || '';

  // For web search, show the query
  if (step.type === 'web_search' || step.type === 'search') {
    return content || 'Searching the web';
  }

  // For file operations, show the path
  if (['read', 'write', 'edit', 'glob', 'grep'].includes(step.type)) {
    const match = content.match(/(?:Read|Write|Edit|Glob|Grep)\s+(.+)/i);
    return match ? match[1].trim() : content;
  }

  return content;
};

const getStepSummary = (step: InlineStep): string | null => {
  if (step.summary) return step.summary;

  const response = step.response || step.details?.result;
  if (!response) return null;

  const text = typeof response === 'string' ? response : JSON.stringify(response);

  // For file reads, count lines
  if (step.type === 'read') {
    const lines = (text.match(/\n/g) || []).length + 1;
    return `Read ${lines} lines`;
  }

  // Truncate long responses
  if (text.length > 100) {
    return text.slice(0, 100) + '...';
  }

  return text;
};

const buildResponse = (step: InlineStep): string | null => {
  if (step.response) return step.response;
  if (step.details?.result) {
    const result = step.details.result;
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }
  if (step.details?.output) return step.details.output;
  if (step.details?.content) return step.details.content;
  return null;
};

// ============================================================================
// Step Status Indicator
// ============================================================================

const StepStatusDot: React.FC<{ status: InlineStep['status']; isActive?: boolean }> = memo(({ status, isActive }) => {
  const isComplete = status === 'complete' || status === 'completed';
  const isRunning = status === 'running';
  const isError = status === 'error';

  // Color based on status
  let color = 'var(--color-text-muted)';
  if (isComplete) color = 'var(--color-success, #34C759)';
  else if (isRunning || isActive) color = 'var(--color-primary, #0A84FF)';
  else if (isError) color = 'var(--color-error, #FF3B30)';

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
      {isRunning ? (
        <Loader2 size={10} className="animate-spin" style={{ color }} />
      ) : isComplete ? (
        <Check size={10} style={{ color }} />
      ) : isError ? (
        <AlertCircle size={10} style={{ color }} />
      ) : (
        <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }} />
      )}
    </span>
  );
});

StepStatusDot.displayName = 'StepStatusDot';

// ============================================================================
// Thinking Block (Claude.ai style - nested within steps)
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
  const contentRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  if (!content) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--color-bg-tertiary, #252525)',
          border: '1px solid var(--color-border, #333)',
          borderRadius: 8,
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
        <ThinkingSphere phase={isStreaming ? 'thinking' : 'complete'} size={14} />
        <span style={{
          fontSize: 13,
          color: 'var(--color-text-secondary)',
        }}>
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        <span style={{ flex: 1 }} />
        {duration && !isStreaming && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {formatDuration(duration)}
          </span>
        )}
      </button>

      {isExpanded && (
        <div style={{
          marginTop: 4,
          padding: '12px 16px',
          background: 'var(--color-bg-tertiary, #252525)',
          border: '1px solid var(--color-border, #333)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
        }}>
          <pre
            ref={contentRef}
            style={{
              margin: 0,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 300,
              overflowY: 'auto',
              lineHeight: 1.6,
            }}
          >
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
// Search Results Preview (Claude.ai style)
// ============================================================================

interface SearchResultsPreviewProps {
  query: string;
  results?: Array<{ title: string; url: string; favicon?: string }>;
  resultCount?: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const SearchResultsPreview: React.FC<SearchResultsPreviewProps> = memo(({
  query,
  results,
  resultCount,
  isExpanded,
  onToggle
}) => {
  const count = resultCount || results?.length || 0;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--color-bg-tertiary, #252525)',
          border: '1px solid var(--color-border, #333)',
          borderRadius: isExpanded ? '8px 8px 0 0' : 8,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <Globe size={14} style={{ color: 'var(--color-primary)' }} />
        <span style={{
          fontSize: 13,
          color: 'var(--color-text)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {query}
        </span>
        {count > 0 && (
          <span style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            padding: '2px 8px',
            background: 'var(--color-bg-secondary)',
            borderRadius: 4,
          }}>
            {count} results
          </span>
        )}
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>

      {isExpanded && results && results.length > 0 && (
        <div style={{
          padding: '8px 0',
          background: 'var(--color-bg-tertiary, #252525)',
          border: '1px solid var(--color-border, #333)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
        }}>
          {results.slice(0, 8).map((result, idx) => (
            <a
              key={idx}
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                textDecoration: 'none',
                color: 'var(--color-text)',
                fontSize: 13,
              }}
            >
              {result.favicon ? (
                <img src={result.favicon} alt="" style={{ width: 16, height: 16 }} />
              ) : (
                <FileText size={14} style={{ color: 'var(--color-text-muted)' }} />
              )}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {result.title}
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {new URL(result.url).hostname}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
});

SearchResultsPreview.displayName = 'SearchResultsPreview';

// ============================================================================
// Single Step Item (Claude.ai style with timeline)
// ============================================================================

interface StepItemProps {
  step: InlineStep;
  isLast: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  showTimeline: boolean;
}

const StepItem: React.FC<StepItemProps> = memo(({
  step,
  isLast,
  isExpanded,
  onToggle,
  showTimeline
}) => {
  const isComplete = step.status === 'complete' || step.status === 'completed';
  const isRunning = step.status === 'running';
  const isWebSearch = step.type === 'web_search' || step.type === 'search';
  const hasThinking = Boolean(step.thinkingContent);
  const response = buildResponse(step);
  const summary = getStepSummary(step);
  const title = getStepTitle(step);

  // Nested expansion states
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [resultsExpanded, setResultsExpanded] = useState(false);

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
          <StepStatusDot status={step.status} isActive={isRunning} />
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
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--color-text-muted)' }}>
            {getStepIcon(step)}
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
            {title}
          </span>

          {/* Result badge */}
          {step.resultCount && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              padding: '2px 6px',
              background: 'var(--color-bg-secondary)',
              borderRadius: 4,
            }}>
              {step.resultCount} results
            </span>
          )}

          {step.duration && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {formatDuration(step.duration)}
            </span>
          )}

          {(response || hasThinking || isWebSearch) && (
            isExpanded ? (
              <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
            )
          )}
        </button>

        {/* Summary line (when collapsed) */}
        {!isExpanded && summary && !isRunning && (
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
        {isExpanded && (
          <div style={{ marginTop: 8, marginLeft: 22 }}>
            {/* Web search results */}
            {isWebSearch && step.searchResults && (
              <SearchResultsPreview
                query={title}
                results={step.searchResults}
                resultCount={step.resultCount}
                isExpanded={resultsExpanded}
                onToggle={() => setResultsExpanded(prev => !prev)}
              />
            )}

            {/* Nested thinking block */}
            {hasThinking && step.thinkingContent && (
              <ThinkingBlock
                content={step.thinkingContent}
                isStreaming={isRunning}
                isExpanded={thinkingExpanded}
                onToggle={() => setThinkingExpanded(prev => !prev)}
              />
            )}

            {/* Tool response/result */}
            {response && !isWebSearch && (
              <div style={{
                marginTop: 8,
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
                  {response.slice(0, 2000)}{response.length > 2000 ? '...' : ''}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Running indicator */}
        {isRunning && !response && (
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
// Artifact Card (Claude.ai style for code outputs)
// ============================================================================

interface ArtifactCardProps {
  title: string;
  type: string;
  filename?: string;
  onOpenInVSCode?: () => void;
}

export const ArtifactCard: React.FC<ArtifactCardProps> = memo(({
  title,
  type,
  filename,
  onOpenInVSCode
}) => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      background: 'var(--color-bg-secondary, #1a1a1a)',
      border: '1px solid var(--color-border, #333)',
      borderRadius: 8,
      marginTop: 16,
    }}>
      {/* Icon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        background: 'var(--color-bg-tertiary, #252525)',
        borderRadius: 8,
      }}>
        <Code size={20} style={{ color: 'var(--color-text-muted)' }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {type}{filename ? ` · ${filename}` : ''}
        </div>
      </div>

      {/* Open in VS Code button */}
      {onOpenInVSCode && (
        <button
          onClick={onOpenInVSCode}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 12px',
            background: 'var(--color-bg-tertiary, #252525)',
            border: '1px solid var(--color-border, #333)',
            borderRadius: 6,
            cursor: 'pointer',
            color: 'var(--color-text)',
            fontSize: 13,
          }}
        >
          <ExternalLink size={14} />
          Open in Visual Studio Code
        </button>
      )}
    </div>
  );
});

ArtifactCard.displayName = 'ArtifactCard';

// ============================================================================
// Steps Container (Claude.ai style - "X steps" collapsible)
// ============================================================================

interface StepsContainerProps {
  steps: InlineStep[];
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming: boolean;
  summaryLine?: string;
  totalDuration?: number;
}

const StepsContainer: React.FC<StepsContainerProps> = memo(({
  steps,
  isExpanded,
  onToggle,
  isStreaming,
  summaryLine,
  totalDuration
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const completedCount = steps.filter(s => s.status === 'complete' || s.status === 'completed').length;
  const allComplete = completedCount === steps.length && !isStreaming;

  // Auto-expand all steps during streaming
  useEffect(() => {
    if (isStreaming) {
      setExpandedSteps(new Set(steps.map(s => s.id)));
    }
  }, [isStreaming, steps]);

  const toggleStep = useCallback((stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

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
            {steps.length} step{steps.length !== 1 ? 's' : ''}
          </span>
          <span style={{ flex: 1 }} />
          {totalDuration && totalDuration > 0 && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {formatDuration(totalDuration)}
            </span>
          )}
        </div>

        {/* Last step name */}
        {steps.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginLeft: 22,
          }}>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {getStepIcon(steps[steps.length - 1])}
            </span>
            <span style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {getStepTitle(steps[steps.length - 1])}
            </span>
          </div>
        )}

        {/* Summary line */}
        {summaryLine && (
          <p style={{
            margin: '4px 0 0 22px',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {summaryLine}
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
          {steps.length} step{steps.length !== 1 ? 's' : ''}
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
        {steps.map((step, idx) => (
          <StepItem
            key={step.id}
            step={step}
            isLast={idx === steps.length - 1}
            isExpanded={expandedSteps.has(step.id)}
            onToggle={() => toggleStep(step.id)}
            showTimeline={steps.length > 1}
          />
        ))}
      </div>
    </div>
  );
});

StepsContainer.displayName = 'StepsContainer';

// ============================================================================
// Convert AgentActivity to InlineStep
// ============================================================================

const activityToStep = (activity: AgentActivity): InlineStep => {
  let type: InlineStep['type'] = 'tool';
  const contentLower = (activity.content || '').toLowerCase();

  if (contentLower.includes('read')) type = 'read';
  else if (contentLower.includes('write')) type = 'write';
  else if (contentLower.includes('edit')) type = 'edit';
  else if (contentLower.includes('bash') || contentLower.includes('shell')) type = 'bash';
  else if (contentLower.includes('grep')) type = 'grep';
  else if (contentLower.includes('glob')) type = 'glob';
  else if (contentLower.includes('search') || contentLower.includes('web_search')) type = 'web_search';
  else if (contentLower.includes('mcp')) type = 'mcp';
  else if (activity.type === 'handoff') type = 'handoff';

  let response: string | undefined;
  try {
    if (activity.result) {
      response = typeof activity.result === 'string' ? activity.result : JSON.stringify(activity.result, null, 2);
    }
  } catch {
    // Ignore serialization errors
  }

  return {
    id: activity.id,
    type,
    status: activity.status === 'executing' ? 'running' :
            activity.status === 'complete' ? 'complete' :
            activity.status === 'error' ? 'error' : 'pending',
    content: typeof activity.content === 'string' ? activity.content : String(activity.content || 'Unknown'),
    response,
    model: activity.model,
    round: activity.round,
    duration: activity.duration,
  };
};

// ============================================================================
// Main Component
// ============================================================================

export const InlineSteps: React.FC<InlineStepsProps> = ({
  agentState,
  steps: propSteps,
  currentThinking,
  isStreaming = false,
  mode = 'verbose',
  turnInfo,
}) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  const [thinkingExpanded, setThinkingExpanded] = useState(isStreaming);
  const [thinkingDuration, setThinkingDuration] = useState(0);
  const thinkingStartRef = useRef<number | null>(null);

  // Build steps list
  const steps: InlineStep[] = useMemo(() => {
    if (propSteps && propSteps.length > 0) return propSteps;
    if (!agentState) return [];
    return agentState.activities
      .filter(a => a.type === 'tool_call' || a.type === 'handoff')
      .map(activityToStep);
  }, [agentState, propSteps]);

  // Thinking content
  const thinkingContent = currentThinking || agentState?.thinkingContent;
  const isThinkingActive = agentState
    ? agentState.phase === 'thinking'
    : (isStreaming && Boolean(currentThinking));

  // Track thinking duration
  useEffect(() => {
    if (isThinkingActive && !thinkingStartRef.current) {
      thinkingStartRef.current = Date.now();
    }
    if (!isThinkingActive && thinkingStartRef.current) {
      setThinkingDuration(Date.now() - thinkingStartRef.current);
      thinkingStartRef.current = null;
    }
  }, [isThinkingActive]);

  // Live duration update
  useEffect(() => {
    if (!isThinkingActive || !thinkingStartRef.current) return;
    const interval = setInterval(() => {
      if (thinkingStartRef.current) {
        setThinkingDuration(Date.now() - thinkingStartRef.current);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isThinkingActive]);

  // Calculate totals
  const totalDuration = useMemo(() => {
    return steps.reduce((sum, s) => sum + (s.duration || 0), 0) + thinkingDuration;
  }, [steps, thinkingDuration]);

  // Generate summary line
  const summaryLine = useMemo(() => {
    if (steps.length === 0) return undefined;
    const lastStep = steps[steps.length - 1];
    const summary = getStepSummary(lastStep);
    return summary || undefined;
  }, [steps]);

  // Auto-expand during streaming
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true);
      setThinkingExpanded(true);
    }
  }, [isStreaming]);

  // Auto-collapse after streaming
  useEffect(() => {
    if (!isStreaming && (steps.length > 0 || thinkingContent)) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
        setThinkingExpanded(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, steps.length, thinkingContent]);

  // Nothing to show
  if (steps.length === 0 && !thinkingContent) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Global thinking block (shows at top when streaming thinking) */}
      {thinkingContent && (
        <div style={{ marginBottom: steps.length > 0 ? 12 : 0 }}>
          <ThinkingBlock
            content={thinkingContent}
            isStreaming={isThinkingActive}
            duration={thinkingDuration}
            isExpanded={thinkingExpanded}
            onToggle={() => setThinkingExpanded(prev => !prev)}
          />
        </div>
      )}

      {/* Steps container */}
      {steps.length > 0 && (
        <StepsContainer
          steps={steps}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(prev => !prev)}
          isStreaming={isStreaming}
          summaryLine={summaryLine}
          totalDuration={totalDuration}
        />
      )}
    </div>
  );
};

export default InlineSteps;
