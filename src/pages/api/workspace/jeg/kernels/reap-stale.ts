import type { NextApiRequest, NextApiResponse } from 'next';
import { isJegPreviewModeEnabled } from '@/lib/workspace/jegSecurity';

const IDLE_WARNING_DAYS = Number(process.env.JEG_IDLE_WARNING_DAYS || '5');
const IDLE_KILL_DAYS = Number(process.env.JEG_IDLE_KILL_DAYS || '10');
const MAX_KERNEL_AGE_DAYS = Number(process.env.JEG_MAX_KERNEL_AGE_DAYS || '15');

type KernelRow = {
  kernelId: string;
  sessionId?: string;
  staleState?: 'healthy' | 'warning' | 'kill';
  idleDays?: number | null;
  ageDays?: number | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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
    return res.status(200).json({ killedKernelIds: [], previewMode: true });
  }

  try {
    const kernelsResponse = await fetch(
      `${req.headers['x-forwarded-proto'] || 'https'}://${
        req.headers['x-forwarded-host'] || req.headers.host
      }/api/workspace/jeg/kernels`,
      {
        method: 'GET',
        headers: {
          cookie: req.headers.cookie || '',
        },
      },
    );

    if (!kernelsResponse.ok) {
      return res.status(200).json({ killedKernelIds: [] });
    }

    const body = (await kernelsResponse.json()) as { kernels?: KernelRow[] };
    const rows = Array.isArray(body.kernels) ? body.kernels : [];

    const toKill = rows.filter((row) => row.staleState === 'kill');

    const terminateTasks = toKill.map(async (row) => {
      const reason = (row.ageDays || 0) >= MAX_KERNEL_AGE_DAYS
        ? 'stale-age'
        : (row.idleDays || 0) >= IDLE_KILL_DAYS
          ? 'stale-idle'
          : (row.idleDays || 0) >= IDLE_WARNING_DAYS
            ? 'stale-idle'
            : 'stale-idle';

      const terminateResponse = await fetch(
        `${req.headers['x-forwarded-proto'] || 'https'}://${
          req.headers['x-forwarded-host'] || req.headers.host
        }/api/workspace/jeg/kernels/terminate`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: req.headers.cookie || '',
          },
          body: JSON.stringify({
            kernelId: row.kernelId,
            sessionId: row.sessionId,
            publishBeforeKill: true,
            reason,
          }),
        },
      );

      const terminateBody = await terminateResponse.json().catch(() => null);
      if (terminateResponse.ok && terminateBody?.removed === true) {
        return row.kernelId;
      }
      return null;
    });

    const settled = await Promise.allSettled(terminateTasks);
    const killedKernelIds = settled.flatMap((result) => {
      if (result.status === 'fulfilled' && result.value) {
        return [result.value];
      }
      return [] as string[];
    });

    return res.status(200).json({ killedKernelIds });
  } catch {
    return res.status(200).json({ killedKernelIds: [] });
  }
}
