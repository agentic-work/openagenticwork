import React, { useState, useEffect } from 'react';
// Basic UI icons from lucide
import {
  Search, Filter, ChevronDown, ChevronRight, Eye, Download,
  Calendar, FileText
} from '@/shared/icons';
// Custom badass AgenticWork icons
import {
  Shield, CheckCircle, XCircle, Timer as Clock, RefreshCw, User,
  Activity, AlertTriangle, Database, Lock
} from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

interface SessionLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  summary?: string;
  messageCount: number;
  userQueries: number;
  aiResponses: number;
  firstQuery: string;
  model: string;
  totalTokens: number | string | null;
  totalCost: number | string | null;
  mcpCallsCount: number;
  toolExecutionsCount: number;
  conversation: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  tokens?: number | string | null;
  cost?: number | string | null;
  hasMcpCalls: boolean;
  hasToolCalls: boolean;
  timestamp: string;
}

interface AuditLogsStats {
  admin: {
    totalActions: number;
    recent24h: number;
    recent7d: number;
    topActions: Array<{
      action: string;
      count: number;
    }>;
  };
  user: {
    totalQueries: number;
    recent24h: number;
    recent7d: number;
    failedQueries24h: number;
    topUsers: Array<{
      userId: string;
      userName: string;
      userEmail: string;
      count: number;
    }>;
  };
}

