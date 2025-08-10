import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Improve hot reload reliability in diverse environments/filesystems
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Polling helps when file watchers miss changes (e.g., network volumes/VMs)
      config.watchOptions = {
        poll: 300,
        aggregateTimeout: 200,
        ignored: ["**/node_modules/**", "**/.next/**"],
      };
    }
    return config;
  },
  // React 19 fast refresh is on by default; keep dev overlays enabled
  reactStrictMode: true,
  // Allow production builds to proceed even if ESLint rules fail
  eslint: {
    ignoreDuringBuilds: true,
  },
  // If needed later, we can also ignore type errors during builds by uncommenting:
  // typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
