/**
 * Search Tools
 * Search files and content in the workspace
 */

import { spawn, execSync } from 'child_process';
import { glob } from 'glob';
import { join, isAbsolute } from 'path';
import { existsSync } from 'fs';
import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

/**
 * Find ripgrep binary - checks multiple locations
 */
function findRipgrep(): string {
  // Common ripgrep locations
  const locations = [
    '/usr/bin/rg',
    '/usr/local/bin/rg',
    '/opt/homebrew/bin/rg',
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }

  // Try to find via which
  try {
    const result = execSync('which rg 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result && existsSync(result)) {
      return result;
    }
  } catch {
    // which failed, continue with default
  }

  // Default to 'rg' and let spawn handle the error
  return 'rg';
}

/**
 * Grep Tool - Search file contents
 */
export const grepTool: ToolDefinition = {
  name: 'grep',
  description: `Search for text patterns in files using ripgrep (rg). Use this to find code, configuration, or any text across the codebase. Supports regex patterns.`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The search pattern (regex supported)',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in (default: current directory)',
      },
      filePattern: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.ts", "*.py")',
      },
      ignoreCase: {
        type: 'boolean',
        description: 'Case-insensitive search (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
      context: {
        type: 'number',
        description: 'Lines of context around matches (default: 2)',
      },
    },
    required: ['pattern'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || '.';
    const filePattern = args.filePattern as string | undefined;
    const ignoreCase = (args.ignoreCase as boolean) || false;
    const maxResults = (args.maxResults as number) || 50;
    const contextLines = (args.context as number) || 2;

    const fullPath = isAbsolute(searchPath)
      ? searchPath
      : join(context.workingDirectory, searchPath);

    // Build ripgrep command
    const rgArgs = [
      '--color=never',
      '--line-number',
      '--no-heading',
      `--max-count=${maxResults}`,
      `--context=${contextLines}`,
    ];

    if (ignoreCase) rgArgs.push('--ignore-case');
    if (filePattern) rgArgs.push(`--glob=${filePattern}`);

    rgArgs.push('--', pattern, fullPath);

    // Try to find ripgrep binary
    const rgBinary = findRipgrep();

    return new Promise((resolve) => {
      let output = '';
      let errorOutput = '';

      const proc = spawn(rgBinary, rgArgs, {
        cwd: context.workingDirectory,
      });

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('error', (error) => {
        // ripgrep not found, fallback to grep
        if (error.message.includes('ENOENT')) {
          resolve(fallbackGrep(pattern, fullPath, ignoreCase, maxResults, context));
        } else {
          resolve({
            content: `Error: ${error.message}`,
            isError: true,
          });
        }
      });

      proc.on('close', (code) => {
        if (code === 1 && !output && !errorOutput) {
          // No matches found
          resolve({
            content: `No matches found for pattern: ${pattern}`,
          });
        } else if (code !== 0 && code !== 1) {
          resolve({
            content: `Search error: ${errorOutput || 'Unknown error'}`,
            isError: true,
          });
        } else {
          const lines = output.trim().split('\n').filter(Boolean);
          const header = `Search results for: ${pattern}\nFound ${lines.length} matches\n${'─'.repeat(60)}`;
          resolve({
            content: `${header}\n${output.trim()}`,
            metadata: { matchCount: lines.length },
          });
        }
      });
    });
  },
};

/**
 * Fallback grep using Node.js (when ripgrep is not available)
 */
async function fallbackGrep(
  pattern: string,
  searchPath: string,
  ignoreCase: boolean,
  maxResults: number,
  context: ToolContext
): Promise<ToolOutput> {
  return new Promise((resolve) => {
    const grepArgs = [
      '-r',
      '-n',
      ignoreCase ? '-i' : '',
      `--max-count=${maxResults}`,
      pattern,
      searchPath,
    ].filter(Boolean);

    const proc = spawn('grep', grepArgs, {
      cwd: context.workingDirectory,
    });

    let output = '';
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 1 && !output) {
        resolve({ content: `No matches found for pattern: ${pattern}` });
      } else {
        resolve({
          content: output.trim() || 'No matches found',
        });
      }
    });
  });
}

/**
 * Glob Tool - Find files by pattern
 */
export const globTool: ToolDefinition = {
  name: 'find_files',
  description: `Find files matching a glob pattern. Use this to locate files by name or extension in the workspace.`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.py", "**/test*")',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (default: current directory)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 100)',
      },
    },
    required: ['pattern'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || '.';
    const maxResults = (args.maxResults as number) || 100;

    const fullPath = isAbsolute(searchPath)
      ? searchPath
      : join(context.workingDirectory, searchPath);

    try {
      const files = await glob(pattern, {
        cwd: fullPath,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });

      const limited = files.slice(0, maxResults);
      const header = `Files matching: ${pattern}\nFound ${files.length} files${files.length > maxResults ? ` (showing first ${maxResults})` : ''}\n${'─'.repeat(60)}`;

      if (limited.length === 0) {
        return { content: `No files found matching: ${pattern}` };
      }

      return {
        content: `${header}\n${limited.map(f => `📄 ${f}`).join('\n')}`,
        metadata: { totalFiles: files.length, shownFiles: limited.length },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error searching files: ${message}`,
        isError: true,
      };
    }
  },
};