interface AuditLogsViewProps {
  theme: string;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [stats, setStats] = useState<AuditLogsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  // SOC2 Compliance: Enhanced filters and search
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [dateRange, setDateRange] = useState<string>('7d');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterUserEmail, setFilterUserEmail] = useState('');
  const [filterActionType, setFilterActionType] = useState('');
  const [filterResourceType, setFilterResourceType] = useState('');
  const [filterIpAddress, setFilterIpAddress] = useState('');
  const [filterSuccess, setFilterSuccess] = useState('');
  const [logType, setLogType] = useState<'all' | 'admin' | 'user'>('all');
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '25'
      });

      // Date range filtering
      const now = new Date();
      if (dateRange === '24h') {
        const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        params.append('startDate', startDate.toISOString());
      } else if (dateRange === '7d') {
        const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        params.append('startDate', startDate.toISOString());
      } else if (dateRange === '30d') {
        const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        params.append('startDate', startDate.toISOString());
      }

      const [sessionsRes, statsRes] = await Promise.all([
        fetch(`/api/admin/audit-logs/sessions?${params}`, {
          headers: {
            ...getAuthHeaders()
          }
        }),
        fetch('/api/admin/audit-logs/stats', {
          headers: {
            ...getAuthHeaders()
          }
        })
      ]);

      if (!sessionsRes.ok) throw new Error('Failed to fetch session logs');
      if (!statsRes.ok) throw new Error('Failed to fetch stats');

      const sessionsData = await sessionsRes.json();
      const statsData = await statsRes.json();

      setSessions(sessionsData.sessions || []);
      setTotalPages(sessionsData.pagination?.totalPages || 1);
      setStats(statsData);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [currentPage, dateRange]);

  // Auto-refresh for real-time updates
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchLogs();
    }, refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, currentPage, dateRange]);

  const handleSearch = () => {
    setCurrentPage(1);
    fetchLogs();
  };

  // SOC2 Compliance: Export audit logs to CSV or JSON
  const handleExport = async () => {
    try {
      setExporting(true);
      const params = new URLSearchParams({
        format: exportFormat,
        logType,
        searchTerm,
        ...(filterUserId && { userId: filterUserId }),
        ...(filterUserEmail && { userEmail: filterUserEmail }),
        ...(filterActionType && { actionType: filterActionType }),
        ...(filterResourceType && { resourceType: filterResourceType }),
        ...(filterIpAddress && { ipAddress: filterIpAddress }),
        ...(filterSuccess && { success: filterSuccess })
      });

      // Date range filtering
      const now = new Date();
      if (dateRange === '24h') {
        const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        params.append('startDate', startDate.toISOString());
      } else if (dateRange === '7d') {
        const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        params.append('startDate', startDate.toISOString());
      } else if (dateRange === '30d') {
        const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        params.append('startDate', startDate.toISOString());
      }

      const response = await fetch(`/api/admin/audit-logs/export?${params}`, {
        headers: {
          ...getAuthHeaders()
        }
      });

      if (!response.ok) throw new Error('Failed to export audit logs');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const extension = exportFormat === 'json' ? 'json' : 'csv';
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.${extension}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedSessions);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedSessions(newExpanded);
  };

  const formatCost = (cost?: number | string | null) => {
    if (cost === null || cost === undefined) return '$0.00';
    const numCost = typeof cost === 'string' ? parseFloat(cost) : cost;
    if (isNaN(numCost)) return '$0.00';
    return `$${numCost.toFixed(4)}`;
  };

  const formatTokens = (tokens?: number | string | null) => {
    if (tokens === null || tokens === undefined) return '0';
    const numTokens = typeof tokens === 'string' ? parseInt(tokens, 10) : tokens;
    if (isNaN(numTokens)) return '0';
    return numTokens.toLocaleString();
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--color-text)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
        <div className="flex items-center gap-2 text-red-500">
          <XCircle className="w-5 h-5" />
          <span>Error: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with SOC2 Compliance Notice */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Shield className="w-6 h-6" />
            Audit Logs
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            SOC2 Compliant: All user activities are logged with full traceability
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as 'csv' | 'json')}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button
            onClick={handleExport}
            disabled={exporting || sessions.length === 0}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exporting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Export {exportFormat.toUpperCase()}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-purple-500" />
              <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                Admin Actions (7d)
              </span>
            </div>
            <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
              {stats.admin.recent7d}
            </div>
            <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {stats.admin.recent24h} in last 24h
            </div>
          </div>

          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <div className="flex items-center gap-2 mb-2">
              <User className="w-5 h-5 text-blue-500" />
              <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                User Queries (7d)
              </span>
            </div>
            <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
              {stats.user.recent7d}
            </div>
            <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {stats.user.recent24h} in last 24h
            </div>
          </div>

          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                Failed Queries (24h)
              </span>
            </div>
            <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
              {stats.user.failedQueries24h}
            </div>
            <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Requires attention
            </div>
          </div>

          <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-green-500" />
              <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                Total Logs
              </span>
            </div>
            <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
              {stats.admin.totalActions + stats.user.totalQueries}
            </div>
            <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              All time
            </div>
          </div>
        </div>
      )}

      {/* Enhanced SOC2 Compliant Filters and Search */}
      <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">Search & Filter - SOC2 Compliant</span>
        </div>

        {/* Primary Filters Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search all fields..."
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
              className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <select
            value={logType}
            onChange={(e) => setLogType(e.target.value as 'all' | 'admin' | 'user')}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Logs</option>
            <option value="admin">Admin Actions</option>
            <option value="user">User Queries</option>
          </select>

          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>

          <select
            value={filterSuccess}
            onChange={(e) => setFilterSuccess(e.target.value)}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Status</option>
            <option value="true">Success Only</option>
            <option value="false">Failures Only</option>
          </select>
        </div>

        {/* Advanced Filters Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            value={filterUserEmail}
            onChange={(e) => setFilterUserEmail(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Filter by user email..."
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          />

          <input
            type="text"
            value={filterActionType}
            onChange={(e) => setFilterActionType(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Filter by action type..."
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          />

          <input
            type="text"
            value={filterResourceType}
            onChange={(e) => setFilterResourceType(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Filter by resource type..."
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          />

          <input
            type="text"
            value={filterIpAddress}
            onChange={(e) => setFilterIpAddress(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Filter by IP address..."
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleSearch}
            className="flex-1 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center justify-center gap-2"
          >
            <Search className="w-4 h-4" />
            <span>Apply Filters</span>
          </button>
          <button
            onClick={() => {
              setSearchTerm('');
              setFilterUserEmail('');
              setFilterActionType('');
              setFilterResourceType('');
              setFilterIpAddress('');
              setFilterSuccess('');
              setLogType('all');
              setDateRange('7d');
              fetchLogs();
            }}
            className="px-4 py-2 rounded-lg hover:opacity-80 transition-opacity"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            Clear Filters
          </button>
          <button
            onClick={fetchLogs}
            className="px-4 py-2 rounded-lg hover:opacity-80 transition-opacity"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Real-time Updates Control */}
        <div className="mt-3 pt-3 border-t flex items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoRefresh"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="autoRefresh" className="text-sm" style={{ color: 'var(--color-text)' }}>
              Real-time Updates
            </label>
          </div>
          {autoRefresh && (
            <>
              <span className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                Refresh every:
              </span>
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
                className="px-2 py-1 text-sm rounded border focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="10">10 seconds</option>
                <option value="30">30 seconds</option>
                <option value="60">1 minute</option>
                <option value="120">2 minutes</option>
                <option value="300">5 minutes</option>
              </select>
              <Activity className="w-4 h-4 text-green-500 animate-pulse" />
            </>
          )}
        </div>
      </div>

      {/* Session Logs */}
      <div className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
        {sessions.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--color-textSecondary)' }}>
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No conversation sessions found</p>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {sessions.map((session) => (
              <div key={session.id} className="rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                {/* Session Header */}
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Activity className="w-5 h-5 text-primary-500" />
                        <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>
                          {session.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          <span>{session.userName}</span>
                          <span className="text-xs">({session.userEmail})</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatTimestamp(session.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleExpanded(session.id)}
                      className="flex items-center gap-1 text-primary-500 hover:text-primary-600 px-3 py-1 rounded"
                      style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
                    >
                      {expandedSessions.has(session.id) ? (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          <span className="text-sm">Hide Conversation</span>
                        </>
                      ) : (
                        <>
                          <ChevronRight className="w-4 h-4" />
                          <span className="text-sm">View Conversation</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Session Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 p-3 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                    <div className="text-center">
                      <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Messages</div>
                      <div className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                        {session.messageCount}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                        {session.userQueries}U / {session.aiResponses}AI
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Model</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        {session.model || 'N/A'}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Tokens</div>
                      <div className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                        {formatTokens(session.totalTokens)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Cost</div>
                      <div className="text-lg font-semibold text-green-500">
                        {formatCost(session.totalCost)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Tools</div>
                      <div className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                        {session.mcpCallsCount + session.toolExecutionsCount}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Conversation */}
                {expandedSessions.has(session.id) && (
                  <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="p-4 space-y-4">
                      {session.conversation.map((message, idx) => (
                        <div key={message.id} className={`p-3 rounded ${message.role === 'user' ? 'ml-8' : 'mr-8'}`}
                          style={{ backgroundColor: message.role === 'user' ? 'var(--color-surfaceSecondary)' : 'var(--color-surfaceTertiary, var(--color-surface))' }}>
                          <div className="flex items-center gap-2 mb-2">
                            {message.role === 'user' ? (
                              <User className="w-4 h-4 text-blue-500" />
                            ) : (
                              <Activity className="w-4 h-4 text-green-500" />
                            )}
                            <span className="font-semibold text-xs uppercase" style={{ color: 'var(--color-textSecondary)' }}>
                              {message.role}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                              {formatTimestamp(message.timestamp)}
                            </span>
                            {message.model && (
                              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-textSecondary)' }}>
                                {message.model}
                              </span>
                            )}
                          </div>

                          <div className="text-sm mb-2 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
                            {message.content.length > 500 ? message.content.substring(0, 500) + '...' : message.content}
                          </div>

                          {message.role === 'assistant' && (message.tokens || message.cost || message.hasMcpCalls || message.hasToolCalls) && (
                            <div className="flex items-center gap-4 mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-textSecondary)' }}>
                              {message.tokens && (
                                <div className="flex items-center gap-1">
                                  <FileText className="w-3 h-3" />
                                  <span>{formatTokens(message.tokens)} tokens</span>
                                </div>
                              )}
                              {message.cost && (
                                <div className="flex items-center gap-1 text-green-500">
                                  <span>{formatCost(message.cost)}</span>
                                </div>
                              )}
                              {message.hasMcpCalls && (
                                <div className="flex items-center gap-1 text-purple-500">
                                  <CheckCircle className="w-3 h-3" />
                                  <span>MCP Tools</span>
                                </div>
                              )}
                              {message.hasToolCalls && (
                                <div className="flex items-center gap-1 text-blue-500">
                                  <CheckCircle className="w-3 h-3" />
                                  <span>Function Calls</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
