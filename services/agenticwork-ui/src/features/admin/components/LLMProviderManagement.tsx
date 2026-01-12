/**
 * LLM Provider Management - Admin Portal
 *
 * Comprehensive UI for managing LLM providers, models, and live testing
 *
 * Features:
 * - Provider configuration (Azure, Vertex AI, Bedrock, Ollama)
 * - Model management with quick-add presets
 * - Live testing playground with streaming responses
 * - Performance metrics and health monitoring
 * - Routing configuration
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
// Basic UI icons from lucide
import {
  Plus, Edit2, Trash2, Beaker, Save, X as XIcon, Eye, EyeOff, Brain,
  Settings, Sliders, BarChart2, Play, Send, Sparkles, MessageSquare,
  Copy, Check, ChevronDown, Terminal, Globe, Key, Download, HardDrive,
  Box, Layers
} from '@/shared/icons';
// Custom badass AgenticWork icons
import {
  Server, CheckCircle, XCircle, AlertCircle, RefreshCw, Zap, DollarSign,
  Activity, Timer as Clock, Database, Cpu
} from './AdminIcons';
import { apiRequest } from '@/utils/api';
import { useAuth } from '../../../app/providers/AuthContext';

// ============================================================================
// TYPES
// ============================================================================

interface Model {
  id: string;
  name: string;
  provider: string;
  providerType: 'azure-openai' | 'vertex-ai' | 'aws-bedrock' | 'ollama';
  location?: string; // For Vertex AI (us-central1, global, etc.)
  enabled: boolean;
  isDefault?: boolean;
  capabilities: {
    chat: boolean;
    vision: boolean;
    tools: boolean;
    streaming: boolean;
    thinking?: boolean;
  };
  config: {
    maxTokens: number;
    temperature: number;
    thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  };
}

interface Provider {
  id: string;
  name: string;
  displayName: string;
  type: 'azure-openai' | 'vertex-ai' | 'aws-bedrock' | 'ollama';
  enabled: boolean;
  healthy?: boolean;
  models: Model[];
  config: any;
}

interface TestMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  latency?: number;
  tokens?: { input: number; output: number; thinking?: number };
}

// ============================================================================
// PRESET MODELS - Quick add configurations
// ============================================================================

const PRESET_MODELS: Record<string, Omit<Model, 'id'>[]> = {
  'vertex-ai': [
    {
      name: 'Gemini 3 Flash Preview',
      provider: 'vertex-ai',
      providerType: 'vertex-ai',
      location: 'global',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true, thinking: true },
      config: { maxTokens: 65536, temperature: 1, thinkingLevel: 'high' }
    },
    {
      name: 'Gemini 3 Pro Preview',
      provider: 'vertex-ai',
      providerType: 'vertex-ai',
      location: 'global',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true, thinking: true },
      config: { maxTokens: 65536, temperature: 1, thinkingLevel: 'high' }
    },
    {
      name: 'Gemini 2.5 Pro',
      provider: 'vertex-ai',
      providerType: 'vertex-ai',
      location: 'us-central1',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true, thinking: true },
      config: { maxTokens: 65536, temperature: 1 }
    },
    {
      name: 'Gemini 2.5 Flash',
      provider: 'vertex-ai',
      providerType: 'vertex-ai',
      location: 'us-central1',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true, thinking: true },
      config: { maxTokens: 65536, temperature: 1 }
    },
    {
      name: 'Gemini 2.0 Flash',
      provider: 'vertex-ai',
      providerType: 'vertex-ai',
      location: 'us-central1',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true },
      config: { maxTokens: 8192, temperature: 1 }
    },
  ],
  'aws-bedrock': [
    {
      name: 'Claude Sonnet 4.5',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true },
      config: { maxTokens: 16000, temperature: 1 }
    },
    {
      name: 'Claude Opus 4',
      provider: 'aws-bedrock',
      providerType: 'aws-bedrock',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true },
      config: { maxTokens: 16000, temperature: 1 }
    },
  ],
  'ollama': [
    {
      name: 'Llama 3.3 70B',
      provider: 'ollama',
      providerType: 'ollama',
      enabled: true,
      capabilities: { chat: true, vision: false, tools: true, streaming: true },
      config: { maxTokens: 8192, temperature: 0.7 }
    },
    {
      name: 'Qwen 3',
      provider: 'ollama',
      providerType: 'ollama',
      enabled: true,
      capabilities: { chat: true, vision: true, tools: true, streaming: true },
      config: { maxTokens: 32768, temperature: 0.7 }
    },
  ]
};

// Model ID mapping for presets
const MODEL_ID_MAP: Record<string, string> = {
  'Gemini 3 Flash Preview': 'gemini-3-flash-preview',
  'Gemini 3 Pro Preview': 'gemini-3-pro-preview',
  'Gemini 2.5 Pro': 'gemini-2.5-pro',
  'Gemini 2.5 Flash': 'gemini-2.5-flash',
  'Gemini 2.0 Flash': 'gemini-2.0-flash',
  'Claude Sonnet 4.5': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'Claude Opus 4': 'us.anthropic.claude-opus-4-20250514-v1:0',
  'Llama 3.3 70B': 'llama3.3:70b',
  'Qwen 3': 'qwen3:latest',
};

// ============================================================================
// COMPONENTS
// ============================================================================

interface LLMProviderManagementProps {
  theme: string;
}

// Provider Form Component
interface ProviderFormProps {
  provider: any;
  onSave: (data: any) => void;
  onCancel: () => void;
}

const ProviderForm: React.FC<ProviderFormProps> = ({ provider, onSave, onCancel }) => {
  const [formData, setFormData] = useState({
    name: provider?.name || '',
    displayName: provider?.display_name || '',
    providerType: provider?.provider_type || 'vertex-ai',
    enabled: provider?.enabled ?? true,
    priority: provider?.priority || 1,
    description: provider?.description || '',

    // Auth config
    apiKey: provider?.auth_config?.apiKey || '',
    endpoint: provider?.auth_config?.endpoint || '',
    projectId: provider?.auth_config?.projectId || '',
    region: provider?.auth_config?.region || '',
    deploymentName: provider?.auth_config?.deploymentName || '',

    // Model config - standardized model fields
    defaultModel: provider?.model_config?.defaultModel || '',
    chatModel: provider?.model_config?.chatModel || '',
    embeddingModel: provider?.model_config?.embeddingModel || '',
    visionModel: provider?.model_config?.visionModel || '',
    imageModel: provider?.model_config?.imageModel || '',
    compactionModel: provider?.model_config?.compactionModel || '',
    maxTokens: provider?.model_config?.maxTokens || 8192,
    temperature: provider?.model_config?.temperature || 1,

    // Thinking configuration (for Gemini/Claude models)
    thinkingLevel: provider?.model_config?.thinkingLevel || 'high',
    thinkingBudget: provider?.model_config?.thinkingBudget || 8000,
  });

  const [showApiKey, setShowApiKey] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const authConfig: any = {};
    const providerConfig: any = {};

    // Build auth config based on provider type
    if (formData.providerType === 'azure-openai') {
      authConfig.apiKey = formData.apiKey;
      authConfig.endpoint = formData.endpoint;
      authConfig.deploymentName = formData.deploymentName;
    } else if (formData.providerType === 'vertex-ai') {
      authConfig.projectId = formData.projectId;
      authConfig.region = formData.region || 'us-central1';
    } else if (formData.providerType === 'aws-bedrock') {
      authConfig.region = formData.region || 'us-east-1';
    } else if (formData.providerType === 'ollama') {
      authConfig.endpoint = formData.endpoint || 'http://ollama:11434';
    }

    // Build model config with all standardized fields
    const modelConfig: any = {
      defaultModel: formData.defaultModel || formData.chatModel,
      maxTokens: formData.maxTokens,
      temperature: formData.temperature,
    };

    // Add specific model configs if provided
    if (formData.chatModel) modelConfig.chatModel = formData.chatModel;
    if (formData.embeddingModel) modelConfig.embeddingModel = formData.embeddingModel;
    if (formData.visionModel) modelConfig.visionModel = formData.visionModel;
    if (formData.imageModel) modelConfig.imageModel = formData.imageModel;
    if (formData.compactionModel) modelConfig.compactionModel = formData.compactionModel;

    // Add thinking config for Vertex AI (Gemini) and Bedrock (Claude)
    if (formData.providerType === 'vertex-ai') {
      // Gemini 3/2.5 uses thinkingLevel ('low' or 'high')
      modelConfig.thinkingLevel = formData.thinkingLevel;
    } else if (formData.providerType === 'aws-bedrock') {
      // Claude uses thinkingBudget (token count)
      modelConfig.thinkingBudget = formData.thinkingBudget;
    }

    onSave({
      name: formData.name,
      displayName: formData.displayName,
      providerType: formData.providerType,
      enabled: formData.enabled,
      priority: formData.priority,
      description: formData.description,
      authConfig,
      providerConfig,
      modelConfig,
      capabilities: {
        chat: true,
        embeddings: !!formData.embeddingModel,
        tools: true,
        vision: !!formData.visionModel || formData.providerType === 'vertex-ai',
        streaming: true,
        thinking: formData.providerType === 'vertex-ai' || formData.providerType === 'aws-bedrock',
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6">
      {/* Basic Info */}
      <div className="space-y-4">
        <h4 className="font-medium text-text-primary">Basic Information</h4>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Provider Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="my-vertex-provider"
              required
              disabled={!!provider}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Display Name *</label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="My Vertex AI Provider"
              required
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Provider Type *</label>
            <select
              value={formData.providerType}
              onChange={(e) => setFormData({ ...formData, providerType: e.target.value })}
              disabled={!!provider}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            >
              <option value="vertex-ai">Google Vertex AI</option>
              <option value="azure-openai">Azure OpenAI</option>
              <option value="aws-bedrock">AWS Bedrock</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Priority</label>
            <input
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 1 })}
              min={1}
              max={100}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
          <input
            type="text"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Optional description"
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="enabled"
            checked={formData.enabled}
            onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
            className="rounded"
          />
          <label htmlFor="enabled" className="text-sm text-text-primary">Enabled</label>
        </div>
      </div>

      {/* Provider-specific config */}
      <div className="space-y-4">
        <h4 className="font-medium text-text-primary">Authentication</h4>

        {formData.providerType === 'azure-openai' && (
          <>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Endpoint *</label>
              <input
                type="text"
                value={formData.endpoint}
                onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                placeholder="https://your-resource.openai.azure.com"
                required
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">API Key *</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  placeholder="Your Azure OpenAI API key"
                  required
                  className="w-full px-3 py-2 pr-10 rounded-lg border text-sm"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Deployment Name</label>
              <input
                type="text"
                value={formData.deploymentName}
                onChange={(e) => setFormData({ ...formData, deploymentName: e.target.value })}
                placeholder="gpt-4"
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>
          </>
        )}

        {formData.providerType === 'vertex-ai' && (
          <>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Project ID *</label>
              <input
                type="text"
                value={formData.projectId}
                onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                placeholder="your-gcp-project-id"
                required
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Region</label>
              <select
                value={formData.region}
                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              >
                <option value="us-central1">us-central1</option>
                <option value="us-east1">us-east1</option>
                <option value="us-west1">us-west1</option>
                <option value="europe-west1">europe-west1</option>
                <option value="asia-east1">asia-east1</option>
                <option value="global">global (for Gemini 3)</option>
              </select>
            </div>
          </>
        )}

        {formData.providerType === 'aws-bedrock' && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Region *</label>
            <select
              value={formData.region}
              onChange={(e) => setFormData({ ...formData, region: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            >
              <option value="us-east-1">us-east-1</option>
              <option value="us-west-2">us-west-2</option>
              <option value="eu-west-1">eu-west-1</option>
              <option value="ap-northeast-1">ap-northeast-1</option>
            </select>
            <p className="text-xs text-text-secondary mt-1">
              AWS credentials are loaded from environment (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
            </p>
          </div>
        )}

        {formData.providerType === 'ollama' && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Endpoint</label>
            <input
              type="text"
              value={formData.endpoint}
              onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
              placeholder="http://ollama:11434"
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
          </div>
        )}
      </div>

      {/* Model config */}
      <div className="space-y-4">
        <h4 className="font-medium text-text-primary">Model Configuration</h4>

        {/* Primary model settings */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Chat Model *</label>
            <input
              type="text"
              value={formData.chatModel}
              onChange={(e) => setFormData({ ...formData, chatModel: e.target.value })}
              placeholder={formData.providerType === 'vertex-ai' ? 'gemini-2.5-pro-preview-06-05' : 'us.anthropic.claude-sonnet-4-20250514-v1:0'}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Max Tokens</label>
            <input
              type="number"
              value={formData.maxTokens}
              onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) || 8192 })}
              min={1}
              max={200000}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Temperature</label>
            <input
              type="number"
              value={formData.temperature}
              onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 1 })}
              min={0}
              max={2}
              step={0.1}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
          </div>
        </div>

        {/* Specialized model settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Embedding Model</label>
            <input
              type="text"
              value={formData.embeddingModel}
              onChange={(e) => setFormData({ ...formData, embeddingModel: e.target.value })}
              placeholder={formData.providerType === 'vertex-ai' ? 'text-embedding-004' : 'amazon.titan-embed-text-v2:0'}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
            <p className="text-xs text-text-secondary mt-1">For vector embeddings (RAG)</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Vision Model</label>
            <input
              type="text"
              value={formData.visionModel}
              onChange={(e) => setFormData({ ...formData, visionModel: e.target.value })}
              placeholder={formData.providerType === 'vertex-ai' ? 'gemini-2.5-pro-preview-06-05' : ''}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text)'
              }}
            />
            <p className="text-xs text-text-secondary mt-1">For image analysis</p>
          </div>
        </div>

        {/* Thinking configuration - only for Vertex AI and AWS Bedrock */}
        {(formData.providerType === 'vertex-ai' || formData.providerType === 'aws-bedrock') && (
          <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Brain size={16} className="text-purple-500" />
              <h5 className="font-medium text-text-primary">Extended Thinking</h5>
            </div>

            {formData.providerType === 'vertex-ai' ? (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Thinking Level</label>
                <select
                  value={formData.thinkingLevel}
                  onChange={(e) => setFormData({ ...formData, thinkingLevel: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)'
                  }}
                >
                  <option value="low">Low (faster, less thinking)</option>
                  <option value="high">High (slower, more thorough)</option>
                </select>
                <p className="text-xs text-text-secondary mt-1">
                  For Gemini 3/2.5 models with thinking capability
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Thinking Budget (tokens)</label>
                <input
                  type="number"
                  value={formData.thinkingBudget}
                  onChange={(e) => setFormData({ ...formData, thinkingBudget: parseInt(e.target.value) || 8000 })}
                  min={1000}
                  max={100000}
                  step={1000}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)'
                  }}
                />
                <p className="text-xs text-text-secondary mt-1">
                  Token budget for Claude's extended thinking (default: 8000)
                </p>
              </div>
            )}
          </div>
        )}

        {/* Advanced model configs - collapsible */}
        <details className="mt-2">
          <summary className="text-sm text-text-secondary cursor-pointer hover:text-text-primary">
            Advanced Model Settings
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Image Model</label>
              <input
                type="text"
                value={formData.imageModel}
                onChange={(e) => setFormData({ ...formData, imageModel: e.target.value })}
                placeholder="Optional - for image generation"
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Compaction Model</label>
              <input
                type="text"
                value={formData.compactionModel}
                onChange={(e) => setFormData({ ...formData, compactionModel: e.target.value })}
                placeholder="Optional - for context compaction"
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Default Model (legacy)</label>
              <input
                type="text"
                value={formData.defaultModel}
                onChange={(e) => setFormData({ ...formData, defaultModel: e.target.value })}
                placeholder="Falls back to Chat Model if empty"
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>
          </div>
        </details>
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg font-medium transition-colors"
          style={{ backgroundColor: 'var(--color-surfaceHover)', color: 'var(--color-text)' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium transition-colors hover:bg-blue-600 flex items-center gap-2"
        >
          <Save size={16} />
          {provider ? 'Update' : 'Create'} Provider
        </button>
      </div>
    </form>
  );
};

