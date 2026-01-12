import React, { useState, useEffect, useCallback } from 'react';
// Basic UI icons from lucide
import { Download, Trash2, Play, HardDrive, Info, Copy, MessageSquare } from '@/shared/icons';
// Custom badass AgenticWork icons
import {
  Server, RefreshCw, Cpu, AlertCircle, CheckCircle, Loader2
} from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface RunningModel {
  name: string;
  size: number;
  digest: string;
  expiresAt?: string;
  sizeVram?: number;
}

interface OllamaStatus {
  success: boolean;
  status: 'connected' | 'disconnected';
  endpoint: string;
  models: number;
  runningModels: number;
  error?: string;
}

interface OllamaManagementViewProps {
  theme?: 'light' | 'dark';
}

export const OllamaManagementView: React.FC<OllamaManagementViewProps> = () => {
  const { getAuthHeaders } = useAuth();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [runningModels, setRunningModels] = useState<RunningModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [pullModel, setPullModel] = useState('');
  const [pulling, setPulling] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<any>(null);
  const [testPrompt, setTestPrompt] = useState('Hello, how are you?');
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const fetchStatus = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/ollama/status', { headers });
      const data = await response.json();
      setStatus(data);
    } catch (err: any) {
      setStatus({
        success: false,
        status: 'disconnected',
        endpoint: 'unknown',
        models: 0,
        runningModels: 0,
        error: err.message
      });
    }
  }, [getAuthHeaders]);

  const fetchModels = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/ollama/models', { headers });
      const data = await response.json();
      if (data.success) {
        setModels(data.models);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [getAuthHeaders]);

  const fetchRunningModels = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/ollama/running', { headers });
      const data = await response.json();
      if (data.success) {
        setRunningModels(data.models);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [getAuthHeaders]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchStatus(), fetchModels(), fetchRunningModels()]);
    setLoading(false);
  }, [fetchStatus, fetchModels, fetchRunningModels]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePullModel = async () => {
    if (!pullModel.trim()) return;

    setPulling(true);
    setError(null);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/admin/ollama/pull', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: pullModel })
      });

      const data = await response.json();
      if (data.success) {
        setPullModel('');
        await refresh();
      } else {
        setError(data.error || 'Failed to pull model');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPulling(false);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`Are you sure you want to delete ${modelName}?`)) return;

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/admin/ollama/models/${encodeURIComponent(modelName)}`, {
        method: 'DELETE',
        headers: authHeaders
      });

      const data = await response.json();
      if (data.success) {
        await refresh();
      } else {
        setError(data.error || 'Failed to delete model');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGetModelInfo = async (modelName: string) => {
    setSelectedModel(modelName);
    setModelInfo(null);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/admin/ollama/models/${encodeURIComponent(modelName)}/info`, {
        headers: authHeaders
      });
      const data = await response.json();
      if (data.success) {
        setModelInfo(data.info);
      } else {
        setError(data.error || 'Failed to get model info');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTestGenerate = async (modelName: string) => {
    setTesting(true);
    setTestResponse(null);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/admin/ollama/generate', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, prompt: testPrompt })
      });

      const data = await response.json();
      if (data.success) {
        setTestResponse(data.response);
      } else {
        setError(data.error || 'Failed to generate response');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Ollama Management
          </h2>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
            bg-gray-100 hover:bg-gray-200 text-gray-900
            dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-800 dark:hover:text-red-400">
            &times;
          </button>
        </div>
      )}

      {/* Status Card */}
      <div className="p-4 rounded-lg border bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {status?.status === 'connected' ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-500" />
            )}
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">
                Server Status: {status?.status || 'Unknown'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Endpoint: {status?.endpoint || 'N/A'}
              </p>
            </div>
          </div>
          <div className="flex gap-6 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {status?.models || 0}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Models</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {status?.runningModels || 0}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Running</div>
            </div>
          </div>
        </div>
      </div>

      {/* Pull Model Section */}
      <div className="p-4 rounded-lg border bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="font-medium mb-3 text-gray-900 dark:text-white">
          Pull New Model
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={pullModel}
            onChange={(e) => setPullModel(e.target.value)}
            placeholder="e.g., llama3.2, codellama, nomic-embed-text"
            className="flex-1 px-3 py-2 rounded-lg border placeholder-gray-400
              bg-white border-gray-300 text-gray-900
              dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <button
            onClick={handlePullModel}
            disabled={pulling || !pullModel.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-white ${
              pulling || !pullModel.trim()
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {pulling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {pulling ? 'Pulling...' : 'Pull'}
          </button>
        </div>
      </div>

      {/* Running Models */}
      {runningModels.length > 0 && (
        <div className="p-4 rounded-lg border bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700">
          <h3 className="font-medium mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
            <Cpu className="w-4 h-4" />
            Running Models
          </h3>
          <div className="space-y-2">
            {runningModels.map((model) => (
              <div
                key={model.digest}
                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700"
              >
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {model.name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    VRAM: {formatBytes(model.sizeVram || 0)} | Size: {formatBytes(model.size)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-green-500 text-sm">
                    <Play className="w-4 h-4" /> Running
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models List */}
      <div className="p-4 rounded-lg border bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <h3 className="font-medium mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
          <HardDrive className="w-4 h-4" />
          Available Models ({models.length})
        </h3>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : models.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No models found. Pull a model to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {models.map((model) => (
              <div
                key={model.digest}
                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700"
              >
                <div className="flex-1">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {model.name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Size: {formatBytes(model.size)}
                    {model.details?.parameter_size && ` | Params: ${model.details.parameter_size}`}
                    {model.details?.quantization_level && ` | Quant: ${model.details.quantization_level}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <button
                    onClick={() => handleGetModelInfo(model.name)}
                    className="p-2 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-600"
                    title="View Info"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleTestGenerate(model.name)}
                    disabled={testing}
                    className="p-2 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-600"
                    title="Test Generate"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteModel(model.name)}
                    className="p-2 rounded transition-colors text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
                    title="Delete Model"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Model Info Modal */}
      {selectedModel && modelInfo && (
        <div className="p-4 rounded-lg border bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-gray-900 dark:text-white">
              Model Info: {selectedModel}
            </h3>
            <button
              onClick={() => {
                setSelectedModel(null);
                setModelInfo(null);
              }}
              className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Close
            </button>
          </div>
          <pre className="text-sm p-3 rounded overflow-auto max-h-96 bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300">
            {JSON.stringify(modelInfo, null, 2)}
          </pre>
        </div>
      )}

      {/* Test Response */}
      {testResponse && (
        <div className="p-4 rounded-lg border bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-gray-900 dark:text-white">
              Test Response
            </h3>
            <button
              onClick={() => setTestResponse(null)}
              className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="p-3 rounded bg-gray-100 dark:bg-gray-900">
            <p className="text-gray-800 dark:text-gray-300">{testResponse}</p>
          </div>
        </div>
      )}
    </div>
  );
};
