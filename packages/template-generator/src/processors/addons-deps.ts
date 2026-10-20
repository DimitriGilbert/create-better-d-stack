import type { ProjectConfig } from "@better-t-stack/types";

import type { JsonValue } from "../core/json-types";
import type { VirtualFileSystem } from "../core/virtual-fs";
import { type AvailableDependencies, addPackageDependency } from "../utils/add-deps";
import { TESTED_PACKAGE_DIRS } from "../utils/tested-package-dirs";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  "lint-staged"?: Record<string, string | string[]>;
  [key: string]: JsonValue | undefined;
};

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
        devDependencies: config.frontend.some((f) => ["react-router", "solid"].includes(f))
          ? ["@vite-pwa/assets-generator", "workbox-window"]
          : ["@vite-pwa/assets-generator"],
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
  if (config.addons.includes("testing")) {
    const hasReactWeb = config.frontend.some((frontend) =>
      ["tanstack-router", "react-router", "tanstack-start", "next"].includes(frontend),
    );
    for (const dir of TESTED_PACKAGE_DIRS) {
      const pkgPath = `${dir}/package.json`;
      if (!vfs.exists(pkgPath)) continue;
      const devDeps: AvailableDependencies[] = ["vitest", "@vitest/coverage-istanbul"];
      if (dir === "packages/ui") {
        devDeps.push("jsdom", "@testing-library/react", "@testing-library/dom");
      } else if (dir === "apps/web" && hasReactWeb) {
        devDeps.push("jsdom");
      }
      addPackageDependency({ vfs, packagePath: pkgPath, devDependencies: devDeps });
      const pkg = vfs.readJson<PackageJson>(pkgPath);
      if (pkg) {
        // Per-package scripts stay `vitest run` under every task runner,
        // including vite-plus — the root aggregate (`vp run -r test`,
        // `turbo run test`, ...) invokes them uniformly.
        pkg.scripts = {
          ...pkg.scripts,
          test: "vitest run",
          "test:coverage": "vitest run --coverage",
        };
        vfs.writeJson(pkgPath, pkg);
      }
    }

    // packages/config/vitest/base.ts imports vitest/config (type-only, but tsc
    // still resolves it from packages/config's own node_modules — required
    // under pnpm's isolated layout).
    if (vfs.exists("packages/config/package.json")) {
      addPackageDependency({
        vfs,
        packagePath: "packages/config/package.json",
        devDependencies: ["vitest"],
      });
    }

    const root = vfs.readJson<PackageJson>("package.json");
    if (root?.scripts) {
      // `??=` preserves user-customized test scripts on the `add` path.
      root.scripts.test ??= runAllScript(vfs, config, "test");
      root.scripts["test:coverage"] ??= runAllScript(vfs, config, "test:coverage");
      vfs.writeJson("package.json", root);
    }
    // No .gitignore append needed — the base template already ignores coverage dirs.
  }

  if (config.addons.includes("e2e-testing")) {
    const root = vfs.readJson<PackageJson>("package.json");
    if (root?.scripts) {
      root.scripts["test:e2e"] = filteredScript(vfs, config, "e2e", "test:e2e");
      root.scripts["test:e2e:install"] = filteredScript(vfs, config, "e2e", "test:e2e:install");
      vfs.writeJson("package.json", root);
    }

    appendGitignoreLines(vfs, [
      "# E2E reports",
      "apps/e2e/playwright-report/",
      "apps/e2e/test-results/",
    ]);
  }

  if (config.addons.includes("quality-metrics")) {
    addPackageDependency({
      vfs,
      packagePath: "package.json",
      devDependencies: ["crap-score", "jscpd", "knip"],
    });
    const root = vfs.readJson<PackageJson>("package.json");
    if (root?.scripts) {
      const pmRun =
        config.packageManager === "npm"
          ? "npm run"
          : config.packageManager === "pnpm"
            ? "pnpm"
            : "bun run";
      root.scripts.test ??= runAllScript(vfs, config, "test");
      root.scripts["test:coverage"] ??= runAllScript(vfs, config, "test:coverage");
      root.scripts["quality:crap"] = "node scripts/quality-crap.mjs";
      root.scripts["quality:duplication"] = "jscpd --config jscpd.config.json .";
      root.scripts["quality:report"] = "node scripts/quality-report.mjs";
      root.scripts["quality:knip"] = "knip";
      root.scripts.quality = `${pmRun} test:coverage && ${pmRun} quality:crap && ${pmRun} quality:duplication && ${pmRun} quality:report`;
      vfs.writeJson("package.json", root);
    }

    appendGitignoreLines(vfs, ["# Quality reports", "reports/"]);
  }
}

/**
 * Runner detection checks both the addon list (create flow: config.addons has
 * every selected addon, but turbo.json/nx.json are written after this
 * processor runs) and VFS markers (add flow: config.addons holds only the
 * newly added addons, so an already-installed runner shows up as a file).
 */
function detectRunner(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
): "turborepo" | "nx" | "vite-plus" | "none" {
  if (config.addons.includes("turborepo") || vfs.exists("turbo.json") || vfs.exists("turbo.jsonc"))
    return "turborepo";
  if (config.addons.includes("nx") || vfs.exists("nx.json")) return "nx";
  // A bare vite.config.ts at the root is ambiguous — confirm vite-plus via
  // the addon list or the vite-plus dependency in the root manifest.
  if (config.addons.includes("vite-plus")) return "vite-plus";
  if (vfs.exists("vite.config.ts")) {
    const root = vfs.readJson<PackageJson>("package.json");
    if (root?.devDependencies?.["vite-plus"] || root?.dependencies?.["vite-plus"]) {
      return "vite-plus";
    }
  }
  return "none";
}

function runAllScript(vfs: VirtualFileSystem, config: ProjectConfig, script: string): string {
  switch (detectRunner(vfs, config)) {
    case "turborepo":
      return `turbo run ${script}`;
    case "nx":
      return `nx run-many -t ${script}`;
    case "vite-plus":
      return `vp run -r ${script}`;
  }
  switch (config.packageManager) {
    case "pnpm":
      return `pnpm -r ${script}`;
    case "npm":
      return `npm run ${script} --workspaces --if-present`;
    default:
      return `bun run --filter '*' ${script}`;
  }
}

function filteredScript(
  vfs: VirtualFileSystem,
  config: ProjectConfig,
  workspace: string,
  script: string,
): string {
  switch (detectRunner(vfs, config)) {
    case "turborepo":
      return `turbo run ${script} -F ${workspace} --`;
    case "nx":
      return `nx run-many -t ${script} --projects=${workspace}`;
    case "vite-plus":
      return `vp run --filter ${workspace} ${script}`;
  }
  switch (config.packageManager) {
    case "pnpm":
      return `pnpm --filter ${workspace} ${script}`;
    case "npm":
      return `npm run ${script} --workspace ${workspace} --`;
    default:
      return `bun run --filter ${workspace} ${script}`;
  }
}

function appendGitignoreLines(vfs: VirtualFileSystem, lines: string[]): void {
  const existing = vfs.readFile(".gitignore") ?? "";
  const existingLines = new Set(existing.split("\n").map((line) => line.trimEnd()));
  const missing = lines.filter((line) => !existingLines.has(line));
  if (missing.length === 0) return;
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  vfs.writeFile(".gitignore", `${existing}${separator}${missing.join("\n")}\n`);
}
