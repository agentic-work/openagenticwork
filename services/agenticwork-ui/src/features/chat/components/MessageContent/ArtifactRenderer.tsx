/**
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 *
 * ArtifactRenderer - Renders interactive artifacts inline in chat
 *
 * Supports:
 * - ```artifact:html - Pure HTML with CSS/JS
 * - ```artifact:react - React components (transpiled in browser)
 * - ```artifact:svg - Interactive SVG graphics
 * - ```artifact:mermaid - Mermaid diagrams (flowcharts, sequence, etc.)
 * - ```artifact:chart - Chart.js charts (bar, line, pie, etc.)
 * - ```artifact:markdown - Rich markdown with preview
 * - ```artifact:latex - LaTeX/Math equations
 * - ```artifact:csv - Editable data tables
 * - ```artifact:canvas - Excalidraw-style drawing
 *
 * Security: Uses sandboxed iframe with blob URLs
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play, Maximize2, Minimize2, RefreshCw, Code, Eye, Copy, Check,
  ExternalLink, Download, Printer, Share2, FileText, Image, Database,
  BarChart2, GitBranch, FileCode
} from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';

// All supported artifact types
type ArtifactType = 'html' | 'react' | 'svg' | 'mermaid' | 'chart' | 'markdown' | 'latex' | 'csv' | 'canvas';

interface ArtifactRendererProps {
  code: string;
  type: ArtifactType;
  title?: string;
  theme?: 'light' | 'dark';
  className?: string;
}

// React template that includes Babel for in-browser transpilation
const REACT_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
      min-height: 100vh;
    }
    #root { width: 100%; height: 100%; min-height: 100vh; }
    .error { color: #ef4444; padding: 16px; background: #fef2f2; border-radius: 8px; white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    // Store all React components defined in user code
    window.__REACT_COMPONENTS__ = [];

    // Wrap component definitions to capture them
    const originalCreateElement = React.createElement;

    try {
      // Execute user code - components will be added to global scope
      ${code}

      // Find the component to render (try common names and patterns)
      let ComponentToRender = null;

      // Check for commonly used component names (in order of preference)
      const componentNames = ['App', 'Game', 'Main', 'Root', 'Component', 'Page', 'Widget'];
      for (const name of componentNames) {
        if (typeof window[name] === 'function' || (typeof window[name] === 'object' && window[name]?.$$typeof)) {
          ComponentToRender = window[name];
          break;
        }
      }

      // If no common name found, look for any PascalCase function (React component convention)
      if (!ComponentToRender) {
        const globalKeys = Object.keys(window);
        for (const key of globalKeys) {
          // PascalCase check: starts with uppercase letter
          if (/^[A-Z]/.test(key) && typeof window[key] === 'function') {
            ComponentToRender = window[key];
            break;
          }
        }
      }

      if (ComponentToRender) {
        ReactDOM.createRoot(document.getElementById('root')).render(
          React.createElement(ComponentToRender)
        );
      } else {
        // If no component found, show helpful message
        document.getElementById('root').innerHTML =
          '<div class="error">No React component found to render.\\n\\n' +
          'Define a component like:\\n' +
          'const App = () => <div>Hello World</div>;\\n\\n' +
          'Or use function declaration:\\n' +
          'function Game() { return <div>Game</div>; }</div>';
      }
    } catch (error) {
      document.getElementById('root').innerHTML =
        '<div class="error">React Error: ' + error.message + '\\n\\nStack: ' + (error.stack || 'N/A') + '</div>';
      console.error(error);
    }
  </script>
</body>
</html>
`;

// HTML template with optional dark mode
const HTML_TEMPLATE = (code: string, theme: string) => {
  // Check if code already has full HTML structure
  if (code.trim().toLowerCase().startsWith('<!doctype') || code.trim().toLowerCase().startsWith('<html')) {
    return code;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
  </style>
</head>
<body>
  ${code}
</body>
</html>
`;
};

// SVG template
const SVG_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
    }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  ${code}
</body>
</html>
`;

// Mermaid diagram template
const MERMAID_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    #mermaid-container {
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .mermaid {
      max-width: 100%;
    }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
      font-family: monospace;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div id="mermaid-container">
    <pre class="mermaid">
${code}
    </pre>
  </div>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: '${theme === 'dark' ? 'dark' : 'default'}',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      },
      sequence: {
        useMaxWidth: true
      },
      gantt: {
        useMaxWidth: true
      }
    });

    // Handle errors
    mermaid.parseError = function(err, hash) {
      document.getElementById('mermaid-container').innerHTML =
        '<div class="error">Mermaid Error: ' + err + '</div>';
    };
  </script>
</body>
</html>
`;

// Chart.js template
const CHART_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    #chart-container {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 300px;
    }
    canvas {
      max-width: 100%;
    }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div id="chart-container">
    <canvas id="chart"></canvas>
  </div>
  <script>
    try {
      Chart.defaults.color = '${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'}';
      Chart.defaults.borderColor = '${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}';

      const ctx = document.getElementById('chart').getContext('2d');
      const chartConfig = ${code};
      new Chart(ctx, chartConfig);
    } catch (error) {
      document.getElementById('chart-container').innerHTML =
        '<div class="error">Chart Error: ' + error.message + '</div>';
      console.error(error);
    }
  </script>
</body>
</html>
`;

// Markdown template with marked.js
const MARKDOWN_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-${theme === 'dark' ? 'dark' : 'light'}.min.css">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
    }
    .markdown-body {
      max-width: 100%;
      padding: 16px;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
    }
    .markdown-body pre {
      background: ${theme === 'dark' ? '#0d1117' : '#f6f8fa'};
    }
    .markdown-body code {
      background: ${theme === 'dark' ? '#161b22' : '#f6f8fa'};
    }
  </style>
</head>
<body>
  <div id="content" class="markdown-body"></div>
  <script>
    const content = ${JSON.stringify(code)};
    document.getElementById('content').innerHTML = marked.parse(content);
  </script>
</body>
</html>
`;

// LaTeX/Math template with KaTeX
const LATEX_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/contrib/auto-render.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
    }
    #math-container {
      text-align: center;
      font-size: 1.4em;
    }
    .katex { font-size: 1.2em; }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div id="math-container">${code}</div>
  <script>
    document.addEventListener("DOMContentLoaded", function() {
      try {
        renderMathInElement(document.getElementById("math-container"), {
          delimiters: [
            {left: "$$", right: "$$", display: true},
            {left: "$", right: "$", display: false},
            {left: "\\\\[", right: "\\\\]", display: true},
            {left: "\\\\(", right: "\\\\)", display: false}
          ],
          throwOnError: false
        });
      } catch (error) {
        document.getElementById('math-container').innerHTML =
          '<div class="error">LaTeX Error: ' + error.message + '</div>';
      }
    });
  </script>
</body>
</html>
`;

// CSV table template with interactive editing
const CSV_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    .table-container {
      overflow-x: auto;
      max-width: 100%;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 14px;
    }
    th, td {
      border: 1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'};
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: ${theme === 'dark' ? '#374151' : '#f3f4f6'};
      font-weight: 600;
      position: sticky;
      top: 0;
    }
    tr:nth-child(even) {
      background: ${theme === 'dark' ? '#1f2937' : '#f9fafb'};
    }
    tr:hover {
      background: ${theme === 'dark' ? '#2d3748' : '#f3f4f6'};
    }
    td[contenteditable="true"]:focus {
      outline: 2px solid #3b82f6;
      outline-offset: -2px;
    }
    .controls {
      margin-bottom: 12px;
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      background: #3b82f6;
      color: white;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover {
      background: #2563eb;
    }
    .error {
      color: #ef4444;
      padding: 16px;
      background: ${theme === 'dark' ? '#3d1f1f' : '#fef2f2'};
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="controls">
    <button onclick="addRow()">+ Add Row</button>
    <button onclick="exportCSV()">Export CSV</button>
  </div>
  <div class="table-container">
    <table id="data-table"></table>
  </div>
  <script>
    let data = [];
    const csvContent = ${JSON.stringify(code)};

    function parseCSV(csv) {
      const lines = csv.trim().split('\\n');
      return lines.map(line => {
        // Handle quoted fields with commas
        const result = [];
        let inQuotes = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      });
    }

    function renderTable() {
      const table = document.getElementById('data-table');
      if (data.length === 0) {
        table.innerHTML = '<tr><td>No data</td></tr>';
        return;
      }

      let html = '<thead><tr>';
      data[0].forEach((header, i) => {
        html += '<th contenteditable="true" data-row="0" data-col="' + i + '">' + header + '</th>';
      });
      html += '</tr></thead><tbody>';

      for (let i = 1; i < data.length; i++) {
        html += '<tr>';
        data[i].forEach((cell, j) => {
          html += '<td contenteditable="true" data-row="' + i + '" data-col="' + j + '">' + cell + '</td>';
        });
        html += '</tr>';
      }
      html += '</tbody>';
      table.innerHTML = html;

      // Add event listeners for edits
      table.querySelectorAll('[contenteditable]').forEach(cell => {
        cell.addEventListener('blur', function() {
          const row = parseInt(this.dataset.row);
          const col = parseInt(this.dataset.col);
          data[row][col] = this.textContent;
        });
      });
    }

    function addRow() {
      if (data.length === 0) return;
      const newRow = data[0].map(() => '');
      data.push(newRow);
      renderTable();
    }

    function exportCSV() {
      const csv = data.map(row => row.map(cell => {
        if (cell.includes(',') || cell.includes('"')) {
          return '"' + cell.replace(/"/g, '""') + '"';
        }
        return cell;
      }).join(',')).join('\\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    try {
      data = parseCSV(csvContent);
      renderTable();
    } catch (error) {
      document.querySelector('.table-container').innerHTML =
        '<div class="error">CSV Error: ' + error.message + '</div>';
    }
  </script>
</body>
</html>
`;

// Canvas drawing template (simple Excalidraw-like)
const CANVAS_TEMPLATE = (code: string, theme: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      overflow: hidden;
    }
    .toolbar {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 4px;
      padding: 8px;
      background: ${theme === 'dark' ? '#374151' : '#f3f4f6'};
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 100;
    }
    .toolbar button {
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${theme === 'dark' ? '#e0e0e0' : '#1a1a1a'};
    }
    .toolbar button:hover {
      background: ${theme === 'dark' ? '#4b5563' : '#e5e7eb'};
    }
    .toolbar button.active {
      background: #3b82f6;
      color: white;
    }
    .color-picker {
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      padding: 4px;
    }
    canvas {
      cursor: crosshair;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="pen" class="active" title="Pen">✏️</button>
    <button id="line" title="Line">📏</button>
    <button id="rect" title="Rectangle">⬜</button>
    <button id="circle" title="Circle">⭕</button>
    <button id="text" title="Text">🔤</button>
    <button id="eraser" title="Eraser">🧹</button>
    <input type="color" class="color-picker" id="color" value="#3b82f6">
    <button id="clear" title="Clear">🗑️</button>
    <button id="save" title="Save">💾</button>
  </div>
  <canvas id="canvas"></canvas>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let isDrawing = false;
    let tool = 'pen';
    let color = '#3b82f6';
    let startX, startY;
    let shapes = [];
    let currentPath = [];

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
      redraw();
    }

    function redraw() {
      ctx.fillStyle = '${theme === 'dark' ? '#1a1a2e' : '#ffffff'}';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      shapes.forEach(shape => {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.lineWidth || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (shape.type === 'path') {
          ctx.beginPath();
          shape.points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        } else if (shape.type === 'line') {
          ctx.beginPath();
          ctx.moveTo(shape.x1, shape.y1);
          ctx.lineTo(shape.x2, shape.y2);
          ctx.stroke();
        } else if (shape.type === 'rect') {
          ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
        } else if (shape.type === 'circle') {
          ctx.beginPath();
          ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
          ctx.stroke();
        } else if (shape.type === 'text') {
          ctx.fillStyle = shape.color;
          ctx.font = '16px sans-serif';
          ctx.fillText(shape.text, shape.x, shape.y);
        }
      });
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    canvas.addEventListener('mousedown', e => {
      isDrawing = true;
      const pos = getPos(e);
      startX = pos.x;
      startY = pos.y;

      if (tool === 'pen' || tool === 'eraser') {
        currentPath = [pos];
      } else if (tool === 'text') {
        const text = prompt('Enter text:');
        if (text) {
          shapes.push({ type: 'text', x: pos.x, y: pos.y, text, color });
          redraw();
        }
        isDrawing = false;
      }
    });

    canvas.addEventListener('mousemove', e => {
      if (!isDrawing) return;
      const pos = getPos(e);

      if (tool === 'pen') {
        currentPath.push(pos);
        redraw();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        currentPath.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      } else if (tool === 'eraser') {
        currentPath.push(pos);
        redraw();
        ctx.strokeStyle = '${theme === 'dark' ? '#1a1a2e' : '#ffffff'}';
        ctx.lineWidth = 20;
        ctx.beginPath();
        currentPath.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      } else {
        redraw();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        if (tool === 'line') {
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(pos.x, pos.y);
          ctx.stroke();
        } else if (tool === 'rect') {
          ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
        } else if (tool === 'circle') {
          const r = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
          ctx.beginPath();
          ctx.arc(startX, startY, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    });

    canvas.addEventListener('mouseup', e => {
      if (!isDrawing) return;
      isDrawing = false;
      const pos = getPos(e);

      if (tool === 'pen') {
        shapes.push({ type: 'path', points: currentPath, color, lineWidth: 2 });
      } else if (tool === 'eraser') {
        shapes.push({ type: 'path', points: currentPath, color: '${theme === 'dark' ? '#1a1a2e' : '#ffffff'}', lineWidth: 20 });
      } else if (tool === 'line') {
        shapes.push({ type: 'line', x1: startX, y1: startY, x2: pos.x, y2: pos.y, color });
      } else if (tool === 'rect') {
        shapes.push({ type: 'rect', x: startX, y: startY, w: pos.x - startX, h: pos.y - startY, color });
      } else if (tool === 'circle') {
        const r = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
        shapes.push({ type: 'circle', x: startX, y: startY, r, color });
      }

      currentPath = [];
      redraw();
    });

    // Toolbar handlers
    document.querySelectorAll('.toolbar button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.id === 'clear') {
          shapes = [];
          redraw();
          return;
        }
        if (btn.id === 'save') {
          const link = document.createElement('a');
          link.download = 'drawing.png';
          link.href = canvas.toDataURL();
          link.click();
          return;
        }
        document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tool = btn.id;
      });
    });

    document.getElementById('color').addEventListener('change', e => {
      color = e.target.value;
    });

    // Load initial data if provided
    try {
      const initialData = ${code ? JSON.stringify(code) : 'null'};
      if (initialData && typeof initialData === 'object') {
        shapes = initialData.shapes || [];
      }
    } catch (e) {}

    window.addEventListener('resize', resize);
    resize();
  </script>
</body>
</html>
`;

const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({
  code,
  type,
  title,
  theme = 'dark',
  className = ''
}) => {
  const [isRunning, setIsRunning] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCode, setShowCode] = useState(true); // Default to showing code first
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Generate blob URL for the iframe
  const generateBlobUrl = useMemo(() => {
    try {
      let html: string;
      switch (type) {
        case 'react':
          html = REACT_TEMPLATE(code, theme);
          break;
        case 'svg':
          html = SVG_TEMPLATE(code, theme);
          break;
        case 'mermaid':
          html = MERMAID_TEMPLATE(code, theme);
          break;
        case 'chart':
          html = CHART_TEMPLATE(code, theme);
          break;
        case 'markdown':
          html = MARKDOWN_TEMPLATE(code, theme);
          break;
        case 'latex':
          html = LATEX_TEMPLATE(code, theme);
          break;
        case 'csv':
          html = CSV_TEMPLATE(code, theme);
          break;
        case 'canvas':
          html = CANVAS_TEMPLATE(code, theme);
          break;
        case 'html':
        default:
          html = HTML_TEMPLATE(code, theme);
          break;
      }

      const blob = new Blob([html], { type: 'text/html' });
      return URL.createObjectURL(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate artifact');
      return null;
    }
  }, [code, type, theme]);

  useEffect(() => {
    if (generateBlobUrl) {
      setBlobUrl(generateBlobUrl);
    }

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [generateBlobUrl]);

  const handleRefresh = () => {
    if (iframeRef.current && blobUrl) {
      iframeRef.current.src = blobUrl;
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleOpenExternal = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank');
    }
  };

  // Export/Download functionality
  const handleDownload = useCallback(() => {
    let filename: string;
    let content: string;
    let mimeType: string;

    switch (type) {
      case 'svg':
        filename = `${title || 'graphic'}.svg`;
        content = code;
        mimeType = 'image/svg+xml';
        break;
      case 'mermaid':
        filename = `${title || 'diagram'}.mmd`;
        content = code;
        mimeType = 'text/plain';
        break;
      case 'chart':
        filename = `${title || 'chart'}.json`;
        content = code;
        mimeType = 'application/json';
        break;
      case 'markdown':
        filename = `${title || 'document'}.md`;
        content = code;
        mimeType = 'text/markdown';
        break;
      case 'latex':
        filename = `${title || 'equation'}.tex`;
        content = code;
        mimeType = 'text/x-latex';
        break;
      case 'csv':
        filename = `${title || 'data'}.csv`;
        content = code;
        mimeType = 'text/csv';
        break;
      case 'react':
        filename = `${title || 'component'}.jsx`;
        content = code;
        mimeType = 'text/javascript';
        break;
      case 'html':
      default:
        filename = `${title || 'document'}.html`;
        content = code;
        mimeType = 'text/html';
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, type, title]);

  // Print functionality
  const handlePrint = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  }, []);

  // Share functionality (Web Share API)
  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || 'Artifact',
          text: code,
        });
      } catch (err) {
        // User cancelled or error
        console.log('Share cancelled');
      }
    } else {
      // Fallback: copy to clipboard
      await handleCopy();
    }
  }, [code, title, handleCopy]);

  const getTypeLabel = () => {
    switch (type) {
      case 'react': return 'React Component';
      case 'svg': return 'SVG Graphic';
      case 'html': return 'HTML';
      case 'mermaid': return 'Mermaid Diagram';
      case 'chart': return 'Chart';
      case 'markdown': return 'Markdown';
      case 'latex': return 'LaTeX Math';
      case 'csv': return 'Data Table';
      case 'canvas': return 'Canvas Drawing';
      default: return 'Artifact';
    }
  };

  const getTypeColor = () => {
    switch (type) {
      case 'react': return 'text-cyan-400 bg-cyan-500/10';
      case 'svg': return 'text-amber-400 bg-amber-500/10';
      case 'html': return 'text-orange-400 bg-orange-500/10';
      case 'mermaid': return 'text-indigo-400 bg-indigo-500/10';
      case 'chart': return 'text-green-400 bg-green-500/10';
      case 'markdown': return 'text-blue-400 bg-blue-500/10';
      case 'latex': return 'text-red-400 bg-red-500/10';
      case 'csv': return 'text-emerald-400 bg-emerald-500/10';
      case 'canvas': return 'text-pink-400 bg-pink-500/10';
      default: return 'text-gray-400 bg-gray-500/10';
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'react': return <FileCode size={14} />;
      case 'svg': return <Image size={14} />;
      case 'mermaid': return <GitBranch size={14} />;
      case 'chart': return <BarChart2 size={14} />;
      case 'markdown': return <FileText size={14} />;
      case 'csv': return <Database size={14} />;
      default: return <Code size={14} />;
    }
  };

  if (error) {
    return (
      <div className={`rounded-lg border border-red-500/30 bg-red-500/10 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-red-400 mb-2">
          <span className="font-medium">Artifact Error</span>
        </div>
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-border bg-bg-secondary overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-tertiary">
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded ${getTypeColor()}`}>
            {getTypeIcon()}
            {getTypeLabel()}
          </span>
          {title && (
            <span className="text-sm text-text-secondary">
              {title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Toggle Code/Preview - Code is default, user clicks to show preview */}
          <button
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1.5 px-2 py-1 rounded transition-colors text-xs font-medium hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title={showCode ? 'Show Preview' : 'Show Code'}
          >
            {showCode ? (
              <>
                <Eye size={14} />
                Show Preview
              </>
            ) : (
              <>
                <Code size={14} />
                Show Code
              </>
            )}
          </button>

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Copy code"
          >
            {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Download"
          >
            <Download size={16} />
          </button>

          {/* Print */}
          <button
            onClick={handlePrint}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Print"
          >
            <Printer size={16} />
          </button>

          {/* Share */}
          <button
            onClick={handleShare}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Share"
          >
            <Share2 size={16} />
          </button>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>

          {/* Open in new tab */}
          <button
            onClick={handleOpenExternal}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Open in new tab"
          >
            <ExternalLink size={16} />
          </button>

          {/* Expand/Collapse */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded transition-colors hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {showCode ? (
          <motion.div
            key="code"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`p-4 overflow-auto ${isExpanded ? 'max-h-[600px]' : 'max-h-[300px]'}`}
          >
            <pre className="text-sm font-mono text-text-secondary">
              <code>{code}</code>
            </pre>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={isExpanded ? 'h-[600px]' : 'h-[300px]'}
          >
            {blobUrl && (
              <iframe
                ref={iframeRef}
                src={blobUrl}
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-modals allow-popups"
                title={title || 'Artifact Preview'}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ArtifactRenderer;
