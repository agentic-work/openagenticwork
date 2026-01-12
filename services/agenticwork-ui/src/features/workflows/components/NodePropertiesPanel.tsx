/**
 * Node Properties Panel
 * Professional right sidebar panel for configuring workflow nodes
 * Enhanced with better form controls, validation, and micro-interactions
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Trash2, AlertCircle, Info, ChevronDown, Check } from '@/shared/icons';
import type { Node } from 'reactflow';
import type { NodeData } from '../types/workflow.types';

interface NodePropertiesPanelProps {
  node: Node<NodeData> | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<NodeData>) => void;
  onDelete: (nodeId: string) => void;
  availableModels?: string[];
  availableTools?: Array<{ name: string; server: string; description?: string }>;
  theme?: 'light' | 'dark';
}

// Form input components for consistent styling
const FormInput: React.FC<{
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  isDark?: boolean;
  helpText?: string;
  min?: number;
  max?: number;
}> = ({ label, value, onChange, type = 'text', placeholder, isDark = true, helpText, min, max }) => (
  <div>
    <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
      {label}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      className={`
        w-full px-3 py-2.5 rounded-lg border text-sm transition-all
        ${isDark
          ? 'bg-gray-800/70 border-gray-700 text-white placeholder-gray-500 focus:bg-gray-800'
          : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
        }
        focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500
      `}
    />
    {helpText && (
      <p className={`text-xs mt-1.5 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
        {helpText}
      </p>
    )}
  </div>
);

const FormTextarea: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  isDark?: boolean;
  helpText?: string;
  monospace?: boolean;
}> = ({ label, value, onChange, rows = 3, placeholder, isDark = true, helpText, monospace = false }) => (
  <div>
    <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
      {label}
    </label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className={`
        w-full px-3 py-2.5 rounded-lg border text-sm transition-all resize-none
        ${monospace ? 'font-mono' : ''}
        ${isDark
          ? 'bg-gray-800/70 border-gray-700 text-white placeholder-gray-500 focus:bg-gray-800'
          : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
        }
        focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500
      `}
    />
    {helpText && (
      <p className={`text-xs mt-1.5 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
        {helpText}
      </p>
    )}
  </div>
);

const FormSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  isDark?: boolean;
  helpText?: string;
}> = ({ label, value, onChange, options, isDark = true, helpText }) => (
  <div>
    <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
      {label}
    </label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`
        w-full px-3 py-2.5 rounded-lg border text-sm transition-all appearance-none cursor-pointer
        ${isDark
          ? 'bg-gray-800/70 border-gray-700 text-white focus:bg-gray-800'
          : 'bg-white border-gray-300 text-gray-900'
        }
        focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500
      `}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
        backgroundPosition: 'right 0.5rem center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '1.5em 1.5em',
        paddingRight: '2.5rem'
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    {helpText && (
      <p className={`text-xs mt-1.5 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
        {helpText}
      </p>
    )}
  </div>
);

export const NodePropertiesPanel: React.FC<NodePropertiesPanelProps> = ({
  node,
  onClose,
  onUpdate,
  onDelete,
  availableModels = [],
  availableTools = [],
  theme = 'dark',
}) => {
  const [nodeData, setNodeData] = useState<NodeData>(node?.data || {} as NodeData);
  const [hasChanges, setHasChanges] = useState(false);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);

  useEffect(() => {
    if (node?.data) {
      setNodeData(node.data);
      setHasChanges(false);
    }
  }, [node]);

  if (!node) return null;

  const isDark = theme === 'dark';

  const handleSave = () => {
    onUpdate(node.id, nodeData);
    setHasChanges(false);
    setShowSaveConfirmation(true);
    setTimeout(() => setShowSaveConfirmation(false), 2000);
  };

  const handleDelete = () => {
    if (confirm(`Delete node "${nodeData.label}"?`)) {
      onDelete(node.id);
      onClose();
    }
  };

  const updateData = (key: keyof NodeData, value: any) => {
    setNodeData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const renderTriggerConfig = () => (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Trigger Type
        </label>
        <select
          value={nodeData.triggerType || 'manual'}
          onChange={(e) => updateData('triggerType', e.target.value as any)}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          <option value="manual">Manual</option>
          <option value="schedule">Schedule (Cron)</option>
          <option value="chat_message">Chat Message</option>
          <option value="file_upload">File Upload</option>
          <option value="webhook">Webhook</option>
          <option value="admin_action">Admin Action</option>
        </select>
      </div>

      {nodeData.triggerType === 'schedule' && (
        <div>
          <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Cron Expression
          </label>
          <input
            type="text"
            value={nodeData.triggerConfig?.cron || ''}
            onChange={(e) => updateData('triggerConfig', { ...nodeData.triggerConfig, cron: e.target.value })}
            placeholder="0 */6 * * *"
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
            Example: 0 */6 * * * (every 6 hours)
          </p>
        </div>
      )}

      {nodeData.triggerType === 'chat_message' && (
        <div>
          <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Message Pattern (optional)
          </label>
          <input
            type="text"
            value={nodeData.triggerConfig?.messagePattern || ''}
            onChange={(e) => updateData('triggerConfig', { ...nodeData.triggerConfig, messagePattern: e.target.value })}
            placeholder="e.g., /workflow.*"
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>
      )}
    </div>
  );

  const renderMCPToolConfig = () => (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          MCP Tool
        </label>
        <select
          value={nodeData.toolName || ''}
          onChange={(e) => {
            const selectedTool = availableTools.find(t => t.name === e.target.value);
            updateData('toolName', e.target.value);
            if (selectedTool) {
              updateData('serverName', selectedTool.server);
            }
          }}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          <option value="">Select a tool...</option>
          {availableTools.map((tool) => (
            <option key={`${tool.server}-${tool.name}`} value={tool.name}>
              {tool.name} ({tool.server})
            </option>
          ))}
        </select>
        {nodeData.toolName && (
          <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
            Server: {nodeData.serverName}
          </p>
        )}
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Arguments (JSON)
        </label>
        <textarea
          value={JSON.stringify(nodeData.arguments || {}, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              updateData('arguments', parsed);
            } catch (err) {
              // Invalid JSON - still update to show user's edits
              updateData('arguments', e.target.value as any);
            }
          }}
          rows={6}
          className={`w-full px-3 py-2 rounded-lg border font-mono text-sm ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          placeholder='{}'
        />
      </div>
    </div>
  );

  const renderLLMConfig = () => (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Model
        </label>
        <select
          value={nodeData.model || ''}
          onChange={(e) => updateData('model', e.target.value)}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          <option value="">Select model...</option>
          {availableModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          System Prompt (optional)
        </label>
        <textarea
          value={nodeData.systemPrompt || ''}
          onChange={(e) => updateData('systemPrompt', e.target.value)}
          rows={3}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          placeholder="You are a helpful assistant..."
        />
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          User Prompt Template
        </label>
        <textarea
          value={nodeData.prompt || ''}
          onChange={(e) => updateData('prompt', e.target.value)}
          rows={4}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          placeholder="Use {{variable}} for input data..."
        />
        <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
          Use {'{{input}}'} to reference previous node output
        </p>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Temperature: {nodeData.temperature ?? 0.7}
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={nodeData.temperature ?? 0.7}
          onChange={(e) => updateData('temperature', parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Max Tokens
        </label>
        <input
          type="number"
          value={nodeData.maxTokens || 1000}
          onChange={(e) => updateData('maxTokens', parseInt(e.target.value))}
          min="1"
          max="32000"
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
      </div>
    </div>
  );

  const renderCodeConfig = () => (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Language
        </label>
        <select
          value={nodeData.language || 'javascript'}
          onChange={(e) => updateData('language', e.target.value as any)}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="bash">Bash</option>
        </select>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Code
        </label>
        <textarea
          value={nodeData.code || ''}
          onChange={(e) => updateData('code', e.target.value)}
          rows={12}
          className={`w-full px-3 py-2 rounded-lg border font-mono text-sm ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          placeholder={`// Access input data:\nconst input = $input;\n\n// Return output:\nreturn { result: input };`}
        />
        <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
          Use $input to access previous node's output
        </p>
      </div>
    </div>
  );

  const renderConditionConfig = () => (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Condition Expression
        </label>
        <input
          type="text"
          value={nodeData.condition || ''}
          onChange={(e) => updateData('condition', e.target.value)}
          placeholder="e.g., $input.value > 100"
          className={`w-full px-3 py-2 rounded-lg border font-mono ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Operator
        </label>
        <select
          value={nodeData.operator || 'equals'}
          onChange={(e) => updateData('operator', e.target.value as any)}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          <option value="equals">Equals</option>
          <option value="contains">Contains</option>
          <option value="greater_than">Greater Than</option>
          <option value="less_than">Less Than</option>
          <option value="regex">Regex Match</option>
        </select>
      </div>
    </div>
  );

  const renderTransformConfig = () => (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Transform Type
        </label>
        <select
          value={nodeData.transformType || 'map'}
          onChange={(e) => updateData('transformType', e.target.value as any)}
          className={`w-full px-3 py-2 rounded-lg border ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          <option value="map">Map</option>
          <option value="filter">Filter</option>
          <option value="reduce">Reduce</option>
          <option value="jsonpath">JSONPath</option>
        </select>
      </div>

      <div>
        <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Expression
        </label>
        <textarea
          value={nodeData.transformExpression || ''}
          onChange={(e) => updateData('transformExpression', e.target.value)}
          rows={4}
          className={`w-full px-3 py-2 rounded-lg border font-mono text-sm ${
            isDark
              ? 'bg-gray-800 border-gray-700 text-white'
              : 'bg-white border-gray-300 text-gray-900'
          } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          placeholder={nodeData.transformType === 'jsonpath' ? '$.data[*].name' : 'item => item.value * 2'}
        />
      </div>
    </div>
  );

  const renderNodeConfig = () => {
    switch (node.type) {
      case 'trigger':
        return renderTriggerConfig();
      case 'mcp_tool':
        return renderMCPToolConfig();
      case 'llm_completion':
        return renderLLMConfig();
      case 'code':
        return renderCodeConfig();
      case 'condition':
        return renderConditionConfig();
      case 'transform':
        return renderTransformConfig();
      case 'loop':
      case 'merge':
        return (
          <div className={`p-4 rounded-lg ${isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
            <p className="text-sm">
              This node type has no additional configuration options.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      className={`
        w-80 border-l overflow-y-auto
        ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}
      `}
    >
      <div className="sticky top-0 z-10 p-4 border-b"
        style={{
          backgroundColor: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
          borderColor: isDark ? 'rgb(31, 41, 55)' : 'rgb(229, 231, 235)'
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Node Properties
          </h3>
          <button
            onClick={onClose}
            className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className={`text-xs px-2 py-1 rounded ${isDark ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
          {node.type?.replace(/_/g, ' ').toUpperCase()}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Node Label */}
        <div>
          <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Label
          </label>
          <input
            type="text"
            value={nodeData.label || ''}
            onChange={(e) => updateData('label', e.target.value)}
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>

        {/* Node Description */}
        <div>
          <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Description (optional)
          </label>
          <textarea
            value={nodeData.description || ''}
            onChange={(e) => updateData('description', e.target.value)}
            rows={2}
            className={`w-full px-3 py-2 rounded-lg border ${
              isDark
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>

        {/* Node-specific config */}
        <div className="pt-4 border-t"
          style={{ borderColor: isDark ? 'rgb(31, 41, 55)' : 'rgb(229, 231, 235)' }}
        >
          <h4 className={`text-sm font-semibold mb-4 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Configuration
          </h4>
          {renderNodeConfig()}
        </div>

        {/* Action buttons */}
        <div className="pt-4 border-t space-y-2"
          style={{ borderColor: isDark ? 'rgb(31, 41, 55)' : 'rgb(229, 231, 235)' }}
        >
          <motion.button
            whileHover={hasChanges ? { scale: 1.02 } : {}}
            whileTap={hasChanges ? { scale: 0.98 } : {}}
            onClick={handleSave}
            disabled={!hasChanges}
            className={`
              w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200
              ${showSaveConfirmation
                ? 'bg-emerald-500 text-white'
                : hasChanges
                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            {showSaveConfirmation ? (
              <>
                <Check className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {hasChanges ? 'Save Changes' : 'No Changes'}
              </>
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleDelete}
            className={`
              w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200
              ${isDark
                ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30'
                : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
              }
            `}
          >
            <Trash2 className="w-4 h-4" />
            Delete Node
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};
