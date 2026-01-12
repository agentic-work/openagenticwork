/**
 * CodeModeLayout - Agenticode Web IDE
 *
 * Full React-based code mode interface featuring:
 * - 3-panel layout: Files | Conversation | Editor/Preview
 * - Inline tool blocks with git-style diffs
 * - Animated todos with strikethrough
 * - Fun status indicators ("Pontificating...", "Booping...")
 * - Embedded code-server (VS Code) per user
 * - Real-time file sync between AI and user edits
 *
 * Session persists when switching to chat mode and back.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Maximize2,
  Minimize2,
  X,
  Send,
  ChevronDown,
  Cpu,
  Paperclip,
  Image as ImageIcon,
} from '@/shared/icons';

// File attachments for drag & drop / paste
import { useFileAttachments, type FileWithPreview } from '@/features/chat/hooks/useFileAttachments';
import FileAttachmentThumbnails, { type AttachmentFile } from '@/features/chat/components/FileAttachmentThumbnails';
import type { FileAttachment } from '../hooks/useCodeModeWebSocket';


// Store - Use individual selectors to prevent re-render loops
import {
  useCodeModeStore,
  useConnectionState,
  useActivityState,
  useMessages,
  useStreamingMessage,
  useActiveSessionId,
  useSession,
  useCodeModeTodos,
  type ConversationMessage as ConversationMessageType,
} from '@/stores/useCodeModeStore';

// Components
import { InlineToolBlock } from './InlineToolBlock';
import { ActiveTaskBar } from './ActiveTaskBar';
import {
  StreamingActivityIndicator,
  InlineStreamingCursor,
} from './StreamingActivityIndicator';
import { EditorPanel } from './EditorPanel';

// Shared components from chat
import EnhancedMessageContent from '@/features/chat/components/MessageContent/EnhancedMessageContent';
import { InlineThinkingDisplay } from '@/features/chat/components/InlineThinkingDisplay';

// =============================================================================
// Types
// =============================================================================

interface CodeModeLayoutV2Props {
  /** When true, renders inline (fills parent) vs fixed fullscreen */
  inline?: boolean;
  /** Called when user clicks exit */
  onExit?: () => void;
  /** Called when fullscreen toggles */
  onToggleFullscreen?: () => void;
  /** Theme override */
  theme?: 'light' | 'dark';
  /** User ID for session */
  userId?: string;
  /** Workspace path */
  workspacePath?: string;
  /** Callback to send message via WebSocket (provided by parent) */
  onSendMessage?: (message: string, files?: FileAttachment[]) => Promise<void>;
}

// =============================================================================
// Header Component
// =============================================================================

/**
 * Minimal header - just title, working dir, and controls
 * Status indicators moved inline in conversation
 */
