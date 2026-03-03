import React from 'react';

type LocalSandboxStatusProps = {
  onCopyToSecureWorkspace: () => Promise<void>;
  copying: boolean;
  message: string | null;
  messageTone?: 'info' | 'success' | 'error';
};

export default function LocalSandboxStatus({
  onCopyToSecureWorkspace,
  copying,
  message,
  messageTone = 'info',
}: LocalSandboxStatusProps) {
  const toneClass =
    messageTone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : messageTone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Local Sandbox Status</h3>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          You are using browser-only execution with public data. No remote secure kernel is attached in this mode.
        </p>
      </div>

      <div className="flex-1 space-y-3 p-4 text-xs text-slate-600">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="font-semibold text-slate-700">Execution Mode</p>
          <p className="mt-1">Local JupyterLite (in-browser, ephemeral session)</p>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="font-semibold text-slate-700">Data Access</p>
          <p className="mt-1">Public data only</p>
        </div>

        <button
          type="button"
          onClick={onCopyToSecureWorkspace}
          disabled={copying}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copying ? 'Copying…' : 'Copy to Secure Workspace'}
        </button>

        {message ? (
          <p className={`rounded-md border p-3 text-xs leading-5 ${toneClass}`}>
            {message}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
