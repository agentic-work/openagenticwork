/**
 * Agenticode Routes
 * Provides endpoints for agenticode-cli instances to connect to the platform.
 *
 * Key endpoints:
 * - GET /config - Provider credentials for direct LLM calls
 * - POST /chat - Streaming chat completions (messages array format)
 * - GET /status - Service status
 * - GET /sessions - User's code sessions
 *
 * Format matches @agentic-work/sdk AgenticodeConfig interface.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import { prisma } from '../utils/prisma.js';
import { getCodeModeSessionService, CodeModeSessionService } from '../services/CodeModeSessionService.js';
import { awcodeStorageService } from '../services/AWCodeStorageService.js';
import { llmMetricsService, LLMRequestMetrics } from '../services/LLMMetricsService.js';
import { ModelConfigurationService } from '../services/ModelConfigurationService.js';

// SECURITY: Internal API key for code-manager authentication
const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';

// SDK-compatible types
type ProviderType = 'anthropic' | 'openai' | 'google' | 'ollama' | 'azure-openai' | 'vertex-ai' | 'bedrock' | 'aws-bedrock';

interface ProviderCredentials {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  projectId?: string;
  location?: string;
  resourceName?: string;
  deploymentName?: string;
  apiVersion?: string;
}

interface AgenticodeProvider {
  type: ProviderType;
  id: string;
  name: string;
  enabled: boolean;
  credentials: ProviderCredentials;
}

interface AgenticodeModelConfig {
  id: string;
  providerId: string;
  name: string;
  available: boolean;
}

interface AgenticodeConfig {
  providers: AgenticodeProvider[];
  models: AgenticodeModelConfig[];
  defaultModel?: string;
  mcpServers?: string[];
  flowiseEnabled?: boolean;
  // Legacy fields for backwards compatibility
  mcpProxyUrl?: string;
  flowiseUrl?: string;
}

// Chat request types (OpenAI-compatible messages format)
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface AgenticodeChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // Session persistence options
  sessionId?: string;  // Optional session ID for message persistence
  persistMessages?: boolean;  // Whether to persist messages to database
}

interface AgenticodeRoutesOptions {
  providerManager?: ProviderManager;
}

export const agenticodeRoutes: FastifyPluginAsync<AgenticodeRoutesOptions> = async (fastify, opts) => {
  const providerManager = opts.providerManager;

  // Initialize CodeModeSessionService for message persistence
  let codeModeSessionService: CodeModeSessionService | null = null;
  if (providerManager) {
    codeModeSessionService = getCodeModeSessionService(loggers.routes, providerManager);
  }
  /**
   * GET /api/agenticode/config
   * Returns provider configuration for the authenticated user's agenticode-cli
   * Currently uses environment variables; can be extended later for per-user keys
   */
  fastify.get('/config', {
    preHandler: authMiddleware,
    handler: async (request, reply) => {
      try {
        const userId = (request.user as any)?.id;

        if (!userId) {
          return reply.status(401).send({ error: 'Unauthorized - no user ID' });
        }

        loggers.routes.info({ userId }, 'Fetching agenticode config for user');

        const providers: AgenticodeProvider[] = [];
        const models: AgenticodeModelConfig[] = [];

        // Get available models from ProviderManager (dynamic discovery)
        if (providerManager) {
          try {
            const availableModels = await providerManager.listModels();

            // Group models by provider and build provider/model lists
            const providerMap = new Map<string, { type: ProviderType; name: string; models: any[] }>();

            for (const model of availableModels) {
              const providerId = model.provider || 'unknown';
              if (!providerMap.has(providerId)) {
                providerMap.set(providerId, {
                  type: providerId as ProviderType,
                  name: providerId.charAt(0).toUpperCase() + providerId.slice(1),
                  models: [],
                });
              }
              providerMap.get(providerId)!.models.push(model);
            }

            // Build providers and models arrays from discovered data
            for (const [providerId, providerData] of providerMap) {
              providers.push({
                type: providerData.type,
                id: providerId,
                name: providerData.name,
                enabled: true,
                credentials: {
                  type: providerData.type,
                  // Note: credentials are not exposed to CLI - it uses API mode
                },
              });

              for (const model of providerData.models) {
                models.push({
                  id: model.id || model.name,
                  providerId,
                  name: model.name || model.id,
                  available: model.available !== false,
                });
              }
            }

            loggers.routes.info({
              providerCount: providers.length,
              modelCount: models.length,
            }, 'Discovered models from ProviderManager');
          } catch (err) {
            loggers.routes.warn({ err }, 'Failed to get models from ProviderManager');
          }
        }

        // If no models discovered and Ollama is enabled, add Ollama as fallback
        const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true';
        if (models.length === 0 && ollamaEnabled) {
          const ollamaHost = process.env.OLLAMA_HOST || process.env.OLLAMA_URL || 'http://ollama:11434';
          providers.push({
            type: 'ollama',
            id: 'ollama-local',
            name: 'Ollama (Local)',
            enabled: true,
            credentials: {
              type: 'ollama',
              baseUrl: ollamaHost,
            },
          });

          // Try to get models from Ollama directly
          try {
            const ollamaResponse = await fetch(`${ollamaHost}/api/tags`);
            if (ollamaResponse.ok) {
              const ollamaData = await ollamaResponse.json() as { models?: Array<{ name: string }> };
              if (ollamaData.models && ollamaData.models.length > 0) {
                for (const ollamaModel of ollamaData.models) {
                  models.push({
                    id: ollamaModel.name,
                    providerId: 'ollama-local',
                    name: ollamaModel.name,
                    available: true,
                  });
                }
                loggers.routes.info({ modelCount: models.length }, 'Discovered models from Ollama');
              }
            }
          } catch (err) {
            loggers.routes.warn({ err }, 'Failed to get models from Ollama');
          }
        }

        // Get MCP servers (if available)
        const mcpServers: string[] = [];
        // TODO: Query MCP proxy for available servers for this user

        // Get admin-configured default model from database
        let configuredDefaultModel: string | undefined;
        try {
          const defaultModelSetting = await prisma.systemConfiguration.findUnique({
            where: { key: 'awcode.defaultModel' },
          });
          if (defaultModelSetting?.value) {
            const val = defaultModelSetting.value;
            configuredDefaultModel = typeof val === 'string' ? val.replace(/^"|"$/g, '') : String(val);
          }
        } catch (err) {
          loggers.routes.warn({ err }, 'Failed to fetch awcode.defaultModel setting');
        }

        // Validate the configured model is in our available models list
        const modelIds = models.map(m => m.id);
        let defaultModel: string | undefined;
        if (configuredDefaultModel && modelIds.includes(configuredDefaultModel)) {
          defaultModel = configuredDefaultModel;
        } else {
          // Smart fallback: prefer Bedrock Claude models (premium), then Vertex, then Ollama
          // Priority: Claude Opus > Claude Sonnet > Claude Haiku > Gemini > Others
          const preferredOrder = [
            'claude-opus',      // Most capable
            'claude-sonnet',    // Balanced
            'claude-haiku',     // Fast/cheap
            'gemini',           // Google alternative
          ];

          // Find best model based on priority
          for (const preferred of preferredOrder) {
            const match = models.find(m =>
              m.id.toLowerCase().includes(preferred) &&
              m.providerId !== 'ollama' // Prefer API models over local
            );
            if (match) {
              defaultModel = match.id;
              break;
            }
          }

          // Final fallback to first available model
          if (!defaultModel) {
            defaultModel = models[0]?.id;
          }

          if (configuredDefaultModel) {
            loggers.routes.warn({
              configuredModel: configuredDefaultModel,
              availableModels: modelIds,
              selectedDefault: defaultModel,
            }, 'Configured defaultModel not found in available models, using smart fallback');
          }
        }

        // Build config response (SDK-compatible format)
        const config: AgenticodeConfig = {
          providers,
          models,
          defaultModel,
          mcpServers,
          flowiseEnabled: !!process.env.FLOWISE_URL,
          // Legacy fields
          mcpProxyUrl: process.env.MCP_PROXY_URL || 'http://localhost:3100',
          flowiseUrl: process.env.FLOWISE_URL || 'http://localhost:3000',
        };

        loggers.routes.info({
          userId,
          providerCount: providers.length,
          modelCount: models.length,
          providers: providers.map(p => p.type),
        }, 'Returning agenticode config');

        return reply.send(config);
      } catch (error) {
        loggers.routes.error({ error }, 'Failed to get agenticode config');
        return reply.status(500).send({ error: 'Failed to get configuration' });
      }
    },
  });

  /**
   * GET /api/agenticode/health
   * Health check for agenticode service
   */
  fastify.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'agenticode',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/agenticode/chat
   * Streaming chat completions for agenticode-cli instances.
   * Accepts OpenAI-compatible messages array format.
   * Routes through platform's configured LLM providers.
   */
  fastify.post<{ Body: AgenticodeChatRequest }>('/chat', {
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest<{ Body: AgenticodeChatRequest }>, reply: FastifyReply): Promise<void> => {
      const userId = (request.user as any)?.id;
      const isAdmin = (request.user as any)?.isAdmin || false;

      if (!userId) {
        reply.code(401).send({ error: 'Unauthorized - no user ID' });
        return;
      }

      const { model, messages, tools, temperature, max_tokens, sessionId, persistMessages } = request.body;

      if (!messages || messages.length === 0) {
        reply.code(400).send({ error: 'Messages array is required' });
        return;
      }

      loggers.routes.info({
        userId,
        model,
        messageCount: messages.length,
        hasTools: !!tools?.length,
        sessionId,
        persistMessages,
      }, '[Agenticode] Chat request received');

      // Track response content for persistence
      let accumulatedContent = '';
      let accumulatedThinking = '';
      let accumulatedToolCalls: any[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      const requestStartTime = new Date();

      if (!providerManager) {
        reply.code(503).send({ error: 'LLM providers not available' });
        return;
      }

      // Determine model to use - get from database config if not provided or if unknown model
      let effectiveModel = model;

      // Check if the provided model is supported by any provider
      // Unknown models like "gpt-oss" should trigger fallback logic
      const isModelSupported = effectiveModel ? providerManager.getProviderForModel(effectiveModel) !== null : false;

      if (!effectiveModel || !isModelSupported) {
        if (effectiveModel && !isModelSupported) {
          loggers.routes.info({ requestedModel: effectiveModel }, '[Agenticode] Unknown model requested, using fallback');
        }

        // Try database-configured default model
        try {
          const defaultModelSetting = await prisma.systemConfiguration.findUnique({
            where: { key: 'awcode.defaultModel' },
          });
          if (defaultModelSetting?.value) {
            const val = defaultModelSetting.value;
            const dbModel = typeof val === 'string' ? val.replace(/^"|"$/g, '') : String(val);
            // Verify this model is also supported
            if (providerManager.getProviderForModel(dbModel)) {
              effectiveModel = dbModel;
            }
          }
        } catch (err) {
          loggers.routes.warn({ err }, '[Agenticode] Failed to fetch default model from database');
        }

        // Fallback to SMARTEST available model for code mode
        // Priority: Opus 4.5 > Opus 4.1 > Opus 4 > Sonnet 4.5 > Sonnet 4 > other Claude > any
        if (!effectiveModel || !providerManager.getProviderForModel(effectiveModel)) {
          const availableModels = await providerManager.listModels();

          // Model preference order - smartest first for code mode
          const modelPreference = [
            'opus-4-5', 'opus-4.5', 'claude-opus-4-5',    // Opus 4.5 - smartest
            'opus-4-1', 'opus-4.1', 'claude-opus-4-1',    // Opus 4.1
            'opus-4', 'claude-opus-4',                     // Opus 4
            'sonnet-4-5', 'sonnet-4.5', 'claude-sonnet-4-5', // Sonnet 4.5
            'sonnet-4', 'claude-sonnet-4',                 // Sonnet 4
          ];

          // Find the smartest available model
          let smartestModel: string | undefined;
          for (const pref of modelPreference) {
            const found = availableModels.find(m =>
              m.id?.toLowerCase().includes(pref) || m.name?.toLowerCase().includes(pref)
            );
            if (found?.id && providerManager.getProviderForModel(found.id)) {
              smartestModel = found.id;
              break;
            }
          }

          // Fall back to any Claude model if no preferred model found
          if (!smartestModel) {
            const anyClaudeModel = availableModels.find(m =>
              m.id?.toLowerCase().includes('claude') || m.name?.toLowerCase().includes('claude')
            );
            smartestModel = anyClaudeModel?.id;
          }

          effectiveModel = smartestModel || availableModels[0]?.id || process.env.DEFAULT_MODEL || process.env.FALLBACK_MODEL;
          loggers.routes.info({ effectiveModel, preference: 'smartest' }, '[Agenticode] Using fallback model - selected smartest available');
        }
      }

      // Set up SSE streaming
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        // Get the appropriate provider name for the model
        const providerName = providerManager.getProviderForModel(effectiveModel);

        if (!providerName) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: `No provider available for model: ${effectiveModel}` })}\n\n`);
          reply.raw.end();
          return;
        }

        // Get the actual provider instance
        const provider = providerManager.getProvider(providerName);
        if (!provider) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: `Provider not found: ${providerName}` })}\n\n`);
          reply.raw.end();
          return;
        }

        loggers.routes.info({
          userId,
          model: effectiveModel,
          provider: providerName,
          messageCount: messages.length,
        }, '[Agenticode] Routing to provider');

        // Debug: Log message structure to understand tool_use format
        messages.forEach((m: any, i: number) => {
          if (Array.isArray(m.content)) {
            m.content.forEach((block: any, j: number) => {
              if (block.type === 'tool_use') {
                loggers.routes.debug({
                  messageIndex: i,
                  contentIndex: j,
                  inputType: typeof block.input,
                  inputValue: block.input,
                }, '[Agenticode] tool_use block found');
              }
            });
          }
        });

        // Convert messages to provider format
        // IMPORTANT: CLI may send tool_use.input in various formats - Bedrock requires it as object
        // Also handle tool_result messages which need proper formatting
        const providerMessages = messages.map((m, msgIdx) => {
          let content: any = m.content;

          // If content is an array, process each block to ensure proper formatting
          if (Array.isArray(content)) {
            content = content.map((block: any, blockIdx: number) => {
              // Handle tool_use blocks - ensure input is a plain object
              if (block.type === 'tool_use') {
                let input = block.input;

                // Ensure input is a valid plain object for Bedrock
                if (typeof input === 'string') {
                  // Try to parse JSON string
                  try {
                    const parsed = JSON.parse(input);
                    // Ensure parsed result is a plain object (not array)
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      input = parsed;
                    } else {
                      loggers.routes.warn({ msgIdx, blockIdx, parsedType: typeof parsed }, '[Agenticode] Parsed tool_use input is not a plain object');
                      input = Array.isArray(parsed) ? { items: parsed } : { value: parsed };
                    }
                  } catch (e) {
                    // If parse fails, wrap the string value
                    loggers.routes.warn({ msgIdx, blockIdx, inputLength: input.length }, '[Agenticode] Failed to parse tool_use input string');
                    input = { raw: input };
                  }
                } else if (input === null || input === undefined) {
                  // Null/undefined -> empty object
                  input = {};
                } else if (Array.isArray(input)) {
                  // Array -> wrap in object
                  loggers.routes.debug({ msgIdx, blockIdx }, '[Agenticode] Wrapping tool_use input array in object');
                  input = { items: input };
                } else if (typeof input !== 'object') {
                  // Primitive types -> wrap in object
                  loggers.routes.warn({ msgIdx, blockIdx, type: typeof input }, '[Agenticode] Wrapping primitive tool_use input');
                  input = { value: input };
                } else {
                  // Already an object - ensure it's a plain object (clone to remove prototype issues)
                  input = JSON.parse(JSON.stringify(input));
                }

                return { ...block, input };
              }

              // Handle tool_result blocks - ensure content is properly formatted
              if (block.type === 'tool_result') {
                let resultContent = block.content;

                // Ensure content is a string or proper array
                if (typeof resultContent !== 'string' && !Array.isArray(resultContent)) {
                  try {
                    resultContent = JSON.stringify(resultContent);
                  } catch {
                    resultContent = String(resultContent);
                  }
                }

                return { ...block, content: resultContent };
              }

              return block;
            });
          }

          return {
            role: m.role,
            content,
            tool_calls: m.tool_calls,
            tool_call_id: m.tool_call_id,
          };
        });

        // Convert tools to provider format
        const providerTools = tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          },
        }));

        // DEBUG: Log transformed messages to understand tool_use.input issue
        providerMessages.forEach((m: any, i: number) => {
          if (Array.isArray(m.content)) {
            m.content.forEach((block: any, j: number) => {
              if (block.type === 'tool_use') {
                loggers.routes.info({
                  messageIndex: i,
                  contentIndex: j,
                  inputType: typeof block.input,
                  inputIsArray: Array.isArray(block.input),
                  inputConstructor: block.input?.constructor?.name,
                  inputValue: JSON.stringify(block.input).substring(0, 200),
                }, '[Agenticode] TRANSFORMED tool_use block');
              }
            });
          }
        });

        // CRITICAL FIX: Validate tool_result blocks have matching tool_use blocks
        // Error: "unexpected `tool_use_id` found in `tool_result` blocks: <id>. Each `tool_result` block must have a corresponding `tool_use` block in the previous message."
        // This happens when message history gets corrupted and tool_result exists without its tool_use
        //
        // IMPORTANT: Handle BOTH message formats:
        // - Anthropic format: tool_use blocks in content[], tool_result blocks in content[]
        // - OpenAI format: tool_calls[] array on assistant messages, role='tool' with tool_call_id

        // Step 1: Collect all tool_use IDs from the message history (both formats)
        const toolUseIds = new Set<string>();
        providerMessages.forEach((m: any) => {
          // Anthropic format: tool_use blocks in content array
          if (Array.isArray(m.content)) {
            m.content.forEach((block: any) => {
              if (block.type === 'tool_use' && block.id) {
                toolUseIds.add(block.id);
              }
            });
          }
          // OpenAI format: tool_calls array on assistant messages
          if (Array.isArray(m.tool_calls)) {
            m.tool_calls.forEach((tc: any) => {
              if (tc.id) {
                toolUseIds.add(tc.id);
              }
            });
          }
        });

        loggers.routes.debug({
          toolUseIdCount: toolUseIds.size,
          toolUseIds: Array.from(toolUseIds).slice(0, 10),
        }, '[Agenticode] Collected tool_use IDs for validation');

        // Step 2: Find and remove orphan tool_result blocks (both formats)
        const cleanedMessages = providerMessages.map((m: any, msgIdx: number) => {
          // OpenAI format: Check role='tool' messages with tool_call_id
          if (m.role === 'tool' && m.tool_call_id) {
            const hasMatchingToolUse = toolUseIds.has(m.tool_call_id);
            if (!hasMatchingToolUse) {
              loggers.routes.warn({
                msgIndex: msgIdx,
                orphanToolCallId: m.tool_call_id,
                availableToolUseIds: Array.from(toolUseIds),
              }, '[Agenticode] Removing orphan OpenAI-format tool message - no matching tool_use found');
              // Return null to filter out, or convert to text message
              return null;
            }
            return m;
          }

          // Anthropic format: Check content array for tool_result blocks
          if (!Array.isArray(m.content)) return m;

          const cleanedContent = m.content.filter((block: any) => {
            // Keep non-tool_result blocks
            if (block.type !== 'tool_result') return true;

            // Check if tool_result has a matching tool_use
            const hasMatchingToolUse = toolUseIds.has(block.tool_use_id);
            if (!hasMatchingToolUse) {
              loggers.routes.warn({
                msgIndex: msgIdx,
                orphanToolUseId: block.tool_use_id,
                availableToolUseIds: Array.from(toolUseIds),
              }, '[Agenticode] Removing orphan Anthropic-format tool_result block - no matching tool_use found');
            }
            return hasMatchingToolUse;
          });

          // If message content is now empty, we might need to handle this
          if (cleanedContent.length === 0 && m.content.length > 0) {
            loggers.routes.warn({
              msgIndex: msgIdx,
              originalContentLength: m.content.length,
              role: m.role,
            }, '[Agenticode] Message content became empty after removing orphan tool_results');
            // Return a text placeholder to avoid empty content errors
            return { ...m, content: [{ type: 'text', text: '[Tool results removed - missing tool calls]' }] };
          }

          return { ...m, content: cleanedContent };
        }).filter((m: any) => m !== null); // Remove nulled-out OpenAI tool messages

        // Step 3: Remove any messages that are now invalid (empty user messages with tool results)
        let validMessages = cleanedMessages.filter((m: any, idx: number) => {
          // Don't filter out messages with valid content
          if (!Array.isArray(m.content)) return true;
          if (m.content.length > 0) return true;

          // Empty content in user message is problematic
          if (m.role === 'user') {
            loggers.routes.warn({ msgIndex: idx }, '[Agenticode] Removing empty user message');
            return false;
          }

          return true;
        });

        if (validMessages.length !== providerMessages.length) {
          loggers.routes.info({
            originalCount: providerMessages.length,
            cleanedCount: validMessages.length,
            removedCount: providerMessages.length - validMessages.length,
          }, '[Agenticode] Cleaned message history - removed orphan tool results');
        }

        // DEBUG: Log tool configuration before sending to provider
        loggers.routes.info({
          model: effectiveModel,
          provider: providerName,
          hasTools: !!providerTools?.length,
          toolCount: providerTools?.length || 0,
          toolNames: providerTools?.slice(0, 5).map(t => t.function.name) || [],
        }, '[Agenticode] 🔧 Sending request to provider with tools');

        // Check if model supports extended thinking
        const modelSupportsThinking = ModelConfigurationService.supportsThinking(effectiveModel);

        // Configure extended thinking for code mode - use generous budget for complex reasoning
        // Code tasks often require deep reasoning about architecture, bugs, and implementation
        const AGENTICODE_THINKING_BUDGET = parseInt(process.env.AGENTICODE_THINKING_BUDGET || '16000');
        let enableThinking = modelSupportsThinking && AGENTICODE_THINKING_BUDGET > 0;

        // Check for incompatible assistant messages - disable thinking if found
        // TODO: In the future, implement proper thinking block preservation in CLI history
        // For now, we disable thinking on subsequent turns to avoid tool_use_id mismatch errors
        if (enableThinking) {
          const hasIncompatibleMessage = validMessages.some((msg: any) => {
            if (msg.role !== 'assistant') return false;
            // If it has tool_calls (OpenAI format), it's from a previous turn without thinking
            if (msg.tool_calls && msg.tool_calls.length > 0) return true;
            // If content is string, it's incompatible
            if (typeof msg.content === 'string') return true;
            // If content array doesn't start with thinking, it's incompatible
            const content = Array.isArray(msg.content) ? msg.content : [];
            if (content.length > 0) {
              const firstType = content[0]?.type;
              if (firstType !== 'thinking' && firstType !== 'redacted_thinking') return true;
            }
            return false;
          });

          if (hasIncompatibleMessage) {
            enableThinking = false;
            loggers.routes.info({
              model: effectiveModel,
              reason: 'History contains assistant messages without thinking blocks',
            }, '[Agenticode] ⚠️ Disabling thinking for compatibility with message history');
          }
        }

        if (enableThinking) {
          loggers.routes.info({
            model: effectiveModel,
            thinkingBudget: AGENTICODE_THINKING_BUDGET,
          }, '[Agenticode] 🧠 Extended thinking enabled for code mode');
        }

        // Build completion request with optional thinking
        const completionRequest: any = {
          model: effectiveModel,
          messages: validMessages,
          tools: providerTools,
          temperature: temperature ?? 0.7,
          max_tokens: max_tokens ?? 8192,
          stream: true,
        };

        // Add thinking configuration for Claude models that support it
        if (enableThinking) {
          completionRequest.thinking = {
            type: 'enabled',
            budget_tokens: AGENTICODE_THINKING_BUDGET,
          };
        }

        // Stream completion from provider using createCompletion
        const stream = await providerManager.createCompletion(completionRequest, providerName) as AsyncGenerator<any>;

        // Accumulate tool call deltas by id/index before emitting
        // Tool calls are streamed in chunks: first has id+name, subsequent have arguments
        const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

        // Helper to emit a complete tool call
        const emitToolCall = (toolCall: { id: string; name: string; arguments: string }) => {
          let parsedArgs: any = {};
          try {
            if (toolCall.arguments) {
              parsedArgs = JSON.parse(toolCall.arguments);
            }
          } catch {
            // Keep as string if parse fails
            parsedArgs = toolCall.arguments;
          }

          // CRITICAL FIX: Unwrap "value" wrapper if model made format error
          // Some models wrap all tool parameters in a "value" key: {"value": {"path": "...", "content": "..."}}
          // But tools expect direct parameters: {"path": "...", "content": "..."}
          if (parsedArgs && typeof parsedArgs === 'object' && parsedArgs.value && typeof parsedArgs.value === 'object') {
            // Check if this looks like a wrapped set of parameters (has typical file operation keys)
            const valueKeys = Object.keys(parsedArgs.value);
            const paramKeys = Object.keys(parsedArgs);
            // If only "value" key exists and value contains actual parameters, unwrap it
            if (paramKeys.length === 1 && valueKeys.length > 0) {
              loggers.routes.warn({
                toolName: toolCall.name,
                originalKeys: paramKeys,
                unwrappedKeys: valueKeys,
              }, '[Agenticode] Unwrapping "value" wrapper from tool arguments - model used incorrect format');
              parsedArgs = parsedArgs.value;
            }
          }
          // Accumulate for persistence
          accumulatedToolCalls.push({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          });
          reply.raw.write(`data: ${JSON.stringify({
            type: 'tool_call',
            tool_call: {
              id: toolCall.id,
              name: toolCall.name,
              arguments: parsedArgs,
            },
          })}\n\n`);
        };

        // Forward stream events to client
        // Handle both simple format { type, content } and OpenAI-style { choices: [{ delta }] }
        for await (const chunk of stream) {
          // OpenAI-style format from providers (Bedrock, etc.)
          if (chunk.choices && chunk.choices[0]) {
            const choice = chunk.choices[0];
            const delta = choice.delta || {};

            // Handle thinking/reasoning content
            if (delta.thinking || delta.reasoning) {
              const thinkingContent = delta.thinking || delta.reasoning;
              accumulatedThinking += thinkingContent;
              reply.raw.write(`data: ${JSON.stringify({ type: 'thinking', content: thinkingContent })}\n\n`);
            }

            // Handle text content
            if (delta.content) {
              accumulatedContent += delta.content;
              reply.raw.write(`data: ${JSON.stringify({ type: 'content', content: delta.content })}\n\n`);
            }

            // Handle tool calls - accumulate deltas before emitting
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                const existing = pendingToolCalls.get(index);

                if (tc.id) {
                  // New tool call with id
                  pendingToolCalls.set(index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  });
                } else if (existing) {
                  // Delta update to existing tool call
                  if (tc.function?.name) {
                    existing.name += tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments;
                  }
                }
              }
            }

            // Handle finish reason - emit all pending tool calls first
            if (choice.finish_reason) {
              // Emit all accumulated tool calls
              for (const [, toolCall] of pendingToolCalls) {
                if (toolCall.id && toolCall.name) {
                  emitToolCall(toolCall);
                }
              }
              pendingToolCalls.clear();

              reply.raw.write(`data: ${JSON.stringify({ type: 'done', finish_reason: choice.finish_reason })}\n\n`);
            }
          }
          // Simple format { type, content } for backwards compatibility
          else if (chunk.type === 'content') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'thinking') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'thinking', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'tool_call') {
            reply.raw.write(`data: ${JSON.stringify({
              type: 'tool_call',
              tool_call: {
                id: chunk.toolCall?.id,
                name: chunk.toolCall?.name,
                arguments: chunk.toolCall?.arguments,
              },
            })}\n\n`);
          } else if (chunk.type === 'error') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
          } else if (chunk.type === 'done') {
            // Emit any remaining pending tool calls
            for (const [, toolCall] of pendingToolCalls) {
              if (toolCall.id && toolCall.name) {
                emitToolCall(toolCall);
              }
            }
            pendingToolCalls.clear();
            reply.raw.write(`data: ${JSON.stringify({ type: 'done', finish_reason: chunk.finishReason || 'stop' })}\n\n`);
          }
        }

        // Emit any remaining tool calls at stream end
        for (const [, toolCall] of pendingToolCalls) {
          if (toolCall.id && toolCall.name) {
            emitToolCall(toolCall);
          }
        }

        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();

        loggers.routes.info({ userId, model: effectiveModel }, '[Agenticode] Chat completed');

        // Persist assistant message if session persistence is enabled
        if (sessionId && persistMessages && codeModeSessionService) {
          try {
            // Find the last user message to persist
            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            if (lastUserMessage) {
              // Persist user message
              await codeModeSessionService.addMessage(sessionId, {
                role: 'user',
                content: lastUserMessage.content,
              });
            }

            // Persist assistant response
            if (accumulatedContent || accumulatedToolCalls.length > 0) {
              await codeModeSessionService.addMessage(sessionId, {
                role: 'assistant',
                content: accumulatedContent,
                toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                thinking: accumulatedThinking || undefined,
                tokensInput: inputTokens || undefined,
                tokensOutput: outputTokens || undefined,
                metadata: {
                  model: effectiveModel,
                },
              });
              loggers.routes.info({
                sessionId,
                contentLength: accumulatedContent.length,
                toolCallsCount: accumulatedToolCalls.length,
              }, '[Agenticode] Persisted messages to session');
            }
          } catch (persistError) {
            loggers.routes.error({ error: persistError, sessionId }, '[Agenticode] Failed to persist messages');
            // Don't throw - persistence failure shouldn't fail the chat
          }
        }

        // 📊 LOG METRICS: Track Code Mode usage separately from Chat
        try {
          const requestEndTime = new Date();
          const totalDurationMs = requestEndTime.getTime() - requestStartTime.getTime();

          // Get API key ID from request (set by auth middleware)
          const apiKeyId = (request as any).apiKeyId;

          const metrics: LLMRequestMetrics = {
            userId,
            sessionId: sessionId || undefined,
            apiKeyId: apiKeyId || undefined,

            providerType: providerName || 'unknown',
            model: effectiveModel,

            requestType: 'chat',
            source: 'code',  // Differentiate from regular chat - this is Code Mode
            streaming: true,
            temperature: temperature || undefined,
            maxTokens: max_tokens || undefined,

            promptTokens: inputTokens || 0,
            completionTokens: outputTokens || 0,
            totalTokens: (inputTokens || 0) + (outputTokens || 0),

            latencyMs: totalDurationMs,
            totalDurationMs: totalDurationMs,

            toolCallsCount: accumulatedToolCalls.length,
            toolNames: accumulatedToolCalls.map(tc => tc.name).filter(Boolean),

            status: 'success',
            requestStartedAt: requestStartTime,
            requestCompletedAt: requestEndTime,
          };

          llmMetricsService.logRequest(metrics).then(logId => {
            if (logId) {
              loggers.routes.debug({ logId, source: 'code', model: effectiveModel }, '[Agenticode] Metrics logged');
            }
          }).catch(err => {
            loggers.routes.warn({ error: err.message }, '[Agenticode] Failed to log metrics');
          });
        } catch (metricsErr: any) {
          loggers.routes.warn({ error: metricsErr.message }, '[Agenticode] Failed to create metrics');
        }
      } catch (error: any) {
        loggers.routes.error({ error, userId }, '[Agenticode] Chat error');
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Chat failed' })}\n\n`);
        reply.raw.end();
      }
    },
  });

  /**
   * GET /api/agenticode/status
   * Detailed AgentiCode service status
   * UAT Requirement: UC-032, UC-033
   */
  fastify.get('/status', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const codeManagerUrl = process.env.CODE_MANAGER_URL || 'http://agenticode-manager:3050';
      
      // Check code manager health
      let managerStatus = 'unknown';
      let managerVersion = 'unknown';
      let activeSlices = 0;
      
      try {
        // SECURITY: Include internal API key for code-manager authentication
        const fetchOptions: RequestInit = {
          signal: AbortSignal.timeout(5000),
          headers: CODE_MANAGER_INTERNAL_KEY ? { 'X-Internal-API-Key': CODE_MANAGER_INTERNAL_KEY } : {},
        };
        const healthResponse = await fetch(`${codeManagerUrl}/health`, fetchOptions);
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          managerStatus = healthData.status || 'healthy';
          managerVersion = healthData.version || 'unknown';
          activeSlices = healthData.activeSlices || 0;
        } else {
          managerStatus = 'unhealthy';
        }
      } catch (error: any) {
        managerStatus = 'unreachable';
        loggers.routes.warn({ error: error.message }, 'Code manager health check failed');
      }

      // Get provider availability
      const providers = {
        ollama: !!process.env.OLLAMA_HOST || !!process.env.OLLAMA_URL,
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        azure: !!process.env.AZURE_API_KEY,
        google: !!process.env.GOOGLE_API_KEY,
      };

      return reply.send({
        status: managerStatus === 'healthy' || managerStatus === 'unknown' ? 'operational' : 'degraded',
        manager: {
          status: managerStatus,
          version: managerVersion,
          url: codeManagerUrl,
          activeSlices,
        },
        providers,
        features: {
          codeExecution: managerStatus === 'healthy',
          terminalAccess: managerStatus === 'healthy',
          fileSystem: managerStatus === 'healthy',
          gitIntegration: managerStatus === 'healthy',
        },
        mcpProxy: {
          url: process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080',
          enabled: true,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get agenticode status');
      return reply.status(500).send({ 
        error: 'Failed to get status',
        message: error.message 
      });
    }
  });

  /**
   * GET /api/agenticode/sessions
   * List user's AgentiCode sessions
   * UAT Requirement: UC-032
   */
  fastify.get('/sessions', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      // Get user's code sessions from database
      const sessions = await prisma.codeSession.findMany({
        where: {
          user_id: userId,
          status: { not: 'deleted' }
        },
        orderBy: { updated_at: 'desc' },
        take: 50,
        select: {
          id: true,
          slice_id: true,
          container_id: true,
          status: true,
          model: true,
          workspace_path: true,
          created_at: true,
          updated_at: true,
        }
      });

      const formattedSessions = sessions.map(session => ({
        id: session.id,
        sliceId: session.slice_id,
        containerId: session.container_id,
        status: session.status,
        model: session.model,
        workspacePath: session.workspace_path,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      }));

      return reply.send({
        sessions: formattedSessions,
        total: formattedSessions.length,
        userId,
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get agenticode sessions');
      return reply.status(500).send({
        error: 'Failed to get sessions',
        message: error.message
      });
    }
  });

  /**
   * POST /api/agenticode/sessions
   * Create a new AgentiCode session
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.post<{
    Body: {
      model?: string;
      workspacePath?: string;
    }
  }>('/sessions', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      const { model, workspacePath } = request.body;

      // Generate proper workspace path if not provided
      // Must match the path created by agenticode-manager's workspaceStorageService
      // Format: /workspaces/{userId} (or with sessionId for per-session isolation)
      const effectiveWorkspacePath = workspacePath || `/workspaces/${userId}`;

      // Get default model from configuration if not specified
      let sessionModel = model;
      if (!sessionModel) {
        try {
          const { ModelConfigurationService } = await import('../services/ModelConfigurationService.js');
          sessionModel = await ModelConfigurationService.getDefaultChatModel();
        } catch (configError) {
          // Fall back to environment variable only - no hardcoded models
          sessionModel = process.env.DEFAULT_MODEL;
        }
      }

      loggers.routes.info({ userId, model: sessionModel, workspacePath: effectiveWorkspacePath }, '[Agenticode] Creating new session');

      const session = await prisma.codeSession.create({
        data: {
          user_id: userId,
          model: sessionModel,
          workspace_path: effectiveWorkspacePath,
          status: 'active',
        },
      });

      return reply.status(201).send({
        session: {
          id: session.id,
          sliceId: session.slice_id,
          containerId: session.container_id,
          status: session.status,
          model: session.model,
          workspacePath: session.workspace_path,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        },
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to create agenticode session');
      return reply.status(500).send({
        error: 'Failed to create session',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/agenticode/sessions/:id
   * Update an existing AgentiCode session
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      model?: string;
      workspacePath?: string;
      status?: string;
    }
  }>('/sessions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;
      const sessionId = request.params.id;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      // Verify session belongs to user
      const existingSession = await prisma.codeSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
        },
      });

      if (!existingSession) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const { model, workspacePath, status } = request.body;

      loggers.routes.info({ userId, sessionId, model, workspacePath, status }, '[Agenticode] Updating session');

      const session = await prisma.codeSession.update({
        where: { id: sessionId },
        data: {
          ...(model && { model }),
          ...(workspacePath && { workspace_path: workspacePath }),
          ...(status && { status }),
          last_activity: new Date(),
        },
      });

      return reply.send({
        session: {
          id: session.id,
          sliceId: session.slice_id,
          containerId: session.container_id,
          status: session.status,
          model: session.model,
          workspacePath: session.workspace_path,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        },
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to update agenticode session');
      return reply.status(500).send({
        error: 'Failed to update session',
        message: error.message
      });
    }
  });

  /**
   * DELETE /api/agenticode/sessions/:id
   * Delete an AgentiCode session (soft delete)
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.delete<{
    Params: { id: string }
  }>('/sessions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;
      const sessionId = request.params.id;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      // Verify session belongs to user
      const existingSession = await prisma.codeSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
        },
      });

      if (!existingSession) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      loggers.routes.info({ userId, sessionId }, '[Agenticode] Deleting session');

      // Soft delete - set status to 'deleted'
      await prisma.codeSession.update({
        where: { id: sessionId },
        data: {
          status: 'deleted',
        },
      });

      return reply.send({ success: true, message: 'Session deleted' });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to delete agenticode session');
      return reply.status(500).send({
        error: 'Failed to delete session',
        message: error.message
      });
    }
  });

  // ==========================================================================
  // Session Messages & Context Window Routes
  // Provides message persistence and context window management for code mode
  // ==========================================================================

  /**
   * GET /api/agenticode/sessions/:id/messages
   * Get messages for a session (supports context windowing)
   * UAT Requirement: UC-032 Session Context
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string; forLLM?: string };
  }>('/sessions/:id/messages', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;
      const limit = parseInt(request.query.limit || '100');
      const forLLM = request.query.forLLM === 'true';

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId, sessionId, limit, forLLM }, '[Agenticode] Getting session messages');

      if (codeModeSessionService) {
        const messages = await codeModeSessionService.getSessionMessages(sessionId, {
          limit,
          forLLM,
        });

        return reply.send({
          messages,
          count: messages.length,
          sessionId,
        });
      } else {
        // Fallback: use AWCodeStorageService directly
        const messages = await awcodeStorageService.getSessionMessages(sessionId, limit);
        return reply.send({
          messages: messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolCalls: m.tool_calls,
            thinking: m.thinking,
            tokensInput: m.tokens_input,
            tokensOutput: m.tokens_output,
            createdAt: m.created_at,
          })),
          count: messages.length,
          sessionId,
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get session messages');
      return reply.status(500).send({
        error: 'Failed to get messages',
        message: error.message
      });
    }
  });

  /**
   * POST /api/agenticode/sessions/:id/messages
   * Add a message to a session
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string | any[];
      toolCalls?: any[];
      toolCallId?: string;
      thinking?: string;
      tokensInput?: number;
      tokensOutput?: number;
      metadata?: Record<string, any>;
    };
  }>('/sessions/:id/messages', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      const { role, content, toolCalls, toolCallId, thinking, tokensInput, tokensOutput, metadata } = request.body;

      loggers.routes.info({ userId, sessionId, role }, '[Agenticode] Adding message to session');

      if (codeModeSessionService) {
        const message = await codeModeSessionService.addMessage(sessionId, {
          role,
          content,
          toolCalls,
          toolCallId,
          thinking,
          tokensInput,
          tokensOutput,
          metadata,
        });

        return reply.status(201).send({ message });
      } else {
        // Fallback: use AWCodeStorageService directly
        const message = await awcodeStorageService.addMessage({
          sessionId,
          role,
          content: typeof content === 'string' ? content : JSON.stringify(content),
          toolCalls,
          thinking,
          tokensInput,
          tokensOutput,
          metadata,
        });
        return reply.status(201).send({ message });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to add message');
      return reply.status(500).send({
        error: 'Failed to add message',
        message: error.message
      });
    }
  });

  /**
   * GET /api/agenticode/sessions/:id/resume
   * Resume a session with context window
   * Returns session info and context-windowed messages for continuation
   * UAT Requirement: UC-032 Session Resumption
   */
  fastify.get<{
    Params: { id: string };
  }>('/sessions/:id/resume', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId, sessionId }, '[Agenticode] Resuming session');

      if (codeModeSessionService) {
        const result = await codeModeSessionService.resumeSession(sessionId, userId);

        if (!result) {
          return reply.status(404).send({ error: 'Session not found or access denied' });
        }

        return reply.send({
          session: result.session,
          contextWindow: {
            messages: result.contextWindow.messages,
            totalTokens: result.contextWindow.totalTokens,
            isCompacted: result.contextWindow.isCompacted,
            summaryIncluded: result.contextWindow.summaryIncluded,
          },
        });
      } else {
        // Fallback: get session and messages directly
        const session = await awcodeStorageService.getSession(sessionId);
        if (!session || session.user_id !== userId) {
          return reply.status(404).send({ error: 'Session not found or access denied' });
        }

        const messages = await awcodeStorageService.getSessionMessages(sessionId, 100);

        return reply.send({
          session: {
            id: session.id,
            userId: session.user_id,
            model: session.model,
            workspacePath: session.workspace_path,
            title: session.title,
            status: session.status,
            messageCount: session.message_count,
            totalTokens: session.total_tokens,
            createdAt: session.started_at,
            lastActivity: session.last_activity,
          },
          contextWindow: {
            messages: messages.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.tool_calls,
              thinking: m.thinking,
              createdAt: m.created_at,
            })),
            totalTokens: session.total_tokens || 0,
            isCompacted: false,
            summaryIncluded: false,
          },
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to resume session');
      return reply.status(500).send({
        error: 'Failed to resume session',
        message: error.message
      });
    }
  });

  /**
   * POST /api/agenticode/sessions/:id/compact
   * Manually trigger context compaction for a session
   * UAT Requirement: UC-032 Context Management
   */
  fastify.post<{
    Params: { id: string };
  }>('/sessions/:id/compact', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId, sessionId }, '[Agenticode] Compacting session context');

      if (codeModeSessionService) {
        const session = await codeModeSessionService.getSession(sessionId, userId);
        if (!session) {
          return reply.status(404).send({ error: 'Session not found or access denied' });
        }

        // Force context window computation which may trigger compaction
        const contextWindow = await codeModeSessionService.getContextWindow(sessionId, session.model);

        return reply.send({
          success: true,
          isCompacted: contextWindow.isCompacted,
          totalTokens: contextWindow.totalTokens,
          messageCount: contextWindow.messages.length,
        });
      } else {
        return reply.status(501).send({ error: 'Context compaction requires CodeModeSessionService' });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to compact session');
      return reply.status(500).send({
        error: 'Failed to compact session',
        message: error.message
      });
    }
  });

  /**
   * GET /api/agenticode/sessions/persisted
   * Get all persisted sessions for a user (from AWCodeSession table)
   * These are sessions with full message history
   * UAT Requirement: UC-032 Session History
   */
  fastify.get('/sessions/persisted', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId }, '[Agenticode] Getting persisted sessions');

      if (codeModeSessionService) {
        const sessions = await codeModeSessionService.getUserSessions(userId, 50);
        return reply.send({
          sessions,
          total: sessions.length,
        });
      } else {
        const sessions = await awcodeStorageService.getUserSessions(userId, 50);
        return reply.send({
          sessions: sessions.map(s => ({
            id: s.id,
            userId: s.user_id,
            model: s.model,
            workspacePath: s.workspace_path,
            title: s.title,
            status: s.status,
            messageCount: s.message_count || s._count?.messages || 0,
            totalTokens: s.total_tokens || 0,
            createdAt: s.started_at || s.created_at,
            lastActivity: s.last_activity,
          })),
          total: sessions.length,
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get persisted sessions');
      return reply.status(500).send({
        error: 'Failed to get sessions',
        message: error.message
      });
    }
  });

  /**
   * POST /api/agenticode/sessions/persisted
   * Create a new persisted session (with AWCodeSession storage)
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.post<{
    Body: {
      model?: string;
      workspacePath?: string;
      title?: string;
      metadata?: Record<string, any>;
    };
  }>('/sessions/persisted', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      const { model, workspacePath, title, metadata } = request.body;

      loggers.routes.info({ userId, model, workspacePath, title }, '[Agenticode] Creating persisted session');

      if (codeModeSessionService) {
        const session = await codeModeSessionService.createSession(userId, {
          model,
          workspacePath,
          title,
          metadata,
        });

        return reply.status(201).send({ session });
      } else {
        // Fallback: use AWCodeStorageService directly
        const { v4: uuidv4 } = await import('uuid');
        const sessionId = uuidv4();
        const session = await awcodeStorageService.createSession({
          id: sessionId,
          userId,
          workspacePath,
          model,
          title,
          metadata,
          status: 'running',
        });

        return reply.status(201).send({
          session: {
            id: session.id,
            userId: session.user_id,
            model: session.model,
            workspacePath: session.workspace_path,
            title: session.title,
            status: session.status,
            messageCount: 0,
            totalTokens: 0,
            createdAt: session.started_at || session.created_at,
            lastActivity: session.last_activity,
          },
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to create persisted session');
      return reply.status(500).send({
        error: 'Failed to create session',
        message: error.message
      });
    }
  });

  // ==========================================================================
  // Code-Server Routes (VS Code integration)
  // Proxies to agenticode-manager for per-session VS Code instances
  // ==========================================================================

  const AGENTICODE_MANAGER_URL = process.env.AGENTICODE_MANAGER_URL || 'http://agenticode-manager:3050';
  // Use CODE_MANAGER_INTERNAL_KEY from docker-compose, fallback to INTERNAL_API_KEY for compatibility
  const INTERNAL_API_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || process.env.INTERNAL_API_KEY || '';

  /**
   * GET /api/agenticode/sessions/:id/code-server
   * Get code-server status for a session
   */
  fastify.get<{
    Params: { id: string }
  }>('/sessions/:id/code-server', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      loggers.routes.info({ userId, sessionId }, '[Agenticode] Getting code-server status');

      const response = await fetch(`${AGENTICODE_MANAGER_URL}/sessions/${sessionId}/code-server`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': INTERNAL_API_KEY,
        },
      });

      const data = await response.json();
      return reply.status(response.status).send(data);
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get code-server status');
      return reply.status(500).send({
        error: 'Failed to get code-server status',
        message: error.message
      });
    }
  });

  /**
   * POST /api/agenticode/sessions/:id/code-server
   * Start code-server for a session
   */
  fastify.post<{
    Params: { id: string }
  }>('/sessions/:id/code-server', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      loggers.routes.info({ userId, sessionId }, '[Agenticode] Starting code-server');

      const response = await fetch(`${AGENTICODE_MANAGER_URL}/sessions/${sessionId}/code-server`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': INTERNAL_API_KEY,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();
      return reply.status(response.status).send(data);
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to start code-server');
      return reply.status(500).send({
        error: 'Failed to start code-server',
        message: error.message
      });
    }
  });

  /**
   * DELETE /api/agenticode/sessions/:id/code-server
   * Stop code-server for a session
   */
  fastify.delete<{
    Params: { id: string }
  }>('/sessions/:id/code-server', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      loggers.routes.info({ userId, sessionId }, '[Agenticode] Stopping code-server');

      const response = await fetch(`${AGENTICODE_MANAGER_URL}/sessions/${sessionId}/code-server`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': INTERNAL_API_KEY,
        },
      });

      const data = await response.json();
      return reply.status(response.status).send(data);
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to stop code-server');
      return reply.status(500).send({
        error: 'Failed to stop code-server',
        message: error.message
      });
    }
  });
};

export default agenticodeRoutes;
