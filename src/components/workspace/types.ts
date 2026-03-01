export type JegSession = {
  baseUrl: string;
  wsUrl?: string;
  token?: string;
  workspaceId: string;
  defaultPath?: string;
  exfiltrationPolicy?: 'strict' | 'balanced' | 'open';
  requireEncryptedTransport?: boolean;
  requireZmqTls?: boolean;
  hasExportContext?: boolean;
  exportSource?: 'cohort' | 'data-library' | 'mixed';
  exportCohortId?: string;
  launchMode?: 'personal' | 'pre-release';
  selectedLibraryIds?: string[];
  sharedLibraryEnabled?: boolean;
  activeMounts?: Array<{ id: string; displayName: string; s3Uri: string }>;
  previewMode?: boolean;
};

export type GlobalNavTab = 'personal' | 'team' | 'demos';

export type LibraryItem = {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
};

export type KernelSpec = {
  name: string;
  display_name: string;
  language: string;
};
