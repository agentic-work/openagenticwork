/**
 * Workflow Builder - Main Component
 * Full-featured workflow editor inspired by n8n
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Play,
  Save,
  Settings,
  Maximize2,
  Minimize2,
} from '@/shared/icons';

import { WorkflowCanvasWrapper } from './WorkflowCanvas';
import { NodePalette } from './NodePalette';
import { WorkflowDefinition } from '../types/workflow.types';

interface WorkflowBuilderProps {
  workflowId?: string;
  initialWorkflow?: WorkflowDefinition;
  mcpTools?: Array<{
    serverId: string;
    serverName: string;
    toolName: string;
    description?: string;
  }>;
  onSave?: (workflow: WorkflowDefinition) => Promise<void>;
  onExecute?: (workflow: WorkflowDefinition) => Promise<void>;
  onBack?: () => void;
  theme?: 'light' | 'dark';
}

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({
  workflowId,
  initialWorkflow,
  mcpTools = [],
  onSave,
  onExecute,
  onBack,
  theme = 'dark',
}) => {
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(
    initialWorkflow || {
      nodes: [],
      edges: [],
    }
  );
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [executionState, setExecutionState] = useState<any>(null);

  const handleWorkflowChange = useCallback((newDefinition: WorkflowDefinition) => {
    setWorkflow(newDefinition);
  }, []);

  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setIsSaving(true);
    try {
      await onSave(workflow);
      // Show success notification
    } catch (error) {
      console.error('Failed to save workflow:', error);
      // Show error notification
    } finally {
      setIsSaving(false);
    }
  }, [workflow, onSave]);

  const handleExecute = useCallback(async () => {
    if (!onExecute) return;

    setIsExecuting(true);
    setExecutionState({
      isExecuting: true,
      currentNodeId: undefined,
      completedNodes: new Set(),
      failedNodes: new Set(),
    });

    try {
      await onExecute(workflow);
      // Update execution state based on results
    } catch (error) {
      console.error('Workflow execution failed:', error);
    } finally {
      setIsExecuting(false);
      setExecutionState(null);
    }
  }, [workflow, onExecute]);

  const isDark = theme === 'dark';

  return (
    <div
      className={`
        w-full h-screen flex flex-col
        ${isDark ? 'bg-gray-950' : 'bg-gray-50'}
      `}
    >
      {/* Work in Progress Notice */}
      <div
        className={`
          px-6 py-3 border-b
          ${isDark ? 'bg-amber-950/80 border-amber-800/50' : 'bg-amber-50 border-amber-200'}
        `}
      >
        <div className="flex items-center gap-3">
          <div className={`
            w-2 h-2 rounded-full animate-pulse
            ${isDark ? 'bg-amber-400' : 'bg-amber-500'}
          `}></div>
          <p className={`text-sm font-medium ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>
            ⚠️ Workflows are currently under development and will be available soon
          </p>
        </div>
      </div>

      {/* Header */}
      <div
        className={`
          h-16 flex items-center justify-between px-6 border-b
          ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}
        `}
      >
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              onClick={onBack}
              className={`
                p-2 rounded-lg transition-colors
                ${isDark
                  ? 'hover:bg-gray-800 text-gray-400 hover:text-white'
                  : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
                }
              `}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div>
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className={`
                text-lg font-semibold bg-transparent border-none outline-none
                ${isDark ? 'text-white' : 'text-gray-900'}
                hover:bg-gray-800/50 px-2 py-1 rounded
              `}
            />
            <div className="text-xs text-gray-500 px-2">
              {workflow.nodes.length} nodes • {workflow.edges.length} connections
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowPalette(!showPalette)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium
              ${isDark
                ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }
              transition-colors
            `}
          >
            {showPalette ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {showPalette ? 'Hide' : 'Show'} Palette
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleExecute}
            disabled={isExecuting || workflow.nodes.length === 0}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium
              ${isExecuting || workflow.nodes.length === 0
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700'
              }
              shadow-lg transition-all
            `}
          >
            <Play className="w-4 h-4" />
            {isExecuting ? 'Executing...' : 'Execute'}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSave}
            disabled={isSaving}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium
              bg-blue-500/20 text-blue-400 hover:bg-blue-500/30
              shadow-lg transition-all duration-150
              ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save'}
          </motion.button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Node Palette */}
        <AnimatePresence>
          {showPalette && (
            <motion.div
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <NodePalette mcpTools={mcpTools} theme={theme} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Canvas */}
        <div className="flex-1 relative">
          <WorkflowCanvasWrapper
            workflow={workflow}
            onChange={handleWorkflowChange}
            onExecute={handleExecute}
            onSave={handleSave}
            theme={theme}
            executionState={executionState}
          />
        </div>
      </div>
    </div>
  );
};
