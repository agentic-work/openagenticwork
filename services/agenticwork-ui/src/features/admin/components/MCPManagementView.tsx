/**
 * MCP Management View - Comprehensive MCP Proxy Management with Tool Testing
 *
 * Features:
 * - Dynamic MCP Server Configuration (JSON-based)
 * - Server Lifecycle Management (Start/Stop/Restart)
 * - Real-time Health Monitoring
 * - Tool Registry & Discovery
 * - **Tool Testing Interface** (like MCP Inspector)
 * - MCP Marketplace/Registry Integration
 * - Redis-backed Configuration Persistence
 */

import React, { useState, useEffect, useCallback } from 'react';
// Basic UI icons from lucide
import {
  Play, Square, Plus, Trash2, Eye, ChevronDown, ChevronRight,
  Code, Send, Copy, Check, Terminal, File, Search
} from '@/shared/icons';
// Custom badass AgenticWork icons
import {
  Server, RotateCw, Activity, CheckCircle, XCircle, AlertCircle,
  Timer as Clock, TrendingUp, Loader2
} from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

interface MCPTool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, {
      type: string;
      description?: string;
      default?: any;
      enum?: string[];
    }>;
    required?: string[];
  };
}

interface MCPServerConfig {
  id: string;
  name: string;
  command: string[];
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  status: 'running' | 'stopped' | 'error' | 'starting' | 'stopping' | 'unknown';
  health?: {
    lastCheck: string;
    uptime: number;
    responseTime: number;
    errors: number;
  };
  tools?: MCPTool[];
  toolCount: number;
  createdAt: string;
  updatedAt: string;
  source?: 'manual' | 'marketplace' | 'npm' | 'pypi';
}

interface ToolTestResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  timestamp: string;
}

interface MCPManagementViewProps {
  theme: string;
}

