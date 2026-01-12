/**
 * LLM Node Component
 * AI completion node for workflows
 */
/* eslint-disable no-restricted-syntax -- Node category color for visual distinction */

import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { motion } from 'framer-motion';
import { Brain, Sparkles } from '@/shared/icons';

export const LLMNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.02 }}
      className={`
        relative min-w-[220px] rounded-lg shadow-lg
        transition-all duration-150
        bg-indigo-900/80
        ${selected
          ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-gray-900'
          : 'ring-1 ring-indigo-600/50'
        }
      `}
      style={{
        borderColor: '#6366f1',
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
        {/* AI Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 mb-3">
          <Sparkles className="w-3 h-3 text-indigo-400" />
          <span className="text-xs font-medium text-indigo-300">AI</span>
        </div>

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-indigo-500/30">
            <Brain className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {data.label || 'LLM Completion'}
            </h3>
            {data.model && (
              <p className="text-xs text-gray-400 mt-0.5">
                {data.model}
              </p>
            )}
          </div>
        </div>

        {/* Prompt Preview */}
        {data.prompt && (
          <div className="mt-3 pt-3 border-t border-indigo-500/20">
            <div className="text-xs text-gray-400 mb-1">Prompt:</div>
            <div className="text-xs text-indigo-200 line-clamp-3 bg-indigo-950/30 rounded p-2 font-mono">
              {data.prompt}
            </div>
          </div>
        )}

        {/* Settings */}
        {(data.temperature !== undefined || data.maxTokens) && (
          <div className="mt-2 flex gap-3 text-xs text-gray-400">
            {data.temperature !== undefined && (
              <div>
                <span className="text-gray-500">Temp:</span>{' '}
                <span className="text-indigo-300">{data.temperature}</span>
              </div>
            )}
            {data.maxTokens && (
              <div>
                <span className="text-gray-500">Tokens:</span>{' '}
                <span className="text-indigo-300">{data.maxTokens}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-emerald-500 border-2 border-gray-800"
      />

      {/* Sparkle effect */}
      <div className="absolute -top-1 -right-1 w-4 h-4">
        <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
      </div>
    </motion.div>
  );
};
