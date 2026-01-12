/**
 * ToolExecutionDisplay Component - Open-Codex Style
 *
 * Displays tool execution like open-codex:
 * - "command" label in magenta bold
 * - $ command format
 * - Simple diff coloring (green for +, red for -)
 * - Truncated output (4 lines by default)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export interface ToolExecution {
  id: string;
  name: string;
  args: string;
  status: 'pending' | 'running' | 'success' | 'error';
  output?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

interface ToolExecutionDisplayProps {
  execution: ToolExecution;
  collapsed?: boolean;
  onToggle?: () => void;
}

// Tool name mappings for display
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  edit_file: 'edit',
  list_dir: 'ls',
  shell: 'bash',
  bash_background: 'bash',
  grep: 'grep',
  find_files: 'find',
  web_fetch: 'fetch',
  web_search: 'search',
};

function getCommandText(name: string, args: string): string {
  const displayName = TOOL_DISPLAY_NAMES[name] || name;
  if (args) {
    return `${displayName} ${args}`;
  }
  return displayName;
}

// Colorize diff output (open-codex style)
function colorizeOutput(output: string): React.ReactNode[] {
  const lines = output.split('\n');
  return lines.map((line, i) => {
    // Green for additions (but not diff headers ++)
    if (line.startsWith('+') && !line.startsWith('++')) {
      return <Text key={i} color="green">{line}</Text>;
    }
    // Red for removals (but not diff headers --)
    if (line.startsWith('-') && !line.startsWith('--')) {
      return <Text key={i} color="red">{line}</Text>;
    }
    // Normal text
    return <Text key={i}>{line}</Text>;
  });
}

export const ToolExecutionDisplay: React.FC<ToolExecutionDisplayProps> = ({
  execution,
  collapsed = true,
}) => {
  const { name, args, status, output, error } = execution;
  const commandText = getCommandText(name, args);

  // Duration if completed
  const duration = execution.startTime && execution.endTime
    ? ((execution.endTime - execution.startTime) / 1000).toFixed(1)
    : null;

  // Process output
  const displayOutput = output || error || '';
  const outputLines = displayOutput.split('\n').filter(l => l.trim());
  const maxLines = collapsed ? 4 : 50;
  const truncatedLines = outputLines.slice(0, maxLines);
  const remainingLines = outputLines.length - maxLines;

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Command header */}
      <Box gap={1}>
        {status === 'running' ? (
          <Text color="magenta"><Spinner type="dots" /></Text>
        ) : status === 'error' ? (
          <Text color="red" bold>✗</Text>
        ) : (
          <Text color="green" bold>✓</Text>
        )}
        <Text color="magentaBright" bold>command</Text>
      </Box>

      {/* Command line */}
      <Box marginLeft={2}>
        <Text color="gray">$ </Text>
        <Text>{commandText}</Text>
        {duration && status !== 'running' && (
          <Text color="gray"> ({duration}s)</Text>
        )}
      </Box>

      {/* Output */}
      {displayOutput && status !== 'running' && (
        <Box flexDirection="column" marginLeft={2} marginTop={0}>
          <Text color="magentaBright" bold dimColor>command.stdout</Text>
          <Box flexDirection="column">
            {truncatedLines.map((line, i) => {
              // Colorize diff lines
              if (line.startsWith('+') && !line.startsWith('++')) {
                return <Text key={i} color="green">{line}</Text>;
              }
              if (line.startsWith('-') && !line.startsWith('--')) {
                return <Text key={i} color="red">{line}</Text>;
              }
              return <Text key={i} color="gray">{line}</Text>;
            })}
            {remainingLines > 0 && (
              <Text color="gray" dimColor>... ({remainingLines} more lines)</Text>
            )}
          </Box>
        </Box>
      )}

      {/* Error output */}
      {error && !output && (
        <Box marginLeft={2}>
          <Text color="red">{error}</Text>
        </Box>
      )}
    </Box>
  );
};

export default ToolExecutionDisplay;
