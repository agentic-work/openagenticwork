/**
 * Chat Session
 * Manages a conversation with tool execution
 * Supports both direct Ollama and AgenticWork API backends
 * Includes context management, thinking states, and MCP proxy integration
 */

import type {
  Message,
  ToolCall,
  ToolResult,
  ToolContext,
  ToolOutput,
  StreamChunk,
  StreamEvent,
  SessionConfig,
  McpServerConfig,
} from './types.js';
import { containsXMLToolCalls, parseXMLToolCalls, unwrapToolArguments } from './xml-tool-parser.js';
import { AWCodeClient } from './client.js';
import { OllamaClient } from './ollama-client.js';
import { APIClient, createAPIClient } from './api-client.js';
import { ToolRegistry } from '../tools/registry.js';
import { MCPClient } from '../mcp/client.js';
import { MCPProxyClient, createMCPProxyClient } from '../mcp/proxy-client.js';
import { ContextManager, ContextStats, ContextEvent } from './context-manager.js';
import { PersistenceClient, createPersistenceClient, ContextMemory, SessionSummary } from './persistence.js';
import { SkillManager, createSkillManager, Skill } from '../skills/index.js';

// Type for the LLM client interface (both clients implement this)
interface LLMClient {
  chatStream(
    request: { model: string; messages: Message[]; tools?: any[]; stream?: boolean; temperature?: number; maxTokens?: number },
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk>;
}

// Session state events for UI updates
export type SessionStateType =
  | 'idle'
  | 'thinking'
  | 'planning'
  | 'streaming'
  | 'tool_calling'
  | 'tool_executing'
  | 'summarizing';

export interface SessionStateEvent {
  state: SessionStateType;
  message?: string;
  tool?: string;
  progress?: number;
}

export type SessionStateHandler = (event: SessionStateEvent) => void;

const DEFAULT_SYSTEM_PROMPT = `You are AgentiCode, an AI coding assistant. You are capable, thorough, and NEVER give up.

## TASK MANAGEMENT - CRITICAL

For ANY task requiring 2+ steps, you MUST use the todo_write tool to:
1. Create a task list BEFORE starting work
2. Mark tasks as "in_progress" when you start them
3. Mark tasks as "completed" when done
4. Keep exactly ONE task as "in_progress" at a time

Example:
User: "Fix the failing tests"
You: "I'll diagnose and fix the failing tests. Let me create a task list."
[call todo_write with: {todos: [{content: "Run tests to see errors", status: "in_progress"}, {content: "Identify root cause", status: "pending"}, {content: "Implement fix", status: "pending"}, {content: "Verify tests pass", status: "pending"}]}]

## COMPLETION REQUIREMENT - NEVER GIVE UP

You MUST complete tasks fully. Do NOT:
- Give up when encountering errors - try another approach
- Say "this would require" without actually doing it
- Provide partial solutions or summaries of what COULD be done
- Stop before the task is verified complete

If your first approach fails, try another. Keep going until done.

## MANDATORY OUTPUT FORMAT

You MUST output text explaining your plan BEFORE calling any tools.

Example correct response:
"I'll create a Flask app. Let me write the main file first."
[then call write tool]
"File created. Now the requirements file."
[then call write tool]

## Response Rules
1. START every response with 1-2 sentences explaining what you will do
2. EXPLAIN each tool call before making it
3. After completing ALL tasks, provide a clear SUMMARY

## CRITICAL: Tool Calling Format
USE NATIVE TOOL CALLING ONLY. DO NOT generate XML in your response text.

When calling tools, parameters MUST be direct key-value pairs:
- CORRECT: {"path": "app.py", "content": "print('hello')"}
- WRONG: {"value": {"path": "app.py", "content": "..."}}

## File Paths
Always use RELATIVE paths (e.g., "src/main.py", "app.py").

## Available Tools
- read_file, write_file, edit_file - File operations
- shell - Run shell commands
- glob, grep - Search files
- todo_write, todo_read - Task tracking (USE THESE!)
- web_search, web_fetch - Web operations`;

export interface SessionState {
  messages: Message[];
  model: string;
  systemPrompt: string;
}

export interface SessionClientConfig {
  // Provider mode: 'api' uses AgenticWork API, 'ollama' uses direct Ollama, 'auto' detects
  providerMode?: 'api' | 'ollama' | 'auto';
  apiEndpoint?: string;     // AgenticWork API endpoint (for 'api' mode)
  apiKey?: string;          // AgenticWork API key (for 'api' mode)
  ollamaEndpoint?: string;  // Ollama endpoint (for 'ollama' mode), defaults to http://localhost:11434
  mcpProxyUrl?: string;     // MCP proxy URL for remote tools
  oboToken?: string;        // On-behalf-of token for user-specific access
  userId?: string;          // User ID for persistence
  tenantId?: string;        // Tenant ID for persistence
  enablePersistence?: boolean; // Enable session persistence (default: true when API available)
}

// Provider mode detection
export type ProviderMode = 'api' | 'ollama';

// Default settings
const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.AGENTICODE_MODEL || 'gpt-oss';

export class ChatSession {
  private client: LLMClient;
  private ollamaClient: OllamaClient | null = null;
  private apiClient: APIClient | null = null;
  private providerMode: ProviderMode = 'ollama';
  private clientConfig: SessionClientConfig;
  private registry: ToolRegistry;
  private mcpClient: MCPClient;
  private mcpProxyClient: MCPProxyClient | null = null;
  private persistenceClient: PersistenceClient | null = null;
  private contextManager: ContextManager;
  private skillManager: SkillManager;  // Agent Skills manager
  private isCompacting: boolean = false;  // Prevents recursive auto-compaction
  private state: SessionState;
  private workingDirectory: string;
  private abortController: AbortController | null = null;
  private stateHandlers: SessionStateHandler[] = [];
  private currentState: SessionStateType = 'idle';
  private loadedContext: string = ''; // Context loaded from previous sessions

