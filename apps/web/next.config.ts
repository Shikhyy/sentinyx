import type { NextConfig } from "next";

const config: NextConfig = {
  // The scanner talks to RPC nodes and uses Node APIs (dns, Buffer). Keep it out of the bundle.
  serverExternalPackages: ["@sentinyx/scanner", "@sentinyx/store", "@sentinyx/crawler", "viem", "postgres", "@anthropic-ai/sdk"],
  poweredByHeader: false,
  // The share card reads its font files from disk at runtime.
  outputFileTracingIncludes: { "/s/[id]/opengraph-image": ["./src/assets/fonts/**"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
