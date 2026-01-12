/**
 * FullScreen Component
 * Properly handles alternate screen buffer for full-screen terminal apps
 *
 * This prevents ghosting by:
 * 1. Using React's useEffect to manage screen buffer lifecycle
 * 2. Clearing the alternate screen on every render cycle
 * 3. Properly restoring terminal state on unmount
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Box, useStdout } from 'ink';

// ANSI escape sequences
const ENTER_ALT_SCREEN = '\x1b[?1049h';  // Switch to alternate screen buffer
const LEAVE_ALT_SCREEN = '\x1b[?1049l';  // Switch back to main screen buffer
const CLEAR_SCREEN = '\x1b[2J';          // Clear entire screen
const CURSOR_HOME = '\x1b[H';            // Move cursor to top-left
const HIDE_CURSOR = '\x1b[?25l';         // Hide cursor
const SHOW_CURSOR = '\x1b[?25h';         // Show cursor
const RESET_SCROLL_REGION = '\x1b[r';    // Reset scroll region to full screen

interface FullScreenProps {
  children: React.ReactNode;
}

export const FullScreen: React.FC<FullScreenProps> = ({ children }) => {
  const { stdout } = useStdout();
  const isInitialized = useRef(false);

  // Use layoutEffect to run synchronously before browser paint
  // This prevents any flicker on initial render
  useLayoutEffect(() => {
    if (!stdout || isInitialized.current) return;

    isInitialized.current = true;

    // Enter alternate screen buffer with full setup
    stdout.write(ENTER_ALT_SCREEN);
    stdout.write(CLEAR_SCREEN);
    stdout.write(CURSOR_HOME);
    stdout.write(RESET_SCROLL_REGION);

    // Cleanup on unmount - restore main screen
    return () => {
      stdout.write(SHOW_CURSOR);
      stdout.write(LEAVE_ALT_SCREEN);
    };
  }, [stdout]);

  // Clear screen before each render to prevent ghosting
  // This is the key to preventing artifacts during streaming
  useEffect(() => {
    if (!stdout) return;

    // Position cursor at top without clearing content
    // (Ink will handle rendering the actual content)
    stdout.write(CURSOR_HOME);
  });

  const rows = stdout?.rows || 24;
  const columns = stdout?.columns || 80;

  return (
    <Box
      flexDirection="column"
      height={rows}
      width={columns}
    >
      {children}
    </Box>
  );
};

export default FullScreen;
