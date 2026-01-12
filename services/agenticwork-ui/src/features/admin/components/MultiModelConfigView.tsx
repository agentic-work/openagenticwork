/**
 * Multi-Model Configuration Admin View
 * 
 * Configure the multi-model collaboration system where different LLM models
 * handle different roles (reasoning, tool execution, synthesis, fallback).
 * 
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

import React, { useState, useEffect, useCallback } from 'react';
// Basic UI icons from lucide
import { Settings, Brain, Wrench, Save, ChevronDown, ChevronRight, Info } from '@/shared/icons';
// Custom badass AgenticWork icons
import {
  Zap, AlertTriangle, RefreshCw, Activity, CheckCircle, XCircle, Loader2,
  FileOutput, ToggleLeft, ToggleRight
} from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

// Types matching the backend
interface ModelRoleConfig {
  role: 'reasoning' | 'tool_execution' | 'synthesis' | 'fallback';
  enabled: boolean;
  primaryModel: string;
  fallbackModel?: string;
  provider?: string;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: number;
  options?: {
    enableThinking?: boolean;
    streamTools?: boolean;
    preserveToolContext?: boolean;
  };
}

interface MultiModelConfig {
  enabled: boolean;
  source: 'feature_flag' | 'runtime' | 'admin' | 'default';
  roles: {
    reasoning: ModelRoleConfig;
    tool_execution: ModelRoleConfig;
    synthesis: ModelRoleConfig;
    fallback: ModelRoleConfig;
  };
  routing: {
    complexityThreshold: number;
    alwaysMultiModelPatterns: string[];
    preferCheaperToolModel: boolean;
    maxHandoffs: number;
  };
  sliderOverrides: {
    enableAbovePosition: number;
    scaleBySlider: boolean;
  };
}

interface MultiModelMetrics {
  totalOrchestrations: number;
  successRate: number;
  avgHandoffs: number;
  avgCostSavings: number;
  roleBreakdown: {
    role: string;
    usageCount: number;
    avgDuration: number;
    avgCost: number;
  }[];
}

const ROLE_ICONS = {
  reasoning: Brain,
  tool_execution: Wrench,
  synthesis: FileOutput,
  fallback: AlertTriangle
};

const ROLE_COLORS = {
  reasoning: 'text-purple-500 bg-purple-500/10',
  tool_execution: 'text-blue-500 bg-blue-500/10',
  synthesis: 'text-green-500 bg-green-500/10',
  fallback: 'text-orange-500 bg-orange-500/10'
};

const ROLE_DESCRIPTIONS = {
  reasoning: 'Complex analysis, planning, and decision-making. Uses premium models with extended thinking.',
  tool_execution: 'MCP tool calls and function execution. Can use faster, cheaper models.',
  synthesis: 'Final response generation after reasoning and tools complete.',
  fallback: 'Error recovery and retry scenarios. Reliable backup model.'
};

// Model info fetched from backend
interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  tier: string;
}

export const MultiModelConfigView: React.FC = () => {
  const { getAccessToken } = useAuth();
  const [config, setConfig] = useState<MultiModelConfig | null>(null);
  const [metrics, setMetrics] = useState<MultiModelMetrics | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRole, setExpandedRole] = useState<string | null>('reasoning');
  const [hasChanges, setHasChanges] = useState(false);

  const apiBase = import.meta.env.VITE_API_URL || '';

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const token = await getAccessToken();

      const [configRes, metricsRes, modelsRes] = await Promise.all([
        fetch(`${apiBase}/api/admin/multi-model/config`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${apiBase}/api/admin/multi-model/metrics`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        // Fetch available models from LLM providers endpoint
        fetch(`${apiBase}/api/admin/llm-providers`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (configRes.ok) {
        const data = await configRes.json();
        setConfig(data.config);
      }

      if (metricsRes.ok) {
        const data = await metricsRes.json();
        // Transform backend aggregates to frontend expected format
        const aggregates = data.aggregates || {};
        const breakdown = data.breakdown || {};
        const successCount = breakdown.bySuccess?.success || 0;
        const totalCount = aggregates.totalRequests || 0;

        setMetrics({
          totalOrchestrations: totalCount,
          successRate: totalCount > 0 ? successCount / totalCount : 0,
          avgHandoffs: aggregates.avgHandoffs || 0,
          avgCostSavings: 0, // Not tracked in current metrics schema - TODO: add cost savings calculation
          roleBreakdown: [] // TODO: populate from detailed metrics if needed
        });
      }

      // Parse available models from LLM providers endpoint
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        const models: AvailableModel[] = [];

        // Parse providers array with nested models
        if (data.providers && Array.isArray(data.providers)) {
          data.providers.forEach((provider: any) => {
            const providerName = provider.name || provider.type || 'unknown';
            if (provider.models && Array.isArray(provider.models)) {
              provider.models.forEach((m: any) => {
                // Skip non-chat models (e.g., image generation, embeddings)
                if (m.capabilities && m.capabilities.chat === false) return;

                // Determine tier based on model characteristics
                let tier = 'balanced';
                const modelId = (m.id || m.name || '').toLowerCase();
                if (modelId.includes('opus') || modelId.includes('pro') || modelId.includes('o1')) {
                  tier = 'premium';
                } else if (modelId.includes('haiku') || modelId.includes('flash') || modelId.includes('mini')) {
                  tier = 'fast';
                }

                models.push({
                  id: m.id || m.name,
                  name: m.name || m.id,
                  provider: m.provider || providerName,
                  tier
                });
              });
            }
          });
        }

        // Sort by provider then name
        models.sort((a, b) => {
          if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
          return a.name.localeCompare(b.name);
        });

        setAvailableModels(models);
      }

      setError(null);
    } catch (err) {
      setError('Failed to load multi-model configuration');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, apiBase]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleToggleEnabled = async () => {
    if (!config) return;
    
    try {
      setSaving(true);
      const token = await getAccessToken();
      
      const res = await fetch(`${apiBase}/api/admin/multi-model/toggle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: !config.enabled })
      });

      if (res.ok) {
        const newEnabled = !config.enabled;
        setConfig(prev => prev ? { ...prev, enabled: newEnabled } : null);
        // Dispatch event to sync with ChatContainer
        window.dispatchEvent(new CustomEvent('multimodel-config-changed', {
          detail: { enabled: newEnabled }
        }));
      }
    } catch (err) {
      setError('Failed to toggle multi-model');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = (role: keyof MultiModelConfig['roles'], field: string, value: any) => {
    if (!config) return;
    
    setConfig(prev => {
      if (!prev) return null;
      return {
        ...prev,
        roles: {
          ...prev.roles,
          [role]: {
            ...prev.roles[role],
            [field]: value
          }
        }
      };
    });
    setHasChanges(true);
  };

  const handleRoutingChange = (field: string, value: any) => {
    if (!config) return;
    
    setConfig(prev => {
      if (!prev) return null;
      return {
        ...prev,
        routing: {
          ...prev.routing,
          [field]: value
        }
      };
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!config) return;
    
    try {
      setSaving(true);
      const token = await getAccessToken();
      
      const res = await fetch(`${apiBase}/api/admin/multi-model/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ config })
      });

      if (res.ok) {
        setHasChanges(false);
        setError(null);
      } else {
        throw new Error('Save failed');
      }
    } catch (err) {
      setError('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const renderRoleCard = (roleKey: keyof MultiModelConfig['roles']) => {
    if (!config) return null;
    
    const roleConfig = config.roles[roleKey];
    const Icon = ROLE_ICONS[roleKey];
    const isExpanded = expandedRole === roleKey;
    
    return (
      <div 
        key={roleKey}
        className="glass-card overflow-hidden"
        style={{ borderLeft: `3px solid var(--ap-${roleKey === 'reasoning' ? 'purple' : roleKey === 'tool_execution' ? 'blue' : roleKey === 'synthesis' ? 'green' : 'orange'}-500, currentColor)` }}
      >
        {/* Role Header */}
        <div 
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors"
          onClick={() => setExpandedRole(isExpanded ? null : roleKey)}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${ROLE_COLORS[roleKey]}`}>
              <Icon size={20} />
            </div>
            <div>
              <h3 className="font-medium text-text-primary capitalize">
                {roleKey.replace('_', ' ')}
              </h3>
              <p className="text-xs text-text-secondary">
                {roleConfig.primaryModel}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRoleChange(roleKey, 'enabled', !roleConfig.enabled);
              }}
              className={`p-1.5 rounded-lg transition-colors ${
                roleConfig.enabled 
                  ? 'bg-green-500/20 text-green-500' 
                  : 'bg-gray-500/20 text-gray-500'
              }`}
            >
              {roleConfig.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
            </button>
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="p-4 pt-0 space-y-4 border-t border-white/10">
            <p className="text-xs text-text-secondary">
              {ROLE_DESCRIPTIONS[roleKey]}
            </p>

            {/* Primary Model */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Primary Model
              </label>
              <select
                value={roleConfig.primaryModel}
                onChange={(e) => handleRoleChange(roleKey, 'primaryModel', e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm"
              >
                {availableModels.length === 0 ? (
                  <option value={roleConfig.primaryModel}>{roleConfig.primaryModel} (loading...)</option>
                ) : (
                  availableModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Fallback Model */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Fallback Model
              </label>
              <select
                value={roleConfig.fallbackModel || ''}
                onChange={(e) => handleRoleChange(roleKey, 'fallbackModel', e.target.value || undefined)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm"
              >
                <option value="">None</option>
                {availableModels.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider})
                  </option>
                ))}
              </select>
            </div>

            {/* Temperature */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Temperature: {roleConfig.temperature?.toFixed(1) || '0.5'}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={roleConfig.temperature || 0.5}
                onChange={(e) => handleRoleChange(roleKey, 'temperature', parseFloat(e.target.value))}
                className="w-full"
              />
            </div>

            {/* Role-specific options */}
            {roleKey === 'reasoning' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`${roleKey}-thinking`}
                  checked={roleConfig.options?.enableThinking ?? true}
                  onChange={(e) => handleRoleChange(roleKey, 'options', {
                    ...roleConfig.options,
                    enableThinking: e.target.checked
                  })}
                  className="rounded"
                />
                <label htmlFor={`${roleKey}-thinking`} className="text-xs">
                  Enable Extended Thinking
                </label>
              </div>
            )}

            {roleKey === 'reasoning' && roleConfig.options?.enableThinking && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Thinking Budget: {roleConfig.thinkingBudget || 8000} tokens
                </label>
                <input
                  type="range"
                  min="2000"
                  max="32000"
                  step="1000"
                  value={roleConfig.thinkingBudget || 8000}
                  onChange={(e) => handleRoleChange(roleKey, 'thinkingBudget', parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            )}

            {roleKey === 'tool_execution' && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`${roleKey}-stream`}
                  checked={roleConfig.options?.streamTools ?? true}
                  onChange={(e) => handleRoleChange(roleKey, 'options', {
                    ...roleConfig.options,
                    streamTools: e.target.checked
                  })}
                  className="rounded"
                />
                <label htmlFor={`${roleKey}-stream`} className="text-xs">
                  Stream Tool Calls
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Zap className="text-yellow-500" size={24} />
            Multi-Model Collaboration
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            Route requests to specialized models by role (reasoning, tool execution, synthesis).
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={fetchConfig}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={18} />
          </button>
          
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save Changes
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Main Toggle */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${config?.enabled ? 'bg-green-500/20' : 'bg-gray-500/20'}`}>
              <Activity size={28} className={config?.enabled ? 'text-green-500' : 'text-gray-500'} />
            </div>
            <div>
              <h3 className="font-semibold text-lg text-text-primary">
                Multi-Model Orchestration
              </h3>
              <p className="text-sm text-text-secondary">
                {config?.enabled 
                  ? 'Active - Requests are routed to specialized models by role'
                  : 'Disabled - All requests use single model'}
              </p>
            </div>
          </div>
          
          <button
            onClick={handleToggleEnabled}
            disabled={saving}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
              config?.enabled ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                config?.enabled ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {config?.enabled && (
          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-text-primary">
                {metrics?.totalOrchestrations || 0}
              </div>
              <div className="text-xs text-text-secondary">Orchestrations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">
                {((metrics?.successRate || 0) * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-text-secondary">Success Rate</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-500">
                {(metrics?.avgHandoffs || 0).toFixed(1)}
              </div>
              <div className="text-xs text-text-secondary">Avg Handoffs</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-500">
                {((metrics?.avgCostSavings || 0) * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-text-secondary">Cost Savings</div>
            </div>
          </div>
        )}
      </div>

      {/* Role Configuration */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
          <Settings size={14} />
          Model Role Assignments
        </h3>
        <div className="space-y-3">
          {config && (
            <>
              {renderRoleCard('reasoning')}
              {renderRoleCard('tool_execution')}
              {renderRoleCard('synthesis')}
              {renderRoleCard('fallback')}
            </>
          )}
        </div>
      </div>

      {/* Routing Configuration */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
          <Activity size={14} />
          Routing Rules
        </h3>
        
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Complexity Threshold: {config?.routing.complexityThreshold || 60}
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={config?.routing.complexityThreshold || 60}
              onChange={(e) => handleRoutingChange('complexityThreshold', parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-text-muted mt-1">
              Requests scoring above this trigger multi-model
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Max Handoffs: {config?.routing.maxHandoffs || 5}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={config?.routing.maxHandoffs || 5}
              onChange={(e) => handleRoutingChange('maxHandoffs', parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-text-muted mt-1">
              Maximum model switches per request
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Slider Threshold: {config?.sliderOverrides.enableAbovePosition || 70}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={config?.sliderOverrides.enableAbovePosition || 70}
              onChange={(e) => setConfig(prev => prev ? {
                ...prev,
                sliderOverrides: {
                  ...prev.sliderOverrides,
                  enableAbovePosition: parseInt(e.target.value)
                }
              } : null)}
              className="w-full"
            />
            <p className="text-xs text-text-muted mt-1">
              Intelligence slider position to enable multi-model
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="prefer-cheaper"
              checked={config?.routing.preferCheaperToolModel ?? true}
              onChange={(e) => handleRoutingChange('preferCheaperToolModel', e.target.checked)}
              className="rounded"
            />
            <label htmlFor="prefer-cheaper" className="text-sm">
              Prefer cheaper models for tool execution
            </label>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="glass-card p-4 flex items-start gap-3 bg-blue-500/5 border-blue-500/20">
        <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-text-secondary">
          <strong className="text-text-primary">How Multi-Model Works:</strong>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li><strong>Reasoning:</strong> Premium model analyzes the task and creates a plan</li>
            <li><strong>Tool Execution:</strong> Fast model executes MCP tool calls</li>
            <li><strong>Synthesis:</strong> Balanced model generates the final response</li>
            <li><strong>Fallback:</strong> Reliable model handles errors and retries</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MultiModelConfigView;
