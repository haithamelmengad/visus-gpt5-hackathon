import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Improve hot reload reliability in diverse environments/filesystems
  webpackDevMiddleware: (config) => {
    // Polling helps when file watchers miss changes (e.g., network volumes/VMs)
    // Adjust interval if needed
    // @ts-expect-error - types don't include watchOptions on middleware config
    config.watchOptions = {
      poll: 300,
      aggregateTimeout: 200,
      ignored: ["**/node_modules/**", "**/.next/**"],
    };
    return config;
  },
  // React 19 fast refresh is on by default; keep dev overlays enabled
  reactStrictMode: true,
};

export default nextConfig;
