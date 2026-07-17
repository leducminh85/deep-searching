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
};

export default nextConfig;
