/**
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { type BundledLanguage } from 'shiki';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, Check, Maximize2, Terminal, FileCode,
  Code2, Database, Settings, Braces, FileText
} from '@/shared/icons';
import { useShiki } from '@/features/chat/hooks/useShiki';

interface ShikiCodeBlockProps {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  onCopy: (text: string) => void;
  copied?: boolean;
  onExpandToCanvas?: (code: string, language: string, filename?: string) => void;
  filename?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  singleLine?: boolean;
  className?: string;
  isInCanvas?: boolean; // Only show line numbers in Canvas mode
  isStreaming?: boolean; // When true, auto-scroll to follow code being written
}

// Language display names and icons - NO hardcoded colors, let CSS handle styling
const languageConfig: Record<string, { displayName: string; icon: React.ElementType }> = {
  javascript: { displayName: 'JavaScript', icon: Braces },
  typescript: { displayName: 'TypeScript', icon: Braces },
  python: { displayName: 'Python', icon: Code2 },
  java: { displayName: 'Java', icon: FileCode },
  csharp: { displayName: 'C#', icon: FileCode },
  cpp: { displayName: 'C++', icon: FileCode },
  go: { displayName: 'Go', icon: Code2 },
  rust: { displayName: 'Rust', icon: Settings },
  sql: { displayName: 'SQL', icon: Database },
  bash: { displayName: 'Bash', icon: Terminal },
  shell: { displayName: 'Shell', icon: Terminal },
  json: { displayName: 'JSON', icon: Braces },
  yaml: { displayName: 'YAML', icon: FileText },
  markdown: { displayName: 'Markdown', icon: FileText },
  html: { displayName: 'HTML', icon: Code2 },
  css: { displayName: 'CSS', icon: Code2 },
  jsx: { displayName: 'JSX', icon: Braces },
  tsx: { displayName: 'TSX', icon: Braces },
  dockerfile: { displayName: 'Docker', icon: FileCode },
  xml: { displayName: 'XML', icon: Code2 },
  php: { displayName: 'PHP', icon: Code2 },
  ruby: { displayName: 'Ruby', icon: Settings },
  swift: { displayName: 'Swift', icon: Code2 },
  kotlin: { displayName: 'Kotlin', icon: Code2 },
};

const ShikiCodeBlock: React.FC<ShikiCodeBlockProps> = ({
  code,
  language,
  theme,
  onCopy,
  copied,
  onExpandToCanvas,
  filename,
  showLineNumbers = false, // Default to false for chat messages
  highlightLines = [],
  singleLine = false,
  className = '',
  isInCanvas = false,
  isStreaming = false,
}) => {
  const { highlighter, isLoading } = useShiki();
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const [localCopied, setLocalCopied] = useState(false);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const prevCodeLengthRef = useRef<number>(0);

  // Auto-scroll to follow code during streaming
  useEffect(() => {
    if (!isStreaming || !codeContainerRef.current) return;

    // Only scroll if code is growing (new content being added)
    if (code.length > prevCodeLengthRef.current) {
      const container = codeContainerRef.current;
      // Scroll to bottom smoothly to follow the code being written
      container.scrollTop = container.scrollHeight;
    }
    prevCodeLengthRef.current = code.length;
  }, [code, isStreaming]);

  // Generate highlighted HTML
  useEffect(() => {
    if (!highlighter || isLoading) {
      // Show loading state with better fallback
      // CRITICAL: Reserve space to prevent layout shift when Shiki loads
      const lineCount = code.split('\n').length;
      const estimatedHeight = lineCount * 24; // 24px per line roughly
      setHighlightedHtml(`<pre class="loading-code" style="min-height: ${estimatedHeight}px;"><code>${escapeHtml(code)}</code></pre>`);
      return;
    }

    const generateHtml = async () => {
      try {
        // Get loaded languages for debugging
        const loadedLanguages = highlighter.getLoadedLanguages();
        // console.log('ShikiCodeBlock - Available languages:', loadedLanguages);
        // console.log('ShikiCodeBlock - Requested language:', language);
        
        // Validate language with better fallbacks
        let validLanguage: BundledLanguage;
        if (language && loadedLanguages.includes(language as BundledLanguage)) {
          validLanguage = language as BundledLanguage;
        } else {
          // Try common language mappings
          const languageMap: Record<string, BundledLanguage> = {
            'js': 'javascript',
            'ts': 'typescript',
            'py': 'python',
            'sh': 'bash',
            'yml': 'yaml',
            'md': 'markdown'
          };
          
          const mappedLang = languageMap[language];
          if (mappedLang && loadedLanguages.includes(mappedLang)) {
            validLanguage = mappedLang;
          } else {
            validLanguage = 'javascript'; // Fallback to a commonly supported language
          }
        }
        
        // console.log('ShikiCodeBlock - Using language:', validLanguage);

        const html = highlighter.codeToHtml(code, {
          lang: validLanguage,
          theme: theme === 'dark' ? 'github-dark' : 'github-light' // NO PURPLE
        });

        // console.log('ShikiCodeBlock - Generated HTML:', html.substring(0, 300));
        // console.log('ShikiCodeBlock - Has inline styles:', html.includes('style='));
        // console.log('ShikiCodeBlock - Has color styles:', html.includes('color:'));
        
        // Ensure the HTML has the proper wrapper
        if (!html.includes('style=')) {
          // console.warn('ShikiCodeBlock - Generated HTML missing inline styles, using fallback');
          setHighlightedHtml(`<pre class="shiki-fallback"><code class="language-${language || 'text'}">${escapeHtml(code)}</code></pre>`);
        } else {
          setHighlightedHtml(html);
        }
      } catch (error) {
        console.error('ShikiCodeBlock - Failed to highlight code:', error);
        console.error('ShikiCodeBlock - Code sample:', code.slice(0, 100));
        console.error('ShikiCodeBlock - Language:', language);
        // Use a more styled fallback that still looks decent
        setHighlightedHtml(`<pre class="shiki-fallback"><code class="language-${language || 'text'}">${escapeHtml(code)}</code></pre>`);
      }
    };

    generateHtml();
  }, [highlighter, code, language, theme]);

  // Get language configuration
  const langConfig = useMemo(() => {
    const config = languageConfig[language] || {
      displayName: language ? language.charAt(0).toUpperCase() + language.slice(1) : 'Plain Text',
      icon: FileText,
      color: 'text-gray-400',
      bgGradient: 'from-gray-500/20 to-gray-600/20'
    };
    return config;
  }, [language]);

  const Icon = langConfig.icon;

  // Handle copy with local state
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      onCopy(code);
      setLocalCopied(true);
      setTimeout(() => setLocalCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle execute
  const handleExecute = async () => {
    if (!onExecute || !executable) return;
    setIsExecuting(true);
    try {
      await onExecute(code, language);
    } finally {
      setIsExecuting(false);
    }
  };

  // Single line styling with glass morphism
  if (singleLine || code.split('\n').length === 1) {
    return (
      <div 
        data-testid="code-block-container"
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-sm glass-dark border border-blue-500/20 shadow-lg hover:shadow-blue-500/20 transition-all duration-150 ${className}`}
      >
        <code>{code}</code>
        <button
          onClick={handleCopy}
          
          className="p-1.5 rounded-lg transition-all duration-150 hover:bg-white/10 hover:text-white hover:shadow-lg"
          style={{ color: 'var(--color-textMuted)' }}
          aria-label="Copy code"
        >
          {(localCopied || copied) ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </button>
      </div>
    );
  }

  // Full code block with professional Gemini/Claude-like styling
  return (
    <div
      data-testid="code-block-container"
      className={`group relative syntax-highlighted-code rounded-lg overflow-hidden border border-border-primary/50 shadow-sm hover:shadow-md transition-shadow bg-bg-secondary ${className}`}
    >
      {/* Header - Clean, professional design like Gemini */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-primary/30 bg-bg-tertiary"
      >
        <div className="flex items-center gap-2">
          <Icon size={14} className="code-language-label opacity-70" />
          <span className="text-xs font-medium text-text-secondary">
            {filename || langConfig.displayName}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCopy}
            className="p-1.5 rounded transition-colors hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
            aria-label="Copy code"
          >
            <AnimatePresence mode="wait">
              {(localCopied || copied) ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Check size={16} className="text-green-500" />
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Copy size={16} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>

      {/* Code content - Professional, clean background with streaming support */}
      <div
        ref={codeContainerRef}
        className={`relative overflow-x-auto bg-bg-primary/80 ${isStreaming ? 'max-h-96 overflow-y-auto' : ''}`}
      >
        {showLineNumbers && (
          <div className="absolute left-0 top-0 bottom-0 w-12 border-r bg-bg-tertiary/50 border-border/30"
          >
            {code.split('\n').map((_, index) => (
              <div
                key={index}
                className={`px-2 text-right text-xs leading-6 select-none ${
                  highlightLines.includes(index + 1)
                    ? 'text-accent-primary-primary'
                    : 'text-text-tertiary'
                }`}
              >
                {index + 1}
              </div>
            ))}
          </div>
        )}

        <div
          className={`syntax-highlighted-code ${
            showLineNumbers ? 'pl-14' : 'pl-4'
          } pr-4 py-4`}
          style={{
            fontSize: '0.875rem',
            lineHeight: '1.6'
          }}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />

        {/* Streaming cursor indicator */}
        {isStreaming && (
          <span
            className="absolute bottom-4 animate-pulse"
            style={{
              left: showLineNumbers ? '3.5rem' : '1rem',
              width: '2px',
              height: '1em',
              backgroundColor: 'var(--color-primary, #6366f1)',
            }}
          />
        )}

        {/* Highlight overlay for specific lines */}
        {highlightLines.length > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            {code.split('\n').map((_, index) => (
              highlightLines.includes(index + 1) && (
                <div
                  key={index}
                  data-testid={`code-line-${index + 1}`}
                  className="absolute left-0 right-0 h-6 highlighted bg-accent-primary-primary/10 border-l-2 border-accent-primary-primary"
                  style={{ top: `${index * 24}px` }}
                />
              )
            ))}
          </div>
        )}
      </div>

      {/* Copy confirmation toast */}
      <AnimatePresence>
        {(localCopied || copied) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-2 right-2 px-2 py-1 rounded text-xs font-medium bg-theme-success text-theme-success-fg"
          >
            Copied!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export default ShikiCodeBlock;