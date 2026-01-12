/**
 * Task Orchestrator
 * Handles complex task decomposition and multi-agent execution
 * Enables fan-out of subtasks to parallel agents
 */

import type { Message, ToolCall, ToolResult } from './types.js';

// Task status
export type TaskStatus = 'pending' | 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';

// A subtask within a larger task
export interface Subtask {
  id: string;
  parentId: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];  // Subtask IDs that must complete first
  result?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  agentId?: string;  // If assigned to a specific agent
}

// A complex task that may be decomposed
export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  subtasks: Subtask[];
  createdAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
}

// Event types
export type TaskEventType =
  | 'task_created'
  | 'task_planning'
  | 'subtask_created'
  | 'subtask_started'
  | 'subtask_completed'
  | 'subtask_failed'
  | 'task_completed'
  | 'task_failed';

export interface TaskEvent {
  type: TaskEventType;
  taskId: string;
  subtaskId?: string;
  message: string;
  data?: Record<string, unknown>;
}

export type TaskEventHandler = (event: TaskEvent) => void;

// Agent interface for executing subtasks
export interface SubtaskAgent {
  id: string;
  execute(subtask: Subtask, context: AgentContext): Promise<string>;
  abort(): void;
}

export interface AgentContext {
  workingDirectory: string;
  parentMessages: Message[];
  tools: string[];
  onProgress: (message: string) => void;
}

// Task planner interface
export interface TaskPlanner {
  planTask(description: string): Promise<Subtask[]>;
  shouldDecompose(description: string): Promise<boolean>;
}

/**
 * Simple task planner that uses LLM to decompose tasks
 */
export class LLMTaskPlanner implements TaskPlanner {
  private llmCall: (prompt: string) => Promise<string>;

  constructor(llmCall: (prompt: string) => Promise<string>) {
    this.llmCall = llmCall;
  }

  async shouldDecompose(description: string): Promise<boolean> {
    // Check if this task is complex enough to warrant decomposition
    const complexityIndicators = [
      'and then',
      'after that',
      'multiple',
      'create a',
      'deploy',
      'set up',
      'configure',
      'landing zone',
      'infrastructure',
      'with',
      'including',
    ];

    const desc = description.toLowerCase();
    const matchCount = complexityIndicators.filter(i => desc.includes(i)).length;

    return matchCount >= 2 || description.length > 200;
  }

  async planTask(description: string): Promise<Subtask[]> {
    const prompt = `You are a task planner. Break down this complex task into smaller, executable subtasks.

Task: ${description}

Rules:
1. Each subtask should be independently executable
2. Identify dependencies between subtasks
3. Subtasks should be concrete and specific
4. Output as JSON array

Output format:
[
  {
    "id": "1",
    "title": "Short title",
    "description": "Detailed description of what to do",
    "dependencies": []  // IDs of subtasks that must complete first
  }
]

Subtasks:`;

    const response = await this.llmCall(prompt);

    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        id: string;
        title: string;
        description: string;
        dependencies: string[];
      }>;

      return parsed.map(p => ({
        id: `subtask_${p.id}`,
        parentId: '',  // Will be set by orchestrator
        title: p.title,
        description: p.description,
        status: 'pending' as TaskStatus,
        dependencies: p.dependencies.map(d => `subtask_${d}`),
      }));
    } catch (error) {
      // If parsing fails, return a single subtask with the original description
      return [{
        id: 'subtask_1',
        parentId: '',
        title: 'Execute task',
        description: description,
        status: 'pending',
        dependencies: [],
      }];
    }
  }
}

/**
 * Task Orchestrator
 * Coordinates complex task execution with multiple agents
 */
export class TaskOrchestrator {
  private tasks: Map<string, Task> = new Map();
  private planner: TaskPlanner;
  private createAgent: () => SubtaskAgent;
  private agents: Map<string, SubtaskAgent> = new Map();
  private eventHandlers: TaskEventHandler[] = [];
  private maxConcurrentAgents: number;

  constructor(
    planner: TaskPlanner,
    createAgent: () => SubtaskAgent,
    maxConcurrentAgents: number = 3
  ) {
    this.planner = planner;
    this.createAgent = createAgent;
    this.maxConcurrentAgents = maxConcurrentAgents;
  }

