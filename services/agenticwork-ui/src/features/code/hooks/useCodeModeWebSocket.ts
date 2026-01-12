/**
 * useCodeModeWebSocket - WebSocket Hook for Code Mode V2
 *
 * Bridges WebSocket events to the new Zustand store (useCodeModeStore).
 * Handles structured streaming events and updates store state for
 * the Agenticode-style React UI.
 *
 * This is the V2 hook - works with CodeModeLayoutV2.
 */

import { useCallback, useRef, useEffect } from 'react';
import {
  useCodeModeStore,
  type ActivityState,
  type ToolStep,
  type TodoItem,
  type DiffLine,
} from '@/stores/useCodeModeStore';
import { useModelStore } from '@/stores/useModelStore';
import {
  AgenticodeStreamEvent,
  detectLanguage,
} from '../types/protocol';

interface UseCodeModeWebSocketOptions {
  userId: string;
  initialSessionId?: string;
  enabled?: boolean;
  workspacePath?: string;
  model?: string;
  /** Auth token for API mode - enables platform LLM providers instead of Ollama */
  authToken?: string;
  onFilesChanged?: () => void;
}

// File attachment interface for sending with messages
export interface FileAttachment {
  name: string;
  type: string;
  content: string; // base64 encoded
}

interface UseCodeModeWebSocketReturn {
  sendMessage: (message: string, files?: FileAttachment[]) => Promise<void>;
  stopExecution: () => void;
  disconnect: () => void;
  reconnect: () => void;
}

// Map WebSocket activity states to store ActivityState
const mapActivityState = (wsState: string): ActivityState => {
  switch (wsState) {
    case 'thinking':
      return 'thinking';
    case 'writing':
    case 'editing':
      return 'streaming';
    case 'executing':
      return 'tool_executing';
    case 'tool_calling':
      return 'tool_calling';
    case 'error':
      return 'error';
    case 'idle':
    default:
      return 'idle';
  }
};

