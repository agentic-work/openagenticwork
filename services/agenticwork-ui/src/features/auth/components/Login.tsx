/**
 * Enhanced Login Component with Midjourney-style ASCII Unscramble Effect
 * Features AGENTICWORK CHAT text that unscrambles from noise
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/providers/AuthContext';
import { AlertCircle, Shield, User, X, Lock } from '@/shared/icons';
import { DisclaimerModal } from './DisclaimerModal';
import { isMicrosoftLoginEnabled, isGoogleLoginEnabled, isLocalLoginEnabled } from '@/config/runtime';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState('');
  const [isAccountLocked, setIsAccountLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showLocalForm, setShowLocalForm] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const canvasRef = useRef<SVGSVGElement>(null);

  // Check for URL error parameters (e.g., from locked account redirect)
  useEffect(() => {
    const errorType = searchParams.get('error');
    const errorMessage = searchParams.get('message');

    if (errorType === 'account_locked') {
      setIsAccountLocked(true);
      setError(errorMessage ? decodeURIComponent(errorMessage) : 'Your account has been locked. Please contact an administrator for assistance.');
    } else if (errorType) {
      setError(errorMessage ? decodeURIComponent(errorMessage) : 'Authentication failed. Please try again.');
    }
  }, [searchParams]);

  // Midjourney-style ASCII Unscramble Effect
  useEffect(() => {
    const svg = canvasRef.current;
    if (!svg) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const charWidth = 12;  // Wider spacing for performance
    const lineHeight = 24; // More spacing
    const cols = Math.floor(width / charWidth);
    const rows = Math.floor(height / lineHeight);

    // SPARSE - 8% density for smooth performance
    const density = 0.08;

    // Programming words for readable code text effect
    const codeWords = [
      'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while',
      'class', 'import', 'export', 'async', 'await', 'try', 'catch', 'throw',
      'new', 'this', 'true', 'false', 'null', 'undefined', 'break', 'continue',
      'switch', 'case', 'default', 'extends', 'static', 'public', 'private',
      'interface', 'type', 'enum', 'namespace', 'module', 'require', 'package'
    ];

    const generateCodeLine = (length: number) => {
      let line = '';
      while (line.length < length) {
        const word = codeWords[Math.floor(Math.random() * codeWords.length)];
        line += word + ' ';
      }
      return line.substring(0, length);
    };

    // Create individual characters for 3D transformation
    const chars: {
      element: SVGTextElement;
      baseX: number;
      baseY: number;
      char: string;
      baseOpacity: number;
    }[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (Math.random() > density) continue; // 80% density

        const charText = generateCodeLine(1);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'ascii-text');
        text.textContent = charText;

        // Varying opacity for depth
        const baseOpacity = 0.3 + Math.random() * 0.5;

        // BLUE color like Midjourney (cyan shades)
        const blueShade = Math.floor(150 + Math.random() * 105); // 150-255
        text.setAttribute('fill', `rgb(100, ${blueShade}, 255)`);

        svg.appendChild(text);

        chars.push({
          element: text,
          baseX: col * charWidth,
          baseY: row * lineHeight + lineHeight,
          char: charText,
          baseOpacity
        });
      }
    }

    let startTime: number | null = null;
    let animationFrame: number;
    let mouseX = 0;
    let mouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / width) * 2 - 1;
      mouseY = (e.clientY / height) * 2 - 1;
    };

    window.addEventListener('mousemove', handleMouseMove);

    const easeOutCubic = (t: number) => {
      return 1 - Math.pow(1 - t, 3);
    };

    const interpolate = (from: number, to: number, progress: number) => {
      return from * (1 - progress) + to * progress;
    };

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp * 0.001;

      const elapsed = timestamp * 0.001 - startTime;

      // Center of screen
      const centerX = width / 2;
      const centerY = height / 2;

      // Simplified animation - vertical wave only
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];

        // Simple vertical wave displacement
        const normY = char.baseY / height;
        const wave = Math.sin(normY * 6 + elapsed * 2) * 15 + Math.cos(normY * 4 - elapsed * 1.5) * 10;

        // Position
        const finalX = char.baseX;
        const finalY = char.baseY + wave;

        // Update position only (no transform/scale for performance)
        char.element.setAttribute('x', String(finalX));
        char.element.setAttribute('y', String(finalY));

        // Simple opacity pulse
        const pulse = Math.sin(elapsed * 2 + normY * 8) * 0.15;
        char.element.setAttribute('opacity', String(Math.max(0.2, Math.min(0.8, char.baseOpacity + pulse))));
      }

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('mousemove', handleMouseMove);
      // Clean up all character elements
      chars.forEach(char => char.element.remove());
    };
  }, []);

  // Typing animation state for AGENTICWORK
  const [typedText, setTypedText] = useState('');
  const fullText = 'AGENTICWORK';

  useEffect(() => {
    let currentIndex = 0;
    const typingDelay = 100; // milliseconds per character

    const typeInterval = setInterval(() => {
      if (currentIndex < fullText.length) {
        setTypedText(fullText.substring(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(typeInterval);
      }
    }, typingDelay);

    return () => clearInterval(typeInterval);
  }, []);

  // Glitch effect - randomly glitch letters
  const [glitchedText, setGlitchedText] = useState('');
  const glitchChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';

  useEffect(() => {
    if (typedText.length === 0) {
      setGlitchedText('');
      return;
    }

    const glitchInterval = setInterval(() => {
      // Randomly decide if we should glitch (20% chance)
      if (Math.random() > 0.8) {
        const chars = typedText.split('');
        // Glitch 1-2 random characters
        const numGlitches = Math.random() > 0.5 ? 1 : 2;

        for (let i = 0; i < numGlitches; i++) {
          const randomIndex = Math.floor(Math.random() * chars.length);
          chars[randomIndex] = glitchChars[Math.floor(Math.random() * glitchChars.length)];
        }

        setGlitchedText(chars.join(''));

        // Reset after brief moment
        setTimeout(() => {
          setGlitchedText(typedText);
        }, 50);
      } else {
        setGlitchedText(typedText);
      }
    }, 150);

    return () => clearInterval(glitchInterval);
  }, [typedText]);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/local/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: email, password }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // Skip disclaimer and login directly
        await login(data.token);
        navigate('/chat');
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAzureLogin = () => {
    window.location.href = '/api/auth/microsoft';
  };

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google/login';
  };

  const handleDisclaimerAccept = async () => {
    if (!pendingToken) return;

    try {
      await fetch('/api/auth/accept-disclaimer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pendingToken}`,
        },
      });

      await login(pendingToken);
      navigate('/chat');
    } catch (error) {
      setError('Failed to record disclaimer acceptance. Please try again.');
      setShowDisclaimer(false);
      setPendingToken(null);
    }
  };

  const handleDisclaimerDecline = () => {
    setShowDisclaimer(false);
    setPendingToken(null);
    setEmail('');
    setPassword('');
    setError('You must accept the disclaimer to continue.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-black">
      {/* ASCII Unscramble Background */}
      <svg
        ref={canvasRef}
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 w-full h-full"
      />

      <style>
        {`
          svg {
            user-select: none;
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
          }

          .ascii-text {
            font-size: 10px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            letter-spacing: 0.05em;
            pointer-events: none;
            font-weight: 500;
          }

          @keyframes crt-scan {
            0% {
              background-position: 0% 0%;
            }
            100% {
              background-position: 0% 100%;
            }
          }

          .crt-effect {
            position: relative;
          }

          .crt-effect::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: repeating-linear-gradient(
              0deg,
              rgba(0, 255, 0, 0.15) 0px,
              rgba(0, 0, 0, 0.05) 1px,
              transparent 2px,
              transparent 3px
            );
            background-size: 100% 4px;
            animation: crt-scan 8s linear infinite;
            pointer-events: none;
            z-index: 1;
          }

          .crt-effect::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(
              to bottom,
              transparent 0%,
              rgba(0, 255, 0, 0.05) 50%,
              transparent 100%
            );
            background-size: 100% 200px;
            animation: crt-scan 3s linear infinite;
            pointer-events: none;
            z-index: 2;
          }
        `}
      </style>

      {/* Typing Logo Text with CRT Effect and Glitching */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute z-10 w-full flex justify-center"
        style={{
          top: 'calc(50% - 80px)',
        }}
      >
        <h1
          className="text-2xl font-black tracking-widest text-center crt-effect"
          style={{
            fontFamily: '"Courier New", "Consolas", monospace',
            color: '#00ff00',
            textShadow: `
              0 0 10px rgba(0, 255, 0, 0.8),
              0 0 20px rgba(0, 255, 0, 0.5),
              0 0 30px rgba(0, 255, 0, 0.3),
              2px 2px 0 rgba(0, 0, 0, 0.5)
            `,
            filter: 'drop-shadow(0 4px 12px rgba(0, 255, 0, 0.5))',
            letterSpacing: '0.15em',
            position: 'relative',
            zIndex: 3,
            padding: '8px 16px',
          }}
        >
          {glitchedText || typedText}
          {typedText.length < fullText.length && (
            <span className="animate-pulse">|</span>
          )}
        </h1>
      </motion.div>

      {/* Locked Account Banner */}
      <AnimatePresence>
        {isAccountLocked && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute z-20 top-1/4 left-1/2 transform -translate-x-1/2 w-full max-w-md px-4"
          >
            <div className="bg-red-900 border-2 border-red-500/50 rounded-xl p-6 shadow-lg">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-500/30 rounded-full">
                  <Lock className="w-6 h-6 text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-red-300 mb-2">Account Locked</h3>
                  <p className="text-red-200 text-sm leading-relaxed">
                    {error}
                  </p>
                  <p className="mt-3 text-red-300/70 text-xs">
                    If you believe this is an error, please contact your administrator.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Login Buttons Container */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
        className="absolute z-10 flex flex-row items-center justify-center gap-3"
        style={{
          top: isAccountLocked ? '60%' : '50%',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        {!showLocalForm ? (
          <>
            {/* Microsoft Login Button - only show if enabled */}
            {isMicrosoftLoginEnabled() && (
              <motion.button
                onClick={handleAzureLogin}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 hover:text-gray-200 hover:bg-gray-800 hover:border-green-500/50 transition-all duration-150 flex items-center gap-2 text-sm"
              >
                <Shield className="w-4 h-4" />
                <span>Microsoft</span>
              </motion.button>
            )}

            {/* Google Login Button - only show if enabled */}
            {isGoogleLoginEnabled() && (
              <motion.button
                onClick={handleGoogleLogin}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 hover:text-gray-200 hover:bg-gray-800 hover:border-green-500/50 transition-all duration-150 flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>Google</span>
              </motion.button>
            )}

            {/* Local Login Button - only show if enabled */}
            {isLocalLoginEnabled() && (
              <motion.button
                onClick={() => setShowLocalForm(true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 hover:text-gray-200 hover:bg-gray-800 hover:border-green-500/50 transition-all duration-150 flex items-center gap-2 text-sm"
              >
                <User className="w-4 h-4" />
                <span>Local</span>
              </motion.button>
            )}
          </>
        ) : (
          /* Local Login Form */
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 rounded-2xl p-8 border-2 border-green-500/30 shadow-lg min-w-[400px]"
            style={{
              boxShadow: '0 0 40px rgba(0, 255, 0, 0.2)',
            }}
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-green-400 tracking-wider">LOCAL LOGIN</h2>
              <button
                onClick={() => {
                  setShowLocalForm(false);
                  setError('');
                  setEmail('');
                  setPassword('');
                }}
                className="text-gray-400 hover:text-green-400 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm flex items-center gap-2 mb-4"
              >
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </motion.div>
            )}

            <form onSubmit={handleLocalLogin} className="space-y-4">
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-black/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/30 transition-all"
                  placeholder="Enter your email"
                  required
                />
              </div>
              <div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-black/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/30 transition-all"
                  placeholder="Enter your password"
                  required
                />
              </div>
              <motion.button
                type="submit"
                disabled={isLoading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3 bg-gradient-to-r from-green-600 to-green-700 font-bold rounded-lg text-white shadow-lg hover:shadow-green-500/50 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span className="tracking-wider">SIGN IN</span>
                )}
              </motion.button>
            </form>
          </motion.div>
        )}
      </motion.div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 4, duration: 1 }}
        className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 text-center space-y-4"
      >
        {/* Legal Links */}
        <div className="flex flex-wrap justify-center items-center gap-4 text-xs text-gray-500">
          <button
            onClick={() => setShowTerms(true)}
            className="text-gray-500 hover:text-green-400 transition-colors underline"
          >
            Terms of Service
          </button>
          <span>•</span>
          <button
            onClick={() => setShowPrivacy(true)}
            className="text-gray-500 hover:text-green-400 transition-colors underline"
          >
            Privacy Policy
          </button>
          <span>•</span>
          <a
            href="mailto:hello@agenticwork.io"
            className="text-gray-500 hover:text-green-400 transition-colors underline"
          >
            Contact Support
          </a>
        </div>

        {/* Copyright */}
        <div className="text-xs text-gray-600 space-y-1">
          <p>© {new Date().getFullYear()} <a href="https://agenticwork.io" target="_blank" rel="noopener noreferrer" className="hover:text-green-400 transition-colors underline">Agenticwork LLC</a></p>
        </div>
      </motion.div>

      {/* Terms of Service Modal */}
      <AnimatePresence>
        {showTerms && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
            onClick={() => setShowTerms(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto border border-green-500/30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-green-400">Terms of Service</h2>
                <button
                  onClick={() => setShowTerms(false)}
                  className="text-gray-400 hover:text-green-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 text-sm text-gray-300">
                <p>
                  By using AgenticWork Chat, you agree to these Terms of Service. These terms
                  govern your use of our AI-powered chat application.
                </p>
                <p>
                  <strong>1. Acceptable Use:</strong> You agree to use the service responsibly
                  and in compliance with all applicable laws and regulations.
                </p>
                <p>
                  <strong>2. Content:</strong> You retain ownership of content you create. We do
                  not claim ownership of your conversations or data.
                </p>
                <p>
                  <strong>3. Service Availability:</strong> We strive to maintain service
                  availability but cannot guarantee uninterrupted access.
                </p>
                <p>
                  <strong>4. Modifications:</strong> We reserve the right to modify these terms
                  with notice to users.
                </p>
              </div>
              <button
                onClick={() => setShowTerms(false)}
                className="mt-6 w-full py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium text-white transition-all"
              >
                I Understand
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Privacy Policy Modal */}
      <AnimatePresence>
        {showPrivacy && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
            onClick={() => setShowPrivacy(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto border border-green-500/30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-green-400">Privacy Policy</h2>
                <button
                  onClick={() => setShowPrivacy(false)}
                  className="text-gray-400 hover:text-green-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-4 text-sm text-gray-300">
                <p>
                  Your privacy is important to us. This policy outlines how we handle your data
                  when using AgenticWork Chat.
                </p>
                <p>
                  <strong>1. Data Collection:</strong> We collect only essential data required
                  for authentication and service functionality.
                </p>
                <p>
                  <strong>2. Data Usage:</strong> Your data is used solely to provide and improve
                  our services. We do not sell or share your personal information.
                </p>
                <p>
                  <strong>3. Data Security:</strong> We implement industry-standard security
                  measures to protect your information.
                </p>
                <p>
                  <strong>4. Your Rights:</strong> You have the right to access, modify, or
                  delete your personal data at any time.
                </p>
              </div>
              <button
                onClick={() => setShowPrivacy(false)}
                className="mt-6 w-full py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium text-white transition-all"
              >
                I Understand
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Disclaimer Modal */}
      <DisclaimerModal
        isOpen={showDisclaimer}
        onAccept={handleDisclaimerAccept}
        onDecline={handleDisclaimerDecline}
      />
    </div>
  );
};

export default Login;
