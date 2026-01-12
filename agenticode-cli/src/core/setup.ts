/**
 * Interactive Setup Wizard
 * Helps users connect to AgenticWork/Ollama and select a model
 *
 * Features:
 * - Auto-discovery of AgenticWork API endpoints
 * - Auto-discovery of Ollama endpoints
 * - Ollama-only model filtering (excludes paid LLMs like Claude, GPT-4)
 * - Container environment detection
 */

import chalk from 'chalk';
import * as readline from 'readline';
import {
  autoConnect,
  discoverApiEndpoint,
  discoverOllamaEndpoint,
  fetchOllamaModels,
  isOllamaOnlyMode,
  type AutoConnectResult,
} from './auto-connect.js';

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface SetupResult {
  ollamaHost: string;
  model: string;
  skipSetup: boolean;
  apiEndpoint?: string;
  apiConnected: boolean;
}

/**
 * Test connection to Ollama and get available models
 */
export async function testOllamaConnection(host: string): Promise<{ ok: boolean; models: OllamaModel[]; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${host}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false, models: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json() as { models?: OllamaModel[] };
    return { ok: true, models: data.models || [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, models: [], error: message };
  }
}

/**
 * Prompt user for input
 */
function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Check if running inside Docker/container environment
 */
export function isContainerEnvironment(): boolean {
  return !!(
    process.env.CONTAINER_MODE ||
    process.env.KUBERNETES_SERVICE_HOST ||
    process.env.DOCKER_CONTAINER
  );
}

/**
 * Filter models to only Ollama-compatible (excludes Claude, GPT-4, etc.)
 */
function filterOllamaModels(models: OllamaModel[]): OllamaModel[] {
  // All models from Ollama's /api/tags are already Ollama models
  // But we can further filter to prefer certain coding-focused models
  const preferredOrder = [
    'gpt-oss',
    'devstral',
    'qwen2.5-coder',
    'deepseek-coder',
    'codellama',
    'starcoder',
    'llama',
    'mistral',
    'phi',
    'gemma',
  ];

  return models.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    // Find preference index (lower is better)
    const aIndex = preferredOrder.findIndex(p => aName.includes(p));
    const bIndex = preferredOrder.findIndex(p => bName.includes(p));

    // Both have preferences - sort by preference
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    // Only a has preference
    if (aIndex !== -1) return -1;
    // Only b has preference
    if (bIndex !== -1) return 1;
    // Neither has preference - sort alphabetically
    return aName.localeCompare(bName);
  });
}

/**
 * Run interactive setup wizard with auto-connect
 * Skipped if:
 * - Running in container (manager sets env vars)
 * - OLLAMA_HOST and model are already set via env/cli args
 * - Non-interactive mode
 */
