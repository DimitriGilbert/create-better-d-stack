import type { ProjectConfig } from "@better-t-stack/types";

import type { JsonValue } from "../core/json-types";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { addPackageDependency } from "../utils/add-deps";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  "lint-staged"?: Record<string, string | string[]>;
  [key: string]: JsonValue | undefined;
};

function appendGitignoreLines(vfs: VirtualFileSystem, lines: string[]): void {
  const gitignore = vfs.readFile(".gitignore");
  if (gitignore === undefined) return;

  const existing = new Set(gitignore.split("\n").map((line) => line.trim()));
  const additions = lines.filter((line) => !existing.has(line));
  if (additions.length === 0) return;

  vfs.writeFile(".gitignore", `${gitignore.trimEnd()}\n\n${additions.join("\n")}\n`);
}

export function processAddonsDeps(vfs: VirtualFileSystem, config: ProjectConfig): void {
  if (!config.addons || config.addons.length === 0) return;

  const hasViteReactFrontend =
    config.frontend.includes("react-router") || config.frontend.includes("tanstack-router");
  const hasSolidFrontend = config.frontend.includes("solid");
  const hasPwaCompatibleFrontend = hasViteReactFrontend || hasSolidFrontend;
  const hasEvlogWebServer = config.frontend.some((frontend) =>
    ["next", "nuxt", "svelte", "tanstack-start", "astro"].includes(frontend),
  );

  if (config.addons.includes("turborepo")) {
    addPackageDependency({ vfs, packagePath: "package.json", devDependencies: ["turbo"] });
  }

  if (config.addons.includes("nx")) {
    addPackageDependency({ vfs, packagePath: "package.json", devDependencies: ["nx"] });
  }

  if (config.addons.includes("vite-plus")) {
    addPackageDependency({
      vfs,
      packagePath: "package.json",
      devDependencies: ["vite-plus", "rolldown"],
    });
  }

  if (config.addons.includes("evlog") || config.addons.includes("axiom")) {
    const serverPkgPath = "apps/server/package.json";
    if (vfs.exists(serverPkgPath) && config.backend !== "self" && config.backend !== "none") {
      addPackageDependency({ vfs, packagePath: serverPkgPath, dependencies: ["evlog"] });
    }

    const webPkgPath = "apps/web/package.json";
    if (vfs.exists(webPkgPath) && hasEvlogWebServer) {
      addPackageDependency({
        vfs,
        packagePath: webPkgPath,
        dependencies: config.frontend.includes("tanstack-start") ? ["evlog", "nitro"] : ["evlog"],
      });
    }
  }

  if (config.addons.includes("pwa") && hasPwaCompatibleFrontend) {
    const webPkgPath = "apps/web/package.json";
    if (vfs.exists(webPkgPath)) {
      addPackageDependency({
        vfs,
        packagePath: webPkgPath,
        dependencies: ["vite-plugin-pwa"],
        devDependencies: ["@vite-pwa/assets-generator"],
      });
      const webPkg = vfs.readJson<PackageJson>(webPkgPath);
      if (webPkg) {
        webPkg.scripts = { ...webPkg.scripts, "generate-pwa-assets": "pwa-assets-generator" };
        vfs.writeJson(webPkgPath, webPkg);
      }
    }
  }

  if (config.addons.includes("tauri")) {
    const webPkgPath = "apps/web/package.json";
    if (vfs.exists(webPkgPath)) {
      addPackageDependency({ vfs, packagePath: webPkgPath, devDependencies: ["@tauri-apps/cli"] });
      const webPkg = vfs.readJson<PackageJson>(webPkgPath);
      if (webPkg) {
        webPkg.scripts = {
          ...webPkg.scripts,
          tauri: "tauri",
          "desktop:dev": "tauri dev",
          "desktop:build": "tauri build",
        };
        vfs.writeJson(webPkgPath, webPkg);
      }
    }
  }

  if (config.addons.includes("cli")) {
    const cliPkgPath = "apps/cli/package.json";
    if (vfs.exists(cliPkgPath)) {
      addPackageDependency({
        vfs,
        packagePath: cliPkgPath,
        dependencies: ["commander"],
        devDependencies: ["typescript", "tsdown", "tsx", "@types/node"],
        customDevDependencies: {
          [`@${config.projectName}/config`]: config.packageManager === "npm" ? "*" : "workspace:*",
        },
      });

      // The `testing` addon's shared vitest factory is the marker: when it
      // exists, wire vitest into apps/cli. The reverse direction (`add testing`
      // onto a project that already has apps/cli) is handled by the testing
      // addon's own post-loop emission pass, not this block.
      if (vfs.exists("packages/config/vitest/base.ts")) {
        addPackageDependency({
          vfs,
          packagePath: cliPkgPath,
          customDevDependencies: {
            vitest: "^4.1.12",
            "@vitest/coverage-istanbul": "^4.1.12",
          },
        });
        const cliPkg = vfs.readJson<PackageJson>(cliPkgPath);
        if (cliPkg) {
          cliPkg.scripts = {
            ...cliPkg.scripts,
            test: "vitest run",
            "test:coverage": "vitest run --coverage",
          };
          vfs.writeJson(cliPkgPath, cliPkg);
        }
      }
    }
  }

  if (config.addons.includes("shadcn-registry") && vfs.exists("packages/ui/package.json")) {
    const rootPkgPath = "package.json";
    addPackageDependency({ vfs, packagePath: rootPkgPath, devDependencies: ["shadcn"] });
    const rootPkg = vfs.readJson<PackageJson>(rootPkgPath);
    if (rootPkg) {
      // shadcn resolves item file paths relative to its CWD, so the build must
      // run from the project root. Prepending to the root `build` script keeps
      // it runner-agnostic: whatever command orchestrates the app build runs
      // after the registry output is emitted.
      const registryBuild = "shadcn build registry.json --output apps/web/public/r";
      rootPkg.scripts = { ...rootPkg.scripts, "registry:build": registryBuild };
      const buildScript = rootPkg.scripts.build;
      if (buildScript && !buildScript.includes("shadcn build")) {
        rootPkg.scripts.build = `${registryBuild} && ${buildScript}`;
      }
      vfs.writeJson(rootPkgPath, rootPkg);
    }
    appendGitignoreLines(vfs, ["# shadcn registry output", "apps/web/public/r/"]);
  }
}
