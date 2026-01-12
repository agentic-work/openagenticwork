import React, { useState, useEffect } from 'react';
// Basic UI icons from lucide
import {
  Users, Edit, Save, X, Search, Image, Code, Globe, Upload, Brain,
  Unlock, SlidersHorizontal, Sparkles, FileText, Calendar, Terminal
} from '@/shared/icons';
// Custom badass AgenticWork icons
import {
  User, AlertTriangle, CheckCircle, XCircle, Shield, Cpu, Server,
  Database, Timer as Clock, Lock, DollarSign
} from './AdminIcons';
import { useAuth } from '../../../app/providers/AuthContext';
import { apiRequest } from '@/utils/api';

// API returns permissions in camelCase format
interface ApiPermissions {
  userId: string;
  allowedLlmProviders: string[];
  deniedLlmProviders: string[];
  allowedMcpServers: string[];
  deniedMcpServers: string[];
  flowiseEnabled: boolean;
  flowiseWorkflows: string[];
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  canUseImageGeneration: boolean;
  canUseCodeExecution: boolean;
  canUseWebSearch: boolean;
  canUseFileUpload: boolean;
  canUseMemory: boolean;
  canUseRag: boolean;
  canUseAwcode: boolean;
  source: 'user' | 'group' | 'default';
}

// API response from /admin/user-management
interface ApiUser {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  groups: string[];
  flowise_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  hasCustomPermissions: boolean;
  customPermissions: ApiPermissions | null;
  // Scope enforcement fields from User model
  is_locked?: boolean;
  scope_warning_count?: number;
  locked_at?: string | null;
  locked_reason?: string | null;
  // Prompt assignment
  prompt_template_id?: string | null;
  prompt_template_name?: string | null;
}

// Normalized format for UI display
interface UserPermission {
  user_id: string;
  email: string;
  name: string;
  is_admin: boolean;
  groups: string[];
  // Permissions - mapped from API
  allowed_llms: string[];
  denied_llms: string[];
  allowed_mcps: string[];
  denied_mcps: string[];
  flowise_access: boolean;
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  feature_flags: {
    image_generation: boolean;
    code_execution: boolean;
    web_search: boolean;
    file_upload: boolean;
    memory: boolean;
    rag: boolean;
    awcode: boolean;
  };
  // Custom permissions flag
  hasCustomPermissions: boolean;
  permissionSource: 'user' | 'group' | 'default';
  // Intelligence slider (0-100, null = use global)
  intelligence_slider: number | null;
  // Scope enforcement / lockout
  is_locked: boolean;
  scope_warning_count: number;
  locked_at: string | null;
  locked_reason: string | null;
  // Prompt template assignment
  prompt_template_id: string | null;
  prompt_template_name: string | null;
  created_at: string;
  updated_at: string;
}

interface SliderInfo {
  value: number | null;
  source: 'user' | 'global' | 'default';
  globalValue?: number;
}

interface AvailableLLM {
  id: string;
  name: string;
  provider_type: string;
}

interface AvailableMCP {
  id: string;
  name: string;
  description?: string;
}

interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  is_default: boolean;
}

