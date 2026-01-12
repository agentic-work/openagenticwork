/**
 * MCP Tool Node Component
 * Represents an MCP tool execution in the workflow
 */
/* eslint-disable no-restricted-syntax -- Node category color for visual distinction */

import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { motion } from 'framer-motion';
import { Wrench, Database, Cloud, FileText, Terminal, Globe } from '@/shared/icons';

const serverIcons = {
  'admin-mcp': Wrench,
  'memory-mcp': Database,
  'azure-mcp': Cloud,
  'filesystem-mcp': FileText,
  'mcp-shell': Terminal,
  'brave-search-mcp': Globe,
};

export const MCPToolNode: React.FC<NodeProps> = ({ data, selected }) => {
  const Icon = data.toolServer
    ? serverIcons[data.toolServer as keyof typeof serverIcons] || Wrench
    : Wrench;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.02 }}
      className={`
        relative min-w-[220px] rounded-lg shadow-lg
        transition-all duration-150
        bg-cyan-900/80
        ${selected
          ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-900'
          : 'ring-1 ring-cyan-600/50'
        }
      `}
      style={{
        borderColor: '#06b6d4',
        borderWidth: '2px',
        borderStyle: 'solid',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-blue-500 border-2 border-gray-800"
      />

      <div className="p-4">
        {/* MCP Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/30 mb-3">
          <Wrench className="w-3 h-3 text-cyan-400" />
          <span className="text-xs font-medium text-cyan-300">MCP Tool</span>
        </div>

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-cyan-500/30">
            <Icon className="w-5 h-5 text-cyan-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">
              {data.toolName || 'MCP Tool'}
            </h3>
            {data.serverName && (
              <p className="text-xs text-gray-400 mt-0.5">
                {data.serverName}
              </p>
            )}
          </div>
        </div>

        {/* Arguments Preview */}
        {data.arguments && Object.keys(data.arguments).length > 0 && (
          <div className="mt-3 pt-3 border-t border-cyan-500/20">
            <div className="flex items-center gap-1.5 text-xs text-cyan-300 mb-1.5">
              <span className="text-gray-400">Arguments:</span>
              <span className="text-cyan-400 font-mono">
                {Object.keys(data.arguments).length}
              </span>
            </div>
            <div className="space-y-1">
              {Object.entries(data.arguments).slice(0, 2).map(([key, value]) => (
                <div key={key} className="text-xs text-gray-400 truncate">
                  <span className="text-cyan-400">{key}:</span>{' '}
                  <span className="text-gray-300">{String(value)}</span>
                </div>
              ))}
              {Object.keys(data.arguments).length > 2 && (
                <div className="text-xs text-gray-500">
                  +{Object.keys(data.arguments).length - 2} more...
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-emerald-500 border-2 border-gray-800"
      />
    </motion.div>
  );
};
