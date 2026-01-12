/**
 * AWCode Banner Component
 * Displays the CLI header with smooth gradient text
 */

import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../themes/colors.js';

/**
 * Generate smooth gradient colors between two hex colors
 */
function interpolateColor(color1: string, color2: string, factor: number): string {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);

  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Generate a smooth gradient across multiple colors
 */
function generateGradient(colorStops: string[], steps: number): string[] {
  if (steps <= 1) return [colorStops[0]];
  if (colorStops.length === 1) return Array(steps).fill(colorStops[0]);

  const result: string[] = [];
  const segmentLength = (steps - 1) / (colorStops.length - 1);

  for (let i = 0; i < steps; i++) {
    const segmentIndex = Math.min(Math.floor(i / segmentLength), colorStops.length - 2);
    const segmentProgress = (i - segmentIndex * segmentLength) / segmentLength;
    result.push(interpolateColor(colorStops[segmentIndex], colorStops[segmentIndex + 1], segmentProgress));
  }

  return result;
}

// Modern gradient: purple -> blue -> cyan -> teal
const GRADIENT_STOPS = [
  '#9333EA',  // Purple
  '#6366F1',  // Indigo
  '#3B82F6',  // Blue
  '#06B6D4',  // Cyan
  '#14B8A6',  // Teal
];

interface BannerProps {
  version: string;
  model: string;
  workingDir: string;
  minimal?: boolean;
}

export const Banner: React.FC<BannerProps> = ({
  version,
  model,
  workingDir,
  minimal = false,
}) => {
  const text = 'agenticwork';
  const gradientColors = generateGradient(GRADIENT_STOPS, text.length);

  if (minimal) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          {text.split('').map((char, i) => (
            <Text key={i} bold color={gradientColors[i]}>{char}</Text>
          ))}
          <Text color={colors.textMuted}> v{version}</Text>
          <Text color={colors.textMuted}> • </Text>
          <Text color={colors.secondary}>{model}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Main banner with smooth gradient */}
      <Box>
        <Text dimColor>(</Text>
        {text.split('').map((char, i) => (
          <Text key={i} bold color={gradientColors[i]}>{char}</Text>
        ))}
        <Text dimColor>)</Text>
      </Box>

      {/* Version and model info */}
      <Box>
        <Text color={colors.textMuted}>v{version}</Text>
        <Text color={colors.textMuted}> • </Text>
        <Text color={colors.secondary}>{model}</Text>
      </Box>
      <Box>
        <Text color={colors.textMuted}>{workingDir}</Text>
      </Box>
    </Box>
  );
};

export default Banner;
