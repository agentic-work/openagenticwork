/**
 * Dashboard Overview Component
 *
 * Grafana-style metrics dashboard with beautiful time-series graphs
 * Features:
 * - Real-time metrics from the platform
 * - Time range selector (1h, 6h, 12h, 24h, 7d, 30d, 90d)
 * - Theme-aware styling using CSS variables
 * - Service status indicators
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Users, MessageSquare, Zap, DollarSign,
  Image, Wrench, TrendingUp, TrendingDown, Activity, Clock, Database,
  GitBranch, Gauge, UserCheck, Terminal, Brain, Key
} from '@/shared/icons';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useAuth } from '../../../app/providers/AuthContext';
import { apiEndpoint } from '../../../utils/api';
import { useTheme } from '../../../contexts/ThemeContext';
import { LLMSankeyModal } from './LLMSankeyModal';

interface DashboardOverviewProps {
  theme: string; // Kept for backwards compat but we use resolvedTheme from context
}

interface MetricsData {
  summary: {
    totalUsers: number;
    activeUsers: number;
    totalSessions: number;
    sessionChange: number;
    totalMessages: number;
    messageChange: number;
    totalTokens: number;
    totalCost: number;
    totalImages: number;
    totalMcpCalls: number;
    totalEmbeddings: number;
    flowiseUsers?: number;
    contextWindowAvgUtil?: number;
    // NEW: Code Mode metrics
    totalCodeTokens?: number;
    totalCodeCost?: number;
    totalCodeMessages?: number;
  };
  timeSeries: {
    sessions: { timestamp: string; value: number }[];
    messages: { timestamp: string; value: number }[];
    tokenUsage: { timestamp: string; value: number }[];
    images: { timestamp: string; value: number }[];
    embeddings: { timestamp: string; value: number }[];
    contextUtilization?: { timestamp: string; value: number }[];
    // NEW: Code Mode token usage
    codeTokenUsage?: { timestamp: string; value: number }[];
  };
  modelUsage: { model: string; count: number; tokens: number; cost: number }[];
  costByModel: { model: string; data: { timestamp: string; value: number }[] }[];
  mcpToolUsage: { tool: string; count: number }[];
  // NEW: Per-user usage
  perUserUsage?: {
    userId: string;
    email: string;
    name: string;
    sessions: number;
    messages: number;
    tokens: number;
    cost: number;
    lastActive: string;
  }[];
  // NEW: Per-user time series
  perUserTimeSeries?: {
    userId: string;
    name: string;
    data: { timestamp: string; value: number }[];
  }[];
  // NEW: Context window metrics
  contextWindowMetrics?: {
    sessionsWithData: number;
    avgUtilization: number;
    maxUtilization: number;
    highUtilizationCount: number;
    totalContextTokens: number;
    avgTokensPerSession: number;
  };
  // NEW: Flowise metrics
  flowiseMetrics?: {
    enabledUsers: number;
    totalUsers: number;
    adoptionRate: number;
  };
  // NEW: Agenticode CLI metrics
  agenticodeMetrics?: {
    totalRequests: number;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalThinkingTokens: number;
    totalCost: number;
    uniqueApiKeys: number;
  };
  agenticodeTimeSeries?: {
    requests: { timestamp: string; value: number }[];
    tokens: { timestamp: string; value: number }[];
    cost: { timestamp: string; value: number }[];
  };
  agenticodeByApiKey?: {
    apiKeyId: string;
    keyName: string;
    userName: string;
    userEmail: string;
    requests: number;
    tokens: number;
    thinkingTokens: number;
    cost: number;
  }[];
  agenticodeModelUsage?: {
    model: string;
    count: number;
    tokens: number;
    cost: number;
    thinkingTokens: number;
  }[];
}

const TIME_RANGES = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '12h', label: '12h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' }
];

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ theme: _theme }) => {
  const { getAccessToken } = useAuth();
  const { resolvedTheme, accentColor } = useTheme();
  const [timeRange, setTimeRange] = useState('24h');
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isSankeyModalOpen, setIsSankeyModalOpen] = useState(false);

  // Use resolvedTheme which handles 'system' preference correctly
  const isDark = resolvedTheme === 'dark';

  // Generate chart colors using CSS variables - no hardcoded colors
  const chartColors = useMemo(() => {
    // Return CSS variable references - actual colors come from theme
    return [
      'var(--color-primary)',
      'var(--color-secondary)',
      'var(--lava-color-1, var(--color-primary))',
      'var(--lava-color-2, var(--color-secondary))',
      'var(--accent-info)'
    ];
  }, []);

  // All colors use CSS variables - no hardcoded values
  const colors = useMemo(() => ({
    // Use CSS variables for accent colors
    primary: 'var(--color-primary)',
    primaryRgb: '', // Not needed when using CSS variables with color-mix
    secondary: 'var(--color-secondary)',
    // Background colors - use CSS variables
    cardBg: 'var(--color-surface)',
    cardBorder: 'var(--color-border)',
    cardHover: 'var(--color-surfaceHover)',
    // Text colors - use CSS variables
    textPrimary: 'var(--color-text)',
    textSecondary: 'var(--color-textSecondary)',
    textMuted: 'var(--color-textMuted)',
    // Chart colors - use CSS variables
    gridLine: 'var(--ap-chart-grid, color-mix(in srgb, var(--color-text) 8%, transparent))',
    axisLine: 'var(--color-textMuted)',
    axisTick: 'var(--color-textSecondary)',
    // Tooltip - use CSS variables
    tooltipBg: 'var(--color-surfaceTertiary)',
    tooltipBorder: 'var(--color-border)',
    tooltipShadow: 'var(--color-shadow)',
    // Status colors - use CSS variables
    success: 'var(--color-success)',
    danger: 'var(--color-error)',
    // Chart gradient colors
    chartColors
  }), [chartColors]);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(apiEndpoint(`/admin/dashboard/metrics?timeRange=${timeRange}`), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-AgenticWork-Frontend': 'true'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard metrics');
      }

      const data = await response.json();
      if (data.success) {
        setMetrics(data);
        setLastRefresh(new Date());
      } else {
        throw new Error(data.error || 'Failed to fetch metrics');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, timeRange]);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (timeRange.includes('h')) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (timeRange === '7d') {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            background: colors.tooltipBg,
            border: `1px solid ${colors.tooltipBorder}`,
            borderRadius: '8px',
            padding: '8px 12px',
            boxShadow: colors.tooltipShadow
          }}
        >
          <p style={{ color: colors.textSecondary, fontSize: '11px', marginBottom: '4px' }}>
            {formatTimestamp(label)}
          </p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: colors.textPrimary, fontSize: '13px', fontWeight: 600 }}>
              {entry.name}: {formatNumber(entry.value)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Stat card component
  const StatCard = ({
    icon: Icon,
    label,
    value,
    subValue,
    change
  }: {
    icon: any;
    label: string;
    value: string | number;
    subValue?: string;
    change?: number;
  }) => (
    <div
      className="rounded-xl p-4 transition-all hover:shadow-lg"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.cardBorder}`,
        backdropFilter: 'blur(8px)'
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className="p-2 rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}
        >
          <Icon size={18} style={{ color: colors.primary }} />
        </div>
        {change !== undefined && (
          <div
            className="flex items-center gap-1 text-xs font-medium"
            style={{ color: change >= 0 ? colors.success : colors.danger }}
          >
            {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(change).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="text-2xl font-bold" style={{ color: colors.textPrimary }}>
        {typeof value === 'number' ? formatNumber(value) : value}
      </div>
      <div className="text-xs mt-1" style={{ color: colors.textSecondary }}>{label}</div>
      {subValue && (
        <div className="text-xs mt-0.5" style={{ color: colors.primary }}>{subValue}</div>
      )}
    </div>
  );

  // Area chart component
  const MetricChart = ({
    title,
    data,
    dataKey = 'value',
    chartColor = colors.chartColors[0]
  }: {
    title: string;
    data: any[];
    dataKey?: string;
    chartColor?: string;
  }) => (
    <div
      className="rounded-xl p-4"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.cardBorder}`,
        backdropFilter: 'blur(8px)'
      }}
    >
      <h3 className="text-sm font-medium mb-4" style={{ color: colors.textSecondary }}>{title}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`gradient-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity={0.4} />
                <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridLine} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTimestamp}
              tick={{ fill: colors.axisTick, fontSize: 10 }}
              axisLine={{ stroke: colors.axisLine }}
              tickLine={{ stroke: colors.axisLine }}
            />
            <YAxis
              tickFormatter={formatNumber}
              tick={{ fill: colors.axisTick, fontSize: 10 }}
              axisLine={{ stroke: colors.axisLine }}
              tickLine={{ stroke: colors.axisLine }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={chartColor}
              strokeWidth={2}
              fill={`url(#gradient-${title.replace(/\s/g, '')})`}
              name={title}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // Line chart for multi-series data
  const MultiLineChart = ({
    title,
    series
  }: {
    title: string;
    series: { model: string; data: any[] }[];
  }) => {
    const mergedData = useMemo(() => {
      const dataMap = new Map<string, any>();
      for (const s of series) {
        for (const point of s.data) {
          if (!dataMap.has(point.timestamp)) {
            dataMap.set(point.timestamp, { timestamp: point.timestamp });
          }
          dataMap.get(point.timestamp)[s.model] = point.value;
        }
      }
      return Array.from(dataMap.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    }, [series]);

    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.cardBorder}`,
          backdropFilter: 'blur(8px)'
        }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: colors.textSecondary }}>{title}</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.gridLine} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTimestamp}
                tick={{ fill: colors.axisTick, fontSize: 10 }}
                axisLine={{ stroke: colors.axisLine }}
                tickLine={{ stroke: colors.axisLine }}
              />
              <YAxis
                tickFormatter={(v) => `$${v.toFixed(2)}`}
                tick={{ fill: colors.axisTick, fontSize: 10 }}
                axisLine={{ stroke: colors.axisLine }}
                tickLine={{ stroke: colors.axisLine }}
              />
              <Tooltip content={<CustomTooltip />} />
              {series.map((s, i) => (
                <Line
                  key={s.model}
                  type="monotone"
                  dataKey={s.model}
                  stroke={colors.chartColors[i % colors.chartColors.length]}
                  strokeWidth={2}
                  dot={false}
                  name={s.model}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          {series.map((s, i) => (
            <div key={s.model} className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: colors.chartColors[i % colors.chartColors.length] }}
              />
              <span className="text-xs" style={{ color: colors.textMuted }}>{s.model}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Bar chart for model usage
  const ModelUsageChart = ({
    data,
    onTitleClick
  }: {
    data: { model: string; count: number; cost: number }[];
    onTitleClick?: () => void;
  }) => (
    <div
      className="rounded-xl p-4"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.cardBorder}`,
        backdropFilter: 'blur(8px)'
      }}
    >
      <h3
        className="text-sm font-medium mb-4 cursor-pointer hover:underline transition-all inline-flex items-center gap-2"
        style={{ color: colors.textSecondary }}
        onClick={onTitleClick}
        title="Click for interactive Sankey diagram"
      >
        LLM Model Usage
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
            color: colors.primary
          }}
        >
          Click to explore
        </span>
      </h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.slice(0, 6)} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={colors.gridLine} horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={formatNumber}
              tick={{ fill: colors.axisTick, fontSize: 10 }}
              axisLine={{ stroke: colors.axisLine }}
            />
            <YAxis
              type="category"
              dataKey="model"
              width={100}
              tick={{ fill: colors.axisTick, fontSize: 10 }}
              axisLine={{ stroke: colors.axisLine }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  return (
                    <div
                      style={{
                        background: colors.tooltipBg,
                        border: `1px solid ${colors.tooltipBorder}`,
                        borderRadius: '8px',
                        padding: '8px 12px',
                        boxShadow: colors.tooltipShadow
                      }}
                    >
                      <p style={{ color: colors.textPrimary, fontWeight: 600, fontSize: '13px' }}>{d.model}</p>
                      <p style={{ color: colors.textSecondary, fontSize: '11px' }}>Requests: {formatNumber(d.count)}</p>
                      <p style={{ color: colors.primary, fontSize: '11px' }}>Cost: ${d.cost.toFixed(2)}</p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="count" fill={colors.chartColors[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // Pie chart for MCP tool usage
  const MCPToolChart = ({ data }: { data: { tool: string; count: number }[] }) => (
    <div
      className="rounded-xl p-4"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.cardBorder}`,
        backdropFilter: 'blur(8px)'
      }}
    >
      <h3 className="text-sm font-medium mb-4" style={{ color: colors.textSecondary }}>MCP Tool Usage</h3>
      <div className="h-48 flex items-center">
        <ResponsiveContainer width="50%" height="100%">
          <PieChart>
            <Pie
              data={data.slice(0, 5)}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
              dataKey="count"
            >
              {data.slice(0, 5).map((_, index) => (
                <Cell key={`cell-${index}`} fill={colors.chartColors[index % colors.chartColors.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div
                      style={{
                        background: colors.tooltipBg,
                        border: `1px solid ${colors.tooltipBorder}`,
                        borderRadius: '8px',
                        padding: '8px 12px',
                        boxShadow: colors.tooltipShadow
                      }}
                    >
                      <p style={{ color: colors.textPrimary, fontWeight: 600, fontSize: '13px' }}>{payload[0].name}</p>
                      <p style={{ color: colors.textSecondary, fontSize: '11px' }}>{payload[0].value} calls</p>
                    </div>
                  );
                }
                return null;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-2">
          {data.slice(0, 5).map((item, i) => (
            <div key={item.tool} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: colors.chartColors[i % colors.chartColors.length] }}
                />
                <span className="text-xs truncate max-w-[120px]" style={{ color: colors.textMuted }}>
                  {item.tool}
                </span>
              </div>
              <span className="text-xs font-medium" style={{ color: colors.textPrimary }}>{item.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="p-8 text-center">
        <Activity size={48} className="mx-auto mb-4" style={{ color: colors.danger }} />
        <h3 className="text-lg font-medium mb-2" style={{ color: colors.textPrimary }}>Failed to load metrics</h3>
        <p className="mb-4" style={{ color: colors.textSecondary }}>{error}</p>
        <button
          onClick={fetchMetrics}
          className="px-4 py-2 rounded-lg transition-colors"
          style={{ background: colors.primary, color: 'var(--color-text)' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: colors.textPrimary }}>Dashboard Overview</h2>
          <p className="text-sm" style={{ color: colors.textSecondary }}>Real-time system performance metrics</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div
            className="flex items-center rounded-lg p-1"
            style={{ background: 'color-mix(in srgb, var(--color-text) 5%, transparent)' }}
          >
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                style={{
                  background: timeRange === range.value ? colors.primary : 'transparent',
                  color: timeRange === range.value ? 'var(--color-text)' : colors.textSecondary
                }}
              >
                {range.label}
              </button>
            ))}
          </div>
          {/* Refresh Button */}
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
              color: colors.textSecondary
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="text-xs">Refresh</span>
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && !metrics && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-12 h-12 border-4 rounded-full animate-spin"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-primary) 20%, transparent)',
                borderTopColor: colors.primary
              }}
            />
            <p style={{ color: colors.textSecondary }}>Loading metrics...</p>
          </div>
        </div>
      )}

      {metrics && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <StatCard icon={Users} label="Total Users" value={metrics.summary.totalUsers} subValue={`${metrics.summary.activeUsers} active`} />
            <StatCard icon={MessageSquare} label="Chat Sessions" value={metrics.summary.totalSessions} change={metrics.summary.sessionChange} />
            <StatCard icon={Activity} label="Messages" value={metrics.summary.totalMessages} change={metrics.summary.messageChange} />
            <StatCard icon={Zap} label="Chat Tokens" value={metrics.summary.totalTokens} />
            {(metrics.summary.totalCodeTokens ?? 0) > 0 && (
              <StatCard icon={GitBranch} label="Code Tokens" value={metrics.summary.totalCodeTokens || 0} subValue={`${metrics.summary.totalCodeMessages || 0} requests`} />
            )}
            <StatCard icon={DollarSign} label="Total Cost" value={`$${((metrics.summary.totalCost || 0) + (metrics.summary.totalCodeCost || 0)).toFixed(2)}`} subValue={metrics.summary.totalCodeCost ? `Chat: $${metrics.summary.totalCost.toFixed(2)} | Code: $${metrics.summary.totalCodeCost.toFixed(2)}` : undefined} />
          </div>

          {/* Additional Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <StatCard icon={Image} label="Images Generated" value={metrics.summary.totalImages} />
            <StatCard icon={Wrench} label="MCP Tool Calls" value={metrics.summary.totalMcpCalls} />
            <StatCard icon={Database} label="Embeddings Stored" value={metrics.summary.totalEmbeddings || 0} />
            <StatCard
              icon={GitBranch}
              label="Flowise Users"
              value={metrics.flowiseMetrics?.enabledUsers || 0}
              subValue={`${metrics.flowiseMetrics?.adoptionRate || 0}% adoption`}
            />
            <StatCard
              icon={Gauge}
              label="Avg Context Usage"
              value={`${(metrics.contextWindowMetrics?.avgUtilization || 0).toFixed(1)}%`}
              subValue={`${metrics.contextWindowMetrics?.highUtilizationCount || 0} high usage`}
            />
            <div
              className="rounded-xl p-4 flex items-center justify-between"
              style={{
                background: colors.cardBg,
                border: `1px solid ${colors.cardBorder}`,
                backdropFilter: 'blur(8px)'
              }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-success) 10%, transparent)' }}>
                  <Clock size={18} style={{ color: colors.success }} />
                </div>
                <div>
                  <div className="text-sm" style={{ color: colors.textPrimary }}>Last Updated</div>
                  <div className="text-xs" style={{ color: colors.textSecondary }}>
                    {lastRefresh.toLocaleTimeString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: colors.success }} />
                <span className="text-xs" style={{ color: colors.success }}>Live</span>
              </div>
            </div>
          </div>

          {/* Main Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricChart title="Chat Sessions" data={metrics.timeSeries.sessions} chartColor={colors.chartColors[0]} />
            <MetricChart title="Messages" data={metrics.timeSeries.messages} chartColor={colors.chartColors[1]} />
            <MetricChart title="Chat Token Usage" data={metrics.timeSeries.tokenUsage} chartColor={colors.chartColors[2]} />
            {metrics.timeSeries.codeTokenUsage && metrics.timeSeries.codeTokenUsage.some(p => p.value > 0) && (
              <MetricChart title="Code Mode Token Usage" data={metrics.timeSeries.codeTokenUsage} chartColor="var(--color-secondary)" />
            )}
            {metrics.costByModel.length > 0 && (
              <MultiLineChart title="Cost by Model" series={metrics.costByModel} />
            )}
          </div>

          {/* Bottom Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {metrics.modelUsage.length > 0 && (
              <ModelUsageChart
                data={metrics.modelUsage}
                onTitleClick={() => setIsSankeyModalOpen(true)}
              />
            )}
            {metrics.mcpToolUsage.length > 0 && <MCPToolChart data={metrics.mcpToolUsage} />}
          </div>

          {/* Images and Embeddings Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {metrics.timeSeries.images?.some(p => p.value > 0) && (
              <MetricChart title="Images Generated" data={metrics.timeSeries.images} chartColor="var(--color-secondary)" />
            )}
            {metrics.timeSeries.embeddings?.some(p => p.value > 0) && (
              <MetricChart title="Embeddings Stored" data={metrics.timeSeries.embeddings} chartColor="var(--accent-info)" />
            )}
          </div>

          {/* Context Utilization Chart */}
          {metrics.timeSeries.contextUtilization && metrics.timeSeries.contextUtilization.some(p => p.value > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MetricChart
                title="Context Window Utilization %"
                data={metrics.timeSeries.contextUtilization}
                chartColor="var(--color-warning)"
              />
              {/* Context Window Summary Card */}
              <div
                className="rounded-xl p-4"
                style={{
                  background: colors.cardBg,
                  border: `1px solid ${colors.cardBorder}`,
                  backdropFilter: 'blur(8px)'
                }}
              >
                <h3 className="text-sm font-medium mb-4" style={{ color: colors.textSecondary }}>
                  Context Window Summary
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
                    <div className="text-2xl font-bold" style={{ color: colors.primary }}>
                      {metrics.contextWindowMetrics?.sessionsWithData || 0}
                    </div>
                    <div className="text-xs" style={{ color: colors.textMuted }}>Sessions Tracked</div>
                  </div>
                  <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)' }}>
                    <div className="text-2xl font-bold" style={{ color: 'var(--color-warning)' }}>
                      {(metrics.contextWindowMetrics?.maxUtilization || 0).toFixed(1)}%
                    </div>
                    <div className="text-xs" style={{ color: colors.textMuted }}>Max Utilization</div>
                  </div>
                  <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, transparent)' }}>
                    <div className="text-2xl font-bold" style={{ color: 'var(--color-error)' }}>
                      {metrics.contextWindowMetrics?.highUtilizationCount || 0}
                    </div>
                    <div className="text-xs" style={{ color: colors.textMuted }}>High Usage (≥80%)</div>
                  </div>
                  <div className="text-center p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-success) 10%, transparent)' }}>
                    <div className="text-2xl font-bold" style={{ color: 'var(--color-success)' }}>
                      {formatNumber(metrics.contextWindowMetrics?.avgTokensPerSession || 0)}
                    </div>
                    <div className="text-xs" style={{ color: colors.textMuted }}>Avg Tokens/Session</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Per-User Usage Table */}
          {metrics.perUserUsage && metrics.perUserUsage.length > 0 && (
            <div
              className="rounded-xl p-4"
              style={{
                background: colors.cardBg,
                border: `1px solid ${colors.cardBorder}`,
                backdropFilter: 'blur(8px)'
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textSecondary }}>
                  <UserCheck size={16} />
                  Top Users by Cost
                </h3>
                <span className="text-xs" style={{ color: colors.textMuted }}>
                  {metrics.perUserUsage.length} users
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${colors.cardBorder}` }}>
                      <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>User</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Sessions</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Messages</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Tokens</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Cost</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.perUserUsage.slice(0, 10).map((user, index) => (
                      <tr
                        key={user.userId}
                        style={{
                          borderBottom: index < 9 ? `1px solid ${colors.cardBorder}` : 'none'
                        }}
                      >
                        <td className="py-2 px-3">
                          <div style={{ color: colors.textPrimary }} className="font-medium truncate max-w-[200px]">
                            {user.name || 'Unknown'}
                          </div>
                          <div className="text-xs truncate max-w-[200px]" style={{ color: colors.textMuted }}>
                            {user.email}
                          </div>
                        </td>
                        <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                          {user.sessions}
                        </td>
                        <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                          {formatNumber(user.messages)}
                        </td>
                        <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                          {formatNumber(user.tokens)}
                        </td>
                        <td className="text-right py-2 px-3 font-medium" style={{ color: colors.primary }}>
                          ${user.cost.toFixed(2)}
                        </td>
                        <td className="text-right py-2 px-3 text-xs" style={{ color: colors.textMuted }}>
                          {new Date(user.lastActive).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Per-User Cost Time Series */}
          {metrics.perUserTimeSeries && metrics.perUserTimeSeries.length > 0 && (
            <MultiLineChart
              title="Cost by User (Top 10)"
              series={metrics.perUserTimeSeries.map(u => ({ model: u.name, data: u.data }))}
            />
          )}

          {/* NEW: Agenticode CLI Usage Section */}
          {metrics.agenticodeMetrics && metrics.agenticodeMetrics.totalRequests > 0 && (
            <>
              {/* Section Header */}
              <div className="flex items-center gap-3 mt-8 mb-4">
                <div
                  className="p-2 rounded-lg"
                  style={{ background: 'color-mix(in srgb, var(--color-secondary) 15%, transparent)' }}
                >
                  <Terminal size={20} style={{ color: 'var(--color-secondary)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold" style={{ color: colors.textPrimary }}>Agenticode CLI Usage</h3>
                  <p className="text-xs" style={{ color: colors.textSecondary }}>
                    Metrics from agenticode-cli API requests
                  </p>
                </div>
              </div>

              {/* Agenticode Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <StatCard
                  icon={Terminal}
                  label="CLI Requests"
                  value={metrics.agenticodeMetrics.totalRequests}
                  subValue={`${metrics.agenticodeMetrics.uniqueApiKeys} API keys`}
                />
                <StatCard
                  icon={Zap}
                  label="CLI Tokens"
                  value={metrics.agenticodeMetrics.totalTokens}
                  subValue={`In: ${formatNumber(metrics.agenticodeMetrics.totalPromptTokens)} | Out: ${formatNumber(metrics.agenticodeMetrics.totalCompletionTokens)}`}
                />
                <StatCard
                  icon={Brain}
                  label="Thinking Tokens"
                  value={metrics.agenticodeMetrics.totalThinkingTokens}
                  subValue={metrics.agenticodeMetrics.totalThinkingTokens > 0 ? 'Extended thinking enabled' : 'No thinking used'}
                />
                <StatCard
                  icon={DollarSign}
                  label="CLI Cost"
                  value={`$${metrics.agenticodeMetrics.totalCost.toFixed(2)}`}
                />
                <StatCard
                  icon={Key}
                  label="Active API Keys"
                  value={metrics.agenticodeMetrics.uniqueApiKeys}
                />
              </div>

              {/* Agenticode Time Series Charts */}
              {metrics.agenticodeTimeSeries && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  {metrics.agenticodeTimeSeries.requests.some(p => p.value > 0) && (
                    <MetricChart
                      title="CLI Requests Over Time"
                      data={metrics.agenticodeTimeSeries.requests}
                      chartColor="var(--color-secondary)"
                    />
                  )}
                  {metrics.agenticodeTimeSeries.tokens.some(p => p.value > 0) && (
                    <MetricChart
                      title="CLI Token Usage Over Time"
                      data={metrics.agenticodeTimeSeries.tokens}
                      chartColor="var(--color-primary)"
                    />
                  )}
                </div>
              )}

              {/* Agenticode API Key Usage Table */}
              {metrics.agenticodeByApiKey && metrics.agenticodeByApiKey.length > 0 && (
                <div
                  className="rounded-xl p-4 mt-4"
                  style={{
                    background: colors.cardBg,
                    border: `1px solid ${colors.cardBorder}`,
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textSecondary }}>
                      <Key size={16} />
                      CLI Usage by API Key
                    </h3>
                    <span className="text-xs" style={{ color: colors.textMuted }}>
                      {metrics.agenticodeByApiKey.length} keys
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.cardBorder}` }}>
                          <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>API Key</th>
                          <th className="text-left py-2 px-3 font-medium" style={{ color: colors.textMuted }}>User</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Requests</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Tokens</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Thinking</th>
                          <th className="text-right py-2 px-3 font-medium" style={{ color: colors.textMuted }}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.agenticodeByApiKey.slice(0, 10).map((key, index) => (
                          <tr
                            key={key.apiKeyId}
                            style={{
                              borderBottom: index < Math.min(9, metrics.agenticodeByApiKey!.length - 1) ? `1px solid ${colors.cardBorder}` : 'none'
                            }}
                          >
                            <td className="py-2 px-3">
                              <div style={{ color: colors.textPrimary }} className="font-medium truncate max-w-[150px]">
                                {key.keyName}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <div style={{ color: colors.textSecondary }} className="truncate max-w-[150px]">
                                {key.userName || key.userEmail}
                              </div>
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                              {formatNumber(key.requests)}
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: colors.textSecondary }}>
                              {formatNumber(key.tokens)}
                            </td>
                            <td className="text-right py-2 px-3" style={{ color: key.thinkingTokens > 0 ? 'var(--color-secondary)' : colors.textMuted }}>
                              {key.thinkingTokens > 0 ? formatNumber(key.thinkingTokens) : '-'}
                            </td>
                            <td className="text-right py-2 px-3 font-medium" style={{ color: colors.primary }}>
                              ${key.cost.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Agenticode Model Usage */}
              {metrics.agenticodeModelUsage && metrics.agenticodeModelUsage.length > 0 && (
                <div
                  className="rounded-xl p-4 mt-4"
                  style={{
                    background: colors.cardBg,
                    border: `1px solid ${colors.cardBorder}`,
                    backdropFilter: 'blur(8px)'
                  }}
                >
                  <h3 className="text-sm font-medium mb-4" style={{ color: colors.textSecondary }}>
                    CLI Model Usage
                  </h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metrics.agenticodeModelUsage.slice(0, 6)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke={colors.gridLine} horizontal={false} />
                        <XAxis
                          type="number"
                          tickFormatter={formatNumber}
                          tick={{ fill: colors.axisTick, fontSize: 10 }}
                          axisLine={{ stroke: colors.axisLine }}
                        />
                        <YAxis
                          type="category"
                          dataKey="model"
                          width={120}
                          tick={{ fill: colors.axisTick, fontSize: 10 }}
                          axisLine={{ stroke: colors.axisLine }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const d = payload[0].payload;
                              return (
                                <div
                                  style={{
                                    background: colors.tooltipBg,
                                    border: `1px solid ${colors.tooltipBorder}`,
                                    borderRadius: '8px',
                                    padding: '8px 12px',
                                    boxShadow: colors.tooltipShadow
                                  }}
                                >
                                  <p style={{ color: colors.textPrimary, fontWeight: 600, fontSize: '13px' }}>{d.model}</p>
                                  <p style={{ color: colors.textSecondary, fontSize: '11px' }}>Requests: {formatNumber(d.count)}</p>
                                  <p style={{ color: colors.textSecondary, fontSize: '11px' }}>Tokens: {formatNumber(d.tokens)}</p>
                                  {d.thinkingTokens > 0 && (
                                    <p style={{ color: 'var(--color-secondary)', fontSize: '11px' }}>Thinking: {formatNumber(d.thinkingTokens)}</p>
                                  )}
                                  <p style={{ color: colors.primary, fontSize: '11px' }}>Cost: ${d.cost.toFixed(2)}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="count" fill="var(--color-secondary)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* LLM Sankey Modal */}
      <LLMSankeyModal
        isOpen={isSankeyModalOpen}
        onClose={() => setIsSankeyModalOpen(false)}
        modelUsage={metrics?.modelUsage || []}
        timeRange={timeRange}
      />
    </div>
  );
};

export default DashboardOverview;
