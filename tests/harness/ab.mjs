// A/B duel: weights/flags A vs B on both sides of the field battle and the building assault.
//   node ab.mjs '<json A>' '<json B>' [seeds=6]
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const A = JSON.parse(process.argv[2] ?? "{}"), B = JSON.parse(process.argv[3] ?? "{}"), SEEDS = Number(process.argv[4] ?? 6);
const run = (scen, seed, bw1, bw2) => new Promise((res) => {
  const ch = spawn("node", [path.join(here, "run.mjs"), scen, "-", `seed=${seed}`], { env: { ...process.env, WAR_BW_1: JSON.stringify(bw1), WAR_BW_2: JSON.stringify(bw2) }, stdio: ["ignore", "pipe", "ignore"] });
  let out = ""; ch.stdout.on("data", (b) => { out += b; }); ch.on("close", () => { try { res(JSON.parse(out.trim().split("\n").pop())); } catch { res(undefined); } });
});
const START = { field: [8, 8], assault: [8, 6] };
const jobs = [];
for (let k = 0; k < SEEDS; k++) for (const scen of ["field", "assault"]) for (const side of [1, 2]) jobs.push({ scen, seed: 3000 + k * 7919, side });
const res = []; let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) { const j = jobs[i++]; const r = await run(j.scen, j.seed, j.side === 1 ? A : B, j.side === 1 ? B : A); res.push({ ...j, r }); } }));
for (const scen of ["field", "assault"]) for (const side of [1, 2]) {
  const rs = res.filter((x) => x.scen === scen && x.side === side && x.r);
  const [n1, n2] = START[scen];
  const sc = rs.map((x) => side === 1 ? x.r.str1 / n1 - x.r.str2 / n2 : x.r.str2 / n2 - x.r.str1 / n1);
  const wins = sc.filter((v) => v > 0).length;
  console.log(`${scen} A as ${side === 1 ? (scen === "assault" ? "attacker" : "side 1") : (scen === "assault" ? "defender" : "side 2")}: A wins ${wins}/${sc.length}, mean margin ${(sc.reduce((a, b) => a + b, 0) / (sc.length || 1)).toFixed(3)}`);
}
const all = res.filter((x) => x.r).map((x) => { const [n1, n2] = START[x.scen]; return x.side === 1 ? x.r.str1 / n1 - x.r.str2 / n2 : x.r.str2 / n2 - x.r.str1 / n1; });
console.log(`OVERALL A margin ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(3)}, A wins ${all.filter((v) => v > 0).length}/${all.length}`);
