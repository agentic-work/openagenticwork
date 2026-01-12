/**

 * For all inquiries, please contact:
 * 
 * Agenticwork LLC
 * hello@agenticwork.io
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { VerboseMCPDisplay } from '../VerboseMCPDisplay';
import ShikiCodeBlock from './ShikiCodeBlock';
import { ChatMessage } from '@/types/index';

interface InlineMessageContentProps {
  message: ChatMessage;
  theme: 'light' | 'dark';
  onExpandToCanvas?: (content: any, type: string, title: string, language?: string) => void;
}

const InlineMessageContent: React.FC<InlineMessageContentProps> = ({ 
  message, 
  theme,
  onExpandToCanvas 
}) => {
  // Parse content to find inline tool calls
  const parseContentWithTools = (content: string) => {
    const segments: Array<{ type: 'text' | 'tool'; content: any }> = [];

    // CRITICAL: There should NEVER be synthetic tool calls - eliminate them completely
    // Only real tool calls from actual API responses should be processed
    if (message.toolCalls && message.toolCalls.length > 0) {
      // Log any tool calls to identify where synthetics are coming from
      console.error('TOOL CALL DEBUG:', {
        messageId: message.id,
        toolCalls: message.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.function?.name,
          args: tc.function?.arguments
        }))
      });

      // ZERO TOLERANCE: Don't process ANY tool calls in UI for now
      // All tool calls should be handled server-side and results displayed as text
      const validToolCalls: any[] = [];

      if (validToolCalls.length > 0) {
        // For Claude-style rendering, we need to interleave tool calls with content
        let lastIndex = 0;

        // Look for tool call markers in the content (if any)
        // Otherwise, place tool calls at the beginning
        if (content.includes('[TOOL_CALL_')) {
          const toolCallRegex = /\[TOOL_CALL_(\d+)\]/g;
          let match;

          while ((match = toolCallRegex.exec(content)) !== null) {
            // Add text before the tool call
            if (match.index > lastIndex) {
              segments.push({
                type: 'text',
                content: content.slice(lastIndex, match.index)
              });
            }

            // Add the tool call
            const toolIndex = parseInt(match[1]);
            if (validToolCalls[toolIndex]) {
              segments.push({
                type: 'tool',
                content: {
                  toolCall: validToolCalls[toolIndex],
                  result: message.toolResults?.[toolIndex]
                }
              });
            }

            lastIndex = match.index + match[0].length;
          }

          // Add remaining text
          if (lastIndex < content.length) {
            segments.push({
              type: 'text',
              content: content.slice(lastIndex)
            });
          }
        } else {
          // No markers found, show tool calls first then content
          // Filter out invalid/broken tool calls
          validToolCalls.forEach((toolCall, index) => {
          // Validate tool call has required data
          if (toolCall?.function?.name &&
              toolCall.function.name !== 'unknown_tool' &&
              toolCall.function.arguments) {
            segments.push({
              type: 'tool',
              content: {
                toolCall,
                result: message.toolResults?.[index]
              }
            });
          }
        });

        if (content) {
          segments.push({
            type: 'text',
            content
          });
        }
        }
      } else {
        // No valid tool calls found, just show the content as text
        if (content) {
          segments.push({
            type: 'text',
            content
          });
        }
      }
    } else {
      // No tool calls, just add the content
      if (content) {
        segments.push({
          type: 'text',
          content
        });
      }
    }
    
    return segments;
  };

  const segments = parseContentWithTools(message.content || '');

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (segment.type === 'tool') {
          const toolCall = segment.content.toolCall;
          let args;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = toolCall.function.arguments;
          }

          return (
            <VerboseMCPDisplay
              key={`tool-${index}`}
              toolCall={{
                id: toolCall.id || `tool-${index}`,
                tool: toolCall.function.name,
                arguments: args,
                result: segment.content.result,
                status: segment.content.result !== undefined ? 'completed' : 'executing'
              }}
              isStreaming={segment.content.result === undefined}
            />
          );
        } else {
          return (
            <div key={`text-${index}`} className="prose-sm-tight">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex as any]}
                components={{
                  // Only override code for syntax highlighting
                  // All other elements use default rendering - LLM has full control
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    const language = match ? match[1] : '';

                    // Code blocks - use syntax highlighting
                    if (!inline && language) {
                      return (
                        <ShikiCodeBlock
                          code={String(children).replace(/\n$/, '')}
                          language={language}
                          theme={theme}
                          onCopy={() => {}}
                        />
                      );
                    }

                    // Inline code - no styling, pass through
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {segment.content}
              </ReactMarkdown>
            </div>
          );
        }
      })}
    </div>
  );
};

export default InlineMessageContent;
