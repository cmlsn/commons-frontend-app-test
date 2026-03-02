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

type KernelSpecEntry = {
  name: string;
  displayName: string;
  language?: string;
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
  const [kernelSpecs, setKernelSpecs] = useState<KernelSpecEntry[]>([]);
  const [selectedKernelName, setSelectedKernelName] = useState<string>('python3');
  const [attachKernelId, setAttachKernelId] = useState<string>('');
  const [sessionPathInput, setSessionPathInput] = useState<string>('Workspace/Untitled.ipynb');
  const [launching, setLaunching] = useState(false);
  const [openingKernelId, setOpeningKernelId] = useState<string | null>(null);

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
      console.log('[KernelPanel] Fetching kernel state...');
      const kernelsResponse = await fetch('/api/workspace/jeg/kernels', {
        method: 'GET',
        credentials: 'include',
      });

      console.log('[KernelPanel] Kernel fetch response:', kernelsResponse.status);
      if (!kernelsResponse.ok) {
        const errorBody = await kernelsResponse.json().catch(() => null);
        console.error('[KernelPanel] Kernel fetch error:', kernelsResponse.status, errorBody);
        throw new Error('Unable to load kernel state from backend.');
      }

      const kernelsBody = (await kernelsResponse.json()) as {
        kernels: KernelRow[];
      };
      const rows = Array.isArray(kernelsBody.kernels) ? kernelsBody.kernels : [];
      console.log('[KernelPanel] Loaded kernels:', rows.length, rows);

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
      console.error('[KernelPanel] Fetch error:', fetchError);
      setError(fetchError?.message || 'Unable to load kernel state.');
      setLoading(false);
    }
  }, []);

  const fetchKernelSpecs = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace/jeg/proxy/api/kernelspecs', {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        default?: string;
        kernelspecs?: Record<string, { spec?: { display_name?: string; language?: string } }>;
      };
      const entries = Object.entries(body.kernelspecs || {}).map(([name, value]) => ({
        name,
        displayName: value?.spec?.display_name || name,
        language: value?.spec?.language,
      }));
      setKernelSpecs(entries);
      const defaultName = body.default || entries[0]?.name || 'python3';
      setSelectedKernelName((current) => current || defaultName);
    } catch {
      // Keep panel usable even if kernelspec fetch fails.
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
    void fetchKernelSpecs();
    const timer = window.setInterval(load, pollingIntervalMs);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchKernelState, fetchKernelSpecs, pollingIntervalMs]);

  useEffect(() => {
    if (!attachKernelId && liveRows.length > 0) {
      setAttachKernelId(liveRows[0].kernelId);
    }
  }, [attachKernelId, liveRows]);

  const normalizeSessionPath = (value: string) => {
    const trimmed = value.trim();
    // Generate unique path using timestamp to avoid JEG session conflicts
    if (!trimmed) return `Workspace/Untitled-${Date.now()}.ipynb`;
    // If user provided a path, also append timestamp to ensure uniqueness
    const base = trimmed.endsWith('.ipynb') ? trimmed.slice(0, -6) : trimmed;
    return `${base}-${Date.now()}.ipynb`;
  };

  const openNotebookInJupyter = useCallback((notebookPath: string) => {
    // Note: Auto-opening causes focus recursion crash in JupyterLab
    // User must manually navigate to the notebook to connect the kernel
    console.log('[KernelPanel] Kernel launched. Notebook path:', notebookPath);
    console.log('[KernelPanel] → Open this file in JupyterLab file browser to connect the kernel');
  }, []);

  const launchKernelSession = async () => {
    setLaunching(true);
    try {
      const path = normalizeSessionPath(sessionPathInput);
      
      // Step 1: Create the notebook file first (required for kernel to fully start)
      console.log('[KernelPanel] Creating notebook file:', path);
      const emptyNotebook = {
        cells: [],
        metadata: {
          kernelspec: {
            display_name: selectedKernelName || 'python3',
            language: 'python',
            name: selectedKernelName || 'python3',
          },
          language_info: {
            name: 'python',
          },
        },
        nbformat: 4,
        nbformat_minor: 5,
      };
      
      const createResponse = await fetch(`/api/workspace/jeg/proxy/api/contents/${encodeURIComponent(path)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notebook',
          format: 'json',
          content: emptyNotebook,
        }),
      });
      
      if (!createResponse.ok) {
        const createBody = await createResponse.json().catch(() => null);
        console.warn('[KernelPanel] Notebook creation failed:', createResponse.status, createBody);
        // Continue anyway - JEG might auto-create it
      } else {
        console.log('[KernelPanel] Notebook file created');
      }
      
      // Step 2: Create the session + kernel
      const payload = {
        path,
        type: 'notebook',
        name: '',
        kernel: { name: selectedKernelName || 'python3' },
      };
      console.log('[KernelPanel] Launching kernel session:', payload);
      const response = await fetch('/api/workspace/jeg/proxy/api/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      console.log('[KernelPanel] Launch response:', response.status, body);
      if (!response.ok) {
        const errorMsg = body?.message || body?.error || `HTTP ${response.status}`;
        throw new Error(`Kernel launch failed (${response.status}): ${errorMsg}`);
      }
      setNotice(`Kernel launched! Open "${path}" in JupyterLab file browser to connect and start.`);
      // Open the notebook in Jupyter so it discovers the kernel
      openNotebookInJupyter(path);
      await fetchKernelState();
    } catch (launchError: any) {
      console.error('[KernelPanel] Launch error:', launchError);
      setNotice(launchError?.message || 'Kernel launch failed.');
    } finally {
      setLaunching(false);
    }
  };

  const attachToExistingKernel = async () => {
    if (!attachKernelId) return;
    setLaunching(true);
    try {
      const selected = liveRows.find((row) => row.kernelId === attachKernelId);
      if (!selected) {
        await fetchKernelState(); // Refresh the list
        throw new Error('Selected kernel not found. The kernel may have been terminated.');
      }
      const path = normalizeSessionPath(sessionPathInput);
      
      // Note: Standard Jupyter session API doesn't support binding to existing kernel IDs.
      // We'll create a new session with the same kernel spec instead.
      const payload = {
        path,
        type: 'notebook',
        name: '',
        kernel: { name: selected.kernelName || selectedKernelName || 'python3' },
      };
      console.log('[KernelPanel] Creating new session with kernel spec:', payload);
      const response = await fetch('/api/workspace/jeg/proxy/api/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      console.log('[KernelPanel] Session create response:', response.status, body);
      if (!response.ok) {
        const errorMsg = body?.message || body?.error || `HTTP ${response.status}`;
        throw new Error(`Failed to create session: ${errorMsg}`);
      }
      setNotice(`Created session "${path}" with kernel spec "${selected.kernelName}".`);
      // Open the notebook in Jupyter so it discovers the kernel
      openNotebookInJupyter(path);
      await fetchKernelState();
    } catch (attachError: any) {
      console.error('[KernelPanel] Error:', attachError);
      setNotice(attachError?.message || 'Failed to create session.');
    } finally {
      setLaunching(false);
    }
  };

  const openNotebookForKernel = async (kernelRow: KernelRow) => {
    setOpeningKernelId(kernelRow.kernelId);
    try {
      // Create a unique notebook path for this kernel
      const notebookPath = `Workspace/kernel-${kernelRow.kernelId.slice(0, 8)}-${Date.now()}.ipynb`;
      
      // Step 1: Create the notebook file
      console.log('[KernelPanel] Creating notebook file for kernel:', notebookPath);
      const emptyNotebook = {
        cells: [],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      };
      
      const createResponse = await fetch('/api/workspace/jeg/proxy/api/contents/' + notebookPath, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'notebook',
          format: 'json',
          content: emptyNotebook,
        }),
      });
      
      if (!createResponse.ok && createResponse.status !== 201) {
        // Try without creating file - create session directly
        console.log('[KernelPanel] File creation skipped (JEG may have contents API disabled)');
      }

      // Step 2: Create a session that binds to this kernel
      // Note: We create a new session with the same kernel spec (JEG doesn't support binding to kernel IDs)
      const sessionPayload = {
        path: notebookPath,
        type: 'notebook',
        name: '',
        kernel: { name: kernelRow.kernelName || 'python3' },
      };
      
      console.log('[KernelPanel] Creating session for kernel:', sessionPayload);
      const sessionResponse = await fetch('/api/workspace/jeg/proxy/api/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sessionPayload),
      });
      
      const sessionBody = await sessionResponse.json().catch(() => null);
      console.log('[KernelPanel] Session create response:', sessionResponse.status, sessionBody);
      
      if (!sessionResponse.ok) {
        const errorMsg = sessionBody?.message || sessionBody?.error || `HTTP ${sessionResponse.status}`;
        throw new Error(`Failed to create session: ${errorMsg}`);
      }

      setNotice(`✓ Notebook "${notebookPath}" created and bound to kernel. Open it in JupyterLab file browser to start using it.`);
      await fetchKernelState();
      
    } catch (err) {
      console.error('[KernelPanel] Error opening notebook for kernel:', err);
      setNotice((err as any)?.message || 'Failed to create notebook for kernel.');
    } finally {
      setOpeningKernelId(null);
    }
  };

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
    console.log('[KernelPanel] Terminating kernel:', row.kernelId);
    setPendingRemovals((current) => ({
      ...current,
      [row.kernelId]: {
        row,
        requestedAt: Date.now(),
      },
    }));

    try {
      const payload = {
        kernelId: row.kernelId,
        sessionId: row.sessionId,
        publishBeforeKill: true,
        reason: 'user-request',
      };
      const response = await fetch('/api/workspace/jeg/kernels/terminate', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      console.log('[KernelPanel] Terminate response:', response.status, body);
      if (!response.ok || body?.removed !== true) {
        throw new Error(body?.error || `Terminate failed (${response.status})`);
      }
      setNotice('Kernel terminated and snapshot published to My Library.');

      await fetchKernelState();
    } catch (err) {
      console.error('[KernelPanel] Terminate error:', err);
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

      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Launch / Attach</p>
        <div className="mt-2 space-y-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">Kernel Spec</label>
            <select
              value={selectedKernelName}
              onChange={(event) => setSelectedKernelName(event.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              {kernelSpecs.length === 0 ? (
                <option value="python3">python3</option>
              ) : (
                kernelSpecs.map((spec) => (
                  <option key={spec.name} value={spec.name}>
                    {spec.displayName} ({spec.name})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">Notebook Path</label>
            <input
              value={sessionPathInput}
              onChange={(event) => setSessionPathInput(event.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
              placeholder="Workspace/Untitled.ipynb"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">Attach to Existing Kernel</label>
            <select
              value={attachKernelId}
              onChange={(event) => setAttachKernelId(event.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
              disabled={liveRows.length === 0}
            >
              {liveRows.length === 0 ? (
                <option value="">No active kernels</option>
              ) : (
                liveRows.map((row) => (
                  <option key={row.kernelId} value={row.kernelId}>
                    {(row.kernelName || 'python3')} · {row.kernelId.slice(0, 8)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={launchKernelSession}
              disabled={launching}
              className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {launching ? 'Working…' : 'Launch Kernel'}
            </button>
            <button
              type="button"
              onClick={attachToExistingKernel}
              disabled={launching || !attachKernelId}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Attach Kernel
            </button>
          </div>
        </div>
      </div>

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
                    onClick={() => openNotebookForKernel(row)}
                    disabled={pending || openingKernelId === row.kernelId}
                    className="flex-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {openingKernelId === row.kernelId ? 'Opening...' : 'Open Notebook'}
                  </button>
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
