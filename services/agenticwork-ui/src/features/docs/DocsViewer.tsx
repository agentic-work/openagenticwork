/**
 * OpenAgenticWork - Docs Viewer Stub
 * https://agenticwork.io
 * Copyright (c) 2026 Agentic Work, Inc.
 *
 * Documentation viewer component - disabled in open source version.
 */

import React from 'react';

interface DocsViewerProps {
  isOpen?: boolean;
  onClose: () => void;
}

export const DocsViewer: React.FC<DocsViewerProps> = ({ onClose }) => {
  // Return null - docs viewer is disabled in open source version
  return null;
};

export default DocsViewer;
