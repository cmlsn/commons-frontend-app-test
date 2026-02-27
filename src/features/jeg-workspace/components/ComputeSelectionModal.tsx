import { useState } from 'react';

type ComputeTier = 'standard-2cpu' | 'large-8cpu' | 'gpu-1x';

type ComputeSelectionModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (tier: ComputeTier) => Promise<void>;
  isSaving?: boolean;
  error?: string | null;
};

const ComputeSelectionModal = ({
  open,
  onClose,
  onConfirm,
  isSaving = false,
  error = null,
}: ComputeSelectionModalProps) => {
  const [selectedTier, setSelectedTier] = useState<ComputeTier>('standard-2cpu');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compute tier selection required"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold text-slate-900">Compute tier selection required</h2>
        <p className="mt-2 text-sm text-slate-700">
          Select a compute tier to start a kernel.
        </p>

        <div className="mt-4 space-y-2">
          {([
            { value: 'standard-2cpu', label: 'Standard (2 CPU)' },
            { value: 'large-8cpu', label: 'Large (8 CPU)' },
            { value: 'gpu-1x', label: 'GPU (1x)' },
          ] as const).map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2"
            >
              <input
                type="radio"
                name="compute-tier"
                value={option.value}
                checked={selectedTier === option.value}
                onChange={() => setSelectedTier(option.value)}
                disabled={isSaving}
              />
              <span className="text-sm text-slate-800">{option.label}</span>
            </label>
          ))}
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selectedTier)}
            disabled={isSaving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save compute tier'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComputeSelectionModal;
