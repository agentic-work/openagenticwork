/**
 * Enhanced Thinking Animation Component
 * Shows the thinking orb with individual thought steps below as glowing bullets
 * Each thought streams in and stacks downward
 */

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ThinkingAnimationProps {
  isThinking: boolean;
  thinkingTime?: number | null;
  message?: string;
  stage?: string;
  detail?: string;
  pipelineState?: {
    currentStage: string | null;
    stageStartTime: number | null;
    stageTiming: Record<string, number>;
    isToolExecutionPhase: boolean;
    activeToolRound: number;
    maxToolRounds: number;
    bufferedContent: string;
  };
  activeMcpCalls?: Array<{
    tool: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    timestamp: number;
    request?: any;
    response?: any;
  }>;
  thinkingMetrics?: {
    tokens: number;
    elapsedMs: number;
    tokensPerSecond: number;
  } | null;
  thinkingContent?: string;
  isCompleted?: boolean;
}

// Parse thinking content into individual thought steps
const parseThoughts = (content: string): string[] => {
  if (!content) return [];

  // Split on bold headers (common in Gemini thinking: **Header**)
  const boldMatches = content.match(/\*\*[^*]+\*\*/g);
  if (boldMatches && boldMatches.length > 1) {
    const parts = content.split(/(\*\*[^*]+\*\*)/);
    const thoughts: string[] = [];
    let currentThought = '';

    for (const part of parts) {
      if (part.match(/^\*\*[^*]+\*\*$/)) {
        if (currentThought.trim()) {
          thoughts.push(currentThought.trim());
        }
        currentThought = part;
      } else {
        currentThought += part;
      }
    }
    if (currentThought.trim()) {
      thoughts.push(currentThought.trim());
    }
    return thoughts.filter(t => t.length > 0);
  }

  // Split on double newlines
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
  if (paragraphs.length > 1) {
    return paragraphs;
  }

  // Single thought
  return content.trim() ? [content.trim()] : [];
};

