/**
 * InterleavedContent - Interleaved Thinking Display
 *
 * Renders content blocks in the exact order they arrive from the API:
 * - thinking blocks (collapsible, similar to InlineThinkingDisplay)
 * - text blocks (regular message content)
 * - tool_use blocks (tool call indicators)
 *
 * This enables interleaved thinking where thinking blocks appear
 * inline with the response, not as a single block at the top.
 *
 * Uses the Anthropic Extended/Interleaved Thinking format:
 * - content_block_start: Creates a new block
 * - content_block_delta: Appends content to the block
 * - content_block_stop: Marks block as complete
 *
 * @copyright 2026 Agenticwork LLC
 */

import React, { memo, useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from '@/shared/icons';
import { ContentBlock } from '../hooks/useSSEChat';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ============================================================================
// Types
// ============================================================================

interface InterleavedContentProps {
  blocks: ContentBlock[];
  isStreaming?: boolean;
  theme?: 'light' | 'dark';
  /** Auto-collapse thinking blocks when complete */
  autoCollapse?: boolean;
  /** Show only thinking blocks (for dedicated thinking display) */
  thinkingOnly?: boolean;
}

// ============================================================================
// Animated Thinking Icon
// ============================================================================

const ThinkingIcon: React.FC<{ isAnimating: boolean; size?: number }> = ({ isAnimating, size = 16 }) => (
  <div
    className={isAnimating ? 'thinking-icon-animate' : ''}
    style={{
      width: size,
      height: size,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}
  >
    <img
      src="/think.svg"
      alt="Thinking"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        filter: isAnimating ? 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.5))' : 'none',
      }}
    />
  </div>
);

// ============================================================================
// Thinking Block (Collapsible)
// ============================================================================

interface ThinkingBlockProps {
  content: string;
  isComplete: boolean;
  isStreaming: boolean;
  blockIndex: number;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = memo(({
  content,
  isComplete,
  isStreaming,
  blockIndex
}) => {
  const contentRef = useRef<HTMLPreElement>(null);
  // Expand while streaming, collapse when complete
  const [isExpanded, setIsExpanded] = useState(!isComplete);

  // Auto-scroll during streaming
  useEffect(() => {
    if (contentRef.current && !isComplete && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isComplete, isStreaming]);

  // Auto-collapse when this block completes
  useEffect(() => {
    if (isComplete) {
      // Small delay before collapsing so user can see it's done
      const timer = setTimeout(() => setIsExpanded(false), 800);
      return () => clearTimeout(timer);
    }
  }, [isComplete]);

  if (!content) return null;

  // Estimate tokens (~4 chars per token)
  const estimatedTokens = Math.ceil(content.length / 4);

  return (
    <div
      className="interleaved-thinking-block"
      data-block-index={blockIndex}
      style={{
        marginBottom: '8px',
        borderRadius: '6px',
        border: '1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)',
        background: 'color-mix(in srgb, var(--color-primary) 5%, transparent)',
        overflow: 'hidden',
      }}
    >
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--color-text)',
          fontSize: '13px',
        }}
      >
        {/* Icon - animated think.svg during streaming, chevron when complete */}
        {!isComplete ? (
          <ThinkingIcon isAnimating={isStreaming} size={16} />
        ) : isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-textMuted)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-textMuted)', flexShrink: 0 }} />
        )}

        {/* Title */}
        <span style={{
          fontWeight: 500,
          color: !isComplete ? 'var(--color-primary)' : 'var(--color-textMuted)',
        }}>
          {!isComplete ? 'Thinking…' : 'Thought process'}
        </span>

        {/* Click hint when collapsed */}
        {isComplete && !isExpanded && (
          <span style={{
            fontSize: '11px',
            color: 'var(--color-textMuted)',
            opacity: 0.7,
          }}>
            (click to show)
          </span>
        )}

        {/* Token count */}
        <span style={{
          marginLeft: 'auto',
          fontSize: '11px',
          color: 'var(--color-textMuted)',
        }}>
          {isComplete && estimatedTokens > 0 && `~${estimatedTokens} tokens`}
        </span>
      </button>

      {/* Content Area */}
      {isExpanded && content && (
        <div style={{
          padding: '0 12px 12px 12px',
          borderTop: '1px solid color-mix(in srgb, var(--color-primary) 10%, transparent)',
        }}>
          <pre
            ref={contentRef}
            style={{
              fontSize: '12px',
              lineHeight: '1.5',
              color: 'var(--color-textMuted, var(--text-muted))',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontStyle: 'italic',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: '8px 0 0 0',
              opacity: 0.8,
              borderLeft: '2px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
              paddingLeft: '12px',
              maxHeight: '300px',
              overflowY: 'auto',
            }}
          >
            {content}
            {!isComplete && isStreaming && (
              <span style={{
                color: 'var(--color-primary)',
                animation: 'blink 1s infinite',
                marginLeft: '2px',
              }}>▊</span>
            )}
          </pre>
        </div>
      )}
    </div>
  );
});

