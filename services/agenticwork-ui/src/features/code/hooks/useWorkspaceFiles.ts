/**
 * useWorkspaceFiles - Hook for fetching workspace files from agenticode-manager
 *
 * Fetches the user's workspace directory structure from the agenticode-manager
 * service, which has access to the user's Minio/cloud storage.
 */

import { useState, useEffect, useCallback } from 'react';
import type { FileNode } from '../types';

interface UseWorkspaceFilesResult {
  files: FileNode[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  uploadFiles: (files: File[], targetPath?: string) => Promise<void>;
  downloadFile: (file: FileNode) => Promise<void>;
  downloadFolder: (folder: FileNode) => Promise<void>;
  gitClone: (repoUrl: string) => Promise<void>;
  syncToSession: (sessionId: string) => Promise<{ syncedCount: number; message: string }>;
  isSyncing: boolean;
}

export function useWorkspaceFiles(userId: string, sessionId?: string): UseWorkspaceFilesResult {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!userId) {
      setFiles([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const authToken = localStorage.getItem('auth_token');

      // UNIFIED FILESYSTEM: Fetch from PTY session workspace (same as AI and VS Code)
      // This ensures UI, AI, and VS Code all see the same files
      const endpoint = sessionId
        ? `/api/code/workspace/session-files?sessionId=${encodeURIComponent(sessionId)}`
        : '/api/code/workspace/files'; // Fallback to MinIO if no session

      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        // Try to parse error response
        let errorData: any = {};
        try {
          errorData = await response.json();
        } catch {
          // Not JSON - that's fine
        }

        // Check for specific error conditions that are normal (empty workspace)
        if (response.status === 404 || errorData.error?.includes('bucket') || errorData.error?.includes('not found') || errorData.error?.includes('ENOENT')) {
          // No workspace yet - that's okay, show empty workspace
          setFiles([]);
          setIsLoading(false);
          return;
        }
        // Storage errors - don't block UI, just show empty with warning
        console.warn('[useWorkspaceFiles] Fetch error:', errorData.error || `Status ${response.status}`);
        setFiles([]);
        setIsLoading(false);
        return;
      }

      const data = await response.json();

      if (data.success && Array.isArray(data.files)) {
        // Convert to our FileNode format (works for both MinIO and session-files)
        const convertNode = (node: any): FileNode => ({
          name: node.name,
          type: node.type === 'directory' ? 'directory' : 'file',
          path: node.path,
          size: node.size,
          children: node.children?.map(convertNode),
        });
        setFiles(data.files.map(convertNode));
        console.log(`[useWorkspaceFiles] Loaded ${data.files.length} files from ${data.source || 'storage'}`);
      } else {
        // No files yet - that's okay
        setFiles([]);
      }
    } catch (err: any) {
      // Network errors or other issues - don't show error, just empty state
      console.warn('[useWorkspaceFiles] Fetch error (showing empty state):', err.message);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId]);

  // Initial fetch
  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Refresh when session changes
  useEffect(() => {
    if (sessionId) {
      fetchFiles();
    }
  }, [sessionId, fetchFiles]);

  // Upload files to workspace
  const uploadFiles = useCallback(async (filesToUpload: File[], targetPath?: string) => {
    const authToken = localStorage.getItem('auth_token');

    for (const file of filesToUpload) {
      const formData = new FormData();
      formData.append('file', file);

      const url = targetPath
        ? `/api/code/workspace/files?path=${encodeURIComponent(targetPath)}/${encodeURIComponent(file.name)}`
        : `/api/code/workspace/files?path=${encodeURIComponent(file.name)}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to upload ${file.name}`);
      }
    }

    // Refresh file list after upload
    await fetchFiles();
  }, [fetchFiles]);

  // Download file from workspace
  // Tries session endpoint first (PTY filesystem), falls back to MinIO
  // This ensures download works regardless of storage backend
  const downloadFile = useCallback(async (file: FileNode) => {
    if (file.type === 'directory') {
      throw new Error('Cannot download directories - use downloadFolder instead');
    }

    const authToken = localStorage.getItem('auth_token');
    const headers = { 'Authorization': `Bearer ${authToken}` };

    // Try session endpoint first if we have a session (PTY filesystem)
    if (sessionId) {
      try {
        const sessionEndpoint = `/api/code/workspace/session-file-download/${encodeURIComponent(file.path)}`;
        const response = await fetch(sessionEndpoint, { headers });

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          return;
        }
        // If session endpoint failed, fall through to MinIO
        console.log('[useWorkspaceFiles] Session download failed, trying MinIO');
      } catch (err) {
        console.log('[useWorkspaceFiles] Session download error, trying MinIO:', err);
      }
    }

    // Fallback to MinIO endpoint
    const minioEndpoint = `/api/code/workspace/files/${encodeURIComponent(file.path)}`;
    const response = await fetch(minioEndpoint, { headers });

    if (!response.ok) {
      throw new Error(`Failed to download ${file.name}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, [sessionId]);

  // Download folder as ZIP from workspace
  // Only works with session (PTY filesystem) for now
  const downloadFolder = useCallback(async (folder: FileNode) => {
    if (folder.type !== 'directory') {
      throw new Error('Not a directory');
    }

    const authToken = localStorage.getItem('auth_token');

    // Folder download only supported from session filesystem
    if (!sessionId) {
      throw new Error('Folder download requires an active session');
    }

    const endpoint = `/api/code/workspace/session-folder-download/${encodeURIComponent(folder.path)}`;

    const response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to download ${folder.name}`);
    }

    // Create blob and trigger download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${folder.name}.zip`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, [sessionId]);

  // Clone a git repository to workspace
  const gitClone = useCallback(async (repoUrl: string) => {
    const authToken = localStorage.getItem('auth_token');

    const response = await fetch('/api/code/workspace/git/clone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repoUrl }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to clone repository');
    }

    // Refresh file list after clone
    await fetchFiles();
  }, [fetchFiles]);

  // Sync MinIO files to the PTY session workspace
  // This makes uploaded files accessible to the CLI
  const syncToSession = useCallback(async (targetSessionId: string): Promise<{ syncedCount: number; message: string }> => {
    setIsSyncing(true);
    const authToken = localStorage.getItem('auth_token');

    try {
      const response = await fetch('/api/code/workspace/sync-to-session', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: targetSessionId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to sync files to session');
      }

      const result = await response.json();
      return {
        syncedCount: result.syncedCount || 0,
        message: result.message || `Synced ${result.syncedCount} files`,
      };
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return {
    files,
    isLoading,
    error,
    refresh: fetchFiles,
    uploadFiles,
    downloadFile,
    downloadFolder,
    gitClone,
    syncToSession,
    isSyncing,
  };
}

export default useWorkspaceFiles;
