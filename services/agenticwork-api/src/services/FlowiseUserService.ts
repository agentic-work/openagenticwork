/**
 * OpenAgenticWork - Flowise User Service Stub
 * https://agenticwork.io
 * Copyright (c) 2026 Agentic Work, Inc.
 *
 * Flowise integration is disabled in open source version.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

interface FlowiseUser {
  id: string;
  email?: string;
  [key: string]: any;
}

export class FlowiseUserService {
  constructor(..._args: any[]) {
    // Stub constructor - accepts any args
  }

  async syncUserToFlowise(..._args: any[]): Promise<void> {
    // Stub - Flowise disabled
  }

  async getFlowiseUser(..._args: any[]): Promise<FlowiseUser | null> {
    return null;
  }

  async getFlowiseUserByEmail(..._args: any[]): Promise<FlowiseUser | null> {
    return null;
  }

  async createFlowiseUser(..._args: any[]): Promise<FlowiseUser | null> {
    return null;
  }

  async ensureFlowiseWorkspace(..._args: any[]): Promise<string | null> {
    return null;
  }

  async ensureFlowiseOrganization(..._args: any[]): Promise<any> {
    return null;
  }

  async linkAgenticUserToFlowise(..._args: any[]): Promise<void> {
    // Stub
  }

  async completeFlowiseUserSetup(..._args: any[]): Promise<void> {
    // Stub
  }

  generateDeterministicPassword(..._args: any[]): string {
    return '';
  }
}

export const flowiseUserService = new FlowiseUserService();
export default FlowiseUserService;
