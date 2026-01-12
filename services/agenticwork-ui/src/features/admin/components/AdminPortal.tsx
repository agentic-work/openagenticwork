import React, { useState, useEffect, useCallback, useMemo } from 'react';
// GCP-style custom icons - Nerd Font + SVG (not lucide-react)
import {
  AdminIcon,
  SparkleIcon,
  ServerRackIcon,
  WorkflowIcon,
  ToolsIcon,
  TerminalPromptIcon,
  ShieldCheckIcon,
  DatabaseSyncIcon,
  AnalyticsIcon,
  PulseIcon,
  type AdminIconName
} from './AdminIcon';
// Keep lucide for basic UI actions
import {
  X, ChevronRight, ChevronDown, Eye, EyeOff, Check, Save, Plus, Edit, Trash2,
  Settings, FileText, Monitor, List, BarChart, Star, MessageSquare, Users, Key
} from '@/shared/icons';
// Custom badass AgenticWork icons - SVG components that actually render!
import {
  Server, Activity, Database, Shield, Timer as Clock, XCircle, CheckCircle,
  Users as UsersIcon, Cog as CogIcon, Cube as CubeIcon, Logs as LogsIcon,
  Grid as GridIcon, Folder as FolderIcon, Terminal as TerminalIcon,
  Prompt as PromptIcon, Template as TemplateIcon, Chart as ChartIcon,
  TrendingUp as TrendingIcon, Key as KeyIcon, Lock as LockIcon,
  Network as NetworkIcon, API as APIIcon, Book as BookIcon, Code as CodeIcon,
  Beaker as BeakerIcon
} from './AdminIcons';
import UsageAnalytics from './UsageAnalytics';
import PerformanceMetrics from './PerformanceMetrics';
import LLMPerformanceMetrics from './LLMPerformanceMetrics';
import EmbeddingMetrics from './EmbeddingMetrics';
import PromptMetrics from './PromptMetrics';
import { ContextWindowMetrics } from './ContextWindowMetrics';
import { LLMProviderManagement } from './LLMProviderManagement';
import { MCPCallLogsView } from './MCPCallLogsView';
// MCPInspectorView removed - tool testing now in MCPManagementView
import { MCPToolsView } from './MCPToolsView';
import { MCPManagementView } from './MCPManagementView';
import { AuditLogsView } from './AuditLogsView';
import { MonitoringView } from './MonitoringView';
import MCPAccessControlView from './MCPAccessControlView';
import { DeveloperAPIView } from './DeveloperAPIView';
import UserPermissionsView from './UserPermissionsView';
import { DashboardOverview } from './DashboardOverview';
import { FlowiseWorkflowManager } from './Flowise/FlowiseWorkflowManager';
import { FlowiseUserManager } from './Flowise/FlowiseUserManager';
import { FlowiseAdminViewer } from './Flowise/FlowiseAdminViewer';
import { FlowiseSettingsManager } from './Flowise/FlowiseSettingsManager';
import { PromptTemplateManager } from './PromptTemplateManager';
import { AWCodeSessionsView } from './AWCodeSessionsView';
import { AWCodeSettingsView } from './AWCodeSettingsView';
import { OllamaManagementView } from './OllamaManagementView';
import SystemSettingsView from './SystemSettingsView';
import { CodeModeMetricsDashboard } from './CodeModeMetricsDashboard';
import { MultiModelConfigView } from './MultiModelConfigView';
import { PipelineSettingsView } from './PipelineSettingsView';
import { AuthAccessControlView } from './AuthAccessControlView';
import { useAuth } from '../../../app/providers/AuthContext';
import { useSystemConfig } from '@/hooks/useSystemConfig';
import { featureFlags } from '@/config/featureFlags';

interface AdminPortalProps {
  theme: string;
  embedded?: boolean;
  onClose?: () => void;
}


interface SidebarItem {
  id: string;
  label: string;
  icon: AdminIconName | React.FC<{ size?: number; className?: string; color?: string }>;
  children?: SidebarItem[];
  badge?: string;
}

interface DashboardData {
  users: {
    total: number;
    active: number;
  };
  sessions: {
    total: number;
    active: number;
  };
  messages: {
    total: number;
  };
  mcpServers: {
    configured: number;
    tools: number;
  };
  systemHealth: string;
}

interface MCPServer {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
}

interface MilvusCollection {
  name: string;
  description?: string;
  status?: string;
}

interface SystemPrompt {
  id: number;
  name: string;
  description: string | null;
  content: string;
  is_default: boolean;
  is_active: boolean;
  category: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  assignedUsersCount: number;
}

interface PromptTemplate {
  id: number;
  name: string;
  description: string | null;
  content: string;
  category: string | null;
  tags: string[];
  is_default: boolean;
  is_active: boolean;
  is_public: boolean;
  model_specific: boolean;
  target_model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  assignedUsersCount: number;
}

interface ApiToken {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  name: string;
  apiKey?: string; // Only present on creation
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  isExpired: boolean;
  createdAt: string;
}

interface AvailableUser {
  id: string;
  email: string;
  name: string | null;
  displayName: string;
  createdAt: string;
}

