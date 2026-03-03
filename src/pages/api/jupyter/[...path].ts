import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Proxy endpoint that forwards Jupyter API requests to the JEG proxy.
 * This allows Datalayer components to work with their expected `/jupyter/api/*` URLs
 * while using our JEG proxy backend.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path } = req.query;
  const pathStr = Array.isArray(path) ? path.join('/') : path || '';
  
  // Build the full target URL with query parameters
  const queryString = new URL(`http://localhost:3000?${new URLSearchParams(req.query as Record<string, string>).toString()}`).search;
  const targetUrl = `/api/workspace/jeg/proxy/api/${pathStr}${queryString}`;

  try {
    console.log(`[Jupyter API Proxy] ${req.method} ${targetUrl}`);
    
    // Forward the request to the JEG proxy
    const response = await fetch(`http://localhost:3000${targetUrl}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        // Don't forward the original headers that might conflict
      },
      credentials: 'include',
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).send(text);
    }
  } catch (error: any) {
    console.error('[Jupyter API Proxy] Error:', error);
    res.status(500).json({ error: 'Proxy error: ' + error.message });
  }
}
