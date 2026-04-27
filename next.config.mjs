/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['yahoo-finance2'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'assets.coingecko.com' },
      { protocol: 'https', hostname: 'coin-images.coingecko.com' },
    ],
  },
};

export default nextConfig;
