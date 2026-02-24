import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { WorkspaceLayout, SecureAppCanvas, getAppConfig } from '@/features/workspace-apps';

const WorkspaceAppPage = () => {
  const router = useRouter();
  const { appId } = router.query;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const appConfig = getAppConfig(appId as string);

  useEffect(() => {
    if (router.isReady) {
      if (!appConfig) {
        setError('App not found.');
      }
      setLoading(false);
    }
  }, [router.isReady, appConfig]);

  if (loading) {
    return (
      <WorkspaceLayout title="Loading...">
        <div className="flex h-full items-center justify-center bg-slate-50">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600 mx-auto mb-4"></div>
            <p className="text-sm font-medium text-slate-600">Initializing secure environment...</p>
          </div>
        </div>
      </WorkspaceLayout>
    );
  }

  if (error || !appConfig) {
    return (
      <WorkspaceLayout title="Error">
        <div className="flex h-full items-center justify-center bg-slate-50">
          <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-slate-900">Application Error</h3>
            <p className="mt-2 text-sm text-slate-600">{error || 'The requested application could not be found.'}</p>
            <button
              onClick={() => router.push('/Workspace')}
              className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Return to Workspace
            </button>
          </div>
        </div>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout title={appConfig.displayName}>
      <SecureAppCanvas appId={appConfig.id} defaultPath={appConfig.defaultPath} />
    </WorkspaceLayout>
  );
};

export default WorkspaceAppPage;
