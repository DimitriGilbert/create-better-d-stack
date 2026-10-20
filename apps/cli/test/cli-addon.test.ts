import { describe, expect, it } from "bun:test";
import path from "node:path";

import fs from "fs-extra";

import { add } from "../src/index";
import { expectSuccess, runCreateTest } from "./test-utils";

describe("CLI addon scaffolding", () => {
  it("scaffolds a Commander-based apps/cli workspace on the default stack", async () => {
    const result = await runCreateTest({
      projectName: "cli-addon-default-stack",
      addons: ["cli"],
    });

    expectSuccess(result);
    const projectDir = result.projectDir;

    const cliPackageJson = await fs.readJson(path.join(projectDir, "apps", "cli", "package.json"));
    expect(cliPackageJson.name).toBe("cli");
    expect(cliPackageJson.scripts.build).toBe("tsdown");
    expect(cliPackageJson.scripts["check-types"]).toBe("tsc --noEmit");

    // bin and start must reference the same emitted artifact
    const binPath = cliPackageJson.bin["cli-addon-default-stack"];
    expect(binPath).toMatch(/^\.\/dist\//);
    expect(cliPackageJson.scripts.start).toBe(`node ${binPath.slice(2)}`);

    // deps are injected from dependencyVersionMap, not hardcoded in the template
    expect(cliPackageJson.dependencies.commander).toBeDefined();
    expect(cliPackageJson.devDependencies.tsdown).toBeDefined();
    expect(cliPackageJson.devDependencies.tsx).toBeDefined();
    expect(cliPackageJson.devDependencies["@types/node"]).toBeDefined();
    expect(cliPackageJson.devDependencies["@cli-addon-default-stack/config"]).toBe("workspace:*");

    const tsdownConfig = await fs.readFile(
      path.join(projectDir, "apps", "cli", "tsdown.config.ts"),
      "utf8",
    );
    expect(tsdownConfig).toContain('entry: "./src/index.ts"');

    const tsconfig = await fs.readJson(path.join(projectDir, "apps", "cli", "tsconfig.json"));
    expect(tsconfig.extends).toBe("@cli-addon-default-stack/config/tsconfig.base.json");

    const indexTs = await fs.readFile(
      path.join(projectDir, "apps", "cli", "src", "index.ts"),
      "utf8",
    );
    expect(indexTs).toStartWith("#!/usr/bin/env node");
    expect(indexTs).toContain('name("cli-addon-default-stack")');
    expect(indexTs).toContain("healthCommand");
    // Bare `dev`/`start` with no args must exit 0 so workspace `dev` aggregates
    // don't abort — guaranteed by a program-level default action that prints help.
    expect(indexTs).toContain("program.action");

    const healthTs = await fs.readFile(
      path.join(projectDir, "apps", "cli", "src", "commands", "health.ts"),
      "utf8",
    );
    expect(healthTs).toContain("http://localhost:3000");
    expect(healthTs).toContain("CLI_HEALTH_URL");

    const transpiler = new Bun.Transpiler({ loader: "ts" });
    expect(() => transpiler.transformSync(indexTs)).not.toThrow();
    expect(() => transpiler.transformSync(healthTs)).not.toThrow();
  });

  it("scaffolds cli on a project with no backend and no frontend", async () => {
    const result = await runCreateTest({
      projectName: "cli-addon-no-backend",
      addons: ["cli"],
      frontend: ["none"],
      backend: "none",
      runtime: "none",
      database: "none",
      orm: "none",
      api: "none",
      auth: "none",
    });

    expectSuccess(result);
    const healthTs = await fs.readFile(
      path.join(result.projectDir, "apps", "cli", "src", "commands", "health.ts"),
      "utf8",
    );
    expect(healthTs).toContain("No HTTP backend configured");
  });

  it("scaffolds cli alongside a native frontend", async () => {
    const result = await runCreateTest({
      projectName: "cli-addon-native",
      addons: ["cli"],
      frontend: ["native-bare"],
    });

    expectSuccess(result);
    expect(await fs.pathExists(path.join(result.projectDir, "apps", "cli", "package.json"))).toBe(
      true,
    );
  });

  it("defaults the health command to the web dev server for backend self", async () => {
    const result = await runCreateTest({
      projectName: "cli-addon-self-next",
      addons: ["cli"],
      frontend: ["next"],
      backend: "self",
      runtime: "none",
    });

    expectSuccess(result);
    const healthTs = await fs.readFile(
      path.join(result.projectDir, "apps", "cli", "src", "commands", "health.ts"),
      "utf8",
    );
    expect(healthTs).toContain("http://localhost:3001");
  });

  it("uses the * workspace specifier for npm package manager", async () => {
    const result = await runCreateTest({
      projectName: "cli-addon-npm",
      addons: ["cli"],
      packageManager: "npm",
    });

    expectSuccess(result);
    const cliPackageJson = await fs.readJson(
      path.join(result.projectDir, "apps", "cli", "package.json"),
    );
    expect(cliPackageJson.devDependencies["@cli-addon-npm/config"]).toBe("*");
  });

  it("keeps apps/* in workspaces for cli + convex + no frontend", async () => {
    const result = await runCreateTest({
      projectName: "cli-addon-convex-no-frontend",
      addons: ["cli"],
      frontend: ["none"],
      backend: "convex",
      runtime: "none",
      database: "none",
      orm: "none",
      api: "none",
      auth: "none",
    });

    expectSuccess(result);
    const rootPackageJson = await fs.readJson(path.join(result.projectDir, "package.json"));
    const workspaces = Array.isArray(rootPackageJson.workspaces)
      ? rootPackageJson.workspaces
      : (rootPackageJson.workspaces?.packages ?? []);
    expect(workspaces).toContain("apps/*");
    expect(await fs.pathExists(path.join(result.projectDir, "apps", "cli", "package.json"))).toBe(
      true,
    );
  });

  it("adds apps/cli/dist to vite-plus lint ignore patterns", async () => {
    const result = await runCreateTest({
      projectName: "cli-addon-vite-plus",
      addons: ["cli", "vite-plus"],
    });

    expectSuccess(result);
    const viteConfig = await fs.readFile(path.join(result.projectDir, "vite.config.ts"), "utf8");
    expect(viteConfig).toContain("apps/cli/dist/**");
  });

  it("scaffolds apps/cli through the add command", async () => {
    const created = await runCreateTest({
      projectName: "cli-addon-add-flow",
      addons: ["none"],
    });
    expectSuccess(created);

    const added = await add({
      projectDir: created.projectDir,
      addons: ["cli"],
      install: false,
    });
    expect(added.success).toBe(true);

    const cliPackageJson = await fs.readJson(
      path.join(created.projectDir, "apps", "cli", "package.json"),
    );
    expect(cliPackageJson.name).toBe("cli");
    expect(cliPackageJson.dependencies.commander).toBeDefined();
    expect(
      await fs.pathExists(
        path.join(created.projectDir, "apps", "cli", "src", "commands", "health.ts"),
      ),
    ).toBe(true);

    const btsConfig = await fs.readFile(path.join(created.projectDir, "bts.jsonc"), "utf8");
    expect(btsConfig).toContain('"cli"');
  });

  it("keeps apps/* in workspaces when adding cli onto a convex + no-frontend project", async () => {
    const created = await runCreateTest({
      projectName: "cli-addon-add-convex",
      addons: ["none"],
      frontend: ["none"],
      backend: "convex",
      runtime: "none",
      database: "none",
      orm: "none",
      api: "none",
      auth: "none",
    });
    expectSuccess(created);

    const added = await add({
      projectDir: created.projectDir,
      addons: ["cli"],
      install: false,
    });
    expect(added.success).toBe(true);

    const after = await fs.readJson(path.join(created.projectDir, "package.json"));
    const afterWorkspaces = Array.isArray(after.workspaces)
      ? after.workspaces
      : (after.workspaces?.packages ?? []);
    expect(afterWorkspaces).toContain("apps/*");
    expect(await fs.pathExists(path.join(created.projectDir, "apps", "cli", "package.json"))).toBe(
      true,
    );
  });

  it("keeps the cli package intact when added onto an existing turborepo project", async () => {
    const created = await runCreateTest({
      projectName: "cli-addon-add-turbo",
      addons: ["turborepo"],
    });
    expectSuccess(created);

    const added = await add({
      projectDir: created.projectDir,
      addons: ["cli"],
      install: false,
    });
    expect(added.success).toBe(true);

    const cliPackageJson = await fs.readJson(
      path.join(created.projectDir, "apps", "cli", "package.json"),
    );
    expect(cliPackageJson.name).toBe("cli");
    expect(cliPackageJson.dependencies.commander).toBeDefined();
    expect(cliPackageJson.scripts.build).toBe("tsdown");
  });
});
