import React, { useEffect, useState } from 'react';
import * as DatalayerJupyter from '@datalayer/jupyter-react';
import { ServerConnection } from '@jupyterlab/services';
import KernelLifecyclePanel from './KernelLifecyclePanel';
import NotebookSetupPanel from './NotebookSetupPanel';

type SecureJupyterProps = {
  stashedNotebookId?: string | null;
  showKernelPanel?: boolean;
  username?: string;
};

type StashResponse = {
  stashId: string;
  notebookPath: string;
  notebookJson: unknown;
};

const JupyterReact = (DatalayerJupyter as any).JupyterReact;
const Notebook = (DatalayerJupyter as any).Notebook;

// Configure Jupyter server connection
// Datalayer automatically appends /api/sessions, /api/kernels, etc.
// So baseUrl should NOT include /api or /proxy suffixes
if (typeof window !== 'undefined') {
  ServerConnection.makeSettings({
    baseUrl: '/api/workspace/jeg/',
    wsUrl: `ws://${window.location.host}/api/workspace/jeg/`,
    token: '', // No token needed (using cookie-based auth)
  });
}


export default function SecureJupyter({ stashedNotebookId, showKernelPanel = true, username }: SecureJupyterProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notebookCreating, setNotebookCreating] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [showSetupPanel, setShowSetupPanel] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [notebookExists, setNotebookExists] = useState(false);

  // Step 1: Spawn the JupyterHub container (or check if already running)
  const spawnContainer = async (username: string) => {
    const hubApiUrl = `/api/workspace/jeg/hub-api/users/${username}/server`;
    
    try {
      const res = await fetch(hubApiUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 201 || res.status === 200 || res.status === 202) {
        return true;
      } else if (res.status === 400) {
        // Server already running
        return true;
      } else if (res.status === 403 || res.status === 401) {
        // Authentication issue - server may need to be started manually via JupyterHub UI
        return true; // Continue to polling step to check if server exists
      } else {
        const errData = await res.json().catch(() => null);
        // Still try to connect in case server is already running
        return true;
      }
    } catch (err) {
      // Continue anyway to check if server is running
      return true;
    }
  };

  // Step 2: Poll until the server is ready
  const waitForServerReady = async (username: string, maxAttempts = 30) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check if the server API is responding
        const res = await fetch(`/api/workspace/jeg/api/sessions`, {
          method: 'GET',
          credentials: 'include',
        });

        if (res.ok) {
          return true;
        }
      } catch (err) {
        // Server not ready yet, continue polling
      }

      // Wait 2 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return false;
  };

  // Create notebook session in JupyterHub (after container is running)
  const createNotebook = async () => {
    setNotebookCreating(true);
    setLoading(true);
    try {
      // Step 1: Spawn the container (or verify it's running)
      const targetUsername = username || 'user';
      await spawnContainer(targetUsername);

      // Step 2: Wait for server to be ready
      const ready = await waitForServerReady(targetUsername);
      
      if (!ready) {
        throw new Error(
          'Jupyter server is not responding. Please start your server at http://localhost:8000/hub/home'
        );
      }

      // Step 3: Now create a session in the running Jupyter server
      
      const sessionRes = await fetch('/api/workspace/jeg/api/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'secure-notebook',
          path: 'secure-notebook.ipynb',
          type: 'notebook',
          kernel: {
            name: 'python3',
          },
        }),
      });

      if (!sessionRes.ok) {
        const errData = await sessionRes.json().catch(() => null);
        throw new Error(`Failed to create session: ${sessionRes.status}`);
      }

      const sessionData = (await sessionRes.json()) as { id: string; kernel?: { id: string } };
      
      // Mark notebook as existing, clear error, and show setup panel
      setNotebookExists(true);
      setError(null);
      setShowSetupPanel(true);
      setLoading(false);
    } catch (err: any) {
      setError(`Failed to create notebook: ${err.message}`);
      setLoading(false);
    } finally {
      setNotebookCreating(false);
    }
  };

  // Check if session exists in JupyterHub
  const ensureNotebookExists = async (notebookPath: string) => {
    try {
      const res = await fetch(`/api/workspace/jeg/api/sessions`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Unable to check sessions');
      }

      const sessions = (await res.json()) as Array<{ path?: string }>;
      const sessionExists = sessions.some(s => s.path === notebookPath);
      
      if (!sessionExists) {
        throw new Error('No active session for notebook');
      }

      setNotebookExists(true);
      return true;
    } catch (err: any) {
      // This is expected - user hasn't created a session yet
      setNotebookExists(false);
      return false;
    }
  };

  // Initialize - check if session exists
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);
      setError(null);

      try {
        const hasSession = await ensureNotebookExists('secure-notebook.ipynb');
        if (mounted) {
          if (hasSession) {
            // Notebook is available and ready to use
          } else {
            // Notebook hasn't been set up yet
            setError(null);
          }
          setLoading(false);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    void init();
    return () => {
      mounted = false;
    };
  }, []);

  // Handle stashed notebook import
  useEffect(() => {
    let mounted = true;

    const importStashed = async () => {
      if (!stashedNotebookId) return;

      setHydrating(true);
      try {
        const response = await fetch(`/api/workspace/stash?id=${encodeURIComponent(stashedNotebookId)}`, {
          method: 'GET',
          credentials: 'include',
        });

        const body = (await response.json().catch(() => null)) as StashResponse | null;
        if (!response.ok || !body?.notebookJson) {
          throw new Error('Unable to load stashed notebook');
        }

        // Write stashed notebook to secure workspace
        const targetPath = `secure-stash-${stashedNotebookId}.ipynb`;
        const writeRes = await fetch(`/api/workspace/jeg/proxy/api/contents/${encodeURIComponent(targetPath)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'notebook',
            format: 'json',
            content: body.notebookJson,
          }),
        });

        if (!writeRes.ok) {
          throw new Error('Failed to import notebook into secure workspace');
        }

        // Delete stash
        await fetch(`/api/workspace/stash?id=${encodeURIComponent(stashedNotebookId)}`, {
          method: 'DELETE',
          credentials: 'include',
        }).catch(() => null);

        if (mounted) {
          setNotebookExists(true);
          setHydrating(false);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to import stashed notebook');
          setHydrating(false);
        }
      }
    };

    void importStashed();
    return () => {
      mounted = false;
    };
  }, [stashedNotebookId]);

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
          <span>Secure Clean Room: JEG Enterprise</span>
          {stashedNotebookId ? <span>Incoming stash: {stashedNotebookId}</span> : null}
          <span className="text-blue-600">
            {notebookExists ? '✓ Notebook Ready' : '○ No Notebook'}
          </span>
        </div>

        {hydrating ? (
          <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
            Importing notebook from Personal Sandbox into Secure Clean Room…
          </div>
        ) : null}

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {(loading || notebookCreating) ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              <div className="text-center">
                <div className="mb-4">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
                </div>
                <div className="mb-2 font-medium">
                  {notebookCreating ? 'Creating session in JupyterHub...' : 'Initializing secure Jupyter...'}
                </div>
                <div className="text-xs text-slate-400">
                  {notebookCreating
                    ? 'Launching kernel environment'
                    : 'Checking for active notebook session'}
                </div>
              </div>
            </div>
          ) : !notebookExists ? (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <div className="max-w-sm rounded-md border border-blue-200 bg-blue-50 p-6 text-sm text-blue-700">
                <p className="font-semibold">Create Your Notebook</p>
                <p className="mt-2 text-xs">
                  Start a new JupyterHub session to create and edit your notebook. Your kernel environment will be
                  provisioned automatically.
                </p>
                {error && (
                  <p className="mt-3 rounded bg-red-100 p-2 text-xs text-red-700">{error}</p>
                )}
                <button
                  type="button"
                  onClick={createNotebook}
                  disabled={notebookCreating}
                  className="mt-4 w-full rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {notebookCreating ? 'Creating...' : 'Create Notebook'}
                </button>
              </div>
            </div>
          ) : !Notebook ? (
            <div className="m-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
              @datalayer/jupyter-react Notebook component is unavailable.
            </div>
          ) : (
            <div className="h-full w-full overflow-hidden flex flex-col">
              {/* Setup panel as modal overlay */}
              {showSetupPanel && !setupComplete && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
                  <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl">
                    <NotebookSetupPanel
                      onSetupComplete={(setup) => {
                        setSetupComplete(true);
                        setShowSetupPanel(false);
                      }}
                    />
                  </div>
                </div>
              )}

              {/* JEG-backed Notebook with MSW mocks for zero-cost rendering */}
              <div className="flex-1 h-full overflow-hidden">
                <JupyterReact>
                  <div className="h-full flex flex-col">
                    <Notebook
                      id="secure-notebook"
                      path="secure-notebook.ipynb"
                      startDefaultKernel={false}
                      height="100%"
                    />
                  </div>
                </JupyterReact>
              </div>
            </div>
          )}
        </div>
      </div>

      {showKernelPanel && (
        <aside className="h-full w-[340px] shrink-0 border-l border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Kernel & Compute</h3>
            <p className="mt-1 text-xs text-slate-500">
              Provision and manage JEG kernel for cell execution.
            </p>
          </div>
          <div className="h-[calc(100%-73px)] overflow-y-auto p-4">
            <KernelLifecyclePanel />
          </div>
        </aside>
      )}
    </div>
  );
}
