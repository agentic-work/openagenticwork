/**
 * AgentiCode - Agenticwork CLI UI
 *
 * Features:
 * - Thinking timer with `∴ Thought for Xs` format
 * - Animated status symbols (✶ ✻ ✽ * ✢ ·)
 * - Status words (Synthesizing, Wandering, Frolicking, etc.)
 * - Tool display with `● ToolName(full args)` and `⎿ Waiting...`
 * - Token count and elapsed time display
 * - Contextual tips
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput, Static, useStdin, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { Message, DiffDisplay, parseUnifiedDiff, createDiffFromTexts, type FileDiff } from './components/index.js';
import type { ChatSession } from '../core/session.js';
import type { StreamEvent } from '../core/types.js';
import { executeCommand, isCommand, type CommandContext } from '../core/commands.js';
import type { AuthClient } from '../core/auth-client.js';
import { getLocalPersistence, type LocalSession } from '../core/local-persistence.js';

interface AppProps {
  session: ChatSession;
  model: string;
  workingDirectory: string;
  initialPrompt?: string;
  yoloMode?: boolean;
  authClient?: AuthClient;
  useAlternateBuffer?: boolean;
  resumeSession?: LocalSession | null;
}

// Message in history
interface HistoryItem {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'tool_result' | 'thinking' | 'file_edit';
  content: string;
  status?: 'running' | 'success' | 'error' | 'waiting';
  toolName?: string;
  duration?: number;
  diff?: FileDiff;  // For file edit operations
  filePath?: string;
}

// Todo item for display (agenticwork style)
interface TodoDisplayItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// File edit tool names
const FILE_EDIT_TOOLS = ['edit_file', 'write_file', 'Edit', 'Write', 'create_file', 'replace_file'];

// Activity status for display
type ActivityStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming';

// Permission modes (like Claude Code's ⏵⏵ bypass permissions)
type PermissionMode = 'normal' | 'auto_accept' | 'auto_deny';
const PERMISSION_MODES: PermissionMode[] = ['normal', 'auto_accept', 'auto_deny'];
const PERMISSION_LABELS: Record<PermissionMode, string> = {
  normal: '⏸ permissions required',
  auto_accept: '⏵⏵ bypass permissions on',
  auto_deny: '⏹ auto-deny on',
};

// Agenticwork style activity messages (fun & quirky)
const THINKING_MESSAGES = [
  'Pontificating',
  'Contemplating',
  'Ruminating',
  'Cogitating',
  'Musing',
  'Deliberating',
  'Mulling it over',
  'Deep in thought',
  'Pondering',
  'Reflecting',
];

const WORKING_MESSAGES = [
  'Booping',
  'Tinkering',
  'Crafting',
  'Assembling',
  'Conjuring',
  'Weaving',
  'Brewing',
  'Cooking up',
  'Whipping up',
  'Orchestrating',
];

const STREAMING_MESSAGES = [
  'Scribbling',
  'Writing',
  'Composing',
  'Drafting',
  'Penning',
];

const TOOL_MESSAGES = [
  'Executing',
  'Running',
  'Crunching',
  'Fetching',
  'Processing',
];

// Animated asterisk for activity (agenticwork brand - orange *)
const ANIMATED_ASTERISK = ['*', '✦', '✧', '★', '☆', '✶'];

// Contextual tips
const TIPS = [
  'Tip: Double-tap esc to rewind the code and/or conversation to a previous point in time',
  'Tip: Use /permissions to pre-approve and pre-deny bash, edit, and MCP tools',
  'Tip: Use ctrl+o to show thinking',
  'Tip: Use shift+tab to cycle through permission modes',
];

export const App: React.FC<AppProps> = ({
  session,
  model,
  workingDirectory,
  initialPrompt,
  authClient,
  resumeSession,
}) => {
  const { exit } = useApp();

  // Set max listeners like open-codex does
  const { internal_eventEmitter } = useStdin() as any;
  if (internal_eventEmitter?.setMaxListeners) {
    internal_eventEmitter.setMaxListeners(20);
  }

  // Local session persistence
  const localPersistence = useRef(getLocalPersistence());
  const sessionInitialized = useRef(false);

  const [loading, setLoading] = useState(false);

  // Initialize history from resumed session or empty
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (resumeSession?.messages) {
      // Convert LocalSession messages to HistoryItem format
      return resumeSession.messages.map((m, i) => ({
        id: `resumed-${i}`,
        type: m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'tool',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      } as HistoryItem));
    }
    return [];
  });
  const [inputValue, setInputValue] = useState('');
  const [liveResponse, setLiveResponse] = useState('');
  const [currentModel, setCurrentModel] = useState(model);
  const [activity, setActivity] = useState<ActivityStatus>('idle');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [currentToolArgs, setCurrentToolArgs] = useState<string>('');
  const [currentToolOutput, setCurrentToolOutput] = useState<string[]>([]); // Streaming bash output lines
  const [thinkingPreview, setThinkingPreview] = useState<string>('');
  const [thinkingLines, setThinkingLines] = useState<string[]>([]); // Live thinking bullets

  // agenticwork style timers and counters
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null);
  const [thinkingDuration, setThinkingDuration] = useState<number>(0);
  const [taskStartTime, setTaskStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('');
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [statusWordIndex, setStatusWordIndex] = useState(0);
  const [showTip, setShowTip] = useState(false);
  const [currentTip, setCurrentTip] = useState('');

  // Command history for up/down arrow navigation
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');

  // Todo list display (agenticwork style - shows above input)
  const [todos, setTodos] = useState<TodoDisplayItem[]>([]);

  // Expanded tool results (ctrl+o to toggle)
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  // Permission mode (shift+tab to cycle)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto_accept');

  // Terminal width for full-width input
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  const idRef = useRef(0);
  const getId = () => `msg-${++idRef.current}`;

  // Ref to track full thinking buffer for proper history saving
  const thinkingBufferRef = useRef<string>('');

  // Initialize local session persistence (ONLY for local/Ollama mode, not platform mode)
  // Platform mode uses server-side persistence via PersistenceClient
  const useLocalPersistence = !authClient; // No authClient = local mode

  useEffect(() => {
    if (!useLocalPersistence) return; // Platform handles persistence
    if (sessionInitialized.current) return;
    sessionInitialized.current = true;

    if (resumeSession) {
      // Use existing session
      localPersistence.current.loadSession(resumeSession.id);
    } else {
      // Create new local session
      localPersistence.current.createSession(workingDirectory, model);
    }
  }, [resumeSession, workingDirectory, model, useLocalPersistence]);

  // Save session when history changes (ONLY for local mode)
  useEffect(() => {
    if (!useLocalPersistence) return; // Platform handles persistence
    if (!sessionInitialized.current || history.length === 0) return;

    // Convert HistoryItem to Message format for persistence
    const messages = history
      .filter(h => h.type === 'user' || h.type === 'assistant')
      .map(h => ({
        role: h.type as 'user' | 'assistant',
        content: h.content,
      }));

    localPersistence.current.updateMessages(messages);
  }, [history, useLocalPersistence]);

  // Animate asterisk symbol rotation (agenticwork brand)
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setSymbolIndex(i => (i + 1) % ANIMATED_ASTERISK.length);
    }, 150);
    return () => clearInterval(interval);
  }, [loading]);

  // Rotate activity messages periodically based on state
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      // Cycle through appropriate message list based on activity
      const messageList = activity === 'thinking' ? THINKING_MESSAGES :
                          activity === 'streaming' ? STREAMING_MESSAGES :
                          activity === 'tool_calling' ? TOOL_MESSAGES : WORKING_MESSAGES;
      setStatusWordIndex(i => (i + 1) % messageList.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [loading, activity]);

  // Update thinking timer
  useEffect(() => {
    if (!thinkingStartTime) return;
    const interval = setInterval(() => {
      setThinkingDuration(Math.floor((Date.now() - thinkingStartTime) / 1000));
    }, 100);
    return () => clearInterval(interval);
  }, [thinkingStartTime]);

  // Update elapsed time
  useEffect(() => {
    if (!taskStartTime) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - taskStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      setElapsedTime(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [taskStartTime]);

  // Show tips periodically
  useEffect(() => {
    if (!loading) {
      setShowTip(false);
      return;
    }
    const tipInterval = setInterval(() => {
      setCurrentTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
      setShowTip(true);
      setTimeout(() => setShowTip(false), 5000);
    }, 10000);
    return () => clearInterval(tipInterval);
  }, [loading]);

  // Ctrl+C, ESC, and arrow key handling
  useInput((input, key) => {
    // ESC to interrupt streaming (like Claude Code)
    if (key.escape && loading) {
      session.abort();
      setLoading(false);
      setLiveResponse('');
      setActivity('idle');
      setCurrentTool(null);
      setCurrentToolArgs('');
      setThinkingPreview('');
      setThinkingStartTime(null);
      setTaskStartTime(null);
      // Add interrupted indicator to history
      setHistory(prev => [...prev, {
        id: Date.now().toString(),
        type: 'assistant',
        content: '\n*[Interrupted by user]*',
        status: 'error'
      }]);
      return;
    }

    if (key.ctrl && input === 'c') {
      if (loading) {
        session.abort();
        setLoading(false);
        setLiveResponse('');
        setActivity('idle');
        setCurrentTool(null);
        setCurrentToolArgs('');
        setThinkingPreview('');
        setThinkingStartTime(null);
        setTaskStartTime(null);
      } else {
        exit();
      }
    }

    // Up arrow - navigate to older commands
    if (key.upArrow && !loading && commandHistory.length > 0) {
      if (historyIndex === -1) {
        // Save current input before navigating
        setSavedInput(inputValue);
        setHistoryIndex(commandHistory.length - 1);
        setInputValue(commandHistory[commandHistory.length - 1]);
      } else if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1);
        setInputValue(commandHistory[historyIndex - 1]);
      }
    }

    // Down arrow - navigate to newer commands
    if (key.downArrow && !loading && historyIndex !== -1) {
      if (historyIndex < commandHistory.length - 1) {
        setHistoryIndex(historyIndex + 1);
        setInputValue(commandHistory[historyIndex + 1]);
      } else {
        // Return to saved input
        setHistoryIndex(-1);
        setInputValue(savedInput);
      }
    }

    // Ctrl+O - toggle expand/collapse all tool results
    if (key.ctrl && input === 'o') {
      // Toggle: if any are expanded, collapse all; otherwise expand all
      const toolResultIds = history
        .filter(h => h.type === 'tool_result')
        .map(h => h.id);

      if (expandedResults.size > 0) {
        // Collapse all
        setExpandedResults(new Set());
      } else {
        // Expand all
        setExpandedResults(new Set(toolResultIds));
      }
    }

    // Shift+Tab - cycle permission modes
    if (key.shift && key.tab) {
      setPermissionMode(current => {
        const currentIndex = PERMISSION_MODES.indexOf(current);
        const nextIndex = (currentIndex + 1) % PERMISSION_MODES.length;
        return PERMISSION_MODES[nextIndex];
      });
    }
  });

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    // Add to command history
    setCommandHistory(h => [...h.slice(-99), text]); // Keep last 100 commands
    setHistoryIndex(-1);
    setSavedInput('');
    setInputValue('');

    // Handle commands
    if (isCommand(text)) {
      const cmdContext: CommandContext = {
        session,
        authClient,
        workingDirectory,
        currentModel,
        onModelChange: setCurrentModel,
        onClear: () => setHistory([]),
        onExit: exit,
      };
      const result = await executeCommand(text, cmdContext);
      if (result.output) {
        setHistory(h => [...h, { id: getId(), type: 'assistant', content: result.output }]);
      }
      return;
    }

    // Add user message
    setHistory(h => [...h, { id: getId(), type: 'user', content: text }]);
    setLoading(true);
    setLiveResponse('');
    setActivity('thinking');
    setThinkingPreview('');
    setThinkingLines([]);
    setThinkingStartTime(Date.now());
    setTaskStartTime(Date.now());
    setThinkingDuration(0);
    setTokenCount(0);

    // Helper to yield to event loop - forces React/Ink to re-render
    const flushUpdates = () => new Promise<void>(resolve => setImmediate(resolve));

    // Flush immediately to show user message and loading state
    await flushUpdates();

    try {
      let response = '';
      let thinkingBuffer = '';
      let tokens = 0;
      let lastBlockType: 'thinking' | 'text' | null = null;

      for await (const event of session.chatEvents(text)) {
        // Handle thinking events - INTERLEAVED with text
        if (event.type === 'thinking' && event.text) {
          // If we were streaming text, save it to history first (interleaving)
          if (lastBlockType === 'text' && response.trim()) {
            setHistory(h => [...h, {
              id: getId(),
              type: 'assistant',
              content: response,
            }]);
            response = ''; // Reset for next text block
            setLiveResponse('');
          }

          lastBlockType = 'thinking';
          thinkingBuffer += event.text;
          thinkingBufferRef.current = thinkingBuffer;
          setActivity('thinking');

          // Estimate tokens (~4 chars per token)
          tokens = Math.ceil(thinkingBuffer.length / 4);
          setTokenCount(tokens);

          // Show streaming thinking content - last 15 lines for scrolling view
          const lines = thinkingBuffer.split('\n').filter(l => l.trim().length > 0);
          const displayLines = lines.slice(-15).map(s => s.trim().slice(0, 120));
          if (displayLines.length > 0) {
            setThinkingLines(displayLines);
          }

          // Also keep preview for status line
          const preview = thinkingBuffer.slice(-100).replace(/\n/g, ' ').trim();
          if (preview) {
            setThinkingPreview(preview.length > 50 ? '...' + preview.slice(-50) : preview);
          }
          // Flush every few thinking updates for live display
          if (thinkingBuffer.length % 50 < 10) {
            await flushUpdates();
          }
        }

        // Handle text streaming - INTERLEAVED with thinking
        if (event.type === 'text' && event.text) {
          // If we were thinking, save thinking to history first (interleaving)
          if (lastBlockType === 'thinking' && thinkingBufferRef.current) {
            const fullThinking = thinkingBufferRef.current;
            const thinkingTokens = Math.ceil(fullThinking.length / 4);
            setHistory(h => [...h, {
              id: getId(),
              type: 'thinking',
              content: fullThinking,
              status: 'success',
              duration: thinkingTokens,
            }]);
            thinkingBufferRef.current = '';
            thinkingBuffer = '';
          }

          lastBlockType = 'text';
          setThinkingLines([]); // Clear display lines
          setActivity('streaming');
          setThinkingPreview('');
          setThinkingStartTime(null);
          response += event.text;
          tokens += event.text.split(/\s+/).length;
          setTokenCount(tokens);
          setLiveResponse(response);
          // Flush for live streaming display
          await flushUpdates();
        }

        // Handle tool_pending - LLM decided to call a tool (shows immediately)
        if (event.type === 'tool_pending' && event.tool) {
          // Save any pending thinking/text content before tool call (interleaving)
          if (thinkingBufferRef.current) {
            const fullThinking = thinkingBufferRef.current;
            const thinkingTokens = Math.ceil(fullThinking.length / 4);
            setHistory(h => [...h, {
              id: getId(),
              type: 'thinking',
              content: fullThinking,
              status: 'success',
              duration: thinkingTokens,
            }]);
            thinkingBufferRef.current = '';
            thinkingBuffer = '';
            setThinkingLines([]);
          }
          if (response.trim()) {
            setHistory(h => [...h, {
              id: getId(),
              type: 'assistant',
              content: response,
            }]);
            response = '';
            setLiveResponse('');
          }
          lastBlockType = null;

          const tool = event.tool;
          setActivity('tool_calling');
          setCurrentTool(tool.name);

          // If it's todo_write, update todos display immediately
          if (tool.name === 'todo_write' && tool.args?.todos) {
            const todoArgs = tool.args.todos as Array<{ content?: string; name?: string; title?: string; status: string }>;
            setTodos(todoArgs.map(t => ({
              content: t.content || t.name || t.title || 'Task',
              status: t.status as 'pending' | 'in_progress' | 'completed',
            })));
          }

          // Show FULL args does
          const argsStr = Object.entries(tool.args || {})
            .map(([k, v]) => typeof v === 'string' ? v : JSON.stringify(v))
            .join(', ');
          setCurrentToolArgs(argsStr);
          const toolDisplay = argsStr ? `${tool.name}(${argsStr})` : tool.name;
          setHistory(h => [...h, {
            id: getId(),
            type: 'tool',
            content: toolDisplay,
            status: 'waiting',  // Show as "waiting" before execution starts
            toolName: tool.name,
          }]);
          // CRITICAL: Flush immediately to show tool as soon as LLM decides to call it
          await flushUpdates();
        }

        // Handle tool start - execution actually begins
        if (event.type === 'tool_start' && event.tool) {
          const tool = event.tool;
          setActivity('tool_calling');
          setCurrentTool(tool.name);
          setCurrentToolOutput([]); // Reset streaming output
          // Update existing tool entry to "running" status (or add if not there)
          // We don't add to history again since tool_pending already did that
          // CRITICAL: Flush immediately to show tool execution in real-time
          await flushUpdates();
        }

        // Handle tool progress - streaming bash/shell output
        if (event.type === 'tool_progress' && event.tool) {
          const output = event.tool.output || '';
          if (output) {
            // Append new output lines, keeping last 15 lines for display
            setCurrentToolOutput(prev => {
              const newLines = output.split('\n').filter(l => l.length > 0);
              const combined = [...prev, ...newLines];
              return combined.slice(-15); // Keep last 15 lines
            });
            await flushUpdates();
          }
        }

        // Handle tool completion
        if ((event.type === 'tool_complete' || event.type === 'tool_error') && event.tool) {
          const tool = event.tool;
          setCurrentTool(null);
          setCurrentToolArgs('');
          setCurrentToolOutput([]); // Clear streaming output
          const output = tool.output || tool.error || '';
          const isError = event.type === 'tool_error' || tool.status === 'error';

          // Check if this is a todo_write - update todos display
          if (tool.name === 'todo_write' && tool.args?.todos) {
            const todoArgs = tool.args.todos as Array<{ content?: string; name?: string; title?: string; status: string }>;
            setTodos(todoArgs.map(t => ({
              content: t.content || t.name || t.title || 'Task',
              status: t.status as 'pending' | 'in_progress' | 'completed',
            })));
          }

          // Check if this is a file edit operation
          const isFileEdit = FILE_EDIT_TOOLS.includes(tool.name);

          if (isFileEdit && output && !isError) {
            // Parse file path from args - ensure it's always a string
            const args = tool.args || {};
            const rawFilePath = args.file_path || args.path || args.filePath ||
                               (typeof args === 'string' ? args : null);
            const filePath: string = typeof rawFilePath === 'string' ? rawFilePath : 'file';

            // Try to parse as unified diff or create simple diff
            let diff: FileDiff;
            if (output.includes('@@') || output.startsWith('---') || output.startsWith('+++')) {
              // Unified diff format
              diff = parseUnifiedDiff(output, filePath);
            } else {
              // Simple output - treat as new content
              const oldContentRaw = args.old_content || args.oldContent || null;
              const newContentRaw = args.new_content || args.newContent || args.content || output;
              const oldContent = typeof oldContentRaw === 'string' ? oldContentRaw : null;
              const newContent = typeof newContentRaw === 'string' ? newContentRaw : String(newContentRaw);
              diff = createDiffFromTexts(filePath, oldContent, newContent);
            }

            setHistory(h => [...h, {
              id: getId(),
              type: 'file_edit' as const,
              content: output,
              status: 'success' as const,
              toolName: tool.name,
              diff,
              filePath,
            }]);
          } else if (output) {
            // Regular tool output - Truncate long output
            const lines = output.split('\n');
            const maxLines = 8;
            const truncated = lines.length > maxLines
              ? lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`
              : output;

            setHistory(h => [...h, {
              id: getId(),
              type: 'tool_result',
              content: truncated,
              status: isError ? 'error' : 'success',
              toolName: tool.name,
            }]);
          }
          // Flush immediately to show tool result in real-time
          await flushUpdates();
        }

        // Handle completion
        if (event.type === 'done') {
          // Save any remaining thinking content
          if (thinkingBufferRef.current) {
            const fullThinking = thinkingBufferRef.current;
            const thinkingTokens = Math.ceil(fullThinking.length / 4);
            setHistory(h => [...h, {
              id: getId(),
              type: 'thinking',
              content: fullThinking,
              status: 'success',
              duration: thinkingTokens,
            }]);
            thinkingBufferRef.current = '';
          }
          // Save any remaining response
          if (response) {
            setHistory(h => [...h, { id: getId(), type: 'assistant', content: response }]);
          }
          setLiveResponse('');
          setThinkingLines([]);
          setLoading(false);
          setActivity('idle');
          setCurrentTool(null);
          setCurrentToolArgs('');
          setThinkingPreview('');
          setThinkingStartTime(null);
          setTaskStartTime(null);
        }

        // Handle errors
        if (event.type === 'error') {
          setHistory(h => [...h, { id: getId(), type: 'assistant', content: `Error: ${event.error}` }]);
          setLoading(false);
          setActivity('idle');
          setCurrentTool(null);
          setCurrentToolArgs('');
          setThinkingPreview('');
          setThinkingStartTime(null);
          setTaskStartTime(null);
        }
      }
    } catch (err) {
      setHistory(h => [...h, { id: getId(), type: 'assistant', content: `Error: ${err}` }]);
      setLoading(false);
      setActivity('idle');
      setCurrentTool(null);
      setCurrentToolArgs('');
      setThinkingPreview('');
      setThinkingStartTime(null);
      setTaskStartTime(null);
    }
  }, [session, loading, authClient, workingDirectory, currentModel, exit]);

  // Initial prompt
  useEffect(() => {
    if (initialPrompt) {
      handleSubmit(initialPrompt);
    }
  }, []);

  // Format token count
  const formatTokens = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  // Get current animated asterisk (agenticwork brand)
  const getCurrentSymbol = () => ANIMATED_ASTERISK[symbolIndex];

  // Get current activity message based on state
  const getActivityMessage = () => {
    const messageList = activity === 'thinking' ? THINKING_MESSAGES :
                        activity === 'streaming' ? STREAMING_MESSAGES :
                        activity === 'tool_calling' ? TOOL_MESSAGES : WORKING_MESSAGES;
    return messageList[statusWordIndex % messageList.length];
  };

  // Get thinking display
  const getThinkingDisplay = () => {
    if (thinkingDuration > 0) {
      return `∴ Thought for ${thinkingDuration}s`;
    }
    return '';
  };

  return (
    <Box flexDirection="column">
      {/* Header - agenticwork brand */}
      <Box marginBottom={1}>
        <Text bold color="yellow">✦</Text>
        <Text bold color="white"> agenticode</Text>
        <Text color="gray"> {currentModel}</Text>
        <Text color="gray" dimColor> • {workingDirectory.split('/').slice(-2).join('/')}</Text>
      </Box>

      {/* Message history - Static prevents re-renders */}
      <Static items={history}>
        {(item) => (
          <Box key={item.id} flexDirection="column" marginBottom={0}>
            {item.type === 'user' && (
              <Box marginY={1}>
                <Text bold color="blue">❯ </Text>
                <Text>{item.content}</Text>
              </Box>
            )}
            {item.type === 'tool' && (
              <Box flexDirection="column" marginLeft={0}>
                <Box>
                  <Text color="yellow">● </Text>
                  <Text color="yellow">{item.toolName}</Text>
                  <Text color="gray">(</Text>
                  <Text>{item.content.replace(`${item.toolName}(`, '').replace(/\)$/, '').slice(0, 80)}</Text>
                  <Text color="gray">)</Text>
                </Box>
              </Box>
            )}
            {item.type === 'tool_result' && (
              <Box marginLeft={2} flexDirection="column">
                {expandedResults.has(item.id) ? (
                  /* Expanded view - show all content */
                  <Box flexDirection="column">
                    <Box>
                      <Text color="gray">⎿  </Text>
                      <Text color={item.status === 'error' ? 'red' : 'gray'}>
                        {item.content.split('\n')[0]}
                      </Text>
                    </Box>
                    {item.content.split('\n').slice(1).map((line, i) => (
                      <Box key={i} marginLeft={3}>
                        <Text color={item.status === 'error' ? 'red' : 'gray'}>{line}</Text>
                      </Box>
                    ))}
                    <Box marginLeft={3}>
                      <Text color="gray" dimColor>(ctrl+o to collapse)</Text>
                    </Box>
                  </Box>
                ) : (
                  /* Collapsed view - show first line + count */
                  <>
                    <Box>
                      <Text color="gray">⎿  </Text>
                      {item.status === 'error' ? (
                        <Text color="red">{item.content.split('\n')[0]}</Text>
                      ) : (
                        <Text color="gray">{item.content.split('\n')[0].slice(0, 60)}</Text>
                      )}
                    </Box>
                    {item.content.split('\n').length > 1 && (
                      <Box marginLeft={3}>
                        <Text color="gray" dimColor>… +{item.content.split('\n').length - 1} lines </Text>
                        <Text color="gray" dimColor>(ctrl+o to expand)</Text>
                      </Box>
                    )}
                  </>
                )}
              </Box>
            )}
            {item.type === 'file_edit' && item.diff && (
              <DiffDisplay diff={item.diff} collapsed={true} maxLines={15} />
            )}
            {item.type === 'thinking' && (
              <Box flexDirection="column" marginBottom={0}>
                {/* Header - inline style, no box */}
                <Box marginBottom={0}>
                  <Text color="cyan">◇ Thought for </Text>
                  {item.duration && item.duration > 0 && (
                    <Text color="cyan">{Math.ceil(item.duration / 15)}s</Text>
                  )}
                </Box>
                {/* Show collapsed thinking - just a preview */}
                {(() => {
                  const lines = item.content.split('\n').filter(l => l.trim().length > 0);
                  const preview = lines.slice(0, 3);
                  const hasMore = lines.length > 3;
                  return (
                    <>
                      {preview.map((line, i) => (
                        <Box key={i}>
                          <Text color="gray">  {line.slice(0, terminalWidth - 10)}</Text>
                        </Box>
                      ))}
                      {hasMore && (
                        <Box>
                          <Text color="gray">  ... ({lines.length - 3} more lines)</Text>
                        </Box>
                      )}
                    </>
                  );
                })()}
              </Box>
            )}
            {item.type === 'assistant' && (
              <Box marginY={1}>
                <Message role="assistant" content={item.content} />
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* Live thinking display - inline streaming like Claude Code (NO BOX) */}
      {loading && activity === 'thinking' && (
        <Box flexDirection="column" marginBottom={0}>
          {/* Streaming thinking content - inline, no borders */}
          {thinkingLines.length > 0 ? (
            <Box flexDirection="column">
              {thinkingLines.map((line, i) => (
                <Box key={i}>
                  <Text color="gray">  {line}</Text>
                </Box>
              ))}
              <Box>
                <Text color="gray">  </Text>
                <Text color="cyan">▊</Text>
              </Box>
            </Box>
          ) : (
            <Box>
              <Text color="cyan" bold>◇ </Text>
              <Text color="cyan">Ruminating...</Text>
              {tokenCount > 0 && (
                <Text color="gray"> (↓ {tokenCount} tokens)</Text>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Tool execution display - agenticwork style with streaming output */}
      {loading && currentTool && (
        <Box flexDirection="column" marginBottom={0}>
          <Box>
            <Text color="yellow">● </Text>
            <Text color="yellow">{currentTool}</Text>
            <Text color="gray">(</Text>
            <Text>{currentToolArgs.slice(0, 80)}{currentToolArgs.length > 80 ? '…' : ''}</Text>
            <Text color="gray">)</Text>
          </Box>
          {/* Streaming output lines - like Claude Code's bash display */}
          {currentToolOutput.length > 0 ? (
            <Box flexDirection="column" marginLeft={2}>
              {currentToolOutput.map((line, idx) => (
                <Box key={idx}>
                  <Text color="gray">│ </Text>
                  <Text color="white" dimColor>{line.slice(0, terminalWidth - 10)}</Text>
                </Box>
              ))}
              <Box>
                <Text color="gray">⎿  </Text>
                <Text color="yellow" bold>{getCurrentSymbol()}</Text>
                <Text color="gray"> streaming...</Text>
              </Box>
            </Box>
          ) : (
            <Box marginLeft={2}>
              <Text color="gray">⎿  </Text>
              <Text color="yellow" bold>{getCurrentSymbol()}</Text>
              <Text color="yellow"> {getActivityMessage()}…</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Live response while streaming */}
      {loading && liveResponse && (
        <Box marginBottom={1}>
          <Message role="assistant" content={liveResponse} streaming />
        </Box>
      )}

      {/* Activity indicator - agenticwork style with animated * (orange) */}
      {loading && !liveResponse && !currentTool && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="yellow" bold>{getCurrentSymbol()} </Text>
            <Text color="yellow">{getActivityMessage()}… </Text>
            <Text color="gray">(esc to interrupt</Text>
            {elapsedTime && <Text color="gray"> · {elapsedTime}</Text>}
            {tokenCount > 0 && <Text color="gray"> · ↓ {formatTokens(tokenCount)} tokens</Text>}
            <Text color="gray">)</Text>
          </Box>
        </Box>
      )}

      {/* Todo list display - agenticwork style (above input, strikethrough for completed) */}
      {todos.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {todos.map((todo, index) => (
            <Box key={index}>
              <Text color={todo.status === 'completed' ? 'green' : todo.status === 'in_progress' ? 'yellow' : 'gray'}>
                {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : '○'}
              </Text>
              <Text
                color={todo.status === 'completed' ? 'gray' : 'white'}
                dimColor={todo.status === 'completed'}
                strikethrough={todo.status === 'completed'}
              >
                {' '}{todo.content}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Separator line - full terminal width (agenticwork orange/yellow) */}
      <Box width={terminalWidth}>
        <Text color="yellow" dimColor>{'─'.repeat(terminalWidth)}</Text>
      </Box>

      {/* Input box - full terminal width */}
      <Box paddingX={0} marginY={0} width={terminalWidth}>
        {loading ? (
          <Box width={terminalWidth}>
            <Text color="yellow">❯ </Text>
            <Text color="gray" dimColor>{getActivityMessage()}...</Text>
          </Box>
        ) : (
          <Box width={terminalWidth}>
            <Text color="yellow">❯ </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="What can I help you build?"
              focus={!loading}
            />
          </Box>
        )}
      </Box>

      {/* Separator line - full terminal width */}
      <Box width={terminalWidth}>
        <Text color="yellow" dimColor>{'─'.repeat(terminalWidth)}</Text>
      </Box>

      {/* Status bar - full terminal width (agenticwork style) */}
      <Box width={terminalWidth}>
        <Text color={permissionMode === 'auto_deny' ? 'red' : permissionMode === 'auto_accept' ? 'yellow' : 'gray'}>
          {PERMISSION_LABELS[permissionMode]}
        </Text>
        <Text color="gray" dimColor> (shift+tab to cycle)</Text>
      </Box>
    </Box>
  );
};

export default App;
