/**
 * NDJSON CLI Runner
 *
 * Runs the agenticode session in NDJSON streaming mode for integration
 * with web UIs like AgenticWork's Code Mode.
 *
 * Usage:
 *   agenticode --output-format stream-json --input-format stream-json
 *
 * Input (stdin): NDJSON messages
 *   {"type":"human","content":"Write hello world in Go"}
 *
 * Output (stdout): NDJSON events
 *   {"type":"system","subtype":"init","tools":["Read","Write","Bash"]}
 *   {"type":"assistant","subtype":"text","text":"I'll help you..."}
 *   {"type":"assistant","subtype":"tool_use","id":"1","name":"Write","input":{...}}
 *   {"type":"user","subtype":"tool_result","tool_use_id":"1","content":"..."}
 *   {"type":"result","subtype":"success","duration_ms":1234}
 */

import { ChatSession } from '../core/session.js';
import { createDefaultRegistry } from '../tools/index.js';
import { resolveModelPreset } from '../core/config.js';
import { NDJSONEmitter, NDJSONReader } from '../core/ndjson-stream.js';

export interface NDJSONCLIConfig {
  model: string;
  workingDirectory: string;
  ollamaHost?: string;
  yoloMode?: boolean;
  systemPrompt?: string;
  providerMode?: 'api' | 'ollama' | 'auto';
  apiEndpoint?: string;
  apiKey?: string;
  sessionId?: string;
}

/**
 * Run the CLI in NDJSON streaming mode
 */
export async function runNDJSONCLI(config: NDJSONCLIConfig): Promise<void> {
  // Resolve model preset to actual model identifier
  const resolvedModel = resolveModelPreset(config.model);

  // Create tool registry
  const registry = createDefaultRegistry();

  // Create session
  const session = new ChatSession(
    null as any, // Deprecated parameter
    registry,
    {
      model: resolvedModel,
      workingDirectory: config.workingDirectory,
      systemPrompt: config.systemPrompt,
    },
    {
      providerMode: config.providerMode,
      ollamaEndpoint: config.ollamaHost,
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
    }
  );

  // Create NDJSON emitter and reader
  const emitter = new NDJSONEmitter(config.sessionId);
  const reader = new NDJSONReader();

  // Emit init event with available tools
  const tools = registry.getDefinitions();
  emitter.emitInit(
    tools,
    resolvedModel,
    config.workingDirectory
  );

  // Keep stdin open
  process.stdin.resume();

  // Main loop: read messages from stdin, process, emit events
  while (true) {
    const input = await reader.read();
    if (input === null) {
      // Stdin closed - exit
      break;
    }

    if (input.type === 'human') {
      try {
        // Process the message through the session using chatEvents
        for await (const event of session.chatEvents(input.content)) {
          emitter.emitStreamEvent(event);
        }
        // Emit success result after processing completes
        emitter.emitResult(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitter.emitResult(false, message);
      }
    }
  }

  reader.close();
}
