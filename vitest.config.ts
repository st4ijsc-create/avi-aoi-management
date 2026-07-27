import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  // doc69 Wave 0-C — mirrors vite.config.ts's @vitejs/plugin-react automatic JSX
  // runtime (no explicit `React` import needed in .tsx source) so *.unit.test.ts
  // files can import pure-logic .tsx modules (e.g. client/src/lib/navigation.tsx)
  // without every file needing an explicit `import React from "react"`. Test-only;
  // does not add the plugin itself (no fast-refresh/babel needed for node-env tests).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    // server tests + node-env client logic tests (named *.unit.test.ts so jsdom-only client
    // tests like exportUtils.test.ts are NOT pulled into the node environment).
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "shared/**/*.test.ts", "client/src/**/*.unit.test.ts"],
    // Loads .env + forces DATABASE_URL to an ISOLATED test DB (see vitest.setup.ts).
    // Provision once: `node scripts/setup-test-db.mjs`.
    setupFiles: ["./vitest.setup.ts"],
  },
});
