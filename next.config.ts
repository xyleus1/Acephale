import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  devIndicators: false,
  // Don't fail production builds on lint issues — run `npm run lint` locally to see them.
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      {
        source: "/dashboard/customers",
        destination: "/dashboard/crm/companies",
        permanent: false,
      },
      {
        source: "/dashboard/customers/:companyId",
        destination: "/dashboard/crm/companies/:companyId",
        permanent: false,
      },
      {
        source: "/dashboard/pipeline",
        destination: "/dashboard/crm/opportunities",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

