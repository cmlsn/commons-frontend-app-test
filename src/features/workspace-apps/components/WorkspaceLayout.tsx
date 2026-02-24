import React, { ReactNode, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { NavPageLayout, NavPageLayoutProps } from '@gen3/frontend';
import { getAllApps } from '../config';

type Props = {
  children: ReactNode;
  headerProps?: NavPageLayoutProps['headerProps'];
  footerProps?: NavPageLayoutProps['footerProps'];
  title?: string;
};

const WorkspaceLayout = ({ children, headerProps, footerProps, title = 'Workspace' }: Props) => {
  const router = useRouter();
  const apps = getAllApps();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <NavPageLayout
      headerProps={headerProps}
      footerProps={footerProps}
      headerMetadata={{
        title: `Gen3 Workspace - ${title}`,
        content: 'Secure Gen3 Workspace Environment',
        key: 'workspace-layout',
      }}
    >
      <div className="flex h-[calc(100vh-var(--header-height,60px))] w-full overflow-hidden bg-slate-100">
        {/* Persistent Sidebar */}
        <aside
          className={`flex-shrink-0 border-r border-slate-200 bg-white transition-all duration-300 ${
            isSidebarCollapsed ? 'w-16' : 'w-64'
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 bg-slate-50">
            {!isSidebarCollapsed && (
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Tools & Apps
              </span>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="ml-auto p-1 rounded-md hover:bg-slate-200 text-slate-500"
              title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isSidebarCollapsed ? (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              )}
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {/* Dashboard / Home */}
            <Link
              href="/Workspace"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                router.pathname === '/Workspace'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              title="Workspace Home"
            >
              <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              {!isSidebarCollapsed && <span>Overview</span>}
            </Link>

            <div className="my-2 border-t border-slate-200" />

            {/* JEG (Jupyter) */}
            <Link
              href="/Workspace/JEG"
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                router.pathname === '/Workspace/JEG'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
              title="Jupyter Notebooks"
            >
              <svg className="h-5 w-5 flex-shrink-0 text-orange-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7.157 19.956c-1.635-.65-2.856-1.99-3.35-3.676-.19-.65-.22-1.02-.14-1.69.05-.42.13-.88.23-1.27.42-1.61 1.63-2.95 3.26-3.6 1.63-.65 3.47-.46 4.92.51l.66.45.66-.45c1.45-.97 3.29-1.16 4.92-.51 1.63.65 2.84 1.99 3.26 3.6.1.39.18.85.23 1.27.08.67.05 1.04-.14 1.69-.5 1.69-1.72 3.03-3.35 3.68-1.64.65-3.48.46-4.92-.51l-.66-.45-.66.45c-1.44.97-3.28 1.16-4.92.51zm11.2-1.76c1.06-.63 1.77-1.72 1.88-2.92.04-.42.02-1.05-.05-1.46-.22-1.28-1.16-2.31-2.41-2.65-.55-.15-1.6-.15-2.15 0-1.25.34-2.19 1.37-2.41 2.65-.07.41-.09 1.04-.05 1.46.11 1.2 1.82 2.29 1.88 2.92.34.34.78.51 1.23.51.45 0 .89-.17 1.23-.51zm-12.72 0c1.06-.63 1.77-1.72 1.88-2.92.04-.42.02-1.05-.05-1.46-.22-1.28-1.16-2.31-2.41-2.65-.55-.15-1.6-.15-2.15 0-1.25.34-2.19 1.37-2.41 2.65-.07.41-.09 1.04-.05 1.46.11 1.2 1.82 2.29 1.88 2.92.34.34.78.51 1.23.51.45 0 .89-.17 1.23-.51z"/>
              </svg>
              {!isSidebarCollapsed && <span>JupyterLab</span>}
            </Link>

            {/* Dynamic Apps */}
            {apps.map((app) => (
              <Link
                key={app.id}
                href={`/workspace/apps/${app.id}`}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  router.query.appId === app.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                title={app.displayName}
              >
                <svg className="h-5 w-5 flex-shrink-0 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
                {!isSidebarCollapsed && <span>{app.displayName}</span>}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white relative shadow-inner">
          {children}
        </main>
      </div>
    </NavPageLayout>
  );
};

export default WorkspaceLayout;
