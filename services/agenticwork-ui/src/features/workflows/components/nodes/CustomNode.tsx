/**
 * Custom Node Component
 * Professional node component inspired by Flowise's polished design
 * Features: Smooth animations, professional shadows, category colors, hover states
 */
/* eslint-disable no-restricted-syntax -- Workflow node styling uses intentional colors for visual hierarchy */

import React, { memo, useState } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Settings, Trash2, Copy, Info } from '@/shared/icons';

export const CustomNode = memo(({ data, selected }: NodeProps) => {
  const isDark = true; // Use theme context in production
  const [isHovered, setIsHovered] = useState(false);

  // Get border color based on state (Flowise-inspired)
  const getBorderColor = () => {
    if (selected) return data.color || '#3b82f6';
    if (isDark) return 'rgba(255, 255, 255, 0.1)';
    return 'rgba(0, 0, 0, 0.15)';
  };

  return (
    <div
      className="workflow-node-wrapper"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: '320px',
        position: 'relative',
      }}
    >
      <div
        className={`
          rounded-2xl transition-all duration-150 relative overflow-hidden
          ${isDark ? 'bg-gray-800' : 'bg-white'}
        `}
        style={{
          border: `2px solid ${getBorderColor()}`,
          borderLeftWidth: '5px',
          borderLeftColor: data.color || '#6b7280',
          boxShadow: selected
            ? `0 0 0 3px ${data.color || '#3b82f6'}40, 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.3)`
            : isHovered
            ? '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)'
            : '0 4px 6px -1px rgba(0, 0, 0, 0.15), 0 2px 4px -1px rgba(0, 0, 0, 0.1)',
          transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
        }}
      >
        {/* Gradient overlay for depth */}
        <div
          className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-150 ease-out pointer-events-none"
          style={{
            background: `radial-gradient(circle at top, ${data.color || '#6b7280'}15, transparent 60%)`,
          }}
        />

        {/* Input Handle - Enhanced */}
        <Handle
          type="target"
          position={Position.Left}
          className="workflow-handle workflow-handle-input"
          style={{
            left: -8,
            width: 16,
            height: 16,
            backgroundColor: '#6366f1',
            border: '3px solid white',
            boxShadow: '0 4px 8px rgba(99, 102, 241, 0.4)',
            transition: 'all 0.2s ease',
          }}
        />

        {/* Node Header - Icon + Title - Enhanced */}
        <div className={`p-4 relative ${isDark ? '' : 'border-b border-gray-100/50'}`}>
          <div className="flex items-center gap-3">
            {/* Professional Icon Badge */}
            <div
              className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all duration-150 ease-out relative"
              style={{
                background: isDark
                  ? `linear-gradient(135deg, ${data.color || '#6b7280'}35, ${data.color || '#6b7280'}20)`
                  : `linear-gradient(135deg, ${data.color || '#6b7280'}25, ${data.color || '#6b7280'}10)`,
                border: `2px solid ${(data.color || '#6b7280')}50`,
                boxShadow: `0 4px 12px ${(data.color || '#6b7280')}25`,
                transform: isHovered ? 'scale(1.08) rotate(2deg)' : 'scale(1) rotate(0deg)',
              }}
            >
              <span className="relative z-10 drop-shadow-sm">{data.icon || '📦'}</span>
              {/* Shine effect on hover */}
              <div
                className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-150 ease-out"
                style={{
                  background: `linear-gradient(135deg, transparent 0%, ${data.color || '#6b7280'}40 100%)`,
                  opacity: isHovered ? 0.3 : 0,
                }}
              />
            </div>

            {/* Title & Description */}
            <div className="flex-1 min-w-0">
              <div
                className={`font-bold text-base truncate ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}
                style={{
                  textShadow: isDark ? '0 1px 2px rgba(0, 0, 0, 0.5)' : 'none',
                }}
              >
                {data.label || 'Node'}
              </div>
              {data.description && (
                <div
                  className={`text-xs mt-0.5 truncate ${
                    isDark ? 'text-gray-400' : 'text-gray-500'
                  }`}
                >
                  {data.description}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Node Content - Configuration Details - Enhanced */}
        {(data.triggerType || data.model || data.toolName || data.language || data.operator || data.transformType) && (
          <>
            <div className={`px-4 py-2.5 border-b relative ${isDark ? 'bg-gray-900/30 border-gray-700/50' : 'bg-gray-100/50 border-gray-200/50'}`}>
              <div className={`text-xs font-bold ${isDark ? 'text-gray-300' : 'text-gray-700'} uppercase tracking-wide flex items-center gap-2`}>
                <div className="w-1 h-4 rounded-full" style={{ backgroundColor: data.color || '#6b7280' }} />
                Configuration
              </div>
            </div>
            <div className="px-4 py-3 space-y-2 relative">
              {/* Trigger Type */}
              {data.triggerType && (
                <div className="flex items-center justify-between text-xs group">
                  <span className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Type</span>
                  <span
                    className={`font-bold px-3 py-1 rounded-lg border-2 transition-all duration-200 ${
                      isDark ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-200'
                    } group-hover:scale-105`}
                  >
                    {data.triggerType}
                  </span>
                </div>
              )}

              {/* LLM Model */}
              {data.model && (
                <div className="flex items-center justify-between text-xs group">
                  <span className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Model</span>
                  <span className={`font-bold px-3 py-1 rounded-lg border-2 transition-all duration-150 ease-out ${isDark ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' : 'bg-blue-50 text-blue-700 border-blue-200'} truncate max-w-[180px] group-hover:scale-105`}>
                    {data.model}
                  </span>
                </div>
              )}

              {/* MCP Tool */}
              {data.toolName && (
                <div className="flex items-center justify-between text-xs group">
                  <span className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Tool</span>
                  <span className={`font-bold px-3 py-1 rounded-lg border-2 transition-all duration-150 ease-out ${isDark ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200'} truncate max-w-[180px] group-hover:scale-105`}>
                    {data.toolName}
                  </span>
                </div>
              )}

              {/* Code Language */}
              {data.language && (
                <div className="flex items-center justify-between text-xs group">
                  <span className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Language</span>
                  <span
                    className={`font-bold px-3 py-1 rounded-lg border-2 transition-all duration-200 ${
                      isDark ? 'bg-orange-500/20 text-orange-300 border-orange-500/30' : 'bg-orange-50 text-orange-700 border-orange-200'
                    } group-hover:scale-105`}
                  >
                    {data.language}
                  </span>
                </div>
              )}

              {/* Condition Operator */}
              {data.operator && (
                <div className="flex items-center justify-between text-xs group">
                  <span className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Operator</span>
                  <span
                    className={`font-bold px-3 py-1 rounded-lg border-2 transition-all duration-200 ${
                      isDark ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-amber-50 text-amber-700 border-amber-200'
                    } group-hover:scale-105`}
                  >
                    {data.operator}
                  </span>
                </div>
              )}

              {/* Transform Type */}
              {data.transformType && (
                <div className="flex items-center justify-between text-xs group">
                  <span className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Type</span>
                  <span
                    className={`font-bold px-3 py-1 rounded-lg border-2 transition-all duration-200 ${
                      isDark ? 'bg-teal-500/20 text-teal-300 border-teal-500/30' : 'bg-teal-50 text-teal-700 border-teal-200'
                    } group-hover:scale-105`}
                  >
                    {data.transformType}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty State - Enhanced */}
        {!data.triggerType && !data.model && !data.toolName && !data.language && !data.operator && !data.transformType && (
          <div className={`px-4 py-6 text-center relative ${isDark ? 'bg-gray-900/20' : 'bg-gray-100/30'}`}>
            <div className="relative inline-block">
              <Settings className={`w-8 h-8 mx-auto mb-2 opacity-30 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
              <div className={`text-xs font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Click to configure
              </div>
            </div>
          </div>
        )}

        {/* Output Handle - Enhanced */}
        <Handle
          type="source"
          position={Position.Right}
          className="workflow-handle workflow-handle-output"
          style={{
            right: -8,
            width: 16,
            height: 16,
            backgroundColor: '#10b981',
            border: '3px solid white',
            boxShadow: '0 4px 8px rgba(16, 185, 129, 0.4)',
            transition: 'all 0.2s ease',
          }}
        />

        {/* Conditional outputs for condition nodes */}
        {data.operator && (
          <>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              className="workflow-handle workflow-handle-output"
              style={{
                right: -6,
                top: '40%',
                width: 12,
                height: 12,
                backgroundColor: '#10b981',
                border: '2px solid white',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              }}
            />
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              className="workflow-handle workflow-handle-output"
              style={{
                right: -6,
                top: '60%',
                width: 12,
                height: 12,
                backgroundColor: '#ef4444',
                border: '2px solid white',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
              }}
            />
          </>
        )}
      </div>

      {/* Flowise-style Hover Toolbar - Enhanced */}
      {(selected || isHovered) && (
        <motion.div
          initial={{ opacity: 0, x: -15 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -15 }}
          className="absolute -right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-20"
        >
          <motion.button
            whileHover={{ scale: 1.15, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
            className={`w-10 h-10 rounded-xl shadow-2xl flex items-center justify-center transition-all duration-200
              ${isDark ? 'bg-gradient-to-br from-gray-700 to-gray-800' : 'bg-gradient-to-br from-white to-gray-50'}
              ${isDark ? 'text-gray-300 hover:text-blue-400' : 'text-gray-600 hover:text-blue-600'}
              border-2 ${isDark ? 'border-gray-600 hover:border-blue-500/50' : 'border-gray-200 hover:border-blue-400/50'}
            `}
            style={{
              boxShadow: isDark
                ? '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)'
                : '0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1)',
            }}
            title="Info"
            onClick={(e) => e.stopPropagation()}
          >
            <Info className="w-4.5 h-4.5" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.15, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
            className={`w-10 h-10 rounded-xl shadow-2xl flex items-center justify-center transition-all duration-200
              ${isDark ? 'bg-gradient-to-br from-gray-700 to-gray-800' : 'bg-gradient-to-br from-white to-gray-50'}
              ${isDark ? 'text-gray-300 hover:text-purple-400' : 'text-gray-600 hover:text-purple-600'}
              border-2 ${isDark ? 'border-gray-600 hover:border-purple-500/50' : 'border-gray-200 hover:border-purple-400/50'}
            `}
            style={{
              boxShadow: isDark
                ? '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)'
                : '0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1)',
            }}
            title="Duplicate"
            onClick={(e) => e.stopPropagation()}
          >
            <Copy className="w-4.5 h-4.5" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.15, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
            className={`w-10 h-10 rounded-xl shadow-2xl flex items-center justify-center transition-all duration-200
              ${isDark ? 'bg-gradient-to-br from-red-600/20 to-red-700/20 hover:from-red-600 hover:to-red-700' : 'bg-gradient-to-br from-white to-gray-50 hover:from-red-50 hover:to-red-100'}
              ${isDark ? 'text-red-400 hover:text-white' : 'text-red-500 hover:text-red-700'}
              border-2 ${isDark ? 'border-red-500/40 hover:border-red-500' : 'border-red-200 hover:border-red-400'}
            `}
            style={{
              boxShadow: isDark
                ? '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)'
                : '0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1)',
            }}
            title="Delete"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 className="w-4.5 h-4.5" />
          </motion.button>
        </motion.div>
      )}
    </div>
  );
});

CustomNode.displayName = 'CustomNode';
