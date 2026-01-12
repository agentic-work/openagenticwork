/**
 * Auto-Connect Module
 *
 * Automatically discovers and connects to AgenticWork API endpoints.
 * Supports both local development and containerized deployments.
 */

import chalk from 'chalk';

export interface AgenticWorkEndpoint {
  url: string;
  name: string;
  healthy: boolean;
  version?: string;
  ollamaUrl?: string;
}

export interface AutoConnectResult {
  connected: boolean;
  endpoint?: AgenticWorkEndpoint;
  ollamaHost?: string;
  token?: string;
  error?: string;
}

/**
 * Well-known AgenticWork API endpoints to try
 */
const WELL_KNOWN_ENDPOINTS = [
  // Local development - port 8000 is the default compose port
  { url: 'http://localhost:8000', name: 'Local Development' },
  { url: 'http://127.0.0.1:8000', name: 'Local (127.0.0.1)' },
  // Legacy port 3001
  { url: 'http://localhost:3001', name: 'Local Development (legacy)' },
  // Docker Compose
  { url: 'http://agenticwork-api:8000', name: 'Docker Compose' },
  { url: 'http://agenticwork-api:3001', name: 'Docker Compose (legacy)' },
  // Kubernetes
  { url: 'http://agenticwork-api.default.svc.cluster.local:8000', name: 'Kubernetes Default NS' },
  { url: 'http://agenticwork-api.agenticwork.svc.cluster.local:8000', name: 'Kubernetes AgenticWork NS' },
  // Environment-specified
];

/**
 * Well-known Ollama endpoints to try
 */
const WELL_KNOWN_OLLAMA = [
  'http://localhost:11434',
  'http://127.0.0.1:11434',
  'http://ollama:11434',
  'http://agenticwork-ollama:11434',
  'http://ollama.default.svc.cluster.local:11434',
];

/**
 * Test if an AgenticWork API endpoint is healthy
 */
async function testEndpoint(url: string): Promise<{ healthy: boolean; version?: string; ollamaUrl?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { healthy: false };
    }

    const data = await response.json() as {
      status?: string;
      version?: string;
      services?: { ollama?: { url?: string } };
    };

    return {
      healthy: data.status === 'ok' || response.ok,
      version: data.version,
      ollamaUrl: data.services?.ollama?.url,
    };
  } catch {
    return { healthy: false };
  }
}

/**
 * Test if an Ollama endpoint is healthy and get available models
 */
async function testOllama(url: string): Promise<{ healthy: boolean; models: string[] }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${url}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { healthy: false, models: [] };
    }

    const data = await response.json() as { models?: Array<{ name: string }> };
    return {
      healthy: true,
      models: data.models?.map(m => m.name) || [],
    };
  } catch {
    return { healthy: false, models: [] };
  }
}

/**
 * Discover AgenticWork API endpoint
 */
export async function discoverApiEndpoint(verbose: boolean = false): Promise<AgenticWorkEndpoint | null> {
  // Check environment first
  const envEndpoint = process.env.AGENTICWORK_API_ENDPOINT ||
                      process.env.AGENTICWORK_API_URL ||
                      process.env.AWCODE_API_ENDPOINT;

  if (envEndpoint) {
    if (verbose) {
      process.stdout.write(chalk.gray(`  Checking ${envEndpoint} (from env)... `));
    }
    const result = await testEndpoint(envEndpoint);
    if (result.healthy) {
      if (verbose) console.log(chalk.green('✓'));
      return {
        url: envEndpoint,
        name: 'Environment Config',
        healthy: true,
        version: result.version,
        ollamaUrl: result.ollamaUrl,
      };
    }
    if (verbose) console.log(chalk.red('✗'));
  }

  // Try well-known endpoints
  for (const endpoint of WELL_KNOWN_ENDPOINTS) {
    if (verbose) {
      process.stdout.write(chalk.gray(`  Checking ${endpoint.url}... `));
    }
    const result = await testEndpoint(endpoint.url);
    if (result.healthy) {
      if (verbose) console.log(chalk.green('✓'));
      return {
        ...endpoint,
        healthy: true,
        version: result.version,
        ollamaUrl: result.ollamaUrl,
      };
    }
    if (verbose) console.log(chalk.gray('✗'));
  }

  return null;
}

/**
 * Discover Ollama endpoint
 */
