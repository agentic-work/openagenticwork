/**
 * Node Type Configurations
 * Defines all available node types for the workflow builder
 * Professional Flowise-quality styling with rich icons and colors
 */
/* eslint-disable no-restricted-syntax -- Node type colors are intentional category indicators */

import { NodeTypeConfig } from '../types/workflow.types';

export const nodeTypeConfigs: Record<string, NodeTypeConfig> = {
  trigger: {
    type: 'trigger',
    label: 'Trigger',
    description: 'Start workflow execution on an event',
    icon: '⚡',
    color: '#f59e0b',
    gradient: 'from-amber-500 to-orange-500',
    category: 'trigger',
    defaultData: {
      label: 'Trigger',
      triggerType: 'manual',
      triggerConfig: {},
    },
  },
  llm_completion: {
    type: 'llm_completion',
    label: 'LLM Completion',
    description: 'Generate text using a language model',
    icon: '🧠',
    color: '#8b5cf6',
    gradient: 'from-purple-500 to-violet-600',
    category: 'ai',
    defaultData: {
      label: 'LLM',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 2000,
      prompt: '',
      systemPrompt: '',
    },
  },
  mcp_tool: {
    type: 'mcp_tool',
    label: 'MCP Tool',
    description: 'Execute an MCP tool',
    icon: '🔧',
    color: '#3b82f6',
    gradient: 'from-blue-500 to-cyan-500',
    category: 'action',
    defaultData: {
      label: 'MCP Tool',
      toolName: '',
      toolServer: '',
      arguments: {},
    },
  },
  code: {
    type: 'code',
    label: 'Code',
    description: 'Run custom JavaScript/Python code',
    icon: '💻',
    color: '#10b981',
    gradient: 'from-emerald-500 to-teal-500',
    category: 'action',
    defaultData: {
      label: 'Code',
      code: '',
      language: 'javascript',
    },
  },
  condition: {
    type: 'condition',
    label: 'Condition',
    description: 'Branch workflow based on a condition',
    icon: '🔀',
    color: '#ec4899',
    gradient: 'from-pink-500 to-rose-500',
    category: 'logic',
    defaultData: {
      label: 'Condition',
      condition: '',
      operator: 'equals',
    },
  },
  loop: {
    type: 'loop',
    label: 'Loop',
    description: 'Iterate over items',
    icon: '🔁',
    color: '#06b6d4',
    gradient: 'from-cyan-500 to-blue-500',
    category: 'logic',
    defaultData: {
      label: 'Loop',
    },
  },
  transform: {
    type: 'transform',
    label: 'Transform',
    description: 'Transform data (map, filter, reduce)',
    icon: '🔄',
    color: '#f97316',
    gradient: 'from-orange-500 to-red-500',
    category: 'data',
    defaultData: {
      label: 'Transform',
      transformType: 'map',
      transformExpression: '',
    },
  },
  merge: {
    type: 'merge',
    label: 'Merge',
    description: 'Combine multiple inputs',
    icon: '⛙',
    color: '#84cc16',
    gradient: 'from-lime-500 to-green-500',
    category: 'data',
    defaultData: {
      label: 'Merge',
    },
  },
};
