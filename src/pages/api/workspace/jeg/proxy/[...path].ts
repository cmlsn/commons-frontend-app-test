import type { NextApiRequest, NextApiResponse } from 'next';
import httpProxy from 'http-proxy';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  assertSecureJegConfiguration,
  buildSecurityHeaders,
  buildIapHeaders,
  buildWorkspaceHeaders,
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
): Promise<string | null> {
  const computeTier = await parseJegComputeTierFromCookie(
    req.headers.cookie || '',
    identity,
  );
  return computeTier?.compute.computeTier || null;
}

function injectKernelComputeTierEnv(
  body: Buffer | undefined,
  computeTier: string,
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
  if (!tierSpec) {
    throw new Error('Unsupported compute tier selection.');
  }

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

  const requestedPath = `/${asPathArray(req.query.path).join('/')}`;
  const queryEntries = Object.entries(req.query).filter(([key]) => key !== 'path');
  const queryParams = new URLSearchParams();
  for (const [key, value] of queryEntries) {
    if (Array.isArray(value)) {
      for (const item of value) queryParams.append(key, item);
    } else if (typeof value === 'string') {
      queryParams.append(key, value);
    }
  }
  const requestedPathWithQuery = queryParams.toString()
    ? `${requestedPath}?${queryParams.toString()}`
    : requestedPath;
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

  const target = buildTargetUrl(req, jegServerUrl);
  const requestBody = await readRequestBody(req);
  const contentType = req.headers['content-type'] as string | undefined;
  const isKernelLaunch = isKernelLaunchRequest(requestedPath, method);
  let computeTier: string | null = null;

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
    const bodyWithLaunch = maybeInjectLaunchProfile(
      requestedPath,
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
        if (contentType) {
          proxyReq.setHeader('content-type', contentType);
        }
        if (req.headers.accept) {
          proxyReq.setHeader('accept', req.headers.accept as string);
        }
        if (incomingToken) {
          proxyReq.setHeader('Authorization', `Bearer ${incomingToken}`);
        }
        for (const [key, value] of Object.entries(
          buildWorkspaceHeaders(identityResult.identity),
        )) {
          proxyReq.setHeader(key, value);
        }
        if (exportContext) {
          proxyReq.setHeader('x-jeg-context-jwt', exportContext.token);
        }
        if (launchProfile) {
          proxyReq.setHeader('x-jeg-launch-jwt', launchProfile.token);
          proxyReq.setHeader('x-jeg-launch-mode', launchProfile.profile.mode);
        }
        for (const [key, value] of Object.entries(buildSecurityHeaders())) {
          proxyReq.setHeader(key, value);
        }
        for (const [key, value] of Object.entries(buildIapHeaders())) {
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
