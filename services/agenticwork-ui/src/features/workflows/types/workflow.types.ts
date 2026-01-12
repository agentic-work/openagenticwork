/**
 * Workflow Type Definitions
 * Inspired by n8n's workflow structure, adapted for AgenticWorkChat
 */

export type NodeType =
  | 'trigger'
  | 'mcp_tool'
  | 'llm_completion'
  | 'code'
  | 'condition'
  | 'loop'
  | 'transform'
  | 'merge';

export type TriggerType =
  | 'manual'
  | 'schedule'
  | 'chat_message'
  | 'file_upload'
  | 'webhook'
  | 'admin_action';

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Position {
  x: number;
  y: number;
}

export interface NodeData {
  label: string;
  description?: string;
  icon?: string;
  color?: string;

  // MCP Tool specific
  toolName?: string;
  toolServer?: string;
  serverName?: string;
  arguments?: Record<string, any>;

  // LLM Completion specific
  model?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;

  // Code Node specific
  code?: string;
  language?: 'javascript' | 'python' | 'bash';

  // Condition Node specific
  condition?: string;
  operator?: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'regex';

  // Trigger specific
  triggerType?: TriggerType;
  triggerConfig?: {
    cron?: string;
    timezone?: string;
    messagePattern?: string;
    userType?: 'admin' | 'non_admin' | 'all';
    fileTypes?: string[];
  };

  // Transform specific
  transformType?: 'map' | 'filter' | 'reduce' | 'jsonpath';
  transformExpression?: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: Position;
  data: NodeData;
  measured?: {
    width?: number;
    height?: number;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: 'default' | 'conditional' | 'error';
  label?: string;
  animated?: boolean;
  style?: Record<string, any>;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: WorkflowStatus;
  is_public: boolean;
  tags?: string[];
  created_at: string;
  updated_at: string;
  lastExecutedAt?: string;
  executionCount?: number;
}

export interface ExecutionLog {
  nodeId: string;
  nodeName: string;
  status: ExecutionStatus;
  startTime: string;
  endTime?: string;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  metadata?: {
    tokensUsed?: number;
    cost?: number;
    retryCount?: number;
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  logs: ExecutionLog[];
  result?: any;
  error?: string;
  triggeredBy?: {
    userId: string;
    userName: string;
    trigger: TriggerType;
  };
  metadata?: {
    totalTokens?: number;
    totalCost?: number;
    nodesExecuted?: number;
    nodesTotal?: number;
  };
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'analytics' | 'automation' | 'data_processing' | 'notification' | 'integration';
  definition: WorkflowDefinition;
  icon?: string;
  tags?: string[];
  featured?: boolean;
  adminOnly?: boolean;
}

// Node type configuration for palette
export interface NodeTypeConfig {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
  color: string;
  category: 'trigger' | 'action' | 'logic' | 'ai' | 'data';
  defaultData: Partial<NodeData>;
}

// MCP Tool as Node configuration
export interface MCPToolNode {
  serverId: string;
  serverName: string;
  toolName: string;
  description?: string;
  schema?: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  icon?: string;
  color?: string;
}

// Workflow validation result
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  type: 'missing_connection' | 'invalid_config' | 'circular_dependency' | 'no_trigger';
  message: string;
}

export interface ValidationWarning {
  nodeId?: string;
  type: 'unused_node' | 'missing_error_handling' | 'performance';
  message: string;
}
