import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DS Wave 6 — Storybook config (doc 17 §6.1 / §7.1).
 *
 * Framework: @storybook/react-vite (SB 10, Vite 7 + React 19 + Tailwind v4).
 * Stories glob is scoped ONLY to the pattern components + token playground so
 * the whole app is not swept in (keeps builds fast + focused). Path aliases are
 * re-declared here because Storybook loads its OWN Vite config, not vite.config.ts.
 */
const config: StorybookConfig = {
  stories: ["../client/src/components/patterns/**/*.stories.@(ts|tsx)"],
  addons: [],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  async viteFinal(baseConfig) {
    return mergeConfig(baseConfig, {
      resolve: {
        alias: {
          "@": path.resolve(dirname, "../client/src"),
          "@shared": path.resolve(dirname, "../shared"),
          "@assets": path.resolve(dirname, "../attached_assets"),
        },
      },
    });
  },
};

export default config;