  constructor(
    _client: AWCodeClient, // DEPRECATED - kept for API compatibility
    registry: ToolRegistry,
    config: SessionConfig & { workingDirectory: string },
    clientConfig?: SessionClientConfig
  ) {
    this.clientConfig = clientConfig || {};
    this.registry = registry;
    this.mcpClient = new MCPClient();
    this.workingDirectory = config.workingDirectory;

    // Determine provider mode
    this.providerMode = this.detectProviderMode(clientConfig);

    // Determine effective model
    const effectiveModel = config.model === 'auto' ? DEFAULT_MODEL : config.model;

    this.state = {
      messages: [],
      model: effectiveModel,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    };

    // Initialize context manager
    this.contextManager = new ContextManager(effectiveModel);

    // Initialize skills manager and load workspace skills
    this.skillManager = createSkillManager();
    this.skillManager.loadWorkspaceSkills(this.workingDirectory);

    // Subscribe to context events - auto-compact when approaching limit
    this.contextManager.onEvent(async (event) => {
      if (event.type === 'approaching_limit' && !this.isCompacting) {
        // Auto-compact when context usage exceeds threshold
        this.emitState({ state: 'summarizing', message: 'Auto-compacting conversation history...' });
        try {
          this.isCompacting = true;
          await this.compactContext();
          this.emitState({ state: 'idle', message: 'Context compacted successfully' });
        } catch (error) {
          console.error('[Session] Auto-compaction failed:', error);
        } finally {
          this.isCompacting = false;
        }
      }
    });

    // Initialize the appropriate LLM client based on provider mode
    if (this.providerMode === 'api' && clientConfig?.apiEndpoint && clientConfig?.apiKey) {
      // Use AgenticWork API - access platform's configured LLM providers
      this.apiClient = new APIClient({
        apiEndpoint: clientConfig.apiEndpoint,
        apiKey: clientConfig.apiKey,
      });
      this.client = this.apiClient;

      if (process.env.AWCODE_DEBUG) {
        console.error(`[Session] Using AgenticWork API at ${clientConfig.apiEndpoint}`);
      }
    } else {
      // Use direct Ollama - standalone mode
      const ollamaHost = clientConfig?.ollamaEndpoint || DEFAULT_OLLAMA_HOST;
      this.ollamaClient = new OllamaClient({ baseUrl: ollamaHost });
      this.client = this.ollamaClient;

      if (process.env.AWCODE_DEBUG) {
        console.error(`[Session] Using direct Ollama at ${ollamaHost} with model: ${effectiveModel}`);
      }
    }

    // Connect to MCP servers if configured
    if (config.mcpServers) {
      this.initMCP(config.mcpServers);
    }

    // Connect to MCP proxy if configured
    if (clientConfig?.mcpProxyUrl) {
      this.initMCPProxy(clientConfig.mcpProxyUrl, clientConfig.oboToken);
    }

    // Initialize persistence client for context loading (optional)
    if (clientConfig?.enablePersistence !== false && clientConfig?.apiEndpoint) {
      this.persistenceClient = createPersistenceClient(clientConfig.apiEndpoint);
    }
  }

  /**
   * Detect which provider mode to use based on configuration
   */
  private detectProviderMode(clientConfig?: SessionClientConfig): ProviderMode {
    // Explicit mode takes priority
    if (clientConfig?.providerMode === 'api') {
      return 'api';
    }
    if (clientConfig?.providerMode === 'ollama') {
      return 'ollama';
    }

    // Auto-detect: prefer API if credentials are available
    if (clientConfig?.apiEndpoint && clientConfig?.apiKey) {
      return 'api';
    }

    // Check environment variables
    const envApiEndpoint = process.env.AGENTICWORK_API_ENDPOINT || process.env.AGENTICWORK_API_URL;
    const envApiKey = process.env.AGENTICODE_API_KEY || process.env.AGENTICWORK_API_KEY;
    if (envApiEndpoint && envApiKey) {
      return 'api';
    }

    // Default to Ollama
    return 'ollama';
  }