export async function runSetupWizard(options: {
  ollamaHost?: string;
  model?: string;
  skipInteractive?: boolean;
}): Promise<SetupResult> {
  // In container mode, use internal services with auto-discovery
  if (isContainerEnvironment()) {
    const connectResult = await autoConnect({ verbose: false, ollamaOnly: true });

    if (connectResult.ollamaHost) {
      const containerModel = process.env.AGENTICODE_MODEL || 'gpt-oss';
      return {
        ollamaHost: connectResult.ollamaHost,
        model: containerModel,
        skipSetup: true,
        apiEndpoint: connectResult.endpoint?.url,
        apiConnected: connectResult.connected,
      };
    }
    // Fall through to interactive if container services not available
  }

  // If host and model provided via args/env, validate and use them
  if (options.ollamaHost && options.model && options.model !== 'auto') {
    const result = await testOllamaConnection(options.ollamaHost);
    if (result.ok) {
      const modelExists = result.models.some(m =>
        m.name === options.model ||
        m.name.startsWith(options.model + ':')
      );
      if (modelExists || options.skipInteractive) {
        // Also try to discover API endpoint
        const apiEndpoint = await discoverApiEndpoint(false);
        return {
          ollamaHost: options.ollamaHost,
          model: options.model,
          skipSetup: true,
          apiEndpoint: apiEndpoint?.url,
          apiConnected: !!apiEndpoint,
        };
      }
    }
  }

  // Skip interactive if requested
  if (options.skipInteractive) {
    // Try auto-connect first
    const connectResult = await autoConnect({ verbose: false, ollamaOnly: true });
    return {
      ollamaHost: connectResult.ollamaHost || options.ollamaHost || 'http://localhost:11434',
      model: options.model || 'gpt-oss',
      skipSetup: true,
      apiEndpoint: connectResult.endpoint?.url,
      apiConnected: connectResult.connected,
    };
  }

  // Interactive setup
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.cyan('\n  AgentiCode Setup\n'));
  console.log(chalk.gray('  Auto-discovering AgenticWork services...\n'));

  // Step 1: Auto-discover services
  const connectResult = await autoConnect({ verbose: true, ollamaOnly: true });

  let selectedHost = connectResult.ollamaHost || '';
  let availableModels: OllamaModel[] = [];
  let apiEndpoint = connectResult.endpoint?.url;

  // If auto-connect found Ollama, get its models
  if (selectedHost) {
    const result = await testOllamaConnection(selectedHost);
    if (result.ok) {
      availableModels = filterOllamaModels(result.models);
    }
  }

  // Step 2: If no Ollama found, prompt for custom host
  if (!selectedHost) {
    console.log(chalk.yellow('\n  No Ollama instance found automatically.'));

    while (!selectedHost) {
      const customHost = await prompt(rl, chalk.white('  Enter Ollama URL (e.g., http://192.168.1.100:11434): '));

      if (!customHost) {
        console.log(chalk.red('  URL required. Press Ctrl+C to exit.'));
        continue;
      }

      // Normalize URL
      let normalizedHost = customHost;
      if (!normalizedHost.startsWith('http')) {
        normalizedHost = `http://${normalizedHost}`;
      }
      if (!normalizedHost.includes(':')) {
        normalizedHost = `${normalizedHost}:11434`;
      }

      process.stdout.write(chalk.gray(`  Testing ${normalizedHost}... `));
      const result = await testOllamaConnection(normalizedHost);

      if (result.ok) {
        console.log(chalk.green('✓ Connected'));
        selectedHost = normalizedHost;
        availableModels = filterOllamaModels(result.models);
      } else {
        console.log(chalk.red(`✗ Failed: ${result.error}`));
      }
    }
  }

  // Step 3: Select model (Ollama-only)
  console.log(chalk.yellow('\n  Select Model (Ollama models only)\n'));

  if (availableModels.length === 0) {
    console.log(chalk.red('  No models found. Please pull a model first:'));
    console.log(chalk.gray('  ollama pull gpt-oss        # Recommended for coding'));
    console.log(chalk.gray('  ollama pull devstral       # Fast coding assistant'));
    console.log(chalk.gray('  ollama pull qwen2.5-coder  # Alternative coding model\n'));
    rl.close();
    process.exit(1);
  }

  // Display available models with coding indicators
  console.log(chalk.white('  Available Ollama models:\n'));
  availableModels.forEach((model, index) => {
    const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(1);
    const name = model.name.toLowerCase();

    // Mark coding-focused models
    let marker = '';
    if (name.includes('gpt-oss')) {
      marker = chalk.green(' (recommended)');
    } else if (name.includes('devstral') || name.includes('coder') || name.includes('codellama')) {
      marker = chalk.blue(' (coding)');
    }

    console.log(chalk.white(`  ${index + 1}. ${model.name}`) + chalk.gray(` (${sizeGB}GB)`) + marker);
  });

  console.log();

  // Find default selection (prefer gpt-oss, then devstral, then any coder model)
  let defaultIndex = availableModels.findIndex(m => m.name.toLowerCase().includes('gpt-oss'));
  if (defaultIndex < 0) {
    defaultIndex = availableModels.findIndex(m => m.name.toLowerCase().includes('devstral'));
  }
  if (defaultIndex < 0) {
    defaultIndex = availableModels.findIndex(m => m.name.toLowerCase().includes('coder'));
  }
  if (defaultIndex < 0) {
    defaultIndex = 0;
  }

  const defaultPrompt = ` [${defaultIndex + 1}]`;

  let selectedModel = '';
  while (!selectedModel) {
    const selection = await prompt(rl, chalk.white(`  Select model (1-${availableModels.length})${defaultPrompt}: `));

    // Use default if empty
    if (!selection) {
      selectedModel = availableModels[defaultIndex].name;
      break;
    }

    const index = parseInt(selection, 10) - 1;
    if (index >= 0 && index < availableModels.length) {
      selectedModel = availableModels[index].name;
    } else {
      console.log(chalk.red(`  Invalid selection. Enter 1-${availableModels.length}`));
    }
  }

  // Strip :latest suffix for cleaner display
  const displayModel = selectedModel.endsWith(':latest')
    ? selectedModel.replace(':latest', '')
    : selectedModel;

  console.log(chalk.green(`\n  ✓ Selected: ${displayModel}`));

  if (apiEndpoint) {
    console.log(chalk.green(`  ✓ AgenticWork API: ${apiEndpoint}`));
  }

  console.log();

  rl.close();

  // CRITICAL: Resume stdin after readline closes it
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }

  return {
    ollamaHost: selectedHost,
    model: selectedModel,
    skipSetup: false,
    apiEndpoint,
    apiConnected: !!apiEndpoint,
  };
}
