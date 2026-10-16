/**
 * quality:crap — run crap-score against every workspace's istanbul
 * coverage-final.json and print the functions whose CRAP score is >= 30.
 *
 * CRAP (Change Risk Anti-Patterns) = complexity^2 * (1 - coverage)^3 + complexity.
 * Report-only: this script always exits 0. Run `<pm> test:coverage` first.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CRAP_THRESHOLD = 30;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const crapBin = path.join(repoRoot, "node_modules", ".bin", "crap");
const reportsDir = path.join(repoRoot, "reports", "crap");

if (!existsSync(crapBin)) {
  console.error(
    `crap-score binary not found at ${crapBin} — run your package manager's install first.`,
  );
  process.exit(0);
}

mkdirSync(reportsDir, { recursive: true });

function collectCoverageFiles() {
  const files = [];
  for (const scope of ["apps", "packages"]) {
    const scopeDir = path.join(repoRoot, scope);
    if (!existsSync(scopeDir)) continue;
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const coverageFile = path.join(scopeDir, entry.name, "coverage", "coverage-final.json");
      if (!existsSync(coverageFile)) continue;
      // crap-score crashes on empty coverage maps (getRootDir reads keys[0]).
      try {
        if (Object.keys(JSON.parse(readFileSync(coverageFile, "utf-8"))).length === 0) {
          continue;
        }
      } catch {
        continue;
      }
      files.push({ dir: `${scope}/${entry.name}`, coverageFile });
    }
  }
  return files;
}

// crap-score's CrapReportJsonObject is a nested map:
//   { [sourcePath]: { [functionName]: { complexity, statements: { crap }, functionDescriptor } } }
function collectOffenders(report, dir) {
  const offenders = [];
  let parsed = 0;
  for (const [sourcePath, functions] of Object.entries(report)) {
    if (!functions) continue;
    for (const [functionName, fn] of Object.entries(functions)) {
      const crap = Number(fn?.statements?.crap);
      if (!Number.isFinite(crap)) continue;
      parsed += 1;
      if (crap >= CRAP_THRESHOLD) {
        offenders.push({ dir, sourcePath, functionName, crap });
      }
    }
  }
  if (parsed === 0 && Object.keys(report).length > 0) {
    console.warn(
      `crap report for ${dir} parsed zero functions — the report shape may have changed.`,
    );
  }
  return offenders;
}

const coverageFiles = collectCoverageFiles();
if (coverageFiles.length === 0) {
  console.log(
    "No coverage-final.json files found — run the coverage suite first (e.g. `test:coverage`).",
  );
  process.exit(0);
}

const offenders = [];

for (const { dir, coverageFile } of coverageFiles) {
  const safeName = dir.replaceAll("/", "-");
  const jsonOut = path.join(reportsDir, `${safeName}.json`);
  const htmlOut = path.join(reportsDir, `${safeName}-html`);

  // Report-only: a single bad coverage file must not abort the pipeline.
  try {
    execFileSync(crapBin, [`--json=${jsonOut}`, `--html=${htmlOut}`, coverageFile], {
      stdio: "inherit",
      cwd: repoRoot,
    });
  } catch (error) {
    console.warn(`crap-score failed for ${dir}: ${error instanceof Error ? error.message : error}`);
    continue;
  }

  try {
    const report = JSON.parse(readFileSync(jsonOut, "utf-8"));
    offenders.push(...collectOffenders(report, dir));
  } catch {
    console.warn(`Could not parse crap report for ${dir} — see ${jsonOut}`);
  }
}

if (offenders.length === 0) {
  console.log(`No functions at or above CRAP ${CRAP_THRESHOLD}.`);
} else {
  console.log(`\nFunctions with CRAP >= ${CRAP_THRESHOLD}:`);
  for (const offender of offenders.sort((a, b) => b.crap - a.crap)) {
    console.log(
      `  ${offender.crap.toFixed(1)}  ${offender.dir}  ${offender.functionName} (${offender.sourcePath})`,
    );
  }
}
