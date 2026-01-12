/**
 * CodeModeStatusBar Component
 *
 * Bottom status bar showing session information like the Agenticode
 * Shows: connection status, model, workspace path, token usage, activity state
 *
 * Inspired by VS Code status bar and Agenticode status display
 */

import React from 'react';
import {
  Circle,
  Cpu,
  FolderOpen,
  ArrowDown,
  ArrowUp,
  Brain,
  Edit2,
  Terminal,
  AlertCircle,
  Sparkles,
  CheckCircle,
} from '@/shared/icons';
import type { ActivityState } from '../types/protocol';

interface CodeModeStatusBarProps {
  model?: string;
  workspacePath?: string;
  tokensIn?: number;
  tokensOut?: number;
  activityState?: ActivityState;
  isConnected?: boolean;
  theme?: 'light' | 'dark';
  className?: string;
}

// Format token count (e.g., 24300 -> "24.3k", 1200 -> "1.2k")
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

// Truncate path if too long (keep last 2-3 segments)
function truncatePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 3) return path;

  // Keep last 3 segments and add ellipsis
  return '.../' + parts.slice(-3).join('/');
}

// Get icon and color for activity state
function getActivityIcon(state: ActivityState, isDark: boolean): {
  icon: React.ReactNode;
  label: string;
  color: string;
} {
  const iconSize = 12;

  switch (state) {
    case 'thinking':
      return {
        icon: <Brain size={iconSize} className="animate-pulse" />,
        label: 'Thinking',
        color: isDark ? '#58a6ff' : '#0969da',
      };
    case 'writing':
      return {
        icon: <Edit2 size={iconSize} />,
        label: 'Writing',
        color: isDark ? '#3fb950' : '#1a7f37',
      };
    case 'editing':
      return {
        icon: <Edit2 size={iconSize} />,
        label: 'Editing',
        color: isDark ? '#d29922' : '#9a6700',
      };
    case 'executing':
      return {
        icon: <Terminal size={iconSize} />,
        label: 'Executing',
        color: isDark ? '#bc8cff' : '#8250df',
      };
    case 'artifact':
      return {
        icon: <Sparkles size={iconSize} />,
        label: 'Artifact',
        color: isDark ? '#f778ba' : '#bf3989',
      };
    case 'error':
      return {
        icon: <AlertCircle size={iconSize} />,
        label: 'Error',
        color: isDark ? '#f85149' : '#d1242f',
      };
    case 'idle':
    default:
      return {
        icon: <CheckCircle size={iconSize} />,
        label: 'Idle',
        color: isDark ? '#8b949e' : '#57606a',
      };
  }
}

export const CodeModeStatusBar: React.FC<CodeModeStatusBarProps> = ({
  model,
  workspacePath = '~',
  tokensIn = 0,
  tokensOut = 0,
  activityState = 'idle',
  isConnected = false,
  theme = 'dark',
  className = '',
}) => {
  const isDark = theme === 'dark';
  const activity = getActivityIcon(activityState, isDark);
  const truncatedPath = truncatePath(workspacePath);

  return (
    <div
      className={`
        flex items-center justify-between px-3 gap-4 border-t
        ${isDark ? 'bg-[#161b22] border-[#30363d]' : 'bg-gray-50 border-gray-200'}
        ${className}
      `}
      style={{ height: '32px', minHeight: '32px', maxHeight: '32px' }}
    >
      {/* Left side: Connection status, Model, Workspace */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Connection indicator */}
        <div className="flex items-center gap-1.5" title={isConnected ? 'Connected' : 'Disconnected'}>
          <Circle
            size={8}
            className={`
              ${isConnected
                ? (isDark ? 'fill-[#3fb950] text-[#3fb950]' : 'fill-green-600 text-green-600')
                : (isDark ? 'fill-[#f85149] text-[#f85149] animate-pulse' : 'fill-red-600 text-red-600 animate-pulse')
              }
            `}
            style={{ strokeWidth: 0 }}
          />
        </div>

        {/* Model */}
        {model && (
          <div
            className={`
              flex items-center gap-1.5 text-xs
              ${isDark ? 'text-[#c9d1d9]' : 'text-gray-700'}
            `}
            title={`Model: ${model}`}
          >
            <Cpu size={12} className={isDark ? 'text-[#8b949e]' : 'text-gray-500'} />
            <span className="font-mono font-medium truncate max-w-[200px]">{model}</span>
          </div>
        )}

        {/* Separator */}
        <div className={`w-px h-4 ${isDark ? 'bg-[#30363d]' : 'bg-gray-300'}`} />

        {/* Workspace path */}
        <div
          className={`
            flex items-center gap-1.5 text-xs flex-1 min-w-0
            ${isDark ? 'text-[#8b949e]' : 'text-gray-600'}
          `}
          title={`Workspace: ${workspacePath}`}
        >
          <FolderOpen size={12} className="flex-shrink-0" />
          <span className="font-mono truncate">{truncatedPath}</span>
        </div>
      </div>

      {/* Right side: Token usage, Activity */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Token usage */}
        {(tokensIn > 0 || tokensOut > 0) && (
          <>
            <div
              className={`
                flex items-center gap-2 text-xs font-mono
                ${isDark ? 'text-[#8b949e]' : 'text-gray-600'}
              `}
              title="Token usage: input / output"
            >
              <span className="flex items-center gap-1">
                <ArrowDown size={10} className="flex-shrink-0" />
                {formatTokens(tokensIn)}
              </span>
              <span className={isDark ? 'text-[#6e7681]' : 'text-gray-400'}>·</span>
              <span className="flex items-center gap-1">
                <ArrowUp size={10} className="flex-shrink-0" />
                {formatTokens(tokensOut)}
              </span>
            </div>

            {/* Separator */}
            <div className={`w-px h-4 ${isDark ? 'bg-[#30363d]' : 'bg-gray-300'}`} />
          </>
        )}

        {/* Activity state */}
        <div
          className={`
            flex items-center gap-1.5 text-xs font-medium
          `}
          style={{ color: activity.color }}
          title={`Activity: ${activity.label}`}
        >
          {activity.icon}
          <span className="min-w-[60px]">{activity.label}</span>
        </div>
      </div>
    </div>
  );
};

export default CodeModeStatusBar;
