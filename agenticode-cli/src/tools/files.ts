/**
 * File Tools
 * Read, write, and edit files in the workspace
 */

import { readFile, writeFile, access, stat, readdir } from 'fs/promises';
import { join, relative, isAbsolute, dirname } from 'path';
import { createTwoFilesPatch } from 'diff';
import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

/**
 * Read File Tool
 */
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: `Read the contents of a file. Use this to examine source code, configuration files, or any text file in the workspace.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path (relative to workspace or absolute)',
      },
      startLine: {
        type: 'number',
        description: 'Optional: Start reading from this line (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'Optional: Stop reading at this line (inclusive)',
      },
    },
    required: ['path'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const filePath = args.path as string;
    const startLine = args.startLine as number | undefined;
    const endLine = args.endLine as number | undefined;

    const fullPath = isAbsolute(filePath)
      ? filePath
      : join(context.workingDirectory, filePath);

    try {
      await access(fullPath);
      const content = await readFile(fullPath, 'utf-8');

      let lines = content.split('\n');
      let result: string;

      if (startLine || endLine) {
        const start = Math.max(1, startLine || 1) - 1;
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;
        lines = lines.slice(start, end);

        // Add line numbers
        result = lines
          .map((line, i) => `${String(start + i + 1).padStart(4)} │ ${line}`)
          .join('\n');
        result = `File: ${filePath} (lines ${start + 1}-${end})\n${'─'.repeat(60)}\n${result}`;
      } else {
        // Add line numbers for full file
        result = lines
          .map((line, i) => `${String(i + 1).padStart(4)} │ ${line}`)
          .join('\n');
        result = `File: ${filePath}\n${'─'.repeat(60)}\n${result}`;
      }

      return { content: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error reading file: ${message}`,
        isError: true,
      };
    }
  },
};

/**
 * Write File Tool
 */
export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: `Write content to a file. Creates the file if it doesn't exist, or overwrites if it does. Use this for creating new files or completely replacing file contents.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path (relative to workspace or absolute)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    // SAFETY NET: Unwrap if model incorrectly wrapped params in "value"
    // This handles: { value: { path: "...", content: "..." } }
    let normalizedArgs = args;
    if (args.value && typeof args.value === 'object' && !args.path && !args.content) {
      console.error('[write_file] WARNING: Unwrapping "value" wrapper - model used incorrect parameter format');
      normalizedArgs = args.value as Record<string, unknown>;
    }

    const filePath = normalizedArgs.path as string;
    const content = normalizedArgs.content as string;

    // Validate required parameters
    if (!filePath || typeof filePath !== 'string') {
      return {
        content: `Error: 'path' parameter is required and must be a string. Received: ${JSON.stringify(args)}. IMPORTANT: Parameters must be direct key-value pairs like {"path": "file.txt", "content": "..."}, NOT wrapped in a "value" object.`,
        isError: true,
      };
    }

    if (content === undefined || content === null) {
      return {
        content: `Error: 'content' parameter is required. Received: ${JSON.stringify(args)}. IMPORTANT: Parameters must be direct key-value pairs like {"path": "file.txt", "content": "..."}, NOT wrapped in a "value" object.`,
        isError: true,
      };
    }

    const fullPath = isAbsolute(filePath)
      ? filePath
      : join(context.workingDirectory, filePath);

    try {
      // Create directory if needed
      const { mkdir } = await import('fs/promises');
      await mkdir(dirname(fullPath), { recursive: true });

      await writeFile(fullPath, content, 'utf-8');

      const lines = content.split('\n').length;
      return {
        content: `Successfully wrote ${lines} lines to ${filePath}`,
        metadata: { path: filePath, lines },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error writing file: ${message}`,
        isError: true,
      };
    }
  },
};

/**
 * Edit File Tool
 */
