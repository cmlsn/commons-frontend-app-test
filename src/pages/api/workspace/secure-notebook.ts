import { NextApiRequest, NextApiResponse } from 'next';

const BLANK_NOTEBOOK = {
  cells: [],
  metadata: {
    kernelspec: {
      display_name: 'Python 3',
      language: 'python',
      name: 'python3',
    },
    language_info: {
      codemirror_mode: {
        name: 'ipython',
        version: 3,
      },
      file_extension: '.py',
      mimetype: 'text/x-python',
      name: 'python',
      nbconvert_exporter: 'python',
      pygments_lexer: 'ipython3',
      version: '3.9.0',
    },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Forward to Jupyter through the JEG proxy endpoint
    // The proxy is already set up at /api/workspace/jeg/proxy/
    const notebookPath = encodeURIComponent('secure-notebook.ipynb');

    const response = await fetch(`http://localhost:3000/api/workspace/jeg/proxy/api/contents/${notebookPath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': req.headers.cookie || '',
      },
      body: JSON.stringify({
        type: 'notebook',
        format: 'json',
        content: BLANK_NOTEBOOK,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[secure-notebook API] Jupyter PUT failed:', response.status, error);
      return res.status(response.status).json({ error: `Failed to create notebook: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('[secure-notebook API] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