  /**
   * Get the current provider mode
   */
  getProviderMode(): ProviderMode {
    return this.providerMode;
  }

  /**
   * Get provider info for display
   */
  getProviderInfo(): { mode: ProviderMode; endpoint: string; connected: boolean } {
    if (this.providerMode === 'api' && this.apiClient) {
      return {
        mode: 'api',
        endpoint: this.clientConfig.apiEndpoint || 'AgenticWork API',
        connected: this.apiClient.isConnected(),
      };
    }
    return {
      mode: 'ollama',
      endpoint: this.clientConfig.ollamaEndpoint || DEFAULT_OLLAMA_HOST,
      connected: true, // Ollama doesn't have a connect step
    };
  }

  /**
   * Load context from previous sessions on startup
   * This should be called after construction to async load memories/summaries
   */
  async loadStartupContext(): Promise<void> {
    if (!this.persistenceClient || !this.clientConfig.userId || !this.clientConfig.tenantId) {
      return;
    }

    try {
      const contextParts: string[] = [];

      // 1. Search for relevant memories from Milvus
      // Start with a general query about the working directory/project
      const projectName = this.workingDirectory.split('/').pop() || 'project';
      const memories = await this.persistenceClient.searchMemories({
        userId: this.clientConfig.userId,
        tenantId: this.clientConfig.tenantId,
        query: `${projectName} coding development context`,
        types: ['fact', 'preference', 'project', 'code_pattern'],
        limit: 10,
        minScore: 0.5,
      });

      if (memories.length > 0) {
        contextParts.push('## Relevant Context from Previous Sessions\n');
        for (const memory of memories) {
          contextParts.push(`- [${memory.type}] ${memory.content}`);
        }
      }

      // 2. Get recent session summaries for this user
      const recentSessions = await this.persistenceClient.listSessions({
        userId: this.clientConfig.userId,
        limit: 3,
      });

      if (recentSessions.sessions.length > 0) {
        const summaryParts: string[] = [];
        for (const session of recentSessions.sessions) {
          try {
            const summaries = await this.persistenceClient.getSummaries(session.id);
            if (summaries.length > 0) {
              // Take the most recent summary
              const latestSummary = summaries[summaries.length - 1];
              summaryParts.push(`- Session ${session.id.slice(0, 8)}... (${session.metadata?.gitBranch || session.workingDirectory}): ${latestSummary.content.slice(0, 200)}...`);
            }
          } catch {
            // Ignore errors fetching individual session summaries
          }
        }
        if (summaryParts.length > 0) {
          contextParts.push('\n## Recent Session Summaries\n');
          contextParts.push(...summaryParts);
        }
      }

      // 3. Get shared knowledge for the tenant
      const sharedKnowledge = await this.persistenceClient.getSharedKnowledge(this.clientConfig.tenantId, {
        types: ['fact', 'code_pattern'],
        limit: 5,
      });

      if (sharedKnowledge.length > 0) {
        contextParts.push('\n## Shared Team Knowledge\n');
        for (const knowledge of sharedKnowledge) {
          contextParts.push(`- ${knowledge.content}`);
        }
      }

      // Combine all context
      if (contextParts.length > 0) {
        this.loadedContext = contextParts.join('\n');
        console.log(`[Session] Loaded ${contextParts.length} context items from previous sessions`);
      }
    } catch (error) {
      // Don't fail startup if context loading fails
      console.warn('[Session] Failed to load startup context:', error);
    }
  }

  /**
   * Get the loaded startup context
   */
  getLoadedContext(): string {
    return this.loadedContext;
  }

