import type { NextConfig } from "next";

/**
 * Moonshot Radar V24 — Next.js App Router.
 * Server Components and route handlers import Turso modules under src/.
 * No Neon. Migrations are CLI-only (npm run migrate), never on request.
 */
const nextConfig: NextConfig = {
  // Keep Node.js runtime defaults for @libsql/client in Server Components / routes.
};

export default nextConfig;
