/**
 * Condition Node Component
 * Conditional branching logic
 */
/* eslint-disable no-restricted-syntax -- Node category color for visual distinction */

import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { motion } from 'framer-motion';
import { GitBranch, CheckCircle, XCircle } from '@/shared/icons';

export const ConditionNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.02 }}
      className={`
        relative min-w-[200px] rounded-lg shadow-lg
        transition-all duration-150
        bg-amber-900/80
        ${selected
          ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-gray-900'
          : 'ring-1 ring-amber-600/50'
        }
      `}
      style={{
        borderColor: '#f59e0b',
        borderWidth: '2px',
        borderStyle: 'solid',
      }}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-blue-500 border-2 border-gray-800"
      />

      <div className="p-4">
        {/* Logic Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 mb-3">
          <GitBranch className="w-3 h-3 text-amber-400" />
          <span className="text-xs font-medium text-amber-300">Condition</span>
        </div>

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amber-500/30">
            <GitBranch className="w-5 h-5 text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {data.label || 'If/Else'}
            </h3>
            {data.description && (
              <p className="text-xs text-gray-400 mt-0.5">
                {data.description}
              </p>
            )}
          </div>
        </div>

        {/* Condition Preview */}
        {data.condition && (
          <div className="mt-3 pt-3 border-t border-amber-500/20">
            <div className="text-xs text-gray-400 mb-1">Condition:</div>
            <div className="text-xs text-amber-200 bg-amber-950/30 rounded p-2 font-mono">
              {data.condition}
            </div>
          </div>
        )}
      </div>

      {/* Output Handles - True/False */}
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        className="w-3 h-3 !bg-emerald-500 border-2 border-gray-800"
        style={{ top: '35%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        className="w-3 h-3 !bg-red-500 border-2 border-gray-800"
        style={{ top: '65%' }}
      />

      {/* Output Labels */}
      <div className="absolute -right-12 top-[35%] transform -translate-y-1/2">
        <div className="flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle className="w-3 h-3" />
          <span>True</span>
        </div>
      </div>
      <div className="absolute -right-12 top-[65%] transform -translate-y-1/2">
        <div className="flex items-center gap-1 text-xs text-red-400">
          <XCircle className="w-3 h-3" />
          <span>False</span>
        </div>
      </div>
    </motion.div>
  );
};
