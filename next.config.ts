import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['yahoo-finance2'],
  },
};

export default nextConfig;
