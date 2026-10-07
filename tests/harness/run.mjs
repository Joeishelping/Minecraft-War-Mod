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
const HOOK = ["getZones", "SAFE", "isHostile", "nearestFlag", "P", "slotOf", "setP", "claimSlot", "FLAG", "isoSurrender", "setRelPair", "warFlagPlaced", "BALL", "entrances", "doorWatchSpot", "buildingCells", "show", "sortPerm", "shotAt", "canHit", "aimAt", "closeEnemy", "friendlyInLine", "bangCount", "wallbang", "WALLBANG", "perchSpot", "safeSpot", "dangerNear", "voiceMenu", "callout", "warTable", "eggUse", "getRel", "relAt", "fires", "coalitions", "held", "holding", "stagger", "putDown", "allOf", "edgeFearT", "cleanupMenu", "purgeState", "gliders", "glideBan", "driveOn", "formMode", "tightAt", "combatLock", "routeProgress", "getLearned", "learned", "generals", "planRoute", "BW", "BW_F", "HEAD_K", "medicMove", "shakenMove", "waterExit", "followPersonal", "spreadMove", "combatMove", "engagement", "reinforceMove", "patrolSweep", "marker", "think", "routeOf", "lookahead", "queuedBehind", "climbing", "laneOf", "trackIdx", "giveOrder", "startMarch", "giveFunction", "setupSoldier", "sd", "perc", "squads", "getMarches", "personal", "downed", "goDown", "marker", "gunState", "brain", "notes", "setRelPair", "travel", "isDowned"];
if (opt.thinkdbg) { const f = path.join(runDir, "main.js"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("    // how far each stationary order may leave its spot to fight", "    if (globalThis.__thinkDbg) globalThis.__thinkDbg(e, engaged, cu, d);\n    // how far each stationary order may leave its spot to fight")); }
fs.appendFileSync(path.join(runDir, "main.js"), `\nglobalThis.__war = {};\n${HOOK.map((n) => `try { globalThis.__war.${n} = ${n}; } catch {}`).join("\n")}\n`);
loadDefs(path.join(root, "War Engine BP"));
{ const cw = console.warn.bind(console); console.warn = (...a) => { const m = a.join(" "); if (m.startsWith("War Engine:")) SIM.errors.push(m); else cw(...a); }; }
// v6.2 Bedrock mode: slow=K makes the add-on's own time budgets see K times the real time (Bedrock's script engine is
// many times slower than V8), harsh=1 corner-cutting walking with knockback, loadR=N land unloads N blocks from players
if (opt.slow) { const real = Date.now.bind(Date), t0 = real(), K = Number(opt.slow); Date.now = () => t0 + (real() - t0) * K; }
if (opt.harsh) SIM.harsh = true;
if (opt.g) SIM.bulletG = Number(opt.g); if (opt.k) SIM.bulletK = Number(opt.k);
if (opt.loadR) SIM.loadR = Number(opt.loadR);
if (opt.simR) SIM.simR = Number(opt.simR);
if (opt.bedrock) { const real = Date.now.bind(Date), t0 = real(); Date.now = () => t0 + (real() - t0) * 15; SIM.harsh = true; SIM.loadR = Number(opt.loadR ?? 160); SIM.simR = Number(opt.simR ?? 64); }
SIM.gunPack = true;
MC.seed(Number(opt.seed ?? 7));
if (!opt.abc) { const L0 = SIM.loading; SIM.loading = false; MC.world.setDynamicProperty("war:set_abc", false); SIM.loading = L0; }   // (scripted form answers pick by position: menus unsorted unless a test asks)
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
  if (opt.pairs && SIM.tick % 50 === 0) { const ms = Object.values(W.getMarches()); console.error("T", SIM.tick, "pairs", pairs / 2, "shape", ms.map((m) => m.shape + (m.final ? "F" : "")).join(","), "cz", (list.reduce((t, e) => t + e._loc.z, 0) / list.length).toFixed(0), "x", list.map((e) => e._loc.x.toFixed(0)).join(" "), "z", list.map((e) => e._loc.z.toFixed(0)).join(" "), "mode", list.map((e) => { const cu = e.dyn.get("war:catchup"); return cu === undefined ? "-" : cu === e.dyn.get("war:fmk") ? "F" : cu === e.dyn.get("war:mymk") ? "D" : "?"; }).join(""), "goal=cu", list.map((e) => e.dyn.get("war:goal") === e.dyn.get("war:catchup") ? 1 : 0).join("")); }
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
SIM.shots.push = (x) => { try { const o = x.owner; let bd = 1e9; for (const e of alive()) if (e !== o && !W.isDowned(e) && e.props.get("war:faction") !== o.props.get("war:faction")) bd = Math.min(bd, Math.hypot(e._loc.x - o._loc.x, e._loc.z - o._loc.z)); x.dist = bd; const gs = W.gunState.get(o.id); x.supp = !!(gs && !gs.target && gs.supp && gs.supp.until > SIM.tick);
  // v7.1: blind = at the moment of the shot, no straight line from the muzzle to any part of any enemy within 80
  let seeAny = false; const f0 = x.from;
  for (const e of alive()) { if (seeAny || e === o || W.isDowned(e) || e.props.get("war:faction") === o.props.get("war:faction")) continue; if (Math.hypot(e._loc.x - f0.x, e._loc.z - f0.z) > 80) continue;
    for (const hy of [0.6, 1.2, 1.7]) { if (MC.rayExact(f0, { x: e._loc.x, y: e._loc.y + hy, z: e._loc.z })) { seeAny = true; break; } } }
  x.blind = !seeAny; { const tg = W.gunState.get(o.id)?.target ?? W.gunState.get(o.id)?.supp?.ent; if (tg?._loc) x.tgtD = Math.hypot(tg._loc.x - f0.x, tg._loc.y + 1.2 - f0.y, tg._loc.z - f0.z); } if (x.blind && opt.blindlog) { const gs = W.gunState.get(o.id), tg = gs?.target; console.error("BLIND", SIM.tick, "wb", !!x.wb, "from", f0.x.toFixed(1), f0.y.toFixed(1), f0.z.toFixed(1), "tgt", tg ? `${tg._loc.x.toFixed(1)},${tg._loc.y.toFixed(1)},${tg._loc.z.toFixed(1)} down=${W.isDowned(tg)} fac=${tg.props?.get("war:faction")} type=${tg.typeId}` : "-", "supp", !!gs?.supp, "shooter", o._loc.x.toFixed(1), o._loc.y.toFixed(1), o._loc.z.toFixed(1)); } } catch {} return origPush(x); };
