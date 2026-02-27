import type { NextApiRequest, NextApiResponse } from 'next';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  assertSecureJegConfiguration,
  getDataExfiltrationPolicy,
  isJegPreviewModeEnabled,
  parseJupyterExportContextFromCookie,
  parseJegLaunchProfileFromCookie,
  parseJegRuntimeRouteFromCookie,
  getProxyBaseUrl,
  getRequireEncryptedTransport,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jeg-workspace/lib/jegSecurity';
import {
  fetchSharedLibrariesForUser,
  isLibraryServiceEnabled,
} from '@/features/jeg-workspace/lib/sharedLibraries';

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
      baseUrl: '/api/workspace/jeg/proxy',
      wsUrl: '/api/workspace/jeg/proxy',
      token: 'preview-token',
      workspaceId: 'workspace-preview-user',
      defaultPath: '/lab',
      exfiltrationPolicy: getDataExfiltrationPolicy(),
      requireEncryptedTransport: true,
      requireZmqTls: process.env.JEG_REQUIRE_ZMQ_TLS === 'true',
      hasExportContext: false,
      exportSource: undefined,
      exportCohortId: undefined,
      launchMode: 'pre-release',
      selectedLibraryIds: ['lib-preview-1'],
      sharedLibraryEnabled: true,
      activeMounts: [
        {
          id: 'lib-preview-1',
          displayName: 'Preview Pre-Release Library',
          s3Uri: 's3://preview-pre-release-bucket/path',
        },
      ],
      previewMode: true,
    });
  }

  try {
    assertSecureJegConfiguration();
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

  const proxyBaseUrl = getProxyBaseUrl(req);
  const normalizedProxyBaseUrl = proxyBaseUrl.replace(/\/$/, '');
  const normalizedBasePath = (process.env.BASE_PATH || '').replace(/\/$/, '');
  const relativeProxyBaseUrl = `${normalizedBasePath}/api/workspace/jeg/proxy`;
  const relativeProxyWsUrl = `${normalizedBasePath}/api/workspace/jeg/proxy`;
  const token = process.env.JEG_CLIENT_TOKEN || undefined;
  const exportContext = await parseJupyterExportContextFromCookie(
    req.headers.cookie || '',
    identityResult.identity,
  );
  const launchProfile = await parseJegLaunchProfileFromCookie(
    req.headers.cookie || '',
    identityResult.identity,
  );
  const runtimeRoute = await parseJegRuntimeRouteFromCookie(
    req.headers.cookie || '',
    identityResult.identity,
  );

  let activeMounts: Array<{ id: string; displayName: string; s3Uri: string }> = [];
  if (
    isLibraryServiceEnabled() &&
    launchProfile?.profile.mode === 'pre-release' &&
    Array.isArray(launchProfile.profile.selectedLibraryIds) &&
    launchProfile.profile.selectedLibraryIds.length > 0
  ) {
    try {
      const accessToken = getAccessToken(req.headers.cookie || '') ?? null;
      const libraries = await fetchSharedLibrariesForUser(
        identityResult.identity,
        accessToken,
      );
      const selectedSet = new Set(launchProfile.profile.selectedLibraryIds);
      activeMounts = libraries
        .filter((item) => selectedSet.has(item.id))
        .map((item) => ({
          id: item.id,
          displayName: item.displayName,
          s3Uri: item.s3Uri,
        }));
    } catch {
      activeMounts = [];
    }
  }

  return res.status(200).json({
    baseUrl: relativeProxyBaseUrl,
    wsUrl: relativeProxyWsUrl,
    token: runtimeRoute?.route.token || token,
    workspaceId: identityResult.identity.workspaceId,
    defaultPath: process.env.JEG_DEFAULT_NOTEBOOK_PATH || '/lab',
    exfiltrationPolicy: getDataExfiltrationPolicy(),
    requireEncryptedTransport: getRequireEncryptedTransport(),
    requireZmqTls: process.env.JEG_REQUIRE_ZMQ_TLS === 'true',
    hasExportContext: Boolean(exportContext),
    exportSource: exportContext?.context.exportSource,
    exportCohortId: exportContext?.context.cohortId,
    launchMode: launchProfile?.profile.mode || 'personal',
    selectedLibraryIds: launchProfile?.profile.selectedLibraryIds || [],
    sharedLibraryEnabled: isLibraryServiceEnabled(),
    activeMounts,
  });
}
