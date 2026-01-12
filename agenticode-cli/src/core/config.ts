/**
 * AWCode Configuration
 * Loads configuration from environment, files, and AgenticWork API
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// Model presets are loaded dynamically from AgenticWork API
// No hardcoded models - everything comes from admin configuration
let cachedModelPresets: Record<string, string> = {};
let cachedAvailableModels: Array<{ name: string; model: string; description: string }> = [];

/**
 * Check if Ollama is available
 */
export async function checkOllamaAvailable(host: string = 'http://localhost:11434'): Promise<boolean> {
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get available Ollama models
 */
export async function getOllamaModels(host: string = 'http://localhost:11434'): Promise<string[]> {
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return [];
    const data = await response.json() as { models?: Array<{ name: string }> };
    return data.models?.map(m => `ollama/${m.name}`) || [];
  } catch {
    return [];
  }
}

// Configuration schema
const ConfigSchema = z.object({
  // API Configuration
  apiEndpoint: z.string().default('http://localhost:3001'),
  apiKey: z.string().optional(),

  // Model Configuration - resolved dynamically from AgenticWork API
  // Use preset names (default, auto, local, fast, pro) or full model identifiers
  model: z.string().default('auto'),  // 'auto' will be resolved from API
  temperature: z.number().min(0).max(2).optional(),  // Let API decide if not set
  maxTokens: z.number().positive().optional(),       // Let API decide if not set

  // Session Configuration
  maxHistoryLength: z.number().positive().default(100),
  maxTurns: z.number().positive().default(20),

  // Feature Flags (controlled by AgenticWork admin portal)
  features: z.object({
    shellEnabled: z.boolean().default(true),
    fileWriteEnabled: z.boolean().default(true),
    webSearchEnabled: z.boolean().default(false),
    mcpEnabled: z.boolean().default(true),
    codeExecutionEnabled: z.boolean().default(false),
  }).default({}),

  // MCP Configuration
  mcpServers: z.array(z.object({
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })).default([]),

  // Telemetry (exports to AgenticWork's observability stack)
  telemetry: z.object({
    enabled: z.boolean().default(true),
    endpoint: z.string().optional(),  // OTLP endpoint
  }).default({}),

  // UI Configuration
  ui: z.object({
    theme: z.enum(['dark', 'light', 'auto']).default('auto'),
    showTokenUsage: z.boolean().default(true),
    streamOutput: z.boolean().default(true),
  }).default({}),
});

export type AWCodeConfig = z.infer<typeof ConfigSchema>;

/**
 * Load configuration from multiple sources
 * Priority: Environment > Config file > AgenticWork API > Defaults
 */
export async function loadConfig(workingDirectory: string): Promise<AWCodeConfig> {
  let config: Partial<AWCodeConfig> = {};

  // 1. Load from AgenticWork API (if available)
  const apiConfig = await loadFromAPI();
  if (apiConfig) {
    config = { ...config, ...apiConfig };
  }

  // 2. Load from config file in workspace
  const fileConfig = loadFromFile(workingDirectory);
  if (fileConfig) {
    config = { ...config, ...fileConfig };
  }

  // 3. Load from environment variables
  const envConfig = loadFromEnv();
  config = { ...config, ...envConfig };

  // 4. Fetch available models from API (populates presets cache)
  const endpoint = config.apiEndpoint || process.env.AGENTIC_API_ENDPOINT;
  await fetchAvailableModels(endpoint);

  // Validate and return with defaults
  return ConfigSchema.parse(config);
}

/**
 * Load configuration from AgenticWork API
 */
async function loadFromAPI(): Promise<Partial<AWCodeConfig> | null> {
  const endpoint = process.env.AGENTICWORK_API_ENDPOINT;
  const token = process.env.AGENTICWORK_API_TOKEN;

  if (!endpoint || !token) {
    return null;
  }

  try {
    const response = await fetch(`${endpoint}/api/awcode/config`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as Partial<AWCodeConfig>;
  } catch {
    return null;
  }
}

/**
 * Load configuration from file
 */
function loadFromFile(workingDirectory: string): Partial<AWCodeConfig> | null {
  const configPaths = [
    join(workingDirectory, '.awcode.json'),
    join(workingDirectory, '.awcode/config.json'),
    join(process.env.HOME || '', '.awcode/config.json'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        // Skip invalid config files
      }
    }
  }

  return null;
}

/**
 * Load configuration from environment variables
 */
