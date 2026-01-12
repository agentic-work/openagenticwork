/**
 * @agenticwork/sdk Built-in Tools
 *
 * Standard tools for file operations, shell commands, etc.
 */

import type { Tool, ToolContext } from '../core/types.js';
import { spawn } from 'child_process';
import { readFile, writeFile, readdir, stat, unlink, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

/**
 * Shell execution tool
 */
export const shellTool: Tool = {
  name: 'shell',
  description: 'Execute a shell command in the working directory',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      workDir: { type: 'string', description: 'Working directory (optional)' },
    },
    required: ['command'],
  },
  execute: async (args, context) => {
    const { command, workDir } = args as { command: string; workDir?: string };
    const cwd = workDir || context.workingDirectory;

    return new Promise((resolve, reject) => {
      const proc = spawn('sh', ['-c', command], {
        cwd,
        env: process.env,
        signal: context.signal,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        context.onProgress?.(text);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        context.onProgress?.(text);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout || stderr || 'Command completed successfully');
        } else {
          resolve(`Exit code ${code}: ${stderr || stdout}`);
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  },
};

/**
 * Read file tool
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (relative to workspace)' },
      encoding: { type: 'string', description: 'File encoding (default: utf-8)' },
    },
    required: ['path'],
  },
  execute: async (args, context) => {
    const { path, encoding = 'utf-8' } = args as { path: string; encoding?: BufferEncoding };
    const fullPath = join(context.workingDirectory, path);
    const content = await readFile(fullPath, { encoding });
    return content;
  },
};

/**
 * Write file tool
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file (creates or overwrites)',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (relative to workspace)' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  execute: async (args, context) => {
    const { path, content } = args as { path: string; content: string };
    const fullPath = join(context.workingDirectory, path);

    // Ensure directory exists
    await mkdir(dirname(fullPath), { recursive: true });

    await writeFile(fullPath, content, 'utf-8');
    const lines = content.split('\n').length;
    return `Successfully wrote ${lines} lines to ${path}`;
  },
};

/**
 * List files tool
 */
export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'List files in a directory',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (default: current directory)' },
      recursive: { type: 'boolean', description: 'List recursively' },
    },
  },
  execute: async (args, context) => {
    const { path = '.', recursive = false } = args as { path?: string; recursive?: boolean };
    const fullPath = join(context.workingDirectory, path);

    if (recursive) {
      const files: string[] = [];
      const walk = async (dir: string, prefix: string = '') => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = join(prefix, entry.name);
          if (entry.isDirectory()) {
            await walk(join(dir, entry.name), entryPath);
          } else {
            files.push(entryPath);
          }
        }
      };
      await walk(fullPath);
      return files.slice(0, 100).join('\n');
    }

    const entries = await readdir(fullPath, { withFileTypes: true });
    return entries.map(e => `${e.isDirectory() ? 'd' : '-'} ${e.name}`).join('\n');
  },
};

/**
 * Delete file tool
 */
export const deleteFileTool: Tool = {
  name: 'delete_file',
  description: 'Delete a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to delete' },
    },
    required: ['path'],
  },
  execute: async (args, context) => {
    const { path } = args as { path: string };
    const fullPath = join(context.workingDirectory, path);
    await unlink(fullPath);
    return `Deleted ${path}`;
  },
};

/**
 * Search files tool (grep-like)
 */
export const searchTool: Tool = {
  name: 'search',
  description: 'Search for a pattern in files',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (regex)' },
      path: { type: 'string', description: 'Directory to search in (default: current)' },
      filePattern: { type: 'string', description: 'File glob pattern (e.g., "*.ts")' },
    },
    required: ['pattern'],
  },
  execute: async (args, context) => {
    const { pattern, path = '.', filePattern = '*' } = args as {
      pattern: string;
      path?: string;
      filePattern?: string;
    };

    return new Promise((resolve) => {
      const proc = spawn('grep', [
        '-rn',
        '--include', filePattern,
        pattern,
        path,
      ], {
        cwd: context.workingDirectory,
        signal: context.signal,
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        resolve(output.slice(0, 10000) || 'No matches found');
      });
    });
  },
};

/**
 * Get all built-in tools
 */
export function getBuiltinTools(): Tool[] {
  return [
    shellTool,
    readFileTool,
    writeFileTool,
    listFilesTool,
    deleteFileTool,
    searchTool,
  ];
}

export default getBuiltinTools;
