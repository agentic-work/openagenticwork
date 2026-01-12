/**
 * InlineToolBlock - Git-Style Tool Call Display
 *
 * Renders tool calls (Write, Edit, Bash, etc.) in Agenticode style:
 * - Orange bullet with tool name and file path
 * - Tree connector to code block
 * - Git-style diff with line numbers and +/- markers
 * - Collapsible "Show full diff" for long outputs
 * - Streaming animation as content arrives
 *
 * Uses existing CSS variables for theming.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  Terminal,
  Search,
  Globe,
  Folder,
  Edit3,
  Check,
  X,
  Loader2,
  Clock,
  Copy,
  CheckCheck,
} from '@/shared/icons';
import type { ToolStep, DiffLine } from '@/stores/useCodeModeStore';

// =============================================================================
// Types
// =============================================================================

interface InlineToolBlockProps {
  step: ToolStep;
  theme?: 'light' | 'dark';
  defaultExpanded?: boolean;
  maxPreviewLines?: number;
  onToggleCollapse?: (id: string, collapsed: boolean) => void;
}

// =============================================================================
// Tool Icons & Display Names
// =============================================================================

const TOOL_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  Write: { icon: FileCode, color: 'var(--cm-success)' },
  Edit: { icon: Edit3, color: 'var(--accent-warning)' },
  Read: { icon: File, color: 'var(--color-primary)' },
  ReadFile: { icon: File, color: 'var(--color-primary)' },
  Bash: { icon: Terminal, color: 'var(--color-secondary)' },
  Grep: { icon: Search, color: 'var(--accent-info)' },
  Glob: { icon: Folder, color: 'var(--accent-info)' },
  WebFetch: { icon: Globe, color: 'var(--color-secondary)' },
  WebSearch: { icon: Globe, color: 'var(--color-secondary)' },
  TodoWrite: { icon: Check, color: 'var(--accent-warning)' },
  // Agentic workflow tools
  execute_step: { icon: Terminal, color: 'var(--accent-warning)' },
  create_artifact: { icon: FileCode, color: 'var(--cm-success)' },
  execute_command: { icon: Terminal, color: 'var(--color-secondary)' },
  present_artifact: { icon: File, color: 'var(--cm-success)' },
  run_agentic_task: { icon: Folder, color: 'var(--accent-warning)' },
};

// Tools that show COMPACT format (header only, collapsed by default)
// These are read-only/info tools - no need to show full content
const COMPACT_TOOLS = new Set([
  'Read', 'ReadFile', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
  'List', 'Find', 'list_files', 'read_file', 'read_workspace_file',
  'list_workspace_files', 'get_session_info'
]);

// Tools that show EXPANDED inline diff format (always show content)
// These are write/modify tools - show what changed with git-style +/- markers
const DIFF_TOOLS = new Set([
  'Write', 'Edit', 'Update', 'write_file', 'write_text_file',
  'create_artifact'
]);

// Tools that show PLAIN output format (no line numbers, no +/- markers)
// These tools output text/logs/status, not file diffs
const PLAIN_OUTPUT_TOOLS = new Set([
  'TodoWrite', 'todo_write', 'Task', 'task',
]);

// Tools that show INLINE output (no expandable block, just text)
// These are command execution tools - show output directly under header
const INLINE_OUTPUT_TOOLS = new Set([
  'Bash', 'bash', 'shell', 'execute_command', 'execute_step', 'run_agentic_task',
  'run_bash', 'run_shell', 'execute_shell',
]);

const getToolIcon = (name: string): React.ElementType => {
  return TOOL_CONFIG[name]?.icon || FileCode;
};

const getToolColor = (name: string): string => {
  return TOOL_CONFIG[name]?.color || 'var(--accent-warning)';
};

// =============================================================================
// Diff Parser
// =============================================================================

const parseDiff = (content: string, isNewFile: boolean = false): DiffLine[] => {
  const lines = content.split('\n');
  const diffLines: DiffLine[] = [];
  let lineNum = 1;

  for (const line of lines) {
    if (isNewFile) {
      // All lines are additions for new files
      diffLines.push({
        type: 'add',
        newLineNumber: lineNum++,
        content: line,
      });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      diffLines.push({
        type: 'add',
        newLineNumber: lineNum++,
        content: line.slice(1),
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      diffLines.push({
        type: 'remove',
        oldLineNumber: lineNum,
        content: line.slice(1),
      });
    } else if (line.startsWith(' ') || line === '') {
      diffLines.push({
        type: 'context',
        lineNumber: lineNum++,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
    } else {
      // Regular line (for non-diff content)
      diffLines.push({
        type: 'add',
        newLineNumber: lineNum++,
        content: line,
      });
    }
  }

  return diffLines;
};

// =============================================================================
// Syntax Highlighting (Basic)
// =============================================================================

const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
  };
  return langMap[ext] || 'plaintext';
};

// =============================================================================
// Sub-Components
// =============================================================================

const StatusIcon: React.FC<{ status: ToolStep['status'] }> = ({ status }) => {
  switch (status) {
    case 'pending':
      return <Clock size={12} className="text-[var(--color-textMuted)]" />;
    case 'executing':
      return <Loader2 size={12} className="text-[var(--accent-warning)] animate-spin" />;
    case 'success':
      return <Check size={12} className="text-[var(--cm-success)]" />;
    case 'error':
      return <X size={12} className="text-[var(--cm-error)]" />;
    default:
      return null;
  }
};

const DiffLineComponent: React.FC<{
  line: DiffLine;
  index: number;
  isStreaming?: boolean;
}> = ({ line, index, isStreaming }) => {
  const bgColor = line.type === 'add'
    ? 'bg-[rgba(63,185,80,0.15)]'
    : line.type === 'remove'
    ? 'bg-[rgba(248,81,73,0.15)]'
    : '';

  const markerColor = line.type === 'add'
    ? 'text-[var(--cm-success)]'
    : line.type === 'remove'
    ? 'text-[var(--cm-error)]'
    : 'text-transparent';

  const lineNumber = line.newLineNumber || line.oldLineNumber || line.lineNumber || '';

  return (
    <motion.div
      initial={isStreaming ? { opacity: 0, x: -10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, delay: isStreaming ? index * 0.02 : 0 }}
      className={`flex font-mono text-[11px] leading-[1.5] ${bgColor}`}
    >
      {/* Line number */}
      <span className="text-[var(--color-textMuted)] px-2 min-w-[40px] text-right select-none border-r border-[var(--color-border)]">
        {lineNumber}
      </span>

      {/* Diff marker */}
      <span className={`px-1 min-w-[16px] select-none font-bold ${markerColor}`}>
        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
      </span>

      {/* Content */}
      <span className="flex-1 px-2 whitespace-pre overflow-x-auto text-[var(--cm-text)]">
        {line.content}
      </span>
    </motion.div>
  );
};

