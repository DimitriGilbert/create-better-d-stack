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
    expect(cliPackageJson.bin["cli-addon-default-stack"]).toBe("./dist/index.mjs");
    expect(cliPackageJson.dependencies.commander).toBeDefined();
    expect(cliPackageJson.devDependencies.tsdown).toBeDefined();
    expect(cliPackageJson.devDependencies["@cli-addon-default-stack/config"]).toBeDefined();
    expect(cliPackageJson.scripts.build).toBe("tsdown");
    expect(cliPackageJson.scripts["check-types"]).toBe("tsc --noEmit");

    const tsdownConfig = await fs.readFile(
      path.join(projectDir, "apps", "cli", "tsdown.config.ts"),
      "utf8",
    );
    expect(tsdownConfig).toContain('entry: "./src/index.ts"');
    expect(tsdownConfig).toContain('platform: "node"');

    const tsconfig = await fs.readJson(path.join(projectDir, "apps", "cli", "tsconfig.json"));
    expect(tsconfig.extends).toBe("@cli-addon-default-stack/config/tsconfig.base.json");

    const indexTs = await fs.readFile(
      path.join(projectDir, "apps", "cli", "src", "index.ts"),
      "utf8",
    );
    expect(indexTs).toStartWith("#!/usr/bin/env node");
    expect(indexTs).toContain('name("cli-addon-default-stack")');
    expect(indexTs).toContain("healthCommand");

    const healthTs = await fs.readFile(
      path.join(projectDir, "apps", "cli", "src", "commands", "health.ts"),
      "utf8",
    );
    expect(healthTs).toContain("http://localhost:3000");
    expect(healthTs).toContain("SERVER_URL");

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

    expect(await fs.pathExists(path.join(created.projectDir, "apps", "cli", "package.json"))).toBe(
      true,
    );
    expect(
      await fs.pathExists(
        path.join(created.projectDir, "apps", "cli", "src", "commands", "health.ts"),
      ),
    ).toBe(true);

    const btsConfig = await fs.readFile(path.join(created.projectDir, "bts.jsonc"), "utf8");
    expect(btsConfig).toContain('"cli"');
  });
});