// v8.0: precise hits are logged like bullets (the same shot statistics)
globalThis.__warShot = (r) => { try {
  const o = r.owner; let near = false;
  for (const e of alive()) { if (e === o || W.isDowned(e) || e.props.get("war:faction") === o.props.get("war:faction")) continue;
    const c = { x: e._loc.x, y: e._loc.y + 1, z: e._loc.z }, t = Math.max(0, Math.min(r.blockD, (c.x - r.from.x) * r.dir.x + (c.y - r.from.y) * r.dir.y + (c.z - r.from.z) * r.dir.z));
    if (Math.hypot(r.from.x + r.dir.x * t - c.x, r.from.y + r.dir.y * t - c.y, r.from.z + r.dir.z * t - c.z) < 2.5) { near = true; break; } }
  SIM.shots.push({ from: r.from, owner: o, t: SIM.tick, nearEnemy: near, hit: r.hit, wb: false, typeId: r.typeId, block: r.block, blockD: r.blockD });
  if (opt.cdbg) { const x = SIM.shots[SIM.shots.length - 1]; if (x.block && x.tgtD !== undefined && x.blockD < x.tgtD - 0.8) { const gs = W.gunState.get(o.id), tg = gs?.target ?? gs?.supp?.ent; console.error("COVER", SIM.tick, "from", r.from.x.toFixed(1), r.from.y.toFixed(1), r.from.z.toFixed(1), "end", r.end.x.toFixed(1), r.end.y.toFixed(1), r.end.z.toFixed(1), "tgt", tg ? `${tg._loc.x.toFixed(1)},${tg._loc.y.toFixed(1)},${tg._loc.z.toFixed(1)}` : "-", "supp", !gs?.target, "expo", gs?.expo, "tgtD", x.tgtD.toFixed(1), "blockD", x.blockD.toFixed(1)); } }
} catch {} };
// v6.0: teleports of more than 2.5 blocks (rescues / anything that jumps a soldier)
let bigTp = 0;
{ const tp0 = MC.Entity.prototype.teleport; MC.Entity.prototype.teleport = function (loc, o) { if (this.typeId === SOLDIER && this._loc && Math.hypot(loc.x - this._loc.x, loc.y - this._loc.y, loc.z - this._loc.z) > 2.5) { bigTp++; if (opt.tplog) console.error("TP", SIM.tick, JSON.stringify(this._loc), "->", JSON.stringify(loc), W.notes?.get?.(this.id)?.text, opt.tplog === "2" ? new Error().stack.split("\n").slice(2, 5).map((s) => s.trim().replace(/\(.*main.js:/, "(")).join(" < ") : ""); } return tp0.call(this, loc, o); }; }
// v5.9: no-clip watch: soldier samples (every 5 ticks) with a solid full block at his feet or head
let clips = 0;
const fullSolid = (x, y, z) => { const id = MC.idAt(x, y, z); return !MC.passCell(x, y, z) && !id.includes("stairs") && !id.includes("slab") && !id.includes("ladder") && !id.includes("door"); };
MC.system.runInterval(() => { for (const e of alive()) { const l = e._loc; if (fullSolid(l.x, l.y + 0.05, l.z) || fullSolid(l.x, l.y + 1.2, l.z)) clips++; } }, 5);
const report = (o) => { if (opt.voices) console.error((SIM.voices ?? []).join("\n")); console.log(JSON.stringify({ scenario, ...o, voiceCount: SIM.voices?.length ?? 0, clips, bigTp, lava: SIM.lavaIds?.size ?? 0, errors: SIM.errors.slice(0, 5), errorCount: SIM.errors.length })); };

// ---------------------------------------------------------------- scenarios
const S = {
  // v9.1: cobwebs. A wall across the way with a doorway full of cobweb; mode=detour also a clear gap 15 blocks aside.
  // With the gap they go round (no man in a cobweb); with only the cobweb they still get through (it's not a wall).
  async webs() {
    SIM.bounds = { x0: -60, x1: 60, z0: -20, z1: 100, y0: -10, y1: 30 };
    fill(-60, 0, 40, 60, 3, 41, "stone_bricks");
    fill(-1, 0, 40, 1, 1, 41, "web");
    if (opt.mode === "detour") fill(14, 0, 40, 15, 1, 41, "air");
    spawnPlayer({ x: 0, y: 0, z: -10 });
    for (let i = 0; i < 6; i++) soldier(1, { x: (i % 3) * 2 - 2 + 0.5, y: 0, z: Math.floor(i / 3) * 2 + 0.5 }, "rifle");
    step(20);
    await order(1, { x: 0, y: 0, z: 80 });
    let inWeb = 0, arrived = -1; const t0 = SIM.tick;
    for (let t = 0; t < Number(opt.ticks ?? 2400) && arrived < 0; t += 5) {
      step(5);
      for (const e of alive(1)) { const l = e._loc; if (MC.idAt(l.x, l.y + 0.1, l.z).includes("web") || MC.idAt(l.x, l.y + 1.1, l.z).includes("web")) inWeb++; }
      if (alive(1).filter((e) => e._loc.z > 70).length >= 5) arrived = SIM.tick - t0;
    }
    report({ mode: opt.mode ?? "only", arrivedTicks: arrived, there: alive(1).filter((e) => e._loc.z > 70).length, webSamples: inWeb });
  },
  // v9.1: a man who surrenders stays surrendered: the enemy leaves, the war ends, his side raises its flag again
  async surrenderStays() {
    SIM.bounds = { x0: -40, x1: 40, z0: -40, z1: 40, y0: -10, y1: 30 };
    spawnPlayer({ x: 0, y: 0, z: -30 });
    const man = soldier(1, { x: 0.5, y: 0, z: 0.5 }, "rifle");
    const foes = []; for (let i = 0; i < 5; i++) foes.push(soldier(2, { x: -4 + i * 2 + 0.5, y: 0, z: 8.5 }, "rifle"));
    step(20);
    W.isoSurrender(man, 2);
    const at = {};
    at.start = !!W.sd(man).surr;
    for (const f of foes) f.remove();
    step(800); at.enemyGone = !!W.sd(man).surr;                  // (before: rejoined 20 s after the enemy left)
    W.setRelPair(1, 2, "0", false); step(200); at.peace = !!W.sd(man).surr;   // (before: rejoined when the war ended)
    W.warFlagPlaced(1); step(200); at.flagRaised = !!W.sd(man).surr;        // (before: rejoined when his side raised its flag)
    report({ surrendered: at, shooting: W.gunState.get(man.id)?.lastShot ?? -1 });
  },
  // v9.1: "Charge POS -> nearest enemy war flag": they go to the flag
  async toFlag() {
    SIM.bounds = { x0: -40, x1: 40, z0: -20, z1: 120, y0: -10, y1: 30 };
    spawnPlayer({ x: 0, y: 0, z: -10 });
    for (let i = 0; i < 6; i++) soldier(1, { x: (i % 3) * 2 - 2 + 0.5, y: 0, z: Math.floor(i / 3) * 2 + 0.5 }, "rifle");
    W.setRelPair(1, 2, "1", false);                              // (at war: the flag is an enemy's)
    const fl = overworld.spawnEntity(W.FLAG, { x: 10.5, y: 0, z: 90.5 });
    W.setP(fl, "war:faction", 2); W.setP(fl, "war:rally", false); W.claimSlot(fl);
    step(20);
    if (opt.dbg) console.error("DBG hostile", W.isHostile(1, 2), "flagF", W.P(fl, "war:faction"), "slot", W.slotOf(fl), "nearest", !!W.nearestFlag(overworld, player.location, () => true, 400), "valid", fl.isValid);
    await order(1, { x: 0, y: 0, z: 0 }, "hold", { target: 1 });
    let arrived = -1; const t0 = SIM.tick;
    for (let t = 0; t < 2400 && arrived < 0; t += 10) { step(10); if (alive(1).filter((e) => Math.hypot(e._loc.x - 10.5, e._loc.z - 90.5) < 8).length >= 5) arrived = SIM.tick - t0; }
    report({ arrivedTicks: arrived, near: alive(1).filter((e) => Math.hypot(e._loc.x - 10.5, e._loc.z - 90.5) < 8).length, msgs: SIM.log.slice(-3) });
  },
  // v9.1: neutral zones. mode=both: both squads inside; mode=half: one inside, one outside; mode=none: no zone
  async zones() {
    SIM.bounds = { x0: -60, x1: 60, z0: -60, z1: 60, y0: -10, y1: 30 };
    spawnPlayer({ x: 0, y: 0, z: -50 });
    W.setRelPair(1, 2, "1", false);
    for (let i = 0; i < 4; i++) soldier(1, { x: i * 2 - 3 + 0.5, y: 0, z: -7.5 }, "rifle");
    for (let i = 0; i < 4; i++) soldier(2, { x: i * 2 - 3 + 0.5, y: 0, z: 7.5 }, "rifle");
    const mode = opt.mode ?? "both";
    if (mode === "both") W.getZones().push({ id: "t", name: "test", dim: "minecraft:overworld", x: 0, y: 0, z: 0, r: 20 });
    if (mode === "half") W.getZones().push({ id: "t", name: "test", dim: "minecraft:overworld", x: 0, y: 0, z: 14, r: 10 });
    step(600);
    const hurt = [1, 2].map((f) => alive(f).filter((e) => (e.getComponent("minecraft:health")?.currentValue ?? 1) < (e.getComponent("minecraft:health")?.effectiveMax ?? 1) || W.isDowned(e)).length);
    report({ mode, shots: SIM.shots.length, hurt, safe: W.SAFE.size, hp: [1, 2].map((f) => alive(f).map((e) => { const h = e.getComponent("minecraft:health"); return `${h?.currentValue}/${h?.effectiveMax}`; }).join(" ")) });
  },
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
      if (opt.trace && t % 50 === 0) console.error(t, alive(1).map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}${W.personal.has(e.id) ? "P" : ""}${e.dyn.get("war:catchup") !== undefined ? "C" : ""}`).join(" "));
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
      if (opt.follow && SIM.tick % 20 === 0) { const u = alive(1); if (u.length) player._loc = { x: u.reduce((q, e) => q + e._loc.x, 0) / u.length, y: 0, z: u.reduce((q, e) => q + e._loc.z, 0) / u.length - 15 }; }
      if (firstUp < 0 && alive(1).some((e) => e._loc.y > 5.5)) firstUp = SIM.tick - t0;
      if (opt.thinkdbg && SIM.tick === Number(opt.thinkdbg)) for (const e of alive(1)) { try { const d = W.sd(e), now = SIM.tick; const r = {}; r.medic = W.medicMove(e, d, now); r.shaken = W.shakenMove(e, d, now); r.water = W.waterExit(e, d, now); r.pers = W.personal.has(e.id) ? { ...W.personal.get(e.id), pts: W.personal.get(e.id).pts?.length } : false; r.fp = W.followPersonal(e, now); r.spread = W.spreadMove(e, now); r.combat = W.combatMove(e, d, now, false, undefined, 6); r.eng = W.engagement(e, d, now, d.goal, false); r.reinf = W.reinforceMove(e, d, now); const cu = e.dyn.get("war:catchup"); r.cu = cu; r.cuMarker = !!W.marker(Number(cu)); console.error("CHAIN", e.id.slice(-5), JSON.stringify(r)); globalThis.__thinkDbg = (x, en, cu, d) => { if (x === e) console.error("  in-think engaged", JSON.stringify(en), "cu", cu, "func", d.func); }; W.think(e); globalThis.__thinkDbg = undefined; console.error("  after goal", e.dyn.get("war:goal"), "og", e.dyn.get("war:ordergoal"), [...e.groups].join(",")); } catch (err) { console.error("THINK ERR", err.stack); } }
      if (opt.dbg && SIM.tick % 100 === 0) for (const [id, m] of Object.entries(W.getMarches())) console.error("M", SIM.tick, id, "path", m.path?.length, "idx", m.idx, "planning", m.planning, "final", m.final, "early", !!m.earlyAt, "replans", m.replans, "frontier", m.frontier, "contactT", m.contactT, "fireT", m.fireT, "wides", m.wides, "pos", JSON.stringify(m.pos));
      if (opt.dbg && SIM.tick % 100 === 0) for (const e of alive(Number(opt.side ?? 1))) { const ps = W.perc.get(e.id), gs = W.gunState.get(e.id), t = ps?.threat; console.error(SIM.tick, e.id.slice(-5), e._loc.x.toFixed(1), e._loc.y.toFixed(1), e._loc.z.toFixed(1), W.sd(e).weapon, W.sd(e).func, "down", W.isDowned(e), "alert", ps?.alert, "threat", t ? `${t.id.slice(-5)}@${Math.round(Math.hypot(t._loc.x - e._loc.x, t._loc.z - e._loc.z))}` : "-", "gsT", gs?.target ? "Y" : "-", "seen", ps?.seen?.size, "note", W.notes.get(e.id)?.text, SIM.tick - (W.notes.get(e.id)?.t ?? 0), "grp", [...e.groups].filter((g) => /g_|t_|s_/.test(g)).join(","), "goal", e.dyn.get("war:goal"), "og", e.dyn.get("war:ordergoal"), "cu", e.dyn.get("war:catchup"), "nav", e.navGoal ? `${e.navGoal.x.toFixed(1)},${e.navGoal.y.toFixed(1)},${e.navGoal.z.toFixed(1)}` : "-", "known", W.squads.get(`1:1`)?.known?.size); }
      if (!alive(2).filter((e) => !W.isDowned(e)).length) break;
    }
    const up = (f) => alive(f).filter((e) => !W.isDowned(e)).reduce((t, e) => t + e.hp / e.maxHp, 0);
    report({ mv: globalThis.__mv, str1: +up(1).toFixed(2), str2: +up(2).toFixed(2), ticks: SIM.tick - t0, defendersLeft: alive(2).filter((e) => !W.isDowned(e)).length, attackersLeft: alive(1).filter((e) => !W.isDowned(e)).length, firstAttackerUpstairs: firstUp, attackerShots: shotStats(1), defenderShots: shotStats(2), bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, notes: M.notes, ...callsPerTick(SIM.tick) });
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
    if (opt.dump) { const ms = W.getMarches(); for (const [id, m] of Object.entries(ms)) console.error("MARCH", id, "idx", m.idx, "len", m.path?.length, "final", m.final, "pos", JSON.stringify(m.pos), "shape", m.shape, "path@idx", JSON.stringify(m.path?.slice(Math.max(0, m.idx - 3), m.idx + 2))); for (const e of alive(1)) { const cu = e.dyn.get("war:catchup"); const mk = cu ? W.marker(Number(cu)) : undefined; console.error("S", JSON.stringify(e._loc), "goal", e.dyn.get("war:goal"), "og", e.dyn.get("war:ordergoal"), "cu", cu, "mk", mk ? JSON.stringify(mk._loc) : "-", "nav", JSON.stringify(e.navGoal), "walk", JSON.stringify(e.walk)); } }
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

  // v6.0: a march that runs into an enemy position off to the side: do they deal with it, then carry on (no ping-pong)?
  async marchContact() {
    SIM.bounds = { x0: -80, x1: 80, z0: -30, z1: 220, y0: -10, y1: 60 };
    fill(26, 0, 64, 26, 0, 80, "cobblestone"); fill(26, 1, 70, 26, 1, 74, "cobblestone");   // a low wall (a higher bit) the enemy holds
    hill(-25, 110, 10, 4);
    spawnPlayer({ x: 0, y: 0, z: -25 });
    const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi", "smg", "rifle"];
    for (let i = 0; i < 8; i++) soldier(1, { x: (i % 4) * 2 - 3 + 0.5, y: 0, z: Math.floor(i / 4) * 2 + 0.5 }, W8[i]);
    for (let i = 0; i < Number(opt.enemies ?? 4); i++) soldier(2, { x: 28.5 + (i % 2), y: 0, z: 66.5 + i * 3 }, ["rifle", "semi", "mg", "rifle"][i % 4], 1, "hold");
    W.setRelPair(1, 2, "1", false);
    step(20);
    const dest = { x: 0, y: 0, z: 180 };
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1;
    const FIGHT = /firing|clear shot|hunting|searching for the enemy|engaging|closing in|taking cover|advancing|assault|flank|suppress|peek|cover|position|shifting/;
    const MARCH = /marching|catching up|on the way through|waiting his turn/;
    const last = new Map(), flips = new Map();
    let killT = -1, killZ = 0, resume = -1; const afterNotes = {};
    for (let t = 0; t < Number(opt.ticks ?? 4000) && arrived < 0; t += 10) {
      step(10); sample(1);
      if (opt.follow && SIM.tick % 20 === 0) { const u = alive(1); if (u.length) player._loc = { x: u.reduce((q, e) => q + e._loc.x, 0) / u.length, y: 0, z: u.reduce((q, e) => q + e._loc.z, 0) / u.length - 20 }; }
      for (const e of alive(1)) {
        const tx = W.notes.get(e.id)?.text ?? ""; const k = FIGHT.test(tx) ? "F" : MARCH.test(tx) ? "M" : "";
        if (!k) continue; const pk = last.get(e.id); if (pk && pk !== k) flips.set(e.id, (flips.get(e.id) ?? 0) + 1); last.set(e.id, k);
      }
      const up = alive(1).filter((e) => !W.isDowned(e));
      if (up.length && up.filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 12).length >= Math.max(1, up.length - 1)) arrived = SIM.tick - t0;
      // v6.3: after the last enemy goes down, how long until the squad is on its way again (its middle 3 blocks further on)
      const mz = up.reduce((q, e) => q + e._loc.z, 0) / Math.max(1, up.length);
      if (killT < 0 && alive(2).filter((e) => !W.isDowned(e)).length === 0) { killT = SIM.tick; killZ = mz; }
      if (killT >= 0 && resume < 0 && mz > killZ + 3) resume = SIM.tick - killT;
      if (killT >= 0 && resume < 0 && opt.after) for (const e of up) { const n = W.notes.get(e.id)?.text; if (n) afterNotes[n] = (afterNotes[n] ?? 0) + 1; }
    }
    const up = (f) => alive(f).filter((e) => !W.isDowned(e)).length;
    const fl = [...flips.values()];
    report({ resumeAfterKill: resume, afterNotes: opt.after ? afterNotes : undefined, arrivedTicks: arrived, attackersUp: up(1), enemiesUp: up(2), flipsMean: +(fl.reduce((a, b) => a + b, 0) / Math.max(1, alive(1).length)).toFixed(2), flipsMax: Math.max(0, ...fl), bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), notes: M.notes });
  },

  // v6.0: a long march across a cluttered battlefield (seeded): hills, trenches with two crossings, walls with gaps,
  // a pond, ruined houses, tree clumps, shell craters. Does the whole squad get there?
  async battlefield() {
    const LEN = Number(opt.len ?? 245), K = LEN / 245;
    SIM.bounds = { x0: -90, x1: 90, z0: -30, z1: LEN + 15, y0: -12, y1: 60 };
    let rs = Number(opt.seed ?? 7) * 2654435761 >>> 0 || 1; const R = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
    const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    for (let k = 0; k < Math.round(4 * K); k++) hill(ri(-60, 60), ri(30, LEN - 25), ri(8, 18), ri(3, 9));
    for (const tz of (K > 1.2 ? [70, 160, 250, 340] : [70, 160]).filter((z) => z < LEN - 30)) {                                   // trenches: 2 deep, 2 wide, across the field; two plank crossings
      fill(-90, -2, tz, 90, -1, tz + 1, "air");
      for (const bx of [ri(-60, -10), ri(10, 60)]) fill(bx, -1, tz, bx + 2, -1, tz + 1, "oak_planks");
    }
    for (let k = 0; k < Math.round(6 * K); k++) { const x = ri(-70, 50), z = ri(20, LEN - 15), L = ri(8, 24); fill(x, 0, z, x + L, 2, z, "stone_bricks"); const g = ri(2, L - 3); fill(x + g, 0, z, x + g + 1, 2, z, "air"); }   // walls with a gap
    { const x = ri(-50, 30), z = ri(90, 140); fill(x, -2, z, x + 10, -1, z + 7, "water"); }                                                                  // a pond
    for (let k = 0; k < Math.round(2 * K); k++) { const b = building(ri(-70, 40), ri(40, LEN - 45), { windows: true }); fill(b.x0 + 3, 5, b.z0 + 3, b.x0 + 8, 15, b.z0 + 8, "air"); }  // ruined houses
    for (let k = 0; k < Math.round(8 * K); k++) { const x = ri(-80, 80), z = ri(10, LEN - 5); fill(x, 0, z, x, 3, z, "oak_log"); fill(x - 2, 3, z - 2, x + 2, 5, z + 2, "oak_leaves"); }   // trees
    for (let k = 0; k < Math.round(14 * K); k++) { const x = ri(-70, 70), z = ri(10, LEN - 5), r = ri(1, 3); for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.hypot(dx, dz) <= r) fill(x + dx, -Math.max(1, r - Math.round(Math.hypot(dx, dz))), z + dz, x + dx, -1, z + dz, "air"); }   // craters
    fill(-8, -3, -6, 8, -1, 8, "grass_block"); fill(-8, 0, -6, 8, 6, 8, "air");                                                                 // a clear start area
    spawnPlayer({ x: 0, y: 0, z: -25 });
    const N = Number(opt.n ?? 12);
    for (let i = 0; i < N; i++) soldier(1, { x: (i % 4) * 2 - 3 + 0.5, y: 0, z: Math.floor(i / 4) * 2 + 0.5 }, "rifle");
    step(20);
    const dest = { x: ri(-30, 30), y: 0, z: LEN };
    fill(dest.x - 6, -3, dest.z - 6, dest.x + 6, -1, dest.z + 6, "grass_block"); fill(dest.x - 6, 0, dest.z - 6, dest.x + 6, 8, dest.z + 6, "air");
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1; const stillT = new Map(); let worstStill = 0; let firstMove = -1, prog600 = -1; const start0 = alive(1).map((e) => ({ ...e._loc }));
    for (let t = 0; t < Number(opt.ticks ?? 7000) && arrived < 0; t += 10) {
      if (opt.watch !== undefined && SIM.tick >= Number(opt.from ?? 0) - 10 && SIM.tick <= Number(opt.to ?? 1e9)) { for (let q = 0; q < 10; q++) { step(1); const e = alive(1)[Number(opt.watch)]; const g = W.gliders.get(e.id); console.error("W", SIM.tick, e._loc.x.toFixed(2), e._loc.y.toFixed(2), e._loc.z.toFixed(2), g ? `g k${g.k} p${g.paused ? 1 : 0} b${g.blocked ?? 0}` : "-", "ban", Math.max(0, (W.glideBan.get(e.id) ?? 0) - SIM.tick), W.driveOn.has(e.id) ? "D" : "F", W.notes.get(e.id)?.text, "walk", e.walk ? `${e.walk.x.toFixed(2)},${e.walk.z.toFixed(2)}` : "", "nav", e.navGoal ? `${e.navGoal.x.toFixed(1)},${e.navGoal.y},${e.navGoal.z.toFixed(1)}` : "", (() => { const m = Object.values(W.getMarches())[0]; if (!m?.path) return ""; const pi = W.routeProgress(m, e._loc, e.id); return `pi ${pi} tight ${W.tightAt(overworld, m.path, pi, e._loc)} pts ${JSON.stringify(m.path.slice(pi, pi + 4).map((q) => [q.x, q.y, q.z]))}`; })()); } } else
      step(10); sample(1);
      if (firstMove < 0 && alive(1).filter((e, k) => Math.hypot(e._loc.x - start0[k].x, e._loc.z - start0[k].z) > 5).length >= 6) firstMove = SIM.tick - t0;
      if (SIM.tick - t0 === 600) prog600 = +(alive(1).reduce((t, e) => t + e._loc.z, 0) / alive(1).length).toFixed(1);
      if (opt.follow && SIM.tick % 20 === 0 && SIM.tick - t0 >= Number(opt.followFrom ?? 0)) { const up = alive(1); const cz = up.reduce((t, e) => t + e._loc.z, 0) / up.length, cx = up.reduce((t, e) => t + e._loc.x, 0) / up.length; player._loc = { x: cx, y: 40, z: cz - 20 }; }
      if (opt.mtrace && SIM.tick % Number(opt.every ?? 100) === 0 && SIM.tick >= Number(opt.from ?? 0)) { const m = Object.values(W.getMarches())[0]; console.error("MT", SIM.tick, "idx", m?.idx, "len", m?.path?.length, "end", JSON.stringify(m?.path?.[m.path.length - 1]), "legs", m?.legs?.length, "replans", m?.replans, "wides", m?.wides, "final", m?.final, "stuck", m?.stuck, "plan", m?.planning, "coarse", m?.coarse, "guess", !!m?.path?.guess, "p", JSON.stringify(m?.path?.[m.idx]), "shape", m?.shape, alive(1).map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}${e.dyn.get("war:catchup") === e.dyn.get("war:fmk") ? "F" : "D"}${W.gliders.has(e.id) ? "g" : ""}${e.dyn.get("war:goal") === e.dyn.get("war:catchup") ? "" : "!"}`).join(" ")); }
      for (const e of alive(1)) { const near = Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 12; const st = near ? 0 : (e.__still ?? 0); if (opt.still && st === 20) console.error("STILL", SIM.tick, JSON.stringify(e._loc), W.notes.get(e.id)?.text, [...e.groups].filter((g) => /g_/.test(g)).join(","), "goal", e.dyn.get("war:goal"), "cu", e.dyn.get("war:catchup"), "glide", W.gliders.has(e.id), "pers", W.personal.has(e.id)); worstStill = Math.max(worstStill, st); }
      if (alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 12).length >= N - 1) arrived = SIM.tick - t0;
    }
    const there = alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 12).length;
    if (opt.route) { const m = Object.values(W.getMarches())[0]; console.error("ROUTE", JSON.stringify((m?.path ?? []).filter((q) => Math.abs(q.z - Number(opt.route)) < 8).map((q) => [q.x, q.y, q.z, q.climb ? "C" : ""]))); console.error("LEGS", JSON.stringify(m?.legs), "legT", JSON.stringify(m?.legT)); }
    if (opt.blocks) { const [bx, bz] = opt.blocks.split(",").map(Number); for (let z = bz - 2; z <= bz + 4; z++) console.error("COL z", z, [-3, -2, -1, 0, 1, 2].map((y) => `${y}:${MC.idAt(bx, y, z).replace("minecraft:", "")}`).join(" ")); }
    if (opt.dump) for (const [id, m] of Object.entries(W.getMarches())) console.error("MARCH", id, "idx", m.idx, "len", m.path?.length, "planning", m.planning, "final", m.final, "replans", m.replans, "legs", m.legs?.length, "dead", JSON.stringify(m.dead), "progT", SIM.tick - m.progT, "pathEnd", JSON.stringify(m.path?.[m.path.length - 1]), "guess", !!m.path?.guess, "path@idx", JSON.stringify(m.path?.slice(Math.max(0, (m.idx ?? 0) - 2), (m.idx ?? 0) + 3)));
    if (opt.dump) for (const e of alive(1)) if (Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) >= 12) { const m = Object.values(W.getMarches())[0]; const g = W.gliders.get(e.id); const mk = W.marker(Number(e.dyn.get("war:catchup") ?? 0)); const pi = m?.path ? W.routeProgress(m, e._loc, e.id) : -1; console.error("DBG", e.id, "glider", g ? JSON.stringify({ k: g.k, paused: g.paused, wait: g.wait, blocked: g.blocked, t: SIM.tick - g.t }) : "-", "ban", (W.glideBan.get(e.id) ?? 0) - SIM.tick, "drive", JSON.stringify(W.driveOn.get(e.id)), "mk", mk ? JSON.stringify(mk._loc) : "-", "pi", pi, "tight", m?.path ? W.tightAt(overworld, m.path, pi, e._loc) : "-", "pts", JSON.stringify(m?.path?.slice(Math.max(0, pi - 1), pi + 3).map((p) => [p.x, p.y, p.z])), "nav", JSON.stringify(e.navGoal), "walk", JSON.stringify(e.walk), "vel", JSON.stringify(e.vel)); }
    if (opt.dump) for (const e of alive(1)) if (Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) >= 12) console.error("LEFT", JSON.stringify(e._loc), W.notes.get(e.id)?.text, "cu", e.dyn.get("war:catchup"), "goal", e.dyn.get("war:goal"), "og", e.dyn.get("war:ordergoal"));
    report({ firstMove, prog600, msgs: SIM.log.filter((m) => /war|Squad|far|position|way/i.test(m)).slice(-4), plan: globalThis.__plan ? { ...globalThis.__plan, maxHeapMB: Math.round(globalThis.__plan.maxHeap / 1048576) } : undefined, arrivedTicks: arrived, there, of: N, worstStillSec: worstStill / 2, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), dest, final: alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`), notes: M.notes });
  },

  // v6.1: from the screenshots: a squad on a castle wall-top (battlements both sides, an enclosed courtyard below with a
  // ladder, a lava moat on the other side) charges a building across the moat. The only way over is a narrow bridge
  // with no railings. Counts falls into the courtyard / the moat, who crossed, how long it took.
  async castleMoat() {
    SIM.bounds = { x0: -45, x1: 45, z0: -40, z1: 45, y0: -10, y1: 40 };
    if (opt.layout === "2") return S.castleChannel();
    fill(-30, 0, -10, 30, 7, -8, "stone_bricks");                                          // the wall (walk on y=8, z=-9)
    for (let x = -30; x <= 30; x += 2) { setBlock(x, 8, -10, "stone_bricks"); setBlock(x, 8, -8, "stone_bricks"); }   // battlements
    fill(-30, 0, -30, 30, 7, -30, "stone_bricks"); fill(-30, 0, -30, -30, 7, -10, "stone_bricks"); fill(30, 0, -30, 30, 7, -10, "stone_bricks");   // courtyard walls
    for (let y = 0; y <= 7; y++) setBlock(-2, y, -11, "ladder");                             // ladder from the courtyard
    fill(-30, -3, -7, 30, -3, 8, "stone"); fill(-30, -2, -7, 30, -1, 8, "lava");             // the lava moat
    fill(10, 0, -7, 11, 7, -7, "air");
    fill(10, 7, -7, 11, 7, 8, "stone_bricks");                                             // the bridge (walk on y=8), no railings
    fill(10, 0, 9, 11, 7, 10, "stone_bricks");                                             // landing on the far side
    for (let i = 0; i < 7; i++) fill(10, 0, 11 + i, 11, 6 - i, 11 + i, "stone_bricks");    // steps down to the ground
    const b = building(0, 24);                                                              // the enemy building (door faces the castle)
    spawnPlayer({ x: 0, y: 8, z: -35 });
    const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi", "smg", "rifle"];
    for (let i = 0; i < 8; i++) soldier(1, { x: -20 + i * 2 + 0.5, y: 8, z: -8.5 }, W8[i]);
    for (let i = 0; i < Number(opt.def ?? 4); i++) soldier(2, { x: 2 + i * 2.5 + 0.5, y: 6, z: 25.5 }, "rifle", 1, "hold");
    W.setRelPair(1, 2, "1", false);
    step(20);
    await order(1, { x: 6, y: 0, z: 22 });
    if (opt.mutual) await order(2, { x: -10, y: 8, z: -9 });                                  // they rush the castle too
    const t0 = SIM.tick; const fellCourt = new Set(), fellMoat = new Set(), crossed = new Set(); let firstCross = -1;
    for (let t = 0; t < Number(opt.ticks ?? 3600); t += 10) {
      step(10); sample(1);
      for (const e of alive(1)) {
        const l = e._loc;
        if (l.z < -10.5 && l.y < 6) fellCourt.add(e.id);
        if (l.z > -7.5 && l.z < 8.5 && l.y < 1 && !(l.x >= 9.5 && l.x <= 12.5)) fellMoat.add(e.id);
        if (l.z > 10) { crossed.add(e.id); if (firstCross < 0) firstCross = SIM.tick - t0; }
      }
      if (opt.fall) for (const e of [...alive(1), ...alive(2)]) { const h = (e.__h ??= []); h.push(`${SIM.tick} ${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)} ${W.notes.get(e.id)?.text ?? ""} g${W.gliders.has(e.id) ? 1 : 0} ${[...e.groups].filter((g) => /g_/.test(g)).join(",")}`); if (h.length > 12) h.shift(); if (e._loc.y < 1 && e._loc.z > -7.5 && e._loc.z < 8.5 && !e.__told) { e.__told = 1; console.error("FALL", e.props.get("war:faction"), "\n  " + h.join("\n  ")); } }
      for (const e of alive(2)) { const l = e._loc; if (l.z > -7.5 && l.z < 8.5 && l.y < 1 && !(l.x >= 9.5 && l.x <= 12.5)) fellMoat.add(e.id); if (l.z < -10.5 && l.y < 6) fellCourt.add(e.id); }
      if (!alive(2).filter((e) => !W.isDowned(e)).length && crossed.size >= alive(1).filter((e) => !W.isDowned(e)).length) break;
      if (opt.mutual && (!alive(1).filter((e) => !W.isDowned(e)).length || !alive(2).filter((e) => !W.isDowned(e)).length)) break;
    }
    report({ ticks: SIM.tick - t0, fellCourtyard: fellCourt.size, fellMoat: fellMoat.size, crossed: crossed.size, firstCross, attackersUp: alive(1).filter((e) => !W.isDowned(e)).length, defendersUp: alive(2).filter((e) => !W.isDowned(e)).length, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), final: alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`), notes: M.notes });
  },

  // v6.2: the first screenshot: a narrow wall-top (2 wide) running right along a lava channel, no battlements on the
  // lava side; the enemy building is across the channel; the only crossing is a bridge over the lava further along.
  async castleChannel() {
    fill(-40, -3, 0, 40, -3, 6, "stone"); fill(-40, -2, 0, 40, -1, 6, "lava");               // the channel (lava 2 deep)
    fill(-40, 0, -2, 40, 7, -1, "stone_bricks");                                             // castle wall along it (walk y=8, z=-2..-1)
    for (let x = -40; x <= 40; x += 2) setBlock(x, 8, -3, "stone_bricks");                    // battlements on the castle side only
    fill(-40, 0, -3, 40, 7, -3, "stone_bricks");
    fill(-40, 0, 7, 40, 7, 8, "stone_bricks");                                               // far bank wall (walk y=8, z=7..8)
    fill(12, 7, 0, 13, 7, 6, "stone_bricks");                                                // the bridge over the lava (y=8), no railings
    for (let i = 0; i < 7; i++) fill(-40, 0, 9 + i, 40, 6 - i, 9 + i, "stone_bricks");       // the far bank steps down to the ground
    for (let y = 0; y <= 7; y++) setBlock(0, y, -4, "ladder");                               // ladder from the courtyard below
    building(0, 24);
    spawnPlayer({ x: 0, y: 8, z: -30 });
    const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi", "smg", "rifle"];
    for (let i = 0; i < 8; i++) soldier(1, { x: -20 + i * 2 + 0.5, y: 8, z: -1.5 }, W8[i]);
    for (let i = 0; i < Number(opt.def ?? 4); i++) soldier(2, { x: 2 + i * 2.5 + 0.5, y: 6, z: 25.5 }, "rifle", 1, "hold");
    W.setRelPair(1, 2, "1", false);
    step(20);
    await order(1, { x: 6, y: 0, z: 22 });
    if (opt.mutual) await order(2, { x: -10, y: 8, z: -1.5 });
    const t0 = SIM.tick; const fellMoat = new Set(), crossed = new Set(); let firstCross = -1;
    for (let t = 0; t < Number(opt.ticks ?? 3600); t += 10) {
      if (opt.fall) { for (let q = 0; q < 10; q++) { step(1); for (const e of [...alive(1), ...alive(2)]) { const h = (e.__h ??= []); h.push(`${SIM.tick} ${e._loc.x.toFixed(2)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(2)} v${e.vel.x.toFixed(2)},${e.vel.z.toFixed(2)} w${(e.walk?.x ?? 0).toFixed(2)},${(e.walk?.z ?? 0).toFixed(2)} ${W.notes.get(e.id)?.text ?? ""} g${W.gliders.has(e.id) ? 1 : 0} nav:${e.navGoal ? `${e.navGoal.x.toFixed(1)},${e.navGoal.y},${e.navGoal.z.toFixed(1)}` : "-"}`); if (h.length > 25) h.shift(); if (SIM.lavaIds?.has(e.id) && !e.__told) { e.__told = 1; console.error("LAVA f" + e.props.get("war:faction") + "\n  " + h.filter((x, k) => k % 2 === 0).join("\n  ")); } } } sample(1); } else { step(10); sample(1); }
      for (const e of [...alive(1), ...alive(2)]) { const l = e._loc; if (l.z > -0.5 && l.z < 6.5 && l.y < 1 && !(l.x >= 11.5 && l.x <= 14.5)) fellMoat.add(e.id); }
      for (const e of alive(1)) if (e._loc.z > 9) { crossed.add(e.id); if (firstCross < 0) firstCross = SIM.tick - t0; }
      const up1 = alive(1).filter((e) => !W.isDowned(e)).length, up2 = alive(2).filter((e) => !W.isDowned(e)).length;
      if (!up1 || !up2 || (crossed.size >= up1 && !up2)) break;
    }
    report({ ticks: SIM.tick - t0, fellMoat: fellMoat.size, crossed: crossed.size, firstCross, attackersUp: alive(1).filter((e) => !W.isDowned(e)).length, defendersUp: alive(2).filter((e) => !W.isDowned(e)).length, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), final: alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`), notes: M.notes });
  },

  // v6.2: the cleanup / repair tools, including things in unloaded land (removed the moment it loads)
  // v6.3: knocked into lava. A soldier holds right at the edge of a lava channel; something hits him toward it.
  //   mode=enemy (enemy player's punch), friend (a friendly player's), bullet (an enemy soldier's bullet), mob (a zombie),
  //   boom (an explosion), fear (an enemy player just walks up: he should back away from the edge, not be hit)
  async knock() {
    SIM.bounds = { x0: -20, x1: 30, z0: -20, z1: 20, y0: -8, y1: 20 };
    fill(-20, -4, -20, 30, -1, 20, "stone"); fill(4, -3, -20, 7, -1, 20, "lava");          // a lava channel 4 wide
    spawnPlayer({ x: -15, y: 0, z: -15 });
    W.setRelPair(1, 2, "1", false);
    const mode = opt.mode ?? "enemy";
    const e = soldier(1, { x: 3.5, y: 0, z: 0.5 }, "rifle", 1, "hold");
    step(40);
    const foe = new MC.Player({ x: 1.5, y: 0, z: 0.5 }, overworld); foe.tags.clear(); foe.tags.add(mode === "friend" ? "war_f1" : "war_f2"); foe.name = "Foe";
    if (mode === "fear") { step(120); report({ mode, pos: e._loc, inLava: SIM.lavaIds?.size ?? 0, backedAway: e._loc.x < 2.6 || Math.abs(e._loc.z - 0.5) > 1, note: W.notes.get(e.id)?.text }); return; }
    if (mode !== "enemy" && mode !== "friend") foe.remove?.();
    let src, cause = "entityAttack";
    if (mode === "enemy" || mode === "friend") src = foe;
    else if (mode === "bullet") { src = soldier(2, { x: -10.5, y: 0, z: 0.5 }, "rifle", 1, "hold"); cause = "projectile"; }
    else if (mode === "mob") src = overworld.spawnEntity("minecraft:zombie", { x: 1.5, y: 0, z: 0.5 });
    else if (mode === "boom") { src = undefined; cause = "blockExplosion"; }
    const hp0 = e.hp;
    e.applyDamage(1, { damagingEntity: src, cause });
    e.vel.x += Number(opt.kb ?? 0.4); e.vel.y = 0.36;               // Minecraft's knockback (~0.4), away from the hit, toward the lava
    for (let t = 0; t < 60; t++) step(1);
    report({ mode, pos: { x: +e._loc.x.toFixed(2), y: +e._loc.y.toFixed(2) }, inLava: SIM.lavaIds?.size ?? 0, fell: e._loc.y < -0.5 || !e.isValid, hp0 });
  },

  // v6.3: the TP wand. Pick up a guard and two marchers, walk away, put them down; then they carry on.
  async wand() {
    SIM.bounds = { x0: -60, x1: 160, z0: -60, z1: 60, y0: -8, y1: 20 };
    fill(-60, -4, -60, 160, -1, 60, "stone");
    fill(20, -3, 10, 23, -1, 14, "lava");                            // lava near the drop spot: nobody lands by it
    spawnPlayer({ x: 0, y: 0, z: -5 });
    player._mainhand = "war:tp_wand";
    const guard = soldier(1, { x: 0.5, y: 0, z: 0.5 }, "rifle", 1, "hold");
    const ms = []; for (let i = 0; i < 4; i++) ms.push(soldier(1, { x: 4.5 + i * 2, y: 0, z: 0.5 }, "rifle", 2, "hold"));
    const enemy = soldier(2, { x: 0.5, y: 0, z: 40.5 }, "rifle", 1, "hold"); enemy.static = false;
    step(40);
    await W.giveOrder(player, { faction: 1, order: 0, squad: 2, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: 140, cz: 0, cy: 0, then: "hold" });
    step(100);
    const hp = guard.hp;
    guard.applyDamage(3, { damagingEntity: player, cause: "entityAttack" });   // left-click with the wand
    ms[0].applyDamage(3, { damagingEntity: player, cause: "entityAttack" });
    ms[1].applyDamage(3, { damagingEntity: player, cause: "entityAttack" });
    enemy.applyDamage(1, { damagingEntity: player, cause: "entityAttack" });  // not ours: just a hit
    step(2);
    const heldN = W.held.size, unhurt = guard.hp === hp, hidden = guard.props.get("war:held") === true, inLoops = W.allOf(SOLDIER).some((x) => x.id === guard.id);
    for (let t = 0; t < 40; t++) { player._loc = { x: 22 + t * 0.2, y: 0, z: 8 }; step(1); }   // walk off with them (past some lava)
    const withMe = [guard, ms[0], ms[1]].every((x) => Math.hypot(x._loc.x - player._loc.x, x._loc.z - player._loc.z) < 0.5);
    for (let t = 0; t < 20; t++) { MC.SIM.tick; step(1); }
    const shotsBefore = SIM.shots ?? 0;
    MC.world.afterEvents.itemUse.fire({ source: player, itemStack: { typeId: "war:tp_wand" } });   // right-click: put them down
    step(4);
    const put = [guard, ms[0], ms[1]].map((x) => ({ x: +x._loc.x.toFixed(1), y: x._loc.y, z: +x._loc.z.toFixed(1) }));
    let minGap = 99; for (let i = 0; i < put.length; i++) for (let j = i + 1; j < put.length; j++) minGap = Math.min(minGap, Math.hypot(put[i].x - put[j].x, put[i].z - put[j].z));
    const byLava = put.some((q) => q.x > 18 && q.x < 25 && q.z > 8 && q.z < 16 && (Math.min(Math.abs(q.x - 20), Math.abs(q.x - 24)) < 1 || Math.min(Math.abs(q.z - 10), Math.abs(q.z - 15)) < 1));
    step(200);
    const guardStays = Math.hypot(guard._loc.x - put[0].x, guard._loc.z - put[0].z) < 4;   // his new post is where he was put down
    let arrived = -1; const t0 = SIM.tick;
    for (let t = 0; t < 4000 && arrived < 0; t += 10) { step(10); if (ms.filter((x) => x.isValid && Math.hypot(x._loc.x - 140, x._loc.z) < 12).length >= 4) arrived = SIM.tick - t0; }
    report({ heldN, unhurt, hidden, inLoops, withMe, put, minGap: +minGap.toFixed(2), byLava, released: W.held.size === 0 && guard.props.get("war:held") === false, guardStays, marchersArrived: arrived, enemyHit: enemy.hp < enemy.maxHp, msgs: SIM.log.filter((m) => /\[bar\]/.test(m)).slice(-3) });
  },

  // v6.3: two squads, one spot. mode=same: both ordered to the same point from different sides; mode=cross: they march
  // through each other head-on along the same corridor (a gap in a wall); mode=follow: the second one right behind the first
  async twoSquads() {
    let mode = opt.mode ?? "same", mode2;
    SIM.bounds = { x0: -80, x1: 80, z0: -40, z1: 160, y0: -8, y1: 30 };
    fill(-80, -4, -40, 80, -1, 160, "stone");
    if (mode === "cross") { fill(-80, 0, 60, 80, 3, 60, "stone_bricks"); fill(-1, 0, 60, 1, 2, 60, "air"); }   // a wall with a 3-wide gap
    if (mode === "open") mode = "cross";     // (head-on in the open: no wall)
    spawnPlayer({ x: 0, y: 0, z: 50 });
    const A = [], B = [];
    for (let i = 0; i < 8; i++) A.push(soldier(1, { x: -6 + (i % 4) * 2 + 0.5, y: 0, z: (mode === "same" ? 0 : 0) + Math.floor(i / 4) * 2 + 0.5 }, "rifle", 1, "hold"));
    for (let i = 0; i < 8; i++) B.push(soldier(1, mode === "same" ? { x: 40 + (i % 4) * 2 + 0.5, y: 0, z: 30 + Math.floor(i / 4) * 2 + 0.5 } : mode === "cross" ? { x: -6 + (i % 4) * 2 + 0.5, y: 0, z: 120 + Math.floor(i / 4) * 2 + 0.5 } : { x: -6 + (i % 4) * 2 + 0.5, y: 0, z: -14 + Math.floor(i / 4) * 2 + 0.5 }, "rifle", 2, "hold"));
    step(40);
    const dA = mode === "cross" ? { x: 0, z: 120 } : { x: 0, z: 100 }, dB = mode === "cross" ? { x: 0, z: 0 } : { x: 0, z: 100 };
    const go = (sq, d) => W.giveOrder(player, { faction: 1, order: 0, squad: sq, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: d.x, cz: d.z, cy: 0, then: "hold" });
    await go(1, dA); await go(2, dB);
    const t0 = SIM.tick; let doneA = -1, doneB = -1, worstStill = 0, jitter = 0;
    const lastPos = new Map(), still = new Map();
    const wa = () => { const e = (opt.side === "B" ? B : A)[Number(opt.wa)]; const g = W.gliders.get(e.id); const r = W.routeOf(e); const cu = e.dyn.get("war:catchup"); const mk = cu ? W.marker(Number(cu)) : undefined; console.error("WA", SIM.tick, e._loc.x.toFixed(2), e._loc.z.toFixed(2), (W.notes.get(e.id)?.text ?? "").slice(0, 16), g ? `G k${g.k} p${g.paused ? 1 : 0} b${g.blocked ?? 0} tgt ${g.pts[g.k]?.x},${g.pts[g.k]?.z}` : "-", "r", r ? `${r.idx}/${r.pts.length}` : "-", "mk", mk ? `${mk._loc.x.toFixed(1)},${mk._loc.z.toFixed(1)}` : "-", [...e.groups].filter((q) => /g_/.test(q)).join(","), W.driveOn.has(e.id) ? "D" : "", W.formMode.has(e.id) ? "F" : "", W.personal.has(e.id) ? "P" : ""); };
    for (let t = 0; t < Number(opt.ticks ?? 5000) && (doneA < 0 || doneB < 0); t += 10) {
      if (opt.wa !== undefined && SIM.tick >= Number(opt.from ?? 0) && SIM.tick <= Number(opt.to ?? 1e9)) { for (let q = 0; q < 10; q++) { step(1); wa(); } } else step(10);
      sample(1);
      if (opt.follow) { const u = [...A, ...B].filter((e) => e.isValid); player._loc = { x: u.reduce((q, e) => q + e._loc.x, 0) / u.length, y: 0, z: u.reduce((q, e) => q + e._loc.z, 0) / u.length }; }
      if (false && opt.wa !== undefined && SIM.tick >= Number(opt.from ?? 0) && SIM.tick <= Number(opt.to ?? 1e9)) { const e = (opt.side === "B" ? B : A)[Number(opt.wa)]; const g = W.gliders.get(e.id); const r = W.routeOf(e); const cu = e.dyn.get("war:catchup"); const mk = cu ? W.marker(Number(cu)) : undefined; console.error("WA", SIM.tick, e._loc.x.toFixed(2), e._loc.z.toFixed(2), (W.notes.get(e.id)?.text ?? "").slice(0, 16), g ? `G k${g.k} p${g.paused ? 1 : 0} tgt ${g.pts[g.k]?.x},${g.pts[g.k]?.z} len${g.pts.length}` : "-", "r", r ? `${r.idx}/${r.pts.length}` : "-", "mk", mk ? `${mk._loc.x.toFixed(1)},${mk._loc.z.toFixed(1)}` : "-", "nav", e.navGoal ? `${e.navGoal.x.toFixed(1)},${e.navGoal.z.toFixed(1)}` : "-", [...e.groups].filter((q) => /g_/.test(q)).join(","), W.driveOn.has(e.id) ? "D" : "", W.formMode.has(e.id) ? "F" : ""); }
      if (opt.gap && SIM.tick % 50 === 0) { const g = [...A, ...B].filter((e) => Math.abs(e._loc.z - 60) < 7); if (g.length) console.error("GAP", SIM.tick, g.map((e) => `${A.includes(e) ? "A" : "B"}${e._loc.x.toFixed(1)},${e._loc.z.toFixed(1)}:${(W.notes.get(e.id)?.text ?? "").slice(0, 14)}${W.gliders.has(e.id) ? `/G${W.gliders.get(e.id).k}p${W.gliders.get(e.id).paused ? 1 : 0}b${W.gliders.get(e.id).blocked ?? 0}w${W.gliders.get(e.id).wait}` : ""}${W.personal.has(e.id) ? "/P" : ""}`).join(" | ")); }
      const near = (L, d) => L.filter((e) => e.isValid && Math.hypot(e._loc.x - d.x, e._loc.z - d.z) < 12).length;
      if (doneA < 0 && near(A, dA) >= 7) doneA = SIM.tick - t0;
      if (doneB < 0 && near(B, dB) >= 7) doneB = SIM.tick - t0;
      for (const e of [...A, ...B]) {
        const lp = lastPos.get(e.id), l = e._loc;
        const moved = lp ? Math.hypot(l.x - lp.x, l.z - lp.z) : 9;
        const dd = Math.min(Math.hypot(l.x - dA.x, l.z - dA.z), Math.hypot(l.x - dB.x, l.z - dB.z));
        if (moved < 0.6 && dd > 12) still.set(e.id, (still.get(e.id) ?? 0) + 1); else still.set(e.id, 0);
        if (lp && moved > 0.15 && moved < 0.6 && dd > 12) jitter++;                // shuffling on the spot
        worstStill = Math.max(worstStill, still.get(e.id));
        lastPos.set(e.id, { ...l });
      }
    }
    const pos = (L) => L.map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.z)}`);
    report({ mode, doneA, doneB, worstStillSec: worstStill / 2, jitter, bunchAvg: +(M.bunchPairs / M.bunchSamples).toFixed(2), maxCluster: M.maxCluster, A: pos(A), B: pos(B), notes: Object.fromEntries(Object.entries(M.notes).sort((a, b) => b[1] - a[1]).slice(0, 8)) });
  },

  // v6.4: the screenshots. pondWall: a pond right at the foot of a high wall; the squad's goal is beyond the wall
  // (a gap far to the side: gap=0 for no gap and a stair up onto it instead). wallTop: a castle wall, a moat at its
  // foot outside, defenders put on the wall walk (between merlons), enemies coming from beyond the moat.
  async pondWall() {
    SIM.bounds = { x0: -50, x1: 50, z0: -20, z1: 70, y0: -8, y1: 30 };
    fill(-50, -5, -20, 50, -1, 70, "grass_block");
    if (opt.stream) { fill(-50, -3, 8, 50, -1, 12, "water"); fill(-50, 0, 13, 50, 0, 13, "grass_block"); }   // a stream across the whole field, a 1-high bank beyond
    else fill(-8, -3, 8, 8, -1, 16, "water");                             // the pond, 3 deep, right up to the wall
    fill(-30, 0, 17, 30, 3, 18, "stone_bricks");                        // a 4-high wall
    if (opt.stream) fill(-30, 0, 17, 30, 3, 18, "air"); else if (opt.gap !== "0") fill(24, 0, 17, 26, 3, 18, "air"); else for (let k = 0; k < 4; k++) fill(-20 + k, 0, 16, -20 + k, k, 16, "stone_bricks");   // a gap far right, or steps up along the wall
    spawnPlayer({ x: 0, y: 0, z: -15 });
    for (let i = 0; i < 8; i++) soldier(1, { x: -3 + (i % 4) * 2 + 0.5, y: 0, z: Math.floor(i / 4) * 2 + 0.5 }, "rifle", 1, "hold");
    step(40);
    const dest = opt.inpond ? { x: 0, y: -1, z: 14 } : opt.gap === "0" ? { x: 0, y: 4, z: 18 } : { x: 0, y: 0, z: 40 };
    await W.giveOrder(player, { faction: 1, order: Number(opt.order ?? 0), squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: dest.x, cz: dest.z, cy: dest.y, then: "hold" });
    const t0 = SIM.tick; let arrived = -1, wetMax = 0, wetSum = 0;
    for (let t = 0; t < Number(opt.ticks ?? 3000) && arrived < 0; t += 10) {
      step(10); sample(1);
      const wet = alive(1).filter((e) => e.isInWater).length; wetMax = Math.max(wetMax, wet); wetSum += wet;
      if (alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 10 && (opt.inpond ? !e.isInWater : Math.abs(e._loc.y - dest.y) < 2)).length >= 7 && (!opt.inpond || SIM.tick - t0 > 600)) arrived = SIM.tick - t0;
      if (opt.trace && SIM.tick % 100 === 0) console.error("T", SIM.tick, alive(1).map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}${e.isInWater ? "w" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 12)}`).join(" "));
      if (opt.w1 !== undefined && SIM.tick >= Number(opt.from ?? 0) && SIM.tick <= Number(opt.to ?? 1e9)) { const e = alive(1)[Number(opt.w1)]; const g = W.gliders.get(e.id); const r = W.routeOf(e); console.error("W1", SIM.tick, e._loc.x.toFixed(2), e._loc.y.toFixed(2), e._loc.z.toFixed(2), e.isInWater ? "wet" : "dry", (W.notes.get(e.id)?.text ?? "").slice(0, 18), g ? `G k${g.k} p${g.paused ? 1 : 0} b${g.blocked ?? 0} tgt ${JSON.stringify(g.pts[g.k])}` : "-", "r", r ? `${r.idx}/${r.pts.length} ${JSON.stringify(r.pts.slice(r.idx, r.idx + 3).map((q) => [q.x, q.y, q.z, q.w ? "w" : ""]))}` : "-", "pers", W.personal.has(e.id), "vel", e.vel.y.toFixed(2), [...e.groups].filter((q) => /g_/.test(q)).join(",")); }
    }
    report({ arrivedTicks: arrived, wetMax, wetSec: +(wetSum / 2 / 8).toFixed(1), final: alive(1).map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}${e.isInWater ? "w" : ""}`), notes: Object.fromEntries(Object.entries(M.notes).sort((a, b) => b[1] - a[1]).slice(0, 8)) });
  },
  async wallTop() {
    SIM.bounds = { x0: -40, x1: 40, z0: -30, z1: 70, y0: -8, y1: 30 };
    fill(-40, -5, -30, 40, -1, 70, "grass_block");
    fill(-30, 0, 0, 30, 5, 3, "stone_bricks");                           // the wall: 4 thick, 6 high; walk on top at y 6
    for (let x = -30; x <= 30; x += 2) fill(x, 6, 3, x, 7, 3, "quartz_block");   // merlons on the outer edge, 1 gap between
    for (let k = 0; k < 6; k++) fill(-12 + k, 0, -1 - 0, -12 + k, k, -1, "stone_bricks");   // a stair up from the courtyard (inside, z < 0)
    fill(-30, -3, 4, 30, -1, 9, "water");                                 // the moat outside
    spawnPlayer({ x: 0, y: 0, z: -20 });
    W.setRelPair(1, 2, "1", false);
    const def = []; for (let i = 0; i < 6; i++) def.push(soldier(1, { x: -5 + i * 2 + 0.5, y: 6, z: 1.5 }, "rifle", 1, opt.func ?? "post"));
    const mates = opt.mates === "0" ? [] : [soldier(1, { x: 0.5, y: 0, z: -10.5 }, "rifle", 1, "hold"), soldier(1, { x: 2.5, y: 0, z: -10.5 }, "rifle", 1, "hold")];
    step(40);
    const foes = []; for (let i = 0; i < 6; i++) foes.push(soldier(2, { x: -5 + i * 2 + 0.5, y: 0, z: 45.5 }, "rifle", 1, "hold"));
    step(20);
    await W.giveOrder(player, { faction: 2, order: 0, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: 0, cz: 15, cy: 0, then: "hold" });
    const t0 = SIM.tick; const start = def.map((e) => ({ ...e._loc }));
    let offWall = 0, tps = 0;
    const tp0 = MC.Entity.prototype.teleport;
    for (let t = 0; t < Number(opt.ticks ?? 2400); t += 10) {
      step(10);
      if (opt.trace && SIM.tick % Number(opt.trace) === 0) console.error("T", SIM.tick, def.map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(1)}h${Math.round(e.hp)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 16)}`).join(" | "));
    }
    offWall = def.filter((e) => e.isValid && (e._loc.y < 5.5 || e._loc.z > 3.9 || e._loc.z < -0.1)).length;
    report({ offWall, defUp: def.filter((e) => e.isValid && !W.isDowned(e)).length, foesUp: foes.filter((e) => e.isValid && !W.isDowned(e)).length, final: def.map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(1)},${e._loc.z.toFixed(1)}`), notes: Object.fromEntries(Object.entries(M.notes).sort((a, b) => b[1] - a[1]).slice(0, 10)) });
  },

  // v6.9: a flat roof (no parapet), 8 up. Defenders hold 3-4 blocks back from the edge; the enemy comes across open
  //   ground to a hut. They should step up to the edge to shoot down (and not fall), not stand back seeing nothing.
  //   mode=medic: no enemy; a man is down right at the roof edge, a medic on the roof must reach and revive him.
  async rooftop() {
    SIM.bounds = { x0: -40, x1: 40, z0: -20, z1: 70, y0: -8, y1: 30 };
    fill(-40, -4, -20, 40, -1, 70, "grass_block");
    fill(-15, 0, 0, 15, 7, 14, "stone_bricks");                           // the block: walk on the roof at y 8, edge at z 14
    if (opt.ladder) fill(-14, 0, -1, -14, 7, -1, "ladder");
    const hut = opt.hut !== "0";
    if (hut) { fill(-3, 0, 24, 3, 4, 30, "oak_planks"); fill(-2, 0, 25, 2, 3, 29, "air"); setBlock(0, 0, 30, "air"); setBlock(0, 1, 30, "air"); setBlock(0, 1, 24, "air"); setBlock(-2, 1, 24, "air"); setBlock(2, 1, 24, "air"); }   // a hut, door at the back, windows facing the roof
    spawnPlayer({ x: 0, y: 8, z: 4 });
    W.setRelPair(1, 2, "1", false);
    const out = {};
    if (opt.mode === "medic") {
      const hurt = soldier(1, { x: 0.5, y: 8, z: 13.5 }, "rifle", 1, "hold");
      const med = overworld.spawnEntity(SOLDIER, opt.medGround ? { x: 8.5, y: 0, z: 20.5 } : { x: 8.5, y: 8, z: 4.5 }, { spawnEvent: "war:init" });
      W.setupSoldier(med, { faction: 1, squad: 1, weapon: "rifle", ranged: true, div: "medic", radius: 8, func: "__none" }, player); W.giveFunction(med, "hold", player);
      step(40); SIM.voices = [];
      W.goDown(hurt);
      let at = -1;
      for (let t = 0; t < Number(opt.ticks ?? 1200) && at < 0; t += 5) { step(5); if (!W.isDowned(hurt)) at = t; }
      report({ revivedAfter: at, medicAt: `${med._loc.x.toFixed(1)},${med._loc.y.toFixed(1)},${med._loc.z.toFixed(1)}`, medicFell: med._loc.y < 7, note: W.notes.get(med.id)?.text, voices: SIM.voices.map((v) => v.split(" ")[1]) });
      return;
    }
    const def = []; for (let i = 0; i < 4; i++) def.push(soldier(1, { x: -6 + i * 4 + 0.5, y: 8, z: 10.5 }, "rifle", 1, opt.func ?? "hold"));
    step(40);
    if (opt.perch) console.error("PERCH", W.perchSpot(def[0], { x: 0.5, y: 8, z: 14.5 }), W.dangerNear(overworld, { x: 0.5, y: 8, z: 14.5 }), JSON.stringify(W.safeSpot(def[0], { x: 0.5, y: 8, z: 14.5 }, SIM.tick, true)));
    const foes = []; for (let i = 0; i < 6; i++) foes.push(soldier(2, { x: -5 + i * 2 + 0.5, y: 0, z: 55.5 }, "rifle", 1, "hold"));
    step(20);
    await W.giveOrder(player, { faction: 2, order: 0, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: 0, cz: 27, cy: 0, then: "hold" });
    const t0 = SIM.tick; let edgeT = 0, fell = 0, inHutShots = 0;
    if (opt.mvdbg) globalThis.__mvdbg = (e, a, b, p, sr, ind, pas) => { if (e === def[Number(opt.mvdbg)] && SIM.tick % 50 < 5) console.error("MV", SIM.tick, JSON.stringify(e._loc), "want", JSON.stringify(a), "safe", JSON.stringify(b), "perch", p, "straight", sr, ind, pas, "pers", W.personal.has(e.id), JSON.stringify(W.personal.get(e.id)?.pts?.slice(-2))); };
    const s0 = SIM.shots.length;
    for (let t = 0; t < Number(opt.ticks ?? 2400); t += 10) {
      step(10);
      if (opt.edbg && SIM.tick % 100 === 0) { const e = def[Number(opt.edbg)]; if (e.isValid) { const d = W.sd(e); let r; try { r = W.engagement(e, d, SIM.tick, d.goal, false); } catch (err) { r = String(err); } console.error("E", SIM.tick, JSON.stringify(e._loc), d.func, "goal", d.goal, JSON.stringify(W.marker(d.goal)?._loc), "nav", JSON.stringify(e.navGoal), "grp", [...e.groups].join(","), "eng", JSON.stringify(r), "pers", JSON.stringify(W.personal.get(e.id) ? { k: W.personal.get(e.id).kind, n: W.personal.get(e.id).pts?.length, end: W.personal.get(e.id).pts?.at(-1), pl: W.personal.get(e.id).planning } : null), "st", JSON.stringify(e.dyn.get("war:st")), "threat", W.perc.get(e.id)?.threat?._loc ? JSON.stringify(W.perc.get(e.id).threat._loc) : "-", "note", W.notes.get(e.id)?.text); } }
      sample(1); for (const e of def) if (e.isValid && !W.isDowned(e) && e._loc.y > 7.5 && e._loc.z > 13) edgeT += 10;
      if (opt.trace && SIM.tick % Number(opt.trace) === 0) console.error("T", SIM.tick, def.map((e) => `${e._loc.x.toFixed(1)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(1)}h${Math.round(e.hp)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 18)}`).join(" | "), "||", foes.map((e) => `${e._loc.x.toFixed(0)},${e._loc.z.toFixed(0)}:${(W.notes.get(e.id)?.text ?? "").slice(0, 14)}`).join(" "));
      if (!foes.some((e) => e.isValid && !W.isDowned(e))) break;
    }
    fell = def.filter((e) => e.isValid && e._loc.y < 7).length;
    for (const x of SIM.shots.slice(s0)) if (x.owner?.props?.get("war:faction") === 2 && x.from.x > -3 && x.from.x < 3 && x.from.z > 24 && x.from.z < 30) inHutShots++;
    const hutShotsBlocked = SIM.shots.slice(s0).filter((x) => x.owner?.props?.get("war:faction") === 2 && x.from.z > 24 && x.from.z < 30 && Math.abs(x.from.x) < 3 && x.block).length;
    report({ ticks: SIM.tick - t0, defUp: def.filter((e) => e.isValid && !W.isDowned(e)).length, foesUp: foes.filter((e) => e.isValid && !W.isDowned(e)).length, edgeSec: +(edgeT / 20).toFixed(1), fell, inHutShots, hutShotsBlocked, defenderShots: shotStats(1, t0), attackerShots: shotStats(2, t0), notes: M.notes });
  },

  // v6.9: through the wall by accident. A rifleman 20 blocks from a man behind a wall (thick=N blocks of mat=block)
  //   with a window at head height. Misses into the wall sometimes come out the far side.
  async wallbang() {
    SIM.bounds = { x0: -30, x1: 30, z0: -30, z1: 40, y0: -8, y1: 30 };
    fill(-30, -4, -30, 30, -1, 40, "grass_block");
    const th = Number(opt.thick ?? 2), mat = opt.mat ?? "stone_bricks";
    fill(-4, 0, 10, 4, 2, 10 + th - 1, mat);
    fill(0, 1, 10, 0, 1, 10 + th - 1, "air");                             // a window, head-high for a man crouched behind
    spawnPlayer({ x: 0, y: 0, z: -20 });
    W.setRelPair(1, 2, "1", false);
    const a = soldier(1, { x: 0.5, y: 0, z: -9.5 }, "rifle", 1, "post");
    const b = soldier(2, { x: 0.5, y: 0, z: 10 + th + 0.5 }, "rifle", 1, "post");
    b.maxHp = 1e6; b.hp = 1e6;
    step(Number(opt.ticks ?? 1200));
    report({ thick: th, mat, bangs: W.bangCount(), aShots: shotStats(1), bShots: shotStats(2) });
  },
  // v6.9.1: two squads on Hold in the open, 8 v 5, 50 apart, a few low walls. The bigger squad should push: contact,
  //   flank / charge / bounding, and the calls that go with them. Then they go back to their spots.
  async holdFight() {
    SIM.bounds = { x0: -50, x1: 50, z0: -30, z1: 80, y0: -8, y1: 30 };
    fill(-50, -4, -30, 50, -1, 80, "grass_block");
    for (const [x, z] of [[-8, 18], [6, 22], [-2, 30], [12, 34], [-12, 38]]) fill(x, 0, z, x + 3, 0, z, "stone_bricks");
    spawnPlayer({ x: 0, y: 0, z: -10 });
    W.setRelPair(1, 2, "1", false);
    const A = [], B = [];
    SIM.voices = [];
    for (let i = 0; i < Number(opt.na ?? 8); i++) A.push(soldier(1, { x: -7 + i * 2 + 0.5, y: 0, z: 0.5 }, ["rifle", "smg", "semi", "mg"][i % 4], 1, "hold"));
    for (let i = 0; i < Number(opt.nb ?? 5); i++) B.push(soldier(2, { x: -4 + i * 2 + 0.5, y: 0, z: Number(opt.gap ?? 50) + 0.5 }, "rifle", 1, "hold"));
    step(40);
    const t0 = SIM.tick; const start = A.map((e) => ({ ...e._loc }));
    for (let t = 0; t < Number(opt.ticks ?? 2400); t += 10) {
      step(10); sample(1);
      if (opt.follow && SIM.tick % 20 === 0) { const u = A.filter((e) => e.isValid); if (u.length) player._loc = { x: u.reduce((q, e) => q + e._loc.x, 0) / u.length, y: 0, z: u.reduce((q, e) => q + e._loc.z, 0) / u.length - 12 }; }
      if (!B.some((e) => e.isValid && !W.isDowned(e))) break;
    }
    const plan = W.squads.get("1:1")?.plan, counter = W.squads.get("1:1")?.counter;
    const callsFight = SIM.voices.length;
    step(600);
    const back = A.filter((e, i) => e.isValid && !W.isDowned(e) && Math.hypot(e._loc.x - start[i].x, e._loc.z - start[i].z) < 6).length;
    const keys = {}; for (const v of SIM.voices) { const k = v.split(" ")[1].split(".").pop(); keys[k] = (keys[k] ?? 0) + 1; }
    report({ ticks: SIM.tick - t0, upA: A.filter((e) => e.isValid && !W.isDowned(e)).length, upB: B.filter((e) => e.isValid && !W.isDowned(e)).length, plan, counter, back, callsFight, lines: keys, notes: M.notes });
  },
  // v6.9.2: a building's upper floor held against attackers coming up the stairs. Defenders (hold, floor 1 at y 6)
  //   should cover the stairhead; attackers should stack up at the foot of the stairs and go up together.
  async stairFight() {
    const B0 = building(0, 0, { windows: opt.windows !== "0" });
    if (opt.two) { for (let i = 0; i < 5; i++) setBlock(9, i, 9 - i, "oak_stairs"); fill(9, 5, 5, 9, 5, 9, "air"); }   // a second staircase
    spawnPlayer({ x: 6, y: 0, z: -12 });
    W.setRelPair(1, 2, "1", false);
    const def = []; for (let i = 0; i < Number(opt.def ?? 4); i++) def.push(soldier(2, { x: 2 + i * 2 + 0.5, y: 6, z: 9.5 }, "rifle", 1, "hold"));
    const att = []; for (let i = 0; i < Number(opt.att ?? 6); i++) att.push(soldier(1, { x: 2 + (i % 3) * 2 + 0.5, y: 0, z: -8 - Math.floor(i / 3) * 2 + 0.5 }, ["rifle", "smg", "semi"][i % 3]));
    step(20); SIM.voices = [];

    await order(1, { x: 6, y: 6, z: 7 }, "hold");
    const t0 = SIM.tick, dn = {}, an = {};
    for (let t = 0; t < Number(opt.ticks ?? 2400); t += 10) {
      step(10);
      for (const [L, N] of [[def, dn], [att, an]]) for (const e of L) { if (!e.isValid || W.isDowned(e)) continue; const n = W.notes.get(e.id); if (n && SIM.tick - n.t < 20) N[n.text.replace(/\d+/g, "#")] = (N[n.text.replace(/\d+/g, "#")] ?? 0) + 1; }
      if (opt.gdbg && SIM.tick % 5 === 0) { const e = def[Number(opt.gdbg)]; if (e.isValid && !W.isDowned(e)) { const d = W.sd(e), t = W.perc.get(e.id)?.threat, gs = W.gunState.get(e.id); console.error("G", SIM.tick, "threat", t ? `${t._loc.x.toFixed(1)},${t._loc.y.toFixed(1)},${t._loc.z.toFixed(1)}` : "-", "can", t ? W.canHit(e, t) : "-", "shotAt", t ? !!W.shotAt(e, d, t, SIM.tick) : "-", "close", !!W.closeEnemy(e, d, 2.5), "gs", gs ? `tgt=${gs.target ? 1 : 0} next=${gs.next - SIM.tick} ammo=${gs.ammo}` : "-", "gun", e.props.get("war:gun"), "w", d.weapon, [...e.groups].filter((g) => /w_|t_/.test(g)).join(","), "note", W.notes.get(e.id)?.text); } }
      if (opt.trace && SIM.tick % Number(opt.trace) === 0) console.error("T", SIM.tick, def.map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 16)}`).join(" | "), "||", att.map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 16)}`).join(" "));
      if (!def.some((e) => e.isValid && !W.isDowned(e)) || !att.some((e) => e.isValid && !W.isDowned(e))) break;
    }
    const keys = {}; for (const v of SIM.voices) { const k = v.split(" ")[1].split(".").pop(); keys[k] = (keys[k] ?? 0) + 1; }
    report({ ticks: SIM.tick - t0, defUp: def.filter((e) => e.isValid && !W.isDowned(e)).length, attUp: att.filter((e) => e.isValid && !W.isDowned(e)).length, defNotes: dn, attNotes: an, lines: keys, attShots: shotStats(1, t0), defShots: shotStats(2, t0) });
  },
  // v6.9.3: a coalition order: soldiers of the member factions (1 and 3) obey, faction 2 doesn't
  async coalOrder() {
    spawnPlayer({ x: 0, y: 0, z: -5 });
    MC.world.setDynamicProperty("war:coal", JSON.stringify([{ name: "Pact", members: [1, 3] }]));
    const s1 = [soldier(1, { x: 0.5, y: 0, z: 0.5 }), soldier(1, { x: 2.5, y: 0, z: 0.5 })], s3 = [soldier(3, { x: 4.5, y: 0, z: 0.5 })], s2 = [soldier(2, { x: 6.5, y: 0, z: 0.5 })];
    step(20);
    await W.giveOrder(player, { faction: 0, coal: 0, order: 0, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: 3, cz: 40, cy: 0, then: "hold" });
    step(900);
    const z = (L) => L.map((e) => Math.round(e._loc.z));
    report({ f1: z(s1), f3: z(s3), f2: z(s2), bar: SIM.log.filter((m) => /\[bar\]/.test(m)).slice(-1) });
  },
  // v6.9.3: defenders holding a hallway (2 wide) beside a big room. The enemy comes in through the room's far door. The
  //   defenders hear them and must get into the fight (through the doorways), not stand in the corridor.
  async hallway() {
    SIM.bounds = { x0: -20, x1: 50, z0: -20, z1: 50, y0: -8, y1: 20 };
    fill(-20, -4, -20, 50, -1, 50, "grass_block");
    fill(0, 0, 0, 30, 4, 12, "stone_bricks"); fill(1, 0, 1, 29, 3, 11, "air");     // the building, 4 high inside
    fill(1, 0, 3, 29, 3, 3, "stone_bricks");                                     // the hallway wall (hallway z 1-2, room z 4-11)
    for (const x of [5, 25]) { setBlock(x, 0, 3, "air"); setBlock(x, 1, 3, "air"); }   // two doorways from the hallway into the room
    setBlock(15, 0, 12, "air"); setBlock(15, 1, 12, "air");                      // the room's outside door
    setBlock(0, 0, 2, "air"); setBlock(0, 1, 2, "air");                          // the hallway's outside door
    spawnPlayer({ x: 15, y: 0, z: 30 });
    W.setRelPair(1, 2, "1", false);
    const def = []; for (let i = 0; i < 6; i++) def.push(soldier(2, { x: 9 + i * 2 + 0.5, y: 0, z: 1.5 + (i % 2) }, "rifle", 1, "hold"));
    const att = []; for (let i = 0; i < 6; i++) att.push(soldier(1, { x: 12 + i + 0.5, y: 0, z: 22.5 }, ["rifle", "smg", "semi"][i % 3]));
    step(40);
    await order(1, { x: 15, y: 0, z: 7 }, "hold");
    const t0 = SIM.tick, dn = {}; let firstDefShot = -1;
    for (let t = 0; t < Number(opt.ticks ?? 2400); t += 10) {
      step(10);
      for (const e of def) { if (!e.isValid || W.isDowned(e)) continue; const n = W.notes.get(e.id); if (n && SIM.tick - n.t < 20) dn[n.text.replace(/\d+/g, "#")] = (dn[n.text.replace(/\d+/g, "#")] ?? 0) + 1; }
      if (firstDefShot < 0 && shotStats(2, t0).shots > 0) firstDefShot = SIM.tick - t0;
      if (opt.trace && SIM.tick % Number(opt.trace) === 0) console.error("T", SIM.tick, def.map((e) => `${e._loc.x.toFixed(0)},${e._loc.z.toFixed(0)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 16)}`).join(" | "), "||", att.map((e) => `${e._loc.x.toFixed(0)},${e._loc.z.toFixed(0)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 12)}`).join(" "));
      if (!def.some((e) => e.isValid && !W.isDowned(e)) || !att.some((e) => e.isValid && !W.isDowned(e))) break;
    }
    report({ ticks: SIM.tick - t0, defUp: def.filter((e) => e.isValid && !W.isDowned(e)).length, attUp: att.filter((e) => e.isValid && !W.isDowned(e)).length, firstDefShot, defShots: shotStats(2, t0).shots, attShots: shotStats(1, t0).shots, defNotes: dn });
  },
  // v6.9.4: a siege. A two-storey hall: an atrium in the middle, the upper floor a balcony round it, a staircase at each
  //   end, windows upstairs on the front, a door in the middle. Defenders (8) hold the upper floor, bunched at the
  //   balcony; attackers (8) come from outside. mode=out: they hold outside and shoot at the windows; mode=in: they
  //   go in and up. The battle should move: windows manned, a sortie, the building secured, both staircases used.
  async siege() {
    SIM.bounds = { x0: -20, x1: 60, z0: -50, z1: 40, y0: -8, y1: 30 };
    fill(-20, -4, -50, 60, -1, 40, "grass_block");
    fill(0, 0, 0, 31, 12, 19, "stone_bricks"); fill(1, 0, 1, 30, 11, 18, "air");
    fill(1, 5, 1, 30, 5, 18, "oak_planks"); fill(10, 5, 3, 21, 5, 9, "air");      // upper floor, with the atrium cut out
    for (let i = 0; i < 5; i++) { setBlock(3, i, 4 + i, "oak_stairs"); setBlock(28, i, 4 + i, "oak_stairs"); }   // a staircase at each end
    fill(3, 5, 3, 3, 5, 9, "air"); fill(28, 5, 3, 28, 5, 9, "air");
    for (const x of [5, 9, 22, 26]) setBlock(x, 7, 0, "air");                         // windows upstairs, front
    for (const x of [15, 16]) { setBlock(x, 0, 0, "air"); setBlock(x, 1, 0, "air"); } // the front door
    spawnPlayer({ x: 15, y: 0, z: -25 });
    W.setRelPair(1, 2, "1", false);
    const def = []; for (let i = 0; i < 8; i++) def.push(soldier(2, { x: 11 + i * 1.3 + 0.5, y: 6, z: 10.5 + (i % 2) }, ["rifle", "smg", "semi", "mg"][i % 4], 1, "hold"));
    const att = []; for (let i = 0; i < 8; i++) att.push(soldier(1, { x: 11 + i + 0.5, y: 0, z: -32.5 - (i % 2) * 2 }, ["rifle", "smg", "semi", "mg"][i % 4]));
    step(40); SIM.voices = [];
    const GT = {}; if (opt.gt) globalThis.__gt = (e, n) => { if (def.includes(e) && SIM.tick > 300) GT[n] = (GT[n] ?? 0) + 1; };
    if (opt.mode === "in") await order(1, { x: 15, y: 6, z: 14 }, "hold"); else await order(1, { x: 15, y: 0, z: -14 }, "hold");
    const t0 = SIM.tick, dn = {}, an = {}; let firstDef = -1, firstAtt = -1, defDown = 0, bunch = 0, bunchN = 0;
    const stairUse = { west: new Set(), east: new Set() }; let attUpMax = 0, firstAttUp = -1, firstBreach = -1, defGroundAtBreach = -1, defGround400 = -1;
    for (let t = 0; t < Number(opt.ticks ?? 3600); t += 10) {
      step(10);
      for (const [L, N] of [[def, dn], [att, an]]) for (const e of L) { if (!e.isValid || W.isDowned(e)) continue; const n = W.notes.get(e.id); if (n && SIM.tick - n.t < 20) N[n.text.replace(/\d+/g, "#")] = (N[n.text.replace(/\d+/g, "#")] ?? 0) + 1; }
      for (const e of [...def, ...att]) if (e.isValid && e._loc.y > 0.5 && e._loc.y < 5.5 && e._loc.z > 2 && e._loc.z < 10) { if (e._loc.x < 8) stairUse.west.add(e.id); else if (e._loc.x > 23) stairUse.east.add(e.id); }
      for (const e of def) if (e.isValid && !W.isDowned(e) && e._loc.y < 3) defDown |= 0, defDown = Math.max(defDown, def.filter((x) => x.isValid && !W.isDowned(x) && x._loc.y < 3).length);
      { const up = def.filter((x) => x.isValid && !W.isDowned(x)); let p = 0; for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) if (Math.hypot(up[i]._loc.x - up[j]._loc.x, up[i]._loc.z - up[j]._loc.z) < 1.6 && Math.abs(up[i]._loc.y - up[j]._loc.y) < 1) p++; bunch += p; bunchN++; }
      if (opt.pdbg && SIM.tick % 40 === 0 && SIM.tick > 300 && SIM.tick < 560) for (const e of def) { if (!e.isValid || W.isDowned(e)) continue; const t = W.perc.get(e.id)?.threat; const vis = att.filter((a) => a.isValid && !W.isDowned(a) && W.canHit(e, a)).length; console.error("P", SIM.tick, e._loc.x.toFixed(0), e._loc.y.toFixed(0), e._loc.z.toFixed(0), "threat", t ? `${t._loc.x.toFixed(0)},${t._loc.y.toFixed(0)},${t._loc.z.toFixed(0)} can=${W.canHit(e, t)}` : "-", "canHitAny", vis, "alert", W.perc.get(e.id)?.alert); }
      if (firstDef < 0 && shotStats(2, t0).shots) firstDef = SIM.tick - t0;
      if (firstAtt < 0 && shotStats(1, t0).shots) firstAtt = SIM.tick - t0;
      if (opt.trace && SIM.tick % Number(opt.trace) === 0) console.error("T", SIM.tick, def.map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 14)}`).join(" | "), "||", att.map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}${W.isDowned(e) ? "D" : ""}:${(W.notes.get(e.id)?.text ?? "").slice(0, 12)}`).join(" "));
      { const inB = (e) => e._loc.x > 0.5 && e._loc.x < 31 && e._loc.z > 0.5 && e._loc.z < 19;
        const aUp = att.filter((e) => e.isValid && !W.isDowned(e) && inB(e) && e._loc.y > 5.5).length; attUpMax = Math.max(attUpMax, aUp); if (aUp && firstAttUp < 0) firstAttUp = SIM.tick - t0;
        if (firstBreach < 0 && att.some((e) => e.isValid && !W.isDowned(e) && inB(e))) { firstBreach = SIM.tick - t0; defGroundAtBreach = def.filter((e) => e.isValid && !W.isDowned(e) && inB(e) && e._loc.y < 3).length; }
        if (firstBreach < 0 && SIM.tick - t0 >= 400 && defGround400 < 0) defGround400 = def.filter((e) => e.isValid && !W.isDowned(e) && inB(e) && e._loc.y < 3).length; }
      if (!def.some((e) => e.isValid && !W.isDowned(e)) || !att.some((e) => e.isValid && !W.isDowned(e))) break;
    }
    const top = (N) => Object.fromEntries(Object.entries(N).sort((a, b) => b[1] - a[1]).slice(0, 8));
    const blind = (f) => { const a = SIM.shots.filter((x) => x.t >= t0 && x.owner?.props?.get("war:faction") === f); return a.length ? +(a.filter((x) => x.blind).length / a.length).toFixed(2) : 0; };
    const blk = (f) => { const a = SIM.shots.filter((x) => x.t >= t0 && x.owner?.props?.get("war:faction") === f); return a.length ? +(a.filter((x) => x.block).length / a.length).toFixed(2) : 0; };
    const shortB = (f) => { const a = SIM.shots.filter((x) => x.t >= t0 && x.owner?.props?.get("war:faction") === f); return a.length ? +(a.filter((x) => x.block && (x.tgtD === undefined || x.blockD < x.tgtD - 0.8)).length / a.length).toFixed(2) : 0; };
    if (opt.ball) console.error("BALL", JSON.stringify([...W.BALL]));
    report({ GT: opt.gt ? GT : undefined, wallShare: { def: blk(2), att: blk(1) }, coverHit: { def: shortB(2), att: shortB(1) }, hitShare: { def: +(shotStats(2, t0).hit / Math.max(1, shotStats(2, t0).shots)).toFixed(2), att: +(shotStats(1, t0).hit / Math.max(1, shotStats(1, t0).shots)).toFixed(2) }, blindShare: { def: blind(2), att: blind(1) }, blindWhy: (() => { const a = SIM.shots.filter((x) => x.t >= t0 && x.blind); return { n: a.length, wb: a.filter((x) => x.wb).length, supp: a.filter((x) => x.supp).length, at: a.filter((x) => (x.typeId ?? "").includes("bazooka")).length }; })(), mode: opt.mode ?? "out", attUpMax, firstAttUp, firstBreach, defGroundAtBreach, defGround400, ticks: SIM.tick - t0, defUp: def.filter((e) => e.isValid && !W.isDowned(e)).length, attUp: att.filter((e) => e.isValid && !W.isDowned(e)).length, firstDef, firstAtt, defShots: shotStats(2, t0).shots, attShots: shotStats(1, t0).shots, defsDownstairs: defDown, defBunch: +(bunch / Math.max(1, bunchN)).toFixed(2), stairs: { west: stairUse.west.size, east: stairUse.east.size }, defNotes: top(dn), attNotes: top(an) });
  },
  // v7.0: patrol / roam inside the two-storey hall (no enemy): how much of the building do they cover, which floors
  async roamTest() {
    SIM.bounds = { x0: -20, x1: 60, z0: -50, z1: 40, y0: -8, y1: 30 };
    fill(-20, -4, -50, 60, -1, 40, "grass_block");
    fill(0, 0, 0, 31, 12, 19, "stone_bricks"); fill(1, 0, 1, 30, 11, 18, "air");
    fill(1, 5, 1, 30, 5, 18, "oak_planks"); fill(10, 5, 3, 21, 5, 9, "air");
    for (let i = 0; i < 5; i++) { setBlock(3, i, 4 + i, "oak_stairs"); setBlock(28, i, 4 + i, "oak_stairs"); }
    fill(3, 5, 3, 3, 5, 9, "air"); fill(28, 5, 3, 28, 5, 9, "air");
    fill(1, 6, 14, 30, 10, 14, "stone_bricks"); for (const x of [8, 22]) { setBlock(x, 6, 14, "air"); setBlock(x, 7, 14, "air"); }   // upstairs: back rooms behind a wall with two doors
    for (const x of [15, 16]) { setBlock(x, 0, 0, "air"); setBlock(x, 1, 0, "air"); }
    spawnPlayer({ x: 15, y: 6, z: 12 });
    const men = []; for (let i = 0; i < 4; i++) men.push(soldier(1, { x: 13 + i + 0.5, y: 6, z: 11.5 }, "rifle", 1, "hold"));
    step(20);
    player._loc = { x: 15, y: 6, z: 12 };
    globalThis.__aim = { x: 15, y: 6, z: 12 };
    const o = opt.mode === "roam" ? 7 : 2;
    W.generals.set(player.id, { cursor: opt.at === "down" ? { x: 15.5, y: 0, z: 6.5 } : { x: 15.5, y: 6, z: 11.5 } });
    await W.giveOrder(player, { faction: 1, order: o, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true });
    W.generals.delete(player.id);
    const cells = new Set(), floors = new Set(), outside = new Set(); let downAt = -1;
    for (let t = 0; t < Number(opt.ticks ?? 2400); t += 10) { step(10); if (downAt < 0 && men.filter((e) => e._loc.y < 3).length >= 3) downAt = t; for (const e of men) { cells.add(`${Math.floor(e._loc.y / 3)}|${Math.floor(e._loc.x / 3)}|${Math.floor(e._loc.z / 3)}`); floors.add(e._loc.y > 4 ? "up" : "down"); if (e._loc.z < 0 || e._loc.z > 19 || e._loc.x < 0 || e._loc.x > 31) outside.add(e.id); } }
    report({ mode: opt.mode ?? "patrol", at: opt.at ?? "up", downAt, cells: cells.size, floors: [...floors], wentOutside: outside.size, notes: Object.fromEntries([...new Set(men.map((e) => W.notes.get(e.id)?.text))].map((k) => [k, 1])) });
  },
  // v7.0: menus A-Z: answers are given by the position shown, and must come back as the original choice
  async abcTest() {
    spawnPlayer({ x: 0, y: 0, z: 0 });
    const UI = await import("@minecraft/server-ui");
    const mf = new UI.ModalFormData().dropdown("x", ["Zulu", "Alpha", "Mike", "Bravo"], { defaultValueIndex: 0 }).toggle("t").dropdown("small", ["c", "a", "b"]);
    globalThis.__formAnswers = [{ formValues: [1, true, 1] }];       // shown: Alpha, Bravo, Mike, Zulu -> "Bravo" (orig 3); small list unsorted -> 1
    const r1 = await W.show(mf, player);
    const af = new UI.ActionFormData().button("« Back").button("Zeta").button("My faction: Red").button("Alpha").button("Gamma");
    globalThis.__formAnswers = [{ selection: 1 }];                   // shown: My faction, Alpha, Gamma, Zeta, « Back -> Alpha (orig 3)
    const r2 = await W.show(af, player);
    report({ dropdown: r1.formValues, button: r2.selection, perm: W.sortPerm(["§9Blue (Wehrmacht)", "§cRed", "§aGreen (Allies)", "None"]) });
  },
  // v7.1: staircase lab. A soldier on the ground floor of a 2-storey house must get upstairs (and one upstairs must get
  //   down). kind=straight (enclosed, ceiling hole), switch (U-turn with a landing), open (along an open atrium edge),
  //   slab (slabs and full blocks alternating), stone (stone-brick stairs), narrowhead (low ceiling over the stairs)
  async stairsLab() {
    SIM.bounds = { x0: -20, x1: 40, z0: -20, z1: 40, y0: -8, y1: 30 };
    fill(-20, -4, -20, 40, -1, 40, "grass_block");
    fill(0, 0, 0, 16, 11, 14, "stone_bricks"); fill(1, 0, 1, 15, 10, 13, "air"); fill(1, 5, 1, 15, 5, 13, "oak_planks");
    setBlock(8, 0, 0, "air"); setBlock(8, 1, 0, "air");
    const k = opt.kind ?? "straight", ST = k === "stone" ? "stone_brick_stairs" : "oak_stairs";
    if (k === "straight" || k === "stone" || k === "narrowhead") { for (let i = 0; i < 5; i++) setBlock(3 + i, i, 3, ST); fill(3, 5, 3, 8, 5, 3, "air"); if (k === "narrowhead") fill(2, 6, 2, 9, 6, 4, "oak_planks"), fill(9, 6, 3, 9, 7, 3, "air"); }
    if (k === "switch") { for (let i = 0; i < 3; i++) setBlock(3 + i, i, 2, "oak_stairs"); fill(6, 0, 2, 7, 2, 3, "stone_bricks"); for (let i = 0; i < 2; i++) setBlock(5 - i, 3 + i, 3, "oak_stairs"); fill(3, 5, 2, 7, 5, 3, "air"); }
    if (k === "open") { fill(4, 5, 4, 12, 5, 9, "air"); for (let i = 0; i < 5; i++) setBlock(4 + i, i, 3, "oak_stairs"); fill(4, 5, 3, 8, 5, 3, "air"); }
    if (k === "slab") { for (let i = 0; i < 5; i++) { setBlock(3 + 2 * i, i, 3, "oak_slab"); setBlock(4 + 2 * i, i, 3, "oak_planks"); } fill(3, 5, 3, 13, 5, 3, "air"); }
    spawnPlayer({ x: 8, y: 0, z: -10 });
    const up = soldier(1, { x: 12.5, y: 0, z: 10.5 }, "rifle", 1, "hold"), down = soldier(2, { x: 12.5, y: 6, z: 10.5 }, "rifle", 2, "hold");
    step(20);
    await order(1, { x: 3, y: 6, z: 11 }, "hold");
    await W.giveOrder(player, { faction: 2, order: 0, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: 12, cz: -8, cy: 0, then: "hold" });
    let upT = -1, downT = -1;
    for (let t = 0; t < 1200; t += 10) { step(10); if (upT < 0 && up._loc.y > 5.5) upT = t; if (downT < 0 && down._loc.y < 0.5 && down._loc.z < 0) downT = t; if (upT >= 0 && downT >= 0) break; }
    report({ kind: k, upT, downT, upAt: `${up._loc.x.toFixed(1)},${up._loc.y.toFixed(1)},${up._loc.z.toFixed(1)}`, downAt: `${down._loc.x.toFixed(1)},${down._loc.y.toFixed(1)},${down._loc.z.toFixed(1)}`, upNote: W.notes.get(up.id)?.text, downNote: W.notes.get(down.id)?.text });
  },
  // v6.6: weapons. mode=molotov: 6 molotov soldiers vs 6 swordsmen; mode=spear: 6 spears vs 6 swords (melee duel)
  async weapons() {
    SIM.bounds = { x0: -40, x1: 40, z0: -40, z1: 60, y0: -8, y1: 30 };
    fill(-40, -4, -40, 40, -1, 60, "grass_block");
    spawnPlayer({ x: 0, y: 0, z: -30 });
    W.setRelPair(1, 2, "1", false);
    const mode = opt.mode ?? "molotov";
    const A = [], B = [];
    const demo = ["grenade", "molotov", "at"].includes(mode);
    for (let i = 0; i < 6; i++) {
      const e = soldier(1, { x: -5 + i * 2 + 0.5, y: 0, z: 0.5 }, mode === "spear" ? "spear" : mode === "gun" ? (opt.gun ?? "pistol") : "rifle", 1, "hold");
      if (demo) W.setupSoldier(e, { faction: 1, squad: 1, weapon: mode, div: "grenadier", radius: 8, func: "hold" }, player);
      if (mode === "legacy") { W.setupSoldier(e, { faction: 1, squad: 1, weapon: "sword", div: "grenadier", radius: 8, func: "hold" }, player); e.dyn.delete("war:kit"); e.dyn.delete("war:throw"); }
      A.push(e);
    }
    for (let i = 0; i < 6; i++) B.push(soldier(2, { x: -5 + i * 2 + 0.5, y: 0, z: (["molotov", "grenade", "at", "legacy"].includes(mode) ? 16 : 10) + 0.5 }, opt.foe ?? "sword", 1, "hold"));
    step(40);
    if (opt.nlog) globalThis.__nadeLog = (e, t, g) => console.error("NADE", SIM.tick, "from", e._loc.x.toFixed(1), e._loc.z.toFixed(1), "tgt", t._loc.x.toFixed(1), t._loc.z.toFixed(1), "land", g.x.toFixed(1), g.z.toFixed(1), "f", t.props.get("war:faction"));
    await W.giveOrder(player, { faction: 2, order: 0, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: 0, cz: 0, cy: 0, then: "hold" });
    let maxFires = 0, t0 = SIM.tick, booms = 0; const ex0 = MC.world.getDimension("overworld").createExplosion; MC.world.getDimension("overworld").createExplosion = function (...a) { booms++; if (opt.boomlog) console.error("BOOM", SIM.tick, JSON.stringify(a[0]), JSON.stringify({ ...a[2], source: !!a[2]?.source })); return ex0.apply(this, a); };
    for (let t = 0; t < Number(opt.ticks ?? 1600); t += 10) {
      step(10); maxFires = Math.max(maxFires, W.fires.length);
      if (!B.some((e) => e.isValid && !W.isDowned(e)) || !A.some((e) => e.isValid && !W.isDowned(e))) break;
    }
    const up = (L) => L.filter((e) => e.isValid && !W.isDowned(e)).length;
    const burnedA = A.filter((e) => SIM.burned?.has(e.id)).length, burnedB = B.filter((e) => SIM.burned?.has(e.id)).length;
    report({ mode, ticks: SIM.tick - t0, upA: up(A), upB: up(B), maxFires, burnedA, burnedB, booms, kit: A[0].dyn.get("war:kit"), throwT: A[0].dyn.get("war:throw"), nadeLeft: A.map((e) => e.dyn.get("war:nade") ?? 3), moloLeft: A.map((e) => e.dyn.get("war:molo") ?? 3), held: A[0].props.get("war:gun"), weaponA: A[0].dyn.get("war:weapon"), groups: [...A[0].groups].filter((g) => /w_/.test(g)) });
  },
  // v6.8: the callout test menu. Every button: soldiers near me (a different line each), every line in turn,
  //   one line (by language), the frequency/subtitles settings; and two men never say the same line at once
  async voices() {
    spawnPlayer({ x: 0, y: 0, z: 0 });
    const men = []; for (let i = 0; i < 6; i++) men.push(soldier(1, { x: i * 2 + 0.5, y: 0, z: 4.5 }, "rifle", 1, "hold"));
    step(20); SIM.voices = [];
    const out = {};
    globalThis.__formAnswers = [{ selection: 1 }]; await W.voiceMenu(player); step(400);
    const near = SIM.voices.map((v) => v.split(" ")[1]); out.near = { n: near.length, unique: new Set(near).size };
    SIM.voices = [];
    globalThis.__formAnswers = [{ selection: 2 }]; await W.voiceMenu(player); step(27 * 80 + 40);
    out.every = { n: SIM.voices.length, unique: new Set(SIM.voices.map((v) => v.split(" ")[1])).size };
    SIM.voices = [];
    globalThis.__formAnswers = [{ selection: 3 }, { formValues: [26, 7] }]; await W.voiceMenu(player); step(5);   // "grenade", German
    out.one = SIM.voices.map((v) => v.split(" ")[1]);
    SIM.voices = [];
    globalThis.__formAnswers = [{ selection: 3 }, { formValues: [26, 1] }]; await W.voiceMenu(player); step(5);   // "grenade", British (not recorded yet)
    out.oneMissing = { played: SIM.voices.length, msg: SIM.log.filter((m) => /recording/.test(m)).slice(-1) };
    globalThis.__formAnswers = [{ selection: 4 }, { formValues: [2, true] }]; await W.voiceMenu(player);
    out.settings = { vfreq: MC.world.getDynamicProperty("war:set_vfreq"), vsubs: MC.world.getDynamicProperty("war:set_vsubs") };
    // all six shout "Enemy spotted!" in the same tick: one voice only
    step(400); SIM.voices = [];
    for (const e of men) W.callout(e, "Enemy spotted!");
    out.sameLine = SIM.voices.length;
    report(out);
  },
  // v6.6: relations. An old world (20 factions, 2 at war, 3 allied) upgraded to 40; diplomacy on one page; a coalition spawn
  async factions() {
    MC.world.setDynamicProperty("war:rel", (() => { let r = ""; for (let a = 1; a <= 20; a++) for (let b = 1; b <= 20; b++) r += a === b ? "2" : (a + b === 3 ? "1" : (a + b === 4 && a !== b) ? "2" : "1"); return r; })());
    spawnPlayer({ x: 0, y: 0, z: 0 });
    const out = { r12: W.relAt(1, 2), r13: W.relAt(1, 3), r45: W.relAt(4, 5), r1_25: W.relAt(1, 25), r30_31: W.relAt(30, 31), len: W.getRel().length };
    MC.world.setDynamicProperty("war:coal", JSON.stringify([{ name: "Northern Pact", members: [3, 7, 25] }]));
    player._mainhand = "war:egg_foot";
    globalThis.__formAnswers = [{ formValues: [40, 0, 0, 2, 4, 8] }];   // pick the coalition (index NF + 0), rifle, 4 each
    await W.eggUse(player, "foot");
    step(5);
    const byF = {}; for (const e of alive()) byF[e.props.get("war:faction")] = (byF[e.props.get("war:faction")] ?? 0) + 1;
    out.spawnedByFaction = byF;
    out.bar = SIM.log.filter((m) => /\[bar\]/.test(m)).slice(-1);
    // diplomacy, one page: faction 1 -> Red hostile, Blue ally (rest as they are); the page comes back; then "everyone neutral"
    const vals = (over) => [0, ...Array.from({ length: 39 }, (_, i) => over[i + 2] ?? ["0", "1", "2"].indexOf(W.relAt(1, i + 2)))];
    globalThis.__formAnswers = [{ selection: 2 }, { selection: 0 }, { formValues: vals({ 2: 1, 3: 2 }) }, { formValues: [1, ...Array(39).fill(0)] }];
    await W.warTable(player);
    out.afterFirstSave = { r12: W.relAt(1, 2), r13: W.relAt(1, 3) };
    out.afterAllNeutral = { r12: W.relAt(1, 2), r13: W.relAt(1, 3), r1_40: W.relAt(1, 40), r2_3: W.relAt(2, 3) };
    out.msgs = SIM.log.filter((m) => /relation/.test(m)).slice(-3);
    report(out);
  },

  async cleanup() {
    SIM.bounds = { x0: -300, x1: 300, z0: -300, z1: 300, y0: -10, y1: 40 };
    SIM.loadR = 100;
    spawnPlayer({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 4; i++) soldier(1, { x: i * 2 + 0.5, y: 0, z: 10.5 }, "rifle");
    for (let i = 0; i < 4; i++) soldier(2, { x: i * 2 + 0.5, y: 0, z: -10.5 }, "rifle", 1);
    SIM.loadR = 1000; for (let i = 0; i < 4; i++) soldier(2, { x: i * 2 + 0.5, y: 0, z: 200.5 }, "rifle", 1); SIM.loadR = 100;   // far away: unloaded
    step(40);
    const count = (f, near) => [...SIM.entities.values()].filter((e) => e._valid && e.typeId === SOLDIER && e.props.get("war:faction") === f && (near === undefined || (near ? e._loc.z < 100 : e._loc.z > 100))).length;
    const before = { f1: count(1), f2near: count(2, true), f2far: count(2, false) };
    globalThis.__formAnswers = [{ selection: 2 }, { selection: 1 }, { selection: 0 }];          // remove faction 2, confirm
    await W.cleanupMenu(player); step(20);
    const afterF = { f1: count(1), f2near: count(2, true), f2far: count(2, false) };
    player._loc = { x: 0, y: 0, z: 190 }; step(220);                                                  // go near the far ones: their land loads
    const afterLoad = { f2far: count(2, false) };
    player._loc = { x: 0, y: 0, z: 0 };
    await order(1, { x: 0, y: 0, z: 60 }); step(40);
    const marchesBefore = Object.keys(W.getMarches()).length;
    globalThis.__formAnswers = [{ selection: 0 }];                                                   // repair
    await W.cleanupMenu(player); step(40);
    const repaired = { marches: Object.keys(W.getMarches()).length, holding: alive(1).filter((e) => W.sd(e).func === "hold").length };
    SIM.loadR = 1000; soldier(1, { x: 0.5, y: 0, z: 250.5 }, "rifle"); SIM.loadR = 100;
    globalThis.__formAnswers = [{ selection: 3 }, { selection: 0 }];                                  // remove everything
    await W.cleanupMenu(player); step(40);
    const left = [...SIM.entities.values()].filter((e) => e._valid && e.typeId.startsWith("war:")).length;
    player._loc = { x: 0, y: 0, z: 240 }; step(220);
    const leftAfterLoad = [...SIM.entities.values()].filter((e) => e._valid && e.typeId.startsWith("war:")).length;
    report({ before, afterF, afterLoad, marchesBefore, repaired, left, leftAfterLoad, leftovers: [...SIM.entities.values()].filter((e) => e._valid && e.typeId.startsWith("war:")).map((e) => `${e.typeId}@${Math.round(e._loc.x)},${Math.round(e._loc.z)} gen=${e.dyn.get("war:gen")}`), purge: W.purgeState(), msgs: SIM.log.slice(-2) });
  },

  // v6.1: the planner's worst case: a 200-block order straight through a long wall whose only gap is far to one side
  async detour() {
    SIM.bounds = { x0: -220, x1: 220, z0: -60, z1: Number(opt.len ?? 200) + 40, y0: -10, y1: 40 };
    fill(-200, 0, 100, 200, 4, 101, "stone_bricks"); fill(150, 0, 100, 152, 4, 101, "air");   // the wall, one gap at x=150
    for (let k = 0; k < 30; k++) { const x = -180 + ((k * 73) % 360), z = 20 + ((k * 37) % 200); fill(x, 0, z, x, 3, z, "oak_log"); fill(x - 2, 3, z - 2, x + 2, 5, z + 2, "oak_leaves"); }
    spawnPlayer({ x: 0, y: 0, z: -40 });
    for (let i = 0; i < 12; i++) soldier(1, { x: (i % 4) * 2 - 3 + 0.5, y: 0, z: Math.floor(i / 4) * 2 + 0.5 }, "rifle");
    step(20);
    const dest = { x: 0, y: 0, z: Number(opt.len ?? 200) };
    await order(1, dest);
    const t0 = SIM.tick; let arrived = -1; const firstMove = -1, prog600 = -1;
    for (let t = 0; t < Number(opt.ticks ?? 9000) && arrived < 0; t += 10) { step(10); sample(1); if (opt.follow && SIM.tick % 20 === 0) { const up = alive(1); player._loc = { x: up.reduce((q, e) => q + e._loc.x, 0) / up.length, y: 30, z: up.reduce((q, e) => q + e._loc.z, 0) / up.length - 20 }; } if (alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 12).length >= 11) arrived = SIM.tick - t0; }
    if (opt.dump) for (const [id, m] of Object.entries(W.getMarches())) console.error("MARCH", "idx", m.idx, "len", m.path?.length, "planning", m.planning, "final", m.final, "replans", m.replans, "legs", JSON.stringify(m.legs), "dead", JSON.stringify(m.dead), "pathEnd", JSON.stringify(m.path?.[m.path.length - 1]), "legT", JSON.stringify(m.legT), "pos", JSON.stringify(m.pos));
    if (opt.dump) console.error("POS", alive(1).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.z)}`).join(" "));
    report({ firstMove, prog600, msgs: SIM.log.filter((m) => /war|Squad|far|position|way/i.test(m)).slice(-4), plan: globalThis.__plan ? { ...globalThis.__plan, maxHeapMB: Math.round(globalThis.__plan.maxHeap / 1048576) } : undefined, arrivedTicks: arrived, there: alive(1).filter((e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 12).length, bigTp, ...callsPerTick(SIM.tick) });
  },

  // soldiers spread far apart (opt spread=1) or bunched (spread=0): the lag case from the field
  async spread() {
    const N = Number(opt.n ?? 30);
    SIM.bounds = { x0: -260, x1: 260, z0: -260, z1: 260, y0: -10, y1: 60 };
    SIM.dynWorld.set("war:set_r_dmg", 0);
    for (const [x, z] of [[-120, -80], [90, 60], [-40, 150], [150, -130]]) building(x, z);
    for (const [x, z] of [[0, 0], [-150, 100], [120, 160]]) hill(x, z, 20, 8);
    spawnPlayer({ x: 0, y: 30, z: 0 });
    const W8 = ["rifle", "smg", "semi", "mg"];
    let k = 0;
    for (let i = 0; i < N; i++) {
      const f = i % 2 ? 2 : 1;
      const at = opt.spread !== "0" ? { x: (Math.random() - 0.5) * 400, z: (Math.random() - 0.5) * 400 } : { x: (Math.random() - 0.5) * 30, z: (f === 1 ? -20 : 20) + (Math.random() - 0.5) * 10 };
      const y = (() => { for (let yy = 40; yy > -5; yy--) if (!MC.passCell(at.x, yy - 1, at.z)) return yy; return 0; })();
      soldier(f, { x: Math.floor(at.x) + 0.5, y, z: Math.floor(at.z) + 0.5 }, W8[i % 4], 0, i % 3 ? "hold" : "patrol");
    }
    W.setRelPair(1, 2, "1", false);
    step(200);
    SIM.calls.clear(); timing.clear();
    const ticks = Number(opt.ticks ?? 600);
    step(ticks, true);
    const mainMs = [...timing].filter(([kk]) => kk.includes("main.js")).reduce((t, [, v]) => t + v, 0) / ticks;
    const top = [...timing].filter(([kk]) => kk.includes("main.js")).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([kk, v]) => `${(v / ticks).toFixed(2)}ms ${kk.replace(/.*run_\d+\//, "")}`);
    const byGB = [...SIM.callsBy].map(([kk, m]) => [kk.replace(/.*run_\d+\//, ""), (m.get("getBlock") ?? 0) / ticks, (m.get("getSkyLightLevel") ?? 0) / ticks]).filter((x) => x[1] + x[2] > 0.5).sort((a, b) => b[1] - a[1]);
    console.error(JSON.stringify(byGB));
    report({ n: N, mainMsPerTick: +mainMs.toFixed(2), navPaths: +((SIM.calls.get("~navPath") ?? 0) / ticks).toFixed(2), teleports: +((SIM.calls.get("teleport") ?? 0) / ticks).toFixed(2), getBlock: +((SIM.calls.get("getBlock") ?? 0) / ticks).toFixed(1), sky: +((SIM.calls.get("getSkyLightLevel") ?? 0) / ticks).toFixed(1), top, ...callsPerTick(ticks) });
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
    report({ n: N, mainMsPerTick: +mainMs.toFixed(2), shots: SIM.shots.length, mw: globalThis.__mw });
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
  // v7.2: long trips that cross stairs. mode=down: top floor of a building -> 160 blocks away; up: 160 blocks away -> top floor;
  // terrace: a 6-high ridge across the map, crossed only by a 1-wide stone staircase. n = squad size, mobs=1 adds zombies on the way
  async trip() {
    const N = Number(opt.n ?? 8), mode = opt.mode ?? "down";
    SIM.bounds = { x0: -60, x1: 60, z0: -200, z1: 40, y0: -8, y1: 40 };
    spawnPlayer({ x: 6, y: 0, z: -60 });
    let start, dest, okFn;
    if (mode === "flat") {                                                       // 300 blocks of open ground with trees in the way
      SIM.bounds = { x0: -60, x1: 60, z0: -330, z1: 40, y0: -8, y1: 40 };
      for (let k = 0; k < 40; k++) { const x = -40 + ((k * 37) % 80), z = -30 - ((k * 53) % 280); fill(x, 0, z, x, 3, z, "oak_log"); fill(x - 2, 3, z - 2, x + 2, 5, z + 2, "oak_leaves"); }
      start = (i) => ({ x: (i % 6) * 2 - 5 + 0.5, y: 0, z: -2 - Math.floor(i / 6) * 2 + 0.5 }); dest = { x: 0, y: 0, z: -302 }; okFn = (e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 14;
    } else if (mode === "terrace") {
      fill(-60, 0, -80, 60, 5, -70, "stone"); for (let i = 0; i < 6; i++) { setBlock(0, i, -69 - i, "stone_brick_stairs"); setBlock(1, i, -69 - i, "air"); } fill(0, 0, -80, 0, 5, -75, "stone");
      for (let i = 0; i < 6; i++) fill(0, i + 1, -69 - i, 0, 7, -69 - i, "air");
      start = (i) => ({ x: (i % 6) * 2 - 5 + 0.5, y: 0, z: -20 - Math.floor(i / 6) * 2 + 0.5 }); dest = { x: 0, y: 6, z: -170 }; okFn = (e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 14;
      // the top of the ridge continues as a plateau to the destination
      fill(-60, 0, -200, 60, 5, -81, "stone");
    } else {
      building(0, 0, { windows: false });
      if (mode === "down") { start = (i) => ({ x: 2 + (i % 9) + 0.5, y: 11, z: 2 + Math.floor(i / 9) * 2 + 0.5 }); dest = { x: 6, y: 0, z: -160 }; okFn = (e) => Math.hypot(e._loc.x - dest.x, e._loc.z - dest.z) < 14 && e._loc.y < 1.5; }
      else { start = (i) => ({ x: (i % 8) * 2 - 2 + 0.5, y: 0, z: -150 - Math.floor(i / 8) * 2 + 0.5 }); dest = { x: 7, y: 11, z: 6 }; okFn = (e) => e._loc.y > 10.5; }
    }
    const team = []; for (let i = 0; i < N; i++) team.push(soldier(1, start(i), ["rifle", "smg", "semi", "mg"][i % 4]));
    if (opt.mobs) for (let i = 0; i < 6; i++) overworld.spawnEntity("minecraft:zombie", { x: -6 + i * 3 + 0.5, y: mode === "terrace" ? 6 : 0, z: mode === "terrace" ? -120 : -80 + 0.5 });
    step(20);
    await order(1, dest);
    const t0 = SIM.tick, need = Math.max(1, Math.ceil(N * 0.85)); let arrived = -1, firstMove = -1, pauses = 0; const st = new Map();
    for (let t = 0; t < Number(opt.ticks ?? 4800) && arrived < 0; t += 10) {
      step(10); sample(1);
      for (const e of team) { if (!e.isValid) continue; const lp = st.get(e.id); if (lp && Math.hypot(lp.x - e._loc.x, lp.z - e._loc.z) < 0.3 && !okFn(e)) pauses++; st.set(e.id, { ...e._loc }); }
      if (firstMove < 0 && team.some((e, k) => Math.hypot(e._loc.x - start(k).x, e._loc.z - start(k).z) > 3)) firstMove = SIM.tick - t0;
      if (opt.trace && SIM.tick % Number(opt.trace) === 0) console.error(SIM.tick, team.slice(0, 10).map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}:${(W.notes.get(e.id)?.text ?? "").slice(0, 16)}`).join(" | "));
      if (team.filter((e) => e.isValid && okFn(e)).length >= need) arrived = SIM.tick - t0;
    }
    report({ mode, n: N, arrivedTicks: arrived, there: team.filter((e) => e.isValid && okFn(e)).length, firstMove, stillPerMan: +(pauses / N).toFixed(1), final: team.slice(0, 12).map((e) => `${Math.round(e._loc.x)},${Math.round(e._loc.y)},${Math.round(e._loc.z)}`), notes: Object.fromEntries(Object.entries(M.notes).sort((a, b) => b[1] - a[1]).slice(0, 8)), ...callsPerTick(SIM.tick) });
  },
  // v7.3: a big three-storey hall like the test map: rooms on the ground floor (partition walls with doorways), one
  // staircase at the back up to the first floor, another at the far side up to the second; windows on every floor.
  // Defenders hold the upper floors, attackers come from outside. Reports who got upstairs, who piled up at the door.
  async bigSiege() {
    SIM.bounds = { x0: -20, x1: 80, z0: -60, z1: 50, y0: -8, y1: 40 };
    fill(-20, -4, -60, 80, -1, 50, "grass_block");
    fill(0, 0, 0, 47, 18, 29, "stone_bricks"); fill(1, 0, 1, 46, 17, 28, "air");
    fill(1, 6, 1, 46, 6, 28, "oak_planks"); fill(1, 12, 1, 46, 12, 28, "oak_planks");
    fill(16, 0, 1, 16, 5, 28, "stone_bricks"); fill(32, 0, 1, 32, 5, 28, "stone_bricks");          // ground floor rooms
    for (const x of [16, 32]) for (const z of [8, 20]) { setBlock(x, 0, z, "air"); setBlock(x, 1, z, "air"); }
    for (let i = 0; i < 6; i++) setBlock(40 + i, i, 26, "oak_stairs"); fill(40, 6, 26, 45, 6, 26, "air"); fill(39, 6, 26, 39, 6, 26, "air");   // stairs 1: back right, ground -> 1st
    for (let i = 0; i < 6; i++) setBlock(3 + i, 7 + i - 1 + 0, 3, "oak_stairs"); fill(3, 12, 3, 8, 12, 3, "air"); fill(2, 12, 3, 2, 12, 3, "air");   // stairs 2: front left, 1st -> 2nd
    for (const x of [23, 24]) { setBlock(x, 0, 0, "air"); setBlock(x, 1, 0, "air"); }               // the front door (middle room)
    for (const x of [4, 10, 20, 28, 36, 42]) { setBlock(x, 8, 0, "air"); setBlock(x, 14, 0, "air"); }   // windows front, both upper floors
    spawnPlayer({ x: 24, y: 0, z: -40 });
    W.setRelPair(1, 2, "1", false);
    const def = []; for (let i = 0; i < 10; i++) def.push(soldier(2, { x: 6 + i * 3.5 + 0.5, y: i < 6 ? 7 : 13, z: 10.5 + (i % 3) * 3 }, ["rifle", "smg", "semi", "mg"][i % 4], 1, "hold"));
    const att = []; for (let i = 0; i < 12; i++) att.push(soldier(1, { x: 16 + i + 0.5, y: 0, z: -35.5 - (i % 2) * 2 }, ["rifle", "smg", "semi", "mg"][i % 4]));
    step(40);
    if (opt.ddbg) { const e = def[0]; const cells = W.buildingCells(e.dimension, e.location, 24); console.error("cells", cells.length, "ys", [...new Set(cells.map((q) => q.y))], "ents", JSON.stringify(W.entrances(e.dimension, e.location)), "spot", JSON.stringify(W.doorWatchSpot(e, W.squads.get("2:1") ?? { }, 0, SIM.tick))); }
    await order(1, { x: 24, y: 0, z: -12 }, "hold");
    const t0 = SIM.tick, an = {}, dn = {}, lbl = { n: 0, lie: 0 }; let attUpMax = 0, firstUp = -1, pileMax = 0, inMax = 0;
    const inB = (e) => e._loc.x > 0.5 && e._loc.x < 47 && e._loc.z > 0.5 && e._loc.z < 29;
    for (let t = 0; t < Number(opt.ticks ?? 4800); t += 10) {
      step(10);
      const A = att.filter((e) => e.isValid && !W.isDowned(e)), D = def.filter((e) => e.isValid && !W.isDowned(e));
      for (const [L, N] of [[A, an], [D, dn]]) for (const e of L) { const n = W.notes.get(e.id); if (n && SIM.tick - n.t < 20) { const k = n.text.replace(/\d+/g, "#") + (e._loc.y > 5 ? "@up" : "@gf"); N[k] = (N[k] ?? 0) + 1; } }
      // labels that claim a post ("at the upper windows", "covering the way in"...) must be true: he's on his post (within 2
      // blocks of it); "storming the building" must be a man actually moving (more than a block in the last 5 s)
      for (const e of [...A, ...D]) { const n = W.notes.get(e.id); if (!n || SIM.tick - n.t >= 20) continue; const post = /^(at the upper windows|watching from a window|covering the way in|holding the stairhead|covering the assault)$/.test(n.text), storm = n.text === "storming the building";
        if (!post && !storm) continue; lbl.n++;
        const sp = W.brain.get(e.id)?.role?.spot; const h = (e.__h ??= []); h.push({ ...e._loc }); if (h.length > 10) h.shift();
        if (post && (!sp || Math.hypot(sp.x - e._loc.x, sp.z - e._loc.z) > 2 || Math.abs(sp.y - e._loc.y) > 1.5)) lbl.lie++;
        if (storm && h.length >= 10 && Math.hypot(h[0].x - e._loc.x, h[0].z - e._loc.z) < 1 && Math.abs(h[0].y - e._loc.y) < 1) lbl.lie++; }
      const up = A.filter((e) => inB(e) && e._loc.y > 5.5).length; attUpMax = Math.max(attUpMax, up); if (up && firstUp < 0) firstUp = SIM.tick - t0;
      inMax = Math.max(inMax, A.filter(inB).length);
      pileMax = Math.max(pileMax, A.filter((e) => inB(e) && e._loc.y < 1 && Math.hypot(e._loc.x - 23.5, e._loc.z - 1) < 5).length);
      if (opt.trace && SIM.tick % Number(opt.trace) === 0) console.error("T", SIM.tick, "D", D.map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}:${(W.notes.get(e.id)?.text ?? "").slice(0, 16)}`).join(" | "), "\n   A", A.map((e) => `${e._loc.x.toFixed(0)},${e._loc.y.toFixed(0)},${e._loc.z.toFixed(0)}:${(W.notes.get(e.id)?.text ?? "").slice(0, 16)}`).join(" | "));
      if (opt.jdbg && SIM.tick % 100 === 0) { const S2 = [...W.squads].filter(([k]) => k.startsWith("2"))[0]?.[1]; console.error("J", SIM.tick, S2?.bplan?.kind, JSON.stringify([...(S2?.jobs ?? [])].map(([id, j]) => j)), def.map((e) => { const B = W.brain.get(e.id); return `${e._loc.y.toFixed(0)}:${B?.role?.job ?? "-"}:${B?.role?.spot ? "S" : "_"}`; }).join(" ")); }
      if (!D.length || !A.length) break;
    }
    const top = (N) => Object.fromEntries(Object.entries(N).sort((a, b) => b[1] - a[1]).slice(0, 10));
    const blindOf = (f) => { const a = SIM.shots.filter((x) => x.t >= t0 && x.owner?.props?.get("war:faction") === f); return a.length ? +(a.filter((x) => x.blind).length / a.length).toFixed(3) : 0; };
    const coverOf = (f) => { const a = SIM.shots.filter((x) => x.t >= t0 && x.owner?.props?.get("war:faction") === f); return a.length ? +(a.filter((x) => x.block && x.tgtD !== undefined && x.blockD < x.tgtD - 0.8).length / a.length).toFixed(3) : 0; };
    report({ labelLies: lbl.n ? +(lbl.lie / lbl.n).toFixed(3) : 0, labelN: lbl.n, blind: Math.max(blindOf(1), blindOf(2)), cover: Math.max(coverOf(1), coverOf(2)), ticks: SIM.tick - t0, attLeft: att.filter((e) => e.isValid && !W.isDowned(e)).length, defLeft: def.filter((e) => e.isValid && !W.isDowned(e)).length, attUpMax, firstUp, inMax, pileMax, attNotes: top(an), defNotes: top(dn) });
  },
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
