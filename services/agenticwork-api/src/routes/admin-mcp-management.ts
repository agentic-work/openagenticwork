/**
 * Admin MCP Management API Routes
 *
 * Provides comprehensive MCP proxy management:
 * - Dynamic server configuration (JSON-based)
 * - Server lifecycle management (start/stop/restart)
 * - Health monitoring
 * - Tool discovery and registry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

// MCP Proxy base URL (from environment or default to localhost)
const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://localhost:8001';

export default async function adminMCPManagementRoutes(fastify: FastifyInstance) {
  /**
   * GET /admin/mcp/servers
   * List all MCP servers with status
   */
  fastify.get('/mcp/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('[ADMIN-MCP] Fetching all MCP servers');

      // Forward request to MCP proxy
      const response = await fetch(`${MCP_PROXY_URL}/servers`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP proxy returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Transform the MCP proxy response (dict of server_name -> status)
      // into the format the UI expects (array of server objects)
      const servers = Object.entries(data).map(([serverName, serverInfo]: [string, any]) => ({
        id: serverName,
        name: serverName,
        command: serverInfo.command || [],
        args: serverInfo.args || [],
        env: serverInfo.env || {},
        enabled: serverInfo.enabled ?? true,
        status: serverInfo.status || 'unknown',
        health: serverInfo.health || null,
        tools: serverInfo.tools || [],
        toolCount: serverInfo.tool_count || 0,
        createdAt: serverInfo.created_at || new Date().toISOString(),
        updatedAt: serverInfo.updated_at || new Date().toISOString(),
        source: serverInfo.source || 'manual',
        pid: serverInfo.pid || null,
        lastError: serverInfo.last_error || null
      }));

      logger.info('[ADMIN-MCP] Successfully fetched MCP servers', {
        serverCount: servers.length
      });

      return reply.send({ servers });
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to fetch MCP servers', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to fetch MCP servers',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers
   * Add a new MCP server from JSON configuration
   */
  fastify.post('/mcp/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = request.body as any;

      logger.info('[ADMIN-MCP] Adding new MCP server', {
        name: config.name,
        command: config.command
      });

      // Validate required fields
      if (!config.name || !config.command || !Array.isArray(config.command)) {
        return reply.status(400).send({
          error: 'Invalid configuration',
          message: 'Configuration must include "name" and "command" (array)'
        });
      }

      // Forward to MCP proxy
      const response = await fetch(`${MCP_PROXY_URL}/servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully added MCP server', {
        serverId: data.id,
        name: config.name
      });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to add MCP server', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to add MCP server',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/:id/start
   * Start an MCP server
   */
  fastify.post('/mcp/servers/:id/start', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Starting MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully started MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to start MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to start MCP server',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/:id/stop
   * Stop an MCP server
   */
  fastify.post('/mcp/servers/:id/stop', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Stopping MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully stopped MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to stop MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to stop MCP server',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/:id/restart
   * Restart an MCP server
   */
  fastify.post('/mcp/servers/:id/restart', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Restarting MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully restarted MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to restart MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to restart MCP server',
        message: error.message
      });
    }
  });

  /**
   * DELETE /admin/mcp/servers/:id
   * Delete an MCP server
   */
  fastify.delete('/mcp/servers/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Deleting MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully deleted MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to delete MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to delete MCP server',
        message: error.message
      });
    }
  });

  /**
   * PATCH /admin/mcp/servers/:id/enabled
   * Enable or disable an MCP server at runtime
   * State is persisted to Redis and survives restarts
   */
  fastify.patch('/mcp/servers/:id/enabled', async (
    request: FastifyRequest<{ Params: { id: string }; Body: { enabled: boolean } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const { enabled } = request.body;

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          error: 'Invalid request',
          message: 'Request body must include "enabled" (boolean)'
        });
      }

      logger.info('[ADMIN-MCP] Setting server enabled state', {
        serverId: id,
        enabled
      });

      // Use API internal key for service-to-service auth (grants admin access)
      const apiInternalKey = process.env.API_INTERNAL_KEY || '';
      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/enabled`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiInternalKey}`
        },
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.detail || errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully set server enabled state', {
        serverId: id,
        enabled,
        action: data.action
      });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to set server enabled state', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to set server enabled state',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/servers/:id/enabled
   * Get the enabled state of a specific MCP server
   */
  fastify.get('/mcp/servers/:id/enabled', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/enabled`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.detail || errorData.error || response.statusText);
      }

      const data = await response.json();
      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to get server enabled state', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to get server enabled state',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/servers/enabled
   * List enabled states for all MCP servers
   */
  fastify.get('/mcp/servers-enabled', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await fetch(`${MCP_PROXY_URL}/servers/enabled`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.detail || errorData.error || response.statusText);
      }

      const data = await response.json();
      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to list server enabled states', {
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to list server enabled states',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/health
   * Get health status of all MCP servers
   */
  fastify.get('/mcp/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('[ADMIN-MCP] Fetching MCP health status');

      const response = await fetch(`${MCP_PROXY_URL}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP proxy returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully fetched MCP health status');

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to fetch MCP health status', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to fetch MCP health status',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/tools-list
   * Get all tools from all running MCP servers
   */
  fastify.get('/mcp/tools-list', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('[ADMIN-MCP] Fetching all MCP tools');

      const response = await fetch(`${MCP_PROXY_URL}/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP proxy returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully fetched MCP tools', {
        toolCount: data.tools?.length || 0
      });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to fetch MCP tools', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to fetch MCP tools',
        message: error.message
      });
    }
  });
}
