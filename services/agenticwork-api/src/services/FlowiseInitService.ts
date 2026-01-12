/**
 * OpenAgenticWork - Flowise Init Service Stub
 * https://agenticwork.io
 * Copyright (c) 2026 Agentic Work, Inc.
 *
 * Flowise integration is disabled in open source version.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = any[];

interface FlowiseInitResult {
  isInitialized: boolean;
  hasDefaultRoles: boolean;
  hasSystemOrganization: boolean;
}

export class FlowiseInitService {
  async initialize(..._args: AnyArgs): Promise<void> {
    // Stub - Flowise disabled
  }

  async initializeFlowise(..._args: AnyArgs): Promise<FlowiseInitResult> {
    // Stub - Flowise disabled
    return {
      isInitialized: false,
      hasDefaultRoles: false,
      hasSystemOrganization: false,
    };
  }

  async isFlowiseAvailable(): Promise<boolean> {
    return false;
  }

  async disconnect(): Promise<void> {
    // Stub
  }
}

export const flowiseInitService = new FlowiseInitService();

export function getFlowiseInitService(..._args: AnyArgs): FlowiseInitService {
  return flowiseInitService;
}

export default FlowiseInitService;
