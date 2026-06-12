import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone yalniz Docker build'inde (NEXT_STANDALONE=1): Windows host'ta
  // pnpm symlink'leri EPERM verir; lokal "next build" duz cikti kullanir.
  ...(process.env.NEXT_STANDALONE === '1'
    ? { output: 'standalone', outputFileTracingRoot: path.join(__dirname, '../../') }
    : {}),
};

export default nextConfig;
