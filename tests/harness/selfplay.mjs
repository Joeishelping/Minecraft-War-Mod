// Self-play tuning of the squad brain's weights (BW): a mutant fights the current best on both sides of two scenarios
// (an open field with cover, and the building assault, attacking and defending). It replaces the best only if it wins
// clearly. The add-on's own code runs both sides; only the weights differ.
//   node selfplay.mjs [generations=12] [seeds=2]
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const GENS = Number(process.argv[2] ?? 12), SEEDS = Number(process.argv[3] ?? 2), POOL = 4;
const SPACE = {   // name: [min, max]
  fire: [0.2, 1.5], expo: [0, 1.2], adv: [0.3, 1.6], close: [0.2, 1], timing: [0, 1.6], assault: [0, 1.6], cover: [0, 1.6],
  peek: [0, 1.6], supp: [0, 1.6], fall: [0, 1], flankShare: [0.1, 0.5], stallT: [60, 400], ratioFix: [0.8, 2.5], commit: [6, 30], headK: [0.5, 0.95],
};
const start = JSON.parse(process.env.BW_START ?? "null") ?? {"fire":0.516,"expo":0.418,"adv":0.933,"close":0.55,"timing":0.884,"assault":0.899,"cover":0.439,"peek":0.72,"supp":0.5,"fall":0.155,"flankShare":0.17,"stallT":252.376,"ratioFix":1.483,"commit":10,"headK":0.75};
let rs = 99; const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
function mutate(p) {
  const q = { ...p }, keys = Object.keys(SPACE);
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) { const k = keys[Math.floor(rnd() * keys.length)], [lo, hi] = SPACE[k]; q[k] = +Math.min(hi, Math.max(lo, q[k] + gauss() * (hi - lo) * 0.25)).toFixed(3); }
  return q;
}
function run(scen, seed, bw1, bw2) {
  return new Promise((res) => {
    const ch = spawn("node", [path.join(here, "run.mjs"), scen, "-", `seed=${seed}`], { env: { ...process.env, WAR_BW_1: JSON.stringify(bw1), WAR_BW_2: JSON.stringify(bw2) }, stdio: ["ignore", "pipe", "ignore"] });
    let out = ""; ch.stdout.on("data", (b) => { out += b; });
    const kill = setTimeout(() => ch.kill(), 600000);
    ch.on("close", () => { clearTimeout(kill); try { res(JSON.parse(out.trim().split("\n").pop())); } catch { res(undefined); } });
  });
}
async function pool(jobs) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: POOL }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); } }));
  return out;
}
// score from the candidate's side: its surviving strength share minus the other side's (each normalized by its start)
const START = { field: [8, 8], assault: [8, 4] };   // [faction 1, faction 2]
function score(r, scen, candSide) {
  if (!r || r.errorCount) return -1;
  const [n1, n2] = START[scen], s1 = r.str1 / n1, s2 = r.str2 / n2;
  return candSide === 1 ? s1 - s2 : s2 - s1;
}
async function duel(cand, inc, seeds, tag) {
  const jobs = [];
  for (let k = 0; k < seeds; k++) for (const scen of ["field", "assault"]) {
    const seed = 1000 + k * 7919 + (tag ?? 0);
    jobs.push(async () => score(await run(scen, seed, cand, inc), scen, 1));   // candidate as faction 1 (field: one side; assault: attacker)
    jobs.push(async () => score(await run(scen, seed, inc, cand), scen, 2));   // candidate as faction 2 (field: other side; assault: defender)
  }
  const s = await pool(jobs);
  return s.reduce((a, b) => a + b, 0) / s.length;
}
let best = { ...start };
const log = [];
for (let g = 1; g <= GENS; g++) {
  const muts = Array.from({ length: 2 }, () => mutate(best));
  const scores = [];
  for (const m of muts) scores.push(await duel(m, best, SEEDS, g * 13));
  const bi = scores.indexOf(Math.max(...scores));
  let line = `gen ${g}: mutant scores ${scores.map((x) => x.toFixed(3)).join(" ")}`;
  if (scores[bi] > 0.12) {                                       // promising: confirm on fresh seeds before adopting (no luck)
    const again = await duel(muts[bi], best, SEEDS, g * 13 + 5000);
    line += ` re-check ${again.toFixed(3)}`;
    if (again > 0.06) { best = muts[bi]; log.push(`${line} -> adopted ${JSON.stringify(best)}`); }
    else log.push(`${line} -> kept`);
  } else log.push(`${line} -> kept`);
  console.log(log[log.length - 1]);
}
// final check against the starting weights on fresh seeds
const final = await duel(best, start, 4, 777);
console.log(`final vs start (fresh seeds, + = better): ${final.toFixed(3)}`);
console.log(`BEST ${JSON.stringify(best)}`);
fs.writeFileSync(path.join(here, "selfplay-result.json"), JSON.stringify({ best, start, finalVsStart: final, log }, null, 2));
