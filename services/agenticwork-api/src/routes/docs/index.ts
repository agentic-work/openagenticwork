/**
 * OpenAgenticWork - Docs Routes Stub
 * https://agenticwork.io
 * Copyright (c) 2026 Agentic Work, Inc.
 *
 * Documentation routes - disabled in open source version.
 */

import { FastifyInstance } from 'fastify';

export async function docsRoutes(fastify: FastifyInstance): Promise<void> {
  // Docs routes disabled
  fastify.get('/', async () => {
    return { message: 'Documentation is not available in this version' };
  });
}

export default docsRoutes;
