/**
 * LiveThinkingDisplay Component
 * Shows thinking status with animated indicator like agenticwork
 *
 * Features:
 * - Animated thinking indicator
 * - Live elapsed time counter
 * - Collapsible thinking content
 *
 * Format:
 * ∴ Thinking... 4.2s
 * or when complete:
 * ∴ Thought for 4.2s (ctrl+o to show thinking)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { colors } from '../themes/colors.js';

interface LiveThinkingDisplayProps {
  isThinking: boolean;
  thinkingContent?: string;
  startTime?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}

// Animated thinking indicator frames (braille dots)
const THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Alternative: pulse animation
const PULSE_FRAMES = ['∴', '∵', '∴', '∵'];

export const LiveThinkingDisplay: React.FC<LiveThinkingDisplayProps> = ({
  isThinking,
  thinkingContent,
  startTime,
  collapsed = true,
  onToggle,
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [frame, setFrame] = useState(0);

  // Update elapsed time (slower to reduce ghosting)
  useEffect(() => {
    if (!isThinking || !startTime) return;

    const interval = setInterval(() => {
      setElapsed((Date.now() - startTime) / 1000);
    }, 500);  // Slowed from 100ms to 500ms

    return () => clearInterval(interval);
  }, [isThinking, startTime]);

  // Animate thinking indicator (slower to reduce ghosting)
  useEffect(() => {
    if (!isThinking) return;

    const interval = setInterval(() => {
      setFrame(prev => (prev + 1) % THINKING_FRAMES.length);
    }, 200);  // Slowed from 80ms to 200ms

    return () => clearInterval(interval);
  }, [isThinking]);

  if (!isThinking && !thinkingContent) {
    return null;
  }

  const indicator = isThinking ? THINKING_FRAMES[frame] : '∴';

  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={colors.secondary}>{indicator} </Text>
        {isThinking ? (
          <>
            <Text color={colors.text}>Thinking</Text>
            <Text color={colors.textMuted}>... </Text>
            <Text color={colors.secondary}>{elapsed.toFixed(1)}s</Text>
          </>
        ) : (
          <>
            <Text color={colors.text}>Thought for </Text>
            <Text color={colors.secondary}>{elapsed.toFixed(1)}s</Text>
            {thinkingContent && collapsed && (
              <Text color={colors.textMuted}> (ctrl+o to show thinking)</Text>
            )}
          </>
        )}
      </Box>

      {/* Thinking content (expanded) */}
      {thinkingContent && !collapsed && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Box>
            <Text color={colors.textMuted}>⎿ </Text>
            <Text color={colors.textMuted} dimColor>
              {thinkingContent.length > 500
                ? thinkingContent.substring(0, 500) + '...'
                : thinkingContent}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default LiveThinkingDisplay;
