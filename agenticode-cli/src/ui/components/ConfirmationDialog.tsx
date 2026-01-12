/**
 * ConfirmationDialog Component
 * HITL (Human-In-The-Loop) confirmation for destructive actions
 * Shows risk level and requires user confirmation before proceeding
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors } from '../themes/colors.js';
import type { DestructiveAction } from '../../core/hitl.js';
import { getRiskColor, getRiskIcon } from '../../core/hitl.js';

// Nerd Font icons
const ICONS = {
  warning: '\uf071',      // nf-fa-exclamation_triangle
  check: '\uf00c',        // nf-fa-check
  times: '\uf00d',        // nf-fa-times
  shield: '\uf132',       // nf-fa-shield
  terminal: '\uf120',     // nf-fa-terminal
  file: '\uf15b',         // nf-fa-file
  database: '\uf1c0',     // nf-fa-database
  cloud: '\uf0c2',        // nf-fa-cloud
  git: '\ue725',          // nf-dev-git_branch
  docker: '\uf308',       // nf-linux-docker
  kubernetes: '\ue7b2',   // nf-md-kubernetes
};

interface ConfirmationDialogProps {
  action: DestructiveAction;
  onConfirm: () => void;
  onDeny: () => void;
  onAlwaysAllow?: () => void;  // For "Always allow this" option
}

const CATEGORY_ICONS: Record<string, string> = {
  file_delete: ICONS.file,
  file_modify: ICONS.file,
  git_destructive: ICONS.git,
  git_publish: ICONS.git,
  database: ICONS.database,
  docker: ICONS.docker,
  kubernetes: ICONS.kubernetes,
  cloud: ICONS.cloud,
  package: ICONS.terminal,
};

const RISK_LABELS: Record<string, string> = {
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
  critical: 'CRITICAL',
};

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  action,
  onConfirm,
  onDeny,
  onAlwaysAllow,
}) => {
  const [selected, setSelected] = useState<'yes' | 'no' | 'always'>('no');

  useInput((input, key) => {
    // Arrow keys to navigate
    if (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') {
      setSelected(prev => {
        if (prev === 'no') return 'yes';
        if (prev === 'yes') return onAlwaysAllow ? 'always' : 'no';
        return 'no';
      });
    }

    // Tab to cycle
    if (key.tab) {
      setSelected(prev => {
        if (prev === 'no') return 'yes';
        if (prev === 'yes') return onAlwaysAllow ? 'always' : 'no';
        return 'no';
      });
    }

    // Enter to confirm selection
    if (key.return) {
      if (selected === 'yes') onConfirm();
      else if (selected === 'no') onDeny();
      else if (selected === 'always' && onAlwaysAllow) onAlwaysAllow();
    }

    // Shortcuts
    if (input === 'y' || input === 'Y') {
      onConfirm();
    }
    if (input === 'n' || input === 'N' || key.escape) {
      onDeny();
    }
    if ((input === 'a' || input === 'A') && onAlwaysAllow) {
      onAlwaysAllow();
    }
  });

  const riskColor = getRiskColor(action.risk);
  const riskIcon = getRiskIcon(action.risk);
  const categoryIcon = CATEGORY_ICONS[action.category] || ICONS.warning;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={riskColor}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={riskColor} bold>
          {riskIcon} {ICONS.shield} CONFIRMATION REQUIRED
        </Text>
      </Box>

      {/* Risk Level */}
      <Box marginBottom={1}>
        <Text color={colors.textMuted}>Risk Level: </Text>
        <Text color={riskColor} bold>
          {RISK_LABELS[action.risk]}
        </Text>
      </Box>

      {/* Action Description */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={colors.text}>
            {categoryIcon} {action.description}
          </Text>
        </Box>
        {action.command && (
          <Box marginTop={1} paddingLeft={2}>
            <Text color={colors.textMuted} dimColor>
              {ICONS.terminal} {action.command.length > 60 ? action.command.substring(0, 57) + '...' : action.command}
            </Text>
          </Box>
        )}
        {action.filePath && !action.command && (
          <Box marginTop={1} paddingLeft={2}>
            <Text color={colors.textMuted} dimColor>
              {ICONS.file} {action.filePath}
            </Text>
          </Box>
        )}
      </Box>

      {/* Warning for critical actions */}
      {action.risk === 'critical' && (
        <Box marginBottom={1}>
          <Text color={colors.error} bold>
            {ICONS.warning} This action cannot be undone!
          </Text>
        </Box>
      )}

      {/* Options */}
      <Box marginTop={1}>
        <Text color={colors.textMuted}>Allow this action? </Text>
      </Box>
      <Box marginTop={1} gap={2}>
        <Box>
          <Text
            color={selected === 'no' ? colors.error : colors.textMuted}
            bold={selected === 'no'}
            inverse={selected === 'no'}
          >
            {' '}[N]o{' '}
          </Text>
        </Box>
        <Box>
          <Text
            color={selected === 'yes' ? colors.success : colors.textMuted}
            bold={selected === 'yes'}
            inverse={selected === 'yes'}
          >
            {' '}[Y]es{' '}
          </Text>
        </Box>
        {onAlwaysAllow && (
          <Box>
            <Text
              color={selected === 'always' ? colors.warning : colors.textMuted}
              bold={selected === 'always'}
              inverse={selected === 'always'}
            >
              {' '}[A]lways{' '}
            </Text>
          </Box>
        )}
      </Box>

      {/* Help */}
      <Box marginTop={1}>
        <Text color={colors.textMuted} dimColor>
          Use arrows/tab to select, Enter to confirm, or press Y/N/A
        </Text>
      </Box>
    </Box>
  );
};

export default ConfirmationDialog;
