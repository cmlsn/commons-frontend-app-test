import type { NextApiRequest, NextApiResponse } from 'next';
import httpProxy from 'http-proxy';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  assertSecureJegConfiguration,
  buildSecurityHeaders,
  buildIapHeaders,
  buildWorkspaceHeaders,
  type ComputeTier,
  evaluateExfiltrationPolicy,
  getDataExfiltrationPolicy,
  parseJegComputeTierFromCookie,
  parseJegLaunchProfileFromCookie,
  parseJupyterExportContextFromCookie,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jeg-workspace/lib/jegSecurity';
import { COMPUTE_TIER_SPECS } from '@/features/jeg-workspace/lib/computeTierSpecs';

export const config = {
  api: {
    bodyParser: false,
  },
};

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const POLLUTION_BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isKernelLaunchRequest(path: string, method: string): boolean {
  return method === 'POST' && path.toLowerCase().endsWith('/api/kernels');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function safeDeepClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => safeDeepClone(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const clone: Record<string, unknown> = Object.create(null);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (POLLUTION_BLOCKED_KEYS.has(key)) continue;
    clone[key] = safeDeepClone(nestedValue);
  }
  return clone;
}

async function getSessionComputeTier(
  req: NextApiRequest,
  identity: Parameters<typeof parseJegComputeTierFromCookie>[1],
): Promise<ComputeTier | null> {
  const computeTier = await parseJegComputeTierFromCookie(
    req.headers.cookie || '',
    identity,
  );
  return computeTier?.compute.computeTier || null;
}

function injectKernelComputeTierEnv(
  body: Buffer | undefined,
  computeTier: ComputeTier,
): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse((body || Buffer.from('{}')).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body for kernel launch request.');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Kernel launch payload must be a JSON object.');
  }

  const tierSpec = COMPUTE_TIER_SPECS[computeTier];

  const cloned = safeDeepClone(parsed) as Record<string, unknown>;
  const existingEnv = isPlainObject(cloned.env)
    ? (safeDeepClone(cloned.env) as Record<string, unknown>)
    : Object.create(null);

  const injectedEnv: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(existingEnv)) {
    if (POLLUTION_BLOCKED_KEYS.has(key)) continue;
    injectedEnv[key] = value;
  }
  injectedEnv.KERNEL_RESOURCE_CPU = tierSpec.cpu;
  injectedEnv.KERNEL_RESOURCE_MEMORY = tierSpec.memory;
  injectedEnv.KERNEL_RESOURCE_GPU = tierSpec.gpu;
  injectedEnv.KERNEL_PRICING_TIER = computeTier;

  cloned.env = injectedEnv;
  return Buffer.from(JSON.stringify(cloned));
}

function asPathArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeRuntimeProxyPath(path: string): string {
  let normalizedPath = path;

  if (normalizedPath === '/api/jupyter-server/api') {
    normalizedPath = '/api';
  } else if (normalizedPath.startsWith('/api/jupyter-server/api/')) {
    normalizedPath = normalizedPath.replace(
      /^\/api\/jupyter-server\/api/,
      '/api',
    );
  } else if (normalizedPath === '/api/jupyter-server/lab/api') {
    normalizedPath = '/lab/api';
  } else if (normalizedPath.startsWith('/api/jupyter-server/lab/api/')) {
    normalizedPath = normalizedPath.replace(
      /^\/api\/jupyter-server\/lab\/api/,
      '/lab/api',
    );
  }

  if (normalizedPath === '/api/settings' || normalizedPath.startsWith('/api/settings/')) {
    normalizedPath = normalizedPath.replace(/^\/api\/settings/, '/lab/api/settings');
  }

  if (normalizedPath === '/api/themes' || normalizedPath.startsWith('/api/themes/')) {
    normalizedPath = normalizedPath.replace(/^\/api\/themes/, '/lab/api/themes');
  }

  if (
    normalizedPath === '/api/translations'
    || normalizedPath.startsWith('/api/translations/')
  ) {
    normalizedPath = normalizedPath.replace(
      /^\/api\/translations/,
      '/lab/api/translations',
    );
  }

  if (
    normalizedPath === '/api/workspaces'
    || normalizedPath.startsWith('/api/workspaces/')
  ) {
    normalizedPath = normalizedPath.replace(
      /^\/api\/workspaces/,
      '/lab/api/workspaces',
    );
  }

  return normalizedPath;
}

function isSettingsPath(path: string): boolean {
  return path === '/api/settings'
    || path.startsWith('/api/settings/')
    || path === '/lab/api/settings'
    || path.startsWith('/lab/api/settings/');
}

function isKernelspecsPath(path: string): boolean {
  return path === '/api/kernelspecs'
    || path.startsWith('/api/kernelspecs/')
    || path === '/lab/api/kernelspecs'
    || path.startsWith('/lab/api/kernelspecs/');
}

