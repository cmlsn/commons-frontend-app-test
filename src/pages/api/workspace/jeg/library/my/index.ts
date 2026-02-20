import type { NextApiRequest, NextApiResponse } from 'next';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  isJegPreviewModeEnabled,
  resolveWorkspaceIdentityFromCookie,
} from '@/lib/workspace/jegSecurity';
import {
  fetchUserLibraryItems,
  publishUserLibraryItem,
} from '@/lib/workspace/sharedLibraries';

type PublishBody = {
  title?: string;
  objectUri?: string;
  sourceType?: 'manual-publish' | 'autosave-stale-kill' | 'autosave-user-kill';
  kernelId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
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
        previewMode: true,
        items: [
          {
            id: 'my-preview-1',
            title: 'My Published Snapshot',
            ownerUserId: 'preview-user',
            objectUri: 'jeg://manual-publish/preview-1',
            sourceType: 'manual-publish',
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
          },
        ],
      });
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as PublishBody;
      return res.status(200).json({
        previewMode: true,
        item: {
          id: `my-preview-${Date.now()}`,
          title: body.title || 'Preview Publish',
          ownerUserId: 'preview-user',
          objectUri: body.objectUri || 'jeg://preview/object',
          sourceType: body.sourceType || 'manual-publish',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
      });
    }

    res.setHeader('Allow', 'GET, POST');
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

  const accessToken = getAccessToken(req.headers.cookie || '') ?? null;

  if (req.method === 'GET') {
    try {
      const items = await fetchUserLibraryItems(
        identityResult.identity,
        accessToken,
      );
      return res.status(200).json({ items });
    } catch (error: any) {
      return res.status(502).json({
        error: error?.message || 'Unable to load personal library.',
        items: [],
      });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as PublishBody;
  if (!body.title || !body.objectUri) {
    return res.status(400).json({
      error: 'title and objectUri are required.',
    });
  }

  try {
    const item = await publishUserLibraryItem(identityResult.identity, accessToken, {
      title: body.title,
      objectUri: body.objectUri,
      sourceType: body.sourceType || 'manual-publish',
      kernelId: body.kernelId,
      sessionId: body.sessionId,
      metadata: body.metadata,
    });
    return res.status(200).json({ item });
  } catch (error: any) {
    return res.status(502).json({
      error: error?.message || 'Unable to publish to personal library.',
    });
  }
}
