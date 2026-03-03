import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * JupyterHub Server Spawner API
 * 
 * This endpoint handles spawning JupyterHub user servers (containers).
 * POST: Spawn a new server for the user
 * DELETE: Stop the user's server
 * GET: Check server status
 */

function getJupyterHubConfig() {
  const adminToken = process.env.JUPYTERHUB_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error('JUPYTERHUB_ADMIN_TOKEN environment variable is not set');
  }
  return {
    url: process.env.JUPYTERHUB_URL || 'http://localhost:8000',
    adminToken,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { username } = req.query;
  
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  const { url: jupyterHubUrl, adminToken } = getJupyterHubConfig();
  const hubApiUrl = `${jupyterHubUrl}/hub/api/users/${username}/server`;

  try {
    const upstreamRes = await fetch(hubApiUrl, {
      method: req.method,
      headers: {
        'Authorization': `token ${adminToken}`,
        'Content-Type': 'application/json',
      },
    });

    const responseText = await upstreamRes.text();
    let responseData;
    
    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseData = { message: responseText };
    }

    // Return the upstream response
    res.status(upstreamRes.status).json(responseData || { status: upstreamRes.status });
  } catch (error: any) {
    // Don't expose internal error details to client
    res.status(502).json({
      error: 'Failed to communicate with JupyterHub',
      message: 'Server operation failed',
    });
  }
}
