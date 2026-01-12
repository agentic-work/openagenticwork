/**
 * Chat Input Toolbar Component - Gemini Style
 *
 * Separate toolbar component that sits below the main input area
 * Features:
 * - Left side: Plus button, MCP servers
 * - Right side: Model selector dropdown
 * - Glassmorphic styling for visibility
 * - React Portal for dropdown positioning
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ChevronDown, ChevronRight, X, PuzzleIcon, Layers, Code2, Brain, Sparkles, Search, CheckCircle, FileText, Smile } from '@/shared/icons';
import { FlowiseIcon } from '@/components/icons/FlowiseIcon';
import { FlowiseViewer } from '@/features/flowise/FlowiseViewer';
import { useSystemConfig } from '@/hooks/useSystemConfig';
import FileAttachmentThumbnails, { AttachmentFile } from './FileAttachmentThumbnails';
import clsx from 'clsx';

// Personality interface matching the API schema
export interface Personality {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

// Deep Research Agent Modal with Architecture Diagram
const DeepResearchModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(6px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Animated rainbow gradient header - intentional decorative colors */}
            {/* eslint-disable no-restricted-syntax */}
            <div
              className="h-1.5"
              style={{
                background: 'linear-gradient(90deg, #ff0080, #ff8c00, #ffff00, #00ff00, #00bfff, #8b5cf6, #ff0080)',
                backgroundSize: '200% 100%',
                animation: 'gradient-shift 4s ease infinite'
              }}
            />
            {/* eslint-enable no-restricted-syntax */}

            {/* Close button */}
            <button
              onClick={onClose}
              aria-label="Close Deep Research Agent dialog"
              className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors hover:bg-white/10 z-10"
              style={{ color: 'var(--color-textMuted)' }}
            >
              <X size={18} aria-hidden="true" />
            </button>

            {/* Content */}
            <div className="p-6">
              {/* Header with brain icon */}
              <div className="flex items-center gap-4 mb-5">
                <div
                  className="relative p-3 rounded-xl"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,0,128,0.15), color-mix(in srgb, var(--color-primary) 15%, transparent), rgba(0,191,255,0.15))',
                    boxShadow: `0 0 30px color-mix(in srgb, var(--color-primary) 20%, transparent)`
                  }}
                >
                  <Brain
                    size={36}
                    style={{
                      color: 'transparent',
                      stroke: 'url(#rainbow-gradient)',
                      strokeWidth: 1.5
                    }}
                  />
                  {/* Rainbow gradient SVG - intentional decorative colors */}
                  {/* eslint-disable no-restricted-syntax */}
                  <svg width="0" height="0" className="absolute">
                    <defs>
                      <linearGradient id="rainbow-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#ff0080" />
                        <stop offset="33%" stopColor="#8b5cf6" />
                        <stop offset="66%" stopColor="#00bfff" />
                        <stop offset="100%" stopColor="#00ff00" />
                      </linearGradient>
                    </defs>
                  </svg>
                  {/* eslint-enable no-restricted-syntax */}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    {/* Rainbow text gradient - intentional decorative colors */}
                    {/* eslint-disable no-restricted-syntax */}
                    <h2
                      className="text-xl font-bold"
                      style={{
                        background: 'linear-gradient(90deg, #ff0080, #8b5cf6, #00bfff)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text'
                      }}
                    >
                      Deep Research Agent
                    </h2>
                    {/* eslint-enable no-restricted-syntax */}
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{
                        background: 'rgba(251,191,36,0.2)',
                        color: '#fbbf24'
                      }}
                    >
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
                    Project GRAEAE - Autonomous multi-LLM research system
                  </p>
                </div>
              </div>

              {/* Architecture Diagram */}
              <div
                className="rounded-xl p-4 mb-5"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)'
                }}
              >
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-textMuted)' }}>
                  8-Phase Research Pipeline
                </h4>

                {/* Visual Pipeline Flow - phase colors are data-driven, not theme colors */}
                {/* eslint-disable no-restricted-syntax */}
                <div className="flex items-center justify-between gap-1 mb-4 overflow-x-auto pb-2">
                  {[
                    { name: 'Plan', icon: '🎯', color: '#8b5cf6' },
                    { name: 'Search', icon: '🔍', color: '#3b82f6' },
                    { name: 'Retrieve', icon: '📥', color: '#06b6d4' },
                    { name: 'Extract', icon: '⚙️', color: '#10b981' },
                    { name: 'Validate', icon: '✓', color: '#22c55e' },
                    { name: 'Synthesize', icon: '🧠', color: '#f59e0b' },
                    { name: 'Report', icon: '📄', color: '#ec4899' },
                    { name: 'Cache', icon: '💾', color: '#8b5cf6' },
                  ].map((phase, i) => (
                    <motion.div
                      key={phase.name}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex flex-col items-center min-w-[60px]"
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg mb-1"
                        style={{
                          backgroundColor: `${phase.color}20`,
                          border: `1px solid ${phase.color}40`
                        }}
                      >
                        {phase.icon}
                      </div>
                      <span className="text-[10px] font-medium" style={{ color: phase.color }}>
                        {phase.name}
                      </span>
                      {i < 7 && (
                        <div
                          className="absolute right-0 top-1/2 -translate-y-1/2 w-4"
                          style={{
                            background: `linear-gradient(90deg, ${phase.color}, transparent)`,
                            height: '1px'
                          }}
                        />
                      )}
                    </motion.div>
                  ))}
                </div>
                {/* eslint-enable no-restricted-syntax */}

                {/* Validation Stack */}
                <div className="grid grid-cols-4 gap-2 mt-3">
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}>
                    <div className="text-sm">🔺</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Triangulate</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
                    <div className="text-sm">🤝</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Consensus</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
                    <div className="text-sm">📊</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Statistics</div>
                  </div>
                  <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                    <div className="text-sm">🏛️</div>
                    <div className="text-[9px] mt-1" style={{ color: 'var(--color-textMuted)' }}>Authority</div>
                  </div>
                </div>
              </div>

              {/* Key Features - Compact */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <Search size={14} style={{ color: '#00bfff' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    5-10 parallel search angles
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <Layers size={14} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    5-tier LLM orchestration
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <CheckCircle size={14} style={{ color: '#22c55e' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    4-layer fact validation
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                  <FileText size={14} style={{ color: '#ec4899' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                    Export: MD, DOCX, PDF
                  </span>
                </div>
              </div>

              {/* Cost savings + Close */}
              <div className="flex items-center justify-between gap-4">
                <div
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg"
                  style={{
                    background: 'linear-gradient(90deg, rgba(34,197,94,0.1), color-mix(in srgb, var(--color-primary) 10%, transparent))',
                    border: '1px solid rgba(34,197,94,0.2)'
                  }}
                >
                  <Sparkles size={14} style={{ color: '#22c55e' }} />
                  <span className="text-xs font-medium" style={{ color: '#22c55e' }}>
                    ~40% cost reduction via intelligent routing
                  </span>
                </div>
                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90"
                  style={{
                    background: 'linear-gradient(90deg, var(--color-primary), #00bfff)',
                    color: 'white'
                  }}
                >
                  Got it
                </button>
              </div>
            </div>

            {/* CSS for gradient animation */}
            <style>{`
              @keyframes gradient-shift {
                0% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
            `}</style>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

// Model Selector Dropdown Component with React Portal and Fixed Positioning
const ModelSelectorDropdown: React.FC<{
  selectedModel: string;
  availableModels: Array<{ id: string; name: string; description?: string; type?: string; }>;
  onModelChange: (model: string) => void;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}> = ({ selectedModel, availableModels, onModelChange, onClose, buttonRef }) => {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setPosition({
          top: rect.top - 270 - 8, // Position dropdown just above button with small gap
          left: rect.left, // Align left edge of dropdown with left edge of button
        });
      }
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [buttonRef]);

  return (
    <div
      className="model-selector-dropdown min-w-[250px] max-h-[260px] rounded-xl glass-modal"
      role="listbox"
      aria-label="Available models"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 10000,
        backdropFilter: 'blur(16px) saturate(180%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--color-shadow)',
        color: 'var(--color-text)'
      }}
    >
      <div className="p-2 max-h-60 overflow-y-auto">
        {/* Auto option */}
        <button
          onClick={() => {
            onModelChange('');
            onClose();
          }}
          role="option"
          aria-selected={!selectedModel}
          className={clsx(
            'w-full text-left px-3 py-2 rounded-md transition-colors text-sm'
          )}
          style={{
            color: 'var(--color-text)',
            backgroundColor: !selectedModel ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent'
          }}
          onMouseEnter={(e) => {
            if (selectedModel) {
              e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = !selectedModel ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent';
          }}
        >
          <div className="font-medium">Default Model</div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>
            Use the system default model
          </div>
        </button>
        {availableModels.filter(m => m.type === 'chat').map((model) => (
          <button
            key={model.id}
            onClick={() => {
              onModelChange(model.id);
              onClose();
            }}
            role="option"
            aria-selected={selectedModel === model.id}
            className={clsx(
              'w-full text-left px-3 py-2 rounded-md transition-colors text-sm'
            )}
            style={{
              color: 'var(--color-text)',
              backgroundColor: selectedModel === model.id ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent'
            }}
            onMouseEnter={(e) => {
              if (selectedModel !== model.id) {
                e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = selectedModel === model.id ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent';
            }}
          >
            <div className="font-medium">{model.name}</div>
            {model.description && (
              <div className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>
                {model.description}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

// Enhanced MCP Servers Dropdown Component
const MCPServersDropdown: React.FC<{
  servers: any[];
  onToggleServer?: (serverName: string) => void;
  enabledServers?: Set<string>;
  onClose?: () => void;
  showMCPIndicators?: boolean;
  onToggleMCPIndicators?: () => void;
  showModelBadges?: boolean;
  onToggleModelBadges?: () => void;
  isAdmin?: boolean;
}> = ({ servers, onToggleServer, enabledServers, onClose, showMCPIndicators = true, onToggleMCPIndicators, showModelBadges = true, onToggleModelBadges, isAdmin = false }) => {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [enabledFunctions, setEnabledFunctions] = useState<Set<string>>(new Set());
  const [serverStates, setServerStates] = useState<Map<string, boolean>>(new Map());

  // Initialize server states and sync with parent enabled tools
  useEffect(() => {
    const states = new Map<string, boolean>();
    servers.forEach(server => {
      states.set(server.id, server.isConnected ?? true);
    });
    setServerStates(states);

    // Initialize enabled functions from parent enabled tools
    if (enabledServers) {
      const initialEnabledFunctions = new Set<string>();
      servers.forEach(server => {
        server.tools?.forEach((tool: any) => {
          const functionKey = `${server.id}.${tool.name}`;
          if (enabledServers.has(functionKey) || enabledServers.has(server.id)) {
            initialEnabledFunctions.add(functionKey);
          }
        });
      });
      setEnabledFunctions(initialEnabledFunctions);
    }
  }, [servers, enabledServers]);

  const toggleServerExpanded = (serverId: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverId)) {
      newExpanded.delete(serverId);
    } else {
      newExpanded.add(serverId);
    }
    setExpandedServers(newExpanded);
  };

  const toggleServer = (serverId: string) => {
    const newStates = new Map(serverStates);
    const currentState = newStates.get(serverId) ?? true;
    newStates.set(serverId, !currentState);
    setServerStates(newStates);

    // If disabling server, disable all its functions
    if (currentState) {
      const server = servers.find(s => s.id === serverId);
      if (server?.tools) {
        const newEnabled = new Set(enabledFunctions);
        server.tools.forEach((tool: any) => {
          newEnabled.delete(`${serverId}.${tool.name}`);
        });
        setEnabledFunctions(newEnabled);
      }
    }

    onToggleServer?.(serverId);
  };

  const toggleFunction = (serverId: string, functionName: string) => {
    const functionKey = `${serverId}.${functionName}`;
    const newEnabled = new Set(enabledFunctions);

    if (newEnabled.has(functionKey)) {
      newEnabled.delete(functionKey);
    } else {
      // Can only enable if server is enabled
      if (serverStates.get(serverId)) {
        newEnabled.add(functionKey);
      }
    }

    setEnabledFunctions(newEnabled);

    // Communicate with parent component
    if (onToggleServer) {
      onToggleServer(functionKey);
    }
  };

  return (
    <div
      className="min-w-[400px] max-w-[600px] rounded-xl"
      style={{
        backdropFilter: 'blur(16px) saturate(180%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--color-shadow)',
      }}
    >
      {/* Header */}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              MCP Servers & Functions
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
              {servers.filter(s => serverStates.get(s.id)).length} of {servers.length} servers enabled
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const newStates = new Map<string, boolean>();
                servers.forEach(s => newStates.set(s.id, true));
                setServerStates(newStates);

                const newEnabled = new Set<string>();
                servers.forEach(server => {
                  server.tools?.forEach((tool: any) => {
                    newEnabled.add(`${server.id}.${tool.name}`);
                  });
                });
                setEnabledFunctions(newEnabled);
              }}
              className="px-2 py-1 text-xs rounded-md transition-colors bg-primary-30 border-primary-30 hover:bg-primary-20"
              style={{
                color: 'var(--color-primary)',
                backgroundColor: 'color-mix(in srgb, var(--color-primary) 30%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-primary) 50%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-primary) 30%, transparent)';
              }}
            >
              Enable All
            </button>
            <button
              onClick={() => {
                const newStates = new Map<string, boolean>();
                servers.forEach(s => newStates.set(s.id, false));
                setServerStates(newStates);
                setEnabledFunctions(new Set());
              }}
              className="px-2 py-1 text-xs rounded-md transition-colors hover:opacity-80"
              style={{
                backgroundColor: 'var(--color-surfaceHover)',
                color: 'var(--color-textSecondary)',
                border: '1px solid var(--color-border)'
              }}
            >
              Disable All
            </button>
          </div>
        </div>

        {/* Tool Execution Indicators Toggle - Admin only */}
        {isAdmin && onToggleMCPIndicators && (
          <div className="flex items-center justify-between mt-3 px-3 py-2 rounded-md" style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)'
          }}>
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                Tool Execution Indicators
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
                Show tool calls below messages
              </div>
            </div>
            <button
              onClick={onToggleMCPIndicators}
              role="switch"
              aria-checked={showMCPIndicators}
              aria-label="Toggle tool execution indicators"
              className="relative w-11 h-6 rounded-full transition-colors"
              style={{
                backgroundColor: showMCPIndicators
                  ? 'rgba(34, 197, 94, 0.3)'
                  : 'rgba(107, 114, 128, 0.3)',
                border: `1px solid ${showMCPIndicators ? 'rgba(34, 197, 94, 0.5)' : 'rgba(107, 114, 128, 0.5)'}`
              }}
            >
              <motion.div
                animate={{ x: showMCPIndicators ? 20 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="absolute top-1 w-4 h-4 rounded-full shadow"
                style={{
                  backgroundColor: showMCPIndicators ? 'rgb(34, 197, 94)' : 'rgb(107, 114, 128)'
                }}
              />
            </button>
          </div>
        )}

        {/* Model Badges Toggle - Admin only */}
        {isAdmin && onToggleModelBadges && (
          <div className="flex items-center justify-between mt-3 px-3 py-2 rounded-md" style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)'
          }}>
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                Model Badges
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
                Show model used on messages
              </div>
            </div>
            <button
              onClick={onToggleModelBadges}
              role="switch"
              aria-checked={showModelBadges}
              aria-label="Toggle model badges on messages"
              className="relative w-11 h-6 rounded-full transition-colors"
              style={{
                backgroundColor: showModelBadges
                  ? 'rgba(66, 133, 244, 0.3)'
                  : 'rgba(107, 114, 128, 0.3)',
                border: `1px solid ${showModelBadges ? 'rgba(66, 133, 244, 0.5)' : 'rgba(107, 114, 128, 0.5)'}`
              }}
            >
              <motion.div
                animate={{ x: showModelBadges ? 20 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="absolute top-1 w-4 h-4 rounded-full shadow"
                style={{
                  backgroundColor: showModelBadges ? 'rgb(66, 133, 244)' : 'rgb(107, 114, 128)'
                }}
              />
            </button>
          </div>
        )}

        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close MCP servers panel"
            className="absolute top-3 right-3 p-1 rounded-md transition-colors hover:bg-red-500/20"
            style={{ color: 'var(--color-textMuted)' }}
            title="Close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Servers List */}
      <div className="p-3 max-h-[500px] overflow-y-auto">
        <div className="space-y-2">
          {servers.map((server: any) => {
            const isExpanded = expandedServers.has(server.id);
            const isServerEnabled = serverStates.get(server.id) ?? true;
            const enabledCount = server.tools?.filter((tool: any) =>
              enabledFunctions.has(`${server.id}.${tool.name}`)
            ).length || 0;

            return (
              <div
                key={server.id}
                className="rounded-lg transition-all"
                style={{
                  border: '1px solid var(--color-border)',
                  backgroundColor: isServerEnabled ? 'var(--color-surfaceSecondary)' : 'var(--color-surfaceTertiary)',
                  opacity: isServerEnabled ? 1 : 0.6
                }}
              >
                {/* Server Header */}
                <div
                  className="flex items-center justify-between px-3 py-2 transition-colors cursor-pointer"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div className="flex items-center gap-2 flex-1">
                    {/* Expand/Collapse Arrow */}
                    <button
                      onClick={() => toggleServerExpanded(server.id)}
                      className={clsx(
                        'p-1 rounded hover:bg-theme-bg-secondary transition-colors',
                        !isServerEnabled && 'opacity-50'
                      )}
                      disabled={!server.tools || server.tools.length === 0}
                    >
                      <ChevronRight
                        size={14}
                        className={clsx(
                          'transition-transform',
                          isExpanded && 'rotate-90'
                        )}
                        style={{ color: 'var(--color-textMuted)' }}
                      />
                    </button>

                    {/* Server Icon & Name */}
                    <div className="flex items-center gap-2">
                      {server.icon ? (
                        <span className="text-base">{server.icon}</span>
                      ) : (
                        <Layers size={16} style={{ color: 'var(--color-textMuted)' }} />
                      )}
                      <span
                        className="font-medium"
                        style={{
                          color: isServerEnabled ? 'var(--color-text)' : 'var(--color-textMuted)'
                        }}
                      >
                        {server.name}
                      </span>
                    </div>

                    {/* Status & Count Badges */}
                    <div className="flex items-center gap-2">
                      {server.status && (
                        <span className={clsx(
                          'text-xs px-2 py-0.5 rounded-full',
                          server.status === 'connected' ? (
                            'bg-green-500/20 text-green-500'
                          ) : (
                            'bg-yellow-500/20 text-yellow-500'
                          )
                        )}>
                          {server.status}
                        </span>
                      )}
                      <span className={clsx(
                        'text-xs px-2 py-0.5 rounded-full',
                        'bg-theme-bg-secondary text-theme-text-muted'
                      )}>
                        {enabledCount}/{server.tools?.length || 0} functions
                      </span>
                    </div>
                  </div>

                  {/* Server Toggle Switch */}
                  <button
                    onClick={() => toggleServer(server.id)}
                    role="switch"
                    aria-checked={isServerEnabled}
                    aria-label={`Toggle ${server.name} server`}
                    className={clsx(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors'
                    )}
                    style={{
                      backgroundColor: isServerEnabled ? '#3B82F6' : 'var(--color-textMuted)'
                    }}
                  >
                    <span
                      className={clsx(
                        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
                        isServerEnabled ? 'translate-x-6' : 'translate-x-1'
                      )}
                    />
                  </button>
                </div>

                {/* Expanded Functions List */}
                {isExpanded && server.tools && server.tools.length > 0 && (
                  <div className={clsx(
                    'px-3 pb-3 pt-1',
                    'border-t border-theme-border-secondary'
                  )}>
                    <div className="grid gap-1">
                      {server.tools.map((tool: any) => {
                        const functionKey = `${server.id}.${tool.name}`;
                        const isFunctionEnabled = enabledFunctions.has(functionKey) && isServerEnabled;

                        return (
                          <div
                            key={tool.name}
                            className={clsx(
                              'flex items-start gap-2 px-2 py-1.5 rounded-md transition-colors',
                              isServerEnabled && 'hover:bg-theme-bg-secondary',
                              !isServerEnabled && 'opacity-50'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isFunctionEnabled}
                              onChange={() => toggleFunction(server.id, tool.name)}
                              disabled={!isServerEnabled}
                              className={clsx(
                                'mt-0.5 rounded border-gray-400',
                                'bg-theme-bg-input border-theme-border-primary checked:bg-theme-accent'
                              )}
                            />
                            <div className="flex-1 min-w-0">
                              <div className={clsx(
                                'text-sm font-medium',
                                isFunctionEnabled ? 'text-theme-text-primary' : 'text-theme-text-muted'
                              )}>
                                {tool.name}
                              </div>
                              {tool.description && (
                                <div className={clsx(
                                  'text-xs mt-0.5 leading-relaxed',
                                  'text-theme-text-muted'
                                )}>
                                  {tool.description}
                                </div>
                              )}
                              {tool.inputSchema && (
                                <div className={clsx(
                                  'text-xs mt-1 font-mono',
                                  'text-theme-text-muted opacity-60'
                                )}>
                                  {Object.keys(tool.inputSchema.properties || {}).length} parameters
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Personality Selector Dropdown Component
const PersonalitySelectorDropdown: React.FC<{
  personalities: Personality[];
  activePersonalityId: string | null;
  onSelectPersonality: (id: string | null) => void;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}> = ({ personalities, activePersonalityId, onSelectPersonality, onClose, buttonRef }) => {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        // Position above the button
        const dropdownHeight = Math.min(400, 60 + personalities.length * 70);
        setPosition({
          top: rect.top - dropdownHeight - 8,
          left: Math.max(8, rect.left - 100), // Center roughly
        });
      }
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [buttonRef, personalities.length]);

  return createPortal(
    <div
      className="personality-dropdown min-w-[280px] max-w-[350px] max-h-[400px] rounded-xl overflow-hidden"
      role="listbox"
      aria-label="Available personalities"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 10000,
        backdropFilter: 'blur(16px) saturate(180%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--color-shadow)',
        color: 'var(--color-text)'
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <Smile size={16} style={{ color: 'var(--color-primary)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            AI Personality
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/10"
          style={{ color: 'var(--color-textMuted)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Personalities List */}
      <div className="p-2 max-h-[320px] overflow-y-auto">
        {/* None option */}
        <button
          onClick={() => {
            onSelectPersonality(null);
            onClose();
          }}
          role="option"
          aria-selected={!activePersonalityId}
          className="w-full text-left px-3 py-2.5 rounded-lg transition-colors mb-1"
          style={{
            backgroundColor: !activePersonalityId ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent',
            color: 'var(--color-text)'
          }}
          onMouseEnter={(e) => {
            if (activePersonalityId) {
              e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = !activePersonalityId ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent';
          }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🤖</span>
            <div>
              <div className="font-medium text-sm">Default Mode</div>
              <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                Standard AI assistant
              </div>
            </div>
          </div>
        </button>

        {/* Personality options */}
        {personalities.map((personality) => (
          <button
            key={personality.id}
            onClick={() => {
              onSelectPersonality(personality.id);
              onClose();
            }}
            role="option"
            aria-selected={activePersonalityId === personality.id}
            className="w-full text-left px-3 py-2.5 rounded-lg transition-colors mb-1"
            style={{
              backgroundColor: activePersonalityId === personality.id ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent',
              color: 'var(--color-text)'
            }}
            onMouseEnter={(e) => {
              if (activePersonalityId !== personality.id) {
                e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = activePersonalityId === personality.id ? 'var(--color-primary-alpha-30, color-mix(in srgb, var(--color-primary) 30%, transparent))' : 'transparent';
            }}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">{personality.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  {personality.name}
                  {activePersonalityId === personality.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--color-textMuted)' }}>
                  {personality.description}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 text-xs" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-textMuted)' }}>
        Personalities affect how the AI responds
      </div>
    </div>,
    document.body
  );
};

// Main Toolbar Component Props
interface ChatInputToolbarProps {
  availableMcpFunctions?: any;
  enabledTools?: Set<string>;
  onToggleTool?: (toolName: string) => void;
  availableModels?: Array<{ id: string; name: string; description?: string; type?: string; }>;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  isAdmin: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  disabled?: boolean;
  showMCPIndicators?: boolean;
  onToggleMCPIndicators?: () => void;
  // Model Badges toggle
  showModelBadges?: boolean;
  onToggleModelBadges?: () => void;
  // AgenticWorkCode toggle
  isCodeMode?: boolean;
  onCodeModeToggle?: () => void;
  canUseAwcode?: boolean;
  // User permissions for feature visibility
  flowiseEnabled?: boolean;
  // Thinking mode toggle
  isThinkingEnabled?: boolean;
  onThinkingToggle?: () => void;
  // Thinking budget (admin only)
  thinkingBudget?: number;
  onThinkingBudgetChange?: (budget: number) => void;
  modelSupportsThinking?: boolean;
  // LLM working indicator
  isStreaming?: boolean;
  // File attachments for thumbnail display
  attachments?: AttachmentFile[];
  onAttachmentRemove?: (fileId: string) => void;
  // Multi-model mode (disables model selector when enabled)
  isMultiModelEnabled?: boolean;
  // Personality system
  personalities?: Personality[];
  activePersonalityId?: string | null;
  onSelectPersonality?: (id: string | null) => void;
}

// Main Toolbar Component - Gemini Style
const ChatInputToolbar: React.FC<ChatInputToolbarProps> = ({
  availableMcpFunctions,
  enabledTools,
  onToggleTool,
  availableModels,
  selectedModel,
  onModelChange,
  isAdmin,
  fileInputRef,
  disabled,
  showMCPIndicators = true,
  onToggleMCPIndicators,
  // Model Badges toggle
  showModelBadges = true,
  onToggleModelBadges,
  // AgenticWorkCode toggle
  isCodeMode = false,
  onCodeModeToggle,
  canUseAwcode = false,
  // User permissions for feature visibility
  flowiseEnabled = false,
  // Thinking mode toggle
  isThinkingEnabled = true,
  onThinkingToggle,
  // Thinking budget (admin only)
  thinkingBudget = 8000,
  onThinkingBudgetChange,
  modelSupportsThinking = true,
  // LLM working indicator
  isStreaming = false,
  // File attachments
  attachments = [],
  onAttachmentRemove,
  // Multi-model mode
  isMultiModelEnabled = false,
  // Personality system
  personalities = [],
  activePersonalityId = null,
  onSelectPersonality
}) => {
  // Local state management for dropdowns
  const [showMCPDropdown, setShowMCPDropdown] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showWorkflowViewer, setShowWorkflowViewer] = useState(false);
  const [showPersonalityDropdown, setShowPersonalityDropdown] = useState(false);
  const modelSelectorButtonRef = useRef<HTMLButtonElement>(null);
  const personalityButtonRef = useRef<HTMLButtonElement>(null);

  // Get system config for workflow engine
  const { config: systemConfig } = useSystemConfig();

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;

      // Check if click is outside MCP dropdown
      if (showMCPDropdown) {
        const mcpDropdown = target.closest('.mcp-dropdown-container');
        const mcpButton = target.closest('.mcp-button');
        if (!mcpDropdown && !mcpButton) {
          setShowMCPDropdown(false);
        }
      }

      // Check if click is outside model selector
      if (showModelSelector) {
        const modelDropdown = target.closest('.model-selector-dropdown');
        const modelButton = target.closest('.model-selector-button');
        if (!modelDropdown && !modelButton) {
          setShowModelSelector(false);
        }
      }

      // Check if click is outside personality dropdown
      if (showPersonalityDropdown) {
        const personalityDropdown = target.closest('.personality-dropdown');
        const personalityButton = target.closest('.personality-button');
        if (!personalityDropdown && !personalityButton) {
          setShowPersonalityDropdown(false);
        }
      }
    };

    if (showMCPDropdown || showModelSelector || showPersonalityDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMCPDropdown, showModelSelector, showPersonalityDropdown]);
  return (
    <div className="space-y-2">
      {/* File Attachment Thumbnails - shown above toolbar when files are attached */}
      {attachments && attachments.length > 0 && (
        <FileAttachmentThumbnails
          attachments={attachments}
          onRemove={onAttachmentRemove}
        />
      )}

      {/* Toolbar controls */}
      <div className="flex items-center justify-between">
        {/* Left side - Tools and utilities */}
        <div className="flex items-center gap-3">
          {/* Plus/Attachment Button */}
          <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Add files or images"
          className={clsx(
            'p-2 rounded-lg transition-colors',
            disabled && 'opacity-50 cursor-not-allowed',
            'hover:bg-theme-bg-secondary'
          )}
          style={{ color: 'rgb(var(--text-secondary))' }}
          title="Add files or images"
        >
          <Plus size={18} aria-hidden="true" />
        </motion.button>

        {/* MCP Servers */}
        {availableMcpFunctions?.servers && availableMcpFunctions.servers.length > 0 && (
          <div className="relative">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowMCPDropdown(!showMCPDropdown)}
              aria-label={`MCP Servers (${availableMcpFunctions.servers.length} available)`}
              aria-expanded={showMCPDropdown}
              aria-haspopup="menu"
              className={clsx(
                'mcp-button p-2 rounded-lg transition-colors',
                'hover:bg-blue-500/20',
                showMCPDropdown && 'bg-blue-500/20'
              )}
              style={{ color: showMCPDropdown ? 'rgb(59, 130, 246)' : 'rgb(96, 165, 250)' }}
              title={`MCP Servers (${availableMcpFunctions.servers.length} available)`}
            >
              <PuzzleIcon size={18} strokeWidth={2.5} aria-hidden="true" />
            </motion.button>

            {/* MCP Dropdown */}
            {showMCPDropdown && (
              <div className="mcp-dropdown-container absolute bottom-full mb-2 left-0 z-50">
                <MCPServersDropdown
                  servers={availableMcpFunctions.servers}
                  onToggleServer={onToggleTool}
                  enabledServers={enabledTools}
                  onClose={() => setShowMCPDropdown(false)}
                  showMCPIndicators={showMCPIndicators}
                  onToggleMCPIndicators={onToggleMCPIndicators}
                  showModelBadges={showModelBadges}
                  onToggleModelBadges={onToggleModelBadges}
                  isAdmin={isAdmin}
                />
              </div>
            )}
          </div>
        )}

        {/* Workflow Manager - Flowise */}
        {(flowiseEnabled || isAdmin) && systemConfig.workflowEngine.available && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowWorkflowViewer(true)}
            aria-label={`Open ${systemConfig.workflowEngine.name} Workflow Manager`}
            className="workflow-button p-2 rounded-lg transition-colors hover:bg-blue-500/20"
            style={{ color: 'rgb(100, 181, 246)' }}
            title={`${systemConfig.workflowEngine.name} Workflow Manager`}
          >
            <FlowiseIcon size={18} aria-hidden="true" />
          </motion.button>
        )}

        {/* AgenticWorkCode button removed - use sidebar mode toggle instead (Ctrl+Shift+C) */}

        {/* Thinking Mode Toggle - Brain Emoji */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onThinkingToggle}
          aria-label={isThinkingEnabled ? "Thinking Mode: ON - Click to disable" : "Thinking Mode: OFF - Click to enable"}
          aria-pressed={isThinkingEnabled}
          className={clsx(
            'thinking-toggle-button p-2 rounded-lg transition-all duration-200 relative',
            isThinkingEnabled
              ? 'bg-violet-500/20'
              : 'hover:bg-gray-500/10'
          )}
          title={isThinkingEnabled ? "Thinking Mode: ON - Click to disable" : "Thinking Mode: OFF - Click to enable"}
        >
          {/* Brain emoji with streaming pulse effect */}
          <span
            className={clsx(
              'text-lg transition-all duration-200',
              isThinkingEnabled && 'thinking-glow'
            )}
            style={{
              filter: isThinkingEnabled ? 'brightness(1.2)' : 'grayscale(0.5) brightness(0.8)',
              opacity: isThinkingEnabled ? 1 : 0.6
            }}
          >
            🧠
          </span>

          {/* Streaming indicator - pulsing ring when LLM is working */}
          {isStreaming && (
            <motion.span
              className="absolute inset-0 rounded-lg thinking-pulse-ring"
              animate={{
                boxShadow: [
                  '0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent)',
                  '0 0 0 8px transparent',
                  '0 0 0 0 transparent'
                ]
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeOut'
              }}
            />
          )}

          {/* Small dot indicator for streaming state */}
          {isStreaming && (
            <motion.span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-violet-500"
              animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </motion.button>

        {/* Thinking Budget Slider - Admin only, visible when thinking is enabled */}
        {isAdmin && isThinkingEnabled && modelSupportsThinking && onThinkingBudgetChange && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <label htmlFor="thinking-budget" className="text-xs whitespace-nowrap" style={{ color: 'var(--color-textMuted)' }}>Budget:</label>
            <input
              id="thinking-budget"
              type="range"
              min="0"
              max="32000"
              step="1000"
              value={thinkingBudget}
              onChange={(e) => onThinkingBudgetChange(parseInt(e.target.value))}
              aria-label={`Thinking budget: ${thinkingBudget} tokens`}
              aria-valuemin={0}
              aria-valuemax={32000}
              aria-valuenow={thinkingBudget}
              className="w-16 h-1 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${(thinkingBudget / 32000) * 100}%, color-mix(in srgb, var(--color-primary) 20%, transparent) ${(thinkingBudget / 32000) * 100}%, color-mix(in srgb, var(--color-primary) 20%, transparent) 100%)`
              }}
              title={`Thinking budget: ${thinkingBudget} tokens`}
            />
            <span
              className="text-xs font-mono min-w-[28px] text-right"
              style={{ color: 'var(--color-text)' }}
            >
              {thinkingBudget >= 1000 ? `${(thinkingBudget / 1000).toFixed(0)}K` : thinkingBudget}
            </span>
          </div>
        )}

        {/* Personality Selector - Shows when personalities are available */}
        {personalities && personalities.length > 0 && onSelectPersonality && (
          <div className="relative">
            <motion.button
              ref={personalityButtonRef}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowPersonalityDropdown(!showPersonalityDropdown)}
              aria-label={activePersonalityId
                ? `Active personality: ${personalities.find(p => p.id === activePersonalityId)?.name || 'Unknown'}`
                : 'Select AI Personality'}
              aria-expanded={showPersonalityDropdown}
              aria-haspopup="listbox"
              className={clsx(
                'personality-button flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-200',
                activePersonalityId
                  ? 'bg-amber-500/20 border border-amber-500/30'
                  : 'hover:bg-amber-500/10'
              )}
              title={activePersonalityId
                ? `Personality: ${personalities.find(p => p.id === activePersonalityId)?.name}`
                : 'Select AI Personality'}
            >
              <span className="text-lg">
                {activePersonalityId
                  ? personalities.find(p => p.id === activePersonalityId)?.emoji || '🎭'
                  : '🎭'}
              </span>
              {activePersonalityId && (
                <span className="text-xs font-medium max-w-[80px] truncate" style={{ color: 'rgb(251, 191, 36)' }}>
                  {personalities.find(p => p.id === activePersonalityId)?.name}
                </span>
              )}
              <ChevronDown size={12} style={{ color: activePersonalityId ? 'rgb(251, 191, 36)' : 'var(--color-textMuted)' }} />
            </motion.button>

            {/* Personality Dropdown */}
            {showPersonalityDropdown && (
              <PersonalitySelectorDropdown
                personalities={personalities}
                activePersonalityId={activePersonalityId}
                onSelectPersonality={onSelectPersonality}
                onClose={() => setShowPersonalityDropdown(false)}
                buttonRef={personalityButtonRef}
              />
            )}
          </div>
        )}

      </div>

      {/* Right side - Model selector (Admin only) */}
      <div className="flex items-center gap-2">
        {/* Model Selector - Only visible to admins */}
        {isAdmin && availableModels && availableModels.length > 0 && onModelChange && (
          <div className="relative">
            <motion.button
              ref={modelSelectorButtonRef}
              whileHover={isMultiModelEnabled ? {} : { scale: 1.02 }}
              whileTap={isMultiModelEnabled ? {} : { scale: 0.98 }}
              onClick={() => !isMultiModelEnabled && setShowModelSelector(!showModelSelector)}
              disabled={isMultiModelEnabled}
              aria-label={isMultiModelEnabled ? 'MultiModel Mode Active' : `Select Model: ${selectedModel ? availableModels.find(m => m.id === selectedModel)?.name : 'Default'}`}
              aria-haspopup="listbox"
              aria-expanded={showModelSelector}
              className={clsx(
                'model-selector-button flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors text-sm',
                isMultiModelEnabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-theme-bg-secondary',
                'border border-theme-border-primary'
              )}
              style={{
                color: isMultiModelEnabled ? 'var(--color-textMuted)' : 'rgb(var(--text-secondary))',
                backgroundColor: isMultiModelEnabled ? 'var(--color-surfaceTertiary)' : 'var(--color-surfaceSecondary)'
              }}
              title={isMultiModelEnabled ? 'MultiModel Mode Active - Model selection disabled' : `Select Model: ${selectedModel ? availableModels.find(m => m.id === selectedModel)?.name : 'Default'}`}
            >
              <span className="font-medium">
                {isMultiModelEnabled
                  ? 'MultiModel Mode'
                  : (selectedModel
                    ? availableModels.find(m => m.id === selectedModel)?.name
                    : 'Default')}
              </span>
              {!isMultiModelEnabled && <ChevronDown size={14} />}
              {isMultiModelEnabled ? (
                <span className="ml-1">🔄</span>
              ) : (
                <span className="ml-1">👑</span>
              )}
            </motion.button>
          </div>
        )}
      </div>

      {/* Model Selector Dropdown - Rendered using Portal (only when multi-model is disabled) */}
      {isAdmin && onModelChange && showModelSelector && !isMultiModelEnabled && createPortal(
        <ModelSelectorDropdown
          selectedModel={selectedModel || ''}
          availableModels={availableModels || []}
          onModelChange={onModelChange}
          onClose={() => setShowModelSelector(false)}
          buttonRef={modelSelectorButtonRef}
        />,
        document.body
      )}

      {/* Workflow Viewer - Rendered using Portal for fullscreen overlay */}
      {showWorkflowViewer && createPortal(
        <FlowiseViewer
          isOpen={showWorkflowViewer}
          onClose={() => setShowWorkflowViewer(false)}
        />,
        document.body
      )}
      </div>
    </div>
  );
};

export default ChatInputToolbar;