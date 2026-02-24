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
  isLocalJegDevelopmentModeEnabled,
  resolveWorkspaceIdentityFromCookie,
} from './lib/jegSecurity';
import SharedLibrariesPanel from './components/SharedLibrariesPanel';
import ActiveMountsStatusBar from './components/ActiveMountsStatusBar';
import KernelLifecyclePanel from './components/KernelLifecyclePanel';

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
    const { PageConfig } = await import('@jupyterlab/coreutils');

    type JupyterShellProps = {
      collaborative?: boolean;
      url?: string;
      token?: string;
      wsUrl?: string;
    };

    return function JupyterShell(props: JupyterShellProps) {
      if (!props.url) {
        return (
          <div className="rounded-md border border-base-light bg-base-max p-6 text-sm text-base-content">
            Unable to initialize Jupyter shell.
          </div>
        );
      }

      const effectiveWsUrl = props.wsUrl || props.url.replace(/^http/, 'ws');

      loadJupyterConfig({
        collaborative: props.collaborative ?? false,
        jupyterServerUrl: props.url,
        jupyterServerToken: props.token || '',
      });

      PageConfig.setOption('baseUrl', props.url);
      PageConfig.setOption('wsUrl', effectiveWsUrl);
      PageConfig.setOption('token', props.token || '');

      return <JupyterLabApp height="100%" width="100%" />;
    };
  },
  { ssr: false },
);

type FeatureProps = {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
};

const Feature = ({ icon, title, children }: FeatureProps) => (
  <div className="flex items-start gap-3">
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
      {icon}
    </div>
    <div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{children}</p>
    </div>
  </div>
);

