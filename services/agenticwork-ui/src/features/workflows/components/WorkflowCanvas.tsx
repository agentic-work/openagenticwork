/**
 * Workflow Canvas Component
 * Visual workflow builder inspired by n8n
 * Uses ReactFlow for node-based editing
 */

import React, { useCallback, useRef, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Connection,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  BackgroundVariant,
  Panel,
  ReactFlowProvider,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Save,
  Download,
  Upload,
  Trash2,
  Zap,
  Settings,
  AlertCircle,
  CheckCircle,
} from '@/shared/icons';

import { WorkflowNode as WFNode, WorkflowEdge, WorkflowDefinition } from '../types/workflow.types';
import { CustomNode } from './nodes/CustomNode';
import { TriggerNode } from './nodes/TriggerNode';
import { MCPToolNode } from './nodes/MCPToolNode';
import { LLMNode } from './nodes/LLMNode';
import { CodeNode } from './nodes/CodeNode';
import { ConditionNode } from './nodes/ConditionNode';

const nodeTypes = {
  trigger: TriggerNode,
  mcp_tool: MCPToolNode,
  llm_completion: LLMNode,
  code: CodeNode,
  condition: ConditionNode,
  default: CustomNode,
};

interface WorkflowCanvasProps {
  workflow?: WorkflowDefinition;
  onChange?: (definition: WorkflowDefinition) => void;
  onExecute?: () => void;
  onSave?: () => void;
  theme?: 'light' | 'dark';
  readOnly?: boolean;
  executionState?: {
    isExecuting: boolean;
    currentNodeId?: string;
    completedNodes?: Set<string>;
    failedNodes?: Set<string>;
  };
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  workflow,
  onChange,
  onExecute,
  onSave,
  theme = 'dark',
  readOnly = false,
  executionState,
}) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(workflow?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(workflow?.edges || []);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Handle connection between nodes
  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        ...params,
        id: `edge-${params.source}-${params.target}`,
        type: 'default',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
      };
      setEdges((eds) => addEdge(newEdge as Edge, eds));

      if (onChange) {
        onChange({
          nodes,
          edges: addEdge(newEdge as Edge, edges),
          viewport: reactFlowInstance?.getViewport(),
        });
      }
    },
    [edges, nodes, onChange, reactFlowInstance, setEdges]
  );

  // Handle drag over for dropping new nodes
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle drop to create new node
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!reactFlowWrapper.current || !reactFlowInstance) return;

      const nodeData = event.dataTransfer.getData('application/reactflow');
      if (!nodeData) return;

      const { type, data } = JSON.parse(nodeData);
      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data,
      };

      setNodes((nds) => nds.concat(newNode));

      if (onChange) {
        onChange({
          nodes: [...nodes, newNode],
          edges,
          viewport: reactFlowInstance.getViewport(),
        });
      }
    },
    [reactFlowInstance, nodes, edges, onChange, setNodes]
  );

  // Handle node selection
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Handle node deletion
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (onChange) {
        onChange({
          nodes: nodes.filter((n) => !deleted.find((d) => d.id === n.id)),
          edges,
          viewport: reactFlowInstance?.getViewport(),
        });
      }
    },
    [nodes, edges, onChange, reactFlowInstance]
  );

  // Update execution state visually on nodes
  React.useEffect(() => {
    if (!executionState) return;

    setNodes((nds) =>
      nds.map((node) => {
        let className = '';
        if (executionState.currentNodeId === node.id) {
          className = 'executing';
        } else if (executionState.completedNodes?.has(node.id)) {
          className = 'completed';
        } else if (executionState.failedNodes?.has(node.id)) {
          className = 'failed';
        }

        return {
          ...node,
          className,
        };
      })
    );
  }, [executionState, setNodes]);

  const isDarkMode = theme === 'dark';

  return (
    <div className="w-full h-full relative" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onNodesDelete={onNodesDelete}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        attributionPosition="bottom-right"
        className={isDarkMode ? 'dark-theme' : 'light-theme'}
        deleteKeyCode="Delete"
        multiSelectionKeyCode="Shift"
        style={{
          background: isDarkMode ? '#0e0918' : '#f8f9fa',
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color={isDarkMode ? '#2a2438' : '#ddd'}
        />
        <Controls
          className={`${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} rounded-lg shadow-lg`}
        />
        <MiniMap
          nodeColor={(node) => {
            if (executionState?.currentNodeId === node.id) return '#f59e0b';
            if (executionState?.completedNodes?.has(node.id)) return '#10b981';
            if (executionState?.failedNodes?.has(node.id)) return '#ef4444';
            return isDarkMode ? '#4b5563' : '#9ca3af';
          }}
          className={`${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white/50 border-gray-300'} rounded-lg`}
          maskColor={isDarkMode ? 'rgb(14, 9, 24, 0.6)' : 'rgb(248, 249, 250, 0.6)'}
        />

        {/* Toolbar Panel */}
        <Panel position="top-right" className="space-x-2 flex items-center">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onExecute}
            disabled={readOnly || executionState?.isExecuting}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium
              ${executionState?.isExecuting
                ? 'bg-amber-500/20 text-amber-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700'
              }
              shadow-lg transition-all duration-200
            `}
          >
            {executionState?.isExecuting ? (
              <>
                <Zap className="w-4 h-4 animate-pulse" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Execute
              </>
            )}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onSave}
            disabled={readOnly}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium
              bg-blue-500/20 text-blue-400 hover:bg-blue-500/30
              shadow-lg transition-all duration-150
              ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <Save className="w-4 h-4" />
            Save
          </motion.button>
        </Panel>

        {/* Validation Warnings Panel */}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-amber-500/20 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center gap-2 text-amber-300"
            >
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">
                Start building your workflow by dragging nodes from the palette
              </span>
            </motion.div>
          </Panel>
        )}
      </ReactFlow>

      {/* Custom styles for node execution states */}
      <style>{`
        .react-flow__node.executing {
          animation: pulse-border 2s ease-in-out infinite;
          box-shadow: 0 0 20px rgba(245, 158, 11, 0.5);
        }

        .react-flow__node.completed {
          border-color: #10b981;
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.3);
        }

        .react-flow__node.failed {
          border-color: #ef4444;
          box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);
          animation: shake 0.5s;
        }

        @keyframes pulse-border {
          0%, 100% { border-color: #f59e0b; }
          50% { border-color: #fbbf24; }
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }

        .dark-theme .react-flow__edge-path {
          stroke: #6366f1;
          stroke-width: 2;
        }

        .dark-theme .react-flow__edge.animated path {
          stroke: #818cf8;
        }

        .light-theme .react-flow__edge-path {
          stroke: #4f46e5;
          stroke-width: 2;
        }
      `}</style>
    </div>
  );
};

// Wrapper with ReactFlowProvider
export const WorkflowCanvasWrapper: React.FC<WorkflowCanvasProps> = (props) => {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas {...props} />
    </ReactFlowProvider>
  );
};
