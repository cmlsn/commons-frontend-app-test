import type { NextApiRequest, NextApiResponse } from 'next';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  assertSecureJegConfiguration,
  buildSecurityHeaders,
  buildIapHeaders,
  buildWorkspaceHeaders,
  evaluateExfiltrationPolicy,
  getDataExfiltrationPolicy,
  parseJegLaunchProfileFromCookie,
  parseJupyterExportContextFromCookie,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jeg-workspace/lib/jegSecurity';

export const config = {
  api: {
    bodyParser: false,
  },
};

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

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
  const body = await readRequestBody(req);

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
      req.headers['content-type'] as string | undefined,
      body,
      launchProfile,
    );

    const upstreamHeaders = new Headers();
    if (req.headers['content-type']) {
      upstreamHeaders.set('content-type', req.headers['content-type'] as string);
    }
    if (req.headers.accept) {
      upstreamHeaders.set('accept', req.headers.accept as string);
    }
    if (incomingToken) {
      upstreamHeaders.set('Authorization', `Bearer ${incomingToken}`);
    }
    for (const [key, value] of Object.entries(
      buildWorkspaceHeaders(identityResult.identity),
    )) {
      upstreamHeaders.set(key, value);
    }
    if (exportContext) {
      upstreamHeaders.set('x-jeg-context-jwt', exportContext.token);
    }
    if (launchProfile) {
      upstreamHeaders.set('x-jeg-launch-jwt', launchProfile.token);
      upstreamHeaders.set('x-jeg-launch-mode', launchProfile.profile.mode);
    }
    for (const [key, value] of Object.entries(buildSecurityHeaders())) {
      upstreamHeaders.set(key, value);
    }
    for (const [key, value] of Object.entries(buildIapHeaders())) {
      upstreamHeaders.set(key, value);
    }

    const upstreamBody =
      bodyWithLaunch !== undefined ? new Uint8Array(bodyWithLaunch) : undefined;

    const upstream = await fetch(target.toString(), {
      method,
      headers: upstreamHeaders,
      body: upstreamBody,
      redirect: 'manual',
    });

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    const contentDisposition = upstream.headers.get('content-disposition');
    const cacheControl = upstream.headers.get('cache-control');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentDisposition) {
      res.setHeader('Content-Disposition', contentDisposition);
    }
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);

    const responseBuffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(responseBuffer);
  } catch (error: any) {
    return res.status(502).json({
      error: 'Failed to proxy request to JEG.',
      detail: error?.message || 'Unknown proxy error',
    });
  }
}
