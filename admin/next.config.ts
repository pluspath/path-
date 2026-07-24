import type { NextConfig } from "next";

const apiInternal =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") || "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
  // Same-origin proxy so the browser never needs localhost / CORS for admin APIs.
  // Browser → http(s)://admin-host/api/admin/* → http://127.0.0.1:3000/api/admin/*
  async rewrites() {
    return [
      {
        source: "/api/admin/:path*",
        destination: `${apiInternal}/api/admin/:path*`,
      },
    ];
  },
};

export default nextConfig;
