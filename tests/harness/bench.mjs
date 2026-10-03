// Runs scenarios over several seeds for one or two script folders and prints averages side by side.
//   node bench.mjs "<scenario,scenario>" <seeds> <dirA> [dirB]
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [scen = "stairsDown,stairsUp", nSeeds = "4", A = "-", B] = process.argv.slice(2);
const dirs = B ? [A, B] : [A];
const pick = (d) => {
  const o = {};
  for (const k of ["arrivedTicks", "bunchAvg", "maxCluster", "apiCallsPerTick", "defendersLeft", "attackersLeft", "firstAttackerUpstairs", "simMsPerTick", "errorCount", "outside", "top", "ticks", "there", "worstStillSec", "bigTp", "clips", "attackersUp", "enemiesUp", "flipsMean", "flipsMax", "fellCourtyard", "fellMoat", "crossed", "firstCross", "defendersUp"]) if (d[k] !== undefined) o[k] = d[k];
  for (const side of ["attackerShots", "defenderShots"]) if (d[side]) { o[`${side}.wasted`] = d[side].wasted; o[`${side}.n`] = d[side].shots; o[`${side}.meanDist`] = d[side].meanDistReal; o[`${side}.noEnemy`] = d[side].noEnemy; o[`${side}.hit`] = d[side].hit; }
  return o;
};
for (const s of scen.split(",")) {
  const rows = dirs.map(() => []);
  for (let k = 1; k <= Number(nSeeds); k++) dirs.forEach((dir, j) => {
    try { const out = execFileSync("node", [path.join(here, "run.mjs"), s, dir, `seed=${k * 7919}`], { encoding: "utf8", timeout: 900000, stdio: ["ignore", "pipe", "ignore"] }); rows[j].push(pick(JSON.parse(out.trim().split("\n").pop()))); }
    catch (err) { rows[j].push({ crash: 1 }); }
  });
  console.log(`== ${s}`);
  rows.forEach((r, j) => {
    const keys = [...new Set(r.flatMap((x) => Object.keys(x)))];
    const sum = {};
    for (const key of keys) {
      const v = r.map((x) => x[key]).filter((x) => x !== undefined);
      if (key === "arrivedTicks" || key === "firstAttackerUpstairs") { const ok = v.filter((x) => x >= 0); sum[key] = `${ok.length}/${v.length} ok, mean ${ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : "-"}`; }
      else sum[key] = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2);
    }
    console.log(`  ${dirs[j] === "-" ? "current" : path.basename(dirs[j])}: ${JSON.stringify(sum)}`);
  });
}
