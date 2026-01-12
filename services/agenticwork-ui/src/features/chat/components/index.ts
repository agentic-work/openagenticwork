

// Barrel exports for Chat components
// Main Chat component exported separately to avoid circular imports
export { default as ChatSidebar } from './ChatSidebar';
export { default as ChatHeader } from './ChatHeader';
export { default as ChatMessages } from './ChatMessages_old';
export { default as ChatInput } from './ChatInput';
export { default as ChatInputBar } from './ChatInputBar';
export { default as EditableMessage } from './EditableMessage';
export { default as ImageViewer } from './ImageViewer';
export { default as LiveUsagePanel } from './LiveUsagePanel';
export { default as MetricsPanel } from './MetricsPanel';
export { default as PersonalTokenUsage } from './PersonalTokenUsage';
export { default as SettingsDropdown } from './SettingsDropdown';
export { default as ToolsPopup } from './ToolsPopup';
export { default as Tooltip } from './Tooltip';

// Export utilities
export * from './utils';

// Agentic Activity Stream (structured thinking display)
export { AgenticActivityStream } from './AgenticActivityStream';
export type {
  ContentBlock,
  AgenticTask,
  ToolCall,
  StreamingState,
  ActivitySection,
  ResponseSummary,
  SuggestedAction,
} from './AgenticActivityStream';

// InlineSteps (existing thinking/tool display)
export { InlineSteps } from './InlineSteps';
export type { InlineStep, DisplayMode } from './InlineSteps';