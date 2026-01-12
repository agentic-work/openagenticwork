/**
 * Code Workspace Routes
 *
 * File and storage management for Code Mode:
 * - List files from MinIO user buckets
 * - Upload files to user storage
 * - Download files
 * - Manage vector collections
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Client as MinioClient } from 'minio';
import { Readable, PassThrough } from 'stream';
import archiver from 'archiver';
import { loggers } from '../utils/logger.js';
import { codeModeMilvusService, CodeMetadata } from '../services/CodeModeMilvusService.js';

const logger = loggers.routes;

// MinIO configuration - parse endpoint that may include port (e.g., "minio:9000")
const rawEndpoint = process.env.MINIO_ENDPOINT || 'localhost:9000';
const [MINIO_ENDPOINT, portStr] = rawEndpoint.includes(':')
  ? rawEndpoint.split(':')
  : [rawEndpoint, process.env.MINIO_PORT || '9000'];
const MINIO_PORT = parseInt(portStr);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const MINIO_BUCKET_PREFIX = 'agenticwork-user-';

// SECURITY: Internal API key for code-manager authentication
const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';

/**
 * Create fetch headers with internal authentication
 * SECURITY: All requests to code-manager must include the internal API key
 */
function createInternalHeaders(contentType = false): HeadersInit {
  const headers: HeadersInit = {};
  if (CODE_MANAGER_INTERNAL_KEY) {
    headers['X-Internal-API-Key'] = CODE_MANAGER_INTERNAL_KEY;
  }
  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

// Create MinIO client
let minioClient: MinioClient | null = null;

function getMinioClient(): MinioClient {
  if (!minioClient) {
    minioClient = new MinioClient({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
    logger.info({ endpoint: MINIO_ENDPOINT, port: MINIO_PORT }, '[WORKSPACE] MinIO client initialized');
  }
  return minioClient;
}

// Get user's bucket name
function getUserBucket(userId: string): string {
  // Sanitize userId to create valid bucket name
  const sanitized = userId.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 40);
  return `${MINIO_BUCKET_PREFIX}${sanitized}`;
}

// Ensure user's bucket exists
async function ensureUserBucket(userId: string): Promise<string> {
  const client = getMinioClient();
  const bucketName = getUserBucket(userId);

  try {
    const exists = await client.bucketExists(bucketName);
    if (!exists) {
      await client.makeBucket(bucketName);
      logger.info({ bucketName, userId }, '[WORKSPACE] Created user bucket');
    }
    return bucketName;
  } catch (error) {
    logger.error({ error, bucketName, userId }, '[WORKSPACE] Failed to ensure bucket');
    throw error;
  }
}

// File/folder structure
interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mimeType?: string;
  modified?: string;
  children?: FileNode[];
}

// Build file tree from MinIO objects
function buildFileTree(objects: { name: string; size: number; lastModified: Date }[]): FileNode[] {
  const root: Map<string, FileNode> = new Map();

  for (const obj of objects) {
    const parts = obj.name.split('/');
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!root.has(currentPath)) {
        const node: FileNode = {
          id: currentPath,
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
        };

        if (isFile) {
          node.size = obj.size;
          node.modified = obj.lastModified.toISOString();
          node.mimeType = getMimeType(part);
        } else {
          node.children = [];
        }

        root.set(currentPath, node);

        // Add to parent's children
        if (parentPath && root.has(parentPath)) {
          const parent = root.get(parentPath)!;
          if (!parent.children) parent.children = [];
          parent.children.push(node);
        }
      }
    }
  }

  // Return only root level items
  return Array.from(root.values()).filter(node => !node.path.includes('/'));
}

// Get MIME type from filename
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'txt': 'text/plain',
    'md': 'text/markdown',
    'json': 'application/json',
    'js': 'text/javascript',
    'ts': 'text/typescript',
    'tsx': 'text/typescript',
    'jsx': 'text/javascript',
    'py': 'text/x-python',
    'html': 'text/html',
    'css': 'text/css',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

