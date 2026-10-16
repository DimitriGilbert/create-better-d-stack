import { defineConfig } from "vitest/config";

import { createTestConfig } from "../../packages/config/vitest/base";

export default defineConfig(
  createTestConfig({ setupFiles: ["../../packages/config/vitest/setup.ts"] }),
);
