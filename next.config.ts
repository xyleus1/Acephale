import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  devIndicators: false,
  // Don't fail production builds on lint issues — run `npm run lint` locally to see them.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

