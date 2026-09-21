import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* Standalone output for Docker deployment */
  output: 'standalone',
  allowedDevOrigins: ['test.wevic.vn'],
  turbopack: {
    root: __dirname,
  },
  async headers() {
    const noStoreHeaders = [
      { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0, must-revalidate' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
    ];

    return [
      { source: '/', headers: noStoreHeaders },
      { source: '/login', headers: noStoreHeaders },
      { source: '/admin', headers: noStoreHeaders },
      { source: '/admin/:path*', headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
