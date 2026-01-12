

import React, { useState } from 'react';
import {
  Wrench, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight,
  Clock, Copy, AlertCircle, Code
} from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';

interface ToolCall {
  // Standard format (our current format)
  id: string;
  tool?: string;
  arguments?: any;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startTime?: number;
  endTime?: number;

  // OpenAI API format (what we actually get from the API)
  type?: string;
  function?: {
    name: string;
    arguments: string;
  };

  // Tool result format
  toolName?: string;
  functionName?: string;
  response?: any;
}

interface EnhancedInlineToolCallProps {
  toolCall: ToolCall;
  isStreaming?: boolean;
}

export const EnhancedInlineToolCall: React.FC<EnhancedInlineToolCallProps> = ({
  toolCall,
  isStreaming = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // Extract data from different formats
  const toolName = toolCall.tool || toolCall.toolName || toolCall.functionName || toolCall.function?.name || 'unknown_tool';

  // Safely parse arguments
  let toolArguments = toolCall.arguments;
  if (!toolArguments && toolCall.function?.arguments) {
    try {
      toolArguments = JSON.parse(toolCall.function.arguments || '{}');
    } catch (e) {
      toolArguments = { raw: toolCall.function.arguments };
    }
  }
  toolArguments = toolArguments || {};

  const toolResult = toolCall.result || toolCall.response;
  const toolError = toolCall.error;

  // Determine status - if we have a result, it's completed
  const status = toolCall.status || (toolResult ? 'completed' : (toolError ? 'failed' : (isStreaming ? 'executing' : 'pending')));

  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-gray-500" />;
      case 'executing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'pending':
        return 'Waiting to execute';
      case 'executing':
        return 'Executing...';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
    }
  };

  const getDuration = () => {
    if (toolCall.startTime && toolCall.endTime) {
      const duration = toolCall.endTime - toolCall.startTime;
      if (duration < 1000) return `${duration}ms`;
      return `${(duration / 1000).toFixed(1)}s`;
    }
    return null;
  };

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatJson = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  return (
    <div className="my-2 rounded-lg overflow-hidden transition-all duration-150 bg-white dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-sm transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
        <Wrench className="w-4 h-4 text-blue-500" />
        <span className="font-mono font-semibold">{toolName}</span>
        {getStatusIcon()}
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {getStatusText()}
        </span>
        {getDuration() && (
          <span className="ml-auto text-xs text-gray-600 dark:text-gray-500">
            {getDuration()}
          </span>
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-800">
              {/* Request Section */}
              {toolArguments && Object.keys(toolArguments).length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400">
                      Request
                    </h4>
                    <button
                      onClick={() => copyToClipboard(formatJson(toolArguments), 'request')}
                      className="p-1 rounded transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-500"
                      title="Copy request"
                    >
                      {copiedSection === 'request' ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <pre className="text-xs font-mono p-3 rounded overflow-x-auto border bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700">
                    {formatJson(toolArguments)}
                  </pre>
                </div>
              )}

              {/* Response Section */}
              {toolResult !== undefined && status === 'completed' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-green-600 dark:text-green-400">
                      Response
                    </h4>
                    <button
                      onClick={() => copyToClipboard(formatJson(toolResult), 'response')}
                      className="p-1 rounded transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-500"
                      title="Copy response"
                    >
                      {copiedSection === 'response' ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <pre className="text-xs font-mono p-3 rounded overflow-x-auto border bg-green-50 dark:bg-gray-900/50 text-green-700 dark:text-green-400/90 border-green-200 dark:border-green-600/30">
                    {formatJson(toolResult)}
                  </pre>
                </div>
              )}

              {/* Error Section */}
              {toolError && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <h4 className="text-sm font-bold text-red-600 dark:text-red-400">
                      Error
                    </h4>
                  </div>
                  <div className="text-sm p-3 rounded border font-mono bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/50">
                    {toolError}
                  </div>
                </div>
              )}

              {/* Executing State */}
              {status === 'executing' && !toolResult && !toolError && (
                <div className="flex items-center justify-center py-4">
                  <motion.div
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="flex items-center gap-2"
                  >
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      Executing {toolName}...
                    </span>
                  </motion.div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
