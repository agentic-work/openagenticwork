/**
 * AWCode Spinner Component
 * Animated thinking indicator
 */

import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';
import { colors } from '../themes/colors.js';

interface SpinnerProps {
  label?: string;
  type?: 'dots' | 'line' | 'arc' | 'circle';
}

export const Spinner: React.FC<SpinnerProps> = ({
  label = 'Thinking',
  type = 'dots',
}) => {
  return (
    <Box>
      <Text color={colors.secondary}>
        <InkSpinner type={type} />
      </Text>
      <Text color={colors.textMuted}> {label}...</Text>
    </Box>
  );
};

export default Spinner;
