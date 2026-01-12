/**
 * ActiveTaskBar - Claude Code Style Sticky Todo Panel
 *
 * A fixed panel above the chat input showing ALL tasks like Claude Code's terminal.
 * Shows the full task list with checkboxes, not just the current task.
 *
 * Style matches Claude Code CLI:
 * - ☒ Completed items (strikethrough, muted)
 * - ☐ Pending items
 * - ⏳ In-progress item (highlighted, spinner)
 * - Compact, unobtrusive design
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle,
  Circle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from '@/shared/icons';
import type { TodoItem } from '@/stores/useCodeModeStore';

interface ActiveTaskBarProps {
  todos: TodoItem[];
  className?: string;
}

export const ActiveTaskBar: React.FC<ActiveTaskBarProps> = ({
  todos,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = React.useState(true);

  // Calculate stats
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;
  const inProgressTask = todos.find(t => t.status === 'in_progress');
  const allComplete = completedCount === totalCount && totalCount > 0;

  // Don't render if no todos
  if (totalCount === 0) return null;

  return (
    <div className={`bg-[var(--color-surfaceSecondary)]/50 backdrop-blur-sm ${className}`}>
      {/* Header - clickable to expand/collapse */}
      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-surfaceHover)]/30 transition-colors"
      >
        {/* Status icon */}
        <div className="flex-shrink-0">
          {allComplete ? (
            <CheckCircle
              size={14}
              className="text-[var(--cm-success)]"
            />
          ) : inProgressTask ? (
            <Loader2
              size={14}
              className="text-[var(--color-primary)] animate-spin"
            />
          ) : (
            <Circle
              size={14}
              className="text-[var(--color-textMuted)]"
            />
          )}
        </div>

        {/* Task text */}
        <div className="flex-1 min-w-0 text-left">
          {allComplete ? (
            <span className="text-xs text-[var(--cm-success)] font-medium">
              All tasks completed
            </span>
          ) : inProgressTask ? (
            <span className="text-xs text-[var(--color-text)] font-medium truncate block">
              {inProgressTask.activeForm || inProgressTask.content}
            </span>
          ) : (
            <span className="text-xs text-[var(--color-textMuted)]">
              {totalCount - completedCount} tasks pending
            </span>
          )}
        </div>

        {/* Progress badge */}
        <div
          className={`
            flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0
            ${allComplete
              ? 'bg-[var(--cm-success)]/20 text-[var(--cm-success)]'
              : inProgressTask
                ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                : 'bg-[var(--color-surfaceSecondary)] text-[var(--color-textMuted)]'
            }
          `}
        >
          <span className="font-mono">{completedCount}/{totalCount}</span>
        </div>

        {/* Expand/collapse chevron */}
        <div className="flex-shrink-0 text-[var(--color-textMuted)]">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </motion.button>

      {/* Expanded task list - Claude Code style */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-1 border-t border-[var(--color-border)]/20 pt-2">
              {todos.map((todo) => (
                <TodoItemRow key={todo.id} todo={todo} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * Individual todo row - matches Claude Code's terminal style
 */
const TodoItemRow: React.FC<{ todo: TodoItem }> = ({ todo }) => {
  const isCompleted = todo.status === 'completed';
  const isInProgress = todo.status === 'in_progress';

  return (
    <motion.div
      initial={{ opacity: 0, x: -5 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-2 text-xs font-mono"
    >
      {/* Checkbox icon */}
      <span className="flex-shrink-0 w-4">
        {isCompleted ? (
          <CheckCircle size={12} className="text-[var(--cm-success)]" />
        ) : isInProgress ? (
          <Loader2 size={12} className="text-[var(--color-primary)] animate-spin" />
        ) : (
          <Circle size={12} className="text-[var(--color-textMuted)]" />
        )}
      </span>

      {/* Task text */}
      <span
        className={`
          flex-1 truncate
          ${isCompleted
            ? 'text-[var(--color-textMuted)] line-through'
            : isInProgress
              ? 'text-[var(--color-text)] font-medium'
              : 'text-[var(--color-textSecondary)]'
          }
        `}
      >
        {isInProgress && todo.activeForm ? todo.activeForm : todo.content}
      </span>
    </motion.div>
  );
};

/**
 * Compact variant for inline use
 */
export const ActiveTaskBadge: React.FC<ActiveTaskBarProps & { onClick?: () => void }> = ({
  todos,
  className = '',
  onClick,
}) => {
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;
  const inProgressTask = todos.find(t => t.status === 'in_progress');
  const allComplete = completedCount === totalCount && totalCount > 0;

  if (totalCount === 0) return null;

  return (
    <motion.button
      onClick={onClick}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium
        transition-all duration-150 border
        ${allComplete
          ? 'bg-[var(--cm-success)]/10 border-[var(--cm-success)]/30 text-[var(--cm-success)]'
          : inProgressTask
            ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/30 text-[var(--color-primary)]'
            : 'bg-[var(--color-surfaceSecondary)] border-[var(--color-border)]/50 text-[var(--color-textMuted)]'
        }
        ${onClick ? 'cursor-pointer hover:brightness-110' : ''}
        ${className}
      `}
    >
      {/* Icon */}
      {allComplete ? (
        <CheckCircle size={12} />
      ) : inProgressTask ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Circle size={12} />
      )}

      {/* Text */}
      {inProgressTask && (
        <span className="truncate max-w-[150px]">
          {inProgressTask.activeForm || inProgressTask.content}
        </span>
      )}

      {/* Progress */}
      <span className="font-mono opacity-80">{completedCount}/{totalCount}</span>
    </motion.button>
  );
};

export default ActiveTaskBar;
