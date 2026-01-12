/**
 * Inline Model Badge Component
 *
 * Shows the model used for a response inline with tool execution badges.
 * Displays model name in a compact badge format similar to InlineMCPIndicator.
 */

import React from 'react';

interface InlineModelBadgeProps {
  model: string;
  theme?: 'light' | 'dark';
}

// Map model IDs to display names
const getModelDisplayName = (model: string): string => {
  // Extract key parts from model names
  if (!model) return 'Unknown';

  // Common patterns
  if (model.includes('claude-opus')) return 'Claude Opus';
  if (model.includes('claude-sonnet')) return 'Claude Sonnet';
  if (model.includes('claude-3-5-sonnet')) return 'Claude 3.5 Sonnet';
  if (model.includes('claude-3-opus')) return 'Claude 3 Opus';
  if (model.includes('claude-haiku')) return 'Claude Haiku';
  if (model.includes('gpt-4o-mini')) return 'GPT-4o Mini';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('gpt-4-turbo')) return 'GPT-4 Turbo';
  if (model.includes('gpt-4')) return 'GPT-4';
  if (model.includes('o1-preview')) return 'o1 Preview';
  if (model.includes('o1-mini')) return 'o1 Mini';
  if (model.includes('gemini-3-pro')) return 'Gemini 3 Pro';
  if (model.includes('gemini-3-flash')) return 'Gemini 3 Flash';
  if (model.includes('gemini-2.0-flash')) return 'Gemini 2 Flash';
  if (model.includes('gemini-2.0')) return 'Gemini 2.0';
  if (model.includes('gemini-1.5-pro')) return 'Gemini 1.5 Pro';
  if (model.includes('gemini-1.5-flash')) return 'Gemini 1.5 Flash';
  if (model.includes('gemini-pro')) return 'Gemini Pro';
  if (model.includes('llama')) return model.split('/').pop()?.split(':')[0] || 'Llama';
  if (model.includes('mistral')) return 'Mistral';
  if (model.includes('mixtral')) return 'Mixtral';
  if (model.includes('deepseek')) return 'DeepSeek';
  if (model.includes('qwen')) return 'Qwen';

  // For Ollama models, extract the model name
  if (model.includes(':')) {
    return model.split(':')[0];
  }

  // Default: clean up the model name
  return model.split('/').pop() || model;
};

// Get provider color based on model
const getProviderColor = (model: string): { bg: string; text: string; border: string } => {
  if (model.includes('claude')) {
    return { bg: 'rgba(210, 140, 90, 0.1)', text: 'rgb(210, 140, 90)', border: 'rgba(210, 140, 90, 0.2)' };
  }
  if (model.includes('gpt') || model.includes('o1')) {
    return { bg: 'rgba(116, 170, 156, 0.1)', text: 'rgb(116, 170, 156)', border: 'rgba(116, 170, 156, 0.2)' };
  }
  if (model.includes('gemini')) {
    return { bg: 'rgba(66, 133, 244, 0.1)', text: 'rgb(66, 133, 244)', border: 'rgba(66, 133, 244, 0.2)' };
  }
  // Default for Ollama/local models
  return { bg: 'rgba(147, 112, 219, 0.1)', text: 'rgb(147, 112, 219)', border: 'rgba(147, 112, 219, 0.2)' };
};

const InlineModelBadge: React.FC<InlineModelBadgeProps> = ({ model, theme }) => {
  if (!model) return null;

  const displayName = getModelDisplayName(model);
  const colors = getProviderColor(model);

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '11px'
      }}
      title={`Model: ${model}`}
    >
      {/* AI icon */}
      <svg
        width="10"
        height="10"
        viewBox="0 0 20 20"
        fill="currentColor"
        style={{ opacity: 0.8 }}
      >
        <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
      </svg>
      <span>{displayName}</span>
    </span>
  );
};

export default InlineModelBadge;