// Quirky phrases for when model doesn't support thinking
const generateQuirkyPhrase = (): string => {
  const phrases = [
    'Processing your request',
    'Analyzing the problem',
    'Computing possibilities',
    'Synthesizing response',
    'Contemplating options',
    'Pondering deeply',
    'Orchestrating thoughts',
    'Calibrating response',
    'Assembling answer',
    'Evaluating approach',
    'Conjuring insights',
    'Weaving solution',
    'Reticulating splines',
    'Consulting the oracle',
    'Brewing ideas',
    'Summoning inspiration',
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
};

export const ThinkingAnimation: React.FC<ThinkingAnimationProps> = ({
  isThinking,
  thinkingTime = 0,
  pipelineState,
  activeMcpCalls,
  thinkingContent,
  isCompleted = false
}) => {
  const [dots, setDots] = useState('');
  const [quirkyPhrase, setQuirkyPhrase] = useState(() => generateQuirkyPhrase());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thoughtsContainerRef = useRef<HTMLDivElement>(null);

  const hasThinkingContent = Boolean(thinkingContent && thinkingContent.trim().length > 0);

  // Parse thoughts - these come from the accumulated thinking content
  const allThoughts = React.useMemo(() => parseThoughts(thinkingContent || ''), [thinkingContent]);

  // Auto-scroll thoughts container when new content arrives
  useEffect(() => {
    if (thoughtsContainerRef.current) {
      thoughtsContainerRef.current.scrollTop = thoughtsContainerRef.current.scrollHeight;
    }
  }, [allThoughts]);

  // Cycle quirky phrases when no thinking content
  useEffect(() => {
    if (!isThinking || hasThinkingContent) return;
    const interval = setInterval(() => {
      setQuirkyPhrase(generateQuirkyPhrase());
    }, 4000);
    return () => clearInterval(interval);
  }, [isThinking, hasThinkingContent]);

  // Animate dots
  useEffect(() => {
    if (!isThinking || hasThinkingContent) return;
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, [isThinking, hasThinkingContent]);

  // Canvas animation for the orb - larger 128x128 for crisp 64px display
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isCompleted || !isThinking) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Render at 2x for crisp display at 64px
    canvas.width = 128;
    canvas.height = 128;

    const centerX = 64;
    const centerY = 64;
    const globeRadius = 48;

    const colors = [
      { r: 100, g: 200, b: 255 },
      { r: 150, g: 100, b: 255 },
      { r: 255, g: 100, b: 180 },
      { r: 100, g: 255, b: 200 },
      { r: 255, g: 200, b: 100 }
    ];

    interface Sparkle {
      theta: number;
      phi: number;
      radius: number;
      speed: number;
      size: number;
      life: number;
      maxLife: number;
      color: { r: number; g: number; b: number };
    }

    const sparkles: Sparkle[] = [];
    for (let i = 0; i < 30; i++) {
      sparkles.push({
        theta: Math.random() * Math.PI * 2,
        phi: Math.random() * Math.PI,
        radius: Math.random() * globeRadius * 0.8,
        speed: 0.01 + Math.random() * 0.02,
        size: 1.5 + Math.random() * 3,
        life: Math.random(),
        maxLife: 0.5 + Math.random() * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }

    let time = 0;
    let rotation = 0;
    let animationId: number;

    function animate() {
      if (!ctx) return;

      time += 0.016;
      rotation += 0.02;

      ctx.clearRect(0, 0, 128, 128);

      const pulse = 0.9 + Math.sin(time * 2) * 0.1;
      const currentRadius = globeRadius * pulse;

      const globeGradient = ctx.createRadialGradient(
        centerX, centerY, currentRadius * 0.3,
        centerX, centerY, currentRadius
      );
      globeGradient.addColorStop(0, 'rgba(100, 200, 255, 0.15)');
      globeGradient.addColorStop(0.7, 'rgba(150, 100, 255, 0.2)');
      globeGradient.addColorStop(1, 'rgba(100, 200, 255, 0.35)');

      ctx.fillStyle = globeGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.fill();

      sparkles.forEach((sparkle) => {
        sparkle.theta += sparkle.speed;

        const x3d = sparkle.radius * Math.sin(sparkle.phi) * Math.cos(sparkle.theta + rotation);
        const y3d = sparkle.radius * Math.sin(sparkle.phi) * Math.sin(sparkle.theta + rotation);
        const z3d = sparkle.radius * Math.cos(sparkle.phi);

        const perspective = 150 / (150 + z3d);
        const x2d = centerX + x3d * perspective;
        const y2d = centerY + y3d * perspective * 0.8;

        const depthFactor = (z3d + globeRadius) / (globeRadius * 2);
        const size = sparkle.size * perspective * (0.5 + depthFactor * 0.5);

        sparkle.life += 0.02;
        if (sparkle.life > sparkle.maxLife) sparkle.life = 0;

        const twinkle = Math.sin(sparkle.life / sparkle.maxLife * Math.PI);
        const alpha = twinkle * (0.6 + depthFactor * 0.4);

        const c = sparkle.color;
        ctx.shadowBlur = size * 4;
        ctx.shadowColor = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x2d, y2d, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      ctx.strokeStyle = `rgba(100, 200, 255, ${0.4 + Math.sin(time * 3) * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.stroke();

      animationId = requestAnimationFrame(animate);
    }

    animate();
    return () => cancelAnimationFrame(animationId);
  }, [isThinking, isCompleted]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  if (!isThinking && !isCompleted) return null;

  // Only show timer if there's a meaningful time (more than 1 second)
  const hasTimer = thinkingTime && thinkingTime >= 1000;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
        maxWidth: '680px', // NARROWER than main content
        padding: '0',
        borderRadius: '16px',
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 6%, transparent) 0%, color-mix(in srgb, var(--color-secondary) 4%, transparent) 50%, color-mix(in srgb, var(--color-info) 6%, transparent) 100%)',
        border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 24px color-mix(in srgb, var(--color-primary) 8%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        overflow: 'hidden',
      }}
    >
      {/* Header with orb and status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        borderBottom: allThoughts.length > 0 ? '1px solid color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'none',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 4%, transparent) 0%, transparent 100%)',
      }}>
        {/* Animated orb - smaller 40px */}
        {isCompleted ? (
          <motion.svg
            width="40"
            height="40"
            viewBox="0 0 64 64"
            style={{ flexShrink: 0 }}
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
          >
            <defs>
              <radialGradient id="globe-grad-lg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(34, 197, 94, 0.2)" />
                <stop offset="70%" stopColor="rgba(34, 197, 94, 0.15)" />
                <stop offset="100%" stopColor="rgba(34, 197, 94, 0.3)" />
              </radialGradient>
            </defs>
            <circle cx="32" cy="32" r="28" fill="url(#globe-grad-lg)" />
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(34, 197, 94, 0.4)" strokeWidth="1.5" />
            <path d="M20 32 L28 40 L44 24" stroke="rgba(34, 197, 94, 0.9)" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </motion.svg>
        ) : (
          <canvas ref={canvasRef} width={128} height={128} style={{ width: '40px', height: '40px', flexShrink: 0 }} />
        )}

        {/* Status text */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontSize: '13px',
              fontWeight: 600,
              color: isCompleted ? 'var(--color-success)' : 'var(--color-primaryLight)',
              letterSpacing: '0.01em',
            }}>
              {isCompleted ? '✓ Reasoning Complete' : 'Reasoning'}
            </span>
            {hasTimer && (
              <span style={{
                fontSize: '11px',
                color: 'var(--color-textMuted)',
                padding: '2px 8px',
                borderRadius: '10px',
                background: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
                fontFamily: 'ui-monospace, monospace',
              }}>
                {formatTime(thinkingTime)}
              </span>
            )}
          </div>
          {!hasThinkingContent && isThinking && (
            <span style={{
              fontSize: '12px',
              color: 'var(--color-textMuted)',
              fontStyle: 'italic',
            }}>
              {quirkyPhrase}{dots}
            </span>
          )}
        </div>
      </div>

      {/* Thought steps - scrollable content area */}
      {allThoughts.length > 0 && (
        <div
          ref={thoughtsContainerRef}
          className="thinking-scrollbar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px 16px',
            maxHeight: isCompleted ? '400px' : '300px',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <AnimatePresence mode="sync">
            {allThoughts.map((thought, idx) => (
              <motion.div
                key={`thought-${idx}-${thought.slice(0, 20)}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.3) }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '6px 8px',
                  borderRadius: '8px',
                  background: idx === allThoughts.length - 1 && isThinking
                    ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)'
                    : 'transparent',
                  transition: 'background 0.2s ease',
                }}
              >
                {/* Glowing bullet with pulse */}
                <motion.div
                  animate={idx === allThoughts.length - 1 && isThinking ? {
                    scale: [1, 1.3, 1],
                    opacity: [0.8, 1, 0.8],
                  } : {}}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: idx === allThoughts.length - 1 && isThinking
                      ? 'var(--color-primary)'
                      : isCompleted
                        ? 'color-mix(in srgb, var(--color-success) 50%, transparent)'
                        : 'color-mix(in srgb, var(--color-primary) 35%, transparent)',
                    boxShadow: idx === allThoughts.length - 1 && isThinking
                      ? '0 0 8px color-mix(in srgb, var(--color-primary) 60%, transparent), 0 0 16px color-mix(in srgb, var(--color-primary) 30%, transparent)'
                      : 'none',
                    flexShrink: 0,
                    marginTop: '6px',
                  }}
                />

                {/* Thought text */}
                <div style={{
                  fontSize: '13px',
                  lineHeight: '1.65',
                  color: 'var(--color-text)',
                  flex: 1,
                  minWidth: 0,
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                }}>
                  {thought.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return (
                        <strong key={i} style={{
                          color: 'var(--color-primaryLight)',
                          fontWeight: 600,
                          background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                          padding: '1px 4px',
                          borderRadius: '4px',
                        }}>
                          {part.slice(2, -2)}
                        </strong>
                      );
                    }
                    return <span key={i}>{part}</span>;
                  })}
                  {idx === allThoughts.length - 1 && isThinking && (
                    <span className="thinking-cursor" style={{ color: 'var(--color-primary)' }}>▊</span>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Tool calls - integrated section */}
      {activeMcpCalls && activeMcpCalls.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '10px 16px 14px',
          borderTop: '1px solid color-mix(in srgb, var(--color-info) 10%, transparent)',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-info) 3%, transparent) 0%, transparent 100%)',
        }}>
          <div style={{
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--color-info)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            marginBottom: '4px',
          }}>
            ⚡ Tools
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {activeMcpCalls.map((call, idx) => (
              <motion.div
                key={`${call.tool}-${idx}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: call.status === 'completed'
                    ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
                    : call.status === 'failed'
                      ? 'color-mix(in srgb, var(--color-error) 10%, transparent)'
                      : call.status === 'running'
                        ? 'color-mix(in srgb, var(--color-info) 10%, transparent)'
                        : 'color-mix(in srgb, var(--color-textMuted) 8%, transparent)',
                  border: `1px solid ${
                    call.status === 'completed'
                      ? 'color-mix(in srgb, var(--color-success) 20%, transparent)'
                      : call.status === 'failed'
                        ? 'color-mix(in srgb, var(--color-error) 20%, transparent)'
                        : call.status === 'running'
                          ? 'color-mix(in srgb, var(--color-info) 20%, transparent)'
                          : 'color-mix(in srgb, var(--color-textMuted) 10%, transparent)'
                  }`,
                }}
              >
                {/* Status indicator */}
                <motion.div
                  animate={call.status === 'running' ? {
                    scale: [1, 1.3, 1],
                    opacity: [0.7, 1, 0.7],
                  } : {}}
                  transition={{ duration: 1, repeat: Infinity }}
                  style={{
                    width: '5px',
                    height: '5px',
                    borderRadius: '50%',
                    background: call.status === 'completed' ? 'var(--color-success)'
                      : call.status === 'failed' ? 'var(--color-error)'
                      : call.status === 'running' ? 'var(--color-info)'
                      : 'var(--color-textMuted)',
                    boxShadow: call.status === 'running'
                      ? '0 0 6px color-mix(in srgb, var(--color-info) 50%, transparent)'
                      : call.status === 'completed'
                        ? '0 0 4px color-mix(in srgb, var(--color-success) 40%, transparent)'
                        : 'none',
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  fontFamily: 'ui-monospace, monospace',
                  color: call.status === 'completed'
                    ? 'var(--color-success)'
                    : call.status === 'failed'
                      ? 'var(--color-error)'
                      : 'var(--color-text)',
                }}>
                  {call.tool.split('___').pop() || call.tool}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* CSS for blinking cursor */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .thinking-cursor {
          animation: blink 1s infinite;
        }
      `}</style>
    </motion.div>
  );
};

export default ThinkingAnimation;
