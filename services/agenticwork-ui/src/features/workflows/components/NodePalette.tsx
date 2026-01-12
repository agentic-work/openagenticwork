/**
 * Node Palette Component
 * Sidebar with available workflow nodes (n8n-style)
 */
/* eslint-disable no-restricted-syntax -- Workflow nodes use intentional category colors for visual distinction */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Wrench,
  Brain,
  Code,
  GitBranch,
  Search,
  ChevronDown,
  ChevronRight,
  Clock,
  MessageSquare,
  Upload,
  Globe,
  Database,
  Cloud,
  FileText,
  Terminal,
  Sparkles,
  Filter,
  type LucideIcon,
} from '@/shared/icons';

// Icon mapping for dynamic icon lookup
const iconMap: Record<string, LucideIcon> = {
  Zap,
  Wrench,
  Brain,
  Code,
  GitBranch,
  Search,
  Clock,
  MessageSquare,
  Upload,
  Globe,
  Database,
  Cloud,
  FileText,
  Terminal,
  Sparkles,
  Filter,
};

interface NodePaletteProps {
  mcpTools?: Array<{
    serverId: string;
    serverName: string;
    toolName: string;
    description?: string;
  }>;
  onNodeDragStart?: (event: React.DragEvent, nodeType: string, nodeData: any) => void;
  theme?: 'light' | 'dark';
}