export const MCPManagementView: React.FC<MCPManagementViewProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<MCPServerConfig | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [configJson, setConfigJson] = useState('');
  const [activeTab, setActiveTab] = useState<'server-management' | 'registry' | 'tools' | 'health' | 'logs'>('server-management');

  // Live MCP server states from proxy health
  interface LiveMCPServer {
    id: string;
    status: 'running' | 'stopped' | 'error';
    enabled: boolean;
    lastError: string | null;
    transport: string;
    pid: number | null;
  }
  const [liveMCPServers, setLiveMCPServers] = useState<Record<string, LiveMCPServer>>({});
  const [liveMCPLoading, setLiveMCPLoading] = useState(false);
  const [enabledStates, setEnabledStates] = useState<Record<string, boolean>>({});
  const [togglingServer, setTogglingServer] = useState<string | null>(null);

  // Tool Testing State
  const [allTools, setAllTools] = useState<Array<MCPTool & { server: string }>>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [selectedTool, setSelectedTool] = useState<(MCPTool & { server: string }) | null>(null);
  const [toolArgs, setToolArgs] = useState<Record<string, any>>({});
  const [testResult, setTestResult] = useState<ToolTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [toolSearchQuery, setToolSearchQuery] = useState('');
  const [copiedResult, setCopiedResult] = useState(false);

  // Load MCP servers from proxy
  const loadServers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint('/admin/mcp/servers'), {
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to load MCP servers: ${response.statusText}`);
      }

      const data = await response.json();
      setServers(data.servers || []);
    } catch (err: any) {
      console.error('Failed to load MCP servers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Load live MCP server status from proxy health endpoint
  const loadLiveMCPServers = useCallback(async () => {
    try {
      setLiveMCPLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint('/admin/mcp/health'), {
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to load MCP health: ${response.statusText}`);
      }

      const data = await response.json();
      const serverStatuses = data.proxy?.servers?.statuses || {};

      // Transform to our format
      const liveServers: Record<string, LiveMCPServer> = {};
      Object.entries(serverStatuses).forEach(([name, info]: [string, any]) => {
        liveServers[name] = {
          id: name,
          status: info.status || 'unknown',
          enabled: info.enabled ?? true,
          lastError: info.last_error || null,
          transport: info.transport || 'stdio',
          pid: info.pid || null
        };
        // Track enabled states
        setEnabledStates(prev => ({ ...prev, [name]: info.enabled ?? true }));
      });

      setLiveMCPServers(liveServers);
    } catch (err: any) {
      console.error('Failed to load live MCP servers:', err);
    } finally {
      setLiveMCPLoading(false);
    }
  }, [getAuthHeaders]);

  // Toggle MCP server enabled/disabled
  const toggleServerEnabled = useCallback(async (serverId: string, enabled: boolean) => {
    try {
      setTogglingServer(serverId);
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint(`/admin/mcp/servers/${serverId}/enabled`), {
        method: 'PATCH',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        throw new Error(`Failed to toggle server: ${response.statusText}`);
      }

      // Update local state immediately
      setEnabledStates(prev => ({ ...prev, [serverId]: enabled }));
      setLiveMCPServers(prev => ({
        ...prev,
        [serverId]: { ...prev[serverId], enabled }
      }));

      // Refresh to get latest state
      await loadLiveMCPServers();
    } catch (err: any) {
      console.error('Failed to toggle server enabled:', err);
      setError(err.message);
    } finally {
      setTogglingServer(null);
    }
  }, [getAuthHeaders, loadLiveMCPServers]);

  // Load all tools from MCP Proxy
  const loadAllTools = useCallback(async () => {
    try {
      setToolsLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint('/admin/mcp/tools-list'), {
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to load tools: ${response.statusText}`);
      }

      const data = await response.json();
      const toolsList = data.tools || [];
      setAllTools(toolsList);
    } catch (err: any) {
      console.error('Failed to load tools:', err);
      // Don't set error for tools - just log it
    } finally {
      setToolsLoading(false);
    }
  }, [getAuthHeaders]);

  // Server lifecycle actions
  const handleServerAction = useCallback(async (serverId: string, action: 'start' | 'stop' | 'restart') => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint(`/admin/mcp/servers/${serverId}/${action}`), {
        method: 'POST',
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} server: ${response.statusText}`);
      }

      await loadServers();
    } catch (err: any) {
      console.error(`Failed to ${action} server:`, err);
      setError(err.message);
    }
  }, [getAuthHeaders, loadServers]);

  // Add new MCP server from JSON config
  const handleAddServer = useCallback(async () => {
    try {
      const config = JSON.parse(configJson);
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint('/admin/mcp/servers'), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        throw new Error(`Failed to add server: ${response.statusText}`);
      }

      setShowAddModal(false);
      setConfigJson('');
      await loadServers();
    } catch (err: any) {
      console.error('Failed to add server:', err);
      setError(err.message);
    }
  }, [configJson, getAuthHeaders, loadServers]);

  // Delete MCP server
  const handleDeleteServer = useCallback(async (serverId: string) => {
    if (!confirm('Are you sure you want to delete this MCP server? This action cannot be undone.')) {
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint(`/admin/mcp/servers/${serverId}`), {
        method: 'DELETE',
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to delete server: ${response.statusText}`);
      }

      await loadServers();
    } catch (err: any) {
      console.error('Failed to delete server:', err);
      setError(err.message);
    }
  }, [getAuthHeaders, loadServers]);

  // Test a tool with given arguments
  const handleTestTool = useCallback(async () => {
    if (!selectedTool) return;

    setTestLoading(true);
    setTestResult(null);
    const startTime = Date.now();

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint('/mcp'), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          method: 'tools/call',
          params: {
            name: selectedTool.name,
            arguments: toolArgs
          },
          server: selectedTool.server,
          id: `test-${Date.now()}`
        })
      });

      const executionTime = Date.now() - startTime;
      const data = await response.json();

      if (data.error) {
        setTestResult({
          success: false,
          error: data.error.message || JSON.stringify(data.error),
          executionTime,
          timestamp: new Date().toISOString()
        });
      } else {
        setTestResult({
          success: true,
          result: data.result,
          executionTime,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err: any) {
      const executionTime = Date.now() - startTime;
      setTestResult({
        success: false,
        error: err.message,
        executionTime,
        timestamp: new Date().toISOString()
      });
    } finally {
      setTestLoading(false);
    }
  }, [selectedTool, toolArgs, getAuthHeaders]);

  // Initialize tool arguments when selecting a tool
  const selectTool = useCallback((tool: MCPTool & { server: string }) => {
    setSelectedTool(tool);
    setTestResult(null);

    // Initialize arguments with defaults
    const initialArgs: Record<string, any> = {};
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        if (prop.default !== undefined) {
          initialArgs[key] = prop.default;
        } else if (prop.type === 'string') {
          initialArgs[key] = '';
        } else if (prop.type === 'number' || prop.type === 'integer') {
          initialArgs[key] = 0;
        } else if (prop.type === 'boolean') {
          initialArgs[key] = false;
        } else if (prop.type === 'array') {
          initialArgs[key] = [];
        } else if (prop.type === 'object') {
          initialArgs[key] = {};
        }
      });
    }
    setToolArgs(initialArgs);
  }, []);

  // Copy result to clipboard
  const copyResultToClipboard = useCallback(() => {
    if (testResult) {
      navigator.clipboard.writeText(JSON.stringify(testResult.result || testResult.error, null, 2));
      setCopiedResult(true);
      setTimeout(() => setCopiedResult(false), 2000);
    }
  }, [testResult]);

  // Load servers, tools, and live status on mount
  useEffect(() => {
    loadServers();
    loadAllTools();
    loadLiveMCPServers();
  }, [loadServers, loadAllTools, loadLiveMCPServers]);

  const isDark = theme === 'dark';

  // Group tools by server
  const toolsByServer = allTools.reduce((acc, tool) => {
    if (!acc[tool.server]) {
      acc[tool.server] = [];
    }
    acc[tool.server].push(tool);
    return acc;
  }, {} as Record<string, Array<MCPTool & { server: string }>>);

  // Filter tools by search query
  const filteredToolsByServer = Object.entries(toolsByServer).reduce((acc, [server, tools]) => {
    const filtered = tools.filter(tool =>
      tool.name.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
      tool.description?.toLowerCase().includes(toolSearchQuery.toLowerCase())
    );
    if (filtered.length > 0) {
      acc[server] = filtered;
    }
    return acc;
  }, {} as Record<string, Array<MCPTool & { server: string }>>);

  // Toggle server expansion in tools list
  const toggleServerExpanded = (serverId: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverId)) {
      newExpanded.delete(serverId);
    } else {
      newExpanded.add(serverId);
    }
    setExpandedServers(newExpanded);
  };

  // Status badge component
  const StatusBadge: React.FC<{ status: MCPServerConfig['status'] }> = ({ status }) => {
    const statusConfig = {
      running: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Running' },
      stopped: { icon: Square, color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Stopped' },
      error: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Error' },
      starting: { icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Starting' },
      stopping: { icon: Activity, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Stopping' },
      unknown: { icon: AlertCircle, color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Unknown' }
    };

    const config = statusConfig[status] || statusConfig.unknown;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  };

  // Server card component
  const ServerCard: React.FC<{ server: MCPServerConfig }> = ({ server }) => (
    <div className="p-4 rounded-lg border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <Server className="w-5 h-5" style={{ color: 'var(--color-textMuted)' }} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {server.name}
            </h3>
            <StatusBadge status={server.status} />
          </div>
          <p className="text-sm mb-2" style={{ color: 'var(--color-textSecondary)' }}>
            ID: <code className="text-xs">{server.id}</code>
          </p>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5" style={{ color: 'var(--color-textSecondary)' }}>
              <Code className="w-4 h-4" />
              {server.toolCount} tools
            </span>
            {server.health && (
              <>
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-textSecondary)' }}>
                  <Clock className="w-4 h-4" />
                  {Math.floor(server.health.uptime / 60)}m uptime
                </span>
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-textSecondary)' }}>
                  <TrendingUp className="w-4 h-4" />
                  {server.health.responseTime}ms
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {server.status === 'running' ? (
            <>
              <button
                onClick={() => handleServerAction(server.id, 'restart')}
                className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-600 hover:text-blue-600'}`}
                title="Restart"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleServerAction(server.id, 'stop')}
                className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400 hover:text-orange-400' : 'hover:bg-gray-100 text-gray-600 hover:text-orange-600'}`}
                title="Stop"
              >
                <Square className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={() => handleServerAction(server.id, 'start')}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400 hover:text-green-400' : 'hover:bg-gray-100 text-gray-600 hover:text-green-600'}`}
              title="Start"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setSelectedServer(server)}
            className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400 hover:text-blue-400' : 'hover:bg-gray-100 text-gray-600 hover:text-blue-600'}`}
            title="View Details"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleDeleteServer(server.id)}
            className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-gray-700 text-gray-400 hover:text-red-400' : 'hover:bg-gray-100 text-gray-600 hover:text-red-600'}`}
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Server command display */}
      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-xs mb-1" style={{ color: 'var(--color-textMuted)' }}>Command:</p>
        <code className="block text-xs p-2 rounded" style={{ color: 'var(--color-textSecondary)', background: 'var(--color-surfaceSecondary)' }}>
          {server.command.join(' ')} {server.args?.join(' ')}
        </code>
      </div>
    </div>
  );

  // Tool Testing Panel
  const ToolTestingPanel = () => (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-300px)] min-h-[500px]">
      {/* Tools List - Left Panel */}
      <div className="col-span-4 rounded-lg border flex flex-col" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="p-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Terminal className={`w-4 h-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} />
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Available Tools
            </h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-600'}`}>
              {allTools.length}
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-textMuted)' }} />
            <input
              type="text"
              placeholder="Search tools..."
              value={toolSearchQuery}
              onChange={(e) => setToolSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border"
              style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {toolsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className={`w-6 h-6 animate-spin ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
            </div>
          ) : Object.keys(filteredToolsByServer).length === 0 ? (
            <div className={`text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No tools found</p>
            </div>
          ) : (
            Object.entries(filteredToolsByServer).map(([server, tools]) => (
              <div key={server} className="mb-2">
                <button
                  onClick={() => toggleServerExpanded(server)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left ${
                    isDark ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100'
                  }`}
                >
                  {expandedServers.has(server) ? (
                    <ChevronDown className={`w-4 h-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} />
                  ) : (
                    <ChevronRight className={`w-4 h-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} />
                  )}
                  <Server className={`w-3.5 h-3.5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                  <span className={`text-sm font-medium flex-1 ${isDark ? 'text-gray-300' : 'text-gray-800'}`}>
                    {server}
                  </span>
                  <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                    {tools.length}
                  </span>
                </button>

                {expandedServers.has(server) && (
                  <div className="ml-4 mt-1 space-y-1">
                    {tools.map((tool) => (
                      <button
                        key={`${server}-${tool.name}`}
                        onClick={() => selectTool(tool)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          selectedTool?.name === tool.name && selectedTool?.server === server
                            ? isDark
                              ? 'bg-blue-600/20 border border-blue-500/30 text-blue-400'
                              : 'bg-blue-50 border border-blue-200 text-blue-700'
                            : isDark
                              ? 'hover:bg-gray-700/50 text-gray-300'
                              : 'hover:bg-gray-100 text-gray-700'
                        }`}
                      >
                        <div className="font-medium truncate">{tool.name}</div>
                        {tool.description && (
                          <div className={`text-xs truncate mt-0.5 ${
                            selectedTool?.name === tool.name && selectedTool?.server === server
                              ? isDark ? 'text-blue-400/70' : 'text-blue-600/70'
                              : isDark ? 'text-gray-500' : 'text-gray-600'
                          }`}>
                            {tool.description}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tool Details & Testing - Right Panel */}
      <div className="col-span-8 rounded-lg border flex flex-col" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {!selectedTool ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-textMuted)' }}>
            <div className="text-center">
              <File className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Select a tool to test</p>
              <p className="text-sm mt-1">Choose a tool from the list to see its parameters and test it</p>
            </div>
          </div>
        ) : (
          <>
            {/* Tool Header */}
            <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                    {selectedTool.name}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-textSecondary)' }}>
                    {selectedTool.description}
                  </p>
                  <p className="text-xs mt-2" style={{ color: 'var(--color-textMuted)' }}>
                    Server: <code className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surfaceTertiary)' }}>{selectedTool.server}</code>
                  </p>
                </div>
                <button
                  onClick={handleTestTool}
                  disabled={testLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                >
                  {testLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Execute
                </button>
              </div>
            </div>

            {/* Parameters & Result */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Input Parameters */}
              {selectedTool.inputSchema?.properties && Object.keys(selectedTool.inputSchema.properties).length > 0 ? (
                <div>
                  <h4 className={`text-sm font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    Input Parameters
                  </h4>
                  <div className="space-y-3">
                    {Object.entries(selectedTool.inputSchema.properties).map(([key, prop]) => {
                      const isRequired = selectedTool.inputSchema?.required?.includes(key);
                      return (
                        <div key={key}>
                          <label className={`block text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                            <span className="font-medium">{key}</span>
                            {isRequired && <span className="text-red-500 ml-1">*</span>}
                            <span className={`ml-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              ({prop.type})
                            </span>
                          </label>
                          {prop.description && (
                            <p className={`text-xs mb-1.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              {prop.description}
                            </p>
                          )}
                          {prop.enum ? (
                            <select
                              value={toolArgs[key] || ''}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: e.target.value })}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-gray-900 border-gray-700 text-gray-300'
                                  : 'bg-white border-gray-300 text-gray-900'
                              }`}
                            >
                              <option value="">Select...</option>
                              {prop.enum.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : prop.type === 'boolean' ? (
                            <select
                              value={String(toolArgs[key] || false)}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: e.target.value === 'true' })}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-gray-900 border-gray-700 text-gray-300'
                                  : 'bg-white border-gray-300 text-gray-900'
                              }`}
                            >
                              <option value="false">false</option>
                              <option value="true">true</option>
                            </select>
                          ) : prop.type === 'number' || prop.type === 'integer' ? (
                            <input
                              type="number"
                              value={toolArgs[key] || 0}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: Number(e.target.value) })}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-gray-900 border-gray-700 text-gray-300'
                                  : 'bg-white border-gray-300 text-gray-900'
                              }`}
                            />
                          ) : prop.type === 'object' || prop.type === 'array' ? (
                            <textarea
                              value={typeof toolArgs[key] === 'object' ? JSON.stringify(toolArgs[key], null, 2) : toolArgs[key] || ''}
                              onChange={(e) => {
                                try {
                                  setToolArgs({ ...toolArgs, [key]: JSON.parse(e.target.value) });
                                } catch {
                                  setToolArgs({ ...toolArgs, [key]: e.target.value });
                                }
                              }}
                              rows={3}
                              placeholder={prop.type === 'array' ? '[]' : '{}'}
                              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${
                                isDark
                                  ? 'bg-gray-900 border-gray-700 text-gray-300'
                                  : 'bg-white border-gray-300 text-gray-900'
                              }`}
                            />
                          ) : (
                            <input
                              type="text"
                              value={toolArgs[key] || ''}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: e.target.value })}
                              placeholder={prop.default !== undefined ? String(prop.default) : ''}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-gray-900 border-gray-700 text-gray-300'
                                  : 'bg-white border-gray-300 text-gray-900'
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                  <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    This tool has no input parameters
                  </p>
                </div>
              )}

              {/* Result Display */}
              {testResult && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      Result
                    </h4>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {testResult.executionTime}ms
                      </span>
                      <button
                        onClick={copyResultToClipboard}
                        className={`p-1.5 rounded transition-colors ${
                          isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
                        }`}
                        title="Copy to clipboard"
                      >
                        {copiedResult ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className={`rounded-lg overflow-hidden border ${
                    testResult.success
                      ? isDark ? 'border-green-500/30' : 'border-green-200'
                      : isDark ? 'border-red-500/30' : 'border-red-200'
                  }`}>
                    <div className={`px-3 py-2 text-xs font-medium ${
                      testResult.success
                        ? isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700'
                        : isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700'
                    }`}>
                      {testResult.success ? '✓ Success' : '✗ Error'}
                    </div>
                    <pre className={`p-3 text-sm font-mono overflow-x-auto max-h-64 ${
                      isDark ? 'bg-gray-900 text-gray-300' : 'bg-gray-50 text-gray-800'
                    }`}>
                      {JSON.stringify(testResult.success ? testResult.result : testResult.error, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Server Management Panel - Live MCP status with enable/disable toggles
  const ServerManagementPanel = () => {
    const serverEntries = Object.entries(liveMCPServers);
    const runningCount = serverEntries.filter(([, s]) => s.status === 'running').length;
    const enabledCount = serverEntries.filter(([, s]) => s.enabled).length;

    return (
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-800/50' : 'bg-gray-50'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Total MCPs</p>
            <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {serverEntries.length}
            </p>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-800/50' : 'bg-gray-50'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Running</p>
            <p className="text-2xl font-bold text-green-500">{runningCount}</p>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-800/50' : 'bg-gray-50'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Enabled</p>
            <p className="text-2xl font-bold text-blue-500">{enabledCount}</p>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-800/50' : 'bg-gray-50'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Total Tools</p>
            <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {allTools.length}
            </p>
          </div>
        </div>

        {/* Server List with Enable/Disable Toggles */}
        <div className={`rounded-lg border ${isDark ? 'bg-gray-800/30' : 'bg-white'} overflow-hidden`} style={{ borderColor: 'var(--color-border)' }}>
          <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Live MCP Servers
            </h3>
            <button
              onClick={loadLiveMCPServers}
              className={`p-2 rounded-lg transition-colors ${
                isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-600'
              }`}
              title="Refresh"
            >
              <RotateCw className={`w-4 h-4 ${liveMCPLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {liveMCPLoading && serverEntries.length === 0 ? (
            <div className="p-8 text-center">
              <Loader2 className={`w-8 h-8 animate-spin mx-auto mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} />
              <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Loading MCP servers...</p>
            </div>
          ) : serverEntries.length === 0 ? (
            <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No MCP servers found</p>
              <p className="text-sm mt-1">Check MCP proxy connection</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {serverEntries.map(([serverName, server]) => {
                const isEnabled = enabledStates[serverName] ?? server.enabled;
                const isToggling = togglingServer === serverName;
                const toolCount = allTools.filter(t => t.server === serverName).length;

                return (
                  <div
                    key={serverName}
                    className={`p-4 flex items-center justify-between transition-colors ${
                      isDark ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Status Indicator */}
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                        server.status === 'running' && isEnabled
                          ? 'bg-green-500'
                          : server.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-gray-500'
                      }`} />

                      <div>
                        <div className="flex items-center gap-2">
                          <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {serverName.replace(/_/g, ' ').replace(/awp /i, '')}
                          </p>
                          <code className={`text-xs px-1.5 py-0.5 rounded ${
                            isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-600'
                          }`}>
                            {serverName}
                          </code>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {server.transport}
                          </span>
                          {server.pid && (
                            <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              PID: {server.pid}
                            </span>
                          )}
                          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {toolCount} tools
                          </span>
                        </div>
                        {server.lastError && (
                          <p className="text-xs text-red-500 mt-1 truncate max-w-md">
                            {server.lastError}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Status Badge */}
                      <StatusBadge status={server.status} />

                      {/* Enable/Disable Toggle */}
                      <button
                        onClick={() => toggleServerEnabled(serverName, !isEnabled)}
                        disabled={isToggling}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          isEnabled ? 'bg-blue-600' : isDark ? 'bg-gray-600' : 'bg-gray-300'
                        } ${isToggling ? 'opacity-50 cursor-wait' : ''}`}
                        role="switch"
                        aria-checked={isEnabled}
                        title={isEnabled ? 'Click to disable' : 'Click to enable'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        >
                          {isToggling && (
                            <Loader2 className="w-3 h-3 animate-spin absolute top-1 left-1 text-gray-400" />
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className={`p-4 rounded-lg ${isDark ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50 border-blue-200'} border`}>
          <div className="flex items-start gap-3">
            <AlertCircle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            <div>
              <p className={`text-sm font-medium ${isDark ? 'text-blue-300' : 'text-blue-800'}`}>
                Runtime MCP Control
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-blue-400/80' : 'text-blue-700'}`}>
                Changes are persisted to Redis and will survive restarts. Disabling an MCP server prevents it from being used for tool calls globally across all users.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Server Logs Panel - Live log streaming with search and filter
  const ServerLogsPanel = ({
    servers: serverList,
    isDark: darkMode,
    getAuthHeaders: authHeadersFn
  }: {
    servers: MCPServerConfig[];
    isDark: boolean;
    getAuthHeaders: () => Promise<Record<string, string>>;
  }) => {
    const [logs, setLogs] = React.useState<Array<{ timestamp: string; server: string; level: string; message: string }>>([]);
    const [selectedLogServer, setSelectedLogServer] = React.useState<string>('all');
    const [logSearch, setLogSearch] = React.useState('');
    const [autoScroll, setAutoScroll] = React.useState(true);
    const [isStreaming, setIsStreaming] = React.useState(false);
    const [logLevel, setLogLevel] = React.useState<string>('all');
    const logsEndRef = React.useRef<HTMLDivElement>(null);
    const eventSourceRef = React.useRef<EventSource | null>(null);

    // Scroll to bottom when new logs arrive
    React.useEffect(() => {
      if (autoScroll && logsEndRef.current) {
        logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, [logs, autoScroll]);

    // Start log streaming
    const startStreaming = React.useCallback(async () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      try {
        const headers = await authHeadersFn();
        const token = headers['Authorization']?.replace('Bearer ', '') || '';

        const url = new URL(apiEndpoint('/admin/mcp/logs/stream'));
        url.searchParams.set('token', token);
        if (selectedLogServer !== 'all') {
          url.searchParams.set('server', selectedLogServer);
        }

        const eventSource = new EventSource(url.toString());
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsStreaming(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const logEntry = JSON.parse(event.data);
            setLogs(prev => [...prev.slice(-500), logEntry]); // Keep last 500 logs
          } catch (e) {
            // Raw log line
            setLogs(prev => [...prev.slice(-500), {
              timestamp: new Date().toISOString(),
              server: 'mcp-proxy',
              level: 'info',
              message: event.data
            }]);
          }
        };

        eventSource.onerror = () => {
          setIsStreaming(false);
          eventSource.close();
        };
      } catch (error) {
        console.error('Failed to start log streaming:', error);
        setIsStreaming(false);
      }
    }, [authHeadersFn, selectedLogServer]);

    // Fetch recent logs on mount or server change
    React.useEffect(() => {
      const fetchLogs = async () => {
        try {
          const headers = await authHeadersFn();
          const url = selectedLogServer === 'all'
            ? apiEndpoint('/admin/mcp/logs?lines=200')
            : apiEndpoint(`/admin/mcp/logs?lines=200&server=${selectedLogServer}`);

          const response = await fetch(url, { headers, credentials: 'include' });
          if (response.ok) {
            const data = await response.json();
            setLogs(data.logs || []);
          }
        } catch (error) {
          console.error('Failed to fetch logs:', error);
        }
      };

      fetchLogs();
    }, [authHeadersFn, selectedLogServer]);

    // Cleanup on unmount
    React.useEffect(() => {
      return () => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
      };
    }, []);

    // Filter logs
    const filteredLogs = logs.filter(log => {
      const matchesSearch = logSearch === '' ||
        log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.server.toLowerCase().includes(logSearch.toLowerCase());
      const matchesLevel = logLevel === 'all' || log.level === logLevel;
      return matchesSearch && matchesLevel;
    });

    const getLevelColor = (level: string) => {
      switch (level.toLowerCase()) {
        case 'error': return 'text-red-500';
        case 'warn': case 'warning': return 'text-yellow-500';
        case 'info': return 'text-blue-400';
        case 'debug': return 'text-gray-500';
        default: return darkMode ? 'text-gray-300' : 'text-gray-600';
      }
    };

    return (
      <div className="rounded-lg border flex flex-col h-[calc(100vh-300px)] min-h-[500px]" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {/* Controls */}
        <div className="p-4 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
          {/* Server Filter */}
          <select
            value={selectedLogServer}
            onChange={(e) => setSelectedLogServer(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm ${
              darkMode
                ? 'bg-gray-900 border-gray-700 text-gray-300'
                : 'bg-gray-50 border-gray-200 text-gray-900'
            } border`}
          >
            <option value="all">All Servers</option>
            <option value="mcp-proxy">MCP Proxy</option>
            {serverList.map(server => (
              <option key={server.id} value={server.name}>{server.name}</option>
            ))}
          </select>

          {/* Level Filter */}
          <select
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm ${
              darkMode
                ? 'bg-gray-900 border-gray-700 text-gray-300'
                : 'bg-gray-50 border-gray-200 text-gray-900'
            } border`}
          >
            <option value="all">All Levels</option>
            <option value="error">Error</option>
            <option value="warn">Warning</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>

          {/* Search */}
          <div className="flex-1 relative min-w-[200px]">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <input
              type="text"
              placeholder="Search logs..."
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg ${
                darkMode
                  ? 'bg-gray-900 border-gray-700 text-gray-300 placeholder-gray-500'
                  : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
              } border`}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => isStreaming ? eventSourceRef.current?.close() : startStreaming()}
              className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                isStreaming
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {isStreaming ? (
                <>
                  <Square className="w-4 h-4" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Stream
                </>
              )}
            </button>

            <button
              onClick={() => setLogs([])}
              className={`px-3 py-2 rounded-lg text-sm ${
                darkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
              }`}
            >
              Clear
            </button>

            <label className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${
              darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
            }`}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded"
              />
              <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-4 py-2 border-b flex items-center gap-4 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-green-500 animate-pulse' : ''}`} style={!isStreaming ? { background: 'var(--color-textMuted)' } : {}} />
            <span style={{ color: 'var(--color-textSecondary)' }}>
              {isStreaming ? 'Streaming live logs...' : 'Not streaming'}
            </span>
          </div>
          <span style={{ color: 'var(--color-textMuted)' }}>
            {filteredLogs.length} entries
          </span>
        </div>

        {/* Logs Display */}
        <div className="flex-1 overflow-y-auto font-mono text-xs" style={{ background: 'var(--color-surfaceSecondary)' }}>
          {filteredLogs.length === 0 ? (
            <div className={`flex items-center justify-center h-full ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              <div className="text-center">
                <Terminal className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No logs to display</p>
                <p className="text-sm mt-1">Click "Stream" to start receiving live logs</p>
              </div>
            </div>
          ) : (
            <div className="p-2">
              {filteredLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`py-1 px-2 hover:${darkMode ? 'bg-gray-800' : 'bg-gray-100'} rounded flex gap-3 items-start`}
                >
                  <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`uppercase font-bold w-12 ${getLevelColor(log.level)}`}>
                    {log.level.substring(0, 4)}
                  </span>
                  <span className={`${darkMode ? 'text-cyan-400' : 'text-cyan-600'} w-24 truncate`}>
                    [{log.server}]
                  </span>
                  <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            MCP Server Management
          </h2>
          <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Manage Model Context Protocol servers and test tools
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { loadServers(); loadAllTools(); }}
            className={`p-2 rounded-lg transition-colors ${
              isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-600'
            }`}
            title="Refresh"
          >
            <RotateCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Server
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className={`flex gap-2 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
        <button
          onClick={() => setActiveTab('server-management')}
          className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'server-management'
              ? 'border-b-2 border-blue-500 text-blue-500'
              : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Server className="w-4 h-4" />
          Server Management
        </button>
        <button
          onClick={() => setActiveTab('registry')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'registry'
              ? 'border-b-2 border-blue-500 text-blue-500'
              : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Registry
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'tools'
              ? 'border-b-2 border-blue-500 text-blue-500'
              : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Tool Testing
        </button>
        <button
          onClick={() => setActiveTab('health')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'health'
              ? 'border-b-2 border-blue-500 text-blue-500'
              : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Health
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'logs'
              ? 'border-b-2 border-blue-500 text-blue-500'
              : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Terminal className="w-4 h-4" />
          Server Logs
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-500 font-medium">Error</p>
            <p className={`text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
          </div>
        </div>
      )}

      {/* Server Management Tab - Live status with enable/disable */}
      {activeTab === 'server-management' && <ServerManagementPanel />}

      {/* Registry Tab - Static configuration */}
      {activeTab === 'registry' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <Activity className={`w-8 h-8 animate-spin mx-auto mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} />
              <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>Loading MCP servers...</p>
            </div>
          ) : servers.length === 0 ? (
            <div className={`text-center py-12 rounded-lg border ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
              <Server className={`w-12 h-12 mx-auto mb-4 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
              <p className={`text-lg font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                No MCP servers configured
              </p>
              <p className={`text-sm mb-4 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
                Add your first MCP server to get started
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add MCP Server
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {servers.map(server => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tools Testing Tab */}
      {activeTab === 'tools' && <ToolTestingPanel />}

      {/* Health Monitoring Tab */}
      {activeTab === 'health' && (
        <div className="space-y-4">
          {/* System Health Overview */}
          <div className={`p-6 rounded-lg border ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'}`}>
            <h3 className={`text-lg font-semibold mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <Activity className="w-5 h-5 text-blue-500" />
              System Health Overview
            </h3>
            <div className="grid grid-cols-4 gap-4">
              <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Total Servers</p>
                <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {servers.length}
                </p>
              </div>
              <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Running</p>
                <p className="text-2xl font-bold text-green-500">
                  {servers.filter(s => s.status === 'running').length}
                </p>
              </div>
              <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Stopped/Error</p>
                <p className="text-2xl font-bold text-orange-500">
                  {servers.filter(s => s.status !== 'running').length}
                </p>
              </div>
              <div className={`p-4 rounded-lg ${isDark ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Total Tools</p>
                <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {allTools.length}
                </p>
              </div>
            </div>
          </div>

          {/* Per-Server Health */}
          <div className={`rounded-lg border ${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'} overflow-hidden`}>
            <div className="p-4 border-b border-gray-700">
              <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Server Health Status
              </h3>
            </div>
            <div className="divide-y divide-gray-700">
              {servers.length === 0 ? (
                <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No servers configured</p>
                </div>
              ) : (
                servers.map(server => (
                  <div key={server.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${
                        server.status === 'running' ? 'bg-green-500' :
                        server.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                      }`} />
                      <div>
                        <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {server.name}
                        </p>
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {server.id}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Tools</p>
                        <p className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {server.toolCount}
                        </p>
                      </div>
                      {server.health && (
                        <>
                          <div className="text-center">
                            <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Uptime</p>
                            <p className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                              {Math.floor(server.health.uptime / 60)}m
                            </p>
                          </div>
                          <div className="text-center">
                            <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Response</p>
                            <p className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                              {server.health.responseTime}ms
                            </p>
                          </div>
                          <div className="text-center">
                            <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Errors</p>
                            <p className={`font-medium ${server.health.errors > 0 ? 'text-red-500' : 'text-green-500'}`}>
                              {server.health.errors}
                            </p>
                          </div>
                        </>
                      )}
                      <StatusBadge status={server.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Server Logs Tab */}
      {activeTab === 'logs' && <ServerLogsPanel servers={servers} isDark={isDark} getAuthHeaders={getAuthHeaders} />}

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-2xl rounded-lg shadow-xl" style={{ background: 'var(--color-surface)' }}>
            <div className="p-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
                Add MCP Server
              </h3>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                Configure a new MCP server using JSON configuration
              </p>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>
                Server Configuration (JSON)
              </label>
              <textarea
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
                placeholder={`{
  "name": "my-mcp-server",
  "command": ["node", "/path/to/server.js"],
  "env": {
    "API_KEY": "your-api-key"
  },
  "enabled": true
}`}
                rows={12}
                className="w-full px-3 py-2 rounded-lg border font-mono text-sm"
                style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div className="p-6 border-t flex justify-end gap-3" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setConfigJson('');
                }}
                className="px-4 py-2 rounded-lg transition-colors"
                style={{ background: 'var(--color-surfaceTertiary)', color: 'var(--color-text)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddServer}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Add Server
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Server Details Modal */}
      {selectedServer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-4xl rounded-lg shadow-xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)' }}>
            <div className="p-6 border-b flex items-start justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
                  {selectedServer.name}
                </h3>
                <p className="mt-1 text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                  Server Details
                </p>
              </div>
              <button
                onClick={() => setSelectedServer(null)}
                className="p-2 rounded-lg transition-colors hover:opacity-80"
                style={{ background: 'var(--color-surfaceTertiary)' }}
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>
                  Tools ({selectedServer.toolCount})
                </h4>
                <div className="space-y-2">
                  {selectedServer.tools?.map((tool, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--color-surfaceSecondary)' }}
                    >
                      <p className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
                        {tool.name}
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-textSecondary)' }}>
                        {tool.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