function rewriteKernelspecAssetUrls(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;

  const record = payload as Record<string, unknown>;
  const kernelspecsValue = record.kernelspecs;
  if (!kernelspecsValue || typeof kernelspecsValue !== 'object') return payload;

  const kernelspecs = kernelspecsValue as Record<string, unknown>;
  for (const specKey of Object.keys(kernelspecs)) {
    const specValue = kernelspecs[specKey];
    if (!specValue || typeof specValue !== 'object') continue;

    const spec = specValue as Record<string, unknown>;
    const resourcesValue = spec.resources;
    if (!resourcesValue || typeof resourcesValue !== 'object') continue;

    const resources = resourcesValue as Record<string, unknown>;
    for (const resourceKey of Object.keys(resources)) {
      const resourceValue = resources[resourceKey];
      if (typeof resourceValue !== 'string') continue;
      if (!resourceValue.startsWith('/kernelspecs/')) continue;

      resources[resourceKey] = `/api/workspace/jeg/proxy${resourceValue}`;
    }
  }

  return record;
}

function alternateSettingsPath(path: string): string {
  if (path === '/lab/api/settings' || path.startsWith('/lab/api/settings/')) {
    return path.replace(/^\/lab\/api\/settings/, '/api/settings');
  }
  if (path === '/api/settings' || path.startsWith('/api/settings/')) {
    return path.replace(/^\/api\/settings/, '/lab/api/settings');
  }
  return path;
}

function buildTargetUrl(
  baseUrl: string,
  normalizedPath: string,
  search: string,
): URL {
  return new URL(`${baseUrl.replace(/\/$/, '')}${normalizedPath}${search}`);
}

