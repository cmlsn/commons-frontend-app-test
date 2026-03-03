import React, { useEffect, useRef, useState } from 'react';
import { GetServerSideProps } from 'next';
import type { GetServerSidePropsContext } from 'next';
import {
  NavPageLayout,
  NavPageLayoutProps,
  getNavPageLayoutPropsFromConfig,
} from '@gen3/frontend';
import LibraryPanel from '@/components/workspace/LibraryPanel';

type WorkspaceJupyterFreePageProps = NavPageLayoutProps;

const WorkspaceJupyterFreePage = ({
  headerProps,
  footerProps,
}: WorkspaceJupyterFreePageProps) => {
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
  const [isWorkspaceMaximized, setIsWorkspaceMaximized] = useState(false);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  const mountPointRef = useRef<HTMLDivElement>(null);
  const hasBootedRef = useRef(false);

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
    const styleId = 'workspace-jeg-maximized-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = 'body.workspace-jeg-maximized footer { display: none !important; }';
      document.head.appendChild(styleEl);
    }

    if (isWorkspaceMaximized) {
      document.body.classList.add('workspace-jeg-maximized');
    } else {
      document.body.classList.remove('workspace-jeg-maximized');
    }

    return () => {
      document.body.classList.remove('workspace-jeg-maximized');
    };
  }, [isWorkspaceMaximized]);

  useEffect(() => {
    if (hasBootedRef.current) return;
    hasBootedRef.current = true;

    const mountPoint = mountPointRef.current;
    if (!mountPoint) return;

    let cancelled = false;

    const popupContainer = document.createElement('div');
    popupContainer.id = 'jupyter-popup-container-free';
    popupContainer.setAttribute(
      'style',
      'position: fixed; top: 0; left: 0; z-index: 10000; pointer-events: none;',
    );
    document.body.appendChild(popupContainer);

    const shellContainStyle = document.createElement('style');
    const shellContainStyleId = 'jupyter-shell-contain-free';
    shellContainStyle.id = shellContainStyleId;
    shellContainStyle.textContent = `
      #jupyter-popup-container-free > .lm-Widget { pointer-events: auto; position: absolute !important; }
      body > .lm-Widget.lm-Menu, body > .lm-Widget.lm-ContextMenu { position: fixed !important; z-index: 100000 !important; }
      .jp-CommandPalette { position: fixed !important; top: 50% !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 100000 !important; max-height: 80vh !important; margin: 0 !important; }
      #jupyterlab-site-free { position: relative !important; contain: strict !important; z-index: 0 !important; height: 100% !important; width: 100% !important; overflow: hidden !important; }
      #jupyterlab-site-free > .jp-LabShell, #jupyterlab-site-free > .jp-ApplicationShell, #jupyterlab-site-free > .lm-Widget { position: absolute !important; inset: 0 !important; height: 100% !important; width: 100% !important; }
    `;
    document.head.appendChild(shellContainStyle);

    const origBodyInsertBefore = document.body.insertBefore.bind(document.body);
    const origBodyAppendChild = document.body.appendChild.bind(document.body);
    const origBodyRemoveChild = document.body.removeChild.bind(document.body);

    const isJupyterShell =
      (node: Node) =>
        node instanceof Element &&
        (node.id === 'jupyterlab-splash' || node.classList.contains('jp-LabShell'));
    const isJupyterPopup =
      (node: Node) =>
        node instanceof Element &&
        (node.classList.contains('lm-Menu') ||
          node.classList.contains('lm-ContextMenu') ||
          node.classList.contains('jp-Dialog') ||
          node.classList.contains('jp-HoverBox') ||
          node.classList.contains('jp-CommandPalette'));

    (document.body as any).insertBefore = function <T extends Node>(node: T, ref: Node | null): T {
      if (isJupyterShell(node)) return mountPoint.insertBefore(node, null) as unknown as T;
      if (isJupyterPopup(node) && popupContainer) {
        return popupContainer.insertBefore(node, null) as unknown as T;
      }
      return origBodyInsertBefore(node, ref);
    };

    (document.body as any).appendChild = function <T extends Node>(node: T): T {
      if (isJupyterShell(node)) return mountPoint.appendChild(node) as unknown as T;
      if (isJupyterPopup(node) && popupContainer) {
        return popupContainer.appendChild(node) as unknown as T;
      }
      return origBodyAppendChild(node);
    };

    (document.body as any).removeChild = function <T extends Node>(node: T): T {
      if (isJupyterShell(node) && node.parentNode === mountPoint) {
        return mountPoint.removeChild(node) as unknown as T;
      }
      if (isJupyterPopup(node) && popupContainer && node.parentNode === popupContainer) {
        return popupContainer.removeChild(node) as unknown as T;
      }
      return origBodyRemoveChild(node);
    };

    const bootstrapFreeJupyter = async () => {
      try {
        const settingsResponse = await fetch('/jupyter/jupyter-lite.json', { credentials: 'same-origin' });
        const settingsBody = await settingsResponse.json();
        const configData = settingsBody?.['jupyter-config-data'] || {};

        const jupyterConfigScriptId = 'jupyter-config-data';
        let configScript = document.getElementById(jupyterConfigScriptId) as HTMLScriptElement | null;
        if (!configScript) {
          configScript = document.createElement('script');
          configScript.id = jupyterConfigScriptId;
          configScript.type = 'application/json';
          document.head.appendChild(configScript);
        }

        configScript.text = JSON.stringify({
          ...configData,
          baseUrl: '/jupyter/',
          staticUrl: '/jupyter/',
        });

        (window as any).__webpack_public_path__ = '/jupyter/build/';

        const bundleScriptId = 'free-jupyterlite-bundle';
        let bundleScript = document.getElementById(bundleScriptId) as HTMLScriptElement | null;
        if (!bundleScript) {
          bundleScript = document.createElement('script');
          bundleScript.id = bundleScriptId;
          bundleScript.src = '/jupyter/build/lab/bundle.js';
          bundleScript.setAttribute('main', 'index');
          bundleScript.crossOrigin = 'anonymous';
          document.head.appendChild(bundleScript);
        }
      } catch (error: any) {
        if (!cancelled) {
          setBootError(error?.message || 'Unable to initialize Free JupyterLite runtime.');
        }
      }
    };

    void bootstrapFreeJupyter();

    return () => {
      cancelled = true;
      (document.body as any).insertBefore = origBodyInsertBefore;
      (document.body as any).appendChild = origBodyAppendChild;
      (document.body as any).removeChild = origBodyRemoveChild;
      if (popupContainer.parentNode) popupContainer.parentNode.removeChild(popupContainer);
      const styleEl = document.getElementById(shellContainStyleId);
      if (styleEl?.parentNode) styleEl.parentNode.removeChild(styleEl);
    };
  }, []);


  return (
    <NavPageLayout
      headerProps={headerProps}
      footerProps={footerProps}
      mainProps={{ fixed: true }}
      headerMetadata={{
        title: 'Workspace JupyterLite',
        content: 'Free JupyterLite Workspace',
        key: 'workspace-jupyter-free-page',
      }}
    >
      <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100">
        <header
          className={`flex shrink-0 items-center justify-between border-b border-slate-200 bg-white shadow-sm ${
            isWorkspaceMaximized ? 'h-[44px] px-4' : 'h-[60px] px-6'
          }`}
        >
          <div className={`flex items-center ${isWorkspaceMaximized ? 'gap-2' : 'gap-3'}`}>
            <div
              className={`flex items-center justify-center rounded-lg bg-blue-600 text-white ${
                isWorkspaceMaximized ? 'h-6 w-6' : 'h-8 w-8'
              }`}
            >
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className={`font-bold text-slate-800 ${isWorkspaceMaximized ? 'text-base' : 'text-lg'}`}>
              Gen3 Workspace
            </h1>
          </div>

          <button
            type="button"
            onClick={toggleZenMode}
            className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {isWorkspaceMaximized ? 'Restore Layout' : 'Maximize Workspace'}
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside
            className={`shrink-0 overflow-hidden border-r border-slate-200 bg-white transition-all duration-300 ${
              isLeftSidebarCollapsed ? 'w-0 border-r-0 opacity-0' : 'w-[320px] opacity-100'
            }`}
          >
            <div className="flex h-full flex-col w-[320px]">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Data & Tools</h2>
                <button
                  type="button"
                  onClick={() => {
                    setIsLeftSidebarCollapsed(true);
                    if (!isRightSidebarCollapsed) setIsWorkspaceMaximized(false);
                  }}
                  className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 text-sm text-slate-600">
                Local JupyterLite runtime is active in Free mode.
              </div>
            </div>
          </aside>

          <main className="z-10 flex min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-lg shadow-slate-200">
            <div className="shrink-0 border-b border-slate-200 bg-slate-50/50">
              <div className="flex h-12 items-center justify-between px-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsLeftSidebarCollapsed((current) => {
                      const next = !current;
                      if (!next || !isRightSidebarCollapsed) setIsWorkspaceMaximized(false);
                      return next;
                    });
                  }}
                  className="rounded-md p-2 text-slate-500 hover:bg-slate-200"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 9.75A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zM2 14.75A.75.75 0 012.75 14h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 14.75z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                <div className="text-xs font-semibold text-slate-600">Free Tier · JupyterLite</div>
                <button
                  type="button"
                  onClick={() => {
                    setIsRightSidebarCollapsed((current) => {
                      const next = !current;
                      if (!next || !isLeftSidebarCollapsed) setIsWorkspaceMaximized(false);
                      return next;
                    });
                  }}
                  className="rounded-md p-2 text-slate-500 hover:bg-slate-200"
                >
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 3.75a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zM10 8.75a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5a.75.75 0 01.75-.75zM8.25 4.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 min-h-0 w-full overflow-hidden flex flex-col">
                {bootError ? (
                  <div className="m-4 rounded border border-red-300 bg-red-50 p-6 text-sm text-red-800">
                    {bootError}
                  </div>
                ) : null}
                <div
                  id="jupyterlab-site-free"
                  ref={mountPointRef}
                  className="relative flex-1 w-full overflow-hidden bg-white"
                  style={{ position: 'relative', width: '100%', height: '100%' }}
                />
              </div>
            </div>
          </main>

          <aside
            className={`shrink-0 overflow-hidden border-l border-slate-200 bg-white transition-all duration-300 ${
              isRightSidebarCollapsed ? 'w-0 border-l-0 opacity-0' : 'w-[340px] opacity-100'
            }`}
          >
            <div className="h-full w-[340px]">
              <LibraryPanel
                onCollapse={() => {
                  setIsRightSidebarCollapsed(true);
                  if (!isLeftSidebarCollapsed) setIsWorkspaceMaximized(false);
                }}
                selectedLibraryIds={selectedLibraryIds}
                onSelectionChange={setSelectedLibraryIds}
              />
            </div>
          </aside>
        </div>
      </section>
    </NavPageLayout>
  );
};

export const getServerSideProps: GetServerSideProps<WorkspaceJupyterFreePageProps> = async (
  _context: GetServerSidePropsContext,
) => {
  return {
    props: {
      ...(await getNavPageLayoutPropsFromConfig()),
    },
  };
};

export default WorkspaceJupyterFreePage;
