/**
 * Inline Thinking Block Component
 * Displays LLM thinking blocks (<tool_code>) in a collapsible UI similar to ThinkingAnimation
 * Uses think.svg with gentle animation for the thinking indicator
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from '@/shared/icons';

// Animated thinking icon using think.svg
const ThinkingIcon: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <motion.div
    animate={{
      scale: [1, 1.05, 1],
      filter: [
        'drop-shadow(0 0 2px rgba(99, 102, 241, 0.3))',
        'drop-shadow(0 0 6px rgba(99, 102, 241, 0.6))',
        'drop-shadow(0 0 2px rgba(99, 102, 241, 0.3))',
      ],
    }}
    transition={{
      duration: 2,
      repeat: Infinity,
      ease: 'easeInOut',
    }}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
    }}
  >
    <img
      src="/think.svg"
      alt="Thinking"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      }}
    />
  </motion.div>
);

interface InlineThinkingBlockProps {
  content: string;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export const InlineThinkingBlock: React.FC<InlineThinkingBlockProps> = ({
  content,
  isExpanded: externalIsExpanded,
  onToggle: externalOnToggle
}) => {
  const [internalIsExpanded, setInternalIsExpanded] = useState(false);

  // Use external state if provided, otherwise use internal state
  const isExpanded = externalIsExpanded !== undefined ? externalIsExpanded : internalIsExpanded;
  const handleToggle = externalOnToggle || (() => setInternalIsExpanded(!internalIsExpanded));

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      className="inline-thinking-block"
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '8px',
        backgroundColor: 'var(--color-surfaceHover)',
        border: '1px solid var(--color-border)',
        marginBottom: '12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}
    >
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 14px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left'
        }}
      >
        {/* Thinking icon with pulse animation */}
        <ThinkingIcon size={28} />

        {/* Status text */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--color-text)'
          }}>
            LLM Thinking
          </div>
          <div style={{
            fontSize: '11px',
            color: 'var(--color-textSecondary)'
          }}>
            {isExpanded ? 'Click to collapse' : 'Click to expand'}
          </div>
        </div>

        {/* Expand/collapse icon */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-textSecondary)'
          }}
        >
          <ChevronDown size={18} />
        </motion.div>
      </button>

      {/* Collapsible content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              overflow: 'hidden'
            }}
          >
            <div style={{
              padding: '12px 14px',
              borderTop: '1px solid var(--color-border)',
              fontSize: '12px',
              color: 'var(--color-textSecondary)',
              fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
              whiteSpace: 'pre-wrap',
              lineHeight: '1.6',
              maxHeight: '400px',
              overflowY: 'auto'
            }}>
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default InlineThinkingBlock;
