import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { GetServerSideProps } from 'next';
import type { GetServerSidePropsContext } from 'next';
import {
  NavPageLayout,
  NavPageLayoutProps,
  getNavPageLayoutPropsFromConfig,
} from '@gen3/frontend';
import {
  isJegPreviewModeEnabled,
  resolveWorkspaceIdentityFromCookie,
} from '@/lib/workspace/jegSecurity';
import SharedLibrariesPanel from '@/components/jeg/SharedLibrariesPanel';
import ActiveMountsStatusBar from '@/components/jeg/ActiveMountsStatusBar';
import KernelLifecyclePanel from '@/components/jeg/KernelLifecyclePanel';

type JegSession = {
  baseUrl: string;
  wsUrl?: string;
  token?: string;
  workspaceId: string;
  defaultPath?: string;
  exfiltrationPolicy?: 'strict' | 'balanced' | 'open';
  requireEncryptedTransport?: boolean;
  requireZmqTls?: boolean;
  hasExportContext?: boolean;
  exportSource?: 'cohort' | 'data-library' | 'mixed';
  exportCohortId?: string;
  launchMode?: 'personal' | 'pre-release';
  selectedLibraryIds?: string[];
  sharedLibraryEnabled?: boolean;
  activeMounts?: Array<{ id: string; displayName: string; s3Uri: string }>;
  previewMode?: boolean;
};

type GlobalNavTab = 'personal' | 'team' | 'demos';

const DatalayerJupyterShell = dynamic(
  async () => {
    const { JupyterLabApp, loadJupyterConfig } = await import(
      '@datalayer/jupyter-react'
    );

    type JupyterShellProps = {
      collaborative?: boolean;
      url?: string;
      token?: string;
    };

    return function JupyterShell(props: JupyterShellProps) {
      if (!props.url) {
        return (
          <div className="rounded-md border border-base-light bg-base-max p-6 text-sm text-base-content">
            Unable to initialize Jupyter shell.
          </div>
        );
      }

      loadJupyterConfig({
        collaborative: props.collaborative ?? false,
        jupyterServerUrl: props.url,
        jupyterServerToken: props.token || '',
      });
      return <JupyterLabApp height="100%" width="100%" />;
    };
  },
  { ssr: false },
);

