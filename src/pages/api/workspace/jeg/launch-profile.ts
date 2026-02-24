import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  createJegLaunchProfileToken,
  getJegLaunchCookieName,
  isJegPreviewModeEnabled,
  parseJegLaunchProfileFromCookie,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jeg-workspace/lib/jegSecurity';
import { fetchSharedLibrariesForUser } from '@/features/jeg-workspace/lib/sharedLibraries';

type LaunchProfileBody = {
  mode?: 'personal' | 'pre-release';
  selectedLibraryIds?: string[];
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  let previewMode = false;
  try {
    previewMode = isJegPreviewModeEnabled();
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Preview mode misconfiguration.',
    });
  }

  if (previewMode) {
    if (req.method === 'GET') {
      return res.status(200).json({
        launchProfile: {
          mode: 'pre-release',
          selectedLibraryIds: ['lib-preview-1'],
        },
        previewMode: true,
      });
    }

    if (req.method === 'DELETE') {
      return res.status(200).json({ cleared: true, previewMode: true });
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as LaunchProfileBody;
      const mode = body.mode === 'pre-release' ? 'pre-release' : 'personal';
      return res.status(200).json({
        launchProfile: {
          mode,
          selectedLibraryIds:
            mode === 'pre-release' ? body.selectedLibraryIds || ['lib-preview-1'] : [],
        },
        expiresInSeconds: 600,
        previewMode: true,
      });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
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

  if (req.method === 'GET') {
    const launchProfile = await parseJegLaunchProfileFromCookie(
      req.headers.cookie || '',
      identityResult.identity,
    );
    return res.status(200).json({
      launchProfile: launchProfile?.profile || {
        mode: 'personal',
        selectedLibraryIds: [],
      },
    });
  }

  if (req.method === 'DELETE') {
    res.setHeader(
      'Set-Cookie',
      serialize(getJegLaunchCookieName(), '', {
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
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as LaunchProfileBody;
  const mode = body.mode === 'pre-release' ? 'pre-release' : 'personal';

  let selectedLibraryIds: string[] = [];
  if (mode === 'pre-release') {
    const requestedIds = Array.isArray(body.selectedLibraryIds)
      ? body.selectedLibraryIds.filter((item) => typeof item === 'string')
      : [];

    if (requestedIds.length === 0) {
      return res.status(400).json({
        error:
          'At least one shared library is required when launch mode is pre-release.',
      });
    }

    const accessToken = getAccessToken(req.headers.cookie || '') ?? null;
    try {
      const allowedLibraries = await fetchSharedLibrariesForUser(
        identityResult.identity,
        accessToken,
      );
      const allowedSet = new Set(allowedLibraries.map((item) => item.id));
      const unauthorized = requestedIds.filter((item) => !allowedSet.has(item));
      if (unauthorized.length > 0) {
        return res.status(403).json({
          error:
            'One or more selected libraries are not authorized for this user.',
          unauthorizedLibraryIds: unauthorized,
        });
      }
      selectedLibraryIds = requestedIds;
    } catch (error: any) {
      return res.status(502).json({
        error: error?.message || 'Unable to validate selected libraries.',
      });
    }
  }

  try {
    const launchToken = await createJegLaunchProfileToken(identityResult.identity, {
      mode,
      selectedLibraryIds,
      requestedByUi: true,
    });

    res.setHeader(
      'Set-Cookie',
      serialize(getJegLaunchCookieName(), launchToken.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/workspace/jeg',
        maxAge: launchToken.maxAgeSeconds,
      }),
    );

    return res.status(200).json({
      launchProfile: {
        mode,
        selectedLibraryIds,
      },
      expiresInSeconds: launchToken.maxAgeSeconds,
    });
  } catch (error: any) {
    return res.status(503).json({
      error: error?.message || 'Unable to create launch profile token.',
    });
  }
}
