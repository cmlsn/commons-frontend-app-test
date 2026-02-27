import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import {
  createJegComputeTierToken,
  getJegComputeCookieName,
  parseJegRuntimeRouteFromCookie,
  resolveWorkspaceIdentityFromCookie,
  type ComputeTier,
} from '@/features/jeg-workspace/lib/jegSecurity';

type SetComputeTierBody = {
  tier?: unknown;
};

const ALLOWED_TIERS: readonly ComputeTier[] = [
  'standard-2cpu',
  'large-8cpu',
  'gpu-1x',
] as const;

function isComputeTier(value: unknown): value is ComputeTier {
  return (
    typeof value === 'string' &&
    (ALLOWED_TIERS as readonly string[]).includes(value)
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const identityResult = await resolveWorkspaceIdentityFromCookie(
    req.headers.cookie || '',
  );

  if (!identityResult.ok) {
    return res
      .status(identityResult.statusCode)
      .json({ error: identityResult.error });
  }

  const runtimeSession = await parseJegRuntimeRouteFromCookie(
    req.headers.cookie || '',
    identityResult.identity,
  );

  if (!runtimeSession?.route) {
    return res.status(409).json({
      error: 'Active workspace session is required.',
    });
  }

  const body = (req.body || {}) as SetComputeTierBody;
  if (!isComputeTier(body.tier)) {
    return res.status(400).json({
      error: 'Invalid compute tier.',
      allowedTiers: ALLOWED_TIERS,
    });
  }

  try {
    const computeToken = await createJegComputeTierToken(
      identityResult.identity,
      { computeTier: body.tier },
    );

    res.setHeader(
      'Set-Cookie',
      serialize(getJegComputeCookieName(), computeToken.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/workspace/jeg',
        maxAge: computeToken.maxAgeSeconds,
      }),
    );

    return res.status(200).end();
  } catch (error: any) {
    return res.status(503).json({
      error: error?.message || 'Unable to update compute tier.',
    });
  }
}
