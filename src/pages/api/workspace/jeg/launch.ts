import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import { execSync } from 'child_process';
import { getAccessToken } from '@/lib/auth/getLoginStatus';
import {
  buildSecurityHeaders,
  buildWorkspaceHeaders,
  createJegRuntimeRouteToken,
  getDataExfiltrationPolicy,
  getJegRuntimeCookieName,
  isLocalJegDevelopmentModeEnabled,
  isJegPreviewModeEnabled,
  parseJegLaunchProfileFromCookie,
  parseJegRuntimeRouteFromCookie,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jeg-workspace/lib/jegSecurity';

type LauncherResponse = {
  baseUrl?: string;
  wsUrl?: string;
  token?: string;
  connection?: {
    baseUrl?: string;
    wsUrl?: string;
    token?: string;
  };
};

function readEnv(primary: string, fallback?: string) {
  const primaryValue = process.env[primary]?.trim();
  if (primaryValue) return primaryValue;
  if (!fallback) return undefined;
  const fallbackValue = process.env[fallback]?.trim();
  return fallbackValue || undefined;
}

function isLocalRuntimeDevelopmentEnabled() {
  return (
    process.env.JUPYTERLAB_LOCAL_DEV_MODE === 'true' ||
    isLocalJegDevelopmentModeEnabled()
  );
}

function normalizeRuntimeRoute(payload: LauncherResponse) {
  const baseUrl = payload.baseUrl || payload.connection?.baseUrl;
  const wsUrl = payload.wsUrl || payload.connection?.wsUrl;
  const token = payload.token || payload.connection?.token;

  if (!baseUrl || !wsUrl) {
    throw new Error('Launcher response missing baseUrl/wsUrl.');
  }

  return {
    baseUrl,
    wsUrl,
    token,
  };
}

function getLauncherUrl() {
  const url = readEnv('JUPYTERLAB_LAUNCHER_URL', 'JEG_LAUNCHER_URL');
  if (!url) {
    throw new Error(
      'JUPYTERLAB_LAUNCHER_URL (or JEG_LAUNCHER_URL) is required to launch isolated JupyterLab runtime instances.',
    );
  }
  return url;
}

function deriveWsUrl(baseUrl: string) {
  return baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
}

function maybeEnsureLocalDockerRuntime() {
  if (!isLocalRuntimeDevelopmentEnabled()) return;
  if (readEnv('JUPYTERLAB_LOCAL_DOCKER_AUTOSTART', 'JEG_LOCAL_DOCKER_AUTOSTART') !== 'true') return;

  const containerName =
    readEnv('JUPYTERLAB_LOCAL_DOCKER_CONTAINER_NAME', 'JEG_LOCAL_DOCKER_CONTAINER_NAME') ||
    'gen3-jupyterlab-local';
  const image =
    readEnv('JUPYTERLAB_LOCAL_DOCKER_IMAGE', 'JEG_LOCAL_DOCKER_IMAGE') ||
    'quay.io/jupyter/scipy-notebook:latest';
  const hostPort = readEnv('JUPYTERLAB_LOCAL_DOCKER_PORT', 'JEG_LOCAL_DOCKER_PORT') || '18888';
  const localToken =
    readEnv('JUPYTERLAB_LOCAL_RUNTIME_TOKEN', 'JEG_LOCAL_RUNTIME_TOKEN') || 'local-dev-token';

  try {
    const running = execSync(
      `docker ps --filter "name=^/${containerName}$" --format "{{.Names}}"`,
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim();
    if (running === containerName) {
      if (!process.env.JUPYTERLAB_LOCAL_RUNTIME_BASE_URL && !process.env.JEG_LOCAL_RUNTIME_BASE_URL) {
        process.env.JUPYTERLAB_LOCAL_RUNTIME_BASE_URL = `http://127.0.0.1:${hostPort}`;
      }
      if (!process.env.JUPYTERLAB_LOCAL_RUNTIME_WS_URL && !process.env.JEG_LOCAL_RUNTIME_WS_URL) {
        process.env.JUPYTERLAB_LOCAL_RUNTIME_WS_URL = deriveWsUrl(
          readEnv('JUPYTERLAB_LOCAL_RUNTIME_BASE_URL', 'JEG_LOCAL_RUNTIME_BASE_URL')!,
        );
      }
      if (!process.env.JUPYTERLAB_LOCAL_RUNTIME_TOKEN && !process.env.JEG_LOCAL_RUNTIME_TOKEN) {
        process.env.JUPYTERLAB_LOCAL_RUNTIME_TOKEN = localToken;
      }
      return;
    }
  } catch {
    // continue and try to launch
  }

  execSync(
    [
      'docker run -d',
      `--name ${containerName}`,
      `-p ${hostPort}:8888`,
      `-e JUPYTER_TOKEN=${localToken}`,
      image,
      'start-notebook.py',
      '--ServerApp.token=${JUPYTER_TOKEN}',
      '--ServerApp.allow_origin=*',
      '--ServerApp.disable_check_xsrf=True',
    ].join(' '),
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  if (!process.env.JUPYTERLAB_LOCAL_RUNTIME_BASE_URL && !process.env.JEG_LOCAL_RUNTIME_BASE_URL) {
    process.env.JUPYTERLAB_LOCAL_RUNTIME_BASE_URL = `http://127.0.0.1:${hostPort}`;
  }
  if (!process.env.JUPYTERLAB_LOCAL_RUNTIME_WS_URL && !process.env.JEG_LOCAL_RUNTIME_WS_URL) {
    process.env.JUPYTERLAB_LOCAL_RUNTIME_WS_URL = deriveWsUrl(
      readEnv('JUPYTERLAB_LOCAL_RUNTIME_BASE_URL', 'JEG_LOCAL_RUNTIME_BASE_URL')!,
    );
  }
  if (!process.env.JUPYTERLAB_LOCAL_RUNTIME_TOKEN && !process.env.JEG_LOCAL_RUNTIME_TOKEN) {
    process.env.JUPYTERLAB_LOCAL_RUNTIME_TOKEN = localToken;
  }
}

function resolveLocalRuntimeRoute() {
  const baseUrl = readEnv('JUPYTERLAB_LOCAL_RUNTIME_BASE_URL', 'JEG_LOCAL_RUNTIME_BASE_URL');
  if (!baseUrl) return null;
  const wsUrl =
    readEnv('JUPYTERLAB_LOCAL_RUNTIME_WS_URL', 'JEG_LOCAL_RUNTIME_WS_URL') || deriveWsUrl(baseUrl);
  const token = readEnv('JUPYTERLAB_LOCAL_RUNTIME_TOKEN', 'JEG_LOCAL_RUNTIME_TOKEN') || undefined;
  return {
    baseUrl,
    wsUrl,
    token,
  };
}

function clearRuntimeCookie(res: NextApiResponse) {
  res.setHeader(
    'Set-Cookie',
    serialize(getJegRuntimeCookieName(), '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/workspace/jeg',
      maxAge: 0,
    }),
  );
}

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

  const identityResult = await resolveWorkspaceIdentityFromCookie(
    req.headers.cookie || '',
  );

  if (!identityResult.ok) {
    return res
      .status(identityResult.statusCode)
      .json({ error: identityResult.error });
  }

  if (req.method === 'DELETE') {
    clearRuntimeCookie(res);
    return res.status(200).json({ cleared: true });
  }

  if (req.method === 'GET') {
    const runtimeRoute = await parseJegRuntimeRouteFromCookie(
      req.headers.cookie || '',
      identityResult.identity,
    );

    return res.status(200).json({
      ready: Boolean(runtimeRoute?.route),
      runtimeRoute: runtimeRoute?.route || null,
      previewMode,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const launchProfile = await parseJegLaunchProfileFromCookie(
    req.headers.cookie || '',
    identityResult.identity,
  );

  if (isLocalRuntimeDevelopmentEnabled()) {
    try {
      maybeEnsureLocalDockerRuntime();
      const localRuntime = resolveLocalRuntimeRoute();
      if (localRuntime) {
        const runtimeToken = await createJegRuntimeRouteToken(
          identityResult.identity,
          {
            baseUrl: localRuntime.baseUrl,
            wsUrl: localRuntime.wsUrl,
            token: localRuntime.token,
            disableExport: true,
            dataExfiltrationPolicy: getDataExfiltrationPolicy(),
          },
        );

        res.setHeader(
          'Set-Cookie',
          serialize(getJegRuntimeCookieName(), runtimeToken.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/api/workspace/jeg',
            maxAge: runtimeToken.maxAgeSeconds,
          }),
        );

        return res.status(200).json({
          launched: true,
          mode: launchProfile?.profile.mode || 'personal',
          selectedLibraryIds: launchProfile?.profile.selectedLibraryIds || [],
          expiresInSeconds: runtimeToken.maxAgeSeconds,
          localOverride: true,
        });
      }
    } catch (error: any) {
      return res.status(503).json({
        error:
          error?.message ||
          'Unable to prepare local JupyterLab runtime override.',
      });
    }
  }

  if (previewMode) {
    const runtimeToken = await createJegRuntimeRouteToken(identityResult.identity, {
      baseUrl: 'https://preview-runtime.local/api/jupyter-server',
      wsUrl: 'wss://preview-runtime.local/api/jupyter-server',
      token: 'preview-token',
      disableExport: true,
      dataExfiltrationPolicy: getDataExfiltrationPolicy(),
    });

    res.setHeader(
      'Set-Cookie',
      serialize(getJegRuntimeCookieName(), runtimeToken.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/workspace/jeg',
        maxAge: runtimeToken.maxAgeSeconds,
      }),
    );

    return res.status(200).json({
      launched: true,
      mode: launchProfile?.profile.mode || 'personal',
      selectedLibraryIds: launchProfile?.profile.selectedLibraryIds || [],
      expiresInSeconds: runtimeToken.maxAgeSeconds,
      previewMode: true,
    });
  }

  try {
    const launcherUrl = getLauncherUrl();
    const timeoutMs = Number(
      readEnv('JUPYTERLAB_LAUNCH_TIMEOUT_MS', 'JEG_LAUNCH_TIMEOUT_MS') || '30000',
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const upstreamHeaders = new Headers({
      'content-type': 'application/json',
      'x-jeg-data-exfil-policy': getDataExfiltrationPolicy(),
      'x-jeg-disable-export': 'true',
    });

    const accessToken = getAccessToken(req.headers.cookie || '');
    if (accessToken) {
      upstreamHeaders.set('Authorization', `Bearer ${accessToken}`);
    }

    for (const [key, value] of Object.entries(
      buildWorkspaceHeaders(identityResult.identity),
    )) {
      upstreamHeaders.set(key, value);
    }

    if (launchProfile?.token) {
      upstreamHeaders.set('x-jeg-launch-jwt', launchProfile.token);
      upstreamHeaders.set('x-jeg-launch-mode', launchProfile.profile.mode);
    }
    upstreamHeaders.set(
      'x-jeg-selected-library-ids',
      JSON.stringify(launchProfile?.profile.selectedLibraryIds || []),
    );
    upstreamHeaders.set('x-jeg-attach-targets', 'jupyterlab-head,kernel');

    for (const [key, value] of Object.entries(buildSecurityHeaders())) {
      upstreamHeaders.set(key, value);
    }

    const payload = {
      workspaceId: identityResult.identity.workspaceId,
      userId: identityResult.identity.userId,
      launchMode: launchProfile?.profile.mode || 'personal',
      selectedLibraryIds: launchProfile?.profile.selectedLibraryIds || [],
      defaultPath: process.env.JEG_DEFAULT_NOTEBOOK_PATH || '/lab',
      requireZmqTls: process.env.JEG_REQUIRE_ZMQ_TLS === 'true',
      exfiltrationPolicy: getDataExfiltrationPolicy(),
      disableExport: true,
      attachLibrariesToJupyterLabHead: true,
      attachLibrariesToKernel: true,
      requestedByUi: true,
    };

    const launcherResponse = await fetch(launcherUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!launcherResponse.ok) {
      const body = await launcherResponse.text();
      return res.status(502).json({
        error: 'Launcher service refused runtime launch request.',
        detail: body || launcherResponse.statusText,
      });
    }

    const launcherBody = (await launcherResponse.json()) as LauncherResponse;
    const normalizedRoute = normalizeRuntimeRoute(launcherBody);

    const runtimeToken = await createJegRuntimeRouteToken(
      identityResult.identity,
      {
        baseUrl: normalizedRoute.baseUrl,
        wsUrl: normalizedRoute.wsUrl,
        token: normalizedRoute.token,
        disableExport: true,
        dataExfiltrationPolicy: getDataExfiltrationPolicy(),
      },
    );

    res.setHeader(
      'Set-Cookie',
      serialize(getJegRuntimeCookieName(), runtimeToken.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/workspace/jeg',
        maxAge: runtimeToken.maxAgeSeconds,
      }),
    );

    return res.status(200).json({
      launched: true,
      mode: launchProfile?.profile.mode || 'personal',
      selectedLibraryIds: launchProfile?.profile.selectedLibraryIds || [],
      expiresInSeconds: runtimeToken.maxAgeSeconds,
    });
  } catch (error: any) {
    return res.status(503).json({
      error: error?.name === 'AbortError'
        ? 'Timed out while launching isolated JupyterLab runtime.'
        : error?.message || 'Unable to launch isolated JupyterLab runtime.',
    });
  }
}