// Helper to map API user to UI format
function mapApiUserToPermission(apiUser: ApiUser): UserPermission {
  const perms = apiUser.customPermissions;
  return {
    user_id: apiUser.id,
    email: apiUser.email,
    name: apiUser.name || 'Unknown',
    is_admin: apiUser.is_admin,
    groups: apiUser.groups || [],
    // Map permissions from camelCase to snake_case
    allowed_llms: perms?.allowedLlmProviders || [],
    denied_llms: perms?.deniedLlmProviders || [],
    allowed_mcps: perms?.allowedMcpServers || [],
    denied_mcps: perms?.deniedMcpServers || [],
    flowise_access: perms?.flowiseEnabled ?? apiUser.flowise_enabled ?? false,
    daily_token_limit: perms?.dailyTokenLimit ?? null,
    monthly_token_limit: perms?.monthlyTokenLimit ?? null,
    feature_flags: {
      image_generation: perms?.canUseImageGeneration ?? true,
      code_execution: perms?.canUseCodeExecution ?? true,
      web_search: perms?.canUseWebSearch ?? true,
      file_upload: perms?.canUseFileUpload ?? true,
      memory: perms?.canUseMemory ?? true,
      rag: perms?.canUseRag ?? true,
      awcode: perms?.canUseAwcode ?? false,
    },
    hasCustomPermissions: apiUser.hasCustomPermissions,
    permissionSource: perms?.source || 'default',
    intelligence_slider: null, // Loaded separately
    is_locked: apiUser.is_locked ?? false,
    scope_warning_count: apiUser.scope_warning_count ?? 0,
    locked_at: apiUser.locked_at ?? null,
    locked_reason: apiUser.locked_reason ?? null,
    prompt_template_id: apiUser.prompt_template_id ?? null,
    prompt_template_name: apiUser.prompt_template_name ?? null,
    created_at: apiUser.created_at,
    updated_at: apiUser.created_at, // API doesn't return updated_at for user list
  };
}

