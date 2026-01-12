import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ChatMessage } from '../interfaces/chat.types.js';

/**
 * Message Preparation Stage
 *
 * Focused on:
 * - Message deduplication (by ID, by pattern, by tool calls)
 * - Conversation validation
 * - Building clean message arrays for LLM
 */
export class MessagePreparationStage implements PipelineStage {
  readonly name = 'message-preparation';
  readonly priority = 45; // Run before completion (50)

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    // Build and deduplicate conversation messages
    const messages = this.buildConversationMessages(context);

    // CRITICAL FIX: ALWAYS validate message sequence, even for forceFinalCompletion
    // The forceFinalCompletion flag only affects whether we add the current user message,
    // but we MUST always validate to remove orphaned tool responses and incomplete cycles
    const validatedMessages = this.validateMessageSequence(messages);

    context.logger.info({
      rawCount: context.messages.length,
      builtCount: messages.length,
      validatedCount: validatedMessages.length,
      processingTime: Date.now() - startTime
    }, '[MESSAGE-PREP] Messages prepared for LLM');

    // Store prepared messages in context
    context.preparedMessages = validatedMessages;

    return context;
  }

  private buildConversationMessages(context: PipelineContext): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // Add system message
    if (context.systemPrompt) {
      messages.push({
        id: `system_${context.messageId}`,
        role: 'system',
        content: context.systemPrompt,
        timestamp: new Date(),
        tokenUsage: null
      });
    }

    // CRITICAL DEBUG: Log what's in context.messages BEFORE deduplication
    (context as any).logger?.info({
      contextMessagesCount: context.messages.length,
      messageRoles: context.messages.map(m => m.role).join(' → '),
      hasToolMessages: context.messages.filter(m => m.role === 'tool').length,
      hasAssistantWithToolCalls: context.messages.filter(m => m.role === 'assistant' && m.toolCalls).length,
      messageDetails: context.messages.map(m => ({
        role: m.role,
        hasContent: !!m.content,
        hasToolCalls: !!m.toolCalls,
        toolCallsCount: m.toolCalls?.length || 0,
        toolCallId: m.toolCallId
      }))
    }, '[MESSAGE-PREP] 🚨 BEFORE deduplication - context.messages state');

    // Deduplicate conversation
    const deduplicated = this.deduplicateConversation(
      context.messages,
      context.forceFinalCompletion || false
    );

    // CRITICAL DEBUG: Log what remains AFTER deduplication
    (context as any).logger?.info({
      deduplicatedCount: deduplicated.length,
      messageRoles: deduplicated.map(m => m.role).join(' → '),
      hasToolMessages: deduplicated.filter(m => m.role === 'tool').length,
      hasAssistantWithToolCalls: deduplicated.filter(m => m.role === 'assistant' && m.toolCalls).length,
      messageDetails: deduplicated.map(m => ({
        role: m.role,
        hasContent: !!m.content,
        hasToolCalls: !!m.toolCalls,
        toolCallsCount: m.toolCalls?.length || 0,
        toolCallId: m.toolCallId
      }))
    }, '[MESSAGE-PREP] 🚨 AFTER deduplication - messages remaining');

    messages.push(...deduplicated);

    // Add current user message if needed
    // CRITICAL FIX: Check if this EXACT user message already exists ANYWHERE in the conversation
    // This prevents duplicate user messages during tool calling rounds
    const currentMessageExists = messages.some(m =>
      m.role === 'user' &&
      (m.id === context.messageId || m.content === context.request.message)
    );

    const shouldAddUserMessage = !context.forceFinalCompletion && !currentMessageExists;

    if (shouldAddUserMessage) {
      messages.push({
        id: context.messageId,
        role: 'user',
        content: context.request.message,
        timestamp: new Date(),
        tokenUsage: null,
        attachments: context.request.attachments
      });
    }

    return messages;
  }

  /**
   * Remove duplicates:
   * 1. By message ID
   * 2. By consecutive user messages (keep only the last one - handles failed request retries)
   * 3. By conversation pattern (repeated user Q + assistant A)
   * 4. By tool calls
   */
  private deduplicateConversation(messages: ChatMessage[], preserveToolCalls: boolean): ChatMessage[] {
    // Step 1: Deduplicate by ID
    const seenIds = new Set<string>();
    const uniqueById = messages.filter(msg => {
      if (seenIds.has(msg.id)) return false;
      seenIds.add(msg.id);
      return true;
    });

    // Step 2: Deduplicate tool calls
    const deduplicatedToolCalls = this.deduplicateToolCalls(uniqueById, preserveToolCalls);

    // Step 3: Remove consecutive user messages without assistant response
    // This handles the case where a previous request failed after saving user message
    // but before generating assistant response - keep only the LAST user message in a sequence
    const withoutConsecutiveUsers: ChatMessage[] = [];
    for (let i = 0; i < deduplicatedToolCalls.length; i++) {
      const current = deduplicatedToolCalls[i];
      const next = deduplicatedToolCalls[i + 1];

      // If current is user and next is also user, skip current (keep the later one)
      if (current.role === 'user' && next?.role === 'user') {
        // Log the skip for debugging
        (this as any).logger?.info({
          skippedUserId: current.id,
          skippedContent: current.content?.substring(0, 50),
          keptUserId: next.id,
          reason: 'consecutive_user_messages'
        }, '[MESSAGE-PREP] ⏭️  Skipping orphaned user message (no assistant response, newer message exists)');
        continue;
      }

      withoutConsecutiveUsers.push(current);
    }

    // Step 4: Remove repeated conversation patterns
    const conversationSignatures = new Set<string>();
    const finalMessages: ChatMessage[] = [];

    for (let i = 0; i < withoutConsecutiveUsers.length; i++) {
      const current = withoutConsecutiveUsers[i];

      if (current.role === 'user') {
        const next = withoutConsecutiveUsers[i + 1];
        if (next && next.role === 'assistant') {
          const signature = `${current.content}|||${next.content}|||${next.toolCalls?.length || 0}`;

          if (conversationSignatures.has(signature)) {
            i++; // Skip both user and assistant message
            continue;
          }
          conversationSignatures.add(signature);
        }
      }

      finalMessages.push(current);
    }

    return finalMessages;
  }

  /**
   * Deduplicate tool calls - keep only unique tool call IDs
   * CRITICAL: Tool responses (role='tool') are DIFFERENT from tool call definitions (assistant.toolCalls)
   * We track them separately to avoid deleting results!
   *
   * CRITICAL TOOL CALLING FIX: When a tool cycle is COMPLETE (assistant+tool_calls → tools → synthesis),
   * we EXCLUDE the tool_calls assistant and tool messages from history, keeping only the synthesis.
   *
   * WHY: The OpenAI tool calling format (which our providers support)
   * requires tool messages to IMMEDIATELY follow the assistant that made the calls:
   *   ✅ VALID:   assistant+tool_calls → tool responses → [next turn]
   *   ❌ INVALID: assistant+tool_calls → assistant(synthesis) → tool responses
   *
   * All LLM providers (ChatGPT, Claude, Gemini, etc.) expect this strict ordering.
   * Once we have synthesis text, we can remove the raw tool call/response pattern from history.
   */
  private deduplicateToolCalls(messages: ChatMessage[], preserveToolCalls: boolean): ChatMessage[] {
    const result: ChatMessage[] = [];
    const seenToolCallIds = new Set<string>();  // Track assistant messages with tool_calls
    const seenToolResponseIds = new Set<string>();  // Track tool response messages (role='tool')
    const toolCallsWithResponses = new Set<string>();

    // Find which tool calls have responses
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.toolCallId) {
        toolCallsWithResponses.add(msg.toolCallId);
      }
    }

    // DISABLED: Completed tool cycle collapse - was removing tool calls from UI
    // TODO: Need to separate LLM context (collapsed) from frontend display (full)
    // Detect completed tool cycles
    // Pattern: assistant+tool_calls → (tool responses) → assistant(synthesis)
    // For completed cycles, we want to SKIP the tool_calls assistant and tool responses,
    // keeping ONLY the synthesis assistant (which contains the human-readable explanation)
    const completedToolCallIds = new Set<string>();
    // for (let i = 0; i < messages.length; i++) {
    //   const msg = messages[i];

    //   // Found assistant with tool_calls
    //   if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    //     // Look ahead for synthesis assistant
    //     let foundSynthesis = false;

    //     for (let j = i + 1; j < messages.length; j++) {
    //       const nextMsg = messages[j];

    //       // If we hit another user message, stop looking
    //       if (nextMsg.role === 'user') break;

    //       // Found synthesis assistant (has content, no/empty tool_calls)
    //       if (nextMsg.role === 'assistant' && nextMsg.content &&
    //           (!nextMsg.toolCalls || nextMsg.toolCalls.length === 0)) {
    //         foundSynthesis = true;
    //         break;
    //       }
    //     }

    //     // If synthesis exists, mark these tool calls as "completed" to exclude them
    //     if (foundSynthesis) {
    //       msg.toolCalls.forEach(tc => completedToolCallIds.add(tc.id));
    //     }
    //   }
    // }

    // Filter messages
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // Remove duplicate tool calls within message
        const uniqueToolCalls = Array.from(
          new Map(msg.toolCalls.map(tc => [tc.id, tc])).values()
        );

        // Keep only tool calls with responses
        const validToolCalls = uniqueToolCalls.filter(tc =>
          toolCallsWithResponses.has(tc.id)
        );

        // DISABLED: Skip assistant+tool_calls if this cycle is completed (has synthesis)
        // The synthesis message provides the human-readable context, making the raw
        // tool calls/responses redundant and problematic for message ordering
        // const isCompleted = validToolCalls.every(tc => completedToolCallIds.has(tc.id));
        // if (isCompleted && validToolCalls.length > 0) {
        //   // Skip this assistant - the synthesis will be included instead
        //   validToolCalls.forEach(tc => seenToolCallIds.add(tc.id));
        //   continue;
        // }

        if (validToolCalls.length > 0) {
          const hasSeenToolCalls = validToolCalls.some(tc => seenToolCallIds.has(tc.id));

          if (!hasSeenToolCalls) {
            validToolCalls.forEach(tc => seenToolCallIds.add(tc.id));
            result.push({
              ...msg,
              content: msg.content || '',
              toolCalls: validToolCalls
            });
          }
        } else if (msg.content) {
          // No valid tool calls, but has content
          if (preserveToolCalls) {
            result.push(msg);
          } else {
            const msgCopy = { ...msg };
            delete msgCopy.toolCalls;
            result.push(msgCopy);
          }
        }
      } else if (msg.role === 'tool' && msg.toolCallId) {
        // DISABLED: Skip tool responses for completed cycles (synthesis represents them now)
        // if (completedToolCallIds.has(msg.toolCallId)) {
        //   seenToolResponseIds.add(msg.toolCallId);
        //   continue;  // Skip - synthesis message will represent this
        // }

        // Use separate set for tool RESPONSES vs tool CALLS
        // The assistant message added the call ID to seenToolCallIds
        // But the tool RESPONSE is different - track it separately!
        if (!seenToolResponseIds.has(msg.toolCallId)) {
          seenToolResponseIds.add(msg.toolCallId);
          result.push(msg);
        }
      } else if (msg.role === 'assistant') {
        // Assistant messages with content but NO toolCalls (or empty toolCalls)
        // should have the toolCalls property removed entirely
        // OpenAI format expects assistant messages to have EITHER tool_calls OR content, not both
        const msgCopy = { ...msg };
        if (msgCopy.toolCalls && msgCopy.toolCalls.length === 0) {
          delete msgCopy.toolCalls;
        }
        result.push(msgCopy);
      } else {
        result.push(msg);
      }
    }

    return result;
  }

  /**
   * Validate that tool messages have proper tool_call_id references
   *
   * CRITICAL TOOL CALLING FIX:
   * OpenAI/Azure AI Foundry requires that EVERY tool_call in an assistant message
   * has a corresponding tool response message. If ANY tool_call is missing its response,
   * the entire request will fail with a 400 error.
   *
   * This function ensures:
   * 1. Every assistant message with tool_calls has ALL corresponding tool responses
   * 2. Orphaned tool messages (without assistant+tool_calls) are removed
   * 3. Assistant messages with incomplete tool responses are REMOVED to prevent API errors
   */
  private validateMessageSequence(messages: ChatMessage[]): ChatMessage[] {
    const validatedMessages: ChatMessage[] = [];
    const assistantWithToolCalls: Map<string, { message: ChatMessage; index: number }> = new Map();
    const toolResponsesByCallId: Map<string, ChatMessage> = new Map();

    // PASS 1: Index all assistant messages with tool_calls and all tool responses
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // Track each tool_call ID from this assistant message
        msg.toolCalls.forEach(tc => {
          assistantWithToolCalls.set(tc.id, { message: msg, index: i });
        });
      } else if (msg.role === 'tool' && msg.toolCallId) {
        // Track tool responses
        toolResponsesByCallId.set(msg.toolCallId, msg);
      }
    }

    // DIAGNOSTIC: Log what we indexed
    (this as any).logger?.info({
      totalMessages: messages.length,
      assistantWithToolCallsCount: assistantWithToolCalls.size,
      toolResponsesCount: toolResponsesByCallId.size,
      assistantToolCallIds: Array.from(assistantWithToolCalls.keys()),
      toolResponseIds: Array.from(toolResponsesByCallId.keys())
    }, '[MESSAGE-PREP] 🔍 PASS 1 complete - indexed assistant tool_calls and tool responses');

    // PASS 2: Build validated message array, removing incomplete tool call cycles
    const assistantsToSkip = new Set<ChatMessage>();
    const toolCallIdsToSkip = new Set<string>();

    // Check each assistant message with tool_calls for completeness
    const processedAssistants = new Set<ChatMessage>();
    for (const [toolCallId, { message: assistantMsg }] of assistantWithToolCalls) {
      if (processedAssistants.has(assistantMsg)) continue;
      processedAssistants.add(assistantMsg);

      // Check if ALL tool_calls from this assistant have responses
      const missingResponses: string[] = [];
      for (const tc of assistantMsg.toolCalls!) {
        if (!toolResponsesByCallId.has(tc.id)) {
          missingResponses.push(tc.id);
        }
      }

      if (missingResponses.length > 0) {
        // CRITICAL: This assistant message has incomplete tool responses
        // Remove BOTH the assistant message AND any tool responses that DO exist
        (this as any).logger?.warn({
          assistantMessageId: assistantMsg.id,
          totalToolCalls: assistantMsg.toolCalls!.length,
          missingToolCallIds: missingResponses,
          missingCount: missingResponses.length
        }, '[MESSAGE-PREP] ⚠️ REMOVING assistant with incomplete tool responses to prevent API error');

        assistantsToSkip.add(assistantMsg);
        // Also skip all tool responses for this assistant (even the ones that exist)
        assistantMsg.toolCalls!.forEach(tc => toolCallIdsToSkip.add(tc.id));
      }
    }

    // PASS 3: Build final validated message array
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // Skip assistant messages with incomplete tool responses
        if (assistantsToSkip.has(msg)) {
          (this as any).logger?.info({
            assistantMessageId: msg.id,
            toolCallsCount: msg.toolCalls.length,
            reason: 'incomplete_tool_responses'
          }, '[MESSAGE-PREP] ⏭️  Skipping assistant with incomplete tool responses');
          continue;
        }
        validatedMessages.push(msg);
      } else if (msg.role === 'tool') {
        // Skip tool messages without toolCallId
        if (!msg.toolCallId) {
          (this as any).logger?.info({
            toolMessageId: msg.id,
            reason: 'missing_toolCallId'
          }, '[MESSAGE-PREP] ⏭️  Skipping tool message without toolCallId');
          continue;
        }

        // Skip tool messages for incomplete tool call cycles
        if (toolCallIdsToSkip.has(msg.toolCallId)) {
          (this as any).logger?.info({
            toolMessageId: msg.id,
            toolCallId: msg.toolCallId,
            reason: 'incomplete_cycle'
          }, '[MESSAGE-PREP] ⏭️  Skipping tool message from incomplete cycle');
          continue;
        }

        // CRITICAL FIX: Skip orphaned tool messages (no corresponding assistant+tool_calls)
        // This happens when deduplication removes the assistant but leaves the tool response
        if (!assistantWithToolCalls.has(msg.toolCallId)) {
          (this as any).logger?.warn({
            toolMessageId: msg.id,
            toolCallId: msg.toolCallId,
            reason: 'orphaned_tool_response'
          }, '[MESSAGE-PREP] ⚠️ REMOVING orphaned tool response (assistant message was deduplicated)');
          continue;
        }

        validatedMessages.push(msg);
      } else {
        validatedMessages.push(msg);
      }
    }

    return validatedMessages;
  }

  async rollback(context: PipelineContext): Promise<void> {
    delete context.preparedMessages;
    context.logger.debug('Message preparation rollback completed');
  }
}
