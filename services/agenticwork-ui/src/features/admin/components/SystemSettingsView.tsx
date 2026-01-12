import React, { useState, useEffect } from 'react';
// Basic UI icons from lucide
import { Settings, SlidersHorizontal, Sparkles, Save, X, Check } from '@/shared/icons';
// Custom badass AgenticWork icons
import { DollarSign, AlertTriangle, Cpu, Zap, ToggleLeft } from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';
import { apiRequest } from '@/utils/api';

interface GlobalSliderData {
  value: number;
  setBy?: string;
  setAt?: string;
}

interface TieredFCConfig {
  enabled: boolean;
  toolStrippingEnabled: boolean;
  decisionCacheEnabled: boolean;
  decisionCacheTTL: number;
  cheapModel: string;
  balancedModel: string;
  premiumModel: string;
}

interface SystemSettingsViewProps {
  theme?: string;
}

const SystemSettingsView: React.FC<SystemSettingsViewProps> = () => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [globalSlider, setGlobalSlider] = useState<GlobalSliderData | null>(null);
  const [editingSlider, setEditingSlider] = useState<number>(50);
  const [hasChanges, setHasChanges] = useState(false);

  // Tiered Function Calling state
  const [tieredFCConfig, setTieredFCConfig] = useState<TieredFCConfig>({
    enabled: true,
    toolStrippingEnabled: true,
    decisionCacheEnabled: true,
    decisionCacheTTL: 300,
    cheapModel: '',
    balancedModel: '',
    premiumModel: ''
  });
  const [hasTieredFCChanges, setHasTieredFCChanges] = useState(false);
  const [savingTieredFC, setSavingTieredFC] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();

      // Fetch slider settings
      const sliderResponse = await apiRequest('/admin/settings/slider', { headers });
      const sliderData = await sliderResponse.json();
      setGlobalSlider(sliderData);
      setEditingSlider(sliderData.value ?? 50);

      // Fetch tiered function calling settings
      try {
        const fcResponse = await apiRequest('/admin/tiered-fc', { headers });
        const fcData = await fcResponse.json();
        setTieredFCConfig({
          enabled: fcData.enabled ?? true,
          toolStrippingEnabled: fcData.toolStrippingEnabled ?? true,
          decisionCacheEnabled: fcData.decisionCacheEnabled ?? true,
          decisionCacheTTL: fcData.decisionCacheTTL ?? 300,
          cheapModel: fcData.cheapModel || '',
          balancedModel: fcData.balancedModel || '',
          premiumModel: fcData.premiumModel || ''
        });
      } catch {
        // Tiered FC not configured yet, use defaults
        console.log('Tiered FC config not found, using defaults');
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
      // Set default if fetch fails
      setGlobalSlider({ value: 50 });
      setEditingSlider(50);
    } finally {
      setLoading(false);
    }
  };

  const handleSliderChange = (value: number) => {
    setEditingSlider(value);
    setHasChanges(value !== (globalSlider?.value ?? 50));
  };

  const handleTieredFCChange = (key: keyof TieredFCConfig, value: any) => {
    setTieredFCConfig(prev => ({ ...prev, [key]: value }));
    setHasTieredFCChanges(true);
  };

  const handleSaveTieredFC = async () => {
    setSavingTieredFC(true);
    setError(null);
    setSuccess(null);

    try {
      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };

      await apiRequest('/admin/tiered-fc', {
        method: 'PUT',
        headers,
        body: JSON.stringify(tieredFCConfig)
      });

      setHasTieredFCChanges(false);
      setSuccess('Tiered function calling settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tiered FC settings');
    } finally {
      setSavingTieredFC(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };

      await apiRequest('/admin/settings/slider', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ value: editingSlider })
      });

      // Refetch to get updated data
      await fetchSettings();
      setHasChanges(false);
      setSuccess('Global slider saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const getTierInfo = (value: number) => {
    if (value <= 33) {
      return {
        name: 'Economical',
        description: 'Prioritizes faster, more cost-effective models. Best for simple tasks.',
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        models: ['GPT-4o-mini', 'Claude 3 Haiku', 'Gemini 1.5 Flash', 'Llama 3.3 8B']
      };
    } else if (value <= 66) {
      return {
        name: 'Balanced',
        description: 'Balances cost and quality. Good for most general use cases.',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/20',
        models: ['Claude 3.5 Sonnet', 'GPT-4o', 'Gemini 1.5 Pro']
      };
    } else {
      return {
        name: 'Premium',
        description: 'Prioritizes highest quality models. Best for complex reasoning tasks.',
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        models: ['Claude 3 Opus', 'GPT-4 Turbo', 'o1-preview']
      };
    }
  };

  const tierInfo = getTierInfo(editingSlider);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold mb-2 text-text-primary">
          System Settings
        </h2>
        <p className="text-text-secondary">
          Configure global system settings that apply to all users
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="glass-card border-red-500/50 bg-red-500/10 p-4 rounded-lg">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <span className="text-red-400">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 hover:bg-red-500/20 rounded"
            >
              <X className="h-4 w-4 text-red-400" />
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="glass-card border-green-500/50 bg-green-500/10 p-4 rounded-lg">
          <div className="flex items-center gap-3">
            <Check className="h-5 w-5 text-green-400" />
            <span className="text-green-400">{success}</span>
          </div>
        </div>
      )}

      {/* Global Intelligence Slider */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" />
            Global Intelligence Slider
          </h3>
          {globalSlider?.setAt && (
            <span className="text-xs text-text-secondary">
              Last updated: {new Date(globalSlider.setAt).toLocaleString()}
            </span>
          )}
        </div>

        <p className="text-text-secondary mb-6">
          The global intelligence slider controls the default cost/quality tradeoff for all users.
          Individual users can have custom overrides set in their permissions.
        </p>

        {/* Slider Control */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-green-400">
              <DollarSign className="h-5 w-5" />
              <span className="font-medium">Cost Optimized</span>
            </div>
            <span className="text-3xl font-bold text-primary-400">{editingSlider}%</span>
            <div className="flex items-center gap-2 text-purple-400">
              <Sparkles className="h-5 w-5" />
              <span className="font-medium">Quality Optimized</span>
            </div>
          </div>

          <input
            type="range"
            min="0"
            max="100"
            value={editingSlider}
            onChange={(e) => handleSliderChange(parseInt(e.target.value))}
            className="w-full h-3 bg-gradient-to-r from-green-500 via-yellow-500 to-purple-500 rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right,
                var(--color-success) 0%,
                var(--color-warning) 50%,
                var(--color-accent) 100%)`
            }}
          />

          {/* Tier Markers */}
          <div className="flex justify-between mt-2 text-sm text-text-secondary">
            <span>0%</span>
            <div className="flex-1 flex justify-around">
              <span className="text-green-400">Economical</span>
              <span className="text-yellow-400">Balanced</span>
              <span className="text-purple-400">Premium</span>
            </div>
            <span>100%</span>
          </div>
        </div>

        {/* Current Tier Info */}
        <div className={`p-4 rounded-lg ${tierInfo.bgColor} mb-6`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-lg font-bold ${tierInfo.color}`}>{tierInfo.name} Tier</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${tierInfo.bgColor} ${tierInfo.color}`}>
              Active
            </span>
          </div>
          <p className="text-text-secondary text-sm mb-3">{tierInfo.description}</p>
          <div className="flex flex-wrap gap-2">
            {tierInfo.models.map((model) => (
              <span key={model} className="px-2 py-1 bg-surface-primary/50 rounded text-xs text-text-primary">
                {model}
              </span>
            ))}
          </div>
        </div>

        {/* Tier Configuration Summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className={`p-4 rounded-lg border ${editingSlider <= 33 ? 'border-green-500' : 'border-border'}`}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <span className="font-medium text-text-primary">Economical</span>
            </div>
            <p className="text-xs text-text-secondary mb-2">0-33%</p>
            <ul className="text-xs text-text-secondary space-y-1">
              <li>No thinking mode</li>
              <li>Fast models only</li>
              <li>Lower token limits</li>
            </ul>
          </div>

          <div className={`p-4 rounded-lg border ${editingSlider > 33 && editingSlider <= 66 ? 'border-yellow-500' : 'border-border'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Settings className="h-4 w-4 text-yellow-400" />
              <span className="font-medium text-text-primary">Balanced</span>
            </div>
            <p className="text-xs text-text-secondary mb-2">34-66%</p>
            <ul className="text-xs text-text-secondary space-y-1">
              <li>Thinking mode enabled</li>
              <li>8K thinking budget</li>
              <li>Standard models</li>
            </ul>
          </div>

          <div className={`p-4 rounded-lg border ${editingSlider > 66 ? 'border-purple-500' : 'border-border'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <span className="font-medium text-text-primary">Premium</span>
            </div>
            <p className="text-xs text-text-secondary mb-2">67-100%</p>
            <ul className="text-xs text-text-secondary space-y-1">
              <li>Extended thinking</li>
              <li>Up to 32K budget</li>
              <li>Premium models</li>
            </ul>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-4 pt-4 border-t border-border">
          {hasChanges && (
            <span className="text-sm text-yellow-400">
              You have unsaved changes
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              hasChanges
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'bg-surface-secondary text-text-secondary cursor-not-allowed'
            }`}
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Tiered Function Calling Settings */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Tiered Function Calling
          </h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tieredFCConfig.enabled}
              onChange={(e) => handleTieredFCChange('enabled', e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <span className="text-sm text-text-secondary">Enabled</span>
          </label>
        </div>

        <p className="text-text-secondary mb-6">
          Configure how models are selected for function calling decisions and tool routing.
          This optimizes cost by using cheaper models for simple decisions.
        </p>

        {/* Tool Stripping */}
        <div className="mb-6 p-4 rounded-lg bg-surface-secondary/50">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={tieredFCConfig.toolStrippingEnabled}
              onChange={(e) => handleTieredFCChange('toolStrippingEnabled', e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-400" />
                <span className="font-medium text-text-primary">Tool Stripping</span>
              </div>
              <p className="text-sm text-text-secondary mt-1">
                Strip tools from requests that don't need them (saves 2000+ tokens per request)
              </p>
            </div>
          </label>
        </div>

        {/* Decision Caching */}
        <div className="mb-6 p-4 rounded-lg bg-surface-secondary/50">
          <label className="flex items-center gap-3 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={tieredFCConfig.decisionCacheEnabled}
              onChange={(e) => handleTieredFCChange('decisionCacheEnabled', e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <div>
              <div className="flex items-center gap-2">
                <ToggleLeft className="h-4 w-4 text-blue-400" />
                <span className="font-medium text-text-primary">Decision Caching</span>
              </div>
              <p className="text-sm text-text-secondary mt-1">
                Cache function calling decisions to avoid redundant model calls
              </p>
            </div>
          </label>
          {tieredFCConfig.decisionCacheEnabled && (
            <div className="ml-8 mt-2">
              <label className="text-sm text-text-secondary">
                Cache TTL (seconds)
                <input
                  type="number"
                  value={tieredFCConfig.decisionCacheTTL}
                  onChange={(e) => handleTieredFCChange('decisionCacheTTL', parseInt(e.target.value) || 300)}
                  className="ml-2 w-24 px-2 py-1 rounded bg-surface-primary border border-border text-text-primary"
                  min={0}
                  max={3600}
                />
              </label>
            </div>
          )}
        </div>

        {/* Model Configuration by Tier */}
        <div className="mb-6">
          <h4 className="text-lg font-medium text-text-primary mb-4">Model Configuration by Tier</h4>
          <p className="text-sm text-text-secondary mb-4">
            Leave blank to use slider-selected model. Specify models for cost optimization.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Cheap Tier */}
            <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/10">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-green-400" />
                <span className="font-medium text-green-400">Cheap Tier (0-40%)</span>
              </div>
              <input
                type="text"
                value={tieredFCConfig.cheapModel}
                onChange={(e) => handleTieredFCChange('cheapModel', e.target.value)}
                placeholder="e.g., gemini-2.0-flash"
                className="w-full px-3 py-2 rounded bg-surface-primary border border-border text-text-primary text-sm"
              />
              <p className="text-xs text-text-secondary mt-2">
                Fast, economical model for simple function decisions
              </p>
            </div>

            {/* Balanced Tier */}
            <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
              <div className="flex items-center gap-2 mb-3">
                <Settings className="h-4 w-4 text-yellow-400" />
                <span className="font-medium text-yellow-400">Balanced Tier (41-60%)</span>
              </div>
              <input
                type="text"
                value={tieredFCConfig.balancedModel}
                onChange={(e) => handleTieredFCChange('balancedModel', e.target.value)}
                placeholder="e.g., claude-3-5-sonnet"
                className="w-full px-3 py-2 rounded bg-surface-primary border border-border text-text-primary text-sm"
              />
              <p className="text-xs text-text-secondary mt-2">
                Standard model for moderate complexity tasks
              </p>
            </div>

            {/* Premium Tier */}
            <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/10">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-purple-400" />
                <span className="font-medium text-purple-400">Premium Tier (61-100%)</span>
              </div>
              <input
                type="text"
                value={tieredFCConfig.premiumModel}
                onChange={(e) => handleTieredFCChange('premiumModel', e.target.value)}
                placeholder="e.g., claude-3-opus"
                className="w-full px-3 py-2 rounded bg-surface-primary border border-border text-text-primary text-sm"
              />
              <p className="text-xs text-text-secondary mt-2">
                High-quality model for complex reasoning
              </p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-4 pt-4 border-t border-border">
          {hasTieredFCChanges && (
            <span className="text-sm text-yellow-400">
              You have unsaved changes
            </span>
          )}
          <button
            onClick={handleSaveTieredFC}
            disabled={!hasTieredFCChanges || savingTieredFC}
            className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              hasTieredFCChanges
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'bg-surface-secondary text-text-secondary cursor-not-allowed'
            }`}
          >
            <Save className="h-4 w-4" />
            {savingTieredFC ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Future Settings Sections */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-semibold mb-4 text-text-primary flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Additional Settings
        </h3>
        <p className="text-text-secondary">
          More system settings will be available here in future updates.
        </p>
      </div>
    </div>
  );
};

export default SystemSettingsView;
