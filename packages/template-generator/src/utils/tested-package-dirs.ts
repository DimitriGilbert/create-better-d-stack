/**
 * Workspace dirs that receive vitest config + smoke tests + `test`/
 * `test:coverage` scripts when the testing addon is enabled. Shared by the
 * template dispatcher and the dependency processor so the two stay in sync.
 *
 * Existence is checked per dir because the emitted set depends on the stack
 * (and, via addons like cli/electrobun, on other addons emitting their
 * packages first). Deliberately excluded: packages/config (hosts the shared
 * factory and has no test script), packages/env (env packages must not be
 * imported under test-time env validation), packages/infra, apps/docs,
 * apps/fumadocs, and apps/e2e (Playwright owns its own runner).
 */
export const TESTED_PACKAGE_DIRS = [
  "apps/web",
  "apps/server",
  "apps/native",
  "apps/desktop",
  "apps/cli",
  "packages/ui",
  "packages/db",
  "packages/api",
  "packages/auth",
  "packages/backend",
] as const;
