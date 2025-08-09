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
};

export default nextConfig;
