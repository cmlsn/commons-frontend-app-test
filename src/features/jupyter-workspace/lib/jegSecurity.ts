import type { NextApiRequest } from 'next';
import { getLoginStatus } from '@/lib/auth/getLoginStatus';
import { parse } from 'cookie';
import { jwtVerify, SignJWT } from 'jose';

type WorkspaceIdentity = {
  workspaceId: string;
  userId: string;
};
export type WorkspaceIdentityType = WorkspaceIdentity;

export type DataExfiltrationPolicy = 'strict' | 'balanced' | 'open';

const WORKSPACE_CLAIM_CANDIDATES = [
  'workspace_id',
  'workspaceId',
  'fence_id',
  'id',
  'name',
  'email',
  'sub',
];

const JEG_SERVER_URL_ENV = 'JEG_SERVER_URL';
const JEG_CONTEXT_COOKIE_NAME = 'jeg_context';
const JEG_LAUNCH_COOKIE_NAME = 'jeg_launch';

export function isJegPreviewModeEnabled(): boolean {
  const previewEnabled = process.env.JEG_UI_PREVIEW_MODE === 'true';
  if (process.env.NODE_ENV === 'production' && previewEnabled) {
    console.error('SECURITY ALERT: JEG_UI_PREVIEW_MODE is enabled in a production environment. This is not allowed.');
    throw new Error('Preview mode cannot run in production');
  }
  return previewEnabled;
}

export function isLocalJegDevelopmentModeEnabled(): boolean {
  // STRICT CHECK: Never allow this in production builds, regardless of the env var.
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  const localDevEnabled = process.env.JEG_LOCAL_DEV_MODE === 'true';
  if (localDevEnabled) {
    // Audit log for development usage
    console.warn('WARNING: JEG Local Development Mode is ACTIVE. Authentication is bypassed.');
  }
  return localDevEnabled;
}

type JupyterExportContextPayload = {
  cohortId?: string;
  cohortName?: string;
  dataLibraryIds?: string[];
  guids?: string[];
  exportSource?: 'cohort' | 'data-library' | 'mixed';
  metadata?: Record<string, unknown>;
};

export type JupyterExportContext = JupyterExportContextPayload & {
  workspaceId: string;
  userId: string;
};

export type JegLaunchMode = 'personal' | 'pre-release';

type JegLaunchProfilePayload = {
  mode: JegLaunchMode;
  selectedLibraryIds?: string[];
  requestedByUi?: boolean;
};

export type JegLaunchProfile = JegLaunchProfilePayload & {
  workspaceId: string;
  userId: string;
};

const EXFIL_POLICY_VALUES = new Set<DataExfiltrationPolicy>([
  'strict',
  'balanced',
  'open',
]);

function sanitizeWorkspaceSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function pickUserIdentifier(userContext: Record<string, any> | undefined): string {
  if (!userContext) return '';

  const configuredClaim = process.env.JEG_WORKSPACE_CLAIM;
  if (
    configuredClaim &&
    typeof userContext[configuredClaim] === 'string' &&
    userContext[configuredClaim].trim().length > 0
  ) {
    return userContext[configuredClaim];
  }

  for (const candidate of WORKSPACE_CLAIM_CANDIDATES) {
    if (
      typeof userContext[candidate] === 'string' &&
      userContext[candidate].trim().length > 0
    ) {
      return userContext[candidate];
    }
  }

  return '';
}

export async function resolveWorkspaceIdentityFromCookie(cookie: string) {
  if (isLocalJegDevelopmentModeEnabled()) {
    return {
      ok: true as const,
      identity: {
        workspaceId: 'local-dev-workspace',
        userId: 'local-dev-user',
      } satisfies WorkspaceIdentity,
      loginStatus: { status: 'issued', userContext: {} } as any,
    };
  }

  const loginStatus = await getLoginStatus(cookie);
  if (loginStatus.status !== 'issued') {
    return {
      ok: false as const,
      statusCode: 401,
      error: 'Active Fence login is required for Workspace JEG access.',
    };
  }

  const userIdentifierRaw = pickUserIdentifier(loginStatus.userContext);
  const userIdentifier = sanitizeWorkspaceSegment(userIdentifierRaw);
  if (!userIdentifier) {
    return {
      ok: false as const,
      statusCode: 403,
      error:
        'Unable to resolve a user workspace identity from Fence token claims.',
    };
  }

  const workspacePrefix = sanitizeWorkspaceSegment(
    process.env.JEG_WORKSPACE_PREFIX || 'workspace',
  );
  const workspaceId = workspacePrefix
    ? `${workspacePrefix}-${userIdentifier}`
    : userIdentifier;

  return {
    ok: true as const,
    identity: {
      workspaceId,
      userId: userIdentifier,
    } satisfies WorkspaceIdentity,
    loginStatus,
  };
}

