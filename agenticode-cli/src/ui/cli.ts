/**
 * agentic-cli - AgenticWork Code Assistant CLI
 * Interactive command-line interface for the AI assistant
 *
 * Clean, minimal UI design
 * Recommended font: Menlo Nerd Font, JetBrains Mono, or any Nerd Font
 */

import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import type { SessionConfig } from '../core/types.js';
import { ChatSession } from '../core/session.js';
import { createDefaultRegistry } from '../tools/index.js';
import { resolveModelPreset, getAvailableModels } from '../core/config.js';
import { getVersion } from '../version.js';

// Modern gradient: purple -> blue -> cyan -> teal
const GRADIENT_STOPS = ['#9333EA', '#6366F1', '#3B82F6', '#06B6D4', '#14B8A6'];

function interpolateColor(c1: string, c2: string, f: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * f), g = Math.round(g1 + (g2 - g1) * f), b = Math.round(b1 + (b2 - b1) * f);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function generateGradient(stops: string[], steps: number): string[] {
  const result: string[] = [];
  const segLen = (steps - 1) / (stops.length - 1);
  for (let i = 0; i < steps; i++) {
    const seg = Math.min(Math.floor(i / segLen), stops.length - 2);
    result.push(interpolateColor(stops[seg], stops[seg + 1], (i - seg * segLen) / segLen));
  }
  return result;
}

// Clean logo with smooth gradient
const printBanner = () => {
  console.log();
  const text = 'agenticwork';
  const colors = generateGradient(GRADIENT_STOPS, text.length);
  const banner = chalk.dim('(') + text.split('').map((c, i) => chalk.hex(colors[i]).bold(c)).join('') + chalk.dim(')');
  console.log('  ' + banner);
  console.log();
};

export interface CLIConfig {
  apiEndpoint?: string;  // AgenticWork API endpoint for API mode
  apiKey?: string;       // AgenticWork API key for API mode
  model: string;
  workingDirectory: string;
  interactive?: boolean;
  ollamaHost: string;    // Ollama endpoint for direct mode
  providerMode?: 'api' | 'ollama' | 'auto';  // Provider mode selection
}

export class CLI {
  private config: CLIConfig;
  private session: ChatSession | null = null;
  private rl: readline.Interface | null = null;
  private isRunning = false;

  constructor(config: CLIConfig) {
    this.config = config;
  }

  /**
   * Initialize the CLI session (without starting interaction loop)
   */
  private initSession(): void {
    // Resolve model preset to actual model identifier
    const resolvedModel = resolveModelPreset(this.config.model);
    // Update config with resolved model for display
    this.config.model = resolvedModel;

    const registry = createDefaultRegistry();

    const sessionConfig: SessionConfig & { workingDirectory: string } = {
      model: resolvedModel,
      workingDirectory: this.config.workingDirectory,
    };

    // Create session with provider mode support
    this.session = new ChatSession(null as any, registry, sessionConfig, {
      providerMode: this.config.providerMode,
      ollamaEndpoint: this.config.ollamaHost,
      apiEndpoint: this.config.apiEndpoint,
      apiKey: this.config.apiKey,
    });
  }

  /**
   * Initialize and start the CLI
   */
  async start(): Promise<void> {
    this.initSession();

    // Print welcome message
    this.printWelcome();

    if (this.config.interactive !== false) {
      await this.startInteractive();
    } else {
      // Non-interactive daemon mode - read from stdin line by line
      await this.startDaemon();
    }
  }

  /**
   * Run a single prompt and exit
   */
  async runOnce(prompt: string): Promise<void> {
    this.initSession();
    this.printWelcome();

    // Handle commands in runOnce mode too
    if (prompt.startsWith('/')) {
      await this.handleCommand(prompt);
    } else {
      await this.processMessage(prompt);
    }
    process.exit(0);
  }

