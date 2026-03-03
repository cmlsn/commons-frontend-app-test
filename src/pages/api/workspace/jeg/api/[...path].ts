import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveWorkspaceIdentityFromCookie } from '@/features/jupyter-workspace/lib/jegSecurity';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function getJupyterConfig(): { hubUrl: string; adminToken: string } {
  const adminToken = process.env.JUPYTERHUB_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error('JUPYTERHUB_ADMIN_TOKEN environment variable is not set');
  }
  return {
    hubUrl: process.env.JUPYTERHUB_URL || 'http://localhost:8000',
    adminToken,
  };
}

function asPathArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function readRequestBody(req: NextApiRequest): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/**
 * Proxy handler for Datalayer Jupyter API requests
 * 
 * Datalayer automatically appends /api/sessions, /api/kernels, etc.
 * So this endpoint receives paths like /api/workspace/jeg/api/sessions
 * and proxies them to JupyterHub user server at /user/{username}/api/sessions
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const method = (req.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Resolve user identity
  const identityResult = await resolveWorkspaceIdentityFromCookie(
    req.headers.cookie || '',
  );

  if (!identityResult.ok) {
    return res
      .status(identityResult.statusCode)
      .json({ error: identityResult.error });
  }

  const { hubUrl, adminToken } = getJupyterConfig();
  
  // Get username from identity context (already validated above)
  // In development, resolveWorkspaceIdentityFromCookie returns 'local-dev-user'
  // In production, it extracts from authenticated session
  const username = identityResult.identity?.userId || 'unknown';
  
  // Extract path after /api/workspace/jeg/api/
  const pathParts = asPathArray(req.query.path);
  const apiPath = pathParts.join('/');
  
  // Route to user's Jupyter server: /user/{username}/api/{path}
  const targetPath = `/user/${username}/api/${apiPath}`;
  
  // Build target URL
  const target = new URL(`${hubUrl}${targetPath}`);
  
  // Copy query parameters (except 'path')
  for (const [key, rawValue] of Object.entries(req.query)) {
    if (key === 'path') continue;
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) target.searchParams.append(key, item);
    } else if (typeof rawValue === 'string') {
      target.searchParams.append(key, rawValue);
    }
  }

  // Read request body
  const bodyBuffer = await readRequestBody(req);
  const body = bodyBuffer ? bodyBuffer.toString() : undefined;

  // Make upstream request
  try {
    const upstreamRes = await fetch(target.toString(), {
      method,
      headers: {
        'Authorization': `token ${adminToken}`,
        'Content-Type': req.headers['content-type'] || 'application/json',
        ...(req.headers['x-jupyter-kernel-id'] && {
          'X-Jupyter-Kernel-Id': req.headers['x-jupyter-kernel-id'] as string,
        }),
      },
      body: body,
    });

    // Handle redirect responses
    if (upstreamRes.status === 302 || upstreamRes.status === 303) {
      const location = upstreamRes.headers.get('location');
      
      // Check if server needs spawning
      if (location?.includes('/hub/spawn/')) {
        return res.status(424).json({
          error: 'Jupyter server not running',
          message: 'JupyterHub server needs to be spawned',
        });
      }
      
      return res.status(upstreamRes.status).json({
        error: 'Unexpected redirect',
        location,
      });
    }

    // Copy response headers
    const contentType = upstreamRes.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Handle JSON responses
    if (contentType?.includes('application/json')) {
      const data = await upstreamRes.json();
      return res.status(upstreamRes.status).json(data);
    }

    // Handle text responses
    const text = await upstreamRes.text();
    return res.status(upstreamRes.status).send(text);

  } catch (error: any) {
    // Don't expose internal error details to client
    return res.status(502).json({
      error: 'Bad gateway',
      message: 'Failed to proxy request to Jupyter server',
    });
  }
}
