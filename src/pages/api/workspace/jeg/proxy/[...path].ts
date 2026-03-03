import type { NextApiRequest, NextApiResponse } from 'next';
import {
  buildSecurityHeaders,
  buildIapHeaders,
  buildWorkspaceHeaders,
  evaluateExfiltrationPolicy,
  getDataExfiltrationPolicy,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jupyter-workspace/lib/jegSecurity';

export const config = {
  api: {
    bodyParser: false,
  },
};

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ============================================================================
// NOTEBOOK VIRTUAL STORAGE (In-memory, will be RDS backend)
// ============================================================================

type NotebookStoreRecord = {
  ownerSub: string;
  path: string;
  notebookJsonString: string;
  savedAt: string;
};

type NotebookStore = Record<string, NotebookStoreRecord>;

declare global {
  // eslint-disable-next-line no-var
  var __notebookVirtualDrive: NotebookStore | undefined;
}

function getNotebookStore(): NotebookStore {
  if (!global.__notebookVirtualDrive) {
    global.__notebookVirtualDrive = {};
  }
  return global.__notebookVirtualDrive;
}

function notebookStoreKey(ownerSub: string, notebookPath: string): string {
  return `${ownerSub}::${notebookPath}`;
}

// ============================================================================
// JUPYTERHUB CONFIGURATION
// ============================================================================

function getJupyterHubConfig(): { url: string; username: string; password: string } {
  // Production reads from environment; dev defaults to localhost:8000 with test/test
  const url = process.env.JUPYTERHUB_URL || 'http://localhost:8000';
  const username = process.env.JUPYTERHUB_USERNAME || 'test';
  const password = process.env.JUPYTERHUB_PASSWORD || 'test';

  return { url, username, password };
}

function getJupyterHubBasicAuth(): string {
  const { username, password } = getJupyterHubConfig();
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

function getJupyterHubApiToken(): string {
  // Use JupyterHub API token for authentication (bypasses XSRF requirements)
  return process.env.JUPYTERHUB_API_TOKEN || process.env.JUPYTERHUB_ADMIN_TOKEN || 'admin-secret-123';
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function asPathArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeNotebookPath(requestedPath: string): string {
  const prefix = '/api/contents/';
  if (!requestedPath.toLowerCase().startsWith(prefix)) {
    return requestedPath;
  }
  const raw = requestedPath.slice(prefix.length);
  return decodeURIComponent(raw);
}

async function readRequestBody(req: NextApiRequest): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function buildTargetUrl(req: NextApiRequest, baseUrl: string): URL {
  const pathParts = asPathArray(req.query.path);
  const path = pathParts.map(encodeURIComponent).join('/');
  const target = new URL(`${baseUrl.replace(/\/$/, '')}/${path}`);

  for (const [key, rawValue] of Object.entries(req.query)) {
    if (key === 'path') continue;
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) target.searchParams.append(key, item);
    } else if (typeof rawValue === 'string') {
      target.searchParams.append(key, rawValue);
    }
  }

  return target;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const method = (req.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Resolve user identity from cookie/JWT
  const identityResult = await resolveWorkspaceIdentityFromCookie(
    req.headers.cookie || '',
  );

  if (!identityResult.ok) {
    return res
      .status(identityResult.statusCode)
      .json({ error: identityResult.error });
  }

  const requestedPath = `/${asPathArray(req.query.path).join('/')}`;
  const body = await readRequestBody(req);

  // ============================================================================
  // BLOCK DATA EXFILTRATION (but allow session/kernel management)
  // ============================================================================

  if ((req.url || '').includes('download=1')) {
    return res.status(403).json({ error: 'Data exfiltration blocked' });
  }

  // Allow session and kernel management endpoints (not data exfiltration)
  const isSessionEndpoint = requestedPath === '/api/sessions' || requestedPath.startsWith('/api/sessions/');
  const isKernelEndpoint = requestedPath === '/api/kernels' || requestedPath.startsWith('/api/kernels/');
  const isTerminalEndpoint = requestedPath === '/api/terminals' || requestedPath.startsWith('/api/terminals/');
  
  if (!isSessionEndpoint && !isKernelEndpoint && !isTerminalEndpoint) {
    const policyDecision = evaluateExfiltrationPolicy(
      requestedPath,
      method,
      getDataExfiltrationPolicy(),
    );

    if (!policyDecision.allowed) {
      return res.status(403).json({
        error: policyDecision.reason,
      });
    }
  }

  // ============================================================================
  // HANDLE NOTEBOOK VIRTUAL STORAGE (Local)
  // Notebooks are stored in an in-memory map per user. In production,
  // this would be backed by RDS. Files are never passed to JupyterHub.
  // ============================================================================

  const isNotebookContentsPath =
    requestedPath.toLowerCase().startsWith('/api/contents/') &&
    requestedPath.toLowerCase().endsWith('.ipynb');

  // PUT (Save notebook)
  if (isNotebookContentsPath && method === 'PUT') {
    try {
      const ownerSub = identityResult.identity.userId;
      if (!ownerSub) {
        return res.status(401).json({ error: 'Unable to verify user identity for notebook save.' });
      }

      // Parse notebook from request body
      const parsed = body ? JSON.parse(body.toString('utf8')) : {};
      const type = String(parsed.type || '').toLowerCase();
      const format = String(parsed.format || '').toLowerCase();
      const content = parsed.content;

      if (type === 'notebook' && format === 'json' && content && typeof content === 'object') {
        const notebook = content as Record<string, unknown>;
        const hasCells = Array.isArray(notebook.cells);
        const hasNbformat = typeof notebook.nbformat === 'number';

        if (hasCells && hasNbformat) {
          const notebookPath = normalizeNotebookPath(requestedPath);
          const now = new Date().toISOString();
          const store = getNotebookStore();

          store[notebookStoreKey(ownerSub, notebookPath)] = {
            ownerSub,
            path: notebookPath,
            notebookJsonString: JSON.stringify(notebook),
            savedAt: now,
          };

          return res.status(200).json({
            name: notebookPath.split('/').pop() || notebookPath,
            path: notebookPath,
            type: 'notebook',
            format: 'json',
            mimetype: 'application/x-ipynb+json',
            created: now,
            last_modified: now,
            content: notebook,
          });
        }
      }
    } catch (error) {
      // Fall through to JupyterHub
    }
  }

  // GET (Read notebook)
  if (isNotebookContentsPath && method === 'GET') {
    try {
      const ownerSub = identityResult.identity.userId;
      if (!ownerSub) {
        return res.status(401).json({ error: 'Unable to verify user identity for notebook read.' });
      }

      const notebookPath = normalizeNotebookPath(requestedPath);
      const store = getNotebookStore();
      const record = store[notebookStoreKey(ownerSub, notebookPath)];

      if (record) {
        return res.status(200).json({
          name: notebookPath.split('/').pop() || notebookPath,
          path: notebookPath,
          type: 'notebook',
          format: 'json',
          mimetype: 'application/x-ipynb+json',
          created: record.savedAt,
          last_modified: record.savedAt,
          content: JSON.parse(record.notebookJsonString),
        });
      }
    } catch (error) {
      // Fall through to JupyterHub
    }
  }

  // ============================================================================
  // PROXY ALL OTHER REQUESTS TO JUPYTERHUB
  // ============================================================================

  const { url: jupyterHubUrl, username } = getJupyterHubConfig();
  
  // For session and kernel management, route to the user's Jupyter server
  // instead of the hub API. Format: /user/{username}/api/sessions
  let targetPath = requestedPath;
  if (requestedPath.startsWith('/api/sessions') || requestedPath.startsWith('/api/kernels')) {
    targetPath = `/user/${username}${requestedPath}`;
    console.log(`[JupyterHub Proxy] Routing to user server: ${targetPath}`);
  }
  
  const target = buildTargetUrl(req, jupyterHubUrl);
  // Override the path with the user-scoped path for session/kernel requests
  if (targetPath !== requestedPath) {
    const pathParts = asPathArray(req.query.path);
    const userPath = `/user/${username}/${pathParts.join('/')}`;
    target.pathname = userPath;
  }

  try {
    const upstreamHeaders = new Headers();

    // Copy request headers
    if (req.headers['content-type']) {
      upstreamHeaders.set('content-type', req.headers['content-type'] as string);
    }
    if (req.headers.accept) {
      upstreamHeaders.set('accept', req.headers.accept as string);
    } else if (method === 'GET') {
      upstreamHeaders.set('accept', 'application/json');
    }

    // Add JupyterHub authentication
    // Use API token for session/kernel management (bypasses XSRF), basic auth otherwise
    const isSessionOrKernelRequest = requestedPath.includes('/sessions') || requestedPath.includes('/kernels');
    if (isSessionOrKernelRequest) {
      const token = getJupyterHubApiToken();
      console.log(`[JupyterHub Proxy] Using API token for ${requestedPath}`);
      upstreamHeaders.set('Authorization', `token ${token}`);
    } else {
      const jupyterHubAuth = getJupyterHubBasicAuth();
      upstreamHeaders.set('Authorization', jupyterHubAuth);
    }

    // Add workspace headers
    for (const [key, value] of Object.entries(
      buildWorkspaceHeaders(identityResult.identity),
    )) {
      upstreamHeaders.set(key, value);
    }

    // Add security headers
    for (const [key, value] of Object.entries(buildSecurityHeaders())) {
      upstreamHeaders.set(key, value);
    }

    // Add IAP headers
    for (const [key, value] of Object.entries(buildIapHeaders())) {
      upstreamHeaders.set(key, value);
    }

    const upstreamBody = body !== undefined ? new Uint8Array(body) : undefined;

    // Log requests for debugging
    if (requestedPath.includes('/sessions') || requestedPath.includes('/kernels')) {
      console.log(`[JupyterHub Proxy] ${method} ${target.pathname}`);
      if (body?.length) {
        console.log(`[JupyterHub Proxy] Body size: ${body.length} bytes`);
      }
    }

    // For POST/PUT/DELETE requests to JupyterHub session/kernel management,
    // we use API token authentication which doesn't require XSRF tokens
    let finalHeaders = upstreamHeaders;
    let finalBody = upstreamBody;
    
    // No need for XSRF handling with API token authentication
    // Token-based API access bypasses XSRF protection

    // Execute upstream request to JupyterHub
    // Follow redirects automatically (needed for JupyterHub's /hub prefix)
    const upstream = await fetch(target.toString(), {
      method,
      headers: finalHeaders,
      body: finalBody,
      redirect: 'follow',
    });

    // Copy response status and headers
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    const contentDisposition = upstream.headers.get('content-disposition');
    const cacheControl = upstream.headers.get('cache-control');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentDisposition) {
      res.setHeader('Content-Disposition', contentDisposition);
    }
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);

    // Log response for debugging
    if (!upstream.ok && (requestedPath.includes('/sessions') || requestedPath.includes('/kernels'))) {
      const respBody = await upstream.clone().text().catch(() => '(unreadable)');
      console.log(`[JupyterHub Proxy] ${method} ${target.pathname} → ${upstream.status}`);
      console.log(`[JupyterHub Proxy] Response: ${respBody.substring(0, 500)}`);
    }

    // Send response body
    const responseBuffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(responseBuffer);
  } catch (error: any) {
    console.error('[JupyterHub Proxy] Error:', error);
    return res.status(502).json({
      error: 'Failed to proxy request to JupyterHub.',
      detail: error?.message || 'Unknown proxy error',
    });
  }
}
