/**
 * CodeMode Input Toolbar Component
 *
 * Agenticode style input toolbar with:
 * - Working folder selector (left side)
 * - Context usage indicator (right side)
 * - Permission mode indicator (right side)
 *
 * Note: Model selection handled by Smart Router (backend)
 * Matches spacing and styling of ChatInputToolbar in Chat mode
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Folder, FolderOpen, Check, Unlock } from '@/shared/icons';
import { useCodeModeStore, useSession, useTotalInputTokens, useTotalOutputTokens } from '@/stores/useCodeModeStore';
import clsx from 'clsx';

// =============================================================================
// Working Folder Selector
// =============================================================================

interface FolderSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  currentPath: string;
  onPathChange: (path: string) => void;
}

const FolderSelectorDropdown: React.FC<FolderSelectorProps> = ({
  isOpen,
  onClose,
  buttonRef,
  currentPath,
  onPathChange,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [customPath, setCustomPath] = useState(currentPath);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left,
      });
    }
    setCustomPath(currentPath);
  }, [isOpen, buttonRef, currentPath]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose, buttonRef]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (customPath.trim()) {
      onPathChange(customPath.trim());
      onClose();
    }
  };

  // Common paths
  const commonPaths = [
    '/workspace',
    '/workspace/projects',
    '/workspace/code',
  ];

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={dropdownRef}
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.95 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="fixed z-[10000] w-[320px] rounded-lg shadow-xl"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          transform: 'translateY(-100%)',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="p-3">
          <div className="text-xs font-medium text-[var(--color-textMuted)] mb-2">
            Working Directory
          </div>

          {/* Custom path input */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSubmit();
                }
              }}
              placeholder="/workspace/path"
              className="flex-1 px-2 py-1.5 text-sm rounded-md
                bg-[var(--color-background)] border border-[var(--color-border)]
                text-[var(--color-text)] placeholder-[var(--color-textMuted)]
                focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]
                font-mono"
            />
            <button
              onClick={handleSubmit}
              className="px-3 py-1.5 text-sm rounded-md
                bg-[var(--color-primary)] text-white
                hover:bg-[var(--color-primary)]/90
                transition-colors"
            >
              Set
            </button>
          </div>

          <div className="border-t border-[var(--color-border)] my-2" />

          {/* Quick paths */}
          <div className="text-xs text-[var(--color-textMuted)] mb-1">Quick Access</div>
          {commonPaths.map((path) => (
            <button
              key={path}
              onClick={() => {
                onPathChange(path);
                onClose();
              }}
              className={clsx(
                'w-full px-2 py-1.5 text-left rounded-md flex items-center gap-2 transition-colors text-sm',
                currentPath === path
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'hover:bg-[var(--color-surfaceHover)] text-[var(--color-text)]'
              )}
            >
              <Folder size={14} className="opacity-60" />
              <span className="font-mono text-xs">{path}</span>
              {currentPath === path && <Check size={14} className="ml-auto" />}
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// =============================================================================
// Context Usage Indicator
// =============================================================================

interface ContextUsageProps {
  inputTokens: number;
  outputTokens: number;
  maxContext?: number;
}

const ContextUsageIndicator: React.FC<ContextUsageProps> = ({
  inputTokens,
  outputTokens,
  maxContext = 200000,
}) => {
  const totalTokens = inputTokens + outputTokens;
  const usagePercent = Math.min((totalTokens / maxContext) * 100, 100);

  // Color based on usage
  const getColor = () => {
    if (usagePercent > 80) return 'var(--color-error)';
    if (usagePercent > 60) return 'var(--color-warning)';
    return 'var(--color-success)';
  };

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
      <div
        className="w-16 h-1.5 rounded-full bg-[var(--color-surfaceSecondary)] overflow-hidden"
        title={`${totalTokens.toLocaleString()} / ${maxContext.toLocaleString()} tokens (${usagePercent.toFixed(1)}%)`}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${usagePercent}%`,
            backgroundColor: getColor(),
          }}
        />
      </div>
      <span className="font-mono">{(totalTokens / 1000).toFixed(1)}K</span>
    </div>
  );
};

// =============================================================================
// Main Toolbar Component
// =============================================================================

interface CodeModeInputToolbarProps {
  onWorkspaceChange?: (path: string) => void;
  className?: string;
}

export const CodeModeInputToolbar: React.FC<CodeModeInputToolbarProps> = ({
  onWorkspaceChange,
  className,
}) => {
  // Use individual selectors to prevent re-render loops
  const session = useSession();
  const totalInputTokens = useTotalInputTokens();
  const totalOutputTokens = useTotalOutputTokens();

  const [isFolderOpen, setIsFolderOpen] = useState(false);

  const folderButtonRef = useRef<HTMLButtonElement>(null);

  const workspacePath = session?.workspacePath || '/workspace';

  // Format path for display (truncate if too long)
  const displayPath = workspacePath.length > 25
    ? '...' + workspacePath.slice(-22)
    : workspacePath;

  const handleWorkspaceChange = useCallback((path: string) => {
    onWorkspaceChange?.(path);
  }, [onWorkspaceChange]);

  return (
    <div className={clsx(
      'flex items-center justify-between gap-4 px-4 py-2',
      'border-b border-[var(--color-border)]',
      'bg-[var(--color-surface)]/50',
      className
    )}>
      {/* Left side: Working folder */}
      <div className="flex items-center gap-2">
        {/* Working Folder Selector */}
        <button
          ref={folderButtonRef}
          onClick={() => setIsFolderOpen(!isFolderOpen)}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs',
            'bg-[var(--color-surfaceSecondary)] hover:bg-[var(--color-surfaceHover)]',
            'border border-[var(--color-border)]',
            'transition-colors duration-150',
            'text-[var(--color-textSecondary)]'
          )}
          title={`Working directory: ${workspacePath}`}
        >
          {isFolderOpen ? (
            <FolderOpen size={12} className="text-amber-500" />
          ) : (
            <Folder size={12} className="text-amber-500" />
          )}
          <span className="font-mono">{displayPath}</span>
          <ChevronDown
            size={12}
            className={clsx(
              'transition-transform duration-150',
              isFolderOpen && 'rotate-180'
            )}
          />
        </button>
        <FolderSelectorDropdown
          isOpen={isFolderOpen}
          onClose={() => setIsFolderOpen(false)}
          buttonRef={folderButtonRef}
          currentPath={workspacePath}
          onPathChange={handleWorkspaceChange}
        />
      </div>

      {/* Right side: Context usage + Permission mode */}
      <div className="flex items-center gap-3">
        {/* Context usage indicator */}
        <ContextUsageIndicator
          inputTokens={totalInputTokens}
          outputTokens={totalOutputTokens}
        />

        {/* Permission mode indicator (placeholder for now) */}
        <div
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--color-textMuted)]"
          title="Permission mode: Permissive (all operations allowed)"
        >
          <Unlock size={12} className="text-green-500" />
          <span className="hidden sm:inline">Permissive</span>
        </div>
      </div>
    </div>
  );
};

export default CodeModeInputToolbar;
