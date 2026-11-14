import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

/**
 * PWA Offline-First con Serwist:
 * genera el Service Worker desde src/core/pwa/sw.ts (precache de la interfaz +
 * caché runtime) para que ListoPOS sea instalable y cargue sin internet.
 * En desarrollo se desactiva para no interferir con el HMR.
 */
const withSerwist = withSerwistInit({
  swSrc: "src/core/pwa/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default withSerwist(nextConfig);