export async function discoverOllamaEndpoint(verbose: boolean = false): Promise<{ url: string; models: string[] } | null> {
  // Check environment first
  const envOllama = process.env.OLLAMA_HOST || process.env.OLLAMA_URL;

  if (envOllama) {
    if (verbose) {
      process.stdout.write(chalk.gray(`  Checking ${envOllama} (from env)... `));
    }
    const result = await testOllama(envOllama);
    if (result.healthy) {
      if (verbose) console.log(chalk.green(`✓ (${result.models.length} models)`));
      return { url: envOllama, models: result.models };
    }
    if (verbose) console.log(chalk.red('✗'));
  }

  // Try well-known endpoints
  for (const url of WELL_KNOWN_OLLAMA) {
    if (verbose) {
      process.stdout.write(chalk.gray(`  Checking ${url}... `));
    }
    const result = await testOllama(url);
    if (result.healthy) {
      if (verbose) console.log(chalk.green(`✓ (${result.models.length} models)`));
      return { url, models: result.models };
    }
    if (verbose) console.log(chalk.gray('✗'));
  }

  return null;
}

/**
 * Get authentication token from environment or stored config
 */
function getAuthToken(): string | undefined {
  return process.env.AGENTICODE_AUTH_TOKEN ||
         process.env.AGENTICWORK_API_TOKEN ||
         process.env.AWCODE_API_KEY;
}

/**
 * Fetch Ollama-only models from AgenticWork API
 * Returns only models where provider is 'ollama' or similar
 */
export async function fetchOllamaModels(apiUrl: string, token?: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${apiUrl}/api/models`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json() as {
      models: Array<{ id: string; provider?: string; name?: string }>;
    };

    // Filter to only Ollama models
    const ollamaModels = data.models
      .filter(m => {
        const provider = (m.provider || '').toLowerCase();
        const id = (m.id || '').toLowerCase();
        return provider.includes('ollama') ||
               id.startsWith('ollama/') ||
               // Common Ollama model patterns
               id.includes('llama') ||
               id.includes('mistral') ||
               id.includes('devstral') ||
               id.includes('qwen') ||
               id.includes('deepseek') ||
               id.includes('codellama') ||
               id.includes('phi') ||
               id.includes('gemma') ||
               id.includes('gpt-oss');
      })
      .map(m => m.id);

    return ollamaModels;
  } catch {
    return [];
  }
}

/**
 * Auto-connect to AgenticWork platform
 * Discovers endpoints, validates connectivity, and returns connection info
 */
export async function autoConnect(options: {
  verbose?: boolean;
  ollamaOnly?: boolean;
} = {}): Promise<AutoConnectResult> {
  const { verbose = false, ollamaOnly = true } = options;

  if (verbose) {
    console.log(chalk.cyan('\n  Auto-connecting to AgenticWork...\n'));
  }

  // Step 1: Discover AgenticWork API
  if (verbose) {
    console.log(chalk.yellow('  Step 1: Discovering AgenticWork API'));
  }
  const apiEndpoint = await discoverApiEndpoint(verbose);

  // Step 2: Discover Ollama
  if (verbose) {
    console.log(chalk.yellow('\n  Step 2: Discovering Ollama'));
  }

  // Use Ollama URL from API if available, otherwise discover
  let ollamaResult: { url: string; models: string[] } | null = null;
  if (apiEndpoint?.ollamaUrl) {
    const result = await testOllama(apiEndpoint.ollamaUrl);
    if (result.healthy) {
      ollamaResult = { url: apiEndpoint.ollamaUrl, models: result.models };
      if (verbose) {
        console.log(chalk.green(`  Using Ollama from API config: ${apiEndpoint.ollamaUrl}`));
      }
    }
  }

  if (!ollamaResult) {
    ollamaResult = await discoverOllamaEndpoint(verbose);
  }

  // Step 3: Get auth token
  const token = getAuthToken();

  // Determine connection status
  if (apiEndpoint) {
    if (verbose) {
      console.log(chalk.green(`\n  ✓ Connected to AgenticWork API: ${apiEndpoint.url}`));
      if (apiEndpoint.version) {
        console.log(chalk.gray(`    Version: ${apiEndpoint.version}`));
      }
    }

    return {
      connected: true,
      endpoint: apiEndpoint,
      ollamaHost: ollamaResult?.url,
      token,
    };
  }

  if (ollamaResult) {
    if (verbose) {
      console.log(chalk.yellow(`\n  ⚠ AgenticWork API not found, using standalone Ollama`));
      console.log(chalk.green(`  ✓ Connected to Ollama: ${ollamaResult.url}`));
      console.log(chalk.gray(`    Available models: ${ollamaResult.models.join(', ')}`));
    }

    return {
      connected: false,
      ollamaHost: ollamaResult.url,
      error: 'AgenticWork API not available, using standalone Ollama',
    };
  }

  // No connections available
  return {
    connected: false,
    error: 'No AgenticWork API or Ollama endpoints found',
  };
}

/**
 * Check if we should use Ollama-only mode
 * Returns true if environment specifies Ollama-only or if API is not available
 */
export function isOllamaOnlyMode(): boolean {
  return process.env.AGENTICODE_OLLAMA_ONLY === 'true' ||
         process.env.AWCODE_OLLAMA_ONLY === 'true' ||
         !process.env.AGENTICWORK_API_ENDPOINT;
}
