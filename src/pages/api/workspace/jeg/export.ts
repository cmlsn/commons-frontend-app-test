import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import {
  createJupyterExportContextToken,
  getJegContextCookieName,
  resolveWorkspaceIdentityFromCookie,
} from '@/lib/workspace/jegSecurity';

type ExportRequestBody = {
  cohortId?: string;
  cohortName?: string;
  dataLibraryIds?: string[];
  guids?: string[];
  exportSource?: 'cohort' | 'data-library' | 'mixed';
  metadata?: Record<string, unknown>;
};

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item) => typeof item === 'string');
  return list.length > 0 ? list : undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === 'DELETE') {
    res.setHeader(
      'Set-Cookie',
      serialize(getJegContextCookieName(), '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/workspace/jeg',
        maxAge: 0,
      }),
    );
    return res.status(200).json({ cleared: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE');
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

  const body = (req.body || {}) as ExportRequestBody;

  if (
    !body.cohortId &&
    !toStringArray(body.dataLibraryIds)?.length &&
    !toStringArray(body.guids)?.length &&
    !body.metadata
  ) {
    return res.status(400).json({
      error:
        'At least one export context selector is required (cohortId, dataLibraryIds, or guids).',
    });
  }

  try {
    const contextToken = await createJupyterExportContextToken(
      identityResult.identity,
      {
        cohortId: typeof body.cohortId === 'string' ? body.cohortId : undefined,
        cohortName:
          typeof body.cohortName === 'string' ? body.cohortName : undefined,
        dataLibraryIds: toStringArray(body.dataLibraryIds),
        guids: toStringArray(body.guids),
        exportSource:
          body.exportSource === 'cohort' ||
          body.exportSource === 'data-library' ||
          body.exportSource === 'mixed'
            ? body.exportSource
            : undefined,
        metadata:
          body.metadata && typeof body.metadata === 'object'
            ? body.metadata
            : undefined,
      },
    );

    res.setHeader(
      'Set-Cookie',
      serialize(getJegContextCookieName(), contextToken.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/workspace/jeg',
        maxAge: contextToken.maxAgeSeconds,
      }),
    );

    return res.status(200).json({
      launchUrl: '/Workspace/JEG?context=1',
      expiresInSeconds: contextToken.maxAgeSeconds,
      workspaceId: identityResult.identity.workspaceId,
    });
  } catch (error: any) {
    return res.status(503).json({
      error: error?.message || 'Unable to create Jupyter export context.',
    });
  }
}
