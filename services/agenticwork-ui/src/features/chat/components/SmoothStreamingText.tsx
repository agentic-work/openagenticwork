/**
 * Smooth Streaming Text Component
 * Provides typewriter-style animation for streaming chat messages
 * Features: Configurable typing speed, smooth character-by-character display, animation controls
 * @see docs/chat/text-animation.md
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SmoothStreamingTextProps {
  content: string;
  className?: string;
  typingSpeed?: number; // Characters per second
  enableAnimation?: boolean;
}

export const SmoothStreamingText: React.FC<SmoothStreamingTextProps> = ({
  content,
  className = '',
  typingSpeed = 60, // 60 chars per second - faster, more responsive (ChatGPT-like)
  enableAnimation = true
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const contentRef = useRef(content);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // If animation is disabled, just show the content
    if (!enableAnimation) {
      setDisplayedContent(content);
      return;
    }

    // CRITICAL FIX: If content is empty, immediately clear and stop typing
    if (content.length === 0) {
      indexRef.current = 0;
      setDisplayedContent('');
      setIsTyping(false);
      return;
    }

    // If content is longer than what we're displaying, continue typing
    if (content.length > indexRef.current) {
      setIsTyping(true);
      // Don't reset the typing animation, just continue from where we are
      if (!timeoutRef.current) {
        typeNextCharacters();
      }
    }
    // If content is exactly what we've displayed, we're done
    else if (content.length === indexRef.current) {
      setIsTyping(false);
    }
    // If content is shorter (shouldn't happen in streaming), reset
    else if (content.length < indexRef.current) {
      indexRef.current = 0;
      setDisplayedContent('');
      setIsTyping(false); // FIX: Don't start typing empty content
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, enableAnimation]);

  const typeNextCharacters = () => {
    const charsPerStep = Math.max(1, Math.floor(typingSpeed / 30)); // 30 steps per second for smoother animation
    const delay = 1000 / 30; // ~33ms between updates for smoother flow
    
    const nextIndex = Math.min(indexRef.current + charsPerStep, content.length);
    const nextContent = content.slice(0, nextIndex);
    
    setDisplayedContent(nextContent);
    indexRef.current = nextIndex;

    if (nextIndex < content.length) {
      timeoutRef.current = setTimeout(typeNextCharacters, delay);
    } else {
      setIsTyping(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="max-w-none prose-sm-tight" style={{ color: 'var(--color-text)' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {displayedContent}
        </ReactMarkdown>
      </div>
      {isTyping && enableAnimation && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
          className="inline-block w-0.5 h-4 bg-current ml-0.5"
        />
      )}
    </div>
  );
};