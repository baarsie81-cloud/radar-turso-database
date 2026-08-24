import type { NextConfig } from "next";

/**
 * Moonshot Radar V24 — Next.js App Router.
 * Server Components and route handlers import Turso modules under src/.
 * No Neon.
 */
const nextConfig: NextConfig = {
  // Ensure SQL migration files are available to serverless functions that
  // initialize the Hypothesis schema in production.
  outputFileTracingIncludes: {
    "/*": ["./migrations/**/*"],
  },
};

export default nextConfig;