function loadFromEnv(): Partial<AWCodeConfig> {
  const config: Partial<AWCodeConfig> = {};

  if (process.env.AWCODE_API_ENDPOINT) {
    config.apiEndpoint = process.env.AWCODE_API_ENDPOINT;
  }

  if (process.env.AWCODE_API_KEY) {
    config.apiKey = process.env.AWCODE_API_KEY;
  }

  if (process.env.AWCODE_MODEL) {
    config.model = process.env.AWCODE_MODEL;
  }

  if (process.env.AWCODE_MAX_TOKENS) {
    config.maxTokens = parseInt(process.env.AWCODE_MAX_TOKENS, 10);
  }

  if (process.env.AWCODE_TEMPERATURE) {
    config.temperature = parseFloat(process.env.AWCODE_TEMPERATURE);
  }

  // Feature flags from environment
  const features: Partial<typeof config.features> = {};

  if (process.env.AWCODE_SHELL_ENABLED !== undefined) {
    features.shellEnabled = process.env.AWCODE_SHELL_ENABLED === 'true';
  }

  if (process.env.AWCODE_FILE_WRITE_ENABLED !== undefined) {
    features.fileWriteEnabled = process.env.AWCODE_FILE_WRITE_ENABLED === 'true';
  }

  if (process.env.AWCODE_MCP_ENABLED !== undefined) {
    features.mcpEnabled = process.env.AWCODE_MCP_ENABLED === 'true';
  }

  if (Object.keys(features).length > 0) {
    config.features = { ...config.features, ...features } as AWCodeConfig['features'];
  }

  return config;
}

/**
 * Get default config for testing
 */
export function getDefaultConfig(): AWCodeConfig {
  return ConfigSchema.parse({});
}

/**
 * Fetch available models from AgenticWork API
 * Models are configured in admin portal, not hardcoded
 */
export async function fetchAvailableModels(apiEndpoint?: string): Promise<void> {
  const endpoint = apiEndpoint || process.env.AGENTIC_API_ENDPOINT;
  const token = process.env.AGENTIC_API_KEY;

  // If no API endpoint configured, skip API fetch entirely and use local discovery
  if (!endpoint) {
    await discoverLocalModels();
    return;
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Fetch models from AgenticWork API (same as chat app uses)
    // Use a short timeout to not block startup
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${endpoint}/api/models`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      // Silently fall back to local discovery
      await discoverLocalModels();
      return;
    }

    const data = await response.json() as {
      models: Array<{
        id: string;
        name: string;
        description?: string;
        provider?: string;
      }>;
      presets?: Record<string, string>;
    };

    // Cache the models
    cachedAvailableModels = data.models.map(m => ({
      name: m.name || m.id,
      model: m.id,
      description: m.description || `${m.provider || 'Unknown'} model`,
    }));

    // Cache presets if provided
    if (data.presets) {
      cachedModelPresets = data.presets;
    }

    // Also discover local Ollama models and merge
    await discoverLocalModels();

  } catch {
    // Silently fall back to local Ollama discovery - don't log scary errors
    await discoverLocalModels();
  }
}

/**
 * Discover locally available Ollama models
 */
async function discoverLocalModels(): Promise<void> {
  const ollamaModels = await getOllamaModels();

  for (const model of ollamaModels) {
    // Add if not already in list
    if (!cachedAvailableModels.find(m => m.model === model)) {
      const shortName = model.replace('ollama/', '');
      cachedAvailableModels.push({
        name: shortName,
        model: model,
        description: `Local Ollama model`,
      });
    }
  }

  // Set default preset to first available local model if not set
  if (!cachedModelPresets['default'] && ollamaModels.length > 0) {
    cachedModelPresets['default'] = ollamaModels[0];
    cachedModelPresets['auto'] = ollamaModels[0];
    cachedModelPresets['local'] = ollamaModels[0];
  }
}

/**
 * Resolve model preset to actual model identifier
 * Presets come from AgenticWork admin configuration
 */
export function resolveModelPreset(model: string): string {
  // Check if it's a preset name from admin config
  const preset = cachedModelPresets[model];
  if (preset) {
    return preset;
  }
  // Return as-is if it's already a model identifier
  return model;
}

/**
 * Get list of available models (from API + local discovery)
 */
export function getAvailableModels(): { name: string; model: string; description: string }[] {
  return cachedAvailableModels;
}

/**
 * Get model presets (from admin configuration)
 */
export function getModelPresets(): Record<string, string> {
  return { ...cachedModelPresets };
}
