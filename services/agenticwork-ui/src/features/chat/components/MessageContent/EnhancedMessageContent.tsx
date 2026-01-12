/**
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { motion } from 'framer-motion';
import { nanoid } from 'nanoid';
import SimpleCodeBlock from './SimpleCodeBlock';
import EnhancedCodeBlock from './EnhancedCodeBlock';
import ArtifactRenderer from './ArtifactRenderer';
import MCPFunctionDisplay from '../MCPFunctionDisplay';
import AnimatedTokenCost from '../AnimatedTokenCost';
import { InlineToolCall } from '../InlineToolCall';
import { InlineMCPCall } from '../InlineMCPCall';
import InlineModelBadge from '../InlineModelBadge';
import InlineThinkingBlock from '../InlineThinkingBlock';
import VerboseMCPDisplay from '../VerboseMCPDisplay';
import DataVisualization from './DataVisualization';
import MetricCard from './MetricCard';
import CalloutBox from './CalloutBox';
import RichCallout from './RichCallout';
import HighlightedText from './HighlightedText';
import ChartRenderer from './ChartRenderer';
import ProgressiveImage from '../ProgressiveImage';
// ReactFlowDiagram RE-ENABLED for native diagram rendering without MCP
import { ReactFlowDiagram, parseDiagramJson } from '@/components/diagrams/ReactFlowDiagram';
import { VennDiagram, parseVennJson } from '@/components/diagrams/VennDiagram';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { ChatMessage } from '@/types/index';

// Extracted MilvusImage component to avoid React hooks rules violation
// When defined inline in ReactMarkdown components, hooks don't work properly
interface MilvusImageProps {
  src?: string;
  alt?: string;
  theme: 'light' | 'dark';
}

// Memoize to prevent re-renders when parent re-renders (e.g., during typing)
const MilvusImage: React.FC<MilvusImageProps> = React.memo(({ src, alt, theme }) => {
  const isImageProtocol = src?.startsWith('image://');
  const [imageSrc, setImageSrc] = React.useState<string | undefined>(isImageProtocol ? undefined : src);
  const [imageError, setImageError] = React.useState(false);
  const [loading, setLoading] = React.useState(isImageProtocol);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [imageDimensions, setImageDimensions] = React.useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    if (src?.startsWith('image://')) {
      const imageId = src.replace('image://', '');
      setLoading(true);
      setImageError(false);

      // Fetch image from API - public endpoint (no auth required)
      fetch(`/api/images/${imageId}`, {
        credentials: 'include'
      })
        .then(res => {
          if (!res.ok) {
            throw new Error(`Failed to load image: ${res.status}`);
          }
          return res.json();
        })
        .then(data => {
          if (data.imageData) {
            // Detect image format from base64 header or default to PNG
            const format = data.metadata?.format || 'png';
            const dataUrl = `data:image/${format};base64,${data.imageData}`;
            setImageSrc(dataUrl);
            // Parse dimensions from metadata if available (e.g., "1024x1024")
            if (data.metadata?.dimensions) {
              const [w, h] = data.metadata.dimensions.split('x').map(Number);
              if (w && h) setImageDimensions({ width: w, height: h });
            }
            setLoading(false);
          } else {
            throw new Error('No image data in response');
          }
        })
        .catch(error => {
          console.error('[MilvusImage] Failed to fetch image:', error);
          setImageError(true);
          setLoading(false);
        });
    }
  }, [src]);

  // Handle escape key to close fullscreen
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // Fixed container size to prevent layout shift during loading/typing
  const containerStyle = {
    width: '100%',
    maxWidth: '512px',
    aspectRatio: imageDimensions ? `${imageDimensions.width}/${imageDimensions.height}` : '1/1',
    minHeight: '200px',
    maxHeight: '512px',
  };

  if (loading) {
    return (
      <div
        className="rounded-lg my-4 flex items-center justify-center border border-border/20 bg-bg-tertiary/50"
        style={containerStyle}
      >
        <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
          Loading image...
        </div>
      </div>
    );
  }

  if (imageError) {
    return (
      <div
        className="rounded-lg my-4 flex items-center justify-center"
        style={{
          ...containerStyle,
          border: '1px solid var(--callout-error-border)',
          backgroundColor: 'var(--callout-error-bg)'
        }}
      >
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>
          Failed to load image
        </div>
      </div>
    );
  }

  // For image:// protocol, we MUST have imageSrc loaded
  // For regular URLs (http://, data:, etc.), use the original src
  const finalSrc = isImageProtocol ? imageSrc : (imageSrc || src);

  // If we're supposed to have an image:// URL but haven't loaded it yet, show loading
  if (isImageProtocol && !imageSrc) {
    return (
      <div
        className="rounded-lg my-4 flex items-center justify-center border border-border/20 bg-bg-tertiary/50"
        style={containerStyle}
      >
        <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
          Loading image...
        </div>
      </div>
    );
  }

  if (!finalSrc) {
    return null;
  }

  return (
    <>
      {/* Thumbnail image - clickable */}
      <div className="relative inline-block my-4 group">
        <img
          src={finalSrc}
          alt={alt || 'Generated image'}
          className="rounded-lg shadow-lg max-w-full h-auto cursor-pointer transition-opacity hover:opacity-90"
          style={{ maxHeight: '512px', objectFit: 'contain' }}
          onClick={() => setIsFullscreen(true)}
          onError={() => setImageError(true)}
        />
        {/* Click hint overlay */}
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-all rounded-lg pointer-events-none"
        >
          <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
            Click to expand
          </span>
        </div>
      </div>

      {/* Fullscreen modal - rendered via portal to escape parent container constraints */}
      {isFullscreen && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 cursor-pointer"
          onClick={() => setIsFullscreen(false)}
        >
          {/* Close button */}
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors z-10"
            onClick={() => setIsFullscreen(false)}
            aria-label="Close fullscreen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          {/* Hint text */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
            Press ESC or click anywhere to close
          </div>

          {/* Full size image */}
          <img
            src={finalSrc}
            alt={alt || 'Generated image'}
            className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  );
});

