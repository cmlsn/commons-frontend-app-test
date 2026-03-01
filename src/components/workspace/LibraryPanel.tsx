import React from 'react';

interface LibraryPanelProps {
  onCollapse: () => void;
  selectedLibraryIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

const LibraryPanel: React.FC<LibraryPanelProps> = ({
  onCollapse,
  selectedLibraryIds,
  onSelectionChange,
}) => {
  // Placeholder libraries - should likely come from API or config
  const libraries = [
    { id: 'lib1', name: 'Standard Data Science', description: 'Python, Pandas, NumPy' },
    { id: 'lib2', name: 'Genomics Analysis', description: 'Bioconductor, specialized R packages' },
    { id: 'lib3', name: 'Machine Learning', description: 'TensorFlow, PyTorch, Scikit-learn' },
  ];

  /* ── Handlers ──────────────────────────────────────────────────────── */
  const toggleSelection = (id: string) => {
    if (selectedLibraryIds.includes(id)) {
      onSelectionChange(selectedLibraryIds.filter((libId) => libId !== id));
    } else {
      onSelectionChange([...selectedLibraryIds, id]);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Apps & Libraries</h2>
        <button
          type="button"
          onClick={onCollapse}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Collapse panel"
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <p className="mb-4 text-xs text-slate-500">
          Select libraries to load into your environment.
        </p>
        <ul className="space-y-3">
          {libraries.map((lib) => (
            <li key={lib.id}>
              <button
                type="button"
                onClick={() => toggleSelection(lib.id)}
                aria-pressed={selectedLibraryIds.includes(lib.id)}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  selectedLibraryIds.includes(lib.id)
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    selectedLibraryIds.includes(lib.id)
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {selectedLibraryIds.includes(lib.id) && (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="font-medium text-slate-900">{lib.name}</div>
                  <div className="text-xs text-slate-500">{lib.description}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default LibraryPanel;
