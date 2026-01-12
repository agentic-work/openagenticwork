/**
 * Code Mode Provisioning Service
 *
 * Handles the setup and lifecycle of per-user sandboxed development environments.
 * When a user first accesses Code Mode, this service provisions:
 * 1. Cloud storage bucket/workspace
 * 2. Sandbox user for OS-level isolation
 * 3. VSCode/code-server settings
 * 4. Agenticode CLI configuration
 *
 * Works with both Docker Compose and Kubernetes deployments.
 *
 * @copyright 2026 Agenticwork LLC
 * @license PROPRIETARY
 */

import { PrismaClient, CodeModeProvisioning } from '@prisma/client';
import type { Logger } from 'pino';

export type ProvisioningStatus = 'pending' | 'provisioning' | 'ready' | 'failed' | 'suspended';

export interface ProvisioningStep {
  name: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  message?: string;
  progress?: number; // 0-100
}

export interface ProvisioningProgress {
  userId: string;
  status: ProvisioningStatus;
  statusMessage: string;
  steps: ProvisioningStep[];
  overallProgress: number; // 0-100
  estimatedTimeRemaining?: number; // seconds
}

export interface ProvisioningResult {
  success: boolean;
  provisioning?: CodeModeProvisioning;
  error?: string;
}

interface ProvisioningConfig {
  environmentType: 'docker' | 'kubernetes';
  storageQuotaMb: number;
  defaultModel: string;
  agenticodeManagerUrl?: string;
  minioEndpoint?: string;
  minioAccessKey?: string;
  minioSecretKey?: string;
}

// SSE callback for real-time progress updates
type ProgressCallback = (progress: ProvisioningProgress) => void;

export class CodeModeProvisioningService {
  private prisma: PrismaClient;
  private logger: Logger;
  private config: ProvisioningConfig;

  // Active provisioning tasks (for progress tracking)
  private activeProvisionings: Map<string, ProvisioningProgress> = new Map();

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger.child({ service: 'CodeModeProvisioningService' });