const nodeCategories = [
  {
    id: 'triggers',
    label: 'Triggers',
    icon: Zap,
    color: '#a855f7',
    nodes: [
      {
        type: 'trigger',
        label: 'Manual Trigger',
        description: 'Start workflow manually',
        icon: 'Zap',
        triggerType: 'manual',
      },
      {
        type: 'trigger',
        label: 'Schedule',
        description: 'Run on a schedule',
        icon: 'Clock',
        triggerType: 'schedule',
      },
      {
        type: 'trigger',
        label: 'Chat Message',
        description: 'Trigger on chat message',
        icon: 'MessageSquare',
        triggerType: 'chat_message',
      },
      {
        type: 'trigger',
        label: 'File Upload',
        description: 'Trigger on file upload',
        icon: 'Upload',
        triggerType: 'file_upload',
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI & LLM',
    icon: Brain,
    color: '#6366f1',
    nodes: [
      {
        type: 'llm_completion',
        label: 'LLM Completion',
        description: 'Generate AI response',
        icon: 'Brain',
        color: '#6366f1',
      },
      {
        type: 'llm_completion',
        label: 'Summarization',
        description: 'Summarize content',
        icon: 'Sparkles',
        color: '#8b5cf6',
        preset: 'summarize',
      },
    ],
  },
  {
    id: 'logic',
    label: 'Logic & Control',
    icon: GitBranch,
    color: '#f59e0b',
    nodes: [
      {
        type: 'condition',
        label: 'If/Else',
        description: 'Conditional branching',
        icon: 'GitBranch',
        color: '#f59e0b',
      },
      {
        type: 'condition',
        label: 'Filter',
        description: 'Filter data',
        icon: 'Filter',
        color: '#fb923c',
      },
    ],
  },
  {
    id: 'code',
    label: 'Code',
    icon: Code,
    color: '#6b7280',
    nodes: [
      {
        type: 'code',
        label: 'JavaScript',
        description: 'Run custom JavaScript',
        icon: 'Code',
        language: 'javascript',
        color: '#f7df1e',
      },
      {
        type: 'code',
        label: 'Python',
        description: 'Run custom Python',
        icon: 'Code',
        language: 'python',
        color: '#3776ab',
      },
      {
        type: 'code',
        label: 'Shell Script',
        description: 'Run bash commands',
        icon: 'Terminal',
        language: 'bash',
        color: '#4eaa25',
      },
    ],
  },
];

export const NodePalette: React.FC<NodePaletteProps> = ({
  mcpTools = [],
  onNodeDragStart,
  theme = 'dark',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['triggers', 'mcp', 'ai', 'logic'])
  );

  // Build MCP Tools category
  const mcpCategory = useMemo(() => {
    const serverGroups: Record<string, any[]> = {};

    mcpTools.forEach((tool) => {
      if (!serverGroups[tool.serverId]) {
        serverGroups[tool.serverId] = [];
      }
      serverGroups[tool.serverId].push({
        type: 'mcp_tool',
        label: tool.toolName,
        description: tool.description || `${tool.serverName} tool`,
        icon: 'Wrench',
        color: '#06b6d4',
        toolName: tool.toolName,
        toolServer: tool.serverId,
        serverName: tool.serverName,
      });
    });

    return {
      id: 'mcp',
      label: 'MCP Tools',
      icon: Wrench,
      color: '#06b6d4',
      nodes: Object.values(serverGroups).flat(),
      serverGroups,
    };
  }, [mcpTools]);

  const allCategories = [
    ...nodeCategories,
    mcpCategory,
  ];

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return allCategories;

    return allCategories
      .map((category) => ({
        ...category,
        nodes: category.nodes.filter(
          (node) =>
            node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            node.description?.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      }))
      .filter((category) => category.nodes.length > 0);
  }, [searchQuery, allCategories]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const handleDragStart = (event: React.DragEvent, node: any) => {
    const nodeData = {
      type: node.type,
      data: {
        label: node.label,
        description: node.description,
        icon: node.icon,
        color: node.color,
        ...node,
      },
    };
    event.dataTransfer.setData('application/reactflow', JSON.stringify(nodeData));
    event.dataTransfer.effectAllowed = 'move';

    if (onNodeDragStart) {
      onNodeDragStart(event, node.type, nodeData.data);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div
      className={`
        w-80 h-full flex flex-col
        ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}
        border-r
      `}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white mb-3">Add Nodes</h2>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`
              w-full pl-10 pr-4 py-2 rounded-lg text-sm
              ${isDark
                ? 'bg-gray-800 text-white border-gray-700 placeholder-gray-500'
                : 'bg-gray-100 text-gray-900 border-gray-300 placeholder-gray-400'
              }
              border focus:outline-none focus:ring-2 focus:ring-blue-500/50
            `}
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredCategories.map((category) => {
          const isExpanded = expandedCategories.has(category.id);
          const CategoryIcon = category.icon;

          return (
            <div key={category.id} className="space-y-1">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-lg
                  transition-colors duration-150
                  ${isDark
                    ? 'hover:bg-gray-800 text-gray-300 hover:text-white'
                    : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
                  }
                `}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <CategoryIcon className="w-4 h-4" style={{ color: category.color }} />
                <span className="text-sm font-medium flex-1 text-left">
                  {category.label}
                </span>
                <span className="text-xs text-gray-500">
                  {category.nodes.length}
                </span>
              </button>

              {/* Nodes */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1 overflow-hidden"
                  >
                    {category.nodes.map((node, index) => (
                      <motion.div
                        key={`${node.type}-${node.label}-${index}`}
                        initial={{ x: -10, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: index * 0.05 }}
                        draggable
                        onDragStart={(e) => handleDragStart(e, node)}
                        className={`
                          ml-6 p-3 rounded-lg border cursor-move
                          transition-all duration-150
                          ${isDark
                            ? 'bg-gray-800/50 border-gray-700 hover:bg-gray-800 hover:border-gray-600'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                          }
                          hover:shadow-lg hover:scale-[1.02]
                        `}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center"
                            style={{ backgroundColor: `${node.color || category.color}30` }}
                          >
                            {React.createElement(
                              iconMap[node.icon] || Wrench,
                              {
                                className: 'w-4 h-4',
                                style: { color: node.color || category.color },
                              }
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-white truncate">
                              {node.label}
                            </div>
                            <div className="text-xs text-gray-400 line-clamp-2">
                              {node.description}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {filteredCategories.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No nodes found</p>
          </div>
        )}
      </div>
    </div>
  );
};
