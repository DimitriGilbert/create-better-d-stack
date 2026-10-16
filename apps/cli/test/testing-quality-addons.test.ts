import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { AddonsListSchema } from "@better-t-stack/types";

import { add, create } from "../src";
import { addHandler } from "../src/helpers/core/add-handler";
import { resolveAddonDependencies } from "../src/utils/compatibility-rules";
import { expectError, expectSuccess, runCreateTest } from "./test-utils";

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) return listFilesRecursive(entryPath);
      return [entryPath];
    }),
  );
  return files.flat();
}

describe("testing addon", () => {
  it("emits the shared vitest factory, per-package configs, scripts, and gitignore", async () => {
    const result = await runCreateTest({
      projectName: "testing-default",
      addons: ["testing"],
    });
    expectSuccess(result);
    const dir = result.projectDir;

    expect(existsSync(join(dir, "packages/config/vitest/base.ts"))).toBe(true);
    expect(existsSync(join(dir, "packages/config/vitest/setup.ts"))).toBe(true);

    const webVitestConfig = await readFile(join(dir, "apps/web/vitest.config.ts"), "utf8");
    expect(webVitestConfig).toContain("../../packages/config/vitest/base");
    expect(webVitestConfig).toContain('environment: "jsdom"');

    const webPkg = await readJson(join(dir, "apps/web/package.json"));
    expect(webPkg.scripts.test).toBe("vitest run");
    expect(webPkg.scripts["test:coverage"]).toBe("vitest run --coverage");
    expect(webPkg.devDependencies.vitest).toBeDefined();
    expect(webPkg.devDependencies["@vitest/coverage-istanbul"]).toBeDefined();
    expect(webPkg.devDependencies.jsdom).toBeDefined();
    expect(existsSync(join(dir, "apps/web/src/smoke.test.ts"))).toBe(true);

    const uiPkg = await readJson(join(dir, "packages/ui/package.json"));
    expect(uiPkg.devDependencies["@testing-library/react"]).toBeDefined();
    expect(uiPkg.devDependencies["@testing-library/dom"]).toBeDefined();
    expect(uiPkg.devDependencies.jsdom).toBeDefined();
    expect(existsSync(join(dir, "packages/ui/src/components/button.test.tsx"))).toBe(true);
    const uiVitestConfig = await readFile(join(dir, "packages/ui/vitest.config.ts"), "utf8");
    expect(uiVitestConfig).toContain('"@testing-default/ui"');

    expect(existsSync(join(dir, "apps/server/vitest.config.ts"))).toBe(true);
    expect(existsSync(join(dir, "apps/server/src/smoke.test.ts"))).toBe(true);
    expect(existsSync(join(dir, "packages/db/vitest.config.ts"))).toBe(true);
    expect(existsSync(join(dir, "packages/api/vitest.config.ts"))).toBe(true);

    const rootPkg = await readJson(join(dir, "package.json"));
    expect(rootPkg.scripts.test).toBe("bun run --filter '*' test");
    expect(rootPkg.scripts["test:coverage"]).toBe("bun run --filter '*' test:coverage");

    const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("**/coverage/");
  });

  it("declares test tasks in turbo.json and uses turbo run scripts", async () => {
    const result = await runCreateTest({
      projectName: "testing-turborepo",
      addons: ["testing", "turborepo"],
    });
    expectSuccess(result);
    const dir = result.projectDir;

    const rootPkg = await readJson(join(dir, "package.json"));
    expect(rootPkg.scripts.test).toBe("turbo run test");
    expect(rootPkg.scripts["test:coverage"]).toBe("turbo run test:coverage");

    const turboJson = await readJson(join(dir, "turbo.json"));
    expect(turboJson.tasks.test).toBeDefined();
    expect(turboJson.tasks["test:coverage"]).toBeDefined();
  });

  it("declares test targets in nx.json", async () => {
    const result = await runCreateTest({
      projectName: "testing-nx",
      addons: ["testing", "nx"],
    });
    expectSuccess(result);
    const dir = result.projectDir;

    const rootPkg = await readJson(join(dir, "package.json"));
    expect(rootPkg.scripts.test).toBe("nx run-many -t test");

    const nxJson = await readJson(join(dir, "nx.json"));
    expect(nxJson.targetDefaults.test).toBeDefined();
    expect(nxJson.targetDefaults["test:coverage"]).toBeDefined();
  });

  it("emits only the shared factory for a project with no apps or packages", async () => {
    const result = await runCreateTest({
      projectName: "testing-empty",
      addons: ["testing"],
      frontend: ["none"],
      backend: "none",
      runtime: "none",
      api: "none",
      database: "none",
      orm: "none",
    });
    expectSuccess(result);
    const dir = result.projectDir;

    expect(existsSync(join(dir, "packages/config/vitest/base.ts"))).toBe(true);
    expect(existsSync(join(dir, "packages/config/vitest/setup.ts"))).toBe(true);
    expect(existsSync(join(dir, "apps"))).toBe(false);
  });

  it("keeps tests out of the convex deploy directory", async () => {
    const result = await runCreateTest({
      projectName: "testing-convex",
      addons: ["testing"],
      backend: "convex",
      runtime: "none",
      database: "none",
      orm: "none",
      api: "none",
      auth: "none",
    });
    expectSuccess(result);
    const dir = result.projectDir;

    expect(existsSync(join(dir, "packages/backend/vitest.config.ts"))).toBe(true);
    expect(existsSync(join(dir, "packages/backend/smoke.test.ts"))).toBe(true);
    const convexFiles = await listFilesRecursive(join(dir, "packages/backend/convex"));
    expect(convexFiles.filter((file) => file.endsWith(".test.ts")).length).toBe(0);
  });

  it("covers apps/desktop regardless of addon ordering", async () => {
    for (const [name, addons] of [
      ["testing-electrobun-first", ["testing", "electrobun"]],
      ["testing-electrobun-last", ["electrobun", "testing"]],
    ] as const) {
      const result = await runCreateTest({
        projectName: name,
        addons: [...addons],
      });
      expectSuccess(result);
      expect(existsSync(join(result.projectDir, "apps/desktop/vitest.config.ts"))).toBe(true);
      expect(existsSync(join(result.projectDir, "apps/desktop/src/smoke.test.ts"))).toBe(true);
    }
  });

  it("places the web smoke test under app/ for nuxt", async () => {
    const result = await runCreateTest({
      projectName: "testing-nuxt",
      addons: ["testing"],
      frontend: ["nuxt"],
      api: "orpc",
    });
    expectSuccess(result);
    const dir = result.projectDir;

    expect(existsSync(join(dir, "apps/web/app/smoke.test.ts"))).toBe(true);
    expect(existsSync(join(dir, "apps/web/vitest.config.ts"))).toBe(true);
  });

  it("uses pnpm recursion and allowlists esbuild under pnpm", async () => {
    const result = await runCreateTest({
      projectName: "testing-pnpm",
      addons: ["testing"],
      packageManager: "pnpm",
    });
    expectSuccess(result);
    const dir = result.projectDir;

    const rootPkg = await readJson(join(dir, "package.json"));
    expect(rootPkg.scripts.test).toBe("pnpm -r test");
    expect(rootPkg.scripts["test:coverage"]).toBe("pnpm -r test:coverage");

    const workspaceYaml = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(workspaceYaml).toContain("allowBuilds");
    expect(workspaceYaml).toContain("esbuild: true");
  });
});

