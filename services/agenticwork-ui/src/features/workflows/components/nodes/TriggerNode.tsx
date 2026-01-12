/**
 * Trigger Node Component
 * Workflow starting point
 */
/* eslint-disable no-restricted-syntax -- Node category color for visual distinction */

import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { motion } from 'framer-motion';
import { Zap, Clock, MessageSquare, Upload, Globe } from '@/shared/icons';

const triggerIcons = {
  manual: Zap,
  schedule: Clock,
  chat_message: MessageSquare,
  file_upload: Upload,
  webhook: Globe,
};

export const TriggerNode: React.FC<NodeProps> = ({ data, selected }) => {
  const Icon = data.triggerType ? triggerIcons[data.triggerType as keyof typeof triggerIcons] : Zap;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.02 }}
      className={`
        relative min-w-[200px] rounded-lg shadow-lg
        transition-all duration-150
        bg-purple-900/80
        ${selected
          ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-gray-900'
          : 'ring-1 ring-purple-500'
        }
      `}
      style={{
        borderColor: '#a855f7',
        borderWidth: '2px',
        borderStyle: 'solid',
      }}
    >
      {/* Output Handle Only (triggers don't have inputs) */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-purple-500 border-2 border-gray-800"
      />

      {/* Node Content */}
      <div className="p-4">
        {/* Trigger Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 mb-3">
          <Zap className="w-3 h-3 text-purple-400" />
          <span className="text-xs font-medium text-purple-300">Trigger</span>
        </div>

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-purple-500/30">
            <Icon className="w-5 h-5 text-purple-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {data.label || 'Trigger'}
            </h3>
            {data.description && (
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                {data.description}
              </p>
            )}
          </div>
        </div>

        {/* Trigger Config Summary */}
        {data.triggerConfig && (
          <div className="mt-3 pt-3 border-t border-purple-500/20">
            {data.triggerConfig.cron && (
              <div className="text-xs text-purple-300">
                <span className="text-gray-400">Schedule:</span> {data.triggerConfig.cron}
              </div>
            )}
            {data.triggerConfig.messagePattern && (
              <div className="text-xs text-purple-300">
                <span className="text-gray-400">Pattern:</span> {data.triggerConfig.messagePattern}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pulse animation for visual appeal */}
      <div className="absolute inset-0 rounded-lg bg-purple-500/10 animate-pulse pointer-events-none" />
    </motion.div>
  );
};
