import React from 'react';

type LaunchMode = 'personal' | 'pre-release';

type Props = {
  mode: LaunchMode;
  onModeChange: (mode: LaunchMode) => void;
  onApply: () => void;
  isApplying: boolean;
};

const LaunchModeSelector = ({
  mode,
  onModeChange,
  onApply,
  isApplying,
}: Props) => {
  return (
    <div className="rounded-md border border-base-light bg-base-max p-4">
      <h2 className="text-sm font-semibold text-primary">Compute Profile</h2>
      <p className="mt-1 text-xs text-base-content">
        Choose isolated personal compute or pre-release project mode with shared
        library mounts.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          onClick={() => onModeChange('personal')}
          className={`rounded border px-3 py-1 ${
            mode === 'personal'
              ? 'border-primary bg-base-lightest text-primary'
              : 'border-base-light text-base-content hover:bg-base-lightest'
          }`}
        >
          Personal
        </button>
        <button
          type="button"
          onClick={() => onModeChange('pre-release')}
          className={`rounded border px-3 py-1 ${
            mode === 'pre-release'
              ? 'border-primary bg-base-lightest text-primary'
              : 'border-base-light text-base-content hover:bg-base-lightest'
          }`}
        >
          Pre-Release Project
        </button>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={onApply}
          disabled={isApplying}
          className="rounded border border-base-light px-3 py-1 text-sm text-base-content hover:bg-base-lightest disabled:opacity-60"
        >
          {isApplying ? 'Applying...' : 'Apply Profile'}
        </button>
      </div>
    </div>
  );
};

export default LaunchModeSelector;
