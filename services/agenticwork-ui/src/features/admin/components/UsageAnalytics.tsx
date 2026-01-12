/**
 * Usage Analytics Component - Dense Production Monitoring Dashboard
 * Displays comprehensive usage metrics: API calls, sessions, tokens, tool calls,
 * image generation, files created, error rates, latencies, and detailed per-user breakdowns
 * Optimized for maximum information density like a production monitoring dashboard
 */

import React, { useState, useEffect } from 'react';
// Keep basic/UI icons from lucide
import {
  Users, MessageSquare, ChevronDown, ChevronUp, Calendar, BarChart, Filter,
  Image, FileText, Wrench, Code, Globe, TrendingDown, Key, Eye
} from '@/shared/icons';
// Custom badass icons
import { Activity, TrendingUp, Zap, DollarSign, Database, AlertCircle as AlertTriangle, CheckCircle, Timer as Clock, Cpu, Server } from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

interface UsageAnalyticsProps {
  theme: string;
}

interface UserUsageData {
  userId: string;
  userName: string;
  userEmail: string;
  totalSessions: number;
  totalMessages: number;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  estimatedCost: number;
  apiCalls: number;
  mcpToolCalls: number;
  imagesGenerated: number;
  filesCreated: number;
  avgResponseTime: number;
  visionModelUsage: number;
  errorRate: number;
  cacheHitRate: number;
  apiKeyUsage: {
    keyName: string;
    callCount: number;
    lastUsed: string;
  }[];
  endpointBreakdown: {
    endpoint: string;
    count: number;
  }[];
  models: {
    modelName: string;
    count: number;
    tokens: number;
    cost: number;
  }[];
  lastActive: string;
}

interface AggregateStats {
  totalUsers: number;
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  tokensInput: number;
  tokensOutput: number;
  totalApiCalls: number;
  totalMcpToolCalls: number;
  totalImagesGenerated: number;
  totalFilesCreated: number;
  avgResponseTime: number;
  totalVisionUsage: number;
  totalErrorRate: number;
  totalSuccessRate: number;
  cacheHitRate: number;
  avgTokensPerSecond: number;
  p95Latency: number;
  p99Latency: number;
  totalToolCalls: number;
  uniqueMcpTools: number;
}

interface TimeSeriesData {
  date: string;
  requests: number;
  tokens: number;
  cost: number;
  errors: number;
  avgLatency: number;
}