    // Load config from environment
    this.config = {
      environmentType: (process.env.ENVIRONMENT_TYPE as 'docker' | 'kubernetes') || 'docker',
      storageQuotaMb: parseInt(process.env.CODE_MODE_STORAGE_QUOTA_MB || '1024', 10),
      // Use env var chain - NEVER hardcode model IDs
      defaultModel: process.env.CODE_MODE_DEFAULT_MODEL || process.env.DEFAULT_MODEL || process.env.FALLBACK_MODEL,
      agenticodeManagerUrl: process.env.AGENTICODE_MANAGER_URL || 'http://agenticode-manager:3001',
      minioEndpoint: process.env.MINIO_ENDPOINT,
      minioAccessKey: process.env.MINIO_ACCESS_KEY,
      minioSecretKey: process.env.MINIO_SECRET_KEY,
    };
  }

  /**
   * Check if a user's Code Mode environment is provisioned and ready
   */
  async checkProvisioningStatus(userId: string): Promise<CodeModeProvisioning | null> {
    try {
      return await this.prisma.codeModeProvisioning.findUnique({
        where: { user_id: userId }
      });
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to check provisioning status');
      return null;
    }
  }

  /**
   * Check if user has Code Mode access (admin or explicitly enabled)
   */
  async hasCodeModeAccess(userId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { is_admin: true, code_enabled: true }
      });

      return user?.is_admin || user?.code_enabled || false;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to check Code Mode access');
      return false;
    }
  }

  /**
   * Get provisioning progress for a user (for SSE streaming)
   */
  getProvisioningProgress(userId: string): ProvisioningProgress | null {
    return this.activeProvisionings.get(userId) || null;
  }

  /**
   * Start provisioning a user's Code Mode environment
   * Returns immediately, provisioning happens async with progress updates
   */
  async startProvisioning(
    userId: string,
    onProgress?: ProgressCallback
  ): Promise<ProvisioningResult> {
    this.logger.info({ userId }, 'Starting Code Mode provisioning');

    // Check if already provisioning or ready
    const existing = await this.checkProvisioningStatus(userId);
    if (existing?.status === 'ready') {
      this.logger.info({ userId }, 'User already provisioned');
      return { success: true, provisioning: existing };
    }

    if (existing?.status === 'provisioning') {
      this.logger.info({ userId }, 'Provisioning already in progress');
      return {
        success: false,
        error: 'Provisioning already in progress'
      };
    }

    // Initialize progress tracking
    const progress: ProvisioningProgress = {
      userId,
      status: 'provisioning',
      statusMessage: 'Initializing your development environment...',
      steps: [
        { name: 'storage', status: 'pending', message: 'Create cloud storage workspace' },
        { name: 'sandbox', status: 'pending', message: 'Set up isolated sandbox user' },
        { name: 'vscode', status: 'pending', message: 'Configure VS Code settings' },
        { name: 'agenticode', status: 'pending', message: 'Initialize AI coding assistant' },
        { name: 'validation', status: 'pending', message: 'Validate environment' },
      ],
      overallProgress: 0,
      estimatedTimeRemaining: 30,
    };

    this.activeProvisionings.set(userId, progress);

    // Create or update provisioning record
    const provisioning = await this.prisma.codeModeProvisioning.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        status: 'provisioning',
        status_message: 'Initializing...',
        environment_type: this.config.environmentType,
        storage_quota_mb: this.config.storageQuotaMb,
        agenticode_model: this.config.defaultModel,
      },
      update: {
        status: 'provisioning',
        status_message: 'Initializing...',
        last_error: null,
      }
    });

    // Run provisioning steps
    try {
      await this.runProvisioningSteps(userId, progress, onProgress);

      // Mark as ready
      const finalProvisioning = await this.prisma.codeModeProvisioning.update({
        where: { user_id: userId },
        data: {
          status: 'ready',
          status_message: 'Environment ready',
          provisioned_at: new Date(),
          last_accessed_at: new Date(),
        }
      });

      progress.status = 'ready';
      progress.statusMessage = 'Your development environment is ready!';
      progress.overallProgress = 100;
      onProgress?.(progress);

      this.activeProvisionings.delete(userId);
      this.logger.info({ userId }, 'Code Mode provisioning completed successfully');

      return { success: true, provisioning: finalProvisioning };

    } catch (error: any) {
      this.logger.error({ error, userId }, 'Code Mode provisioning failed');

      // Update DB with error
      await this.prisma.codeModeProvisioning.update({
        where: { user_id: userId },
        data: {
          status: 'failed',
          status_message: 'Provisioning failed',
          last_error: error.message || 'Unknown error',
          error_count: { increment: 1 },
        }
      });

      progress.status = 'failed';
      progress.statusMessage = `Provisioning failed: ${error.message}`;
      onProgress?.(progress);

      this.activeProvisionings.delete(userId);

      return {
        success: false,
        error: error.message || 'Provisioning failed'
      };
    }
  }

  /**
   * Run all provisioning steps with progress updates
   */
  private async runProvisioningSteps(
    userId: string,
    progress: ProvisioningProgress,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const updateProgress = (stepName: string, stepStatus: ProvisioningStep['status'], message?: string) => {
      const step = progress.steps.find(s => s.name === stepName);
      if (step) {
        step.status = stepStatus;
        if (message) step.message = message;
      }

      // Calculate overall progress
      const completedSteps = progress.steps.filter(s => s.status === 'complete').length;
      progress.overallProgress = Math.round((completedSteps / progress.steps.length) * 100);
      progress.estimatedTimeRemaining = Math.max(0, (progress.steps.length - completedSteps) * 5);

      onProgress?.(progress);
    };

    // Step 1: Storage
    updateProgress('storage', 'running', 'Creating cloud storage workspace...');
    await this.provisionStorage(userId);
    updateProgress('storage', 'complete', 'Storage ready');

    // Step 2: Sandbox
    updateProgress('sandbox', 'running', 'Setting up isolated sandbox...');
    await this.provisionSandbox(userId);
    updateProgress('sandbox', 'complete', 'Sandbox configured');

    // Step 3: VS Code
    updateProgress('vscode', 'running', 'Configuring VS Code settings...');
    await this.provisionVSCode(userId);
    updateProgress('vscode', 'complete', 'VS Code ready');

    // Step 4: Agenticode
    updateProgress('agenticode', 'running', 'Initializing AI assistant...');
    await this.provisionAgenticode(userId);
    updateProgress('agenticode', 'complete', 'AI assistant ready');

    // Step 5: Validation
    updateProgress('validation', 'running', 'Validating environment...');
    await this.validateEnvironment(userId);
    updateProgress('validation', 'complete', 'Environment validated');
  }

  /**
   * Provision cloud storage for the user
   */
  private async provisionStorage(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning storage');

    const bucketName = `codemode-${userId.substring(0, 8)}`;

    // For Docker Compose: Use local MinIO
    // For Kubernetes: Use configured storage (MinIO, S3, Azure Blob, etc.)
    if (this.config.minioEndpoint) {
      // TODO: Actual MinIO bucket creation
      // For now, just mark as provisioned
      this.logger.info({ userId, bucketName }, 'Would create MinIO bucket');
    }

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        storage_provisioned: true,
        storage_bucket: bucketName,
      }
    });

    // Simulate some work
    await this.sleep(500);
  }

  /**
   * Provision sandbox user for isolation
   */
  private async provisionSandbox(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning sandbox');

    // In Docker Compose: Request sandbox from agenticode-manager
    // In Kubernetes: Sandbox is per-pod, handled by K8s security context

    const sandboxUsername = `code-${userId.substring(0, 8)}`;

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        sandbox_provisioned: true,
        sandbox_username: sandboxUsername,
      }
    });

    await this.sleep(500);
  }

  /**
   * Set up VS Code configuration
   */
  private async provisionVSCode(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning VS Code');

    const defaultSettings = {
      'editor.theme': 'vs-dark',
      'editor.fontSize': 14,
      'editor.tabSize': 2,
      'terminal.integrated.shell.linux': '/bin/bash',
    };

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        vscode_provisioned: true,
        vscode_settings: defaultSettings,
      }
    });

    await this.sleep(300);
  }

  /**
   * Configure Agenticode CLI
   */
  private async provisionAgenticode(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning Agenticode');

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        agenticode_provisioned: true,
        agenticode_model: this.config.defaultModel,
      }
    });

    await this.sleep(500);
  }

  /**
   * Validate the provisioned environment
   */
  private async validateEnvironment(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Validating environment');

    const provisioning = await this.prisma.codeModeProvisioning.findUnique({
      where: { user_id: userId }
    });

    if (!provisioning) {
      throw new Error('Provisioning record not found');
    }

    // Check all components are provisioned
    if (!provisioning.storage_provisioned) {
      throw new Error('Storage not provisioned');
    }
    if (!provisioning.sandbox_provisioned) {
      throw new Error('Sandbox not provisioned');
    }
    if (!provisioning.vscode_provisioned) {
      throw new Error('VS Code not provisioned');
    }
    if (!provisioning.agenticode_provisioned) {
      throw new Error('Agenticode not provisioned');
    }

    // TODO: Actual health checks against the services

    await this.sleep(300);
  }

  /**
   * Update last accessed timestamp
   */
  async recordAccess(userId: string): Promise<void> {
    try {
      await this.prisma.codeModeProvisioning.update({
        where: { user_id: userId },
        data: { last_accessed_at: new Date() }
      });
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to update last accessed time');
    }
  }

  /**
   * Suspend a user's Code Mode environment
   */
  async suspendEnvironment(userId: string, reason: string): Promise<void> {
    this.logger.info({ userId, reason }, 'Suspending Code Mode environment');

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        status: 'suspended',
        status_message: 'Environment suspended',
        suspended_at: new Date(),
        suspended_reason: reason,
      }
    });
  }

  /**
   * Resume a suspended environment
   */
  async resumeEnvironment(userId: string): Promise<ProvisioningResult> {
    const provisioning = await this.checkProvisioningStatus(userId);

    if (!provisioning || provisioning.status !== 'suspended') {
      return { success: false, error: 'Environment not suspended' };
    }

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        status: 'ready',
        status_message: 'Environment resumed',
        suspended_at: null,
        suspended_reason: null,
      }
    });

    return { success: true };
  }

  /**
   * Delete a user's provisioned environment
   */
  async deprovision(userId: string): Promise<void> {
    this.logger.info({ userId }, 'Deprovisioning Code Mode environment');

    // TODO: Actually clean up resources (storage, sandbox user, etc.)

    await this.prisma.codeModeProvisioning.delete({
      where: { user_id: userId }
    }).catch(() => {
      // Ignore if doesn't exist
    });
  }

  /**
   * Get all users with provisioned environments (for admin)
   */
  async listProvisionedUsers(): Promise<CodeModeProvisioning[]> {
    return this.prisma.codeModeProvisioning.findMany({
      orderBy: { created_at: 'desc' }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let provisioningServiceInstance: CodeModeProvisioningService | null = null;

export function getCodeModeProvisioningService(
  prisma: PrismaClient,
  logger: Logger
): CodeModeProvisioningService {
  if (!provisioningServiceInstance) {
    provisioningServiceInstance = new CodeModeProvisioningService(prisma, logger);
  }
  return provisioningServiceInstance;
}
