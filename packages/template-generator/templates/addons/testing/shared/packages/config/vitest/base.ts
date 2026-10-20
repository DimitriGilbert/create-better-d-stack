import type { ViteUserConfig } from "vitest/config";

export type TestEnvironment = "node" | "jsdom";

/**
 * Shared vitest configuration factory. Each workspace wraps the result in
 * `defineConfig` from its own `vitest` dependency:
 *
 *   import { defineConfig } from "vitest/config";
 *   import { createTestConfig } from "../../packages/config/vitest/base";
 *   export default defineConfig(createTestConfig({ setupFiles: [...] }));
 */
export function createTestConfig(
  options: {
    environment?: TestEnvironment;
    setupFiles?: string[];
    resolve?: ViteUserConfig["resolve"];
  } = {},
): ViteUserConfig {
  return {
    resolve: options.resolve,
    test: {
      environment: options.environment ?? "node",
      setupFiles: options.setupFiles ?? [],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.{idea,git,cache,output,temp}/**",
        "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      ],
      coverage: {
        // istanbul is required: the quality pipeline (crap-score) consumes
        // istanbul's coverage-final.json format.
        provider: "istanbul",
        reporter: ["text", "json", "html"],
        exclude: [
          "**/*.test.*",
          "**/*.gen.ts",
          "**/_generated/**",
          "**/migrations/**",
          "**/*.sql",
          "**/*.config.*",
          "**/node_modules/**",
          "**/dist/**",
          "coverage/**",
        ],
      },
    },
  };
}
