import type { NextConfig } from "next";

const backendInternalUrl =
  process.env.BACKEND_INTERNAL_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";
const cloudflareInsightsScriptHost = "https://static.cloudflareinsights.com";
const cloudflareInsightsConnectHosts = [
  "https://cloudflareinsights.com",
  "https://*.cloudflareinsights.com",
  cloudflareInsightsScriptHost,
];

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${cloudflareInsightsScriptHost}`,
      `script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' ${cloudflareInsightsScriptHost}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self' ws: wss: ${cloudflareInsightsConnectHosts.join(" ")}`,
      "worker-src 'self' blob:",
      "frame-src 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/app",
        destination: "/",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendInternalUrl}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
