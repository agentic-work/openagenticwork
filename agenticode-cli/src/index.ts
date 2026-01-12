#!/usr/bin/env node
/**
 * AgentiCode - AgenticWork AI Code Assistant CLI
 *
 * A badass coding assistant CLI powered by local LLMs via Ollama.
 * React Ink based UI for a modern terminal experience.
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { CLI } from './ui/cli.js';
import { runInkCLI } from './ui/ink-cli.js';
import { runNDJSONCLI } from './ui/ndjson-cli.js';
import { loadConfig } from './core/config.js';
import { getVersion } from './version.js';
import { runSetupWizard, isContainerEnvironment } from './core/setup.js';
import { getLocalPersistence, formatSessionList } from './core/local-persistence.js';
import chalk from 'chalk';

/**
 * Get system prompt from various sources (priority order):
 * 1. --system-prompt CLI argument
 * 2. --system-prompt-file CLI argument (file path)
 * 3. AGENTICODE_SYSTEM_PROMPT environment variable
 * 4. AGENTICODE_SYSTEM_PROMPT_FILE environment variable (file path)
 */
function getSystemPrompt(argv: { systemPrompt?: string; systemPromptFile?: string }): string | undefined {
  // 1. Direct CLI argument
  if (argv.systemPrompt) {
    return argv.systemPrompt;
  }

  // 2. File path from CLI
  if (argv.systemPromptFile) {
    try {
      return readFileSync(argv.systemPromptFile, 'utf-8').trim();
    } catch (err) {
      console.error(chalk.yellow(`Warning: Could not read system prompt file: ${argv.systemPromptFile}`));
    }
  }

  // 3. Environment variable
  if (process.env.AGENTICODE_SYSTEM_PROMPT) {
    return process.env.AGENTICODE_SYSTEM_PROMPT;
  }

  // 4. File path from environment
  if (process.env.AGENTICODE_SYSTEM_PROMPT_FILE) {
    try {
      return readFileSync(process.env.AGENTICODE_SYSTEM_PROMPT_FILE, 'utf-8').trim();
    } catch (err) {
      console.error(chalk.yellow(`Warning: Could not read system prompt file: ${process.env.AGENTICODE_SYSTEM_PROMPT_FILE}`));
    }
  }

  return undefined;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('agenticode')
    .usage('$0 [options] [prompt]')
    .option('model', {
      alias: 'm',
      type: 'string',
      description: 'Model to use (interactive selection if not specified)',
    })
    .option('ollama-host', {
      alias: 'o',
      type: 'string',
      description: 'Ollama host URL (interactive selection if not specified)',
    })
    .option('directory', {
      alias: 'd',
      type: 'string',
      description: 'Working directory',
      default: process.cwd(),
    })
    .option('non-interactive', {
      alias: 'n',
      type: 'boolean',
      description: 'Run in non-interactive mode (skip setup wizard)',
      default: false,
    })
    .option('json', {
      alias: 'j',
      type: 'boolean',
      description: 'Output as JSON (non-interactive)',
      default: false,
    })
    .option('ui', {
      type: 'string',
      description: 'UI mode: ink (modern) or classic',
      default: 'ink',
      choices: ['ink', 'classic'],
    })
    .option('yolo', {
      alias: 'y',
      type: 'boolean',
      description: 'YOLO mode: auto-approve all tool executions',
      default: false,
    })
    .option('system-prompt', {
      alias: 's',
      type: 'string',
      description: 'Custom system prompt (or set AGENTICODE_SYSTEM_PROMPT env var)',
    })
    .option('system-prompt-file', {
      type: 'string',
      description: 'Path to file containing system prompt',
    })
    .option('api-endpoint', {
      type: 'string',
      description: 'AgenticWork API endpoint (use platform LLM providers)',
    })
    .option('api-key', {
      type: 'string',
      description: 'AgenticWork API key (or set AGENTICODE_API_KEY env var)',
    })
    .option('provider', {
      type: 'string',
      description: 'LLM provider mode: api (AgenticWork), ollama (direct), auto (detect)',
      choices: ['api', 'ollama', 'auto'],
      default: 'auto',
    })
    .option('alt-buffer', {
      type: 'boolean',
      description: 'Use alternate screen buffer (not needed with new UI)',
      default: false,
    })
    .option('continue', {
      alias: 'c',
      type: 'boolean',
      description: 'Continue last session in current directory',
      default: false,
    })
    .option('resume', {
      alias: 'r',
      type: 'string',
      description: 'Resume a specific session by ID',
    })
    .option('sessions', {
      type: 'boolean',
      description: 'List all saved sessions',
      default: false,
    })
    .option('output-format', {
      type: 'string',
      description: 'Output format: text (human-readable) or stream-json (NDJSON for web UIs)',
      choices: ['text', 'stream-json'],
      default: 'text',
    })
    .option('input-format', {
      type: 'string',
      description: 'Input format: text (plain text) or stream-json (NDJSON from web UIs)',
      choices: ['text', 'stream-json'],
      default: 'text',
    })
    .version(`v${getVersion()}`)  // Read version from package.json
    .alias('version', 'V')
    .help('help')
    .alias('help', 'h')
    .example('$0', 'Start interactive session with setup wizard')
    .example('$0 -c', 'Continue last session in current directory')
    .example('$0 --sessions', 'List all saved sessions')
    .example('$0 -r abc123', 'Resume session by ID')
    .example('$0 -o http://192.168.1.100:11434', 'Use specific Ollama host')
    .example('$0 -m gpt-oss "explain this code"', 'Use specific model')
    .example('$0 -d /path/to/project', 'Set working directory')
    .parse();

  try {
    // Handle --sessions flag: list all sessions and exit
    if (argv.sessions) {
      const persistence = getLocalPersistence();
      const sessions = persistence.listSessions();
      console.log(formatSessionList(sessions));
      return;
    }

    // Load configuration
    const config = await loadConfig(argv.directory as string);

    // Determine if we should run the interactive setup wizard
    const isInteractive = process.stdout.isTTY && !argv.nonInteractive;
    const hasPrompt = argv._.length > 0;

    // Run setup wizard to select Ollama host and model
    // Skips automatically if:
    // - In container environment (uses internal Ollama)
    // - Both host and model provided via args
    // - Non-interactive mode
    const setupResult = await runSetupWizard({
      ollamaHost: argv.ollamaHost as string | undefined,
      model: argv.model as string | undefined,
      skipInteractive: !isInteractive || hasPrompt,
    });

    // Get system prompt from CLI args or environment
    const systemPrompt = getSystemPrompt({
      systemPrompt: argv.systemPrompt as string | undefined,
      systemPromptFile: argv.systemPromptFile as string | undefined,
    });

    // Get API credentials from args or environment
    const apiEndpoint = (argv.apiEndpoint as string) ||
      process.env.AGENTICWORK_API_ENDPOINT ||
      process.env.AGENTICWORK_API_URL;
    const apiKey = (argv.apiKey as string) ||
      process.env.AGENTICODE_API_KEY ||
      process.env.AGENTICWORK_API_KEY;

    const mergedConfig = {
      model: setupResult.model,
      workingDirectory: argv.directory as string,
      ollamaHost: setupResult.ollamaHost,
      yoloMode: argv.yolo as boolean,
      systemPrompt,
      useAlternateBuffer: argv.altBuffer as boolean,
      // Provider configuration
      providerMode: argv.provider as 'api' | 'ollama' | 'auto',
      apiEndpoint,
      apiKey,
    };

    // NDJSON streaming mode - for web UI integration (AgenticWork Code Mode)
    // When --output-format stream-json is specified, run in headless NDJSON mode
    const outputFormat = argv.outputFormat as string;
    const inputFormat = argv.inputFormat as string;

    if (outputFormat === 'stream-json') {
      // NDJSON mode - structured JSON output for web UIs
      await runNDJSONCLI({
        ...mergedConfig,
        sessionId: process.env.AGENTICODE_SESSION_ID,
      });
      return;
    }

    // Use Ink UI when:
    // 1. Explicitly requested via --ui ink
    // 2. Running in a TTY (real terminal or PTY from manager)
    // Note: --non-interactive only skips the setup wizard, doesn't disable Ink UI
    // This allows the rich Ink UI to work via agenticwork-manager's PTY
    //
    // IMPORTANT: When spawned by agenticode-manager via node-pty, process.stdout.isTTY
    // may still be false inside Docker containers. We detect this by checking:
    // - CONTAINER_MODE=1 (set by manager)
    // - TERM=xterm-256color (set by manager's PTY)
    const isContainerPTY = process.env.CONTAINER_MODE === '1' && process.env.TERM === 'xterm-256color';
    const useInk = argv.ui === 'ink' && (process.stdout.isTTY || isContainerPTY);

    if (useInk) {
      // Modern Ink-based UI
      const initialPrompt = argv._.length > 0 ? argv._.join(' ') : undefined;

      // Handle session resumption
      const persistence = getLocalPersistence();
      let resumeSession = null;

      if (argv.resume) {
        // Resume specific session by ID
        resumeSession = persistence.loadSession(argv.resume as string);
        if (!resumeSession) {
          console.error(chalk.red(`Session not found: ${argv.resume}`));
          console.log(chalk.gray('Use --sessions to list available sessions'));
          process.exit(1);
        }
        console.log(chalk.green(`Resuming session: ${resumeSession.title || resumeSession.id}`));
        console.log(chalk.gray(`  ${resumeSession.messageCount} messages | ${resumeSession.model}`));
      } else if (argv.continue) {
        // Continue last session in current directory
        resumeSession = persistence.getLastSessionForDirectory(argv.directory as string);
        if (resumeSession) {
          console.log(chalk.green(`Continuing session: ${resumeSession.title || resumeSession.id}`));
          console.log(chalk.gray(`  ${resumeSession.messageCount} messages | ${resumeSession.model}`));
        } else {
          console.log(chalk.gray('No previous session found, starting new session'));
        }
      }

      await runInkCLI({
        ...mergedConfig,
        initialPrompt,
        resumeSession,
      });
    } else {
      // Classic readline-based CLI
      const cli = new CLI({
        ...mergedConfig,
        interactive: !argv.nonInteractive && !argv._.length,
      });

      if (argv._.length > 0) {
        const prompt = argv._.join(' ');
        await cli.runOnce(prompt);
      } else {
        await cli.start();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
