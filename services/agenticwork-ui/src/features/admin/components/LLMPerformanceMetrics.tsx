/**
 * LLM Performance Metrics Component
 * Displays real-time LLM usage metrics: token usage, costs, MCP tool calls
 * Data sourced directly from user_query_audit database table
 */

import React, { useState, useEffect } from 'react';
// Basic UI icons from lucide
import { Wrench, Users, BarChart, HelpCircle } from '@/shared/icons';
// Custom badass AgenticWork icons
import {
  Activity, Zap, DollarSign, TrendingUp, RefreshCw,
  Timer as Clock, CheckCircle, XCircle
} from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

// Tooltip component for metric explanations
const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center">
      {children}
      <div
        className="ml-1 cursor-help"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        <HelpCircle size={14} className="text-text-secondary opacity-60 hover:opacity-100 transition-opacity" />
      </div>
      {isVisible && (
        <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-gray-900 rounded-lg shadow-lg whitespace-normal max-w-xs">
          {text}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
};

// Metric explanations
const METRIC_TOOLTIPS = {
  totalQueries: "Total number of LLM API requests made in the selected time period",
  totalTokens: "Combined count of input (prompt) and output (completion) tokens processed",
  estimatedCost: "Estimated cost based on token usage and model-specific pricing",
  mcpToolCalls: "Number of MCP (Model Context Protocol) tool invocations by the LLM",
  ttft: "Time to First Token - How long until the LLM starts generating a response. Lower is better.",
  avgTTFT: "Average time to first token across all requests",
  p50TTFT: "50th percentile (median) - Half of requests start faster than this",
  p95TTFT: "95th percentile - 95% of requests start faster than this",
  p99TTFT: "99th percentile - Only 1% of requests are slower than this",
  tokensPerSecond: "Rate at which the LLM generates output tokens. Higher is better.",
  responseTime: "Total end-to-end time from request to complete response",
  modelLatency: "Average response time broken down by model type",
  errorRate: "Percentage of failed requests for each model",
  concurrent: "Average and maximum simultaneous requests being processed",
  queueWait: "Time requests spend waiting in queue before processing begins",
  cacheHitRate: "Percentage of requests served from cache vs. new LLM calls. Higher means lower costs.",
  providerCost: "Actual cost breakdown by LLM provider from request logs",
  modelUsage: "Token consumption and cost breakdown by specific model",
  userCost: "Cost attribution by user for billing and usage monitoring",
  toolStats: "Success rates and performance metrics for MCP tool calls",
};

interface LLMPerformanceMetricsProps {
  theme: string;
}

interface OverviewMetrics {
  totalQueries: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  avgResponseTime: number;
  uniqueUsers: number;
  successCount: number;
  failureCount: number;
  successRate: string;
  toolCalls: number;
}

interface ModelBreakdown {
  model: string;
  queries: number;
  tokens: number;
  cost: number;
  avgTokensPerQuery: number;
}

interface UserMetrics {
  userId: string;
  email: string;
  totalQueries: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  toolCalls: number;
  avgResponseTime: number;
}

interface ToolMetrics {
  toolName: string;
  serverName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionTime: number;
  estimatedCost: number;
}

interface TrendData {
  timestamp: string;
  queries: number;
  tokens: number;
  cost: number;
  toolCalls: number;
}

interface ProviderMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCost: string;
  avgLatencyMs: number;
  avgTokensPerSecond: number;
}

interface PerformanceKPIs {
  // Time to First Token
  avgTTFT: number;
  p50TTFT: number;
  p95TTFT: number;
  p99TTFT: number;

  // Tokens per second
  avgTokensPerSecond: number;
  p50TokensPerSecond: number;
  p95TokensPerSecond: number;

  // Response time
  avgResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;

  // Token counts
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;

  // Model latency
  modelLatencyByModel: Array<{ model: string; avgLatency: number; count: number }>;

  // Error rates
  errorRateByModel: Array<{ model: string; errorRate: number; totalRequests: number }>;

  // Costs
  totalCost: number;
  avgCostPerRequest: number;
  costByModel: Array<{ model: string; totalCost: number; count: number }>;