describe("e2e-testing addon", () => {
  it("emits apps/e2e with web and api specs and root scripts", async () => {
    const result = await runCreateTest({
      projectName: "e2e-default",
      addons: ["e2e-testing"],
    });
    expectSuccess(result);
    const dir = result.projectDir;

    const e2ePkg = await readJson(join(dir, "apps/e2e/package.json"));
    expect(e2ePkg.scripts["test:e2e"]).toBe("playwright test");
    expect(e2ePkg.scripts.test).toBeUndefined();
    expect(e2ePkg.scripts["test:e2e:install"]).toBe("playwright install chromium");

    const playwrightConfig = await readFile(join(dir, "apps/e2e/playwright.config.ts"), "utf8");
    expect(playwrightConfig).toContain('cwd: "../.."');
    expect(playwrightConfig).toContain("dev:web");
    expect(playwrightConfig).toContain("dev:server");

    expect(existsSync(join(dir, "apps/e2e/e2e/web.spec.ts"))).toBe(true);
    expect(existsSync(join(dir, "apps/e2e/e2e/api.spec.ts"))).toBe(true);
    expect(existsSync(join(dir, "apps/e2e/README.md"))).toBe(true);

    const rootPkg = await readJson(join(dir, "package.json"));
    expect(rootPkg.scripts["test:e2e"]).toBe("bun run --filter e2e test:e2e");
    expect(rootPkg.scripts["test:e2e:install"]).toBe("bun run --filter e2e test:e2e:install");

    const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("apps/e2e/playwright-report/");
  });

  it("rejects projects with no HTTP surface", async () => {
    const result = await runCreateTest({
      projectName: "e2e-native-fail",
      addons: ["e2e-testing"],
      frontend: ["native-bare"],
      backend: "none",
      runtime: "none",
      api: "none",
      database: "none",
      orm: "none",
      auth: "none",
    });
    expectError(result, "e2e-testing addon requires a web frontend or a Node/Bun server backend");
  });

  it("emits api specs only for a backend-only project", async () => {
    const result = await runCreateTest({
      projectName: "e2e-hono-only",
      addons: ["e2e-testing"],
      frontend: ["none"],
      backend: "hono",
      runtime: "bun",
      api: "none",
    });
    expectSuccess(result);
    const dir = result.projectDir;

    expect(existsSync(join(dir, "apps/e2e/e2e/api.spec.ts"))).toBe(true);
    expect(existsSync(join(dir, "apps/e2e/e2e/web.spec.ts"))).toBe(false);

    const playwrightConfig = await readFile(join(dir, "apps/e2e/playwright.config.ts"), "utf8");
    expect(playwrightConfig).toContain("dev:server");
    expect(playwrightConfig).not.toContain("dev:web");
  });

  it("never boots convex dev as an e2e webServer", async () => {
    const result = await runCreateTest({
      projectName: "e2e-convex",
      addons: ["e2e-testing"],
      backend: "convex",
      runtime: "none",
      database: "none",
      orm: "none",
      api: "none",
      auth: "none",
    });
    expectSuccess(result);
    const dir = result.projectDir;

    const playwrightConfig = await readFile(join(dir, "apps/e2e/playwright.config.ts"), "utf8");
    expect(playwrightConfig).toContain("dev:web");
    expect(playwrightConfig).not.toContain("dev:server");
    expect(existsSync(join(dir, "apps/e2e/e2e/api.spec.ts"))).toBe(false);
    expect(existsSync(join(dir, "apps/e2e/e2e/web.spec.ts"))).toBe(true);
  });
});

