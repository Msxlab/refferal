import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Use standalone output only in Docker builds. On Windows hosts, pnpm symlinks can
  // hit EPERM during tracing, so local builds use the regular Next.js output.
  ...(process.env.NEXT_STANDALONE === '1'
    ? { output: 'standalone', outputFileTracingRoot: path.join(__dirname, '../../') }
    : {}),
};

export default nextConfig;
