/**
 * AWCode Theme Colors
 * Cyberpunk-inspired color palette for the CLI
 */

export const colors = {
  // Primary brand colors
  primary: '#00ff88',      // Neon green
  primaryDim: '#00cc6a',
  secondary: '#00d4ff',    // Cyan
  accent: '#ff00ff',       // Magenta

  // Semantic colors
  success: '#00ff88',
  error: '#ff4444',
  warning: '#ffaa00',
  info: '#00d4ff',

  // UI colors
  background: '#0a0a0f',
  surface: '#14141f',
  border: '#2a2a3f',
  borderFocus: '#00ff88',

  // Text colors
  text: '#e0e0e0',
  textMuted: '#666680',
  textBright: '#ffffff',

  // Syntax highlighting
  keyword: '#ff79c6',
  string: '#f1fa8c',
  number: '#bd93f9',
  comment: '#6272a4',
  function: '#50fa7b',
  variable: '#8be9fd',

  // Gradients (for ASCII art)
  gradient: ['#00ff88', '#00d4ff', '#ff00ff'],
};

// ANSI color codes for terminal
export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  green: '\x1b[38;2;0;255;136m',
  cyan: '\x1b[38;2;0;212;255m',
  magenta: '\x1b[38;2;255;0;255m',
  red: '\x1b[38;2;255;68;68m',
  yellow: '\x1b[38;2;255;170;0m',
  white: '\x1b[38;2;224;224;224m',
  gray: '\x1b[38;2;102;102;128m',
};
