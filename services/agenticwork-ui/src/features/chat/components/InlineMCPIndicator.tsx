/**
 * Inline MCP Tool Call Indicator
 *
 * Subtle, minimal badge that shows when AI used MCP tools
 * Inspired by Gemini's function call indicators
 * - Small inline badge with icon + tool name
 * - Click to expand/collapse details
 * - Minimal visual footprint
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';

interface InlineMCPIndicatorProps {
  mcpCall: {
    tool?: string;
    name?: string;
    function?: { name?: string };
    args?: any;
    arguments?: any;
    result?: any;
    status?: string;
    executionTime?: number;
  };
  theme?: 'light' | 'dark';
}

// Check if result contains diagram data
const isDiagramResult = (res: any): boolean => {
  if (!res) return false;
  // Check for explicit diagram type
  if (res.type === 'diagram' && res.data) return true;
  // Check if result itself has diagram structure (nodes and edges)
  if (res.nodes && Array.isArray(res.nodes) && res.edges && Array.isArray(res.edges)) return true;
  // Check for nested diagram data
  if (res.diagram && res.diagram.nodes && res.diagram.edges) return true;
  // Check for content array with diagram type
  if (res.content && Array.isArray(res.content)) {
    return res.content.some((c: any) => c.type === 'diagram' || (c.nodes && c.edges));
  }
  return false;
};

// Extract diagram data from various result formats
const extractDiagramData = (res: any): DiagramDefinition | null => {
  if (!res) return null;
  if (res.type === 'diagram' && res.data) return res.data as DiagramDefinition;
  if (res.nodes && Array.isArray(res.nodes)) return res as DiagramDefinition;
  if (res.diagram && res.diagram.nodes) return res.diagram as DiagramDefinition;
  if (res.content && Array.isArray(res.content)) {
    const diagramContent = res.content.find((c: any) => c.type === 'diagram' || (c.nodes && c.edges));
    if (diagramContent) {
      return diagramContent.data || diagramContent;
    }
  }
  return null;
};

const InlineMCPIndicator: React.FC<InlineMCPIndicatorProps> = ({ mcpCall, theme }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = mcpCall.tool || mcpCall.name || mcpCall.function?.name;
  if (!toolName || toolName === 'tool') return null;

  const args = mcpCall.args || mcpCall.arguments || mcpCall.function?.arguments;
  const status = mcpCall.status || (mcpCall.result ? 'completed' : 'calling');

  // Check if this is a diagram result
  const hasDiagram = isDiagramResult(mcpCall.result);
  const diagramData = hasDiagram ? extractDiagramData(mcpCall.result) : null;

  return (
    <span className="inline-block mx-1 align-middle">
      {/* Subtle inline badge */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all hover:scale-105"
        style={{
          background: status === 'completed'
            ? 'rgba(34, 197, 94, 0.1)'
            : 'rgba(251, 191, 36, 0.1)',
          color: status === 'completed'
            ? 'rgb(34, 197, 94)'
            : 'rgb(251, 191, 36)',
          border: `1px solid ${status === 'completed' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(251, 191, 36, 0.2)'}`,
          cursor: 'pointer'
        }}
      >
        {/* Tool icon */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 20 20"
          fill="currentColor"
          style={{ opacity: 0.8 }}
        >
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>

        {/* Tool name */}
        <span style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace' }}>
          {toolName}
        </span>

        {/* Status indicator */}
        <span style={{ fontSize: '9px', opacity: 0.7 }}>
          {status === 'completed' ? '✓' : '⏳'}
        </span>

        {/* Expand/collapse arrow */}
        <svg
          width="8"
          height="8"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={{
            opacity: 0.6,
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          <path d="M6 8L2 4h8z" />
        </svg>
      </button>

      {/* Expandable details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.2 }}
            className="block w-full"
            style={{ overflow: 'hidden' }}
          >
            <div
              className="rounded-lg p-3 mt-2"
              style={{
                background: 'var(--color-bg-tertiary, rgba(0, 0, 0, 0.05))',
                border: '1px solid var(--color-border-primary, rgba(0, 0, 0, 0.1))',
                fontSize: '12px',
                maxWidth: hasDiagram ? '100%' : '500px',  // Allow full width for diagrams
                width: hasDiagram ? '100%' : 'auto'
              }}
            >
              {/* Execution time */}
              {mcpCall.executionTime && (
                <div
                  style={{
                    fontSize: '10px',
                    color: 'var(--color-text-tertiary)',
                    marginBottom: '8px'
                  }}
                >
                  Executed in {mcpCall.executionTime}ms
                </div>
              )}

              {/* Arguments */}
              {args && (
                <details className="mb-2">
                  <summary
                    className="cursor-pointer font-medium"
                    style={{
                      fontSize: '11px',
                      color: 'var(--color-text-secondary)',
                      opacity: 0.8
                    }}
                  >
                    Arguments
                  </summary>
                  <pre
                    className="mt-1 p-2 rounded overflow-x-auto"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      fontSize: '10px',
                      fontFamily: 'ui-monospace, monospace',
                      maxHeight: '150px',
                      overflowY: 'auto'
                    }}
                  >
                    {typeof args === 'string' ? args : JSON.stringify(args, null, 2)}
                  </pre>
                </details>
              )}

              {/* Result - Render diagram if present, otherwise show JSON */}
              {mcpCall.result && (
                <details open={hasDiagram}>
                  <summary
                    className="cursor-pointer font-medium"
                    style={{
                      fontSize: '11px',
                      color: 'var(--color-text-secondary)',
                      opacity: 0.8
                    }}
                  >
                    Result {hasDiagram && <span style={{ color: 'rgb(34, 197, 94)' }}>(Diagram)</span>}
                  </summary>

                  {/* Render diagram if detected */}
                  {hasDiagram && diagramData ? (
                    <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                      <ReactFlowDiagram
                        diagram={diagramData}
                        height={400}
                        interactive={true}
                        showControls={true}
                        showMiniMap={false}
                      />
                    </div>
                  ) : (
                    <pre
                      className="mt-1 p-2 rounded overflow-x-auto"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        fontSize: '10px',
                        fontFamily: 'ui-monospace, monospace',
                        maxHeight: '200px',
                        overflowY: 'auto'
                      }}
                    >
                      {typeof mcpCall.result === 'string'
                        ? mcpCall.result
                        : mcpCall.result.content?.[0]?.text || JSON.stringify(mcpCall.result, null, 2)}
                    </pre>
                  )}
                </details>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
};

export default InlineMCPIndicator;
