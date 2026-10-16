/**
 * quality:report — aggregate coverage, CRAP, and duplication reports into a
 * single self-contained HTML dashboard at reports/quality/index.html plus a
 * machine-readable reports/quality/summary.json. Report-only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CRAP_THRESHOLD = 30;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = path.join(repoRoot, "reports", "quality");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}

function collectPackages() {
  const packages = [];
  for (const scope of ["apps", "packages"]) {
    const scopeDir = path.join(repoRoot, scope);
    if (!existsSync(scopeDir)) continue;
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      packages.push({ name: `${scope}/${entry.name}`, dir: path.join(scopeDir, entry.name) });
    }
  }
  return packages;
}

// istanbul coverage-final.json is a per-file map: fnMap/branchMap/statementMap
// give locations, f/b/s give hit counts keyed to the same ids.
function summarizeCoverage(coverageMap) {
  const totals = {
    statements: 0,
    coveredStatements: 0,
    functions: 0,
    coveredFunctions: 0,
    branches: 0,
    coveredBranches: 0,
  };
  const lines = new Set();
  const coveredLines = new Set();

  for (const file of Object.values(coverageMap)) {
    if (!file) continue;
    for (const [id, hits] of Object.entries(file.s ?? {})) {
      totals.statements += 1;
      if (hits > 0) totals.coveredStatements += 1;
      const loc = file.statementMap?.[id]?.start?.line;
      if (loc != null) {
        lines.add(`${file.path}:${loc}`);
        if (hits > 0) coveredLines.add(`${file.path}:${loc}`);
      }
    }
    for (const hits of Object.values(file.f ?? {})) {
      totals.functions += 1;
      if (hits > 0) totals.coveredFunctions += 1;
    }
    for (const hits of Object.values(file.b ?? {})) {
      const counts = Array.isArray(hits) ? hits : [hits];
      totals.branches += counts.length;
      for (const count of counts) {
        if (count > 0) totals.coveredBranches += 1;
      }
    }
  }

  const pct = (covered, total) => (total === 0 ? 100 : (covered / total) * 100);
  return {
    statements: pct(totals.coveredStatements, totals.statements),
    functions: pct(totals.coveredFunctions, totals.functions),
    branches: pct(totals.coveredBranches, totals.branches),
    lines: pct(coveredLines.size, lines.size),
  };
}

const coverage = [];
for (const pkg of collectPackages()) {
  const coverageFile = path.join(pkg.dir, "coverage", "coverage-final.json");
  if (!existsSync(coverageFile)) continue;
  const map = readJson(coverageFile);
  if (map) coverage.push({ name: pkg.name, ...summarizeCoverage(map) });
}

const crapReportsDir = path.join(repoRoot, "reports", "crap");
const crapOffenders = [];
// crap-score's CrapReportJsonObject: { [sourcePath]: { [functionName]: { statements: { crap } } } }
if (existsSync(crapReportsDir)) {
  for (const file of readdirSync(crapReportsDir)) {
    if (!file.endsWith(".json")) continue;
    const report = readJson(path.join(crapReportsDir, file));
    if (!report) continue;
    let parsed = 0;
    for (const [sourcePath, functions] of Object.entries(report)) {
      if (!functions) continue;
      for (const [functionName, fn] of Object.entries(functions)) {
        const crap = Number(fn?.statements?.crap);
        if (!Number.isFinite(crap)) continue;
        parsed += 1;
        if (crap >= CRAP_THRESHOLD) {
          crapOffenders.push({
            package: file.replace(/\.json$/, ""),
            name: `${functionName} (${sourcePath})`,
            crap,
          });
        }
      }
    }
    if (parsed === 0 && Object.keys(report).length > 0) {
      console.warn(
        `crap report ${file} parsed zero functions — the report shape may have changed.`,
      );
    }
  }
}
crapOffenders.sort((a, b) => b.crap - a.crap);

const jscpdReport = readJson(path.join(repoRoot, "reports", "jscpd", "jscpd-report.json"));
const duplication = jscpdReport?.statistics?.total
  ? {
      percentage: jscpdReport.statistics.total.percentage ?? 0,
      clones: jscpdReport.statistics.total.clones ?? 0,
    }
  : undefined;

const summary = { generatedAt: new Date().toISOString(), coverage, crapOffenders, duplication };
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const esc = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const fmtPct = (value) => `${value.toFixed(1)}%`;

const coverageRows = coverage
  .map(
    (row) =>
      `<tr><td>${esc(row.name)}</td><td>${fmtPct(row.lines)}</td><td>${fmtPct(
        row.statements,
      )}</td><td>${fmtPct(row.functions)}</td><td>${fmtPct(row.branches)}</td></tr>`,
  )
  .join("\n");

const crapRows = crapOffenders
  .map(
    (row) =>
      `<tr><td>${esc(row.package)}</td><td>${esc(row.name)}</td><td>${row.crap.toFixed(1)}</td></tr>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Quality report</title>
<style>
  body { font-family: ui-monospace, monospace; margin: 2rem; background: #0d1117; color: #c9d1d9; }
  h1, h2 { color: #f0f6fc; }
  table { border-collapse: collapse; margin-bottom: 2rem; min-width: 32rem; }
  th, td { border: 1px solid #30363d; padding: 0.4rem 0.8rem; text-align: left; }
  th { background: #161b22; }
  .muted { color: #8b949e; }
</style>
</head>
<body>
<h1>Quality report</h1>
<p class="muted">Generated ${esc(summary.generatedAt)}</p>

<h2>Coverage</h2>
${
  coverage.length === 0
    ? '<p class="muted">No coverage data — run the coverage suite first.</p>'
    : `<table><thead><tr><th>Package</th><th>Lines</th><th>Statements</th><th>Functions</th><th>Branches</th></tr></thead><tbody>\n${coverageRows}\n</tbody></table>`
}

<h2>CRAP &ge; ${CRAP_THRESHOLD}</h2>
${
  crapOffenders.length === 0
    ? '<p class="muted">No functions above the CRAP threshold.</p>'
    : `<table><thead><tr><th>Package</th><th>Function</th><th>CRAP</th></tr></thead><tbody>\n${crapRows}\n</tbody></table>`
}

<h2>Duplication</h2>
${
  duplication === undefined
    ? '<p class="muted">No jscpd report — run quality:duplication first.</p>'
    : `<p>${fmtPct(duplication.percentage)} duplicated across ${duplication.clones} clone(s).</p>`
}
</body>
</html>
`;

writeFileSync(path.join(outDir, "index.html"), html);
console.log(`Quality report written to ${path.relative(repoRoot, outDir)}/index.html`);
