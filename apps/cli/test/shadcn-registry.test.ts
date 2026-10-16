import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { add } from "../src";
import { expectError, expectSuccess, runCreateTest } from "./test-utils";

const registryFileSchema = z.object({
  path: z.string(),
});

const registryItemSchema = z.object({
  name: z.string(),
  files: z.array(registryFileSchema),
});

const sourceRegistrySchema = z.object({
  name: z.string(),
  homepage: z.string(),
  items: z.array(registryItemSchema),
});

const packageJsonSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

async function readRegistrySources(dir: string): Promise<{ path: string; content: string }[]> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) return readRegistrySources(entryPath);
      return [{ path: entryPath, content: await readFile(entryPath, "utf-8") }];
    }),
  );

  return files.flat();
}

describe("shadcn-registry addon", () => {
  it("scaffolds a source registry with resolvable file paths and wired scripts", async () => {
    const result = await runCreateTest({
      projectName: "shadcn-registry-tsr",
      addons: ["shadcn-registry"],
      frontend: ["tanstack-router"],
    });

    expectSuccess(result);

    const registry = sourceRegistrySchema.parse(
      JSON.parse(await readFile(join(result.projectDir, "registry.json"), "utf-8")),
    );
    expect(registry.name).toBe("shadcn-registry-tsr");
    expect(registry.homepage).toBe("http://localhost:3001");
    expect(registry.items.length).toBeGreaterThan(0);

    for (const item of registry.items) {
      for (const file of item.files) {
        expect(existsSync(join(result.projectDir, file.path))).toBe(true);
      }
    }

    const rootPackageJson = packageJsonSchema.parse(
      JSON.parse(await readFile(join(result.projectDir, "package.json"), "utf-8")),
    );
    expect(rootPackageJson.devDependencies?.shadcn).toBeDefined();
    expect(rootPackageJson.scripts?.["registry:build"]).toBe(
      "shadcn build registry.json --output apps/web/public/r",
    );

    const gitignore = await readFile(join(result.projectDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("apps/web/public/r/");
  });

  it("keeps registry sources free of workspace-scoped imports", async () => {
    const projectName = "shadcn-registry-imports";
    const result = await runCreateTest({
      projectName,
      addons: ["shadcn-registry"],
      frontend: ["tanstack-router"],
    });

    expectSuccess(result);

    const sources = await readRegistrySources(join(result.projectDir, "registry"));
    expect(sources.length).toBeGreaterThan(0);
    const offending = sources
      .filter((source) => source.content.includes(`@${projectName}/ui`))
      .map((source) => source.path);
    expect(offending).toEqual([]);

    const button = sources.find((source) => source.path.endsWith("button.tsx"));
    expect(button?.content).toContain('from "@/lib/utils"');
  });

  it("works with next and uses its dev port for the homepage", async () => {
    const result = await runCreateTest({
      projectName: "shadcn-registry-next",
      addons: ["shadcn-registry"],
      frontend: ["next"],
      backend: "self",
      runtime: "none",
      database: "none",
      orm: "none",
      api: "none",
    });

    expectSuccess(result);

    const registry = sourceRegistrySchema.parse(
      JSON.parse(await readFile(join(result.projectDir, "registry.json"), "utf-8")),
    );
    expect(registry.homepage).toContain("3001");
    expect(existsSync(join(result.projectDir, "registry", "ui", "button.tsx"))).toBe(true);
  });

  it("uses the Vite dev port for react-router", async () => {
    const result = await runCreateTest({
      projectName: "shadcn-registry-rr",
      addons: ["shadcn-registry"],
      frontend: ["react-router"],
    });

    expectSuccess(result);

    const registry = sourceRegistrySchema.parse(
      JSON.parse(await readFile(join(result.projectDir, "registry.json"), "utf-8")),
    );
    expect(registry.homepage).toContain("5173");
  });

  for (const frontend of ["nuxt", "native-bare"] as const) {
    it(`rejects ${frontend} frontends`, async () => {
      const result = await runCreateTest({
        projectName: `shadcn-registry-${frontend}-fail`,
        addons: ["shadcn-registry"],
        frontend: [frontend],
        api: frontend === "nuxt" ? "orpc" : "trpc",
      });

      expectError(result, "requires one of these frontends");
    });
  }

  it("adds the registry to an existing React project", async () => {
    const created = await runCreateTest({
      projectName: "shadcn-registry-add",
      frontend: ["tanstack-router"],
    });

    expectSuccess(created);

    const addResult = await add({
      projectDir: created.projectDir,
      addons: ["shadcn-registry"],
      install: false,
    });

    expect(addResult?.success).toBe(true);

    const registry = sourceRegistrySchema.parse(
      JSON.parse(await readFile(join(created.projectDir, "registry.json"), "utf-8")),
    );
    expect(registry.name).toBe("shadcn-registry-add");
    expect(existsSync(join(created.projectDir, "registry", "ui", "card.tsx"))).toBe(true);

    const btsConfig = await readFile(join(created.projectDir, "bts.jsonc"), "utf-8");
    expect(btsConfig).toContain("shadcn-registry");
  });

  it("rejects the addon on an incompatible project during add", async () => {
    const created = await runCreateTest({
      projectName: "shadcn-registry-add-fail",
      frontend: ["nuxt"],
      api: "orpc",
    });

    expectSuccess(created);

    const addResult = await add({
      projectDir: created.projectDir,
      addons: ["shadcn-registry"],
      install: false,
    });

    expect(addResult?.success).toBe(false);
    expect(addResult?.error).toContain("requires one of these frontends");
  });
});