// Plain output line component - no line numbers, no diff markers
// Used for Bash, TodoWrite, and other non-file-edit tools
const PlainOutputLine: React.FC<{
  content: string;
  index: number;
  isStreaming?: boolean;
  isTodo?: boolean;
  todoStatus?: string;
}> = ({ content, index, isStreaming, isTodo, todoStatus }) => {
  // Handle todo-specific formatting
  if (isTodo && content.trim()) {
    // Detect todo status markers
    const isCompleted = todoStatus === 'completed' || content.includes('[x]') || content.includes('[completed]');
    const isInProgress = todoStatus === 'in_progress' || content.includes('[in_progress]') || content.includes('[*]');
    const isPending = todoStatus === 'pending' || content.includes('[ ]') || content.includes('[pending]');

    // Clean the content of status markers for display
    const cleanContent = content
      .replace(/\[x\]|\[completed\]|\[\*\]|\[in_progress\]|\[ \]|\[pending\]/gi, '')
      .replace(/^[-*•]\s*/, '')
      .trim();

    if (!cleanContent) return null;

    return (
      <motion.div
        initial={isStreaming ? { opacity: 0, x: -10 } : false}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.15, delay: isStreaming ? index * 0.02 : 0 }}
        className="flex items-center gap-2 py-0.5 px-3 font-mono text-[12px] leading-[1.6]"
      >
        {/* Status indicator */}
        <span className={`flex-shrink-0 ${
          isCompleted ? 'text-[var(--cm-success)]' :
          isInProgress ? 'text-[var(--accent-warning)]' :
          'text-[var(--color-textMuted)]'
        }`}>
          {isCompleted ? '✓' : isInProgress ? '●' : '○'}
        </span>
        {/* Content with strikethrough for completed */}
        <span className={`flex-1 ${
          isCompleted ? 'text-[var(--color-textMuted)] line-through' : 'text-[var(--cm-text)]'
        }`}>
          {cleanContent}
        </span>
      </motion.div>
    );
  }

  // Regular plain output (bash, etc.)
  return (
    <motion.div
      initial={isStreaming ? { opacity: 0, x: -10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, delay: isStreaming ? index * 0.02 : 0 }}
      className="px-3 py-0.5 font-mono text-[11px] leading-[1.5] text-[var(--cm-text)] whitespace-pre-wrap"
    >
      {content}
    </motion.div>
  );
};