export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: `Make targeted edits to a file by replacing specific text. Use this for modifying existing files without rewriting the entire content. The oldText must match exactly (including whitespace).`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path (relative to workspace or absolute)',
      },
      oldText: {
        type: 'string',
        description: 'The exact text to find and replace',
      },
      newText: {
        type: 'string',
        description: 'The text to replace it with',
      },
    },
    required: ['path', 'oldText', 'newText'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    // SAFETY NET: Unwrap if model incorrectly wrapped params in "value"
    let normalizedArgs = args;
    if (args.value && typeof args.value === 'object' && !args.path) {
      console.error('[edit_file] WARNING: Unwrapping "value" wrapper - model used incorrect parameter format');
      normalizedArgs = args.value as Record<string, unknown>;
    }

    const filePath = normalizedArgs.path as string;
    const oldText = normalizedArgs.oldText as string;
    const newText = normalizedArgs.newText as string;

    // Validate required parameters
    if (!filePath || typeof filePath !== 'string') {
      return {
        content: `Error: 'path' parameter is required. Received: ${JSON.stringify(args)}. Parameters must be direct key-value pairs, NOT wrapped in a "value" object.`,
        isError: true,
      };
    }

    if (oldText === undefined || oldText === null) {
      return {
        content: `Error: 'oldText' parameter is required. Received: ${JSON.stringify(args)}. Parameters must be direct key-value pairs.`,
        isError: true,
      };
    }

    if (newText === undefined) {
      return {
        content: `Error: 'newText' parameter is required. Received: ${JSON.stringify(args)}. Parameters must be direct key-value pairs.`,
        isError: true,
      };
    }

    const fullPath = isAbsolute(filePath)
      ? filePath
      : join(context.workingDirectory, filePath);

    try {
      const content = await readFile(fullPath, 'utf-8');

      if (!content.includes(oldText)) {
        return {
          content: `Error: Could not find the specified text in ${filePath}. Make sure the oldText matches exactly, including whitespace and indentation.`,
          isError: true,
        };
      }

      // Count occurrences
      const occurrences = content.split(oldText).length - 1;
      if (occurrences > 1) {
        return {
          content: `Error: Found ${occurrences} occurrences of the text. Please provide more context to make the match unique.`,
          isError: true,
        };
      }

      const newContent = content.replace(oldText, newText);
      await writeFile(fullPath, newContent, 'utf-8');

      // Generate diff
      const diff = createTwoFilesPatch(
        filePath,
        filePath,
        content,
        newContent,
        'before',
        'after'
      );

      return {
        content: `Successfully edited ${filePath}\n\n${diff}`,
        metadata: { path: filePath },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error editing file: ${message}`,
        isError: true,
      };
    }
  },
};

/**
 * List Directory Tool
 */
export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: `List the contents of a directory. Shows files and subdirectories with their types and sizes.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path (relative to workspace or absolute)',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list recursively (default: false)',
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum depth for recursive listing (default: 3)',
      },
    },
    required: ['path'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const dirPath = (args.path as string) || '.';
    const recursive = (args.recursive as boolean) || false;
    const maxDepth = (args.maxDepth as number) || 3;

    const fullPath = isAbsolute(dirPath)
      ? dirPath
      : join(context.workingDirectory, dirPath);

    async function listRecursive(
      dir: string,
      depth: number,
      prefix: string = ''
    ): Promise<string[]> {
      const entries: string[] = [];

      try {
        const items = await readdir(dir, { withFileTypes: true });

        for (const item of items) {
          // Skip hidden files and common ignore patterns
          if (item.name.startsWith('.') || item.name === 'node_modules') {
            continue;
          }

          const itemPath = join(dir, item.name);
          const relPath = relative(fullPath, itemPath);

          if (item.isDirectory()) {
            entries.push(`${prefix}📁 ${item.name}/`);
            if (recursive && depth < maxDepth) {
              const subEntries = await listRecursive(
                itemPath,
                depth + 1,
                prefix + '  '
              );
              entries.push(...subEntries);
            }
          } else {
            try {
              const stats = await stat(itemPath);
              const size = formatSize(stats.size);
              entries.push(`${prefix}📄 ${item.name} (${size})`);
            } catch {
              entries.push(`${prefix}📄 ${item.name}`);
            }
          }
        }
      } catch (error) {
        entries.push(`${prefix}Error: Cannot read directory`);
      }

      return entries;
    }

    try {
      const entries = await listRecursive(fullPath, 0);
      const header = `Directory: ${dirPath}\n${'─'.repeat(60)}`;
      return {
        content: entries.length > 0
          ? `${header}\n${entries.join('\n')}`
          : `${header}\n(empty directory)`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error listing directory: ${message}`,
        isError: true,
      };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
