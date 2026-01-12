/**
 * Workflows Container - Main Workflow Canvas
 * Professional Flowise-inspired drag-and-drop workflow builder using ReactFlow 11
 * Enhanced with custom styling, animations, and micro-interactions
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
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
  NodeChange,
  EdgeChange,
  OnNodesChange,
  OnEdgesChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import '../styles/workflow-canvas.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Save,
  ArrowLeft,
  Plus,
  AlertCircle,
  Zap,
  Grid3x3,
  Maximize2,
  Search,
  X,
} from '@/shared/icons';

import { WorkflowDefinition, NodeType, NodeData } from '../types/workflow.types';
import { nodeTypeConfigs } from '../utils/nodeConfigs';
import { CustomNode } from './nodes/CustomNode';
import { CustomEdge } from './edges/CustomEdge';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { useWorkflowResources } from '../hooks/useWorkflowResources';
import { useBackendNodes } from '../hooks/useBackendNodes';

const nodeTypes = {
  trigger: CustomNode,
  mcp_tool: CustomNode,
  llm_completion: CustomNode,
  code: CustomNode,
  condition: CustomNode,
  loop: CustomNode,
  transform: CustomNode,
  merge: CustomNode,
};

const edgeTypes = {
  default: CustomEdge,
};

interface WorkflowsContainerProps {
  workflowId?: string;
  workflowName?: string;
  initialWorkflow?: WorkflowDefinition;
  onSave?: (workflow: WorkflowDefinition) => Promise<void>;
  onExecute?: (workflow: WorkflowDefinition) => Promise<void>;
  onBack?: () => void;
  theme?: 'light' | 'dark';
}

const WorkflowCanvasInner: React.FC<WorkflowsContainerProps> = ({
  workflowId,
  workflowName: initialWorkflowName = 'Untitled Workflow',
  initialWorkflow,
  onSave,
  onExecute,
  onBack,
  theme = 'dark',
}) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialWorkflow?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialWorkflow?.edges || []);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState(initialWorkflowName);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isDark = theme === 'dark';

  // Fetch available resources (models, tools)
  const { availableModels, availableTools, loading: resourcesLoading } = useWorkflowResources();

  // Fetch backend nodes
  const { nodeConfigs: backendNodeConfigs, loading: nodesLoading, error: nodesError } = useBackendNodes();

  // Use backend nodes if available, otherwise fall back to hardcoded configs
  const activeNodeConfigs = Object.keys(backendNodeConfigs).length > 0 ? backendNodeConfigs : nodeTypeConfigs;

  // Filter nodes based on search query
  const filteredNodeConfigs = Object.values(activeNodeConfigs).filter((config) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      config.label.toLowerCase().includes(query) ||
      config.description.toLowerCase().includes(query) ||
      config.category.toLowerCase().includes(query)
    );
  });

  // Group nodes by category
  const nodesByCategory = filteredNodeConfigs.reduce((acc, config) => {
    const category = config.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(config);
    return acc;
  }, {} as Record<string, typeof filteredNodeConfigs>);

  // Update workflow definition when nodes or edges change
  const getWorkflowDefinition = useCallback((): WorkflowDefinition => {
    return {
      nodes,
      edges,
      viewport: reactFlowInstance?.getViewport(),
    };
  }, [nodes, edges, reactFlowInstance]);

  // Handle edge deletion
  const handleEdgeDelete = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }, [setEdges]);

  // Handle connection between nodes
  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge: Edge = {
        id: `edge-${params.source}-${params.target}-${Date.now()}`,
        source: params.source!,
        target: params.target!,
        sourceHandle: params.sourceHandle,
        targetHandle: params.targetHandle,
        type: 'default',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
        },
        data: {
          onDelete: handleEdgeDelete,
        },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges, handleEdgeDelete]
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

      const nodeDataStr = event.dataTransfer.getData('application/reactflow');
      if (!nodeDataStr) return;

      try {
        const nodeConfig = JSON.parse(nodeDataStr);
        const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
        const position = reactFlowInstance.project({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        });

        const newNode: Node = {
          id: `${nodeConfig.type}-${Date.now()}`,
          type: nodeConfig.type,
          position,
          data: {
            ...nodeConfig.defaultData,
            label: nodeConfig.label,
            icon: nodeConfig.icon,
            color: nodeConfig.color,
          },
        };

        setNodes((nds) => nds.concat(newNode));
      } catch (error) {
        console.error('Failed to parse node data:', error);
      }
    },
    [reactFlowInstance, setNodes]
  );

  // Handle node selection
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setShowPropertiesPanel(true);
  }, []);

  // Handle node update from properties panel
  const handleNodeUpdate = useCallback((nodeId: string, data: Partial<NodeData>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node
      )
    );
  }, [setNodes]);

  // Handle node deletion from properties panel
  const handleNodeDelete = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNode(null);
    setShowPropertiesPanel(false);
  }, [setNodes, setEdges]);

  // Handle Save
  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setIsSaving(true);
    setSaveStatus('saving');
    try {
      await onSave(getWorkflowDefinition());
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save workflow:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, getWorkflowDefinition]);

  // Handle Execute
  const handleExecute = useCallback(async () => {
    if (!onExecute || nodes.length === 0) return;

    setIsExecuting(true);
    try {
      await onExecute(getWorkflowDefinition());
    } catch (error) {
      console.error('Workflow execution failed:', error);
    } finally {
      setIsExecuting(false);
    }
  }, [onExecute, getWorkflowDefinition, nodes.length]);

  return (
    <div className={`w-full h-screen flex flex-col ${isDark ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div
        className={`
          h-16 flex items-center justify-between px-6 border-b
          ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}
          z-10
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
                hover:bg-gray-800/50 px-2 py-1 rounded transition-colors
              `}
              placeholder="Workflow Name"
            />
            <div className={`text-xs px-2 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
              {nodes.length} nodes • {edges.length} connections
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowPalette(!showPalette)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm
              ${isDark
                ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }
              transition-colors
            `}
          >
            <Grid3x3 className="w-4 h-4" />
            {showPalette ? 'Hide' : 'Show'} Nodes
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleExecute}
            disabled={isExecuting || nodes.length === 0}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm
              ${isExecuting || nodes.length === 0
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700'
              }
              shadow-lg transition-all
            `}
          >
            {isExecuting ? (
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
            onClick={handleSave}
            disabled={isSaving}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm
              ${saveStatus === 'saved'
                ? 'bg-emerald-500/20 text-emerald-400'
                : saveStatus === 'error'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
              }
              shadow-lg transition-all duration-150
              ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <Save className="w-4 h-4" />
            {saveStatus === 'saving'
              ? 'Saving...'
              : saveStatus === 'saved'
              ? 'Saved!'
              : saveStatus === 'error'
              ? 'Error'
              : 'Save'}
          </motion.button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Node Palette */}
        <AnimatePresence>
          {showPalette && (
            <motion.div
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`
                w-80 border-r flex flex-col overflow-hidden
                ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}
              `}
            >
              {/* Palette Header */}
              <div className="flex-shrink-0 p-4 border-b"
                style={{ borderColor: isDark ? 'rgb(31, 41, 55)' : 'rgb(229, 231, 235)' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Plus className="w-5 h-5 text-blue-400" />
                  <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    Add Nodes
                  </h2>
                </div>

                {/* Search Box */}
                <div className="relative">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search nodes..."
                    className={`
                      w-full pl-10 pr-9 py-2 rounded-lg border text-sm transition-all
                      ${isDark
                        ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500'
                        : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500'
                      }
                      focus:outline-none focus:ring-2 focus:ring-blue-500/20
                    `}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors
                        ${isDark ? 'hover:bg-gray-700 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'}
                      `}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Nodes List */}
              <div className="flex-1 overflow-y-auto workflow-scrollbar p-4">
                {nodesLoading && (
                  <div className="p-8 text-center">
                    <div className="workflow-spinner rounded-full h-10 w-10 border-3 border-blue-500 border-t-transparent mx-auto mb-3"></div>
                    <p className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Loading nodes...</p>
                  </div>
                )}

                {nodesError && (
                  <div className={`p-4 rounded-lg border ${isDark ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium">Failed to load nodes</p>
                        <p className="text-xs mt-1 opacity-80">{nodesError}</p>
                        <p className="text-xs mt-1 opacity-60">Using default node types.</p>
                      </div>
                    </div>
                  </div>
                )}

                {!nodesLoading && Object.keys(nodesByCategory).length === 0 && (
                  <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">No nodes found</p>
                    <p className="text-xs mt-1">Try a different search term</p>
                  </div>
                )}

                {!nodesLoading && Object.entries(nodesByCategory).map(([category, configs]) => (
                  <div key={category} className="mb-4 last:mb-0">
                    {/* Category Header */}
                    <div className={`text-xs font-semibold mb-2 px-2 ${isDark ? 'text-gray-400' : 'text-gray-600'} uppercase tracking-wider`}>
                      {category}
                    </div>

                    {/* Nodes in Category - Professional Flowise-style Cards */}
                    <div className="space-y-2">
                      {configs.map((config) => (
                        <motion.div
                          key={config.type}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              'application/reactflow',
                              JSON.stringify(config)
                            );
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          whileHover={{
                            scale: 1.03,
                            translateY: -4,
                            boxShadow: isDark
                              ? '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)'
                              : '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)'
                          }}
                          whileTap={{ scale: 0.97 }}
                          className={`
                            workflow-palette-item p-4 rounded-xl border-2 cursor-grab active:cursor-grabbing
                            transition-all duration-150 ease-out relative overflow-hidden
                            ${isDark
                              ? 'bg-gradient-to-br from-gray-800/90 to-gray-800/70 border-gray-700/50 hover:border-gray-600'
                              : 'bg-gradient-to-br from-white to-gray-50 border-gray-200 hover:border-gray-300'
                            }
                          `}
                          style={{
                            boxShadow: isDark
                              ? '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)'
                              : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                          }}
                        >
                          {/* Gradient accent bar on left */}
                          <div
                            className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                            style={{
                              background: `linear-gradient(to bottom, ${config.color}, ${config.color}CC)`,
                            }}
                          />

                          <div className="flex items-start gap-3 relative">
                            {/* Professional Icon Badge */}
                            <div
                              className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all duration-150 ease-out relative group-hover:scale-110"
                              style={{
                                background: isDark
                                  ? `linear-gradient(135deg, ${config.color}30, ${config.color}20)`
                                  : `linear-gradient(135deg, ${config.color}25, ${config.color}15)`,
                                border: `2px solid ${config.color}40`,
                                boxShadow: `0 4px 12px ${config.color}20`,
                              }}
                            >
                              <span className="relative z-10">{config.icon}</span>
                              {/* Shine effect */}
                              <div
                                className="absolute inset-0 rounded-xl opacity-0 hover:opacity-20 transition-opacity duration-150 ease-out"
                                style={{
                                  background: `linear-gradient(135deg, transparent 0%, ${config.color} 100%)`,
                                }}
                              />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className={`font-semibold text-sm mb-1 truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                {config.label}
                              </div>
                              <p className={`text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                {config.description}
                              </p>
                            </div>
                          </div>

                          {/* Hover glow effect */}
                          <div
                            className="absolute inset-0 rounded-xl opacity-0 hover:opacity-10 transition-opacity duration-150 ease-out pointer-events-none"
                            style={{
                              background: `radial-gradient(circle at 50% 0%, ${config.color}, transparent 70%)`,
                            }}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
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
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            attributionPosition="bottom-right"
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            style={{
              background: isDark ? '#0a0a0f' : '#f8f9fa',
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color={isDark ? '#1f1f2e' : '#ddd'}
            />
            <Controls
              className={`${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'} rounded-lg shadow-lg`}
            />
            <MiniMap
              nodeColor={(node) => {
                const config = activeNodeConfigs[node.type as NodeType];
                return config?.color || (isDark ? '#4b5563' : '#9ca3af');
              }}
              className={`${isDark ? 'bg-gray-800/50 border-gray-700' : 'bg-white/50 border-gray-300'} rounded-lg`}
              maskColor={isDark ? 'rgb(10, 10, 15, 0.6)' : 'rgb(248, 249, 250, 0.6)'}
            />

            {/* Empty State */}
            {nodes.length === 0 && (
              <Panel position="top-center">
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`
                    border rounded-lg px-6 py-4 flex items-center gap-3
                    ${isDark
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                      : 'bg-blue-50 border-blue-200 text-blue-700'
                    }
                  `}
                >
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">
                    Drag nodes from the palette to start building your workflow
                  </span>
                </motion.div>
              </Panel>
            )}
          </ReactFlow>

          {/* Custom styles */}
          <style>{`
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

            .react-flow__node {
              transition: all 0.2s ease;
            }

            .react-flow__node.selected {
              box-shadow: 0 0 0 2px #3b82f6;
            }
          `}</style>
        </div>

        {/* Node Properties Panel */}
        {showPropertiesPanel && selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            onClose={() => {
              setShowPropertiesPanel(false);
              setSelectedNode(null);
            }}
            onUpdate={handleNodeUpdate}
            onDelete={handleNodeDelete}
            availableModels={availableModels}
            availableTools={availableTools}
            theme={theme}
          />
        )}
      </div>
    </div>
  );
};

// Wrapper with ReactFlowProvider
export const WorkflowsContainer: React.FC<WorkflowsContainerProps> = (props) => {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
};