const JupyterInfoPanel = () => {
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Welcome to Your Secure Gen3 Workspace
        </h2>
        <p className="mt-3 max-w-2xl mx-auto text-lg text-slate-600">
          A powerful, secure, and cost-effective environment for bioinformatics and research.
        </p>
      </div>

      <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        <Feature
          icon={<svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a.75.75 0 01.75.75v.51a4.5 4.5 0 014.235 4.432l.015.058.015.057V10a2 2 0 01-1.995 1.995L13 12H7a2 2 0 01-2-2V7.75a4.5 4.5 0 014.492-4.492L10 3.25a.75.75 0 01.75-.75zM10 5a2.5 2.5 0 00-2.5 2.5V9h5V7.5A2.5 2.5 0 0010 5z" /></svg>}
          title="Pay-per-use & Cost-Efficient"
        >
          Your workspace only consumes resources when you&apos;re actively running computations. Kernels automatically shut down when idle, ensuring you only pay for what you use.
        </Feature>

        <Feature
          icon={<svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>}
          title="FEDRAMP-level Security"
        >
          Built with stringent security controls, including encrypted data transport and strict exfiltration policies to protect sensitive HIPPA and CUI data.
        </Feature>

        <Feature
          icon={<svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 8a3 3 0 100-6 3 3 0 000 6zM14.5 8a3 3 0 100-6 3 3 0 000 6zM1.5 16.5a3 3 0 100-6 3 3 0 000 6zM16 14.5a3 3 0 10-6 0 3 3 0 006 0z" /></svg>}
          title="AI-Powered Embeddings & Cohorts"
        >
          Leverage powerful AI tools to analyze data, generate insights, and work with pre-defined cohorts directly within your secure workspace.
        </Feature>

        <Feature
          icon={<svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-6.5 6.5-3.536-3.536 6.5-6.5z" /></svg>}
          title="Pre-release Data Access"
        >
          Seamlessly switch to &apos;Team Mode&apos; to access and analyze pre-release datasets in a controlled and secure environment before they are made public.
        </Feature>

        <Feature
          icon={<svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12.5a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5a.75.75 0 01.75-.75zM10 3.25a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 3.25zM5.654 6.822a.75.75 0 011.058-.083l1.26 1.01a.75.75 0 01-.975 1.218l-1.26-1.01a.75.75 0 01-.083-1.058zm7.572 1.01a.75.75 0 01.975 1.218l-1.26 1.01a.75.75 0 11-.975-1.218l1.26-1.01z" /></svg>}
          title="Easy to Use & 508 Compliant"
        >
          An intuitive interface that meets 508 compliance standards, ensuring accessibility for all users, coupled with a familiar Jupyter experience.
        </Feature>

        <Feature
          icon={<svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M15.5 2.05a.75.75 0 00-1.061 1.06L15.22 3.9a.75.75 0 001.06-1.061l-.78-.78zM5.84 15.5a.75.75 0 10-1.061-1.06l-.78.78a.75.75 0 001.06 1.061l.78-.78zM16.28 14.44a.75.75 0 00-1.06-1.06l-.78.78a.75.75 0 101.06 1.06l.78-.78zM3.9 4.78a.75.75 0 00-1.06 1.06l.78.78a.75.75 0 001.06-1.06l-.78-.78zM10 1.25a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM10 16.25a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM3.75 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zM13.75 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75z" /></svg>}
          title="Shared Demo Notebooks"
        >
          Access a library of shared notebooks for demos and training, making it easy to get started and learn best practices from the community.
        </Feature>
      </div>
    </div>
  );
};

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
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(true);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(true);

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
          if (response.status === 401 || response.status === 403) {
            throw new Error('Access Denied: Please log in to access your workspace.');
          }
          if (response.status >= 500) {
            throw new Error('System Unavailable: The workspace service is currently experiencing issues. Please try again later.');
          }
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
        setError(e?.message || 'Unable to initialize secure JEG session. Please check your network connection.');
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
        <div className="m-4 rounded border border-blue-200 bg-white p-6 text-sm text-blue-900">
          Initializing secure JEG session...
        </div>
      );
    }

    if (error) {
      return (
        <div className="m-4 rounded border border-red-300 bg-red-50 p-6 text-sm text-red-800">
          {error}
        </div>
      );
    }

    if (!session) {
      return null;
    }

    if (!session.baseUrl) {
      return <JupyterInfoPanel />;
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
      <section className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <h1 className="text-lg font-bold text-slate-800">Gen3 Workspace</h1>
            </div>
            <nav aria-label="Global workspace scope" className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
              {(['personal', 'team', 'demos'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleGlobalTabChange(tab)}
                  aria-pressed={globalNavTab === tab}
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${
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
              onClick={applyLaunchProfile}
              disabled={isApplyingProfile || loading || Boolean(error)}
              className="rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-400"
            >
              {isApplyingProfile ? 'Applying...' : 'Apply & Launch'}
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside
            id="jeg-left-sidebar"
            className={`shrink-0 overflow-hidden border-r border-slate-200 bg-white transition-all duration-300 ${
              isLeftSidebarCollapsed
                ? 'w-0 -translate-x-full border-r-0 opacity-0'
                : 'w-[320px] translate-x-0 opacity-100'
            }`}
            aria-hidden={isLeftSidebarCollapsed}
          >
            <div
              className={`h-full min-h-0 w-[320px] overflow-y-auto motion-safe:transition-opacity motion-safe:duration-200 motion-reduce:transition-none ${
                isLeftSidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
              }`}
            >
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 p-4">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                    Data & Tools
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsLeftSidebarCollapsed(true)}
                    aria-label="Collapse data & tools sidebar"
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" /></svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <SharedLibrariesPanel
                    enabled={Boolean(session?.sharedLibraryEnabled)}
                    launchMode={launchMode}
                    selectedLibraryIds={selectedLibraryIds}
                    onSelectionChange={setSelectedLibraryIds}
                    activeScope={globalNavTab}
                  />
                </div>
              </div>
            </div>
          </aside>

          <main className="z-10 flex min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-lg shadow-slate-200">
            <div className="shrink-0 border-b border-slate-200 bg-slate-50/50">
              <div className="flex h-12 items-center justify-between px-4">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setIsLeftSidebarCollapsed((current) => !current)}
                    aria-controls="jeg-left-sidebar"
                    aria-expanded={!isLeftSidebarCollapsed}
                    className="rounded-md p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 9.75A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zM2 14.75A.75.75 0 012.75 14h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 14.75z" clipRule="evenodd" /></svg>
                    <span className="sr-only">Toggle Data & Tools</span>
                  </button>
                  <div className="h-6 w-px bg-slate-200" />
                  {session && (
                    <ActiveMountsStatusBar
                      launchMode={session.launchMode || launchMode}
                      mounts={session.activeMounts || []}
                    />
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <svg className="h-4 w-4 text-amber-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>
                        <span>Exfiltration Control: <strong>{session?.exfiltrationPolicy || 'Strict'}</strong></span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <button
                    type="button"
                    onClick={() => setIsRightSidebarCollapsed((current) => !current)}
                    aria-controls="jeg-right-sidebar"
                    aria-expanded={!isRightSidebarCollapsed}
                    className="rounded-md p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3.75a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM10 8.75a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5a.75.75 0 01.75-.75zM8.25 4.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z" /></svg>
                    <span className="sr-only">Toggle Infrastructure State</span>
                  </button>
                </div>
              </div>

              {session?.hasExportContext && (
                <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
                  <span className="font-semibold">Active Data Context:</span>
                  <span>
                    {session.exportSource || 'unknown'}
                    {session.exportCohortId ? ` / Cohort ${session.exportCohortId}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={clearExportContext}
                    className="ml-auto rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Clear context
                  </button>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="h-full min-h-0 w-full overflow-y-auto">{jupyterCanvas}</div>
            </div>
          </main>

          <aside
            id="jeg-right-sidebar"
            className={`shrink-0 overflow-hidden border-l border-slate-200 bg-white transition-all duration-300 ${
              isRightSidebarCollapsed
                ? 'w-0 translate-x-full border-l-0 opacity-0'
                : 'w-[340px] translate-x-0 opacity-100'
            }`}
            aria-hidden={isRightSidebarCollapsed}
          >
            <div
              className={`h-full w-[340px] overflow-y-auto motion-safe:transition-opacity motion-safe:duration-200 motion-reduce:transition-none ${
                isRightSidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
              }`}
            >
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 p-4">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
                    Infrastructure & Costs
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsRightSidebarCollapsed(true)}
                    aria-label="Collapse infrastructure sidebar"
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">Pay-per-use compute</p>
                    <p className="mt-1">You are only billed for active compute time. Your kernel will automatically shut down after a period of inactivity to save costs.</p>
                  </div>
                  <div className="mt-4">
                    <KernelLifecyclePanel />
                  </div>
                </div>
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
  if (isJegPreviewModeEnabled() || isLocalJegDevelopmentModeEnabled()) {
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
