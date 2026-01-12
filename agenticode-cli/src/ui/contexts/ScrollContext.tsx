/**
 * ScrollContext
 *
 * Provides scroll management for Ink applications.
 * Enables scrolling through message history with keyboard controls.
 *
 * Based on Gemini CLI's ScrollProvider pattern.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useStdout, useInput } from 'ink';

export interface ScrollState {
  /** Current scroll position (lines from top) */
  scrollY: number;
  /** Maximum scrollable amount */
  maxScroll: number;
  /** Visible viewport height in lines */
  viewportHeight: number;
  /** Total content height in lines */
  contentHeight: number;
  /** Whether user is at the bottom (auto-scroll enabled) */
  isAtBottom: boolean;
}

export interface ScrollContextValue extends ScrollState {
  /** Set scroll position directly */
  setScrollY: (y: number) => void;
  /** Scroll up by N lines (default: 1) */
  scrollUp: (lines?: number) => void;
  /** Scroll down by N lines (default: 1) */
  scrollDown: (lines?: number) => void;
  /** Scroll to top of content */
  scrollToTop: () => void;
  /** Scroll to bottom of content */
  scrollToBottom: () => void;
  /** Update content height (call when content changes) */
  setContentHeight: (height: number) => void;
  /** Page up (viewport height - 2 lines) */
  pageUp: () => void;
  /** Page down (viewport height - 2 lines) */
  pageDown: () => void;
}

const ScrollContext = createContext<ScrollContextValue | null>(null);

export interface ScrollProviderProps {
  children: React.ReactNode;
  /**
   * Whether to enable keyboard scroll controls
   * @default true
   */
  enableKeyboardScroll?: boolean;
  /**
   * Whether to auto-scroll to bottom on new content
   * @default true
   */
  autoScrollToBottom?: boolean;
  /**
   * Fixed height for viewport (if not using terminal height)
   */
  fixedHeight?: number;
  /**
   * Reserve lines for fixed elements (input, status bar)
   * @default 5
   */
  reservedLines?: number;
}

export function ScrollProvider({
  children,
  enableKeyboardScroll = true,
  autoScrollToBottom = true,
  fixedHeight,
  reservedLines = 5,
}: ScrollProviderProps) {
  const { stdout } = useStdout();

  // Calculate viewport height
  const viewportHeight = useMemo(() => {
    if (fixedHeight) return fixedHeight;
    const terminalHeight = stdout?.rows || 24;
    return Math.max(1, terminalHeight - reservedLines);
  }, [fixedHeight, stdout?.rows, reservedLines]);

  const [state, setState] = useState<ScrollState>({
    scrollY: 0,
    maxScroll: 0,
    viewportHeight,
    contentHeight: 0,
    isAtBottom: true,
  });

  // Update viewport height when terminal resizes
  useEffect(() => {
    setState(prev => ({
      ...prev,
      viewportHeight,
      maxScroll: Math.max(0, prev.contentHeight - viewportHeight),
    }));
  }, [viewportHeight]);

  // Scroll functions
  const scrollUp = useCallback((lines = 1) => {
    setState(prev => {
      const newScrollY = Math.max(0, prev.scrollY - lines);
      return {
        ...prev,
        scrollY: newScrollY,
        isAtBottom: newScrollY >= prev.maxScroll,
      };
    });
  }, []);

  const scrollDown = useCallback((lines = 1) => {
    setState(prev => {
      const newScrollY = Math.min(prev.maxScroll, prev.scrollY + lines);
      return {
        ...prev,
        scrollY: newScrollY,
        isAtBottom: newScrollY >= prev.maxScroll,
      };
    });
  }, []);

  const scrollToTop = useCallback(() => {
    setState(prev => ({
      ...prev,
      scrollY: 0,
      isAtBottom: prev.maxScroll === 0,
    }));
  }, []);

  const scrollToBottom = useCallback(() => {
    setState(prev => ({
      ...prev,
      scrollY: prev.maxScroll,
      isAtBottom: true,
    }));
  }, []);

  const setScrollY = useCallback((y: number) => {
    setState(prev => {
      const clampedY = Math.max(0, Math.min(prev.maxScroll, y));
      return {
        ...prev,
        scrollY: clampedY,
        isAtBottom: clampedY >= prev.maxScroll,
      };
    });
  }, []);

  const setContentHeight = useCallback((height: number) => {
    setState(prev => {
      const newMaxScroll = Math.max(0, height - prev.viewportHeight);
      const wasAtBottom = prev.isAtBottom;

      // Auto-scroll to bottom if we were at bottom
      const newScrollY = wasAtBottom && autoScrollToBottom
        ? newMaxScroll
        : Math.min(prev.scrollY, newMaxScroll);

      return {
        ...prev,
        contentHeight: height,
        maxScroll: newMaxScroll,
        scrollY: newScrollY,
        isAtBottom: newScrollY >= newMaxScroll,
      };
    });
  }, [autoScrollToBottom]);

  const pageUp = useCallback(() => {
    scrollUp(Math.max(1, state.viewportHeight - 2));
  }, [scrollUp, state.viewportHeight]);

  const pageDown = useCallback(() => {
    scrollDown(Math.max(1, state.viewportHeight - 2));
  }, [scrollDown, state.viewportHeight]);

  // Handle keyboard scrolling
  useInput((input, key) => {
    if (!enableKeyboardScroll) return;

    // Vim-style navigation
    if (key.upArrow || input === 'k') {
      scrollUp();
    } else if (key.downArrow || input === 'j') {
      scrollDown();
    } else if (key.pageUp) {
      pageUp();
    } else if (key.pageDown) {
      pageDown();
    }

    // Additional shortcuts
    if (input === 'g') {
      scrollToTop();
    } else if (input === 'G') {
      scrollToBottom();
    }
  }, { isActive: enableKeyboardScroll });

  const contextValue = useMemo<ScrollContextValue>(() => ({
    ...state,
    setScrollY,
    scrollUp,
    scrollDown,
    scrollToTop,
    scrollToBottom,
    setContentHeight,
    pageUp,
    pageDown,
  }), [
    state,
    setScrollY,
    scrollUp,
    scrollDown,
    scrollToTop,
    scrollToBottom,
    setContentHeight,
    pageUp,
    pageDown,
  ]);

  return (
    <ScrollContext.Provider value={contextValue}>
      {children}
    </ScrollContext.Provider>
  );
}

/**
 * Hook to access scroll context
 * @throws Error if used outside ScrollProvider
 */
export function useScroll(): ScrollContextValue {
  const context = useContext(ScrollContext);
  if (!context) {
    throw new Error('useScroll must be used within a ScrollProvider');
  }
  return context;
}

/**
 * Hook to access scroll context (returns null if not in provider)
 */
export function useScrollSafe(): ScrollContextValue | null {
  return useContext(ScrollContext);
}

export default ScrollProvider;
