import type { NextApiRequest, NextApiResponse } from 'next';

type StashPayload = {
  source?: string;
  notebookPath?: string;
  notebookJson?: unknown;
  createdAt?: string;
};

type StashRecord = {
  id: string;
  source: string;
  notebookPath: string;
  notebookJson: unknown;
  createdAt: string;
};

type StashStore = Record<string, StashRecord>;

declare global {
  // eslint-disable-next-line no-var
  var __workspaceNotebookStash: StashStore | undefined;
}

function getStashStore(): StashStore {
  if (!global.__workspaceNotebookStash) {
    global.__workspaceNotebookStash = {};
  }
  return global.__workspaceNotebookStash;
}

function buildStashId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `stash-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const store = getStashStore();

  if (req.method === 'POST') {
    const payload = (req.body || {}) as StashPayload;
    if (!payload.notebookJson) {
      return res.status(400).json({ error: 'notebookJson is required' });
    }

    const stashId = buildStashId();
    const record: StashRecord = {
      id: stashId,
      source: payload.source || 'unknown',
      notebookPath: payload.notebookPath || `stashed-${Date.now()}.ipynb`,
      notebookJson: payload.notebookJson,
      createdAt: payload.createdAt || new Date().toISOString(),
    };

    store[stashId] = record;

    return res.status(200).json({
      stashId,
      notebookPath: record.notebookPath,
      message: 'Notebook stashed successfully',
    });
  }

  if (req.method === 'GET') {
    const stashId = String(req.query.id || '').trim();
    if (!stashId) {
      return res.status(400).json({ error: 'id query parameter is required' });
    }

    const record = store[stashId];
    if (!record) {
      return res.status(404).json({ error: 'Stash not found' });
    }

    return res.status(200).json({
      stashId: record.id,
      source: record.source,
      notebookPath: record.notebookPath,
      notebookJson: record.notebookJson,
      createdAt: record.createdAt,
    });
  }

  if (req.method === 'DELETE') {
    const stashId = String(req.query.id || '').trim();
    if (!stashId) {
      return res.status(400).json({ error: 'id query parameter is required' });
    }

    if (!store[stashId]) {
      return res.status(404).json({ error: 'Stash not found' });
    }

    delete store[stashId];
    return res.status(200).json({ deleted: true, stashId });
  }

  res.setHeader('Allow', 'POST, GET, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
