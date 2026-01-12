/**
 * AWCode Settings View
 *
 * Standalone admin panel for AWCode/Agenticode configuration settings.
 * Extracted from AWCodeSessionsView for use as a top-level Admin Console section.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Code, Globe, HardDrive } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

// Settings interface
interface AWCodeSettings {
  defaultModel: string;
  sessionIdleTimeout: number;
  sessionMaxLifetime: number;
  maxSessionsPerUser: number;
  defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
  defaultNetworkEnabled: boolean;
  defaultCpuLimit: number;
  defaultMemoryLimitMb: number;
  enabledForNewUsers: boolean;
  // Storage quota settings
  defaultStorageLimitMb: number;
  storageQuotaEnabled: boolean;
  // Code Mode UI settings
  enableNewCodeModeUI: boolean;
  codeModeDefaultView: 'conversation' | 'terminal';
  artifactSandboxLevel: 'strict' | 'permissive' | 'none';
  artifactMaxPreviewSize: number;
  enableArtifactAutoPreview: boolean;
  enableActivityVisualization: boolean;
}

// Available models interface
interface AvailableModel {
  id: string;
  name: string;
  providerId: string;
  available: boolean;
}

interface AWCodeSettingsViewProps {
  theme?: string;
}

export const AWCodeSettingsView: React.FC<AWCodeSettingsViewProps> = ({ theme }) => {
  const { getAuthHeaders } = useAuth();
  const [settings, setSettings] = useState<AWCodeSettings | null>(null);
  const [localSettings, setLocalSettings] = useState<Partial<AWCodeSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(apiEndpoint('/admin/code/settings'), {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        setLocalSettings(data.settings);
        setError(null);
      } else {
        setError('Failed to fetch settings');
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Fetch available models
  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const response = await fetch(apiEndpoint('/agenticode/config'), {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data.models || []);
      }
    } catch (err) {
      console.error('Failed to fetch available models:', err);
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchSettings();
    fetchModels();
  }, [fetchSettings, fetchModels]);

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(apiEndpoint('/admin/code/settings'), {
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(localSettings)
      });

      if (response.ok) {
        setSettings({ ...settings, ...localSettings } as AWCodeSettings);
        setSuccess('Settings saved successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to save settings');
      }
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
            <Settings size={20} />
            Agenticode Settings
          </h2>
          <p className="text-text-secondary">
            Configure code mode behavior, model preferences, and sandbox settings
          </p>
        </div>
        <div className="glass-card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
          <p className="text-text-secondary mt-4">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
          <Settings size={20} />
          Agenticode Settings
        </h2>
        <p className="text-text-secondary">
          Configure code mode behavior, model preferences, and sandbox settings
        </p>
      </div>

      {/* Success/Error messages */}
      {success && (
        <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
          {success}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
          {error}
        </div>
      )}

      {/* Core Settings */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Settings size={20} className="text-primary-500" />
          Core Configuration
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Default Model */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Model
            </label>
            <select
              value={localSettings.defaultModel || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultModel: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
              disabled={modelsLoading}
            >
              {modelsLoading ? (
                <option value="">Loading models...</option>
              ) : availableModels.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))
              )}
            </select>
            {!modelsLoading && localSettings.defaultModel && !availableModels.find(m => m.id === localSettings.defaultModel) && (
              <p className="text-xs text-yellow-500 mt-1">
                Current setting "{localSettings.defaultModel}" is not in available models list
              </p>
            )}
          </div>

          {/* Max Sessions Per User */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Sessions Per User
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={localSettings.maxSessionsPerUser || 3}
              onChange={(e) => setLocalSettings({ ...localSettings, maxSessionsPerUser: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Session Idle Timeout */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Idle Timeout (seconds)
            </label>
            <input
              type="number"
              min={300}
              max={7200}
              step={60}
              value={localSettings.sessionIdleTimeout || 1800}
              onChange={(e) => setLocalSettings({ ...localSettings, sessionIdleTimeout: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Max Session Lifetime */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Lifetime (seconds)
            </label>
            <input
              type="number"
              min={3600}
              max={86400}
              step={3600}
              value={localSettings.sessionMaxLifetime || 14400}
              onChange={(e) => setLocalSettings({ ...localSettings, sessionMaxLifetime: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Security Level */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Security Level
            </label>
            <select
              value={localSettings.defaultSecurityLevel || 'permissive'}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultSecurityLevel: e.target.value as AWCodeSettings['defaultSecurityLevel'] })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="strict">Strict (Limited access)</option>
              <option value="permissive">Permissive (Default)</option>
              <option value="minimal">Minimal (Full access)</option>
            </select>
          </div>

          {/* CPU Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              CPU Limit (cores)
            </label>
            <input
              type="number"
              min={0.5}
              max={8}
              step={0.5}
              value={localSettings.defaultCpuLimit || 2}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultCpuLimit: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Memory Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Memory Limit (MB)
            </label>
            <input
              type="number"
              min={512}
              max={8192}
              step={256}
              value={localSettings.defaultMemoryLimitMb || 2048}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultMemoryLimitMb: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Network Enabled */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="networkEnabled"
              checked={localSettings.defaultNetworkEnabled ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultNetworkEnabled: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label htmlFor="networkEnabled" className="text-sm text-text-secondary">
              Enable Network Access by Default
            </label>
          </div>

          {/* Enabled for New Users */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enabledForNewUsers"
              checked={localSettings.enabledForNewUsers ?? false}
              onChange={(e) => setLocalSettings({ ...localSettings, enabledForNewUsers: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label htmlFor="enabledForNewUsers" className="text-sm text-text-secondary">
              Enable Agenticode for New Users
            </label>
          </div>
        </div>
      </div>

      {/* Storage Quota Settings */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <HardDrive size={20} className="text-blue-500" />
          Storage Quota Settings
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Storage Quota Enabled */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="storageQuotaEnabled"
              checked={localSettings.storageQuotaEnabled ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, storageQuotaEnabled: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label htmlFor="storageQuotaEnabled" className="text-sm text-text-secondary">
              Enable Storage Quota Enforcement
            </label>
          </div>

          {/* Default Storage Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Storage Limit (MB)
            </label>
            <input
              type="number"
              min={100}
              max={10240}
              step={100}
              value={localSettings.defaultStorageLimitMb || 5120}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultStorageLimitMb: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
              disabled={!localSettings.storageQuotaEnabled}
            />
            <p className="text-xs text-text-tertiary mt-1">
              Default: 5120 MB (5GB) per user workspace
            </p>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p className="text-sm text-blue-400">
            Storage quotas help prevent individual users from consuming excessive disk space.
            Users should use GitHub for files they want to persist long-term.
          </p>
        </div>
      </div>

      {/* Code Mode UI Settings */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Code size={20} className="text-green-500" />
          Code Mode UI Settings
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Enable New Code Mode UI */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableNewCodeModeUI"
              checked={localSettings.enableNewCodeModeUI ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableNewCodeModeUI: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label htmlFor="enableNewCodeModeUI" className="text-sm text-text-secondary">
              Enable New Code Mode UI (Three-Panel Layout)
            </label>
          </div>

          {/* Enable Activity Visualization */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableActivityVisualization"
              checked={localSettings.enableActivityVisualization ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableActivityVisualization: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label htmlFor="enableActivityVisualization" className="text-sm text-text-secondary">
              Enable Real-time Activity Visualization
            </label>
          </div>

          {/* Default View */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Code Mode View
            </label>
            <select
              value={localSettings.codeModeDefaultView || 'conversation'}
              onChange={(e) => setLocalSettings({ ...localSettings, codeModeDefaultView: e.target.value as 'conversation' | 'terminal' })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="conversation">Conversation (New UI)</option>
              <option value="terminal">Terminal (Legacy)</option>
            </select>
          </div>

          {/* Artifact Sandbox Level */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Artifact Sandbox Level
            </label>
            <select
              value={localSettings.artifactSandboxLevel || 'strict'}
              onChange={(e) => setLocalSettings({ ...localSettings, artifactSandboxLevel: e.target.value as 'strict' | 'permissive' | 'none' })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="strict">Strict (Recommended)</option>
              <option value="permissive">Permissive (Allow more APIs)</option>
              <option value="none">None (Full access - Not recommended)</option>
            </select>
          </div>

          {/* Artifact Max Preview Size */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Artifact Preview Size (MB)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={localSettings.artifactMaxPreviewSize || 10}
              onChange={(e) => setLocalSettings({ ...localSettings, artifactMaxPreviewSize: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Enable Artifact Auto Preview */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableArtifactAutoPreview"
              checked={localSettings.enableArtifactAutoPreview ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableArtifactAutoPreview: e.target.checked })}
              className="rounded border-gray-600"
            />
            <label htmlFor="enableArtifactAutoPreview" className="text-sm text-text-secondary">
              Auto-Preview Artifacts When Ready
            </label>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p className="text-sm text-blue-400 flex items-center gap-2">
            <Globe size={14} />
            The new Code Mode UI uses WebSocket streaming via <code className="px-1 bg-blue-500/20 rounded">/ws/events</code> for real-time activity visualization.
          </p>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default AWCodeSettingsView;