export function getJegServerUrl(): string | null {
  const jegServerUrl = process.env[JEG_SERVER_URL_ENV]?.trim();
  return jegServerUrl && jegServerUrl.length > 0 ? jegServerUrl : null;
}

export function getProxyBaseUrl(req: NextApiRequest): string {
  const proto =
    ((req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ||
      'https')
      .trim()
      .toLowerCase();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
  // Return base URL without /proxy suffix - Datalayer appends /api/* automatically
  return `${proto}://${host}/api/workspace/jeg`;
}

export function buildWorkspaceHeaders(identity: WorkspaceIdentity) {
  return {
    'x-jeg-workspace-id': identity.workspaceId,
    'x-jeg-user-id': identity.userId,
    'x-zero-trust-subject': identity.userId,
  };
}

export function buildIapHeaders() {
  if (process.env.JEG_IAP_ENABLED !== 'true') return {};

  const assertionHeader =
    process.env.JEG_IAP_ASSERTION_HEADER || 'x-goog-iap-jwt-assertion';
  const assertion = process.env.JEG_IAP_ASSERTION?.trim();
  if (!assertion) {
    throw new Error(
      'JEG_IAP_ENABLED is true, but JEG_IAP_ASSERTION is not configured.',
    );
  }

  return {
    [assertionHeader]: assertion,
  };
}

function isSecureUrl(url: string, allowedSchemes: string[]) {
  try {
    const parsed = new URL(url);
    return allowedSchemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function getDataExfiltrationPolicy(): DataExfiltrationPolicy {
  const raw = (process.env.JEG_DATA_EXFIL_POLICY || 'strict')
    .trim()
    .toLowerCase() as DataExfiltrationPolicy;
  return EXFIL_POLICY_VALUES.has(raw) ? raw : 'strict';
}

export function getRequireEncryptedTransport(): boolean {
  return process.env.JEG_ENFORCE_ENCRYPTED_TRANSPORT !== 'false';
}

export function assertSecureJegConfiguration() {
  const jegServerUrl = getJegServerUrl();
  if (!jegServerUrl) {
    throw new Error(
      'JEG is not configured. Set JEG_SERVER_URL in the runtime environment.',
    );
  }

  if (getRequireEncryptedTransport() && !isLocalJegDevelopmentModeEnabled()) {
    if (!isSecureUrl(jegServerUrl, ['https:'])) {
      throw new Error(
        'JEG_SERVER_URL must use HTTPS when JEG_ENFORCE_ENCRYPTED_TRANSPORT is enabled.',
      );
    }

    if (
      process.env.JEG_WS_URL &&
      !isSecureUrl(process.env.JEG_WS_URL, ['wss:'])
    ) {
      throw new Error(
        'JEG_WS_URL must use WSS when JEG_ENFORCE_ENCRYPTED_TRANSPORT is enabled.',
      );
    }
  }

  return jegServerUrl;
}

export function evaluateExfiltrationPolicy(
  upstreamPath: string,
  method: string,
  policy: DataExfiltrationPolicy,
) {
  if (policy === 'open') {
    return { allowed: true as const };
  }

  const path = upstreamPath.toLowerCase();
  const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (path.startsWith('/api/terminals')) {
    return {
      allowed: false as const,
      reason: 'Terminal access is disabled by policy.',
    };
  }

  if (path.includes('/nbconvert') || path.includes('/export')) {
    return {
      allowed: false as const,
      reason: 'Notebook export endpoints are disabled by policy.',
    };
  }

  if (policy === 'strict') {
    if (path.startsWith('/files/')) {
      return {
        allowed: false as const,
        reason: 'Direct file download endpoints are disabled in strict policy.',
      };
    }

    if (path.startsWith('/api/contents') && isWriteMethod) {
      return {
        allowed: false as const,
        reason: 'Content write operations are disabled in strict policy.',
      };
    }
  }

  return { allowed: true as const };
}

export function buildSecurityHeaders() {
  if (process.env.JEG_REQUIRE_ZMQ_TLS !== 'true') return {};

  return {
    'x-jeg-require-zmq-tls': 'true',
  };
}

function getContextSigningKey(): Uint8Array | null {
  const signingKey = process.env.JEG_CONTEXT_SIGNING_KEY?.trim();
  if (!signingKey) return null;
  return new TextEncoder().encode(signingKey);
}

function getLaunchSigningKey(): Uint8Array | null {
  const explicitLaunchKey = process.env.JEG_LAUNCH_SIGNING_KEY?.trim();
  if (explicitLaunchKey) return new TextEncoder().encode(explicitLaunchKey);
  return getContextSigningKey();
}

export function getJegContextCookieName() {
  return JEG_CONTEXT_COOKIE_NAME;
}

export function getJegLaunchCookieName() {
  return JEG_LAUNCH_COOKIE_NAME;
}

export async function createJupyterExportContextToken(
  identity: WorkspaceIdentity,
  payload: JupyterExportContextPayload,
) {
  const key = getContextSigningKey();
  if (!key) {
    throw new Error(
      'JEG_CONTEXT_SIGNING_KEY is required to export cohort/data-library context to JEG.',
    );
  }

  const maxAgeSeconds = Number(process.env.JEG_CONTEXT_TOKEN_TTL_SECONDS || '600');
  const safeMaxAge = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
    ? Math.floor(maxAgeSeconds)
    : 600;

  const token = await new SignJWT({
    workspaceId: identity.workspaceId,
    userId: identity.userId,
    ...payload,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${safeMaxAge}s`)
    .setSubject(identity.userId)
    .sign(key);

  return {
    token,
    maxAgeSeconds: safeMaxAge,
  };
}

export async function parseJupyterExportContextFromCookie(
  cookieHeader: string,
  identity: WorkspaceIdentity,
) {
  const cookies = parse(cookieHeader || '');
  const token = cookies[JEG_CONTEXT_COOKIE_NAME];
  if (!token) return null;

  const key = getContextSigningKey();
  if (!key) return null;

  try {
    const verified = await jwtVerify(token, key);
    const payload = verified.payload as Record<string, any>;

    if (
      payload.userId !== identity.userId ||
      payload.workspaceId !== identity.workspaceId
    ) {
      return null;
    }

    return {
      token,
      context: {
        cohortId: typeof payload.cohortId === 'string' ? payload.cohortId : undefined,
        cohortName:
          typeof payload.cohortName === 'string' ? payload.cohortName : undefined,
        dataLibraryIds: Array.isArray(payload.dataLibraryIds)
          ? payload.dataLibraryIds.filter((item) => typeof item === 'string')
          : undefined,
        guids: Array.isArray(payload.guids)
          ? payload.guids.filter((item) => typeof item === 'string')
          : undefined,
        exportSource:
          payload.exportSource === 'cohort' ||
          payload.exportSource === 'data-library' ||
          payload.exportSource === 'mixed'
            ? payload.exportSource
            : undefined,
        metadata:
          payload.metadata && typeof payload.metadata === 'object'
            ? payload.metadata
            : undefined,
        workspaceId: payload.workspaceId,
        userId: payload.userId,
      } satisfies JupyterExportContext,
    };
  } catch {
    return null;
  }
}

export async function createJegLaunchProfileToken(
  identity: WorkspaceIdentity,
  payload: JegLaunchProfilePayload,
) {
  const key = getLaunchSigningKey();
  if (!key) {
    throw new Error(
      'JEG_LAUNCH_SIGNING_KEY or JEG_CONTEXT_SIGNING_KEY must be configured for launch profile control.',
    );
  }

  const maxAgeSeconds = Number(process.env.JEG_LAUNCH_TOKEN_TTL_SECONDS || '600');
  const safeMaxAge = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
    ? Math.floor(maxAgeSeconds)
    : 600;

  const token = await new SignJWT({
    workspaceId: identity.workspaceId,
    userId: identity.userId,
    ...payload,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${safeMaxAge}s`)
    .setSubject(identity.userId)
    .sign(key);

  return {
    token,
    maxAgeSeconds: safeMaxAge,
  };
}

export async function parseJegLaunchProfileFromCookie(
  cookieHeader: string,
  identity: WorkspaceIdentity,
) {
  const cookies = parse(cookieHeader || '');
  const token = cookies[JEG_LAUNCH_COOKIE_NAME];
  if (!token) return null;

  const key = getLaunchSigningKey();
  if (!key) return null;

  try {
    const verified = await jwtVerify(token, key);
    const payload = verified.payload as Record<string, any>;

    if (
      payload.userId !== identity.userId ||
      payload.workspaceId !== identity.workspaceId
    ) {
      return null;
    }

    const mode: JegLaunchMode =
      payload.mode === 'pre-release' ? 'pre-release' : 'personal';

    return {
      token,
      profile: {
        mode,
        selectedLibraryIds: Array.isArray(payload.selectedLibraryIds)
          ? payload.selectedLibraryIds.filter((item) => typeof item === 'string')
          : undefined,
        requestedByUi: Boolean(payload.requestedByUi),
        workspaceId: payload.workspaceId,
        userId: payload.userId,
      } satisfies JegLaunchProfile,
    };
  } catch {
    return null;
  }
}
