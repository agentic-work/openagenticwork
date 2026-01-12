/**
 * EditorPanel - Embedded VS Code (code-server) Panel
 *
 * Provides a full VS Code experience within Agenticode:
 * - Embedded code-server iframe
 * - File preview/editing
 * - Integrated terminal
 * - Extensions support
 *
 * The code-server instance is managed per-user by agenticode-manager.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Code2,
  Eye,
  FileCode,
  Loader2,
  RefreshCw,
  ExternalLink,
  X,
  Maximize2,
  Minimize2,
  Play,
  AlertCircle,
  Lock,
} from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';

export type EditorPanelTab = 'editor' | 'terminal' | 'preview';

export interface EditorPanelProps {
  sessionId: string | null;
  workspacePath: string;
  selectedFile?: string;
  onFileSelect?: (path: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenExternal?: () => void;
  className?: string;
}

interface CodeServerStatus {
  status: 'not_started' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'available';
  url: string | null;
  port?: number;
  password?: string;
  error?: string;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  sessionId,
  workspacePath,
  selectedFile,
  onFileSelect,
  isCollapsed = false,
  onToggleCollapse,
  onOpenExternal,
  className = '',
}) => {
  const { getAuthHeaders } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [activeTab, setActiveTab] = useState<EditorPanelTab>('editor');
  const [codeServerStatus, setCodeServerStatus] = useState<CodeServerStatus>({
    status: 'not_started',
    url: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Fetch code-server status
  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;

    try {
      const response = await fetch(
        apiEndpoint(`/agenticode/sessions/${sessionId}/code-server`),
        { headers: getAuthHeaders() }
      );

      if (response.ok) {
        const data = await response.json();
        setCodeServerStatus(data);
      }
    } catch (err) {
      console.error('[EditorPanel] Failed to fetch code-server status:', err);
    }
  }, [sessionId, getAuthHeaders]);

  // Start code-server
  const startCodeServer = useCallback(async () => {
    if (!sessionId) return;

    setIsLoading(true);
    setCodeServerStatus(prev => ({ ...prev, status: 'starting' }));

    try {
      const response = await fetch(
        apiEndpoint(`/agenticode/sessions/${sessionId}/code-server`),
        {
          method: 'POST',
          headers: getAuthHeaders(),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setCodeServerStatus({
          status: 'running',
          url: data.url,
          port: data.port,
          password: data.password,
        });
      } else {
        const error = await response.json();
        setCodeServerStatus({
          status: 'error',
          url: null,
          error: error.message || 'Failed to start code-server',
        });
      }
    } catch (err: any) {
      setCodeServerStatus({
        status: 'error',
        url: null,
        error: err.message || 'Failed to start code-server',
      });
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, getAuthHeaders]);

  // Stop code-server
  const stopCodeServer = useCallback(async () => {
    if (!sessionId) return;

    try {
      await fetch(
        apiEndpoint(`/agenticode/sessions/${sessionId}/code-server`),
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        }
      );
      setCodeServerStatus({ status: 'stopped', url: null });
    } catch (err) {
      console.error('[EditorPanel] Failed to stop code-server:', err);
    }
  }, [sessionId, getAuthHeaders]);

  // Poll status when starting
  useEffect(() => {
    if (sessionId) {
      fetchStatus();
    }
  }, [sessionId, fetchStatus]);

  // Construct iframe URL with folder path
  const getIframeUrl = useCallback(() => {
    if (!codeServerStatus.url) return null;

    // The URL from the manager already includes the correct folder path
    // e.g., /code-server/?folder=%2Fworkspaces%2F{userId}%2F{sessionId}
    let url = codeServerStatus.url;

    // If a specific file is selected, append to the URL
    if (selectedFile) {
      // Decode existing folder path to build file path
      const urlObj = new URL(url, window.location.origin);
      const folder = urlObj.searchParams.get('folder') || '/workspaces';
      urlObj.searchParams.set('file', `${folder}/${selectedFile}`);
      url = urlObj.pathname + urlObj.search;
    }

    return url;
  }, [codeServerStatus.url, selectedFile]);

  // Handle iframe load
  const handleIframeLoad = () => {
    setIframeLoaded(true);
  };

  // Open in new window
  const handleOpenExternal = () => {
    if (codeServerStatus.url) {
      window.open(getIframeUrl() || codeServerStatus.url, '_blank');
    }
    onOpenExternal?.();
  };

  // Refresh iframe
  const handleRefresh = () => {
    if (iframeRef.current) {
      setIframeLoaded(false);
      iframeRef.current.src = getIframeUrl() || '';
    }
  };

  // Panel tabs - Terminal disabled for security (prevents root access to container)
  const tabs: { id: EditorPanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'editor', label: 'Editor', icon: <FileCode size={14} /> },
    // Terminal tab disabled - users should not have direct terminal access
    // { id: 'terminal', label: 'Terminal', icon: <Terminal size={14} /> },
    { id: 'preview', label: 'Preview', icon: <Eye size={14} /> },
  ];

  if (isCollapsed) {
    return (
      <div
        className={`w-10 bg-[var(--cm-bg-secondary)] border-l border-[var(--cm-border)] flex flex-col items-center py-2 ${className}`}
      >
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
          title="Expand Editor Panel"
        >
          <Code2 size={18} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col w-full h-full bg-[var(--cm-bg)] border-l border-[var(--cm-border)] ${
        isMaximized ? 'fixed inset-0 z-[1200]' : ''
      } ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--cm-border)] bg-[var(--cm-bg-secondary)]">
        <div className="flex items-center gap-2">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[var(--cm-bg-tertiary)] text-[var(--cm-text)]'
                    : 'text-[var(--cm-text-secondary)] hover:text-[var(--cm-text)] hover:bg-[var(--cm-bg-tertiary)]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {codeServerStatus.status === 'running' && (
            <>
              <button
                onClick={handleRefresh}
                className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
                title="Refresh"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={handleOpenExternal}
                className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
                title="Open in New Window"
              >
                <ExternalLink size={14} />
              </button>
            </>
          )}
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary)] text-[var(--cm-text-secondary)]"
            title="Collapse Panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center overflow-hidden min-h-[300px]" style={{ backgroundColor: 'var(--color-background)' }}>
        {/* Not Started / Stopped / Available State */}
        {(codeServerStatus.status === 'not_started' || codeServerStatus.status === 'stopped' || codeServerStatus.status === 'available') && (
          <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="p-4 rounded-full bg-[var(--color-surfaceSecondary)]">
              <Code2 size={32} className="text-[var(--color-textMuted)]" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-[var(--color-text)]">VS Code Web IDE</h3>
              <p className="text-sm mt-1 text-[var(--color-textMuted)]">
                Start your personal VS Code instance to edit files
              </p>
            </div>
            <button
              onClick={startCodeServer}
              disabled={isLoading || !sessionId}
              data-testid="start-vscode-btn"
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 bg-[var(--color-success)] text-white hover:opacity-90"
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              <span>Start VS Code</span>
            </button>
            {!sessionId && (
              <p className="text-xs text-[var(--color-textMuted)]">
                Connect to a session first
              </p>
            )}
          </div>
        )}

        {/* Starting State */}
        {codeServerStatus.status === 'starting' && (
          <div className="flex flex-col items-center justify-center gap-4 p-6">
            <Loader2 size={32} className="animate-spin text-[var(--color-success)]" />
            <div className="text-center">
              <p className="text-[var(--cm-text)]">Starting VS Code...</p>
              <p className="text-sm text-[var(--cm-text-secondary)] mt-1">
                This may take a few seconds
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {codeServerStatus.status === 'error' && (
          <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="p-4 rounded-full bg-red-500/10">
              <AlertCircle size={32} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-[var(--cm-text)]">Failed to Start</h3>
              <p className="text-sm text-red-400 mt-1">
                {codeServerStatus.error || 'Unknown error'}
              </p>
            </div>
            <button
              onClick={startCodeServer}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--cm-bg-tertiary)] hover:bg-[var(--cm-bg-secondary)] text-[var(--cm-text)] transition-colors"
            >
              <RefreshCw size={16} />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Running - Show iframe */}
        {codeServerStatus.status === 'running' && codeServerStatus.url && (
          <>
            {/* Loading overlay */}
            {!iframeLoaded && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-background)] z-10">
                <Loader2 size={32} className="animate-spin text-[var(--color-success)]" />
              </div>
            )}

            {/* Password hint */}
            {codeServerStatus.password && (
              <div className="absolute top-2 right-2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--cm-bg-tertiary)] border border-[var(--cm-border)] text-xs">
                <Lock size={12} className="text-[var(--cm-text-secondary)]" />
                <span className="text-[var(--cm-text-secondary)]">Password:</span>
                <code className="font-mono text-[var(--cm-text)]">
                  {codeServerStatus.password}
                </code>
              </div>
            )}

            {/* VS Code iframe */}
            <iframe
              ref={iframeRef}
              src={getIframeUrl() || ''}
              className="w-full h-full border-0"
              data-testid="vscode-iframe"
              onLoad={handleIframeLoad}
              allow="clipboard-read; clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          </>
        )}
      </div>

      {/* Status Bar */}
      {codeServerStatus.status === 'running' && (
        <div className="flex items-center justify-between px-3 py-1 border-t border-[var(--cm-border)] bg-[var(--cm-bg-secondary)] text-xs">
          <div className="flex items-center gap-2 text-[var(--cm-text-secondary)]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#3fb950]" />
              Connected
            </span>
            <span>Port: {codeServerStatus.port}</span>
          </div>
          <button
            onClick={stopCodeServer}
            className="text-red-400 hover:text-red-300 transition-colors"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
};

export default EditorPanel;