ThinkingBlock.displayName = 'ThinkingBlock';

// ============================================================================
// Text Block (Markdown rendered)
// ============================================================================

interface TextBlockProps {
  content: string;
  isComplete: boolean;
  isStreaming: boolean;
  blockIndex: number;
}

const TextBlock: React.FC<TextBlockProps> = memo(({
  content,
  isComplete,
  isStreaming,
  blockIndex
}) => {
  if (!content) return null;

  return (
    <div
      className="interleaved-text-block"
      data-block-index={blockIndex}
      style={{ marginBottom: '4px' }}
    >
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
        {!isComplete && isStreaming && (
          <span
            className="animate-pulse"
            style={{
              display: 'inline-block',
              width: '2px',
              height: '14px',
              marginLeft: '2px',
              backgroundColor: 'var(--color-primary)',
              verticalAlign: 'text-bottom',
            }}
          />
        )}
      </div>
    </div>
  );
});

TextBlock.displayName = 'TextBlock';

// ============================================================================
// Tool Use Block
// ============================================================================

interface ToolUseBlockProps {
  toolName?: string;
  toolId?: string;
  content: string; // JSON args
  isComplete: boolean;
  isStreaming: boolean;
  blockIndex: number;
}

const ToolUseBlock: React.FC<ToolUseBlockProps> = memo(({
  toolName,
  toolId,
  content,
  isComplete,
  isStreaming,
  blockIndex
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="interleaved-tool-block"
      data-block-index={blockIndex}
      style={{
        marginBottom: '8px',
        borderRadius: '6px',
        border: '1px solid color-mix(in srgb, var(--color-info, #0A84FF) 30%, transparent)',
        background: 'color-mix(in srgb, var(--color-info, #0A84FF) 5%, transparent)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--color-text)',
          fontSize: '13px',
        }}
      >
        {!isComplete ? (
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-info, #0A84FF)' }} />
        ) : isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-textMuted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-textMuted)' }} />
        )}

        <span style={{
          fontWeight: 500,
          color: !isComplete ? 'var(--color-info, #0A84FF)' : 'var(--color-textMuted)',
        }}>
          {toolName || 'Tool call'}
        </span>

        {!isComplete && (
          <span style={{ fontSize: '11px', color: 'var(--color-textMuted)' }}>
            Running...
          </span>
        )}
      </button>

      {isExpanded && content && (
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid color-mix(in srgb, var(--color-info, #0A84FF) 10%, transparent)',
        }}>
          <pre style={{
            fontSize: '11px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            color: 'var(--color-textMuted)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            maxHeight: '150px',
            overflowY: 'auto',
          }}>
            {content}
          </pre>
        </div>
      )}
    </div>
  );
});

ToolUseBlock.displayName = 'ToolUseBlock';

// ============================================================================
// Main Component
// ============================================================================

export const InterleavedContent: React.FC<InterleavedContentProps> = ({
  blocks,
  isStreaming = false,
  theme = 'dark',
  autoCollapse = true,
  thinkingOnly = false,
}) => {
  // Filter blocks if thinkingOnly is set
  const displayBlocks = thinkingOnly
    ? blocks.filter(b => b.type === 'thinking')
    : blocks;

  if (displayBlocks.length === 0) return null;

  return (
    <div className="interleaved-content" data-theme={theme}>
      {displayBlocks.map((block) => {
        switch (block.type) {
          case 'thinking':
            return (
              <ThinkingBlock
                key={`thinking-${block.index}`}
                content={block.content}
                isComplete={block.isComplete}
                isStreaming={isStreaming}
                blockIndex={block.index}
              />
            );
          case 'text':
            return (
              <TextBlock
                key={`text-${block.index}`}
                content={block.content}
                isComplete={block.isComplete}
                isStreaming={isStreaming}
                blockIndex={block.index}
              />
            );
          case 'tool_use':
            return (
              <ToolUseBlock
                key={`tool-${block.index}`}
                toolName={block.toolName}
                toolId={block.toolId}
                content={block.content}
                isComplete={block.isComplete}
                isStreaming={isStreaming}
                blockIndex={block.index}
              />
            );
          default:
            return null;
        }
      })}

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes think-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
        }
        @keyframes think-glow {
          0%, 100% {
            filter: drop-shadow(0 0 2px rgba(99, 102, 241, 0.3));
          }
          50% {
            filter: drop-shadow(0 0 6px rgba(99, 102, 241, 0.6));
          }
        }
        .thinking-icon-animate {
          animation: think-pulse 2s ease-in-out infinite, think-glow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default InterleavedContent;
