/**
 * AWCode Ink CLI Entry Point
 * Renders the React Ink application
 *
 * Supports two modes:
 * - Direct Ollama: Local LLM without authentication
 * - Authenticated: Uses AgenticWork API with full platform features
 *
 * Terminal-specific fixes:
 * - Ghostty: Uses random progress values to prevent timeout hiding
 * - General: Disables console patching to prevent ghost rendering
 */

import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { ChatSession, SessionClientConfig } from '../core/session.js';
import { createDefaultRegistry } from '../tools/index.js';
import { resolveModelPreset } from '../core/config.js';
import type { SessionConfig } from '../core/types.js';
import { AuthClient, createAuthClientFromEnv } from '../core/auth-client.js';
import { detectMode, hasAuth } from '../core/mode.js';
import type { LocalSession } from '../core/local-persistence.js';

// Terminal detection for specific rendering workarounds
interface TerminalInfo {
  name: string;
  isGhostty: boolean;
  isWindowsTerminal: boolean;
  isITerm: boolean;
  supportsProgressBar: boolean;
}

function detectTerminal(): TerminalInfo {
  const termProgram = process.env.TERM_PROGRAM || '';
  const termProgramVersion = process.env.TERM_PROGRAM_VERSION || '';
  const wtSession = process.env.WT_SESSION || '';
  const ghosttyVersion = process.env.GHOSTTY_RESOURCES_DIR || '';

  return {
    name: termProgram || 'unknown',
    isGhostty: !!ghosttyVersion || termProgram.toLowerCase().includes('ghostty'),
    isWindowsTerminal: !!wtSession,
    isITerm: termProgram === 'iTerm.app',
    supportsProgressBar: !!ghosttyVersion || !!wtSession || termProgram === 'iTerm.app',
  };
}

export interface InkCLIConfig {
  apiEndpoint?: string;  // AgenticWork API endpoint for authenticated mode
  apiKey?: string;       // Auth token for authenticated mode
  model: string;
  workingDirectory: string;
  ollamaHost: string;    // Ollama endpoint for direct mode
  initialPrompt?: string;
  yoloMode?: boolean;
  systemPrompt?: string; // Custom system prompt
  /** Use alternate screen buffer for ghosting-free rendering (default: false for backward compat) */
  useAlternateBuffer?: boolean;
  /** Provider mode: 'api' (AgenticWork), 'ollama' (direct), 'auto' (detect) */
  providerMode?: 'api' | 'ollama' | 'auto';
  /** Resume a previous local session */
  resumeSession?: LocalSession | null;
}

export async function runInkCLI(config: InkCLIConfig): Promise<void> {
  // Detect operating mode
  const modeConfig = detectMode();

  // Try to initialize auth client if credentials are available
  let authClient: AuthClient | undefined;

  if (hasAuth(modeConfig) || config.apiKey) {
    try {
      authClient = new AuthClient({
        apiEndpoint: config.apiEndpoint || modeConfig.apiEndpoint,
        authToken: config.apiKey || modeConfig.authToken,
        userId: modeConfig.userId,
        tenantId: modeConfig.tenantId,
      });

      // Initialize auth (validates token, loads models)
      await authClient.init();

      console.log(`[AgentiCode] Authenticated as ${authClient.getState().userEmail || 'user'}`);
    } catch (err) {
      // Auth failed - continue in direct Ollama mode
      console.warn(`[AgentiCode] Auth failed, using direct Ollama mode: ${err instanceof Error ? err.message : err}`);
      authClient = undefined;
    }
  }

  // Resolve model - prefer auth client's default if authenticated
  const resolvedModel = authClient?.getDefaultModel() || resolveModelPreset(config.model);

  const registry = createDefaultRegistry();

  // Register MCP tools from platform if authenticated
  // Adapt SDK Tool format to agenticode ToolDefinition format
  if (authClient) {
    const sdkTools = authClient.getMCPTools();
    if (sdkTools.length > 0) {
      // Adapt SDK tools to local ToolDefinition format
      for (const sdkTool of sdkTools) {
        registry.register({
          name: sdkTool.name,
          description: sdkTool.description,
          // Cast SDK schema to local JsonSchema type (any cast needed due to type differences)
          inputSchema: (sdkTool.inputSchema || { type: 'object', properties: {} }) as any,
          // Wrap SDK execute method in handler signature
          handler: async (args, context) => {
            try {
              const result = await sdkTool.execute(args, {
                workingDirectory: context.workingDirectory,
                signal: context.signal,
              });
              return {
                content: typeof result === 'string' ? result : JSON.stringify(result),
                isError: false,
              };
            } catch (err) {
              return {
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                isError: true,
              };
            }
          },
        });
      }
      console.log(`[AgentiCode] Loaded ${sdkTools.length} MCP tools from platform`);
    }
  }

  const sessionConfig: SessionConfig & { workingDirectory: string } = {
    model: resolvedModel,
    workingDirectory: config.workingDirectory,
    systemPrompt: config.systemPrompt,
  };

  // Configure client based on mode
  // Priority: explicit providerMode > API credentials > auto-detect
  const hasApiCredentials = !!(config.apiKey || modeConfig.authToken) &&
                            !!(config.apiEndpoint || modeConfig.apiEndpoint);

  const clientConfig: SessionClientConfig = {
    providerMode: config.providerMode || (hasApiCredentials ? 'api' : 'ollama'),
    ollamaEndpoint: config.ollamaHost,
    apiEndpoint: config.apiEndpoint || modeConfig.apiEndpoint,
    apiKey: config.apiKey || modeConfig.authToken,
    userId: modeConfig.userId,
    tenantId: modeConfig.tenantId,
    enablePersistence: hasApiCredentials,
  };

  // Create session
  const session = new ChatSession(null as any, registry, sessionConfig, clientConfig);

  // Load startup context from previous sessions (async, don't block)
  session.loadStartupContext().catch((err) => {
    console.error('[InkCLI] Failed to load startup context:', err);
  });

  // Detect terminal for specific rendering workarounds
  const terminal = detectTerminal();

  if (process.env.AWCODE_DEBUG) {
    console.error(`[InkCLI] Terminal detected: ${terminal.name}, Ghostty: ${terminal.isGhostty}`);
  }

  // Render the Ink app with terminal-specific options
  // Following open-codex pattern: patchConsole enabled by default
  const { waitUntilExit } = render(
    <App
      session={session}
      model={resolvedModel}
      workingDirectory={config.workingDirectory}
      initialPrompt={config.initialPrompt}
      yoloMode={config.yoloMode}
      authClient={authClient}
      resumeSession={config.resumeSession}
    />,
    {
      // Enable console patching (like open-codex) - prevents console.log from breaking UI
      patchConsole: process.env.DEBUG ? false : true,
      // Exit on Ctrl+C - App handles this
      exitOnCtrlC: false,
      // Debug mode - useful for diagnosing rendering issues
      debug: process.env.AWCODE_INK_DEBUG === '1',
    }
  );

  await waitUntilExit();
}
