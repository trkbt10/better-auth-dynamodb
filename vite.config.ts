/**
 * @file Vite build configuration
 */

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    lib: {
      entry: "src/index.ts",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "cjs" ? "cjs" : "js"}`,
    },
    rollupOptions: {
      external: [
        // Node.js built-ins
        /^node:.+/,
        // Peer dependencies (user-provided)
        "@aws-sdk/client-dynamodb",
        "@aws-sdk/lib-dynamodb",
        "@aws-sdk/util-dynamodb",
        "better-auth",
        // Better Auth internal modules
        /^@better-auth\/.+/,
      ],
    },
  },
});
