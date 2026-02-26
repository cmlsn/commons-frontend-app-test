import type { NextApiRequest, NextApiResponse } from 'next';
import { GEN3_FENCE_API, GEN3_FENCE_SERVICE } from '@gen3/core/server';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import { fetchArboristResources } from '@/lib/auth/fetchAuthz';
import {
  isJegPreviewModeEnabled,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jeg-workspace/lib/jegSecurity';
import { shareLibraryWithUsers } from '@/features/jeg-workspace/lib/sharedLibraries';

type ShareBody = {
  libraryId?: string;
  sharedWithUsers?: string[];
};

function hasShareAuthz(resources: string[]) {
  const requiredResource = process.env.JEG_LIBRARY_SHARE_AUTHZ_RESOURCE?.trim();
  if (!requiredResource) return true;
  return resources.includes(requiredResource);
}

function sanitizeSharedWithUsers(sharedWithUsers: unknown): string[] {
  if (!Array.isArray(sharedWithUsers)) return [];
  return Array.from(
    new Set(
      sharedWithUsers
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

async function validateFenceIdentityUsername(
  username: string,
  accessToken: string | null,
): Promise<boolean> {
  const base = process.env.NODE_ENV === 'production'
    ? GEN3_FENCE_SERVICE
    : GEN3_FENCE_API;
  const rawPaths =
    process.env.JEG_FENCE_USER_LOOKUP_PATHS || '/user/{username},/users/{username}';
  const paths = rawPaths
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  for (const pathTemplate of paths) {
    const endpoint = `${base}${pathTemplate.replace('{username}', encodeURIComponent(username))}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    if (response.ok) {
      return true;
    }

    if (response.status !== 404) {
      throw new Error(
        `Unable to validate Fence identity '${username}' (${response.status}).`,
      );
    }
  }

  return false;
}

async function findInvalidFenceUsernames(
  usernames: string[],
  accessToken: string | null,
): Promise<string[]> {
  const checks = await Promise.allSettled(
    usernames.map(async (username) => {
      const valid = await validateFenceIdentityUsername(username, accessToken);
      return { username, valid };
    }),
  );

  const invalidUsernames: string[] = [];
  for (const check of checks) {
    if (check.status === 'rejected') {
      throw check.reason;
    }
    if (!check.value.valid) {
      invalidUsernames.push(check.value.username);
    }
  }

  return invalidUsernames;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body || {}) as ShareBody;
  const sanitizedSharedWithUsers = sanitizeSharedWithUsers(body.sharedWithUsers);

  let previewMode = false;
  try {
    previewMode = isJegPreviewModeEnabled();
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || 'Preview mode misconfiguration.',
    });
  }

  if (previewMode) {
    if (!body.libraryId || !Array.isArray(body.sharedWithUsers)) {
      return res.status(400).json({
        error: 'libraryId and sharedWithUsers are required.',
      });
    }
    return res.status(200).json({
      library: {
        id: body.libraryId,
        displayName: 'Preview Shared Library',
        projectType: 'pre-release',
        s3Uri: 's3://preview-pre-release-bucket/path',
        ownerUserId: 'preview-user',
        sharedWithUsers: sanitizedSharedWithUsers,
      },
      previewMode: true,
    });
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
  const resources = await fetchArboristResources(
    accessToken,
    process.env.NODE_ENV === 'production',
  );

  if (!hasShareAuthz(resources)) {
    return res.status(403).json({
      error: 'Not authorized to share pre-release libraries.',
    });
  }

  if (!body.libraryId || !Array.isArray(body.sharedWithUsers)) {
    return res.status(400).json({
      error: 'libraryId and sharedWithUsers are required.',
    });
  }

  // SECURITY: Verify ownership before allowing share operation
  let userLibraries;
  try {
    const { fetchSharedLibrariesForUser } = await import(
      '@/features/jeg-workspace/lib/sharedLibraries'
    );
    userLibraries = await fetchSharedLibrariesForUser(
      identityResult.identity,
      accessToken,
    );
  } catch (error: any) {
    return res.status(502).json({
      error: error?.message || 'Unable to verify library ownership.',
    });
  }

  const libraryToShare = userLibraries.find((lib) => lib.id === body.libraryId);

  if (!libraryToShare) {
    return res.status(404).json({
      error: 'Library not found or you do not have access to it.',
    });
  }

  if (libraryToShare.ownerUserId !== identityResult.identity.userId) {
    return res.status(403).json({
      error: 'Only the library owner can modify sharing permissions.',
      libraryId: body.libraryId,
    });
  }

  if (sanitizedSharedWithUsers.length > 0) {
    try {
      const invalidUsernames = await findInvalidFenceUsernames(
        sanitizedSharedWithUsers,
        accessToken,
      );
      if (invalidUsernames.length > 0) {
        return res.status(400).json({
          error:
            'One or more sharedWithUsers entries are not valid Fence identities.',
          invalidUsernames,
        });
      }
    } catch (error: any) {
      return res.status(502).json({
        error: error?.message || 'Unable to validate Fence identities.',
      });
    }
  }

  try {
    const library = await shareLibraryWithUsers(
      body.libraryId,
      sanitizedSharedWithUsers,
      identityResult.identity,
      accessToken,
    );
    return res.status(200).json({ library });
  } catch (error: any) {
    return res.status(502).json({
      error: error?.message || 'Unable to share library.',
    });
  }
}
