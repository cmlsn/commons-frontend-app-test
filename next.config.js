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

// Next configuration with support for rewriting API to existing common services
const nextConfig = {
  output: 'standalone',
  httpAgentOptions: {
    keepAlive: true,
  },
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
        source: '/(.*)?',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
    ];
  },

  async rewrites() {
    const GEN3_TARGET =
      process.env.NEXT_PUBLIC_GEN3_API_TARGET ||
      'https://qa-vpodc.planx-pla.net';

    const useDevInsecureProxy =
      process.env.NODE_ENV !== 'production' &&
      process.env.DEV_INSECURE_BRH_PROXY === 'true';

    if (useDevInsecureProxy) {
      return [
        { source: '/kernelspecs/:path*', destination: '/api/workspace/jeg/proxy/kernelspecs/:path*' },
        { source: '/_status', destination: '/api/dev-insecure-proxy/_status' },
        { source: '/user/:path*', destination: '/api/dev-insecure-proxy/user/:path*' },
        { source: '/guppy/:path*', destination: '/api/dev-insecure-proxy/guppy/:path*' },
        { source: '/mds/:path*', destination: '/api/dev-insecure-proxy/mds/:path*' },
        { source: '/ai-search/:path*', destination: '/api/dev-insecure-proxy/ai-search/:path*' },
        { source: '/authz/:path*', destination: '/api/dev-insecure-proxy/authz/:path*' },
        { source: '/lw-workspace/:path*', destination: '/api/dev-insecure-proxy/lw-workspace/:path*' },
        { source: '/api/v0/submission/:path*', destination: '/api/dev-insecure-proxy/api/v0/submission/:path*' },
        { source: '/wts/:path*', destination: '/api/dev-insecure-proxy/wts/:path*' },
        { source: '/library/lists/:path*', destination: '/api/dev-insecure-proxy/library/lists/:path*' },
        { source: '/jobs/:path*', destination: '/api/dev-insecure-proxy/jobs/:path*' },
        { source: '/manifests/:path*', destination: '/api/dev-insecure-proxy/manifests/:path*' },
        { source: '/requestor/:path*', destination: '/api/dev-insecure-proxy/requestor/:path*' },
      ];
    }

    return [
      { source: '/kernelspecs/:path*', destination: '/api/workspace/jeg/proxy/kernelspecs/:path*' },
      { source: '/_status', destination: `${GEN3_TARGET}/_status` },
      { source: '/user/:path*', destination: `${GEN3_TARGET}/user/:path*` },
      { source: '/guppy/:path*', destination: `${GEN3_TARGET}/guppy/:path*` },
      { source: '/mds/:path*', destination: `${GEN3_TARGET}/mds/:path*` },
      { source: '/ai-search/:path*', destination: `${GEN3_TARGET}/ai-search/:path*` },
      { source: '/authz/:path*', destination: `${GEN3_TARGET}/authz/:path*` },
      { source: '/lw-workspace/:path*', destination: `${GEN3_TARGET}/lw-workspace/:path*` },
      { source: '/api/v0/submission/:path*', destination: `${GEN3_TARGET}/api/v0/submission/:path*` },
      { source: '/wts/:path*', destination: `${GEN3_TARGET}/wts/:path*` },
      { source: '/library/lists/:path*', destination: `${GEN3_TARGET}/library/lists/:path*` },
      { source: '/jobs/:path*', destination: `${GEN3_TARGET}/jobs/:path*` },
      { source: '/manifests/:path*', destination: `${GEN3_TARGET}/manifests/:path*` },
      { source: '/requestor/:path*', destination: `${GEN3_TARGET}/requestor/:path*` },
    ];
  },
};

module.exports = withMDX(nextConfig);