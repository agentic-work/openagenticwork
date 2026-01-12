/**
 * StreamingActivityIndicator - Agenticode Style Status Display
 *
 * Shows activity state with fun, quirky messages:
 * - "* Pontificating..." (thinking)
 * - "* Booping..." (working)
 * - "* Scribbling█" (streaming with cursor)
 *
 * Features:
 * - Orange asterisk prefix
 * - Rotating fun messages
 * - Blinking block cursor for streaming
 * - Shimmer animation during activity
 * - Smooth transitions between states
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ActivityState } from '@/stores/useCodeModeStore';

// =============================================================================
// Types
// =============================================================================

interface StreamingActivityIndicatorProps {
  state: ActivityState;
  streamingText?: string;
  customMessage?: string;
  showCursor?: boolean;
}

// =============================================================================
// Fun Activity Messages
// =============================================================================

const THINKING_MESSAGES = [
  'Pontificating',
  'Contemplating',
  'Ruminating',
  'Cogitating',
  'Musing',
  'Deliberating',
  'Mulling it over',
  'Deep in thought',
  'Pondering',
  'Reflecting',
];

const WORKING_MESSAGES = [
  'Booping',
  'Tinkering',
  'Crafting',
  'Assembling',
  'Conjuring',
  'Weaving',
  'Brewing',
  'Cooking up',
  'Whipping up',
  'Orchestrating',
];

const STREAMING_MESSAGES = [
  'Scribbling',
  'Writing',
  'Typing',
  'Composing',
  'Drafting',
  'Penning',
  'Jotting',
];

const TOOL_MESSAGES = [
  'Executing',
  'Running',
  'Processing',
  'Computing',
  'Crunching',
  'Analyzing',
  'Fetching',
];

const getMessagesForState = (state: ActivityState): string[] => {
  switch (state) {
    case 'thinking':
      return THINKING_MESSAGES;
    case 'streaming':
      return STREAMING_MESSAGES;
    case 'tool_calling':
    case 'tool_executing':
      return TOOL_MESSAGES;
    default:
      return WORKING_MESSAGES;
  }
};

// =============================================================================
// Blinking Cursor Component
// =============================================================================

const BlinkingCursor: React.FC = () => (
  <motion.span
    initial={{ opacity: 1 }}
    animate={{ opacity: [1, 0, 1] }}
    transition={{
      duration: 1,
      repeat: Infinity,
      ease: 'steps(2)',
    }}
    className="inline-block w-[8px] h-[14px] bg-[var(--color-primary)] ml-0.5 align-middle"
    style={{ marginBottom: '2px' }}
  />
);

// =============================================================================
// Shimmer Effect Component
// =============================================================================

const ShimmerEffect: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="relative inline-block overflow-hidden">
    {children}
    <motion.span
      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
      initial={{ x: '-100%' }}
      animate={{ x: '200%' }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: 'linear',
      }}
    />
  </span>
);

// =============================================================================
// Dots Animation Component
// =============================================================================

const AnimatedDots: React.FC = () => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="inline-block w-[18px] text-left">
      {dots}
    </span>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const StreamingActivityIndicator: React.FC<StreamingActivityIndicatorProps> = ({
  state,
  streamingText,
  customMessage,
  showCursor = true,
}) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const messages = useMemo(() => getMessagesForState(state), [state]);

  // Rotate through messages every few seconds
  useEffect(() => {
    if (state === 'idle' || state === 'complete') return;

    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [state, messages.length]);

  // Reset message index when state changes
  useEffect(() => {
    setMessageIndex(Math.floor(Math.random() * messages.length));
  }, [state, messages.length]);

  // Don't show for idle/complete states
  if (state === 'idle' || state === 'complete') {
    return null;
  }

  const displayMessage = customMessage || messages[messageIndex];
  const isStreaming = state === 'streaming';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.2 }}
        className="flex items-center gap-1 py-2 font-mono text-[13px]"
      >
        {/* Orange asterisk */}
        <motion.span
          className="text-[var(--accent-warning)] font-bold"
          animate={
            state === 'thinking'
              ? {
                  rotate: [0, 5, -5, 0],
                  scale: [1, 1.1, 1],
                }
              : {}
          }
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          *
        </motion.span>

        {/* Message with optional shimmer */}
        <span className="text-[var(--accent-warning)]">
          {state === 'thinking' ? (
            <ShimmerEffect>
              <motion.span
                key={displayMessage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                {displayMessage}
              </motion.span>
            </ShimmerEffect>
          ) : (
            <motion.span
              key={displayMessage}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {displayMessage}
            </motion.span>
          )}

          {/* Animated dots or cursor */}
          {isStreaming && showCursor ? (
            <BlinkingCursor />
          ) : (
            <AnimatedDots />
          )}
        </span>
      </motion.div>
    </AnimatePresence>
  );
};

// =============================================================================
// Compact Inline Version (for showing at end of streaming text)
// =============================================================================

export const InlineStreamingCursor: React.FC<{
  isVisible: boolean;
}> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="inline-block"
    >
      <BlinkingCursor />
    </motion.span>
  );
};

// =============================================================================
// Status Pill Version (for headers)
// =============================================================================

export const ActivityStatusPill: React.FC<{
  state: ActivityState;
  message?: string;
}> = ({ state, message }) => {
  if (state === 'idle' || state === 'complete') return null;

  const messages = getMessagesForState(state);
  const displayMessage = message || messages[0];

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium font-mono
        bg-[var(--accent-warning)]/20 text-[var(--accent-warning)]
        ring-1 ring-[var(--accent-warning)]/30
      `}
    >
      {/* Spinner or pulse */}
      <motion.span
        animate={{
          rotate: state === 'tool_executing' ? 360 : 0,
          scale: state === 'thinking' ? [1, 1.2, 1] : 1,
        }}
        transition={{
          duration: state === 'tool_executing' ? 1 : 2,
          repeat: Infinity,
          ease: state === 'tool_executing' ? 'linear' : 'easeInOut',
        }}
        className="text-[10px]"
      >
        ◆
      </motion.span>

      <span>{displayMessage}</span>
      <AnimatedDots />
    </motion.div>
  );
};

export default StreamingActivityIndicator;
