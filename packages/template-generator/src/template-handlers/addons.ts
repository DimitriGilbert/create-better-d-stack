import { SERVER_BACKENDS, type ProjectConfig } from "@better-t-stack/types";

import type { VirtualFileSystem } from "../core/virtual-fs";
import { type TemplateData, processTemplatesFromPrefix } from "./utils";

/**
 * Package dirs that receive vitest config + smoke tests when the testing
 * addon is enabled. Emitted after the addon loop so packages written by
 * sibling addons (electrobun's apps/desktop, cli's apps/cli) are visible.
 */
const TESTED_PACKAGE_DIRS = [
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

export async function processAddonTemplates(
  vfs: VirtualFileSystem,
  templates: TemplateData,
  config: ProjectConfig,
): Promise<void> {
  if (!config.addons || config.addons.length === 0) return;

  // Emit the shared vitest config factory before the loop so sibling addons
  // can observe it (e.g. the cli addon checks for packages/config/vitest).
  if (config.addons.includes("testing")) {
    processTemplatesFromPrefix(vfs, templates, "addons/testing/shared", "", config);
  }

  for (const addon of config.addons) {
    if (addon === "none") continue;

    // Task runners are handled programmatically by generators.
    if (addon === "turborepo" || addon === "nx" || addon === "vite-plus") continue;

    // testing's shared files already emitted above; its per-package files are
    // emitted after the loop. quality-metrics templates are copied verbatim
    // via the default dispatch below.
    if (addon === "testing") continue;

    if (addon === "e2e-testing") {
      processTemplatesFromPrefix(vfs, templates, "addons/e2e-testing/base", "", config);
      if (vfs.directoryExists("apps/web")) {
        processTemplatesFromPrefix(vfs, templates, "addons/e2e-testing/web", "", config);
      }
      const hasHttpBackend = SERVER_BACKENDS.includes(config.backend) || config.backend === "self";
      if (hasHttpBackend) {
        processTemplatesFromPrefix(vfs, templates, "addons/e2e-testing/api", "", config);
      }
      continue;
    }

    if (addon === "pwa") {
      if (
        config.frontend.some((frontend) => ["solid", "react-router", "next"].includes(frontend))
      ) {
        processTemplatesFromPrefix(vfs, templates, "addons/pwa/apps/web/ssr", "apps/web", config);
      }
      if (config.frontend.includes("next")) {
        processTemplatesFromPrefix(vfs, templates, "addons/pwa/apps/web/next", "apps/web", config);
      } else if (
        config.frontend.some((f) => ["tanstack-router", "react-router", "solid"].includes(f))
      ) {
        processTemplatesFromPrefix(vfs, templates, "addons/pwa/apps/web/vite", "apps/web", config);
      }
      continue;
    }

    processTemplatesFromPrefix(vfs, templates, `addons/${addon}`, "", config);
  }

  if (config.addons.includes("testing")) {
    for (const dir of TESTED_PACKAGE_DIRS) {
      if (!vfs.exists(`${dir}/package.json`)) continue;
      if (dir === "apps/web" && config.frontend.includes("nuxt")) {
        // Nuxt apps have app/ instead of src/
        processTemplatesFromPrefix(vfs, templates, "addons/testing/apps/web", dir, config);
        processTemplatesFromPrefix(vfs, templates, "addons/testing/apps-web-nuxt", dir, config);
      } else if (dir === "apps/web") {
        processTemplatesFromPrefix(vfs, templates, "addons/testing/apps/web", dir, config);
        processTemplatesFromPrefix(vfs, templates, "addons/testing/apps-web-src", dir, config);
      } else {
        processTemplatesFromPrefix(vfs, templates, `addons/testing/${dir}`, dir, config);
      }
    }
  }
}
