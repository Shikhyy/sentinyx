import type { MetadataRoute } from "next";

const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

// Reports and traces quote untrusted text, so they stay out of search indexes.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: ["/", "/scan", "/ledger"], disallow: ["/s/", "/api/", "/guard/traces/"] }], sitemap: `${site}/sitemap.xml` };
}
