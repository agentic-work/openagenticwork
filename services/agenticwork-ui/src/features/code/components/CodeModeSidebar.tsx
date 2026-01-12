/**
 * Code Mode Sidebar Content
 *
 * Displays code mode specific content in the sidebar:
 * - Session list (like Agenticode - NEW!)
 * - Workspace files (from MinIO - persistent storage)
 * - Project settings
 *
 * Sessions are now persisted and can be switched between.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folders, RefreshCw, ChevronRight,
  ChevronDown, File, Folder, FileCode, FileText,
  Image, Archive, Download, Upload, Plus, MessageSquare,
  Clock, Trash2
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

// Session type from API
interface CodeSession {
  id: string;
  sliceId?: string;
  containerId?: string;
  status: string;
  model?: string;
  workspacePath?: string;
  title?: string; // Generated title for display
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mimeType?: string;
  children?: WorkspaceFile[];
}

interface CodeModeSidebarProps {
  isExpanded: boolean;
  theme?: 'light' | 'dark';
  /** Currently active session ID */
  activeSessionId?: string;
  /** Callback when a session is selected */
  onSessionSelect?: (session: CodeSession) => void;
  /** Callback when new session is requested */
  onNewSession?: () => void;
  /** Callback when a file is selected */
  onFileSelect?: (file: WorkspaceFile) => void;
  /** Callback to upload files */
  onUploadFiles?: (files: File[]) => Promise<void>;
  /** Callback to download a file */
  onDownloadFile?: (file: WorkspaceFile) => Promise<void>;
  /** Callback to download a folder as ZIP */
  onDownloadFolder?: (folder: WorkspaceFile) => Promise<void>;
}

/**
 * Get icon for file type
 */
function getFileIcon(name: string, type: string): React.ReactNode {
  if (type === 'directory') return <Folder size={14} className="text-yellow-500" />;

  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode size={14} className="text-blue-500" />;
    case 'py':
      return <FileCode size={14} className="text-green-500" />;
    case 'md':
    case 'txt':
      return <FileText size={14} className="text-gray-400" />;
    case 'json':
    case 'yaml':
    case 'yml':
      return <FileCode size={14} className="text-purple-500" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <Image size={14} className="text-pink-500" />;
    case 'zip':
    case 'tar':
    case 'gz':
      return <Archive size={14} className="text-orange-500" />;
    default:
      return <File size={14} className="text-gray-400" />;
  }
}

/**
 * Format file size
 */
function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Recursive file tree component
 */
interface FileTreeProps {
  files: WorkspaceFile[];
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onFileSelect?: (file: WorkspaceFile) => void;
  onDownloadFile?: (file: WorkspaceFile) => Promise<void>;
  onDownloadFolder?: (folder: WorkspaceFile) => Promise<void>;
  isDark: boolean;
  level: number;
}

