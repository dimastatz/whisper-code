// Fails when any coverage metric in coverage/coverage-summary.json is below the threshold.
import { readFileSync } from "node:fs";

const threshold = Number(process.argv[2] ?? 95);
const { total } = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));

let failed = false;
for (const metric of ["lines", "statements", "functions", "branches"]) {
  const pct = total[metric].pct;
  const ok = pct >= threshold;
  failed ||= !ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${metric}: ${pct}% (threshold ${threshold}%)`);
}

if (failed) {
  process.exit(1);
}
