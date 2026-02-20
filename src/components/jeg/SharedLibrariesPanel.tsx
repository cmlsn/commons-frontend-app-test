import React, { useEffect, useMemo, useState } from 'react';

type SharedLibraryRecord = {
  id: string;
  displayName: string;
  projectType: 'personal' | 'pre-release';
  s3Uri: string;
  ownerUserId: string;
  sharedWithUsers: string[];
  description?: string;
};

type UserLibraryItem = {
  id: string;
  title: string;
  objectUri: string;
  sourceType: 'manual-publish' | 'autosave-stale-kill' | 'autosave-user-kill';
  createdAt: string;
};

type Props = {
  enabled: boolean;
  launchMode: 'personal' | 'pre-release';
  selectedLibraryIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  activeScope?: 'personal' | 'team' | 'demos';
};

const SharedLibrariesPanel = ({
  enabled,
  launchMode,
  selectedLibraryIds,
  onSelectionChange,
  activeScope: activeScopeProp,
}: Props) => {
  const [libraries, setLibraries] = useState<SharedLibraryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareInputById, setShareInputById] = useState<Record<string, string>>({});
  const [shareBusyById, setShareBusyById] = useState<Record<string, boolean>>({});
  const [myLibraryItems, setMyLibraryItems] = useState<UserLibraryItem[]>([]);
  const [publishingToMyLibrary, setPublishingToMyLibrary] = useState(false);
  const [activeScope, setActiveScope] = useState<'personal' | 'team' | 'demos'>(
    'personal',
  );
  const [activeSubTab, setActiveSubTab] = useState<'lib' | 'ai'>('lib');

  useEffect(() => {
    if (!activeScopeProp) return;
    setActiveScope(activeScopeProp);
  }, [activeScopeProp]);

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    const loadLibraries = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/workspace/jeg/libraries', {
          method: 'GET',
          credentials: 'include',
        });
        const body = await response.json().catch(() => ({}));

        if (!mounted) return;

        if (!response.ok) {
          setError(body?.error || 'Unable to load shared libraries.');
          setLibraries([]);
          return;
        }

        setLibraries(Array.isArray(body?.libraries) ? body.libraries : []);

        const myLibraryResponse = await fetch('/api/workspace/jeg/library/my', {
          method: 'GET',
          credentials: 'include',
        });
        const myLibraryBody = await myLibraryResponse.json().catch(() => ({}));
        setMyLibraryItems(
          Array.isArray(myLibraryBody?.items) ? myLibraryBody.items : [],
        );
      } catch {
        if (!mounted) return;
        setError('Unable to load shared libraries.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadLibraries();
    return () => {
      mounted = false;
    };
  }, [enabled]);

  const selectedSet = useMemo(
    () => new Set(selectedLibraryIds),
    [selectedLibraryIds],
  );

  const teamLibraries = useMemo(
    () => libraries.filter((library) => library.projectType === 'pre-release'),
    [libraries],
  );

  const personalLibraries = useMemo(
    () => libraries.filter((library) => library.projectType === 'personal'),
    [libraries],
  );

  const toggleSelect = (libraryId: string) => {
    if (launchMode !== 'pre-release') return;
    if (selectedSet.has(libraryId)) {
      onSelectionChange(selectedLibraryIds.filter((item) => item !== libraryId));
      return;
    }
    onSelectionChange([...selectedLibraryIds, libraryId]);
  };

  const handleShare = async (libraryId: string) => {
    const rawUsers = shareInputById[libraryId] || '';
    const sharedWithUsers = rawUsers
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    setShareBusyById((current) => ({ ...current, [libraryId]: true }));
    try {
      await fetch('/api/workspace/jeg/libraries/share', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          libraryId,
          sharedWithUsers,
        }),
      });
    } finally {
      setShareBusyById((current) => ({ ...current, [libraryId]: false }));
    }
  };

  const publishToMyLibrary = async () => {
    setPublishingToMyLibrary(true);
    try {
      await fetch('/api/workspace/jeg/library/my', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: `Manual Publish ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
          objectUri: `jeg://manual-publish/${Date.now()}`,
          sourceType: 'manual-publish',
          metadata: {
            source: 'jupyter-ui-manual-publish',
          },
        }),
      });

      const refresh = await fetch('/api/workspace/jeg/library/my', {
        method: 'GET',
        credentials: 'include',
      });
      const body = await refresh.json().catch(() => ({}));
      setMyLibraryItems(Array.isArray(body?.items) ? body.items : []);
    } finally {
      setPublishingToMyLibrary(false);
    }
  };

  if (!enabled) {
    return null;
  }

  const visibleLibraries =
    activeScope === 'team' ? teamLibraries : activeScope === 'demos' ? [] : personalLibraries;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b border-slate-200 p-4">
        <div className="relative">
          <label htmlFor="library-filter-input" className="sr-only">
            Search shared libraries
          </label>
          <svg
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="library-filter-input"
            type="text"
            placeholder={activeScope === 'team' ? 'Search shared libraries...' : 'Filter assets...'}
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-700 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          />
        </div>

        {!activeScopeProp && (
          <div className="mt-3 flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
          {(['personal', 'team', 'demos'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setActiveScope(scope)}
              aria-pressed={activeScope === scope}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                activeScope === scope
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200 hover:text-slate-800'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2`}
            >
              {scope}
            </button>
          ))}
          </div>
        )}

        {activeScope === 'personal' && (
          <div className="mt-3 flex items-center gap-4 border-b border-slate-200 pb-1">
            <button
              type="button"
              onClick={() => setActiveSubTab('lib')}
              aria-pressed={activeSubTab === 'lib'}
              className={`border-b-2 pb-1 text-[11px] font-bold uppercase tracking-wide ${
                activeSubTab === 'lib'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2`}
            >
              Library
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('ai')}
              aria-pressed={activeSubTab === 'ai'}
              className={`border-b-2 pb-1 text-[11px] font-bold uppercase tracking-wide ${
                activeSubTab === 'ai'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2`}
            >
              AI & Vectors
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && <p className="text-xs text-slate-600">Loading libraries...</p>}
        {error && <p className="text-xs text-red-700">{error}</p>}

        {!loading && !error && activeScope === 'personal' && activeSubTab === 'ai' && (
          <div className="space-y-2">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Vector Stores
            </p>
            <div className="rounded-lg border border-violet-200 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">LUAD_Embeddings</p>
                    <span className="rounded border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                      Ready
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-600">chromadb://ai-mesh</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && (activeScope !== 'personal' || activeSubTab === 'lib') && (
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {activeScope === 'team'
                ? 'Organizational Access'
                : activeScope === 'demos'
                  ? 'Preconfigured Workflows'
                  : 'Mounted Cohorts'}
            </p>

            {activeScope === 'demos' && (
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-blue-700">
                    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v11.5a.5.5 0 0 1-.777.416L7 13.101l-4.223 2.815A.5.5 0 0 1 2 15.5V4z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">Survival_Demo.ipynb</p>
                    <p className="truncate text-xs text-slate-600">Multi-modal architecture</p>
                  </div>
                </div>
              </div>
            )}

            {activeScope !== 'demos' && visibleLibraries.length === 0 && (
              <p className="text-xs text-slate-600">
                No shared libraries available for your current identity.
              </p>
            )}

            {activeScope !== 'demos' &&
              visibleLibraries.map((library) => (
                <div key={library.id} className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                  <div className="flex items-start gap-3 p-4">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                        activeSubTab === 'ai'
                          ? 'border border-violet-200 bg-violet-50 text-violet-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zM9.5 5V1.5L13 5H9.5z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-extrabold text-slate-900">
                          {library.displayName}
                        </p>
                        <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600">
                          1.4 TB
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        Owner: {library.ownerUserId}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <p className="truncate text-xs text-slate-600">{library.s3Uri}</p>
                        <span className="rounded border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-[10px] text-violet-700">
                          chromadb://
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5">
                    <span className="text-[11px] font-medium text-slate-500">
                      {selectedSet.has(library.id) ? 'Mounted to Session' : 'Read-Only Access'}
                    </span>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(library.id)}
                        onChange={() => toggleSelect(library.id)}
                        disabled={launchMode !== 'pre-release'}
                        aria-label={`Attach ${library.displayName}`}
                        className="peer sr-only"
                      />
                      <span className="relative h-[18px] w-8 rounded-full bg-slate-300 transition peer-checked:bg-emerald-600 peer-disabled:opacity-60">
                        <span className="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-3.5" />
                      </span>
                      <span className="text-[11px] font-semibold text-slate-700">
                        {selectedSet.has(library.id) ? 'Attached' : 'Attach'}
                      </span>
                    </label>
                  </div>

                  {activeScope === 'team' && (
                    <div className="border-t border-slate-200 bg-white p-4">
                      <label className="mb-2 block text-[11px] font-extrabold uppercase tracking-wide text-slate-800">
                        Access Control
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={shareInputById[library.id] || ''}
                          onChange={(event) =>
                            setShareInputById((current) => ({
                              ...current,
                              [library.id]: event.target.value,
                            }))
                          }
                          placeholder="user1, user2@email.com"
                          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                        />
                        <button
                          type="button"
                          onClick={() => handleShare(library.id)}
                          disabled={Boolean(shareBusyById[library.id])}
                          className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-60"
                        >
                          {shareBusyById[library.id] ? 'Saving...' : 'Update Sharing'}
                        </button>
                      </div>

                      {Array.isArray(library.sharedWithUsers) && library.sharedWithUsers.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {library.sharedWithUsers.map((user) => (
                            <span
                              key={`${library.id}-${user}`}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-700"
                            >
                              {user}
                              <span className="text-slate-500">×</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

            <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">My Published Library</p>
                  <p className="text-xs text-slate-600">
                    Personal snapshots and published workspace state.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={publishToMyLibrary}
                  disabled={publishingToMyLibrary}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {publishingToMyLibrary ? 'Publishing...' : 'Publish'}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {myLibraryItems.length === 0 && (
                  <p className="text-xs text-slate-600">No published items yet.</p>
                )}
                {myLibraryItems.map((item) => (
                  <div key={item.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-2">
                    <p className="truncate text-xs font-semibold text-slate-900">{item.title}</p>
                    <p className="truncate text-xs text-slate-600">{item.objectUri}</p>
                    <p className="text-[11px] text-slate-500">
                      {item.sourceType} • {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(SharedLibrariesPanel);