describe("quality-metrics addon", () => {
  it("emits configs, quality scripts, and devDeps", async () => {
    const result = await runCreateTest({
      projectName: "quality-default",
      addons: ["testing", "quality-metrics"],
    });
    expectSuccess(result);
    const dir = result.projectDir;

    expect(existsSync(join(dir, "jscpd.config.json"))).toBe(true);
    expect(existsSync(join(dir, "knip.json"))).toBe(true);
    expect(existsSync(join(dir, "scripts/quality-crap.mjs"))).toBe(true);
    expect(existsSync(join(dir, "scripts/quality-report.mjs"))).toBe(true);

    const rootPkg = await readJson(join(dir, "package.json"));
    expect(rootPkg.devDependencies["crap-score"]).toBeDefined();
    expect(rootPkg.devDependencies.jscpd).toBeDefined();
    expect(rootPkg.devDependencies.knip).toBeDefined();
    expect(rootPkg.scripts.quality).toBe(
      "bun run test:coverage && bun run quality:crap && bun run quality:duplication && bun run quality:report",
    );

    const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("reports/");
  });

  it("requires the testing addon via schema and programmatic create", async () => {
    expect(AddonsListSchema.safeParse(["quality-metrics"]).success).toBe(false);
    expect(AddonsListSchema.safeParse(["quality-metrics", "testing"]).success).toBe(true);
    expect(resolveAddonDependencies(["quality-metrics"])).toEqual(["quality-metrics", "testing"]);

    const result = await create("unused-quality-only", {
      addons: ["quality-metrics"],
      install: false,
      git: false,
      disableAnalytics: true,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("requires the 'testing' addon");
    }
  });
});

describe("testing addons via the add command", () => {
  it("adds testing, quality-metrics, and e2e-testing to an existing project", async () => {
    const created = await runCreateTest({ projectName: "testing-add-flow" });
    expectSuccess(created);
    const projectDir = created.result.projectDirectory;

    const addTesting = await add({ projectDir, addons: ["testing"], install: false });
    expect(addTesting?.success).toBe(true);
    const webPkg = await readJson(join(projectDir, "apps/web/package.json"));
    expect(webPkg.scripts.test).toBe("vitest run");
    const gitignore = await readFile(join(projectDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("**/coverage/");

    const addQuality = await add({
      projectDir,
      addons: ["quality-metrics", "testing"],
      install: false,
    });
    expect(addQuality?.success).toBe(true);
    const btsConfig = await readFile(join(projectDir, "bts.jsonc"), "utf8");
    expect(btsConfig).toContain('"quality-metrics"');
    expect(btsConfig).toContain('"testing"');
    expect(btsConfig.match(/"testing"/g)?.length).toBe(1);

    const addE2e = await add({ projectDir, addons: ["e2e-testing"], install: false });
    expect(addE2e?.success).toBe(true);
    expect(existsSync(join(projectDir, "apps/e2e/playwright.config.ts"))).toBe(true);
  });

  it("rejects quality-metrics alone through the programmatic add API", async () => {
    const created = await runCreateTest({ projectName: "quality-add-schema" });
    expectSuccess(created);

    const result = await add({
      projectDir: created.result.projectDirectory,
      addons: ["quality-metrics"],
      install: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires the 'testing' addon");
  });

  it("auto-adds testing when the CLI flag path requests only quality-metrics", async () => {
    const created = await runCreateTest({ projectName: "quality-auto-testing" });
    expectSuccess(created);
    const projectDir = created.result.projectDirectory;

    // addHandler is what `bts add --addons quality-metrics` invokes — its
    // input bypasses AddInputSchema, so the dependency resolver must pull in
    // testing there.
    const result = await addHandler(
      { projectDir, addons: ["quality-metrics"], install: false },
      { silent: true },
    );
    expect(result?.success).toBe(true);
    expect(result?.addedAddons).toEqual(expect.arrayContaining(["quality-metrics", "testing"]));

    const webPkg = await readJson(join(projectDir, "apps/web/package.json"));
    expect(webPkg.scripts.test).toBe("vitest run");
    const btsConfig = await readFile(join(projectDir, "bts.jsonc"), "utf8");
    expect(btsConfig).toContain('"testing"');
    expect(btsConfig).toContain('"quality-metrics"');
  });
});
