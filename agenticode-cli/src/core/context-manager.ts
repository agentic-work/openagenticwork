/**
 * Context Manager
 * Handles context window management, token counting, and automatic summarization
 * Context limits are fetched from AgenticWork API - not hardcoded
 */

import type { Message } from './types.js';

// Context limits are fetched from AgenticWork API per model
// This is just a fallback default if API is unavailable
const DEFAULT_CONTEXT_LIMIT = 32768;

// Cache for model context limits from API
let cachedContextLimits: Record<string, number> = {};

/**
 * Fetch context limits from AgenticWork API
 */
export async function fetchContextLimits(apiEndpoint?: string): Promise<void> {
  const endpoint = apiEndpoint || process.env.AGENTIC_API_ENDPOINT;

  // If no endpoint configured, skip - use defaults
  if (!endpoint) {
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${endpoint}/api/models/limits`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json() as { limits: Record<string, number> };
      cachedContextLimits = data.limits;
    }
  } catch {
    // Use defaults if API unavailable
  }
}

/**
 * Get context limit for a model (from API cache or default)
 */
function getModelContextLimit(model: string): number {
  // Check exact match first
  if (cachedContextLimits[model]) {
    return cachedContextLimits[model];
  }

  // Check for partial match (e.g., "ollama/devstral" matches "devstral")
  const normalizedModel = model.toLowerCase().replace('ollama/', '');
  for (const [key, limit] of Object.entries(cachedContextLimits)) {
    if (normalizedModel.includes(key.toLowerCase())) {
      return limit;
    }
  }

  return DEFAULT_CONTEXT_LIMIT;
}

// Reserve tokens for response
const RESPONSE_RESERVE = 4096;

// When to trigger summarization (percentage of context used)
const SUMMARIZATION_THRESHOLD = 0.75;

export interface ContextStats {
  totalTokens: number;
  contextLimit: number;
  usagePercent: number;
  messagesCount: number;
  shouldSummarize: boolean;
}

export interface ContextEvent {
  type: 'token_update' | 'approaching_limit' | 'summarizing' | 'summarized';
  stats: ContextStats;
  message?: string;
}

export type ContextEventHandler = (event: ContextEvent) => void;

export class ContextManager {
  private model: string;
  private contextLimit: number;
  private currentTokens: number = 0;
  private eventHandlers: ContextEventHandler[] = [];

  constructor(model: string, contextLimit?: number) {
    this.model = model;
    // Use provided limit, or fetch from cache, or use default
    this.contextLimit = contextLimit || getModelContextLimit(model);
  }

  /**
   * Subscribe to context events
   */
  onEvent(handler: ContextEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit a context event
   */
  private emit(event: ContextEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  /**
   * Estimate token count for text (rough approximation)
   * ~4 chars per token for English text
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate total tokens for messages
   */
  calculateTokens(messages: Message[]): number {
    let total = 0;

    for (const msg of messages) {
      // Role overhead
      total += 4;

      // Content
      if (typeof msg.content === 'string') {
        total += this.estimateTokens(msg.content);
      } else {
        for (const part of msg.content) {
          if (part.text) {
            total += this.estimateTokens(part.text);
          }
        }
      }

      // Tool calls overhead
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += this.estimateTokens(tc.name);
          total += this.estimateTokens(JSON.stringify(tc.arguments));
        }
      }
    }

    return total;
  }

  /**
   * Update token count and check thresholds
   */
  updateTokens(messages: Message[]): ContextStats {
    this.currentTokens = this.calculateTokens(messages);

    const stats = this.getStats(messages);

    // Emit token update
    this.emit({
      type: 'token_update',
      stats,
    });

    // Check if approaching limit
    if (stats.shouldSummarize) {
      this.emit({
        type: 'approaching_limit',
        stats,
        message: `Context usage at ${(stats.usagePercent * 100).toFixed(0)}%. Consider summarizing.`,
      });
    }

    return stats;
  }

  /**
   * Get current context statistics
   */
  getStats(messages: Message[]): ContextStats {
    const totalTokens = this.currentTokens || this.calculateTokens(messages);
    const availableTokens = this.contextLimit - RESPONSE_RESERVE;
    const usagePercent = totalTokens / availableTokens;

    return {
      totalTokens,
      contextLimit: this.contextLimit,
      usagePercent,
      messagesCount: messages.length,
      shouldSummarize: usagePercent >= SUMMARIZATION_THRESHOLD,
    };
  }

  /**
   * Create a summary of conversation history
   * Returns a condensed message array suitable for continuing the conversation
   */
  async summarize(
    messages: Message[],
    summarizer: (prompt: string) => Promise<string>
  ): Promise<Message[]> {
    this.emit({
      type: 'summarizing',
      stats: this.getStats(messages),
      message: 'Summarizing conversation history...',
    });

    // Keep system message if present
    const systemMessage = messages.find(m => m.role === 'system');

    // Keep the last few messages for immediate context
    // IMPORTANT: Don't cut in the middle of tool call sequences!
    let recentMessages = messages.slice(-6);

    // Step 1: Find all tool_call_ids referenced in tool messages within recent
    const referencedToolCallIds = new Set<string>();
    for (const msg of recentMessages) {
      if (msg.role === 'tool' && msg.toolCallId) {
        referencedToolCallIds.add(msg.toolCallId);
      }
    }

    // Step 2: Expand backwards to include assistant messages with matching toolCalls
    if (referencedToolCallIds.size > 0) {
      const startIdx = messages.indexOf(recentMessages[0]);
      for (let i = startIdx - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.toolCalls) {
          const hasMatchingToolCall = msg.toolCalls.some(tc => referencedToolCallIds.has(tc.id));
          if (hasMatchingToolCall) {
            // Include this assistant message and add its tool_call IDs
            recentMessages = [msg, ...recentMessages];
            for (const tc of msg.toolCalls) {
              referencedToolCallIds.add(tc.id);
            }
          }
        }
        // Stop if we've gone back too far (max 10 extra messages)
        if (recentMessages.length >= 16) break;
      }
    }

    // Step 3: Collect all valid tool_call IDs from assistant messages in recent
    const validToolCallIds = new Set<string>();
    for (const msg of recentMessages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          validToolCallIds.add(tc.id);
        }
      }
    }

    // Step 4: Filter out orphan tool messages (no matching tool_call)
    recentMessages = recentMessages.filter(msg => {
      if (msg.role === 'tool' && msg.toolCallId) {
        if (!validToolCallIds.has(msg.toolCallId)) {
          console.warn(`[ContextManager] Removing orphan tool message with toolCallId: ${msg.toolCallId}`);
          return false;
        }
      }
      return true;
    });

    // Get messages to summarize (excluding system and recent)
    const toSummarize = messages.filter(
      m => m.role !== 'system' && !recentMessages.includes(m)
    );

    if (toSummarize.length < 4) {
      // Not enough to summarize
      return messages;
    }

    // Build summary prompt
    const conversationText = toSummarize
      .map(m => {
        const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${role}: ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`;
      })
      .join('\n\n');

    const summaryPrompt = `Summarize the following conversation history concisely, preserving:
1. Key decisions and outcomes
2. Important file paths and code changes
3. Any errors encountered and how they were resolved
4. Current state/progress of the task

Conversation:
${conversationText}

Summary:`;

    try {
      const summary = await summarizer(summaryPrompt);

      // Build new message array
      const summarized: Message[] = [];

      if (systemMessage) {
        summarized.push(systemMessage);
      }

      // Add summary as a system message
      summarized.push({
        role: 'system',
        content: `[Previous conversation summary]\n${summary}\n[End of summary - conversation continues below]`,
      });

      // Add recent messages
      summarized.push(...recentMessages);

      const newStats = this.getStats(summarized);

      this.emit({
        type: 'summarized',
        stats: newStats,
        message: `Summarized ${toSummarize.length} messages. New context: ${newStats.totalTokens} tokens.`,
      });

      return summarized;
    } catch (error) {
      // If summarization fails, return truncated history
      console.error('Summarization failed:', error);
      const truncated = systemMessage
        ? [systemMessage, ...recentMessages]
        : recentMessages;
      return truncated;
    }
  }

  /**
   * Update model and recalculate limits
   */
  setModel(model: string, contextLimit?: number): void {
    this.model = model;
    this.contextLimit = contextLimit || getModelContextLimit(model);
  }

  /**
   * Get the available tokens for new content
   */
  getAvailableTokens(): number {
    return Math.max(0, this.contextLimit - RESPONSE_RESERVE - this.currentTokens);
  }
}