export const LLMProviderManagement: React.FC<LLMProviderManagementProps> = ({ theme }) => {
  const { getAccessToken } = useAuth();

  // State
  const [activeTab, setActiveTab] = useState<'playground' | 'models' | 'ollama' | 'providers' | 'metrics'>('models');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Playground state
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [playgroundMessages, setPlaygroundMessages] = useState<TestMessage[]>([]);
  const [playgroundInput, setPlaygroundInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [lastTokenUsage, setLastTokenUsage] = useState<{ prompt: number; completion: number; total: number } | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [playgroundSessionId] = useState(() => `playground_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Comprehensive Playground Config - All SDK Options
  const [playgroundConfig, setPlaygroundConfig] = useState({
    // Universal options
    temperature: 1,
    maxTokens: 4096,
    topP: 1,
    topK: 40,
    stopSequences: [] as string[],
    stream: true,

    // OpenAI/Azure specific
    frequencyPenalty: 0,
    presencePenalty: 0,
    seed: undefined as number | undefined,
    responseFormat: 'text' as 'text' | 'json_object' | 'json_schema',
    logprobs: false,
    topLogprobs: 0,

    // Anthropic/Claude specific
    enableThinking: false,
    thinkingBudget: 8000,

    // Google Vertex AI specific
    safetyLevel: 'BLOCK_MEDIUM_AND_ABOVE' as 'BLOCK_NONE' | 'BLOCK_LOW_AND_ABOVE' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_ONLY_HIGH',
    enableGrounding: false,

    // Ollama specific
    numCtx: 4096,
    repeatPenalty: 1.1,
    mirostat: 0 as 0 | 1 | 2,
    mirostatEta: 0.1,
    mirostatTau: 5.0,
  });

  // Track which provider type is selected (for showing relevant options)
  const getSelectedProviderType = (): string => {
    if (selectedProvider) {
      const provider = dbProviders.find(p => p.name === selectedProvider);
      return provider?.provider_type || 'unknown';
    }
    // Try to infer from model
    if (selectedModel) {
      if (selectedModel.includes('gemini') || selectedModel.includes('vertex')) return 'google-vertex';
      if (selectedModel.includes('claude') || selectedModel.includes('anthropic')) return 'aws-bedrock';
      if (selectedModel.includes('gpt') || selectedModel.includes('o1') || selectedModel.includes('o3')) return 'azure-openai';
      if (ollamaModels.some(m => m.name === selectedModel)) return 'ollama';
    }
    return 'unknown';
  };

  // Helper for backward compat
  const playgroundTemperature = playgroundConfig.temperature;
  const setPlaygroundTemperature = (val: number) => setPlaygroundConfig(prev => ({ ...prev, temperature: val }));
  const playgroundMaxTokens = playgroundConfig.maxTokens;
  const setPlaygroundMaxTokens = (val: number) => setPlaygroundConfig(prev => ({ ...prev, maxTokens: val }));

  // Model management state
  const [showAddModel, setShowAddModel] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);

  // Live model discovery state
  const [availableModels, setAvailableModels] = useState<Array<{
    id: string;
    name: string;
    provider: string;
    category: string;
    description?: string;
    inputCostPer1M?: number;
    outputCostPer1M?: number;
    capabilities?: string[];
  }>>([]);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [modelSearchProvider, setModelSearchProvider] = useState<string>('');
  const [modelSearchCategory, setModelSearchCategory] = useState<string>('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [addingModelId, setAddingModelId] = useState<string | null>(null);

  // Metrics state
  const [metrics, setMetrics] = useState<any[]>([]);
  const [healthStatus, setHealthStatus] = useState<any[]>([]);

  // Ollama state
  const [ollamaModels, setOllamaModels] = useState<any[]>([]);
  const [pullModelName, setPullModelName] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<string>('');
  const [ollamaLoading, setOllamaLoading] = useState(false);

  // Database providers state (for CRUD)
  const [dbProviders, setDbProviders] = useState<any[]>([]);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any>(null);
  // Track which provider's config panel is expanded
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch providers
      const providersRes = await apiRequest('/admin/llm-providers');
      if (providersRes.ok) {
        const data = await providersRes.json();
        setProviders(data.providers || []);

        // Extract models from providers
        const allModels: Model[] = [];
        (data.providers || []).forEach((p: any) => {
          (p.models || []).forEach((m: any) => {
            allModels.push({
              id: m.id,
              name: m.name || m.id,
              provider: p.name,
              providerType: p.type || 'vertex-ai',
              enabled: true,
              capabilities: m.capabilities || { chat: true, vision: false, tools: true, streaming: true },
              config: { maxTokens: m.maxTokens || 8192, temperature: 1 }
            });
          });
        });
        setModels(allModels);

        // Set default selected model
        if (allModels.length > 0 && !selectedModel) {
          setSelectedModel(allModels[0].id);
        }
      }

      // Fetch health
      const healthRes = await apiRequest('/admin/llm-providers/health');
      if (healthRes.ok) {
        const data = await healthRes.json();
        setHealthStatus(data.providers || []);
      }

      // Fetch metrics
      const metricsRes = await apiRequest('/admin/llm-providers/metrics');
      if (metricsRes.ok) {
        const data = await metricsRes.json();
        setMetrics(data.providers || []);
      }

      // Fetch database providers (for CRUD)
      const dbRes = await apiRequest('/admin/llm-providers/database');
      if (dbRes.ok) {
        const data = await dbRes.json();
        setDbProviders(data.providers || []);
      }

      // Fetch Ollama models
      await fetchOllamaModels();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  const fetchOllamaModels = async () => {
    try {
      setOllamaLoading(true);
      const res = await apiRequest('/admin/llm-providers/ollama/models');
      if (res.ok) {
        const data = await res.json();
        setOllamaModels(data.models || []);
      }
    } catch (err) {
      console.warn('Failed to fetch Ollama models:', err);
    } finally {
      setOllamaLoading(false);
    }
  };

  const pullOllamaModel = async () => {
    if (!pullModelName.trim() || isPulling) return;

    setIsPulling(true);
    setPullProgress('Starting download...');

    try {
      const token = await getAccessToken();
      const response = await fetch('/api/admin/llm-providers/ollama/models/pull', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-AgenticWork-Frontend': 'true'
        },
        body: JSON.stringify({ model: pullModelName.trim() })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`);
      }

      // Stream the progress
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.status) {
              let progress = data.status;
              if (data.completed && data.total) {
                const pct = Math.round((data.completed / data.total) * 100);
                progress = `${data.status} - ${pct}%`;
              }
              setPullProgress(progress);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      setPullProgress('Download complete!');
      setPullModelName('');
      await fetchOllamaModels();

      setTimeout(() => setPullProgress(''), 3000);

    } catch (err) {
      setPullProgress(`Error: ${err instanceof Error ? err.message : 'Failed to pull model'}`);
    } finally {
      setIsPulling(false);
    }
  };

  const deleteOllamaModel = async (modelName: string) => {
    if (!confirm(`Are you sure you want to delete ${modelName}?`)) return;

    try {
      const res = await apiRequest(`/admin/llm-providers/ollama/models/${encodeURIComponent(modelName)}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        await fetchOllamaModels();
      } else {
        const data = await res.json();
        alert(`Failed to delete model: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to delete model: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const testProviderCapabilities = async (providerName: string, testType: string = 'all') => {
    try {
      const res = await apiRequest(`/admin/llm-providers/${providerName}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testType })
      });

      if (res.ok) {
        const data = await res.json();
        alert(`Test Results:\n${JSON.stringify(data.summary, null, 2)}`);
      } else {
        const data = await res.json();
        alert(`Test failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [playgroundMessages]);

  // ============================================================================
  // PLAYGROUND FUNCTIONS
  // ============================================================================

  const sendPlaygroundMessage = async () => {
    if (!playgroundInput.trim() || !selectedModel || isStreaming) return;

    const userMessage: TestMessage = { role: 'user', content: playgroundInput };
    setPlaygroundMessages(prev => [...prev, userMessage]);
    setPlaygroundInput('');
    setIsStreaming(true);

    const startTime = Date.now();
    let assistantContent = '';
    let thinkingContent = '';

    try {
      const token = await getAccessToken();

      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-AgenticWork-Frontend': 'true'
        },
        body: JSON.stringify({
          message: playgroundInput,
          sessionId: playgroundSessionId,
          model: selectedModel || undefined,
          provider: selectedProvider || undefined,
          systemPrompt: systemPrompt,
          max_tokens: playgroundMaxTokens,
          temperature: playgroundTemperature
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // Add empty assistant message that we'll update
      setPlaygroundMessages(prev => [...prev, { role: 'assistant', content: '', thinking: '' }]);

      let buffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // Skip event type lines
            continue;
          }
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              // Handle stream content (SSE format)
              if (parsed.content && parsed.delta) {
                assistantContent += parsed.content;
              }

              // Handle thinking_event
              if (parsed.accumulated) {
                thinkingContent = parsed.accumulated;
              }

              // Handle message_updated (final message with token usage)
              if (parsed.tokenUsage) {
                setLastTokenUsage({
                  prompt: parsed.tokenUsage.prompt_tokens || 0,
                  completion: parsed.tokenUsage.completion_tokens || 0,
                  total: parsed.tokenUsage.total_tokens || 0
                });
                if (parsed.content) {
                  assistantContent = parsed.content;
                }
                if (parsed.thinkingContent) {
                  thinkingContent = parsed.thinkingContent;
                }
              }

              // Handle done event with usage
              if (parsed.usage) {
                setLastTokenUsage({
                  prompt: parsed.usage.prompt_tokens || 0,
                  completion: parsed.usage.completion_tokens || 0,
                  total: parsed.usage.total_tokens || 0
                });
              }

              // Update the last message
              setPlaygroundMessages(prev => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (updated[lastIdx]?.role === 'assistant') {
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    content: assistantContent,
                    thinking: thinkingContent || undefined
                  };
                }
                return updated;
              });
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Update with final latency
      const latency = Date.now() - startTime;
      setPlaygroundMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = { ...updated[lastIdx], latency };
        }
        return updated;
      });

    } catch (err) {
      setPlaygroundMessages(prev => [
        ...prev.slice(0, -1), // Remove empty assistant message
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Request failed'}` }
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  const clearPlayground = () => {
    setPlaygroundMessages([]);
  };

  // ============================================================================
  // MODEL MANAGEMENT FUNCTIONS
  // ============================================================================

  const addPresetModel = async (preset: Omit<Model, 'id'>) => {
    const modelId = MODEL_ID_MAP[preset.name] || preset.name.toLowerCase().replace(/\s+/g, '-');

    // For now, just add to the models list and set as selected
    const newModel: Model = {
      ...preset,
      id: modelId,
    };

    setModels(prev => [...prev, newModel]);
    setSelectedModel(modelId);
    setShowAddModel(false);

    // TODO: Persist to database via API
  };

  const testModel = async (modelId: string) => {
    setSelectedModel(modelId);
    setActiveTab('playground');
    setPlaygroundInput('Hello! Please introduce yourself briefly.');
  };

  // Fetch available models from all providers (live discovery)
  const fetchAvailableModels = async () => {
    setIsLoadingModels(true);
    try {
      const params = new URLSearchParams();
      if (modelSearchProvider) params.append('provider', modelSearchProvider);
      if (modelSearchQuery) params.append('search', modelSearchQuery);
      if (modelSearchCategory) params.append('category', modelSearchCategory);
      params.append('limit', '100');

      const response = await apiRequest(`/admin/llm-providers/available-models?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        if (data.models) {
          setAvailableModels(data.models);
        }
      }
    } catch (err) {
      console.error('Failed to fetch available models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Add a model from the search results - creates an LLM Provider in the database
  const addModelFromSearch = async (model: typeof availableModels[0]) => {
    setAddingModelId(model.id);
    const providerType = model.provider as Model['providerType'];

    // Check if a provider already exists for this provider type
    const existingProvider = dbProviders.find(p => p.provider_type === providerType);

    if (existingProvider) {
      // Provider exists - update its model_config to use this model
      try {
        const updatedModelConfig = {
          ...existingProvider.model_config,
          chatModel: model.id,
          defaultModel: model.id,
        };

        await apiRequest(`/admin/llm-providers/${existingProvider.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...existingProvider,
            model_config: updatedModelConfig,
          })
        });

        // Refresh data to show updated provider
        await fetchData();

        // Update local models state for playground
        const newModel: Model = {
          id: model.id,
          name: model.name,
          provider: model.provider,
          providerType: providerType,
          enabled: true,
          capabilities: {
            chat: model.category === 'chat',
            vision: (model.capabilities || []).includes('vision'),
            tools: (model.capabilities || []).includes('function-calling'),
            streaming: (model.capabilities || []).includes('streaming'),
          },
          config: {
            maxTokens: model.maxTokens || 8192,
            temperature: 1.0,
          },
        };

        setModels(prev => {
          if (prev.some(m => m.id === model.id)) return prev;
          return [...prev, newModel];
        });

        setSelectedModel(model.id);
      } catch (err) {
        console.error('Failed to update provider with new model:', err);
        alert(`Failed to update provider: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setAddingModelId(null);
        return;
      }
    } else {
      // No provider exists - create a new one
      try {
        // Build provider data based on provider type
        const providerData: any = {
          name: `${providerType}-${Date.now()}`,
          displayName: `${model.provider} (${model.name})`,
          providerType: providerType,
          enabled: true,
          priority: dbProviders.length + 1,
          description: model.description || `Auto-configured from Live Model Discovery`,
          authConfig: {},
          providerConfig: {},
          modelConfig: {
            chatModel: model.id,
            defaultModel: model.id,
            maxTokens: model.maxTokens || 8192,
            temperature: 1.0,
          },
          capabilities: {
            chat: model.category === 'chat',
            embeddings: model.category === 'embedding',
            tools: (model.capabilities || []).includes('function-calling'),
            vision: (model.capabilities || []).includes('vision'),
            streaming: (model.capabilities || []).includes('streaming'),
            thinking: providerType === 'vertex-ai' || providerType === 'aws-bedrock',
          }
        };

        // Add provider-specific auth config hints
        if (providerType === 'vertex-ai') {
          providerData.authConfig.projectId = process.env.GOOGLE_CLOUD_PROJECT || '';
          providerData.authConfig.region = 'us-central1';
        } else if (providerType === 'aws-bedrock') {
          providerData.authConfig.region = process.env.AWS_REGION || 'us-east-1';
        } else if (providerType === 'ollama') {
          providerData.authConfig.endpoint = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
        }

        await apiRequest('/admin/llm-providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(providerData)
        });

        // Refresh data to show new provider
        await fetchData();

        // Update local models state for playground
        const newModel: Model = {
          id: model.id,
          name: model.name,
          provider: model.provider,
          providerType: providerType,
          enabled: true,
          capabilities: {
            chat: model.category === 'chat',
            vision: (model.capabilities || []).includes('vision'),
            tools: (model.capabilities || []).includes('function-calling'),
            streaming: (model.capabilities || []).includes('streaming'),
          },
          config: {
            maxTokens: model.maxTokens || 8192,
            temperature: 1.0,
          },
        };

        setModels(prev => {
          if (prev.some(m => m.id === model.id)) return prev;
          return [...prev, newModel];
        });

        setSelectedModel(model.id);
      } catch (err) {
        console.error('Failed to create provider:', err);
        alert(`Failed to create provider: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setAddingModelId(null);
        return;
      }
    }

    setAddingModelId(null);
    setShowModelPicker(false);
  };

  // ============================================================================
  // RENDER FUNCTIONS
  // ============================================================================

  const renderPlayground = () => (
    <div className="h-[calc(100vh-280px)] flex flex-col">
      {/* Model Selection & Settings Bar */}
      <div className="flex items-center gap-4 p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex-1">
          <label className="block text-xs text-text-secondary mb-1">Provider</label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm font-medium"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
          >
            <option value="">Auto (default)</option>
            {dbProviders.filter(p => p.enabled).map(p => (
              <option key={p.name} value={p.name}>
                {p.display_name || p.name} ({p.provider_type})
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-xs text-text-secondary mb-1">Model</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm font-medium"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
          >
            {models.length === 0 ? (
              <option value="">No models available</option>
            ) : (
              models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id} ({m.provider})
                </option>
              ))
            )}
            {/* Add Ollama models to the list */}
            {ollamaModels.map(m => (
              <option key={`ollama-${m.name}`} value={m.name}>
                {m.name} (ollama)
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-xs text-text-secondary mb-1">System Prompt</label>
          <input
            type="text"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            placeholder="System prompt..."
          />
        </div>

        <div className="pt-5 flex gap-2">
          <button
            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            style={{ backgroundColor: 'var(--color-surfaceHover)', color: 'var(--color-text)' }}
            title="Advanced Settings"
          >
            <Sliders size={14} />
          </button>
          <button
            onClick={clearPlayground}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            style={{ backgroundColor: 'var(--color-surfaceHover)', color: 'var(--color-text)' }}
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </div>

      {/* Advanced Settings Panel */}
      {showAdvancedSettings && (() => {
        const providerType = getSelectedProviderType();
        const isOpenAI = providerType === 'azure-openai' || providerType === 'azure-ai-foundry';
        const isClaude = providerType === 'aws-bedrock' || providerType === 'azure-ai-foundry';
        const isGoogle = providerType === 'google-vertex';
        const isOllama = providerType === 'ollama';

        return (
          <div className="p-4 border-b space-y-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surfaceSecondary)' }}>
            {/* Row 1: Universal options */}
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary">Temperature</label>
                <input
                  type="range" min="0" max="2" step="0.1"
                  value={playgroundConfig.temperature}
                  onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="w-24"
                />
                <span className="text-xs font-mono text-text-primary w-8">{playgroundConfig.temperature}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary">Max Tokens</label>
                <input
                  type="number" min="1" max="200000"
                  value={playgroundConfig.maxTokens}
                  onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 4096 }))}
                  className="w-24 px-2 py-1 rounded border text-xs"
                  style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary">Top P</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={playgroundConfig.topP}
                  onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, topP: parseFloat(e.target.value) }))}
                  className="w-20"
                />
                <span className="text-xs font-mono text-text-primary w-8">{playgroundConfig.topP}</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary">Top K</label>
                <input
                  type="number" min="1" max="500"
                  value={playgroundConfig.topK}
                  onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, topK: parseInt(e.target.value) || 40 }))}
                  className="w-16 px-2 py-1 rounded border text-xs"
                  style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
              {lastTokenUsage && (
                <div className="flex items-center gap-4 ml-auto text-xs text-text-secondary">
                  <span>Prompt: <strong className="text-text-primary">{lastTokenUsage.prompt.toLocaleString()}</strong></span>
                  <span>Completion: <strong className="text-text-primary">{lastTokenUsage.completion.toLocaleString()}</strong></span>
                  <span>Total: <strong className="text-blue-500">{lastTokenUsage.total.toLocaleString()}</strong></span>
                </div>
              )}
            </div>

            {/* Row 2: Provider-specific options */}
            <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-dashed" style={{ borderColor: 'var(--color-border)' }}>
              {/* OpenAI/Azure Options */}
              {isOpenAI && (
                <>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary">Frequency Penalty</label>
                    <input
                      type="range" min="-2" max="2" step="0.1"
                      value={playgroundConfig.frequencyPenalty}
                      onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, frequencyPenalty: parseFloat(e.target.value) }))}
                      className="w-20"
                    />
                    <span className="text-xs font-mono text-text-primary w-8">{playgroundConfig.frequencyPenalty}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary">Presence Penalty</label>
                    <input
                      type="range" min="-2" max="2" step="0.1"
                      value={playgroundConfig.presencePenalty}
                      onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, presencePenalty: parseFloat(e.target.value) }))}
                      className="w-20"
                    />
                    <span className="text-xs font-mono text-text-primary w-8">{playgroundConfig.presencePenalty}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary">Response Format</label>
                    <select
                      value={playgroundConfig.responseFormat}
                      onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, responseFormat: e.target.value as 'text' | 'json_object' | 'json_schema' }))}
                      className="px-2 py-1 rounded border text-xs"
                      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      <option value="text">Text</option>
                      <option value="json_object">JSON Object</option>
                    </select>
                  </div>
                </>
              )}

              {/* Claude/Anthropic Options */}
              {isClaude && (
                <>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={playgroundConfig.enableThinking}
                        onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, enableThinking: e.target.checked }))}
                        className="rounded"
                      />
                      <span className="text-xs text-text-secondary flex items-center gap-1">
                        <Brain size={12} className="text-purple-500" />
                        Extended Thinking
                      </span>
                    </label>
                  </div>
                  {playgroundConfig.enableThinking && (
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-text-secondary">Thinking Budget</label>
                      <input
                        type="number" min="1024" max="128000" step="1000"
                        value={playgroundConfig.thinkingBudget}
                        onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, thinkingBudget: parseInt(e.target.value) || 8000 }))}
                        className="w-24 px-2 py-1 rounded border text-xs"
                        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      />
                      <span className="text-xs text-text-secondary">tokens</span>
                    </div>
                  )}
                </>
              )}

              {/* Google Vertex AI Options */}
              {isGoogle && (
                <>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary">Safety Level</label>
                    <select
                      value={playgroundConfig.safetyLevel}
                      onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, safetyLevel: e.target.value as any }))}
                      className="px-2 py-1 rounded border text-xs"
                      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      <option value="BLOCK_NONE">Block None</option>
                      <option value="BLOCK_LOW_AND_ABOVE">Block Low+</option>
                      <option value="BLOCK_MEDIUM_AND_ABOVE">Block Medium+</option>
                      <option value="BLOCK_ONLY_HIGH">Block High Only</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={playgroundConfig.enableGrounding}
                        onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, enableGrounding: e.target.checked }))}
                        className="rounded"
                      />
                      <span className="text-xs text-text-secondary">Google Search Grounding</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={playgroundConfig.enableThinking}
                        onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, enableThinking: e.target.checked }))}
                        className="rounded"
                      />
                      <span className="text-xs text-text-secondary flex items-center gap-1">
                        <Brain size={12} className="text-purple-500" />
                        Thinking Mode
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* Ollama Options */}
              {isOllama && (
                <>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary">Context Length</label>
                    <input
                      type="number" min="128" max="131072"
                      value={playgroundConfig.numCtx}
                      onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, numCtx: parseInt(e.target.value) || 4096 }))}
                      className="w-24 px-2 py-1 rounded border text-xs"
                      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary">Repeat Penalty</label>
                    <input
                      type="range" min="0" max="2" step="0.1"
                      value={playgroundConfig.repeatPenalty}
                      onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, repeatPenalty: parseFloat(e.target.value) }))}
                      className="w-20"
                    />
                    <span className="text-xs font-mono text-text-primary w-8">{playgroundConfig.repeatPenalty}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-text-secondary">Mirostat</label>
                    <select
                      value={playgroundConfig.mirostat}
                      onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, mirostat: parseInt(e.target.value) as 0 | 1 | 2 }))}
                      className="px-2 py-1 rounded border text-xs"
                      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      <option value={0}>Disabled</option>
                      <option value={1}>Mirostat 1</option>
                      <option value={2}>Mirostat 2</option>
                    </select>
                  </div>
                </>
              )}

              {/* Provider indicator */}
              <div className="ml-auto px-2 py-1 rounded text-xs bg-blue-500/10 text-blue-500">
                {providerType === 'azure-openai' && 'Azure OpenAI'}
                {providerType === 'aws-bedrock' && 'AWS Bedrock (Claude)'}
                {providerType === 'google-vertex' && 'Google Vertex AI'}
                {providerType === 'ollama' && 'Ollama'}
                {providerType === 'azure-ai-foundry' && 'Azure AI Foundry'}
                {providerType === 'unknown' && 'Auto-detect'}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {playgroundMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="p-4 rounded-full bg-blue-500/10 mb-4">
              <MessageSquare size={32} className="text-blue-500" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">Model Testing Playground</h3>
            <p className="text-text-secondary max-w-md">
              Select a model above and send a message to test it. Streaming responses, thinking content,
              and latency will be shown in real-time.
            </p>

            {/* Quick prompts */}
            <div className="flex flex-wrap gap-2 mt-6 max-w-lg justify-center">
              {[
                'Hello! What can you do?',
                'Write a haiku about coding',
                'Explain quantum computing simply',
                'What is 2+2? Show your reasoning.'
              ].map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => setPlaygroundInput(prompt)}
                  className="px-3 py-1.5 text-sm rounded-full border transition-colors hover:bg-blue-500/10 hover:border-blue-500"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          playgroundMessages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'border'
                }`}
                style={msg.role === 'assistant' ? {
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)'
                } : undefined}
              >
                {/* Thinking content */}
                {msg.thinking && (
                  <div className="mb-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <div className="flex items-center gap-2 text-purple-400 text-xs font-medium mb-1">
                      <Brain size={12} />
                      Thinking
                    </div>
                    <div className="text-sm text-purple-300 whitespace-pre-wrap">{msg.thinking}</div>
                  </div>
                )}

                {/* Main content */}
                <div className={`text-sm whitespace-pre-wrap ${msg.role === 'assistant' ? 'text-text-primary' : ''}`}>
                  {msg.content || (isStreaming && idx === playgroundMessages.length - 1 ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                    </span>
                  ) : '')}
                </div>

                {/* Latency badge */}
                {msg.latency && (
                  <div className="mt-2 text-xs opacity-60 flex items-center gap-1">
                    <Clock size={10} />
                    {msg.latency}ms
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex gap-2">
          <input
            type="text"
            value={playgroundInput}
            onChange={(e) => setPlaygroundInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendPlaygroundMessage()}
            placeholder="Type a message to test the model..."
            disabled={isStreaming || !selectedModel}
            className="flex-1 px-4 py-3 rounded-xl border text-sm"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
          />
          <button
            onClick={sendPlaygroundMessage}
            disabled={isStreaming || !selectedModel || !playgroundInput.trim()}
            className="px-6 py-3 bg-blue-500 text-white rounded-xl font-medium transition-colors hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isStreaming ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            Send
          </button>
        </div>
      </div>
    </div>
  );

  const renderModels = () => (
    <div className="space-y-6">
      {/* Quick Add Section */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Quick Add Models</h3>
            <p className="text-sm text-text-secondary">Add pre-configured models with one click</p>
          </div>
        </div>

        <div className="space-y-4">
          {Object.entries(PRESET_MODELS).map(([providerType, presets]) => (
            <div key={providerType}>
              <h4 className="text-sm font-medium text-text-secondary mb-2 flex items-center gap-2">
                {providerType === 'vertex-ai' && <Globe size={14} className="text-blue-500" />}
                {providerType === 'aws-bedrock' && <Cpu size={14} className="text-orange-500" />}
                {providerType === 'ollama' && <Terminal size={14} className="text-green-500" />}
                {providerType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset, idx) => {
                  const modelId = MODEL_ID_MAP[preset.name];
                  const isAdded = models.some(m => m.id === modelId);

                  return (
                    <button
                      key={idx}
                      onClick={() => !isAdded && addPresetModel(preset)}
                      disabled={isAdded}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                        isAdded
                          ? 'bg-green-500/10 text-green-500 cursor-default'
                          : 'border hover:bg-blue-500/10 hover:border-blue-500 hover:text-blue-500'
                      }`}
                      style={!isAdded ? { borderColor: 'var(--color-border)', color: 'var(--color-text)' } : undefined}
                    >
                      {isAdded ? <Check size={14} /> : <Plus size={14} />}
                      {preset.name}
                      {preset.capabilities.thinking && (
                        <Brain size={12} className="text-purple-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Model Discovery Section */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Database size={18} className="text-purple-500" />
              Live Model Discovery
            </h3>
            <p className="text-sm text-text-secondary">Search available models from all connected providers</p>
          </div>
          <button
            onClick={() => {
              setShowModelPicker(!showModelPicker);
              if (!showModelPicker && availableModels.length === 0) {
                fetchAvailableModels();
              }
            }}
            className="px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 transition-colors flex items-center gap-2"
          >
            <Globe size={16} />
            {showModelPicker ? 'Hide Models' : 'Browse All Models'}
          </button>
        </div>

        {showModelPicker && (
          <div className="space-y-4">
            {/* Search and Filters */}
            <div className="flex gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search models by name or ID..."
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchAvailableModels()}
                  className="w-full px-4 py-2 rounded-lg border text-sm"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)'
                  }}
                />
              </div>
              <select
                value={modelSearchProvider}
                onChange={(e) => setModelSearchProvider(e.target.value)}
                className="px-4 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              >
                <option value="">All Providers</option>
                <option value="aws-bedrock">AWS Bedrock</option>
                <option value="vertex-ai">Google Vertex AI</option>
                <option value="azure-openai">Azure OpenAI</option>
                <option value="ollama">Ollama</option>
              </select>
              <select
                value={modelSearchCategory}
                onChange={(e) => setModelSearchCategory(e.target.value)}
                className="px-4 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              >
                <option value="">All Categories</option>
                <option value="chat">Chat</option>
                <option value="embedding">Embedding</option>
                <option value="image">Image Generation</option>
              </select>
              <button
                onClick={fetchAvailableModels}
                disabled={isLoadingModels}
                className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isLoadingModels ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Search
              </button>
            </div>

            {/* Results */}
            {isLoadingModels ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw size={24} className="animate-spin text-purple-500" />
                <span className="ml-3 text-text-secondary">Loading models from providers...</span>
              </div>
            ) : availableModels.length === 0 ? (
              <div className="text-center py-12 text-text-secondary">
                <Database size={32} className="mx-auto mb-3 opacity-50" />
                <p>Click "Search" to discover available models</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0" style={{ backgroundColor: 'var(--color-surface)' }}>
                    <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                      <th className="text-left p-3 font-medium text-text-secondary">Model</th>
                      <th className="text-left p-3 font-medium text-text-secondary">Provider</th>
                      <th className="text-left p-3 font-medium text-text-secondary">Category</th>
                      <th className="text-right p-3 font-medium text-text-secondary">Input $/1M</th>
                      <th className="text-right p-3 font-medium text-text-secondary">Output $/1M</th>
                      <th className="text-center p-3 font-medium text-text-secondary">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                    {availableModels.map((model) => {
                      const isAdded = models.some(m => m.id === model.id);
                      return (
                        <tr
                          key={model.id}
                          className="hover:bg-blue-500/5 transition-colors"
                        >
                          <td className="p-3">
                            <div className="font-medium text-text-primary">{model.name}</div>
                            <code className="text-xs text-text-secondary font-mono">{model.id}</code>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded-full text-xs ${
                              model.provider === 'aws-bedrock' ? 'bg-orange-500/10 text-orange-500' :
                              model.provider === 'vertex-ai' ? 'bg-blue-500/10 text-blue-500' :
                              model.provider === 'azure-openai' ? 'bg-cyan-500/10 text-cyan-500' :
                              'bg-green-500/10 text-green-500'
                            }`}>
                              {model.provider}
                            </span>
                          </td>
                          <td className="p-3 text-text-secondary capitalize">{model.category}</td>
                          <td className="p-3 text-right font-mono text-text-secondary">
                            {model.inputCostPer1M != null ? `$${model.inputCostPer1M.toFixed(3)}` : '-'}
                          </td>
                          <td className="p-3 text-right font-mono text-text-secondary">
                            {model.outputCostPer1M != null ? `$${model.outputCostPer1M.toFixed(3)}` : '-'}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => !isAdded && !addingModelId && addModelFromSearch(model)}
                              disabled={isAdded || addingModelId === model.id}
                              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                                isAdded
                                  ? 'bg-green-500/10 text-green-500 cursor-default'
                                  : addingModelId === model.id
                                    ? 'bg-yellow-500/10 text-yellow-500 cursor-wait'
                                    : 'bg-purple-500/10 text-purple-500 hover:bg-purple-500/20'
                              }`}
                            >
                              {isAdded ? (
                                <span className="flex items-center gap-1"><Check size={12} /> Added</span>
                              ) : addingModelId === model.id ? (
                                <span className="flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> Adding...</span>
                              ) : (
                                <span className="flex items-center gap-1"><Plus size={12} /> Add</span>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="text-xs text-text-secondary text-right">
              {availableModels.length > 0 && `${availableModels.length} models found`}
            </div>
          </div>
        )}
      </div>

      {/* Configured Models */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-semibold text-text-primary">Configured Models</h3>
          <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">
            {models.length} models
          </span>
        </div>

        {models.length === 0 ? (
          <div className="p-12 text-center">
            <Sparkles className="w-12 h-12 mx-auto mb-4 text-text-secondary opacity-50" />
            <p className="text-text-secondary">No models configured. Add one from the presets above!</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {models.map((model) => (
              <div
                key={model.id}
                className="p-4 hover:bg-blue-500/5 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${
                      model.providerType === 'vertex-ai' ? 'bg-blue-500/10' :
                      model.providerType === 'aws-bedrock' ? 'bg-orange-500/10' :
                      'bg-green-500/10'
                    }`}>
                      {model.providerType === 'vertex-ai' && <Globe size={20} className="text-blue-500" />}
                      {model.providerType === 'aws-bedrock' && <Cpu size={20} className="text-orange-500" />}
                      {model.providerType === 'ollama' && <Terminal size={20} className="text-green-500" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text-primary">{model.name || model.id}</span>
                        {model.isDefault && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/10 text-yellow-500">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-xs text-text-secondary font-mono">{model.id}</code>
                        {model.location && (
                          <span className="text-xs text-text-secondary">• {model.location}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Capability badges */}
                    <div className="flex gap-1 mr-4">
                      {model.capabilities.chat && (
                        <span className="px-2 py-1 text-xs rounded bg-blue-500/10 text-blue-500">Chat</span>
                      )}
                      {model.capabilities.vision && (
                        <span className="px-2 py-1 text-xs rounded bg-purple-500/10 text-purple-500">Vision</span>
                      )}
                      {model.capabilities.tools && (
                        <span className="px-2 py-1 text-xs rounded bg-green-500/10 text-green-500">Tools</span>
                      )}
                      {model.capabilities.thinking && (
                        <span className="px-2 py-1 text-xs rounded bg-pink-500/10 text-pink-500">Thinking</span>
                      )}
                    </div>

                    {/* Actions */}
                    <button
                      onClick={() => testModel(model.id)}
                      className="p-2 rounded-lg hover:bg-green-500/10 text-green-500 transition-colors"
                      title="Test in Playground"
                    >
                      <Play size={16} />
                    </button>
                    <button
                      onClick={() => setEditingModel(model)}
                      className="p-2 rounded-lg hover:bg-blue-500/10 text-blue-500 transition-colors"
                      title="Edit"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => setModels(prev => prev.filter(m => m.id !== model.id))}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                      title="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderOllama = () => (
    <div className="space-y-6">
      {/* Pull New Model Section */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-green-500/10">
            <Download size={20} className="text-green-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Pull New Model</h3>
            <p className="text-sm text-text-secondary">Download models from the Ollama library</p>
          </div>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={pullModelName}
            onChange={(e) => setPullModelName(e.target.value)}
            placeholder="e.g., llama3.3:70b, qwen3:latest, mistral:latest"
            disabled={isPulling}
            className="flex-1 px-4 py-3 rounded-lg border text-sm"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)'
            }}
            onKeyDown={(e) => e.key === 'Enter' && pullOllamaModel()}
          />
          <button
            onClick={pullOllamaModel}
            disabled={isPulling || !pullModelName.trim()}
            className="px-6 py-3 bg-green-500 text-white rounded-lg font-medium transition-colors hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPulling ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Pulling...
              </>
            ) : (
              <>
                <Download size={16} />
                Pull Model
              </>
            )}
          </button>
        </div>

        {/* Progress indicator */}
        {pullProgress && (
          <div className={`mt-4 p-3 rounded-lg text-sm ${
            pullProgress.includes('Error')
              ? 'bg-red-500/10 text-red-500'
              : pullProgress.includes('complete')
                ? 'bg-green-500/10 text-green-500'
                : 'bg-blue-500/10 text-blue-500'
          }`}>
            <div className="flex items-center gap-2">
              {isPulling && <RefreshCw size={14} className="animate-spin" />}
              {pullProgress}
            </div>
          </div>
        )}

        {/* Popular models suggestions */}
        <div className="mt-4">
          <p className="text-xs text-text-secondary mb-2">Popular models:</p>
          <div className="flex flex-wrap gap-2">
            {[
              'llama3.3:70b',
              'llama3.3:latest',
              'qwen3:32b',
              'qwen3:latest',
              'mistral:latest',
              'codellama:latest',
              'llama3.2-vision:latest',
              'deepseek-coder:33b'
            ].map((model) => (
              <button
                key={model}
                onClick={() => setPullModelName(model)}
                disabled={isPulling}
                className="px-3 py-1.5 text-xs rounded-full border transition-colors hover:bg-green-500/10 hover:border-green-500 hover:text-green-500 disabled:opacity-50"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {model}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Installed Models */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <HardDrive size={20} className="text-text-secondary" />
            <h3 className="text-lg font-semibold text-text-primary">Installed Models</h3>
            <span className="px-2 py-1 rounded-full text-xs bg-green-500/10 text-green-500">
              {ollamaModels.length} models
            </span>
          </div>
          <button
            onClick={fetchOllamaModels}
            disabled={ollamaLoading}
            className="px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2"
            style={{ backgroundColor: 'var(--color-surfaceHover)', color: 'var(--color-text)' }}
          >
            <RefreshCw size={14} className={ollamaLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {ollamaLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin text-green-500" />
            <p className="text-text-secondary">Loading Ollama models...</p>
          </div>
        ) : ollamaModels.length === 0 ? (
          <div className="p-12 text-center">
            <Box className="w-12 h-12 mx-auto mb-4 text-text-secondary opacity-50" />
            <p className="text-text-secondary">No models installed. Pull one from above!</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {ollamaModels.map((model: any) => (
              <div
                key={model.name}
                className="p-4 hover:bg-green-500/5 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <Terminal size={20} className="text-green-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text-primary">{model.name}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
                        <span>Size: {(model.size / (1024 * 1024 * 1024)).toFixed(1)} GB</span>
                        {model.details?.parameter_size && (
                          <span>• {model.details.parameter_size}</span>
                        )}
                        {model.details?.quantization_level && (
                          <span>• {model.details.quantization_level}</span>
                        )}
                        <span>• Modified: {new Date(model.modified_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Test button */}
                    <button
                      onClick={() => {
                        setSelectedModel(model.name);
                        setActiveTab('playground');
                        setPlaygroundInput('Hello! Please introduce yourself briefly.');
                      }}
                      className="p-2 rounded-lg hover:bg-green-500/10 text-green-500 transition-colors"
                      title="Test in Playground"
                    >
                      <Play size={16} />
                    </button>
                    {/* Delete button */}
                    <button
                      onClick={() => deleteOllamaModel(model.name)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                      title="Delete Model"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ollama Info */}
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-blue-500 mt-0.5" />
          <div className="text-sm text-text-secondary">
            <p className="font-medium text-text-primary mb-1">About Ollama</p>
            <p>
              Ollama runs models locally on your server. Models are downloaded once and stored locally.
              Larger models require more GPU VRAM. Visit{' '}
              <a href="https://ollama.ai/library" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                ollama.ai/library
              </a>{' '}
              for the full model catalog.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderProviders = () => (
    <div className="space-y-6">
      {/* Header with Add Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Provider Configuration</h3>
          <p className="text-sm text-text-secondary">Manage LLM providers (Azure OpenAI, Vertex AI, AWS Bedrock, Ollama)</p>
        </div>
        <button
          onClick={() => {
            setEditingProvider(null);
            setShowProviderForm(true);
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium transition-colors hover:bg-blue-600 flex items-center gap-2"
        >
          <Plus size={16} />
          Add Provider
        </button>
      </div>

      {/* Provider List */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <Server size={20} className="text-text-secondary" />
            <span className="font-medium text-text-primary">Configured Providers</span>
            <span className="px-2 py-1 rounded-full text-xs bg-blue-500/10 text-blue-500">
              {dbProviders.length} providers
            </span>
          </div>
        </div>

        {dbProviders.length === 0 ? (
          <div className="p-12 text-center">
            <Server className="w-12 h-12 mx-auto mb-4 text-text-secondary opacity-50" />
            <p className="text-text-secondary">No providers configured. Add one to get started!</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {dbProviders.map((provider: any) => {
              const providerHealth = healthStatus.find(h => h.provider === provider.name);
              const isEnvProvider = provider.isEnvironmentProvider;

              return (
                <div
                  key={provider.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {/* Provider Header - Clickable to expand */}
                  <div
                    className="p-4 hover:bg-blue-500/5 transition-colors cursor-pointer"
                    onClick={() => setExpandedProviderId(expandedProviderId === provider.id ? null : provider.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <ChevronDown
                          size={16}
                          className={`text-text-secondary transition-transform duration-200 ${
                            expandedProviderId === provider.id ? 'rotate-180' : ''
                          }`}
                        />
                        <div className={`p-2 rounded-lg ${
                          provider.provider_type === 'azure-openai' ? 'bg-blue-500/10' :
                          provider.provider_type === 'vertex-ai' ? 'bg-green-500/10' :
                          provider.provider_type === 'aws-bedrock' ? 'bg-orange-500/10' :
                          'bg-purple-500/10'
                        }`}>
                          {provider.provider_type === 'azure-openai' && <Globe size={20} className="text-blue-500" />}
                          {provider.provider_type === 'vertex-ai' && <Globe size={20} className="text-green-500" />}
                          {provider.provider_type === 'aws-bedrock' && <Cpu size={20} className="text-orange-500" />}
                          {provider.provider_type === 'ollama' && <Terminal size={20} className="text-purple-500" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-text-primary">
                              {provider.display_name || provider.name}
                            </span>
                            {provider.enabled ? (
                              <CheckCircle size={14} className="text-green-500" />
                            ) : (
                              <XCircle size={14} className="text-red-500" />
                            )}
                            {isEnvProvider && (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/10 text-yellow-500">
                                Environment
                              </span>
                            )}
                            {providerHealth && (
                              <span className={`px-2 py-0.5 rounded-full text-xs ${
                                providerHealth.healthy
                                  ? 'bg-green-500/10 text-green-500'
                                  : 'bg-red-500/10 text-red-500'
                              }`}>
                                {providerHealth.status}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
                            <span>{provider.provider_type}</span>
                            {provider.priority && <span>• Priority: {provider.priority}</span>}
                            {provider.model_config?.chatModel && <span>• {provider.model_config.chatModel}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {/* Test button */}
                        <button
                          onClick={() => testProviderCapabilities(provider.name)}
                          className="p-2 rounded-lg hover:bg-green-500/10 text-green-500 transition-colors"
                          title="Test Provider"
                        >
                          <Beaker size={16} />
                        </button>
                        {/* Edit button */}
                        <button
                          onClick={() => {
                            setEditingProvider(provider);
                            setShowProviderForm(true);
                          }}
                          className="p-2 rounded-lg hover:bg-blue-500/10 text-blue-500 transition-colors"
                          title={isEnvProvider ? "Create Override" : "Edit Provider"}
                        >
                          <Edit2 size={16} />
                        </button>
                        {/* Delete button - disabled for env providers */}
                        <button
                          onClick={() => !isEnvProvider && deleteProvider(provider.id)}
                          disabled={isEnvProvider}
                          className={`p-2 rounded-lg transition-colors ${
                            isEnvProvider
                              ? 'opacity-50 cursor-not-allowed'
                              : 'hover:bg-red-500/10 text-red-500'
                          }`}
                          title={isEnvProvider ? "Environment providers cannot be deleted" : "Delete Provider"}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Config Panel */}
                  {expandedProviderId === provider.id && (
                    <div className="px-6 pb-4 pt-2 bg-[var(--color-surfaceSecondary)]/30">
                      <div className="grid grid-cols-2 gap-6">
                        {/* Model Configuration */}
                        <div>
                          <h5 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
                            <Cpu size={14} />
                            Model Configuration
                          </h5>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Chat Model:</span>
                              <span className="text-text-primary font-mono text-xs">
                                {provider.model_config?.chatModel || provider.model_config?.defaultModel || 'Not configured'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Embedding Model:</span>
                              <span className="text-text-primary font-mono text-xs">
                                {provider.model_config?.embeddingModel || 'Not configured'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Vision Model:</span>
                              <span className="text-text-primary font-mono text-xs">
                                {provider.model_config?.visionModel || 'Not configured'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Max Tokens:</span>
                              <span className="text-text-primary">{provider.model_config?.maxTokens || 8192}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Temperature:</span>
                              <span className="text-text-primary">{provider.model_config?.temperature ?? 1}</span>
                            </div>
                          </div>
                        </div>

                        {/* Extended Thinking / Provider-Specific */}
                        <div>
                          <h5 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
                            <Brain size={14} />
                            {provider.provider_type === 'vertex-ai' ? 'Gemini Thinking' :
                             provider.provider_type === 'aws-bedrock' ? 'Claude Extended Thinking' :
                             'Advanced Settings'}
                          </h5>
                          <div className="space-y-2 text-sm">
                            {provider.provider_type === 'vertex-ai' && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-text-secondary">Thinking Level:</span>
                                  <span className={`px-2 py-0.5 rounded text-xs ${
                                    provider.model_config?.thinkingLevel === 'high'
                                      ? 'bg-purple-500/10 text-purple-500'
                                      : 'bg-blue-500/10 text-blue-500'
                                  }`}>
                                    {provider.model_config?.thinkingLevel || 'low'}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-text-secondary">Project ID:</span>
                                  <span className="text-text-primary font-mono text-xs">
                                    {provider.auth_config?.projectId || 'From environment'}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-text-secondary">Region:</span>
                                  <span className="text-text-primary">{provider.auth_config?.region || 'us-central1'}</span>
                                </div>
                              </>
                            )}
                            {provider.provider_type === 'aws-bedrock' && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-text-secondary">Thinking Budget:</span>
                                  <span className="text-text-primary">{provider.model_config?.thinkingBudget || 8000} tokens</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-text-secondary">Region:</span>
                                  <span className="text-text-primary">{provider.auth_config?.region || 'us-east-1'}</span>
                                </div>
                              </>
                            )}
                            {provider.provider_type === 'azure-openai' && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-text-secondary">Endpoint:</span>
                                  <span className="text-text-primary font-mono text-xs truncate max-w-[200px]">
                                    {provider.auth_config?.endpoint || 'Not configured'}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-text-secondary">Deployment:</span>
                                  <span className="text-text-primary">{provider.auth_config?.deploymentName || 'Not configured'}</span>
                                </div>
                              </>
                            )}
                            {provider.provider_type === 'ollama' && (
                              <div className="flex justify-between">
                                <span className="text-text-secondary">Endpoint:</span>
                                <span className="text-text-primary font-mono text-xs">
                                  {provider.auth_config?.endpoint || 'http://ollama:11434'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick Actions */}
                      <div className="mt-4 pt-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--color-border)' }}>
                        <button
                          onClick={() => {
                            setEditingProvider(provider);
                            setShowProviderForm(true);
                          }}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                        >
                          {isEnvProvider ? 'Create Override' : 'Edit Configuration'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Provider Form Modal */}
      {showProviderForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-xl"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <div className="p-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text-primary">
                  {editingProvider ? 'Edit Provider' : 'Add New Provider'}
                </h3>
                <button
                  onClick={() => {
                    setShowProviderForm(false);
                    setEditingProvider(null);
                  }}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-text-secondary hover:text-red-500"
                >
                  <XIcon size={20} />
                </button>
              </div>
            </div>

            <ProviderForm
              provider={editingProvider}
              onSave={async (data) => {
                try {
                  if (editingProvider) {
                    await apiRequest(`/admin/llm-providers/${editingProvider.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data)
                    });
                  } else {
                    await apiRequest('/admin/llm-providers', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data)
                    });
                  }
                  setShowProviderForm(false);
                  setEditingProvider(null);
                  fetchData();
                } catch (err) {
                  alert(`Failed to save provider: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
              }}
              onCancel={() => {
                setShowProviderForm(false);
                setEditingProvider(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="glass-card p-4">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-blue-500 mt-0.5" />
          <div className="text-sm text-text-secondary">
            <p className="font-medium text-text-primary mb-1">Provider Types</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong>Azure OpenAI</strong>: Microsoft Azure hosted OpenAI models (GPT-4, GPT-4o)</li>
              <li><strong>Vertex AI</strong>: Google Cloud Gemini models (Gemini 2.5, 3.0)</li>
              <li><strong>AWS Bedrock</strong>: Amazon hosted models (Claude, Llama, Titan)</li>
              <li><strong>Ollama</strong>: Self-hosted open source models (Llama, Qwen, Mistral)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  const deleteProvider = async (providerId: string) => {
    if (!confirm('Are you sure you want to delete this provider?')) return;

    try {
      const res = await apiRequest(`/admin/llm-providers/${providerId}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert(`Failed to delete provider: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to delete provider: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const renderMetrics = () => (
    <div className="space-y-6">
      {/* Aggregate Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Activity size={16} />
            <span className="text-sm">Total Requests</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">
            {metrics.reduce((sum, m) => sum + (m.requests?.total || 0), 0).toLocaleString()}
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <CheckCircle size={16} className="text-green-500" />
            <span className="text-sm">Success Rate</span>
          </div>
          <div className="text-2xl font-bold text-green-500">
            {metrics.length > 0
              ? (metrics.reduce((sum, m) => sum + parseFloat(m.requests?.successRate || '0'), 0) / metrics.length).toFixed(1)
              : 0}%
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Clock size={16} />
            <span className="text-sm">Avg Latency</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">
            {metrics.length > 0
              ? Math.round(metrics.reduce((sum, m) => sum + (m.performance?.averageLatency || 0), 0) / metrics.length)
              : 0}ms
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <DollarSign size={16} />
            <span className="text-sm">Est. Cost</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">
            ${metrics.reduce((sum, m) => sum + parseFloat(m.usage?.estimatedCost || '0'), 0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Health Status */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4">Provider Health</h3>
        <div className="grid grid-cols-3 gap-4">
          {healthStatus.map((h) => (
            <div
              key={h.provider}
              className={`p-4 rounded-lg border ${
                h.healthy ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
              }`}
            >
              <div className="flex items-center gap-3">
                {h.healthy ? (
                  <CheckCircle className="text-green-500" size={24} />
                ) : (
                  <XCircle className="text-red-500" size={24} />
                )}
                <div>
                  <div className="font-semibold text-text-primary">{h.provider}</div>
                  <div className="text-xs text-text-secondary">{h.status}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-Provider Metrics Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-semibold text-text-primary">Detailed Metrics</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-text-secondary" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Requests</th>
              <th className="px-4 py-3">Success Rate</th>
              <th className="px-4 py-3">Avg Latency</th>
              <th className="px-4 py-3">Tokens</th>
              <th className="px-4 py-3">Cost</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.provider} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-4 py-3 font-medium text-text-primary">{m.provider}</td>
                <td className="px-4 py-3 text-text-primary">{m.requests?.total?.toLocaleString() || 0}</td>
                <td className="px-4 py-3">
                  <span className={parseFloat(m.requests?.successRate || '0') >= 95 ? 'text-green-500' : 'text-yellow-500'}>
                    {m.requests?.successRate || '0'}%
                  </span>
                </td>
                <td className="px-4 py-3 text-text-primary">{m.performance?.averageLatency || 0}ms</td>
                <td className="px-4 py-3 text-text-primary">{m.usage?.totalTokens?.toLocaleString() || 0}</td>
                <td className="px-4 py-3 text-text-primary">${m.usage?.estimatedCost || '0.00'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-text-primary">LLM Provider Management</h2>
          <p className="text-text-secondary mt-1">Configure models, test responses, and monitor performance</p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
          style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
        {[
          { id: 'providers', label: 'Providers', icon: Server },
          { id: 'models', label: 'Models', icon: Sparkles },
          { id: 'playground', label: 'Playground', icon: MessageSquare },
          { id: 'ollama', label: 'Ollama', icon: Terminal },
          { id: 'metrics', label: 'Metrics', icon: BarChart2 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === id
                ? 'bg-blue-500 text-white shadow-lg'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Error Display */}
      {error && (
        <div className="glass-card p-4 border-l-4 border-red-500">
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'playground' && renderPlayground()}
      {activeTab === 'providers' && renderProviders()}
      {activeTab === 'models' && renderModels()}
      {activeTab === 'ollama' && renderOllama()}
      {activeTab === 'metrics' && renderMetrics()}
    </div>
  );
};
