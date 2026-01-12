/**
 * AWCode Status Bar Component
 * Shows current model, working directory, token usage, activity state, and shortcuts
 * Uses Nerd Font icons for visual polish
 * Displays input/output token breakdown like agenticwork
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { colors } from '../themes/colors.js';
import type { TokenUsage } from '../../core/types.js';

// Nerd Font icons
const ICONS = {
  model: '\uf121',    // nf-fa-code / terminal
  folder: '\uf07c',   // nf-fa-folder_open
  tokens: '\uf201',   // nf-fa-line_chart
  input: '\uf090',    // nf-fa-sign_in (input)
  output: '\uf08b',   // nf-fa-sign_out (output)
  help: '\uf059',     // nf-fa-question_circle
  quit: '\uf011',     // nf-fa-power_off
  working: '\uf110',  // nf-fa-spinner
};

// Animated spinner frames
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export type ActivityState = 'idle' | 'thinking' | 'streaming' | 'tool_running' | 'error';

interface StatusBarProps {
  model: string;
  workingDir: string;
  tokenUsage?: TokenUsage;
  /** Current activity state */
  activity?: ActivityState;
  /** Current tool name if tool_running */
  currentTool?: string;
  /** @deprecated Use tokenUsage instead */
  tokenCount?: number;
}

// Format token count with K/M suffix
function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

// Activity state labels
const ACTIVITY_LABELS: Record<ActivityState, string> = {
  idle: '',
  thinking: 'Thinking',
  streaming: 'Generating',
  tool_running: 'Running',
  error: 'Error',
};

const ACTIVITY_COLORS: Record<ActivityState, string> = {
  idle: colors.textMuted,
  thinking: colors.secondary,
  streaming: colors.primary,
  tool_running: colors.accent,
  error: colors.error,
};

export const StatusBar: React.FC<StatusBarProps> = ({
  model,
  workingDir,
  tokenUsage,
  activity = 'idle',
  currentTool,
  tokenCount,
}) => {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Animate spinner when active (slower to reduce ghosting)
  useEffect(() => {
    if (activity === 'idle' || activity === 'error') return;

    const interval = setInterval(() => {
      setSpinnerFrame(prev => (prev + 1) % SPINNER_FRAMES.length);
    }, 200);  // Slowed from 80ms to 200ms

    return () => clearInterval(interval);
  }, [activity]);

  // Truncate working dir if too long
  const maxLen = 30;
  const displayDir = workingDir.length > maxLen
    ? '...' + workingDir.slice(-maxLen + 3)
    : workingDir;

  // Use tokenUsage if available, fall back to tokenCount for backwards compatibility
  const hasUsage = tokenUsage && tokenUsage.totalTokens > 0;
  const hasLegacyCount = !hasUsage && tokenCount !== undefined && tokenCount > 0;

  const isActive = activity !== 'idle' && activity !== 'error';
  const activityLabel = ACTIVITY_LABELS[activity];
  const activityColor = ACTIVITY_COLORS[activity];

  return (
    <Box
      borderStyle="single"
      borderColor={isActive ? activityColor : colors.border}
      paddingX={1}
      marginTop={1}
    >
      <Box flexGrow={1}>
        {/* Activity indicator - prominent when active */}
        {isActive && (
          <>
            <Text color={activityColor}>{SPINNER_FRAMES[spinnerFrame]} </Text>
            <Text color={activityColor} bold>{activityLabel}</Text>
            {currentTool && activity === 'tool_running' && (
              <Text color={colors.textMuted}> {currentTool}</Text>
            )}
            <Text color={colors.textMuted}>  │  </Text>
          </>
        )}

        <Text color={colors.secondary}>{ICONS.model} </Text>
        <Text color={colors.text}>{model}</Text>
        <Text color={colors.textMuted}>  │  </Text>
        <Text color={colors.primary}>{ICONS.folder} </Text>
        <Text color={colors.textMuted}>{displayDir}</Text>
        {hasUsage && (
          <>
            <Text color={colors.textMuted}>  │  </Text>
            <Text color={colors.success}>{ICONS.tokens} </Text>
            <Text color={colors.text}>{formatTokens(tokenUsage.totalTokens)}</Text>
            <Text color={colors.textMuted}> (</Text>
            <Text color={colors.accent}>{ICONS.input}</Text>
            <Text color={colors.textMuted}>{formatTokens(tokenUsage.promptTokens)}</Text>
            <Text color={colors.textMuted}>/</Text>
            <Text color={colors.warning}>{ICONS.output}</Text>
            <Text color={colors.textMuted}>{formatTokens(tokenUsage.completionTokens)}</Text>
            <Text color={colors.textMuted}>)</Text>
          </>
        )}
        {hasLegacyCount && (
          <>
            <Text color={colors.textMuted}>  │  </Text>
            <Text color={colors.success}>{ICONS.tokens} </Text>
            <Text color={colors.text}>{formatTokens(tokenCount)}</Text>
          </>
        )}
      </Box>
      <Box>
        <Text color={colors.textMuted}>
          <Text color={colors.primary}>{ICONS.help}</Text> /h
          <Text color={colors.warning}> {ICONS.quit}</Text> /q
        </Text>
      </Box>
    </Box>
  );
};

export default StatusBar;
