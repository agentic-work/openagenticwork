/**
 * CodeMode Enhanced Metrics Dashboard
 *
 * Comprehensive real-time metrics for CodeMode/AWCode sessions.
 * Features:
 * - Live WebSocket streaming for system metrics
 * - Per-session detailed metrics (CPU, memory, network I/O, disk I/O, tokens, storage)
 * - System-wide aggregated view
 * - Time-series charts for historical data
 * - Per-user breakdown with cost attribution
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu, HardDrive, Network, Database, Zap, Users, Clock, Activity,
  ArrowUpRight, ArrowDownRight, RefreshCw, Wifi, WifiOff, DollarSign,
  TrendingUp, BarChart3, AlertTriangle, CheckCircle, XCircle, Server,
  FileText, Download, Upload
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

// Types matching the backend
interface EnhancedProcessMetrics {
  cpu: number;
  memory: number;
  memoryMB: number;
  elapsed: number;
  networkRx: number;
  networkTx: number;
  diskReadBytes: number;
  diskWriteBytes: number;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface StorageUsage {
  totalBytes: number;
  fileCount: number;
  largestFile: { path: string; size: number } | null;
}

interface EnhancedSessionMetrics extends EnhancedProcessMetrics {
  tokenUsage: TokenUsage;
  storageUsage: StorageUsage | null;
}

interface SessionWithMetrics {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  status: string;
  model: string;
  workspacePath: string;
  createdAt: string;
  lastActivity: string;
  currentActivity?: string;
  enhancedMetrics: EnhancedSessionMetrics | null;
}

interface SystemMetrics {
  totalSessions: number;
  activeSessions: number;
  totalCpu: number;
  totalMemoryMB: number;
  totalNetworkRx: number;
  totalNetworkTx: number;
  totalDiskRead: number;
  totalDiskWrite: number;
  totalTokens: number;
  totalStorageBytes: number;
  database?: {
    totalTokensRecorded: number;
    totalStorageRecorded: number;
  };
}

interface CodeModeMetricsDashboardProps {
  theme?: string;
}

// Format bytes to human-readable
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format number with commas
const formatNumber = (num: number): string => {
  return num.toLocaleString();
};

// Format currency
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
  }).format(amount);
};

// Metric Card Component
const MetricCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}> = ({ title, value, subtitle, icon, iconBg, trend, trendValue }) => (
  <div className="glass-card p-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`p-3 rounded-xl ${iconBg}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-text-primary">{value}</p>
          <p className="text-sm text-text-secondary">{title}</p>
          {subtitle && <p className="text-xs text-text-tertiary">{subtitle}</p>}
        </div>
      </div>
      {trend && trendValue && (
        <div className={`flex items-center gap-1 text-xs ${
          trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-500'
        }`}>
          {trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {trendValue}
        </div>
      )}
    </div>
  </div>
);

// Live Status Indicator
const LiveIndicator: React.FC<{ connected: boolean }> = ({ connected }) => (
  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
    connected ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'
  }`}>
    {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
    {connected ? 'Live' : 'Disconnected'}
  </div>
);

// Session Row Component
const SessionMetricsRow: React.FC<{
  session: SessionWithMetrics;
  expanded: boolean;
  onToggle: () => void;
}> = ({ session, expanded, onToggle }) => {
  const metrics = session.enhancedMetrics;

  const statusConfig = {
    running: { color: 'text-green-500', bg: 'bg-green-500/20', icon: <CheckCircle size={14} /> },
    idle: { color: 'text-yellow-500', bg: 'bg-yellow-500/20', icon: <Clock size={14} /> },
    stopped: { color: 'text-gray-500', bg: 'bg-gray-500/20', icon: <XCircle size={14} /> },
    error: { color: 'text-red-500', bg: 'bg-red-500/20', icon: <AlertTriangle size={14} /> },
  };

  const config = statusConfig[session.status as keyof typeof statusConfig] || statusConfig.stopped;

  return (
    <div className="border-b border-white/5 last:border-0">
      <div
        className="p-4 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-4"
        onClick={onToggle}
      >
        {/* Status */}
        <div className={`p-1.5 rounded-lg ${config.bg}`}>
          {config.icon}
        </div>

        {/* User & Model */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-text-primary truncate">
            {session.userName || session.userEmail || session.userId}
          </p>
          <p className="text-xs text-text-secondary">{session.model}</p>
        </div>

        {/* CPU */}
        <div className="w-20 text-center">
          <p className="text-sm font-mono text-cyan-400">
            {metrics?.cpu?.toFixed(1) || '0.0'}%
          </p>
          <p className="text-xs text-text-tertiary">CPU</p>
        </div>

        {/* Memory */}
        <div className="w-24 text-center">
          <p className="text-sm font-mono text-purple-400">
            {metrics?.memoryMB?.toFixed(0) || '0'} MB
          </p>
          <p className="text-xs text-text-tertiary">Memory</p>
        </div>

        {/* Network */}
        <div className="w-32 text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-mono">
            <span className="text-green-400 flex items-center gap-1">
              <Download size={10} />
              {formatBytes(metrics?.networkRx || 0)}
            </span>
          </div>
          <p className="text-xs text-text-tertiary">Network In</p>
        </div>

        {/* Tokens */}
        <div className="w-28 text-center">
          <p className="text-sm font-mono text-yellow-400">
            {formatNumber(metrics?.tokenUsage?.totalTokens || 0)}
          </p>
          <p className="text-xs text-text-tertiary">Tokens</p>
        </div>

        {/* Cost */}
        <div className="w-24 text-center">
          <p className="text-sm font-mono text-orange-400">
            {formatCurrency(metrics?.tokenUsage?.estimatedCost || 0)}
          </p>
          <p className="text-xs text-text-tertiary">Cost</p>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && metrics && (
        <div className="px-4 pb-4 grid grid-cols-6 gap-4 bg-white/5">
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Network Out</p>
            <p className="text-sm font-mono text-blue-400 flex items-center gap-1">
              <Upload size={12} />
              {formatBytes(metrics.networkTx)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Disk Read</p>
            <p className="text-sm font-mono text-green-400">
              {formatBytes(metrics.diskReadBytes)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Disk Write</p>
            <p className="text-sm font-mono text-red-400">
              {formatBytes(metrics.diskWriteBytes)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Input Tokens</p>
            <p className="text-sm font-mono text-text-primary">
              {formatNumber(metrics.tokenUsage?.inputTokens || 0)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Output Tokens</p>
            <p className="text-sm font-mono text-text-primary">
              {formatNumber(metrics.tokenUsage?.outputTokens || 0)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-white/5">
            <p className="text-xs text-text-secondary mb-1">Storage</p>
            <p className="text-sm font-mono text-text-primary">
              {metrics.storageUsage ? formatBytes(metrics.storageUsage.totalBytes) : 'N/A'}
            </p>
            {metrics.storageUsage && (
              <p className="text-xs text-text-tertiary">
                {metrics.storageUsage.fileCount} files
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Main Dashboard Component
export const CodeModeMetricsDashboard: React.FC<CodeModeMetricsDashboardProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [sessions, setSessions] = useState<SessionWithMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch enhanced metrics via REST API
  const fetchMetrics = useCallback(async () => {
    try {
      const [systemRes, sessionsRes] = await Promise.all([
        fetch(apiEndpoint('/admin/code/metrics/system'), { headers: getAuthHeaders() }),
        fetch(apiEndpoint('/admin/code/sessions/metrics/enhanced'), { headers: getAuthHeaders() }),
      ]);

      if (systemRes.ok) {
        const systemData = await systemRes.json();
        setSystemMetrics(systemData);
      }

      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json();
        setSessions(sessionsData.sessions || []);
      }

      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Connect to live metrics WebSocket
  const connectWebSocket = useCallback(async () => {
    try {
      // Get WebSocket URL from API
      const response = await fetch(apiEndpoint('/admin/code/metrics/websocket'), {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        console.warn('Could not get metrics WebSocket URL');
        return;
      }

      const { url } = await response.json();
      if (!url) return;

      // Close existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[Metrics WS] Connected');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'system_metrics') {
            setSystemMetrics(data.data);
          }
        } catch (err) {
          console.error('[Metrics WS] Parse error:', err);
        }
      };

      ws.onclose = () => {
        console.log('[Metrics WS] Disconnected');
        setWsConnected(false);
      };

      ws.onerror = (err) => {
        console.error('[Metrics WS] Error:', err);
        setWsConnected(false);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[Metrics WS] Connection error:', err);
    }
  }, [getAuthHeaders]);

  // Initial fetch and WebSocket connection
  useEffect(() => {
    fetchMetrics();
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [fetchMetrics, connectWebSocket]);

  // Auto-refresh sessions (WebSocket only updates system metrics)
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(fetchMetrics, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, [fetchMetrics, autoRefresh]);

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
        <p className="text-text-secondary">Loading enhanced metrics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <BarChart3 size={20} className="text-primary-500" />
            CodeMode Enhanced Metrics
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Real-time resource monitoring with network I/O, disk I/O, token usage, and cost tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator connected={wsConnected} />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-600"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchMetrics}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 transition-colors"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="glass-card p-4 border border-red-500/30 bg-red-500/10">
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle size={18} />
            <span className="font-medium">Error: {error}</span>
          </div>
        </div>
      )}

      {/* System Overview Cards */}
      {systemMetrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          <MetricCard
            title="Active Sessions"
            value={systemMetrics.activeSessions}
            subtitle={`${systemMetrics.totalSessions} total`}
            icon={<Activity size={24} className="text-green-500" />}
            iconBg="bg-green-500/10"
          />
          <MetricCard
            title="Total CPU"
            value={`${systemMetrics.totalCpu.toFixed(1)}%`}
            icon={<Cpu size={24} className="text-cyan-500" />}
            iconBg="bg-cyan-500/10"
          />
          <MetricCard
            title="Total Memory"
            value={`${systemMetrics.totalMemoryMB.toFixed(0)} MB`}
            icon={<Server size={24} className="text-purple-500" />}
            iconBg="bg-purple-500/10"
          />
          <MetricCard
            title="Network I/O"
            value={formatBytes(systemMetrics.totalNetworkRx + systemMetrics.totalNetworkTx)}
            subtitle={`${formatBytes(systemMetrics.totalNetworkRx)} / ${formatBytes(systemMetrics.totalNetworkTx)}`}
            icon={<Network size={24} className="text-blue-500" />}
            iconBg="bg-blue-500/10"
          />
          <MetricCard
            title="Disk I/O"
            value={formatBytes(systemMetrics.totalDiskRead + systemMetrics.totalDiskWrite)}
            subtitle={`R: ${formatBytes(systemMetrics.totalDiskRead)}`}
            icon={<HardDrive size={24} className="text-orange-500" />}
            iconBg="bg-orange-500/10"
          />
          <MetricCard
            title="Total Tokens"
            value={formatNumber(systemMetrics.totalTokens)}
            subtitle={systemMetrics.database ? `DB: ${formatNumber(systemMetrics.database.totalTokensRecorded)}` : undefined}
            icon={<Zap size={24} className="text-yellow-500" />}
            iconBg="bg-yellow-500/10"
          />
        </div>
      )}

      {/* Storage & Cost Summary */}
      {systemMetrics && (
        <div className="grid grid-cols-2 gap-4">
          <div className="glass-card p-6">
            <h3 className="text-base font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Database size={18} className="text-green-500" />
              Storage Usage
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Live Session Storage</span>
                <span className="font-mono text-text-primary">{formatBytes(systemMetrics.totalStorageBytes)}</span>
              </div>
              {systemMetrics.database && (
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Database Recorded</span>
                  <span className="font-mono text-text-primary">
                    {formatBytes(systemMetrics.database.totalStorageRecorded)}
                  </span>
                </div>
              )}
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-500"
                  style={{ width: `${Math.min(100, (systemMetrics.totalStorageBytes / (1024 * 1024 * 1024)) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-text-tertiary">1 GB reference bar</p>
            </div>
          </div>

          <div className="glass-card p-6">
            <h3 className="text-base font-semibold text-text-primary mb-4 flex items-center gap-2">
              <DollarSign size={18} className="text-orange-500" />
              Cost Tracking
            </h3>
            <div className="space-y-4">
              <div className="text-center py-4">
                <p className="text-3xl font-bold text-orange-400">
                  {formatCurrency(
                    sessions.reduce((acc, s) => acc + (s.enhancedMetrics?.tokenUsage?.estimatedCost || 0), 0)
                  )}
                </p>
                <p className="text-sm text-text-secondary mt-1">Estimated Total Cost (Active Sessions)</p>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Sessions with Cost</span>
                <span className="font-mono text-text-primary">
                  {sessions.filter(s => s.enhancedMetrics?.tokenUsage?.estimatedCost).length}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Session Details Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Users size={18} className="text-blue-500" />
            Session Details
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-500">
              {sessions.length} sessions
            </span>
          </h3>
        </div>

        {sessions.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">
            No active sessions with metrics
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {sessions.map((session) => (
              <SessionMetricsRow
                key={session.id}
                session={session}
                expanded={expandedSessions.has(session.id)}
                onToggle={() => toggleSession(session.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* WebSocket Info */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-text-secondary">WebSocket Status:</span>
            <span className={wsConnected ? 'text-green-500' : 'text-gray-500'}>
              {wsConnected ? 'Connected (2s updates)' : 'Disconnected (REST fallback)'}
            </span>
          </div>
          {!wsConnected && (
            <button
              onClick={connectWebSocket}
              className="text-primary-500 hover:text-primary-400 underline"
            >
              Retry Connection
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodeModeMetricsDashboard;
