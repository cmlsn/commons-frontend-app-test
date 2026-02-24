import React from 'react';
import Link from 'next/link';
import { GetServerSideProps } from 'next';
import {
  NavPageLayoutProps,
  getNavPageLayoutPropsFromConfig,
} from '@gen3/frontend';
import { WorkspaceLayout } from '@/features/workspace-apps';
import { getAllApps } from '@/features/workspace-apps/config';

const WorkspaceHome = ({ headerProps, footerProps }: NavPageLayoutProps) => {
  const apps = getAllApps();

  return (
    <WorkspaceLayout
      headerProps={headerProps}
      footerProps={footerProps}
      title="Home"
    >
      <div className="h-full w-full overflow-y-auto bg-slate-50 p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">Welcome to Your Workspace</h1>
            <p className="mt-2 text-slate-600">
              Select a tool to begin your analysis. All environments are secure, compliant, and integrated with your cohort data.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Primary Tool: JupyterLab */}
            <Link href="/Workspace/JEG" className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:border-blue-400 hover:shadow-md">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 to-amber-500" />
              <div className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-orange-50 text-orange-600 group-hover:bg-orange-100">
                  <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M7.157 19.956c-1.635-.65-2.856-1.99-3.35-3.676-.19-.65-.22-1.02-.14-1.69.05-.42.13-.88.23-1.27.42-1.61 1.63-2.95 3.26-3.6 1.63-.65 3.47-.46 4.92.51l.66.45.66-.45c1.45-.97 3.29-1.16 4.92-.51 1.63.65 2.84 1.99 3.26 3.6.1.39.18.85.23 1.27.08.67.05 1.04-.14 1.69-.5 1.69-1.72 3.03-3.35 3.68-1.64.65-3.48.46-4.92-.51l-.66-.45-.66.45c-1.44.97-3.28 1.16-4.92.51zm11.2-1.76c1.06-.63 1.77-1.72 1.88-2.92.04-.42.02-1.05-.05-1.46-.22-1.28-1.16-2.31-2.41-2.65-.55-.15-1.6-.15-2.15 0-1.25.34-2.19 1.37-2.41 2.65-.07.41-.09 1.04-.05 1.46.11 1.2 1.82 2.29 1.88 2.92.34.34.78.51 1.23.51.45 0 .89-.17 1.23-.51zm-12.72 0c1.06-.63 1.77-1.72 1.88-2.92.04-.42.02-1.05-.05-1.46-.22-1.28-1.16-2.31-2.41-2.65-.55-.15-1.6-.15-2.15 0-1.25.34-2.19 1.37-2.41 2.65-.07.41-.09 1.04-.05 1.46.11 1.2 1.82 2.29 1.88 2.92.34.34.78.51 1.23.51.45 0 .89-.17 1.23-.51z"/>
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-900">JupyterLab</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Full-featured interactive development environment for Python and R. Ideal for bioinformatics workflows and custom analysis.
                </p>
              </div>
              <div className="mt-auto border-t border-slate-100 bg-slate-50 px-6 py-3">
                <span className="text-xs font-semibold text-orange-700 group-hover:text-orange-800">Launch Notebook &rarr;</span>
              </div>
            </Link>

            {/* Dynamic Apps */}
            {apps.map((app) => (
              <Link
                key={app.id}
                  href={`/Workspace/Apps/${app.id}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:border-blue-400 hover:shadow-md"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
                <div className="p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{app.displayName}</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    {app.id === 'superset'
                      ? 'Explore and visualize clinical data with interactive dashboards. No coding required.'
                      : app.id === 'igv'
                        ? 'High-performance visualization of genomic datasets.'
                        : 'Interactive analytics application.'}
                  </p>
                </div>
                <div className="mt-auto border-t border-slate-100 bg-slate-50 px-6 py-3">
                  <span className="text-xs font-semibold text-blue-700 group-hover:text-blue-800">Launch App &rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
};

export const getServerSideProps: GetServerSideProps<NavPageLayoutProps> =
  async () => {
    return {
      props: {
        ...(await getNavPageLayoutPropsFromConfig()),
      },
    };
  };

export default WorkspaceHome;
