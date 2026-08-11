import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/supply-os/quote-cycles/*/connected-replies/*/extract": [
      "./node_modules/pdf-parse/**/*",
      "./node_modules/pdfjs-dist/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
  },
  // Don't fail production builds on lint issues — run `npm run lint` locally to see them.
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    // Baseline security headers (F6). Clickjacking is the concrete risk on the
    // authenticated CRM, so frame-ancestors/X-Frame-Options are the priority.
    // A full script-src CSP is intentionally omitted for now (would need nonce
    // work against the app's inline styles) — tracked as a follow-up.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/dashboard/customers",
        destination: "/dashboard/crm",
        permanent: false,
      },
      {
        source: "/dashboard/customers/:companyId",
        destination: "/dashboard/crm",
        permanent: false,
      },
      {
        source: "/dashboard/pipeline",
        destination: "/dashboard/crm",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
