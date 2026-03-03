import React, { useState } from 'react';

type NotebookSetup = 'python' | 'llm' | 'data-analysis' | 'custom';

interface NotebookSetupPanelProps {
  onSetupComplete?: (setup: NotebookSetup) => void;
}

const SETUP_OPTIONS = [
  {
    id: 'python',
    label: 'Python Development',
    description: 'Standard Python environment with common libraries',
    icon: '🐍',
  },
  {
    id: 'llm',
    label: 'LLM & AI',
    description: 'Pre-configured for LLMs, transformers, and AI workloads',
    icon: '🤖',
  },
  {
    id: 'data-analysis',
    label: 'Data Analysis',
    description: 'Pandas, NumPy, Matplotlib, and visualization tools',
    icon: '📊',
  },
  {
    id: 'custom',
    label: 'Custom Setup',
    description: 'Start with a blank environment and add packages as needed',
    icon: '⚙️',
  },
];

export default function NotebookSetupPanel({ onSetupComplete }: NotebookSetupPanelProps) {
  const [selectedSetup, setSelectedSetup] = useState<NotebookSetup | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async (setup: NotebookSetup) => {
    setSelectedSetup(setup);
    setIsConfirming(true);
    
    // Simulate setup initialization
    await new Promise(r => setTimeout(r, 1500));
    
    onSetupComplete?.(setup);
  };

  if (isConfirming && selectedSetup) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-white p-6">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
        <p className="text-sm text-slate-600">Initializing {selectedSetup} environment...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="border-b border-slate-200 p-6">
        <h2 className="text-lg font-bold text-slate-900">Setup Notebook</h2>
        <p className="mt-2 text-sm text-slate-600">Choose a configuration for your secure notebook environment</p>
      </div>

      <div className="flex-1 space-y-3 p-6">
        {SETUP_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => handleConfirm(option.id as NotebookSetup)}
            className="block w-full rounded-lg border border-slate-200 bg-white p-4 text-left transition-all hover:border-blue-400 hover:bg-blue-50"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{option.icon}</span>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900">{option.label}</h3>
                <p className="text-xs text-slate-600">{option.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <p>💡 You can always add more packages and customize your environment later.</p>
      </div>
    </div>
  );
}