// Agenticode Manager endpoint for direct filesystem access
const CODE_MANAGER_URL = process.env.AGENTICODE_MANAGER_URL || 'http://agenticode-manager:3050';

// Build file tree from flat list (from agenticode-manager /direct/list)
function buildFileTreeFromList(
  files: Array<{ name: string; type: string; path: string }>,
  baseDir: string
): FileNode[] {
  const nodeMap: Map<string, FileNode> = new Map();

  // First pass: create all nodes
  for (const file of files) {
    const node: FileNode = {
      id: file.path,
      name: file.name,
      path: file.path,
      type: file.type as 'file' | 'directory',
    };

    if (file.type === 'directory') {
      node.children = [];
    } else {
      node.mimeType = getMimeType(file.name);
    }

    nodeMap.set(file.path, node);
  }

  // Second pass: build tree structure
  const roots: FileNode[] = [];

  for (const [path, node] of nodeMap) {
    const parts = path.split('/');

    if (parts.length === 1) {
      // Root level item
      roots.push(node);
    } else {
      // Find parent
      const parentPath = parts.slice(0, -1).join('/');
      const parent = nodeMap.get(parentPath);

      if (parent && parent.children) {
        parent.children.push(node);
      } else {
        // Parent doesn't exist in our list, treat as root
        roots.push(node);
      }
    }
  }

  // Sort: directories first, then alphabetically
  const sortNodes = (nodes: FileNode[]): FileNode[] => {
    return nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    }).map(node => {
      if (node.children) {
        node.children = sortNodes(node.children);
      }
      return node;
    });
  };

  return sortNodes(roots);
}

