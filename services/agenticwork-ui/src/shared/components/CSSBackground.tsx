/**
 * CSSBackground - Liquid Glass Effect
 *
 * A lightweight CSS-only alternative to WebGLBackground.
 * Uses layered gradients with animations for a premium glass effect.
 * ~1-2% CPU vs ~15-30% for WebGL
 */

import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';

export default function CSSBackground() {
  const { resolvedTheme } = useTheme();
  const isLightTheme = resolvedTheme === 'light';

  return (
    <div className="css-background">
      {/* Base layer - softer background color */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isLightTheme
            ? '#f5f5f7'  // Soft off-white instead of pure white
            : '#0a0a0f', // Soft dark instead of pure black
        }}
      />

      {/* Deep layer - large accent blobs spread across screen */}
      <div
        className="layer-deep"
        style={{
          position: 'absolute',
          inset: '-30%',
          background: `
            radial-gradient(ellipse 80% 80% at 10% 90%, var(--lava-color-1), transparent 60%),
            radial-gradient(ellipse 70% 70% at 90% 10%, var(--lava-color-2), transparent 60%),
            radial-gradient(ellipse 60% 60% at 50% 50%, var(--user-accent-color), transparent 50%)
          `,
          filter: 'blur(100px) saturate(70%)',
          opacity: isLightTheme ? 0.2 : 0.25,
          animation: 'liquid-deep 40s ease-in-out infinite alternate',
        }}
      />

      {/* Mid layer - spread across corners */}
      <div
        className="layer-mid"
        style={{
          position: 'absolute',
          inset: '-20%',
          background: `
            radial-gradient(circle at 15% 15%, var(--user-accent-color), transparent 45%),
            radial-gradient(circle at 85% 85%, var(--lava-color-1), transparent 45%),
            radial-gradient(circle at 85% 15%, var(--lava-color-2), transparent 40%),
            radial-gradient(circle at 15% 85%, var(--lava-color-1), transparent 40%)
          `,
          filter: 'blur(80px) saturate(65%)',
          opacity: isLightTheme ? 0.15 : 0.2,
          animation: 'liquid-mid 25s ease-in-out infinite alternate-reverse',
        }}
      />

      {/* Edge glow layer - subtle color at edges */}
      <div
        className="layer-pulse"
        style={{
          position: 'absolute',
          inset: '0',
          background: `
            radial-gradient(ellipse 80% 50% at 50% 100%, var(--lava-color-2), transparent 60%),
            radial-gradient(ellipse 50% 80% at 0% 50%, var(--lava-color-1), transparent 50%),
            radial-gradient(ellipse 50% 80% at 100% 50%, var(--lava-color-2), transparent 50%),
            radial-gradient(ellipse 80% 50% at 50% 0%, var(--user-accent-color), transparent 60%)
          `,
          filter: 'blur(80px) saturate(60%)',
          opacity: isLightTheme ? 0.12 : 0.18,
          animation: 'liquid-pulse 15s ease-in-out infinite',
        }}
      />

      {/* Glass overlay - frosted effect */}
      <div
        className="glass-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          background: isLightTheme
            ? 'rgba(248, 248, 250, 0.8)'  // Softer overlay, more opaque
            : 'rgba(18, 18, 24, 0.65)',    // Slightly more coverage
          backdropFilter: 'blur(60px) saturate(110%)',
          WebkitBackdropFilter: 'blur(60px) saturate(110%)',
        }}
      >
        {/* Noise texture for glass depth */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: isLightTheme ? 0.08 : 0.12,
            mixBlendMode: 'overlay',
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '128px 128px',
            filter: 'contrast(120%) brightness(120%)',
          }}
        />

        {/* Surface highlights - subtle light reflections */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              radial-gradient(circle at 10% 10%, rgba(255, 255, 255, ${isLightTheme ? '0.3' : '0.05'}) 0%, transparent 25%),
              radial-gradient(circle at 90% 90%, rgba(255, 255, 255, ${isLightTheme ? '0.2' : '0.03'}) 0%, transparent 25%),
              linear-gradient(135deg,
                rgba(255,255,255,${isLightTheme ? '0.1' : '0.02'}) 0%,
                transparent 40%,
                transparent 60%,
                rgba(255,255,255,${isLightTheme ? '0.05' : '0.01'}) 100%)
            `,
            animation: 'liquid-surface 20s ease-in-out infinite alternate',
            pointerEvents: 'none',
          }}
        />

        {/* Accent glow at edges - very subtle */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `
              linear-gradient(to right,
                color-mix(in srgb, var(--lava-color-1) ${isLightTheme ? '3%' : '5%'}, transparent) 0%,
                transparent 15%,
                transparent 85%,
                color-mix(in srgb, var(--lava-color-2) ${isLightTheme ? '3%' : '5%'}, transparent) 100%),
              linear-gradient(to bottom,
                transparent 0%,
                transparent 90%,
                color-mix(in srgb, var(--user-accent-color) ${isLightTheme ? '2%' : '4%'}, transparent) 100%)
            `,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Vignette for depth */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: isLightTheme
            ? 'radial-gradient(ellipse at center, transparent 0%, transparent 60%, rgba(0,0,0,0.03) 100%)'
            : 'radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(0,0,0,0.3) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* CSS Keyframes */}
      <style>{`
        .css-background {
          position: fixed;
          inset: 0;
          z-index: -1;
          overflow: hidden;
          background: var(--bg-primary);
        }

        @keyframes liquid-deep {
          0% {
            transform: translate(0, 0) scale(1) rotate(0deg);
          }
          50% {
            transform: translate(3%, -3%) scale(1.05) rotate(2deg);
          }
          100% {
            transform: translate(-2%, 4%) scale(1.1) rotate(-1deg);
          }
        }

        @keyframes liquid-mid {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: inherit;
          }
          33% {
            transform: translate(-2%, 2%) rotate(3deg);
          }
          66% {
            transform: translate(2%, -1%) rotate(-2deg);
          }
          100% {
            transform: translate(-1%, 3%) rotate(4deg);
          }
        }

        @keyframes liquid-pulse {
          0%, 100% {
            opacity: inherit;
            transform: scale(1);
          }
          50% {
            opacity: calc(inherit * 1.3);
            transform: scale(1.05);
          }
        }

        @keyframes liquid-surface {
          0% {
            opacity: 0.8;
          }
          100% {
            opacity: 1;
          }
        }

        /* Reduce motion for accessibility */
        @media (prefers-reduced-motion: reduce) {
          .css-background * {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