  /**
   * Subscribe to session state changes
   */
  onStateChange(handler: SessionStateHandler): () => void {
    this.stateHandlers.push(handler);
    return () => {
      const idx = this.stateHandlers.indexOf(handler);
      if (idx >= 0) this.stateHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit a state change event
   */
  private emitState(event: SessionStateEvent): void {
    this.currentState = event.state;
    for (const handler of this.stateHandlers) {
      handler(event);
    }
  }

  /**
   * Get current session state
   */
  getCurrentState(): SessionStateType {
    return this.currentState;
  }

  /**
   * Get context statistics
   */
  getContextStats(): ContextStats {
    return this.contextManager.getStats(this.state.messages);
  }

  /**
   * Initialize MCP proxy connection
   */
  private async initMCPProxy(url: string, oboToken?: string): Promise<void> {
    try {
      this.mcpProxyClient = createMCPProxyClient({
        baseUrl: url,
        oboToken,
      });
      await this.mcpProxyClient.connect();

      // Register MCP proxy tools with main registry
      const proxyTools = this.mcpProxyClient.getTools();
      this.registry.registerAll(proxyTools);

      console.log(`[Session] Connected to MCP proxy with ${proxyTools.length} tools`);
    } catch (error) {
      console.warn('[Session] Failed to connect to MCP proxy:', error);
    }
  }

  /**
   * Get the appropriate client for the model
   * Returns API client or Ollama client based on provider mode
   */
  private getClientForModel(_model: string): LLMClient {
    if (this.providerMode === 'api' && this.apiClient) {
      return this.apiClient;
    }
    return this.ollamaClient!;
  }

  /**
   * Initialize MCP servers
   */
  private async initMCP(servers: McpServerConfig[]): Promise<void> {
    for (const server of servers) {
      try {
        await this.mcpClient.connect(server);
        // Register MCP tools with main registry
        const mcpTools = this.mcpClient.getTools();
        this.registry.registerAll(mcpTools);
      } catch (error) {
        console.warn(`Failed to connect to MCP server ${server.name}:`, error);
      }
    }
  }

  /**
   * Get MCP client for direct access
   */
  getMCPClient(): MCPClient {
    return this.mcpClient;
  }

  /**
   * Send a message and get streaming response with tool execution
   * Tool execution is displayed inline in the stream (agenticwork style)
   */
  async *chat(
    userMessage: string
  ): AsyncGenerator<string, void, unknown> {
    // Add user message
    this.state.messages.push({
      role: 'user',
      content: userMessage,
    });

    // Create abort controller for this request
    this.abortController = new AbortController();

    try {
      yield* this.runConversationLoop();
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Run the conversation loop with tool execution
   * Tool calls are yielded inline in agenticwork style (● ToolName, ⎿ output)
   */
  private async *runConversationLoop(): AsyncGenerator<string, void, unknown> {
    const maxIterations = 10; // Prevent infinite loops
    const maxToolCallsPerTask = 5; // Don't call tools forever for one task
    let iteration = 0;
    let totalToolCalls = 0;
    const DEBUG = !!process.env.AWCODE_DEBUG;

    if (DEBUG) console.error('[Session DEBUG] Starting conversation loop');

    while (iteration < maxIterations) {
      iteration++;
      if (DEBUG) console.error(`[Session DEBUG] Iteration ${iteration}, total tool calls so far: ${totalToolCalls}`);

      // Build messages with system prompt, loaded context, and active skills
      let systemPrompt = this.state.systemPrompt;
      if (this.loadedContext) {
        systemPrompt += `\n\n# Context from Previous Sessions\nYou have access to context from previous work sessions. Use this information when relevant to provide continuity:\n\n${this.loadedContext}`;
      }
      // Add active skill instructions
      const skillInstructions = this.skillManager.getActiveInstructions();
      if (skillInstructions) {
        systemPrompt += `\n\n${skillInstructions}`;
      }
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...this.state.messages,
      ];
      if (DEBUG) console.error(`[Session DEBUG] Message count: ${messages.length}, model: ${this.state.model}`);

      // Stream response
      let assistantContent = '';
      let toolCalls: ToolCall[] = [];
      let finishReason: string | undefined;

      const toolDefs = this.registry.getDefinitions();
      if (DEBUG) {
        console.error(`[Session DEBUG] Calling chatStream with ${toolDefs.length} tools: ${toolDefs.map(t => t.name).join(', ')}`);
        // Log messages being sent (truncated)
        for (const m of messages) {
          const contentPreview = typeof m.content === 'string' ? m.content.substring(0, 100) : JSON.stringify(m.content).substring(0, 100);
          console.error(`[Session DEBUG] Message: role=${m.role}, toolCallId=${m.toolCallId}, toolCalls=${m.toolCalls?.length || 0}, content=${contentPreview}...`);
        }
      }
      const stream = this.client.chatStream(
        {
          model: this.state.model,
          messages,
          tools: toolDefs,
          stream: true,
        },
        this.abortController?.signal
      );

      if (DEBUG) console.error(`[Session DEBUG] Stream created, iterating...`);
      let thinkingContent = '';
      for await (const chunk of stream) {
        if (DEBUG) console.error(`[Session DEBUG] Received chunk type: ${chunk.type}`);
        if (chunk.type === 'thinking' && chunk.text) {
          // Accumulate thinking - don't yield it, just track it
          // The UI will show "Thinking..." spinner during this phase
          thinkingContent += chunk.text;
        } else if (chunk.type === 'text' && chunk.text) {
          assistantContent += chunk.text;
          yield chunk.text;
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        } else if (chunk.type === 'done') {
          finishReason = chunk.finishReason;
        } else if (chunk.type === 'error') {
          console.error(`[Session] Error: ${chunk.error}`);
          throw new Error(chunk.error);
        }
      }
      // Store thinking content for potential display/logging (not yielded to stream)
      if (thinkingContent && DEBUG) {
        console.error(`[Session DEBUG] Model thinking: ${thinkingContent.substring(0, 200)}...`);
      }
      if (DEBUG) console.error(`[Session DEBUG] Stream iteration complete. Content length: ${assistantContent.length}, toolCalls: ${toolCalls.length}`);

      // FALLBACK: Check for XML tool calls in text if no native tool calls were returned
      // Some models generate XML like <invoke name="write_file">...</invoke> instead of using native tools
      if (toolCalls.length === 0 && containsXMLToolCalls(assistantContent)) {
        console.error('[Session] WARNING: Model generated XML tool calls instead of using native tools. Parsing XML fallback...');
        const { toolCalls: xmlToolCalls, cleanedText } = parseXMLToolCalls(assistantContent);

        if (xmlToolCalls.length > 0) {
          // Unwrap any wrapper patterns in the parsed arguments
          for (const tc of xmlToolCalls) {
            tc.arguments = unwrapToolArguments(tc.arguments as Record<string, unknown>);
          }

          toolCalls.push(...xmlToolCalls);
          assistantContent = cleanedText;

          console.error(`[Session] Parsed ${xmlToolCalls.length} XML tool calls: ${xmlToolCalls.map(tc => tc.name).join(', ')}`);
          if (DEBUG) {
            console.error('[Session DEBUG] XML tool calls:', JSON.stringify(xmlToolCalls, null, 2));
          }
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent,
      };
      if (toolCalls.length > 0) {
        assistantMessage.toolCalls = toolCalls;
        if (DEBUG) console.error(`[Session DEBUG] Tool calls to execute: ${JSON.stringify(toolCalls.map(tc => tc.name))}`);
      }
      this.state.messages.push(assistantMessage);

      // If no tool calls, we're done
      // Note: Only return if there are NO tool calls - execute tools even if finishReason is "stop"
      // because some providers (like Vertex AI) return "stop" even with tool calls
      if (toolCalls.length === 0) {
        if (DEBUG) console.error(`[Session DEBUG] No tool calls, returning`);
        return;
      }

      // Execute tool calls - yield output inline does
      if (DEBUG) console.error(`[Session DEBUG] Executing ${toolCalls.length} tool calls...`);
      yield '\n';

      // Execute tools and yield their output inline
      const toolResults: ToolResult[] = [];
      for (const toolCall of toolCalls) {
        // Yield tool call header (agenticwork style: ● ToolName(args))
        const argsStr = Object.entries(toolCall.arguments || {})
          .map(([k, v]) => {
            const val = typeof v === 'string' ? v : JSON.stringify(v);
            // Truncate long values
            const shortVal = val.length > 50 ? val.substring(0, 47) + '...' : val;
            return shortVal;
          })
          .join(', ');
        yield `\n● ${toolCall.name}(${argsStr})\n`;

        // No onProgress callback to avoid duplicate output
        // Tool output is shown via the ⎿ format after execution completes
        const context: ToolContext = {
          workingDirectory: this.workingDirectory,
          signal: this.abortController?.signal || new AbortController().signal,
        };

        const output = await this.registry.execute(toolCall, context);

        // Yield tool result inline (agenticwork style: ⎿ output)
        const resultLines = output.content.split('\n');
        const maxLines = 15; // Limit output display
        const displayLines = resultLines.slice(0, maxLines);
        if (resultLines.length > maxLines) {
          displayLines.push(`... (${resultLines.length - maxLines} more lines)`);
        }
        // Format: ⎿ with proper indentation for multi-line output
        const formattedOutput = displayLines.map((line, i) =>
          i === 0 ? `  ⎿  ${line}` : `     ${line}`
        ).join('\n');
        yield `${formattedOutput}\n`;

        toolResults.push({
          toolCallId: toolCall.id,
          content: output.content,
          isError: output.isError,
        });
      }

      totalToolCalls += toolCalls.length;

      // Add tool results to messages
      let consecutiveErrors = 0;
      const errorToolNames: string[] = [];
      for (const result of toolResults) {
        if (DEBUG) console.error(`[Session DEBUG] Tool result for ${result.toolCallId}: ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`);
        this.state.messages.push({
          role: 'tool',
          content: result.content,
          toolCallId: result.toolCallId,
        });

        // Track errors to detect loops
        if (result.isError) {
          consecutiveErrors++;
          const toolName = toolCalls.find(tc => tc.id === result.toolCallId)?.name || 'unknown';
          errorToolNames.push(toolName);
        }
      }

      // ERROR RECOVERY: If multiple tools failed with errors, provide explicit guidance
      // This helps the model recover from bad patterns instead of repeating the same mistakes
      if (consecutiveErrors >= 2) {
        const errorGuidance = `IMPORTANT: ${consecutiveErrors} tool calls failed in the previous turn. Please carefully check:
1. Tool parameters must be direct key-value pairs, NOT wrapped in a "value" object
2. For write_file: use {"path": "...", "content": "..."} NOT {"value": {"path": "...", "content": "..."}}
3. Read the error messages carefully before retrying
4. If a tool keeps failing, try an alternative approach

Stop and explain what went wrong before retrying.`;

        this.state.messages.push({
          role: 'user',
          content: errorGuidance,
        });

        if (DEBUG) console.error(`[Session DEBUG] Added error recovery guidance after ${consecutiveErrors} tool errors`);
      }

      // Safety: If we've done too many tool calls for this simple task,
      // add a message telling the model to summarize and stop
      if (totalToolCalls >= maxToolCallsPerTask) {
        if (DEBUG) console.error(`[Session DEBUG] Max tool calls reached (${totalToolCalls}), forcing summary`);
        this.state.messages.push({
          role: 'user',
          content: 'The task appears complete. Please provide a brief summary of what was done and stop using tools.',
        });
      }

      // Check context usage and auto-compact if needed
      this.contextManager.updateTokens(this.state.messages);
    }

    yield '\n[Maximum iterations reached]';
  }

  /**
   * Send a message and get streaming events (agenticwork style)
   * Yields structured StreamEvents for real-time UI updates
   */
  async *chatEvents(
    userMessage: string
  ): AsyncGenerator<StreamEvent, void, unknown> {
    // Add user message
    this.state.messages.push({
      role: 'user',
      content: userMessage,
    });

    // Create abort controller for this request
    this.abortController = new AbortController();

    try {
      yield* this.runEventLoop();
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Run the conversation loop yielding StreamEvents
   * This provides real-time updates for tool execution
   */
  private async *runEventLoop(): AsyncGenerator<StreamEvent, void, unknown> {
    const maxIterations = 10;
    const maxToolCallsPerTask = 5;
    let iteration = 0;
    let totalToolCalls = 0;
    const DEBUG = !!process.env.AWCODE_DEBUG;

    while (iteration < maxIterations) {
      iteration++;

      // Build messages with system prompt, loaded context, and active skills
      let systemPrompt = this.state.systemPrompt;
      if (this.loadedContext) {
        systemPrompt += `\n\n# Context from Previous Sessions\n${this.loadedContext}`;
      }
      // Add active skill instructions
      const skillInstructions = this.skillManager.getActiveInstructions();
      if (skillInstructions) {
        systemPrompt += `\n\n${skillInstructions}`;
      }
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        ...this.state.messages,
      ];

      // Stream response
      let assistantContent = '';
      let toolCalls: ToolCall[] = [];

      const toolDefs = this.registry.getDefinitions();
      const stream = this.client.chatStream(
        {
          model: this.state.model,
          messages,
          tools: toolDefs,
          stream: true,
        },
        this.abortController?.signal
      );

      for await (const chunk of stream) {
        if (chunk.type === 'thinking' && chunk.text) {
          yield { type: 'thinking', text: chunk.text };
        } else if (chunk.type === 'text' && chunk.text) {
          assistantContent += chunk.text;
          yield { type: 'text', text: chunk.text };
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
          // Emit tool_pending immediately when LLM decides to call a tool
          // This shows the tool in the UI before execution starts
          yield {
            type: 'tool_pending',
            tool: {
              id: chunk.toolCall.id,
              name: chunk.toolCall.name,
              args: chunk.toolCall.arguments || {},
              status: 'pending',
            },
          };
        } else if (chunk.type === 'error') {
          yield { type: 'error', error: chunk.error };
          return;
        }
      }

      // FALLBACK: Check for XML tool calls in text if no native tool calls were returned
      // Some models generate XML like <invoke name="write_file">...</invoke> instead of using native tools
      if (toolCalls.length === 0 && containsXMLToolCalls(assistantContent)) {
        console.error('[Session Events] WARNING: Model generated XML tool calls. Parsing XML fallback...');
        const { toolCalls: xmlToolCalls, cleanedText } = parseXMLToolCalls(assistantContent);

        if (xmlToolCalls.length > 0) {
          // Unwrap any wrapper patterns in the parsed arguments
          for (const tc of xmlToolCalls) {
            tc.arguments = unwrapToolArguments(tc.arguments as Record<string, unknown>);
            // Emit tool_pending for XML-parsed tools
            yield {
              type: 'tool_pending',
              tool: {
                id: tc.id,
                name: tc.name,
                args: tc.arguments || {},
                status: 'pending',
              },
            };
          }

          toolCalls.push(...xmlToolCalls);
          assistantContent = cleanedText;

          console.error(`[Session Events] Parsed ${xmlToolCalls.length} XML tool calls: ${xmlToolCalls.map(tc => tc.name).join(', ')}`);
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent,
      };
      if (toolCalls.length > 0) {
        assistantMessage.toolCalls = toolCalls;
      }
      this.state.messages.push(assistantMessage);

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        // Yield token usage at end
        const stats = this.getContextStats();
        yield {
          type: 'usage',
          usage: {
            promptTokens: Math.floor(stats.totalTokens * 0.6),
            completionTokens: Math.floor(stats.totalTokens * 0.4),
            totalTokens: stats.totalTokens,
          },
        };
        yield { type: 'done' };
        return;
      }

      // Execute tool calls with real-time streaming progress events
      const toolResults: ToolResult[] = [];
      for (const toolCall of toolCalls) {
        const startTime = Date.now();

        // Emit tool_start event immediately
        yield {
          type: 'tool_start',
          tool: {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.arguments || {},
            status: 'running',
            startTime,
          },
        };

        // Progress queue for streaming tool output
        // Callbacks can't yield directly, so we collect events and poll for them
        const progressQueue: StreamEvent[] = [];
        let toolDone = false;
        let toolOutput: ToolOutput | undefined;
        let toolError: Error | undefined;

        const context: ToolContext = {
          workingDirectory: this.workingDirectory,
          signal: this.abortController?.signal || new AbortController().signal,
          // Progress callback pushes to queue for polling
          onProgress: (output: string) => {
            progressQueue.push({
              type: 'tool_progress',
              tool: {
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.arguments || {},
                status: 'running',
                output,
              },
            });
          },
        };

        // Start tool execution (don't await - poll for progress)
        const toolPromise = this.registry.execute(toolCall, context)
          .then(result => { toolOutput = result; toolDone = true; })
          .catch(err => { toolError = err; toolDone = true; });

        // Poll for progress events while tool is running
        while (!toolDone) {
          // Yield any queued progress events
          while (progressQueue.length > 0) {
            yield progressQueue.shift()!;
          }
          // Small delay to allow more events to accumulate (50ms)
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Yield any remaining progress events after tool completion
        while (progressQueue.length > 0) {
          yield progressQueue.shift()!;
        }

        // Wait for the promise to fully settle (should be instant since toolDone is true)
        await toolPromise.catch(() => {}); // Ignore - we already captured the error

        const endTime = Date.now();

        if (toolError) {
          const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);

          // Emit tool_error event
          yield {
            type: 'tool_error',
            tool: {
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.arguments || {},
              status: 'error',
              error: errorMessage,
              startTime,
              endTime,
              duration: endTime - startTime,
            },
          };

          toolResults.push({
            toolCallId: toolCall.id,
            content: errorMessage,
            isError: true,
          });
        } else if (toolOutput) {
          // Emit tool_complete event
          yield {
            type: 'tool_complete',
            tool: {
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.arguments || {},
              status: toolOutput.isError ? 'error' : 'success',
              output: toolOutput.content,
              error: toolOutput.isError ? toolOutput.content : undefined,
              startTime,
              endTime,
              duration: endTime - startTime,
            },
          };

          toolResults.push({
            toolCallId: toolCall.id,
            content: toolOutput.content,
            isError: toolOutput.isError,
          });
        }
      }

      totalToolCalls += toolCalls.length;

      // Add tool results to messages with error tracking
      let consecutiveErrors = 0;
      for (const result of toolResults) {
        this.state.messages.push({
          role: 'tool',
          content: result.content,
          toolCallId: result.toolCallId,
        });
        if (result.isError) {
          consecutiveErrors++;
        }
      }

      // ERROR RECOVERY: If multiple tools failed, provide explicit guidance
      if (consecutiveErrors >= 2) {
        const errorGuidance = `IMPORTANT: ${consecutiveErrors} tool calls failed. Please carefully check:
1. Tool parameters must be direct key-value pairs, NOT wrapped in a "value" object
2. For write_file: use {"path": "...", "content": "..."} NOT {"value": {"path": "...", "content": "..."}}
3. Read the error messages carefully before retrying

Stop and explain what went wrong before retrying.`;

        this.state.messages.push({
          role: 'user',
          content: errorGuidance,
        });
      }

      // Safety: If we've done too many tool calls, force summary
      if (totalToolCalls >= maxToolCallsPerTask) {
        this.state.messages.push({
          role: 'user',
          content: 'The task appears complete. Please provide a brief summary of what was done and stop using tools.',
        });
      }

      // Check context usage and auto-compact if needed
      this.contextManager.updateTokens(this.state.messages);
    }

    yield { type: 'text', text: '\n[Maximum iterations reached]' };
    yield { type: 'done' };
  }

  /**
   * Abort current request
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Get conversation history
   */
  getHistory(): Message[] {
    return [...this.state.messages];
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.state.messages = [];
  }

  /**
   * Get current model
   */
  getModel(): string {
    return this.state.model;
  }

  /**
   * Set model
   * Automatically switches between Ollama and API client based on model prefix
   */
  setModel(model: string): void {
    this.state.model = model;
    // Update client based on new model
    this.client = this.getClientForModel(model);
  }

  // ============== Skill Management ==============

  /**
   * List all available skills
   */
  listSkills(): Skill[] {
    return this.skillManager.listSkills();
  }

  /**
   * Get active skills
   */
  getActiveSkills(): Skill[] {
    return this.skillManager.getActiveSkills();
  }

  /**
   * Activate a skill by name
   */
  activateSkill(name: string): boolean {
    return this.skillManager.activateSkill(name);
  }

  /**
   * Deactivate a skill by name
   */
  deactivateSkill(name: string): boolean {
    return this.skillManager.deactivateSkill(name);
  }

  /**
   * Get a skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skillManager.getSkill(name);
  }

  /**
   * Check message for skill triggers and auto-activate
   */
  checkSkillTriggers(message: string): Skill[] {
    return this.skillManager.checkTriggers(message);
  }

  // ============== End Skill Management ==============

  /**
   * Get token statistics (input/output breakdown)
   */
  getTokenStats(): { inputTokens: number; outputTokens: number } {
    const stats = this.contextManager.getStats(this.state.messages);
    // Estimate input/output based on message roles (rough estimate)
    const inputTokens = Math.floor(stats.totalTokens * 0.6); // Assume 60% input
    const outputTokens = Math.floor(stats.totalTokens * 0.4); // Assume 40% output
    return {
      inputTokens,
      outputTokens,
    };
  }

  /**
   * Compact context by summarizing old messages
   */
  async compactContext(): Promise<void> {
    // Create summarizer function that uses the LLM
    const summarizer = async (prompt: string): Promise<string> => {
      // Use the LLM to summarize the context
      const request = {
        model: this.state.model,
        messages: [{ role: 'user' as const, content: prompt }],
        stream: false,
      };

      let summary = '';
      for await (const chunk of this.client.chatStream(request, this.abortController?.signal)) {
        if (chunk.type === 'text' && chunk.text) {
          summary += chunk.text;
        }
      }

      return summary;
    };

    // Manually trigger context summarization
    const summarized = await this.contextManager.summarize(this.state.messages, summarizer);
    if (summarized) {
      this.state.messages = summarized;
    }
  }

  /**
   * Initialize project context (scan and generate AGENTICODE.md)
   */
  async initializeProjectContext(params: {
    workingDirectory: string;
    includeFileStructure?: boolean;
    includeDependencies?: boolean;
    includeGitInfo?: boolean;
  }): Promise<{ hasStructure: boolean; hasDependencies: boolean; hasGit: boolean }> {
    // TODO: Implement full project scanning
    // For now, return placeholder
    return {
      hasStructure: params.includeFileStructure || false,
      hasDependencies: params.includeDependencies || false,
      hasGit: params.includeGitInfo || false,
    };
  }

  /**
   * Get memory status
   */
  async getMemoryStatus(): Promise<{
    startupMemories: number;
    sessionSummaries: number;
    sharedKnowledge: number;
    totalContextItems: number;
    currentMessages: number;
    currentTokens: number;
    contextUsagePercent: number;
    userMemoriesInDB?: number;
    hasProjectContext: boolean;
  }> {
    const stats = this.contextManager.getStats(this.state.messages);
    return {
      startupMemories: this.loadedContext ? this.loadedContext.split('\n').filter(l => l.startsWith('- [')).length : 0,
      sessionSummaries: 0, // TODO: Track from persistence
      sharedKnowledge: 0, // TODO: Track from persistence
      totalContextItems: this.loadedContext ? this.loadedContext.split('\n').filter(l => l.startsWith('-')).length : 0,
      currentMessages: this.state.messages.length,
      currentTokens: stats.totalTokens,
      contextUsagePercent: stats.usagePercent,
      userMemoriesInDB: undefined,
      hasProjectContext: false, // TODO: Check for AGENTICODE.md
    };
  }

  /**
   * List recent sessions for user
   */
  async listRecentSessions(userId: string, limit: number = 10): Promise<Array<{
    id: string;
    workingDirectory: string;
    lastActivityAt: Date;
    status: string;
    messageCount?: number;
    metadata?: Record<string, any>;
  }>> {
    if (!this.persistenceClient) {
      return [];
    }

    try {
      const result = await this.persistenceClient.listSessions({ userId, limit });
      return result.sessions;
    } catch {
      return [];
    }
  }

  /**
   * Resume a previous session
   */
  async resumeSession(sessionId: string): Promise<boolean> {
    if (!this.persistenceClient) {
      return false;
    }

    try {
      // Get session and messages
      const session = await this.persistenceClient.getSession(sessionId);
      if (!session) {
        return false;
      }

      const messages = await this.persistenceClient.getMessages(sessionId, { limit: 100 });

      // Restore messages
      this.state.messages = messages.map(m => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      }));

      return true;
    } catch {
      return false;
    }
  }
}
