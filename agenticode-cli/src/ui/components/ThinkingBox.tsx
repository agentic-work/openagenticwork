/**
 * ThinkingBox Component
 * Displays the LLM's reasoning/thinking process
 * Similar to agenticwork's thinking display
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from './Spinner.js';

interface ThinkingBoxProps {
  content: string;
  collapsed?: boolean;
  isLive?: boolean;  // Is thinking still being streamed?
}

export const ThinkingBox: React.FC<ThinkingBoxProps> = ({ content, collapsed = false, isLive = false }) => {
  if (!content) return null;

  // Truncate if collapsed
  const displayContent = collapsed
    ? content.slice(0, 150) + (content.length > 150 ? '...' : '')
    : content;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isLive ? '#F59E0B' : '#6366F1'}  // Orange when live, purple when done
      paddingX={1}
      marginY={1}
    >
      <Box>
        {isLive ? (
          <>
            <Text color="#F59E0B" bold>💭 thinking</Text>
            <Text color="#F59E0B" dimColor> (streaming...)</Text>
          </>
        ) : (
          <>
            <Text color="#6366F1" bold>thinking</Text>
            <Text color="#6366F1" dimColor> {collapsed ? '(collapsed)' : ''}</Text>
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={isLive ? '#FCD34D' : '#9CA3AF'} wrap="wrap">{displayContent}</Text>
      </Box>
    </Box>
  );
};

export default ThinkingBox;