const FileTree: React.FC<FileTreeProps> = ({
  files,
  expandedFolders,
  toggleFolder,
  onFileSelect,
  onDownloadFile,
  onDownloadFolder,
  isDark,
  level,
}) => {
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: WorkspaceFile } | null>(null);

  const handleDownload = async (file: WorkspaceFile, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    setIsDownloading(file.path);
    try {
      if (file.type === 'directory') {
        if (!onDownloadFolder) return;
        await onDownloadFolder(file);
      } else {
        if (!onDownloadFile) return;
        await onDownloadFile(file);
      }
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsDownloading(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: WorkspaceFile) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // Close context menu on click outside
  React.useEffect(() => {
    const handleClick = () => closeContextMenu();
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  return (
    <div className="space-y-0.5">
      {files.map((file) => (
        <React.Fragment key={file.path}>
          <motion.div
            whileHover={{ backgroundColor: isDark ? '#21262d' : '#f3f4f6' }}
            className={`
              group flex items-center gap-2 py-1.5 rounded cursor-pointer
              ${isDark ? 'text-[#c9d1d9]' : 'text-gray-700'}
            `}
            style={{ paddingLeft: `${8 + level * 12}px`, paddingRight: '8px' }}
            onClick={() => {
              if (file.type === 'directory') {
                toggleFolder(file.path);
              } else if (onFileSelect) {
                onFileSelect(file);
              }
            }}
            onContextMenu={(e) => handleContextMenu(e, file)}
          >
            {file.type === 'directory' ? (
              expandedFolders.has(file.path) ? (
                <ChevronDown size={12} className="opacity-50 flex-shrink-0" />
              ) : (
                <ChevronRight size={12} className="opacity-50 flex-shrink-0" />
              )
            ) : (
              <span className="w-3 flex-shrink-0" />
            )}
            {getFileIcon(file.name, file.type)}
            <span className="flex-1 text-sm truncate">{file.name}</span>
            {/* Download button - visible on hover for files */}
            {file.type === 'file' && onDownloadFile && (
              <button
                onClick={(e) => handleDownload(file, e)}
                disabled={isDownloading === file.path}
                className={`
                  opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity
                  ${isDark ? 'hover:bg-[#30363d] text-[#8b949e]' : 'hover:bg-gray-200 text-gray-500'}
                `}
                title="Download file"
              >
                {isDownloading === file.path ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <Download size={12} />
                )}
              </button>
            )}
            {file.size !== undefined && file.size > 0 && !onDownloadFile && (
              <span className={`text-xs flex-shrink-0 ${isDark ? 'text-[#6e7681]' : 'text-gray-400'}`}>
                {formatSize(file.size)}
              </span>
            )}
          </motion.div>
          {/* Render children if directory is expanded */}
          <AnimatePresence>
            {file.type === 'directory' && expandedFolders.has(file.path) && file.children && file.children.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
              >
                <FileTree
                  files={file.children}
                  expandedFolders={expandedFolders}
                  toggleFolder={toggleFolder}
                  onFileSelect={onFileSelect}
                  onDownloadFile={onDownloadFile}
                  onDownloadFolder={onDownloadFolder}
                  isDark={isDark}
                  level={level + 1}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </React.Fragment>
      ))}

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className={`
              fixed z-[100] py-1 rounded-md shadow-lg min-w-[140px]
              ${isDark ? 'bg-[#161b22] border border-[#30363d]' : 'bg-white border border-gray-200'}
            `}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Download option for files */}
            {contextMenu.file.type === 'file' && onDownloadFile && (
              <button
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-sm
                  ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
                `}
                onClick={() => {
                  handleDownload(contextMenu.file);
                  closeContextMenu();
                }}
              >
                <Download size={14} />
                Download
              </button>
            )}
            {/* Download option for folders (as ZIP) */}
            {contextMenu.file.type === 'directory' && onDownloadFolder && (
              <button
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-sm
                  ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
                `}
                onClick={() => {
                  handleDownload(contextMenu.file);
                  closeContextMenu();
                }}
              >
                <Download size={14} />
                Download as ZIP
              </button>
            )}
            {/* Copy path option */}
            <button
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-sm
                ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
              `}
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.file.path);
                closeContextMenu();
              }}
            >
              <File size={14} />
              Copy Path
            </button>
            {/* Open in editor option for files */}
            {contextMenu.file.type === 'file' && onFileSelect && (
              <button
                className={`
                  w-full flex items-center gap-2 px-3 py-1.5 text-sm
                  ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
                `}
                onClick={() => {
                  onFileSelect(contextMenu.file);
                  closeContextMenu();
                }}
              >
                <FileCode size={14} />
                Open in Editor
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Helper to format relative time like Agenticode
const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
};

// Generate a title for session based on model or timestamp
const getSessionTitle = (session: CodeSession): string => {
  if (session.title) return session.title;
  if (session.model) {
    const modelName = session.model.split('/').pop() || session.model;
    return `Session with ${modelName}`;
  }
  return `Session ${session.id.slice(0, 8)}`;
};

export const CodeModeSidebar: React.FC<CodeModeSidebarProps> = ({
  isExpanded,
  theme = 'dark',
  activeSessionId,
  onSessionSelect,
  onNewSession,
  onFileSelect,
  onUploadFiles,
  onDownloadFile,
  onDownloadFolder,
}) => {
  const { getAuthHeaders } = useAuth();

  // Sessions state
  const [sessions, setSessions] = useState<CodeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Files state
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Default to 'files' tab so users see their workspace folder immediately
  const [activeSection, setActiveSection] = useState<'sessions' | 'files'>('files');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Storage info state
  const [storageDisplay, setStorageDisplay] = useState<string>('Storage');

  const isDark = theme === 'dark';

  // Store getAuthHeaders in ref to prevent effect re-runs
  const getAuthHeadersRef = useRef(getAuthHeaders);
  getAuthHeadersRef.current = getAuthHeaders;

  // Fetch sessions from API - uses ref to avoid dependency issues
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const response = await fetch(apiEndpoint('/agenticode/sessions'), {
        headers: getAuthHeadersRef.current(),
      });
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('[CodeModeSidebar] Failed to fetch sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  }, []); // Empty deps - uses ref

  // Create new session via API - uses ref for auth headers
  const createNewSession = useCallback(async () => {
    try {
      const response = await fetch(apiEndpoint('/agenticode/sessions'), {
        method: 'POST',
        headers: {
          ...getAuthHeadersRef.current(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Don't specify model - let API use slider-selected model
          workspacePath: '/',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Add new session to list
        setSessions(prev => [data.session, ...prev]);
        // Select the new session
        if (onSessionSelect) {
          onSessionSelect(data.session);
        }
        // Also call parent's onNewSession if provided
        if (onNewSession) {
          onNewSession();
        }
        return data.session;
      } else {
        console.error('[CodeModeSidebar] Failed to create session');
      }
    } catch (err) {
      console.error('[CodeModeSidebar] Failed to create session:', err);
    }
    return null;
  }, [onSessionSelect, onNewSession]); // Removed getAuthHeaders

  // Delete session via API - uses ref for auth headers
  const deleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the session

    try {
      const response = await fetch(apiEndpoint(`/agenticode/sessions/${sessionId}`), {
        method: 'DELETE',
        headers: getAuthHeadersRef.current(),
      });

      if (response.ok) {
        // Remove session from list
        setSessions(prev => prev.filter(s => s.id !== sessionId));
      } else {
        console.error('[CodeModeSidebar] Failed to delete session');
      }
    } catch (err) {
      console.error('[CodeModeSidebar] Failed to delete session:', err);
    }
  }, []); // Empty deps - uses ref

  // Load sessions on mount only
  useEffect(() => {
    fetchSessions();
  }, []); // Empty deps - run only once on mount

  // Fetch storage info on mount
  useEffect(() => {
    const fetchStorageInfo = async () => {
      try {
        const response = await fetch(apiEndpoint('/code/health'), {
          headers: getAuthHeadersRef.current(),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.storage?.display) {
            setStorageDisplay(data.storage.display);
          }
        }
      } catch (err) {
        console.error('[CodeModeSidebar] Failed to fetch storage info:', err);
      }
    };
    fetchStorageInfo();
  }, []); // Empty deps - run only once on mount

  // Handle file upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadFiles = e.target.files;
    if (!uploadFiles || uploadFiles.length === 0 || !onUploadFiles) return;

    setIsUploading(true);
    try {
      await onUploadFiles(Array.from(uploadFiles));
      // Refresh files after upload - fetchFiles will be called after this
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [onUploadFiles]);

  // Store activeSessionId in ref to prevent effect re-runs
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Fetch workspace files - prioritize session filesystem, fallback to MinIO
  // Uses refs to avoid callback recreation and effect re-runs
  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // If we have an active session, fetch from session's PTY filesystem
      // This shows the actual files the Agenticode is working with
      const sessionId = activeSessionIdRef.current;
      if (sessionId) {
        const response = await fetch(
          apiEndpoint(`/code/workspace/session-files?sessionId=${sessionId}`),
          { headers: getAuthHeadersRef.current() }
        );

        if (response.ok) {
          const data = await response.json();
          setFiles(data.files || []);
          console.log('[CodeModeSidebar] Loaded session files:', data.files?.length || 0);
          return;
        }
        // Fall through to MinIO if session files fail
        console.log('[CodeModeSidebar] Session files unavailable, falling back to MinIO');
      }

      // Fallback: Use MinIO storage endpoint for persistent user files
      const response = await fetch(apiEndpoint('/code/workspace/files'), {
        headers: getAuthHeadersRef.current(),
      });

      if (response.ok) {
        const data = await response.json();
        // MinIO endpoint returns a file tree with children for directories
        setFiles(data.files || []);
      } else if (response.status === 404 || response.status === 503) {
        // Storage unavailable or no bucket yet - show empty state
        setFiles([]);
      } else {
        throw new Error('Failed to load files');
      }
    } catch (err: any) {
      // Gracefully handle errors - show empty state instead of error
      // This is expected when the user hasn't uploaded any files yet
      console.log('[CodeModeSidebar] Files fetch error (expected if no bucket):', err.message);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []); // Empty deps - uses refs

  // Load files on mount AND when activeSessionId changes
  // This ensures the sidebar shows the correct files for the current session
  useEffect(() => {
    fetchFiles();
  }, [activeSessionId, fetchFiles]); // Re-fetch when session changes

  // Toggle folder expansion
  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Collapsed view - just icons
  if (!isExpanded) {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        {/* Sessions icon */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setActiveSection('sessions')}
          className={`p-2 rounded-lg transition-colors ${
            activeSection === 'sessions'
              ? (isDark ? 'bg-[#21262d] text-[#58a6ff]' : 'bg-gray-200 text-blue-600')
              : (isDark ? 'text-[#8b949e] hover:text-[#c9d1d9]' : 'text-gray-500 hover:text-gray-700')
          }`}
          title="Sessions"
        >
          <MessageSquare size={18} />
        </motion.button>

        {/* Files icon */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setActiveSection('files')}
          className={`p-2 rounded-lg transition-colors ${
            activeSection === 'files'
              ? (isDark ? 'bg-[#21262d] text-[#58a6ff]' : 'bg-gray-200 text-blue-600')
              : (isDark ? 'text-[#8b949e] hover:text-[#c9d1d9]' : 'text-gray-500 hover:text-gray-700')
          }`}
          title="Workspace Files"
        >
          <Folders size={18} />
        </motion.button>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="flex flex-col h-full">
      {/* Section tabs - Sessions, Files, Settings */}
      <div className={`flex items-center gap-1 px-2 py-2 border-b ${isDark ? 'border-[#30363d]' : 'border-gray-200'}`}>
        <button
          onClick={() => setActiveSection('sessions')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors ${
            activeSection === 'sessions'
              ? (isDark ? 'bg-[#21262d] text-[#c9d1d9]' : 'bg-gray-200 text-gray-900')
              : (isDark ? 'text-[#8b949e] hover:text-[#c9d1d9]' : 'text-gray-500 hover:text-gray-700')
          }`}
        >
          <MessageSquare size={12} />
          Sessions
        </button>
        <button
          onClick={() => setActiveSection('files')}
          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors ${
            activeSection === 'files'
              ? (isDark ? 'bg-[#21262d] text-[#c9d1d9]' : 'bg-gray-200 text-gray-900')
              : (isDark ? 'text-[#8b949e] hover:text-[#c9d1d9]' : 'text-gray-500 hover:text-gray-700')
          }`}
        >
          <Folders size={12} />
          Files
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Sessions Section - Like Agenticode */}
        {activeSection === 'sessions' ? (
          <div className="p-2">
            {/* New Session Button */}
            <button
              onClick={createNewSession}
              className={`
                w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg text-sm font-medium
                transition-colors
                ${isDark
                  ? 'bg-[#238636] hover:bg-[#2ea043] text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
                }
              `}
            >
              <Plus size={14} />
              New Session
            </button>

            {/* Sessions List */}
            {sessionsLoading ? (
              <div className={`text-sm text-center py-4 ${isDark ? 'text-[#8b949e]' : 'text-gray-500'}`}>
                Loading sessions...
              </div>
            ) : sessions.length === 0 ? (
              <div className={`text-sm text-center py-8 px-4 ${isDark ? 'text-[#8b949e]' : 'text-gray-500'}`}>
                <MessageSquare size={24} className="mx-auto mb-2 opacity-50" />
                <p className="font-medium">No sessions yet</p>
                <p className="text-xs mt-1 opacity-75">
                  Start a new session to begin coding
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <motion.div
                      key={session.id}
                      whileHover={{ backgroundColor: isDark ? '#21262d' : '#f3f4f6' }}
                      className={`
                        group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer
                        ${isActive
                          ? (isDark ? 'bg-[#21262d] ring-1 ring-[#58a6ff]' : 'bg-gray-200 ring-1 ring-blue-500')
                          : ''
                        }
                      `}
                      onClick={() => onSessionSelect?.(session)}
                    >
                      {/* Active indicator */}
                      <div className={`
                        mt-1.5 w-2 h-2 rounded-full flex-shrink-0
                        ${session.status === 'running'
                          ? 'bg-[#3fb950]'
                          : (isDark ? 'bg-[#6e7681]' : 'bg-gray-400')
                        }
                      `} />

                      {/* Session info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isDark ? 'text-[#c9d1d9]' : 'text-gray-900'}`}>
                          {getSessionTitle(session)}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Clock size={10} className={isDark ? 'text-[#6e7681]' : 'text-gray-400'} />
                          <span className={`text-xs ${isDark ? 'text-[#6e7681]' : 'text-gray-400'}`}>
                            {formatRelativeTime(session.updatedAt)}
                          </span>
                        </div>
                      </div>

                      {/* Delete button */}
                      <button
                        onClick={(e) => deleteSession(session.id, e)}
                        className={`
                          p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity
                          ${isDark
                            ? 'hover:bg-[#30363d] text-[#8b949e] hover:text-red-400'
                            : 'hover:bg-gray-200 text-gray-400 hover:text-red-500'
                          }
                        `}
                        title="Delete session"
                      >
                        <Trash2 size={12} />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="p-2">
            {/* Header with refresh */}
            <div className={`flex items-center justify-between px-2 py-1 mb-2`}>
              <span className={`text-xs font-medium uppercase ${isDark ? 'text-[#8b949e]' : 'text-gray-500'}`}>
                Workspace
              </span>
              <button
                onClick={fetchFiles}
                disabled={isLoading}
                className={`p-1 rounded transition-colors ${
                  isDark ? 'hover:bg-[#21262d] text-[#8b949e]' : 'hover:bg-gray-100 text-gray-500'
                }`}
                title="Refresh files"
              >
                <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* File list */}
            {isLoading ? (
              <div className={`text-sm text-center py-4 ${isDark ? 'text-[#8b949e]' : 'text-gray-500'}`}>
                Loading...
              </div>
            ) : error ? (
              <div className={`text-sm text-center py-4 ${isDark ? 'text-[#f85149]' : 'text-red-500'}`}>
                {error}
              </div>
            ) : files.length === 0 ? (
              <div className={`text-sm text-center py-8 px-4 ${isDark ? 'text-[#8b949e]' : 'text-gray-500'}`}>
                <Folders size={24} className="mx-auto mb-2 opacity-50" />
                <p className="font-medium">No files yet</p>
                <p className="text-xs mt-1 opacity-75">
                  Upload files or create them in the terminal
                </p>
                {onUploadFiles && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className={`
                        mt-3 flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded text-xs font-medium
                        ${isDark
                          ? 'bg-[#238636] text-white hover:bg-[#2ea043]'
                          : 'bg-green-600 text-white hover:bg-green-700'}
                        ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      {isUploading ? (
                        <>
                          <RefreshCw size={12} className="animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload size={12} />
                          Upload Files
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <FileTree
                files={files}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                onFileSelect={onFileSelect}
                onDownloadFile={onDownloadFile}
                onDownloadFolder={onDownloadFolder}
                isDark={isDark}
                level={0}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer - storage info */}
      <div className={`px-3 py-2 border-t text-xs flex items-center gap-2 ${isDark ? 'border-[#30363d] text-[#6e7681]' : 'border-gray-200 text-gray-400'}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
        {storageDisplay}
      </div>
    </div>
  );
};

export default CodeModeSidebar;
