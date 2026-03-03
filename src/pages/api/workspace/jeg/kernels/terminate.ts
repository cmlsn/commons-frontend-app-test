import type { NextApiRequest, NextApiResponse } from 'next';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  getProxyBaseUrl,
  isJegPreviewModeEnabled,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jupyter-workspace/lib/jegSecurity';
import { publishUserLibraryItem } from '@/lib/workspace/sharedLibraries';

type TerminateBody = {
  kernelId?: string;
  sessionId?: string;
  publishBeforeKill?: boolean;
  publishTitle?: string;
  reason?: 'user-request' | 'stale-idle' | 'stale-age';
};

const VERIFY_RETRY_LIMIT = 3;
const VERIFY_RETRY_DELAY_MS = 2000;

function buildSnapshotUri(kernelId: string) {
  const prefix = process.env.JEG_SNAPSHOT_URI_PREFIX || 'jeg://workspace-snapshots';
  return `${prefix}/${encodeURIComponent(kernelId)}/${Date.now()}`;
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as TerminateBody;
  if (!body.kernelId) {
    return res.status(400).json({ error: 'kernelId is required.' });
  }

  let previewMode = false;
  try {
    previewMode = isJegPreviewModeEnabled();
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Preview mode misconfiguration.',
    });
  }

  if (previewMode) {
    return res.status(200).json({
      removed: true,
      publishedItemId: body.publishBeforeKill ? `preview-publish-${Date.now()}` : null,
      previewMode: true,
    });
  }

  const login = await resolveWorkspaceIdentityFromCookie(req.headers.cookie || '');
  if (!login.ok) {
    return res.status(login.statusCode).json({ error: login.error });
  }

  const shouldAutosave =
    body.publishBeforeKill ||
    ((body.reason === 'stale-idle' || body.reason === 'stale-age') &&
      process.env.JEG_AUTOSAVE_ON_STALE_KILL !== 'false');

  let publishedItemId: string | null = null;
  if (shouldAutosave) {
    try {
      const accessToken = getAccessToken(req.headers.cookie || '') ?? null;
      const published = await publishUserLibraryItem(login.identity, accessToken, {
        title:
          body.publishTitle ||
          `Kernel Snapshot ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
        objectUri: buildSnapshotUri(body.kernelId),
        sourceType:
          body.reason === 'user-request'
            ? 'autosave-user-kill'
            : 'autosave-stale-kill',
        kernelId: body.kernelId,
        sessionId: body.sessionId,
        metadata: {
          reason: body.reason || 'user-request',
        },
      });
      publishedItemId = published?.id || null;
    } catch {
      // publish failures should not block explicit kernel termination
    }
  }

  const proxyBaseUrl = getProxyBaseUrl(req);
  const kernelPath = `${proxyBaseUrl}/api/kernels/${encodeURIComponent(body.kernelId)}`;
  try {
    if (body.sessionId) {
      await fetch(`${proxyBaseUrl}/api/sessions/${encodeURIComponent(body.sessionId)}`, {
        method: 'DELETE',
        headers: { cookie: req.headers.cookie || '' },
      });
    }

    for (let attempt = 1; attempt <= VERIFY_RETRY_LIMIT; attempt += 1) {
      const terminateResponse = await fetch(kernelPath, {
        method: 'DELETE',
        headers: { cookie: req.headers.cookie || '' },
      });

      if (!terminateResponse.ok && terminateResponse.status !== 404) {
        return res.status(502).json({
          removed: false,
          publishedItemId,
          error: `Kernel termination request failed (${terminateResponse.status}).`,
        });
      }

      const verifyResponse = await fetch(kernelPath, {
        method: 'GET',
        headers: { cookie: req.headers.cookie || '' },
      });

      if (verifyResponse.status === 404) {
        return res.status(200).json({
          removed: true,
          publishedItemId,
        });
      }

      if (!verifyResponse.ok) {
        return res.status(502).json({
          removed: false,
          publishedItemId,
          error: `Kernel termination verification failed (${verifyResponse.status}).`,
        });
      }

      if (attempt < VERIFY_RETRY_LIMIT) {
        await sleep(VERIFY_RETRY_DELAY_MS);
      }
    }

    return res.status(200).json({
      removed: false,
      publishedItemId,
      error:
        'Kernel remains active after 3 termination attempts (zombie kernel).',
    });
  } catch (error: any) {
    return res.status(502).json({
      removed: false,
      publishedItemId,
      error: error?.message || 'Unable to terminate kernel.',
    });
  }
}
