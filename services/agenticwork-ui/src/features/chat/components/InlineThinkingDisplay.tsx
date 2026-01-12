/**
 * Inline Thinking Display
 *
 * Inline thinking UI features:
 * - During thinking: Animated think.svg icon with "Thinking…" text
 * - Streams thinking content in real-time
 * - After completion: Collapsible block (collapsed by default) with metrics
 * - Click header to expand/collapse
 *
 * This component appears INLINE in the chat flow, above the assistant's response.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from '@/shared/icons';

// Animated thinking icon using think.svg
const ThinkingIcon: React.FC<{ isAnimating: boolean; size?: number }> = ({ isAnimating, size = 20 }) => (
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

interface InlineThinkingDisplayProps {
  isThinking: boolean;
  thinkingContent?: string;
  isCompleted?: boolean;
  elapsedMs?: number;
  theme?: 'light' | 'dark';
}

export const InlineThinkingDisplay: React.FC<InlineThinkingDisplayProps> = ({
  isThinking,
  thinkingContent,
  isCompleted = false,
  elapsedMs = 0,
  theme = 'dark',
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  // Start expanded while thinking, collapse when completed
  const [isExpanded, setIsExpanded] = useState(true);

  // Auto-collapse when thinking completes
  useEffect(() => {
    if (isCompleted && !isThinking) {
      setIsExpanded(false);
    }
  }, [isCompleted, isThinking]);

  // Auto-scroll to bottom when new content streams in
  useEffect(() => {
    if (contentRef.current && isThinking && isExpanded) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [thinkingContent, isThinking, isExpanded]);

  // Don't render if no content and not thinking
  if (!thinkingContent && !isThinking) {
    return null;
  }

  // Format elapsed time
  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Estimate tokens (rough: ~4 chars per token)
  const estimatedTokens = Math.ceil((thinkingContent?.length || 0) / 4);

  return (
    <div
      className="thinking-block-inline thinking"
      data-testid="thinking-block"
      style={{
        marginBottom: '8px',
        borderRadius: '6px',
        border: '1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)',
        background: 'color-mix(in srgb, var(--color-primary) 5%, transparent)',
        overflow: 'hidden',
      }}
    >
      {/* Collapsible Header - Click to expand/collapse */}
      <button
        onClick={() => !isThinking && setIsExpanded(!isExpanded)}
        disabled={isThinking}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: isThinking ? 'default' : 'pointer',
          textAlign: 'left',
          color: 'var(--color-text)',
          fontSize: '13px',
        }}
      >
        {/* Animated think.svg during thinking, chevron when complete */}
        {isThinking ? (
          <ThinkingIcon isAnimating={true} size={20} />
        ) : isExpanded ? (
          <ChevronDown size={16} style={{ color: 'var(--color-textMuted)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={16} style={{ color: 'var(--color-textMuted)', flexShrink: 0 }} />
        )}

        {/* Title: "⏵ Thought for Ns" */}
        <span style={{
          fontWeight: 500,
          color: isThinking ? 'var(--color-primary)' : 'var(--color-textMuted)',
        }}>
          {isThinking ? 'Thinking…' : `Thought for ${formatTime(elapsedMs)}`}
        </span>

        {/* Keyboard hint for expanding */}
        {!isThinking && !isExpanded && (
          <span style={{
            fontSize: '11px',
            color: 'var(--color-textMuted)',
            opacity: 0.7,
          }}>
            (click to show thinking)
          </span>
        )}

        {/* Metrics - only show tokens (time is in title now) */}
        <span style={{
          marginLeft: 'auto',
          fontSize: '11px',
          color: 'var(--color-textMuted)',
          display: 'flex',
          gap: '12px',
        }}>
          {estimatedTokens > 0 && !isThinking && (
            <span>~{estimatedTokens} tokens</span>
          )}
        </span>
      </button>

      {/* Content Area - Shown when expanded or thinking */}
      {(isExpanded || isThinking) && thinkingContent && (
        <div
          ref={contentRef}
          style={{
            maxHeight: '300px',
            overflowY: 'auto',
            padding: '0 12px 12px 12px',
            borderTop: '1px solid color-mix(in srgb, var(--color-primary) 10%, transparent)',
          }}
        >
          {/* CLAUDE CODE STYLE: Gray italic text for thinking content */}
        <pre style={{
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
          }}>
            {thinkingContent}
            {isThinking && (
              <span style={{
                color: 'var(--color-primary)',
                animation: 'blink 1s infinite',
                marginLeft: '2px',
              }}>▊</span>
            )}
          </pre>
        </div>
      )}

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

export default InlineThinkingDisplay;