export default async function codeWorkspaceRoutes(fastify: FastifyInstance) {
  // Get user ID helper
  const getUserId = (request: FastifyRequest): string | null => {
    const user = (request as any).user;
    return user?.userId || user?.id || user?.oid || null;
  };

  /**
   * List session workspace files (from PTY filesystem, NOT MinIO)
   * This returns the actual files the CLI is working with
   * GET /api/code/workspace/session-files?sessionId={id}
   */
  fastify.get('/workspace/session-files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { sessionId } = request.query as { sessionId?: string };

      // List files from the user's workspace directory
      // User workspaces are at /workspaces/{userId}/ directly (not session-based)
      // sessionId is kept in the query for potential future use but not used for path
      const directory = '.';

      const response = await fetch(`${CODE_MANAGER_URL}/direct/list`, {
        method: 'POST',
        headers: createInternalHeaders(true),
        body: JSON.stringify({
          userId,
          directory,
          recursive: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ error, userId, sessionId }, '[WORKSPACE] Failed to list session files from manager');
        return reply.code(response.status).send({ error: 'Failed to list files', details: error });
      }

      const data = await response.json();

      // Transform flat file list to tree structure
      const files = buildFileTreeFromList(data.files || [], directory);

      return reply.send({
        success: true,
        files,
        workspacePath: data.directory,
        sessionId,
        source: 'pty-filesystem',
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to list session files');
      return reply.code(500).send({
        error: 'Failed to list files',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Read file content from session workspace
   * GET /api/code/workspace/session-files/:path
   */
  fastify.get('/workspace/session-file/*', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const filePath = (request.params as any)['*'];
      const { sessionId } = request.query as { sessionId?: string };

      if (!filePath) {
        return reply.code(400).send({ error: 'File path required' });
      }

      // User workspace path - no session subdirectory needed
      const fullPath = filePath;

      const response = await fetch(`${CODE_MANAGER_URL}/direct/read`, {
        method: 'POST',
        headers: createInternalHeaders(true),
        body: JSON.stringify({
          userId,
          filepath: fullPath,
        }),
      });

      if (!response.ok) {
        return reply.code(response.status).send({ error: 'File not found' });
      }

      const data = await response.json();

      return reply.send({
        success: true,
        content: data.content,
        path: filePath,
        source: 'pty-filesystem',
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to read session file');
      return reply.code(500).send({
        error: 'Failed to read file',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Download file from session workspace (PTY filesystem)
   * Returns file as attachment for download instead of JSON
   * GET /api/code/workspace/session-file-download/:path
   */
  fastify.get('/workspace/session-file-download/*', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const filePath = (request.params as any)['*'];
      if (!filePath) {
        return reply.code(400).send({ error: 'File path required' });
      }

      // Read file content from PTY filesystem
      const response = await fetch(`${CODE_MANAGER_URL}/direct/read`, {
        method: 'POST',
        headers: createInternalHeaders(true),
        body: JSON.stringify({
          userId,
          filepath: filePath,
        }),
      });

      if (!response.ok) {
        return reply.code(response.status).send({ error: 'File not found' });
      }

      const data = await response.json();
      const content = data.content;
      const fileName = filePath.split('/').pop() || 'download';
      const mimeType = getMimeType(fileName);

      // Return as downloadable file
      reply.header('Content-Type', mimeType);
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      reply.header('Content-Length', Buffer.byteLength(content, 'utf-8'));

      return reply.send(content);
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to download session file');
      return reply.code(500).send({
        error: 'Failed to download file',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Download folder as ZIP from session workspace (PTY filesystem)
   * Creates a ZIP archive of all files in the folder and streams it back
   * GET /api/code/workspace/session-folder-download/:path
   */
  fastify.get('/workspace/session-folder-download/*', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const folderPath = (request.params as any)['*'] || '.';
      const folderName = folderPath === '.' ? 'workspace' : (folderPath.split('/').pop() || 'folder');

      // Get list of all files in the folder recursively
      const listResponse = await fetch(`${CODE_MANAGER_URL}/direct/list`, {
        method: 'POST',
        headers: createInternalHeaders(true),
        body: JSON.stringify({
          userId,
          directory: folderPath,
          recursive: true,
        }),
      });

      if (!listResponse.ok) {
        return reply.code(listResponse.status).send({ error: 'Folder not found' });
      }

      const listData = await listResponse.json();
      const files = (listData.files || []).filter((f: any) => f.type === 'file');

      if (files.length === 0) {
        return reply.code(404).send({ error: 'No files to download in folder' });
      }

      // Create ZIP archive
      const archive = archiver('zip', { zlib: { level: 6 } });
      const passThrough = new PassThrough();

      // Set response headers for ZIP download
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${folderName}.zip"`);

      // Pipe archive to response stream
      archive.pipe(passThrough);

      // Add each file to the archive
      for (const file of files) {
        try {
          const fileResponse = await fetch(`${CODE_MANAGER_URL}/direct/read`, {
            method: 'POST',
            headers: createInternalHeaders(true),
            body: JSON.stringify({
              userId,
              filepath: file.path,
            }),
          });

          if (fileResponse.ok) {
            const fileData = await fileResponse.json();
            const content = fileData.content;
            // Use relative path within the folder for archive
            const relativePath = file.path.startsWith(folderPath + '/')
              ? file.path.substring(folderPath.length + 1)
              : file.path;
            archive.append(Buffer.from(content, 'utf-8'), { name: relativePath });
          }
        } catch (fileErr) {
          logger.warn({ file: file.path, error: fileErr }, '[WORKSPACE] Failed to read file for ZIP');
        }
      }

      // Finalize the archive
      archive.finalize();

      return reply.send(passThrough);
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to download folder as ZIP');
      return reply.code(500).send({
        error: 'Failed to download folder',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * List workspace files from MinIO (cloud storage)
   * GET /api/code/workspace/files
   */
  fastify.get('/workspace/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const client = getMinioClient();
      const bucketName = await ensureUserBucket(userId);

      // List all objects in user's bucket
      const objects: { name: string; size: number; lastModified: Date }[] = [];
      const stream = client.listObjects(bucketName, '', true);

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) {
            objects.push({
              name: obj.name,
              size: obj.size || 0,
              lastModified: obj.lastModified || new Date(),
            });
          }
        });
        stream.on('error', reject);
        stream.on('end', resolve);
      });

      const files = buildFileTree(objects);

      return reply.send({
        success: true,
        files,
        bucket: bucketName,
        totalFiles: objects.length,
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to list files');
      return reply.code(500).send({
        error: 'Failed to list files',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Upload file to workspace
   * POST /api/code/workspace/files
   */
  fastify.post('/workspace/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const data = await (request as any).file();
      if (!data) {
        return reply.code(400).send({ error: 'No file provided' });
      }

      const client = getMinioClient();
      const bucketName = await ensureUserBucket(userId);

      // Get target path from query or use filename
      const targetPath = (request.query as any).path || data.filename;

      // Upload to MinIO
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      await client.putObject(bucketName, targetPath, buffer, buffer.length, {
        'Content-Type': data.mimetype,
      });

      logger.info({ bucketName, targetPath, size: buffer.length }, '[WORKSPACE] File uploaded');

      return reply.send({
        success: true,
        file: {
          name: data.filename,
          path: targetPath,
          size: buffer.length,
          mimeType: data.mimetype,
        },
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to upload file');
      return reply.code(500).send({
        error: 'Failed to upload file',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Download file from workspace
   * GET /api/code/workspace/files/:path
   */
  fastify.get('/workspace/files/*', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const filePath = (request.params as any)['*'];
      if (!filePath) {
        return reply.code(400).send({ error: 'File path required' });
      }

      const client = getMinioClient();
      const bucketName = await ensureUserBucket(userId);

      // Get file from MinIO
      const stream = await client.getObject(bucketName, filePath);

      // Get file stats
      const stat = await client.statObject(bucketName, filePath);

      reply.header('Content-Type', stat.metaData?.['content-type'] || getMimeType(filePath));
      reply.header('Content-Disposition', `attachment; filename="${filePath.split('/').pop()}"`);
      reply.header('Content-Length', stat.size);

      return reply.send(stream);
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        return reply.code(404).send({ error: 'File not found' });
      }
      logger.error({ error }, '[WORKSPACE] Failed to download file');
      return reply.code(500).send({
        error: 'Failed to download file',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Delete file from workspace
   * DELETE /api/code/workspace/files/:path
   */
  fastify.delete('/workspace/files/*', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const filePath = (request.params as any)['*'];
      if (!filePath) {
        return reply.code(400).send({ error: 'File path required' });
      }

      const client = getMinioClient();
      const bucketName = await ensureUserBucket(userId);

      await client.removeObject(bucketName, filePath);

      logger.info({ bucketName, filePath }, '[WORKSPACE] File deleted');

      return reply.send({ success: true });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to delete file');
      return reply.code(500).send({
        error: 'Failed to delete file',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * List user's vector collection info
   * GET /api/code/collections
   */
  fastify.get('/collections', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Get user's CodeMode collection info
      const collectionInfo = await codeModeMilvusService.getCollectionInfo(userId);

      if (!collectionInfo) {
        return reply.send({
          success: true,
          collections: [],
          message: 'No collection created yet. Embeddings will be stored automatically.',
        });
      }

      return reply.send({
        success: true,
        collections: [{
          id: collectionInfo.name,
          name: collectionInfo.name,
          numEntities: collectionInfo.vectorCount,
          dimension: 1536,
          status: collectionInfo.status,
          createdAt: collectionInfo.createdAt?.toISOString(),
          lastAccessed: collectionInfo.lastAccessed?.toISOString(),
        }],
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to list collections');
      return reply.code(500).send({
        error: 'Failed to list collections',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Ensure user's collection exists (creates if needed)
   * POST /api/code/collections
   */
  fastify.post('/collections', async (request: FastifyRequest<{ Body: { name?: string } }>, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Create/ensure user's collection exists
      const collectionName = await codeModeMilvusService.ensureUserCollection(userId);
      const info = await codeModeMilvusService.getCollectionInfo(userId);

      return reply.send({
        success: true,
        collection: {
          id: collectionName,
          name: collectionName,
          numEntities: info?.vectorCount || 0,
          dimension: 1536,
          status: info?.status || 'active',
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to create collection');
      return reply.code(500).send({
        error: 'Failed to create collection',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Store embeddings in user's collection
   * POST /api/code/collections/embeddings
   */
  fastify.post<{
    Body: {
      content: string;
      embedding: number[];
      metadata?: Partial<CodeMetadata>;
    }
  }>('/collections/embeddings', async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { content, embedding, metadata = {} } = request.body;

      if (!content || !embedding) {
        return reply.code(400).send({ error: 'Content and embedding required' });
      }

      const id = await codeModeMilvusService.storeEmbedding(userId, {
        content,
        embedding,
        metadata: {
          timestamp: Date.now(),
          ...metadata,
        } as CodeMetadata,
      });

      return reply.send({
        success: true,
        embeddingId: id,
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to store embedding');
      return reply.code(500).send({
        error: 'Failed to store embedding',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Batch store embeddings
   * POST /api/code/collections/embeddings/batch
   */
  fastify.post<{
    Body: {
      embeddings: Array<{
        content: string;
        embedding: number[];
        metadata?: Partial<CodeMetadata>;
      }>;
    }
  }>('/collections/embeddings/batch', async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { embeddings } = request.body;

      if (!Array.isArray(embeddings) || embeddings.length === 0) {
        return reply.code(400).send({ error: 'Embeddings array required' });
      }

      const entries = embeddings.map(e => ({
        content: e.content,
        embedding: e.embedding,
        metadata: {
          timestamp: Date.now(),
          ...e.metadata,
        } as CodeMetadata,
      }));

      const ids = await codeModeMilvusService.batchStoreEmbeddings(userId, entries);

      return reply.send({
        success: true,
        embeddingIds: ids,
        count: ids.length,
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to batch store embeddings');
      return reply.code(500).send({
        error: 'Failed to batch store embeddings',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Search user's collection
   * POST /api/code/collections/search
   */
  fastify.post<{
    Body: {
      embedding: number[];
      topK?: number;
      sessionId?: string;
      language?: string;
      symbolType?: string;
      filePath?: string;
      minScore?: number;
    }
  }>('/collections/search', async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { embedding, topK, sessionId, language, symbolType, filePath, minScore } = request.body;

      if (!embedding) {
        return reply.code(400).send({ error: 'Query embedding required' });
      }

      const results = await codeModeMilvusService.search(userId, embedding, {
        topK,
        sessionId,
        language,
        symbolType,
        filePath,
        minScore,
      });

      return reply.send({
        success: true,
        results,
        count: results.length,
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to search collection');
      return reply.code(500).send({
        error: 'Failed to search collection',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Delete embeddings from user's collection
   * DELETE /api/code/collections/embeddings
   */
  fastify.delete<{
    Body: { ids?: string[]; sessionId?: string }
  }>('/collections/embeddings', async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { ids, sessionId } = request.body;

      if (sessionId) {
        // Delete all embeddings for a session
        const count = await codeModeMilvusService.deleteSessionEmbeddings(userId, sessionId);
        return reply.send({
          success: true,
          deletedCount: count,
          message: `Deleted ${count} embeddings for session ${sessionId}`,
        });
      }

      if (ids && ids.length > 0) {
        await codeModeMilvusService.deleteEmbeddings(userId, ids);
        return reply.send({
          success: true,
          deletedCount: ids.length,
        });
      }

      return reply.code(400).send({ error: 'Either ids or sessionId required' });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to delete embeddings');
      return reply.code(500).send({
        error: 'Failed to delete embeddings',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Compact user's collection to optimize storage
   * POST /api/code/collections/compact
   */
  fastify.post('/collections/compact', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      await codeModeMilvusService.compactUserCollection(userId);

      return reply.send({
        success: true,
        message: 'Collection compaction completed',
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to compact collection');
      return reply.code(500).send({
        error: 'Failed to compact collection',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Delete user's entire collection (admin or user request)
   * DELETE /api/code/collections/:id
   */
  fastify.delete('/collections/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // User can only delete their own collection
      await codeModeMilvusService.deleteUserCollection(userId);

      return reply.send({
        success: true,
        message: 'Collection deleted',
      });
    } catch (error) {
      logger.error({ error }, '[WORKSPACE] Failed to delete collection');
      return reply.code(500).send({
        error: 'Failed to delete collection',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * Clone a Git repository to user's workspace
   * POST /api/code/workspace/git/clone
   */
  fastify.post<{ Body: { repoUrl: string; targetDir?: string } }>(
    '/workspace/git/clone',
    async (request: FastifyRequest<{ Body: { repoUrl: string; targetDir?: string } }>, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { repoUrl, targetDir } = request.body;

        if (!repoUrl) {
          return reply.code(400).send({ error: 'Repository URL required' });
        }

        // Validate URL format (basic check)
        const urlPattern = /^(https?:\/\/)?([\w.-]+)(:\d+)?\/[\w./-]+\.git$|^(https?:\/\/)?(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+\/?$/i;
        if (!urlPattern.test(repoUrl)) {
          return reply.code(400).send({ error: 'Invalid repository URL format' });
        }

        // Extract repo name for target directory
        const repoName = targetDir || repoUrl.split('/').pop()?.replace('.git', '') || 'repo';

        // Send clone command to agenticode-manager
        const response = await fetch(`${CODE_MANAGER_URL}/direct/git-clone`, {
          method: 'POST',
          headers: createInternalHeaders(true),
          body: JSON.stringify({
            userId,
            repoUrl,
            targetDir: repoName,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          logger.error({ error, userId, repoUrl }, '[WORKSPACE] Failed to clone repository');
          return reply.code(response.status).send({ error: 'Failed to clone repository', details: error });
        }

        const result = await response.json();

        logger.info({ userId, repoUrl, targetDir: repoName }, '[WORKSPACE] Repository cloned');

        return reply.send({
          success: true,
          message: `Repository cloned to ${repoName}`,
          ...result,
        });
      } catch (error) {
        logger.error({ error }, '[WORKSPACE] Failed to clone repository');
        return reply.code(500).send({
          error: 'Failed to clone repository',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  /**
   * Sync MinIO files TO the PTY session workspace
   * This makes uploaded files available to the CLI
   * POST /api/code/workspace/sync-to-session
   */
  fastify.post<{ Body: { sessionId: string } }>(
    '/workspace/sync-to-session',
    async (request: FastifyRequest<{ Body: { sessionId: string } }>, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { sessionId } = request.body;
        if (!sessionId) {
          return reply.code(400).send({ error: 'Session ID required' });
        }

        // Get files from MinIO
        const client = getMinioClient();
        let bucketName: string;
        try {
          bucketName = await ensureUserBucket(userId);
        } catch (err) {
          // No bucket means no files to sync
          return reply.send({
            success: true,
            syncedCount: 0,
            message: 'No files to sync (no storage bucket)',
          });
        }

        // List all objects in user's bucket
        const objects: { name: string; size: number }[] = [];
        const stream = client.listObjects(bucketName, '', true);

        await new Promise<void>((resolve, reject) => {
          stream.on('data', (obj) => {
            if (obj.name) {
              objects.push({ name: obj.name, size: obj.size || 0 });
            }
          });
          stream.on('error', reject);
          stream.on('end', resolve);
        });

        if (objects.length === 0) {
          return reply.send({
            success: true,
            syncedCount: 0,
            message: 'No files to sync',
          });
        }

        let syncedCount = 0;
        let errorCount = 0;

        // Copy each file from MinIO to PTY workspace
        for (const obj of objects) {
          try {
            // Read file from MinIO
            const fileStream = await client.getObject(bucketName, obj.name);
            const chunks: Buffer[] = [];
            for await (const chunk of fileStream) {
              chunks.push(chunk);
            }
            const content = Buffer.concat(chunks).toString('utf-8');

            // Write to user's PTY workspace directly (no session subdirectory)
            const writeResponse = await fetch(`${CODE_MANAGER_URL}/direct/write`, {
              method: 'POST',
              headers: createInternalHeaders(true),
              body: JSON.stringify({
                userId,
                filepath: obj.name,  // Write directly to user workspace root
                content,
              }),
            });

            if (writeResponse.ok) {
              syncedCount++;
            } else {
              errorCount++;
              logger.warn({ file: obj.name }, '[WORKSPACE] Failed to write file to session');
            }
          } catch (err) {
            errorCount++;
            logger.warn({ err, file: obj.name }, '[WORKSPACE] Failed to sync file to session');
          }
        }

        logger.info({ userId, sessionId, syncedCount, errorCount }, '[WORKSPACE] Files synced to session');

        return reply.send({
          success: true,
          syncedCount,
          errorCount,
          totalFiles: objects.length,
          message: `Synced ${syncedCount} files to session workspace`,
        });
      } catch (error) {
        logger.error({ error }, '[WORKSPACE] Failed to sync files to session');
        return reply.code(500).send({
          error: 'Failed to sync files to session',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  /**
   * Sync workspace files to MinIO storage
   * POST /api/code/workspace/sync
   */
  fastify.post<{ Body: { sessionId?: string } }>(
    '/workspace/sync',
    async (request: FastifyRequest<{ Body: { sessionId?: string } }>, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const { sessionId } = request.body;

        // Get files from user workspace directly (not session-based)
        const listResponse = await fetch(`${CODE_MANAGER_URL}/direct/list`, {
          method: 'POST',
          headers: createInternalHeaders(true),
          body: JSON.stringify({
            userId,
            directory: '.',  // Always use user workspace root
            recursive: true,
          }),
        });

        if (!listResponse.ok) {
          return reply.code(500).send({ error: 'Failed to list workspace files' });
        }

        const { files } = await listResponse.json();
        const client = getMinioClient();
        const bucketName = await ensureUserBucket(userId);

        let syncedCount = 0;
        let errorCount = 0;

        // Sync each file to MinIO
        for (const file of files || []) {
          if (file.type === 'directory') continue;

          try {
            // Read file content
            const readResponse = await fetch(`${CODE_MANAGER_URL}/direct/read`, {
              method: 'POST',
              headers: createInternalHeaders(true),
              body: JSON.stringify({
                userId,
                filepath: file.path,
              }),
            });

            if (!readResponse.ok) continue;

            const { content } = await readResponse.json();
            const buffer = Buffer.from(content, 'utf-8');

            // Upload to MinIO
            await client.putObject(bucketName, file.path, buffer, buffer.length, {
              'Content-Type': getMimeType(file.name),
            });

            syncedCount++;
          } catch (err) {
            errorCount++;
            logger.warn({ err, file: file.path }, '[WORKSPACE] Failed to sync file');
          }
        }

        logger.info({ userId, syncedCount, errorCount }, '[WORKSPACE] Workspace synced to storage');

        return reply.send({
          success: true,
          syncedCount,
          errorCount,
          message: `Synced ${syncedCount} files to storage`,
        });
      } catch (error) {
        logger.error({ error }, '[WORKSPACE] Failed to sync workspace');
        return reply.code(500).send({
          error: 'Failed to sync workspace',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );
}
