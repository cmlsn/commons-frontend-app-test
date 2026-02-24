import { NextApiRequest, NextApiResponse } from 'next';
import httpProxy from 'http-proxy';
import { getAppConfig } from '@/lib/workspace/workspaceApps.config';
import { resolveWorkspaceIdentityFromCookie } from '@/features/jeg-workspace/lib/jegSecurity';

// Disable Next.js body parsing to allow streaming proxy
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  autoRewrite: true,
  protocolRewrite: 'http',
});

// Error handling for the proxy
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
  }
  res.end(JSON.stringify({ error: 'Upstream service unavailable' }));
});

// HTML Injection Logic
proxy.on('proxyRes', (proxyRes, req, res) => {
  const contentType = proxyRes.headers['content-type'] || '';

  // Only intercept HTML responses for CSS injection
  if (contentType.includes('text/html')) {
    const _write = res.write;
    const _end = res.end;
    const _writeHead = res.writeHead;

    let body = '';
    let isIntercepted = false;

    // Buffer the response body
    proxyRes.on('data', (chunk) => {
      body += chunk;
    });

    proxyRes.on('end', () => {
      if (!isIntercepted) {
        // Inject CSS and CSP
        const injection = `
          <link rel="stylesheet" href="/theme-overrides.css">
          <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self';">
          <script>window.WORKSPACE_CONTEXT = ${JSON.stringify({
            user: (req as any).user,
            workspaceId: (req as any).workspaceId
          })};</script>
        `;

        // Simple injection before </head>
        const modifiedBody = body.replace('</head>', `${injection}</head>`);

        // Update content-length header
        res.setHeader('Content-Length', Buffer.byteLength(modifiedBody));

        // Write the modified body
        _write.call(res, modifiedBody);
        _end.call(res);
      }
    });

    // Prevent original response from being sent directly
    isIntercepted = true;
  }
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { appId, path } = req.query;

  // 1. Validate Session (Zero Trust)
  const identity = await resolveWorkspaceIdentityFromCookie(req.headers.cookie || '');
  if (!identity.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Validate App Configuration
  const appConfig = getAppConfig(appId as string);
  if (!appConfig) {
    return res.status(404).json({ error: 'App not found' });
  }

  // 3. Construct Upstream URL
  // The path array handles sub-paths (e.g., /api/v1/dashboard/1)
  const subPath = Array.isArray(path) ? path.join('/') : '';
  const target = `${appConfig.upstreamUrl}/${subPath}`;

  // 4. Attach Identity Headers for Upstream App
  req.headers['x-workspace-user'] = identity.identity.userId;
  req.headers['x-workspace-id'] = identity.identity.workspaceId;

  // 5. Proxy the Request
  proxy.web(req, res, {
    target: appConfig.upstreamUrl,
    // Rewrite the path to remove the Next.js API prefix
    pathRewrite: {
      [`^/api/workspace/apps/${appId}`]: '',
    },
  });
}
