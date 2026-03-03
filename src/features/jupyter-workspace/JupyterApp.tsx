import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import PersonalSandbox from './components/PersonalSandbox';
import LibraryPanel from '@/components/workspace/LibraryPanel';
import SharedLibrariesPanel from './components/SharedLibrariesPanel';

const SecureJupyter = dynamic(() => import('./components/SecureJupyter'), {
  ssr: false,
});

export type WorkspaceTab = 'personal' | 'team' | 'secure';

type TabConfig = {
  key: WorkspaceTab;
  label: string;
};

const TABS: TabConfig[] = [
  { key: 'personal', label: 'Personal (Free)' },
  { key: 'team', label: 'Team' },
  { key: 'secure', label: 'Secure Clean Room' },
];

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: TabConfig;
  active: boolean;
  onClick: (key: WorkspaceTab) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(tab.key)}
      className={[
        'rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-slate-900 text-white'
          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
      ].join(' ')}
      aria-current={active ? 'page' : undefined}
    >
      {tab.label}
    </button>
  );
}

function TeamEnvironment() {
  return (
    <section className="flex-1 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Team</h2>
      <p className="mt-2 text-sm text-slate-600">Team environment is active.</p>
    </section>
  );
}

export default function JupyterApp() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('personal');
  const [stashedNotebookId, setStashedNotebookId] = useState<string | null>(null);
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(true);
  const [sharedLibrariesPanelOpen, setSharedLibrariesPanelOpen] = useState(true);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [selectedSharedLibraryIds, setSelectedSharedLibraryIds] = useState<string[]>([]);

  const handleSwitchToSecure = (stashId?: string) => {
    if (stashId) {
      setStashedNotebookId(stashId);
    }
    setActiveTab('secure');
  };

  const activeContent = useMemo(() => {
    if (activeTab === 'team') {
      return <TeamEnvironment />;
    }

    if (activeTab === 'secure') {
      return <SecureJupyter stashedNotebookId={stashedNotebookId} />;
    }

    return <PersonalSandbox onSwitchToSecure={handleSwitchToSecure} />;
  }, [activeTab, stashedNotebookId]);

  return (
    <div className="w-full h-full min-h-screen flex flex-col bg-slate-100">
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__webpack_public_path__ = '/jupyter/build/';`,
          }}
        />
        <link
          id="jupyter-lite-main"
          rel="preload"
          href="/jupyter/build/lab/bundle.js"
          as="script"
        />
      </Head>

      <div className="w-full border-b border-slate-200 bg-white px-4 py-3">\n        <div className="flex items-center gap-2 overflow-x-auto">
          {TABS.map((tab) => (
            <TabButton key={tab.key} tab={tab} active={activeTab === tab.key} onClick={setActiveTab} />
          ))}
        </div>
      </div>

      <main className="flex min-h-0 flex-1 overflow-hidden p-4">
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          {sharedLibrariesPanelOpen && (
            <aside className="h-full w-[320px] shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Data & Tools</h2>
                  <button
                    type="button"
                    onClick={() => setSharedLibrariesPanelOpen(false)}
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Collapse shared libraries panel"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <SharedLibrariesPanel
                    enabled={true}
                    launchMode={activeTab === 'secure' ? 'pre-release' : 'personal'}
                    selectedLibraryIds={selectedSharedLibraryIds}
                    onSelectionChange={setSelectedSharedLibraryIds}
                    activeScope={activeTab === 'team' ? 'team' : 'personal'}
                  />
                </div>
              </div>
            </aside>
          )}
          {!sharedLibrariesPanelOpen && (
            <button
              type="button"
              onClick={() => setSharedLibrariesPanelOpen(true)}
              className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
              aria-label="Open Data & Tools panel"
            >
              <svg className="mx-auto h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          <div className="flex min-h-0 flex-1 flex-col">{activeContent}</div>

          {libraryPanelOpen && (
            <aside className="h-full w-[320px] shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <LibraryPanel
                onCollapse={() => setLibraryPanelOpen(false)}
                selectedLibraryIds={selectedLibraryIds}
                onSelectionChange={setSelectedLibraryIds}
              />
            </aside>
          )}
          {!libraryPanelOpen && (
            <button
              type="button"
              onClick={() => setLibraryPanelOpen(true)}
              className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900"
              aria-label="Open Apps & Libraries panel"
            >
              <svg className="mx-auto h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
              </svg>
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
