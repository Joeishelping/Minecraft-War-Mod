// The acceptance suite: ten things the War Engine must get right, each with a pass mark, run on several seeds for one
// or two script folders and printed as a PASS/FAIL table. Bullets drop (g=0.05, k=0.99) as the gun pack's do.
//   node accept.mjs <seeds> <dirA> [dirB]
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [nSeeds = "3", A = "-", B] = process.argv.slice(2);
const dirs = B ? [A, B] : [A];
const PHYS = ["g=0.05", "k=0.99"];
const RUNS = [
  ["siegeOut", "siege", ["mode=out", ...PHYS]],
  ["siegeIn", "siege", ["mode=in", ...PHYS]],
  ["bigSiege", "bigSiege", PHYS],
  ["flat30", "trip", ["mode=flat", "n=30", "ticks=4800"]],
  ["down8", "trip", ["mode=down", "n=8", "ticks=2400"]],
  ["up8", "trip", ["mode=up", "n=8", "ticks=2400"]],
  ["roamDown", "roamTest", ["mode=roam", "at=down", "ticks=1200"]],
  ["big90", "big", ["n=90", "ticks=600"]],
];
const run = (dir, [name, scen, args], seed) => new Promise((res) => {
  execFile("node", [path.join(here, "run.mjs"), scen, dir, `seed=${seed * 7919}`, ...args], { timeout: 1200000, maxBuffer: 1 << 26 }, (err, out) => {
    try { res({ name, d: JSON.parse(String(out).trim().split("\n").pop()) }); } catch { res({ name, d: { crash: 1 } }); }
  });
});
const CRIT = [
  ["1. No shots at men nobody can see (blind <= 3%)", (R) => R.every((r) => !["siegeOut", "siegeIn", "bigSiege"].includes(r.name) || Math.max(r.d.blindShare?.def ?? 0, r.d.blindShare?.att ?? 0, r.d.blind ?? 0) <= 0.03)],
  ["2. Rounds into cover in front of the target <= 8%", (R) => R.every((r) => !["siegeOut", "siegeIn", "bigSiege"].includes(r.name) || Math.max(r.d.coverHit?.def ?? 0, r.d.coverHit?.att ?? 0, r.d.cover ?? 0) <= 0.08)],
  ["3. Attackers reach the upper floor of the big hall within 60 s (2 of 3)", (R) => { const a = R.filter((r) => r.name === "bigSiege"); return a.filter((r) => r.d.firstUp >= 0 && r.d.firstUp <= 1200).length >= Math.ceil(a.length * 2 / 3); }],
  ["4. Defenders on the ground floor when the door is breached (every run)", (R) => R.filter((r) => r.name === "siegeOut").every((r) => (r.d.defGroundAtBreach ?? 0) >= 1)],
  ["5. 30 men march 300 blocks: 85% there within 4 min", (R) => R.filter((r) => r.name === "flat30").every((r) => r.d.arrivedTicks >= 0 && r.d.arrivedTicks <= 4800)],
  ["6. 8 men in/out of a building over 160 blocks: 85% there within 2 min", (R) => R.filter((r) => r.name === "down8" || r.name === "up8").every((r) => r.d.arrivedTicks >= 0 && r.d.arrivedTicks <= 2400)],
  ["7. Roam ordered downstairs: 3 of 4 down within 30 s", (R) => R.filter((r) => r.name === "roamDown").every((r) => r.d.downAt >= 0 && r.d.downAt <= 600)],
  ["8. Labels tell the truth (lies <= 5%)", (R) => R.filter((r) => r.name === "bigSiege").every((r) => (r.d.labelLies ?? 1) <= 0.05)],
  ["9. 90 v 90: they meet and fight, <= 500 game calls a tick", (R) => R.filter((r) => r.name === "big90").every((r) => (r.d.shots ?? 0) > 0 && (r.d.apiCallsPerTick ?? 1e9) <= 500)],
  ["10. No script errors, no crashes", (R) => R.every((r) => !r.d.crash && !r.d.loadError && (r.d.errorCount ?? 0) === 0)],
];
for (const dir of dirs) {
  const jobs = [];
  for (let s = 1; s <= Number(nSeeds); s++) for (const R of RUNS) jobs.push([R, s]);
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < jobs.length) { const [R, s] = jobs[i++]; results.push(await run(dir, R, s)); } }));
  console.log(`\n=== ${dir === "-" ? "current" : path.basename(dir)}`);
  let pass = 0;
  for (const [label, f] of CRIT) { let ok = false; try { ok = f(results); } catch {} if (ok) pass++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); }
  console.log(`  ${pass}/10 passed`);
  const brief = (r) => ({ blind: r.d.blindShare ?? r.d.blind, cover: r.d.coverHit ?? r.d.cover, firstUp: r.d.firstUp, defGroundAtBreach: r.d.defGroundAtBreach, arrived: r.d.arrivedTicks, there: r.d.there, downAt: r.d.downAt, lies: r.d.labelLies, calls: r.d.apiCallsPerTick, shots: r.d.shots, err: r.d.errorCount, crash: r.d.crash });
  for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) console.log(`    ${r.name.padEnd(9)} ${JSON.stringify(Object.fromEntries(Object.entries(brief(r)).filter(([, v]) => v !== undefined)))}`);
}
