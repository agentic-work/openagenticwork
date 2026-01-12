/**
 * AWCode Input Component
 * Interactive text input with prompt styling
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { colors } from '../themes/colors.js';

interface InputProps {
  onSubmit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const Input: React.FC<InputProps> = ({
  onSubmit,
  placeholder = 'Type a message...',
  disabled = false,
}) => {
  const [value, setValue] = useState('');

  const handleSubmit = (val: string) => {
    if (val.trim()) {
      onSubmit(val.trim());
      setValue('');
    }
  };

  return (
    <Box>
      <Text color={colors.primary} bold>❯ </Text>
      {disabled ? (
        <Text color={colors.textMuted}>{placeholder}</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      )}
    </Box>
  );
};

export default Input;
