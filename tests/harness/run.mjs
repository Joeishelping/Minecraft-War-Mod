// Runs one scenario against a copy of the add-on's scripts and prints a JSON report.
//   node run.mjs <scenario> [scriptsDir]     (scriptsDir defaults to the add-on's own scripts)
// Each scenario runs in its own process so module state never leaks between runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as MC from "./mc.js";
const { SIM, overworld, step, fill, setBlock, finishLoading, loadDefs, Player, timing } = MC;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const scenario = process.argv[2] ?? "load";
const scriptsDir = path.resolve(process.argv[3] && process.argv[3] !== "-" ? process.argv[3] : path.join(root, "War Engine BP/scripts"));
const opt = Object.fromEntries((process.argv.slice(4)).map((a) => a.split("=")));
const runDir = path.join(here, `run_${process.pid}`);
fs.mkdirSync(runDir, { recursive: true });
fs.cpSync(scriptsDir, runDir, { recursive: true });
// expose the add-on's internals to the scenarios (appended to the copy only)
const HOOK = ["getLearned", "learned", "generals", "planRoute", "BW", "BW_F", "HEAD_K", "medicMove", "shakenMove", "waterExit", "followPersonal", "spreadMove", "combatMove", "engagement", "reinforceMove", "patrolSweep", "marker", "think", "routeOf", "lookahead", "queuedBehind", "climbing", "laneOf", "trackIdx", "giveOrder", "startMarch", "giveFunction", "setupSoldier", "sd", "perc", "squads", "getMarches", "personal", "downed", "goDown", "marker", "gunState", "brain", "notes", "setRelPair", "travel", "isDowned"];
if (opt.thinkdbg) { const f = path.join(runDir, "main.js"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("    // how far each stationary order may leave its spot to fight", "    if (globalThis.__thinkDbg) globalThis.__thinkDbg(e, engaged, cu, d);\n    // how far each stationary order may leave its spot to fight")); }
fs.appendFileSync(path.join(runDir, "main.js"), `\nglobalThis.__war = {};\n${HOOK.map((n) => `try { globalThis.__war.${n} = ${n}; } catch {}`).join("\n")}\n`);
loadDefs(path.join(root, "War Engine BP"));
SIM.gunPack = true;
MC.seed(Number(opt.seed ?? 7));
const cleanup = () => { try { fs.rmSync(runDir, { recursive: true, force: true }); } catch {} };
let W;
try {
  await import(path.join(runDir, "main.js"));
  W = globalThis.__war;
} catch (err) { cleanup(); console.log(JSON.stringify({ scenario, loadError: String(err?.stack ?? err) })); process.exit(1); }
finishLoading(); MC.debugHook();
// self-play: each side can get its own brain weights
for (const f of [1, 2]) { const j = process.env[`WAR_BW_${f}`]; if (j) W.BW_F[f] = { ...W.BW, headK: W.HEAD_K, ...JSON.parse(j) }; }
cleanup();