  /**
   * Start daemon mode for non-interactive use (e.g., from awcode-manager)
   * Reads messages from stdin, processes them, outputs human-readable text
   */
  private async startDaemon(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false  // Important: don't treat as TTY
    });

    this.isRunning = true;

    // Keep process alive - ref() keeps the event loop active
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // Track if we're currently processing a message
    let isProcessing = false;
    const messageQueue: string[] = [];

    const processNextMessage = async () => {
      if (isProcessing || messageQueue.length === 0) return;

      isProcessing = true;
      const trimmed = messageQueue.shift()!;

      try {
        // Try to parse as JSON first
        let message: string;
        try {
          const parsed = JSON.parse(trimmed);
          message = parsed.message || parsed.prompt || parsed.content || trimmed;
        } catch {
          // Not JSON, treat as plain text message
          message = trimmed;
        }

        // Handle commands
        if (message.startsWith('/')) {
          await this.handleCommand(message);
          isProcessing = false;
          processNextMessage();
          return;
        }

        // Process the message - output clean human-readable text
        try {
          const chatGenerator = this.session!.chat(message);
          let isFirstChunk = true;
          for await (const chunk of chatGenerator) {
            if (isFirstChunk) {
              console.log(); // Blank line before response
              isFirstChunk = false;
            }
            // Stream text directly - no JSON wrapper
            process.stdout.write(chunk);
          }
          console.log('\n'); // Newlines after response
        } catch (chatError) {
          const errMsg = chatError instanceof Error ? chatError.message : String(chatError);
          console.log(chalk.red(`\nError: ${errMsg}\n`));
          isProcessing = false;
          processNextMessage();
          return;
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`\nError: ${errorMsg}\n`));
      }

      isProcessing = false;
      processNextMessage();
    };

    // Handle stdin close gracefully
    this.rl.on('close', () => {
      // Silent - no debug output
    });

    // Process each line as a message - queue them to handle async properly
    this.rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      messageQueue.push(trimmed);
      processNextMessage();
    });

    // Keep the process running indefinitely
    await new Promise<void>((resolve) => {
      process.on('SIGTERM', () => {
        this.isRunning = false;
        resolve();
      });
      process.on('SIGINT', () => {
        this.isRunning = false;
        resolve();
      });
    });
  }

  /**
   * Start interactive mode
   */
  private async startInteractive(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.isRunning = true;

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      if (this.session) {
        this.session.abort();
        console.log(chalk.yellow('\n\nRequest cancelled.'));
      } else {
        this.exit();
      }
    });

    while (this.isRunning) {
      const input = await this.prompt();

      if (!input) continue;

      // Handle commands
      if (input.startsWith('/')) {
        await this.handleCommand(input);
        continue;
      }

      // Process message
      await this.processMessage(input);
    }
  }

  /**
   * Process a user message
   */
  async processMessage(message: string): Promise<void> {
    if (!this.session) return;

    const spinner = ora({
      text: 'Thinking...',
      color: 'cyan',
    }).start();

    let fullResponse = '';
    let isFirstChunk = true;

    try {
      // Tool execution is now inline in the stream (agenticwork style: ● ToolName, ⎿ output)
      for await (const chunk of this.session.chat(message)) {
        if (isFirstChunk) {
          spinner.stop();
          isFirstChunk = false;
          console.log(); // New line before response
        }

        fullResponse += chunk;
        process.stdout.write(chunk);
      }

      console.log('\n');
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`\nError: ${message}\n`));
    }
  }

  /**
   * Handle slash commands
   */
  private async handleCommand(input: string): Promise<void> {
    const [command, ...args] = input.slice(1).split(' ');

    switch (command.toLowerCase()) {
      case '?':
      case 'help':
      case 'h':
        this.printHelp();
        break;

      case 'clear':
      case 'c':
        this.session?.clearHistory();
        console.log(chalk.green('Conversation cleared.\n'));
        break;

      case 'model':
      case 'm':
        if (args.length > 0) {
          const resolvedModel = resolveModelPreset(args[0]);
          this.session?.setModel(resolvedModel);
          console.log(chalk.green(`Model set to: ${resolvedModel}\n`));
        } else {
          console.log(chalk.blue(`Current model: ${this.session?.getModel()}\n`));
        }
        break;

      case 'models':
        this.printModels();
        break;

      case 'history':
        this.printHistory();
        break;

      case 'exit':
      case 'quit':
      case 'q':
        this.exit();
        break;

      default:
        console.log(chalk.yellow(`Unknown command: ${command}\n`));
        this.printHelp();
    }
  }

  /**
   * Prompt for input
   */
  private prompt(): Promise<string> {
    return new Promise((resolve) => {
      this.rl?.question(chalk.green('❯ '), (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Print welcome message - agenticwork style
   */
  private printWelcome(): void {
    printBanner();
    console.log(chalk.dim('  v' + getVersion() + '  •  ') + chalk.cyan(this.config.model));
    console.log(chalk.dim('  ' + this.config.workingDirectory));
    console.log();
    console.log(chalk.dim('  ') + chalk.green('/?') + chalk.dim(' help  •  ') + chalk.red('Ctrl+C') + chalk.dim(' cancel  •  ') + chalk.yellow('/exit') + chalk.dim(' quit'));
    console.log();
  }

  /**
   * Print help - agenticwork style
   */
  private printHelp(): void {
    console.log();
    console.log(chalk.green.bold('Commands:'));
    console.log(chalk.white('  /?, /help, /h    ') + chalk.dim('Show this help'));
    console.log(chalk.white('  /clear, /c       ') + chalk.dim('Clear conversation history'));
    console.log(chalk.white('  /model [name]    ') + chalk.dim('Show or set the model'));
    console.log(chalk.white('  /models          ') + chalk.dim('List available models'));
    console.log(chalk.white('  /history         ') + chalk.dim('Show conversation history'));
    console.log(chalk.white('  /exit, /q        ') + chalk.dim('Exit AWCode'));
    console.log();
    console.log(chalk.green.bold('Tips:'));
    console.log(chalk.dim('  • Press ') + chalk.red('Ctrl+C') + chalk.dim(' to cancel a request'));
    console.log(chalk.dim('  • Multi-line input: end with \\ to continue'));
    console.log(chalk.dim('  • Recommended font: Menlo Nerd Font or JetBrains Mono'));
    console.log();
  }

  /**
   * Print available models - AWCode independent model list
   */
  private printModels(): void {
    const models = getAvailableModels();
    const currentModel = this.session?.getModel() || this.config.model;

    console.log();
    console.log(chalk.green.bold('Available Models:'));
    console.log(chalk.dim('─'.repeat(60)));

    // Group by provider
    const localModels = models.filter(m => m.model.startsWith('ollama/'));
    const cloudModels = models.filter(m => !m.model.startsWith('ollama/') && !['default', 'local', 'fast', 'pro'].includes(m.name));
    const presets = models.filter(m => ['default', 'local', 'fast', 'pro'].includes(m.name));

    console.log(chalk.cyan.bold('\n  Presets:'));
    for (const m of presets) {
      const isCurrent = m.model === currentModel || m.name === currentModel;
      const marker = isCurrent ? chalk.green(' ◀ current') : '';
      console.log(chalk.white(`    ${m.name.padEnd(20)}`) + chalk.dim(m.description) + marker);
    }

    console.log(chalk.cyan.bold('\n  Local (Ollama):'));
    for (const m of localModels) {
      const isCurrent = m.model === currentModel;
      const marker = isCurrent ? chalk.green(' ◀ current') : '';
      console.log(chalk.white(`    ${m.name.padEnd(20)}`) + chalk.dim(m.description) + marker);
    }

    console.log(chalk.cyan.bold('\n  Cloud (API key required):'));
    for (const m of cloudModels) {
      const isCurrent = m.model === currentModel;
      const marker = isCurrent ? chalk.green(' ◀ current') : '';
      console.log(chalk.white(`    ${m.name.padEnd(20)}`) + chalk.dim(m.description) + marker);
    }

    console.log();
    console.log(chalk.dim('  Use ') + chalk.green('/model <name>') + chalk.dim(' to switch models'));
    console.log(chalk.dim('  Example: ') + chalk.white('/model ollama/devstral'));
    console.log();
  }

  /**
   * Print conversation history
   */
  private printHistory(): void {
    const history = this.session?.getHistory() || [];

    if (history.length === 0) {
      console.log(chalk.dim('\nNo conversation history.\n'));
      return;
    }

    console.log(chalk.cyan.bold('\nConversation History:'));
    console.log(chalk.dim('─'.repeat(60)));

    for (const msg of history) {
      const role = msg.role === 'user' ? chalk.green('You') : chalk.blue('AWCode');
      const content = typeof msg.content === 'string'
        ? msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : '')
        : '[complex content]';
      console.log(`${role}: ${chalk.white(content)}`);
    }

    console.log(chalk.dim('─'.repeat(60)));
    console.log();
  }

  /**
   * Exit the CLI
   */
  private exit(): void {
    console.log(chalk.cyan('\nGoodbye! 👋\n'));
    this.isRunning = false;
    this.rl?.close();
    process.exit(0);
  }
}
