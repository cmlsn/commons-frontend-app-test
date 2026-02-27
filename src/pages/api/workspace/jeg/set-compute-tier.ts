import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import {
  createJegComputeTierToken,
  getJegComputeCookieName,
  resolveWorkspaceIdentityFromCookie,
  type ComputeTier,
} from '@/features/jeg-workspace/lib/jegSecurity';
import {
  COMPUTE_TIER_KEYS,
  COMPUTE_TIER_SPECS,
} from '@/features/jeg-workspace/lib/computeTierSpecs';

type SetComputeTierBody = {
  tier?: unknown;
};

function isComputeTier(value: unknown): value is ComputeTier {
  if (typeof value !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(COMPUTE_TIER_SPECS, value);
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

  const body = (req.body || {}) as SetComputeTierBody;
  if (!isComputeTier(body.tier)) {
    return res.status(400).json({
      error: 'Invalid compute tier.',
      allowedTiers: COMPUTE_TIER_KEYS,
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
