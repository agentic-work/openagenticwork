/**
 * Workflow List Component
 * Dashboard view of all user workflows
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Play,
  Pause,
  Edit,
  Trash2,
  Copy,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  MoreVertical,
} from '@/shared/icons';
import { format } from 'date-fns';
import { Workflow, WorkflowStatus } from '../types/workflow.types';

interface WorkflowListProps {
  workflows: Workflow[];
  onCreateNew?: () => void;
  onEdit?: (workflowId: string) => void;
  onExecute?: (workflowId: string) => void;
  onDelete?: (workflowId: string) => void;
  onDuplicate?: (workflowId: string) => void;
  onToggleStatus?: (workflowId: string, status: WorkflowStatus) => void;
  theme?: 'light' | 'dark';
}

export const WorkflowList: React.FC<WorkflowListProps> = ({
  workflows,
  onCreateNew,
  onEdit,
  onExecute,
  onDelete,
  onDuplicate,
  onToggleStatus,
  theme = 'dark',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<WorkflowStatus | 'all'>('all');
  const [showMenu, setShowMenu] = useState<string | null>(null);

  const filteredWorkflows = workflows.filter((workflow) => {
    const matchesSearch =
      workflow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workflow.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || workflow.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getStatusColor = (status: WorkflowStatus) => {
    switch (status) {
      case 'active':
        return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30';
      case 'paused':
        return 'text-amber-400 bg-amber-500/20 border-amber-500/30';
      case 'draft':
        return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
      case 'archived':
        return 'text-gray-500 bg-gray-600/20 border-gray-600/30';
      default:
        return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
    }
  };

  const getStatusIcon = (status: WorkflowStatus) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-3.5 h-3.5" />;
      case 'paused':
        return <Pause className="w-3.5 h-3.5" />;
      default:
        return <Clock className="w-3.5 h-3.5" />;
    }
  };

  const isDark = theme === 'dark';

  return (
    <div
      className={`
        w-full h-full flex flex-col
        ${isDark ? 'bg-gray-950' : 'bg-gray-50'}
      `}
    >
      {/* Header */}
      <div
        className={`
          p-6 border-b
          ${isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}
        `}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Workflows
            </h1>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Automate tasks with custom workflows
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onCreateNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Create Workflow
          </motion.button>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`
                w-full pl-10 pr-4 py-2 rounded-lg text-sm
                ${isDark
                  ? 'bg-gray-800 text-white border-gray-700'
                  : 'bg-gray-100 text-gray-900 border-gray-300'
                }
                border focus:outline-none focus:ring-2 focus:ring-blue-500/50
              `}
            />
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as WorkflowStatus | 'all')}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium
              ${isDark
                ? 'bg-gray-800 text-white border-gray-700'
                : 'bg-gray-100 text-gray-900 border-gray-300'
              }
              border focus:outline-none focus:ring-2 focus:ring-blue-500/50
            `}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Workflow Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Search className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">No workflows found</p>
            <p className="text-sm">Create your first workflow to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredWorkflows.map((workflow) => (
                <motion.div
                  key={workflow.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`
                    p-5 rounded-lg border
                    ${isDark
                      ? 'bg-gray-900/80 border-gray-800 hover:bg-gray-900 hover:border-gray-700'
                      : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                    }
                    cursor-pointer transition-all duration-150
                    hover:shadow-lg
                  `}
                  onClick={() => onEdit?.(workflow.id)}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className={`text-base font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {workflow.name}
                      </h3>
                      {workflow.description && (
                        <p className={`text-sm mt-1 line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          {workflow.description}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(showMenu === workflow.id ? null : workflow.id);
                      }}
                      className={`
                        p-1 rounded transition-colors
                        ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-200'}
                      `}
                    >
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>

                    {/* Dropdown Menu */}
                    {showMenu === workflow.id && (
                      <div
                        className={`
                          absolute right-0 mt-8 w-48 rounded-lg border shadow-xl z-10
                          ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}
                        `}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            onExecute?.(workflow.id);
                            setShowMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-700"
                        >
                          <Play className="w-4 h-4" />
                          Execute
                        </button>
                        <button
                          onClick={() => {
                            onDuplicate?.(workflow.id);
                            setShowMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-700"
                        >
                          <Copy className="w-4 h-4" />
                          Duplicate
                        </button>
                        <button
                          onClick={() => {
                            onDelete?.(workflow.id);
                            setShowMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-700 text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Status & Metadata */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`
                        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium
                        ${getStatusColor(workflow.status)}
                      `}
                    >
                      {getStatusIcon(workflow.status)}
                      {workflow.status.charAt(0).toUpperCase() + workflow.status.slice(1)}
                    </span>

                    {workflow.tags && workflow.tags.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {workflow.tags[0]}
                        {workflow.tags.length > 1 && ` +${workflow.tags.length - 1}`}
                      </span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className={`flex items-center gap-4 text-xs ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>
                    <div>
                      <span className="font-medium">{Array.isArray(workflow.nodes) ? workflow.nodes.length : 0}</span> nodes
                    </div>
                    {workflow.executionCount !== undefined && (
                      <div>
                        <span className="font-medium">{workflow.executionCount}</span> runs
                      </div>
                    )}
                    {workflow.lastExecutedAt && (
                      <div>
                        Last run: {format(new Date(workflow.lastExecutedAt), 'MMM d')}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
