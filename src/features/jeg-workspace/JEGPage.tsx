import React, { useEffect, useRef, useState } from 'react';
import { GetServerSideProps } from 'next';
import type { GetServerSidePropsContext } from 'next';
import Head from 'next/head';
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

type WorkspaceJEGPageProps = NavPageLayoutProps & {
  isStaticJupyterMode?: boolean;
};

const WorkspaceJEGPage = ({
  headerProps,
  footerProps,
  isStaticJupyterMode = false,
}: WorkspaceJEGPageProps) => {
  const [forceStaticJupyterMode, setForceStaticJupyterMode] = useState(false);
  const staticJupyterModeEnabled = isStaticJupyterMode || forceStaticJupyterMode;
  const [session, setSession] = useState<JegSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!staticJupyterModeEnabled);
  const [launchMode, setLaunchMode] = useState<'personal' | 'pre-release'>('personal');
  const [globalNavTab, setGlobalNavTab] = useState<GlobalNavTab>('personal');
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(true);
  const [isWorkspaceMaximized, setIsWorkspaceMaximized] = useState(false);
  
  const mountPointRef = useRef<HTMLDivElement>(null);
  const staticAssetBaseUrl = (process.env.NEXT_PUBLIC_JEG_STATIC_ASSET_BASE_URL || '/jupyter').replace(/\/$/, '');
  const configuredWsUrl = (process.env.NEXT_PUBLIC_JEG_WS_URL || process.env.JEG_WS_URL || '').trim();
  
  // For local dev with Basic auth, inject credentials into WebSocket URL
  const runtimeWsUrl = (() => {
    const baseWsUrl = configuredWsUrl || 'ws://localhost:18888';
    // Check if local dev mode (client-side check)
    if (typeof window !== 'undefined' && baseWsUrl.includes('localhost')) {
      // Include Basic auth credentials in WS URL for local dev
      const username = 'guest'; // From .env.development
      const password = 'guest-password';
      // Parse URL and inject credentials
      try {
        const url = new URL(baseWsUrl);
        url.username = username;
        url.password = password;
        return url.toString();
      } catch {
        return baseWsUrl;
      }
    }
    return baseWsUrl;
  })();

  const shouldRenderJupyterMountPoint = staticJupyterModeEnabled
    ? !loading && !error
    : !loading && !error && Boolean(session?.baseUrl) && !session?.previewMode;

  const toggleZenMode = () => {
    const nextMaximized = !isWorkspaceMaximized;
    setIsWorkspaceMaximized(nextMaximized);
    setIsLeftSidebarCollapsed(nextMaximized);
    setIsRightSidebarCollapsed(nextMaximized);
  };

  useEffect(() => {
    const delay = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 320);
    return () => window.clearTimeout(delay);
  }, [isLeftSidebarCollapsed, isRightSidebarCollapsed, isWorkspaceMaximized]);

  useEffect(() => {
    if (isWorkspaceMaximized) {
      document.body.classList.add('workspace-jeg-maximized');
      return () => {
        document.body.classList.remove('workspace-jeg-maximized');
      };
    }
    document.body.classList.remove('workspace-jeg-maximized');
  }, [isWorkspaceMaximized]);

  useEffect(() => {
    if (staticJupyterModeEnabled) {
      setLoading(false);
      setError(null);
      return;
    }
    let mounted = true;
    const loadSession = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/workspace/jeg/session', { method: 'GET', credentials: 'include' });
        if (!response.ok) throw new Error('Unable to initialize secure JupyterLab runtime session.');
        const data = (await response.json()) as JegSession;
        if (!mounted) return;
        setSession(data);
        setLaunchMode(data.launchMode || 'personal');
        setGlobalNavTab((data.launchMode || 'personal') === 'personal' ? 'personal' : 'team');
        setSelectedLibraryIds(data.selectedLibraryIds || []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Connection failed.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadSession();
    return () => { mounted = false; };
  }, [staticJupyterModeEnabled]);

  const clearExportContext = async () => {
    try {
      await fetch('/api/workspace/jeg/export', { method: 'DELETE', credentials: 'include' });
      setSession((current: JegSession | null) => current ? { ...current, hasExportContext: false, exportSource: undefined, exportCohortId: undefined } : current);
    } catch {}
  };

  const handleGlobalTabChange = (tab: GlobalNavTab) => {
    setGlobalNavTab(tab);
    setLaunchMode(tab === 'personal' ? 'personal' : 'pre-release');
  };

  useEffect(() => {
    if (!shouldRenderJupyterMountPoint) return;
    const mountPoint = mountPointRef.current;
    if (!mountPoint) return;

    let disposed = false;

    // Create popup container for menus/dialogs
    const popupContainer = document.createElement('div');
    popupContainer.id = 'jupyter-popup-container';
    popupContainer.setAttribute('style', 'position: fixed; top: 0; left: 0; z-index: 10000; pointer-events: none;');
    document.body.appendChild(popupContainer);

    // Add CSS to constrain the shell and handle popups
    const shellContainStyle = document.createElement('style');
    const shellContainStyleId = 'jupyter-shell-contain';
    shellContainStyle.id = shellContainStyleId;
    shellContainStyle.textContent = `
      #jupyter-popup-container > .lm-Widget { pointer-events: auto; position: absolute !important; }
      body > .lm-Widget.lm-Menu, body > .lm-Widget.lm-ContextMenu { position: fixed !important; z-index: 100000 !important; }
      .jp-CommandPalette { position: fixed !important; top: 50% !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 100000 !important; max-height: 80vh !important; margin: 0 !important; }
      #jupyterlab-site { position: relative !important; contain: strict !important; z-index: 0 !important; height: 100% !important; width: 100% !important; overflow: hidden !important; }
      #jupyterlab-site > .jp-LabShell, #jupyterlab-site > .jp-ApplicationShell, #jupyterlab-site > .lm-Widget { position: absolute !important; inset: 0 !important; height: 100% !important; width: 100% !important; }
    `;
    document.head.appendChild(shellContainStyle);

    // Intercept DOM mutations to route JupyterLab components to mount point
    const origBodyInsertBefore = document.body.insertBefore.bind(document.body);
    const origBodyAppendChild = document.body.appendChild.bind(document.body);
    const origBodyRemoveChild = document.body.removeChild.bind(document.body);

    const isJupyterShell = (node: Node) => node instanceof Element && (node.id === 'jupyterlab-splash' || node.classList.contains('jp-LabShell'));
    const isJupyterPopup = (node: Node) => node instanceof Element && (node.classList.contains('lm-Menu') || node.classList.contains('lm-ContextMenu') || node.classList.contains('jp-Dialog') || node.classList.contains('jp-HoverBox') || node.classList.contains('jp-CommandPalette'));

    (document.body as any).insertBefore = function <T extends Node>(node: T, ref: Node | null): T {
      if (isJupyterShell(node)) return mountPoint.insertBefore(node, null) as unknown as T;
      if (isJupyterPopup(node) && popupContainer) return popupContainer.insertBefore(node, null) as unknown as T;
      return origBodyInsertBefore(node, ref);
    };
    (document.body as any).appendChild = function <T extends Node>(node: T): T {
      if (isJupyterShell(node)) return mountPoint.appendChild(node) as unknown as T;
      if (isJupyterPopup(node) && popupContainer) return popupContainer.appendChild(node) as unknown as T;
      return origBodyAppendChild(node);
    };
    (document.body as any).removeChild = function <T extends Node>(node: T): T {
      if (isJupyterShell(node) && node.parentNode === mountPoint) return mountPoint.removeChild(node) as unknown as T;
      if (isJupyterPopup(node) && popupContainer && node.parentNode === popupContainer) return popupContainer.removeChild(node) as unknown as T;
      return origBodyRemoveChild(node);
    };

    // Load the bundle
    const preloader = document.getElementById('jupyter-lite-main') as HTMLLinkElement;
    if (!preloader) {
      // If no preloader, inject bootstrap.js directly
      const script = document.createElement('script');
      script.src = `${staticAssetBaseUrl}/bootstrap.js`;
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    } else {
      // Load via preload link
      const script = document.createElement('script');
      script.src = preloader.href;
      script.setAttribute('main', preloader.getAttribute('main') || 'index');
      document.head.appendChild(script);
    }

    return () => {
      disposed = true;
      // Restore original methods
      (document.body as any).insertBefore = origBodyInsertBefore;
      (document.body as any).appendChild = origBodyAppendChild;
      (document.body as any).removeChild = origBodyRemoveChild;
      // Clean up
      if (popupContainer.parentNode) popupContainer.parentNode.removeChild(popupContainer);
      const styleEl = document.getElementById(shellContainStyleId);
      if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
    };
  }, [shouldRenderJupyterMountPoint, staticAssetBaseUrl]);

  return (
    <NavPageLayout
      headerProps={headerProps}
      footerProps={footerProps}
      mainProps={{ fixed: true }}
      headerMetadata={{
        title: 'Workspace JupyterLab',
        content: 'Secure JupyterLab Workspace',
        key: 'workspace-jeg-page',
      }}
    >
      <Head>
        <title>Workspace JupyterLab</title>
        <style>{`
          body.workspace-jeg-maximized footer {
            display: none !important;
          }
        `}</style>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__webpack_public_path__ = '${staticAssetBaseUrl}/build/';`,
          }}
        />
        <link
          id="jupyter-lite-main"
          rel="preload"
          href={`${staticAssetBaseUrl}/build/lab/bundle.js`}
          // @ts-ignore - custom attribute used by JupyterLite
          main="index"
          as="script"
        />
        <script
          id="jupyter-config-data"
          type="application/json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              baseUrl: `${staticAssetBaseUrl}/`,
              staticUrl: `${staticAssetBaseUrl}/`,
              wsUrl: runtimeWsUrl,
              kernelsUrl: '/api/workspace/jeg/proxy/api/kernels',
              sessionsUrl: '/api/workspace/jeg/proxy/api/sessions',
              kernelspecsUrl: '/api/workspace/jeg/proxy/api/kernelspecs',
              contentsUrl: '/api/workspace/jeg/proxy/api/contents',
              themesUrl: `./build/themes`,
              settingsUrl: `./build/schemas`,
              fullKernelsUrl: '/api/workspace/jeg/proxy/api/kernels',
              fullSessionsUrl: '/api/workspace/jeg/proxy/api/sessions',
              fullKernelspecsUrl: '/api/workspace/jeg/proxy/api/kernelspecs',
              fullWorkspacesUrl: '/api/workspace/jeg/proxy/api/workspaces',
              fullContentsUrl: '/api/workspace/jeg/proxy/api/contents',
              appName: 'Gen3 Workspace',
              federated_extensions: [],
              // Configure JupyterLab to use remote kernel gateway
              disableRTC: true,
              exposeAppInBrowser: false,
              collaborative: false,
              notebookStartsKernel: false, // 🔑 Don't auto-start kernels - use existing ones
              // Tell Jupyter this is a remote kernel server (JEG)
              serverSettings: {
                baseUrl: '/api/workspace/jeg/proxy',
                wsUrl: runtimeWsUrl,
                token: '', // Authentication handled by Next.js proxy
                appendToken: false, // Don't append token to URLs (handled via cookies)
              },
              // Extend server settings with authentication for kernel API calls
              overrides: {
                'notebook:tracker': {
                  codeCellConfig: {
                    lineNumbers: true,
                  },
                },
              },
            }),
          }}
        />
      </Head>
      <script
        dangerouslySetInnerHTML={{
          __html: `
(async () => {
  // Wait for JupyterLab to initialize and load kernels
  let attempts = 0;
  const maxAttempts = 50;
  
  while (attempts < maxAttempts) {
    try {
      const app = window.jupyterlab?.app || window.jupyterlab;
      if (!app) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      console.log('[JEG Init] JupyterLab app initialized');
      
      // Fetch running kernels from our proxy
      const response = await fetch('/api/workspace/jeg/proxy/api/kernels', {
        credentials: 'include',
      });
      
      if (response.ok) {
        const kernels = await response.json();
        console.log('[JEG Init] Running kernels:', kernels);
        
        // Store in a global so the kernel manager can access them
        window.__jegRunningKernels = kernels;
      }
      
      break;
    } catch (e) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
})();
          `,
        }}
      />
      <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100">
        <header className={`flex shrink-0 items-center justify-between border-b border-slate-200 bg-white shadow-sm ${isWorkspaceMaximized ? 'h-[44px] px-4' : 'h-[60px] px-6'}`}>
          <div className={`flex items-center ${isWorkspaceMaximized ? 'gap-4' : 'gap-8'}`}>
            <div className={`flex items-center ${isWorkspaceMaximized ? 'gap-2' : 'gap-3'}`}>
              <div className={`flex items-center justify-center rounded-lg bg-blue-600 text-white ${isWorkspaceMaximized ? 'h-6 w-6' : 'h-8 w-8'}`}>
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              </div>
              <h1 className={`font-bold text-slate-800 ${isWorkspaceMaximized ? 'text-base' : 'text-lg'}`}>Gen3 Workspace</h1>
            </div>
            <nav className={`flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 ${isWorkspaceMaximized ? 'p-0.5' : 'p-1'}`}>
              {(['personal', 'team', 'demos'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleGlobalTabChange(tab)}
                  className={`rounded-md font-semibold capitalize transition-colors ${isWorkspaceMaximized ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm'} ${globalNavTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}
                >
                  {tab}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside className={`shrink-0 overflow-hidden border-r border-slate-200 bg-white transition-all duration-300 ${isLeftSidebarCollapsed ? 'w-0 border-r-0 opacity-0' : 'w-[320px] opacity-100'}`}>
            <div className="flex h-full flex-col w-[320px]">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Data & Tools</h2>
                <button type="button" onClick={() => {
                  setIsLeftSidebarCollapsed(true);
                  if (!isRightSidebarCollapsed) setIsWorkspaceMaximized(false);
                }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <SharedLibrariesPanel enabled={Boolean(session?.sharedLibraryEnabled)} launchMode={launchMode} selectedLibraryIds={selectedLibraryIds} onSelectionChange={setSelectedLibraryIds} activeScope={globalNavTab} />
              </div>
            </div>
          </aside>

          <main className="z-10 flex min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-lg shadow-slate-200">
            <div className="shrink-0 border-b border-slate-200 bg-slate-50/50">
              <div className="flex h-12 items-center justify-between px-4">
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => {
                    setIsLeftSidebarCollapsed((current) => {
                      const next = !current;
                      if (!next || !isRightSidebarCollapsed) setIsWorkspaceMaximized(false);
                      return next;
                    });
                  }} className="rounded-md p-2 text-slate-500 hover:bg-slate-200">
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 9.75A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zM2 14.75A.75.75 0 012.75 14h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 14.75z" clipRule="evenodd" /></svg>
                  </button>
                  <div className="h-6 w-px bg-slate-200" />
                  {session && <ActiveMountsStatusBar launchMode={session.launchMode || launchMode} mounts={session.activeMounts || []} />}
                </div>

                <div className="flex flex-1 justify-center">
                  <button type="button" onClick={toggleZenMode} className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {isWorkspaceMaximized ? (
                      <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>Restore Layout</>
                    ) : (
                      <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7m-7 17v-6m0 0h6m-6 0l7 7M7 10V4m0 0H1m6 0L0 11" /></svg>Maximize Workspace</>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <svg className="h-4 w-4 text-amber-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" /></svg>
                    <span>Exfiltration Control: <strong>{session?.exfiltrationPolicy || 'Strict'}</strong></span>
                  </div>
                  <div className="h-6 w-px bg-slate-200" />
                  <button type="button" onClick={() => {
                    setIsRightSidebarCollapsed((current) => {
                      const next = !current;
                      if (!next || !isLeftSidebarCollapsed) setIsWorkspaceMaximized(false);
                      return next;
                    });
                  }} className="rounded-md p-2 text-slate-500 hover:bg-slate-200">
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3.75a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM10 8.75a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5a.75.75 0 01.75-.75zM8.25 4.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z" /></svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col">
                {error && <div className="m-4 rounded border border-red-300 bg-red-50 p-6 text-sm text-red-800">{error}</div>}
                {!error && (
                  <div id="jupyterlab-site" ref={mountPointRef} className="relative flex-1 w-full overflow-hidden bg-white" style={{ position: 'relative', width: '100%', height: '100%' }} />
                )}
              </div>
            </div>
          </main>

          <aside className={`shrink-0 overflow-hidden border-l border-slate-200 bg-white transition-all duration-300 ${isRightSidebarCollapsed ? 'w-0 border-l-0 opacity-0' : 'w-[340px] opacity-100'}`}>
            <div className="flex h-full flex-col w-[340px]">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Infrastructure</h2>
                <button type="button" onClick={() => {
                  setIsRightSidebarCollapsed(true);
                  if (!isLeftSidebarCollapsed) setIsWorkspaceMaximized(false);
                }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mt-4"><KernelLifecyclePanel /></div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<WorkspaceJEGPageProps> = async (context: GetServerSidePropsContext) => {
  const isStaticJupyterMode = isLocalJegDevelopmentModeEnabled() || process.env.JUPYTERLAB_LOCAL_DEV_MODE === 'true';
  if (isJegPreviewModeEnabled() || isLocalJegDevelopmentModeEnabled()) return { props: { ...(await getNavPageLayoutPropsFromConfig()), isStaticJupyterMode } };
  const login = await resolveWorkspaceIdentityFromCookie(context.req.headers.cookie || '');
  if (!login.ok) return { redirect: { destination: `/Login?referer=${encodeURIComponent('/Workspace/JEG')}`, permanent: false } };
  return { props: { ...(await getNavPageLayoutPropsFromConfig()), isStaticJupyterMode } };
};

export default WorkspaceJEGPage;