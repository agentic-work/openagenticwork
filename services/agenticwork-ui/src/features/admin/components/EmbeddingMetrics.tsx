/**
 * Embedding Metrics Component
 * Displays embedding usage statistics: request counts, tokens, costs, and latency
 * Data sourced from /api/admin/analytics/embeddings endpoint
 */

import React, { useState, useEffect, useCallback } from 'react';
import { HelpCircle } from '@/shared/icons';
import {
  Activity, Zap, DollarSign, TrendingUp, RefreshCw,
  Timer as Clock
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
  totalRequests: "Total number of embedding API requests made",
  totalTokens: "Total tokens processed for embedding generation",
  totalCost: "Estimated cost based on embedding model pricing",
  avgLatency: "Average time to generate embeddings in milliseconds",
  byProvider: "Embedding usage breakdown by provider (Azure, Vertex AI, Bedrock, etc.)",
  byModel: "Embedding usage breakdown by specific model",
  dailyTrend: "Daily embedding request count over the last 7 days",
};

interface EmbeddingMetricsProps {
  theme?: string;
}

interface EmbeddingData {
  summary: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    avgLatencyMs: number;
  };
  byProvider: Array<{
    provider: string;
    requests: number;
    tokens: number;
    cost: number;
    avgLatencyMs: number;
  }>;
  byModel: Array<{
    model: string;
    requests: number;
    tokens: number;
    cost: number;
    avgLatencyMs: number;
  }>;
  dailyTrend: Array<{
    date: string;
    count: number;
  }>;
}

const EmbeddingMetrics: React.FC<EmbeddingMetricsProps> = ({ theme = 'dark' }) => {
  const { getAccessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EmbeddingData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();
      const response = await fetch('/api/admin/analytics/embeddings', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.success) {
        setData(result.embeddings);
        setLastUpdated(new Date());
      } else {
        throw new Error(result.error || 'Failed to fetch embedding metrics');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load embedding metrics');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchData();
    // Refresh every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  if (loading && !data) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-secondary rounded w-1/3"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-surface-secondary rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-red-400 hover:text-red-300 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const summary = data?.summary || { totalRequests: 0, totalTokens: 0, totalCost: 0, avgLatencyMs: 0 };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Zap size={24} className="text-purple-400" />
            Embedding Metrics
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Vector embedding usage and performance statistics
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-text-secondary">
              Updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg bg-surface-secondary hover:bg-surface-hover transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface-secondary border border-border">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Tooltip text={METRIC_TOOLTIPS.totalRequests}>
              <span className="text-sm">Total Requests</span>
            </Tooltip>
          </div>
          <div className="text-2xl font-bold text-text-primary">
            {formatNumber(summary.totalRequests)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-secondary border border-border">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Tooltip text={METRIC_TOOLTIPS.totalTokens}>
              <span className="text-sm">Total Tokens</span>
            </Tooltip>
          </div>
          <div className="text-2xl font-bold text-text-primary">
            {formatNumber(summary.totalTokens)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-secondary border border-border">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Tooltip text={METRIC_TOOLTIPS.totalCost}>
              <span className="text-sm">Total Cost</span>
            </Tooltip>
          </div>
          <div className="text-2xl font-bold text-green-400">
            {formatCost(summary.totalCost)}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-secondary border border-border">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Tooltip text={METRIC_TOOLTIPS.avgLatency}>
              <span className="text-sm">Avg Latency</span>
            </Tooltip>
          </div>
          <div className="text-2xl font-bold text-text-primary">
            {summary.avgLatencyMs}ms
          </div>
        </div>
      </div>

      {/* Provider Breakdown */}
      {data?.byProvider && data.byProvider.length > 0 && (
        <div className="p-4 rounded-xl bg-surface-secondary border border-border">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Activity size={18} />
            <Tooltip text={METRIC_TOOLTIPS.byProvider}>
              <span>By Provider</span>
            </Tooltip>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary border-b border-border">
                  <th className="pb-2">Provider</th>
                  <th className="pb-2 text-right">Requests</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.byProvider.map((provider) => (
                  <tr key={provider.provider} className="border-b border-border/50">
                    <td className="py-2 text-text-primary font-medium">{provider.provider}</td>
                    <td className="py-2 text-right text-text-secondary">{formatNumber(provider.requests)}</td>
                    <td className="py-2 text-right text-text-secondary">{formatNumber(provider.tokens)}</td>
                    <td className="py-2 text-right text-green-400">{formatCost(provider.cost)}</td>
                    <td className="py-2 text-right text-text-secondary">{provider.avgLatencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Model Breakdown */}
      {data?.byModel && data.byModel.length > 0 && (
        <div className="p-4 rounded-xl bg-surface-secondary border border-border">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <TrendingUp size={18} />
            <Tooltip text={METRIC_TOOLTIPS.byModel}>
              <span>By Model</span>
            </Tooltip>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary border-b border-border">
                  <th className="pb-2">Model</th>
                  <th className="pb-2 text-right">Requests</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((model) => (
                  <tr key={model.model} className="border-b border-border/50">
                    <td className="py-2 text-text-primary font-medium font-mono text-xs">{model.model}</td>
                    <td className="py-2 text-right text-text-secondary">{formatNumber(model.requests)}</td>
                    <td className="py-2 text-right text-text-secondary">{formatNumber(model.tokens)}</td>
                    <td className="py-2 text-right text-green-400">{formatCost(model.cost)}</td>
                    <td className="py-2 text-right text-text-secondary">{model.avgLatencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Daily Trend */}
      {data?.dailyTrend && data.dailyTrend.length > 0 && (
        <div className="p-4 rounded-xl bg-surface-secondary border border-border">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Clock size={18} />
            <Tooltip text={METRIC_TOOLTIPS.dailyTrend}>
              <span>Daily Trend (Last 7 Days)</span>
            </Tooltip>
          </h3>
          <div className="flex items-end gap-2 h-32">
            {data.dailyTrend.map((day) => {
              const maxCount = Math.max(...data.dailyTrend.map(d => d.count), 1);
              const height = (day.count / maxCount) * 100;
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-xs text-text-secondary">{day.count}</div>
                  <div
                    className="w-full bg-purple-500/50 rounded-t"
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                  <div className="text-xs text-text-secondary">
                    {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!data?.byProvider || data.byProvider.length === 0) &&
       (!data?.byModel || data.byModel.length === 0) && (
        <div className="p-8 text-center text-text-secondary">
          <Zap size={48} className="mx-auto mb-4 opacity-50" />
          <p>No embedding data available yet.</p>
          <p className="text-sm mt-2">
            Embedding metrics will appear once embedding requests are logged.
          </p>
        </div>
      )}
    </div>
  );
};

export default EmbeddingMetrics;
