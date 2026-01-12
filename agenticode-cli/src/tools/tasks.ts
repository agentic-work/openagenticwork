/**
 * Task Management Tools
 * Todo list and task tracking capabilities
 */

import type { ToolDefinition, ToolContext, ToolOutput } from '../core/types.js';

/**
 * In-memory todo storage (per session)
 * In a real implementation, this could be persisted to disk or database
 */
interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

const todoStore: Map<string, TodoItem[]> = new Map();

function getSessionTodos(sessionId: string): TodoItem[] {
  if (!todoStore.has(sessionId)) {
    todoStore.set(sessionId, []);
  }
  return todoStore.get(sessionId)!;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Todo Write Tool - Manage task list
 * Write and update todos for tracking work progress
 */
export const todoWriteTool: ToolDefinition = {
  name: 'todo_write',
  description: `Manage a task list for tracking work progress. Use this to:
- Create new tasks when starting multi-step work
- Update task status as you progress (pending → in_progress → completed)
- Break complex tasks into smaller, trackable steps
- Show the user your progress on their request

The task list helps organize complex work and demonstrates thoroughness.`,
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Array of todo items to set. Replaces the entire todo list.',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Task description',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Task status',
            },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const todos = args.todos as Array<{ content?: string; name?: string; title?: string; task?: string; status: string }>;
    const sessionId = context.sessionId || 'default';

    if (!Array.isArray(todos)) {
      return {
        content: 'Invalid input: todos must be an array',
        isError: true,
      };
    }

    // Replace the entire todo list
    // Accept content, name, title, or task as the description (models use different names)
    const newTodos: TodoItem[] = todos.map((t) => ({
      id: generateId(),
      content: t.content || t.name || t.title || t.task || 'Untitled task',
      status: t.status as 'pending' | 'in_progress' | 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    todoStore.set(sessionId, newTodos);

    // Format output
    const pending = newTodos.filter(t => t.status === 'pending');
    const inProgress = newTodos.filter(t => t.status === 'in_progress');
    const completed = newTodos.filter(t => t.status === 'completed');

    let output = `Task List Updated (${newTodos.length} items)\n${'─'.repeat(50)}\n`;

    if (inProgress.length > 0) {
      output += '\n🔄 In Progress:\n';
      inProgress.forEach(t => {
        output += `   • ${t.content}\n`;
      });
    }

    if (pending.length > 0) {
      output += '\n⏳ Pending:\n';
      pending.forEach(t => {
        output += `   • ${t.content}\n`;
      });
    }

    if (completed.length > 0) {
      output += '\n✅ Completed:\n';
      completed.forEach(t => {
        output += `   • ${t.content}\n`;
      });
    }

    return {
      content: output,
      metadata: {
        total: newTodos.length,
        pending: pending.length,
        inProgress: inProgress.length,
        completed: completed.length,
      },
    };
  },
};

/**
 * Todo Read Tool - View current task list
 */
export const todoReadTool: ToolDefinition = {
  name: 'todo_read',
  description: `Read the current task list to see progress on the current work.`,
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolOutput> => {
    const sessionId = context.sessionId || 'default';
    const todos = getSessionTodos(sessionId);

    if (todos.length === 0) {
      return {
        content: 'No tasks in the list.',
      };
    }

    const pending = todos.filter(t => t.status === 'pending');
    const inProgress = todos.filter(t => t.status === 'in_progress');
    const completed = todos.filter(t => t.status === 'completed');

    let output = `Current Task List (${todos.length} items)\n${'─'.repeat(50)}\n`;

    if (inProgress.length > 0) {
      output += '\n🔄 In Progress:\n';
      inProgress.forEach(t => {
        output += `   • ${t.content}\n`;
      });
    }

    if (pending.length > 0) {
      output += '\n⏳ Pending:\n';
      pending.forEach(t => {
        output += `   • ${t.content}\n`;
      });
    }

    if (completed.length > 0) {
      output += '\n✅ Completed:\n';
      completed.forEach(t => {
        output += `   • ${t.content}\n`;
      });
    }

    return {
      content: output,
      metadata: {
        total: todos.length,
        pending: pending.length,
        inProgress: inProgress.length,
        completed: completed.length,
      },
    };
  },
};
