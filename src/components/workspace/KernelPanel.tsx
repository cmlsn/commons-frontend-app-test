import React from 'react';
import type { JegSession } from './types';

interface KernelPanelProps {
  onCollapse: () => void;
  session: JegSession | null;
}

const KernelPanel: React.FC<KernelPanelProps> = ({ onCollapse, session }) => {
  /* ── Derived ────────────────────────────────────────────────────────── */
  const mounts = session?.activeMounts || [];

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Infrastructure</h2>
        <button
          type="button"
          onClick={onCollapse}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Collapse panel"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {/* Active Mounts */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Storage Mounts
          </h3>
          {mounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
              No active storage mounts.
            </div>
          ) : (
            <ul className="space-y-2">
              {mounts.map((mount) => (
                <li
                  key={mount.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <svg
                      className="h-4 w-4 shrink-0 text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                      />
                    </svg>
                    <span className="truncate text-sm font-medium text-slate-700">
                      {mount.displayName}
                    </span>
                  </div>
                  <div
                    className="h-2 w-2 rounded-full bg-emerald-500"
                    title="Mounted"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Kernel Specs / Compute */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Compute Environment
          </h3>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">JEG Gateway</span>
              <span
                className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                  session?.baseUrl
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <div
                  className={`h-1.5 w-1.5 rounded-full ${
                    session?.baseUrl ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                />
                {session?.baseUrl ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            
            {session?.baseUrl && (
              <div className="mt-3 space-y-2 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Exfiltration Policy:</span>
                  <span className="font-medium capitalize text-slate-700">
                    {session.exfiltrationPolicy || 'Strict'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Workspace ID:</span>
                  <span className="font-mono text-slate-700 truncate max-w-[120px]" title={session.workspaceId}>
                    {session.workspaceId?.substring(0, 8)}...
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
export default KernelPanel;
