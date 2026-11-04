import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One `.env` at the repo root feeds every workspace (see .env.example); Next only reads the app
// directory by default.
// `forceReload` is required: Next has already loaded the app directory's env by the time this
// runs, and `loadEnvConfig` returns that cached result unless it is told to reload.
loadEnvConfig(resolve(import.meta.dirname, "../.."), process.env.NODE_ENV !== "production", console, true);

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@zeno/sdk", "@zeno/config", "@zeno/types", "@zeno/ui"],
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/features", destination: "/#products", permanent: true }];
  },
  // The site signs wallet transactions, so nothing may frame it (clickjacking). No script-src: Next injects inline
  // scripts and a nonce setup is not worth it yet; these directives cannot break a page.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // Workspace packages import their own files as "./x.js" while the source is x.ts / x.tsx.
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

export default config;
