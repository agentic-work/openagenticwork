/**
 * useSSEChat Hook
 * Server-Sent Events (SSE) implementation for real-time chat streaming
 * Features: Message streaming, pipeline state tracking, error recovery, MCP tool handling
 * Pipeline stages: auth → validation → prompt → mcp → completion → response
 * Methods:
 * - sendMessage: Sends user message and initiates SSE stream
 * - stopStreaming: Aborts current stream
 * - resetError: Clears error state
 * Handles: Token usage tracking, thinking blocks, tool calls, message formatting
 * @see docs/chat/streaming-architecture.md
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiEndpoint } from '@/utils/api';

import { formatAgentMessage, addVisualEnhancements } from '@/utils/messageFormatter';
import { useAuth } from '@/app/providers/AuthContext';
import { ChatMessage } from '@/types/index';
import { useChatStore } from '@/stores/useChatStore';

// Pipeline stages from ChatPipeline backend
export type PipelineStage = 'auth' | 'validation' | 'prompt' | 'mcp' | 'completion' | 'response';

// Pipeline state to track current processing phase
export interface PipelineState {
  currentStage: PipelineStage | null;
  stageStartTime: number | null;
  stageTiming: Record<string, number>;
  isToolExecutionPhase: boolean;
  activeToolRound: number;
  maxToolRounds: number;
  bufferedContent: string;
  shouldSuppressContent: boolean;
}

// Animation modes for streaming - simplified
export type AnimationMode = 'smooth' | 'none';

// Content block for interleaved thinking
// Each block can be either thinking or text, rendered in order
export interface ContentBlock {
  index: number;
  type: 'thinking' | 'text' | 'tool_use';
  content: string;
  isComplete: boolean;
  toolName?: string;
  toolId?: string;
}

// Pipeline-aware event types that match backend ChatPipeline
interface PipelineEvents {
  'pipeline:start': { messageId: string; stage: PipelineStage };
  'pipeline:stage': { stage: PipelineStage; data: any };
  'pipeline:tool_round': { round: number; maxRounds: number };
  'pipeline:content_suppressed': { stage: PipelineStage; reason: string };
  'pipeline:complete': { metrics: any };
}

// Create initial pipeline state
const createInitialPipelineState = (): PipelineState => ({
  currentStage: null,
  stageStartTime: null,
  stageTiming: {},
  isToolExecutionPhase: false,
  activeToolRound: 0,
  maxToolRounds: 5, // Match backend maxToolCallRounds
  bufferedContent: '',
  shouldSuppressContent: false
});

// Determine if content should be suppressed based on pipeline stage
const shouldSuppressContentForStage = (stage: PipelineStage | null, toolRound: number): boolean => {
  if (!stage) return false;
  
  // Suppress content during tool execution phases
  if (stage === 'mcp' && toolRound > 0) return true;
  
  // Allow content during final completion phase
  if (stage === 'completion' || stage === 'response') return false;
  
  // Suppress during early stages
  if (stage === 'auth' || stage === 'validation' || stage === 'prompt') return true;
  
  return false;
};

// Map backend stage names to our pipeline stages
const mapBackendStage = (eventType: string): PipelineStage | null => {
  switch (eventType) {
    case 'auth_start':
    case 'auth_complete':
      return 'auth';
    case 'validation_start':
    case 'validation_complete':
      return 'validation';
    case 'prompt_start':
    case 'prompt_complete':
    case 'prompt_engineering':
      return 'prompt';
    case 'mcp_start':
    case 'mcp_complete':
    case 'tool_execution_start':
    case 'tool_execution_complete':
    case 'completion_restart':
    case 'tool_executing':
    case 'tool_result':
    case 'tool_call_delta':
      return 'mcp';
    case 'completion_start':
    case 'completion_complete':
      return 'completion';
    case 'response_start':
    case 'stream_complete':
    case 'done':
      return 'response';
    default:
      return null;
  }
};

// Get animation mode from user preferences
const getAnimationMode = (): AnimationMode => {
  if (typeof window === 'undefined') return 'none';
  
  const saved = localStorage.getItem('chat-animation-mode');
  if (saved === 'smooth' || saved === 'none') return saved;
  
  // Default to smooth for better UX now that we have proper pipeline awareness
  return 'smooth';
};

// Extract thinking blocks and return both cleaned content and thinking
function extractAndCleanThinkingBlocks(content: string): { cleaned: string; thinking: string } {
  let cleanContent = content;
  const thinkingParts: string[] = [];

  // Extract and remove <thinking> blocks
  let match;
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
  while ((match = thinkingRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(thinkingRegex, '');

  // Extract and remove <reasoning> blocks
  const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/g;
  while ((match = reasoningRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(reasoningRegex, '');

  // Extract and remove <tool_code> blocks
  const toolCodeRegex = /<tool_code>([\s\S]*?)<\/tool_code>/g;
  while ((match = toolCodeRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(toolCodeRegex, '');

  // Clean up any extra whitespace
  cleanContent = cleanContent.trim().replace(/\n{3,}/g, '\n\n');

  return {
    cleaned: cleanContent,
    thinking: thinkingParts.join('\n\n---\n\n')
  };
}

// Backward compatibility wrapper
function cleanThinkingBlocks(content: string): string {
  return extractAndCleanThinkingBlocks(content).cleaned;
}

export interface UseSSEChatOptions {
  sessionId: string;
  onMessage?: (message: ChatMessage) => void;
  onToolExecution?: (tool: any) => void;
  onToolApprovalRequest?: (data: { tools: any[]; toolCallRound: number; messageId: string }) => void;
  onError?: (error: Error) => void;
  onThinking?: (status: string) => void;
  onThinkingContent?: (content: string, tokens?: number) => void;  // For actual thinking content
  onThinkingComplete?: () => void;  // When thinking finishes
  onMultiModel?: (event: { type: string; orchestrationId?: string; executionPlan?: string[]; fromModel?: string; toModel?: string; role?: string; rolesExecuted?: string[]; totalCost?: number }) => void;  // Multi-model orchestration events
  onStream?: (content: string) => void;
  onPipelineStage?: (stage: PipelineStage, data?: any) => void;
  onToolRound?: (round: number, maxRounds: number) => void;
  autoApproveTools?: boolean;
}

export const useSSEChat = ({
  sessionId,
  onMessage,
  onToolExecution,
  onToolApprovalRequest,
  onError,
  onThinking,
  onThinkingContent,
  onThinkingComplete,
  onMultiModel,
  onStream,
  onPipelineStage,
  onToolRound,
  autoApproveTools = true
}: UseSSEChatOptions) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [isThinkingCompleted, setIsThinkingCompleted] = useState(false); // Tracks if thinking phase has finished
  const currentThinkingRef = useRef(''); // Ref to capture thinking at message completion time

  // Interleaved content blocks - renders thinking/text in order
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const contentBlocksRef = useRef<ContentBlock[]>([]); // Ref for closure access
  const currentThinkingBlockIndexRef = useRef<number | null>(null); // Track active thinking block for interleaved display
  const currentTextBlockIndexRef = useRef<number | null>(null); // Track active text block for interleaved display
  const [thinkingMetrics, setThinkingMetrics] = useState<{
    tokens: number;
    elapsedMs: number;
    tokensPerSecond: number;
  } | null>(null);
  const previousSessionIdRef = useRef<string | null>(null); // Track session changes
  // TTFT (Time to First Token) tracking for debugging slow responses
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  // Chain of Thought steps for COT UI display
  const [cotSteps, setCotSteps] = useState<Array<{
    id: string;
    type: 'thinking' | 'tool_call' | 'rag_lookup' | 'fetch' | 'memory' | 'reasoning';
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    startTime?: number;
    endTime?: number;
    request?: any;
    response?: any;
    error?: string;
  }>>([]);
  // Ref to capture cotSteps at message completion time (for closure access)
  const cotStepsRef = useRef<typeof cotSteps>([]);
  const [pipelineState, setPipelineState] = useState<PipelineState>(createInitialPipelineState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { getAccessToken, user } = useAuth();
  const [animationMode, setAnimationMode] = useState<AnimationMode>(getAnimationMode());

  // Keep refs in sync with state for capturing at completion time
  useEffect(() => {
    currentThinkingRef.current = currentThinking;
  }, [currentThinking]);

  // Keep cotSteps ref in sync for closure access in done handler
  useEffect(() => {
    cotStepsRef.current = cotSteps;
  }, [cotSteps]);

  // Keep contentBlocks ref in sync for closure access
  useEffect(() => {
    contentBlocksRef.current = contentBlocks;
  }, [contentBlocks]);

  // CRITICAL FIX: Reset thinking state when session changes
  // This prevents thinking displays from persisting across sessions
  useEffect(() => {
    if (previousSessionIdRef.current !== null && previousSessionIdRef.current !== sessionId) {
      // Session changed - reset all thinking/streaming state
      console.log('[SSE] Session changed, resetting thinking state:', {
        from: previousSessionIdRef.current,
        to: sessionId
      });
      setCurrentThinking('');
      setCurrentMessage('');
      setIsThinkingCompleted(false);
      setThinkingMetrics(null);
      setCotSteps([]);
      setContentBlocks([]); // Reset interleaved content blocks
      setPipelineState(createInitialPipelineState());
      currentThinkingRef.current = '';
      cotStepsRef.current = [];
      contentBlocksRef.current = [];
      currentThinkingBlockIndexRef.current = null; // Reset thinking block tracking
      currentTextBlockIndexRef.current = null; // Reset text block tracking
    }
    previousSessionIdRef.current = sessionId;
  }, [sessionId]);

  const sendMessage = useCallback(async (
    message: string,
    options?: {
      model?: string;
      enabledTools?: string[];
      files?: any[];
      promptTechniques?: string[];
      enableExtendedThinking?: boolean;
    }
  ) => {
    // Critical debug logging
    // console.log('[SSE] sendMessage called with:', { message, sessionId, options });
    
    // Validate sessionId before attempting to send
    if (!sessionId || sessionId.trim() === '') {
      console.error('[SSE] Cannot send message - no sessionId provided');
      setIsStreaming(false);
      if (onError) {
        onError(new Error('No session ID provided'));
      }
      return;
    }
    
    // CRITICAL FIX: Save current streaming message BEFORE clearing it
    // If there's a streaming message in progress, finalize it first to prevent message loss
    if (currentMessage && onMessage) {
      // console.log('[SSE] Finalizing previous streaming message before starting new one');
      onMessage({
        id: `streaming_${Date.now()}`,
        role: 'assistant',
        content: currentMessage,
        timestamp: new Date().toISOString(),
        mcpCalls: [],
        metadata: { streamingInterrupted: true }
      });
    }

    // Abort any existing stream and wait briefly to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      // Small delay to ensure cleanup is complete before creating new controller
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Additional safety check - if the controller was somehow aborted immediately, recreate it
    if (abortController.signal.aborted) {
      // console.warn('[SSE] AbortController was aborted immediately, creating new one');
      const newController = new AbortController();
      abortControllerRef.current = newController;
    }

    setIsStreaming(true);
    setCurrentMessage('');
    setCurrentThinking('');
    setContentBlocks([]); // Reset interleaved content blocks for new message
    contentBlocksRef.current = [];
    setIsThinkingCompleted(false); // Reset thinking completion flag
    setThinkingMetrics(null);
    setTtftMs(null); // Reset TTFT for new message
    setCotSteps([]); // Clear COT steps for new message
    setPipelineState(createInitialPipelineState());
    
    try {
      // Get access token - try multiple auth methods
      let token;
      try {
        token = await getAccessToken(['User.Read']);
      } catch (error) {
        console.error('[SSE] getAccessToken failed:', error);
        // Fallback to manual token retrieval
        token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
      }
      
      if (!token) {
        console.error('[SSE] No authentication token available');
        throw new Error('Authentication required - no token available');
      }

      // Critical debug logging - always log this fetch attempt
      // console.log('[SSE] About to send fetch request to:', apiEndpoint('/chat/stream'), {
      //   sessionId,
      //   model: options?.model,
      //   hasToken: !!token,
      //   tokenLength: token?.length,
      //   userId: user?.id || user?.oid,
      //   fullPayload: {
      //     sessionId,
      //     message,
      //     model: options?.model,
      //     enabledTools: options?.enabledTools || [],
      //     autoApproveTools,
      //     files: options?.files,
      //     promptTechniques: options?.promptTechniques || []
      //   }
      // });

      // console.log('[SSE] FETCH REQUEST STARTING NOW - URL:', apiEndpoint('/chat/stream'));
      // console.log('[SSE] FETCH REQUEST HEADERS:', {
      //   'Content-Type': 'application/json',
      //   'Authorization': token ? `Bearer ${token.substring(0, 20)}...` : 'NO TOKEN',
      //   'x-user-id': user?.id || user?.oid
      // });
      
      const response = await fetch(apiEndpoint('/chat/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-user-id': user?.id || user?.oid,
          // CRITICAL: Tell browser/proxy not to cache this SSE stream
          'Cache-Control': 'no-cache',
          // CRITICAL: Accept SSE event stream
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          sessionId,
          message,
          model: options?.model,
          enabledTools: options?.enabledTools || [],
          autoApproveTools,
          files: options?.files,
          promptTechniques: options?.promptTechniques || [],
          enableExtendedThinking: options?.enableExtendedThinking
        }),
        signal: abortControllerRef.current?.signal,
        // CRITICAL: Disable browser caching for SSE
        cache: 'no-store'
      });
      
      // SSE response logging - disabled in production to reduce console noise
      // console.log('[SSE] FETCH REQUEST COMPLETED - Response received:', {
      //   status: response.status,
      //   ok: response.ok,
      //   statusText: response.statusText,
      //   contentType: response.headers.get('content-type'),
      //   hasBody: !!response.body
      // });

      // Log errors
      if (!response.ok) {
        console.error('[SSE] Response error:', {
          status: response.status,
          ok: response.ok
        });
      }
      
      if (!response.ok) {
        console.error('[SSE] HTTP ERROR - Response not ok:', {
          status: response.status,
          statusText: response.statusText
        });
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No response body');
      }
      
      let assistantMessage = '';
      let messageId = '';
      let mcpCalls: any[] = [];
      let chunkCount = 0;
      let currentPipelineState = createInitialPipelineState();
      let hasCompletedStream = false; // Guard against duplicate done events
      let hasReportedError = false; // Guard against duplicate error messages (fixes 3x error display)
      let responseModel = options?.model || ''; // Track which model was used for this response (fallback to requested model)
      
      // Add stream timeout handling
      const STREAM_TIMEOUT = 5 * 60 * 1000; // 5 minutes
      const streamTimeout = setTimeout(() => {
        // console.warn('[SSE] Stream timeout after 5 minutes');
        abortControllerRef.current?.abort();
        onError?.(new Error('Stream timeout - no response received within 5 minutes'));
      }, STREAM_TIMEOUT);
      
      // Proper SSE parsing that doesn't break on JSON boundaries
      let buffer = '';
      let eventType = '';
      let eventData = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            clearTimeout(streamTimeout);
            if (import.meta.env.DEV) {
              // console.log('[SSE] Stream complete, total chunks:', chunkCount);
            }
            break;
          }
        
        chunkCount++;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Chunk reception logging - disabled in production
        // if (chunkCount === 1 || chunkCount % 10 === 0) {
        //   console.log(`[SSE] Received chunk #${chunkCount}, size: ${chunk.length} bytes`);
        // }

        // SSE uses double newline as event separator - this prevents JSON boundary splits
        const eventStrings = buffer.split('\n\n');
        
        // Keep the last incomplete event in buffer
        buffer = eventStrings.pop() || '';
        
        for (const eventString of eventStrings) {
          if (!eventString.trim()) continue;
          
          const lines = eventString.split('\n');
          let eventType = null;
          let eventData = '';
          
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              // Accumulate data lines (SSE allows multiple data: lines)
              eventData += line.slice(6);
            }
          }
          
          if (eventData) {
            try {
              const parsedData = JSON.parse(eventData);
              // Create a deep defensive copy to avoid "object is not extensible" errors
              const safeData = JSON.parse(JSON.stringify(parsedData));

              // SSE event logging - disabled in production to reduce console noise
              // Enable by uncommenting for debugging streaming issues
              // console.log(`[SSE-DEBUG] Event received - Type: "${eventType}"`, safeData);

              // Only log specific events in dev when needed for debugging
              // if (import.meta.env.DEV && ['error', 'tool_call', 'pipeline', 'stream'].includes(eventType || '')) {
              //   console.log(`[SSE] Processing event: ${eventType}`, safeData);
              // }
              
              // Update pipeline state based on event
              const mappedStage = mapBackendStage(eventType || '');
              if (mappedStage && mappedStage !== currentPipelineState.currentStage) {
                // Stage transition
                if (currentPipelineState.currentStage && currentPipelineState.stageStartTime) {
                  const stageTime = Date.now() - currentPipelineState.stageStartTime;
                  currentPipelineState.stageTiming[currentPipelineState.currentStage] = stageTime;
                }
                
                currentPipelineState.currentStage = mappedStage;
                currentPipelineState.stageStartTime = Date.now();
                
                // Update tool execution phase detection
                currentPipelineState.isToolExecutionPhase = mappedStage === 'mcp';
                
                // Update content suppression
                currentPipelineState.shouldSuppressContent = shouldSuppressContentForStage(
                  mappedStage, 
                  currentPipelineState.activeToolRound
                );
                
                setPipelineState({...currentPipelineState});
                onPipelineStage?.(mappedStage, safeData);
              }
              
              switch (eventType) {
                case 'message_received':
                  messageId = safeData.messageId;
                  break;

                case 'ttft':
                  // Time to First Token - useful for debugging slow responses
                  // This measures how long from request to first content chunk
                  if (safeData.ttftMs) {
                    setTtftMs(safeData.ttftMs);
                    // TTFT logging - disabled in production
                    // console.log(`[SSE-METRICS] ⏱️ TTFT: ${safeData.ttftMs}ms`);
                  }
                  break;

                case 'message_saved':
                  // Database-First: Message confirmed in PostgreSQL before streaming
                  // console.log('[SSE] message_saved event received:', safeData);
                  messageId = safeData.messageId || messageId;

                  // If this is a user message, we can ignore it (already handled by UI)
                  // If this is an assistant message starting to stream, prepare for content
                  if (safeData.role === 'assistant' && safeData.streaming) {
                    // console.log('[SSE] Assistant message starting with DB ID:', messageId);
                  }
                  break;

                case 'message_updated':
                  // Database-First: Final message content after streaming completes
                  // console.log('[SSE] message_updated event received:', safeData);
                  if (safeData.final && safeData.role === 'assistant') {
                    // console.log('[SSE] Assistant message finalized in database:', messageId);
                  }
                  break;

                case 'thinking':
                case 'thinking_event':
                  // 🧠 Capture AI's real thinking process with metrics from backend
                  // console.log('[SSE] Thinking event received:', safeData);

                  // Handle both 'content' and legacy 'message' fields
                  const thinkingContent = safeData.content || safeData.message;
                  const accumulatedThinking = safeData.accumulated || thinkingContent || '';

                  if (thinkingContent) {
                    setCurrentThinking(accumulatedThinking);
                    // Also update ref for persistence
                    currentThinkingRef.current = accumulatedThinking;
                  }

                  // Capture thinking metrics (tokens, timing, speed)
                  const thinkingTokens = safeData.tokens;
                  if (thinkingTokens !== undefined) {
                    const metrics = {
                      tokens: thinkingTokens,
                      elapsedMs: safeData.elapsedMs || 0,
                      tokensPerSecond: safeData.tokensPerSecond || 0
                    };
                    // console.log('[SSE] Setting thinking metrics:', metrics);
                    setThinkingMetrics(metrics);
                  }

                  // Call callbacks for unified activity display
                  onThinking?.(safeData.status || 'Thinking');
                  onThinkingContent?.(accumulatedThinking, thinkingTokens);
                  break;

                case 'thinking_complete':
                  // Thinking phase finished - DON'T clear thinking content here!
                  // Let the UI decide when to collapse/hide the thinking display
                  // The content should remain visible for users to review
                  setIsThinkingCompleted(true); // Mark thinking as completed for UI

                  // Mark ContentBlock as complete for interleaved display
                  if (currentThinkingBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    ));
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    );
                    currentThinkingBlockIndexRef.current = null; // Clear tracking ref
                  }

                  onThinkingComplete?.();
                  // Only clear metrics (the spinner), not the content
                  setThinkingMetrics(null);
                  break;

                case 'token_metrics':
                  // Live token metrics during streaming (separate from thinking events)
                  if (safeData.tokens !== undefined || safeData.elapsedMs !== undefined) {
                    const metrics = {
                      tokens: safeData.tokens || 0,
                      elapsedMs: safeData.elapsedMs || 0,
                      tokensPerSecond: safeData.tokensPerSecond || 0
                    };
                    setThinkingMetrics(metrics);
                  }
                  break;

                case 'stream':
                case 'content_delta':
                case 'delta': // Additional common SSE event name
                  // DISABLED: This was blocking ALL stream events because done event arrives first
                  // if (hasCompletedStream) {
                  //   console.warn('[SSE] Ignoring stream event after completion');
                  //   break;
                  // }

                  // Handle different response formats
                  let contentDelta = '';

                  // Direct content (custom format)
                  if (safeData.content) {
                    contentDelta = safeData.content;
                  }
                  // Delta format (some providers)
                  else if (safeData.delta) {
                    contentDelta = safeData.delta;
                  }
                  // Text format (some providers)
                  else if (safeData.text) {
                    contentDelta = safeData.text;
                  }
                  // OpenAI format (choices[0].delta.content)
                  else if (safeData.choices && safeData.choices[0] && safeData.choices[0].delta && safeData.choices[0].delta.content) {
                    contentDelta = safeData.choices[0].delta.content;
                  }
                  // Raw JSON string response from some providers
                  else if (typeof safeData === 'string') {
                    try {
                      const parsed = JSON.parse(safeData);
                      if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                        contentDelta = parsed.choices[0].delta.content;
                      } else if (parsed.content) {
                        contentDelta = parsed.content;
                      }
                    } catch (e) {
                      // If not JSON, treat as raw content
                      contentDelta = safeData;
                    }
                  }
                  
                  // Pipeline-aware content handling
                  // CRITICAL FIX: Do NOT suppress content during MCP execution - show it in real-time!
                  // The old behavior was buffering content during tool execution, causing the UI to appear frozen
                  // Now we always show content immediately for better UX
                  if (false && currentPipelineState.shouldSuppressContent) {
                    // DISABLED: Buffer content during tool execution phases
                    currentPipelineState.bufferedContent += contentDelta;

                    // Content suppression logging - disabled
                    // if (import.meta.env.DEV) {
                    //   console.log(`[SSE] Content suppressed during ${currentPipelineState.currentStage} stage (tool round ${currentPipelineState.activeToolRound})`);
                    // }
                  } else {
                    // Show content immediately during appropriate phases
                    assistantMessage += contentDelta;

                    // Also include any buffered content if transitioning from suppressed state
                    if (currentPipelineState.bufferedContent) {
                      assistantMessage = currentPipelineState.bufferedContent + assistantMessage;
                      currentPipelineState.bufferedContent = '';
                    }

                    // Extract thinking blocks and clean content
                    const { cleaned, thinking } = extractAndCleanThinkingBlocks(assistantMessage);
                    setCurrentMessage(cleaned);

                    // Set extracted thinking content if found
                    if (thinking) {
                      setCurrentThinking(thinking);
                      // console.log('[SSE] Extracted thinking from stream:', thinking.substring(0, 100) + '...');
                    }

                    // Update text ContentBlock for interleaved display
                    // If no text block exists yet, create one (fallback for providers that don't send content_start)
                    if (currentTextBlockIndexRef.current === null && contentDelta) {
                      const newTextBlockIndex = contentBlocksRef.current.length;
                      const newTextBlock: ContentBlock = {
                        index: newTextBlockIndex,
                        type: 'text',
                        content: cleaned,
                        isComplete: false,
                      };
                      setContentBlocks(prev => [...prev, newTextBlock]);
                      contentBlocksRef.current = [...contentBlocksRef.current, newTextBlock];
                      currentTextBlockIndexRef.current = newTextBlockIndex;
                    } else if (currentTextBlockIndexRef.current !== null) {
                      // Update existing text block with cleaned content
                      setContentBlocks(prev => prev.map(block =>
                        block.index === currentTextBlockIndexRef.current
                          ? { ...block, content: cleaned }
                          : block
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === currentTextBlockIndexRef.current
                          ? { ...block, content: cleaned }
                          : block
                      );
                    }

                    onStream?.(contentDelta);
                  }
                  break;

                case 'tool_approval_request':
                  // Human-in-the-loop: AI is requesting approval to execute tools
                  // console.log('[SSE] Tool approval requested:', {
                  //   round: safeData.toolCallRound,
                  //   toolCount: safeData.tools?.length,
                  //   tools: safeData.tools
                  // });

                  // Call the approval callback to display the dialog
                  if (onToolApprovalRequest && safeData.tools && safeData.tools.length > 0) {
                    onToolApprovalRequest({
                      tools: safeData.tools,
                      toolCallRound: safeData.toolCallRound,
                      messageId: safeData.messageId
                    });
                  }
                  break;

                case 'tool_execution_start':
                  // Update pipeline state for tool execution
                  currentPipelineState.isToolExecutionPhase = true;
                  currentPipelineState.activeToolRound = Math.max(1, currentPipelineState.activeToolRound);
                  // CRITICAL FIX: DO NOT suppress content during tool execution
                  // We want real-time streaming even during MCP tool calls
                  currentPipelineState.shouldSuppressContent = false;

                  setPipelineState({...currentPipelineState});
                  onToolRound?.(currentPipelineState.activeToolRound, currentPipelineState.maxToolRounds);
                  onToolExecution?.({
                    type: 'start',
                    tools: safeData.tools,
                    round: currentPipelineState.activeToolRound
                  });
                  break;

                case 'tool_execution_complete':
                  // Tool execution finished - prepare for next completion stream
                  currentPipelineState.isToolExecutionPhase = false;
                  onToolExecution?.({
                    type: 'complete',
                    executionTimeMs: safeData.executionTimeMs,
                    successCount: safeData.successCount,
                    errorCount: safeData.errorCount
                  });
                  break;

                case 'completion_restart':
                  // Completion is restarting after tool execution
                  // Un-suppress content so the next completion stream shows
                  currentPipelineState.shouldSuppressContent = false;
                  setPipelineState({...currentPipelineState});
                  break;

                case 'completion_start':
                  // Capture the model at completion start for the response badge
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;

                case 'tool_executing':
                  // MODERN FIX: Don't append tool status to message content
                  // This prevents the "hanging cursor" issue when stream completes
                  // Tool execution status should be shown in a separate UI element (via onToolExecution callback)
                  onToolExecution?.({
                    type: 'executing',
                    name: safeData.name,
                    arguments: safeData.arguments
                  });
                  break;

                case 'tool_result':
                  // MODERN FIX: Don't modify message content for tool completion
                  // Let the final stream content come through naturally
                  onToolExecution?.({
                    type: 'result',
                    name: safeData.name,
                    result: safeData.result
                  });
                  break;
                  
                case 'tool_error':
                  onToolExecution?.({
                    type: 'error',
                    name: safeData.name,
                    error: safeData.error
                  });
                  break;
                  
                case 'tool_call_delta':
                  // Tool call detected - increment round if needed
                  if (currentPipelineState.activeToolRound === 0) {
                    currentPipelineState.activeToolRound = 1;
                  }

                  // Notify UI about tool calls being made so they display as steps during streaming
                  // These are real LLM function calls (not synthetic) - we just don't have results yet
                  if (safeData.toolCalls && safeData.toolCalls.length > 0) {
                    onToolExecution?.({
                      type: 'tool_call_streaming',
                      calls: safeData.toolCalls.map((tc: any) => ({
                        id: tc.id,
                        name: tc.function?.name || tc.name,
                        tool: tc.function?.name || tc.name,
                        args: tc.function?.arguments || tc.arguments,
                        status: 'running'
                      })),
                      round: currentPipelineState.activeToolRound
                    });
                  }

                  setPipelineState({...currentPipelineState});
                  break;
                  
                case 'tool_call_complete':
                  // CRITICAL FIX: Don't track synthetic tool completions
                  // Real MCP results come through 'mcp_execution' events

                  // Just update pipeline state for tool rounds
                  currentPipelineState.isToolExecutionPhase = false;
                  if (currentPipelineState.activeToolRound < currentPipelineState.maxToolRounds) {
                    currentPipelineState.shouldSuppressContent = false;
                  }

                  setPipelineState({...currentPipelineState});
                  break;
                  
                case 'tool_calls_required':
                  // CRITICAL FIX: Don't initialize synthetic mcpCalls
                  // Real MCP results will come through proper 'mcp_execution' events
                  break;
                  
                case 'mcp_status':
                  // Store MCP status in metadata, don't append to content
                  // This information can be shown in a status bar or separate UI element
                  break;
                  
                case 'session_title':
                  // Update session title in the store
                  if (safeData.title && sessionId) {
                    const { updateSessionTitle } = useChatStore.getState();
                    updateSessionTitle(sessionId, safeData.title);
                  }
                  break;

                case 'multi_model_start':
                case 'orchestration_start':
                  // Multi-model orchestration started
                  console.log('[SSE] 🎭 Multi-model orchestration started:', safeData);
                  onMultiModel?.({
                    type: 'start',
                    orchestrationId: safeData.orchestrationId,
                    executionPlan: safeData.executionPlan
                  });
                  break;

                case 'role_start':
                  // A specific role (reasoning, tool_execution, synthesis) started
                  console.log('[SSE] 🎭 Role started:', safeData.role, 'model:', safeData.model);
                  onMultiModel?.({
                    type: 'role_start',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    model: safeData.model
                  });
                  break;

                case 'role_thinking':
                  // Thinking content from a role
                  console.log('[SSE] 🧠 Role thinking:', safeData.role, 'accumulated:', safeData.accumulated?.length || 0);
                  onMultiModel?.({
                    type: 'role_thinking',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    content: safeData.content
                  });
                  // Also update thinking state for display
                  // CRITICAL FIX: Use accumulated from backend if available, otherwise build locally
                  // The agentState.thinkingContent gets REPLACED, not appended
                  if (safeData.content || safeData.accumulated) {
                    // Prefer backend-accumulated value for accuracy
                    const accumulatedContent = safeData.accumulated || '';
                    if (accumulatedContent) {
                      setCurrentThinking(accumulatedContent);
                      onThinkingContent?.(accumulatedContent);
                    } else if (safeData.content) {
                      // Fallback: accumulate locally
                      setCurrentThinking(prev => {
                        const accumulated = prev + safeData.content;
                        onThinkingContent?.(accumulated);
                        return accumulated;
                      });
                    }
                  }
                  break;

                case 'role_stream':
                  // Streaming content from a role (multi-model mode)
                  // This is the actual LLM content being streamed during orchestration
                  if (safeData.content) {
                    // Update current message with the delta
                    assistantMessage += safeData.content;
                    setCurrentMessage(assistantMessage);

                    // Also notify the stream callback
                    onStream?.(safeData.content);
                  }
                  break;

                case 'role_complete':
                  // A specific role completed
                  console.log('[SSE] ✅ Role completed:', safeData.role, 'metrics:', safeData.metrics);
                  onMultiModel?.({
                    type: 'role_complete',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    model: safeData.model,
                    metrics: safeData.metrics
                  });
                  break;

                case 'multi_model_handoff':
                case 'handoff':
                  // Model handoff during orchestration
                  console.log('[SSE] 🔄 Handoff:', safeData.fromRole, '->', safeData.toRole);
                  onMultiModel?.({
                    type: 'handoff',
                    orchestrationId: safeData.orchestrationId,
                    fromRole: safeData.fromRole,
                    toRole: safeData.toRole,
                    fromModel: safeData.fromModel,
                    toModel: safeData.toModel,
                    handoffCount: safeData.handoffCount
                  });
                  break;

                case 'multi_model_complete':
                case 'orchestration_complete':
                  // Multi-model orchestration completed
                  console.log('[SSE] 🏁 Orchestration complete:', safeData);
                  onMultiModel?.({
                    type: 'complete',
                    orchestrationId: safeData.orchestrationId,
                    rolesExecuted: safeData.rolesExecuted,
                    totalCost: safeData.totalCost,
                    totalDuration: safeData.totalDuration
                  });
                  break;

                case 'multi_model_error':
                case 'orchestration_error':
                  // Multi-model orchestration error
                  console.log('[SSE] ❌ Orchestration error:', safeData);
                  onMultiModel?.({
                    type: 'error',
                    orchestrationId: safeData.orchestrationId,
                    error: safeData.error
                  });
                  break;

                case 'job_completed':
                  // Autonomous job monitoring - background job completed
                  // console.log('[SSE] Background job completed:', {
                  //   jobId: safeData.jobId,
                  //   status: safeData.status,
                  //   completedAt: safeData.completedAt
                  // });

                  // Dispatch a custom event so BackgroundJobsPanel can refresh its list
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('background-job-completed', {
                      detail: {
                        jobId: safeData.jobId,
                        status: safeData.status,
                        result: safeData.result,
                        error: safeData.error,
                        completedAt: safeData.completedAt
                      }
                    }));
                  }

                  // Optionally, inject a system message into the chat
                  const jobStatusMessage = safeData.error
                    ? `⚠️ Background job ${safeData.jobId} failed: ${safeData.error}`
                    : `✅ Background job ${safeData.jobId} completed successfully`;

                  onMessage?.({
                    id: `job_${safeData.jobId}_${Date.now()}`,
                    role: 'system',
                    content: jobStatusMessage,
                    timestamp: new Date(safeData.completedAt).toISOString(),
                    metadata: {
                      type: 'job_completion',
                      jobId: safeData.jobId,
                      status: safeData.status
                    }
                  });
                  break;
                  
                case 'mcp_calls_data':
                  // Store MCP calls for the current message AND notify for display
                  // console.log('[SSE] MCP calls data received:', {
                  //   callsCount: safeData.calls?.length,
                  //   calls: safeData.calls
                  // });

                  if (safeData.calls && safeData.calls.length > 0) {
                    // Deep copy MCP calls to ensure they're extensible
                    mcpCalls = JSON.parse(JSON.stringify(safeData.calls));

                    // Notify onToolExecution callback to update activeMcpCalls for real-time display
                    onToolExecution?.({
                      type: 'mcp_calls_data',
                      calls: mcpCalls,
                      round: safeData.round
                    });
                  }
                  break;
                  
                case 'cot_step':
                  // Chain of Thought step event - update COT display
                  if (safeData.step) {
                    setCotSteps(prev => {
                      const existingIndex = prev.findIndex(s => s.id === safeData.step.id);
                      if (existingIndex >= 0) {
                        // Update existing step
                        const updated = [...prev];
                        updated[existingIndex] = { ...updated[existingIndex], ...safeData.step };
                        return updated;
                      } else {
                        // Add new step
                        return [...prev, safeData.step];
                      }
                    });
                  }
                  break;

                case 'cot_data':
                case 'cot_processed':
                  // Legacy CoT events - still processed for backwards compatibility
                  break;

                // ============================================================
                // ANTHROPIC-NATIVE EVENTS
                // These handle raw Anthropic API events if passed through
                // See: https://docs.anthropic.com/en/docs/build-with-claude/streaming
                // ============================================================

                case 'message_start':
                  // Anthropic: Initial message object
                  if (safeData.message?.id) {
                    messageId = safeData.message.id;
                  }
                  break;

                case 'content_block_start':
                  // Anthropic: Start of a content block (thinking, text, or tool_use)
                  // INTERLEAVED THINKING: Add block to contentBlocks array
                  const blockIndex = safeData.index ?? contentBlocksRef.current.length;
                  const blockType = safeData.content_block?.type as 'thinking' | 'text' | 'tool_use';

                  if (blockType) {
                    const newBlock: ContentBlock = {
                      index: blockIndex,
                      type: blockType,
                      content: '',
                      isComplete: false,
                      toolName: blockType === 'tool_use' ? safeData.content_block?.name : undefined,
                      toolId: blockType === 'tool_use' ? safeData.content_block?.id : undefined,
                    };
                    setContentBlocks(prev => [...prev, newBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, newBlock];
                  }

                  if (safeData.content_block?.type === 'thinking') {
                    // Extended thinking block started
                    onThinking?.('Thinking');
                  } else if (safeData.content_block?.type === 'tool_use') {
                    // Tool use block started
                    onToolExecution?.({
                      type: 'tool_call_streaming',
                      calls: [{
                        id: safeData.content_block.id,
                        name: safeData.content_block.name,
                        tool: safeData.content_block.name,
                        args: '',
                        status: 'running'
                      }],
                      round: currentPipelineState.activeToolRound || 1
                    });
                  }
                  break;

                case 'content_block_delta':
                  // Anthropic: Delta update for a content block
                  // INTERLEAVED THINKING: Update the correct block in contentBlocks
                  const deltaIndex = safeData.index;

                  if (safeData.delta?.type === 'thinking_delta') {
                    // Streaming thinking content
                    const thinkingDelta = safeData.delta.thinking || '';

                    // Update contentBlocks for interleaved display
                    if (deltaIndex !== undefined) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + thinkingDelta }
                          : block
                      ));
                      // Also update contentBlocksRef synchronously for persistence
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + thinkingDelta }
                          : block
                      );
                    }

                    // Also update legacy currentThinking for backwards compatibility
                    // CRITICAL FIX: Update ref synchronously for persistence in done handler
                    const newAccumulatedThinking = currentThinkingRef.current + thinkingDelta;
                    currentThinkingRef.current = newAccumulatedThinking; // Sync update for done handler
                    setCurrentThinking(newAccumulatedThinking);
                    onThinkingContent?.(newAccumulatedThinking);
                  } else if (safeData.delta?.type === 'text_delta') {
                    // Streaming text content
                    const textDelta = safeData.delta.text || '';

                    // Update contentBlocks for interleaved display
                    if (deltaIndex !== undefined) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + textDelta }
                          : block
                      ));
                    }

                    assistantMessage += textDelta;
                    const { cleaned } = extractAndCleanThinkingBlocks(assistantMessage);
                    setCurrentMessage(cleaned);
                    onStream?.(textDelta);
                  } else if (safeData.delta?.type === 'input_json_delta') {
                    // Streaming tool input JSON
                    // Update contentBlocks for tool args display
                    const jsonDelta = safeData.delta.partial_json || '';
                    if (deltaIndex !== undefined && jsonDelta) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + jsonDelta }
                          : block
                      ));
                    }
                  } else if (safeData.delta?.type === 'signature_delta') {
                    // Extended thinking signature (for verification)
                    // Store but don't display
                  }
                  break;

                case 'content_block_stop':
                  // Anthropic: End of a content block
                  // INTERLEAVED THINKING: Mark the block as complete
                  const stopIndex = safeData.index;
                  if (stopIndex !== undefined) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === stopIndex
                        ? { ...block, isComplete: true }
                        : block
                    ));
                  }
                  break;

                case 'message_delta':
                  // Anthropic: Top-level message changes (stop_reason, usage)
                  if (safeData.usage) {
                    // Token usage stats
                    const usage = safeData.usage;
                    setThinkingMetrics({
                      tokens: usage.input_tokens + usage.output_tokens,
                      elapsedMs: 0,
                      tokensPerSecond: 0
                    });
                  }
                  break;

                case 'message_stop':
                  // Anthropic: End of message stream
                  // This is equivalent to our 'done' event
                  // Don't handle here - let 'done' case handle finalization
                  break;

                // ============================================================
                // END ANTHROPIC-NATIVE EVENTS
                // ============================================================

                // ============================================================
                // AWP UNIFIED ACTIVITY STREAMING EVENTS
                // Version: awp-activity-streaming-2025-01
                // These normalize thinking/tools/activity from ALL providers
                // ============================================================

                case 'activity_start':
                  // New activity session started
                  // Store session info if needed for metrics display
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;

                case 'thinking_start':
                  // Thinking/reasoning phase started (Claude, o1, Gemini, DeepSeek)
                  // Create ContentBlock for interleaved display
                  const thinkingBlockIndex = contentBlocksRef.current.length;
                  const thinkingBlock: ContentBlock = {
                    index: thinkingBlockIndex,
                    type: 'thinking',
                    content: '',
                    isComplete: false,
                  };
                  setContentBlocks(prev => [...prev, thinkingBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, thinkingBlock];
                  currentThinkingBlockIndexRef.current = thinkingBlockIndex;
                  onThinking?.(safeData.thinkingMode === 'hidden' ? 'Reasoning' : 'Thinking');
                  break;

                case 'thinking_delta':
                  // Streaming thinking content - use accumulated for accuracy
                  const thinkingDelta = safeData.delta || '';
                  const thinkingAccumulated = safeData.accumulated || '';

                  // Update ContentBlock for interleaved display
                  if (currentThinkingBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, content: thinkingAccumulated || (block.content + thinkingDelta) }
                        : block
                    ));
                    // Keep ref in sync
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, content: thinkingAccumulated || (block.content + thinkingDelta) }
                        : block
                    );
                  }

                  // Also update legacy currentThinking for backwards compatibility
                  if (thinkingAccumulated) {
                    setCurrentThinking(thinkingAccumulated);
                    onThinkingContent?.(thinkingAccumulated, safeData.tokenCount);
                  } else if (thinkingDelta) {
                    setCurrentThinking(prev => {
                      const accumulated = prev + thinkingDelta;
                      onThinkingContent?.(accumulated, safeData.tokenCount);
                      return accumulated;
                    });
                  }
                  // Update metrics if provided
                  if (safeData.tokenCount !== undefined) {
                    setThinkingMetrics(prev => ({
                      tokens: safeData.tokenCount || prev?.tokens || 0,
                      elapsedMs: safeData.elapsedMs || prev?.elapsedMs || 0,
                      tokensPerSecond: prev?.tokensPerSecond || 0
                    }));
                  }
                  break;

                // NOTE: thinking_complete is handled above at line ~567
                // Removed duplicate case here

                case 'content_start':
                  // Response content phase started - create text ContentBlock for interleaved display
                  const textBlockIndex = contentBlocksRef.current.length;
                  const textBlock: ContentBlock = {
                    index: textBlockIndex,
                    type: 'text',
                    content: '',
                    isComplete: false,
                  };
                  setContentBlocks(prev => [...prev, textBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, textBlock];
                  currentTextBlockIndexRef.current = textBlockIndex;
                  break;

                // NOTE: 'content_delta' is handled above in the 'stream'/'content_delta'/'delta' case group
                // to avoid duplicate case clauses

                case 'content_complete':
                  // Response content finished - mark text ContentBlock as complete
                  if (currentTextBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentTextBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    ));
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentTextBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    );
                    currentTextBlockIndexRef.current = null; // Clear tracking ref
                  }
                  break;

                case 'tool_start':
                  // Tool call initiated (normalized from all providers)
                  onToolExecution?.({
                    type: 'tool_call_streaming',
                    calls: [{
                      id: safeData.toolCallId,
                      name: safeData.toolName,
                      tool: safeData.toolName,
                      args: '',
                      status: 'running'
                    }],
                    round: currentPipelineState.activeToolRound || 1
                  });
                  break;

                case 'tool_delta':
                  // Tool argument streaming (shows args building up)
                  onToolExecution?.({
                    type: 'stream_delta',
                    toolCallId: safeData.toolCallId,
                    delta: safeData.delta,
                    accumulated: safeData.accumulated,
                    sequenceNumber: safeData.sequenceNumber,
                    isValidJson: safeData.isValidJson
                  });
                  break;

                case 'tool_complete':
                  // Tool call ready for execution
                  onToolExecution?.({
                    type: 'stream_complete',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    arguments: safeData.arguments,
                    durationMs: safeData.durationMs,
                    status: 'pending_execution'
                  });
                  break;

                // NOTE: 'tool_result' is handled above at line ~763
                // to avoid duplicate case clauses

                case 'model_info':
                  // Model identification event
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  // Could emit multi-model event for role info
                  if (safeData.role) {
                    onMultiModel?.({
                      type: 'role_start',
                      role: safeData.role,
                      model: safeData.model
                    });
                  }
                  break;

                case 'metrics_update':
                  // Live metrics during streaming
                  if (safeData.tokens) {
                    setThinkingMetrics({
                      tokens: safeData.tokens.total || 0,
                      elapsedMs: safeData.timing?.elapsed || 0,
                      tokensPerSecond: safeData.timing?.tokensPerSecond || 0
                    });
                  }
                  if (safeData.timing?.ttft && !ttftMs) {
                    setTtftMs(safeData.timing.ttft);
                  }
                  break;

                case 'activity_complete':
                  // Activity session finished - similar to done but with more metrics
                  // Let the existing done handler finalize the message
                  break;

                // ============================================================
                // AWP TOOL STREAMING EVENTS
                // Version: awp-tool-streaming-2025-01
                // Fine-grained tool argument streaming
                // ============================================================

                case 'tool_stream_start':
                  // Tool argument streaming started
                  onToolExecution?.({
                    type: 'stream_start',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    toolIndex: safeData.toolIndex,
                    provider: safeData.provider,
                    status: 'streaming'
                  });
                  break;

                case 'tool_stream_delta':
                  // Tool argument chunk received
                  onToolExecution?.({
                    type: 'stream_delta',
                    toolCallId: safeData.toolCallId,
                    delta: safeData.delta,
                    accumulated: safeData.accumulated,
                    sequenceNumber: safeData.sequenceNumber,
                    isValidJson: safeData.isValidJson
                  });
                  break;

                case 'tool_stream_complete':
                  // Tool arguments fully received
                  onToolExecution?.({
                    type: 'stream_complete',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    arguments: safeData.arguments,
                    durationMs: safeData.durationMs,
                    status: 'pending_execution'
                  });
                  break;

                case 'tool_stream_error':
                  // Tool streaming failed
                  onToolExecution?.({
                    type: 'stream_error',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    error: safeData.error,
                    errorCode: safeData.errorCode
                  });
                  break;

                // ============================================================
                // END AWP ACTIVITY/TOOL STREAMING EVENTS
                // ============================================================

                case 'image':
                  // CRITICAL FIX: Do NOT add image to assistantMessage here
                  // The backend already emits a 'stream' event with the full markdown content
                  // including the image. Adding it here causes duplication.
                  // Image event logging - disabled in production
                  // if (import.meta.env.DEV) {
                  //   console.log('[SSE] Image event received (will be included in stream event):', {
                  //     imageUrl: safeData.imageUrl,
                  //     revisedPrompt: safeData.revisedPrompt
                  //   });
                  // }
                  // Don't modify assistantMessage - the stream event already contains the image
                  break;
                  
                case 'completion_complete':
                  // CRITICAL: Do NOT add any content here - it was already streamed
                  // This event only carries metadata like toolCalls, usage, finishReason
                  // Capture the model for the final message badge
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;
                  
                case 'done':
                case 'stream_complete':
                  // CRITICAL FIX: Prevent duplicate messages from multiple done events
                  if (hasCompletedStream) {
                    // console.warn('[SSE] Ignoring duplicate done/stream_complete event');
                    break;
                  }
                  hasCompletedStream = true;

                  // CRITICAL FIX: Capture model from done event (server renames completion_complete to done)
                  // This is needed because the completion_complete case may not be hit
                  if (safeData.model && !responseModel) {
                    responseModel = safeData.model;
                  }

                  // Mark pipeline as complete
                  currentPipelineState.currentStage = 'response';
                  currentPipelineState.shouldSuppressContent = false;
                  currentPipelineState.isToolExecutionPhase = false;

                  // CRITICAL FIX: Always add message if there's content OR mcpCalls
                  // Tool-only responses (no text) should still create a message to display the tool execution
                  if (assistantMessage || mcpCalls.length > 0) {
                    // Clean thinking blocks from the content AND extract thinking for persistence
                    const { cleaned: cleanedContent, thinking: extractedThinking } = extractAndCleanThinkingBlocks(assistantMessage || '');

                    // Format the message for better readability
                    const formattedContent = cleanedContent
                      ? addVisualEnhancements(formatAgentMessage(cleanedContent))
                      : ''; // Empty content but we still want to show MCP calls

                    // CRITICAL FIX: Extract thinking from contentBlocks as fallback
                    // This ensures interleaved thinking (from content_block_delta) is persisted
                    const thinkingFromBlocks = contentBlocksRef.current
                      .filter(b => b.type === 'thinking')
                      .map(b => b.content)
                      .filter(c => c && c.length > 0)
                      .join('\n\n---\n\n');

                    // Capture current thinking content for persistence (use extracted, state ref, or blocks)
                    const thinkingToSave = extractedThinking || currentThinkingRef.current || thinkingFromBlocks || '';

                    // CRITICAL FIX: Capture cotSteps as thinkingSteps for inline display
                    // This ensures thinking steps persist with the message for later viewing
                    // Use ref to get current value (state may be stale in closure)
                    // IMPORTANT: Deep copy to ensure objects are extensible (React may freeze state objects)
                    const finalThinkingSteps = cotStepsRef.current.length > 0
                      ? JSON.parse(JSON.stringify(cotStepsRef.current))
                      : undefined;

                    // CRITICAL FIX: Capture any tool calls for inline display
                    // safeData may contain toolCalls from completion_complete event
                    const finalToolCalls = safeData.toolCalls || undefined;
                    const finalToolResults = safeData.toolResults || undefined;

                    // Call onMessage with formatted content and MCP calls (HIGH PRIORITY)
                    // CRITICAL: Include thinkingSteps, reasoningTrace, toolCalls for inline step display
                    onMessage?.({
                      id: messageId || new Date().toISOString(),
                      role: 'assistant',
                      content: formattedContent,
                      timestamp: new Date().toISOString(),
                      model: responseModel || undefined, // Include the model used for this response
                      mcpCalls: mcpCalls.length > 0 ? mcpCalls : undefined,
                      // CRITICAL: Include step data for inline display
                      thinkingSteps: finalThinkingSteps, // Structured thinking steps from COT
                      reasoningTrace: thinkingToSave || undefined, // Full reasoning text
                      toolCalls: finalToolCalls, // Tool calls made during response
                      toolResults: finalToolResults, // Results from tool executions
                      metadata: {
                        // Create fresh extensible object to avoid "Object is not extensible" errors
                        ...JSON.parse(JSON.stringify(safeData)),
                        // IMPORTANT: Save thinking content for persistence after reload
                        thinkingContent: thinkingToSave || undefined,
                        // IMPORTANT: Also save mcpCalls in metadata for database persistence
                        mcpCalls: mcpCalls.length > 0 ? mcpCalls : undefined,
                        pipelineMetrics: {
                          stageTiming: currentPipelineState.stageTiming,
                          toolRounds: currentPipelineState.activeToolRound
                        }
                      }
                    });
                  }

                  // MODERN FIX: Clear active tool execution indicators AFTER final message is queued
                  // The useTransition below ensures onMessage completes before this executes
                  // This prevents stale "✓ Completed" badges from lingering with streaming cursor
                  onToolExecution?.({ type: 'clear_all' });

                  // CRITICAL FIX: Set streaming state IMMEDIATELY when done event is received
                  // The previous use of startTransition caused the "Generating" indicator to persist
                  // because deferred updates have lower priority. For UI indicators, immediate updates are essential.
                  setIsStreaming(false);
                  setCurrentMessage('');
                  // DON'T clear thinking content on completion - let it persist for user review!
                  // The thinking will be cleared when a NEW message starts (line ~291)
                  // setCurrentThinking('');  // REMOVED - was hiding thinking from users
                  setThinkingMetrics(null); // Only clear metrics (spinner)

                  setPipelineState({...currentPipelineState});
                  onPipelineStage?.('response', { complete: true });
                  break;
                  
                case 'error':
                  // Guard against duplicate error messages (fixes 3x error display)
                  if (hasReportedError) {
                    console.log('[SSE] Skipping duplicate error event');
                    break;
                  }
                  hasReportedError = true;

                  console.error('[SSE] Error event received:', safeData);

                  // Enhanced error handling with specific details about what failed
                  let detailedErrorMessage = safeData.message || 'Unknown error occurred';
                  let errorContext = '';

                  // If it's a model provider error, add specific details
                  if (safeData.code === 'PIPELINE_ERROR' || safeData.code === 'COMPLETION_FAILED') {
                    errorContext += `\n\nError Code: ${safeData.code}`;
                    if (safeData.stage) {
                      errorContext += `\nFailed Stage: ${safeData.stage}`;
                    }
                    if (safeData.retryable !== undefined) {
                      errorContext += `\nRetryable: ${safeData.retryable ? 'Yes' : 'No'}`;
                    }

                    // Check for specific model provider issues
                    if (detailedErrorMessage.includes('Could not identify azure model') ||
                        detailedErrorMessage.includes('base_model')) {
                      detailedErrorMessage = `❌ MODEL CONFIGURATION ERROR\n\nCannot identify the Azure model deployment.\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (detailedErrorMessage.includes('Failed to connect') ||
                               detailedErrorMessage.includes('Connection failed')) {
                      detailedErrorMessage = `❌ CONNECTION ERROR\n\nCannot connect to the AI model provider.\n\nCheck if:\n• API service is running\n• Network connectivity is available\n• API endpoints are correct\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (detailedErrorMessage.includes('401') ||
                               detailedErrorMessage.includes('unauthorized')) {
                      detailedErrorMessage = `❌ AUTHENTICATION ERROR\n\nModel provider authentication failed.\n\nCheck if:\n• Azure API keys are valid\n• OAuth tokens haven't expired\n• Model deployment permissions are correct\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (detailedErrorMessage.includes('timeout') ||
                               detailedErrorMessage.includes('timed out')) {
                      detailedErrorMessage = `❌ TIMEOUT ERROR\n\nThe AI model took too long to respond.\n\nThis could be due to:\n• High model load\n• Network latency\n• Complex request processing\n\nTechnical Details:\n${detailedErrorMessage}`;
                    }
                  }

                  const enhancedError = new Error(detailedErrorMessage + errorContext);
                  enhancedError.name = safeData.code || 'ChatError';
                  onError?.(enhancedError);
                  break;
              }
            } catch (error) {
              console.error('[SSE] Error parsing SSE data:', error, 'Raw data:', eventData);
            }
          }
        }
      }
    } catch (streamError: any) {
        // CRITICAL FIX: Don't report AbortError - it's expected when sending a new message
        // AbortError occurs when abortControllerRef.current.abort() is called for a new message
        if (streamError.name !== 'AbortError') {
          // Guard against duplicate error messages (fixes 3x error display)
          if (!hasReportedError) {
            hasReportedError = true;
            console.error('[SSE] Stream processing error:', streamError);
            onError?.(streamError);
          }
        } else {
          // Stream abort logging - disabled in production
          // console.log('[SSE] Stream aborted (expected when sending new message)');
        }
      } finally {
        // Clear timeout regardless of how the stream ends
        clearTimeout(streamTimeout);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        // Guard against duplicate error messages (fixes 3x error display)
        if (!hasReportedError) {
          hasReportedError = true;
          // Error logging - keep minimal for production debugging
          console.error('[SSE] Chat error:', error.message);
          onError?.(error);
        }
      } else {
        // console.log('[SSE] Request was aborted (this is normal when stopping stream)');
      }
    } finally {
      setIsStreaming(false);
      // DON'T clear currentMessage here - it causes double display
      // It's already handled in the done/stream_complete event handler
      // setCurrentMessage(''); // REMOVED - causes double display bug
      abortControllerRef.current = null;

      // Reset pipeline state
      setPipelineState(createInitialPipelineState());
    }
  }, [sessionId, autoApproveTools, onMessage, onToolExecution, onToolApprovalRequest, onError, onThinking, onThinkingContent, onThinkingComplete, onMultiModel, onStream, onPipelineStage, onToolRound, getAccessToken, animationMode]);
  
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setCurrentMessage(''); // Clear streaming content when stopped
      setCurrentThinking('');
      setContentBlocks([]); // Clear interleaved content blocks when stopped
      contentBlocksRef.current = [];
      setThinkingMetrics(null);
      setCotSteps([]); // Clear COT steps when stopped
    }

    // Reset pipeline state
    setPipelineState(createInitialPipelineState());
  }, []);
  
  // Update animation mode preference
  const updateAnimationMode = useCallback((mode: AnimationMode) => {
    setAnimationMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-animation-mode', mode);
    }
  }, []);
  
  // Listen for animation mode changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'chat-animation-mode' && e.newValue) {
        const newMode = e.newValue as AnimationMode;
        if (newMode === 'smooth' || newMode === 'none') {
          setAnimationMode(newMode);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  
  return {
    sendMessage,
    stopStreaming,
    isStreaming,
    currentMessage,
    currentThinking,
    isThinkingCompleted, // Whether thinking phase has finished (for UI collapse)
    thinkingMetrics,
    ttftMs, // Time to First Token - for debugging slow responses
    pipelineState,
    animationMode,
    updateAnimationMode,
    cotSteps, // Chain of Thought steps for COT UI display
    contentBlocks // Interleaved content blocks for thinking/text display
  };
};