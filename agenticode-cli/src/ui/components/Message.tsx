/**
 * AWCode Message Component
 * Displays chat messages with markdown rendering, code syntax highlighting, and Nerd Font icons
 */

import React from 'react';
import { Box, Text } from 'ink';
import { colors } from '../themes/colors.js';

// Nerd Font icons for message roles
const ROLE_ICONS = {
  user: '\ue285',       // nf-custom-vim_close_prompt / user icon
  assistant: '\uf135',  // nf-fa-rocket / AI assistant
  system: '\uf013',     // nf-fa-cog / system/settings
};

interface MessageProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
}

// Parse content into segments (text, code blocks, inline code)
interface ContentSegment {
  type: 'text' | 'code_block' | 'inline_code';
  content: string;
  language?: string;
}

function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];

  // Regex to match code blocks with optional language
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before this code block
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index);
      segments.push(...parseInlineCode(textContent));
    }

    // Add code block
    segments.push({
      type: 'code_block',
      language: match[1] || 'text',
      content: match[2].trim(),
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push(...parseInlineCode(content.slice(lastIndex)));
  }

  return segments;
}

function parseInlineCode(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const inlineRegex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'inline_code', content: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
}

// Simple syntax highlighting for common patterns
function highlightCode(code: string, language: string): React.ReactNode[] {
  const lines = code.split('\n');

  return lines.map((line, i) => {
    // Basic highlighting based on common patterns
    let highlighted: React.ReactNode = line;

    // Keywords (common across languages)
    const keywords = /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|interface|type|async|await|try|catch|throw|new|this|null|undefined|true|false|def|self|elif|lambda|yield)\b/g;

    // Strings
    const strings = /(["'`])(?:(?!\1)[^\\]|\\.)*?\1/g;

    // Comments
    const comments = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/gm;

    // Numbers
    const numbers = /\b(\d+\.?\d*)\b/g;

    // Simple approach: just color the entire line based on pattern detection
    if (comments.test(line)) {
      highlighted = <Text dimColor>{line}</Text>;
    } else {
      highlighted = <Text>{line}</Text>;
    }

    return (
      <Box key={i}>
        <Text dimColor>{String(i + 1).padStart(3)} │ </Text>
        {highlighted}
      </Box>
    );
  });
}

// Render a code block with language header and line numbers
function CodeBlock({ content, language }: { content: string; language: string }) {
  const langIcon = '\ue7a8';  // nf-dev-code / generic code icon

  return (
    <Box flexDirection="column" marginY={1} borderStyle="round">
      {/* Header with language */}
      <Box paddingX={1} borderStyle="single" borderBottom>
        <Text>{langIcon} </Text>
        <Text bold>{language || 'code'}</Text>
      </Box>
      {/* Code content with line numbers */}
      <Box flexDirection="column" paddingX={1}>
        {highlightCode(content, language)}
      </Box>
    </Box>
  );
}

export const Message: React.FC<MessageProps> = ({ role, content, streaming = false }) => {
  // Parse content into segments
  const segments = streaming ? [{ type: 'text' as const, content }] : parseContent(content);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Content segments - no role indicator, just content */}
      <Box flexDirection="column">
        {segments.map((segment, i) => {
          switch (segment.type) {
            case 'code_block':
              return <CodeBlock key={i} content={segment.content} language={segment.language || 'text'} />;
            case 'inline_code':
              return (
                <Text key={i}>
                  <Text inverse>{segment.content}</Text>
                </Text>
              );
            case 'text':
            default:
              return (
                <Text key={i}>
                  {segment.content}
                </Text>
              );
          }
        })}
        {streaming && <Text>▌</Text>}
      </Box>
    </Box>
  );
};

export default Message;
