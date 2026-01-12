/**
 * Code Mode Store - Centralized State Management
 *
 * Handles:
 * - Session persistence across chat/code mode switching
 * - Streaming state (text, thinking, tools, todos)
 * - Connection management
 * - UI state (activity indicators, animations)
 *
 * The session stays ALIVE even when user switches to chat mode.
 * WebSocket connection is maintained, session ID preserved.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';

// =============================================================================
// Types
// =============================================================================

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export type ActivityState = 'idle' | 'thinking' | 'streaming' | 'tool_calling' | 'tool_executing' | 'complete' | 'error';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string; // Present continuous form ("Creating file...")
  completedAt?: number; // Timestamp for animation sequencing
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface ToolStep {
  id: string;
  name: string;
  displayName: string;
  icon?: string;
  status: 'pending' | 'executing' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;

  // Input/Output
  input?: Record<string, any>;
  inputPreview?: string;
  output?: string;
  error?: string;

  // File operations
  filePath?: string;
  diff?: DiffLine[];
  language?: string;

  // Command operations
  command?: string;
  exitCode?: number;

  // UI state
  isCollapsed: boolean;
  isStreaming: boolean;
}

// Content block types for ordered rendering
export type ContentBlockType = 'text' | 'tool' | 'thinking' | 'todo';

export interface TextBlock {
  type: 'text';
  id: string;
  content: string;
  isStreaming?: boolean;
}

export interface ToolBlock {
  type: 'tool';
  id: string;
  step: ToolStep;
}

export interface ThinkingBlock {
  type: 'thinking';
  id: string;
  content: string;
  isStreaming?: boolean;
}

export interface TodoBlock {
  type: 'todo';
  id: string;
  todos: TodoItem[];
}

export type ContentBlock = TextBlock | ToolBlock | ThinkingBlock | TodoBlock;

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: Date;

  // Ordered content blocks (for interspersed text/tools)
  contentBlocks?: ContentBlock[];

  // Legacy: kept for backward compatibility
  textContent?: string;
  thinkingContent?: string;

  // Tool calls
  steps?: ToolStep[];

  // Todos (when TodoWrite is called)
  todos?: TodoItem[];

  // Streaming state
  isStreaming: boolean;
  streamingState?: ActivityState;

  // Usage
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

export interface CodeSession {
  sessionId: string;
  userId: string;
  workspacePath: string;
  model: string;
  createdAt: number;
  lastActiveAt: number;
}

// =============================================================================
// Store State
// =============================================================================

interface CodeModeState {
  // Session
  activeSessionId: string | null;
  session: CodeSession | null;

  // Connection
  connectionState: ConnectionState;
  connectionError: string | null;
  reconnectAttempts: number;

  // Activity
  activityState: ActivityState;
  activityMessage: string | null; // "Pontificating...", "Booping...", etc.

  // Conversation
  messages: ConversationMessage[];
  streamingMessage: ConversationMessage | null;

  // Current streaming state
  streamingText: string;
  streamingThinking: string;
  currentSteps: ToolStep[];
  currentTodos: TodoItem[];
  currentContentBlocks: ContentBlock[]; // Ordered blocks for interleaved display
  currentTextBlockId: string | null; // Track current text block to append to

  // Usage tracking
  totalInputTokens: number;
  totalOutputTokens: number;

  // UI preferences (persisted)
  isCodeModeActive: boolean;
  preferredModel: string;
  defaultWorkspace: string;
  showThinkingBlocks: boolean;
  autoExpandDiffs: boolean;
  maxDiffPreviewLines: number;
}

interface CodeModeActions {
  // Session management
  setActiveSession: (sessionId: string, session: CodeSession) => void;
  clearSession: () => void;
  updateSessionActivity: () => void;

  // Connection
  setConnectionState: (state: ConnectionState, error?: string) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;

  // Activity
  setActivityState: (state: ActivityState, message?: string) => void;

  // Messages
  addUserMessage: (content: string) => void;
  startAssistantMessage: () => void;
  updateStreamingText: (text: string) => void;
  updateStreamingThinking: (thinking: string) => void;
  finalizeAssistantMessage: () => void;
  clearMessages: () => void;

  // Tool steps
  addToolStep: (step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'>) => void;
  updateToolStep: (id: string, updates: Partial<ToolStep>) => void;
  setToolStepStreaming: (id: string, content: string) => void;
  finalizeToolStep: (id: string, output: string, isError?: boolean) => void;

  // Todos
  setTodos: (todos: TodoItem[]) => void;
  updateTodoStatus: (id: string, status: TodoItem['status']) => void;

  // Usage
  addUsage: (input: number, output: number, cacheRead?: number, cacheWrite?: number) => void;

  // Mode switching
  activateCodeMode: () => void;
  deactivateCodeMode: () => void;

  // Preferences
  setPreferredModel: (model: string) => void;
  setDefaultWorkspace: (path: string) => void;
  toggleThinkingBlocks: () => void;
  toggleAutoExpandDiffs: () => void;

  // Reset
  reset: () => void;
}

type CodeModeStore = CodeModeState & CodeModeActions;

// =============================================================================
// Fun Activity Messages
// =============================================================================

const THINKING_MESSAGES = [
  'Pontificating...',
  'Contemplating...',
  'Ruminating...',
  'Cogitating...',
  'Musing...',
  'Deliberating...',
  'Mulling it over...',
  'Deep in thought...',
];

const WORKING_MESSAGES = [
  'Booping...',
  'Tinkering...',
  'Crafting...',
  'Assembling...',
  'Conjuring...',
  'Weaving...',
  'Brewing...',
  'Cooking up...',
];

const TOOL_MESSAGES = [
  'Executing...',
  'Running...',
  'Processing...',
  'Computing...',
  'Crunching...',
];

export const getRandomMessage = (state: ActivityState): string => {
  const messages = state === 'thinking' ? THINKING_MESSAGES
    : state === 'tool_executing' ? TOOL_MESSAGES
    : WORKING_MESSAGES;
  return messages[Math.floor(Math.random() * messages.length)];
};

// =============================================================================
// Initial State
// =============================================================================

const initialState: CodeModeState = {
  // Session
  activeSessionId: null,
  session: null,

  // Connection
  connectionState: 'disconnected',
  connectionError: null,
  reconnectAttempts: 0,

  // Activity
  activityState: 'idle',
  activityMessage: null,

  // Conversation
  messages: [],
  streamingMessage: null,

  // Streaming
  streamingText: '',
  streamingThinking: '',
  currentSteps: [],
  currentTodos: [],
  currentContentBlocks: [],
  currentTextBlockId: null,

  // Usage
  totalInputTokens: 0,
  totalOutputTokens: 0,

  // UI preferences
  isCodeModeActive: false,
  preferredModel: 'claude-sonnet-4-20250514',
  defaultWorkspace: '/workspace',
  showThinkingBlocks: true,
  autoExpandDiffs: false,
  maxDiffPreviewLines: 20,
};

// Keys to persist
const PERSISTED_KEYS = [
  'activeSessionId',
  'isCodeModeActive',
  'preferredModel',
  'defaultWorkspace',
  'showThinkingBlocks',
  'autoExpandDiffs',
  'maxDiffPreviewLines',
] as const;

// =============================================================================
// Store
// =============================================================================

export const useCodeModeStore = create<CodeModeStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ---------------------------------------------------------------------
        // Session Management
        // ---------------------------------------------------------------------

        setActiveSession: (sessionId, session) =>
          set(
            { activeSessionId: sessionId, session },
            false,
            'setActiveSession'
          ),

        clearSession: () =>
          set(
            {
              activeSessionId: null,
              session: null,
              messages: [],
              streamingMessage: null,
              streamingText: '',
              streamingThinking: '',
              currentSteps: [],
              currentTodos: [],
              currentContentBlocks: [],
              currentTextBlockId: null,
            },
            false,
            'clearSession'
          ),

        updateSessionActivity: () =>
          set(
            (state) => ({
              session: state.session
                ? { ...state.session, lastActiveAt: Date.now() }
                : null,
            }),
            false,
            'updateSessionActivity'
          ),

        // ---------------------------------------------------------------------
        // Connection
        // ---------------------------------------------------------------------

        setConnectionState: (connectionState, connectionError) =>
          set({ connectionState, connectionError }, false, 'setConnectionState'),

        incrementReconnectAttempts: () =>
          set(
            (state) => ({ reconnectAttempts: state.reconnectAttempts + 1 }),
            false,
            'incrementReconnectAttempts'
          ),

        resetReconnectAttempts: () =>
          set({ reconnectAttempts: 0 }, false, 'resetReconnectAttempts'),

        // ---------------------------------------------------------------------
        // Activity
        // ---------------------------------------------------------------------

        setActivityState: (activityState, message) =>
          set(
            {
              activityState,
              activityMessage: message || (activityState !== 'idle' ? getRandomMessage(activityState) : null),
            },
            false,
            'setActivityState'
          ),

        // ---------------------------------------------------------------------
        // Messages
        // ---------------------------------------------------------------------

        addUserMessage: (content) =>
          set(
            (state) => ({
              messages: [
                ...state.messages,
                {
                  id: `user-${Date.now()}`,
                  role: 'user',
                  timestamp: new Date(),
                  textContent: content,
                  isStreaming: false,
                },
              ],
            }),
            false,
            'addUserMessage'
          ),

        startAssistantMessage: () =>
          set(
            {
              streamingMessage: {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                timestamp: new Date(),
                isStreaming: true,
                streamingState: 'thinking',
                contentBlocks: [],
              },
              streamingText: '',
              streamingThinking: '',
              currentSteps: [],
              currentContentBlocks: [],
              currentTextBlockId: null,
              activityState: 'thinking',
              activityMessage: getRandomMessage('thinking'),
            },
            false,
            'startAssistantMessage'
          ),

        updateStreamingText: (text) =>
          set(
            (state) => {
              const newText = state.streamingText + text;
              let newBlocks = [...state.currentContentBlocks];
              let newTextBlockId = state.currentTextBlockId;

              // If we have a current text block, append to it
              if (newTextBlockId) {
                const existingIndex = newBlocks.findIndex(
                  (b) => b.type === 'text' && b.id === newTextBlockId
                );
                if (existingIndex >= 0) {
                  newBlocks[existingIndex] = {
                    ...newBlocks[existingIndex],
                    content: (newBlocks[existingIndex] as TextBlock).content + text,
                    isStreaming: true,
                  } as TextBlock;
                }
              } else {
                // Create new text block
                newTextBlockId = `text-${Date.now()}`;
                newBlocks.push({
                  type: 'text',
                  id: newTextBlockId,
                  content: text,
                  isStreaming: true,
                });
              }

              return {
                streamingText: newText,
                currentContentBlocks: newBlocks,
                currentTextBlockId: newTextBlockId,
                activityState: 'streaming',
                activityMessage: null,
                streamingMessage: state.streamingMessage
                  ? {
                      ...state.streamingMessage,
                      textContent: newText,
                      contentBlocks: newBlocks,
                      streamingState: 'streaming',
                    }
                  : null,
              };
            },
            false,
            'updateStreamingText'
          ),

        updateStreamingThinking: (thinking) =>
          set(
            (state) => ({
              streamingThinking: state.streamingThinking + thinking,
              streamingMessage: state.streamingMessage
                ? {
                    ...state.streamingMessage,
                    thinkingContent: state.streamingThinking + thinking,
                  }
                : null,
            }),
            false,
            'updateStreamingThinking'
          ),

        finalizeAssistantMessage: () =>
          set(
            (state) => {
              if (!state.streamingMessage) return state;

              // Finalize text blocks (mark as not streaming)
              const finalBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'text' ? { ...block, isStreaming: false } : block
              );

              const finalMessage: ConversationMessage = {
                ...state.streamingMessage,
                textContent: state.streamingText || undefined,
                thinkingContent: state.streamingThinking || undefined,
                steps: state.currentSteps.length > 0 ? [...state.currentSteps] : undefined,
                todos: state.currentTodos.length > 0 ? [...state.currentTodos] : undefined,
                contentBlocks: finalBlocks.length > 0 ? finalBlocks : undefined,
                isStreaming: false,
                streamingState: 'complete',
              };

              return {
                messages: [...state.messages, finalMessage],
                streamingMessage: null,
                streamingText: '',
                streamingThinking: '',
                currentSteps: [],
                currentContentBlocks: [],
                currentTextBlockId: null,
                activityState: 'idle',
                activityMessage: null,
              };
            },
            false,
            'finalizeAssistantMessage'
          ),

        clearMessages: () =>
          set(
            {
              messages: [],
              streamingMessage: null,
              streamingText: '',
              streamingThinking: '',
              currentSteps: [],
              currentContentBlocks: [],
              currentTextBlockId: null,
            },
            false,
            'clearMessages'
          ),

        // ---------------------------------------------------------------------
        // Tool Steps
        // ---------------------------------------------------------------------

        addToolStep: (step) =>
          set(
            (state) => {
              const newStep = { ...step, isCollapsed: true, isStreaming: true };
              const newSteps = [...state.currentSteps, newStep];

              // Add tool block to content blocks (for interleaved display)
              const newBlocks = [
                ...state.currentContentBlocks,
                {
                  type: 'tool' as const,
                  id: step.id,
                  step: newStep,
                },
              ];

              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                // Reset text block ID so next text creates a new block after this tool
                currentTextBlockId: null,
                activityState: 'tool_calling',
                activityMessage: getRandomMessage('tool_calling'),
                // Keep streamingMessage in sync
                streamingMessage: state.streamingMessage
                  ? {
                      ...state.streamingMessage,
                      steps: newSteps,
                      contentBlocks: newBlocks,
                    }
                  : null,
              };
            },
            false,
            'addToolStep'
          ),

        updateToolStep: (id, updates) =>
          set(
            (state) => {
              const newSteps = state.currentSteps.map((step) =>
                step.id === id ? { ...step, ...updates } : step
              );
              // Also update in content blocks
              const newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'tool' && block.id === id
                  ? { ...block, step: { ...block.step, ...updates } }
                  : block
              );
              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, steps: newSteps, contentBlocks: newBlocks }
                  : null,
              };
            },
            false,
            'updateToolStep'
          ),

        setToolStepStreaming: (id, content) =>
          set(
            (state) => {
              const updates = { inputPreview: content, isStreaming: true };
              const newSteps = state.currentSteps.map((step) =>
                step.id === id ? { ...step, ...updates } : step
              );
              const newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'tool' && block.id === id
                  ? { ...block, step: { ...block.step, ...updates } }
                  : block
              );
              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, steps: newSteps, contentBlocks: newBlocks }
                  : null,
              };
            },
            false,
            'setToolStepStreaming'
          ),

        finalizeToolStep: (id, output, isError = false) =>
          set(
            (state) => {
              const stepUpdates = {
                output,
                error: isError ? output : undefined,
                status: (isError ? 'error' : 'success') as ToolStep['status'],
                endTime: Date.now(),
                isStreaming: false,
              };

              const newSteps: ToolStep[] = state.currentSteps.map((step) =>
                step.id === id
                  ? {
                      ...step,
                      ...stepUpdates,
                      duration: Date.now() - step.startTime,
                    }
                  : step
              );

              const newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'tool' && block.id === id
                  ? {
                      ...block,
                      step: {
                        ...block.step,
                        ...stepUpdates,
                        duration: Date.now() - block.step.startTime,
                      },
                    }
                  : block
              );

              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, steps: newSteps, contentBlocks: newBlocks }
                  : null,
              };
            },
            false,
            'finalizeToolStep'
          ),

        // ---------------------------------------------------------------------
        // Todos
        // ---------------------------------------------------------------------

        setTodos: (todos) =>
          set(
            (state) => {
              // Mark newly completed todos with timestamp for animation
              const updatedTodos = todos.map((todo) => {
                const existing = state.currentTodos.find((t) => t.id === todo.id);
                if (todo.status === 'completed' && existing?.status !== 'completed') {
                  return { ...todo, completedAt: Date.now() };
                }
                return existing ? { ...existing, ...todo } : todo;
              });
              return {
                currentTodos: updatedTodos,
                // Keep streamingMessage.todos in sync for live UI updates
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, todos: updatedTodos }
                  : null,
              };
            },
            false,
            'setTodos'
          ),

        updateTodoStatus: (id, status) =>
          set(
            (state) => {
              const updatedTodos = state.currentTodos.map((todo) =>
                todo.id === id
                  ? {
                      ...todo,
                      status,
                      completedAt: status === 'completed' ? Date.now() : undefined,
                    }
                  : todo
              );
              return {
                currentTodos: updatedTodos,
                // Keep streamingMessage.todos in sync for live UI updates
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, todos: updatedTodos }
                  : null,
              };
            },
            false,
            'updateTodoStatus'
          ),

        // ---------------------------------------------------------------------
        // Usage
        // ---------------------------------------------------------------------

        addUsage: (input, output, cacheRead, cacheWrite) =>
          set(
            (state) => ({
              totalInputTokens: state.totalInputTokens + input,
              totalOutputTokens: state.totalOutputTokens + output,
              streamingMessage: state.streamingMessage
                ? {
                    ...state.streamingMessage,
                    usage: {
                      inputTokens: input,
                      outputTokens: output,
                      cacheRead,
                      cacheWrite,
                    },
                  }
                : null,
            }),
            false,
            'addUsage'
          ),

        // ---------------------------------------------------------------------
        // Mode Switching
        // ---------------------------------------------------------------------

        activateCodeMode: () =>
          set({ isCodeModeActive: true }, false, 'activateCodeMode'),

        deactivateCodeMode: () =>
          set({ isCodeModeActive: false }, false, 'deactivateCodeMode'),

        // ---------------------------------------------------------------------
        // Preferences
        // ---------------------------------------------------------------------

        setPreferredModel: (model) =>
          set({ preferredModel: model }, false, 'setPreferredModel'),

        setDefaultWorkspace: (path) =>
          set({ defaultWorkspace: path }, false, 'setDefaultWorkspace'),

        toggleThinkingBlocks: () =>
          set(
            (state) => ({ showThinkingBlocks: !state.showThinkingBlocks }),
            false,
            'toggleThinkingBlocks'
          ),

        toggleAutoExpandDiffs: () =>
          set(
            (state) => ({ autoExpandDiffs: !state.autoExpandDiffs }),
            false,
            'toggleAutoExpandDiffs'
          ),

        // ---------------------------------------------------------------------
        // Reset
        // ---------------------------------------------------------------------

        reset: () =>
          set(
            {
              ...initialState,
              // Keep preferences
              preferredModel: get().preferredModel,
              defaultWorkspace: get().defaultWorkspace,
              showThinkingBlocks: get().showThinkingBlocks,
              autoExpandDiffs: get().autoExpandDiffs,
              maxDiffPreviewLines: get().maxDiffPreviewLines,
            },
            false,
            'reset'
          ),
      }),
      {
        name: 'code-mode-store',
        partialize: (state) =>
          Object.fromEntries(
            PERSISTED_KEYS.map((key) => [key, state[key]])
          ) as Pick<CodeModeState, (typeof PERSISTED_KEYS)[number]>,
      }
    ),
    { name: 'CodeMode' }
  )
);

// =============================================================================
// Selectors - Use shallow equality to prevent infinite re-renders
// =============================================================================

// Individual primitive selectors - these are stable and won't cause re-renders unless the value changes
export const useConnectionState = () => useCodeModeStore((state) => state.connectionState);
export const useConnectionError = () => useCodeModeStore((state) => state.connectionError);
export const useReconnectAttempts = () => useCodeModeStore((state) => state.reconnectAttempts);
export const useActivityState = () => useCodeModeStore((state) => state.activityState);
export const useActivityMessage = () => useCodeModeStore((state) => state.activityMessage);
export const useActiveSessionId = () => useCodeModeStore((state) => state.activeSessionId);
export const useSession = () => useCodeModeStore((state) => state.session);
export const useIsCodeModeActive = () => useCodeModeStore((state) => state.isCodeModeActive);
export const useMessages = () => useCodeModeStore((state) => state.messages, shallow);
export const useStreamingMessage = () => useCodeModeStore((state) => state.streamingMessage);
export const useTotalInputTokens = () => useCodeModeStore((state) => state.totalInputTokens);
export const useTotalOutputTokens = () => useCodeModeStore((state) => state.totalOutputTokens);

// Compound selectors with shallow comparison - use sparingly
// WARNING: These return new objects on every call. Use individual selectors when possible.
export const useCodeModeConnection = () =>
  useCodeModeStore(
    (state) => ({
      connectionState: state.connectionState,
      connectionError: state.connectionError,
      reconnectAttempts: state.reconnectAttempts,
    }),
    shallow
  );

export const useCodeModeActivity = () =>
  useCodeModeStore(
    (state) => ({
      activityState: state.activityState,
      activityMessage: state.activityMessage,
    }),
    shallow
  );

export const useCodeModeMessages = () =>
  useCodeModeStore(
    (state) => ({
      messages: state.messages,
      streamingMessage: state.streamingMessage,
    }),
    shallow
  );

export const useCodeModeTodos = () =>
  useCodeModeStore((state) => state.currentTodos, shallow);

export const useCodeModeSteps = () =>
  useCodeModeStore((state) => state.currentSteps, shallow);

export const useCodeModeSession = () =>
  useCodeModeStore(
    (state) => ({
      sessionId: state.activeSessionId,
      session: state.session,
      isActive: state.isCodeModeActive,
    }),
    shallow
  );

export const useCodeModeUsage = () =>
  useCodeModeStore(
    (state) => ({
      inputTokens: state.totalInputTokens,
      outputTokens: state.totalOutputTokens,
    }),
    shallow
  );