interface MCPCall {
  id: string;
  toolName: string;
  serverName?: string;
  status: 'running' | 'completed' | 'error' | 'pending';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  metadata?: any;
}

interface EnhancedMessageContentProps {
  message?: ChatMessage;
  content?: string; // Allow content to be passed directly
  theme: 'light' | 'dark';
  onExpandToCanvas?: (content: any, type: string, title: string, language?: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  showTokenCost?: boolean;
  tokenCostDelay?: number;
  showModelBadges?: boolean;  // Control model badge visibility
  isStreaming?: boolean;  // When true, code blocks auto-scroll to follow content
}

interface ParsedContent {
  type: 'text' | 'code' | 'visualization' | 'metric' | 'callout' | 'summary' | 'mcp-calls' | 'chart' | 'tool-calls' | 'thinking-block';
  content: any;
  language?: string;
}

const EnhancedMessageContent: React.FC<EnhancedMessageContentProps> = ({
  message,
  content: directContent,
  theme,
  onExpandToCanvas,
  onExecuteCode,
  showTokenCost = true,
  tokenCostDelay = 0,
  showModelBadges = true,
  isStreaming = false
}) => {
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Parse message content - simplified to let AI render markdown freely
  const parseContent = (content: string | any): ParsedContent[] => {
    const parsed: ParsedContent[] = [];

    // Handle Ollama/JSON responses that might come as objects
    if (content && typeof content === 'object') {
      // If it's an object with a message or text field, extract it
      if (content.message) {
        content = content.message;
      } else if (content.text) {
        content = content.text;
      } else if (content.content) {
        content = content.content;
      } else if (content.response) {
        content = content.response;
      } else if (content.result) {
        // Background job result
        content = content.result;
      } else {
        // If it's some other object structure, try to format it as JSON
        try {
          content = JSON.stringify(content, null, 2);
        } catch {
          content = String(content);
        }
      }
    }

    // Ensure content is a string
    if (!content || typeof content !== 'string') {
      // If there's no content but there are MCP calls, don't add empty text
      const mcpCalls = message?.mcpCalls || message?.metadata?.mcpCalls;
      if (mcpCalls && mcpCalls.length > 0) {
        return [];
      }
      return [{ type: 'text', content: content || '' }];
    }

    // Extract <tool_code> blocks for thinking display
    const toolCodeRegex = /<tool_code>([\s\S]*?)<\/tool_code>/g;
    const toolCodeBlocks: string[] = [];
    let match;
    while ((match = toolCodeRegex.exec(content)) !== null) {
      toolCodeBlocks.push(match[1].trim());
    }

    // Remove thinking/reasoning/tool_code blocks from main content
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    content = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');
    content = content.replace(/<tool_code>[\s\S]*?<\/tool_code>/g, '');
    content = content.trim();

    // Add thinking blocks FIRST (before other content)
    toolCodeBlocks.forEach(block => {
      parsed.push({ type: 'thinking-block', content: block });
    });

    // Check if message contains backend visualization data (structured data, not markdown)
    if (message?.visualizations && Array.isArray(message.visualizations)) {
      message.visualizations.forEach(viz => {
        if (viz && typeof viz === 'object') {
          parsed.push({ type: 'visualization', content: viz });
        }
      });
    }

    // Check if message contains backend Prometheus metrics (structured data, not markdown)
    if (message?.prometheusData && Array.isArray(message.prometheusData)) {
      message.prometheusData.forEach(metric => {
        if (metric && typeof metric === 'object') {
          parsed.push({ type: 'metric', content: metric });
        }
      });
    }

    // Add remaining content as text - let ReactMarkdown handle all markdown rendering
    // No hardcoded pattern matching for callouts, summaries, D2, charts, etc.
    // AI can write markdown freely and it will render naturally
    if (content && content.length > 0) {
      parsed.push({ type: 'text', content: content });
    }

    return parsed;
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      const id = nanoid();
      setCopiedItems(prev => new Set([...prev, id]));
      setTimeout(() => {
        setCopiedItems(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleExpandToCanvas = (code: string, language: string, filename?: string) => {
    if (onExpandToCanvas) {
      onExpandToCanvas(
        code,
        'code',
        filename || `${language} code`,
        language
      );
    }
  };

  const handleMCPExpandToCanvas = (call: any) => {
    if (onExpandToCanvas) {
      onExpandToCanvas(
        call,
        'mcp-result',
        `${call.toolName} result`,
      );
    }
  };

  const parsedContent = parseContent(directContent || message?.content || '');

  return (
    <div className="message-content space-y-4">
      {/* Token cost display */}
      {showTokenCost && message?.tokenUsage && message?.role === 'assistant' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: tokenCostDelay / 1000 }}
          className="flex justify-end"
        >
          <AnimatedTokenCost
            usage={message.tokenUsage}
            theme={theme}
            isVisible={true}
            delay={tokenCostDelay}
            compact={false}
          />
        </motion.div>
      )}

      {/* Model badge display - shows which model generated this response */}
      {showModelBadges && message?.model && message?.role === 'assistant' && (
        <div className="flex items-center gap-2 mb-2">
          <InlineModelBadge model={message.model} theme={theme} />
          {/* Show tool execution count if any */}
          {(message?.mcpCalls?.length || 0) > 0 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{
                background: 'rgba(34, 197, 94, 0.1)',
                color: 'rgb(34, 197, 94)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                fontSize: '11px'
              }}
            >
              <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" style={{ opacity: 0.8 }}>
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
              <span>{message.mcpCalls?.length} tool{(message.mcpCalls?.length || 0) > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
      )}

      {/* Render parsed content */}
      {parsedContent.map((section, index) => {
        const sectionId = `section-${index}`;
        
        switch (section.type) {
          case 'tool-calls':
            // CRITICAL FIX: Never display synthetic tool calls in UI
            // Tool calls should only be processed server-side and results shown as text
            // console.warn('TOOL CALL DEBUG: Synthetic tool call section detected and blocked', {
            //   toolCallCount: section.content.toolCalls?.length || 0,
            //   sectionId
            // });
            return null;

          case 'thinking-block':
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="mb-4"
              >
                <InlineThinkingBlock
                  content={section.content}
                  isExpanded={expandedSections.has(sectionId)}
                  onToggle={() => {
                    setExpandedSections(prev => {
                      const next = new Set(prev);
                      if (next.has(sectionId)) {
                        next.delete(sectionId);
                      } else {
                        next.add(sectionId);
                      }
                      return next;
                    });
                  }}
                />
              </motion.div>
            );

          // MCP calls case removed - now handled separately in ChatMessages.tsx
          // This prevents duplicate rendering and ensures correct chronological order

          case 'code':
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="code-block-wrapper"
              >
                <SimpleCodeBlock
                  code={section.content.code}
                  language={section.content.language}
                  theme={theme}
                  onCopy={handleCopy}
                  isStreaming={isStreaming}
                />
              </motion.div>
            );

          case 'visualization':
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <DataVisualization
                  data={section.content}
                  theme={theme}
                />
              </motion.div>
            );

          case 'metric':
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <MetricCard
                  metric={section.content}
                  theme={theme}
                />
              </motion.div>
            );

          case 'text':
          default:
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="max-w-none llm-content prose-sm-tight"
                style={{ color: 'var(--color-text)' }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex as any]}
                  // Allow image:// protocol URLs (custom protocol for Milvus-stored images)
                  urlTransform={(url) => {
                    // Allow our custom image:// protocol
                    if (url.startsWith('image://')) {
                      return url;
                    }
                    // Allow data URLs
                    if (url.startsWith('data:')) {
                      return url;
                    }
                    // Allow standard protocols
                    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
                      return url;
                    }
                    // Block other protocols for security
                    return '';
                  }}
                  components={{
                    // Only override code blocks for special rendering (diagrams, syntax highlighting)
                    // All other elements use default browser/markdown rendering - LLM has full control
                    code: ({ node, className, children, ...props }) => {
                      const match = /language-([\w:.+-]+)/.exec(className || '');
                      const isInline = !match;

                      // Inline code - minimal styling, no grey boxes
                      if (isInline) {
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      }

                      const codeString = String(children).replace(/\n$/, '');
                      const language = match ? match[1] : "plaintext";

                      // React Flow diagrams - render natively without MCP
                      // Supports: diagram, diagram-json, flowchart, flowchart-json, reactflow
                      if (['diagram', 'diagram-json', 'flowchart', 'flowchart-json', 'reactflow'].includes(language)) {
                        try {
                          const diagramDef = parseDiagramJson(codeString);
                          if (diagramDef) {
                            return (
                              <div className="my-4">
                                <ReactFlowDiagram
                                  diagram={diagramDef}
                                  height={450}
                                  showControls={true}
                                  interactive={true}
                                />
                              </div>
                            );
                          }
                        } catch (e) {
                          console.warn('Failed to parse diagram JSON:', e);
                          // Fall through to code block if parse fails
                        }
                      }

                      // Charts (JSON specifications) - render as visual charts
                      if (language === 'chart' || language === 'chart-json') {
                        try {
                          const chartSpec = JSON.parse(codeString);
                          return (
                            <ChartRenderer
                              chartSpec={chartSpec}
                              theme={theme}
                              height={400}
                            />
                          );
                        } catch {
                          // If JSON parse fails, fall through to code block
                        }
                      }

                      // Venn diagrams - render as overlapping circles
                      if (language === 'venn' || language === 'venn-json') {
                        try {
                          const vennDef = parseVennJson(codeString);
                          if (vennDef) {
                            return (
                              <div className="my-4">
                                <VennDiagram
                                  venn={vennDef}
                                  height={400}
                                />
                              </div>
                            );
                          }
                        } catch {
                          // If parse fails, fall through to code block
                        }
                      }

                      // Interactive Artifacts - render in sandboxed iframe
                      // Supports: artifact:html, artifact:react, artifact:svg, artifact:mermaid,
                      //           artifact:chart, artifact:markdown, artifact:latex, artifact:csv, artifact:canvas
                      if (language.startsWith('artifact:')) {
                        const artifactType = language.replace('artifact:', '') as
                          'html' | 'react' | 'svg' | 'mermaid' | 'chart' | 'markdown' | 'latex' | 'csv' | 'canvas';
                        return (
                          <div className="my-4">
                            <ArtifactRenderer
                              code={codeString}
                              type={artifactType}
                              theme={theme}
                            />
                          </div>
                        );
                      }

                      // Also support standalone mermaid blocks (common LLM pattern)
                      if (language === 'mermaid') {
                        return (
                          <div className="my-4">
                            <ArtifactRenderer
                              code={codeString}
                              type="mermaid"
                              theme={theme}
                            />
                          </div>
                        );
                      }

                      // Also support standalone latex/math blocks
                      if (language === 'latex' || language === 'tex' || language === 'math') {
                        return (
                          <div className="my-4">
                            <ArtifactRenderer
                              code={codeString}
                              type="latex"
                              theme={theme}
                            />
                          </div>
                        );
                      }

                      // Also support standalone csv blocks for data tables
                      if (language === 'csv') {
                        return (
                          <div className="my-4">
                            <ArtifactRenderer
                              code={codeString}
                              type="csv"
                              theme={theme}
                            />
                          </div>
                        );
                      }

                      // Support HTML code blocks as renderable artifacts
                      // LLMs often just use 'html' instead of 'artifact:html'
                      if (language === 'html' || language === 'htm') {
                        return (
                          <div className="my-4">
                            <ArtifactRenderer
                              code={codeString}
                              type="html"
                              theme={theme}
                            />
                          </div>
                        );
                      }

                      // Support React/JSX code blocks as renderable artifacts
                      // LLMs often use 'jsx', 'tsx', or 'react' instead of 'artifact:react'
                      if (language === 'jsx' || language === 'tsx' || language === 'react') {
                        return (
                          <div className="my-4">
                            <ArtifactRenderer
                              code={codeString}
                              type="react"
                              theme={theme}
                            />
                          </div>
                        );
                      }

                      // Support SVG code blocks as renderable artifacts
                      if (language === 'svg') {
                        return (
                          <div className="my-4">
                            <ArtifactRenderer
                              code={codeString}
                              type="svg"
                              theme={theme}
                            />
                          </div>
                        );
                      }

                      // Code blocks - use syntax highlighting with optional execute
                      return (
                        <SimpleCodeBlock
                          code={codeString}
                          language={language}
                          theme={theme}
                          onCopy={handleCopy}
                          onExecute={onExecuteCode}
                          executable={Boolean(onExecuteCode)}
                          isStreaming={isStreaming}
                        />
                      );
                    },
                    // Images - special handling for Milvus image:// protocol
                    img: ({ src, alt }) => (
                      <MilvusImage src={src} alt={alt} theme={theme} />
                    ),
                    // Links - open in new tab for security
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {section.content}
                </ReactMarkdown>
              </motion.div>
            );
        }
      })}
    </div>
  );
};

// Memoize the entire component to prevent re-renders when parent re-renders (e.g., during typing)
// Only re-render if the actual content, theme, or streaming state changes
export default React.memo(EnhancedMessageContent, (prevProps, nextProps) => {
  // Return true if props are equal (no re-render needed)
  const contentEqual = prevProps.content === nextProps.content;
  const messageContentEqual = prevProps.message?.content === nextProps.message?.content;
  const themeEqual = prevProps.theme === nextProps.theme;
  const streamingEqual = prevProps.isStreaming === nextProps.isStreaming;

  // If content hasn't changed and theme/streaming state haven't changed, skip re-render
  return contentEqual && messageContentEqual && themeEqual && streamingEqual;
});