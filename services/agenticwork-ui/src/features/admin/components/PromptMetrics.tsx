/**
 * Prompt Metrics Component
 * Displays which prompts/templates/injections are used per chat session
 * Shows system prompts, templates, and MCP context injections
 */

import React, { useState, useEffect } from 'react';
// Keep basic/UI icons from lucide
import {
  FileText, MessageSquare, User, Calendar, Filter, Search,
  ChevronDown, ChevronUp, Sparkles, Hash, Check, X
} from '@/shared/icons';
// Custom badass icons
import { Database, Timer as Clock } from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

interface PromptMetricsProps {
  theme: string;
}

interface PromptMetricData {
  id: string;
  sessionId: string;
  messageId?: string;
  userId: string;
  userName: string;
  userEmail: string;
  timestamp: string;

  // Template information
  baseTemplateId?: number;
  baseTemplateName?: string;
  domainTemplateId?: number;
  domainTemplateName?: string;

  // System prompt
  systemPrompt?: string;
  systemPromptLength?: number;

  // Techniques
  appliedTechniques: string[];
  tokensAdded: number;

  // Context injections
  hasFormatting: boolean;
  hasMcpContext: boolean;
  hasRAG: boolean;
  hasMemory: boolean;
  hasAzureSdkDocs: boolean;

  // Context counts
  ragDocsCount: number;
  ragChatsCount: number;
  memoryCount: number;
  mcpToolsCount: number;

  // Metadata
  metadata?: Record<string, any>;
}

interface AggregateStats {
  totalRequests: number;
  uniqueSessions: number;
  uniqueUsers: number;
  totalPrompts: number;
  mostUsedTechniques: Array<{ technique: string; count: number }>;
  avgTokensAdded: number;
  avgSystemPromptLength: number;

  // Template stats
  baseTemplatesUsed: number;
  domainTemplatesUsed: number;
  mostUsedBaseTemplate?: [string, number];
  mostUsedDomainTemplate?: [string, number];

  // Context injection stats
  formattingInjections: number;
  mcpContextInjections: number;
  ragContextInjections: number;
  memoryContextInjections: number;
  azureSdkDocsInjections: number;

  // Average context counts
  avgRagDocsCount: number;
  avgRagChatsCount: number;
  avgMemoryCount: number;
  avgMcpToolsCount: number;
}

