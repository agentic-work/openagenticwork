/**
 * ThinkingBox Component - Claude Desktop Style
 *
 * A static, collapsible box that displays the AI's actual thinking process
 * as it streams. Inspired by Claude Desktop's extended thinking display.
 *
 * Features:
 * - Always visible when there's thinking content
 * - Streams content in real-time with typing cursor
 * - Collapsible with smooth animation
 * - Shows token count and elapsed time metrics
 * - Monospace font for readability
 * - Auto-scrolls to bottom as content streams
 * - Theme-aware via CSS variables (no JS theme switching needed)
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronDown, ChevronRight, Sparkles, Clock, Zap } from '@/shared/icons';

interface ThinkingBoxProps {
  /** The actual thinking content from the LLM */
  content: string;
  /** Whether the LLM is currently thinking (streaming) */
  isThinking: boolean;
  /** Whether the box should be collapsed by default */
  defaultCollapsed?: boolean;
  /** Token metrics */
  metrics?: {
    tokens: number;
    elapsedMs: number;
    tokensPerSecond: number;
  } | null;
}

export const ThinkingBox: React.FC<ThinkingBoxProps> = ({
  content,
  isThinking,
  defaultCollapsed = false,
  metrics,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevContentLength = useRef(0);

  // Auto-scroll to bottom as content streams
  useEffect(() => {
    if (contentRef.current && content.length > prevContentLength.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
    prevContentLength.current = content.length;
  }, [content]);

  // Don't render if no content AND not thinking
  // Also don't render if content is empty string (cleared after completion)
  if ((!content || content.trim() === '') && !isThinking) {
    return null;
  }

  // Format time display
  const formatTime = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}s`;
  };

  // Format number with K suffix for large numbers
  const formatTokens = (num: number): string => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="thinking-box thinking-box-gradient rounded-lg overflow-hidden mb-4 border">
      {/* Header - Click to collapse/expand */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors bg-transparent cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {/* Brain icon with pulse when thinking */}
          <div className="relative">
            <Brain
              size={18}
              className={isThinking ? 'text-[var(--color-primaryLight)]' : 'text-[var(--color-primary)]'}
            />
            {isThinking && (
              <motion.div
                className="absolute -inset-1"
                animate={{
                  scale: [1, 1.3, 1],
                  opacity: [0.5, 0.2, 0.5]
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
              >
                <Sparkles size={22} className="text-[var(--color-primaryLight)]" />
              </motion.div>
            )}
          </div>

          {/* Title - minimal text */}
          <span className="text-xs font-normal thinking-label">
            {isThinking ? '' : 'Reasoning'}
          </span>

          {/* Metrics badges */}
          {metrics && (
            <div className="flex items-center gap-2 ml-2">
              {metrics.tokens > 0 && (
                <span className="thinking-badge flex items-center gap-1 text-xs px-2 py-0.5 rounded-full">
                  <Zap size={10} />
                  {formatTokens(metrics.tokens)} tokens
                </span>
              )}
              {metrics.elapsedMs > 0 && (
                <span className="thinking-badge flex items-center gap-1 text-xs px-2 py-0.5 rounded-full">
                  <Clock size={10} />
                  {formatTime(metrics.elapsedMs)}
                </span>
              )}
              {metrics.tokensPerSecond > 0 && (
                <span className="text-xs thinking-label">
                  ({metrics.tokensPerSecond.toFixed(1)} tok/s)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Collapse indicator */}
        <div className="thinking-label">
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Content area */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              ref={contentRef}
              className="px-4 pb-4 overflow-y-auto thinking-scrollbar"
              style={{ maxHeight: '400px' }}
            >
              {/* Thinking content */}
              <pre className="text-sm leading-relaxed whitespace-pre-wrap break-words font-mono text-[var(--color-text)] m-0 p-0 opacity-90">
                {content || (isThinking ? 'Starting to think...' : '')}
                {/* Typing cursor when thinking */}
                {isThinking && (
                  <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="thinking-cursor inline-block w-2 h-4 ml-0.5 align-text-bottom"
                  />
                )}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ThinkingBox;
