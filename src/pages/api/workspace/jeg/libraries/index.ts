import type { NextApiRequest, NextApiResponse } from 'next';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import { fetchArboristResources } from '@/lib/auth/fetchAuthz';
import {
  isJegPreviewModeEnabled,
  resolveWorkspaceIdentityFromCookie,
} from '@/lib/workspace/jegSecurity';
import {
  fetchSharedLibrariesForUser,
  isLibraryServiceEnabled,
} from '@/lib/workspace/sharedLibraries';

function hasAuthzForLibraries(resources: string[]) {
  const requiredResource = process.env.JEG_LIBRARY_READ_AUTHZ_RESOURCE?.trim();
  if (!requiredResource) return true;
  return resources.includes(requiredResource);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
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
      enabled: true,
      previewMode: true,
      libraries: [
        {
          id: 'lib-preview-1',
          displayName: 'Preview Pre-Release Library',
          projectType: 'pre-release',
          s3Uri: 's3://preview-pre-release-bucket/path',
          ownerUserId: 'preview-owner',
          sharedWithUsers: ['preview-user'],
          description: 'UI preview library record',
        },
        {
          id: 'lib-preview-2',
          displayName: 'Preview Genomics Dataset',
          projectType: 'pre-release',
          s3Uri: 's3://preview-genomics-bucket/data',
          ownerUserId: 'preview-owner-2',
          sharedWithUsers: ['preview-user'],
          description: 'Second preview record',
        },
      ],
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

  if (!hasAuthzForLibraries(resources)) {
    return res.status(403).json({
      enabled: isLibraryServiceEnabled(),
      libraries: [],
      error: 'Not authorized to view shared pre-release libraries.',
    });
  }

  if (!isLibraryServiceEnabled()) {
    return res.status(200).json({ enabled: false, libraries: [] });
  }

  try {
    const libraries = await fetchSharedLibrariesForUser(
      identityResult.identity,
      accessToken,
    );
    return res.status(200).json({ enabled: true, libraries });
  } catch (error: any) {
    return res.status(502).json({
      enabled: true,
      error: error?.message || 'Unable to load shared libraries.',
      libraries: [],
    });
  }
}
