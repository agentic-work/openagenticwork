/**
 * OpenAgenticWork - Flowise Admin Routes Stub
 * https://agenticwork.io
 * Copyright (c) 2026 Agentic Work, Inc.
 *
 * Flowise integration is disabled in open source version.
 */

import { FastifyInstance } from 'fastify';

export async function adminFlowiseRoutes(fastify: FastifyInstance): Promise<void> {
  // Flowise admin routes disabled
  fastify.get('/status', async () => {
    return { enabled: false, message: 'Flowise is not available in this version' };
  });
}

export default adminFlowiseRoutes;
