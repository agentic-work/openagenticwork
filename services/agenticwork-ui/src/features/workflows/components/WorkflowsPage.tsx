/**
 * Workflows Page - Container Component
 * Wires UI components to API and manages state
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthContext';
import { WorkflowApiService } from '../services/workflowApi';
import { WorkflowList } from './WorkflowList';
import { WorkflowsContainer } from './WorkflowsContainer';
import { Workflow, WorkflowDefinition } from '../types/workflow.types';
import { useTheme } from '@/contexts/ThemeContext';
import { X } from '@/shared/icons';

type ViewMode = 'list' | 'builder';

export const WorkflowsPage: React.FC = () => {
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const { resolvedTheme } = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [currentWorkflow, setCurrentWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize API service
  const apiService = new WorkflowApiService(getAuthHeaders);

  // Handle close - navigate back to chat
  const handleClose = useCallback(() => {
    navigate('/');
  }, [navigate]);

  // Load workflows on mount
  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiService.listWorkflows();
      setWorkflows(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load workflows');
      console.error('Error loading workflows:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = useCallback(async () => {
    try {
      const newWorkflow = await apiService.createWorkflow({
        name: 'Untitled Workflow',
        description: '',
        nodes: [],
        edges: [],
        status: 'draft',
      });
      setCurrentWorkflow(newWorkflow);
      setViewMode('builder');
      await loadWorkflows(); // Refresh list
    } catch (err: any) {
      setError(err.message || 'Failed to create workflow');
      console.error('Error creating workflow:', err);
    }
  }, []);

  const handleEdit = useCallback(async (workflowId: string) => {
    try {
      const workflow = await apiService.getWorkflow(workflowId);
      setCurrentWorkflow(workflow);
      setViewMode('builder');
    } catch (err: any) {
      setError(err.message || 'Failed to load workflow');
      console.error('Error loading workflow:', err);
    }
  }, []);

  const handleSave = useCallback(async (definition: WorkflowDefinition) => {
    if (!currentWorkflow) return;

    try {
      const updated = await apiService.updateWorkflow(currentWorkflow.id, {
        name: currentWorkflow.name,
        description: currentWorkflow.description,
        nodes: definition.nodes,
        edges: definition.edges,
      });
      setCurrentWorkflow(updated);
      await loadWorkflows(); // Refresh list
    } catch (err: any) {
      setError(err.message || 'Failed to save workflow');
      console.error('Error saving workflow:', err);
      throw err; // Re-throw so WorkflowBuilder can handle it
    }
  }, [currentWorkflow]);

  const handleExecute = useCallback(async (definition: WorkflowDefinition) => {
    if (!currentWorkflow) return;

    try {
      await apiService.executeWorkflow(
        currentWorkflow.id,
        {},
        (event) => {
          console.log('Execution progress:', event);
          // TODO: Update UI with execution progress
        }
      );
    } catch (err: any) {
      setError(err.message || 'Failed to execute workflow');
      console.error('Error executing workflow:', err);
      throw err;
    }
  }, [currentWorkflow]);

  const handleExecuteFromList = useCallback(async (workflowId: string) => {
    try {
      await apiService.executeWorkflow(
        workflowId,
        {},
        (event) => {
          console.log('Execution progress:', event);
          // TODO: Show execution progress notification
        }
      );
    } catch (err: any) {
      setError(err.message || 'Failed to execute workflow');
      console.error('Error executing workflow:', err);
    }
  }, []);

  const handleDelete = useCallback(async (workflowId: string) => {
    if (!confirm('Are you sure you want to delete this workflow?')) {
      return;
    }

    try {
      await apiService.deleteWorkflow(workflowId);
      await loadWorkflows(); // Refresh list
    } catch (err: any) {
      setError(err.message || 'Failed to delete workflow');
      console.error('Error deleting workflow:', err);
    }
  }, []);

  const handleDuplicate = useCallback(async (workflowId: string) => {
    try {
      await apiService.duplicateWorkflow(workflowId);
      await loadWorkflows(); // Refresh list
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate workflow');
      console.error('Error duplicating workflow:', err);
    }
  }, []);

  const handleToggleStatus = useCallback(async (workflowId: string, status: any) => {
    try {
      await apiService.updateWorkflow(workflowId, { status });
      await loadWorkflows(); // Refresh list
    } catch (err: any) {
      setError(err.message || 'Failed to update workflow status');
      console.error('Error updating status:', err);
    }
  }, []);

  const handleBack = useCallback(() => {
    setViewMode('list');
    setCurrentWorkflow(null);
  }, []);

  const isDark = resolvedTheme === 'dark';

  // Show loading state
  if (loading && viewMode === 'list') {
    return (
      <div className={`w-full h-screen ${isDark ? 'bg-gray-950' : 'bg-gray-50'}`}>
        {/* Close Button */}
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={handleClose}
            className={`
              p-3 rounded-lg transition-all shadow-lg
              ${isDark
                ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
                : 'bg-white hover:bg-gray-100 text-gray-700 hover:text-gray-900'
              }
              border ${isDark ? 'border-gray-700' : 'border-gray-200'}
            `}
            title="Close Workflows"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="w-full h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-500">Loading workflows...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error && viewMode === 'list') {
    return (
      <div className={`w-full h-screen ${isDark ? 'bg-gray-950' : 'bg-gray-50'}`}>
        {/* Close Button */}
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={handleClose}
            className={`
              p-3 rounded-lg transition-all shadow-lg
              ${isDark
                ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
                : 'bg-white hover:bg-gray-100 text-gray-700 hover:text-gray-900'
              }
              border ${isDark ? 'border-gray-700' : 'border-gray-200'}
            `}
            title="Close Workflows"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="w-full h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-500 mb-4">{error}</p>
            <button
              onClick={loadWorkflows}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show builder view
  if (viewMode === 'builder' && currentWorkflow) {
    return (
      <div className="relative w-full h-screen">
        {/* Close Button */}
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={handleClose}
            className={`
              p-3 rounded-lg transition-all shadow-lg
              ${isDark
                ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
                : 'bg-white hover:bg-gray-100 text-gray-700 hover:text-gray-900'
              }
              border ${isDark ? 'border-gray-700' : 'border-gray-200'}
            `}
            title="Close Workflows"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <WorkflowsContainer
          workflowId={currentWorkflow.id}
          workflowName={currentWorkflow.name}
          initialWorkflow={{
            nodes: currentWorkflow.nodes || [],
            edges: currentWorkflow.edges || [],
          }}
          onSave={handleSave}
          onExecute={handleExecute}
          onBack={handleBack}
          theme={resolvedTheme as 'light' | 'dark'}
        />
      </div>
    );
  }

  // Show list view
  return (
    <div className="relative w-full h-screen">
      {/* Close Button */}
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={handleClose}
          className={`
            p-3 rounded-lg transition-all shadow-lg
            ${isDark
              ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
              : 'bg-white hover:bg-gray-100 text-gray-700 hover:text-gray-900'
            }
            border ${isDark ? 'border-gray-700' : 'border-gray-200'}
          `}
          title="Close Workflows"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <WorkflowList
        workflows={workflows}
        onCreateNew={handleCreateNew}
        onEdit={handleEdit}
        onExecute={handleExecuteFromList}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onToggleStatus={handleToggleStatus}
        theme={resolvedTheme}
      />
    </div>
  );
};