// ---------------------------------------------------------------- world building helpers
const SOLDIER = "war:soldier";
function building(x0, z0, opts = {}) {
  // 12x12, three floors (stand at y=0, 6, 11), 1-wide stairs, a wooden door on the -z wall, window holes upstairs
  const x1 = x0 + 11, z1 = z0 + 11;
  fill(x0, 0, z0, x1, 15, z1, "stone_bricks");
  fill(x0 + 1, 0, z0 + 1, x1 - 1, 14, z1 - 1, "air");
  fill(x0 + 1, 5, z0 + 1, x1 - 1, 5, z1 - 1, "oak_planks");
  fill(x0 + 1, 10, z0 + 1, x1 - 1, 10, z1 - 1, "oak_planks");
  // lower stairs (ground -> floor 1) along z0+1, climbing toward +x
  for (let i = 0; i < 5; i++) setBlock(x0 + 3 + i, i, z0 + 1, "oak_stairs");
  fill(x0 + 3, 5, z0 + 1, x0 + 7, 5, z0 + 1, "air");
  fill(x0 + 2, 5, z0 + 1, x0 + 2, 5, z0 + 1, "air");
  // upper stairs (floor 1 -> floor 2) along z1-1
  for (let i = 0; i < 4; i++) setBlock(x0 + 3 + i, 6 + i, z1 - 1, "oak_stairs");
  fill(x0 + 2, 10, z1 - 1, x0 + 6, 10, z1 - 1, "air");
  // door and windows on the -z wall
  setBlock(x0 + 6, 0, z0, "wooden_door"); setBlock(x0 + 6, 1, z0, "wooden_door");
  if (opts.windows !== false) for (const wx of [x0 + 2, x0 + 5, x0 + 9]) { setBlock(wx, 7, z0, "air"); setBlock(wx, 12, z0, "air"); }
  return { x0, z0, x1, z1 };
}
function hill(cx, cz, r, h) {
  for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
    const top = Math.floor(h * (1 - Math.hypot(x - cx, z - cz) / r));
    if (top > 0) fill(x, 0, z, x, top - 1, z, "grass_block");
  }
}
let player;
function spawnPlayer(at) { player = new Player(at, overworld); player.tags.add("war_f1"); return player; }
function soldier(f, at, weapon = "rifle", squad = 1, func = "hold") {
  const e = overworld.spawnEntity(SOLDIER, at, { spawnEvent: "war:init" });
  W.setupSoldier(e, { faction: f, squad, weapon, ranged: weapon !== "sword", div: "foot", radius: 8, func: "__none" }, player);
  W.giveFunction(e, func, player);
  return e;
}
const alive = (f) => [...SIM.entities.values()].filter((e) => e.isValid && e.typeId === SOLDIER && (f === undefined || e.props.get("war:faction") === f));
async function order(fac, dest, then = "hold", extra = {}) {
  await W.giveOrder(player, { faction: fac, order: 0, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: Math.floor(dest.x), cz: Math.floor(dest.z), cy: dest.y, then, ...extra });
}
// ---------------------------------------------------------------- measurements
const M = { bunchSamples: 0, bunchPairs: 0, maxCluster: 0, notes: {}, stuckSamples: 0 };
function sample(fac) {
  const list = alive(fac).filter((e) => !W.isDowned(e));
  let pairs = 0, worst = 0;
  for (const a of list) {
    let n = 0;
    for (const b of list) if (a !== b && Math.hypot(a._loc.x - b._loc.x, a._loc.z - b._loc.z) < 1.0 && Math.abs(a._loc.y - b._loc.y) < 1) n++;
    pairs += n; worst = Math.max(worst, n + 1);
  }
  if (opt.trace && SIM.tick % Number(opt.every ?? 50) === 0) console.error(SIM.tick, list.map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}${opt.trace === "2" ? ":" + (W.notes.get(e.id)?.text ?? "") + "/" + [...e.groups].filter((g) => /g_|t_/.test(g)).join(",") : ""}`).join(" | "));
  M.bunchSamples++; M.bunchPairs += pairs / 2; M.maxCluster = Math.max(M.maxCluster, worst);
  for (const e of list) {
    const n = W.notes.get(e.id); if (n && SIM.tick - n.t < 20) M.notes[n.text.replace(/\d+/g, "#")] = (M.notes[n.text.replace(/\d+/g, "#")] ?? 0) + 1;
    const lp = e.__lp; if (lp && Math.hypot(lp.x - e._loc.x, lp.z - e._loc.z) < 0.05) e.__still = (e.__still ?? 0) + 1; else e.__still = 0; e.__lp = { ...e._loc };
  }
}
function callsPerTick(ticks) {
  const out = {}; let total = 0;
  for (const [k, v] of SIM.calls) { out[k] = +(v / ticks).toFixed(1); if (!k.startsWith("~") && k !== "location") total += v; }
  return { perTick: out, apiCallsPerTick: Math.round(total / ticks) };
}
function shotStats(fac, from = 0) {
  const s = SIM.shots.filter((x) => x.t >= from && x.owner && x.owner.props?.get("war:faction") === fac);
  const far = s.filter((x) => x.dist > 80 && x.dist < 1e8).length;
  const noEnemy = s.filter((x) => x.dist >= 1e8).length;
  const real = s.filter((x) => x.dist < 1e8);
  return { suppShots: s.filter((x) => x.supp).length, suppWasted: s.filter((x) => x.supp && !x.nearEnemy).length, noEnemy, meanDistReal: real.length ? Math.round(real.reduce((t, x) => t + x.dist, 0) / real.length) : 0, shots: s.length, hit: s.filter((x) => x.hit).length, wasted: s.filter((x) => !x.nearEnemy).length, beyond80: far, meanDist: s.length ? Math.round(s.reduce((t, x) => t + (x.dist ?? 0), 0) / s.length) : 0 };
}
// note the distance from shooter to nearest enemy at each shot
const origPush = SIM.shots.push.bind(SIM.shots);
SIM.shots.push = (x) => { try { const o = x.owner; let bd = 1e9; for (const e of alive()) if (e !== o && !W.isDowned(e) && e.props.get("war:faction") !== o.props.get("war:faction")) bd = Math.min(bd, Math.hypot(e._loc.x - o._loc.x, e._loc.z - o._loc.z)); x.dist = bd; const gs = W.gunState.get(o.id); x.supp = !!(gs && !gs.target && gs.supp && gs.supp.until > SIM.tick); } catch {} return origPush(x); };
const report = (o) => { console.log(JSON.stringify({ scenario, ...o, errors: SIM.errors.slice(0, 5), errorCount: SIM.errors.length })); };

// ---------------------------------------------------------------- scenarios
const S = {
  async load() { step(40); report({ ok: SIM.errors.length === 0 }); },

  // a squad on the top floor ordered out of the building to a point outside: down two 1-wide staircases and a door
  async stairsDown() {
    const B = building(0, 0, { windows: false });
    spawnPlayer({ x: 6, y: 0, z: -40 });
    const team = []; for (let i = 0; i < 8; i++) team.push(soldier(1, { x: 3 + (i % 4) * 2 + 0.5, y: 11, z: 4 + Math.floor(i / 4) * 3 + 0.5 }, ["rifle", "smg", "semi", "mg"][i % 4]));
    step(20);
    const dest = { x: 6, y: 0, z: -30 };
    await order(1, dest);
    let arrived = -1, t0 = SIM.tick;
    for (let t = 0; t < 2400 && arrived < 0; t += 10) {
      step(10); sample(1);
      if (opt.dumpAt && SIM.tick >= Number(opt.dumpAt) && SIM.tick < Number(opt.dumpAt) + 40) for (const e of alive(1)) { const r = W.routeOf(e); console.error("D", SIM.tick, e.id.slice(-6), e._loc.x.toFixed(2), e._loc.y.toFixed(2), e._loc.z.toFixed(2), "goal", e.dyn.get("war:goal"), "cu", e.dyn.get("war:catchup"), "idx", r?.idx, "q", r ? W.queuedBehind(e, r.pts, r.idx) : "-", "next", JSON.stringify(r?.pts[r.idx + 1]), "vel", e.vel.x.toFixed(2), e.vel.y.toFixed(2), e.vel.z.toFixed(2), "walk", JSON.stringify(e.walk), "nav", JSON.stringify(e.navGoal)); }
      if (opt.trace) console.error(SIM.tick, alive(1).map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}`).join(" | "));
      const n = alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 10 && e._loc.y < 1.5).length;
      if (n >= 7) arrived = SIM.tick - t0;
    }
    const final = alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`);
    report({ arrivedTicks: arrived, outside: alive(1).filter((e) => e._loc.z < 0).length, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, final, notes: M.notes, ...callsPerTick(SIM.tick) });
  },

  // the reverse: from outside, up the stairs to the top floor
  async stairsUp() {
    building(0, 0, { windows: false });
    spawnPlayer({ x: 6, y: 0, z: -40 });
    for (let i = 0; i < 8; i++) soldier(1, { x: 2 + (i % 4) * 2 + 0.5, y: 0, z: -14 - Math.floor(i / 4) * 2 + 0.5 }, ["rifle", "smg", "semi", "mg"][i % 4]);
    step(20);
    const dest = { x: 7, y: 11, z: 6 };
    await order(1, dest);
    let arrived = -1; const t0 = SIM.tick;
    for (let t = 0; t < 2400 && arrived < 0; t += 10) {
      step(10); sample(1);
      const n = alive(1).filter((e) => e._loc.y > 10.5 && e._loc.y < 12).length;
      if (n >= 7) arrived = SIM.tick - t0;
    }
    if (opt.dump) for (const e of alive(1).filter((x) => x._loc.y < 10.5)) {
      const r = W.routeOf(e); const pts = r?.pts;
      console.error("STUCK", e._loc, "dyn", JSON.stringify([...e.dyn].filter(([k]) => /goal|catchup|mymk|ordergoal/.test(k))), "idx", r?.idx, "queued", pts ? W.queuedBehind(e, pts, r.idx) : "-", "pts", JSON.stringify(pts?.slice(Math.max(0, r.idx - 2), r.idx + 4)), "climb", W.climbing.has(e.id), "vel", JSON.stringify(e.vel), "walk", JSON.stringify(e.walk), "navGoal", JSON.stringify(e.navGoal));
    }
    report({ arrivedTicks: arrived, top: alive(1).filter((e) => e._loc.y > 10.5).length, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, final: alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`), notes: M.notes, ...callsPerTick(SIM.tick) });
  },

  // the castle in the screenshot: squad on a wall-top walkway, down a 2-wide brick staircase between two walls, lava beside it
  async castleStairs() {
    fill(-12, 0, -2, 12, 7, 2, "stone_bricks");                                  // the wall (walk on y=8)
    fill(-12, 8, -2, 12, 8, -2, "blackstone_wall"); fill(-12, 8, 2, -1, 8, 2, "blackstone_wall"); fill(2, 8, 2, 12, 8, 2, "blackstone_wall");   // parapets, gap for the stairs
    for (let i = 0; i < 8; i++) { fill(0, 7 - i, 3 + i, 1, 7 - i, 3 + i, "brick_stairs"); if (7 - i > 0) fill(0, 0, 3 + i, 1, 6 - i, 3 + i, "stone_bricks"); }
    fill(-1, 0, 3, -1, 8, 10, "blackstone"); fill(2, 0, 3, 2, 8, 10, "blackstone");   // walls on both sides of the stairs
    fill(3, -1, 3, 12, -1, 14, "lava");
    spawnPlayer({ x: 0, y: 0, z: 30 });
    for (let i = 0; i < 8; i++) soldier(1, { x: -8 + i * 2 + 0.5, y: 8, z: 0.5 }, ["rifle", "smg", "semi", "mg"][i % 4]);
    step(20);
    const dest = { x: 0, y: 0, z: 22 };
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1, burned = 0;
    for (let t = 0; t < 2400 && arrived < 0; t += 10) {
      step(10); sample(1);
      if (opt.trace && SIM.tick % 50 === 0) console.error(SIM.tick, alive(1).map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}:${W.notes.get(e.id)?.text ?? ""}`).join(" | "));
      if (alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 10 && e._loc.y < 1.5).length >= 7) arrived = SIM.tick - t0;
    }
    report({ arrivedTicks: arrived, down: alive(1).filter((e) => e._loc.y < 1.5).length, alive: alive(1).length, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, final: alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`), notes: M.notes, ...callsPerTick(SIM.tick) });
  },

  // a fight inside the building: attackers on the ground floor, two defenders on the top floor; charge to the top
  async indoorFight() {
    building(0, 0, { windows: false });
    spawnPlayer({ x: 6, y: 0, z: -40 });
    for (const [x, z] of [[8.5, 8.5], [3.5, 7.5]]) soldier(2, { x, y: 11, z }, "rifle", 1, "hold");
    for (let i = 0; i < 6; i++) soldier(1, { x: 2 + (i % 3) * 2.5 + 0.5, y: 0, z: 4.5 + Math.floor(i / 3) * 3 }, ["rifle", "smg", "semi"][i % 3]);
    W.setRelPair(1, 2, "1", false);
    step(20);
    await order(1, { x: 6, y: 11, z: 6 });
    const t0 = SIM.tick;
    for (let t = 0; t < 3000; t += 10) { step(10); sample(1); if (opt.trace && SIM.tick % 100 === 0) console.error(SIM.tick, alive(1).map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}:${W.notes.get(e.id)?.text ?? ""}`).join(" | ")); if (!alive(2).filter((e) => !W.isDowned(e)).length) break; }
    report({ ticks: SIM.tick - t0, defendersLeft: alive(2).filter((e) => !W.isDowned(e)).length, attackersLeft: alive(1).filter((e) => !W.isDowned(e)).length, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, notes: M.notes });
  },

  // a player (creative, as when testing) who joined faction 2 stands 30 blocks from faction 1's soldiers: they must target him
  async playerTarget() {
    spawnPlayer({ x: 0, y: 0, z: 30 });
    player.tags.delete("war_f1"); player.tags.add("war_f2"); SIM.gameMode = opt.mode ?? "survival";
    for (let i = 0; i < 4; i++) soldier(1, { x: i * 2 + 0.5, y: 0, z: 0.5 }, "rifle", 1, "hold");
    W.setRelPair(1, 2, "1", false);
    step(400);
    const s = SIM.shots.filter((x) => x.owner?.props?.get("war:faction") === 1);
    const atPlayer = s.filter((x) => x.nearPlayer).length;
    report({ shots: s.length, ok: s.length > 0 });
  },

  async planDbg() {
    if (!opt.flat) fill(-6, -5, -6, 6, -1, 6, "air"); fill(-7, -6, -7, 7, -6, 7, "stone");
    for (let y = -5; y <= -1; y++) setBlock(0, y, 6, "ladder");
    step(5);
    let out;
    const g = opt.g ? JSON.parse(opt.g) : { x: 0.5, y: 0, z: 12.5 };
    W.planRoute(overworld, opt.s ? JSON.parse(opt.s) : { x: 0.5, y: -5, z: -2.5 }, g, (pts, partial) => { out = { pts: pts?.map((p) => `${p.x - 0.5},${p.y},${p.z - 0.5}${p.climb ? "L" : ""}`), partial }; }, { max: 120000, maxRadius: 300 });
    for (let k = 0; k < 400 && !out; k++) step(1);
    report({ out });
  },
  // "Hold here" on top of a wall that only a ladder reaches (the short-order path), counting teleports
  async ladderHold() {
    fill(-10, 0, 10, 10, 5, 14, "stone_bricks");
    const lx = Number(opt.lx ?? 3);
    for (let y = 0; y <= 5; y++) setBlock(lx, y, 9, "ladder");
    spawnPlayer({ x: 0, y: 0, z: -5 });
    for (let i = 0; i < 5; i++) soldier(1, { x: -4 + i * 2 + 0.5, y: 0, z: 1.5 }, "rifle");
    step(20);
    let tps = 0; const lastY = new Map();
    W.generals.set(player.id, { cursor: { x: 0.5, y: 6, z: 12.5 } });
    await W.giveOrder(player, { faction: 1, order: 1, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true });
    W.generals.delete(player.id);
    const t0 = SIM.tick; let arrived = -1;
    for (let t = 0; t < 2400 && arrived < 0; t += 1) {
      step(1);
      for (const e of alive(1)) { const ly = lastY.get(e.id); if (ly !== undefined && e._loc.y - ly > 1.5) tps++; lastY.set(e.id, e._loc.y); }
      if (t % 10 === 0) sample(1);
      if (alive(1).filter((e) => e._loc.y > 5.5).length >= 5) arrived = SIM.tick - t0;
    }
    report({ arrivedTicks: arrived, top: alive(1).filter((e) => e._loc.y > 5.5).length, upwardJumps: tps, notes: M.notes });
  },
  // ladders: up a 6-high wall (opt up=1, default) or out of a 5-deep pit (opt pit=1)
  async ladder() {
    if (opt.pit) {
      fill(-6, -5, -6, 6, -1, 6, "air"); fill(-7, -6, -7, 7, -6, 7, "stone");                // a pit, floor at y=-5
      const lx = Number(opt.lx ?? 0);
      for (let y = -5; y <= -1; y++) setBlock(lx, y, 6, "ladder");                            // ladder on the north wall (opt lx: off to the side)
      spawnPlayer({ x: 0, y: 0, z: 40 });
      for (let i = 0; i < 6; i++) soldier(1, { x: -4 + i * 1.6 + 0.5, y: -5, z: -2.5 }, "rifle");
    } else {
      fill(-10, 0, 10, 10, 5, 12, "stone_bricks");                                             // a wall, top at y=6
      for (let y = 0; y <= 5; y++) setBlock(0, y, 9, "ladder");                               // ladder on its south face
      spawnPlayer({ x: 0, y: 0, z: -30 });
      for (let i = 0; i < 6; i++) soldier(1, { x: -5 + i * 2 + 0.5, y: 0, z: -2.5 }, "rifle");
    }
    step(20);
    const dest = opt.pit ? { x: 0, y: 0, z: 12 } : { x: 0, y: 6, z: 11 };
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1;
    for (let t = 0; t < 2400 && arrived < 0; t += 10) {
      step(10); sample(1);
      if (opt.trace && SIM.tick % 50 === 0) console.error(SIM.tick, alive(1).map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}:${W.notes.get(e.id)?.text ?? ""}${W.climbing.has(e.id) ? "[C]" : ""}`).join(" | "));
      if (opt.path && SIM.tick - t0 === 60) for (const m of Object.values(W.getMarches())) console.error("PATH", JSON.stringify(m.path?.map((p) => `${p.x - 0.5},${p.y},${p.z - 0.5}${p.climb ? "L" : ""}`)));
      const ok = alive(1).filter((e) => Math.abs(e._loc.y - dest.y) < 1.2 && Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 8).length;
      if (ok >= (opt.all ? alive(1).length : 5)) arrived = SIM.tick - t0;
    }
    report({ arrivedTicks: arrived, done: alive(1).filter((e) => Math.abs(e._loc.y - dest.y) < 1.2).length, final: alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`), notes: M.notes });
  },

  // half the squad goes down mid-march: the rest must carry on, not wait ~30 s for them
  async downedMarch() {
    spawnPlayer({ x: 0, y: 0, z: -10 });
    const team = []; for (let i = 0; i < 8; i++) team.push(soldier(1, { x: (i % 4) * 2 + 0.5, y: 0, z: Math.floor(i / 4) * 2 + 0.5 }, "rifle"));
    step(20);
    const dest = { x: 0, y: 0, z: 120 };
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1;
    for (let t = 0; t < 2400 && arrived < 0; t += 10) {
      step(10); sample(1);
      if (SIM.tick - t0 === 100 && !opt.nodown) for (const e of team.slice(0, Number(opt.downN ?? 4))) { try { e.applyDamage(1000, { cause: "entityAttack" }); } catch {} }
      const up = alive(1).filter((e) => !W.isDowned(e));
      if (up.length && up.every((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 10)) arrived = SIM.tick - t0;
    }
    report({ arrivedTicks: arrived, downed: alive(1).filter((e) => W.isDowned(e)).length, ...callsPerTick(SIM.tick) });
  },

  // the attackers come at a building held from the upper windows: do they close in and get to the enemy's level,
  // or stand far off shooting at walls?
  async assault() {
    building(0, 0);
    spawnPlayer({ x: 6, y: 0, z: -120 });
    for (let i = 0; i < Number(opt.def ?? 6); i++) soldier(2, i < 4 ? { x: 2 + i * 2.5 + 0.5, y: 11, z: 2.5 } : { x: 3 + (i - 4) * 5 + 0.5, y: 6, z: 2.5 }, i < 4 ? "rifle" : "mg", 1, "hold");
    const att = []; for (let i = 0; i < 8; i++) att.push(soldier(1, { x: (i % 4) * 2 + 0.5, y: 0, z: -95 - Math.floor(i / 4) * 2 + 0.5 }, ["rifle", "smg", "semi", "mg"][i % 4]));
    W.setRelPair(1, 2, "1", false);
    step(20);
    await order(1, { x: 6, y: 0, z: -3 }, "hold");
    const t0 = SIM.tick;
    let firstUp = -1;
    for (let t = 0; t < 3600; t += 10) {
      step(10); sample(1);
      if (firstUp < 0 && alive(1).some((e) => e._loc.y > 5.5)) firstUp = SIM.tick - t0;
      if (opt.thinkdbg && SIM.tick === Number(opt.thinkdbg)) for (const e of alive(1)) { try { const d = W.sd(e), now = SIM.tick; const r = {}; r.medic = W.medicMove(e, d, now); r.shaken = W.shakenMove(e, d, now); r.water = W.waterExit(e, d, now); r.pers = W.personal.has(e.id) ? { ...W.personal.get(e.id), pts: W.personal.get(e.id).pts?.length } : false; r.fp = W.followPersonal(e, now); r.spread = W.spreadMove(e, now); r.combat = W.combatMove(e, d, now, false, undefined, 6); r.eng = W.engagement(e, d, now, d.goal, false); r.reinf = W.reinforceMove(e, d, now); const cu = e.dyn.get("war:catchup"); r.cu = cu; r.cuMarker = !!W.marker(Number(cu)); console.error("CHAIN", e.id.slice(-5), JSON.stringify(r)); globalThis.__thinkDbg = (x, en, cu, d) => { if (x === e) console.error("  in-think engaged", JSON.stringify(en), "cu", cu, "func", d.func); }; W.think(e); globalThis.__thinkDbg = undefined; console.error("  after goal", e.dyn.get("war:goal"), "og", e.dyn.get("war:ordergoal"), [...e.groups].join(",")); } catch (err) { console.error("THINK ERR", err.stack); } }
      if (opt.dbg && SIM.tick % 100 === 0) for (const e of alive(1)) { const ps = W.perc.get(e.id), gs = W.gunState.get(e.id), t = ps?.threat; console.error(SIM.tick, e.id.slice(-5), e._loc.x.toFixed(1), e._loc.y.toFixed(1), e._loc.z.toFixed(1), W.sd(e).weapon, W.sd(e).func, "down", W.isDowned(e), "alert", ps?.alert, "threat", t ? `${t.id.slice(-5)}@${Math.round(Math.hypot(t._loc.x - e._loc.x, t._loc.z - e._loc.z))}` : "-", "gsT", gs?.target ? "Y" : "-", "seen", ps?.seen?.size, "note", W.notes.get(e.id)?.text, SIM.tick - (W.notes.get(e.id)?.t ?? 0), "grp", [...e.groups].filter((g) => /g_|t_|s_/.test(g)).join(","), "goal", e.dyn.get("war:goal"), "og", e.dyn.get("war:ordergoal"), "cu", e.dyn.get("war:catchup"), "nav", e.navGoal ? `${e.navGoal.x.toFixed(1)},${e.navGoal.y.toFixed(1)},${e.navGoal.z.toFixed(1)}` : "-", "known", W.squads.get(`1:1`)?.known?.size); }
      if (!alive(2).filter((e) => !W.isDowned(e)).length) break;
    }
    const up = (f) => alive(f).filter((e) => !W.isDowned(e)).reduce((t, e) => t + e.hp / e.maxHp, 0);
    report({ str1: +up(1).toFixed(2), str2: +up(2).toFixed(2), ticks: SIM.tick - t0, defendersLeft: alive(2).filter((e) => !W.isDowned(e)).length, attackersLeft: alive(1).filter((e) => !W.isDowned(e)).length, firstAttackerUpstairs: firstUp, attackerShots: shotStats(1), defenderShots: shotStats(2), bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, notes: M.notes, ...callsPerTick(SIM.tick) });
  },

  // over a hill and down the other side
  async hillMarch() {
    hill(0, 40, 22, 9);
    spawnPlayer({ x: 0, y: 0, z: -10 });
    for (let i = 0; i < 8; i++) soldier(1, { x: (i % 4) * 2 - 3 + 0.5, y: 0, z: Math.floor(i / 4) * 2 + 0.5 }, "rifle");
    step(20);
    const dest = { x: 0, y: 0, z: 85 };
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1;
    for (let t = 0; t < 2400 && arrived < 0; t += 10) { step(10); sample(1); if (opt.trace && SIM.tick % 100 === 0) console.error(SIM.tick, alive(1).map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}:${W.notes.get(e.id)?.text ?? ""}:${e.dyn.get("war:goal")}/${e.dyn.get("war:catchup") ?? ""}`).join(" | ")); if (alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 10).length >= 7) arrived = SIM.tick - t0; }
    report({ arrivedTicks: arrived, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, ...callsPerTick(SIM.tick) });
  },

  // a long Charge POS (the GPS): across a stream and around a long wall, 260 blocks
  async longCharge() {
    SIM.bounds = { x0: -150, x1: 150, z0: -60, z1: 320, y0: -10, y1: 60 };
    fill(-150, -1, 100, 150, -1, 104, "water"); fill(-150, -2, 100, 150, -2, 104, "water");     // a stream (2 deep, 5 wide)
    fill(-2, -1, 100, 2, -1, 104, "oak_planks");                                                  // a bridge
    fill(-60, 0, 170, 60, 3, 171, "stone_bricks");                                                 // a long wall to go around
    spawnPlayer({ x: 0, y: 0, z: -10 });
    for (let i = 0; i < 12; i++) soldier(1, { x: (i % 4) * 2 - 3 + 0.5, y: 0, z: Math.floor(i / 4) * 2 + 0.5 }, "rifle");
    step(20);
    const dest = { x: 10, y: 0, z: 260 };
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1, firstMove = -1; const start = alive(1).map((e) => ({ ...e._loc }));
    for (let t = 0; t < 6000 && arrived < 0; t += 10) {
      step(10); sample(1);
      if (firstMove < 0 && alive(1).some((e, k) => Math.hypot(e._loc.x - start[k].x, e._loc.z - start[k].z) > 3)) firstMove = SIM.tick - t0;
      if (alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 12).length >= 10) arrived = SIM.tick - t0;
    }
    report({ arrivedTicks: arrived, firstMove, wet: alive(1).filter((e) => e.isInWater).length, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, final: alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.z)}`), ...callsPerTick(SIM.tick) });
  },

  // 8 v 8 across broken ground: low walls, a hut and a hill between them (both sides attack)
  async field() {
    SIM.bounds = { x0: -100, x1: 100, z0: -100, z1: 100, y0: -10, y1: 60 };
    // mirror-symmetric ground (point symmetry through the centre), so neither side has the better half
    const sym = (fn) => { fn(1); fn(-1); };
    sym((k) => hill(-20 * k, 6 * k, 10, 4));
    for (const [x, z] of [[-8, -25], [10, -18], [0, -8], [16, -4], [-14, -12], [6, -20], [-4, -30], [20, -30]]) sym((k) => { const xx = x * k, zz = z * k; fill(Math.min(xx, xx + 3 * k), 0, zz, Math.max(xx, xx + 3 * k), 0, zz, "cobblestone"); });   // low walls
    fill(-3, 0, -2, 3, 3, 2, "stone_bricks"); fill(-2, 0, -1, 2, 3, 1, "air"); fill(-3, 4, -2, 3, 4, 2, "oak_planks"); for (const z of [-2, 2]) { setBlock(0, 0, z, "air"); setBlock(0, 1, z, "air"); }   // a hut in the middle
    spawnPlayer({ x: 0, y: 0, z: -90 });
    const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi", "smg", "rifle"];
    for (let i = 0; i < 8; i++) soldier(1, { x: (i % 4) * 2.5 - 4 + 0.5, y: 0, z: -55 - Math.floor(i / 4) * 2.5 + 0.5 }, W8[i]);
    for (let i = 0; i < 8; i++) soldier(2, { x: (i % 4) * 2.5 - 4 + 0.5, y: 0, z: 55 + Math.floor(i / 4) * 2.5 + 0.5 }, W8[i], 1);
    W.setRelPair(1, 2, "1", false);
    step(20);
    await order(1, { x: 0, y: 0, z: 50 });
    await order(2, { x: 0, y: 0, z: -50 });
    const t0 = SIM.tick;
    for (let t = 0; t < Number(opt.ticks ?? 2400); t += 10) { step(10); sample(1); if (!alive(1).filter((e) => !W.isDowned(e)).length || !alive(2).filter((e) => !W.isDowned(e)).length) break; }
    const up = (f) => alive(f).filter((e) => !W.isDowned(e)).reduce((t, e) => t + e.hp / e.maxHp, 0);
    report({ ticks: SIM.tick - t0, str1: +up(1).toFixed(2), str2: +up(2).toFixed(2), left1: alive(1).filter((e) => !W.isDowned(e)).length, left2: alive(2).filter((e) => !W.isDowned(e)).length, shots1: shotStats(1), shots2: shotStats(2), bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), notes: M.notes });
  },

  // steady load for profiling: N v N, damage switched off (Realism slider 0), so the same fight goes on for the whole run
  async perf() {
    const N = Number(opt.n ?? 40);
    SIM.bounds = { x0: -200, x1: 200, z0: -200, z1: 200, y0: -10, y1: 60 };
    SIM.dynWorld.set("war:set_r_dmg", 0);
    building(-6, -6);
    spawnPlayer({ x: 0, y: 0, z: -100 });
    const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi"];
    for (let i = 0; i < N; i++) soldier(1, { x: (i % 10) * 2.5 - 12 + 0.5, y: 0, z: -45 - Math.floor(i / 10) * 2.5 + 0.5 }, W8[i % 6], 1 + (i % 4));
    for (let i = 0; i < N; i++) soldier(2, { x: (i % 10) * 2.5 - 12 + 0.5, y: 0, z: 45 + Math.floor(i / 10) * 2.5 + 0.5 }, W8[i % 6], 1 + (i % 4));
    W.setRelPair(1, 2, "1", false);
    step(20);
    await order(1, { x: 0, y: 0, z: 30 });
    await order(2, { x: 0, y: 0, z: -30 });
    step(200);
    const t0 = performance.now(), ticks = Number(opt.ticks ?? 600);
    timing.clear();
    step(ticks, true);
    const mainMs = [...timing].filter(([k]) => k.includes("main.js")).reduce((t, [, v]) => t + v, 0) / ticks;
    report({ n: N, mainMsPerTick: +mainMs.toFixed(2), shots: SIM.shots.length });
  },

  // battle learning: many 8 v 8 fights in one world; faction 1 learns, faction 2 keeps the defaults (opt learn2=1: both learn)
  async learn() {
    SIM.bounds = { x0: -100, x1: 100, z0: -100, z1: 100, y0: -10, y1: 60 };
    if (!opt.learn2) W.BW_F[2] = { ...W.BW, headK: W.HEAD_K };
    spawnPlayer({ x: 0, y: 0, z: -90 });
    W.setRelPair(1, 2, "1", false);
    const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi", "smg", "rifle"];
    const rounds = Number(opt.rounds ?? 20), res = [];
    for (let r = 0; r < rounds; r++) {
      for (const e of alive()) e.remove();
      const sw = r % 2;   // swap sides each round (no side bias)
      for (let i = 0; i < 8; i++) soldier(1, { x: (i % 4) * 2.5 - 4 + 0.5, y: 0, z: (sw ? 55 : -55) + (sw ? 1 : -1) * Math.floor(i / 4) * 2.5 + 0.5 }, W8[i]);
      for (let i = 0; i < 8; i++) soldier(2, { x: (i % 4) * 2.5 - 4 + 0.5, y: 0, z: (sw ? -55 : 55) + (sw ? -1 : 1) * Math.floor(i / 4) * 2.5 + 0.5 }, W8[i]);
      step(20);
      if (sw) { await order(2, { x: 0, y: 0, z: 50 }); await order(1, { x: 0, y: 0, z: -50 }); } else { await order(1, { x: 0, y: 0, z: 50 }); await order(2, { x: 0, y: 0, z: -50 }); }
      for (let t = 0; t < 2000; t += 20) { step(20); if (!alive(1).filter((e) => !W.isDowned(e)).length || !alive(2).filter((e) => !W.isDowned(e)).length) break; }
      const up = (f) => alive(f).filter((e) => !W.isDowned(e)).length;
      res.push(up(1) - up(2));
      step(700);   // the fight is over: squads see no enemy, the engagement is scored
    }
    const L = W.getLearned();
    const half = Math.floor(rounds / 2), m = (a) => +(a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(2);
    report({ marginFirstHalf: m(res.slice(0, half)), marginSecondHalf: m(res.slice(half)), results: res, learned1: L[1], learned2: L[2] });
  },

  // open-field battle, N v N: script cost per tick (the lag)
  async big() {
    const N = Number(opt.n ?? 100);
    SIM.bounds = { x0: -300, x1: 300, z0: -300, z1: 300, y0: -10, y1: 60 };
    spawnPlayer({ x: 0, y: 0, z: 0 });
    const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi"];
    for (let i = 0; i < N; i++) soldier(1, { x: (i % 20) * 2 - 20 + 0.5, y: 0, z: -60 - Math.floor(i / 20) * 2 + 0.5 }, W8[i % 6]);
    for (let i = 0; i < N; i++) soldier(2, { x: (i % 20) * 2 - 20 + 0.5, y: 0, z: 60 + Math.floor(i / 20) * 2 + 0.5 }, W8[i % 6]);
    W.setRelPair(1, 2, "1", false);
    step(20);
    await order(1, { x: 0, y: 0, z: 60 });
    await order(2, { x: 0, y: 0, z: -60 });
    SIM.calls.clear(); SIM.callsBy.clear();
    const t0 = performance.now(), k0 = SIM.tick, ticks = Number(opt.ticks ?? 600);
    for (let k = 0; k < ticks; k += 10) { step(10, true); sample(1); }
    const ms = (performance.now() - t0) / ticks;
    const zs = (f) => { const a = alive(f).map((e) => e._loc.z); return a.length ? `${Math.min(...a).toFixed(0)}..${Math.max(...a).toFixed(0)}` : "-"; };
    console.error("z1", zs(1), "z2", zs(2), "marches", JSON.stringify(Object.values(W.getMarches()).map((m) => ({ planning: m.planning, path: m.path?.length, idx: m.idx, final: m.final, members: m.members?.length }))));
    const top = [...timing].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${(v / ticks).toFixed(2)}ms ${k.replace(/.*run_\d+\//, "")}`);
    const by = [...SIM.callsBy].map(([k, m]) => [k.replace(/.*run_\d+\//, ""), [...m].filter(([n]) => n !== "location").reduce((t, [, v]) => t + v, 0) / ticks, [...m].filter(([n]) => n !== "location").sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `${n}:${(v / ticks).toFixed(0)}`).join(" ")]).sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.error(by.map((x) => `${x[1].toFixed(0).padStart(6)}  ${x[0]}  ${x[2]}`).join("\n"));
    report({ notes: M.notes, n: N, simMsPerTick: +ms.toFixed(1), left1: alive(1).filter((e) => !W.isDowned(e)).length, left2: alive(2).filter((e) => !W.isDowned(e)).length, shots: SIM.shots.length, hits: SIM.hits, topIntervals: top, ...callsPerTick(SIM.tick - k0) });
  },
};
if (!S[scenario]) { console.log(`unknown scenario ${scenario}; one of ${Object.keys(S).join(", ")}`); process.exit(2); }
await S[scenario]();
process.exit(0);