  // Concurrent requests
  avgConcurrentRequests: number;
  maxConcurrentRequests: number;

  // Queue wait times
  avgQueueWait: number;
  p95QueueWait: number;

  // Cache metrics
  cacheHitRate: number;
  totalCacheHits: number;
  totalCacheMisses: number;
}

const LLMPerformanceMetrics: React.FC<LLMPerformanceMetricsProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(24); // hours
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Metrics state
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdown[]>([]);
  const [userMetrics, setUserMetrics] = useState<UserMetrics[]>([]);
  const [toolMetrics, setToolMetrics] = useState<ToolMetrics[]>([]);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [providerMetrics, setProviderMetrics] = useState<ProviderMetrics[]>([]);
  const [providerTotalCost, setProviderTotalCost] = useState<string>('0.000000');
  const [performanceKPIs, setPerformanceKPIs] = useState<PerformanceKPIs | null>(null);

  const fetchMetrics = async () => {
    try {
      setLoading(true);

      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };

      // Fetch all metrics in parallel
      const [overviewRes, usersRes, toolsRes, trendsRes, providersRes, performanceRes] = await Promise.all([
        fetch(`/api/admin/metrics/llm/overview?hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics/llm/users?hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics/llm/tools?hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics/llm/trends?hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics/llm/providers?hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics/llm/performance?hours=${timeRange}`, { headers })
      ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setOverview(data.overview);
        setModelBreakdown(data.modelBreakdown || []);
      }

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUserMetrics(data.users || []);
      }

      if (toolsRes.ok) {
        const data = await toolsRes.json();
        setToolMetrics(data.tools || []);
      }

      if (trendsRes.ok) {
        const data = await trendsRes.json();
        setTrends(data.trends || []);
      }

      if (providersRes.ok) {
        const data = await providersRes.json();
        setProviderMetrics(data.providers || []);
        setProviderTotalCost(data.totalCost || '0.000000');
      }

      if (performanceRes.ok) {
        const data = await performanceRes.json();
        setPerformanceKPIs(data.kpis || null);
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch LLM metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [timeRange]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, 30000); // Refresh every 30 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh, timeRange]);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toFixed(0);
  };

  const formatCurrency = (amount: number): string => {
    return `$${amount.toFixed(4)}`;
  };

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">LLM Performance Metrics</h2>
          <p className="text-text-secondary">
            Real-time token usage, costs, and MCP tool analytics
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="px-4 py-2 rounded-lg border border-border bg-surface-secondary text-text-primary"
          >
            <option value={1}>Last Hour</option>
            <option value={6}>Last 6 Hours</option>
            <option value={24}>Last 24 Hours</option>
            <option value={168}>Last Week</option>
            <option value={720}>Last Month</option>
          </select>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              autoRefresh
                ? 'border-primary-500 bg-primary-500/10 text-primary-500'
                : 'border-border bg-surface-secondary text-text-secondary'
            }`}
          >
            <RefreshCw size={16} className={autoRefresh ? 'animate-spin' : ''} />
          </button>

          {/* Manual Refresh */}
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-border bg-surface-secondary text-text-primary hover:bg-surface-hover disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Last Updated */}
      <div className="text-xs text-text-secondary">
        Last updated: {lastUpdated.toLocaleTimeString()}
      </div>

      {/* Overview Cards */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Queries */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <div className="flex items-center justify-between">
              <Activity size={24} className="text-blue-500" />
              <Tooltip text={METRIC_TOOLTIPS.totalQueries}>
                <span className="text-xs text-text-secondary">Total Queries</span>
              </Tooltip>
            </div>
            <div className="mt-4">
              <div className="text-3xl font-bold text-text-primary">
                {formatNumber(overview.totalQueries)}
              </div>
              <div className="text-xs text-text-secondary mt-1">
                {overview.uniqueUsers} unique users
              </div>
            </div>
          </div>

          {/* Total Tokens - use performanceKPIs for accurate breakdown */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <div className="flex items-center justify-between">
              <Zap size={24} className="text-yellow-500" />
              <Tooltip text={METRIC_TOOLTIPS.totalTokens}>
                <span className="text-xs text-text-secondary">Total Tokens</span>
              </Tooltip>
            </div>
            <div className="mt-4">
              <div className="text-3xl font-bold text-text-primary">
                {formatNumber(performanceKPIs?.totalTokens ?? overview.totalTokens)}
              </div>
              <div className="text-xs text-text-secondary mt-1">
                {formatNumber(performanceKPIs?.totalPromptTokens ?? overview.totalPromptTokens)} prompt / {formatNumber(performanceKPIs?.totalCompletionTokens ?? overview.totalCompletionTokens)} completion
              </div>
            </div>
          </div>

          {/* Total Cost - use accurate data from provider metrics or KPIs */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <div className="flex items-center justify-between">
              <DollarSign size={24} className="text-green-500" />
              <Tooltip text={METRIC_TOOLTIPS.estimatedCost}>
                <span className="text-xs text-text-secondary">Total Cost</span>
              </Tooltip>
            </div>
            <div className="mt-4">
              <div className="text-3xl font-bold text-text-primary">
                ${performanceKPIs?.totalCost?.toFixed(4) ?? providerTotalCost ?? '0.0000'}
              </div>
              <div className="text-xs text-text-secondary mt-1">
                Avg {performanceKPIs?.avgResponseTime ?? overview.avgResponseTime}ms response time
              </div>
            </div>
          </div>

          {/* Tool Calls */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <div className="flex items-center justify-between">
              <Wrench size={24} className="text-purple-500" />
              <Tooltip text={METRIC_TOOLTIPS.mcpToolCalls}>
                <span className="text-xs text-text-secondary">MCP Tool Calls</span>
              </Tooltip>
            </div>
            <div className="mt-4">
              <div className="text-3xl font-bold text-text-primary">
                {formatNumber(overview.toolCalls)}
              </div>
              <div className="text-xs text-text-secondary mt-1 flex items-center gap-2">
                <CheckCircle size={12} className="text-green-500" />
                {overview.successRate}% success rate
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Provider Cost Breakdown (from llm_request_logs - accurate costs) */}
      {providerMetrics.length > 0 && (
        <div className="p-6 rounded-lg bg-surface-secondary border border-border">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <DollarSign size={20} />
            <Tooltip text={METRIC_TOOLTIPS.providerCost}>
              <span>Provider Cost Breakdown</span>
            </Tooltip>
            <span className="text-sm font-normal text-text-secondary ml-2">
              (Total: ${providerTotalCost})
            </span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-text-secondary border-b border-border">
                  <th className="pb-3">Provider</th>
                  <th className="pb-3 text-right">Requests</th>
                  <th className="pb-3 text-right">Success Rate</th>
                  <th className="pb-3 text-right">Prompt Tokens</th>
                  <th className="pb-3 text-right">Completion Tokens</th>
                  <th className="pb-3 text-right">Avg Latency</th>
                  <th className="pb-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {providerMetrics.map((provider, index) => (
                  <tr key={index} className="text-sm text-text-primary border-b border-border/50">
                    <td className="py-3 font-medium capitalize">{provider.provider.replace('-', ' ')}</td>
                    <td className="py-3 text-right">{formatNumber(provider.totalRequests)}</td>
                    <td className="py-3 text-right">
                      <span className={parseFloat(provider.successRate) >= 90 ? 'text-green-500' : parseFloat(provider.successRate) >= 70 ? 'text-yellow-500' : 'text-red-500'}>
                        {provider.successRate}%
                      </span>
                    </td>
                    <td className="py-3 text-right">{formatNumber(provider.promptTokens)}</td>
                    <td className="py-3 text-right">{formatNumber(provider.completionTokens)}</td>
                    <td className="py-3 text-right">{provider.avgLatencyMs}ms</td>
                    <td className="py-3 text-right text-green-600 font-semibold">${provider.totalCost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Model Breakdown */}
      {modelBreakdown.length > 0 && (
        <div className="p-6 rounded-lg bg-surface-secondary border border-border">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <BarChart size={20} />
            <Tooltip text={METRIC_TOOLTIPS.modelUsage}>
              <span>Model Usage Breakdown</span>
            </Tooltip>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-text-secondary border-b border-border">
                  <th className="pb-3">Model</th>
                  <th className="pb-3 text-right">Queries</th>
                  <th className="pb-3 text-right">Total Tokens</th>
                  <th className="pb-3 text-right">Avg Tokens/Query</th>
                  <th className="pb-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {modelBreakdown.map((model, index) => (
                  <tr key={index} className="text-sm text-text-primary border-b border-border/50">
                    <td className="py-3 font-medium">{model.model}</td>
                    <td className="py-3 text-right">{formatNumber(model.queries)}</td>
                    <td className="py-3 text-right">{formatNumber(model.tokens)}</td>
                    <td className="py-3 text-right">{formatNumber(model.avgTokensPerQuery)}</td>
                    <td className="py-3 text-right text-green-600">{formatCurrency(model.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Users by Cost */}
      {userMetrics.length > 0 && (
        <div className="p-6 rounded-lg bg-surface-secondary border border-border">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Users size={20} />
            <Tooltip text={METRIC_TOOLTIPS.userCost}>
              <span>Top Users by Cost</span>
            </Tooltip>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-text-secondary border-b border-border">
                  <th className="pb-3">User</th>
                  <th className="pb-3 text-right">Queries</th>
                  <th className="pb-3 text-right">Tokens</th>
                  <th className="pb-3 text-right">Tool Calls</th>
                  <th className="pb-3 text-right">Avg Response</th>
                  <th className="pb-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {userMetrics.slice(0, 10).map((user, index) => (
                  <tr key={index} className="text-sm text-text-primary border-b border-border/50">
                    <td className="py-3 font-medium">{user.email}</td>
                    <td className="py-3 text-right">{formatNumber(user.totalQueries)}</td>
                    <td className="py-3 text-right">{formatNumber(user.totalTokens)}</td>
                    <td className="py-3 text-right">{formatNumber(user.toolCalls)}</td>
                    <td className="py-3 text-right">{user.avgResponseTime}ms</td>
                    <td className="py-3 text-right text-green-600 font-semibold">
                      {formatCurrency(user.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MCP Tool Statistics */}
      {toolMetrics.length > 0 && (
        <div className="p-6 rounded-lg bg-surface-secondary border border-border">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Wrench size={20} />
            <Tooltip text={METRIC_TOOLTIPS.toolStats}>
              <span>MCP Tool Call Statistics</span>
            </Tooltip>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-text-secondary border-b border-border">
                  <th className="pb-3">Tool Name</th>
                  <th className="pb-3">Server</th>
                  <th className="pb-3 text-right">Total Calls</th>
                  <th className="pb-3 text-right">Success Rate</th>
                  <th className="pb-3 text-right">Avg Time</th>
                  <th className="pb-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {toolMetrics.slice(0, 15).map((tool, index) => (
                  <tr key={index} className="text-sm text-text-primary border-b border-border/50">
                    <td className="py-3 font-medium">{tool.toolName}</td>
                    <td className="py-3 text-text-secondary">{tool.serverName}</td>
                    <td className="py-3 text-right">{formatNumber(tool.totalCalls)}</td>
                    <td className="py-3 text-right">
                      <span className={(tool.successRate ?? 0) >= 90 ? 'text-green-500' : (tool.successRate ?? 0) >= 70 ? 'text-yellow-500' : 'text-red-500'}>
                        {(tool.successRate ?? 0).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 text-right">{tool.avgExecutionTime}ms</td>
                    <td className="py-3 text-right text-green-600">
                      {formatCurrency(tool.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Comprehensive Performance KPIs - Issue 4l */}
      {performanceKPIs && (
        <>
          {/* Time to First Token (TTFT) Metrics */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Clock size={20} className="text-blue-500" />
              <Tooltip text={METRIC_TOOLTIPS.ttft}>
                <span>Time to First Token (TTFT)</span>
              </Tooltip>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Average TTFT</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.avgTTFT}ms</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P50 TTFT</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p50TTFT}ms</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P95 TTFT</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p95TTFT}ms</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P99 TTFT</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p99TTFT}ms</div>
              </div>
            </div>
          </div>

          {/* Output Speed (Tokens/Second) */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Zap size={20} className="text-yellow-500" />
              <Tooltip text={METRIC_TOOLTIPS.tokensPerSecond}>
                <span>Output Speed (Tokens/Second)</span>
              </Tooltip>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Average</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.avgTokensPerSecond} tok/s</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P50</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p50TokensPerSecond} tok/s</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P95</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p95TokensPerSecond} tok/s</div>
              </div>
            </div>
          </div>

          {/* Response Time Distribution */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <TrendingUp size={20} className="text-green-500" />
              <Tooltip text={METRIC_TOOLTIPS.responseTime}>
                <span>Total Response Time Distribution</span>
              </Tooltip>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Average</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.avgResponseTime}ms</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P50</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p50ResponseTime}ms</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P95</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p95ResponseTime}ms</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P99</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p99ResponseTime}ms</div>
              </div>
            </div>
          </div>

          {/* Model-Specific Latency */}
          {performanceKPIs.modelLatencyByModel.length > 0 && (
            <div className="p-6 rounded-lg bg-surface-secondary border border-border">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <BarChart size={20} />
                <Tooltip text={METRIC_TOOLTIPS.modelLatency}>
                  <span>Model Latency by Type</span>
                </Tooltip>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-text-secondary border-b border-border">
                      <th className="pb-3">Model</th>
                      <th className="pb-3 text-right">Avg Latency</th>
                      <th className="pb-3 text-right">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performanceKPIs.modelLatencyByModel.map((model, index) => (
                      <tr key={index} className="text-sm text-text-primary border-b border-border/50">
                        <td className="py-3 font-medium">{model.model}</td>
                        <td className="py-3 text-right">{model.avgLatency}ms</td>
                        <td className="py-3 text-right">{formatNumber(model.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error Rates by Model */}
          {performanceKPIs.errorRateByModel.length > 0 && (
            <div className="p-6 rounded-lg bg-surface-secondary border border-border">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <XCircle size={20} className="text-red-500" />
                <Tooltip text={METRIC_TOOLTIPS.errorRate}>
                  <span>Error Rates by Model</span>
                </Tooltip>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-text-secondary border-b border-border">
                      <th className="pb-3">Model</th>
                      <th className="pb-3 text-right">Error Rate</th>
                      <th className="pb-3 text-right">Total Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performanceKPIs.errorRateByModel.map((model, index) => (
                      <tr key={index} className="text-sm text-text-primary border-b border-border/50">
                        <td className="py-3 font-medium">{model.model}</td>
                        <td className="py-3 text-right">
                          <span className={model.errorRate < 1 ? 'text-green-500' : model.errorRate < 5 ? 'text-yellow-500' : 'text-red-500'}>
                            {model.errorRate}%
                          </span>
                        </td>
                        <td className="py-3 text-right">{formatNumber(model.totalRequests)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Concurrent Request Handling & Queue Metrics */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Activity size={20} className="text-purple-500" />
              <Tooltip text={METRIC_TOOLTIPS.concurrent}>
                <span>Concurrent Requests & Queue Performance</span>
              </Tooltip>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Avg Concurrent</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.avgConcurrentRequests}</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Max Concurrent</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.maxConcurrentRequests}</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Avg Queue Wait</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.avgQueueWait}ms</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">P95 Queue Wait</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.p95QueueWait}ms</div>
              </div>
            </div>
          </div>

          {/* Cache Hit/Miss Rates */}
          <div className="p-6 rounded-lg bg-surface-secondary border border-border">
            <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <CheckCircle size={20} className="text-green-500" />
              <Tooltip text={METRIC_TOOLTIPS.cacheHitRate}>
                <span>Cache Performance</span>
              </Tooltip>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Cache Hit Rate</div>
                <div className="text-2xl font-bold text-text-primary">{performanceKPIs.cacheHitRate}%</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Cache Hits</div>
                <div className="text-2xl font-bold text-green-500">{formatNumber(performanceKPIs.totalCacheHits)}</div>
              </div>
              <div className="p-4 rounded bg-surface-hover">
                <div className="text-xs text-text-secondary mb-1">Cache Misses</div>
                <div className="text-2xl font-bold text-red-500">{formatNumber(performanceKPIs.totalCacheMisses)}</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LLMPerformanceMetrics;
