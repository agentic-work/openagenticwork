import React, { useState, useEffect } from 'react';
// Keep basic icons from lucide
import { BarChart } from '@/shared/icons';
// Custom badass icons
import { Activity, Zap, TrendingUp, Timer as Clock, RefreshCw, AlertCircle, CheckCircle, DollarSign, Cpu } from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

interface MonitoringViewProps {
  theme: string;
}

export const MonitoringView: React.FC<MonitoringViewProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24h');
  const [mcpMetrics, setMcpMetrics] = useState<any>(null);
  const [llmMetrics, setLlmMetrics] = useState<any>(null);

  const fetchMetrics = async () => {
    try {
      setLoading(true);

      const [mcpRes, llmRes] = await Promise.all([
        fetch(`/api/admin/metrics/mcp?timeRange=${timeRange}`, {
          headers: { ...getAuthHeaders() }
        }),
        fetch(`/api/admin/metrics/llm?timeRange=${timeRange}`, {
          headers: { ...getAuthHeaders() }
        })
      ]);

      if (mcpRes.ok) {
        const data = await mcpRes.json();
        setMcpMetrics(data);
      }

      if (llmRes.ok) {
        const data = await llmRes.json();
        setLlmMetrics(data);
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [timeRange]);

  const formatNumber = (num: number) => num.toLocaleString('en-US');

  if (loading && !mcpMetrics && !llmMetrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin" style={{ color: 'var(--color-text)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
            Monitoring & Logs
          </h2>
          <p style={{ color: 'var(--color-textSecondary)' }}>
            MCP tool execution and LLM usage metrics
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            className="px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* MCP Metrics */}
      {mcpMetrics && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Zap className="w-5 h-5 text-primary-500" />
            MCP Tool Execution
          </h3>

          {/* MCP Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Total Calls
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                {formatNumber(mcpMetrics.summary.totalCalls)}
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Success Rate
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                {mcpMetrics.summary.successRate}%
              </div>
              <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {formatNumber(mcpMetrics.summary.successfulCalls)} / {formatNumber(mcpMetrics.summary.failedCalls)}
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-purple-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Avg Execution Time
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                {mcpMetrics.summary.avgExecutionTime}ms
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Failed Calls
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                {formatNumber(mcpMetrics.summary.failedCalls)}
              </div>
            </div>
          </div>

          {/* Top Tools */}
          {mcpMetrics.toolPerformance && mcpMetrics.toolPerformance.length > 0 && (
            <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <h4 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                Top Tools by Usage
              </h4>
              <div className="space-y-3">
                {mcpMetrics.toolPerformance.slice(0, 10).map((tool: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ color: 'var(--color-text)', fontWeight: '500' }}>{tool.toolName}</span>
                        <span style={{ color: tool.successRate > 95 ? 'var(--color-success)' : tool.successRate > 80 ? 'var(--color-warning)' : 'var(--color-error)', fontSize: '0.75rem' }}>
                          {tool.successRate}% success
                        </span>
                      </div>
                      <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem' }}>
                        {formatNumber(tool.totalCalls)} calls • {tool.avgExecutionTime}ms avg
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* LLM Metrics */}
      {llmMetrics && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Cpu className="w-5 h-5 text-primary-500" />
            LLM Usage
          </h3>

          {/* LLM Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <BarChart className="w-4 h-4 text-blue-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Total Messages
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                {formatNumber(llmMetrics.summary.totalMessages)}
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Total Tokens
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                {formatNumber(llmMetrics.summary.totalTokens)}
              </div>
              <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {formatNumber(llmMetrics.summary.totalTokensInput)} in / {formatNumber(llmMetrics.summary.totalTokensOutput)} out
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-yellow-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Total Cost
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                ${llmMetrics.summary.totalCost}
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-purple-500" />
                <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.875rem' }}>
                  Avg Per Message
                </span>
              </div>
              <div style={{ color: 'var(--color-text)', fontSize: '1.875rem', fontWeight: 'bold' }}>
                {formatNumber(llmMetrics.summary.avgTokensPerMessage)}
              </div>
              <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                tokens • ${llmMetrics.summary.avgCostPerMessage}
              </div>
            </div>
          </div>

          {/* Top Models */}
          {llmMetrics.topModels && llmMetrics.topModels.length > 0 && (
            <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <h4 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                Top Models by Usage
              </h4>
              <div className="space-y-3">
                {llmMetrics.topModels.slice(0, 10).map((model: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span style={{ color: 'var(--color-text)', fontWeight: '500' }}>{model.model}</span>
                        <span style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem' }}>
                          {formatNumber(model.count)} calls
                        </span>
                      </div>
                      <div style={{ color: 'var(--color-textSecondary)', fontSize: '0.75rem' }}>
                        {formatNumber(model.totalTokens)} tokens • ${(Number(model.cost) || 0).toFixed(4)} cost
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
