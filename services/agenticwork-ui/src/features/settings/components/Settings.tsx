import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';
import GlassCard from '@/shared/ui/GlassCard';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';
// import FilesystemManager from '@/components/FilesystemManager'; // TODO: Add this component
import {
  CogIcon,
  BellIcon,
  ShieldCheckIcon,
  ServerIcon,
  PaintBrushIcon,
  UserIcon,
  KeyIcon,
  GlobeAltIcon,
  CpuChipIcon,
  FolderIcon,
  ClockIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
// import toast from 'react-hot-toast'; // TODO: Add toast notifications

const Settings = () => {
  const { theme, changeTheme, accentColor, accentColors, changeAccentColor, backgroundEffect, setBackgroundEffect } = useTheme();
  const { getAuthHeaders } = useAuth();

  // Save theme to backend after user clicks theme button
  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    changeTheme(newTheme);
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(apiEndpoint('/settings'), {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ theme: newTheme === 'system' ? 'dark' : newTheme })
      });
    } catch (error) {
      console.error('Failed to save theme to backend:', error);
    }
  };

  const [notifications, setNotifications] = useState({
    testFailures: true,
    securityAlerts: true,
    systemUpdates: false,
    performanceWarnings: true,
  });
  
  const [apiSettings, setApiSettings] = useState({
    rateLimit: '1000',
    timeout: '30',
    maxRetries: '3',
  });
  
  const [aiModelSettings, setAiModelSettings] = useState({
    provider: 'ollama', // 'ollama' or 'azure'
    azureEndpoint: '',
    azureApiKey: '',
    azureDeploymentName: '',
    azureApiVersion: '2024-02-01',
  });
  
  const handleSave = () => {
    // Save settings to localStorage for now
    if (aiModelSettings.provider === 'azure' && aiModelSettings.azureApiKey) {
      localStorage.setItem('ai-model-settings', JSON.stringify(aiModelSettings));
    }
    // toast.success('Settings saved successfully!');
    // console.log('Settings saved successfully!');
  };
  
  // Load settings on mount
  React.useEffect(() => {
    const savedSettings = localStorage.getItem('ai-model-settings');
    if (savedSettings) {
      setAiModelSettings(JSON.parse(savedSettings));
    }
  }, []);
  
  const settingsSections = [
    { icon: PaintBrushIcon, label: 'Appearance', id: 'appearance' },
    { icon: BellIcon, label: 'Notifications', id: 'notifications' },
    { icon: ShieldCheckIcon, label: 'Security', id: 'security' },
    { icon: ServerIcon, label: 'API Settings', id: 'api' },
    { icon: CpuChipIcon, label: 'AI Models', id: 'ai-models' },
    { icon: FolderIcon, label: 'MCP Settings', id: 'mcp' },
    { icon: UserIcon, label: 'Profile', id: 'profile' },
  ];
  
  const [activeSection, setActiveSection] = useState('appearance');
  
  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold text-[var(--color-text)] mb-2">Settings</h1>
        <p className="text-[var(--color-textSecondary)]">Configure your AgenticWorkCode preferences</p>
      </motion.div>
      
      <div className="grid grid-cols-12 gap-6">
        {/* Settings Navigation */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="col-span-12 lg:col-span-3"
        >
          <GlassCard padding="p-4">
            <nav className="space-y-1">
              {settingsSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors ${
                    activeSection === section.id
                      ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]'
                      : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-background)]/30'
                  }`}
                >
                  <section.icon className="w-5 h-5" />
                  <span className="text-sm font-medium">{section.label}</span>
                </button>
              ))}
            </nav>
          </GlassCard>
        </motion.div>
        
        {/* Settings Content */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="col-span-12 lg:col-span-9"
        >
          {activeSection === 'appearance' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <PaintBrushIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Appearance</h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Theme
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleThemeChange('light')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        theme === 'light'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="w-full h-20 bg-white rounded-lg mb-2"></div>
                      <span className="text-sm font-medium">Light</span>
                    </button>

                    <button
                      onClick={() => handleThemeChange('dark')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        theme === 'dark'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="w-full h-20 bg-gray-900 rounded-lg mb-2"></div>
                      <span className="text-sm font-medium">Dark</span>
                    </button>

                    <button
                      onClick={() => handleThemeChange('system')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        theme === 'system'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="w-full h-20 bg-gradient-to-r from-white to-gray-900 rounded-lg mb-2"></div>
                      <span className="text-sm font-medium">System</span>
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Accent Color
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {accentColors.map((color) => (
                      <button
                        key={color.name}
                        onClick={() => changeAccentColor(color)}
                        className={`group relative w-12 h-12 rounded-full border-2 transition-all ${
                          accentColor.name === color.name
                            ? 'border-[var(--color-text)] scale-110 shadow-lg'
                            : 'border-[var(--color-border)] hover:scale-110 hover:border-[var(--color-borderHover)]'
                        }`}
                        style={{ backgroundColor: color.primary }}
                      >
                        {accentColor.name === color.name && (
                          <div className="absolute inset-0 rounded-full flex items-center justify-center">
                            <svg className="w-6 h-6 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                        <span className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 text-xs text-[var(--color-textSecondary)] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {color.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Background Effect
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setBackgroundEffect('off')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        backgroundEffect === 'off'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="w-full h-12 bg-[var(--color-background)] rounded-lg mb-2 flex items-center justify-center">
                        <span className="text-xs text-[var(--color-textSecondary)]">Solid</span>
                      </div>
                      <span className="text-sm font-medium">Off</span>
                      <p className="text-xs text-[var(--color-textSecondary)] mt-1">No effects</p>
                    </button>

                    <button
                      onClick={() => setBackgroundEffect('css')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        backgroundEffect === 'css'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div
                        className="w-full h-12 rounded-lg mb-2 relative overflow-hidden"
                        style={{
                          background: `linear-gradient(135deg,
                            color-mix(in srgb, ${accentColor.lava1} 30%, var(--color-background)) 0%,
                            var(--color-background) 50%,
                            color-mix(in srgb, ${accentColor.lava2} 30%, var(--color-background)) 100%)`,
                        }}
                      >
                        <div className="absolute inset-0 backdrop-blur-sm" />
                      </div>
                      <span className="text-sm font-medium">Liquid Glass</span>
                      <p className="text-xs text-[var(--color-textSecondary)] mt-1">Animated CSS</p>
                    </button>
                  </div>
                  <p className="text-xs text-[var(--color-textSecondary)] mt-2">
                    Liquid Glass provides a premium animated background with minimal CPU usage.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Keyboard Shortcuts
                  </label>
                  <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/30">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">New Chat</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+C</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Light Theme</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+L</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Dark Theme</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+D</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Admin Portal</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+A</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Documentation</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+?</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">All Shortcuts</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Shift+?</kbd>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'notifications' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <BellIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Notifications</h2>
              </div>
              
              <div className="space-y-4">
                {Object.entries(notifications).map(([key, value]) => (
                  <label key={key} className="flex items-center justify-between cursor-pointer p-4 rounded-lg hover:bg-[var(--color-background)]/30 transition-colors">
                    <div>
                      <p className="text-[var(--color-text)] font-medium">
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      </p>
                      <p className="text-sm text-[var(--color-textSecondary)]">
                        Receive notifications for {key.toLowerCase().replace(/([A-Z])/g, ' $1')}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => setNotifications({ ...notifications, [key]: e.target.checked })}
                      className="sr-only"
                    />
                    <div className={`relative w-12 h-6 rounded-full transition-colors ${
                      value ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
                    }`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                        value ? 'translate-x-6' : 'translate-x-0'
                      }`} />
                    </div>
                  </label>
                ))}
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'security' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <ShieldCheckIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Security</h2>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[var(--color-text)] font-medium">Two-Factor Authentication</h3>
                    <span className="text-sm text-[var(--color-success)]">Enabled</span>
                  </div>
                  <p className="text-sm text-[var(--color-textSecondary)]">
                    Add an extra layer of security to your account
                  </p>
                </div>
                
                <div className="p-4 rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[var(--color-text)] font-medium">API Keys</h3>
                    <span className="text-sm text-[var(--color-textSecondary)]">3 active</span>
                  </div>
                  <p className="text-sm text-[var(--color-textSecondary)] mb-3">
                    Manage your API keys for external integrations
                  </p>
                  <button className="text-sm text-[var(--color-primary)] hover:text-[var(--color-secondary)]">
                    Manage Keys →
                  </button>
                </div>
                
                <div className="p-4 rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[var(--color-text)] font-medium">Session Timeout</h3>
                    <select className="px-3 py-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)]">
                      <option>30 minutes</option>
                      <option>1 hour</option>
                      <option>2 hours</option>
                      <option>Never</option>
                    </select>
                  </div>
                  <p className="text-sm text-[var(--color-textSecondary)]">
                    Automatically log out after period of inactivity
                  </p>
                </div>

                {/* Build Information */}
                <div className="p-4 rounded-lg border border-[var(--color-border)] mt-6">
                  <div className="flex items-center space-x-2 mb-4">
                    <InformationCircleIcon className="w-5 h-5 text-[var(--color-primary)]" />
                    <h3 className="text-[var(--color-text)] font-medium">Build Information</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--color-textSecondary)] flex items-center gap-2">
                        <ClockIcon className="w-4 h-4" />
                        Built
                      </span>
                      <span className="text-[var(--color-text)] font-mono text-xs">
                        {(() => {
                          const buildTime = import.meta.env.VITE_BUILD_TIME || new Date().toISOString();
                          try {
                            return new Date(buildTime).toLocaleString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'UTC',
                              timeZoneName: 'short'
                            });
                          } catch {
                            return 'Unknown';
                          }
                        })()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--color-textSecondary)]">Version</span>
                      <span className="text-[var(--color-text)] font-mono text-xs">
                        {import.meta.env.VITE_VERSION || '1.0.0'}
                      </span>
                    </div>
                    {import.meta.env.VITE_GIT_SHORT_COMMIT && (
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Commit</span>
                        <code className="text-[var(--color-text)] font-mono text-xs bg-[var(--color-surface)] px-2 py-0.5 rounded">
                          {import.meta.env.VITE_GIT_SHORT_COMMIT}
                        </code>
                      </div>
                    )}
                    {import.meta.env.VITE_GIT_BRANCH && (
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Branch</span>
                        <span className="text-[var(--color-text)] font-mono text-xs">
                          {import.meta.env.VITE_GIT_BRANCH}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'api' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <ServerIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">API Settings</h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                    Rate Limit (requests/hour)
                  </label>
                  <input
                    type="number"
                    value={apiSettings.rateLimit}
                    onChange={(e) => setApiSettings({ ...apiSettings, rateLimit: e.target.value })}
                    className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                    Request Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    value={apiSettings.timeout}
                    onChange={(e) => setApiSettings({ ...apiSettings, timeout: e.target.value })}
                    className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                    Max Retries
                  </label>
                  <input
                    type="number"
                    value={apiSettings.maxRetries}
                    onChange={(e) => setApiSettings({ ...apiSettings, maxRetries: e.target.value })}
                    className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                  />
                </div>
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'ai-models' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <CpuChipIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">AI Models</h2>
              </div>
              
              <div className="space-y-6">
                {/* Model Provider Selection */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Model Provider
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setAiModelSettings({ ...aiModelSettings, provider: 'ollama' })}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        aiModelSettings.provider === 'ollama'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="text-left">
                        <h4 className="font-medium text-[var(--color-text)] mb-1">Ollama</h4>
                        <p className="text-sm text-[var(--color-textSecondary)]">Local models</p>
                      </div>
                    </button>
                    
                    <button
                      onClick={() => setAiModelSettings({ ...aiModelSettings, provider: 'azure' })}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        aiModelSettings.provider === 'azure'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="text-left">
                        <h4 className="font-medium text-[var(--color-text)] mb-1">Azure OpenAI</h4>
                        <p className="text-sm text-[var(--color-textSecondary)]">Cloud models</p>
                      </div>
                    </button>
                  </div>
                </div>
                
                {/* Azure OpenAI Settings */}
                {aiModelSettings.provider === 'azure' && (
                  <>
                    <div className="p-4 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
                      <p className="text-sm text-[var(--color-warning)]">
                        <strong>Note:</strong> This is for testing purposes. Your API key will be stored locally.
                      </p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        Azure OpenAI Endpoint
                      </label>
                      <input
                        type="url"
                        value={aiModelSettings.azureEndpoint}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureEndpoint: e.target.value })}
                        placeholder="https://your-resource.openai.azure.com/"
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={aiModelSettings.azureApiKey}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureApiKey: e.target.value })}
                        placeholder="Your Azure OpenAI API key"
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        Deployment Name
                      </label>
                      <input
                        type="text"
                        value={aiModelSettings.azureDeploymentName}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureDeploymentName: e.target.value })}
                        placeholder="e.g., gpt-4-turbo"
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        API Version
                      </label>
                      <select
                        value={aiModelSettings.azureApiVersion}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureApiVersion: e.target.value })}
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      >
                        <option value="2024-02-01">2024-02-01 (Latest)</option>
                        <option value="2023-12-01-preview">2023-12-01-preview</option>
                        <option value="2023-05-15">2023-05-15</option>
                      </select>
                    </div>
                    
                    <button
                      onClick={() => {
                        // Test connection
                        // console.log('Testing connection...');
                        /* toast.promise(
                          new Promise((resolve, reject) => {
                            setTimeout(() => {
                              if (aiModelSettings.azureEndpoint && aiModelSettings.azureApiKey) {
                                resolve('Connection successful!');
                              } else {
                                reject('Please fill in all required fields');
                              }
                            }, 1000);
                          }),
                          {
                            loading: 'Testing connection...',
                            success: 'Connection successful!',
                            error: 'Connection failed',
                          }
                        ); */
                      }}
                      className="px-4 py-2 bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded-lg font-medium hover:bg-[var(--color-primary)]/30 transition-colors"
                    >
                      Test Connection
                    </button>
                  </>
                )}
                
                {/* Ollama Settings */}
                {aiModelSettings.provider === 'ollama' && (
                  <div className="p-4 rounded-lg bg-[var(--color-success)]/10 border border-[var(--color-success)]/30">
                    <p className="text-sm text-[var(--color-success)]">
                      Using local Ollama models. Make sure Ollama is running on your system.
                    </p>
                  </div>
                )}
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'mcp' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <FolderIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">MCP Settings</h2>
              </div>
              
              <div className="space-y-6">
                {/* MCP Information */}
                <div className="p-4 rounded-lg bg-[var(--color-info)]/10 border border-[var(--color-info)]/30 mb-6">
                  <h3 className="text-sm font-medium text-[var(--color-info)] mb-2">Model Context Protocol (MCP)</h3>
                  <p className="text-sm text-[var(--color-textSecondary)]">
                    MCP enables AI models to interact with external tools and services. The filesystem below is used by MCP servers to store and manage their data.
                  </p>
                </div>
                
                {/* Filesystem Manager */}
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-textSecondary)] mb-4">MCP Filesystem</h3>
                  {/* <FilesystemManager /> */}
                  <p className="text-sm text-[var(--color-textSecondary)]">Filesystem manager coming soon...</p>
                </div>
              </div>
            </GlassCard>
          )}
          
          {/* Save Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-6 flex justify-end"
          >
            <button
              onClick={handleSave}
              className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium hover:bg-[var(--color-primary)]/80 transition-colors"
            >
              Save Changes
            </button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default Settings;
