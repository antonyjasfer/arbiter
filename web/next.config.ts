import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One secrets file for the whole repo: load <repo-root>/.env.local in local dev.
// On Render there is no such file and the dashboard's env vars are used.
loadEnvConfig(path.resolve(process.cwd(), ".."));

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