const CodeModeHeader: React.FC<{
  onToggleFullscreen?: () => void;
  onExit?: () => void;
  isFullscreen?: boolean;
  sessionTitle?: string;
  workingDir?: string;
}> = ({
  onToggleFullscreen,
  onExit,
  isFullscreen,
  sessionTitle,
  workingDir,
}) => {
  const session = useSession();

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]/30 bg-transparent">
      {/* Left - Title with dropdown */}
      <div className="flex items-center gap-3">
        <span className="font-semibold text-[var(--color-text)] text-sm">
          {sessionTitle || session?.sessionId?.slice(0, 8) || 'New session'}
        </span>
        <ChevronDown size={14} className="text-[var(--color-textMuted)]" />
      </div>

      {/* Right - Working dir and controls */}
      <div className="flex items-center gap-2">
        {/* Working directory */}
        {(workingDir || session?.workspacePath) && (
          <span className="text-xs text-[var(--color-textMuted)] font-mono">
            {workingDir || session?.workspacePath}
          </span>
        )}

        {/* Fullscreen */}
        <button
          onClick={onToggleFullscreen}
          className="p-1.5 rounded text-[var(--color-textMuted)] hover:bg-[var(--color-surfaceHover)] transition-colors"
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        {onExit && (
          <button
            onClick={onExit}
            className="p-1.5 rounded text-[var(--color-textMuted)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--cm-error)] transition-colors"
            title="Exit Code Mode"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Message Component
// =============================================================================

const MessageComponent: React.FC<{
  message: ConversationMessageType;
  theme?: 'light' | 'dark';
}> = ({ message, theme = 'dark' }) => {
  const isUser = message.role === 'user';

  // Check if we have ordered content blocks (new interleaved format)
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`mb-6 ${isUser ? 'flex justify-end' : ''}`}
    >
      {isUser ? (
        // User message - right aligned bubble
        <div className="user-bubble max-w-[80%] px-4 py-3 text-[15px]">
          {message.textContent}
        </div>
      ) : (
        // Assistant message - left aligned, no background
        <div className="space-y-3">
          {/* Thinking block - always at top */}
          {message.thinkingContent && (
            <InlineThinkingDisplay
              isThinking={message.isStreaming && message.streamingState === 'thinking'}
              thinkingContent={message.thinkingContent}
              isCompleted={!message.isStreaming}
              theme={theme}
            />
          )}

          {/* Ordered content blocks (new interleaved display) */}
          {hasContentBlocks ? (
            <>
              {message.contentBlocks!.map((block) => {
                switch (block.type) {
                  case 'text':
                    return (
                      <div key={block.id} className="prose-terminal">
                        <EnhancedMessageContent
                          content={block.content}
                          theme={theme}
                          isStreaming={block.isStreaming}
                        />
                        {block.isStreaming && (
                          <InlineStreamingCursor isVisible={true} />
                        )}
                      </div>
                    );
                  case 'tool':
                    return (
                      <InlineToolBlock
                        key={block.id}
                        step={block.step}
                        theme={theme}
                      />
                    );
                  case 'todo':
                    // TODOs are shown in the sticky panel at bottom, not inline
                    return null;
                  default:
                    return null;
                }
              })}
            </>
          ) : (
            // Fallback to legacy rendering (for old messages without contentBlocks)
            <>
              {/* TODOs are shown in sticky panel at bottom, not inline */}

              {/* Tool steps */}
              {message.steps?.map((step) => (
                <InlineToolBlock key={step.id} step={step} theme={theme} />
              ))}

              {/* Text content */}
              {message.textContent && (
                <div className="prose-terminal">
                  <EnhancedMessageContent
                    content={message.textContent}
                    theme={theme}
                    isStreaming={message.isStreaming && message.streamingState === 'streaming'}
                  />
                  {message.isStreaming && message.streamingState === 'streaming' && (
                    <InlineStreamingCursor isVisible={true} />
                  )}
                </div>
              )}
            </>
          )}

          {/* Streaming activity indicator (when no content yet) */}
          {message.isStreaming && !hasContentBlocks && !message.textContent && message.streamingState !== 'streaming' && (
            <StreamingActivityIndicator
              state={message.streamingState || 'thinking'}
              showCursor={false}
            />
          )}
        </div>
      )}
    </motion.div>
  );
};

// =============================================================================
// Input Component
// =============================================================================

/**
 * AgentiCode style input - clean and minimal
 * Features:
 * - Up/down arrow command history
 * - Drag & drop file uploads
 * - Clipboard paste for images
 */
