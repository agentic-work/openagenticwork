/**
 * Workflow API Service
 * Handles all workflow-related API calls
 * Routes to AgenticWorkflows microservice
 */

import { workflowEndpoint } from '@/utils/api';
import type { Workflow, WorkflowDefinition } from '../types/workflow.types';

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  nodes: any[];
  edges: any[];
  status?: 'draft' | 'active' | 'paused' | 'archived';
  is_public?: boolean;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  nodes?: any[];
  edges?: any[];
  status?: 'draft' | 'active' | 'paused' | 'archived';
  is_public?: boolean;
}

export interface ExecuteWorkflowRequest {
  input?: Record<string, any>;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  user_id: string;
  status: 'running' | 'completed' | 'failed';
  input: Record<string, any>;
  output: Record<string, any>;
  node_executions: any[];
  error?: string;
  created_at: string;
  completed_at?: string;
}

export class WorkflowApiService {
  private getAuthHeaders: () => Record<string, string>;

  constructor(getAuthHeaders: () => Record<string, string>) {
    this.getAuthHeaders = getAuthHeaders;
  }

  /**
   * List all workflows for current user
   */
  async listWorkflows(): Promise<Workflow[]> {
    const response = await fetch(workflowEndpoint('/workflows'), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to list workflows');
    }

    const data = await response.json();
    return data.workflows;
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(id: string): Promise<Workflow> {
    const response = await fetch(workflowEndpoint(`/workflows/${id}`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get workflow');
    }

    const data = await response.json();
    return data.workflow;
  }

  /**
   * Create new workflow
   */
  async createWorkflow(workflow: CreateWorkflowRequest): Promise<Workflow> {
    const response = await fetch(workflowEndpoint('/workflows'), {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(workflow),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create workflow');
    }

    const data = await response.json();
    return data.workflow;
  }

  /**
   * Update existing workflow
   */
  async updateWorkflow(id: string, updates: UpdateWorkflowRequest): Promise<Workflow> {
    const response = await fetch(workflowEndpoint(`/workflows/${id}`), {
      method: 'PUT',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update workflow');
    }

    const data = await response.json();
    return data.workflow;
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(id: string): Promise<void> {
    const response = await fetch(workflowEndpoint(`/workflows/${id}`), {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete workflow');
    }
  }

  /**
   * Execute workflow (with SSE streaming)
   */
  async executeWorkflow(
    id: string,
    input?: Record<string, any>,
    onProgress?: (event: { type: string; data: any }) => void
  ): Promise<void> {
    const response = await fetch(workflowEndpoint(`/workflows/${id}/execute`), {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: input || {} }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to execute workflow');
    }

    // Handle SSE streaming
    if (onProgress && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('event:')) {
            const eventType = line.substring(6).trim();
            const nextLine = lines[lines.indexOf(line) + 1];
            if (nextLine && nextLine.startsWith('data:')) {
              const data = JSON.parse(nextLine.substring(5).trim());
              onProgress({ type: eventType, data });
            }
          }
        }
      }
    }
  }

  /**
   * Test workflow without saving to database
   */
  async testWorkflow(
    definition: WorkflowDefinition,
    input?: Record<string, any>,
    onProgress?: (event: { type: string; data: any }) => void
  ): Promise<void> {
    const response = await fetch(workflowEndpoint('/workflows/test'), {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodes: definition.nodes,
        edges: definition.edges,
        input: input || {},
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to test workflow');
    }

    // Handle SSE streaming (same as execute)
    if (onProgress && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('event:')) {
            const eventType = line.substring(6).trim();
            const nextLine = lines[lines.indexOf(line) + 1];
            if (nextLine && nextLine.startsWith('data:')) {
              const data = JSON.parse(nextLine.substring(5).trim());
              onProgress({ type: eventType, data });
            }
          }
        }
      }
    }
  }

  /**
   * Get workflow execution history
   */
  async getExecutions(workflowId: string): Promise<WorkflowExecution[]> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get executions');
    }

    const data = await response.json();
    return data.executions;
  }

  /**
   * Duplicate workflow
   */
  async duplicateWorkflow(id: string): Promise<Workflow> {
    // Get the original workflow
    const original = await this.getWorkflow(id);

    // Create a copy with modified name
    return this.createWorkflow({
      name: `${original.name} (Copy)`,
      description: original.description,
      nodes: original.nodes,
      edges: original.edges,
      status: 'draft',
      is_public: false,
    });
  }
}
