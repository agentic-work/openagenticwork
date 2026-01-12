/**
 * useAlternateBuffer Hook
 *
 * Enables alternate screen buffer mode for Ink applications.
 * This prevents ghosting and terminal history pollution by rendering
 * in a separate terminal buffer (like vim, less, or nano).
 *
 * When the app exits, the original terminal content is restored.
 */

import { useEffect, useRef } from 'react';

// ANSI escape code building block
const ESC = '\x1b';

// Alternate screen buffer control
const ENTER_ALT_SCREEN = `${ESC}[?1049h`;
const LEAVE_ALT_SCREEN = `${ESC}[?1049l`;

// Cursor visibility
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

// Mouse event support (SGR extended mode for wider coordinates)
const ENABLE_MOUSE = `${ESC}[?1000h${ESC}[?1002h${ESC}[?1015h${ESC}[?1006h`;
const DISABLE_MOUSE = `${ESC}[?1006l${ESC}[?1015l${ESC}[?1002l${ESC}[?1000l`;

// Clear screen
const CLEAR_SCREEN = `${ESC}[2J`;
const MOVE_HOME = `${ESC}[H`;

export interface AlternateBufferOptions {
  /**
   * Whether to enable the alternate buffer (default: true)
   */
  enabled?: boolean;

  /**
   * Whether to enable mouse event tracking (default: false)
   * Note: Mouse tracking can interfere with terminal copy/paste
   */
  enableMouse?: boolean;

  /**
   * Whether to hide the cursor initially (default: false)
   */
  hideCursor?: boolean;

  /**
   * Whether to clear the screen on enter (default: true)
   */
  clearOnEnter?: boolean;
}

/**
 * Hook to enable alternate screen buffer mode.
 *
 * Features:
 * - Enters alternate screen buffer on mount
 * - Restores original buffer on unmount
 * - Optionally enables mouse tracking
 * - Handles Ctrl+C and other exit signals
 *
 * @example
 * ```typescript
 * function App() {
 *   useAlternateBuffer({ enabled: true });
 *   return <Box>Content renders in alternate buffer</Box>;
 * }
 * ```
 */
export function useAlternateBuffer(options: AlternateBufferOptions = {}): void {
  const {
    enabled = true,
    enableMouse = false,
    hideCursor = false,
    clearOnEnter = true,
  } = options;

  const isEnteredRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // Enter alternate screen buffer
    let enterSequence = ENTER_ALT_SCREEN;

    if (clearOnEnter) {
      enterSequence += CLEAR_SCREEN + MOVE_HOME;
    }

    if (hideCursor) {
      enterSequence += HIDE_CURSOR;
    }

    if (enableMouse) {
      enterSequence += ENABLE_MOUSE;
    }

    process.stdout.write(enterSequence);
    isEnteredRef.current = true;

    // Build exit sequence
    const exitSequence = () => {
      if (!isEnteredRef.current) return;

      let sequence = '';

      if (enableMouse) {
        sequence += DISABLE_MOUSE;
      }

      if (hideCursor) {
        sequence += SHOW_CURSOR;
      }

      sequence += LEAVE_ALT_SCREEN;

      process.stdout.write(sequence);
      isEnteredRef.current = false;
    };

    // Handle various exit signals
    const handleExit = () => {
      exitSequence();
    };

    // Graceful exit handlers
    process.on('exit', handleExit);
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
    process.on('SIGHUP', handleExit);

    // Handle uncaught exceptions to ensure terminal is restored
    const handleUncaughtException = (err: Error) => {
      exitSequence();
      console.error('Uncaught exception:', err);
      process.exit(1);
    };

    process.on('uncaughtException', handleUncaughtException);

    // Cleanup on unmount
    return () => {
      exitSequence();
      process.off('exit', handleExit);
      process.off('SIGINT', handleExit);
      process.off('SIGTERM', handleExit);
      process.off('SIGHUP', handleExit);
      process.off('uncaughtException', handleUncaughtException);
    };
  }, [enabled, enableMouse, hideCursor, clearOnEnter]);
}

/**
 * Low-level function to manually enter alternate buffer
 * Use this if you need more control than the hook provides
 */
export function enterAlternateBuffer(options: Omit<AlternateBufferOptions, 'enabled'> = {}): void {
  const { enableMouse = false, hideCursor = false, clearOnEnter = true } = options;

  let sequence = ENTER_ALT_SCREEN;

  if (clearOnEnter) {
    sequence += CLEAR_SCREEN + MOVE_HOME;
  }

  if (hideCursor) {
    sequence += HIDE_CURSOR;
  }

  if (enableMouse) {
    sequence += ENABLE_MOUSE;
  }

  process.stdout.write(sequence);
}

/**
 * Low-level function to manually leave alternate buffer
 */
export function leaveAlternateBuffer(options: { enableMouse?: boolean; hideCursor?: boolean } = {}): void {
  const { enableMouse = false, hideCursor = false } = options;

  let sequence = '';

  if (enableMouse) {
    sequence += DISABLE_MOUSE;
  }

  if (hideCursor) {
    sequence += SHOW_CURSOR;
  }

  sequence += LEAVE_ALT_SCREEN;

  process.stdout.write(sequence);
}

export default useAlternateBuffer;