const AdminPortal: React.FC<AdminPortalProps> = ({ theme, embedded, onClose }) => {
  const { getAuthHeaders } = useAuth();
  const { config: systemConfig } = useSystemConfig();
  const [activeSection, setActiveSection] = useState('overview');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set()); // All collapsed by default
  // MCP Inspector removed - tool testing now in MCPManagementView
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpServersLoading, setMcpServersLoading] = useState(false);
  const [milvusCollections, setMilvusCollections] = useState<MilvusCollection[]>([]);
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // User assignment state
  const [showUserAssignDialog, setShowUserAssignDialog] = useState(false);
  const [assigningPrompt, setAssigningPrompt] = useState<SystemPrompt | null>(null);
  const [assigningTemplate, setAssigningTemplate] = useState<PromptTemplate | null>(null);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);

  // API Token management state
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [showCreateTokenDialog, setShowCreateTokenDialog] = useState(false);
  const [newTokenData, setNewTokenData] = useState<{ userId: string; name: string; expiresInDays: number; rateLimitTier: string; rateLimitPerMinute?: number; rateLimitPerHour?: number }>({ userId: '', name: '', expiresInDays: 30, rateLimitTier: 'free' });
  const [createdToken, setCreatedToken] = useState<ApiToken | null>(null);
  const [apiMetrics, setApiMetrics] = useState<any>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Fetch dashboard overview data
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/admin/system/dashboard/overview', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setDashboardData(data);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  // Fetch MCP servers data
  useEffect(() => {
    const fetchMCPServers = async () => {
      try {
        setMcpServersLoading(true);
        const response = await fetch('/api/admin/system/mcp-servers', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setMcpServers(data.servers || []);
        }
      } catch (error) {
        console.error('Failed to fetch MCP servers:', error);
      } finally {
        setMcpServersLoading(false);
      }
    };

    if (activeSection === 'servers') {
      fetchMCPServers();
    }
  }, [activeSection]);

  // Fetch Milvus collections data
  useEffect(() => {
    const fetchMilvusCollections = async () => {
      try {
        const response = await fetch('/api/admin/system/milvus/collections', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setMilvusCollections(data.collections || []);
        }
      } catch (error) {
        console.error('Failed to fetch Milvus collections:', error);
      }
    };

    if (activeSection === 'collections') {
      fetchMilvusCollections();
    }
  }, [activeSection]);

  // Fetch system prompts
  useEffect(() => {
    const fetchSystemPrompts = async () => {
      try {
        const response = await fetch('/api/admin/prompts/system-prompts', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setSystemPrompts(data.prompts || []);
        }
      } catch (error) {
        console.error('Failed to fetch system prompts:', error);
      }
    };

    if (activeSection === 'prompts') {
      fetchSystemPrompts();
    }
  }, [activeSection]);

  // Fetch prompt templates
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await fetch('/api/admin/prompts/templates', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setPromptTemplates(data.templates || []);
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      }
    };

    if (activeSection === 'templates') {
      fetchTemplates();
    }
  }, [activeSection]);

  // Fetch API tokens and available users
  useEffect(() => {
    const fetchApiTokens = async () => {
      try {
        // Include expired tokens so admins can delete them
        const response = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setApiTokens(data.tokens || []);
        }
      } catch (error) {
        console.error('Failed to fetch API tokens:', error);
      }
    };

    const fetchAvailableUsers = async () => {
      try {
        const response = await fetch('/api/admin/tokens/users/available', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setAvailableUsers(data.users || []);
        }
      } catch (error) {
        console.error('Failed to fetch available users:', error);
      }
    };

    const fetchApiMetrics = async () => {
      try {
        setMetricsLoading(true);
        const response = await fetch('/api/admin/tokens/metrics', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setApiMetrics(data);
        }
      } catch (error) {
        console.error('Failed to fetch API metrics:', error);
      } finally {
        setMetricsLoading(false);
      }
    };

    if (activeSection === 'tokens') {
      fetchApiTokens();
      fetchAvailableUsers();
      fetchApiMetrics();
    }
  }, [activeSection]);

  // Handler functions for prompts and templates
  const handleSavePrompt = async (prompt: SystemPrompt) => {
    try {
      const url = prompt.id
        ? `/api/admin/prompts/system-prompts/${prompt.id}`
        : '/api/admin/prompts/system-prompts';
      const method = prompt.id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(prompt)
      });

      if (response.ok) {
        // Refresh the list
        const listResponse = await fetch('/api/admin/prompts/system-prompts', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const data = await listResponse.json();
          setSystemPrompts(data.prompts || []);
        }
        setShowEditDialog(false);
        setEditingPrompt(null);
      }
    } catch (error) {
      console.error('Failed to save prompt:', error);
    }
  };

  const handleDeletePrompt = async (id: number) => {
    if (!confirm('Are you sure you want to delete this prompt?')) return;

    try {
      const response = await fetch(`/api/admin/prompts/system-prompts/${id}`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok || response.status === 204) {
        setSystemPrompts(systemPrompts.filter(p => p.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete prompt:', error);
    }
  };

  const handleSaveTemplate = async (template: PromptTemplate) => {
    try {
      const url = template.id
        ? `/api/admin/prompts/templates/${template.id}`
        : '/api/admin/prompts/templates';
      const method = template.id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(template)
      });

      if (response.ok) {
        // Refresh the list
        const listResponse = await fetch('/api/admin/prompts/templates', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const data = await listResponse.json();
          setPromptTemplates(data.templates || []);
        }
        setShowEditDialog(false);
        setEditingTemplate(null);
      }
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      const response = await fetch(`/api/admin/prompts/templates/${id}`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok || response.status === 204) {
        setPromptTemplates(promptTemplates.filter(t => t.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  };

  // Handler functions for user assignment
  const handleAssignUsersToPrompt = async (prompt: SystemPrompt) => {
    try {
      // Fetch currently assigned users
      const response = await fetch(`/api/admin/prompts/system-prompts/${prompt.id}/users`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAssignedUserIds(data.userIds || []);
      }

      setAssigningPrompt(prompt);
      setAssigningTemplate(null);
      setShowUserAssignDialog(true);
    } catch (error) {
      console.error('Failed to fetch assigned users:', error);
    }
  };

  const handleAssignUsersToTemplate = async (template: PromptTemplate) => {
    try {
      // Fetch currently assigned users
      const response = await fetch(`/api/admin/prompts/templates/${template.id}/users`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAssignedUserIds(data.userIds || []);
      }

      setAssigningTemplate(template);
      setAssigningPrompt(null);
      setShowUserAssignDialog(true);
    } catch (error) {
      console.error('Failed to fetch assigned users:', error);
    }
  };

  const handleSaveUserAssignments = async () => {
    try {
      const isPrompt = assigningPrompt !== null;
      const id = isPrompt ? assigningPrompt?.id : assigningTemplate?.id;
      const endpoint = isPrompt
        ? `/api/admin/prompts/system-prompts/${id}/users`
        : `/api/admin/prompts/templates/${id}/users`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userIds: assignedUserIds })
      });

      if (response.ok) {
        // Refresh the list to update assignedUsersCount
        if (isPrompt) {
          const listResponse = await fetch('/api/admin/prompts/system-prompts', {
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            }
          });
          if (listResponse.ok) {
            const data = await listResponse.json();
            setSystemPrompts(data.prompts || []);
          }
        } else {
          const listResponse = await fetch('/api/admin/prompts/templates', {
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            }
          });
          if (listResponse.ok) {
            const data = await listResponse.json();
            setPromptTemplates(data.templates || []);
          }
        }

        setShowUserAssignDialog(false);
        setAssigningPrompt(null);
        setAssigningTemplate(null);
        setAssignedUserIds([]);
      }
    } catch (error) {
      console.error('Failed to save user assignments:', error);
    }
  };

  const toggleUserAssignment = (userId: string) => {
    setAssignedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  // Handler functions for API tokens
  const handleCreateToken = async () => {
    if (!newTokenData.userId || !newTokenData.name) {
      alert('Please select a user and enter a token name');
      return;
    }

    try {
      const response = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newTokenData)
      });

      if (response.ok) {
        const data = await response.json();
        setCreatedToken(data.token);
        // Refresh the token list (include expired tokens)
        const listResponse = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const listData = await listResponse.json();
          setApiTokens(listData.tokens || []);
        }
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to create API token');
      }
    } catch (error: any) {
      console.error('Failed to create API token:', error);
      alert('Failed to create API token');
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this API token? The token will be deactivated but can still be permanently deleted.')) return;

    try {
      const response = await fetch(`/api/admin/tokens/${tokenId}`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Refresh the token list (include expired/revoked tokens)
        const listResponse = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const listData = await listResponse.json();
          setApiTokens(listData.tokens || []);
        }
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to revoke API token');
      }
    } catch (error) {
      console.error('Failed to revoke API token:', error);
      alert('Failed to revoke API token');
    }
  };

  const handleDeleteToken = async (tokenId: string) => {
    if (!confirm('Are you sure you want to permanently delete this API token? This action cannot be undone.')) return;

    try {
      const response = await fetch(`/api/admin/tokens/${tokenId}/permanent`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Refresh the token list
        const listResponse = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const listData = await listResponse.json();
          setApiTokens(listData.tokens || []);
        }
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to delete API token');
      }
    } catch (error) {
      console.error('Failed to delete API token:', error);
      alert('Failed to delete API token');
    }
  };

  // AWCodeSessionsView is now imported from ./AWCodeSessionsView.tsx

  // Agenticode Settings View Component - fetches real config from agenticode-manager
  const AgenticodeSettingsView: React.FC<{ theme: string }> = ({ theme }) => {
    const [config, setConfig] = useState<{
      defaultModel: string;
      defaultUi: string;
      sessionIdleTimeout: number;
      sessionMaxLifetime: number;
      maxSessionsPerUser: number;
      workspacesPath: string;
      apiEndpoint: string;
    } | null>(null);
    const [health, setHealth] = useState<{
      status: string;
      activeSessions: number;
      uptime: number;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Model configuration state
    const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; providerId: string }>>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [savedModel, setSavedModel] = useState<string>('');
    const [savingModel, setSavingModel] = useState(false);
    const [modelSaveStatus, setModelSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
      const fetchConfig = async () => {
        setLoading(true);
        setError(null);
        try {
          // Fetch health/config from agenticode-manager via API proxy
          const response = await fetch('/api/code/health', {
            headers: getAuthHeaders()
          });

          if (response.ok) {
            const data = await response.json();
            setHealth({
              status: data.status || 'running',
              activeSessions: data.activeSessions || 0,
              uptime: data.uptime || 0
            });
            // Config comes from health endpoint or defaults
            setConfig({
              defaultModel: data.config?.defaultModel || 'ollama/devstral',
              defaultUi: data.config?.defaultUi || 'ink',
              sessionIdleTimeout: data.config?.sessionIdleTimeout || 1800,
              sessionMaxLifetime: data.config?.sessionMaxLifetime || 14400,
              maxSessionsPerUser: data.config?.maxSessionsPerUser || 3,
              workspacesPath: data.config?.workspacesPath || '/workspaces',
              apiEndpoint: data.config?.apiEndpoint || 'http://agenticwork-api:8000'
            });
          } else {
            setError('Unable to connect to Agenticode Manager');
          }

          // Fetch available models
          const modelsResponse = await fetch('/api/agenticode/config', {
            headers: getAuthHeaders()
          });
          if (modelsResponse.ok) {
            const modelsData = await modelsResponse.json();
            const models = modelsData.models || [];
            setAvailableModels(models.filter((m: any) => !m.id.includes('embedding')));
          }

          // Fetch current admin-set default model
          const modelConfigResponse = await fetch('/api/admin/code-mode/model-config', {
            headers: getAuthHeaders()
          });
          if (modelConfigResponse.ok) {
            const modelConfigData = await modelConfigResponse.json();
            const defaultModel = modelConfigData.config?.defaultModel || '';
            setSelectedModel(defaultModel);
            setSavedModel(defaultModel);
          }
        } catch (err: any) {
          setError(err.message || 'Failed to fetch configuration');
        } finally {
          setLoading(false);
        }
      };
      fetchConfig();
    }, [getAuthHeaders]);

    // Save model configuration
    const handleSaveModel = async () => {
      setSavingModel(true);
      setModelSaveStatus('idle');
      try {
        const response = await fetch('/api/admin/code-mode/model-config', {
          method: 'PUT',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ defaultModel: selectedModel || null })
        });
        if (response.ok) {
          setSavedModel(selectedModel);
          setModelSaveStatus('success');
          setTimeout(() => setModelSaveStatus('idle'), 3000);
        } else {
          setModelSaveStatus('error');
        }
      } catch (err) {
        setModelSaveStatus('error');
      } finally {
        setSavingModel(false);
      }
    };

    const formatDuration = (seconds: number) => {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      if (hours > 0) return `${hours}h ${mins}m`;
      return `${mins}m`;
    };

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
            <Settings size={20} />
            Agenticode Settings
          </h2>
          <p className="text-text-secondary">
            Configuration for Agenticode CLI sessions
          </p>
        </div>

        {loading ? (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
            <p className="text-text-secondary">Loading configuration...</p>
          </div>
        ) : error ? (
          <div className="glass-card p-4 bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 text-red-500">
              <Activity size={18} />
              <span className="font-medium">Connection Error</span>
            </div>
            <p className="text-sm text-text-secondary mt-1">{error}</p>
          </div>
        ) : (
          <>
            {/* Manager Status */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4">Manager Status</h3>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${health?.status === 'running' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                  <Server size={20} className={health?.status === 'running' ? 'text-green-500' : 'text-red-500'} />
                </div>
                <div>
                  <p className="font-medium text-text-primary">agenticode-manager</p>
                  <p className="text-sm text-text-secondary">Active Sessions: {health?.activeSessions || 0}</p>
                </div>
                <div className="ml-auto">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    health?.status === 'running'
                      ? 'bg-green-500/20 text-green-500'
                      : 'bg-red-500/20 text-red-500'
                  }`}>
                    {health?.status === 'running' ? 'Running' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>

            {/* Model Configuration - Admin Settable */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4">Default Model Configuration</h3>
              <p className="text-xs text-text-secondary mb-4">
                Set the default LLM model for new Code Mode sessions. Users will see this model in "Smart Router" mode.
              </p>
              <div className="flex items-center gap-3">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-surface-secondary border border-border-primary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Auto (Smart Fallback)</option>
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.providerId})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleSaveModel}
                  disabled={savingModel || selectedModel === savedModel}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    selectedModel !== savedModel
                      ? 'bg-primary-500 text-white hover:bg-primary-600'
                      : 'bg-surface-secondary text-text-secondary cursor-not-allowed'
                  }`}
                >
                  {savingModel ? 'Saving...' : 'Save'}
                </button>
              </div>
              {modelSaveStatus === 'success' && (
                <p className="text-xs text-green-500 mt-2">✓ Model configuration saved successfully</p>
              )}
              {modelSaveStatus === 'error' && (
                <p className="text-xs text-red-500 mt-2">✗ Failed to save model configuration</p>
              )}
              {savedModel && (
                <p className="text-xs text-text-secondary mt-2">
                  Current: <span className="font-mono text-text-primary">{savedModel}</span>
                </p>
              )}
            </div>

            {/* Runtime Configuration */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4">Runtime Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Active Model (from Manager)</div>
                  <div className="text-sm font-medium text-text-primary font-mono">{config?.defaultModel}</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">UI Mode</div>
                  <div className="text-sm font-medium text-text-primary capitalize">{config?.defaultUi}</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Idle Timeout</div>
                  <div className="text-sm font-medium text-text-primary">{formatDuration(config?.sessionIdleTimeout || 0)}</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Max Session Lifetime</div>
                  <div className="text-sm font-medium text-text-primary">{formatDuration(config?.sessionMaxLifetime || 0)}</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Max Sessions per User</div>
                  <div className="text-sm font-medium text-text-primary">{config?.maxSessionsPerUser}</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Workspaces Path</div>
                  <div className="text-sm font-medium text-text-primary font-mono">{config?.workspacesPath}</div>
                </div>
              </div>
            </div>

            {/* Environment Variables Info */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4">Configuration Environment Variables</h3>
              <p className="text-xs text-text-secondary mb-3">
                Agenticode settings are configured via environment variables on the agenticode-manager service.
              </p>
              <div className="space-y-2 text-xs font-mono">
                <div className="p-2 rounded bg-surface-secondary">
                  <span className="text-cyan-400">AGENTICODE_MODEL</span>
                  <span className="text-text-secondary"> - Default LLM model</span>
                </div>
                <div className="p-2 rounded bg-surface-secondary">
                  <span className="text-cyan-400">AGENTICODE_UI</span>
                  <span className="text-text-secondary"> - UI mode (ink, plain, json)</span>
                </div>
                <div className="p-2 rounded bg-surface-secondary">
                  <span className="text-cyan-400">MAX_SESSIONS_PER_USER</span>
                  <span className="text-text-secondary"> - Session limit per user</span>
                </div>
                <div className="p-2 rounded bg-surface-secondary">
                  <span className="text-cyan-400">SESSION_IDLE_TIMEOUT</span>
                  <span className="text-text-secondary"> - Idle timeout in seconds</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // Agenticode Metrics View Component - fetches session and usage metrics
  const AgenticodeMetricsView: React.FC<{ theme: string }> = ({ theme }) => {
    const [metrics, setMetrics] = useState<{
      totalSessions: number;
      activeSessions: number;
      totalMessages: number;
      totalTokens: number;
      avgSessionDuration: number;
      usersWithSessions: number;
      sessionsByDay: { date: string; count: number }[];
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      const fetchMetrics = async () => {
        setLoading(true);
        setError(null);
        try {
          // Fetch metrics from agenticode stats endpoint
          const response = await fetch('/api/code/stats', {
            headers: getAuthHeaders()
          });

          if (response.ok) {
            const data = await response.json();
            setMetrics({
              totalSessions: data.totalSessions || 0,
              activeSessions: data.activeSessions || 0,
              totalMessages: data.totalMessages || 0,
              totalTokens: data.totalTokens || 0,
              avgSessionDuration: data.avgSessionDuration || 0,
              usersWithSessions: data.usersWithSessions || 0,
              sessionsByDay: data.sessionsByDay || []
            });
          } else {
            setError('Unable to fetch Agenticode metrics');
          }
        } catch (err: any) {
          setError(err.message || 'Failed to fetch metrics');
        } finally {
          setLoading(false);
        }
      };
      fetchMetrics();
    }, [getAuthHeaders]);

    const formatNumber = (num: number) => {
      if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
      if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
      return num.toString();
    };

    const formatDuration = (seconds: number) => {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      if (hours > 0) return `${hours}h ${mins}m`;
      return `${mins}m`;
    };

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
            <ChartIcon size={20} />
            Agenticode Metrics
          </h2>
          <p className="text-text-secondary">
            Usage statistics and performance metrics for Agenticode sessions
          </p>
        </div>

        {loading ? (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
            <p className="text-text-secondary">Loading metrics...</p>
          </div>
        ) : error ? (
          <div className="glass-card p-4 bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 text-red-500">
              <Activity size={18} />
              <span className="font-medium">Error Loading Metrics</span>
            </div>
            <p className="text-sm text-text-secondary mt-1">{error}</p>
          </div>
        ) : (
          <>
            {/* Overview Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="glass-card p-4">
                <div className="text-2xl font-bold text-text-primary">{formatNumber(metrics?.totalSessions || 0)}</div>
                <div className="text-xs text-text-secondary">Total Sessions</div>
              </div>
              <div className="glass-card p-4">
                <div className="text-2xl font-bold text-green-500">{metrics?.activeSessions || 0}</div>
                <div className="text-xs text-text-secondary">Active Now</div>
              </div>
              <div className="glass-card p-4">
                <div className="text-2xl font-bold text-text-primary">{formatNumber(metrics?.totalMessages || 0)}</div>
                <div className="text-xs text-text-secondary">Total Messages</div>
              </div>
              <div className="glass-card p-4">
                <div className="text-2xl font-bold text-blue-500">{formatNumber(metrics?.totalTokens || 0)}</div>
                <div className="text-xs text-text-secondary">Total Tokens</div>
              </div>
              <div className="glass-card p-4">
                <div className="text-2xl font-bold text-text-primary">{formatDuration(metrics?.avgSessionDuration || 0)}</div>
                <div className="text-xs text-text-secondary">Avg Duration</div>
              </div>
              <div className="glass-card p-4">
                <div className="text-2xl font-bold text-purple-500">{metrics?.usersWithSessions || 0}</div>
                <div className="text-xs text-text-secondary">Unique Users</div>
              </div>
            </div>

            {/* Session Activity Chart Placeholder */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <TrendingIcon size={16} />
                Session Activity (Last 7 Days)
              </h3>
              <div className="h-40 flex items-end justify-around gap-2">
                {(metrics?.sessionsByDay || []).slice(-7).map((day, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div
                      className="w-8 bg-primary-500/70 rounded-t hover:bg-primary-500 transition-colors"
                      style={{ height: `${Math.max(20, (day.count / Math.max(...(metrics?.sessionsByDay || []).map(d => d.count), 1)) * 120)}px` }}
                      title={`${day.count} sessions`}
                    />
                    <span className="text-xs text-text-secondary">{new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  </div>
                ))}
                {(!metrics?.sessionsByDay || metrics.sessionsByDay.length === 0) && (
                  <div className="text-text-secondary text-sm">No activity data available</div>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4">Performance Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-text-secondary">Avg Messages/Session</span>
                  <span className="font-medium text-text-primary">
                    {metrics?.totalSessions ? Math.round((metrics?.totalMessages || 0) / metrics.totalSessions) : 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-text-secondary">Avg Tokens/Session</span>
                  <span className="font-medium text-text-primary">
                    {metrics?.totalSessions ? formatNumber(Math.round((metrics?.totalTokens || 0) / metrics.totalSessions)) : 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-text-secondary">Sessions/User (Avg)</span>
                  <span className="font-medium text-text-primary">
                    {metrics?.usersWithSessions ? (metrics.totalSessions / metrics.usersWithSessions).toFixed(1) : 0}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // Sidebar navigation structure
  // GCP-style sidebar with custom icons - 80% professional, 20% nerd
  const sidebarItems: SidebarItem[] = [
    {
      id: 'overview',
      label: 'Dashboard Overview',
      icon: PulseIcon
    },
    {
      id: 'system',
      label: 'System Management',
      icon: 'server' as AdminIconName,
      children: [
        { id: 'users', label: 'User Management', icon: 'users' as AdminIconName },
        { id: 'settings', label: 'System Settings', icon: 'cog' as AdminIconName }
      ]
    },
    {
      id: 'llm',
      label: 'LLM Providers',
      icon: SparkleIcon,
      children: [
        { id: 'providers', label: 'Provider Management', icon: SparkleIcon },
        // Multi-Model Config - build-time feature flag
        ...(featureFlags.multiModel ? [{ id: 'multi-model', label: 'Multi-Model Config', icon: 'sparkle' as AdminIconName, badge: 'New' }] : []),
        // Ollama Management - build-time feature flag
        ...(featureFlags.ollama ? [{ id: 'ollama', label: 'Ollama Management', icon: 'cube' as AdminIconName }] : []),
        { id: 'llm-performance', label: 'Performance Metrics', icon: AnalyticsIcon }
      ]
    },
    // MCP Management - build-time feature flag
    ...(featureFlags.mcp ? [{
      id: 'mcp',
      label: 'MCP Management',
      icon: ToolsIcon,
      children: [
        { id: 'mcp-management', label: 'Server Management', icon: ServerRackIcon },
        { id: 'mcp-tools', label: 'MCP Tools', icon: ToolsIcon },
        { id: 'mcp-logs', label: 'MCP Call Logs', icon: 'logs' as AdminIconName },
        { id: 'mcp-kubernetes', label: 'Kubernetes Config', icon: 'cube' as AdminIconName, badge: 'New' }
      ]
    }] : []),
    // Flowise Workflow Manager - build-time feature flag + runtime availability check
    ...(featureFlags.flowise && systemConfig.workflowEngine.available ? [{
      id: 'workflows',
      label: `${systemConfig.workflowEngine.name} Workflows`,
      icon: WorkflowIcon,
      children: [
        { id: 'workflow-admin', label: 'Admin Console', icon: 'grid' as AdminIconName },
        { id: 'workflow-manager', label: 'Workflow Manager', icon: 'folder' as AdminIconName },
        { id: 'workflow-users', label: 'User Management', icon: 'users' as AdminIconName },
        { id: 'workflow-settings', label: 'Settings & API Keys', icon: 'cog' as AdminIconName }
      ]
    }] : []),
    // AgentiCode - build-time feature flag
    ...(featureFlags.agenticode ? [{
      id: 'agenticode',
      label: 'Agenticode',
      icon: TerminalPromptIcon,
      children: [
        { id: 'agenticode-sessions', label: 'Active Sessions', icon: 'terminal' as AdminIconName },
        { id: 'agenticode-settings', label: 'Settings', icon: 'cog' as AdminIconName },
        { id: 'agenticode-metrics', label: 'Metrics', icon: 'chart' as AdminIconName }
      ]
    }] : []),
    {
      id: 'content',
      label: 'Content & Data',
      icon: DatabaseSyncIcon,
      children: [
        { id: 'prompts', label: 'Prompt Library', icon: 'prompt' as AdminIconName },
        { id: 'templates', label: 'Chat Templates', icon: 'template' as AdminIconName },
        { id: 'prompt-metrics', label: 'Prompt Metrics', icon: 'chart' as AdminIconName },
        { id: 'pipeline-settings', label: 'Pipeline Settings', icon: 'cog' as AdminIconName, badge: 'New' },
        { id: 'database', label: 'Redis/Cache', icon: 'database' as AdminIconName },
        { id: 'milvus', label: 'Milvus/Vectors', icon: 'database' as AdminIconName }
      ]
    },
    {
      id: 'monitoring',
      label: 'Monitoring & Logs',
      icon: AnalyticsIcon,
      children: [
        { id: 'analytics', label: 'Usage Analytics', icon: 'trending' as AdminIconName },
        { id: 'audit', label: 'Audit Logs', icon: 'shield' as AdminIconName },
        { id: 'performance', label: 'Performance Metrics', icon: 'activity' as AdminIconName },
        { id: 'errors', label: 'Monitoring & Logs', icon: 'logs' as AdminIconName },
        { id: 'context-window', label: 'Context Window Metrics', icon: 'chart' as AdminIconName },
        { id: 'embeddings', label: 'Embedding Metrics', icon: 'zap' as AdminIconName }
      ]
    },
    {
      id: 'security',
      label: 'Security & Access',
      icon: ShieldCheckIcon,
      children: [
        { id: 'auth-access', label: 'Auth Access Control', icon: 'users' as AdminIconName, badge: 'New' },
        { id: 'permissions', label: 'User Permissions', icon: 'key' as AdminIconName },
        { id: 'tokens', label: 'API Token Management', icon: 'lock' as AdminIconName },
        { id: 'rate-limits', label: 'Rate Limits', icon: 'clock' as AdminIconName },
        { id: 'mcp-access', label: 'MCP Access Control', icon: 'shield' as AdminIconName },
        { id: 'network', label: 'Network Security', icon: 'network' as AdminIconName }
      ]
    },
    {
      id: 'developer',
      label: 'Developer API',
      icon: 'api' as AdminIconName,
      children: [
        { id: 'api-docs', label: 'API Documentation', icon: 'book' as AdminIconName },
        { id: 'api-examples', label: 'Code Examples', icon: 'code' as AdminIconName }
      ]
    },
    {
      id: 'development',
      label: 'Development',
      icon: 'beaker' as AdminIconName,
      children: [
        { id: 'uat-dashboard', label: 'UAT Dashboard', icon: 'beaker' as AdminIconName }
      ]
    }
  ];

  // Note: Data fetching disabled - showing placeholder content

  const toggleExpanded = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };


  // Map string icon names to SVG components from AdminIcons.tsx
  const iconMap: Record<string, React.FC<{ size?: number; className?: string }>> = {
    'server': Server,
    'users': UsersIcon,
    'cog': CogIcon,
    'sparkle': SparkleIcon,
    'cube': CubeIcon,
    'logs': LogsIcon,
    'grid': GridIcon,
    'folder': FolderIcon,
    'terminal': TerminalIcon,
    'prompt': PromptIcon,
    'template': TemplateIcon,
    'chart': ChartIcon,
    'database': Database,
    'trending': TrendingIcon,
    'shield': Shield,
    'activity': Activity,
    'key': KeyIcon,
    'lock': LockIcon,
    'clock': Clock,
    'network': NetworkIcon,
    'api': APIIcon,
    'book': BookIcon,
    'code': CodeIcon,
    'beaker': BeakerIcon,
  };

  // Helper to render icon - handles both SVG components and AdminIcon strings
  const renderIcon = (icon: SidebarItem['icon'], size = 16, className = '') => {
    if (typeof icon === 'string') {
      // Map string to SVG component from AdminIcons
      const IconComponent = iconMap[icon];
      if (IconComponent) {
        return <IconComponent size={size} className={className} />;
      }
      // Fallback to AdminIcon if no mapping exists (shouldn't happen)
      return <AdminIcon name={icon as AdminIconName} size={size} className={className} />;
    } else {
      // It's an SVG component
      const IconComponent = icon;
      return <IconComponent size={size} className={className} />;
    }
  };

  const renderSidebarItem = (item: SidebarItem, depth = 0) => {
    const isExpanded = expandedItems.has(item.id);
    const isActive = activeSection === item.id;
    const hasChildren = item.children && item.children.length > 0;

    return (
      <div key={item.id} className="w-full">
        <button
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(item.id);
            } else {
              setActiveSection(item.id);
            }
          }}
          className={`admin-nav-item w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 ${
            isActive
              ? 'active'
              : ''
          }`}
          data-active={isActive}
          style={{
            marginLeft: `${depth * 12}px`,
            borderRadius: depth === 0 ? '0 24px 24px 0' : '8px',
            marginRight: '8px',
            fontSize: '13px'
          }}
        >
          {hasChildren ? (
            <FolderIcon
              size={16}
              className="flex-shrink-0 opacity-70"
            />
          ) : (
            <span className="flex-shrink-0 opacity-80">
              {renderIcon(item.icon, 16)}
            </span>
          )}

          <span className="flex-1 font-medium" style={{ letterSpacing: '-0.01em' }}>{item.label}</span>

          {item.badge && (
            <span
              className={`admin-segment px-2 py-0.5 text-[10px] rounded font-semibold uppercase tracking-wider ${
                item.badge === 'Alpha' ? 'warning' : ''
              }`}
            >
              {item.badge}
            </span>
          )}

          {hasChildren && (
            <ChevronRight
              size={14}
              className={`flex-shrink-0 transition-transform duration-200 opacity-50 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          )}
        </button>

        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {item.children!.map(child => renderSidebarItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderMainContent = () => {
    switch (activeSection) {
      case 'overview':
        return <DashboardOverview theme={theme} />;

      case 'servers':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">
                MCP Servers
              </h2>
              <p className="text-text-secondary">
                Model Context Protocol servers and tools
              </p>
            </div>

            {mcpServersLoading ? (
              <div className="glass-card p-8 text-center">
                <div className="flex flex-col items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mb-4"></div>
                  <p className="text-text-secondary">Loading MCP servers...</p>
                </div>
              </div>
            ) : mcpServers.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <Server size={48} className="mx-auto mb-4 text-text-secondary" />
                <p className="text-text-secondary">No MCP servers found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {mcpServers.map((server) => (
                  <div key={server.id} className="glass-card p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-lg bg-primary-500/10">
                          <Server size={24} className="text-primary-500" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-text-primary">{server.name}</h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              server.status === 'running'
                                ? 'bg-green-500/10 text-green-500'
                                : 'bg-theme-bg-secondary text-text-secondary'
                            }`}>
                              {server.status}
                            </span>
                            <span className="text-sm text-text-secondary">
                              {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {server.tools && server.tools.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-sm font-medium text-text-secondary mb-2">Available Tools:</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {server.tools.map((tool, idx) => (
                            <div key={idx} className="p-3 rounded-lg bg-surface-secondary">
                              <p className="text-sm font-medium text-text-primary">{tool.name}</p>
                              {tool.description && (
                                <p className="text-xs text-text-secondary mt-1">{tool.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'providers':
        return <LLMProviderManagement theme={theme} />;

      case 'multi-model':
        return <MultiModelConfigView />;

      case 'llm-performance':
        return <LLMPerformanceMetrics theme={theme} />;

      case 'ollama':
        return <OllamaManagementView theme={theme as 'light' | 'dark'} />;

      case 'mcp-management':
        return <MCPManagementView theme={theme} />;

      case 'mcp-tools':
        return <MCPToolsView theme={theme} />;

      case 'mcp-logs':
        return <MCPCallLogsView theme={theme} />;

      case 'mcp-kubernetes':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">
                Kubernetes MCP Configuration
              </h2>
              <p className="text-text-secondary">
                Manage kubeconfigs for the Kubernetes MCP server. Add multiple clusters to enable K8s administration via MCP tools.
              </p>
            </div>

            {/* In-Cluster Status */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Server size={18} />
                In-Cluster Configuration
              </h3>
              <div className="p-4 rounded-lg bg-surface-secondary mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-text-primary">Current Cluster</div>
                    <div className="text-xs text-text-secondary mt-1">
                      The K8s MCP automatically uses in-cluster ServiceAccount credentials when deployed in Kubernetes.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="text-green-500" size={20} />
                    <span className="text-sm text-green-500">Active</span>
                  </div>
                </div>
              </div>
              <div className="text-xs text-text-secondary">
                <strong>Protected Namespace:</strong> The namespace where AgenticWork is deployed is automatically protected (read-only).
              </div>
            </div>

            {/* Additional Clusters */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Database size={18} />
                Additional Clusters (Coming Soon)
              </h3>
              <p className="text-text-secondary text-sm mb-4">
                Add kubeconfigs for additional Kubernetes clusters. This feature allows managing multiple clusters from a single AgenticWork deployment.
              </p>
              <button
                disabled
                className="px-4 py-2 rounded-lg bg-accent-primary/50 text-white text-sm cursor-not-allowed opacity-50"
              >
                <Plus size={14} className="inline mr-2" />
                Add Kubeconfig
              </button>
            </div>

            {/* K8s MCP Tools Summary */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Activity size={18} />
                Available K8s Tools
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {['Namespaces', 'Pods', 'Deployments', 'Services', 'ConfigMaps', 'Secrets', 'Nodes', 'Helm'].map(tool => (
                  <div key={tool} className="p-3 rounded-lg bg-surface-secondary text-center">
                    <div className="text-sm font-medium text-text-primary">{tool}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs text-text-secondary">
                The Kubernetes MCP provides 40+ tools for cluster administration. Admin users can manage pods, deployments, services, helm releases, and more.
              </div>
            </div>
          </div>
        );

      case 'mcp-access':
        return <MCPAccessControlView />;

      // Workflow Manager - supports both Flowise and n8n
      case 'workflow-admin':
      case 'flowise-admin':
        return <FlowiseAdminViewer theme={theme} workflowEngine={systemConfig.workflowEngine.type} />;

      case 'workflow-manager':
      case 'flowise-workflows':
        return <FlowiseWorkflowManager theme={theme} workflowEngine={systemConfig.workflowEngine.type} />;

      case 'workflow-users':
      case 'flowise-users':
        return <FlowiseUserManager theme={theme} workflowEngine={systemConfig.workflowEngine.type} />;

      case 'workflow-settings':
      case 'flowise-settings':
        return <FlowiseSettingsManager theme={theme} workflowEngine={systemConfig.workflowEngine.type} />;

      case 'agenticode-sessions':
        return <AWCodeSessionsView theme={theme} />; // Using CRT-style component

      case 'agenticode-settings':
        return <AWCodeSettingsView theme={theme} />;

      case 'agenticode-metrics':
        return <CodeModeMetricsDashboard theme={theme} />;

      case 'settings':
        return <SystemSettingsView theme={theme} />;

      case 'users':
      case 'permissions':
        return <UserPermissionsView />;

      case 'auth-access':
        return <AuthAccessControlView />;

      case 'rate-limits':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">
                Rate Limits Configuration
              </h2>
              <p className="text-text-secondary">
                Configure API rate limits per user or globally to prevent abuse
              </p>
            </div>

            {/* Global Rate Limits */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Activity size={18} />
                Global Rate Limits
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Requests per Minute</div>
                  <div className="text-2xl font-bold text-text-primary">60</div>
                  <div className="text-xs text-green-500 mt-1">Default limit</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Requests per Hour</div>
                  <div className="text-2xl font-bold text-text-primary">1,000</div>
                  <div className="text-xs text-green-500 mt-1">Default limit</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-secondary">
                  <div className="text-xs text-text-secondary mb-1">Burst Limit</div>
                  <div className="text-2xl font-bold text-text-primary">10</div>
                  <div className="text-xs text-text-secondary mt-1">Expensive operations</div>
                </div>
              </div>
            </div>

            {/* Per-User Rate Limits */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Users size={18} />
                Per-User Rate Limits
              </h3>
              <p className="text-sm text-text-secondary mb-4">
                Override rate limits for specific users or API tokens. Higher limits for premium users, lower for abusive accounts.
              </p>
              <div className="text-center py-8 text-text-secondary">
                <Shield size={48} className="mx-auto mb-4 opacity-50" />
                <p>Rate limit overrides are managed via API tokens.</p>
                <p className="text-sm mt-2">Create or edit API tokens to set custom rate limits.</p>
              </div>
            </div>

            {/* Rate Limit Tiers */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4">Rate Limit Tiers</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary">
                  <div>
                    <div className="font-medium text-text-primary">Free Tier</div>
                    <div className="text-xs text-text-secondary">Default for all users</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-text-primary">60 req/min</div>
                    <div className="text-xs text-text-secondary">1,000 req/hour</div>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary">
                  <div>
                    <div className="font-medium text-text-primary">Pro Tier</div>
                    <div className="text-xs text-text-secondary">For power users</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-text-primary">120 req/min</div>
                    <div className="text-xs text-text-secondary">5,000 req/hour</div>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-secondary">
                  <div>
                    <div className="font-medium text-text-primary">Enterprise Tier</div>
                    <div className="text-xs text-text-secondary">For high-volume API users</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-text-primary">300 req/min</div>
                    <div className="text-xs text-text-secondary">Unlimited/hour</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'database':
        return (
          <div className="h-full flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold mb-2 text-text-primary">
                  Redis Cache Management
                </h2>
                <p className="text-text-secondary">
                  Redis Commander - full cache management interface
                </p>
              </div>
              <a
                href={(import.meta.env.VITE_REDIS_COMMANDER_URL as string) || '/redis-commander/'}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Monitor size={18} />
                Open in New Window
              </a>
            </div>

            <div className="flex-1 glass-card rounded-lg overflow-hidden" style={{ minHeight: '700px' }}>
              <iframe
                src={(import.meta.env.VITE_REDIS_COMMANDER_URL as string) || '/redis-commander/'}
                className="w-full h-full border-0"
                style={{ minHeight: '700px' }}
                title="Redis Commander"
                allow="clipboard-read; clipboard-write"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                onLoad={() => console.log('Redis Commander iframe loaded')}
                onError={(e) => console.error('Failed to load Redis Commander:', e)}
              />
            </div>
          </div>
        );

      case 'milvus':
        return (
          <div className="h-full flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold mb-2 text-text-primary">
                  Milvus Vector Database
                </h2>
                <p className="text-text-secondary">
                  Attu - Milvus vector database administration interface
                </p>
              </div>
              <a
                href={(import.meta.env.VITE_ATTU_URL as string) || '/attu/'}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Monitor size={18} />
                Open in New Window
              </a>
            </div>

            <div className="flex-1 glass-card rounded-lg overflow-hidden" style={{ minHeight: '700px' }}>
              <iframe
                src={(import.meta.env.VITE_ATTU_URL as string) || '/attu/'}
                className="w-full h-full border-0"
                style={{ minHeight: '700px' }}
                title="Attu - Milvus Admin"
                allow="clipboard-read; clipboard-write"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                onLoad={() => console.log('Attu iframe loaded')}
                onError={(e) => console.error('Failed to load Attu:', e)}
              />
            </div>
          </div>
        );

      case 'prompts':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold mb-2 text-text-primary">
                  System Prompts Library
                </h2>
                <p className="text-text-secondary">
                  Manage system prompts that guide AI behavior and responses
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingPrompt({
                    id: 0,
                    name: '',
                    description: '',
                    content: '',
                    is_default: false,
                    is_active: true,
                    category: 'general',
                    tags: [],
                    version: 1,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    assignedUsersCount: 0
                  });
                  setShowEditDialog(true);
                }}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                New Prompt
              </button>
            </div>

            {systemPrompts.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <FileText size={48} className="mx-auto mb-4 text-text-secondary" />
                <p className="text-text-secondary">No system prompts found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {systemPrompts.map((prompt) => (
                  <div key={prompt.id} className="glass-card p-6 hover:shadow-lg transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-sm font-semibold text-text-primary">{prompt.name}</h3>
                          {prompt.is_default && (
                            <span className="px-2 py-1 text-xs rounded-full bg-yellow-500/10 text-yellow-500 flex items-center gap-1">
                              <Star size={12} />
                              Default
                            </span>
                          )}
                          <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${
                            prompt.is_active
                              ? 'bg-green-500/10 text-green-500'
                              : 'bg-theme-bg-secondary text-text-secondary'
                          }`}>
                            {prompt.is_active ? <Eye size={12} /> : <EyeOff size={12} />}
                            {prompt.is_active ? 'Active' : 'Inactive'}
                          </span>
                          {prompt.category && (
                            <span className="px-2 py-1 text-xs rounded-full bg-primary-500/10 text-primary-500">
                              {prompt.category}
                            </span>
                          )}
                        </div>
                        {prompt.description && (
                          <p className="text-sm text-text-secondary mb-3">{prompt.description}</p>
                        )}
                        <div className="bg-surface-secondary rounded-lg p-3 mb-3">
                          <p className="text-sm text-text-primary font-mono line-clamp-3">
                            {prompt.content}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-text-secondary">
                          <span>Version {prompt.version}</span>
                          <span>{prompt.assignedUsersCount} user{prompt.assignedUsersCount !== 1 ? 's' : ''}</span>
                          <span>Updated {new Date(prompt.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleAssignUsersToPrompt(prompt)}
                          className="px-3 py-2 rounded-lg hover:bg-blue-500/10 text-blue-500 transition-colors flex items-center gap-2 text-sm"
                          title="Assign users to this prompt"
                        >
                          <Users size={16} />
                          Assign Users
                        </button>
                        <button
                          onClick={() => {
                            setEditingPrompt(prompt);
                            setShowEditDialog(true);
                          }}
                          className="p-2 rounded-lg hover:bg-primary-500/10 text-primary-500 transition-colors"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => handleDeletePrompt(prompt.id)}
                          className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                          disabled={prompt.is_default}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'templates':
        return <PromptTemplateManager />;

      case 'prompt-metrics':
        return <PromptMetrics theme={theme} />;

      case 'pipeline-settings':
        return <PipelineSettingsView />;

      case 'tokens':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold mb-2 text-text-primary">
                  API Token Management
                </h2>
                <p className="text-text-secondary">
                  Create and manage API keys for any user to access the API programmatically
                </p>
              </div>
              <button
                onClick={() => {
                  setShowCreateTokenDialog(true);
                  setNewTokenData({ userId: '', name: '', expiresInDays: 30, rateLimitTier: 'free' });
                  setCreatedToken(null);
                }}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                Create API Token
              </button>
            </div>

            {/* Create Token Dialog */}
            {showCreateTokenDialog && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 dark:bg-black/70">
                <div className="glass-card w-full max-w-2xl m-4 p-6">
                  {!createdToken ? (
                    <>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-base font-bold text-text-primary">Create New API Token</h3>
                        <button
                          onClick={() => setShowCreateTokenDialog(false)}
                          className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            User *
                          </label>
                          <select
                            value={newTokenData.userId}
                            onChange={(e) => setNewTokenData({ ...newTokenData, userId: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          >
                            <option value="" style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }}>Select a user...</option>
                            {availableUsers.map(user => (
                              <option key={user.id} value={user.id} style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }}>
                                {user.displayName}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-text-secondary mt-1">
                            Create an API token for any user to access the API programmatically
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            Token Name *
                          </label>
                          <input
                            type="text"
                            value={newTokenData.name}
                            onChange={(e) => setNewTokenData({ ...newTokenData, name: e.target.value })}
                            placeholder="e.g., Production Server, Dev Environment, CI/CD Pipeline"
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            Expires In (Days)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={newTokenData.expiresInDays}
                            onChange={(e) => setNewTokenData({ ...newTokenData, expiresInDays: parseInt(e.target.value) || 30 })}
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          />
                          <p className="text-xs text-text-secondary mt-1">
                            Token will expire after this many days. Maximum 365 days.
                          </p>
                        </div>

                        {/* Rate Limit Configuration */}
                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            Rate Limit Tier
                          </label>
                          <select
                            value={newTokenData.rateLimitTier}
                            onChange={(e) => setNewTokenData({ ...newTokenData, rateLimitTier: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          >
                            <option value="free">Free (60 req/min, 1K req/hour)</option>
                            <option value="pro">Pro (120 req/min, 5K req/hour)</option>
                            <option value="enterprise">Enterprise (300 req/min, Unlimited/hour)</option>
                            <option value="custom">Custom</option>
                          </select>
                        </div>

                        {newTokenData.rateLimitTier === 'custom' && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-text-primary mb-2">
                                Requests per Minute
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="10000"
                                value={newTokenData.rateLimitPerMinute || ''}
                                onChange={(e) => setNewTokenData({ ...newTokenData, rateLimitPerMinute: parseInt(e.target.value) || undefined })}
                                placeholder="e.g., 60"
                                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                                style={{
                                  backgroundColor: 'var(--color-surfaceSecondary)',
                                  borderColor: 'var(--color-border)',
                                  color: 'var(--color-text)'
                                }}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-text-primary mb-2">
                                Requests per Hour
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="100000"
                                value={newTokenData.rateLimitPerHour || ''}
                                onChange={(e) => setNewTokenData({ ...newTokenData, rateLimitPerHour: parseInt(e.target.value) || undefined })}
                                placeholder="e.g., 1000"
                                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                                style={{
                                  backgroundColor: 'var(--color-surfaceSecondary)',
                                  borderColor: 'var(--color-border)',
                                  color: 'var(--color-text)'
                                }}
                              />
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-3 mt-6">
                        <button
                          onClick={() => setShowCreateTokenDialog(false)}
                          className="px-4 py-2 rounded-lg bg-surface-secondary text-text-primary hover:bg-surface-hover transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateToken}
                          disabled={!newTokenData.userId || !newTokenData.name}
                          className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <Key size={18} />
                          Generate Token
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-base font-bold text-green-500">API Token Created Successfully!</h3>
                        <button
                          onClick={() => {
                            setShowCreateTokenDialog(false);
                            setCreatedToken(null);
                          }}
                          className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                          <p className="text-sm font-medium text-yellow-500 mb-2">
                            Important: Save this token now!
                          </p>
                          <p className="text-xs text-text-secondary">
                            This is the only time you'll see this token. Store it securely - it won't be shown again.
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            API Token
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={createdToken.apiKey || ''}
                              readOnly
                              className="flex-1 px-4 py-2 rounded-lg border font-mono text-sm"
                              style={{
                                backgroundColor: 'var(--color-surfaceSecondary)',
                                borderColor: 'var(--color-border)',
                                color: 'var(--color-text)'
                              }}
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(createdToken.apiKey || '');
                                alert('Token copied to clipboard!');
                              }}
                              className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Token Name</label>
                            <p className="text-sm font-medium text-text-primary">{createdToken.name}</p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">User</label>
                            <p className="text-sm font-medium text-text-primary">{createdToken.userName}</p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Expires</label>
                            <p className="text-sm font-medium text-text-primary">
                              {createdToken.expiresAt ? new Date(createdToken.expiresAt).toLocaleDateString() : 'Never'}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Created</label>
                            <p className="text-sm font-medium text-text-primary">
                              {new Date(createdToken.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end mt-6">
                        <button
                          onClick={() => {
                            setShowCreateTokenDialog(false);
                            setCreatedToken(null);
                          }}
                          className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Token List */}
            {apiTokens.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <Key size={48} className="mx-auto mb-4 text-text-secondary" />
                <p className="text-text-secondary">No API tokens found</p>
                <p className="text-sm text-text-secondary mt-2">
                  Create an API token to allow programmatic access to the API
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {apiTokens.map((token) => (
                  <div key={token.id} className="glass-card p-6 hover:shadow-lg transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-sm font-semibold text-text-primary">{token.name}</h3>
                          <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${
                            token.isActive && !token.isExpired
                              ? 'bg-green-500/10 text-green-500'
                              : 'bg-red-500/10 text-red-500'
                          }`}>
                            {token.isActive && !token.isExpired ? 'Active' : token.isExpired ? 'Expired' : 'Revoked'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">User</label>
                            <p className="text-sm font-medium text-text-primary">{token.userName}</p>
                            <p className="text-xs text-text-secondary">{token.userEmail}</p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Created</label>
                            <p className="text-sm font-medium text-text-primary">
                              {new Date(token.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Last Used</label>
                            <p className="text-sm font-medium text-text-primary">
                              {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : 'Never'}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Expires</label>
                            <p className={`text-sm font-medium ${token.isExpired ? 'text-red-500' : 'text-text-primary'}`}>
                              {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'Never'}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Rate Limit</label>
                            <p className="text-sm font-medium text-text-primary capitalize">
                              {(token as any).rateLimitTier || 'free'}
                            </p>
                            {(token as any).rateLimitPerMinute && (
                              <p className="text-xs text-text-secondary">
                                {(token as any).rateLimitPerMinute} req/min
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 flex items-center gap-2">
                        {/* Revoke button - only for active tokens */}
                        {token.isActive && !token.isExpired && (
                          <button
                            onClick={() => handleRevokeToken(token.id)}
                            className="p-2 rounded-lg hover:bg-yellow-500/10 text-yellow-500 transition-colors"
                            title="Revoke Token"
                          >
                            <XCircle size={18} />
                          </button>
                        )}
                        {/* Delete button - only for revoked or expired tokens */}
                        {(!token.isActive || token.isExpired) && (
                          <button
                            onClick={() => handleDeleteToken(token.id)}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                            title="Permanently Delete Token"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* API Token Usage Metrics Dashboard */}
            {apiMetrics && (
              <div className="space-y-4 mt-6">
                <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                  <BarChart size={20} />
                  API Token Usage Metrics
                </h3>

                {/* Overall Statistics */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Total Tokens</div>
                    <div className="text-2xl font-bold text-text-primary">{apiMetrics.overall?.totalTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Active</div>
                    <div className="text-2xl font-bold text-green-500">{apiMetrics.overall?.activeTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Expired</div>
                    <div className="text-2xl font-bold text-yellow-500">{apiMetrics.overall?.expiredTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Revoked</div>
                    <div className="text-2xl font-bold text-red-500">{apiMetrics.overall?.revokedTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Total Requests</div>
                    <div className="text-2xl font-bold text-blue-500">{apiMetrics.overall?.totalRequests?.toLocaleString() || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Total Errors</div>
                    <div className="text-2xl font-bold text-red-500">{apiMetrics.overall?.totalErrors?.toLocaleString() || 0}</div>
                  </div>
                </div>

                {/* Per-Token Detailed Metrics */}
                {apiMetrics.tokens && apiMetrics.tokens.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-text-primary">Per-Token Metrics</h4>
                    {apiMetrics.tokens.map((tokenMetric: any) => (
                      <div key={tokenMetric.tokenId} className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h5 className="text-sm font-semibold text-text-primary">{tokenMetric.tokenName}</h5>
                            <p className="text-xs text-text-secondary">{tokenMetric.userName} ({tokenMetric.userEmail})</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              tokenMetric.isActive && !tokenMetric.isExpired
                                ? 'bg-green-500/10 text-green-500'
                                : 'bg-red-500/10 text-red-500'
                            }`}>
                              {tokenMetric.isActive && !tokenMetric.isExpired ? 'Active' : tokenMetric.isExpired ? 'Expired' : 'Revoked'}
                            </span>
                          </div>
                        </div>

                        {/* Metric Summary */}
                        {tokenMetric.metrics && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Total Requests</div>
                            <div className="text-lg font-bold text-text-primary">{(tokenMetric.metrics.totalRequests || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Errors</div>
                            <div className="text-lg font-bold text-red-500">{(tokenMetric.metrics.totalErrors || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Error Rate</div>
                            <div className="text-lg font-bold text-orange-500">{(tokenMetric.metrics.errorRate || 0).toFixed(2)}%</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Token Usage</div>
                            <div className="text-lg font-bold text-blue-500">{(tokenMetric.metrics.totalTokens || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Avg Response (ms)</div>
                            <div className="text-lg font-bold text-purple-500">{(tokenMetric.metrics.averageResponseTime || 0).toFixed(0)}</div>
                          </div>
                        </div>
                        )}

                        {/* Endpoint Usage */}
                        {tokenMetric.metrics?.endpointUsage && tokenMetric.metrics.endpointUsage.length > 0 && (
                          <div className="mb-4">
                            <h6 className="text-xs font-semibold text-text-primary mb-2">Top Endpoints</h6>
                            <div className="space-y-2">
                              {tokenMetric.metrics.endpointUsage.slice(0, 5).map((ep: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <div className="flex-1 bg-surface-secondary rounded-full h-6 overflow-hidden">
                                    <div
                                      className="bg-blue-500/30 h-full flex items-center px-2"
                                      style={{ width: `${ep.percentage}%` }}
                                    >
                                      <span className="text-xs font-mono text-text-primary truncate">{ep.endpoint}</span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-text-secondary w-16 text-right">{ep.count} ({ep.percentage.toFixed(1)}%)</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Error Breakdown */}
                        {tokenMetric.metrics?.errorBreakdown && tokenMetric.metrics.errorBreakdown.length > 0 && (
                          <div className="mb-4">
                            <h6 className="text-xs font-semibold text-text-primary mb-2">Error Breakdown</h6>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {tokenMetric.metrics.errorBreakdown.map((err: any, idx: number) => (
                                <div key={idx} className="bg-red-500/10 p-2 rounded">
                                  <div className="text-xs text-red-500 font-semibold">{err.errorType}</div>
                                  <div className="text-sm text-text-primary">{err.count} ({err.percentage.toFixed(1)}%)</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Request Frequency Chart (Last 30 Days) */}
                        {tokenMetric.metrics?.requestFrequency && tokenMetric.metrics.requestFrequency.length > 0 && (
                          <div>
                            <h6 className="text-xs font-semibold text-text-primary mb-2">Request Frequency (Last 30 Days)</h6>
                            <div className="flex items-end gap-1 h-20">
                              {tokenMetric.metrics.requestFrequency.map((freq: any, idx: number) => {
                                const maxCount = Math.max(...tokenMetric.metrics.requestFrequency.map((f: any) => f.count));
                                const height = maxCount > 0 ? (freq.count / maxCount) * 100 : 0;
                                return (
                                  <div
                                    key={idx}
                                    className="flex-1 bg-blue-500/50 hover:bg-blue-500 transition-colors rounded-t"
                                    style={{ height: `${height}%` }}
                                    title={`${freq.date}: ${freq.count} requests`}
                                  />
                                );
                              })}
                            </div>
                            <div className="flex justify-between text-xs text-text-secondary mt-1">
                              <span>{tokenMetric.metrics.requestFrequency[0]?.date}</span>
                              <span>{tokenMetric.metrics.requestFrequency[tokenMetric.metrics.requestFrequency.length - 1]?.date}</span>
                            </div>
                          </div>
                        )}

                        {/* Last Used */}
                        <div className="mt-4 pt-4 border-t border-border text-xs text-text-secondary">
                          Last used: {tokenMetric.lastUsedAt ? new Date(tokenMetric.lastUsedAt).toLocaleString() : 'Never'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {metricsLoading && (
                  <div className="glass-card p-8 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
                    <p className="text-text-secondary">Loading metrics...</p>
                  </div>
                )}
              </div>
            )}

          </div>
        );

      case 'analytics':
        return <UsageAnalytics theme={theme} />;

      case 'performance':
        return <LLMPerformanceMetrics theme={theme} />;
      case 'context-window':
        return <ContextWindowMetrics />;

      case 'embeddings':
        return <EmbeddingMetrics theme={theme} />;

      case 'audit':
        return <AuditLogsView theme={theme} />;

      case 'errors':
        return <MonitoringView theme={theme} />;

      case 'api-docs':
        return <DeveloperAPIView theme={theme} />;

      case 'api-examples':
        return (
          <div className="space-y-8 max-w-5xl">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">API Code Examples</h2>
              <p className="text-text-secondary">Complete developer guide for integrating with AgenticWorkChat API</p>
            </div>

            {/* Authentication Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Key className="w-6 h-6" />
                Authentication
              </h3>
              <p className="text-text-secondary">
                AgenticWorkChat API supports two types of authentication tokens:
              </p>

              <div className="space-y-4 mt-4">
                <div className="bg-surface-elevated p-4 rounded-lg border border-border">
                  <h4 className="font-semibold text-text-primary mb-2">Standard API Keys (<code className="text-sm bg-surface-base px-2 py-1 rounded">awc_*</code>)</h4>
                  <p className="text-sm text-text-secondary mb-3">
                    Use the authenticated user's Azure AD credentials for MCP tool operations. Requires user to have logged in via Azure AD.
                  </p>
                  <div className="bg-surface-base p-3 rounded font-mono text-xs overflow-x-auto">
                    <span className="text-green-400">POST</span> /api/admin/tokens<br/>
                    <span className="text-text-secondary">{"{"}</span><br/>
                    &nbsp;&nbsp;<span className="text-blue-400">"userId"</span>: <span className="text-yellow-400">"user-uuid"</span>,<br/>
                    &nbsp;&nbsp;<span className="text-blue-400">"name"</span>: <span className="text-yellow-400">"My API Key"</span>,<br/>
                    &nbsp;&nbsp;<span className="text-blue-400">"expiresInDays"</span>: <span className="text-purple-400">90</span><br/>
                    <span className="text-text-secondary">{"}"}</span>
                  </div>
                </div>

                <div className="bg-surface-elevated p-4 rounded-lg border border-border">
                  <h4 className="font-semibold text-text-primary mb-2">System API Keys (<code className="text-sm bg-surface-base px-2 py-1 rounded">awc_system_*</code>)</h4>
                  <p className="text-sm text-text-secondary mb-3">
                    Root-level access using Service Principal credentials. Bypasses user authentication for all Azure operations.
                  </p>
                  <div className="bg-surface-base p-3 rounded font-mono text-xs overflow-x-auto">
                    <span className="text-green-400">POST</span> /api/admin/tokens<br/>
                    <span className="text-text-secondary">{"{"}</span><br/>
                    &nbsp;&nbsp;<span className="text-blue-400">"userId"</span>: <span className="text-yellow-400">"admin-user-uuid"</span>,<br/>
                    &nbsp;&nbsp;<span className="text-blue-400">"name"</span>: <span className="text-yellow-400">"System Root Key"</span>,<br/>
                    &nbsp;&nbsp;<span className="text-blue-400">"isSystemToken"</span>: <span className="text-purple-400">true</span>,<br/>
                    &nbsp;&nbsp;<span className="text-blue-400">"expiresInDays"</span>: <span className="text-purple-400">365</span><br/>
                    <span className="text-text-secondary">{"}"}</span>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-lg mt-4">
                <p className="text-sm text-yellow-400">
                  <strong>Security Warning:</strong> System API keys have unrestricted access to all Azure resources. Only create them for trusted automation and administrative tasks.
                </p>
              </div>
            </div>

            {/* Chat Sessions Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <MessageSquare className="w-6 h-6" />
                Creating Chat Sessions
              </h3>

              <div className="space-y-3">
                <p className="text-text-secondary">Create a new chat session before sending messages:</p>

                <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
                  <span className="text-green-400">POST</span> /api/chat/sessions<br/>
                  <span className="text-blue-400">Authorization:</span> Bearer {"<your-api-key>"}<br/>
                  <span className="text-blue-400">Content-Type:</span> application/json<br/><br/>
                  <span className="text-text-secondary">{"{"}</span><br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"title"</span>: <span className="text-yellow-400">"My Chat Session"</span><br/>
                  <span className="text-text-secondary">{"}"}</span>
                </div>

                <p className="text-sm text-text-secondary mt-3">Response:</p>
                <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
                  <span className="text-text-secondary">{"{"}</span><br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"success"</span>: <span className="text-purple-400">true</span>,<br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"session"</span>: {"{"}<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-400">"id"</span>: <span className="text-yellow-400">"session_1763736207976_d8guv4wib"</span>,<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-400">"title"</span>: <span className="text-yellow-400">"My Chat Session"</span>,<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-400">"createdAt"</span>: <span className="text-yellow-400">"2025-11-21T14:30:07.976Z"</span><br/>
                  &nbsp;&nbsp;{"}"}<br/>
                  <span className="text-text-secondary">{"}"}</span>
                </div>
              </div>
            </div>

            {/* Sending Messages Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Activity className="w-6 h-6" />
                Sending Messages & Calling MCP Tools
              </h3>

              <div className="space-y-3">
                <p className="text-text-secondary">Send a message to trigger LLM completion with automatic MCP tool execution:</p>

                <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
                  <span className="text-green-400">POST</span> /api/chat/stream<br/>
                  <span className="text-blue-400">Authorization:</span> Bearer {"<your-api-key>"}<br/>
                  <span className="text-blue-400">Content-Type:</span> application/json<br/><br/>
                  <span className="text-text-secondary">{"{"}</span><br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"sessionId"</span>: <span className="text-yellow-400">"session_1763736207976_d8guv4wib"</span>,<br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"message"</span>: <span className="text-yellow-400">"Show me my Azure subscriptions and resource groups"</span>,<br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"stream"</span>: <span className="text-purple-400">true</span><br/>
                  <span className="text-text-secondary">{"}"}</span>
                </div>

                <p className="text-sm text-text-secondary mt-4">
                  The API will automatically:
                </p>
                <ul className="list-disc list-inside text-sm text-text-secondary space-y-1 ml-4">
                  <li>Route to the appropriate LLM (GPT-5, Claude, etc.)</li>
                  <li>Detect required MCP tool calls (e.g., <code className="bg-surface-base px-1 rounded">subscription_list</code>, <code className="bg-surface-base px-1 rounded">group_list</code>)</li>
                  <li>Execute tools with proper authentication (Azure AD for user tokens, SP for system tokens)</li>
                  <li>Stream responses back with tool results</li>
                </ul>

                <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-lg mt-4">
                  <p className="text-sm text-blue-400">
                    <strong>Streaming Response:</strong> Use Server-Sent Events (SSE) to receive real-time updates including tool execution status, results, and LLM responses.
                  </p>
                </div>
              </div>
            </div>

            {/* Direct MCP Tool Calls Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Server className="w-6 h-6" />
                Direct MCP Tool Execution
              </h3>

              <div className="space-y-3">
                <p className="text-text-secondary">
                  While the chat API automatically handles MCP tool calls, you can also call MCP tools directly via the proxy:
                </p>

                <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
                  <span className="text-green-400">POST</span> http://mcp-proxy:8001/mcp/tool<br/>
                  <span className="text-blue-400">Authorization:</span> Bearer {"<your-api-key>"}<br/>
                  <span className="text-blue-400">Content-Type:</span> application/json<br/><br/>
                  <span className="text-text-secondary">{"{"}</span><br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"server_id"</span>: <span className="text-yellow-400">"azure_mcp"</span>,<br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"tool_name"</span>: <span className="text-yellow-400">"subscription_list"</span>,<br/>
                  &nbsp;&nbsp;<span className="text-blue-400">"arguments"</span>: {"{"}<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-blue-400">"auth-method"</span>: <span className="text-purple-400">0</span><br/>
                  &nbsp;&nbsp;{"}"}<br/>
                  <span className="text-text-secondary">{"}"}</span>
                </div>

                <p className="text-sm text-text-secondary mt-4">Available Azure MCP Tools:</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary font-mono">
                  <code className="bg-surface-base px-2 py-1 rounded">subscription_list</code>
                  <code className="bg-surface-base px-2 py-1 rounded">group_list</code>
                  <code className="bg-surface-base px-2 py-1 rounded">resource_list</code>
                  <code className="bg-surface-base px-2 py-1 rounded">vm_list</code>
                  <code className="bg-surface-base px-2 py-1 rounded">aks_cluster_get</code>
                  <code className="bg-surface-base px-2 py-1 rounded">storage_account_list</code>
                  <code className="bg-surface-base px-2 py-1 rounded">microsoft_docs_search</code>
                  <code className="bg-surface-base px-2 py-1 rounded">applens_resource_diagnose</code>
                </div>
              </div>
            </div>

            {/* Rate Limits Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <Clock className="w-6 h-6" />
                Rate Limits & Best Practices
              </h3>

              <div className="space-y-3">
                <ul className="list-disc list-inside text-sm text-text-secondary space-y-2">
                  <li><strong>Rate Limits:</strong> 100 requests per minute per API key</li>
                  <li><strong>Token Expiry:</strong> Configure expiration when creating tokens (1-365 days)</li>
                  <li><strong>System Tokens:</strong> Use sparingly, only for automation and administrative tasks</li>
                  <li><strong>Streaming:</strong> Always use streaming mode for better UX and real-time updates</li>
                  <li><strong>Error Handling:</strong> Check SSE events for <code className="bg-surface-base px-1 rounded">tool_error</code> to detect MCP failures</li>
                </ul>
              </div>
            </div>
          </div>
        );

      case 'code-examples':
        return (
          <div className="space-y-8 max-w-5xl">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">Code Examples</h2>
              <p className="text-text-secondary">Ready-to-use code snippets for common integrations</p>
            </div>

            {/* Python Example */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-base font-semibold text-text-primary">Python</h3>

              <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
                {`import requests
import json

API_KEY = "awc_system_..."
BASE_URL = "http://localhost:8000/api"

# Create a session
session_resp = requests.post(
    f"{BASE_URL}/chat/sessions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    },
    json={"title": "Azure Query Session"}
)
session_id = session_resp.json()["session"]["id"]

# Send a message with streaming
response = requests.post(
    f"{BASE_URL}/chat/stream",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    },
    json={
        "sessionId": session_id,
        "message": "List my Azure subscriptions",
        "stream": True
    },
    stream=True
)

# Process SSE events
for line in response.iter_lines():
    if line:
        line = line.decode('utf-8')
        if line.startswith('data: '):
            data = json.loads(line[6:])
            print(data)`}
              </div>
            </div>

            {/* Node.js/TypeScript Example */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-base font-semibold text-text-primary">Node.js / TypeScript</h3>

              <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
                {`import fetch from 'node-fetch';

const API_KEY = 'awc_system_...';
const BASE_URL = 'http://localhost:8000/api';

async function queryAzure() {
  // Create session
  const sessionResp = await fetch(\`\${BASE_URL}/chat/sessions\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${API_KEY}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title: 'Azure Query' })
  });

  const { session } = await sessionResp.json();

  // Send message
  const response = await fetch(\`\${BASE_URL}/chat/stream\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${API_KEY}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sessionId: session.id,
      message: 'Show my resource groups',
      stream: true
    })
  });

  // Process SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        console.log(data);
      }
    }
  }
}

queryAzure();`}
              </div>
            </div>

            {/* cURL Example */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-base font-semibold text-text-primary">cURL / Bash</h3>

              <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
                {`#!/bin/bash

API_KEY="awc_system_..."
BASE_URL="http://localhost:8000/api"

# Create session
SESSION_ID=$(curl -s -X POST "$BASE_URL/chat/sessions" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Azure Query"}' | jq -r '.session.id')

echo "Session ID: $SESSION_ID"

# Send message and stream response
curl -X POST "$BASE_URL/chat/stream" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"sessionId\\": \\"$SESSION_ID\\",
    \\"message\\": \\"List all my Azure resource groups\\",
    \\"stream\\": true
  }" \\
  --no-buffer`}
              </div>
            </div>

            {/* Workflows API Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-base font-semibold text-text-primary">Workflows API</h3>
              <p className="text-sm text-text-secondary mb-4">
                Create, manage, and execute AI workflows programmatically.
              </p>

              <div className="space-y-6">
                {/* List Workflows */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">List All Workflows</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X GET "http://localhost:8000/api/workflows" \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -H "Content-Type: application/json"`}
                  </div>
                </div>

                {/* Create Workflow */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Create Workflow</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X POST "http://localhost:8000/api/workflows" \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My Workflow",
    "description": "Automated data processing",
    "nodes": [
      {
        "id": "node_1",
        "type": "trigger",
        "data": {"triggerType": "manual"}
      },
      {
        "id": "node_2",
        "type": "llm",
        "data": {
          "prompt": "Analyze the following data: {{input}}",
          "model": "gpt-4"
        }
      }
    ],
    "edges": [
      {
        "id": "edge_1",
        "source": "node_1",
        "target": "node_2"
      }
    ],
    "status": "active"
  }'`}
                  </div>
                </div>

                {/* Get Workflow */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Get Workflow by ID</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X GET "http://localhost:8000/api/workflows/\${WORKFLOW_ID}" \\
  -H "Authorization: Bearer \${API_KEY}"`}
                  </div>
                </div>

                {/* Update Workflow */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Update Workflow</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X PUT "http://localhost:8000/api/workflows/\${WORKFLOW_ID}" \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Updated Workflow Name",
    "description": "Updated description",
    "status": "active"
  }'`}
                  </div>
                </div>

                {/* Execute Workflow */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Execute Workflow</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X POST "http://localhost:8000/api/workflows/\${WORKFLOW_ID}/execute" \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": {
      "data": "Your input data here"
    }
  }'`}
                  </div>
                  <p className="text-xs text-text-secondary mt-2">
                    Returns Server-Sent Events (SSE) stream with real-time execution updates
                  </p>
                </div>

                {/* Delete Workflow */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Delete Workflow</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X DELETE "http://localhost:8000/api/workflows/\${WORKFLOW_ID}" \\
  -H "Authorization: Bearer \${API_KEY}"`}
                  </div>
                </div>

                {/* Get Execution History */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Get Execution History</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X GET "http://localhost:8000/api/workflows/\${WORKFLOW_ID}/executions" \\
  -H "Authorization: Bearer \${API_KEY}"`}
                  </div>
                </div>
              </div>
            </div>

            {/* MCP Tools API Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-base font-semibold text-text-primary">MCP Tools API</h3>

              <div className="space-y-6">
                {/* List Available Tools */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">List Available MCP Tools</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X GET "http://localhost:8001/v1/mcp/tools" \\
  -H "Authorization: Bearer \${API_KEY}"`}
                  </div>
                </div>

                {/* Execute MCP Tool */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Execute MCP Tool Directly</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X POST "http://localhost:8001/mcp/tool" \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "server_id": "azure_mcp",
    "tool_name": "group_list",
    "arguments": {
      "subscription": "your-subscription-id"
    }
  }'`}
                  </div>
                </div>
              </div>
            </div>

            {/* Admin API Section */}
            <div className="glass-card p-6 space-y-4">
              <h3 className="text-base font-semibold text-text-primary">Admin API</h3>

              <div className="space-y-6">
                {/* List Users */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">List Users</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X GET "http://localhost:8000/api/admin/users" \\
  -H "Authorization: Bearer \${API_KEY}"`}
                  </div>
                </div>

                {/* Create API Token */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Create API Token</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X POST "http://localhost:8000/api/admin/tokens" \\
  -H "Authorization: Bearer \${API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "user-uuid",
    "name": "My API Key",
    "expiresInDays": 90,
    "isSystemToken": false
  }'`}
                  </div>
                  <p className="text-xs text-text-secondary mt-2">
                    Set <code className="bg-surface-base px-1 rounded">isSystemToken: true</code> for system-level access with SP credentials
                  </p>
                </div>

                {/* Audit Logs */}
                <div>
                  <h4 className="font-semibold text-text-primary mb-2">Get Audit Logs</h4>
                  <div className="bg-surface-base p-4 rounded font-mono text-xs overflow-x-auto">
{`curl -X GET "http://localhost:8000/api/admin/audit-logs?limit=50&offset=0" \\
  -H "Authorization: Bearer \${API_KEY}"`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'uat-dashboard':
        return (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-text-primary">UAT Dashboard</h2>
                <p className="text-text-secondary text-sm">
                  Automated testing powered by Agenticode CLI
                </p>
              </div>
              <a
                href="http://localhost:3333"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
              >
                Open in New Tab
              </a>
            </div>
            <div className="flex-1 min-h-0 glass-card overflow-hidden rounded-lg">
              <iframe
                src="http://localhost:3333"
                className="w-full h-full border-0"
                title="UAT Dashboard"
                allow="clipboard-write"
              />
            </div>
          </div>
        );

      default:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">
                {sidebarItems.find(item =>
                  item.id === activeSection ||
                  item.children?.some(child => child.id === activeSection)
                )?.label || 'Admin Section'}
              </h2>
              <p className="text-text-secondary">Feature coming soon...</p>
            </div>

            <div className="glass-card p-8 text-center">
              <div className="max-w-md mx-auto">
                <div className="p-4 rounded-full bg-primary-500/10 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <Settings size={32} className="text-primary-500" />
                </div>
                <h3 className="text-base font-semibold mb-2 text-text-primary">Feature Coming Soon</h3>
                <p className="text-text-secondary">This admin feature is currently under development and will be available in a future update.</p>
              </div>
            </div>
          </div>
        );
    }
  };

  // Edit Dialog Component
  // Memoized handlers to prevent EditDialog recreation on each keystroke
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, name: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, name: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, description: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, description: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, content: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, content: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleCategoryChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, category: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, category: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleCloseDialog = useCallback(() => {
    setShowEditDialog(false);
    setEditingPrompt(null);
    setEditingTemplate(null);
  }, []);

  const handleTemperatureChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditingTemplate(prev => prev ? { ...prev, temperature: value ? parseFloat(value) : null } : null);
  }, []);

  const handleMaxTokensChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditingTemplate(prev => prev ? { ...prev, max_tokens: value ? parseInt(value) : null } : null);
  }, []);

  const handleTargetModelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditingTemplate(prev => prev ? { ...prev, target_model: value || null, model_specific: !!value } : null);
  }, []);

  const handleIsDefaultChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, is_default: checked } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, is_default: checked } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleIsActiveChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, is_active: checked } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, is_active: checked } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleIsPublicChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setEditingTemplate(prev => prev ? { ...prev, is_public: checked } : null);
  }, []);

  // Memoized EditDialog component to prevent recreation on parent re-renders
  const EditDialog = useMemo(() => {
    if (!showEditDialog || (!editingPrompt && !editingTemplate)) return null;

    const isPrompt = !!editingPrompt;
    const item = isPrompt ? editingPrompt : editingTemplate;
    if (!item) return null;

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 dark:bg-black/70">
        <div
          className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col m-4 rounded-2xl shadow-2xl border"
          style={{
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)'
          }}
        >
          {/* Header */}
          <div
            className="p-6 border-b flex items-center justify-between"
            style={{
              borderColor: 'var(--color-border)'
            }}
          >
            <h2 className="text-sm font-bold text-text-primary">
              {item.id ? 'Edit' : 'Create'} {isPrompt ? 'System Prompt' : 'Chat Template'}
            </h2>
            <button
              onClick={handleCloseDialog}
              className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Name *
              </label>
              <input
                type="text"
                defaultValue={item.name}
                onChange={handleNameChange}
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
                placeholder="Enter name..."
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Description
              </label>
              <textarea
                defaultValue={item.description || ''}
                onChange={handleDescriptionChange}
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
                placeholder="Enter description..."
                rows={2}
              />
            </div>

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Content *
              </label>
              <textarea
                defaultValue={item.content}
                onChange={handleContentChange}
                className="w-full px-4 py-2 rounded-lg border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
                placeholder="Enter prompt/template content..."
                rows={12}
              />
              <p className="text-xs text-text-secondary mt-2">
                Character count: {item.content.length}
              </p>
            </div>

            {/* Category and Tags */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Category
                </label>
                <select
                  defaultValue={item.category || 'general'}
                  onChange={handleCategoryChange}
                  className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                  style={{
                    backgroundColor: 'var(--color-surfaceSecondary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)'
                  }}
                >
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="general">General</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="development">Development</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="writing">Writing</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="analysis">Analysis</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="creative">Creative</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="business">Business</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="education">Education</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="technical">Technical</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="research">Research</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="other">Other</option>
                </select>
              </div>
            </div>

            {/* Template-specific fields */}
            {!isPrompt && editingTemplate && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Temperature
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      defaultValue={editingTemplate.temperature || ''}
                      onChange={handleTemperatureChange}
                      className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                      style={{
                        backgroundColor: 'var(--color-surfaceSecondary)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)'
                      }}
                      placeholder="0.7"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Max Tokens
                    </label>
                    <input
                      type="number"
                      defaultValue={editingTemplate.max_tokens || ''}
                      onChange={handleMaxTokensChange}
                      className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                      style={{
                        backgroundColor: 'var(--color-surfaceSecondary)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)'
                      }}
                      placeholder="2000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Target Model (optional)
                  </label>
                  <input
                    type="text"
                    defaultValue={editingTemplate.target_model || ''}
                    onChange={handleTargetModelChange}
                    className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                    style={{
                      backgroundColor: 'var(--color-surfaceSecondary)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)'
                    }}
                    placeholder="gpt-4, claude-3, etc."
                  />
                </div>
              </>
            )}

            {/* Toggles */}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  defaultChecked={item.is_default}
                  onChange={handleIsDefaultChange}
                  className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm text-text-primary">Set as Default</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  defaultChecked={item.is_active}
                  onChange={handleIsActiveChange}
                  className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm text-text-primary">Active</span>
              </label>

              {!isPrompt && editingTemplate && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked={editingTemplate.is_public}
                    onChange={handleIsPublicChange}
                    className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-text-primary">Public</span>
                </label>
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            className="p-6 border-t flex items-center justify-end gap-3"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surfaceTertiary)'
            }}
          >
            <button
              onClick={handleCloseDialog}
              className="px-4 py-2 rounded-lg transition-colors"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                color: 'var(--color-text)'
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (isPrompt && editingPrompt) {
                  handleSavePrompt(editingPrompt);
                } else if (editingTemplate) {
                  handleSaveTemplate(editingTemplate);
                }
              }}
              disabled={!item.name || !item.content}
              className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Save size={18} />
              Save {isPrompt ? 'Prompt' : 'Template'}
            </button>
          </div>
        </div>
      </div>
    );
  }, [
    showEditDialog,
    editingPrompt,
    editingTemplate,
    handleNameChange,
    handleDescriptionChange,
    handleContentChange,
    handleCategoryChange,
    handleTemperatureChange,
    handleMaxTokensChange,
    handleTargetModelChange,
    handleIsDefaultChange,
    handleIsActiveChange,
    handleIsPublicChange,
    handleCloseDialog,
    handleSavePrompt,
    handleSaveTemplate
  ]);

  return (
    <div className="fixed inset-0 z-[1100] flex admin-portal" style={{ background: 'transparent' }}>
      {/* Edit Dialog */}
      {EditDialog}

      {/* User Assignment Dialog */}
      {showUserAssignDialog && (assigningPrompt || assigningTemplate) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/70">
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col m-4 rounded-2xl shadow-2xl border"
            style={{
              backgroundColor: 'var(--color-background)',
              borderColor: 'var(--color-border)'
            }}
          >
            <div
              className="p-6 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2 className="text-sm font-bold text-text-primary">
                Assign Users to {assigningPrompt ? assigningPrompt.name : assigningTemplate?.name}
              </h2>
              <button
                onClick={() => {
                  setShowUserAssignDialog(false);
                  setAssigningPrompt(null);
                  setAssigningTemplate(null);
                  setAssignedUserIds([]);
                }}
                className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-sm text-text-secondary mb-4">
                Select users who should have access to this {assigningPrompt ? 'prompt' : 'template'}
              </p>

              {availableUsers.length === 0 ? (
                <div className="glass-card p-8 text-center">
                  <Users size={48} className="mx-auto mb-4 text-text-secondary" />
                  <p className="text-text-secondary">No users available</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {availableUsers.map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-surface-secondary transition-colors"
                      style={{
                        borderColor: assignedUserIds.includes(user.id) ? 'var(--color-primary)' : 'var(--color-border)',
                        backgroundColor: assignedUserIds.includes(user.id) ? 'var(--color-primary-500)/10' : 'transparent'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={assignedUserIds.includes(user.id)}
                        onChange={() => toggleUserAssignment(user.id)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-text-primary">{user.displayName}</div>
                        <div className="text-xs text-text-secondary">{user.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div
              className="p-6 border-t flex items-center justify-end gap-3"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => {
                  setShowUserAssignDialog(false);
                  setAssigningPrompt(null);
                  setAssigningTemplate(null);
                  setAssignedUserIds([]);
                }}
                className="px-4 py-2 rounded-lg border hover:bg-surface-secondary transition-colors"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUserAssignments}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Save size={18} />
                Save Assignments
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar - GCP Style */}
      <div
        className="admin-sidebar w-64 flex-shrink-0 overflow-y-auto scrollbar-hide"
        style={{
          background: 'var(--ap-bg-secondary)',
          borderRight: '1px solid var(--ap-border)'
        }}
      >
        {/* Logo/Header */}
        <div
          className="px-4 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--ap-border)' }}
        >
          <div className="flex items-center gap-3">
            <CogIcon size={20} className="text-[var(--ap-accent)]" />
            <span
              className="font-semibold text-[var(--ap-text)]"
              style={{ fontSize: '14px', letterSpacing: '-0.02em' }}
            >
              Admin Console
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors hover:bg-[var(--ap-bg-tertiary)]"
              style={{ color: 'var(--ap-text-muted)' }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <div className="py-2 space-y-0.5">
          {sidebarItems.map(item => renderSidebarItem(item))}
        </div>

        {/* Footer with version */}
        <div
          className="absolute bottom-0 left-0 w-64 px-4 py-3 text-[10px] flex items-center gap-2"
          style={{
            background: 'var(--ap-bg-secondary)',
            borderTop: '1px solid var(--ap-border)',
            color: 'var(--ap-text-muted)'
          }}
        >
          <CubeIcon size={12} className="opacity-50" />
          <span>AgenticWork v0.1.0-alpha</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col admin-main-content">
        {/* Header - GCP Style */}
        <div
          className="admin-header px-6 py-3 flex items-center justify-between"
          style={{
            background: 'var(--ap-bg)',
            borderBottom: '1px solid var(--ap-border)'
          }}
        >
          <div className="flex items-center gap-3">
            <Clock size={14} className="opacity-50" />
            <span style={{ fontSize: '12px', color: 'var(--ap-text-muted)' }}>
              Last updated: {new Date().toLocaleTimeString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Nerd font status indicators */}
            <span
              className="admin-segment success flex items-center gap-1.5"
              title="System Status"
            >
              <CheckCircle size={10} />
              <span>Healthy</span>
            </span>
          </div>
        </div>

        {/* Content Area */}
        <div
          className="flex-1 p-6 overflow-y-auto"
          style={{
            fontSize: '13px',
            background: 'var(--ap-bg)',
            color: 'var(--ap-text)'
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
              <span className="ml-4 text-sm text-text-secondary">Loading admin data...</span>
            </div>
          ) : (
            renderMainContent()
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPortal;