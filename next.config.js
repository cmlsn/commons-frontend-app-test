'use strict';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./src/lib/plugins/index.js');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withMDX = require('@next/mdx')({
  extension: /\.(md|mdx)$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

// Next configuration with support for rewrting API to existing common services
const nextConfig = {
  output: 'standalone',
  serverRuntimeConfig: {
    HOSTNAME: '0.0.0.0',
  },
  env: {
    version: process.env.npm_package_version,
  },
  reactStrictMode: true,
  pageExtensions: ['mdx', 'md', 'jsx', 'js', 'tsx', 'ts'],
  basePath: process.env.BASE_PATH || '',
  transpilePackages: ['@gen3/core', '@gen3/frontend'],
  webpack: (config) => {
    config.infrastructureLogging = {
      level: 'error',
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)?', // Matches all pages
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
    ];
  },
  
  // ADDED: Crucial rewrites to prevent Jupyter 404 crashes
  async rewrites() {
    return [
      // 1. Catch rogue Jupyter root asset requests
      { source: '/jupyter-lite.json', destination: '/jupyter/jupyter-lite.json' },
      { source: '/jupyter-lite.ipynb', destination: '/jupyter/jupyter-lite.ipynb' },
      { source: '/index.html', destination: '/jupyter/index.html' },
      { source: '/config-utils.js', destination: '/jupyter/config-utils.js' },
      
      // 2. Catch relative requests leaking from the /Workspace/ path
      { source: '/Workspace/jupyter-lite.json', destination: '/jupyter/jupyter-lite.json' },
      { source: '/Workspace/jupyter-lite.ipynb', destination: '/jupyter/jupyter-lite.ipynb' },
      { source: '/Workspace/index.html', destination: '/jupyter/index.html' },
      { source: '/Workspace/config-utils.js', destination: '/jupyter/config-utils.js' },

      // 3. Catch relative requests leaking specifically from the JEG nested route
      { source: '/Workspace/JEG/jupyter-lite.json', destination: '/jupyter/jupyter-lite.json' },
      { source: '/Workspace/JEG/jupyter-lite.ipynb', destination: '/jupyter/jupyter-lite.ipynb' },
      { source: '/Workspace/JEG/index.html', destination: '/jupyter/index.html' },
      { source: '/Workspace/JEG/config-utils.js', destination: '/jupyter/config-utils.js' },
      
      // 3b. Catch /Workspace/build paths that leak from JupyterLab relative path resolution
      { source: '/Workspace/build/:path*', destination: '/jupyter/build/:path*' },

      // 4. Catch orphaned Webpack JS chunks leaking to the root (e.g. 927.399dde7.js)
      // Note: Next.js puts its own chunks safely in /_next/
      { source: '/:hash([a-zA-Z0-9_.-]+\\.js)', destination: '/jupyter/build/:hash' },
      
      // 4b. Catch Webpack chunks requested from /jupyter/ that should go to /jupyter/build/
      { source: '/jupyter/:hash([a-zA-Z0-9_.-]+\\.js)', destination: '/jupyter/build/:hash' },
      
      { source: '/build/:path*', destination: '/jupyter/build/:path*' },
      { source: '/extensions/:path*', destination: '/jupyter/extensions/:path*' },

      // 5. Prevent Next.js from 404ing when Jupyter forcefully changes the URL bar
      { source: '/lab', destination: '/Workspace/JEG' },
      { source: '/Workspace/JEG/lab', destination: '/Workspace/JEG' },
      
      // 6. Proxy all /jupyter requests to the backend server on port 8080
      {
        source: '/jupyter/:path*',
        destination: 'http://localhost:8080/:path*',
      }
    ];
  },
};

module.exports = withMDX(nextConfig);
