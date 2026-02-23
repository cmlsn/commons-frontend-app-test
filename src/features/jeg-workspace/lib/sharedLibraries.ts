import {
  buildIapHeaders,
  buildWorkspaceHeaders,
  type WorkspaceIdentityType,
} from './jegSecurity';

export type SharedLibraryRecord = {
  id: string;
  displayName: string;
  projectType: 'personal' | 'pre-release';
  s3Uri: string;
  ownerUserId: string;
  sharedWithUsers: string[];
  description?: string;
};

export type UserLibraryItem = {
  id: string;
  title: string;
  ownerUserId: string;
  objectUri: string;
  sourceType: 'manual-publish' | 'autosave-stale-kill' | 'autosave-user-kill';
  kernelId?: string;
  sessionId?: string;
  createdAt: string;
  lastUsedAt?: string;
};

const LIBRARY_SERVICE_ENV = 'JEG_LIBRARY_SERVICE_URL';

function getLibraryServiceUrl() {
  const value = process.env[LIBRARY_SERVICE_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

export function isLibraryServiceEnabled() {
  return Boolean(getLibraryServiceUrl());
}

export async function fetchSharedLibrariesForUser(
  identity: WorkspaceIdentityType,
  accessToken: string | null,
) {
  const serviceUrl = getLibraryServiceUrl();
  if (!serviceUrl) {
    return [] as SharedLibraryRecord[];
  }

  const endpoint = new URL('/libraries', serviceUrl);
  endpoint.searchParams.set('userId', identity.userId);
  endpoint.searchParams.set('workspaceId', identity.workspaceId);

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...buildWorkspaceHeaders(identity),
      ...buildIapHeaders(),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Failed to fetch shared libraries: ${response.status} ${detail || ''}`.trim(),
    );
  }

  const body = (await response.json()) as { libraries?: SharedLibraryRecord[] };
  return Array.isArray(body.libraries) ? body.libraries : [];
}

export async function shareLibraryWithUsers(
  libraryId: string,
  sharedWithUsers: string[],
  identity: WorkspaceIdentityType,
  accessToken: string | null,
) {
  const serviceUrl = getLibraryServiceUrl();
  if (!serviceUrl) {
    throw new Error('JEG_LIBRARY_SERVICE_URL is not configured.');
  }

  const endpoint = new URL(`/libraries/${encodeURIComponent(libraryId)}/share`, serviceUrl);
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...buildWorkspaceHeaders(identity),
      ...buildIapHeaders(),
    },
    body: JSON.stringify({
      sharedWithUsers,
      updatedBy: identity.userId,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Failed to share library: ${response.status} ${detail || ''}`.trim(),
    );
  }

  const body = (await response.json()) as { library?: SharedLibraryRecord };
  return body.library || null;
}

export async function fetchUserLibraryItems(
  identity: WorkspaceIdentityType,
  accessToken: string | null,
) {
  const serviceUrl = getLibraryServiceUrl();
  if (!serviceUrl) {
    return [] as UserLibraryItem[];
  }

  const endpoint = new URL('/my-library', serviceUrl);
  endpoint.searchParams.set('ownerUserId', identity.userId);
  endpoint.searchParams.set('workspaceId', identity.workspaceId);

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...buildWorkspaceHeaders(identity),
      ...buildIapHeaders(),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Failed to fetch my library items: ${response.status} ${detail || ''}`.trim(),
    );
  }

  const body = (await response.json()) as { items?: UserLibraryItem[] };
  return Array.isArray(body.items) ? body.items : [];
}

type PublishLibraryPayload = {
  title: string;
  objectUri: string;
  sourceType: UserLibraryItem['sourceType'];
  kernelId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export async function publishUserLibraryItem(
  identity: WorkspaceIdentityType,
  accessToken: string | null,
  payload: PublishLibraryPayload,
) {
  const serviceUrl = getLibraryServiceUrl();
  if (!serviceUrl) {
    throw new Error('JEG_LIBRARY_SERVICE_URL is not configured.');
  }

  const endpoint = new URL('/my-library', serviceUrl);
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...buildWorkspaceHeaders(identity),
      ...buildIapHeaders(),
    },
    body: JSON.stringify({
      ownerUserId: identity.userId,
      workspaceId: identity.workspaceId,
      ...payload,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Failed to publish my library item: ${response.status} ${detail || ''}`.trim(),
    );
  }

  const body = (await response.json()) as { item?: UserLibraryItem };
  return body.item || null;
}
