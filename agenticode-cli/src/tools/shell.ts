/**
 * Shell Tool
 * Execute shell commands in the workspace
 */

import { spawn } from 'child_process';
import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

const DANGEROUS_PATTERNS = [
  /\brm\s+(-rf?|--recursive)?\s*\/(?![\w-])/,  // rm / or rm -rf /
  /\bsudo\b/,
  /\bchmod\s+[0-7]*s/,  // setuid/setgid
  /\bdd\s+.*of=\/dev/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\b(wget|curl).*\|\s*(ba)?sh/,  // Pipe to shell
  /\bnc\s+-[el]/,  // Netcat listen
  />\s*\/etc\//,  // Write to /etc
  />\s*\/dev\//,  // Write to /dev
];

export const shellTool: ToolDefinition = {
  name: 'shell',
  description: `Execute a shell command in the workspace. Use this for:
- Running build commands (npm, make, etc.)
- Git operations
- File manipulation
- Running tests
- Any system commands

The command runs in the current working directory with a timeout of 60 seconds.`,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      workDir: {
        type: 'string',
        description: 'Optional working directory (relative or absolute)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000)',
      },
    },
    required: ['command'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const command = args.command as string;
    let workDir = (args.workDir as string) || context.workingDirectory;
    const timeout = (args.timeout as number) || 60000;

    // Validate workDir exists, fall back to context.workingDirectory if not
    try {
      const { access } = await import('fs/promises');
      await access(workDir);
    } catch {
      // Invalid workDir, use context.workingDirectory instead
      workDir = context.workingDirectory;
    }

    // Security check
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          content: `Security: Command blocked by security policy`,
          isError: true,
        };
      }
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn('bash', ['-c', command], {
        cwd: workDir,
        env: { ...process.env, TERM: 'dumb' },
        timeout,
      });

      // Handle abort signal
      const abortHandler = () => {
        if (!killed) {
          killed = true;
          proc.kill('SIGTERM');
        }
      };
      context.signal.addEventListener('abort', abortHandler);

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

      proc.on('error', (error) => {
        context.signal.removeEventListener('abort', abortHandler);
        resolve({
          content: `Error: ${error.message}`,
          isError: true,
        });
      });

      proc.on('close', (code) => {
        context.signal.removeEventListener('abort', abortHandler);
        const duration = Date.now() - startTime;

        let output = '';
        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n' : '') + stderr;
        if (!output) output = code === 0 ? 'Command completed successfully' : 'Command failed with no output';

        output += `\n\n[Exit code: ${code}, Duration: ${duration}ms]`;

        resolve({
          content: output,
          isError: code !== 0,
          metadata: { exitCode: code, duration },
        });
      });
    });
  },
};