const PromptMetrics: React.FC<PromptMetricsProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PromptMetricData[]>([]);
  const [aggregateStats, setAggregateStats] = useState<AggregateStats | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('7d');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTechnique, setFilterTechnique] = useState('all');

  useEffect(() => {
    const fetchPromptMetrics = async () => {
      try {
        setLoading(true);

        const response = await fetch(`/api/admin/analytics/prompt-metrics?timeRange=${timeRange}`, {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setMetrics(data.metrics || []);
          setAggregateStats(data.aggregate || null);
        }
      } catch (error) {
        console.error('Failed to fetch prompt metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPromptMetrics();
  }, [timeRange, getAuthHeaders]);

  // Filter metrics based on search and technique filter
  const filteredMetrics = metrics.filter(metric => {
    const matchesSearch = searchTerm === '' ||
      metric.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      metric.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      metric.sessionId.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTechnique = filterTechnique === 'all' ||
      metric.appliedTechniques.includes(filterTechnique);

    return matchesSearch && matchesTechnique;
  });

  // Get all unique techniques for filter dropdown
  const allTechniques = Array.from(
    new Set(metrics.flatMap(m => m.appliedTechniques))
  ).sort();

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        <span className="ml-4 text-lg text-text-secondary">Loading prompt metrics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">
            Prompt Metrics
          </h2>
          <p className="text-text-secondary">
            Track which prompts, templates, and injections are used per chat session
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
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      {/* Aggregate Statistics Cards */}
      {aggregateStats && (
        <>
          {/* Main Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="glass-card p-6 hover:shadow-lg transition-all duration-150 ease-out"
              style={{
                background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)'
              }}>
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
                  <MessageSquare size={24} style={{ color: 'var(--color-primary)' }} />
                </div>
              </div>
              <h3 className="text-sm font-medium text-text-secondary">Total Requests</h3>
              <p className="text-3xl font-bold text-text-primary mt-1">
                {formatNumber(aggregateStats.totalRequests)}
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Across {formatNumber(aggregateStats.uniqueSessions)} sessions
              </p>
            </div>

            <div className="glass-card p-6 hover:shadow-lg transition-all duration-150 ease-out"
              style={{
                background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)'
              }}>
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
                  <User size={24} style={{ color: 'var(--color-primary)' }} />
                </div>
              </div>
              <h3 className="text-sm font-medium text-text-secondary">Unique Users</h3>
              <p className="text-3xl font-bold text-text-primary mt-1">
                {formatNumber(aggregateStats.uniqueUsers)}
              </p>
            </div>

            <div className="glass-card p-6 hover:shadow-lg transition-all duration-150 ease-out"
              style={{
                background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)'
              }}>
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
                  <FileText size={24} style={{ color: 'var(--color-primary)' }} />
                </div>
              </div>
              <h3 className="text-sm font-medium text-text-secondary">Templates Used</h3>
              <p className="text-3xl font-bold text-text-primary mt-1">
                {formatNumber(aggregateStats.domainTemplatesUsed)}
              </p>
              <p className="text-xs text-text-secondary mt-1">
                Domain templates
              </p>
            </div>

            <div className="glass-card p-6 hover:shadow-lg transition-all duration-150 ease-out"
              style={{
                background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surfaceSecondary) 100%)'
              }}>
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-primary-500)/10' }}>
                  <Sparkles size={24} style={{ color: 'var(--color-primary)' }} />
                </div>
              </div>
              <h3 className="text-sm font-medium text-text-secondary">Avg Tokens Added</h3>
              <p className="text-3xl font-bold text-text-primary mt-1">
                {formatNumber(Math.round(aggregateStats.avgTokensAdded))}
              </p>
            </div>
          </div>

          {/* Context Injection Stats */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Context Injections</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-surface-secondary rounded-lg p-4">
                <p className="text-xs text-text-secondary mb-1">Formatting</p>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(aggregateStats.formattingInjections)}</p>
              </div>
              <div className="bg-surface-secondary rounded-lg p-4">
                <p className="text-xs text-text-secondary mb-1">MCP Context</p>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(aggregateStats.mcpContextInjections)}</p>
              </div>
              <div className="bg-surface-secondary rounded-lg p-4">
                <p className="text-xs text-text-secondary mb-1">RAG Context</p>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(aggregateStats.ragContextInjections)}</p>
              </div>
              <div className="bg-surface-secondary rounded-lg p-4">
                <p className="text-xs text-text-secondary mb-1">Memory</p>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(aggregateStats.memoryContextInjections)}</p>
              </div>
              <div className="bg-surface-secondary rounded-lg p-4">
                <p className="text-xs text-text-secondary mb-1">Azure SDK Docs</p>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(aggregateStats.azureSdkDocsInjections)}</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Most Used Techniques */}
      {aggregateStats && aggregateStats.mostUsedTechniques.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Most Used Techniques</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {aggregateStats.mostUsedTechniques.map((tech, idx) => (
              <div key={idx} className="bg-surface-secondary rounded-lg p-4">
                <p className="text-sm text-text-secondary mb-1">{tech.technique}</p>
                <p className="text-2xl font-bold text-text-primary">{formatNumber(tech.count)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search and Filter Controls */}
      <div className="flex items-center gap-4 glass-card p-4">
        <div className="flex-1 relative">
          <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder="Search by user, email, or session ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-secondary">Technique:</span>
          <select
            value={filterTechnique}
            onChange={(e) => setFilterTechnique(e.target.value)}
            className="px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
          >
            <option value="all">All Techniques</option>
            {allTechniques.map(tech => (
              <option key={tech} value={tech}>{tech}</option>
            ))}
          </select>
        </div>

        <span className="text-sm text-text-secondary">
          {filteredMetrics.length} session{filteredMetrics.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Metrics Table */}
      {filteredMetrics.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <FileText size={48} className="mx-auto mb-4 text-text-secondary" />
          <p className="text-text-secondary">No prompt metrics found for the selected filters</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMetrics.map((metric) => (
            <div
              key={metric.sessionId}
              className="glass-card p-6 hover:shadow-lg transition-all duration-150 ease-out"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 rounded-full bg-primary-500/10 flex items-center justify-center">
                        <MessageSquare size={20} style={{ color: 'var(--color-primary)' }} />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-text-primary">{metric.userName}</h3>
                        <p className="text-sm text-text-secondary">{metric.userEmail}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedSessionId(expandedSessionId === metric.sessionId ? null : metric.sessionId)}
                      className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
                    >
                      {expandedSessionId === metric.sessionId ? (
                        <ChevronUp size={20} className="text-text-secondary" />
                      ) : (
                        <ChevronDown size={20} className="text-text-secondary" />
                      )}
                    </button>
                  </div>

                  {/* Quick Stats Row */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                    <div>
                      <p className="text-xs text-text-secondary mb-1 flex items-center gap-1">
                        <Hash size={14} />
                        Session ID
                      </p>
                      <p className="text-sm font-mono font-bold text-text-primary truncate" title={metric.sessionId}>
                        {metric.sessionId.substring(0, 8)}...
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-text-secondary mb-1 flex items-center gap-1">
                        <Calendar size={14} />
                        Timestamp
                      </p>
                      <p className="text-sm font-medium text-text-primary">
                        {new Date(metric.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-text-secondary mb-1 flex items-center gap-1">
                        <FileText size={14} />
                        Templates Used
                      </p>
                      <div className="text-sm font-medium text-text-primary">
                        {metric.baseTemplateName && (
                          <span className="inline-block bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs mr-2">
                            Base: {metric.baseTemplateName}
                          </span>
                        )}
                        {metric.domainTemplateName && (
                          <span className="inline-block bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs">
                            Domain: {metric.domainTemplateName}
                          </span>
                        )}
                        {!metric.baseTemplateName && !metric.domainTemplateName && 'N/A'}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-text-secondary mb-1 flex items-center gap-1">
                        <Clock size={14} />
                        Tokens Added
                      </p>
                      <p className="text-lg font-bold text-text-primary">{metric.tokensAdded || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-secondary mb-1 flex items-center gap-1">
                        <MessageSquare size={14} />
                        Prompt Length
                      </p>
                      <p className="text-lg font-bold text-text-primary">{formatNumber(metric.systemPromptLength || 0)}</p>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedSessionId === metric.sessionId && (
                    <div className="mt-6 pt-6 border-t border-border space-y-4">
                      {/* System Prompt */}
                      {metric.systemPrompt && (
                        <div className="bg-surface-secondary rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                            <FileText size={16} />
                            System Prompt
                          </h4>
                          <div className="bg-surface rounded p-3 max-h-40 overflow-y-auto">
                            <pre className="text-xs text-text-primary whitespace-pre-wrap font-mono">
                              {metric.systemPrompt}
                            </pre>
                          </div>
                        </div>
                      )}

                      {/* Applied Techniques */}
                      {metric.appliedTechniques && metric.appliedTechniques.length > 0 && (
                        <div className="bg-surface-secondary rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                            <Sparkles size={16} />
                            Applied Techniques
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {metric.appliedTechniques.map((technique, idx) => (
                              <span
                                key={idx}
                                className="px-3 py-1.5 bg-primary-500/10 text-primary-500 rounded-full text-sm font-medium"
                              >
                                {technique}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Injections & Context */}
                      <div className="bg-surface-secondary rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                          <Database size={16} />
                          Context Injections
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                          <div className="bg-surface rounded p-3">
                            <p className="text-xs text-text-secondary mb-1">Formatting</p>
                            <p className="text-lg font-bold text-text-primary">
                              {metric.hasFormatting ? (
                                <Check size={20} className="text-green-500" />
                              ) : (
                                <X size={20} className="text-red-500" />
                              )}
                            </p>
                          </div>
                          <div className="bg-surface rounded p-3">
                            <p className="text-xs text-text-secondary mb-1">MCP Context</p>
                            <p className="text-lg font-bold text-text-primary">
                              {metric.hasMcpContext ? (
                                <Check size={20} className="text-green-500" />
                              ) : (
                                <X size={20} className="text-red-500" />
                              )}
                            </p>
                            {metric.mcpToolsCount > 0 && (
                              <p className="text-xs text-text-secondary mt-1">{metric.mcpToolsCount} tools</p>
                            )}
                          </div>
                          <div className="bg-surface rounded p-3">
                            <p className="text-xs text-text-secondary mb-1">RAG Context</p>
                            <p className="text-lg font-bold text-text-primary">
                              {metric.hasRAG ? (
                                <Check size={20} className="text-green-500" />
                              ) : (
                                <X size={20} className="text-red-500" />
                              )}
                            </p>
                            {metric.ragDocsCount > 0 && (
                              <p className="text-xs text-text-secondary mt-1">
                                {metric.ragDocsCount} docs, {metric.ragChatsCount} chats
                              </p>
                            )}
                          </div>
                          <div className="bg-surface rounded p-3">
                            <p className="text-xs text-text-secondary mb-1">Memory</p>
                            <p className="text-lg font-bold text-text-primary">
                              {metric.hasMemory ? (
                                <Check size={20} className="text-green-500" />
                              ) : (
                                <X size={20} className="text-red-500" />
                              )}
                            </p>
                            {metric.memoryCount > 0 && (
                              <p className="text-xs text-text-secondary mt-1">{metric.memoryCount} items</p>
                            )}
                          </div>
                          <div className="bg-surface rounded p-3">
                            <p className="text-xs text-text-secondary mb-1">Azure SDK Docs</p>
                            <p className="text-lg font-bold text-text-primary">
                              {metric.hasAzureSdkDocs ? (
                                <Check size={20} className="text-green-500" />
                              ) : (
                                <X size={20} className="text-red-500" />
                              )}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Message ID */}
                      {metric.messageId && (
                        <div className="bg-surface-secondary rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-text-primary mb-3">Message ID</h4>
                          <p className="text-sm font-mono text-text-primary">{metric.messageId}</p>
                        </div>
                      )}

                      {/* Additional Metadata */}
                      {metric.metadata && Object.keys(metric.metadata).length > 0 && (
                        <div className="bg-surface-secondary rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                            <Database size={16} />
                            Additional Metadata
                          </h4>
                          <pre className="text-xs text-text-primary bg-surface rounded p-3 overflow-auto max-h-40">
                            {JSON.stringify(metric.metadata, null, 2)}
                          </pre>
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

export default PromptMetrics;
