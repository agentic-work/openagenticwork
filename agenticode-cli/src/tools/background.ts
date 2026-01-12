/**
 * Background Process Tools
 * Run and monitor long-running shell commands in the background
 */

import { spawn, ChildProcess } from 'child_process';
import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

/**
 * Background process state
 */
interface BackgroundProcess {
  id: string;
  command: string;
  pid: number;
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
  status: 'running' | 'completed' | 'error';
  exitCode: number | null;
  startedAt: Date;
  completedAt?: Date;
}

// Global store of background processes
const backgroundProcesses: Map<string, BackgroundProcess> = new Map();

// Max lines to keep in output buffer
const MAX_OUTPUT_LINES = 1000;

/**
 * Generate a short ID for process tracking
 */
function generateProcessId(): string {
  return Math.random().toString(36).substring(2, 8);
}

/**
 * Bash Background Tool - Run a command in the background
 */
export const bashBackgroundTool: ToolDefinition = {
  name: 'bash_background',
  description: `Run a shell command in the background. Use this for long-running commands like:
- Running servers (npm run dev, python -m http.server)
- Build processes (npm run build --watch)
- Test suites (npm test)
- Any command that takes more than a few seconds

Returns a process ID that can be used with bash_output to check progress.`,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to run',
      },
      description: {
        type: 'string',
        description: 'Optional description of what this command does',
      },
    },
    required: ['command'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const command = args.command as string;
    const description = args.description as string | undefined;

    if (!command) {
      return {
        content: 'Error: command is required',
        isError: true,
      };
    }

    try {
      const processId = generateProcessId();

      // Spawn the process
      const proc = spawn('bash', ['-c', command], {
        cwd: context.workingDirectory,
        env: { ...process.env },
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const bgProcess: BackgroundProcess = {
        id: processId,
        command,
        pid: proc.pid || 0,
        process: proc,
        stdout: [],
        stderr: [],
        status: 'running',
        exitCode: null,
        startedAt: new Date(),
      };

      // Capture stdout
      proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        bgProcess.stdout.push(...lines);
        // Keep only last N lines
        while (bgProcess.stdout.length > MAX_OUTPUT_LINES) {
          bgProcess.stdout.shift();
        }
      });

      // Capture stderr
      proc.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        bgProcess.stderr.push(...lines);
        while (bgProcess.stderr.length > MAX_OUTPUT_LINES) {
          bgProcess.stderr.shift();
        }
      });

      // Handle completion
      proc.on('exit', (code) => {
        bgProcess.status = code === 0 ? 'completed' : 'error';
        bgProcess.exitCode = code;
        bgProcess.completedAt = new Date();
      });

      proc.on('error', (err) => {
        bgProcess.status = 'error';
        bgProcess.stderr.push(`Process error: ${err.message}`);
        bgProcess.completedAt = new Date();
      });

      backgroundProcesses.set(processId, bgProcess);

      return {
        content: `Started background process:
  ID: ${processId}
  PID: ${proc.pid}
  Command: ${command}${description ? `\n  Description: ${description}` : ''}

Use bash_output with ID "${processId}" to check progress.
Use kill_bash with ID "${processId}" to stop the process.`,
        metadata: {
          processId,
          pid: proc.pid,
          command,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Failed to start background process: ${message}`,
        isError: true,
      };
    }
  },
};

/**
 * Bash Output Tool - Get output from a background process
 */
export const bashOutputTool: ToolDefinition = {
  name: 'bash_output',
  description: `Get output from a background process started with bash_background.
Returns the current stdout/stderr output and process status.`,
  inputSchema: {
    type: 'object',
    properties: {
      processId: {
        type: 'string',
        description: 'The process ID returned by bash_background',
      },
      tailLines: {
        type: 'number',
        description: 'Number of output lines to return from the end (default: 50)',
      },
      filter: {
        type: 'string',
        description: 'Optional regex pattern to filter output lines',
      },
    },
    required: ['processId'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const processId = args.processId as string;
    const tailLines = (args.tailLines as number) || 50;
    const filter = args.filter as string | undefined;

    if (!processId) {
      return {
        content: 'Error: processId is required',
        isError: true,
      };
    }

    const bgProcess = backgroundProcesses.get(processId);
    if (!bgProcess) {
      // List available processes
      const available = Array.from(backgroundProcesses.keys()).join(', ') || 'none';
      return {
        content: `Process not found: ${processId}\nAvailable processes: ${available}`,
        isError: true,
      };
    }

    // Get output lines, optionally filtered
    let stdout = bgProcess.stdout.slice(-tailLines);
    let stderr = bgProcess.stderr.slice(-tailLines);

    if (filter) {
      try {
        const regex = new RegExp(filter);
        stdout = stdout.filter(l => regex.test(l));
        stderr = stderr.filter(l => regex.test(l));
      } catch {
        // Invalid regex, ignore filter
      }
    }

    const runtime = bgProcess.completedAt
      ? Math.round((bgProcess.completedAt.getTime() - bgProcess.startedAt.getTime()) / 1000)
      : Math.round((Date.now() - bgProcess.startedAt.getTime()) / 1000);

    let output = `Process ${processId} (${bgProcess.status})
${'─'.repeat(50)}
Command: ${bgProcess.command}
PID: ${bgProcess.pid}
Status: ${bgProcess.status}
Runtime: ${runtime}s
${bgProcess.exitCode !== null ? `Exit code: ${bgProcess.exitCode}` : ''}
`;

    if (stdout.length > 0) {
      output += `\nStdout (last ${stdout.length} lines):\n${stdout.join('\n')}`;
    }

    if (stderr.length > 0) {
      output += `\n\nStderr (last ${stderr.length} lines):\n${stderr.join('\n')}`;
    }

    if (stdout.length === 0 && stderr.length === 0) {
      output += '\n(No output yet)';
    }

    return {
      content: output,
      metadata: {
        processId,
        status: bgProcess.status,
        exitCode: bgProcess.exitCode,
        runtime,
        stdoutLines: bgProcess.stdout.length,
        stderrLines: bgProcess.stderr.length,
      },
    };
  },
};

/**
 * Kill Bash Tool - Terminate a background process
 */
export const killBashTool: ToolDefinition = {
  name: 'kill_bash',
  description: `Stop a background process started with bash_background.
Use this to terminate long-running processes when they're no longer needed.`,
  inputSchema: {
    type: 'object',
    properties: {
      processId: {
        type: 'string',
        description: 'The process ID to terminate',
      },
      signal: {
        type: 'string',
        enum: ['SIGTERM', 'SIGKILL', 'SIGINT'],
        description: 'Signal to send (default: SIGTERM)',
      },
    },
    required: ['processId'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const processId = args.processId as string;
    const signal = (args.signal as string) || 'SIGTERM';

    if (!processId) {
      return {
        content: 'Error: processId is required',
        isError: true,
      };
    }

    const bgProcess = backgroundProcesses.get(processId);
    if (!bgProcess) {
      return {
        content: `Process not found: ${processId}`,
        isError: true,
      };
    }

    if (bgProcess.status !== 'running') {
      return {
        content: `Process ${processId} is not running (status: ${bgProcess.status})`,
        metadata: {
          processId,
          status: bgProcess.status,
          exitCode: bgProcess.exitCode,
        },
      };
    }

    try {
      const killed = bgProcess.process.kill(signal as NodeJS.Signals);

      if (killed) {
        bgProcess.status = 'completed';
        bgProcess.exitCode = -1;
        bgProcess.completedAt = new Date();

        return {
          content: `Process ${processId} terminated with ${signal}`,
          metadata: {
            processId,
            signal,
            killed: true,
          },
        };
      } else {
        return {
          content: `Failed to terminate process ${processId}`,
          isError: true,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error terminating process: ${message}`,
        isError: true,
      };
    }
  },
};

/**
 * List Background Processes Tool - Show all running background processes
 */
export const listBackgroundTool: ToolDefinition = {
  name: 'list_background',
  description: `List all background processes started with bash_background.
Shows process ID, command, status, and runtime for each process.`,
  inputSchema: {
    type: 'object',
    properties: {
      showCompleted: {
        type: 'boolean',
        description: 'Include completed/stopped processes (default: false)',
      },
    },
    required: [],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const showCompleted = args.showCompleted as boolean || false;

    const processes = Array.from(backgroundProcesses.values())
      .filter(p => showCompleted || p.status === 'running');

    if (processes.length === 0) {
      return {
        content: showCompleted
          ? 'No background processes found.'
          : 'No running background processes. Use showCompleted: true to see all.',
      };
    }

    let output = `Background Processes (${processes.length})\n${'─'.repeat(60)}\n`;

    for (const proc of processes) {
      const runtime = proc.completedAt
        ? Math.round((proc.completedAt.getTime() - proc.startedAt.getTime()) / 1000)
        : Math.round((Date.now() - proc.startedAt.getTime()) / 1000);

      const statusEmoji = proc.status === 'running' ? '🔄' : proc.status === 'completed' ? '✅' : '❌';

      output += `\n${statusEmoji} ${proc.id} (${proc.status})
   Command: ${proc.command.slice(0, 60)}${proc.command.length > 60 ? '...' : ''}
   PID: ${proc.pid}, Runtime: ${runtime}s${proc.exitCode !== null ? `, Exit: ${proc.exitCode}` : ''}\n`;
    }

    return {
      content: output,
      metadata: {
        total: backgroundProcesses.size,
        running: processes.filter(p => p.status === 'running').length,
        completed: processes.filter(p => p.status === 'completed').length,
        error: processes.filter(p => p.status === 'error').length,
      },
    };
  },
};
