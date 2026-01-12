/**
 * Streaming Thinking Block Component
 *
 * Streaming thinking display with:
 * - Markdown rendering for thinking content
 * - Live status bar showing what the LLM is working on
 * - Real-time token usage (input/output)
 * - Time elapsed counter
 * - Emphasis on the current line being streamed
 * - Gradient highlighting for active content
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Clock,
  Zap,
  ArrowDown,
  ArrowUp,
  Activity,
  Loader2
} from '@/shared/icons';

interface StreamingThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  // Live metrics
  inputTokens?: number;
  outputTokens?: number;
  startTime?: number;
  // Status info
  currentTask?: string;  // e.g., "Planning Physics Engine Details"
  model?: string;
}

// Parse thinking content to extract task headers (marked with **)
const parseThinkingContent = (content: string): { currentTask: string; sections: string[] } => {
  const lines = content.split('\n');
  let currentTask = '';
  const sections: string[] = [];

  for (const line of lines) {
    // Match **Task Name** pattern
    const taskMatch = line.match(/^\*\*([^*]+)\*\*$/);
    if (taskMatch) {
      currentTask = taskMatch[1];
    }
  }

  return { currentTask, sections };
};

export const StreamingThinkingBlock: React.FC<StreamingThinkingBlockProps> = ({
  content,
  isStreaming = false,
  isExpanded: externalIsExpanded,
  onToggle: externalOnToggle,
  inputTokens = 0,
  outputTokens = 0,
  startTime,
  currentTask: externalCurrentTask,
  model
}) => {
  const [internalIsExpanded, setInternalIsExpanded] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevContentLength = useRef(0);

  // Use external state if provided, otherwise use internal state
  const isExpanded = externalIsExpanded !== undefined ? externalIsExpanded : internalIsExpanded;
  const handleToggle = externalOnToggle || (() => setInternalIsExpanded(!internalIsExpanded));

  // Parse content to extract current task
  const { currentTask: parsedTask } = useMemo(() => parseThinkingContent(content), [content]);
  const currentTask = externalCurrentTask || parsedTask || 'Processing...';

  // Update elapsed time
  useEffect(() => {
    if (!isStreaming || !startTime) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming, startTime]);

  // Auto-scroll to follow streaming content
  useEffect(() => {
    if (!isStreaming || !contentRef.current) return;

    if (content.length > prevContentLength.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
    prevContentLength.current = content.length;
  }, [content, isStreaming]);

  // Format elapsed time as mm:ss
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get the last few lines for emphasis effect
  const contentLines = content.split('\n');
  const lastLineIndex = contentLines.length - 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="streaming-thinking-block rounded-xl overflow-hidden mb-4 border border-purple-500/30 bg-gradient-to-b from-purple-950/20 to-slate-900/50"
      style={{
        boxShadow: isStreaming ? '0 0 20px rgba(168, 85, 247, 0.15)' : 'none'
      }}
    >
      {/* Collapsible Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer bg-purple-950/30 border-b border-purple-500/20 hover:bg-purple-950/40 transition-colors"
        onClick={handleToggle}
      >
        {/* Left: Brain icon + Status */}
        <div className="flex items-center gap-3">
          <div className="relative">
            {isStreaming ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              >
                <Brain className="w-5 h-5 text-purple-400" />
              </motion.div>
            ) : (
              <Brain className="w-5 h-5 text-purple-400/60" />
            )}
            {isStreaming && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            )}
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-semibold text-purple-300">
              {isStreaming ? 'Thinking...' : 'Thought Process'}
            </span>
            {currentTask && (
              <span className="text-xs text-purple-400/70 truncate max-w-[300px]">
                {currentTask}
              </span>
            )}
          </div>
        </div>

        {/* Right: Metrics + Expand */}
        <div className="flex items-center gap-4">
          {/* Live Token Usage */}
          <div className="flex items-center gap-3 text-xs">
            {/* Input tokens */}
            <div className="flex items-center gap-1 text-blue-400/80">
              <ArrowDown className="w-3 h-3" />
              <span>{inputTokens.toLocaleString()}</span>
            </div>

            {/* Output tokens */}
            <div className="flex items-center gap-1 text-green-400/80">
              <ArrowUp className="w-3 h-3" />
              <span>{outputTokens.toLocaleString()}</span>
            </div>

            {/* Time elapsed */}
            {(isStreaming || elapsedTime > 0) && (
              <div className="flex items-center gap-1 text-amber-400/80">
                <Clock className="w-3 h-3" />
                <span>{formatTime(elapsedTime)}</span>
              </div>
            )}
          </div>

          {/* Activity indicator */}
          {isStreaming && (
            <motion.div
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <Activity className="w-4 h-4 text-purple-400" />
            </motion.div>
          )}

          {/* Expand/collapse */}
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-purple-400/60"
          >
            <ChevronDown className="w-5 h-5" />
          </motion.div>
        </div>
      </div>

      {/* Content Area with Markdown */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              ref={contentRef}
              className="p-4 max-h-[500px] overflow-y-auto"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(168, 85, 247, 0.3) transparent'
              }}
            >
              {/* Render content with markdown and line emphasis */}
              <div className="thinking-content space-y-1">
                {contentLines.map((line, index) => {
                  const isLastLine = index === lastLineIndex && isStreaming;
                  const isRecentLine = index >= lastLineIndex - 2 && isStreaming;
                  const isHeader = line.startsWith('**') && line.endsWith('**');

                  return (
                    <motion.div
                      key={index}
                      initial={isRecentLine ? { opacity: 0, x: -10 } : false}
                      animate={{ opacity: 1, x: 0 }}
                      className={`
                        text-sm leading-relaxed font-mono
                        ${isLastLine ? 'text-purple-200 font-medium' : 'text-purple-300/70'}
                        ${isRecentLine && !isLastLine ? 'text-purple-300/85' : ''}
                        ${isHeader ? 'text-purple-100 font-semibold mt-3 mb-1' : ''}
                      `}
                      style={{
                        borderLeft: isLastLine ? '3px solid rgb(168, 85, 247)' : isRecentLine ? '2px solid rgba(168, 85, 247, 0.3)' : 'none',
                        paddingLeft: isLastLine || isRecentLine ? '12px' : '0',
                        background: isLastLine ? 'linear-gradient(90deg, rgba(168, 85, 247, 0.1) 0%, transparent 100%)' : 'transparent'
                      }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          // Style markdown elements
                          strong: ({ children }) => (
                            <span className="text-purple-100 font-bold">{children}</span>
                          ),
                          em: ({ children }) => (
                            <span className="text-purple-200/90 italic">{children}</span>
                          ),
                          code: ({ children }) => (
                            <code className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-200 text-xs">
                              {children}
                            </code>
                          ),
                          a: ({ href, children }) => (
                            <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ),
                          ul: ({ children }) => (
                            <ul className="list-disc list-inside pl-2 space-y-0.5">{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="list-decimal list-inside pl-2 space-y-0.5">{children}</ol>
                          ),
                          li: ({ children }) => (
                            <li className="text-purple-300/80">{children}</li>
                          ),
                          p: ({ children }) => (
                            <span>{children}</span>
                          )
                        }}
                      >
                        {line || '\u00A0'}
                      </ReactMarkdown>
                    </motion.div>
                  );
                })}

                {/* Streaming cursor */}
                {isStreaming && (
                  <motion.span
                    className="inline-block w-2 h-4 bg-purple-400 ml-1"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                  />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default StreamingThinkingBlock;
