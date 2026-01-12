/**
 * Settings Dropdown Component
 * Provides quick access to app settings, theme controls, and MCP tool management
 * Features: Theme switching, animation controls, MCP inspector integration, TTS settings
 */

import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Moon, Sun, Zap, Settings as SettingsIcon, Wrench, Brain, Book } from '@/shared/icons';
import clsx from 'clsx';
import { Settings } from '@/types';
import { useAuth } from '@/app/providers/AuthContext';
import { DocsViewer } from '@/features/docs/DocsViewer';

interface SettingsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  theme: 'light' | 'dark';
  anchorElement?: HTMLElement | null;
  position?: 'top' | 'bottom';
  mcpServers?: any[];
}

const SettingsDropdown: React.FC<SettingsDropdownProps> = ({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  theme,
  anchorElement,
  position = 'top',
  mcpServers = []
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState('general');
  const [showDocsViewer, setShowDocsViewer] = useState(false);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          anchorElement && !anchorElement.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose, anchorElement]);

  // Calculate position - always above the button
  const getPosition = () => {
    if (!anchorElement) return { bottom: 60, left: 300 };
    
    const rect = anchorElement.getBoundingClientRect();
    
    // Position above the button
    return {
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left + rect.width / 2 - 240 // Center the 480px dropdown on button
    };
  };

  const pos = getPosition();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, scale: 0.95, y: position === 'top' ? 10 : -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: position === 'top' ? 10 : -10 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="fixed z-50 w-[480px] rounded-xl shadow-2xl border overflow-hidden bg-bg-secondary border-border"
          style={{
            ...pos,
            height: '400px',
            maxHeight: '400px'
          }}
        >
          {/* Header with Tabs */}
          <div className="border-b border-border">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <h3 className="text-sm font-semibold text-text-primary">
                Settings
              </h3>
              <button
                onClick={onClose}
                className="p-1 rounded-lg transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
              >
                <X size={16} />
              </button>
            </div>
            
            {/* Tab Navigation */}
            <div className="flex px-2 gap-1 overflow-x-auto">
              {[
                { id: 'general', label: 'General', icon: SettingsIcon },
                { id: 'mcp-tools', label: 'MCP Tools', icon: Wrench },
                { id: 'documentation', label: 'Documentation', icon: Book }
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-all rounded-t-lg',
                    activeTab === id
                      ? 'bg-bg-hover text-text-primary border-b-2 border-accent'
                      : 'text-text-muted hover:text-text-primary hover:bg-bg-hover/50'
                  )}
                >
                  <Icon size={12} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content - Scrollable with fixed height */}
          <div className="overflow-y-auto px-4 py-3" style={{ height: 'calc(400px - 88px)' }}>
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-4">
                {/* Chat Preferences */}
                <div>
                  <label className="text-xs font-medium mb-2 block text-text-muted">
                    Chat Preferences
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.general?.enableKeyboardShortcuts ?? true}
                        onChange={(e) => onSettingsChange({
                          ...settings,
                          general: { ...settings.general, enableKeyboardShortcuts: e.target.checked }
                        })}
                        className="rounded text-xs"
                      />
                      <span className="text-xs">Enable keyboard shortcuts</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.general?.showTypingIndicators ?? true}
                        onChange={(e) => onSettingsChange({
                          ...settings,
                          general: { ...settings.general, showTypingIndicators: e.target.checked }
                        })}
                        className="rounded text-xs"
                      />
                      <span className="text-xs">Show typing indicators</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.general?.autoSaveConversations ?? true}
                        onChange={(e) => onSettingsChange({
                          ...settings,
                          general: { ...settings.general, autoSaveConversations: e.target.checked }
                        })}
                        className="rounded text-xs"
                      />
                      <span className="text-xs">Auto-save conversations</span>
                    </label>
                  </div>
                </div>

                {/* Theme Selection */}
                <div>
                  <label className="text-xs font-medium mb-2 block text-text-muted">
                    Theme
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'light', icon: Sun, label: 'Light' },
                      { value: 'dark', icon: Moon, label: 'Dark' }
                    ].map(({ value, icon: Icon, label }) => (
                      <button
                        key={value}
                        onClick={() => onSettingsChange({ ...settings, theme: value as any })}
                        className={clsx(
                          'flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all',
                          settings.theme === value
                            ? 'bg-accent text-white'
                            : 'bg-bg-hover hover:bg-bg-tertiary text-text-secondary'
                        )}
                      >
                        <Icon size={14} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* MCP Tools Tab */}
            {activeTab === 'mcp-tools' && (
              <div className="h-full overflow-y-auto" style={{ height: '300px' }}>
                {/* Show available MCP servers and their tools */}
                {mcpServers && mcpServers.length > 0 ? (
                  <div className="space-y-2">
                    {mcpServers.map((server, index) => {
                      // Get server icon based on name
                      const getServerIcon = (name: string) => {
                        if (name.toLowerCase().includes('memory')) {
                          return <Brain size={16} />;
                        } else if (name.toLowerCase().includes('azure')) {
                          return (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                            </svg>
                          );
                        } else if (name.toLowerCase().includes('time')) {
                          return (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                              <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                          );
                        } else if (name.toLowerCase().includes('sequential') || name.toLowerCase().includes('thinking')) {
                          return (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                            </svg>
                          );
                        } else {
                          return <Wrench size={16} />;
                        }
                      };

                      // Format server description
                      const getServerDescription = (server: any) => {
                        // Check multiple possible locations for tools array
                        const toolCount = server.toolCount || 
                                        server.availableTools?.length || 
                                        server.tools?.length || 
                                        server.functions?.length || 
                                        0;
                        const status = server.status || (server.isConnected ? 'connected' : 'Unknown');
                        return `${toolCount} tools • ${status}`;
                      };

                      return (
                        <div
                          key={server.id || index}
                          className="flex items-center justify-between p-3 rounded-lg border transition-colors bg-bg-tertiary border-border hover:bg-bg-hover"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-bg-hover">
                              {getServerIcon(server.serverName || server.name || '')}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-text-primary">
                                {server.serverName || server.name || 'Unknown Server'}
                              </p>
                              <p className="text-xs text-text-muted">
                                {getServerDescription(server)}
                              </p>
                            </div>
                          </div>
                          <div className={clsx(
                            'w-2 h-2 rounded-full',
                            server.status === 'connected' || server.isConnected ? 'bg-green-500' : 'bg-gray-400'
                          )} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-text-muted">
                    <Wrench size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No MCP tools available</p>
                    <p className="text-xs mt-1">Loading MCP servers...</p>
                  </div>
                )}
              </div>
            )}

            {/* Documentation Tab */}
            {activeTab === 'documentation' && (
              <div className="space-y-4">
                <div className="text-center py-8 text-text-secondary">
                  <Book size={48} className="mx-auto mb-4 opacity-80" />
                  <p className="text-sm font-medium mb-2">Documentation</p>
                  <p className="text-xs mb-4">Access comprehensive guides, API references, and system documentation</p>
                  <button
                    onClick={() => {
                      setShowDocsViewer(true);
                      onClose();
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-accent hover:bg-accent-hover text-white"
                  >
                    Open Documentation
                  </button>
                </div>
              </div>
            )}

          </div>
        </motion.div>
      )}

      {/* Full-screen Documentation Viewer */}
      {showDocsViewer && (
        <div className="fixed inset-0 z-[100] bg-black/80">
          <DocsViewer
            isOpen={showDocsViewer}
            onClose={() => setShowDocsViewer(false)}
            theme={theme}
          />
        </div>
      )}
    </AnimatePresence>
  );
};

export default SettingsDropdown;