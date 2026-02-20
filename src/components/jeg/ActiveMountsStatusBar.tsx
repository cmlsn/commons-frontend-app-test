import React from 'react';

type ActiveMount = {
  id: string;
  displayName: string;
  s3Uri: string;
};

type Props = {
  launchMode: 'personal' | 'pre-release';
  mounts: ActiveMount[];
};

const ActiveMountsStatusBar = ({ launchMode, mounts }: Props) => {
  return (
    <div className="rounded-md border border-base-light bg-base-max p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-primary">Active Mounts</p>
          <p className="text-xs text-base-content">
            {launchMode === 'personal'
              ? 'Personal mode: no shared pre-release mounts attached.'
              : mounts.length > 0
                ? `${mounts.length} shared mount(s) attached for this JEG session.`
                : 'Pre-release mode selected, but no mounts are attached yet.'}
          </p>
        </div>
      </div>

      {launchMode === 'pre-release' && mounts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {mounts.map((mount) => (
            <span
              key={mount.id}
              className="rounded border border-base-light bg-base-lightest px-2 py-1 text-xs text-base-content"
              title={mount.s3Uri}
            >
              {mount.displayName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ActiveMountsStatusBar;
