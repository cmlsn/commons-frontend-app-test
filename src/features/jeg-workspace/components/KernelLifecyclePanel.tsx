import React, { useCallback, useEffect, useMemo, useState } from 'react';

type KernelRow = {
  kernelId: string;
  kernelName?: string;
  executionState?: string;
  sessionId?: string;
  sessionPath?: string;
  lastUsedAt?: string;
  startedAt?: string;
  sessionAgeMinutes?: number | null;
  workflowActiveExecutionMinutes?: number | null;
  staleState?: 'healthy' | 'warning' | 'kill';
  idleDays?: number | null;
};

type PendingRemoval = {
  row: KernelRow;
  requestedAt: number;
};

const FAST_POLL_MS = 4000;
const SLOW_POLL_MS = 30000;
const IDLE_KILL_DAYS = Number(process.env.NEXT_PUBLIC_JEG_IDLE_KILL_DAYS || '10');
const MAX_KERNEL_AGE_DAYS = Number(
  process.env.NEXT_PUBLIC_JEG_MAX_KERNEL_AGE_DAYS || '15',
);

const KernelLifecyclePanel = () => {
  const [liveRows, setLiveRows] = useState<KernelRow[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<Record<string, PendingRemoval>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasPendingRemovals = useMemo(
    () => Object.keys(pendingRemovals).length > 0,
    [pendingRemovals],
  );

  const hasTransitioningKernel = useMemo(
    () =>
      liveRows.some((row) => {
        const state = (row.executionState || '').toLowerCase();
        return state === 'starting' || state === 'terminating';
      }),
    [liveRows],
  );

  const allKernelsHealthyOrIdle = useMemo(
    () =>
      liveRows.every((row) => {
        const state = (row.executionState || '').toLowerCase();
        return state === 'healthy' || state === 'idle';
      }),
    [liveRows],
  );

  const pollingIntervalMs =
    hasPendingRemovals || hasTransitioningKernel || !allKernelsHealthyOrIdle
      ? FAST_POLL_MS
      : SLOW_POLL_MS;

  const fetchKernelState = useCallback(async () => {
    try {
      const kernelsResponse = await fetch('/api/workspace/jeg/kernels', {
        method: 'GET',
        credentials: 'include',
      });

      if (!kernelsResponse.ok) {
        throw new Error('Unable to load kernel state from backend.');
      }

      const kernelsBody = (await kernelsResponse.json()) as {
        kernels: KernelRow[];
      };
      const rows = Array.isArray(kernelsBody.kernels) ? kernelsBody.kernels : [];

      setLiveRows(rows);
      setError(null);
      setLoading(false);

      setPendingRemovals((current) => {
        const liveKernelIds = new Set(rows.map((row) => row.kernelId));
        const next: Record<string, PendingRemoval> = {};
        for (const [kernelId, pending] of Object.entries(current)) {
          if (liveKernelIds.has(kernelId)) {
            next[kernelId] = pending;
          }
        }
        return next;
      });
    } catch (fetchError: any) {
      setError(fetchError?.message || 'Unable to load kernel state.');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!mounted) return;
      if (document.visibilityState !== 'visible') return;
      await fetchKernelState();
    };

    const onVisibilityChange = () => {
      if (!mounted) return;
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    load();
    const timer = window.setInterval(load, pollingIntervalMs);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchKernelState, pollingIntervalMs]);

  const reapStaleKernels = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace/jeg/kernels/reap-stale', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        setNotice('Stale reap request failed.');
        return;
      }
      const body = (await response.json()) as { killedKernelIds?: string[] };
      if (Array.isArray(body.killedKernelIds) && body.killedKernelIds.length > 0) {
        setNotice(
          `${body.killedKernelIds.length} stale kernel(s) were auto-saved and terminated by policy.`,
        );
      } else {
        setNotice('No stale kernels to reap.');
      }
      await fetchKernelState();
    } catch {
      setNotice('Stale reap request failed.');
    }
  }, [fetchKernelState]);

  const displayRows = useMemo(() => {
    const merged = [...liveRows];
    const liveSet = new Set(liveRows.map((row) => row.kernelId));
    for (const pending of Object.values(pendingRemovals)) {
      if (!liveSet.has(pending.row.kernelId)) {
        merged.push(pending.row);
      }
    }
    return merged;
  }, [liveRows, pendingRemovals]);

  const terminateRow = async (row: KernelRow) => {
    setPendingRemovals((current) => ({
      ...current,
      [row.kernelId]: {
        row,
        requestedAt: Date.now(),
      },
    }));

    try {
      const response = await fetch('/api/workspace/jeg/kernels/terminate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kernelId: row.kernelId,
          sessionId: row.sessionId,
          publishBeforeKill: true,
          reason: 'user-request',
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.removed !== true) {
        throw new Error(body?.error || 'Backend did not confirm kernel removal.');
      }
      setNotice('Kernel terminated and snapshot published to My Library.');

      await fetchKernelState();
    } catch {
      setPendingRemovals((current) => {
        const next = { ...current };
        delete next[row.kernelId];
        return next;
      });
    }
  };

  const publishRow = async (row: KernelRow) => {
    try {
      const response = await fetch('/api/workspace/jeg/library/my', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: `Manual Publish ${row.kernelName || 'Kernel'} ${new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')}`,
          objectUri: `jeg://kernel-snapshot/${encodeURIComponent(row.kernelId)}/${Date.now()}`,
          sourceType: 'manual-publish',
          kernelId: row.kernelId,
          sessionId: row.sessionId,
          metadata: {
            sessionPath: row.sessionPath,
          },
        }),
      });
      if (!response.ok) {
        setNotice('Publish failed.');
        return;
      }
      setNotice('Published to My Library.');
    } catch {
      setNotice('Publish failed.');
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Kernel Lifecycle</h2>
          <p className="mt-1 text-xs text-slate-600">
            Terminate and delete kernels cleanly. Rows remain visible until backend
            confirms removal.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Stale kernel reaping is intentionally not auto-polled in the browser;
            production cleanup should be handled by a backend Kubernetes CronJob that
            calls /api/workspace/jeg/kernels/reap-stale.
          </p>
        </div>
        <button
          type="button"
          onClick={reapStaleKernels}
          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Run Stale Reap
        </button>
      </div>

      {notice && (
        <p className="mt-2 rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {notice}
        </p>
      )}

      {loading && <p className="mt-3 text-xs text-slate-600">Loading kernels...</p>}
      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}

      {!loading && !error && displayRows.length === 0 && (
        <p className="mt-3 text-xs text-slate-600">No active kernels.</p>
      )}

      {!loading && !error && displayRows.length > 0 && (
        <div className="mt-3 space-y-3">
          {displayRows.map((row) => {
            const pending = Boolean(pendingRemovals[row.kernelId]);
            const state = (row.executionState || '').toLowerCase();
            const isStaleOrIdle =
              state === 'idle' || row.staleState === 'warning' || row.staleState === 'kill';

            return (
              <div
                key={row.kernelId}
                className={`rounded-xl border border-slate-300 bg-white p-5 shadow-sm ${
                  isStaleOrIdle ? 'border-l-4 border-l-orange-600' : 'border-l-4 border-l-green-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {row.kernelName || 'python3'}
                    </p>
                    <p className="text-xs font-mono text-slate-600">
                      {row.sessionPath || 'unknown'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      State: {pending ? 'Terminating...' : row.executionState || 'unknown'}
                    </p>
                    {!pending && row.staleState === 'warning' && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Idle warning: inactive for about {Math.floor(row.idleDays || 0)} day(s).
                      </p>
                    )}
                    {!pending && row.staleState === 'kill' && (
                      <p className="mt-1 text-[11px] text-red-700">
                        Stale kill policy applies; autosave + terminate pending.
                      </p>
                    )}
                  </div>
                  <span
                    className={`rounded px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
                      isStaleOrIdle
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {isStaleOrIdle ? 'Stale/Idle' : 'Active'}
                  </span>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-[11px] text-slate-700">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-slate-500">UI Session Idle:</span>
                    <span className="font-semibold text-slate-900">
                      {row.sessionAgeMinutes == null
                        ? 'unknown'
                        : `${row.sessionAgeMinutes} min`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-300 pt-2 text-[12px] font-extrabold">
                    <span>WORKFLOW COMPUTE:</span>
                    <span className="text-blue-700">
                      {row.workflowActiveExecutionMinutes == null
                        ? 'unknown'
                        : `${row.workflowActiveExecutionMinutes} min`}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => publishRow(row)}
                    disabled={pending}
                    className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Snapshot
                  </button>
                  <button
                    type="button"
                    onClick={() => terminateRow(row)}
                    disabled={pending}
                    className="flex-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? 'Waiting for backend...' : 'Terminate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 rounded-md bg-slate-100 p-3 text-xs leading-relaxed text-slate-500">
        Compliance Policy: To adhere to FedRAMP continuous patching requirements
        and optimize grant funding, idle Jupyter head units are automatically
        snapshotted to your Library and terminated after {IDLE_KILL_DAYS} days of
        inactivity, or {MAX_KERNEL_AGE_DAYS} days total. Note: This policy only
        culls stateful interactive sessions; active backend compute workflows are
        not interrupted by UI timeouts.
      </div>
    </div>
  );
};

export default React.memo(KernelLifecyclePanel);
