/**
 * Performance Metrics Component
 * Displays real-time Prometheus metrics for all services
 * Shows CPU, Memory, Disk, Network, Redis cache hits, Milvus collection calls
 * Uses theme system (CSS variables) for consistent styling
 */

import React, { useState, useEffect } from 'react';
// Keep basic icons from lucide
import { HardDrive, Network } from '@/shared/icons';
// Custom badass icons
import { Activity, Cpu, Database, Server, TrendingUp, Zap, RefreshCw, AlertCircle, CheckCircle } from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

interface PerformanceMetricsProps {
  theme: string;
}

interface ServiceMetrics {
  serviceName: string;
  status: 'healthy' | 'degraded' | 'down';
  cpu: {
    usage: number; // percentage
    cores: number;
  };
  memory: {
    used: number; // bytes
    total: number; // bytes
    percentage: number;
  };
  disk: {
    used: number; // bytes
    total: number; // bytes
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
}

interface RedisMetrics {
  cacheHitRate: number; // percentage
  cacheHits: number;
  cacheMisses: number;
  totalKeys: number;
  evictedKeys: number;
  memoryUsed: number; // bytes
  memoryPeak: number; // bytes
  connectedClients: number;
  commandsPerSecond: number;
}

interface MilvusMetrics {
  collections: {
    name: string;
    entityCount: number;
    indexType: string;
    status: string;
  }[];
  totalQueries: number;
  avgQueryLatency: number; // ms
  totalInserts: number;
}

const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceMetrics[]>([]);
  const [redisMetrics, setRedisMetrics] = useState<RedisMetrics | null>(null);
  const [milvusMetrics, setMilvusMetrics] = useState<MilvusMetrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchMetrics = async () => {
    try {
      setLoading(true);

      // Fetch service metrics from Prometheus
      const servicesResponse = await fetch('/api/admin/metrics/services', {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (servicesResponse.ok) {
        const data = await servicesResponse.json();
        setServices(data.services || []);
      }

      // Fetch Redis metrics
      const redisResponse = await fetch('/api/admin/metrics/redis', {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (redisResponse.ok) {
        const data = await redisResponse.json();
        setRedisMetrics(data.metrics || data);
      }

      // Fetch Milvus metrics
      const milvusResponse = await fetch('/api/admin/metrics/milvus', {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (milvusResponse.ok) {
        const data = await milvusResponse.json();
        setMilvusMetrics(data.metrics || data);
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch performance metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchMetrics();
    }, 30000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Format number with commas
  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US');
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-500';
      case 'degraded':
        return 'text-yellow-500';
      case 'down':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  // Get percentage color
  const getPercentageColor = (percentage: number) => {
    if (percentage < 50) return 'text-green-500';
    if (percentage < 80) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (loading && services.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        <span className="ml-4 text-lg text-text-secondary">Loading performance metrics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">
            Performance Metrics
          </h2>
          <p className="text-text-secondary">
            Real-time system performance from Prometheus
          </p>
        </div>

        {/* Refresh Controls */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">
            Updated: {lastUpdated.toLocaleTimeString()}
          </span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            <span className="text-sm text-text-primary">Auto-refresh</span>
          </label>
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

      {/* Service Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => (
          <div
            key={service.serviceName}
            className="glass-card p-6 hover:shadow-lg transition-all duration-150 ease-out"
            style={{
              background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)'
            }}
          >
            {/* Service Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
                  <Server size={20} style={{ color: 'var(--color-primary)' }} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">{service.serviceName}</h3>
                  <div className="flex items-center gap-1 mt-1">
                    {service.status === 'healthy' ? (
                      <CheckCircle size={14} className="text-green-500" />
                    ) : (
                      <AlertCircle size={14} className={getStatusColor(service.status)} />
                    )}
                    <span className={`text-xs font-medium ${getStatusColor(service.status)}`}>
                      {service.status}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="space-y-3">
              {/* CPU */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-text-secondary flex items-center gap-1">
                    <Cpu size={12} />
                    CPU
                  </span>
                  <span className={`text-sm font-bold ${getPercentageColor(service.cpu?.usage ?? 0)}`}>
                    {(service.cpu?.usage ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${service.cpu.usage}%`,
                      backgroundColor: service.cpu.usage < 50 ? 'var(--color-success)' : service.cpu.usage < 80 ? 'var(--color-warning)' : 'var(--color-error)'
                    }}
                  />
                </div>
                <span className="text-xs text-text-secondary mt-1">{service.cpu.cores} cores</span>
              </div>

              {/* Memory */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-text-secondary flex items-center gap-1">
                    <Activity size={12} />
                    Memory
                  </span>
                  <span className={`text-sm font-bold ${getPercentageColor(service.memory?.percentage ?? 0)}`}>
                    {(service.memory?.percentage ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${service.memory.percentage}%`,
                      backgroundColor: service.memory.percentage < 50 ? 'var(--color-success)' : service.memory.percentage < 80 ? 'var(--color-warning)' : 'var(--color-error)'
                    }}
                  />
                </div>
                <span className="text-xs text-text-secondary mt-1">
                  {formatBytes(service.memory.used)} / {formatBytes(service.memory.total)}
                </span>
              </div>

              {/* Disk */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-text-secondary flex items-center gap-1">
                    <HardDrive size={12} />
                    Disk
                  </span>
                  <span className={`text-sm font-bold ${getPercentageColor(service.disk?.percentage ?? 0)}`}>
                    {(service.disk?.percentage ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${service.disk.percentage}%`,
                      backgroundColor: service.disk.percentage < 50 ? 'var(--color-success)' : service.disk.percentage < 80 ? 'var(--color-warning)' : 'var(--color-error)'
                    }}
                  />
                </div>
                <span className="text-xs text-text-secondary mt-1">
                  {formatBytes(service.disk.used)} / {formatBytes(service.disk.total)}
                </span>
              </div>

              {/* Network */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary flex items-center gap-1">
                    <Network size={12} />
                    Network
                  </span>
                  <div className="text-right">
                    <div className="text-xs text-green-500">
                      ↓ {formatBytes(service.network.bytesIn)}
                    </div>
                    <div className="text-xs text-blue-500">
                      ↑ {formatBytes(service.network.bytesOut)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Redis Metrics */}
      {redisMetrics && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
              <Database size={24} style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-text-primary">Redis Cache Performance</h3>
              <p className="text-sm text-text-secondary">Cache hit rates and memory usage</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-secondary rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Cache Hit Rate</span>
                <TrendingUp size={14} className="text-green-500" />
              </div>
              <p className="text-2xl font-bold text-green-500">{(redisMetrics.cacheHitRate ?? 0).toFixed(2)}%</p>
              <p className="text-xs text-text-secondary mt-1">
                {formatNumber(redisMetrics.cacheHits ?? 0)} hits / {formatNumber(redisMetrics.cacheMisses ?? 0)} misses
              </p>
            </div>

            <div className="bg-surface-secondary rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Total Keys</span>
                <Zap size={14} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(redisMetrics.totalKeys)}</p>
              <p className="text-xs text-text-secondary mt-1">
                {formatNumber(redisMetrics.evictedKeys)} evicted
              </p>
            </div>

            <div className="bg-surface-secondary rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Memory Usage</span>
                <Activity size={14} className="text-purple-500" />
              </div>
              <p className="text-2xl font-bold text-text-primary">{formatBytes(redisMetrics.memoryUsed)}</p>
              <p className="text-xs text-text-secondary mt-1">
                Peak: {formatBytes(redisMetrics.memoryPeak)}
              </p>
            </div>

            <div className="bg-surface-secondary rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-secondary">Performance</span>
                <Cpu size={14} className="text-orange-500" />
              </div>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(redisMetrics.commandsPerSecond)}</p>
              <p className="text-xs text-text-secondary mt-1">
                commands/sec | {redisMetrics.connectedClients} clients
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Milvus Metrics */}
      {milvusMetrics && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
              <Database size={24} style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-text-primary">Milvus Vector Database</h3>
              <p className="text-sm text-text-secondary">Collection metrics and query performance</p>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-surface-secondary rounded-lg p-4">
              <span className="text-xs text-text-secondary">Total Queries</span>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(milvusMetrics.totalQueries)}</p>
            </div>
            <div className="bg-surface-secondary rounded-lg p-4">
              <span className="text-xs text-text-secondary">Avg Query Latency</span>
              <p className="text-2xl font-bold text-text-primary">{(milvusMetrics.avgQueryLatency ?? 0).toFixed(2)}ms</p>
            </div>
            <div className="bg-surface-secondary rounded-lg p-4">
              <span className="text-xs text-text-secondary">Total Inserts</span>
              <p className="text-2xl font-bold text-text-primary">{formatNumber(milvusMetrics.totalInserts)}</p>
            </div>
          </div>

          {/* Collections */}
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-3">Collections</h4>
            <div className="space-y-2">
              {milvusMetrics.collections.map((collection, idx) => (
                <div key={idx} className="bg-surface-secondary rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-text-primary">{collection.name}</p>
                    <p className="text-xs text-text-secondary">
                      Index: {collection.indexType} | Status: {collection.status}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-text-primary">{formatNumber(collection.entityCount)}</p>
                    <p className="text-xs text-text-secondary">entities</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PerformanceMetrics;
