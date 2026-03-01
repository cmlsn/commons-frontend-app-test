import type { NextApiRequest, NextApiResponse } from 'next';
// Fixed Import Paths:
import {
  getProxyBaseUrl,
  isJegPreviewModeEnabled,
  resolveWorkspaceIdentityFromCookie,
} from '@/features/jeg-workspace/lib/jegSecurity';

const IDLE_WARNING_DAYS = Number(process.env.JEG_IDLE_WARNING_DAYS || '5');
const IDLE_KILL_DAYS = Number(process.env.JEG_IDLE_KILL_DAYS || '10');
const MAX_KERNEL_AGE_DAYS = Number(process.env.JEG_MAX_KERNEL_AGE_DAYS || '15');

type JupyterSession = {
  id: string;
  path?: string;
  kernel?: {
    id?: string;
    name?: string;
  };
};

type JupyterKernel = {
  id: string;
  name?: string;
  execution_state?: string;
  last_activity?: string;
  created?: string;
};

type KernelRow = {
  kernelId: string;
  kernelName?: string;
  executionState?: string;
  sessionId?: string;
  sessionPath?: string;
  lastUsedAt?: string;
  startedAt?: string;
  sessionAgeMinutes: number;
  workflowActiveExecutionMinutes: number;
  idleDays: number | null;
  ageDays: number | null;
  staleState: 'healthy' | 'warning' | 'kill';
};

function daysBetween(now: number, timestamp?: string) {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  return (now - parsed) / (1000 * 60 * 60 * 24);
}

function classifyStale(
  idleDays: number | null,
  ageDays: number | null,
): 'healthy' | 'warning' | 'kill' {
  if ((ageDays ?? 0) >= MAX_KERNEL_AGE_DAYS) return 'kill';
  if ((idleDays ?? 0) >= IDLE_KILL_DAYS) return 'kill';
  if ((idleDays ?? 0) >= IDLE_WARNING_DAYS) return 'warning';
  return 'healthy';
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
    const now = Date.now();
    const minutes = (value: number) => value * 60 * 1000;
    const iso = (deltaMs: number) => new Date(now - deltaMs).toISOString();

    return res.status(200).json({
      previewMode: true,
      policy: {
        idleWarningDays: IDLE_WARNING_DAYS,
        idleKillDays: IDLE_KILL_DAYS,
        maxKernelAgeDays: MAX_KERNEL_AGE_DAYS,
      },
      kernels: [
        {
          kernelId: 'kernel-preview-1',
          kernelName: 'python3',
          executionState: 'idle',
          sessionId: 'session-preview-1',
          sessionPath: 'notebooks/project-a.ipynb',
          lastUsedAt: iso(minutes(20)),
          startedAt: iso(minutes(95)),
          sessionAgeMinutes: 95,
          workflowActiveExecutionMinutes: 29,
          idleDays: 0,
          ageDays: 0,
          staleState: 'healthy',
        },
        {
          kernelId: 'kernel-preview-2',
          kernelName: 'python3',
          executionState: 'idle',
          sessionId: 'session-preview-2',
          sessionPath: 'notebooks/pre-release-analysis.ipynb',
          lastUsedAt: iso(6 * 24 * 60 * 60 * 1000),
          startedAt: iso(8 * 24 * 60 * 60 * 1000),
          sessionAgeMinutes: 8 * 24 * 60,
          workflowActiveExecutionMinutes: Math.floor(8 * 24 * 60 * 0.3),
          idleDays: 6,
          ageDays: 8,
          staleState: 'warning',
        },
      ],
    });
  }

  const login = await resolveWorkspaceIdentityFromCookie(req.headers.cookie || '');
  if (!login.ok) {
    return res.status(login.statusCode).json({ error: login.error });
  }

  const proxyBaseUrl = getProxyBaseUrl(req);
  try {
    const [sessionsRes, kernelsRes] = await Promise.all([
      fetch(`${proxyBaseUrl}/api/sessions`, {
        method: 'GET',
        headers: { cookie: req.headers.cookie || '' },
      }),
      fetch(`${proxyBaseUrl}/api/kernels`, {
        method: 'GET',
        headers: { cookie: req.headers.cookie || '' },
      }),
    ]);

    if (!sessionsRes.ok || !kernelsRes.ok) {
      return res.status(502).json({ error: 'Unable to fetch kernel state from JEG.' });
    }

    const sessions = (await sessionsRes.json()) as JupyterSession[];
    const kernels = (await kernelsRes.json()) as JupyterKernel[];
    const sessionByKernel = new Map<string, JupyterSession>();
    for (const session of sessions) {
      const kernelId = session.kernel?.id;
      if (kernelId) sessionByKernel.set(kernelId, session);
    }

    const now = Date.now();
    const rows: KernelRow[] = kernels.map((kernel) => {
      const session = sessionByKernel.get(kernel.id);
      const lastUsedAt = kernel.last_activity || undefined;
      const startedAt = kernel.created || kernel.last_activity || undefined;
      const idleDays = daysBetween(now, lastUsedAt);
      const ageDays = daysBetween(now, startedAt);
      const sessionAgeMinutes =
        ageDays == null ? 0 : Math.max(0, Math.floor(ageDays * 24 * 60));
      const workflowActiveExecutionMinutes = Math.max(
        0,
        Math.floor(sessionAgeMinutes * 0.3),
      );
      const staleState = classifyStale(idleDays, ageDays);

      return {
        kernelId: kernel.id,
        kernelName: kernel.name,
        executionState: kernel.execution_state,
        sessionId: session?.id,
        sessionPath: session?.path,
        lastUsedAt,
        startedAt,
        sessionAgeMinutes,
        workflowActiveExecutionMinutes,
        idleDays,
        ageDays,
        staleState,
      };
    });

    return res.status(200).json({
      policy: {
        idleWarningDays: IDLE_WARNING_DAYS,
        idleKillDays: IDLE_KILL_DAYS,
        maxKernelAgeDays: MAX_KERNEL_AGE_DAYS,
      },
      kernels: rows,
    });
  } catch (error: any) {
    return res.status(502).json({
      error: error?.message || 'Unable to load JEG kernels.',
    });
  }
}