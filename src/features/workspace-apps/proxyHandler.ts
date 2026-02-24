import { NextApiRequest, NextApiResponse } from 'next';
import httpProxy from 'http-proxy';
import { getAppConfig } from './config';
import {
  resolveWorkspaceIdentityFromCookie,
  getRequireEncryptedTransport,
  assertSecureJegConfiguration
} from '@/features/jeg-workspace/lib/jegSecurity';

// Helper to safely serialize JSON for script injection
function safeStringify(obj: any): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  autoRewrite: true,
  protocolRewrite: 'http',
  ws: true, // Enable WebSocket support
  selfHandleResponse: true,
});

proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
  }
  res.end(JSON.stringify({ error: 'Upstream service unavailable' }));
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  const contentType = proxyRes.headers['content-type'] || '';

  // Security: Strip potentially dangerous headers
  delete proxyRes.headers['x-powered-by'];
  delete proxyRes.headers['server'];

  // Only intercept HTML responses for CSS/Context injection
  if (contentType.includes('text/html')) {
    let body = '';

    proxyRes.on('data', (chunk) => {
      body += chunk;
    });

    proxyRes.on('end', () => {
      const contextScript = `
        <script>
          window.WORKSPACE_CONTEXT = ${safeStringify({
            user: (req as any).user,
            workspaceId: (req as any).workspaceId
          })};
        </script>
      `;

      const cssLink = `<link rel="stylesheet" href="/theme-overrides.css">`;

      const cspMeta = `
        <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self';">
      `;

      const injection = `${cssLink}${cspMeta}${contextScript}`;
      const modifiedBody = body.replace('</head>', `${injection}</head>`);

      Object.keys(proxyRes.headers).forEach((key) => {
        if (key !== 'content-length') {
          res.setHeader(key, proxyRes.headers[key] as string | string[]);
        }
      });

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Content-Length', Buffer.byteLength(modifiedBody));

      res.write(modifiedBody);
      res.end();
    });
  } else {
    Object.keys(proxyRes.headers).forEach((key) => {
      res.setHeader(key, proxyRes.headers[key] as string | string[]);
    });
    proxyRes.pipe(res);
  }
});

export default async function proxyHandler(req: NextApiRequest, res: NextApiResponse) {
  const { appId } = req.query;

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

  // 3. Enforce Encrypted Transport
  if (getRequireEncryptedTransport()) {
    try {
      assertSecureJegConfiguration();
    } catch (e) {
       if (!appConfig.upstreamUrl.startsWith('https://')) {
         console.warn(`Security Warning: Upstream app ${appId} is using insecure HTTP transport.`);
       }
    }
  }

  // 4. Attach Identity Headers
  req.headers['x-workspace-user'] = identity.identity.userId;
  req.headers['x-workspace-id'] = identity.identity.workspaceId;

  // 5. Proxy the Request
  // Note: Next.js API routes don't natively support the 'upgrade' event for WebSockets
  // in the same way a raw Node server does. However, http-proxy handles the upgrade
  // if the underlying server supports it. For a robust production setup, ensure
  // your Next.js server (or the ingress controller in front of it) allows WebSocket upgrades.
  proxy.web(req, res, {
    target: appConfig.upstreamUrl,
    pathRewrite: {
      [`^/api/workspace/proxy/${appId}`]: '',
    },
  });
}
