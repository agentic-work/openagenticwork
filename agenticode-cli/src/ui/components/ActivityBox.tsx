/**
 * ActivityBox Component - Redesigned
 * Compact, fixed-height activity indicator above the input
 * Clean, subtle styling - similar to agenticwork's activity display
 */

import React from 'react';
import { Box, Text } from 'ink';

// Nerd Font icons - minimal set
const ICONS = {
  thinking: '\uf110',      // nf-fa-spinner
  reading: '\uf02d',       // nf-fa-book
  writing: '\uf044',       // nf-fa-pencil
  searching: '\uf002',     // nf-fa-search
  executing: '\uf120',     // nf-fa-terminal
  analyzing: '\uf085',     // nf-fa-cogs
  planning: '\uf0ae',      // nf-fa-tasks
  waiting: '\uf017',       // nf-fa-clock_o
  done: '\uf00c',          // nf-fa-check
  error: '\uf00d',         // nf-fa-times
};

export type ActivityType =
  | 'thinking'
  | 'reading'
  | 'writing'
  | 'searching'
  | 'executing'
  | 'analyzing'
  | 'planning'
  | 'waiting'
  | 'done'
  | 'error';

export interface Activity {
  type: ActivityType;
  description: string;
  detail?: string;
  progress?: number;  // 0-100 for progress bar
}

interface ActivityBoxProps {
  activities: Activity[];
  currentThought?: string;  // What the AI is currently thinking
}

// Subtle, professional color palette - dimmed for less visual noise
const ACTIVITY_COLORS: Record<ActivityType, string> = {
  thinking: '#6B7280',   // gray-500
  reading: '#6B7280',    // gray-500
  writing: '#9CA3AF',    // gray-400
  searching: '#6B7280',  // gray-500
  executing: '#9CA3AF',  // gray-400
  analyzing: '#6B7280',  // gray-500
  planning: '#6B7280',   // gray-500
  waiting: '#4B5563',    // gray-600
  done: '#10B981',       // emerald-500
  error: '#EF4444',      // red-500
};

export const ActivityBox: React.FC<ActivityBoxProps> = ({ activities, currentThought }) => {
  if (activities.length === 0 && !currentThought) {
    return null;
  }

  // Get the most recent activity (or thinking state)
  const latestActivity = activities[activities.length - 1];
  const displayText = currentThought
    ? currentThought.length > 70 ? currentThought.substring(0, 67) + '...' : currentThought
    : latestActivity?.description || 'Processing...';

  const activityType = latestActivity?.type || 'thinking';
  const icon = ICONS[activityType];
  const color = ACTIVITY_COLORS[activityType];

  // Compact, single-line display - no border, just a subtle indicator
  return (
    <Box height={2} flexShrink={0} marginTop={1}>
      <Box>
        <Text color={color} dimColor>
          {icon}{' '}
        </Text>
        <Text color="#6B7280" dimColor>
          {displayText}
        </Text>
        {latestActivity?.detail && (
          <Text color="#4B5563" dimColor>
            {' '}- {latestActivity.detail.length > 40 ? latestActivity.detail.substring(0, 37) + '...' : latestActivity.detail}
          </Text>
        )}
      </Box>
    </Box>
  );
};

export default ActivityBox;
