/**
 * Chat Container Component
 * Main chat interface that orchestrates all chat functionality
 * Features: Session management, message streaming, MCP tool integration, file uploads
 * Handles: SSE streaming, WebSocket fallback, token usage tracking, AI model routing
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Plus, Bot, User, CheckCircle, XCircle, Wrench, DollarSign, Activity,
  X, LineChart, HelpCircle, Settings as SettingsIcon, ChevronRight, Square,
  Trash2, Shield, Zap, Brain, ChevronDown, Check, Paperclip
} from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';
// ReactMarkdown and remarkGfm removed - not used in this component
import { nanoid } from 'nanoid';
// Recharts imports removed - charts handled by sub-components
import MessageContent from './MessageContent';
import { useSSEChat } from '../hooks/useSSEChat';
import { isValidChatMessage, validateChartData, ensureArray, safeArrayAccess } from '@/utils/validation';
import { useAuth } from '@/app/providers/AuthContext';
// Removed conflicting useTheme - using settings from API as source of truth
import { apiEndpoint } from '@/utils/api';
import { getDocsBaseUrl } from '@/config/constants';
// Token operations handled by AuthContext - pure frontend architecture
import ToolCallDisplay from './ToolCallDisplay';
import GlassmorphismContainer from '@/components/ui/GlassmorphismContainer';
import { InlineToolCallDisplay } from './InlineToolCallDisplay';
// Model selector removed - backend handles model selection
// TokenUsagePanel removed - analytics feature deleted
import { SettingsModal } from '@/features/settings/components/SettingsModal';
import SettingsDropdown from './SettingsDropdown';
import { useSettings } from '@/features/settings/hooks/useSettings';
// import { useTextToSpeech } from '../hooks/useTextToSpeech'; // DISABLED
import AADLogin from '@/features/auth/components/AADLogin';
import CanvasPanel from '@/shared/components/CanvasPanel';
import { DocsViewer } from '@/features/docs/DocsViewer';
import { getDocsUrl } from '@/utils/api';
// MovableTokenGraph removed - analytics feature deleted
import { useKeyboardShortcuts, KeyboardShortcutsHelp } from '@/shared/hooks/useKeyboardShortcuts';
import { useHotkeys } from 'react-hotkeys-hook';
import { useChatStore } from '@/stores/useChatStore';
import { useUIVisibilityStore } from '@/stores/useUIVisibilityStore';
import { useChatStreamingStore } from '@/stores/useChatStreamingStore';
import { useModelStore } from '@/stores/useModelStore';
import { useChatSessions } from '../hooks/useChatSessions';
import { useMCPTools } from '../hooks/useMCPTools';
import { useUserPermissions } from '@/hooks/useUserPermissions';

// Import sub-components
import ChatSidebar from './ChatSidebar';
import ChatMessages from './ChatMessages';
import ChatInputBar from './ChatInputBar';
import SSEErrorBoundary from '@/shared/components/SSEErrorBoundary';
import MetricsPanel from './MetricsPanel';
// StaticSidebar removed - using ChatSidebar only
import ImageAnalysis from './ImageAnalysis';
// Lazy load AdminPortal for better initial load performance - only loaded when admin opens portal
const AdminPortal = lazy(() => import('@/features/admin/components/AdminPortal'));
// ScrollToBottomButton removed - auto-scroll handles this now
import BackgroundJobsPanel from './BackgroundJobsPanel';
// ExportButton removed - not working
import { CodeModeLayoutV2 } from '@/features/code/components';

// App mode type for chat/code toggle
type AppMode = 'chat' | 'code';
import { useCodeModeWebSocket } from '@/features/code/hooks/useCodeModeWebSocket';
import { useActiveSessionId as useCodeModeSessionId, useCodeModeStore } from '@/stores/useCodeModeStore';
import { useWorkspaceFiles } from '@/features/code/hooks/useWorkspaceFiles';

// Personality type for AI response styling
interface Personality {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

// Personalities are now fetched from the pipeline config API (admin portal is SOT)
// Built-in personalities with full system prompts are defined in the backend:
// services/agenticwork-api/src/routes/chat/pipeline/pipeline-config.schema.ts
// Legacy activity components - replaced by UnifiedAgentActivity
// import { LiveActivityFeed, useActivityFeed, type ActivityItem } from './LiveActivityFeed';
// import { ActivityOrb, useOrbState } from './ActivityOrb';

// Agent state hook - activity is now displayed inline in message bubbles
import { useSSEToAgentState } from './UnifiedAgentActivity';

// Import types
import type { 
  ChatMessage, TokenUsage, PrometheusData, VisualizationData, 
  ChatSession, TokenStats 
} from '@/types/index';

// Additional type interfaces to replace 'any' types
interface MCPFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface MCPToolsResponse {
  tools: {
    functions: MCPFunction[];
  };
}

interface SessionApiResponse {
  sessions: Array<{
    id: string;
    userId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount?: number;
    messages?: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: string;
    }>;
  }>;
  lastActiveSessionId?: string;
}

interface UsageDataPoint {
  date: string;
  tokens: number;
  cost: number;
}

interface ImageAnalysisResult {
  text?: string;
  description?: string;
  objects?: Array<{
    name: string;
    confidence: number;
  }>;
  tags?: string[];
}

interface FileWithPreview extends File {
  previewUrl?: string;
}

interface ChatProps {
  theme: 'light' | 'dark';
  onThemeChange?: (theme: 'light' | 'dark') => void;
  onFunctionsReady?: (functions: {
    createNewSession: () => void;
    toggleMetrics: () => void;
    openMonitor: () => void;
    toggleSidebar: () => void;
  }) => void;
  showMetricsPanel?: boolean;
}

const Chat: React.FC<ChatProps> = ({ onFunctionsReady, onThemeChange, showMetricsPanel: propShowMetricsPanel }) => {
  // Navigation hook
  const navigate = useNavigate();

  // Auth state
  const { isAuthenticated: authIsAuthenticated, user, getAccessToken, getAuthHeaders, logout } = useAuth();
  
  // Settings state - theme comes from API settings
  const { settings, saveSettings, updateTheme } = useSettings();
  // TTS completely removed - no longer supported
  const isSpeaking = false;
  const stopSpeaking = () => {};
  
  // Use actual authentication state
  const isAuthenticated = authIsAuthenticated;

  // Chat store
  const {
    sessions,
    activeSessionId,
    addMessage,
    updateMessage,
    updateStreamingMessage,
    finishStreamingMessage
  } = useChatStore();
  
  // Session management hook
  const {
    setActiveSession,
    createNewSession,
    loadSessions,
    deleteSession,
    loadSessionMessages,
    updateSessionTitle
  } = useChatSessions();
  
  // MCP Tools hook
  const {
    availableMCPFunctions,
    enabledTools,
    activeMcpCalls,
    currentToolRound, // Track agentic loop round for visual indicator
    loadMCPFunctions,
    handleToggleTool,
    handleToolExecution,
    executeCode: handleExecuteCode,
    setActiveMcpCalls
  } = useMCPTools();

  // User permissions hook - for feature access control
  const { permissions: userPermissions } = useUserPermissions();

  // UI Visibility store - centralized panel visibility state
  const {
    showChatSessions,
    showMetricsPanel,
    showSettings,
    showKeyboardHelp,
    showDocsViewer,
    showAdminPortal,
    showBackgroundJobs,
    showTokenUsage,
    showTokenGraph,
    showPersonalTokenUsage,
    showPromptTechniques,
    showMCPTools,
    showImageAnalysis,
    canvasOpen,
    showMCPIndicators,
    showThinkingInline,
    showModelBadges,
    isSidebarExpanded,
    showDeleteConfirm,
    toggle: toggleUI,
    set: setUI,
    open: openUI,
    close: closeUI,
    closeAll: closeAllUI,
    setDeleteConfirm,
  } = useUIVisibilityStore();

  // Chat streaming store - streaming and thinking state
  const {
    streamingContent,
    streamingStatus,
    realtimeCoTSteps,
    currentCoTData,
    thinkingTime,
    thinkingStartTime,
    appendContent: appendStreamingContent,
    setContent: setStreamingContent,
    startStreaming,
    finishStreaming,
    setStatus: setStreamingStatus,
    addCoTStep,
    setCoTData: setCurrentCoTData,
    clearCoTSteps,
    startThinking,
    stopThinking,
    reset: resetStreaming,
  } = useChatStreamingStore();

  // Unified Agent Activity state - single source of truth for all agentic activity
  const {
    state: agentState,
    handlers: agentHandlers,
    isActive: agentIsActive,
    reset: resetAgentState
  } = useSSEToAgentState();

  // Model store - model selection, available models, multi-model mode
  const {
    selectedModel,
    availableModels,
    isMultiModelEnabled,
    setSelectedModel,
    setAvailableModels,
    setMultiModelEnabled,
    initializeModel,
  } = useModelStore();

  // Get current session messages from store - memoized for performance
  const currentSession = useMemo(() => 
    activeSessionId ? sessions[activeSessionId] : null,
    [activeSessionId, sessions]
  );
  const messages = useMemo(() => 
    currentSession?.messages || [],
    [currentSession?.messages]
  );

  // Chat state - only truly local state remains
  const [inputMessage, setInputMessage] = useState('');
  
  // Tool state - minimal remaining state
  const [pendingToolCalls, setPendingToolCalls] = useState<any[]>([]);
  const [executedToolCalls, setExecutedToolCalls] = useState<any[]>([]);
  const [mcpCalls, setMcpCalls] = useState<any[]>([]);
  
  // Track previous session for scroll behavior
  const [previousActiveSessionId, setPreviousActiveSessionId] = useState<string | null>(activeSessionId);

  // Track if we've scrolled for the current session's messages (to handle initial load)
  const hasScrolledForSession = useRef<string | null>(null);

  // UI state
  // selectedModel, availableModels, isMultiModelEnabled now provided by useModelStore
  // showChatSessions, showMetricsPanel, showDeleteConfirm, showSettings, isSidebarExpanded, streamingStatus
  // now provided by useUIVisibilityStore and useChatStreamingStore
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  // Remove redundant currentTheme state - use settings.theme directly
  const [tokenStats, setTokenStats] = useState<TokenStats>({
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    chartData: []
  });
  const [userUsageData, setUserUsageData] = useState<any>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [canvasContent, setCanvasContent] = useState<any>(null);
  // canvasOpen, currentCoTData, showKeyboardHelp, showDocsViewer, showImageAnalysis,
  // showAdminPortal, showBackgroundJobs now provided by stores
  const [currentImageForAnalysis, setCurrentImageForAnalysis] = useState<File | null>(null);

  // App Mode state - Chat vs Code mode
  const [appMode, setAppMode] = useState<AppMode>('chat');

  // Active personality ID for AI response styling
  const [activePersonalityId, setActivePersonalityId] = useState<string | null>(null);

  // Personalities fetched from pipeline config API (admin portal is SOT)
  const [personalities, setPersonalities] = useState<Personality[]>([]);

  // Fetch personalities from pipeline config API on mount
  useEffect(() => {
    const fetchPersonalities = async () => {
      try {
        const response = await fetch('/api/admin/pipeline-config', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.config?.stages?.prompt) {
            const promptConfig = data.config.stages.prompt;
            // Combine built-in and custom personalities from the API
            const builtInPersonalities = promptConfig.builtInPersonalities || [];
            const customPersonalities = promptConfig.customPersonalities || [];
            setPersonalities([...builtInPersonalities, ...customPersonalities]);
            // Sync active personality from API config
            if (promptConfig.activePersonalityId && promptConfig.enablePersonality) {
              setActivePersonalityId(promptConfig.activePersonalityId);
            }
          }
        }
      } catch (error) {
        console.warn('Failed to fetch personalities from pipeline config:', error);
      }
    };

    fetchPersonalities();
  }, []);

  // Code mode session ID for file browser integration
  // Get from the code mode store - this is set when WebSocket connects to agenticode-manager
  const codeSessionId = useCodeModeSessionId();

  // Get auth token for Code Mode API access (allows using platform LLM providers)
  const codeModeAuthToken = localStorage.getItem('auth_token') || undefined;

  // Workspace files for code mode - get refresh function to pass to WebSocket
  const { refresh: refreshCodeModeFiles } = useWorkspaceFiles(
    user?.id || '',
    codeSessionId || undefined
  );

  // Code Mode WebSocket connection (only active when in code mode)
  const { sendMessage: sendCodeModeMessage, reconnect: reconnectCodeMode } = useCodeModeWebSocket({
    userId: user?.id || 'anonymous',
    workspacePath: '~',
    authToken: codeModeAuthToken,
    enabled: appMode === 'code' && userPermissions.canUseAwcode,
    onFilesChanged: refreshCodeModeFiles, // Refresh file sidebar when AI creates/edits files
  });

  // Handle code mode session selection - load session and reconnect
  const handleCodeSessionSelect = useCallback((session: { id: string; model?: string | null; workspacePath?: string | null }) => {
    const store = useCodeModeStore.getState();
    // Set the new session in store
    store.setActiveSession(session.id, {
      sessionId: session.id,
      userId: user?.id || 'anonymous',
      workspacePath: session.workspacePath || '~',
      model: session.model || undefined,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    // Clear old messages and reconnect
    store.clearMessages();
    reconnectCodeMode();
  }, [user?.id, reconnectCodeMode]);

  // Handle new code mode session
  const handleCodeNewSession = useCallback(() => {
    const store = useCodeModeStore.getState();
    store.clearSession();
    reconnectCodeMode();
  }, [reconnectCodeMode]);

  // Comprehensive cleanup for memory leaks when component unmounts
  useEffect(() => {
    return () => {
      // Clean up all preview URLs on unmount
      selectedFiles.forEach(file => {
        if ((file as any).previewUrl) {
          URL.revokeObjectURL((file as any).previewUrl);
        }
      });
      
      // TTS removed - no longer stopping speech
      
      // Clear any pending timeouts/intervals (covered by individual useEffect cleanup)
      // AbortController cleanup is handled in individual functions
      
      // Clear streaming content via store
      resetStreaming();
      setActiveMcpCalls([]);
      
      // Note: SSE cleanup is handled by useSSEChat hook
    };
  }, []);

  // showTokenUsage, showTokenGraph, showPersonalTokenUsage, showPromptTechniques, showMCPTools
  // showMCPIndicators, showThinkingInline, showModelBadges now provided by useUIVisibilityStore
  // with automatic localStorage persistence

  const [textToSpeechEnabled, setTextToSpeechEnabled] = useState(settings.audio?.enableTextToSpeech || false);

  // Prompt techniques and MCP state - remaining local state
  const [enabledPromptTechniques, setEnabledPromptTechniques] = useState<Set<string>>(new Set());
  const [alwaysApprovedTools, setAlwaysApprovedTools] = useState<Set<string>>(new Set());
  const [pendingApproval, setPendingApproval] = useState<any>(null);

  // Check if user is admin (needed early for model logic)
  const isAdminUser = user?.is_admin || user?.groups?.includes('AgenticWorkAdmins') || user?.groups?.includes('admin') || false;

  // Model selection persistence handled by useModelStore with persist middleware
  // Initialize model on mount - clears for non-admins, validates for admins
  useEffect(() => {
    if (!isAdminUser && selectedModel) {
      // Non-admin has a model selected - clear it
      console.log('[MODEL] Non-admin user, clearing model selection to use default');
      setSelectedModel('');
    }
  }, [isAdminUser]); // Only run when admin status changes

  const [currentPrompt, setCurrentPrompt] = useState<string>(''); // Current prompt being used
  const [globalTokenUsage, setGlobalTokenUsage] = useState<{
    total: number;
    sessions: number;
    users: number;
    cost: number;
  } | null>(null);

  // Use the isAdminUser variable defined earlier for model selection logic
  const isAdmin = isAdminUser;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // thinkingStartTime, thinkingTime now provided by useChatStreamingStore
  const streamingPlaceholderIdRef = useRef<string | null>(null); // Track current streaming message ID

  // Initialize SSE chat hook with pipeline awareness
  const {
    sendMessage: sendSSEMessage,
    stopStreaming,
    isStreaming,
    currentMessage,
    currentThinking,
    thinkingMetrics,
    pipelineState,
    cotSteps, // Chain of Thought steps for COT UI display
    contentBlocks // Interleaved content blocks for thinking/text display
  } = useSSEChat({
    sessionId: activeSessionId || '',
    onMessage: (message) => {
      // Prevent duplicate messages by checking if message ID already exists
      if (!activeSessionId) return;

      // If there's a streaming placeholder, update it instead of adding new message
      if (streamingPlaceholderIdRef.current && message.role === 'assistant') {
        // console.log('[CHAT] Finalizing streaming placeholder with complete message');
        // CRITICAL FIX: Update with full message object to preserve mcpCalls, metadata, model, AND step data
        // This ensures thinkingSteps, reasoningTrace, toolCalls, toolResults persist for inline display
        // DEFENSIVE: Ensure reasoningTrace is always a string for the store
        const reasoningTraceStr = typeof message.reasoningTrace === 'string'
          ? message.reasoningTrace
          : message.reasoningTrace?.reasoning || undefined;

        updateMessage(
          activeSessionId,
          streamingPlaceholderIdRef.current,
          message.content,
          message.mcpCalls,
          message.metadata,
          message.model,
          message.thinkingSteps,    // Structured thinking steps from COT
          reasoningTraceStr,         // Full reasoning text (ensured to be string)
          message.toolCalls,         // Tool calls made during response
          message.toolResults        // Results from tool executions
        );
        finishStreamingMessage(activeSessionId, streamingPlaceholderIdRef.current);
        streamingPlaceholderIdRef.current = null; // Clear placeholder tracking
        return;
      }

      // Check if message already exists to prevent duplicates
      const existingMessage = messages.find(m => m.id === message.id);
      if (existingMessage) {
        // console.log('Duplicate message detected, skipping:', message.id);
        return;
      }

      // Add message to store which handles session metadata updates
      addMessage(activeSessionId, message);
      
      // Auto-generate title after first assistant response
      if (messages.length <= 1 && message.role === 'assistant' && currentSession?.title === 'New Chat') {
        // Generate title from first user message or content
        const titleContent = messages[0]?.content || message.content || 'New Chat';
        const title = titleContent.slice(0, 50) + (titleContent.length > 50 ? '...' : '');
        updateSessionTitle(activeSessionId, title);
      }
      // Clear streaming status after message completes
      setStreamingStatus('idle');

      // Complete unified agent activity tracking
      const metrics = message.metadata?.pipelineMetrics || message.metadata;
      agentHandlers.onStreamComplete(metrics);

      // Message count is handled by the store automatically
      
      // Stop thinking timer
      if (thinkingStartTime) {
        stopThinking();
      }
      
      // Update token stats
      if (message.tokenUsage || message.metadata?.tokenUsage) {
        const usage = message.tokenUsage || message.metadata?.tokenUsage;
        setTokenStats(prev => ({
          totalPromptTokens: prev.totalPromptTokens + (usage.promptTokens || 0),
          totalCompletionTokens: prev.totalCompletionTokens + (usage.completionTokens || 0),
          totalTokens: prev.totalTokens + (usage.totalTokens || 0),
          chartData: [...prev.chartData, {
            timestamp: new Date().toISOString(),
            promptTokens: usage.promptTokens || 0,
            completionTokens: usage.completionTokens || 0,
            tokens: usage.totalTokens || 0
          }]
        }));
      }
      
      // Don't reload sessions here - it causes messages to disappear
      // The title update is already handled locally via updateSessionTitle
      // Reloading from API would overwrite the local state with stale data
    },
    onToolExecution: (event) => {
      // Update unified agent state
      agentHandlers.onToolExecution(event);
      // Also call the MCP tools handler for backwards compatibility
      handleToolExecution(event);
    },
    onError: (error) => {
      // Update unified agent state
      agentHandlers.onError(error);
      console.error('Chat error:', error);
      setStreamingStatus('error');

      // Clear streaming content on error

      // Differentiate error messages for admin vs regular users
      const isAdmin = user?.isAdmin || user?.is_admin || false;
      let errorContent: string;

      if (isAdmin) {
        // Admin users get detailed error information
        errorContent = `**Error Details**\n\n${error.message}`;

        // Add code and stage info if available from enhanced errors
        if (error.name && error.name !== 'Error') {
          errorContent += `\n\n**Error Code:** \`${error.name}\``;
        }
      } else {
        // Non-admin users get a simple, user-friendly message
        const message = error.message?.toLowerCase() || '';
        if (message.includes('timeout') || message.includes('timed out')) {
          errorContent = 'The request took too long. Please try again.';
        } else if (message.includes('401') || message.includes('unauthorized')) {
          errorContent = 'Your session may have expired. Please refresh the page or log in again.';
        } else if (message.includes('connection') || message.includes('connect')) {
          errorContent = 'Unable to reach the server. Please check your connection and try again.';
        } else {
          errorContent = 'Something went wrong. Please try again or contact support.';
        }
      }

      // Add error message to chat
      const errorMessage: ChatMessage = {
        id: `error_${nanoid()}`,
        role: 'assistant',
        content: errorContent,
        timestamp: new Date(Date.now() + 2).toISOString(), // Ensure proper ordering after user and placeholder
        metadata: {
          isError: true,
          errorDetails: isAdmin ? {
            message: error.message,
            name: error.name,
            stack: error.stack
          } : undefined
        }
      };

      // Add error message to current session
      if (activeSessionId) {
        addMessage(activeSessionId, errorMessage);
      }

      // Reset status after error
      setTimeout(() => setStreamingStatus('idle'), 3000);
    },
    onThinking: (status) => {
      // Start thinking phase in unified agent state
      agentHandlers.onThinking(status);
      if (!thinkingStartTime) {
        startThinking();
      }
    },
    onThinkingContent: (content, tokens) => {
      // Update unified agent state with actual thinking content and token count
      agentHandlers.onThinkingContent(content, tokens);
    },
    onThinkingComplete: () => {
      // Mark thinking as complete in unified agent state
      agentHandlers.onThinkingComplete();
    },
    onMultiModel: (event) => {
      // Forward multi-model events to unified agent state
      agentHandlers.onMultiModel(event);
    },
    onStream: (content) => {
      setStreamingStatus('streaming');
      // Update unified agent state
      agentHandlers.onContentDelta(content);
      // Don't accumulate here - currentMessage from useSSEChat already has the full content
      // This callback is just for status updates
    },
    onPipelineStage: (stage, data) => {
      // Update unified agent state with pipeline stage
      agentHandlers.onPipelineStage(stage, data);
    },
    onToolRound: (round, maxRounds) => {
      // Tool round logging disabled to reduce console noise
      // if (import.meta.env.DEV) {
      //   console.log(`[Pipeline] Tool round ${round} of ${maxRounds}`);
      // }
      // Update tool round indicators if needed
    },
    autoApproveTools: true // Auto-approve all tools
  });

  // Agent activity state is now managed by useSSEToAgentState hook
  // The unified agentState replaces the old feedActivities and orbState

  // Live thinking timer - calculated from thinkingStartTime during streaming
  // Uses a local state for live updates during streaming, falls back to store's thinkingTime when complete
  const [liveThinkingTime, setLiveThinkingTime] = useState(0);

  useEffect(() => {
    if (!isStreaming || !thinkingStartTime) {
      return;
    }

    // Update timer immediately
    setLiveThinkingTime(Date.now() - thinkingStartTime);

    // Update timer every 100ms for smooth animation
    const interval = setInterval(() => {
      if (thinkingStartTime) {
        setLiveThinkingTime(Date.now() - thinkingStartTime);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming, thinkingStartTime]);

  // Use live time during streaming, store's thinkingTime when complete
  const displayThinkingTime = isStreaming && thinkingStartTime ? liveThinkingTime : thinkingTime;

  // Session creation logic moved to useChatSessions hook

  // Session loading logic moved to useChatSessions hook
  
  // Message loading logic moved to useChatSessions hook
  // Token stats are computed locally when messages are loaded

  // MCP functions loading logic moved to useMCPTools hook

  // Fetch user usage data
  const fetchUserUsage = useCallback(async () => {
    try {
      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint('/admin/my-usage'), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-AgenticWork-Frontend': 'true'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Update token stats with real data
        setTokenStats({
          totalPromptTokens: data.totals?.prompt_tokens || 0,
          totalCompletionTokens: data.totals?.completion_tokens || 0,
          totalTokens: data.totals?.total_tokens || 0,
          chartData: data.dailyUsage?.map((day: UsageDataPoint) => ({
            timestamp: day.date,
            promptTokens: 0, // API doesn't split prompt/completion per day
            completionTokens: 0,
            totalTokens: day.tokens || 0
          })) || []
        });
        
        // Store full usage data for the panel
        setUserUsageData(data);
      }
    } catch (error) {
      console.error('Failed to fetch user usage:', error);
    }
  }, [getAccessToken]);

  // Fetch global token usage data for admin users
  const fetchGlobalTokenUsage = useCallback(async () => {
    if (!isAdmin) return;
    
    try {
      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint('/admin/global-usage'), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-AgenticWork-Frontend': 'true'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setGlobalTokenUsage({
          total: data.totalTokens || 0,
          sessions: data.totalSessions || 0,
          users: data.activeUsers || 0,
          cost: data.totalCost || 0
        });
      }
    } catch (error) {
      console.error('Failed to fetch global token usage:', error);
    }
  }, [getAccessToken, isAdmin]);

  // Session deletion logic moved to useChatSessions hook

  // Tool toggling logic moved to useMCPTools hook

  // Multimedia component handlers
  const handleImageAnalysisComplete = useCallback((result: ImageAnalysisResult) => {
    // Add the analysis result as a message to the chat
    const analysisMessage: ChatMessage = {
      id: nanoid(),
      role: 'assistant',
      content: `## Image Analysis Results\n\n**Extracted Text:** ${result.text || 'No text detected'}\n\n**Description:** ${result.description || 'No description available'}\n\n**Detected Objects:** ${result.objects?.map((obj) => `${obj.name} (${Math.round(obj.confidence * 100)}%)`).join(', ') || 'None'}\n\n**Tags:** ${result.tags?.join(', ') || 'None'}`,
      timestamp: new Date().toISOString(),
      tokenUsage: null,
      metadata: { imageAnalysis: result }
    };
    
    // Add analysis result to current session
    if (activeSessionId) {
      addMessage(activeSessionId, analysisMessage);
    }
    closeUI('showImageAnalysis');
    setCurrentImageForAnalysis(null);
  }, [closeUI]);



  const handleExportFilesSelect = useCallback((files: any[]) => {
    // Handle exported files if needed
    // console.log('Exported files:', files);
  }, []);

  const handleUploadFilesSelect = useCallback((files: any[]) => {
    // Convert uploaded files to the expected format and add to selected files
    const convertedFiles = files.map(f => f.file).filter(Boolean);
    setSelectedFiles(prev => [...prev, ...convertedFiles]);
    
    // Don't auto-trigger image analysis - images will be sent with message
  }, [currentImageForAnalysis]);

  // Send message - updated to use SSE
  const sendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isStreaming) {
      return;
    }
    
    // Auto-create session if none exists
    let sessionId = activeSessionId;
    if (!sessionId) {
      // console.log('[CHAT] No active session, creating new session...');
      try {
        sessionId = await createNewSession();
        // console.log('[CHAT] Created new session:', sessionId);
      } catch (error) {
        console.error('[CHAT] Failed to create session:', error);
        return;
      }
    }

    // Prepare files if any - do this FIRST so we can attach to user message
    let base64Images: Array<{ name: string; type: string; content: string }> = [];
    if (selectedFiles.length > 0) {
      base64Images = await Promise.all(
        selectedFiles.map(async (file) => {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          return {
            name: file.name,
            type: file.type,
            content: base64.split(',')[1] // Remove data:image/jpeg;base64, prefix
          };
        })
      );
    }

    // Add user message to UI immediately (optimistic update)
    const baseTimestamp = Date.now();
    const userMessage: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date(baseTimestamp).toISOString(),
      status: 'sending', // Visual indicator that message is being sent
      // Include attached files so they display as thumbnails with the message
      attachedImages: base64Images.length > 0 ? base64Images.map(img => ({
        name: img.name,
        data: img.content, // Already base64 without prefix
        mimeType: img.type
      })) : undefined
    };

    // Add user message to store
    if (sessionId) {
      addMessage(sessionId, userMessage);
    }

    // Smooth scroll to show user's message - use requestAnimationFrame for smooth timing
    requestAnimationFrame(() => {
      const container = document.getElementById('chat-messages-container');
      if (container) {
        // Scroll to bottom to show user's message, then let them scroll naturally
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    });

    // Clear input and files
    const message = inputMessage;
    setInputMessage('');

    // Clean up preview URLs before clearing files
    selectedFiles.forEach(file => {
      if ((file as any).previewUrl) {
        URL.revokeObjectURL((file as any).previewUrl);
      }
    });
    setSelectedFiles([]);

    // CRITICAL: Reset ALL streaming state to prevent old content from bleeding into new responses
    setStreamingContent(''); // Clear streaming content
    setActiveMcpCalls([]); // Clear MCP calls

    // Clear placeholder ref to prevent updates to old placeholders
    const oldPlaceholderId = streamingPlaceholderIdRef.current;
    if (oldPlaceholderId) {
      // console.log('[CHAT] Clearing old placeholder ref:', oldPlaceholderId);
      // Mark old placeholder as completed to stop any further updates
      if (sessionId) {
        finishStreamingMessage(sessionId, oldPlaceholderId);
      }
      streamingPlaceholderIdRef.current = null;
    }

    // CRITICAL FIX: Add placeholder assistant message IMMEDIATELY to preserve message order
    // This prevents second user messages from appearing above first assistant responses
    const assistantPlaceholderId = `assistant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '', // Will be filled as streaming progresses
      timestamp: new Date(baseTimestamp + 1).toISOString(), // Ensure it comes after user message
      status: 'streaming'
    };

    // console.log('[CHAT] Creating new placeholder for new message:', assistantPlaceholderId);

    if (sessionId) {
      addMessage(sessionId, assistantPlaceholder);
      streamingPlaceholderIdRef.current = assistantPlaceholderId; // Track this ID for updates
    }

    // Send message using SSE - admins can override model selection
    // console.log('[CHAT] About to call sendSSEMessage with:', {
    //   message,
    //   sessionId,
    //   selectedModel,
    //   enabledToolsCount: Array.from(enabledTools).length,
    //   enabledTools: Array.from(enabledTools),
    //   hasFiles: base64Images.length > 0,
    //   filesCount: base64Images.length,
    //   enabledPromptTechniques: Array.from(enabledPromptTechniques),
    //   sendSSEMessageType: typeof sendSSEMessage,
    //   sendSSEMessageExists: !!sendSSEMessage
    // });

    if (!sendSSEMessage) {
      console.error('[CHAT] CRITICAL ERROR: sendSSEMessage is null/undefined!');
      return;
    }

    // console.log('[CHAT] CALLING sendSSEMessage NOW...');
    lastMessageSentRef.current = Date.now(); // Track when message was sent to prevent race conditions

    // Start unified agent activity tracking
    agentHandlers.onStreamStart(assistantPlaceholderId, selectedModel || undefined);

    try {
      const result = await sendSSEMessage(message, {
        // Pass selected model if admin has chosen one
        model: selectedModel || undefined,
        enabledTools: Array.from(enabledTools),
        files: base64Images.length > 0 ? base64Images : undefined,
        // Pass enabled prompt techniques
        promptTechniques: Array.from(enabledPromptTechniques),
        // Enable extended thinking for supported models (Claude 3.5+, o1-preview, etc.)
        enableExtendedThinking: showThinkingInline
      });
      // console.log('[CHAT] sendSSEMessage completed successfully:', result);
    } catch (error) {
      console.error('[CHAT] CRITICAL ERROR - Failed to send message');
      // Error is already handled by the SSE hook's onError callback
    }
  }, [inputMessage, activeSessionId, isStreaming, sendSSEMessage, selectedFiles, enabledTools, selectedModel, enabledPromptTechniques, agentHandlers.onStreamStart]);

  // Load sessions on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadSessions();
      // Auto-create first session if no sessions exist (handled in loadSessions)
    }
  }, [isAuthenticated]); // loadSessions is stable from zustand, no need in deps
  
  // Load messages when current session changes
  useEffect(() => {
    if (activeSessionId && isAuthenticated) {
      loadSessionMessages(activeSessionId);
    }
  }, [activeSessionId, isAuthenticated, loadSessionMessages]);

  // Track when messages are sent to avoid race conditions
  const lastMessageSentRef = useRef<number>(0);
  
  // DISABLED: Do not stop streaming when session changes - this was causing abort race condition
  // The original intent was to prevent input from remaining disabled, but it was aborting active streams
  // Instead, let the stream complete naturally and the UI will update accordingly
  useEffect(() => {
    // console.log('[SESSION] Session change detected:', { activeSessionId, isStreaming, isAuthenticated });
    // Do not automatically stop streaming on session changes - let streams complete naturally
    if (isStreaming) {
      // console.log('[SESSION] Stream active during session change - allowing to continue');
    }
  }, [activeSessionId, isStreaming, isAuthenticated]);

  // Load MCP functions (only once)
  const mcpLoadedRef = useRef(false);
  useEffect(() => {
    // Load MCP functions when authenticated
    const isLocalMode = process.env.NODE_ENV === 'development' && import.meta.env.VITE_LOCAL_MODE === 'true';
    if ((isAuthenticated || isLocalMode) && !mcpLoadedRef.current) {
      mcpLoadedRef.current = true;
      loadMCPFunctions();
    }
  }, [isAuthenticated, loadMCPFunctions]);

  // Fetch available models and current prompt on mount
  useEffect(() => {
    const fetchModelsAndPrompt = async () => {
      try {
        // Get auth token
        const token = await getAccessToken();
        const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
        
        // Fetch available models from API
        const modelsResponse = await fetch(apiEndpoint('/models'), {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (modelsResponse.ok) {
          const data = await modelsResponse.json();
          if (data.models && data.models.length > 0) {
            // Store the actual models for dynamic display (for admins to select from)
            setAvailableModels(data.models);

            // Model selection is ADMIN ONLY
            // Non-admins always use empty string which defaults to model-router on backend
            if (isAdminUser) {
              // Validate stored model against available models
              const storedModel = localStorage.getItem('selectedModel');
              const modelIds = data.models.map((m: any) => m.id);

              if (storedModel && modelIds.includes(storedModel)) {
                // Stored model is valid - use it
                console.log('[MODEL] Admin using stored model from localStorage:', storedModel);
                setSelectedModel(storedModel);
              } else {
                // No valid stored model - use "Default" (empty string)
                // This lets the model router choose the best model
                console.log('[MODEL] Admin no stored model, using Default (router selection)');
                setSelectedModel('');
              }
            } else {
              // Non-admin - always use default model-router (empty string)
              console.log('[MODEL] Non-admin user, using default model-router');
              setSelectedModel('');
              localStorage.removeItem('selectedModel');
            }
          }
        }

        // Fetch current user's assigned prompt template
        try {
          const promptResponse = await fetch(apiEndpoint('/admin/prompts/my-template'), {
            headers: {
              'X-AgenticWork-Frontend': 'true',
              ...authHeaders
            }
          });

          if (promptResponse.ok) {
            const promptData = await promptResponse.json();
            if (promptData.template?.name) {
              setCurrentPrompt(promptData.template.name);
            }
          } else {
            // Fall back to default if no specific template assigned
            setCurrentPrompt('Default Assistant');
          }
        } catch (promptError) {
          console.error('Could not fetch current prompt template:', promptError);
          // Fall back to default - this is normal if no template is assigned
          setCurrentPrompt('Default Assistant');
        }

        // Fetch multi-model config (admin only) to check if multi-model mode is enabled
        if (isAdminUser) {
          try {
            const multiModelResponse = await fetch(apiEndpoint('/admin/multi-model/config'), {
              headers: {
                'X-AgenticWork-Frontend': 'true',
                ...authHeaders
              }
            });

            if (multiModelResponse.ok) {
              const multiModelData = await multiModelResponse.json();
              const isEnabled = multiModelData.config?.enabled ?? false;
              setMultiModelEnabled(isEnabled);
              console.log('[MULTI-MODEL] Mode enabled:', isEnabled);
            }
          } catch (multiModelError) {
            console.warn('Could not fetch multi-model config:', multiModelError);
            setMultiModelEnabled(false);
          }
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };

    fetchModelsAndPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminUser]); // Re-run when admin status changes (e.g., after user loads)

  // Listen for multi-model config changes (dispatched from Admin Portal)
  useEffect(() => {
    const handleMultiModelChange = async (event: CustomEvent<{ enabled: boolean }>) => {
      console.log('[MULTI-MODEL] Config changed via event:', event.detail);
      setMultiModelEnabled(event.detail.enabled);
    };

    window.addEventListener('multimodel-config-changed', handleMultiModelChange as EventListener);
    return () => {
      window.removeEventListener('multimodel-config-changed', handleMultiModelChange as EventListener);
    };
  }, []);

  // REMOVED: This useEffect was causing infinite loops
  // The theme is already managed by ThemeContext - no need to notify parent on every change

  // Expose functions to parent component
  useEffect(() => {
    if (onFunctionsReady) {
      onFunctionsReady({
        createNewSession: () => {
          // CRITICAL: Abort any ongoing stream before creating new session
          if (isStreaming) {
            stopStreaming();
          }
          resetAgentState();
          createNewSession(() => {
            // Reset session-specific state when creating new session via parent
            clearCoTSteps();
            setAlwaysApprovedTools(new Set<string>());
          });
        },
        toggleMetrics: () => toggleUI('showMetricsPanel'),
        openMonitor: () => {
          // Monitor feature placeholder
        },
        toggleSidebar: () => toggleUI('showChatSessions')
      });
    }
  }, [onFunctionsReady, createNewSession, showMetricsPanel, showChatSessions, isStreaming, stopStreaming, resetAgentState]);

  // Track message count - auto-scroll disabled to let users control their view
  // Users can use the ScrollToBottomButton when they want to jump to the latest message
  const lastMessageCountRef = useRef<number>(0);

  useEffect(() => {
    // Just track message count for reference, no auto-scroll
    if (messages.length > lastMessageCountRef.current) {
      lastMessageCountRef.current = messages.length;
    }
  }, [messages.length]);

  // Auto-save conversations if enabled
  useEffect(() => {
    // Auto-save is always enabled - backend handles persistence
    if (activeSessionId && messages.length > 0) {
      // Messages are automatically persisted by the backend through the SSE stream
      // console.log('Messages are persisted by the backend');
    }
  }, [messages, activeSessionId, getAccessToken]);

  // Update streaming placeholder content as it streams in
  // CRITICAL: Only update if content is actually new (not stale from previous message)
  useEffect(() => {
    if (!streamingPlaceholderIdRef.current || !currentMessage || !activeSessionId) {
      return;
    }

    // Find the placeholder message to verify it's still streaming
    const placeholder = messages.find(m => m.id === streamingPlaceholderIdRef.current);
    if (!placeholder || placeholder.status !== 'streaming') {
      // console.log('[CHAT] Skipping update - placeholder not found or not streaming');
      return;
    }

    // Only update if content is different (prevents stale updates)
    if (placeholder.content !== currentMessage) {
      updateStreamingMessage(activeSessionId, streamingPlaceholderIdRef.current, currentMessage);
    }
  }, [currentMessage, activeSessionId, messages, updateStreamingMessage]);

  // Auto-scroll to bottom during streaming to keep user focused on response
  // Uses requestAnimationFrame for smooth, non-blocking scrolling
  useEffect(() => {
    if (isStreaming && currentMessage) {
      requestAnimationFrame(() => {
        const container = document.getElementById('chat-messages-container');
        if (container) {
          // Only auto-scroll if user is near the bottom (within 200px)
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
          if (isNearBottom) {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'auto' // Use 'auto' for instant scroll during streaming to avoid jitter
            });
          }
        }
      });
    }
  }, [isStreaming, currentMessage]);

  // Load user usage data on mount and periodically
  useEffect(() => {
    if (isAuthenticated) {
      fetchUserUsage();
      
      // Refresh usage data every 5 minutes
      const interval = setInterval(fetchUserUsage, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchUserUsage]);

  // Auto-scroll to bottom when loading any chat session (new or existing)
  // This ensures the user sees the latest messages when switching sessions OR on initial load
  useEffect(() => {
    // Scroll if:
    // 1. Session changed and has messages, OR
    // 2. Messages just loaded for a session we haven't scrolled for yet
    const sessionChanged = activeSessionId !== previousActiveSessionId;
    const needsInitialScroll = activeSessionId &&
      messages.length > 0 &&
      hasScrolledForSession.current !== activeSessionId;

    if ((sessionChanged && messages.length > 0) || needsInitialScroll) {
      // Mark this session as scrolled
      hasScrolledForSession.current = activeSessionId;

      // Use setTimeout to ensure DOM has updated with messages
      setTimeout(() => {
        requestAnimationFrame(() => {
          const container = document.getElementById('chat-messages-container');
          if (container) {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'auto' // Instant scroll when loading a session
            });
          }
        });
      }, 50);
    }
  }, [activeSessionId, previousActiveSessionId, messages.length]);

  // Track session changes for proper scroll behavior
  useEffect(() => {
    setPreviousActiveSessionId(activeSessionId);
    // Reset scroll tracking and agent state when session changes
    if (activeSessionId !== previousActiveSessionId) {
      hasScrolledForSession.current = null;
      // Reset unified agent activity state for the new session
      resetAgentState();
    }
  }, [activeSessionId, resetAgentState]);

  // 🎯 FOCUS: Auto-focus input when new session starts
  useEffect(() => {
    if (activeSessionId && messages.length === 0) {
      // Focus the chat input when starting a new session
      const inputElement = document.querySelector('[data-chat-input]') as HTMLTextAreaElement;
      if (inputElement) {
        setTimeout(() => inputElement.focus(), 100);
      }
    }
  }, [activeSessionId, messages.length]);

  // Cleanup memory leaks on unmount
  useEffect(() => {
    return () => {
      // Clean up any remaining file preview URLs
      selectedFiles.forEach(file => {
        if ((file as any).previewUrl) {
          URL.revokeObjectURL((file as any).previewUrl);
        }
      });
    };
  }, [selectedFiles]);

  // Load global token usage data for admin users
  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      fetchGlobalTokenUsage();
      
      // Refresh global usage data every 5 minutes for admins
      const interval = setInterval(fetchGlobalTokenUsage, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, isAdmin, fetchGlobalTokenUsage]);

  // Handle canvas expansion
  const handleExpandToCanvas = useCallback((content: any, type: string, title: string, language?: string) => {
    const canvasItem = {
      id: Math.random().toString(36).substring(2, 15), // Replace require('nanoid')
      type: type as any,
      title,
      content,
      language,
      timestamp: new Date().toISOString()
    };
    
    setCanvasContent(canvasItem);
    openUI('canvasOpen');
  }, [openUI]);

  // Code execution is handled by the handleExecuteCode from useMCPTools hook

  // Handle message update
  const handleMessageUpdate = useCallback(async (messageId: string, newContent: string) => {
    if (!activeSessionId) return;

    // Store original content for revert if needed
    const originalMessage = messages.find(m => m.id === messageId);
    if (!originalMessage) return;

    // Update message in store
    const updatedMessage = { ...originalMessage, content: newContent };
    // Note: This would require a new store method updateMessage
    // For now, we'll just send the update to backend and rely on re-fetch

    // Send update to backend
    try {
      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint(`/chat/messages/${messageId}`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: newContent })
      });

      if (!response.ok) {
        console.error('Failed to update message:', response.status);
        // In a proper implementation, we'd need updateMessage in the store to revert
      }
    } catch (error) {
      console.error('Error updating message:', error);
    }
  }, [messages, getAccessToken]);


  // Handle text-to-speech - DISABLED
  // const handleTextToSpeech = useCallback((message: ChatMessage) => {
  //   if (isSpeaking) {
  //     stopSpeaking();
  //   } else {
  //     speak(message.content);
  //   }
  // }, [speak, stopSpeaking, isSpeaking]);

  // Handle prompt technique toggling
  const handleTogglePromptTechnique = useCallback((techniqueId: string) => {
    setEnabledPromptTechniques(prev => {
      const newSet = new Set(prev);
      if (newSet.has(techniqueId)) {
        newSet.delete(techniqueId);
      } else {
        newSet.add(techniqueId);
      }
      return newSet;
    });
  }, []);

  // addDemoCoTMessage removed - CoT functionality replaced with sequential-thinking MCP

  // Keyboard shortcut actions
  const keyboardActions = {
    createNewSession: () => {
      // CRITICAL: Abort any ongoing stream before creating new session
      if (isStreaming) {
        stopStreaming();
      }
      resetAgentState();
      createNewSession(() => {
        // Reset session-specific state when creating new session via keyboard
        clearCoTSteps();
        setAlwaysApprovedTools(new Set<string>());
      });
    },
    toggleMetrics: () => toggleUI('showMetricsPanel'),
    toggleZenMode: () => {
      // Implement zen mode - hide all panels except chat
      closeUI('showChatSessions');
      closeUI('showMetricsPanel');
      closeUI('showTokenUsage');
    },
    openChatSettings: () => openUI('showSettings'),
    regenerateMessage: () => {
      // Find last assistant message and regenerate
      const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistantMessage) {
        // console.log('Regenerating message:', lastAssistantMessage.id);
      }
    },
    toggleLeftPanel: () => toggleUI('showChatSessions'),
    toggleRightPanel: () => toggleUI('showMetricsPanel'),
    addUserMessage: () => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    },
    clearCurrentMessages: () => {
      if (activeSessionId) {
        // Messages are managed by the store, no local state to clear
        setTokenStats({
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          chartData: []
        });
      }
    },
    saveTopic: () => {
      // console.log('Saving topic for session:', activeSessionId);
    },
    focusInput: () => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    },
    searchMessages: () => {
      // console.log('Opening message search');
    },
    exportChat: () => {
      // console.log('Exporting chat');
    },
    toggleTools: () => toggleUI('showSettings'),
    setLightTheme: () => {
      if (onThemeChange) {
        onThemeChange('light');
      }
      updateTheme('light');
    },
    setDarkTheme: () => {
      if (onThemeChange) {
        onThemeChange('dark');
      }
      updateTheme('dark');
    },
    openAdminPortal: () => {
      if (isAdmin) {
        openUI('showAdminPortal');
      } else {
        // console.log('Admin portal access denied - user is not an admin');
      }
    },
    openDocs: () => {
      openUI('showDocsViewer');
    }
  };

  // Register keyboard shortcuts (respecting settings)
  // KEYBOARD SHORTCUTS DISABLED PER USER REQUEST
  const enableKeyboardShortcuts = false;
  const shortcuts = useKeyboardShortcuts(keyboardActions, enableKeyboardShortcuts);

  // Show help with ? key - DISABLED
  // useHotkeys('shift+?', () => {
  //   setShowKeyboardHelp(true);
  // });

  // App Mode keyboard shortcut - Ctrl+Shift+C (only if user has permission)
  useHotkeys('ctrl+shift+c', (e) => {
    if (userPermissions.canUseAwcode) {
      e.preventDefault();
      setAppMode(prev => prev === 'chat' ? 'code' : 'chat');
    }
  }, [userPermissions.canUseAwcode]);

  // Demo CoT message removed - replaced with sequential-thinking MCP

  return (
    <div className="flex h-screen relative overflow-hidden">
      {/* Background is now global in App.tsx via WebGLBackground */}

      {/* New Hamburger Sidebar - Hidden when fullscreen overlays are open */}
      {!showAdminPortal && !showDocsViewer && (
      <ChatSidebar
        currentTheme={settings.theme || 'dark'}
        onThemeChange={onThemeChange}
        sessions={Object.values(sessions)}
        activeSessionId={activeSessionId}
        showDeleteConfirm={showDeleteConfirm}
        isExpanded={isSidebarExpanded}
        onExpandedChange={(expanded: boolean) => setUI('isSidebarExpanded', expanded)}
        onSessionSelect={async (sessionId: string) => {
          // CRITICAL: Abort any ongoing stream before switching sessions
          // This prevents the old stream from bleeding into the new session
          if (isStreaming) {
            stopStreaming();
          }
          setActiveSession(sessionId);
          // Clear messages first for instant UI feedback
          // Messages are managed by the store, no local state to clear
          setStreamingContent('');
          setActiveMcpCalls([]);
          // Reset agent activity state for clean session
          resetAgentState();
          // console.log('Switched to session:', sessionId);
          // Load the session's message history
          await loadSessionMessages(sessionId);
        }}
        onSessionDelete={(sessionId) => deleteSession(sessionId, setDeleteConfirm)}
        onNewSession={async () => {
          try {
            // CRITICAL: Abort any ongoing stream before creating new session
            // This prevents the old stream from bleeding into the new session
            if (isStreaming) {
              stopStreaming();
            }
            // Reset agent activity state for clean session
            resetAgentState();
            // console.log('[NEW SESSION] User clicked New Chat button');
            await createNewSession(() => {
              // Reset session-specific state when creating new session
              setInputMessage('');
              setStreamingContent('');
              clearCoTSteps();
              setPendingToolCalls([]);
              setExecutedToolCalls([]);
              setMcpCalls([]);
              setStreamingStatus('idle');
              setAlwaysApprovedTools(new Set<string>());
              setPendingApproval(null);
              // Reset any streaming state
              stopThinking();
              // console.log('[NEW SESSION] Reset all UI state for clean session');
            });
            // console.log('[NEW SESSION] Successfully created new session');
          } catch (error: any) {
            console.error('[NEW SESSION] Failed to create new session:', error);

            // Differentiate error messages for admin vs regular users
            const isAdmin = user?.isAdmin || user?.is_admin || false;
            const errorContent = isAdmin
              ? `**Failed to create session**\n\n${error.message || 'Unknown error'}`
              : 'Something went wrong. Please try again later or contact support.';

            // Show error message
            const errorMessage: ChatMessage = {
              id: `error_new_session_${Date.now()}`,
              role: 'assistant',
              content: errorContent,
              timestamp: new Date().toISOString(),
              metadata: {
                isError: true,
                errorDetails: isAdmin ? { message: error.message, stack: error.stack } : undefined
              }
            };

            // Add error message to current session if one exists
            if (activeSessionId) {
              addMessage(activeSessionId, errorMessage);
            }
          }
        }}
        onShowDeleteConfirm={setDeleteConfirm}
        onSettingsClick={() => openUI('showSettings')}
        userName={user?.name || user?.email || 'User'}
        userEmail={user?.email}
        isAdmin={isAdmin}
        onAdminPanelClick={() => {
          openUI('showAdminPortal');
        }}
        onLogout={async () => {
          await logout();
        }}
        onHelpClick={() => {
          // Open documentation as overlay modal
          openUI('showDocsViewer');
        }}
        // App Mode toggle (Chat/Code)
        appMode={appMode}
        onAppModeChange={setAppMode}
        canUseCodeMode={userPermissions.canUseAwcode}
        // Code mode session ID for file browser
        codeSessionId={codeSessionId}
        // Code mode session handlers
        onCodeSessionSelect={handleCodeSessionSelect}
        onCodeNewSession={handleCodeNewSession}
      />
      )}
      {/* Full-screen Admin Portal - renders over everything including sidebar (lazy loaded) */}
      {showAdminPortal && (
        <div className="fixed inset-0 z-50">
          <Suspense fallback={
            <div className="h-full w-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
                <p className="mt-4 text-sm" style={{ color: 'var(--color-textMuted)' }}>Loading Admin Portal...</p>
              </div>
            </div>
          }>
            <AdminPortal
              theme={settings.theme || 'dark'}
              embedded={false}
              onClose={() => closeUI('showAdminPortal')}
            />
          </Suspense>
        </div>
      )}

      {/* Full-screen Docs Viewer - renders over everything including sidebar */}
      {showDocsViewer && (
        <div className="fixed inset-0 z-50">
          <DocsViewer
            isOpen={true}
            onClose={() => closeUI('showDocsViewer')}
            theme={settings.theme || 'dark'}
          />
        </div>
      )}

      {/* Main chat area - FIXED to use proper flexbox layout - Hidden when fullscreen overlays are open */}
      {!showAdminPortal && !showDocsViewer && (
      <div
        className="flex flex-col transition-all duration-150"
        style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          right: 0,
          left: isSidebarExpanded ? '320px' : '64px',
          width: `calc(100vw - ${isSidebarExpanded ? '320px' : '64px'})`
        }}
      >
        <div className="flex flex-col h-full w-full">
          {/* Conditional rendering: Chat Mode vs Code Mode */}
          {appMode === 'code' && userPermissions.canUseAwcode ? (
            /* Code Mode - AgentiCode UI (V2) */
            <CodeModeLayoutV2
              userId={user?.id || 'anonymous'}
              workspacePath="~"
              onExit={() => setAppMode('chat')}
              theme={(settings.theme || 'dark') as 'light' | 'dark'}
              inline={true}
              onSendMessage={sendCodeModeMessage}
            />
          ) : (
          /* Chat Mode - Normal chat interface */
          <>
          {/* Main content area - Chat messages */}
          <div
            id="chat-messages-container"
            className="flex-1 overflow-y-auto bg-theme-bg-primary relative"
            style={{
              // Optimize scroll performance
              overscrollBehavior: 'contain',
              scrollBehavior: 'auto', // Use auto for instant scroll updates during streaming
              willChange: 'scroll-position',
              contain: 'strict',
              width: '100%',
              height: '100%'
            }}
          >
            {/* Export Button - DISABLED (not working) */}
            <ChatMessages
              theme={settings.theme || 'dark'}
              messages={messages}
              streamingContent={currentMessage}
              smoothStreaming={true}
              isLoading={isStreaming}
              thinkingTime={thinkingTime}
              thinkingMessage={currentThinking}
              thinkingContent={currentThinking}
              thinkingMetrics={thinkingMetrics}
              messagesEndRef={messagesEndRef}
              activeMcpCalls={activeMcpCalls}
              currentToolRound={currentToolRound}
              pipelineState={pipelineState}
              showTypingIndicators={true}
              showMCPIndicators={showMCPIndicators}
              showModelBadges={showModelBadges}
              showThinkingInline={showThinkingInline}
              cotSteps={cotSteps}
              agentState={agentState}
              contentBlocks={contentBlocks}
              onExpandToCanvas={handleExpandToCanvas}
              onExecuteCode={handleExecuteCode}
              onMessageUpdate={handleMessageUpdate}
            />
          </div>

          {/* Input area - FIXED at bottom, NO BORDER - Hidden when admin portal or docs viewer is active */}
          {!showAdminPortal && !showDocsViewer && (
          <div className="flex-shrink-0">
            {/* Input area */}
            <div className="relative">
              {/* REMOVED: UnifiedAgentActivity - thinking/steps now displayed INLINE in message bubbles */}

              {/* Selected files display */}
              {selectedFiles.length > 0 && (
                <div className="px-4 pt-3 pb-1 bg-theme-bg-secondary">
                  <div className="flex flex-wrap gap-2">
                    {selectedFiles.map((file, index) => (
                      <motion.div
                        key={`${file.name}-${index}`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-theme-bg-tertiary text-theme-text-secondary"
                      >
                        <Paperclip size={12} />
                        <span className="max-w-[150px] truncate">{file.name}</span>
                        <button
                          onClick={() => {
                            setSelectedFiles(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="ml-1 p-0.5 rounded hover:bg-opacity-20 hover:bg-theme-text-primary"
                        >
                          <X size={12} />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Modern Chat Input Bar with integrated toolbar */}
              <SSEErrorBoundary onRetry={() => {
                // Reset streaming state on retry
                setStreamingContent('');
                setActiveMcpCalls([]);
              }}>
                <ChatInputBar
                  value={inputMessage}
                  onChange={setInputMessage}
                  onSend={sendMessage}
                  onStopGeneration={stopStreaming}
                  onFileSelect={(files) => {
                    // Create file objects with preview URLs for images
                    const filesWithPreviews = files.map(file => {
                      if (file.type.startsWith('image/') && !file.type.includes('svg')) {
                        // Create a preview URL for the image
                        const previewUrl = URL.createObjectURL(file);
                        // Store the preview URL on the file object
                        (file as any).previewUrl = previewUrl;
                      }
                      return file;
                    });
                    setSelectedFiles([...selectedFiles, ...filesWithPreviews]);
                  }}
                  onFileRemove={(fileId) => {
                    // Clean up preview URLs when removing files
                    const fileToRemove = selectedFiles.find(f => f.name === fileId);
                    if (fileToRemove && (fileToRemove as any).previewUrl) {
                      URL.revokeObjectURL((fileToRemove as any).previewUrl);
                    }
                    setSelectedFiles(selectedFiles.filter(f => f.name !== fileId));
                  }}
                  isLoading={isStreaming}
                  isStreaming={isStreaming}
                  disabled={!isAuthenticated}
                  attachments={selectedFiles.map(file => {
                    // Determine file type for proper icon display
                    const extension = file.name.split('.').pop()?.toLowerCase();
                    const mimeType = file.type.toLowerCase();

                    let fileType: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other' = 'other';

                    if (mimeType.startsWith('image/')) {
                      fileType = 'image';
                    } else if (mimeType === 'application/pdf' || extension === 'pdf') {
                      fileType = 'pdf';
                    } else if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'go', 'rs', 'php', 'swift', 'kt', 'sql'].includes(extension || '')) {
                      fileType = 'code';
                    } else if (['xls', 'xlsx', 'csv'].includes(extension || '') || mimeType.includes('spreadsheet')) {
                      fileType = 'spreadsheet';
                    } else if (extension === 'json' || mimeType === 'application/json') {
                      fileType = 'json';
                    } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension || '') || mimeType.includes('zip') || mimeType.includes('compressed')) {
                      fileType = 'archive';
                    } else if (['doc', 'docx', 'txt', 'md', 'rtf', 'odt'].includes(extension || '') || mimeType.includes('document') || mimeType.includes('text')) {
                      fileType = 'document';
                    }

                    return {
                      id: file.name,
                      file,
                      type: fileType,
                      preview: (file as any).previewUrl
                    };
                  })}
                  // Toolbar props
                  showTokenUsage={showPersonalTokenUsage}
                  availableModels={availableModels}
                  selectedModel={selectedModel}
                  onModelChange={(model) => {
                    // Only update local state for this session, not global settings
                    setSelectedModel(model);
                  }}
                  onToggleTokenUsage={() => {
                    // console.log('[TOOLBAR DEBUG] Personal Token Usage clicked, current:', showPersonalTokenUsage);
                    toggleUI('showPersonalTokenUsage');
                  }}
                  // Pass MCP functions for toolbar display
                  availableMcpFunctions={availableMCPFunctions}
                  enabledTools={enabledTools}
                  onToggleTool={handleToggleTool}
                  // Token count from API
                  tokenCount={tokenStats.totalTokens}
                  // Active MCP calls for centered display
                  activeMcpCalls={activeMcpCalls}
                  // MCP Indicators display toggle
                  showMCPIndicators={showMCPIndicators}
                  onToggleMCPIndicators={() => toggleUI('showMCPIndicators')}
                  // Model Badges display toggle
                  showModelBadges={showModelBadges}
                  onToggleModelBadges={() => toggleUI('showModelBadges')}
                  // App Mode toggle (Chat/Code)
                  isCodeMode={appMode === 'code'}
                  onCodeModeToggle={() => setAppMode(prev => prev === 'chat' ? 'code' : 'chat')}
                  canUseAwcode={userPermissions.canUseAwcode}
                  // Thinking mode toggle
                  isThinkingEnabled={showThinkingInline}
                  onThinkingToggle={() => toggleUI('showThinkingInline')}
                  // Multi-model mode (disables model selector when enabled)
                  isMultiModelEnabled={isMultiModelEnabled}
                  // Personality system - fetched from pipeline config API (admin portal is SOT)
                  personalities={personalities}
                  activePersonalityId={activePersonalityId}
                  onSelectPersonality={setActivePersonalityId}
                  className="pb-0"
                />
              </SSEErrorBoundary>
            </div>
          </div>
          )}
          </>
          )}
        </div>
      </div>
      )}

      {/* Side panels */}
      <AnimatePresence>
        {showMetricsPanel && (
          <MetricsPanel
            tokenStats={tokenStats}
            onClose={() => closeUI('showMetricsPanel')}
            onShowMovableGraph={() => openUI('showTokenGraph')}
          />
        )}
      </AnimatePresence>
      
      {/* Settings Dropdown removed - no longer needed */}
      
      
      {/* Canvas Panel */}
      <CanvasPanel
        isOpen={canvasOpen}
        onClose={() => closeUI('canvasOpen')}
        content={canvasContent}
        theme={settings.theme || 'dark'}
        onExecute={handleExecuteCode}
      />

      {/* Admin Portal is now embedded in main content area - modal removed */}

      {/* Token Graph removed - analytics feature deleted */}
      
      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        isOpen={showKeyboardHelp}
        onClose={() => closeUI('showKeyboardHelp')}
      />
      
      {/* Admin Portal is now embedded in main content area */}

      {/* Documentation Viewer */}
      {/* {showDocsViewer && (
        <DocsViewer onClose={() => closeUI('showDocsViewer')} />
      )} */}

      {/* Image Analysis Modal */}
      <AnimatePresence>
        {showImageAnalysis && currentImageForAnalysis && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-background)' }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closeUI('showImageAnalysis');
                setCurrentImageForAnalysis(null);
              }
            }}
          >
            <div className="w-full max-w-4xl mx-4 h-[80vh]" onClick={(e) => e.stopPropagation()}>
              <ImageAnalysis
                file={currentImageForAnalysis}
                onAnalysisComplete={handleImageAnalysisComplete}
                onClose={() => {
                  closeUI('showImageAnalysis');
                  setCurrentImageForAnalysis(null);
                }}
                theme={settings.theme || 'dark'}
                className="w-full h-full"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Portal and Documentation Viewer now rendered inline - modal overlays removed */}

      {/* Background Jobs Panel */}
      <BackgroundJobsPanel
        isOpen={showBackgroundJobs}
        onClose={() => closeUI('showBackgroundJobs')}
      />

      {/* Code Mode is now rendered inline in the main content area above */}

      {/* Activity Orb replaced by UnifiedAgentActivity component with integrated ThinkingSphere */}

    </div>
  );
};

export default Chat;