const CodeModeInput: React.FC<{
  onSubmit: (text: string, files?: FileWithPreview[]) => void;
  disabled?: boolean;
  onOpenVSCode?: () => void;
  vsCodeExpanded?: boolean;
}> = ({ onSubmit, disabled, onOpenVSCode, vsCodeExpanded }) => {
  const [input, setInput] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activityState = useActivityState();
  const todos = useCodeModeTodos();
  const session = useSession();

  // Get a friendly model name from model ID
  const getModelDisplayName = (modelId: string): string => {
    const name = modelId.split('/').pop() || modelId;
    return name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };
  const sessionModel = session?.model;
  const modelDisplayName = sessionModel ? `Router → ${getModelDisplayName(sessionModel)}` : 'Smart Router';

  // Command history state
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState(''); // Save current input when navigating history

  // File attachments hook
  const {
    selectedFiles,
    addFiles,
    removeFile,
    clearFiles,
    handleDrop: onDrop,
    fileInputRef,
    handleFileInputChange,
    openFilePicker,
  } = useFileAttachments({
    onError: (error) => console.warn('[CodeModeInput] File error:', error),
  });

  const isProcessing = activityState !== 'idle' && activityState !== 'complete';

  // Convert selectedFiles to AttachmentFile format for thumbnails
  const attachments: AttachmentFile[] = selectedFiles.map((file, idx) => ({
    id: `file-${idx}-${file.name}`,
    file,
    type: file.type.startsWith('image/') ? 'image' : 'other',
    preview: file.previewUrl,
  }));

  const handleSubmit = useCallback(() => {
    if ((input.trim() || selectedFiles.length > 0) && !disabled && !isProcessing) {
      // Add to command history
      if (input.trim()) {
        setCommandHistory(prev => {
          // Don't add duplicates of the most recent command
          if (prev[0] === input.trim()) return prev;
          return [input.trim(), ...prev].slice(0, 50); // Keep last 50 commands
        });
      }
      onSubmit(input.trim(), selectedFiles.length > 0 ? selectedFiles : undefined);
      setInput('');
      setHistoryIndex(-1);
      setSavedInput('');
      clearFiles();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [input, selectedFiles, disabled, isProcessing, onSubmit, clearFiles]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Submit on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      // Command history navigation with up/down arrows
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Only navigate history if cursor is at start/end of input or input is empty
        const textarea = textareaRef.current;
        if (!textarea) return;

        const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
        const atEnd = textarea.selectionStart === input.length && textarea.selectionEnd === input.length;
        const isEmpty = input === '';

        if (e.key === 'ArrowUp' && (atStart || isEmpty) && commandHistory.length > 0) {
          e.preventDefault();
          if (historyIndex === -1) {
            // Save current input before navigating
            setSavedInput(input);
          }
          const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
          setHistoryIndex(newIndex);
          setInput(commandHistory[newIndex]);
        } else if (e.key === 'ArrowDown' && (atEnd || isEmpty) && historyIndex >= 0) {
          e.preventDefault();
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          if (newIndex === -1) {
            // Restore saved input
            setInput(savedInput);
          } else {
            setInput(commandHistory[newIndex]);
          }
        }
      }
    },
    [handleSubmit, input, commandHistory, historyIndex, savedInput]
  );

  // Handle paste event for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Create a named file from clipboard
          const namedFile = new File([file], `pasted-image-${Date.now()}.png`, {
            type: file.type,
          });
          imageFiles.push(namedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  }, [addFiles]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    onDrop(e);
  }, [onDrop]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="sticky bottom-0 px-4 pb-6 pt-4">
      <div className="max-w-[1000px] mx-auto">
        {/* Active Task Bar - Claude Code style, above input */}
        {todos.length > 0 && (
          <div className="mb-3 rounded-lg overflow-hidden border border-[var(--color-border)]/30">
            <ActiveTaskBar todos={todos} />
          </div>
        )}

        {/* File attachments thumbnails - above input */}
        {attachments.length > 0 && (
          <div className="mb-3">
            <FileAttachmentThumbnails
              attachments={attachments}
              onRemove={(id) => {
                const idx = attachments.findIndex(a => a.id === id);
                if (idx >= 0) removeFile(idx);
              }}
            />
          </div>
        )}

        {/* Unified Input Container - Matches ChatInputBar glass-surface style */}
        <div
          className={`glass-surface relative transition-all duration-200 ${
            isDragOver ? 'ring-2 ring-[var(--color-primary)]/30' : ''
          }`}
          style={{
            border: isDragOver ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
            borderRadius: '24px',
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 bg-[var(--color-primary)]/10 rounded-[24px] flex items-center justify-center z-10 pointer-events-none">
              <div className="flex items-center gap-2 text-[var(--color-primary)] font-medium">
                <ImageIcon size={20} />
                <span>Drop files here</span>
              </div>
            </div>
          )}

          {/* Textarea area - Auto-expanding input */}
          <div className="flex items-center gap-2 px-4 py-3">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Reset history index when typing
                  if (historyIndex >= 0) {
                    setHistoryIndex(-1);
                  }
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={isProcessing ? 'Working...' : 'What would you like to do?'}
                disabled={disabled || isProcessing}
                rows={1}
                className={`
                  w-full resize-none bg-transparent
                  text-[var(--color-text)] placeholder-[var(--color-textMuted)]
                  focus:outline-none border-0
                  text-[16px] leading-relaxed
                  overflow-y-auto
                  ${disabled || isProcessing ? 'opacity-60 cursor-not-allowed' : ''}
                `}
                style={{
                  minHeight: '20px',
                  maxHeight: '200px',
                  background: 'transparent',
                  boxShadow: 'none',
                }}
              />
            </div>

            {/* Send button - Integrated in main input */}
            <button
              onClick={handleSubmit}
              disabled={(!input.trim() && selectedFiles.length === 0) || disabled || isProcessing}
              className={`
                p-2 rounded-lg transition-all duration-150 flex-shrink-0
                ${(input.trim() || selectedFiles.length > 0) && !disabled && !isProcessing
                  ? 'bg-gray-600 hover:bg-gray-500 text-white'
                  : 'text-[var(--color-textMuted)]'
                }
                ${disabled || isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {isProcessing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>

          {/* Subtle Divider Line - Gemini style */}
          <div
            className="mx-4 h-px"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              opacity: 0.3
            }}
          />

          {/* Integrated Toolbar - Inside the same container */}
          <div className="flex items-center justify-end gap-2 px-4 py-2">
            <div className="flex items-center gap-1">
              {/* VS Code button - pill-shaped with VS Code icon */}
              {onOpenVSCode && (
                <button
                  onClick={onOpenVSCode}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                    transition-all duration-150 border vscode-pill vscode-glow-animate
                    ${vsCodeExpanded ? 'active' : ''}
                  `}
                >
                  {/* VS Code icon - simplified recognizable version */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/>
                  </svg>
                  <span>{vsCodeExpanded ? 'Close' : 'VS Code'}</span>
                </button>
              )}

              {/* Attach file button */}
              <button
                onClick={openFilePicker}
                disabled={disabled || isProcessing}
                className="p-1.5 rounded-md text-[var(--color-textMuted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceSecondary)] transition-colors"
                title="Attach files (or drag & drop)"
              >
                <Paperclip size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.json,.js,.ts,.py"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Keyboard hints */}
        <div className="mt-2 text-center text-xs text-[var(--color-textMuted)]">
          Enter to send • Shift+Enter for new line • ↑↓ for history • Paste/drop images
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Empty State Component
// =============================================================================