const WorkspaceJEGPage = ({
  headerProps,
  footerProps,
}: NavPageLayoutProps) => {
  const [session, setSession] = useState<JegSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [launchMode, setLaunchMode] = useState<'personal' | 'pre-release'>(
    'personal',
  );
  const [globalNavTab, setGlobalNavTab] = useState<GlobalNavTab>('personal');
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [isApplyingProfile, setIsApplyingProfile] = useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/workspace/jeg/session', {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || 'Unable to initialize secure JEG session.');
        }

        const data = (await response.json()) as JegSession;
        if (!mounted) return;
        setSession(data);
        setLaunchMode(data.launchMode || 'personal');
        setGlobalNavTab((data.launchMode || 'personal') === 'personal' ? 'personal' : 'team');
        setSelectedLibraryIds(data.selectedLibraryIds || []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Unable to initialize secure JEG session.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadSession();

    return () => {
      mounted = false;
    };
  }, []);

  const clearExportContext = async () => {
    try {
      await fetch('/api/workspace/jeg/export', {
        method: 'DELETE',
        credentials: 'include',
      });
      setSession((current: JegSession | null) =>
        current
          ? {
              ...current,
              hasExportContext: false,
              exportSource: undefined,
              exportCohortId: undefined,
            }
          : current,
      );
    } catch {
      // no-op to keep UI stable if context clear fails
    }
  };

  const applyLaunchProfile = async () => {
    setIsApplyingProfile(true);
    try {
      const response = await fetch('/api/workspace/jeg/launch-profile', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          mode: launchMode,
          selectedLibraryIds,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Unable to apply launch profile.');
      }

      const refreshed = await fetch('/api/workspace/jeg/session', {
        method: 'GET',
        credentials: 'include',
      });
      if (refreshed.ok) {
        const nextSession = (await refreshed.json()) as JegSession;
        setSession(nextSession);
        setLaunchMode(nextSession.launchMode || launchMode);
        setGlobalNavTab(
          (nextSession.launchMode || launchMode) === 'personal' ? 'personal' : globalNavTab,
        );
        setSelectedLibraryIds(nextSession.selectedLibraryIds || selectedLibraryIds);
      }
    } catch (error: any) {
      setError(error?.message || 'Unable to apply launch profile.');
    } finally {
      setIsApplyingProfile(false);
    }
  };

  const jupyterProps = useMemo(() => {
    if (!session) return {};
    return {
      collaborative: false,
      fullHeight: true,
      url: session.baseUrl,
      wsUrl: session.wsUrl,
      token: session.token,
      path: session.defaultPath || '/lab',
      workspaceId: session.workspaceId,
    };
  }, [session]);

  const handleGlobalTabChange = (tab: GlobalNavTab) => {
    setGlobalNavTab(tab);
    setLaunchMode(tab === 'personal' ? 'personal' : 'pre-release');
  };

  const jupyterCanvas = useMemo(() => {
    if (loading) {
      return (
        <div className="m-4 rounded border border-slate-300 bg-white p-6 text-sm text-slate-600">
          Initializing secure JEG session...
        </div>
      );
    }

    if (error) {
      return (
        <div className="m-4 rounded border border-slate-300 bg-white p-6 text-sm text-red-700">
          {error}
        </div>
      );
    }

    if (!session) {
      return null;
    }

    if (session.previewMode) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-slate-50 p-6 text-sm text-slate-600">
          Preview mode enabled: JEG backend is mocked. This panel shows UI
          layout and controls without connecting to a live kernel service.
        </div>
      );
    }

    return <DatalayerJupyterShell {...jupyterProps} />;
  }, [loading, error, session, jupyterProps]);

  return (
    <NavPageLayout
      {...{ headerProps, footerProps }}
      headerMetadata={{
        title: 'Workspace Jupyter (JEG)',
        content: 'Secure Jupyter Workspace',
        key: 'workspace-jeg-page',
      }}
    >
      <section className="flex h-screen w-screen flex-col overflow-hidden bg-slate-200">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-slate-300 bg-white px-6">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-600 text-white">
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <h1 className="text-base font-extrabold text-slate-900">Gen3 Workspace</h1>
            </div>
            <nav aria-label="Global workspace scope" className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
              {(['personal', 'team', 'demos'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleGlobalTabChange(tab)}
                  aria-pressed={globalNavTab === tab}
                  className={`rounded px-4 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    globalNavTab === tab
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsLeftSidebarCollapsed((current) => !current)}
              aria-controls="jeg-left-sidebar"
              aria-expanded={!isLeftSidebarCollapsed}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              {isLeftSidebarCollapsed ? 'Show Library' : 'Hide Library'}
            </button>
            <button
              type="button"
              onClick={applyLaunchProfile}
              disabled={isApplyingProfile || loading || Boolean(error)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isApplyingProfile ? 'Applying...' : 'Apply Profile'}
            </button>
            <button
              type="button"
              onClick={() => setIsRightSidebarCollapsed((current) => !current)}
              aria-controls="jeg-right-sidebar"
              aria-expanded={!isRightSidebarCollapsed}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              {isRightSidebarCollapsed ? 'Show Metrics' : 'Hide Metrics'}
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside
            id="jeg-left-sidebar"
            className={`shrink-0 overflow-hidden border-r border-slate-300 bg-slate-50 transition-all duration-300 ${
              isLeftSidebarCollapsed
                ? 'w-0 border-r-0 opacity-0'
                : 'w-[300px] opacity-100'
            }`}
            aria-hidden={isLeftSidebarCollapsed}
          >
            <div
              className={`h-full min-h-0 w-[300px] overflow-y-auto motion-safe:transition-opacity motion-safe:duration-200 motion-reduce:transition-none ${
                isLeftSidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
              }`}
            >
              <SharedLibrariesPanel
                enabled={Boolean(session?.sharedLibraryEnabled)}
                launchMode={launchMode}
                selectedLibraryIds={selectedLibraryIds}
                onSelectionChange={setSelectedLibraryIds}
                activeScope={globalNavTab}
              />
            </div>
          </aside>

          <main className="z-20 flex min-w-0 flex-1 flex-col overflow-hidden border-x border-slate-300 bg-white shadow-[-10px_0_20px_rgba(0,0,0,0.03),10px_0_20px_rgba(0,0,0,0.03)]">
            <div className="shrink-0 border-b border-slate-300 bg-slate-50">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-2 text-[11px] font-bold uppercase tracking-wide">
                <span className="flex items-center gap-2 text-red-800">
                  <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4H4.5A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7H11z" />
                  </svg>
                  Data Exfiltration Prevention: Strict
                </span>
                <span className="flex items-center gap-1.5 text-emerald-700">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
                  ZMQ Tunnel: {session?.requireZmqTls ? 'Encrypted' : 'Default'}
                </span>
              </div>

              <div className="flex h-11 items-center gap-5 border-b border-slate-200 bg-white px-5 text-[13px] text-slate-700">
                <span className="font-semibold text-slate-900">File</span>
                <span>Edit</span>
                <span>View</span>
                <span>Run</span>
                <span>Kernel</span>
                <span>Settings</span>
              </div>

              {session && (
                <div className="px-5 py-2">
                  <ActiveMountsStatusBar
                    launchMode={session.launchMode || launchMode}
                    mounts={session.activeMounts || []}
                  />
                </div>
              )}

              {session?.hasExportContext && (
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-2 text-xs text-slate-600">
                  <span>
                    Source: {session.exportSource || 'unknown'}
                    {session.exportCohortId ? ` • Cohort ${session.exportCohortId}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={clearExportContext}
                    className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100"
                  >
                    Clear context
                  </button>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="h-full min-h-0 w-full overflow-hidden">{jupyterCanvas}</div>
            </div>
          </main>

          <aside
            id="jeg-right-sidebar"
            className={`shrink-0 overflow-hidden border-l border-slate-300 bg-slate-50 transition-all duration-300 ${
              isRightSidebarCollapsed
                ? 'w-0 border-l-0 opacity-0'
                : 'w-[340px] opacity-100'
            }`}
            aria-hidden={isRightSidebarCollapsed}
          >
            <div
              className={`h-full w-[340px] overflow-y-auto motion-safe:transition-opacity motion-safe:duration-200 motion-reduce:transition-none ${
                isRightSidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-300 bg-white px-5 py-4">
                <span className="text-xs font-extrabold tracking-wide text-slate-900">
                  INFRASTRUCTURE STATE
                </span>
                <button
                  type="button"
                  onClick={() => setIsRightSidebarCollapsed(true)}
                  aria-label="Collapse infrastructure sidebar"
                  className="rounded text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4">
              <KernelLifecyclePanel />
              </div>
            </div>
          </aside>
        </div>
      </section>
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<NavPageLayoutProps> = async (
  context: GetServerSidePropsContext,
) => {
  if (isJegPreviewModeEnabled()) {
    return {
      props: {
        ...(await getNavPageLayoutPropsFromConfig()),
      },
    };
  }

  const login = await resolveWorkspaceIdentityFromCookie(
    context.req.headers.cookie || '',
  );

  if (!login.ok) {
    return {
      redirect: {
        destination: `/Login?referer=${encodeURIComponent('/Workspace/JEG')}`,
        permanent: false,
      },
    };
  }

  return {
    props: {
      ...(await getNavPageLayoutPropsFromConfig()),
    },
  };
};

export default WorkspaceJEGPage;
