/**
 * DiffDisplay Component - GitHub-Style File Edit Display
 *
 * Shows file edits with:
 * - File path header with icon
 * - Line numbers
 * - Green + for additions
 * - Red - for deletions
 * - Gray context lines
 * - Box styling like agenticwork
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  filePath: string;
  operation: 'create' | 'modify' | 'delete';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

interface DiffDisplayProps {
  diff: FileDiff;
  collapsed?: boolean;
  maxLines?: number;
}

// Parse unified diff format into structured data
export function parseUnifiedDiff(diffText: string, filePath?: string): FileDiff {
  const lines = diffText.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let additions = 0;
  let deletions = 0;
  let detectedPath = filePath || '';

  for (const line of lines) {
    // Detect file path from diff header
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const pathMatch = line.match(/^[+-]{3}\s+(?:a\/|b\/)?(.+)/);
      if (pathMatch && pathMatch[1] !== '/dev/null') {
        detectedPath = pathMatch[1];
      }
      continue;
    }

    // Hunk header @@ -start,count +start,count @@
    if (line.startsWith('@@')) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        header: line,
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    // Additions
    if (line.startsWith('+')) {
      additions++;
      currentHunk.lines.push({
        type: 'add',
        content: line.slice(1),
      });
    }
    // Deletions
    else if (line.startsWith('-')) {
      deletions++;
      currentHunk.lines.push({
        type: 'remove',
        content: line.slice(1),
      });
    }
    // Context lines
    else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  // Determine operation
  let operation: 'create' | 'modify' | 'delete' = 'modify';
  if (deletions === 0 && additions > 0) {
    operation = 'create';
  } else if (additions === 0 && deletions > 0) {
    operation = 'delete';
  }

  return {
    filePath: detectedPath,
    operation,
    hunks,
    additions,
    deletions,
  };
}

// Parse simple old/new text comparison
export function createDiffFromTexts(
  filePath: string,
  oldText: string | null,
  newText: string
): FileDiff {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText.split('\n');
  const diffLines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  // Simple line-by-line comparison (for display purposes)
  // Real diff would use Myers algorithm, but this is for visual display
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      // Addition
      additions++;
      diffLines.push({ type: 'add', content: newLine, newLineNumber: i + 1 });
    } else if (newLine === undefined) {
      // Deletion
      deletions++;
      diffLines.push({ type: 'remove', content: oldLine, oldLineNumber: i + 1 });
    } else if (oldLine !== newLine) {
      // Changed line - show as deletion + addition
      deletions++;
      additions++;
      diffLines.push({ type: 'remove', content: oldLine, oldLineNumber: i + 1 });
      diffLines.push({ type: 'add', content: newLine, newLineNumber: i + 1 });
    } else {
      // Context line
      diffLines.push({ type: 'context', content: newLine, newLineNumber: i + 1 });
    }
  }

  return {
    filePath,
    operation: oldText === null ? 'create' : 'modify',
    hunks: [{ header: '', lines: diffLines }],
    additions,
    deletions,
  };
}

// File operation icons
const OPERATION_ICONS = {
  create: '📄',
  modify: '✏️',
  delete: '🗑️',
};

const OPERATION_COLORS = {
  create: 'green',
  modify: 'yellow',
  delete: 'red',
} as const;

export const DiffDisplay: React.FC<DiffDisplayProps> = ({
  diff,
  collapsed = false,
  maxLines = 20,
}) => {
  const { filePath, operation, hunks, additions, deletions } = diff;

  // Count total lines and truncate if needed
  let totalLines = 0;
  const truncatedHunks: DiffHunk[] = [];
  let lineCount = 0;

  for (const hunk of hunks) {
    totalLines += hunk.lines.length;
    if (collapsed && lineCount >= maxLines) continue;

    const remainingLines = maxLines - lineCount;
    if (collapsed && hunk.lines.length > remainingLines) {
      truncatedHunks.push({
        header: hunk.header,
        lines: hunk.lines.slice(0, remainingLines),
      });
      lineCount = maxLines;
    } else {
      truncatedHunks.push(hunk);
      lineCount += hunk.lines.length;
    }
  }

  const displayHunks = collapsed ? truncatedHunks : hunks;
  const hiddenLines = collapsed ? totalLines - lineCount : 0;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* File header */}
      <Box>
        <Text color={OPERATION_COLORS[operation]}>
          {operation === 'create' ? '●' : operation === 'modify' ? '●' : '●'}
        </Text>
        <Text bold> {operation === 'create' ? 'Write' : 'Edit'}</Text>
        <Text color="gray">(</Text>
        <Text color="cyan">{filePath}</Text>
        <Text color="gray">)</Text>
      </Box>

      {/* Stats line */}
      <Box marginLeft={2}>
        <Text color="gray">⎿  </Text>
        {additions > 0 && <Text color="green">+{additions} </Text>}
        {deletions > 0 && <Text color="red">-{deletions} </Text>}
        <Text color="gray">lines</Text>
      </Box>

      {/* Diff content */}
      <Box flexDirection="column" marginLeft={3} marginTop={0}>
        {displayHunks.map((hunk, hunkIndex) => (
          <Box key={hunkIndex} flexDirection="column">
            {hunk.header && (
              <Text color="cyan" dimColor>{hunk.header}</Text>
            )}
            {hunk.lines.map((line, lineIndex) => (
              <Box key={lineIndex}>
                {line.type === 'add' && (
                  <>
                    <Text color="green" bold>+ </Text>
                    <Text color="green">{line.content}</Text>
                  </>
                )}
                {line.type === 'remove' && (
                  <>
                    <Text color="red" bold>- </Text>
                    <Text color="red">{line.content}</Text>
                  </>
                )}
                {line.type === 'context' && (
                  <>
                    <Text color="gray">  </Text>
                    <Text color="gray" dimColor>{line.content}</Text>
                  </>
                )}
              </Box>
            ))}
          </Box>
        ))}
        {hiddenLines > 0 && (
          <Text color="gray" dimColor>... ({hiddenLines} more lines)</Text>
        )}
      </Box>
    </Box>
  );
};

// Compact diff display for inline use
export const InlineDiff: React.FC<{
  additions: number;
  deletions: number;
  filePath: string;
}> = ({ additions, deletions, filePath }) => (
  <Box>
    <Text color="cyan">{filePath}</Text>
    <Text color="gray"> | </Text>
    {additions > 0 && <Text color="green">+{additions}</Text>}
    {additions > 0 && deletions > 0 && <Text color="gray"> </Text>}
    {deletions > 0 && <Text color="red">-{deletions}</Text>}
  </Box>
);

export default DiffDisplay;