const EmptyState: React.FC = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="flex flex-col items-center justify-center py-16"
  >
    <h2 className="text-xl font-medium text-[var(--color-text)] mb-2">
      What would you like to build?
    </h2>
    <p className="text-[var(--color-textSecondary)] text-sm max-w-md text-center">
      Describe your task and I'll help you code it.
    </p>
  </motion.div>
);

// =============================================================================
// Main Layout Component
// =============================================================================

export const CodeModeLayoutV2: React.FC<CodeModeLayoutV2Props> = ({
  inline = false,
  onExit,
  onToggleFullscreen,
  theme = 'dark',
  userId,
  workspacePath = '~',
  onSendMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [editorWidth, setEditorWidth] = useState(600); // Initial width in pixels
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Use individual selectors to prevent re-render loops
  const messages = useMessages();
  const streamingMessage = useStreamingMessage();
  const connectionState = useConnectionState();
  const session = useSession();
  const activeSessionId = useActiveSessionId();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  // Handle fullscreen toggle
  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
    onToggleFullscreen?.();
  }, [onToggleFullscreen]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Resize handlers for editor panel
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: editorWidth };
  }, [editorWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      // Calculate new width (dragging left increases editor width)
      const delta = resizeRef.current.startX - e.clientX;
      const newWidth = Math.max(300, Math.min(1200, resizeRef.current.startWidth + delta));
      setEditorWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Convert files to base64 for transmission
  const convertFilesToAttachments = useCallback(async (files: FileWithPreview[]): Promise<FileAttachment[]> => {
    return Promise.all(
      files.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        return {
          name: file.name,
          type: file.type,
          content: base64.split(',')[1], // Remove data:image/jpeg;base64, prefix
        };
      })
    );
  }, []);

  // Handle message submission with optional files
  const handleSubmit = useCallback(
    async (text: string, files?: FileWithPreview[]) => {
      if (onSendMessage) {
        // Convert files to base64 if present
        const attachments = files && files.length > 0
          ? await convertFilesToAttachments(files)
          : undefined;
        // Use the WebSocket hook's sendMessage (handles store updates + WS send)
        await onSendMessage(text, attachments);
      } else {
        // Fallback: just add to store (for when not connected)
        useCodeModeStore.getState().addUserMessage(text);
      }
    },
    [onSendMessage, convertFilesToAttachments]
  );

  // All messages including streaming
  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;

  return (
    <div
      ref={containerRef}
      className={`
        ${inline ? 'relative w-full h-full' : 'fixed inset-0 z-[1100]'}
        flex
      `}
      data-theme={theme}
      style={{
        // Transparent to let liquid glass background show through
        // Subtle grid pattern overlaid on the glass effect
        backgroundColor: 'transparent',
        backgroundImage: `
          radial-gradient(circle at 1px 1px, rgba(99, 102, 241, 0.08) 1px, transparent 1px),
          linear-gradient(rgba(128, 128, 128, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(128, 128, 128, 0.04) 1px, transparent 1px)
        `,
        backgroundSize: '24px 24px, 48px 48px, 48px 48px',
        backgroundPosition: '0 0, 0 0, 0 0',
      }}
    >
      {/* Main content area (conversation) - full width, no sidebar */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Minimal header */}
        <CodeModeHeader
          onToggleFullscreen={handleToggleFullscreen}
          onExit={onExit}
          isFullscreen={isFullscreen}
          workingDir={workspacePath}
        />

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className={`mx-auto px-6 py-6 ${editorExpanded ? 'max-w-full' : 'max-w-[1000px]'}`}>
            {/* Activity indicator - inline */}
            {connectionState === 'connecting' && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-primary)] mb-4">
                <Loader2 size={14} className="animate-spin" />
                <span>Connecting...</span>
              </div>
            )}

            {/* Empty state or messages */}
            {allMessages.length === 0 ? (
              <EmptyState />
            ) : (
              <AnimatePresence mode="popLayout">
                {allMessages.map((message) => (
                  <MessageComponent
                    key={message.id}
                    message={message}
                    theme={theme}
                  />
                ))}
              </AnimatePresence>
            )}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input with VS Code button */}
        <CodeModeInput
          onSubmit={handleSubmit}
          disabled={connectionState !== 'connected'}
          onOpenVSCode={() => setEditorExpanded(!editorExpanded)}
          vsCodeExpanded={editorExpanded}
        />
      </div>

      {/* Right - Editor Panel (VS Code) with Resizable Divider */}
      <AnimatePresence>
        {editorExpanded && (
          <>
            {/* Resize Handle */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`
                w-1 flex-shrink-0 cursor-col-resize
                hover:bg-[var(--color-primary)]/30 active:bg-[var(--color-primary)]/50
                transition-colors group relative
                ${isResizing ? 'bg-[var(--color-primary)]/50' : 'bg-transparent'}
              `}
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            >
              {/* Visual indicator on hover */}
              <div className={`
                absolute inset-y-0 -left-1 -right-1
                group-hover:bg-[var(--color-primary)]/10
                ${isResizing ? 'bg-[var(--color-primary)]/10' : ''}
              `} />
              {/* Grip dots */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-1 h-1 rounded-full bg-[var(--color-textMuted)]" />
                <div className="w-1 h-1 rounded-full bg-[var(--color-textMuted)]" />
                <div className="w-1 h-1 rounded-full bg-[var(--color-textMuted)]" />
              </div>
            </motion.div>

            {/* Editor Panel */}
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: editorWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: isResizing ? 0 : 0.2, ease: 'easeInOut' }}
              style={{ width: editorWidth }}
              className="code-mode flex-shrink-0 h-full"
            >
              <EditorPanel
                sessionId={activeSessionId}
                workspacePath={workspacePath}
                selectedFile={selectedFile}
                onFileSelect={(path) => setSelectedFile(path)}
                isCollapsed={false}
                onToggleCollapse={() => setEditorExpanded(false)}
                onOpenExternal={() => {}}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
};

export default CodeModeLayoutV2;
