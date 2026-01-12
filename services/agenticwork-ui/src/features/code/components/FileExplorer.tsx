/**
 * File Explorer Component
 * Enhanced file tree with search, new file/folder creation, and context actions
 */

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileJson,
  Image as ImageIcon,
  ChevronRight,
  ChevronDown,
  Search,
  Plus,
  FolderPlus,
  FilePlus,
  MoreHorizontal,
  Trash2,
  Edit2,
  Copy,
  Download,
  Upload,
  GitBranch,
  RefreshCw,
  Loader2,
} from '@/shared/icons';
import type { FileNode } from '../types';

interface FileExplorerProps {
  files: FileNode[];
  onFileSelect: (file: FileNode) => void;
  onCreateFile?: (path: string, name: string) => void;
  onCreateFolder?: (path: string, name: string) => void;
  onDeleteFile?: (file: FileNode) => void;
  onRenameFile?: (file: FileNode, newName: string) => void;
  onUploadFiles?: (files: File[], targetPath?: string) => Promise<void>;
  onDownloadFile?: (file: FileNode) => Promise<void>;
  onGitClone?: (repoUrl: string) => Promise<void>;
  onRefresh?: () => void;
  isLoading?: boolean;
  theme: 'light' | 'dark';
  className?: string;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  onFileSelect,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onUploadFiles,
  onDownloadFile,
  onGitClone,
  onRefresh,
  isLoading = false,
  theme,
  className = '',
}) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/workspace', '.']));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileNode } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showGitCloneModal, setShowGitCloneModal] = useState(false);
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isDark = theme === 'dark';

  // Handle file upload via input
  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadFiles = e.target.files;
    if (!uploadFiles || uploadFiles.length === 0 || !onUploadFiles) return;

    setIsUploading(true);
    try {
      await onUploadFiles(Array.from(uploadFiles));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [onUploadFiles]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onUploadFiles) {
      setIsDragging(true);
    }
  }, [onUploadFiles]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!onUploadFiles) return;

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    setIsUploading(true);
    try {
      await onUploadFiles(droppedFiles);
    } finally {
      setIsUploading(false);
    }
  }, [onUploadFiles]);

  // Handle git clone
  const handleGitClone = useCallback(async () => {
    if (!gitRepoUrl.trim() || !onGitClone) return;

    setIsCloning(true);
    try {
      await onGitClone(gitRepoUrl.trim());
      setShowGitCloneModal(false);
      setGitRepoUrl('');
    } finally {
      setIsCloning(false);
    }
  }, [gitRepoUrl, onGitClone]);

  // Handle download
  const handleDownload = useCallback(async (file: FileNode) => {
    if (!onDownloadFile || file.type === 'directory') return;
    await onDownloadFile(file);
  }, [onDownloadFile]);

  // Toggle folder expansion
  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  }, []);

  // Get appropriate icon for file type
  const getFileIcon = useCallback((fileName: string, isDirectory: boolean, isExpanded: boolean) => {
    if (isDirectory) {
      return isExpanded
        ? <FolderOpen size={16} className="text-blue-500" />
        : <Folder size={16} className="text-blue-500" />;
    }

    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'jsx':
        return <FileCode size={16} className="text-yellow-500" />;
      case 'ts':
      case 'tsx':
        return <FileCode size={16} className="text-blue-500" />;
      case 'py':
        return <FileCode size={16} className="text-green-500" />;
      case 'java':
      case 'cpp':
      case 'c':
      case 'go':
      case 'rs':
        return <FileCode size={16} className="text-orange-500" />;
      case 'json':
        return <FileJson size={16} className="text-yellow-500" />;
      case 'yaml':
      case 'yml':
      case 'toml':
        return <FileJson size={16} className="text-purple-500" />;
      case 'md':
      case 'txt':
        return <FileText size={16} className="text-gray-500" />;
      case 'html':
        return <FileCode size={16} className="text-orange-500" />;
      case 'css':
      case 'scss':
      case 'less':
        return <FileCode size={16} className="text-blue-400" />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg':
      case 'webp':
        return <ImageIcon size={16} className="text-purple-500" />;
      default:
        return <File size={16} className={isDark ? 'text-[#8b949e]' : 'text-gray-500'} />;
    }
  }, [isDark]);

  // Format file size
  const formatSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Filter files based on search
  const filterFiles = useCallback((nodes: FileNode[], query: string): FileNode[] => {
    if (!query.trim()) return nodes;

    const lowerQuery = query.toLowerCase();
    return nodes.reduce<FileNode[]>((acc, node) => {
      const nameMatches = node.name.toLowerCase().includes(lowerQuery);
      const filteredChildren = node.children ? filterFiles(node.children, query) : [];

      if (nameMatches || filteredChildren.length > 0) {
        acc.push({
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
          expanded: filteredChildren.length > 0 ? true : node.expanded,
        });
      }
      return acc;
    }, []);
  }, []);

  const filteredFiles = useMemo(() => {
    return filterFiles(files, searchQuery);
  }, [files, searchQuery, filterFiles]);

  // Handle file click
  const handleFileClick = useCallback((file: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedPath(file.path);

    if (file.type === 'directory') {
      toggleExpand(file.path);
    } else {
      onFileSelect(file);
    }
  }, [toggleExpand, onFileSelect]);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  }, []);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Render a single file node
  const renderNode = (node: FileNode, level: number = 0): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path;
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          className={`
            flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded-sm
            transition-colors duration-100
            ${isSelected
              ? (isDark ? 'bg-[#21262d]' : 'bg-gray-200')
              : (isDark ? 'hover:bg-[#21262d]/50' : 'hover:bg-gray-100')
            }
          `}
          style={{ paddingLeft: `${8 + level * 12}px` }}
          onClick={(e) => handleFileClick(node, e)}
          onContextMenu={(e) => handleContextMenu(e, node)}
        >
          {/* Expand/collapse chevron for directories */}
          {node.type === 'directory' ? (
            <div className="flex-shrink-0 w-4">
              {isExpanded ? (
                <ChevronDown size={12} className={isDark ? 'text-[#8b949e]' : 'text-gray-500'} />
              ) : (
                <ChevronRight size={12} className={isDark ? 'text-[#8b949e]' : 'text-gray-500'} />
              )}
            </div>
          ) : (
            <div className="w-4" />
          )}

          {/* Icon */}
          <div className="flex-shrink-0">
            {getFileIcon(node.name, node.type === 'directory', isExpanded)}
          </div>

          {/* Name */}
          <span
            className={`
              flex-1 text-sm truncate
              ${isDark ? 'text-[#c9d1d9]' : 'text-gray-700'}
            `}
            title={node.name}
          >
            {node.name}
          </span>

          {/* Size for files */}
          {node.type === 'file' && node.size !== undefined && (
            <span className={`text-xs ${isDark ? 'text-[#6e7681]' : 'text-gray-400'}`}>
              {formatSize(node.size)}
            </span>
          )}
        </div>

        {/* Children */}
        <AnimatePresence>
          {node.type === 'directory' && isExpanded && hasChildren && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {node.children!.map(child => renderNode(child, level + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div
      className={`flex flex-col h-full ${className}`}
      onClick={closeContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-background)]/90 border-2 border-dashed border-[var(--color-primary)]">
          <div className="text-center">
            <Upload size={32} className="text-[var(--color-primary)] mx-auto mb-2" />
            <p className="text-sm font-medium text-[var(--color-text)]">
              Drop files here to upload
            </p>
          </div>
        </div>
      )}

      {/* Header with actions */}
      <div className={`p-2 border-b ${isDark ? 'border-[#30363d]' : 'border-gray-200'}`}>
        {/* Action buttons */}
        <div className="flex items-center gap-1 mb-2">
          {onUploadFiles && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={`
                flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors
                ${isDark
                  ? 'bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              title="Upload files"
            >
              {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              <span>Upload</span>
            </button>
          )}
          {/* GitHub Connect - Coming Soon */}
          <button
            onClick={() => setShowGitCloneModal(true)}
            disabled={true}
            className={`
              flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors
              ${isDark
                ? 'bg-[#21262d] text-[#6e7681]'
                : 'bg-gray-100 text-gray-400'}
              opacity-60 cursor-not-allowed
            `}
            title="Connect to GitHub - Coming Soon"
          >
            <GitBranch size={12} />
            <span>GitHub</span>
            <span className={`text-[10px] px-1 rounded ${isDark ? 'bg-[#30363d]' : 'bg-gray-200'}`}>Soon</span>
          </button>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className={`
                p-1 rounded transition-colors ml-auto
                ${isDark
                  ? 'text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              title="Refresh files"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--color-background)] border border-[var(--color-border)]">
          <Search size={14} className="text-[var(--color-textMuted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="flex-1 text-sm bg-transparent outline-none text-[var(--color-text)] placeholder-[var(--color-textMuted)]"
          />
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-auto">
        {filteredFiles.length === 0 ? (
          <div className="p-4 text-center">
            <Folder size={32} className="mx-auto mb-2 text-[var(--color-border)]" />
            <p className="text-sm font-medium text-[var(--color-textMuted)]">
              {searchQuery ? 'No files match your search' : 'No files yet'}
            </p>
            {!searchQuery && (
              <>
                <p className="text-xs mt-1 text-[var(--color-textMuted)]">
                  Upload files or create them using the terminal
                </p>
                {onUploadFiles && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-3 flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded text-xs font-medium bg-[var(--color-success)] text-white hover:opacity-90"
                  >
                    <Upload size={12} />
                    Upload Files
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="py-1">
            {filteredFiles.map(node => renderNode(node))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className={`
              fixed z-50 py-1 rounded-md shadow-lg min-w-[160px]
              ${isDark ? 'bg-[#161b22] border border-[#30363d]' : 'bg-white border border-gray-200'}
            `}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.file.type === 'directory' && (
              <>
                <button
                  className={`
                    w-full flex items-center gap-2 px-3 py-1.5 text-sm
                    ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
                  `}
                  onClick={() => {
                    onCreateFile?.(contextMenu.file.path, 'new-file.txt');
                    closeContextMenu();
                  }}
                >
                  <FilePlus size={14} />
                  New File
                </button>
                <button
                  className={`
                    w-full flex items-center gap-2 px-3 py-1.5 text-sm
                    ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
                  `}
                  onClick={() => {
                    onCreateFolder?.(contextMenu.file.path, 'new-folder');
                    closeContextMenu();
                  }}
                >
                  <FolderPlus size={14} />
                  New Folder
                </button>
                <div className={`my-1 border-t ${isDark ? 'border-[#30363d]' : 'border-gray-200'}`} />
              </>
            )}
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
            <button
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-sm
                ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
              `}
              onClick={() => {
                // Copy path to clipboard
                navigator.clipboard.writeText(contextMenu.file.path);
                closeContextMenu();
              }}
            >
              <Copy size={14} />
              Copy Path
            </button>
            <button
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-sm
                ${isDark ? 'text-[#c9d1d9] hover:bg-[#21262d]' : 'text-gray-700 hover:bg-gray-100'}
              `}
              onClick={() => {
                onRenameFile?.(contextMenu.file, contextMenu.file.name);
                closeContextMenu();
              }}
            >
              <Edit2 size={14} />
              Rename
            </button>
            <div className={`my-1 border-t ${isDark ? 'border-[#30363d]' : 'border-gray-200'}`} />
            <button
              className={`
                w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500
                ${isDark ? 'hover:bg-[#21262d]' : 'hover:bg-gray-100'}
              `}
              onClick={() => {
                onDeleteFile?.(contextMenu.file);
                closeContextMenu();
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Git Clone Modal */}
      <AnimatePresence>
        {showGitCloneModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-background)]/80 backdrop-blur-sm"
            onClick={() => setShowGitCloneModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md p-4 rounded-lg shadow-xl bg-[var(--color-surface)] border border-[var(--color-border)]"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold mb-4 text-[var(--color-text)]">
                Clone Git Repository
              </h3>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[var(--color-textMuted)]">
                  Repository URL
                </label>
                <input
                  type="text"
                  value={gitRepoUrl}
                  onChange={(e) => setGitRepoUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className="w-full px-3 py-2 rounded-md text-sm bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                  onKeyDown={(e) => e.key === 'Enter' && handleGitClone()}
                />
                <p className="text-xs mt-1 text-[var(--color-textMuted)]">
                  Supports GitHub, GitLab, Bitbucket, and any public Git URL
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowGitCloneModal(false)}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-[var(--color-surfaceSecondary)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGitClone}
                  disabled={!gitRepoUrl.trim() || isCloning}
                  className={`
                    flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium
                    bg-blue-600 text-white hover:bg-blue-700
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  {isCloning ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Cloning...
                    </>
                  ) : (
                    <>
                      <GitBranch size={14} />
                      Clone
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FileExplorer;