const UsageAnalytics: React.FC<UsageAnalyticsProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [userUsage, setUserUsage] = useState<UserUsageData[]>([]);
  const [aggregateStats, setAggregateStats] = useState<AggregateStats | null>(null);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('7d'); // 7d, 30d, 90d, all
  const [sortBy, setSortBy] = useState<'tokens' | 'messages' | 'sessions' | 'cost' | 'errors'>('tokens');

  useEffect(() => {
    const fetchUsageData = async () => {
      try {
        setLoading(true);

        const usageResponse = await fetch(`/api/admin/analytics/usage?timeRange=${timeRange}`, {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (usageResponse.ok) {
          const data = await usageResponse.json();
          setUserUsage(data.users || []);
          setAggregateStats(data.aggregate || null);
          setTimeSeriesData(data.timeSeries || []);
        }
      } catch (error) {
        console.error('Failed to fetch usage analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsageData();
  }, [timeRange, getAuthHeaders]);

  // Sort users by selected criteria
  const sortedUsers = [...userUsage].sort((a, b) => {
    switch (sortBy) {
      case 'tokens':
        return b.totalTokens - a.totalTokens;
      case 'messages':
        return b.totalMessages - a.totalMessages;
      case 'sessions':
        return b.totalSessions - a.totalSessions;
      case 'cost':
        return b.estimatedCost - a.estimatedCost;
      case 'errors':
        return b.errorRate - a.errorRate;
      default:
        return 0;
    }
  });

  // Format large numbers with commas
  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US');
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  // Format percentage
  const formatPercent = (num: number) => {
    return `${num.toFixed(1)}%`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        <span className="ml-4 text-lg text-text-secondary">Loading usage analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">
            Usage Analytics Dashboard
          </h2>
          <p className="text-text-secondary">
            Comprehensive production monitoring and usage tracking
          </p>
        </div>

        {/* Time Range Filter */}
        <div className="flex items-center gap-3">
          <Filter size={20} className="text-text-secondary" />
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      {/* Aggregate Statistics Cards - Dense Grid Layout */}
      {aggregateStats && (
        <>
          {/* Primary Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Users size={18} className="text-blue-500" />
                <TrendingUp size={12} className="text-green-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Active Users</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalUsers)}
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <MessageSquare size={18} className="text-purple-500" />
                <Activity size={12} className="text-green-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Messages</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalMessages)}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {formatNumber(aggregateStats.totalSessions)} sessions
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Globe size={18} className="text-cyan-500" />
                <Database size={12} className="text-blue-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">API Calls</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalApiCalls)}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {(aggregateStats.avgResponseTime || 0).toFixed(0)}ms avg
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Zap size={18} className="text-yellow-500" />
                <Activity size={12} className="text-blue-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Tokens</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalTokens)}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {formatNumber(aggregateStats.tokensInput)} in / {formatNumber(aggregateStats.tokensOutput)} out
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <DollarSign size={18} className="text-emerald-500" />
                <TrendingUp size={12} className="text-green-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Total Cost</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatCurrency(aggregateStats.totalCost)}
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <CheckCircle size={18} className="text-green-500" />
                {aggregateStats.totalErrorRate > 5 ? (
                  <AlertTriangle size={12} className="text-red-500" />
                ) : (
                  <CheckCircle size={12} className="text-green-500" />
                )}
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Success Rate</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatPercent(aggregateStats.totalSuccessRate)}
              </p>
              <p className="text-xs text-red-400 mt-0.5">
                {formatPercent(aggregateStats.totalErrorRate)} errors
              </p>
            </div>
          </div>

          {/* Secondary Metrics Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Wrench size={18} className="text-orange-500" />
                <Code size={12} className="text-purple-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">MCP Tool Calls</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalMcpToolCalls)}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {aggregateStats.uniqueMcpTools} unique tools
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Image size={18} className="text-pink-500" />
                <BarChart size={12} className="text-purple-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Images</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalImagesGenerated)}
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <FileText size={18} className="text-green-500" />
                <Database size={12} className="text-cyan-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Files</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalFilesCreated)}
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Eye size={18} className="text-indigo-500" />
                <Activity size={12} className="text-cyan-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Vision Usage</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatNumber(aggregateStats.totalVisionUsage || 0)}
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Clock size={18} className="text-blue-400" />
                <TrendingDown size={12} className="text-green-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">P95 Latency</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {aggregateStats.p95Latency.toFixed(0)}ms
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                P99: {aggregateStats.p99Latency.toFixed(0)}ms
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Database size={18} className="text-teal-500" />
                <CheckCircle size={12} className="text-green-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Cache Hit Rate</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {formatPercent(aggregateStats.cacheHitRate)}
              </p>
            </div>

            <div className="glass-card p-3 hover:shadow-lg transition-all duration-150 ease-out">
              <div className="flex items-center justify-between mb-1">
                <Cpu size={18} className="text-purple-500" />
                <TrendingUp size={12} className="text-green-500" />
              </div>
              <h3 className="text-xs font-medium text-text-secondary">Tokens/sec</h3>
              <p className="text-xl font-bold text-text-primary mt-0.5">
                {aggregateStats.avgTokensPerSecond.toFixed(1)}
              </p>
            </div>
          </div>

          {/* Time Series Chart */}
          {timeSeriesData.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Trends Over Time</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Requests Chart */}
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-2">API Requests & Errors</h4>
                  <div className="space-y-1">
                    {timeSeriesData.map((day, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary w-20">{day.date.split('-').slice(1).join('/')}</span>
                        <div className="flex-1 flex gap-1">
                          <div
                            className="bg-blue-500 h-6 rounded flex items-center justify-end px-2"
                            style={{
                              width: `${Math.max((day.requests / Math.max(...timeSeriesData.map(d => d.requests))) * 100, 5)}%`
                            }}
                          >
                            <span className="text-xs text-white">{day.requests}</span>
                          </div>
                          {day.errors > 0 && (
                            <div
                              className="bg-red-500 h-6 rounded flex items-center justify-end px-2"
                              style={{
                                width: `${Math.max((day.errors / Math.max(...timeSeriesData.map(d => d.requests))) * 100, 3)}%`
                              }}
                            >
                              <span className="text-xs text-white">{day.errors}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tokens & Cost Chart */}
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-2">Tokens & Cost</h4>
                  <div className="space-y-1">
                    {timeSeriesData.map((day, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary w-20">{day.date.split('-').slice(1).join('/')}</span>
                        <div className="flex-1">
                          <div
                            className="bg-gradient-to-r from-green-500 to-emerald-600 h-6 rounded flex items-center justify-between px-2"
                            style={{
                              width: `${Math.max((day.tokens / Math.max(...timeSeriesData.map(d => d.tokens))) * 100, 5)}%`
                            }}
                          >
                            <span className="text-xs text-white">{formatNumber(day.tokens)}</span>
                            <span className="text-xs text-white font-semibold">{formatCurrency(day.cost)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Latency Chart */}
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-2">Average Latency (ms)</h4>
                  <div className="space-y-1">
                    {timeSeriesData.map((day, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-xs text-text-secondary w-20">{day.date.split('-').slice(1).join('/')}</span>
                        <div className="flex-1">
                          <div
                            className={`h-6 rounded flex items-center justify-end px-2 ${
                              day.avgLatency > 1000 ? 'bg-red-500' : day.avgLatency > 500 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{
                              width: `${Math.max((day.avgLatency / Math.max(...timeSeriesData.map(d => d.avgLatency))) * 100, 5)}%`
                            }}
                          >
                            <span className="text-xs text-white">{day.avgLatency.toFixed(0)}ms</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Sort Controls */}
      <div className="flex items-center justify-between glass-card p-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-text-secondary">Sort by:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSortBy('tokens')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sortBy === 'tokens'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
              }`}
            >
              Tokens
            </button>
            <button
              onClick={() => setSortBy('cost')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sortBy === 'cost'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
              }`}
            >
              Cost
            </button>
            <button
              onClick={() => setSortBy('messages')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sortBy === 'messages'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
              }`}
            >
              Messages
            </button>
            <button
              onClick={() => setSortBy('sessions')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sortBy === 'sessions'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
              }`}
            >
              Sessions
            </button>
            <button
              onClick={() => setSortBy('errors')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sortBy === 'errors'
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-secondary text-text-secondary hover:bg-surface-hover'
              }`}
            >
              Errors
            </button>
          </div>
        </div>
        <span className="text-sm text-text-secondary">
          {sortedUsers.length} user{sortedUsers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* User Usage Table */}
      {sortedUsers.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Activity size={48} className="mx-auto mb-4 text-text-secondary" />
          <p className="text-text-secondary">No usage data found for the selected time range</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedUsers.map((user) => (
            <div
              key={user.userId}
              className="glass-card p-4 hover:shadow-lg transition-all duration-150 ease-out"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-1">
                      <div className="w-8 h-8 rounded-full bg-primary-500/10 flex items-center justify-center">
                        <Users size={16} style={{ color: 'var(--color-primary)' }} />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-text-primary">{user.userName}</h3>
                        <p className="text-xs text-text-secondary">{user.userEmail}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedUserId(expandedUserId === user.userId ? null : user.userId)}
                      className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
                    >
                      {expandedUserId === user.userId ? (
                        <ChevronUp size={18} className="text-text-secondary" />
                      ) : (
                        <ChevronDown size={18} className="text-text-secondary" />
                      )}
                    </button>
                  </div>

                  {/* Dense Quick Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-12 gap-2">
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Sessions</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.totalSessions)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Messages</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.totalMessages)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">API Calls</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.apiCalls || 0)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">MCP Tools</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.mcpToolCalls || 0)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Tokens</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.totalTokens)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Images</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.imagesGenerated || 0)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Files</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.filesCreated || 0)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Vision</p>
                      <p className="text-sm font-bold text-text-primary">{formatNumber(user.visionModelUsage || 0)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Cost</p>
                      <p className="text-sm font-bold text-text-primary">{formatCurrency(user.estimatedCost)}</p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Avg Latency</p>
                      <p className="text-sm font-bold text-text-primary">{(user.avgResponseTime || 0).toFixed(0)}ms</p>
                    </div>
                    <div className={`rounded p-2 ${user.errorRate > 5 ? 'bg-red-900/20' : 'bg-surface-secondary'}`}>
                      <p className="text-xs text-text-secondary mb-0.5">Error Rate</p>
                      <p className={`text-sm font-bold ${user.errorRate > 5 ? 'text-red-400' : 'text-text-primary'}`}>
                        {formatPercent(user.errorRate)}
                      </p>
                    </div>
                    <div className="bg-surface-secondary rounded p-2">
                      <p className="text-xs text-text-secondary mb-0.5">Cache Hit</p>
                      <p className="text-sm font-bold text-text-primary">{formatPercent(user.cacheHitRate)}</p>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedUserId === user.userId && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      {/* Token Breakdown */}
                      <div className="bg-surface-secondary rounded-lg p-3">
                        <h4 className="text-sm font-semibold text-text-primary mb-2">Token Breakdown</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-xs text-text-secondary mb-1">Input Tokens</p>
                            <p className="text-lg font-bold text-text-primary">{formatNumber(user.tokensInput)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-secondary mb-1">Output Tokens</p>
                            <p className="text-lg font-bold text-text-primary">{formatNumber(user.tokensOutput)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-secondary mb-1">Total</p>
                            <p className="text-lg font-bold text-text-primary">{formatNumber(user.totalTokens)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Model Usage */}
                      {user.models && user.models.length > 0 && (
                        <div className="bg-surface-secondary rounded-lg p-3">
                          <h4 className="text-sm font-semibold text-text-primary mb-2">Model Usage</h4>
                          <div className="space-y-1.5">
                            {user.models.map((model, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 bg-surface rounded text-xs">
                                <span className="font-medium text-text-primary">{model.modelName}</span>
                                <div className="flex items-center gap-3">
                                  <span className="text-text-secondary">{formatNumber(model.count)} uses</span>
                                  <span className="text-text-secondary">{formatNumber(model.tokens)} tokens</span>
                                  <span className="font-medium text-text-primary">{formatCurrency(model.cost)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* API Key Usage */}
                      {user.apiKeyUsage && user.apiKeyUsage.length > 0 && (
                        <div className="bg-surface-secondary rounded-lg p-3">
                          <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                            <Key size={14} />
                            API Key Usage
                          </h4>
                          <div className="space-y-1.5">
                            {user.apiKeyUsage.map((key, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 bg-surface rounded text-xs">
                                <span className="font-medium text-text-primary">{key.keyName}</span>
                                <div className="flex items-center gap-3">
                                  <span className="text-text-secondary">{formatNumber(key.callCount)} calls</span>
                                  <span className="text-text-secondary">Last: {new Date(key.lastUsed).toLocaleDateString()}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Endpoint Breakdown */}
                      {user.endpointBreakdown && user.endpointBreakdown.length > 0 && (
                        <div className="bg-surface-secondary rounded-lg p-3">
                          <h4 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                            <Server size={14} />
                            Endpoint Breakdown
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {user.endpointBreakdown.map((ep, idx) => (
                              <div key={idx} className="p-2 bg-surface rounded text-xs">
                                <p className="text-text-secondary mb-0.5">{ep.endpoint}</p>
                                <p className="font-bold text-text-primary">{formatNumber(ep.count)} calls</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UsageAnalytics;
