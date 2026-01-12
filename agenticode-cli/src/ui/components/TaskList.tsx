/**
 * TaskList Component
 * Displays the LLM's collected tasks/todos
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface Task {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

interface TaskListProps {
  tasks: Task[];
  title?: string;
}

// Nerd Font icons (from Menlo Nerd Font / any Nerd Font patched font)
const STATUS_ICONS: Record<Task['status'], string> = {
  pending: '\uf111',      // nf-fa-circle (hollow dot)
  in_progress: '\uf110',  // nf-fa-spinner
  completed: '\uf00c',    // nf-fa-check
  failed: '\uf00d',       // nf-fa-times / x mark
};

const STATUS_COLORS: Record<Task['status'], string> = {
  pending: '#6B7280',
  in_progress: '#3B82F6',
  completed: '#10B981',
  failed: '#EF4444',
};

export const TaskList: React.FC<TaskListProps> = ({ tasks, title = 'Tasks' }) => {
  if (tasks.length === 0) return null;

  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3B82F6"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text color="#3B82F6" bold>{title}</Text>
        <Text color="#6B7280">{completed}/{total}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {tasks.map((task, i) => (
          <Box key={task.id || i}>
            <Text color={STATUS_COLORS[task.status]}>
              {STATUS_ICONS[task.status]}{' '}
            </Text>
            <Text
              color={task.status === 'completed' ? '#6B7280' : '#E5E7EB'}
              strikethrough={task.status === 'completed'}
            >
              {task.content}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default TaskList;