const CopyButton: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-[var(--color-surfaceHover)] transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <CheckCheck size={14} className="text-[var(--cm-success)]" />
      ) : (
        <Copy size={14} className="text-[var(--color-textMuted)]" />
      )}
    </button>
  );
};

// =============================================================================
// Main Component
// =============================================================================

// Streaming cursor component
const StreamingCursor: React.FC = () => (
  <motion.span
    className="inline-block w-2 h-4 ml-0.5 bg-[var(--accent-warning)]"
    animate={{ opacity: [1, 0] }}
    transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
  />
);

// Activity dots (animated "...")
const ActivityDots: React.FC = () => (
  <span className="inline-flex gap-0.5 ml-2">
    {[0, 1, 2].map((i) => (
      <motion.span
        key={i}
        className="w-1 h-1 rounded-full bg-[var(--accent-warning)]"
        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
        transition={{
          duration: 1,
          repeat: Infinity,
          delay: i * 0.2,
        }}
      />
    ))}
  </span>
);

export const InlineToolBlock: React.FC<InlineToolBlockProps> = ({
  step,
  theme = 'dark',
  defaultExpanded = false,
  maxPreviewLines = 20,
  onToggleCollapse,
}) => {
  // Determine tool type for display behavior
  const isCompactTool = COMPACT_TOOLS.has(step.name);
  const isDiffTool = DIFF_TOOLS.has(step.name);
  const isPlainOutputTool = PLAIN_OUTPUT_TOOLS.has(step.name);
  const isInlineOutputTool = INLINE_OUTPUT_TOOLS.has(step.name);
  const isTodoTool = step.name === 'TodoWrite' || step.name === 'todo_write';

  // Compact tools default to collapsed, diff tools default to expanded
  // Streaming always expands, errors always show content
  const [isExpanded, setIsExpanded] = useState(() => {
    if (step.isStreaming) return true;
    if (step.error) return true;
    if (isDiffTool) return true;
    if (isCompactTool) return false;
    return defaultExpanded || !step.isCollapsed;
  });
  const [showFullDiff, setShowFullDiff] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-expand when streaming starts
  const wasAutoExpanded = useRef(false);
  useEffect(() => {
    if (step.isStreaming && !isExpanded) {
      setIsExpanded(true);
      wasAutoExpanded.current = true;
    }
    // Auto-collapse compact tools when streaming ends
    if (!step.isStreaming && wasAutoExpanded.current && isCompactTool && !step.error) {
      setIsExpanded(false);
      wasAutoExpanded.current = false;
    }
  }, [step.isStreaming, isExpanded, isCompactTool, step.error]);

  const Icon = getToolIcon(step.name);
  const toolColor = getToolColor(step.name);
  const isExecuting = step.status === 'executing' || step.isStreaming;

  // Parse content for diff display (Write/Edit tools)
  const diffLines = useMemo(() => {
    if (step.diff) return step.diff;

    const content = step.name === 'Write' || step.name === 'Edit'
      ? (step.input?.content || step.input?.new_string || step.output || '')
      : (step.output || step.inputPreview || '');

    const isNewFile = step.name === 'Write';
    return parseDiff(content, isNewFile);
  }, [step]);

  // Parse plain output for non-diff tools (TodoWrite, etc.)
  const plainOutputLines = useMemo(() => {
    if (!isPlainOutputTool) return [];
    const content = step.output || step.inputPreview || '';
    return content.split('\n');
  }, [isPlainOutputTool, step.output, step.inputPreview]);

  // Parse inline output for command execution tools (Bash, etc.)
  const inlineOutput = useMemo(() => {
    if (!isInlineOutputTool) return null;
    return step.output || step.inputPreview || '';
  }, [isInlineOutputTool, step.output, step.inputPreview]);

  // Use plain output for plain tools, diff for diff tools
  const visibleLines = showFullDiff
    ? (isPlainOutputTool ? plainOutputLines : diffLines)
    : (isPlainOutputTool ? plainOutputLines : diffLines).slice(0, maxPreviewLines);
  const totalLines = isPlainOutputTool ? plainOutputLines.length : diffLines.length;
  const hiddenLineCount = totalLines - maxPreviewLines;

  // Get file path or command for header - prefer meaningful info over "unknown"
  const rawPath = step.filePath || step.input?.file_path || step.input?.path;
  const filePath = rawPath && rawPath !== 'unknown' ? rawPath : undefined;
  const command = step.command || step.input?.command;

  // For non-file tools, use inputPreview (e.g., "5 items" for TodoWrite)
  // Don't show displayName again if it's the same as step.name
  const headerText = filePath
    || command
    || step.inputPreview
    || (step.input?.query ? `"${step.input.query.substring(0, 40)}..."` : undefined)
    || (step.input?.pattern ? step.input.pattern : undefined)
    || '';

  // Compact summary for read-only tools (shown when collapsed)
  const compactSummary = useMemo(() => {
    if (!isCompactTool || step.status === 'executing' || step.isStreaming) return null;

    // Count lines for read operations
    if (diffLines.length > 0) {
      const lineCount = diffLines.length;
      if (step.name === 'Read' || step.name === 'ReadFile' || step.name === 'read_file') {
        return `${lineCount} lines`;
      }
      if (step.name === 'Grep' || step.name === 'Glob' || step.name === 'list_files') {
        return `${lineCount} ${lineCount === 1 ? 'match' : 'matches'}`;
      }
    }

    // For errors, show truncated error
    if (step.error) {
      return step.error.substring(0, 50) + (step.error.length > 50 ? '...' : '');
    }

    return null;
  }, [isCompactTool, step.status, step.isStreaming, step.name, step.error, diffLines.length]);

  // Duration display
  const durationText = step.duration
    ? step.duration < 1000
      ? `${step.duration}ms`
      : `${(step.duration / 1000).toFixed(1)}s`
    : null;

  // Handle collapse toggle
  const handleToggle = () => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    onToggleCollapse?.(step.id, !newExpanded);
  };

  // For inline output tools (Bash), render a simpler format
  if (isInlineOutputTool) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="my-2 inline-tool-block"
        data-testid="inline-tool-block"
        data-tool-name={step.name}
      >
        {/* Header line */}
        <div className="flex items-center gap-2">
          {/* Status bullet */}
          {isExecuting ? (
            <motion.span
              className="text-base font-bold"
              style={{ color: 'var(--accent-warning)' }}
              animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              ●
            </motion.span>
          ) : (
            <span
              className="text-base font-bold"
              style={{ color: step.status === 'error' ? 'var(--cm-error)' : 'var(--cm-success)' }}
            >
              ●
            </span>
          )}

          {/* Tool name */}
          <span className="font-mono text-[13px] font-medium" style={{ color: toolColor }}>
            {step.displayName || step.name}
          </span>

          {/* Command */}
          <span className="font-mono text-[13px] text-[var(--color-textSecondary)] truncate flex-1">
            {headerText}
            {isExecuting && <ActivityDots />}
          </span>

          {/* Duration & Status */}
          <div className="flex items-center gap-2 text-[11px]">
            {durationText && <span className="text-[var(--color-textMuted)]">{durationText}</span>}
            <StatusIcon status={step.status} />
          </div>
        </div>

        {/* Inline output - directly below, no block wrapper */}
        {(inlineOutput || step.error) && (
          <div className="ml-5 mt-1">
            {inlineOutput && (
              <pre className="font-mono text-[11px] text-[var(--color-textMuted)] whitespace-pre-wrap overflow-x-auto leading-relaxed">
                <span className="text-[var(--color-textMuted)] select-none">❯ </span>
                {inlineOutput}
              </pre>
            )}
            {step.error && (
              <div className="text-[11px] text-[var(--cm-error)] font-mono mt-1">
                Error: {step.error}
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="my-3 inline-tool-block"
      data-testid="inline-tool-block"
      data-tool-name={step.name}
    >
      {/* Header - Orange bullet with tool info */}
      <div className="flex items-center gap-2">
        {/* Animated bullet - pulses when executing */}
        {isExecuting ? (
          <motion.span
            className="text-lg font-bold"
            style={{ color: 'var(--accent-warning)' }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [1, 0.7, 1],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            ●
          </motion.span>
        ) : (
          <span
            className="text-lg font-bold"
            style={{ color: step.status === 'error' ? 'var(--cm-error)' : 'var(--cm-success)' }}
          >
            ●
          </span>
        )}

        {/* Tool name */}
        <span
          className="font-mono text-[13px] font-medium"
          style={{ color: toolColor }}
        >
          {step.displayName || step.name}
        </span>

        {/* File path / command + activity dots when executing */}
        <span className="font-mono text-[13px] text-[var(--color-textSecondary)] truncate flex-1 flex items-center gap-2">
          {headerText}
          {isExecuting && <ActivityDots />}
          {/* Compact summary for read tools when collapsed */}
          {!isExpanded && compactSummary && (
            <span className="text-[var(--color-textMuted)] text-[11px]">
              ({compactSummary})
            </span>
          )}
        </span>

        {/* Status & Duration */}
        <div className="flex items-center gap-2 text-[11px]">
          {durationText && (
            <span className="text-[var(--color-textMuted)]">{durationText}</span>
          )}
          <StatusIcon status={step.status} />
        </div>

        {/* Expand/Collapse toggle */}
        <button
          onClick={handleToggle}
          className="p-1 rounded hover:bg-[var(--color-surfaceHover)] transition-colors"
        >
          {isExpanded ? (
            <ChevronDown size={14} className="text-[var(--color-textMuted)]" />
          ) : (
            <ChevronRight size={14} className="text-[var(--color-textMuted)]" />
          )}
        </button>
      </div>

      {/* Tree connector and content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {/* Tree connector */}
            <div className="flex mt-1">
              <span className="text-[var(--color-textMuted)] ml-[7px] mr-2">└</span>

              {/* Code block - clean border style */}
              <div
                ref={contentRef}
                className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--cm-bg)] overflow-hidden"
              >
                {/* Code block header */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--cm-bg-secondary)]">
                  <div className="flex items-center gap-2">
                    {isExecuting ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      >
                        <Loader2 size={12} style={{ color: toolColor }} />
                      </motion.div>
                    ) : (
                      <Icon size={12} style={{ color: toolColor }} />
                    )}
                    <span className="font-mono text-[11px] text-[var(--color-textMuted)]">
                      {step.language || (step.filePath && getLanguageFromPath(step.filePath)) || 'output'}
                    </span>
                  </div>
                  {!isExecuting && <CopyButton content={isPlainOutputTool ? plainOutputLines.join('\n') : diffLines.map(l => l.content).join('\n')} />}
                </div>

                {/* Content area */}
                <div className="overflow-x-auto">
                  {visibleLines.length > 0 ? (
                    isPlainOutputTool ? (
                      // Plain output rendering (Bash, TodoWrite, etc.) - no diff markers
                      (visibleLines as string[]).map((line, index) => (
                        <PlainOutputLine
                          key={index}
                          content={line}
                          index={index}
                          isStreaming={step.isStreaming}
                          isTodo={isTodoTool}
                        />
                      ))
                    ) : (
                      // Diff output rendering (Write, Edit) - git-style +/- markers
                      (visibleLines as DiffLine[]).map((line, index) => (
                        <DiffLineComponent
                          key={index}
                          line={line}
                          index={index}
                          isStreaming={step.isStreaming}
                        />
                      ))
                    )
                  ) : isExecuting ? (
                    // Show activity placeholder when executing but no output yet
                    <div className="flex items-center gap-2 px-3 py-3 text-[var(--color-textMuted)]">
                      <motion.div
                        className="flex gap-1"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      >
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            className="w-1.5 h-1.5 rounded-full bg-[var(--accent-warning)]"
                            animate={{
                              y: [0, -4, 0],
                              opacity: [0.5, 1, 0.5],
                            }}
                            transition={{
                              duration: 0.6,
                              repeat: Infinity,
                              delay: i * 0.15,
                            }}
                          />
                        ))}
                      </motion.div>
                      <span className="text-[11px]">Running...</span>
                    </div>
                  ) : null}

                  {/* Streaming cursor at end of content */}
                  {isExecuting && visibleLines.length > 0 && (
                    <div className="px-3 py-1">
                      <StreamingCursor />
                    </div>
                  )}
                </div>

                {/* Show full content button */}
                {hiddenLineCount > 0 && !showFullDiff && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => setShowFullDiff(true)}
                    className="w-full py-2 text-center text-[12px] text-[var(--color-textMuted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors border-t border-[var(--color-border)]"
                  >
                    {isDiffTool ? `Show full diff (${hiddenLineCount} more lines)` : `Show more (${hiddenLineCount} more lines)`}
                  </motion.button>
                )}

                {/* Error display */}
                {step.error && (
                  <div className="px-3 py-2 border-t border-[var(--cm-error)] bg-[rgba(248,81,73,0.1)]">
                    <span className="text-[11px] text-[var(--cm-error)] font-mono">
                      {step.error}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default InlineToolBlock;