// Parse diff content into DiffLine[]
const parseDiffContent = (content: string, isNewFile = false): DiffLine[] => {
  const lines = content.split('\n');
  const diffLines: DiffLine[] = [];
  let lineNum = 1;

  for (const line of lines) {
    if (isNewFile) {
      diffLines.push({
        type: 'add',
        newLineNumber: lineNum++,
        content: line,
      });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      diffLines.push({
        type: 'add',
        newLineNumber: lineNum++,
        content: line.slice(1),
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      diffLines.push({
        type: 'remove',
        oldLineNumber: lineNum,
        content: line.slice(1),
      });
    } else {
      diffLines.push({
        type: 'context',
        lineNumber: lineNum++,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
    }
  }

  return diffLines;
};

export function useCodeModeWebSocket({
  userId,
  initialSessionId,
  enabled = true,
  workspacePath = '/workspace',
  model = 'claude-sonnet-4-20250514',
  authToken,
  onFilesChanged,
}: UseCodeModeWebSocketOptions): UseCodeModeWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const pendingToolsRef = useRef<Map<string, ToolStep>>(new Map());
  const isConnectingRef = useRef(false);

  // Store options in refs to prevent callback recreation on every render
  // This is critical to prevent React error #185 (infinite re-render loop)
  const optionsRef = useRef({ userId, workspacePath, model, authToken, onFilesChanged });
  optionsRef.current = { userId, workspacePath, model, authToken, onFilesChanged };

  // NOTE: We access store actions via getState() INSIDE callbacks to ensure stable references
  // and prevent React error #185 (Maximum update depth exceeded)

  // Handle WebSocket events and update store
  const handleWebSocketEvent = useCallback(
    (event: AgenticodeStreamEvent) => {
      // Get store actions inside callback to ensure stable reference
      const store = useCodeModeStore.getState();
      // Get options from ref to avoid dependency on changing props
      const { userId: uid, workspacePath: wsp, model: mdl, onFilesChanged: ofc } = optionsRef.current;
      console.log('[CodeModeWS] Event:', event.type, event);

      switch (event.type) {
        case 'session_started': {
          const sessionEvent = event as any;
          store.setActiveSession(sessionEvent.sessionId, {
            sessionId: sessionEvent.sessionId,
            userId: uid,
            workspacePath: wsp,
            model: mdl,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
          });
          store.setConnectionState('connected');
          store.resetReconnectAttempts();
          store.setActivityState('idle');
          break;
        }

        case 'session_ended':
          store.setActivityState('complete');
          break;

        case 'thinking_start':
          store.startAssistantMessage();
          store.setActivityState('thinking');
          break;

        case 'thinking_block':
        case 'thinking_update': {
          const thinkingEvent = event as any;
          store.updateStreamingThinking(thinkingEvent.text || thinkingEvent.step || '');
          break;
        }

        case 'thinking_end':
          // Will transition to streaming or tool_calling
          break;

        case 'text_block':
        case 'text_delta': {
          const textEvent = event as any;
          const text = textEvent.text || textEvent.delta || '';
          store.updateStreamingText(text);
          store.setActivityState('streaming');
          break;
        }

        case 'file_write_start': {
          const writeEvent = event as any;
          const stepId = `write-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: stepId,
            name: 'Write',
            displayName: 'Write',
            status: 'executing',
            startTime: Date.now(),
            filePath: writeEvent.path,
            language: writeEvent.language || detectLanguage(writeEvent.path),
            inputPreview: '',
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(stepId, step as ToolStep);
          store.setActivityState('streaming');
          break;
        }

        case 'file_write_chunk': {
          const chunkEvent = event as any;
          // Find the pending write step
          const entries = Array.from(pendingToolsRef.current.entries());
          const [stepId, step] = entries.find(([, s]) => s.name === 'Write' && s.status === 'executing') || [];
          if (stepId && step) {
            const newContent = (step.inputPreview || '') + chunkEvent.content;
            store.updateToolStep(stepId, {
              inputPreview: newContent,
              diff: parseDiffContent(newContent, true),
            });
            step.inputPreview = newContent;
          }
          break;
        }

        case 'file_write_end': {
          const writeEndEvent = event as any;
          const entries = Array.from(pendingToolsRef.current.entries());
          const [stepId] = entries.find(([, s]) => s.name === 'Write' && s.status === 'executing') || [];
          if (stepId) {
            store.finalizeToolStep(stepId, 'File written successfully');
            pendingToolsRef.current.delete(stepId);
          }
          ofc?.();
          break;
        }

        case 'file_edit_start': {
          const editEvent = event as any;
          const stepId = `edit-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: stepId,
            name: 'Edit',
            displayName: 'Edit',
            status: 'executing',
            startTime: Date.now(),
            filePath: editEvent.path,
            language: detectLanguage(editEvent.path),
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(stepId, step as ToolStep);
          store.setActivityState('streaming');
          break;
        }

        case 'file_edit_diff': {
          const diffEvent = event as any;
          const entries = Array.from(pendingToolsRef.current.entries());
          const [stepId] = entries.find(([, s]) => s.name === 'Edit' && s.status === 'executing') || [];
          if (stepId && diffEvent.hunks) {
            // Convert hunks to DiffLine format
            const diffLines: DiffLine[] = [];
            for (const hunk of diffEvent.hunks) {
              for (const line of hunk.lines || []) {
                if (line.startsWith('+')) {
                  diffLines.push({ type: 'add', content: line.slice(1) });
                } else if (line.startsWith('-')) {
                  diffLines.push({ type: 'remove', content: line.slice(1) });
                } else {
                  diffLines.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line });
                }
              }
            }
            store.updateToolStep(stepId, { diff: diffLines });
          }
          break;
        }

        case 'file_edit_end': {
          const entries = Array.from(pendingToolsRef.current.entries());
          const [stepId] = entries.find(([, s]) => s.name === 'Edit' && s.status === 'executing') || [];
          if (stepId) {
            store.finalizeToolStep(stepId, 'File edited successfully');
            pendingToolsRef.current.delete(stepId);
          }
          ofc?.();
          break;
        }

        case 'command_start': {
          const cmdEvent = event as any;
          const stepId = `bash-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: stepId,
            name: 'Bash',
            displayName: 'Bash',
            status: 'executing',
            startTime: Date.now(),
            command: cmdEvent.command,
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(stepId, step as ToolStep);
          store.setActivityState('tool_executing');
          break;
        }

        case 'command_output': {
          const outputEvent = event as any;
          const entries = Array.from(pendingToolsRef.current.entries());
          const [stepId, step] = entries.find(([, s]) => s.name === 'Bash' && s.status === 'executing') || [];
          if (stepId && step) {
            const newOutput = (step.output || '') + outputEvent.output;
            store.updateToolStep(stepId, { output: newOutput });
            step.output = newOutput;
          }
          break;
        }

        case 'command_end': {
          const cmdEndEvent = event as any;
          const entries = Array.from(pendingToolsRef.current.entries());
          const [stepId, step] = entries.find(([, s]) => s.name === 'Bash' && s.status === 'executing') || [];
          if (stepId) {
            const isError = cmdEndEvent.exitCode !== 0;
            // Preserve accumulated output from command_output events, append exit code
            const accumulatedOutput = step?.output || '';
            const finalOutput = accumulatedOutput
              ? `${accumulatedOutput}\n\nExit code: ${cmdEndEvent.exitCode}`
              : `Exit code: ${cmdEndEvent.exitCode}`;
            store.finalizeToolStep(stepId, finalOutput, isError);
            pendingToolsRef.current.delete(stepId);
          }
          break;
        }

        case 'tool_call':  // AgenticCodeService sends this
        case 'tool_start':
        case 'tool_use_start': {
          const toolEvent = event as any;
          const stepId = toolEvent.toolId || toolEvent.id || `tool-${Date.now()}`;
          const rawToolName = toolEvent.toolName || toolEvent.tool || toolEvent.name || 'Tool';

          // Format tool name nicely: todo_write -> TodoWrite, str_replace -> StrReplace
          const displayName = rawToolName
            .split('_')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');

          // Get a summary for the header text based on tool input
          // AgenticCodeService sends 'params', other sources send 'args' or 'input'
          const input = toolEvent.params || toolEvent.args || toolEvent.input || {};
          let inputSummary: string | undefined;

          // Extract file path from tool input (different tools use different field names)
          const filePath = input.file_path || input.path || input.filePath ||
                          input.filename || input.file || toolEvent.path;

          // Extract command for bash-like tools
          const command = input.command || input.cmd || toolEvent.command;

          // Extract meaningful info from common tool inputs
          if (input.content && typeof input.content === 'string') {
            // For TodoWrite, show number of items
            if (rawToolName.toLowerCase().includes('todo')) {
              try {
                const todos = JSON.parse(input.content);
                if (Array.isArray(todos)) {
                  inputSummary = `${todos.length} item${todos.length !== 1 ? 's' : ''}`;
                }
              } catch {
                inputSummary = input.content.substring(0, 50);
              }
            } else {
              inputSummary = input.content.substring(0, 50) + (input.content.length > 50 ? '...' : '');
            }
          } else if (input.todos && Array.isArray(input.todos)) {
            inputSummary = `${input.todos.length} item${input.todos.length !== 1 ? 's' : ''}`;
          } else if (input.query) {
            inputSummary = input.query.substring(0, 50);
          } else if (input.pattern) {
            inputSummary = input.pattern;
          }

          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: stepId,
            name: displayName,
            displayName: displayName,
            status: 'executing',
            startTime: Date.now(),
            input: input,
            // Set file path for Write/Edit/Read tools
            filePath: filePath,
            // Set command for Bash tools
            command: command,
            // Use inputSummary for header display instead of showing displayName twice
            inputPreview: inputSummary,
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(stepId, step as ToolStep);
          store.setActivityState('tool_calling');
          break;
        }

        case 'tool_end':
        case 'tool_result': {
          const toolEndEvent = event as any;
          const toolId = toolEndEvent.toolId || toolEndEvent.toolUseId;
          if (toolId && pendingToolsRef.current.has(toolId)) {
            const isError = toolEndEvent.isError || toolEndEvent.error;
            // Support multiple field names for output: result (AgenticCodeService), output, content
            const rawOutput = toolEndEvent.result || toolEndEvent.output || toolEndEvent.content || '';
            const output = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2);

            // If we have file path info in the result, update the step
            const resultPath = toolEndEvent.path || toolEndEvent.file_path || toolEndEvent.filePath;
            if (resultPath) {
              store.updateToolStep(toolId, { filePath: resultPath });
            }

            store.finalizeToolStep(toolId, output, !!isError);

            // Check if this was a file operation tool - trigger refresh
            const pendingTool = pendingToolsRef.current.get(toolId);
            const toolName = pendingTool?.name?.toLowerCase() || toolEndEvent.toolName?.toLowerCase() || '';
            const fileOpsTools = ['write', 'edit', 'create', 'delete', 'mv', 'cp', 'rm', 'write_file', 'edit_file', 'create_file', 'delete_file', 'bash'];

            if (!isError && fileOpsTools.some(op => toolName.includes(op))) {
              // Debounce file refresh to avoid rapid-fire updates
              setTimeout(() => {
                console.log('[CodeModeWS] File operation detected, triggering refresh');
                ofc?.();
              }, 500);
            }

            pendingToolsRef.current.delete(toolId);
          }
          break;
        }

        // Handle tool_executing events from SSE/chat stream (includes full arguments)
        case 'tool_executing': {
          const toolEvent = event as any;
          const stepId = toolEvent.toolCallId || `tool-${Date.now()}`;
          const rawToolName = toolEvent.name || 'Tool';

          // Format tool name nicely: todo_write -> TodoWrite, str_replace -> StrReplace
          const displayName = rawToolName
            .split('_')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');

          // Extract arguments from the event
          const args = toolEvent.arguments || {};

          // Extract file path from arguments (different tools use different field names)
          const filePath = args.file_path || args.path || args.filePath ||
                          args.filename || args.file || toolEvent.path;

          // Extract command for bash-like tools
          const command = args.command || args.cmd || toolEvent.command;

          // Create input summary for header
          let inputSummary: string | undefined;
          if (args.content && typeof args.content === 'string' && rawToolName.toLowerCase().includes('todo')) {
            try {
              const todos = JSON.parse(args.content);
              if (Array.isArray(todos)) {
                inputSummary = `${todos.length} item${todos.length !== 1 ? 's' : ''}`;
              }
            } catch {
              inputSummary = args.content.substring(0, 50);
            }
          } else if (args.todos && Array.isArray(args.todos)) {
            inputSummary = `${args.todos.length} item${args.todos.length !== 1 ? 's' : ''}`;
          }

          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: stepId,
            name: displayName,
            displayName: displayName,
            status: 'executing',
            startTime: Date.now(),
            input: args,
            filePath: filePath,
            command: command,
            inputPreview: inputSummary,
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(stepId, step as ToolStep);
          store.setActivityState('tool_executing');
          break;
        }

        case 'todo_update': {
          const todoEvent = event as any;
          if (todoEvent.todos) {
            const todos: TodoItem[] = todoEvent.todos.map((t: any, i: number) => ({
              id: t.id || `todo-${i}`,
              content: t.content,
              status: t.status,
              activeForm: t.activeForm,
            }));
            store.setTodos(todos);
          }
          break;
        }

        case 'usage': {
          const usageEvent = event as any;
          store.addUsage(
            usageEvent.inputTokens || 0,
            usageEvent.outputTokens || 0,
            usageEvent.cacheRead,
            usageEvent.cacheWrite
          );
          break;
        }

        // ===========================================
        // Agentic Workflow Events (from awp-agenticwork-cli-mcp)
        // ===========================================

        case 'step_start': {
          const stepEvent = event as any;
          const stepId = stepEvent.stepId || `step-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: stepId,
            name: 'execute_step',
            displayName: stepEvent.stepName || 'Executing Step',
            status: 'executing',
            startTime: Date.now(),
            inputPreview: stepEvent.stepDescription || '',
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(stepId, step as ToolStep);
          store.setActivityState('tool_executing');
          break;
        }

        case 'step_complete': {
          const stepEvent = event as any;
          const stepId = stepEvent.stepId;
          if (stepId && pendingToolsRef.current.has(stepId)) {
            const isError = stepEvent.status === 'error';
            store.finalizeToolStep(stepId, '', isError);
            pendingToolsRef.current.delete(stepId);
          }
          break;
        }

        case 'artifact_start': {
          const artifactEvent = event as any;
          const artifactId = artifactEvent.artifactId || `artifact-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: artifactId,
            name: 'create_artifact',
            displayName: artifactEvent.artifactName || 'Creating Artifact',
            status: 'executing',
            startTime: Date.now(),
            filePath: artifactEvent.filepath,
            inputPreview: artifactEvent.description || artifactEvent.filepath || '',
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(artifactId, step as ToolStep);
          store.setActivityState('tool_executing');
          break;
        }

        case 'artifact_created': {
          const artifactEvent = event as any;
          const artifactId = artifactEvent.artifactId;
          if (artifactId && pendingToolsRef.current.has(artifactId)) {
            store.finalizeToolStep(artifactId, `Created: ${artifactEvent.filepath}`, false);
            pendingToolsRef.current.delete(artifactId);
            // Trigger file refresh
            setTimeout(() => ofc?.(), 500);
          }
          break;
        }

        case 'artifact_presented': {
          const artifactEvent = event as any;
          const presentId = artifactEvent.presentationId || `present-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: presentId,
            name: 'present_artifact',
            displayName: 'Presented file',
            status: 'success',
            startTime: Date.now(),
            endTime: Date.now(),
            duration: 0,
            filePath: artifactEvent.filepath,
            inputPreview: artifactEvent.artifactName || artifactEvent.filepath,
          };
          store.addToolStep(step);
          store.finalizeToolStep(presentId, artifactEvent.message || '', false);
          break;
        }

        case 'command_start': {
          const cmdEvent = event as any;
          const cmdId = cmdEvent.commandId || `cmd-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: cmdId,
            name: 'execute_command',
            displayName: 'Bash',
            status: 'executing',
            startTime: Date.now(),
            command: cmdEvent.command,
            inputPreview: cmdEvent.description || cmdEvent.command?.substring(0, 50) || '',
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(cmdId, step as ToolStep);
          store.setActivityState('tool_executing');
          break;
        }

        case 'command_complete': {
          const cmdEvent = event as any;
          const cmdId = cmdEvent.commandId;
          if (cmdId && pendingToolsRef.current.has(cmdId)) {
            const isError = cmdEvent.exitCode !== 0;
            const output = cmdEvent.stdout || cmdEvent.stderr || '';
            store.finalizeToolStep(cmdId, output, isError);
            pendingToolsRef.current.delete(cmdId);
            // Trigger file refresh for commands that might modify files
            setTimeout(() => ofc?.(), 500);
          }
          break;
        }

        case 'task_start': {
          const taskEvent = event as any;
          const taskId = taskEvent.taskId || `task-${Date.now()}`;
          const step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'> = {
            id: taskId,
            name: 'run_agentic_task',
            displayName: taskEvent.taskName || 'Running Task',
            status: 'executing',
            startTime: Date.now(),
            inputPreview: taskEvent.taskDescription || `${taskEvent.stepsTotal || '?'} steps`,
          };
          store.addToolStep(step);
          pendingToolsRef.current.set(taskId, step as ToolStep);
          store.setActivityState('tool_executing');
          break;
        }

        case 'task_progress': {
          const taskEvent = event as any;
          // Update the task step with progress info
          const taskId = taskEvent.taskId;
          if (taskId && pendingToolsRef.current.has(taskId)) {
            // Progress is shown via streaming text for now
            store.updateStreamingText(`Step ${taskEvent.currentStep}/${taskEvent.stepsTotal}: ${taskEvent.stepName || ''}`);
          }
          break;
        }

        case 'task_complete': {
          const taskEvent = event as any;
          const taskId = taskEvent.taskId;
          if (taskId && pendingToolsRef.current.has(taskId)) {
            const isError = !taskEvent.success;
            const output = `Completed ${taskEvent.stepsCompleted}/${taskEvent.stepsTotal} steps`;
            store.finalizeToolStep(taskId, output, isError);
            pendingToolsRef.current.delete(taskId);
            // Trigger file refresh
            setTimeout(() => ofc?.(), 500);
          }
          break;
        }

        // ===========================================
        // End Agentic Workflow Events
        // ===========================================

        case 'message_end':
        case 'response_complete':
          store.finalizeAssistantMessage();
          store.setActivityState('idle');
          pendingToolsRef.current.clear();
          break;

        case 'error': {
          const errorEvent = event as any;
          store.setActivityState('error', errorEvent.message || 'An error occurred');
          store.finalizeAssistantMessage();
          break;
        }

        case 'message': {
          const msgEvent = event as any;
          if (msgEvent.role === 'assistant') {
            store.updateStreamingText(msgEvent.content || '');
            store.finalizeAssistantMessage();
          }
          break;
        }
      }
    },
    [] // Empty deps - options accessed via ref, store accessed via getState()
  );

  // Connect to WebSocket - uses refs to avoid recreating callback
  const connectWebSocket = useCallback(() => {
    if (!enabled) return;
    // Prevent duplicate connections using both ref and WebSocket state checks
    if (isConnectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    isConnectingRef.current = true;
    const store = useCodeModeStore.getState();
    store.setConnectionState('connecting');

    // Get userId and authToken from ref to avoid callback recreation
    const { userId: uid, authToken: token } = optionsRef.current;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_AGENTICODE_WS_URL || `${wsProtocol}//${window.location.host}`;
    const sessionId = store.activeSessionId;

    // Build WebSocket URL with auth token for API mode
    // When token is provided, the backend uses platform LLM providers instead of Ollama
    const wsUrl = `${wsHost}/api/code/ws/events?userId=${uid}${
      sessionId ? `&sessionId=${sessionId}` : ''
    }${token ? `&token=${encodeURIComponent(token)}` : ''}`;

    console.log('[CodeModeWS] Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=***'));
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[CodeModeWS] Connected');
      isConnectingRef.current = false;
      const s = useCodeModeStore.getState();
      s.setConnectionState('connected');
      s.resetReconnectAttempts();
    };

    ws.onmessage = (event) => {
      try {
        const data: AgenticodeStreamEvent = JSON.parse(event.data);
        handleWebSocketEvent(data);
      } catch (err) {
        console.error('[CodeModeWS] Failed to parse message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('[CodeModeWS] Error:', error);
      isConnectingRef.current = false;
      useCodeModeStore.getState().setConnectionState('error', 'WebSocket connection error');
    };

    ws.onclose = () => {
      console.log('[CodeModeWS] Closed');
      isConnectingRef.current = false;
      const s = useCodeModeStore.getState();
      s.setConnectionState('disconnected');
      wsRef.current = null;

      // Attempt to reconnect with exponential backoff
      // Check enabled via closure (captured at callback creation time)
      if (enabled && reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        s.incrementReconnectAttempts();
        s.setConnectionState('reconnecting');
        console.log(
          `[CodeModeWS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`
        );
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      }
    };

    wsRef.current = ws;
  }, [enabled, handleWebSocketEvent]); // Only enabled needed - userId from ref, handleWebSocketEvent is stable

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    useCodeModeStore.getState().setConnectionState('disconnected');
  }, []);

  // Reconnect manually
  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttempts.current = 0;
    useCodeModeStore.getState().resetReconnectAttempts();
    connectWebSocket();
  }, [disconnect, connectWebSocket]);

  // Send message with optional file attachments
  const sendMessage = useCallback(
    async (message: string, files?: FileAttachment[]) => {
      const store = useCodeModeStore.getState();

      // Get the user-selected model (if any) from the model store
      const selectedModel = useModelStore.getState().selectedModel;

      // Create message content with file info for display
      const displayMessage = files && files.length > 0
        ? `${message}\n\n[Attached ${files.length} file${files.length > 1 ? 's' : ''}: ${files.map(f => f.name).join(', ')}]`
        : message;

      store.addUserMessage(displayMessage);
      store.startAssistantMessage();

      const sessionId = store.activeSessionId;

      // Build message payload with files and model override
      const messagePayload = {
        type: 'user_message',
        content: message,
        sessionId,
        // Include model override if user has selected one (empty string means use default/smart router)
        ...(selectedModel ? { model: selectedModel } : {}),
        // Include files if present (base64 encoded)
        ...(files && files.length > 0 ? { attachments: files } : {}),
      };

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(messagePayload));
      } else {
        // Fallback to REST API - get userId from ref
        const { userId: uid } = optionsRef.current;
        try {
          const response = await fetch('/api/agenticode/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message,
              sessionId,
              userId: uid,
              ...(selectedModel ? { model: selectedModel } : {}),
              ...(files && files.length > 0 ? { attachments: files } : {}),
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to send message');
          }
        } catch (err) {
          console.error('[CodeModeWS] Failed to send message:', err);
          const s = useCodeModeStore.getState();
          s.setActivityState('error', 'Failed to send message. Please try again.');
          s.finalizeAssistantMessage();
        }
      }
    },
    [] // Empty deps - userId accessed via ref
  );

  // Stop execution
  const stopExecution = useCallback(() => {
    const sessionId = useCodeModeStore.getState().activeSessionId;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'stop_execution',
          sessionId,
        })
      );
    }
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (enabled) {
      connectWebSocket();
    }

    return () => {
      // Don't disconnect when component unmounts - keep session alive
      // disconnect();
    };
  }, [enabled, connectWebSocket]);

  return {
    sendMessage,
    stopExecution,
    disconnect,
    reconnect,
  };
}

export default useCodeModeWebSocket;
