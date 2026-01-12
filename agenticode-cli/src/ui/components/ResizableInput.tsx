/**
 * ResizableInput Component
 * A clean chat input with top and bottom lines (no box)
 * Like agenticwork's minimal input style
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { colors } from '../themes/colors.js';

// Simple horizontal line
const HORIZONTAL_LINE = '\u2500'; // ─

// Nerd Font icon
const PROMPT_ICON = '\uf054';  // nf-fa-chevron_right (>)

interface ResizableInputProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  borderColor?: string;
}

export const ResizableInput: React.FC<ResizableInputProps> = ({
  onSubmit,
  placeholder = 'Type a message... (Shift+Enter for newline)',
  disabled = false,
  borderColor = '#00FF00',
}) => {
  const { stdout } = useStdout();
  const [value, setValue] = useState('');

  // Calculate terminal width
  const terminalWidth = stdout?.columns || 80;

  // Handle multiline input
  useInput((input, key) => {
    if (disabled) return;

    // Shift+Enter or Ctrl+Enter for newline
    if (key.return && (key.shift || key.ctrl)) {
      setValue(prev => prev + '\n');
      return;
    }
  });

  const handleChange = (newValue: string) => {
    setValue(newValue);
  };

  const handleSubmit = (val: string) => {
    if (val.trim()) {
      onSubmit(val.trim());
      setValue('');
    }
  };

  // Create horizontal line
  const horizontalLine = HORIZONTAL_LINE.repeat(terminalWidth);

  // Show line count if multiline
  const lineCount = value.split('\n').length;
  const showLineIndicator = lineCount > 1;

  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      {/* Top line */}
      <Box>
        <Text color={borderColor}>{horizontalLine}</Text>
      </Box>

      {/* Input area */}
      <Box paddingY={0}>
        {disabled ? (
          <Text color={colors.textMuted}>{placeholder}</Text>
        ) : (
          <Box>
            <Text color={borderColor} bold>{PROMPT_ICON} </Text>
            <TextInput
              value={value}
              onChange={handleChange}
              onSubmit={handleSubmit}
              placeholder={placeholder}
            />
          </Box>
        )}
      </Box>

      {/* Bottom line with optional line indicator */}
      <Box>
        {showLineIndicator ? (
          <>
            <Text color={borderColor}>{HORIZONTAL_LINE.repeat(2)}</Text>
            <Text color="#6B7280"> {lineCount} lines </Text>
            <Text color={borderColor}>
              {HORIZONTAL_LINE.repeat(terminalWidth - lineCount.toString().length - 10)}
            </Text>
          </>
        ) : (
          <Text color={borderColor}>{horizontalLine}</Text>
        )}
      </Box>
    </Box>
  );
};

export default ResizableInput;
