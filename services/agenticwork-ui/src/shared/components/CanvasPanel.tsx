/**
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize2, Minimize2, FileCode, Terminal, Play, Download, RotateCcw } from '@/shared/icons';
import { useShiki } from '@/features/chat/hooks/useShiki';

interface CanvasContent {
  id: string;
  type: 'code' | 'visualization' | 'tool-output' | 'mcp-result';
  title: string;
  content: any;
  language?: string;
  timestamp: string;
}

interface CanvasPanelProps {
  isOpen: boolean;
  onClose: () => void;
  content: CanvasContent | null;
  theme: 'light' | 'dark';
  onExecute?: (code: string, language: string) => void;
}

const CanvasPanel: React.FC<CanvasPanelProps> = ({
  isOpen,
  onClose,
  content,
  theme,
  onExecute
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'output' | 'metadata'>('content');
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const { highlighter, isLoading } = useShiki();

  const panelWidth = isMaximized ? '100vw' : '60vw';
  const panelHeight = isMaximized ? '100vh' : '100vh';

  const formatTimestamp = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case 'code':
        return <FileCode size={16} />;
      case 'tool-output':
        return <Terminal size={16} />;
      case 'mcp-result':
        return <Terminal size={16} />;
      default:
        return <FileCode size={16} />;
    }
  };
  
  // Generate syntax-highlighted HTML when content changes
  useEffect(() => {
    if (!content || content.type !== 'code' || !highlighter || isLoading) {
      return;
    }

    const generateHighlightedCode = async () => {
      try {
        const lang = content.language || 'text';
        const html = highlighter.codeToHtml(content.content, {
          lang,
          theme: theme === 'dark' ? 'vitesse-dark' : 'vitesse-light'
        });
        setHighlightedHtml(html);
      } catch (error) {
        console.error('Canvas - Failed to highlight code:', error);
        // Fallback to plain code
        setHighlightedHtml(`<pre><code>${escapeHtml(content.content)}</code></pre>`);
      }
    };

    generateHighlightedCode();
  }, [content, highlighter, isLoading, theme]);

  const escapeHtml = (unsafe: string): string => {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const renderCodeContent = (code: string, language: string) => {
    const lines = code.split('\n');

    // If Shiki is loaded and we have highlighted HTML, use it
    if (highlightedHtml && !isLoading) {
      return (
        <div className="h-full relative">
          {/* Line numbers */}
          <div className="absolute left-0 top-0 bottom-0 w-16 border-r select-none overflow-hidden"
            style={{
              backgroundColor: theme === 'dark' ? 'rgba(20, 21, 30, 0.6)' : 'rgba(241, 245, 249, 0.6)',
              borderColor: theme === 'dark' ? 'rgba(60, 60, 70, 0.4)' : 'rgba(203, 213, 225, 0.4)'
            }}
          >
            <div className="px-3" style={{ paddingTop: '1.5rem', paddingBottom: '1.5rem' }}>
              {lines.map((_, i) => (
                <div key={i} className="text-xs opacity-60 text-right"
                  style={{
                    color: theme === 'dark' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
                    lineHeight: '1.5rem',
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
                  }}
                >
                  {i + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Syntax highlighted code */}
          <div className="pl-16 overflow-auto h-full"
            style={{
              backgroundColor: theme === 'dark' ? 'rgba(26, 27, 38, 0.8)' : 'rgba(255, 255, 255, 0.9)'
            }}
          >
            <div
              className="shiki-canvas-code"
              style={{
                fontSize: '0.875rem',
                lineHeight: '1.5rem',
                paddingTop: '1.5rem',
                paddingBottom: '1.5rem',
                paddingLeft: '1.5rem',
                paddingRight: '1.5rem'
              }}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </div>
        </div>
      );
    }

    // Fallback to plain rendering with line numbers (same as before)
    return (
      <div className="h-full">
        <pre
          className="p-6 text-sm leading-relaxed"
          style={{
            background: theme === 'dark' ? 'rgba(26, 27, 38, 0.8)' : 'rgba(255, 255, 255, 0.9)',
            color: theme === 'dark' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.9)',
            margin: 0,
            minHeight: '100%',
            overflow: 'visible'
          }}
        >
          <div className="flex">
            <div className="select-none text-right pr-4 opacity-50">
              {lines.map((_, i) => (
                <div key={i} className="leading-relaxed text-xs">
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="flex-1">
              <code>{code}</code>
            </div>
          </div>
        </pre>
      </div>
    );
  };
  
  const renderVisualizationContent = (data: any) => (
    <div className="p-6 h-full overflow-auto">
      <div className={`rounded-lg p-4 ${
        'bg-bg-secondary'
      }`}>
        <pre className={`text-sm ${
          'text-text-secondary'
        }`}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
  
  const renderToolOutput = (output: any) => (
    <div className="p-6 h-full overflow-auto">
      <div className={`rounded-lg border ${
        'bg-bg-primary border-border-primary'
      }`}>
        <div className={`px-4 py-2 border-b ${
          'border-border-secondary'
        }`}>
          <span className={`text-sm font-medium ${
            'text-text-primary'
          }`}>
            Tool Output
          </span>
        </div>
        <div className="p-4">
          <pre className={`text-sm overflow-auto ${
            'text-text-secondary'
          }`}>
            {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
  
  const isExecutableLanguage = (lang?: string) => {
    if (!lang) return false;
    const executableLangs = ['python', 'javascript', 'typescript', 'bash', 'sql'];
    return executableLangs.includes(lang.toLowerCase());
  };
  
  return (
    <AnimatePresence>
      {isOpen && content && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            
            className="fixed inset-0 z-40"
            style={{ backgroundColor: 'var(--color-background)' }}
            onClick={onClose}
          />
          
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className={`fixed top-0 right-0 z-50 shadow-2xl ${
              'glass border-l border-border-primary'
            }`}
            style={{ width: panelWidth, height: panelHeight }}
          >
            {/* Header */}
            <div className={`flex items-center justify-between p-4 border-b ${
              'border-border-secondary'
            }`}>
              <div className="flex items-center gap-3">
                <span className="text-info">
                  {getContentTypeIcon(content.type)}
                </span>
                <div>
                  <h2 className={`text-lg font-semibold ${
                    'text-text-primary'
                  }`}>
                    {content.title}
                  </h2>
                  <p className={`text-sm ${
                    'text-text-muted'
                  }`}>
                    {formatTimestamp(content.timestamp)} • {content.type}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Execute button for code */}
                {content.type === 'code' && 
                 content.language && 
                 isExecutableLanguage(content.language) && 
                 onExecute && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onExecute(content.content, content.language!)}
                    
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all bg-success hover:opacity-80"
                    style={{ color: 'var(--color-text)' }}
                  >
                    <Play size={14} />
                    Execute
                  </motion.button>
                )}
                
                {/* Download button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    const blob = new Blob([
                      content.type === 'code' ? content.content : JSON.stringify(content.content, null, 2)
                    ], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${content.title}.${content.language || 'txt'}`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className={`p-2 rounded-lg transition-all ${
                    'hover:bg-bg-secondary text-text-muted'
                  }`}
                  title="Download"
                >
                  <Download size={16} />
                </motion.button>
                
                {/* Maximize/Minimize button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setIsMaximized(!isMaximized)}
                  className={`p-2 rounded-lg transition-all ${
                    'hover:bg-bg-secondary text-text-muted'
                  }`}
                  title={isMaximized ? 'Restore' : 'Maximize'}
                >
                  {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </motion.button>
                
                {/* Close button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={onClose}
                  className={`p-2 rounded-lg transition-all ${
                    'hover:bg-bg-secondary text-text-muted'
                  }`}
                >
                  <X size={16} />
                </motion.button>
              </div>
            </div>
            
            {/* Tab navigation */}
            <div className={`flex border-b ${
              'border-border-secondary'
            }`}>
              {['content', 'output', 'metadata'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? 'text-info border-b-2 border-info'
                      : 'text-muted hover:text-secondary'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            
            {/* Content area */}
            <div className="flex-1 overflow-auto" style={{ height: 'calc(100vh - 180px)' }}>
              {activeTab === 'content' && (
                <>
                  {content.type === 'code' && content.language &&
                    renderCodeContent(content.content, content.language)}
                  {content.type === 'visualization' &&
                    renderVisualizationContent(content.content)}
                  {(content.type === 'tool-output' || content.type === 'mcp-result') &&
                    renderToolOutput(content.content)}
                </>
              )}
              
              {activeTab === 'output' && (
                <div className="p-6">
                  <div className={`text-center ${
                    'text-text-muted'
                  }`}>
                    No output available
                  </div>
                </div>
              )}
              
              {activeTab === 'metadata' && (
                <div className="p-6">
                  <div className={`rounded-lg p-4 ${
                    'bg-bg-secondary'
                  }`}>
                    <pre className={`text-sm ${
                      'text-text-secondary'
                    }`}>
                      {JSON.stringify({
                        id: content.id,
                        type: content.type,
                        title: content.title,
                        language: content.language,
                        timestamp: typeof content.timestamp === 'string' 
                          ? content.timestamp 
                          : content.timestamp ? new Date(content.timestamp).toISOString() : new Date().toISOString(),
                        size: content.type === 'code' 
                          ? `${content.content.length} characters`
                          : `${JSON.stringify(content.content).length} characters`
                      }, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CanvasPanel;