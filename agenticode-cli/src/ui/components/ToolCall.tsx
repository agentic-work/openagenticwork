/**
 * AWCode Tool Call Display Component
 * Shows tool execution status with nice styling
 */

import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../themes/colors.js';

interface ToolCallProps {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
  collapsed?: boolean;
}

const STATUS_ICONS = {
  pending: '○',
  running: '◐',
  success: '●',
  error: '✖',
};

const STATUS_COLORS = {
  pending: colors.textMuted,
  running: colors.secondary,
  success: colors.success,
  error: colors.error,
};

export const ToolCall: React.FC<ToolCallProps> = ({
  name,
  status,
  result,
  collapsed = true,
}) => {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={STATUS_COLORS[status]}>{STATUS_ICONS[status]} </Text>
        <Text color={colors.accent} bold>{name}</Text>
        <Text color={colors.textMuted}>
          {status === 'running' ? ' executing...' : status === 'success' ? ' done' : ''}
        </Text>
      </Box>
      {!collapsed && result && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={colors.textMuted}>{result.slice(0, 500)}{result.length > 500 ? '...' : ''}</Text>
        </Box>
      )}
    </Box>
  );
};

export default ToolCall;
