/**
 * Context Window Metrics View
 *
 * Displays context window usage metrics per chat session to help administrators
 * monitor how well context window management systems are working.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/providers/AuthContext';

interface ContextMetrics {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  model: string;
  messageCount: number;
  contextTokensInput: number;
  contextTokensOutput: number;
  contextTokensTotal: number;
  contextWindowSize: number | null;
  contextUtilizationPct: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Statistics {
  averageUtilization: number;
  maxUtilization: number;
  totalSessions: number;
  highUtilizationSessions: number;
}

export const ContextWindowMetrics: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [sessions, setSessions] = useState<ContextMetrics[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  // Filters
  const [sortBy, setSortBy] = useState<'utilization' | 'total_tokens' | 'created_at'>('utilization');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [minUtilization, setMinUtilization] = useState<string>('');
  const [limit, setLimit] = useState(50);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        limit: limit.toString(),
        sortBy,
        sortOrder,
        ...(minUtilization && { minUtilization })
      });

      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/context-metrics?${params}`, {
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to fetch context metrics');
      }

      const data = await response.json();
      setSessions(data.sessions);
      setStatistics(data.statistics);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch context metrics');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, limit, sortBy, sortOrder, minUtilization]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const getUtilizationColor = (utilization: number | null): string => {
    if (!utilization) return 'text-text-secondary';
    if (utilization >= 90) return 'text-red-500 font-bold';
    if (utilization >= 70) return 'text-orange-500 font-semibold';
    if (utilization >= 50) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getUtilizationBadge = (utilization: number | null): string => {
    if (!utilization) return 'bg-surface-secondary text-text-secondary';
    if (utilization >= 90) return 'bg-red-900/30 text-red-400';
    if (utilization >= 70) return 'bg-orange-900/30 text-orange-400';
    if (utilization >= 50) return 'bg-yellow-900/30 text-yellow-400';
    return 'bg-green-900/30 text-green-400';
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat().format(num);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">Context Window Metrics</h2>
          <p className="text-text-secondary">
            Monitor context window usage across chat sessions to evaluate context management effectiveness
          </p>
        </div>
        <button
          onClick={fetchMetrics}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Statistics Cards */}
      {statistics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass-card p-6">
            <div className="text-sm text-text-secondary mb-1">Average Utilization</div>
            <div className={`text-3xl font-bold ${getUtilizationColor(statistics.averageUtilization)}`}>
              {statistics.averageUtilization.toFixed(2)}%
            </div>
          </div>
          <div className="glass-card p-6">
            <div className="text-sm text-text-secondary mb-1">Max Utilization</div>
            <div className={`text-3xl font-bold ${getUtilizationColor(statistics.maxUtilization)}`}>
              {statistics.maxUtilization.toFixed(2)}%
            </div>
          </div>
          <div className="glass-card p-6">
            <div className="text-sm text-text-secondary mb-1">Total Sessions</div>
            <div className="text-3xl font-bold text-primary-500">
              {formatNumber(statistics.totalSessions)}
            </div>
          </div>
          <div className="glass-card p-6">
            <div className="text-sm text-text-secondary mb-1">High Utilization (≥80%)</div>
            <div className="text-3xl font-bold text-orange-500">
              {formatNumber(statistics.highUtilizationSessions)}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 border border-border bg-surface-secondary text-text-primary rounded-md"
            >
              <option value="utilization">Utilization %</option>
              <option value="total_tokens">Total Tokens</option>
              <option value="created_at">Created Date</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="w-full px-3 py-2 border border-border bg-surface-secondary text-text-primary rounded-md"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Min Utilization %</label>
            <input
              type="number"
              value={minUtilization}
              onChange={(e) => setMinUtilization(e.target.value)}
              placeholder="e.g., 50"
              className="w-full px-3 py-2 border border-border bg-surface-secondary text-text-primary rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Limit</label>
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-border bg-surface-secondary text-text-primary rounded-md"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
        </div>
      </div>

      {/* Loading/Error States */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
          <p className="mt-4 text-text-secondary">Loading context window metrics...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-400">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Sessions Table */}
      {!loading && !error && sessions.length > 0 && (
        <div className="glass-card overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Session
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Model
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Messages
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Input Tokens
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Output Tokens
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Total Tokens
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Window Size
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  Utilization %
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.id}
                  className="border-b border-border/50 hover:bg-surface-secondary/30 cursor-pointer transition-colors"
                  onClick={() => setSelectedSession(session.id)}
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-text-primary truncate max-w-xs">
                      {session.title}
                    </div>
                    <div className="text-xs text-text-secondary">{formatDate(session.createdAt)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-text-primary">{session.userName}</div>
                    <div className="text-xs text-text-secondary">{session.userEmail}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-text-primary">
                    {session.model}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-text-primary text-right">
                    {session.messageCount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary text-right">
                    {formatNumber(session.contextTokensInput)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary text-right">
                    {formatNumber(session.contextTokensOutput)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text-primary text-right">
                    {formatNumber(session.contextTokensTotal)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary text-right">
                    {session.contextWindowSize ? formatNumber(session.contextWindowSize) : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {session.contextUtilizationPct !== null ? (
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getUtilizationBadge(
                          session.contextUtilizationPct
                        )}`}
                      >
                        {session.contextUtilizationPct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-text-secondary text-sm">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="text-center py-12 glass-card">
          <p className="text-text-secondary">No sessions found with the current filters.</p>
        </div>
      )}
    </div>
  );
};

export default ContextWindowMetrics;