async function readRequestBody(req: NextApiRequest): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function maybeInjectLaunchProfile(
  requestedPath: string,
  method: string,
  contentType: string | undefined,
  body: Buffer | undefined,
  launchProfile:
    | {
        token: string;
        profile: {
          mode: 'personal' | 'pre-release';
          selectedLibraryIds?: string[];
        };
      }
    | null,
) {
  if (!launchProfile || !body) return body;
  if (method !== 'POST') return body;
  if (!requestedPath.toLowerCase().startsWith('/api/sessions')) return body;
  if (!contentType || !contentType.includes('application/json')) return body;

  try {
    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const enriched = {
      ...parsed,
      gen3LaunchProfile: {
        mode: launchProfile.profile.mode,
        selectedLibraryIds: launchProfile.profile.selectedLibraryIds || [],
      },
    };
    return Buffer.from(JSON.stringify(enriched));
  } catch {
    return body;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const method = (req.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.includes(method)) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let jegServerUrl = '';
  try {
    jegServerUrl = assertSecureJegConfiguration();
  } catch (error: any) {
    return res.status(503).json({ error: error?.message || 'JEG is not configured.' });
  }

  const identityResult = await resolveWorkspaceIdentityFromCookie(
    req.headers.cookie || '',
  );

  if (!identityResult.ok) {
    return res
      .status(identityResult.statusCode)
      .json({ error: identityResult.error });
  }

  const incomingUrl = new URL(req.url || '/', 'http://localhost');
  const requestedPath =
    incomingUrl.pathname.replace(/^\/api\/workspace\/jeg\/proxy/, '') || '/';
  const normalizedRequestedPath = normalizeRuntimeProxyPath(requestedPath);
  const requestedPathWithQuery = `${normalizedRequestedPath}${incomingUrl.search}`;
  const policyDecision = evaluateExfiltrationPolicy(
    requestedPathWithQuery,
    method,
    getDataExfiltrationPolicy(),
  );

  if (!policyDecision.allowed) {
    return res.status(403).json({
      error: policyDecision.reason,
    });
  }

  const target = buildTargetUrl(
    jegServerUrl,
    normalizedRequestedPath,
    incomingUrl.search,
  );
  const requestBody = await readRequestBody(req);
  const contentType = req.headers['content-type'] as string | undefined;
  const isKernelLaunch = isKernelLaunchRequest(normalizedRequestedPath, method);
  let computeTier: ComputeTier | null = null;

  if (isKernelLaunch) {
    computeTier = await getSessionComputeTier(req, identityResult.identity);
    if (computeTier == null) {
      return res.status(402).json({ error: 'Compute tier selection required' });
    }
  }

  try {
    const incomingToken = getAccessToken(req.headers.cookie || '');
    const exportContext = await parseJupyterExportContextFromCookie(
      req.headers.cookie || '',
      identityResult.identity,
    );
    const launchProfile = await parseJegLaunchProfileFromCookie(
      req.headers.cookie || '',
      identityResult.identity,
    );

    const upstreamHeaders: Record<string, string> = {};
    if (contentType) {
      upstreamHeaders['content-type'] = contentType;
    }
    if (req.headers.accept) {
      upstreamHeaders.accept = String(req.headers.accept);
    }
    if (incomingToken) {
      upstreamHeaders.Authorization = `Bearer ${incomingToken}`;
    }
    for (const [key, value] of Object.entries(
      buildWorkspaceHeaders(identityResult.identity),
    )) {
      upstreamHeaders[key] = value;
    }
    if (exportContext) {
      upstreamHeaders['x-jeg-context-jwt'] = exportContext.token;
    }
    if (launchProfile) {
      upstreamHeaders['x-jeg-launch-jwt'] = launchProfile.token;
      upstreamHeaders['x-jeg-launch-mode'] = launchProfile.profile.mode;
    }
    for (const [key, value] of Object.entries(buildSecurityHeaders())) {
      upstreamHeaders[key] = value;
    }
    for (const [key, value] of Object.entries(buildIapHeaders())) {
      upstreamHeaders[key] = value;
    }

    if ((method === 'GET' || method === 'HEAD') && isSettingsPath(normalizedRequestedPath)) {
      const primarySettingsTarget = buildTargetUrl(
        jegServerUrl,
        normalizedRequestedPath,
        incomingUrl.search,
      );
      const fallbackSettingsPath = alternateSettingsPath(normalizedRequestedPath);
      const fallbackSettingsTarget = buildTargetUrl(
        jegServerUrl,
        fallbackSettingsPath,
        incomingUrl.search,
      );

      let upstreamResponse = await fetch(primarySettingsTarget.toString(), {
        method,
        headers: upstreamHeaders,
      });

      if (upstreamResponse.status === 404 && fallbackSettingsPath !== normalizedRequestedPath) {
        upstreamResponse = await fetch(fallbackSettingsTarget.toString(), {
          method,
          headers: upstreamHeaders,
        });
      }

      res.status(upstreamResponse.status);
      const responseContentType = upstreamResponse.headers.get('content-type');
      if (responseContentType) {
        res.setHeader('content-type', responseContentType);
      }

      if (method === 'HEAD') {
        res.end();
        return;
      }

      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
      res.send(responseBody);
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && isKernelspecsPath(normalizedRequestedPath)) {
      const kernelspecsTarget = buildTargetUrl(
        jegServerUrl,
        normalizedRequestedPath,
        incomingUrl.search,
      );

      const upstreamResponse = await fetch(kernelspecsTarget.toString(), {
        method,
        headers: upstreamHeaders,
      });

      res.status(upstreamResponse.status);
      const responseContentType = upstreamResponse.headers.get('content-type');
      if (responseContentType) {
        res.setHeader('content-type', responseContentType);
      }

      if (method === 'HEAD') {
        res.end();
        return;
      }

      const shouldRewriteJson = (responseContentType || '').includes('application/json');
      if (!shouldRewriteJson) {
        const passthroughBody = Buffer.from(await upstreamResponse.arrayBuffer());
        res.send(passthroughBody);
        return;
      }

      const payload = await upstreamResponse.json().catch(() => null);
      const rewritten = rewriteKernelspecAssetUrls(payload);
      res.send(rewritten);
      return;
    }

    const bodyWithLaunch = maybeInjectLaunchProfile(
      normalizedRequestedPath,
      method,
      contentType,
      requestBody,
      launchProfile,
    );
    const proxy = httpProxy.createProxyServer({
      changeOrigin: true,
      autoRewrite: true,
      ws: true,
    });

    await new Promise<void>((resolve) => {
      proxy.once('proxyReq', (proxyReq: any) => {
        for (const [key, value] of Object.entries(upstreamHeaders)) {
          proxyReq.setHeader(key, value);
        }

        let outboundBody = bodyWithLaunch;

        if (isKernelLaunch && computeTier) {
          try {
            outboundBody = injectKernelComputeTierEnv(outboundBody, computeTier);
          } catch (error: any) {
            proxyReq.destroy();
            if (!res.headersSent) {
              res.status(400).json({
                error: error?.message || 'Invalid kernel launch payload.',
              });
            }
            resolve();
            return;
          }
        }

        if (outboundBody !== undefined) {
          proxyReq.removeHeader('transfer-encoding');
          proxyReq.setHeader('Content-Length', String(outboundBody.length));
          proxyReq.write(outboundBody);
          proxyReq.end();
        }
      });

      proxy.once('proxyRes', () => {
        resolve();
      });

      proxy.once('error', (error: unknown) => {
        if (!res.headersSent) {
          res.status(502).json({
            error: 'Failed to proxy request to JEG.',
            detail: (error as Error)?.message || 'Unknown proxy error',
          });
        }
        resolve();
      });

      req.url = `${target.pathname}${target.search}`;
      proxy.web(req, res, {
        target: `${target.protocol}//${target.host}`,
      });
    });

    return;
  } catch (error: any) {
    return res.status(502).json({
      error: 'Failed to proxy request to JEG.',
      detail: error?.message || 'Unknown proxy error',
    });
  }
}