  /**
   * Subscribe to task events
   */
  onEvent(handler: TaskEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit a task event
   */
  private emit(event: TaskEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  /**
   * Generate unique task ID
   */
  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Create and plan a new task
   */
  async createTask(description: string): Promise<Task> {
    const taskId = this.generateId();

    const task: Task = {
      id: taskId,
      title: description.slice(0, 50) + (description.length > 50 ? '...' : ''),
      description,
      status: 'planning',
      subtasks: [],
      createdAt: new Date(),
    };

    this.tasks.set(taskId, task);

    this.emit({
      type: 'task_created',
      taskId,
      message: `Task created: ${task.title}`,
    });

    // Check if we should decompose
    const shouldDecompose = await this.planner.shouldDecompose(description);

    if (shouldDecompose) {
      this.emit({
        type: 'task_planning',
        taskId,
        message: 'Planning task decomposition...',
      });

      const subtasks = await this.planner.planTask(description);

      for (const subtask of subtasks) {
        subtask.parentId = taskId;
        task.subtasks.push(subtask);

        this.emit({
          type: 'subtask_created',
          taskId,
          subtaskId: subtask.id,
          message: `Subtask: ${subtask.title}`,
          data: { dependencies: subtask.dependencies },
        });
      }
    } else {
      // Single subtask for simple tasks
      task.subtasks.push({
        id: 'subtask_main',
        parentId: taskId,
        title: task.title,
        description: task.description,
        status: 'pending',
        dependencies: [],
      });
    }

    task.status = 'pending';
    return task;
  }

  /**
   * Execute a task
   */
  async executeTask(taskId: string, context: AgentContext): Promise<string> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'executing';

    try {
      // Execute subtasks respecting dependencies
      const results = await this.executeSubtasks(task, context);

      // Combine results
      const combinedResult = results
        .map(r => `## ${r.title}\n${r.result}`)
        .join('\n\n');

      task.status = 'completed';
      task.completedAt = new Date();
      task.result = combinedResult;

      this.emit({
        type: 'task_completed',
        taskId,
        message: `Task completed: ${task.title}`,
        data: { duration: task.completedAt.getTime() - task.createdAt.getTime() },
      });

      return combinedResult;
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);

      this.emit({
        type: 'task_failed',
        taskId,
        message: `Task failed: ${task.error}`,
      });

      throw error;
    } finally {
      // Cleanup agents
      for (const [agentId, agent] of this.agents) {
        agent.abort();
      }
      this.agents.clear();
    }
  }

  /**
   * Execute subtasks with dependency management
   */
  private async executeSubtasks(
    task: Task,
    context: AgentContext
  ): Promise<Array<{ title: string; result: string }>> {
    const results: Array<{ title: string; result: string }> = [];
    const completed = new Set<string>();
    const running = new Map<string, Promise<void>>();

    while (completed.size < task.subtasks.length) {
      // Find subtasks ready to run (dependencies met, not running/completed)
      const ready = task.subtasks.filter(st =>
        st.status === 'pending' &&
        st.dependencies.every(dep => completed.has(dep)) &&
        !running.has(st.id)
      );

      if (ready.length === 0 && running.size === 0) {
        // Deadlock or error
        throw new Error('No subtasks ready and none running - possible circular dependency');
      }

      // Start subtasks up to concurrency limit
      for (const subtask of ready) {
        if (running.size >= this.maxConcurrentAgents) break;

        const promise = this.executeSubtask(subtask, context)
          .then(result => {
            completed.add(subtask.id);
            results.push({ title: subtask.title, result });
            running.delete(subtask.id);
          })
          .catch(error => {
            running.delete(subtask.id);
            throw error;
          });

        running.set(subtask.id, promise);
      }

      // Wait for at least one to complete
      if (running.size > 0) {
        await Promise.race(running.values());
      }
    }

    return results;
  }

  /**
   * Execute a single subtask
   */
  private async executeSubtask(
    subtask: Subtask,
    context: AgentContext
  ): Promise<string> {
    subtask.status = 'executing';
    subtask.startedAt = new Date();

    this.emit({
      type: 'subtask_started',
      taskId: subtask.parentId,
      subtaskId: subtask.id,
      message: `Starting: ${subtask.title}`,
    });

    try {
      // Create or reuse agent
      const agent = this.createAgent();
      subtask.agentId = agent.id;
      this.agents.set(agent.id, agent);

      const result = await agent.execute(subtask, {
        ...context,
        onProgress: (msg) => {
          context.onProgress(`[${subtask.title}] ${msg}`);
        },
      });

      subtask.status = 'completed';
      subtask.completedAt = new Date();
      subtask.result = result;

      this.emit({
        type: 'subtask_completed',
        taskId: subtask.parentId,
        subtaskId: subtask.id,
        message: `Completed: ${subtask.title}`,
        data: {
          duration: subtask.completedAt.getTime() - subtask.startedAt!.getTime(),
        },
      });

      return result;
    } catch (error) {
      subtask.status = 'failed';
      subtask.error = error instanceof Error ? error.message : String(error);

      this.emit({
        type: 'subtask_failed',
        taskId: subtask.parentId,
        subtaskId: subtask.id,
        message: `Failed: ${subtask.title} - ${subtask.error}`,
      });

      throw error;
    }
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'cancelled';

    // Abort all running agents for this task
    for (const subtask of task.subtasks) {
      if (subtask.agentId) {
        const agent = this.agents.get(subtask.agentId);
        if (agent) {
          agent.abort();
        }
      }
      if (subtask.status === 'pending' || subtask.status === 'executing') {
        subtask.status = 'cancelled';
      }
    }
  }
}