const UserPermissionsView: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [availableLLMs, setAvailableLLMs] = useState<AvailableLLM[]>([]);
  const [availableMCPs, setAvailableMCPs] = useState<AvailableMCP[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserPermission | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<Partial<UserPermission> | null>(null);
  const [editingPromptTemplateId, setEditingPromptTemplateId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [sliderInfo, setSliderInfo] = useState<SliderInfo | null>(null);
  const [editingSlider, setEditingSlider] = useState<number | null>(null);
  const [useGlobalSlider, setUseGlobalSlider] = useState(true);
  const [globalSliderValue, setGlobalSliderValue] = useState<number>(50);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      const [usersData, llmsData, mcpsData, promptsData] = await Promise.all([
        apiRequest('/admin/user-management', { headers }).then(r => r.json()),
        apiRequest('/admin/permissions/available-llms', { headers }).then(r => r.json()),
        apiRequest('/admin/permissions/available-mcps', { headers }).then(r => r.json()),
        apiRequest('/admin/prompts/templates', { headers }).then(r => r.json()).catch(() => ({ templates: [] }))
      ]);

      // Map API users to normalized UI format
      const apiUsers: ApiUser[] = Array.isArray(usersData) ? usersData : usersData.users || [];
      const mappedUsers = apiUsers.map(mapApiUserToPermission);

      setUsers(mappedUsers);
      setAvailableLLMs(Array.isArray(llmsData) ? llmsData : llmsData.providers || []);
      setAvailableMCPs(Array.isArray(mcpsData) ? mcpsData : mcpsData.servers || []);
      setPromptTemplates(Array.isArray(promptsData) ? promptsData : promptsData.templates || []);
    } catch (err) {
      console.error('Failed to fetch user permissions data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setUsers([]);
      setAvailableLLMs([]);
      setAvailableMCPs([]);
      setPromptTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = async (user: UserPermission) => {
    try {
      const headers = getAuthHeaders();

      // Fetch permissions, slider info, and prompt assignment in parallel
      const [permissionsResponse, sliderResponse, globalSliderResponse, promptAssignmentResponse] = await Promise.all([
        apiRequest(`/admin/user-management/${user.user_id}/permissions`, { headers }),
        apiRequest(`/admin/users/${user.user_id}/slider`, { headers }),
        apiRequest(`/admin/settings/slider`, { headers }),
        apiRequest(`/admin/prompts/users/${user.user_id}/templates`, { headers }).catch(() => ({ json: async () => ({ templates: [] }) }))
      ]);

      const permissions = await permissionsResponse.json();
      const sliderData = await sliderResponse.json();
      const globalData = await globalSliderResponse.json();
      const promptData = promptAssignmentResponse?.json ? await promptAssignmentResponse.json() : { templates: [] };
      // Get the first assigned template (if any)
      const userTemplates = promptData.templates || promptData || [];
      const currentPromptTemplateId = Array.isArray(userTemplates) && userTemplates.length > 0
        ? String(userTemplates[0].id)
        : user.prompt_template_id;

      // API returns permissions in camelCase format
      const apiPerms = permissions.permissions || permissions;

      setSelectedUser(user);
      setEditingPermissions({
        user_id: user.user_id,
        // Map from API camelCase to UI snake_case
        allowed_llms: apiPerms.allowedLlmProviders || [],
        denied_llms: apiPerms.deniedLlmProviders || [],
        allowed_mcps: apiPerms.allowedMcpServers || [],
        denied_mcps: apiPerms.deniedMcpServers || [],
        flowise_access: apiPerms.flowiseEnabled ?? false,
        daily_token_limit: apiPerms.dailyTokenLimit ?? null,
        monthly_token_limit: apiPerms.monthlyTokenLimit ?? null,
        feature_flags: {
          image_generation: apiPerms.canUseImageGeneration ?? true,
          code_execution: apiPerms.canUseCodeExecution ?? true,
          web_search: apiPerms.canUseWebSearch ?? true,
          file_upload: apiPerms.canUseFileUpload ?? true,
          memory: apiPerms.canUseMemory ?? true,
          rag: apiPerms.canUseRag ?? true,
          awcode: apiPerms.canUseAwcode ?? false
        }
      });

      // Set prompt template
      setEditingPromptTemplateId(currentPromptTemplateId || null);

      // Set slider state
      setSliderInfo(sliderData);
      setGlobalSliderValue(globalData.value ?? 50);

      // If user has a custom slider, use it; otherwise use global
      if (sliderData.source === 'user' && sliderData.value !== null) {
        setUseGlobalSlider(false);
        setEditingSlider(sliderData.value);
      } else {
        setUseGlobalSlider(true);
        setEditingSlider(globalData.value ?? 50);
      }

      setShowEditModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user permissions');
    }
  };

  const handleSavePermissions = async () => {
    if (!editingPermissions || !selectedUser) return;

    try {
      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };

      // Map UI field names back to API camelCase format
      const apiPermissions = {
        allowedLlmProviders: editingPermissions.allowed_llms || [],
        deniedLlmProviders: editingPermissions.denied_llms || [],
        allowedMcpServers: editingPermissions.allowed_mcps || [],
        deniedMcpServers: editingPermissions.denied_mcps || [],
        flowiseEnabled: editingPermissions.flowise_access ?? false,
        dailyTokenLimit: editingPermissions.daily_token_limit,
        monthlyTokenLimit: editingPermissions.monthly_token_limit,
        canUseImageGeneration: editingPermissions.feature_flags?.image_generation ?? true,
        canUseCodeExecution: editingPermissions.feature_flags?.code_execution ?? true,
        canUseWebSearch: editingPermissions.feature_flags?.web_search ?? true,
        canUseFileUpload: editingPermissions.feature_flags?.file_upload ?? true,
        canUseMemory: editingPermissions.feature_flags?.memory ?? true,
        canUseRag: editingPermissions.feature_flags?.rag ?? true,
        canUseAwcode: editingPermissions.feature_flags?.awcode ?? false,
      };

      // Save permissions
      await apiRequest(`/admin/user-management/${selectedUser.user_id}/permissions`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(apiPermissions)
      });

      // Save slider setting
      if (useGlobalSlider) {
        // Clear user slider (use global)
        await apiRequest(`/admin/users/${selectedUser.user_id}/slider`, {
          method: 'DELETE',
          headers
        });
      } else if (editingSlider !== null) {
        // Set user-specific slider
        await apiRequest(`/admin/users/${selectedUser.user_id}/slider`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ value: editingSlider })
        });
      }

      // Save prompt template assignment
      // First, get current assignment to see if we need to remove old one
      const currentAssignment = selectedUser.prompt_template_id;
      if (editingPromptTemplateId !== currentAssignment) {
        // Remove old assignment if it exists
        if (currentAssignment) {
          try {
            await apiRequest(`/admin/prompts/templates/${currentAssignment}/assign/${selectedUser.user_id}`, {
              method: 'DELETE',
              headers
            });
          } catch (e) {
            // Ignore if no assignment exists
          }
        }
        // Add new assignment if provided
        if (editingPromptTemplateId) {
          await apiRequest(`/admin/prompts/templates/${editingPromptTemplateId}/assign`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ user_id: selectedUser.user_id })
          });
        }
      }

      await fetchData();
      setShowEditModal(false);
      setSelectedUser(null);
      setEditingPermissions(null);
      setEditingPromptTemplateId(null);
      setSliderInfo(null);
      setEditingSlider(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions');
    }
  };

  const handleDeletePermissions = async (userId: string) => {
    if (!confirm('Are you sure you want to delete all custom permissions for this user? They will inherit default permissions.')) return;

    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/permissions`, {
        method: 'DELETE',
        headers
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete permissions');
    }
  };

  /**
   * Unlock a user account that was locked due to scope violations
   */
  const handleUnlockUser = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to unlock ${userName}'s account? This will also reset their warning count.`)) return;

    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/unlock`, {
        method: 'POST',
        headers
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock user');
    }
  };

  /**
   * Reset a user's warning count without unlocking
   */
  const handleResetWarnings = async (userId: string, userName: string) => {
    if (!confirm(`Reset ${userName}'s warning count? They have not been locked yet.`)) return;

    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/reset-warnings`, {
        method: 'POST',
        headers
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset warnings');
    }
  };

  const toggleArrayItem = (array: string[], item: string): string[] => {
    if (array.includes(item)) {
      return array.filter(i => i !== item);
    }
    return [...array, item];
  };

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
          User Permissions Management
        </h2>
        <p className="text-text-secondary">
          Manage user-level permissions for LLM providers, MCP servers, and features
        </p>
      </div>

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

      {/* Search Bar */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-text-secondary" />
          <input
            type="text"
            placeholder="Search users by email or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary placeholder-text-secondary"
          />
        </div>
      </div>

      {/* Users List */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-semibold mb-4 text-text-primary flex items-center gap-2">
          <Users className="h-5 w-5" />
          Users ({filteredUsers.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-text-primary">User</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Status</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">LLM Access</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">MCP Access</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Features</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Token Limits</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.user_id} className="border-b border-border/50 hover:bg-surface-secondary/20">
                  <td className="py-3 px-4">
                    <div>
                      <p className="font-medium text-text-primary">{user.name || 'Unknown'}</p>
                      <p className="text-xs text-text-secondary">{user.email}</p>
                    </div>
                  </td>
                  {/* Account Status Column */}
                  <td className="py-3 px-4">
                    {user.is_locked ? (
                      <div className="flex items-center gap-2">
                        <div className="px-2 py-1 bg-red-500/20 text-red-400 rounded-full text-xs font-medium flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          Locked
                        </div>
                        {user.locked_at && (
                          <span className="text-xs text-text-secondary">
                            {new Date(user.locked_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ) : user.scope_warning_count > 0 ? (
                      <div className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-xs font-medium">
                        ⚠️ {user.scope_warning_count}/3 warnings
                      </div>
                    ) : (
                      <div className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-medium flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Active
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1">
                      {(user.allowed_llms?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3 text-green-400" />
                          <span className="text-xs text-text-secondary">{user.allowed_llms?.length ?? 0} allowed</span>
                        </div>
                      )}
                      {(user.denied_llms?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <XCircle className="h-3 w-3 text-red-400" />
                          <span className="text-xs text-text-secondary">{user.denied_llms?.length ?? 0} denied</span>
                        </div>
                      )}
                      {(user.allowed_llms?.length ?? 0) === 0 && (user.denied_llms?.length ?? 0) === 0 && (
                        <span className="text-xs text-text-secondary">Default</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1">
                      {(user.allowed_mcps?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3 text-green-400" />
                          <span className="text-xs text-text-secondary">{user.allowed_mcps?.length ?? 0} allowed</span>
                        </div>
                      )}
                      {(user.denied_mcps?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <XCircle className="h-3 w-3 text-red-400" />
                          <span className="text-xs text-text-secondary">{user.denied_mcps?.length ?? 0} denied</span>
                        </div>
                      )}
                      {(user.allowed_mcps?.length ?? 0) === 0 && (user.denied_mcps?.length ?? 0) === 0 && (
                        <span className="text-xs text-text-secondary">Default</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {user.feature_flags?.image_generation && (
                        <div className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">Img</div>
                      )}
                      {user.feature_flags?.code_execution && (
                        <div className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">Code</div>
                      )}
                      {user.feature_flags?.web_search && (
                        <div className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs">Web</div>
                      )}
                      {user.feature_flags?.awcode && (
                        <div className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">Agenticode</div>
                      )}
                      {user.flowise_access && (
                        <div className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded text-xs">Flow</div>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-0.5">
                      {user.daily_token_limit && (
                        <span className="text-xs text-text-secondary">D: {user.daily_token_limit.toLocaleString()}</span>
                      )}
                      {user.monthly_token_limit && (
                        <span className="text-xs text-text-secondary">M: {user.monthly_token_limit.toLocaleString()}</span>
                      )}
                      {!user.daily_token_limit && !user.monthly_token_limit && (
                        <span className="text-xs text-text-secondary">Unlimited</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="p-1 hover:bg-blue-500/20 text-blue-400 rounded"
                        title="Edit Permissions"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeletePermissions(user.user_id)}
                        className="p-1 hover:bg-red-500/20 text-red-400 rounded"
                        title="Reset to Default"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      {/* Lock/Unlock buttons */}
                      {user.is_locked ? (
                        <button
                          onClick={() => handleUnlockUser(user.user_id, user.name || user.email)}
                          className="p-1 hover:bg-green-500/20 text-green-400 rounded"
                          title="Unlock Account"
                        >
                          <Unlock className="h-4 w-4" />
                        </button>
                      ) : user.scope_warning_count > 0 ? (
                        <button
                          onClick={() => handleResetWarnings(user.user_id, user.name || user.email)}
                          className="p-1 hover:bg-yellow-500/20 text-yellow-400 rounded"
                          title="Reset Warnings"
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredUsers.length === 0 && (
            <div className="text-center py-8 text-text-secondary">
              No users found matching your search.
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && selectedUser && editingPermissions && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Edit Permissions: {selectedUser.name}
                </h3>
                <p className="text-sm text-text-secondary">{selectedUser.email}</p>
              </div>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedUser(null);
                  setEditingPermissions(null);
                  setSliderInfo(null);
                  setEditingSlider(null);
                  setUseGlobalSlider(true);
                }}
                className="p-1 hover:bg-surface-secondary rounded"
              >
                <X className="h-5 w-5 text-text-secondary" />
              </button>
            </div>

            <div className="space-y-6">
              {/* LLM Providers */}
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  LLM Provider Access
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Allowed Providers
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded p-2">
                      {availableLLMs.map(llm => (
                        <label key={llm.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={editingPermissions.allowed_llms?.includes(llm.id) || false}
                            onChange={() => setEditingPermissions({
                              ...editingPermissions,
                              allowed_llms: toggleArrayItem(editingPermissions.allowed_llms || [], llm.id)
                            })}
                            className="text-green-500"
                          />
                          <span className="text-sm text-text-primary">{llm.name}</span>
                          <span className="text-xs text-text-secondary">({llm.provider_type})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Denied Providers
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded p-2">
                      {availableLLMs.map(llm => (
                        <label key={llm.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={editingPermissions.denied_llms?.includes(llm.id) || false}
                            onChange={() => setEditingPermissions({
                              ...editingPermissions,
                              denied_llms: toggleArrayItem(editingPermissions.denied_llms || [], llm.id)
                            })}
                            className="text-red-500"
                          />
                          <span className="text-sm text-text-primary">{llm.name}</span>
                          <span className="text-xs text-text-secondary">({llm.provider_type})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* MCP Servers */}
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  MCP Server Access
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Allowed Servers
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded p-2">
                      {availableMCPs.map(mcp => (
                        <label key={mcp.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={editingPermissions.allowed_mcps?.includes(mcp.id) || false}
                            onChange={() => setEditingPermissions({
                              ...editingPermissions,
                              allowed_mcps: toggleArrayItem(editingPermissions.allowed_mcps || [], mcp.id)
                            })}
                            className="text-green-500"
                          />
                          <div className="flex-1">
                            <span className="text-sm text-text-primary block">{mcp.name}</span>
                            {mcp.description && (
                              <span className="text-xs text-text-secondary block">{mcp.description}</span>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Denied Servers
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded p-2">
                      {availableMCPs.map(mcp => (
                        <label key={mcp.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={editingPermissions.denied_mcps?.includes(mcp.id) || false}
                            onChange={() => setEditingPermissions({
                              ...editingPermissions,
                              denied_mcps: toggleArrayItem(editingPermissions.denied_mcps || [], mcp.id)
                            })}
                            className="text-red-500"
                          />
                          <div className="flex-1">
                            <span className="text-sm text-text-primary block">{mcp.name}</span>
                            {mcp.description && (
                              <span className="text-xs text-text-secondary block">{mcp.description}</span>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature Flags */}
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Feature Permissions
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={editingPermissions.feature_flags?.image_generation || false}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        feature_flags: {
                          ...editingPermissions.feature_flags!,
                          image_generation: e.target.checked
                        }
                      })}
                    />
                    <Image className="h-4 w-4 text-blue-400" />
                    <span className="text-sm text-text-primary">Image Generation</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={editingPermissions.feature_flags?.code_execution || false}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        feature_flags: {
                          ...editingPermissions.feature_flags!,
                          code_execution: e.target.checked
                        }
                      })}
                    />
                    <Code className="h-4 w-4 text-green-400" />
                    <span className="text-sm text-text-primary">Code Execution</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={editingPermissions.feature_flags?.web_search || false}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        feature_flags: {
                          ...editingPermissions.feature_flags!,
                          web_search: e.target.checked
                        }
                      })}
                    />
                    <Globe className="h-4 w-4 text-purple-400" />
                    <span className="text-sm text-text-primary">Web Search</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={editingPermissions.feature_flags?.file_upload || false}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        feature_flags: {
                          ...editingPermissions.feature_flags!,
                          file_upload: e.target.checked
                        }
                      })}
                    />
                    <Upload className="h-4 w-4 text-orange-400" />
                    <span className="text-sm text-text-primary">File Upload</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={editingPermissions.feature_flags?.memory || false}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        feature_flags: {
                          ...editingPermissions.feature_flags!,
                          memory: e.target.checked
                        }
                      })}
                    />
                    <Brain className="h-4 w-4 text-pink-400" />
                    <span className="text-sm text-text-primary">Memory</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={editingPermissions.feature_flags?.rag || false}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        feature_flags: {
                          ...editingPermissions.feature_flags!,
                          rag: e.target.checked
                        }
                      })}
                    />
                    <Database className="h-4 w-4 text-cyan-400" />
                    <span className="text-sm text-text-primary">RAG</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-surface-secondary/20 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={editingPermissions.feature_flags?.awcode || false}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        feature_flags: {
                          ...editingPermissions.feature_flags!,
                          awcode: e.target.checked
                        }
                      })}
                    />
                    <Terminal className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm text-text-primary">Agenticode</span>
                  </label>
                </div>
              </div>

              {/* Flowise Access */}
              <div className="border border-border rounded-lg p-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPermissions.flowise_access || false}
                    onChange={(e) => setEditingPermissions({
                      ...editingPermissions,
                      flowise_access: e.target.checked
                    })}
                  />
                  <span className="font-medium text-text-primary">Flowise Access</span>
                  <span className="text-sm text-text-secondary ml-auto">Enable access to Flowise workflows</span>
                </label>
              </div>

              {/* Token Limits */}
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Token Limits
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Daily Token Limit
                    </label>
                    <input
                      type="number"
                      value={editingPermissions.daily_token_limit || ''}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        daily_token_limit: e.target.value ? parseInt(e.target.value) : null
                      })}
                      placeholder="Unlimited"
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Monthly Token Limit
                    </label>
                    <input
                      type="number"
                      value={editingPermissions.monthly_token_limit || ''}
                      onChange={(e) => setEditingPermissions({
                        ...editingPermissions,
                        monthly_token_limit: e.target.value ? parseInt(e.target.value) : null
                      })}
                      placeholder="Unlimited"
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Intelligence Slider */}
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  Intelligence Slider
                </h4>
                <p className="text-sm text-text-secondary mb-4">
                  Controls the cost/quality tradeoff for AI model selection. Lower values prefer cheaper/faster models, higher values prefer more capable models.
                </p>

                {/* Use Global Toggle */}
                <label className="flex items-center gap-2 cursor-pointer mb-4 p-2 rounded hover:bg-surface-secondary/20">
                  <input
                    type="checkbox"
                    checked={useGlobalSlider}
                    onChange={(e) => {
                      setUseGlobalSlider(e.target.checked);
                      if (e.target.checked) {
                        setEditingSlider(globalSliderValue);
                      }
                    }}
                    className="text-primary-500"
                  />
                  <span className="text-sm text-text-primary">Use global default</span>
                  <span className="text-xs text-text-secondary ml-auto">
                    (Global: {globalSliderValue}%)
                  </span>
                </label>

                {/* Slider Control */}
                <div className={`transition-opacity ${useGlobalSlider ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1 text-green-400">
                      <DollarSign className="h-4 w-4" />
                      <span className="text-xs font-medium">Cost Optimized</span>
                    </div>
                    <span className="text-lg font-bold text-primary-400">{editingSlider ?? 50}%</span>
                    <div className="flex items-center gap-1 text-purple-400">
                      <Sparkles className="h-4 w-4" />
                      <span className="text-xs font-medium">Quality Optimized</span>
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={editingSlider ?? 50}
                    onChange={(e) => setEditingSlider(parseInt(e.target.value))}
                    className="w-full h-2 bg-gradient-to-r from-green-500 via-yellow-500 to-purple-500 rounded-lg appearance-none cursor-pointer slider-thumb"
                  />

                  {/* Tier Indicator */}
                  <div className="flex justify-between mt-2 text-xs text-text-secondary">
                    <span>0%</span>
                    <span className="border-l border-border pl-2">33% - Economical</span>
                    <span className="border-l border-border pl-2">66% - Balanced</span>
                    <span>100%</span>
                  </div>

                  {/* Current Tier Badge */}
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-sm text-text-secondary">Current Tier:</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      (editingSlider ?? 50) <= 33
                        ? 'bg-green-500/20 text-green-400'
                        : (editingSlider ?? 50) <= 66
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {(editingSlider ?? 50) <= 33
                        ? 'Economical (Fast, Low Cost)'
                        : (editingSlider ?? 50) <= 66
                          ? 'Balanced (Standard)'
                          : 'Premium (High Quality)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Prompt Template Assignment */}
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-text-primary mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Prompt Template (Behavior Profile)
                </h4>
                <p className="text-sm text-text-secondary mb-4">
                  Controls the AI's behavior, scope restrictions, and personality. Admin templates have full access; non-admin templates enforce topic scope.
                </p>
                <div>
                  <select
                    value={editingPromptTemplateId || ''}
                    onChange={(e) => setEditingPromptTemplateId(e.target.value || null)}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                  >
                    <option value="">Use default template (based on role)</option>
                    {promptTemplates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.name} {template.is_default ? '(Default)' : ''} - {template.category || 'general'}
                        {template.description ? ` - ${template.description.substring(0, 50)}...` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-2">
                    {selectedUser?.is_admin
                      ? '⚠️ Admin users have access to all templates including Admin Mode.'
                      : '🔒 Non-admin users can only be assigned non-admin templates for topic scope enforcement.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-6 border-t border-border">
              <button
                onClick={handleSavePermissions}
                className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center justify-center gap-2"
              >
                <Save className="h-4 w-4" />
                Save Permissions
              </button>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setSelectedUser(null);
                  setEditingPermissions(null);
                  setEditingPromptTemplateId(null);
                  setSliderInfo(null);
                  setEditingSlider(null);
                  setUseGlobalSlider(true);
                }}
                className="px-4 py-2 border border-border rounded-lg text-text-secondary hover:bg-surface-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserPermissionsView;
