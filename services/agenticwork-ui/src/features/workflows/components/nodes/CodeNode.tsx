/**
 * Code Node Component
 * Custom code execution node
 */
/* eslint-disable no-restricted-syntax -- Language-specific colors for code node visualization */

import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { motion } from 'framer-motion';
import { Code, Terminal } from '@/shared/icons';

export const CodeNode: React.FC<NodeProps> = ({ data, selected }) => {
  const languageColors = {
    javascript: '#f7df1e',
    python: '#3776ab',
    bash: '#4eaa25',
  };

  const bgColor = data.language
    ? languageColors[data.language as keyof typeof languageColors]
    : '#6b7280';

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.02 }}
      className={`
        relative min-w-[220px] rounded-lg shadow-lg
        transition-all duration-150
        bg-gray-800
        ${selected
          ? 'ring-2 ring-gray-400 ring-offset-2 ring-offset-gray-900'
          : 'ring-1 ring-gray-600/50'
        }
      `}
      style={{
        borderColor: bgColor,
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
        {/* Code Badge */}
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border mb-3"
          style={{
            backgroundColor: `${bgColor}20`,
            borderColor: `${bgColor}30`
          }}
        >
          <Terminal className="w-3 h-3" style={{ color: bgColor }} />
          <span className="text-xs font-medium" style={{ color: bgColor }}>
            {data.language || 'Code'}
          </span>
        </div>

        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${bgColor}30` }}
          >
            <Code className="w-5 h-5" style={{ color: bgColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {data.label || 'Code Execution'}
            </h3>
            {data.description && (
              <p className="text-xs text-gray-400 mt-0.5">
                {data.description}
              </p>
            )}
          </div>
        </div>

        {/* Code Preview */}
        {data.code && (
          <div className="mt-3 pt-3 border-t border-gray-600/20">
            <div className="text-xs text-gray-400 mb-1">Code:</div>
            <div className="text-xs text-gray-200 bg-gray-950/50 rounded p-2 font-mono overflow-hidden">
              <div className="line-clamp-3">
                {data.code}
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {data.code.split('\n').length} lines
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
