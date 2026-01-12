/**
 * Build Indicator Component
 * Shows current git commit, build time, and links to GitHub commit for transparency
 */

import React, { useState } from 'react';
import { GitCommit, ExternalLink, Clock, Tag } from '@/shared/icons';

interface BuildInfo {
  gitCommit: string;
  gitShortCommit: string;
  buildTime: string;
  version: string;
  branch: string;
}

export const BuildIndicator: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  // These values will be replaced at build time by vite
  const buildInfo: BuildInfo = {
    gitCommit: import.meta.env.VITE_GIT_COMMIT || '649715b',
    gitShortCommit: import.meta.env.VITE_GIT_SHORT_COMMIT || '649715b',
    buildTime: import.meta.env.VITE_BUILD_TIME || new Date().toISOString(),
    version: import.meta.env.VITE_VERSION || '1.0.0',
    branch: import.meta.env.VITE_GIT_BRANCH || 'develop'
  };

  const formatBuildTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short'
      });
    } catch {
      return 'Unknown';
    }
  };

  const githubCommitUrl = `https://github.com/agenticwork/agenticworkchat/commit/${buildInfo.gitCommit}`;
  const dockerImageUrl = `https://omcpdevaksagenticregistry.azurecr.io/agenticworkchat-ui:${buildInfo.gitShortCommit}`;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`
          bg-black/90 border border-white/20 rounded-lg
          transition-all duration-150
          ${isExpanded ? 'p-4 min-w-[300px]' : 'p-2'}
        `}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        {!isExpanded ? (
          // Collapsed state - just the commit hash
          <div className="flex items-center gap-2 text-white/70 text-xs font-mono">
            <GitCommit size={12} />
            <span>{buildInfo.gitShortCommit}</span>
          </div>
        ) : (
          // Expanded state - full build info
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-white text-sm font-medium border-b border-white/20 pb-2">
              <Tag size={14} />
              <span>Build Information</span>
            </div>

            <div className="space-y-2 text-xs">
              {/* Git Commit */}
              <div className="flex items-center justify-between">
                <span className="text-white/70">Commit:</span>
                <div className="flex items-center gap-1">
                  <code className="text-white font-mono bg-white/10 px-1 rounded">
                    {buildInfo.gitShortCommit}
                  </code>
                  <a
                    href={githubCommitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                    title="View commit on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Branch */}
              <div className="flex items-center justify-between">
                <span className="text-white/70">Branch:</span>
                <code className="text-white font-mono">{buildInfo.branch}</code>
              </div>

              {/* Build Time */}
              <div className="flex items-center justify-between">
                <span className="text-white/70 flex items-center gap-1">
                  <Clock size={10} />
                  Built:
                </span>
                <span className="text-white/90 text-right">
                  {formatBuildTime(buildInfo.buildTime)}
                </span>
              </div>

              {/* Docker Image */}
              <div className="pt-2 border-t border-white/20">
                <div className="text-white/50 text-[10px] mb-1">Docker Image:</div>
                <div className="text-white/80 font-mono text-[10px] break-all">
                  omcpdevaksagenticregistry.azurecr.io/agenticworkchat-ui:{buildInfo.gitShortCommit}
                </div>
              </div>

              {/* Agenticwork Link */}
              <div className="pt-2 border-t border-white/20">
                <a
                  href="https://agenticwork.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors text-xs"
                >
                  <ExternalLink size={10} />
                  <span>agenticwork.io</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BuildIndicator;