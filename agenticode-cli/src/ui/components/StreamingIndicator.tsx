/**
 * StreamingIndicator Component
 * Shows a blinking cursor while content is being generated
 */

import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface StreamingIndicatorProps {
  active: boolean;
  color?: string;
}

export const StreamingIndicator: React.FC<StreamingIndicatorProps> = ({
  active,
  color = '#3B82F6',
}) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      setVisible(prev => !prev);
    }, 500);

    return () => clearInterval(interval);
  }, [active]);

  if (!active) return null;

  return <Text color={color}>{visible ? '▌' : ' '}</Text>;
};

export default StreamingIndicator;
