
// ================================================================ War Engine test kit (real Bedrock Dedicated Server)
// Appended to a TEST COPY of main.js only (never shipped). "/scriptevent war:test <scenario>" builds the scenario in the
// real world (on a stone floor at y=100, kept running by a ticking area), spawns the soldiers, gives the orders, measures
// and prints one line "WARTEST {json}" to the server log. Without the gun pack on the server: gunners keep their guns
// (the precise hits need no bullets); an old version that fires the pack's bullets fires real arrows instead (real
// projectile physics: they drop and slow down like the pack's).
const KIT_PLAYER = { id: "kit-player", name: "Kit", typeId: "minecraft:player", isValid: true, get location() { return KIT ? { x: KIT.ox, y: 100, z: KIT.oz - 20 } : { x: 0, y: 100, z: 0 }; },
  get dimension() { return world.getDimension("overworld"); }, onScreenDisplay: { setActionBar() {}, setTitle() {} }, sendMessage() {},
  hasTag: () => false, getTags: () => [], addTag() {}, removeTag() {}, getRotation: () => ({ x: 0, y: 0 }), getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
  getEntitiesFromViewDirection: () => [], getDynamicProperty() { return undefined; }, setDynamicProperty() {}, getGameMode: () => "Survival", getComponent: () => undefined };
const ow = () => world.getDimension("overworld");
const kcmd = (c) => { try { return ow().runCommand(c); } catch (err) { console.warn(`KIT cmd failed: ${c} :: ${err}`); } };
function kfill(x0, y0, z0, x1, y1, z1, b) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)], [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
  for (let x = ax; x <= bx; x += 32) for (let z = az; z <= bz; z += 32) for (let y = ay; y <= by; y += 30) kcmd(`fill ${x} ${y} ${z} ${Math.min(bx, x + 31)} ${Math.min(by, y + 29)} ${Math.min(bz, z + 31)} ${b}`);
}
const kset = (x, y, z, b) => kcmd(`setblock ${x} ${y} ${z} ${b}`);
const STAIR = (dir) => `oak_stairs ["weirdo_direction"=${{ "+x": 0, "-x": 1, "+z": 2, "-z": 3 }[dir]}]`;
let KIT = null;
const kitSoldiers = (f) => allOf(SOLDIER).filter((e) => e.isValid && (f === undefined || Number(P(e, "war:faction")) === f));
function kitSoldier(f, at, weapon = "rifle", func = "hold") {
  const e = ow().spawnEntity(SOLDIER, at, { spawnEvent: "war:init" });
  const ne = setupSoldier(e, { faction: f, squad: 1, weapon, ranged: weapon !== "sword", div: "foot", radius: 8, func: "__none" }, KIT_PLAYER) ?? e;
  const x = ne?.isValid ? ne : e;
  giveFunction(x, func, KIT_PLAYER);
  return x;
}
async function kitOrder(fac, dest, then = "hold", extra = {}) {
  await giveOrderInner(KIT_PLAYER, { faction: fac, order: 0, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: Math.floor(dest.x), cz: Math.floor(dest.z), cy: dest.y, then, ...extra });
}
const isDown = (e) => downed.has(e.id) || pows.has(e.id);
// ---- shot statistics: every shot's start, whether any enemy was in view (blind), and whether it stopped in a block
// in front of its target (cover)
const KSHOTS = [];
function kitSeeAny(o, from) {
  const f = Number(P(o, "war:faction") ?? 0);
  for (const e of kitSoldiers()) {
    if (e.id === o.id || isDown(e) || Number(P(e, "war:faction")) === f || dist(e.location, from) > 80) continue;
    for (const hy of [0.6, 1.2, 1.7]) if (openNow(o.dimension, from, { x: e.location.x, y: e.location.y + hy, z: e.location.z })) return true;
  }
  return false;
}
function kitTargetD(o, from) { const g = gunState.get(o.id), t = g?.target ?? g?.supp?.ent; return t?.isValid ? Math.hypot(t.location.x - from.x, t.location.y + 1.2 - from.y, t.location.z - from.z) : undefined; }
let kitCoverLog = 0;
globalThis.__warShot = (r) => { if (!KIT) return; try {
  if (KIT.dbg && r.block && kitCoverLog < 25) { const g = gunState.get(r.owner.id), t = g?.target; const td = kitTargetD(r.owner, r.from); if (td !== undefined && r.blockD < td - 0.8) { kitCoverLog++; let bt = "?"; try { bt = ow().getBlock({ x: Math.floor(r.end.x + r.dir.x * 0.05), y: Math.floor(r.end.y + r.dir.y * 0.05), z: Math.floor(r.end.z + r.dir.z * 0.05) })?.typeId; } catch {} const tc = t?.isValid ? chest(t) : undefined; let on = "-", raw = "-"; try { on = String(openNow(r.owner.dimension, r.from, tc)); const L = Math.hypot(tc.x - r.from.x, tc.y - r.from.y, tc.z - r.from.z); const hb = r.owner.dimension.getBlockFromRay(r.from, { x: (tc.x - r.from.x) / L, y: (tc.y - r.from.y) / L, z: (tc.z - r.from.z) / L }, { maxDistance: L - 0.4, includeLiquidBlocks: false, includePassableBlocks: false }); raw = hb ? `${hb.block.typeId}@${hb.block.location.x},${hb.block.location.y},${hb.block.location.z} face ${JSON.stringify(hb.faceLocation)}` : "none"; } catch (err) { raw = "THREW " + err; }
    console.warn(`COVERDBG from ${r.from.x.toFixed(1)},${r.from.y.toFixed(1)},${r.from.z.toFixed(1)} end ${r.end.x.toFixed(1)},${r.end.y.toFixed(1)},${r.end.z.toFixed(1)} blockD ${r.blockD.toFixed(1)} tgtD ${td.toFixed(1)} block ${bt} tgt ${tc ? `${tc.x.toFixed(1)},${tc.y.toFixed(1)},${tc.z.toFixed(1)}` : "-"} openNow ${on} ray ${raw} shooterSeesTgt ${t?.isValid ? canHit(r.owner, t) : "-"}`); } }
  KSHOTS.push({ t: tick(), f: Number(P(r.owner, "war:faction")), blind: !kitSeeAny(r.owner, r.from), cover: r.block && (() => { const td = kitTargetD(r.owner, r.from); return td !== undefined && r.blockD < td - 0.8; })(), hit: r.hit }); } catch {} };
// arrows standing in for the pack's bullets (old versions): watched to the block they stop in
const ARROWS = new Map(); // arrow id -> record
world.afterEvents.projectileHitBlock.subscribe((ev) => { try { const a = ARROWS.get(ev.projectile?.id); if (!a) return; const hp = ev.location; a.rec.cover = a.td !== undefined && Math.hypot(hp.x - a.from.x, hp.y - a.from.y, hp.z - a.from.z) < a.td - 0.8; ARROWS.delete(ev.projectile.id); try { ev.projectile.remove(); } catch {} } catch {} });
world.afterEvents.projectileHitEntity.subscribe((ev) => { try { const a = ARROWS.get(ev.projectile?.id); if (!a) return; a.rec.hit = true; ARROWS.delete(ev.projectile.id); } catch {} });
function kitArrow(e, spec, from, v) {
  const b = e.dimension.spawnEntity("minecraft:arrow", from);
  const pc = b.getComponent("minecraft:projectile"); if (pc) { pc.owner = e; pc.shoot(v); }
  const rec = { t: tick(), f: Number(P(e, "war:faction")), blind: !kitSeeAny(e, from), cover: false, hit: false };
  KSHOTS.push(rec); ARROWS.set(b.id, { rec, from: { ...from }, td: kitTargetD(e, from) });
  if (ARROWS.size > 2000) ARROWS.clear();
  return b;
}
// ---- the scenarios (the same buildings and orders as the simulator's)
const KS = {};
const Y = 100;
function floorAt(x0, z0, x1, z1) { kfill(x0, Y - 1, z0, x1, Y - 1, z1, "stone"); kfill(x0, Y, z0, x1, Y + 20, z1, "air"); }
KS.siege = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 50, ox + 60, oz + 40);
  const B = (x0, y0, z0, x1, y1, z1, b) => kfill(ox + x0, Y + y0, oz + z0, ox + x1, Y + y1, oz + z1, b);
  B(0, 0, 0, 31, 12, 19, "stone_bricks"); B(1, 0, 1, 30, 11, 18, "air");
  B(1, 5, 1, 30, 5, 18, "oak_planks"); B(10, 5, 3, 21, 5, 9, "air");
  for (let i = 0; i < 5; i++) { kset(ox + 3, Y + i, oz + 4 + i, STAIR("+z")); kset(ox + 28, Y + i, oz + 4 + i, STAIR("+z")); }
  B(3, 5, 3, 3, 5, 9, "air"); B(28, 5, 3, 28, 5, 9, "air");
  for (const x of [5, 9, 22, 26]) B(x, 7, 0, x, 7, 0, "air");
  for (const x of [15, 16]) B(x, 0, 0, x, 1, 0, "air");
  setRelPair(1, 2, "1", false);
  const def = [], att = [];
  for (let i = 0; i < 8; i++) def.push(kitSoldier(2, { x: ox + 11 + i * 1.3 + 0.5, y: Y + 6, z: oz + 10.5 + (i % 2) }, ["rifle", "smg", "semi", "mg"][i % 4], "hold"));
  for (let i = 0; i < 8; i++) att.push(kitSoldier(1, { x: ox + 11 + i + 0.5, y: Y, z: oz - 32.5 - (i % 2) * 2 }, ["rifle", "smg", "semi", "mg"][i % 4], "hold"));
  await kitWait(40);
  if (o.mode === "in") await kitOrder(1, { x: ox + 15, y: Y + 6, z: oz + 14 }); else await kitOrder(1, { x: ox + 15, y: Y, z: oz - 14 });
  const t0 = tick(), inB = (e) => e.location.x > ox + 0.5 && e.location.x < ox + 31 && e.location.z > oz + 0.5 && e.location.z < oz + 19;
  let firstBreach = -1, defGroundAtBreach = -1, attUpMax = 0, firstAttUp = -1;
  await kitLoop(3600, () => {
    const A = att.filter((e) => e.isValid && !isDown(e)), D = def.filter((e) => e.isValid && !isDown(e));
    const up = A.filter((e) => inB(e) && e.location.y > Y + 5.5).length; attUpMax = Math.max(attUpMax, up); if (up && firstAttUp < 0) firstAttUp = tick() - t0;
    if (firstBreach < 0 && A.some(inB)) { firstBreach = tick() - t0; defGroundAtBreach = D.filter((e) => inB(e) && e.location.y < Y + 3).length; }
    return !A.length || !D.length;
  });
  return { mode: o.mode ?? "out", ticks: tick() - t0, attLeft: att.filter((e) => e.isValid && !isDown(e)).length, defLeft: def.filter((e) => e.isValid && !isDown(e)).length, firstBreach, defGroundAtBreach, attUpMax, firstAttUp, ...kitShotStats(t0) };
};
KS.bigSiege = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 60, ox + 80, oz + 50);
  const B = (x0, y0, z0, x1, y1, z1, b) => kfill(ox + x0, Y + y0, oz + z0, ox + x1, Y + y1, oz + z1, b);
  B(0, 0, 0, 47, 18, 29, "stone_bricks"); B(1, 0, 1, 46, 17, 28, "air");
  B(1, 6, 1, 46, 6, 28, "oak_planks"); B(1, 12, 1, 46, 12, 28, "oak_planks");
  B(16, 0, 1, 16, 5, 28, "stone_bricks"); B(32, 0, 1, 32, 5, 28, "stone_bricks");
  for (const x of [16, 32]) for (const z of [8, 20]) B(x, 0, z, x, 1, z, "air");
  for (let i = 0; i < 6; i++) kset(ox + 40 + i, Y + i, oz + 26, STAIR("+x")); B(39, 6, 26, 45, 6, 26, "air");
  for (let i = 0; i < 6; i++) kset(ox + 3 + i, Y + 6 + i, oz + 3, STAIR("+x")); B(2, 12, 3, 8, 12, 3, "air");
  for (const x of [23, 24]) B(x, 0, 0, x, 1, 0, "air");
  for (const x of [4, 10, 20, 28, 36, 42]) { B(x, 8, 0, x, 8, 0, "air"); B(x, 14, 0, x, 14, 0, "air"); }
  setRelPair(1, 2, "1", false);
  const def = [], att = [];
  for (let i = 0; i < 10; i++) def.push(kitSoldier(2, { x: ox + 6 + i * 3.5 + 0.5, y: Y + (i < 6 ? 7 : 13), z: oz + 10.5 + (i % 3) * 3 }, ["rifle", "smg", "semi", "mg"][i % 4], "hold"));
  for (let i = 0; i < 12; i++) att.push(kitSoldier(1, { x: ox + 16 + i + 0.5, y: Y, z: oz - 35.5 - (i % 2) * 2 }, ["rifle", "smg", "semi", "mg"][i % 4], "hold"));
  await kitWait(40);
  await kitOrder(1, { x: ox + 24, y: Y, z: oz - 12 });
  const t0 = tick(), inB = (e) => e.location.x > ox + 0.5 && e.location.x < ox + 47 && e.location.z > oz + 0.5 && e.location.z < oz + 29;
  let firstUp = -1, attUpMax = 0; const lbl = { n: 0, lie: 0 }; const hist = new Map();
  await kitLoop(4800, () => {
    const A = att.filter((e) => e.isValid && !isDown(e)), D = def.filter((e) => e.isValid && !isDown(e));
    const up = A.filter((e) => inB(e) && e.location.y > Y + 5.5).length; attUpMax = Math.max(attUpMax, up); if (up && firstUp < 0) firstUp = tick() - t0;
    for (const e of [...A, ...D]) {
      const n = notes.get(e.id); if (!n || tick() - n.t >= 20) continue;
      const post = /^(at the upper windows|watching from a window|covering the way in|holding the stairhead|covering the assault)$/.test(n.text), storm = n.text === "storming the building";
      if (!post && !storm) continue; lbl.n++;
      const sp = brain.get(e.id)?.role?.spot, h = hist.get(e.id) ?? []; h.push({ ...e.location }); if (h.length > 10) h.shift(); hist.set(e.id, h);
      if (post && (!sp || Math.hypot(sp.x - e.location.x, sp.z - e.location.z) > 2 || Math.abs(sp.y - e.location.y) > 1.5)) lbl.lie++;
      if (storm && h.length >= 10 && Math.hypot(h[0].x - e.location.x, h[0].z - e.location.z) < 1 && Math.abs(h[0].y - e.location.y) < 1) lbl.lie++;
    }
    return !A.length || !D.length;
  });
  return { ticks: tick() - t0, attLeft: att.filter((e) => e.isValid && !isDown(e)).length, defLeft: def.filter((e) => e.isValid && !isDown(e)).length, firstUp, attUpMax, labelLies: lbl.n ? +(lbl.lie / lbl.n).toFixed(3) : 0, labelN: lbl.n, ...kitShotStats(t0) };
};
KS.trip = async (o, ox, oz) => {
  const N = Number(o.n ?? 8), mode = o.mode ?? "down";
  let start, dest, okFn;
  if (mode === "flat") {
    floorAt(ox - 60, oz - 330, ox + 60, oz + 20);
    for (let k = 0; k < 40; k++) { const x = ox - 40 + ((k * 37) % 80), z = oz - 30 - ((k * 53) % 280); kfill(x, Y, z, x, Y + 3, z, "oak_log"); kfill(x - 2, Y + 3, z - 2, x + 2, Y + 5, z + 2, "oak_leaves"); }
    start = (i) => ({ x: ox + (i % 6) * 2 - 5 + 0.5, y: Y, z: oz - 2 - Math.floor(i / 6) * 2 + 0.5 }); dest = { x: ox, y: Y, z: oz - 302 };
    okFn = (e) => Math.hypot(e.location.x - dest.x, e.location.z - dest.z) < 14;
  } else {
    floorAt(ox - 30, oz - 180, ox + 40, oz + 30);
    const B = (x0, y0, z0, x1, y1, z1, b) => kfill(ox + x0, Y + y0, oz + z0, ox + x1, Y + y1, oz + z1, b);
    B(0, 0, 0, 11, 15, 11, "stone_bricks"); B(1, 0, 1, 10, 14, 10, "air"); B(1, 5, 1, 10, 5, 10, "oak_planks"); B(1, 10, 1, 10, 10, 10, "oak_planks");
    for (let i = 0; i < 5; i++) kset(ox + 3 + i, Y + i, oz + 1, STAIR("+x")); B(2, 5, 1, 7, 5, 1, "air");
    for (let i = 0; i < 4; i++) kset(ox + 3 + i, Y + 6 + i, oz + 10, STAIR("+x")); B(2, 10, 10, 6, 10, 10, "air");
    B(6, 0, 0, 6, 1, 0, "air");
    if (mode === "down") { start = (i) => ({ x: ox + 2 + (i % 9) + 0.5, y: Y + 11, z: oz + 2 + Math.floor(i / 9) * 2 + 0.5 }); dest = { x: ox + 6, y: Y, z: oz - 160 }; okFn = (e) => Math.hypot(e.location.x - dest.x, e.location.z - dest.z) < 14 && e.location.y < Y + 1.5; }
    else { start = (i) => ({ x: ox + (i % 8) * 2 - 2 + 0.5, y: Y, z: oz - 150 - Math.floor(i / 8) * 2 + 0.5 }); dest = { x: ox + 7, y: Y + 11, z: oz + 6 }; okFn = (e) => e.location.y > Y + 10.5; }
  }
  const team = []; for (let i = 0; i < N; i++) team.push(kitSoldier(1, start(i), ["rifle", "smg", "semi", "mg"][i % 4]));
  await kitWait(20);
  await kitOrder(1, dest);
  const t0 = tick(), need = Math.max(1, Math.ceil(N * 0.85)); let arrived = -1;
  await kitLoop(Number(o.ticks ?? 4800), () => { if (team.filter((e) => e.isValid && okFn(e)).length >= need) { arrived = tick() - t0; return true; } return false; });
  return { mode, n: N, arrivedTicks: arrived, there: team.filter((e) => e.isValid && okFn(e)).length, final: team.slice(0, 6).map((e) => e.isValid ? `${Math.round(e.location.x - ox)},${Math.round(e.location.y - Y)},${Math.round(e.location.z - oz)}` : "x") };
};
KS.roam = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 50, ox + 60, oz + 40);
  const B = (x0, y0, z0, x1, y1, z1, b) => kfill(ox + x0, Y + y0, oz + z0, ox + x1, Y + y1, oz + z1, b);
  B(0, 0, 0, 31, 12, 19, "stone_bricks"); B(1, 0, 1, 30, 11, 18, "air");
  B(1, 5, 1, 30, 5, 18, "oak_planks"); B(10, 5, 3, 21, 5, 9, "air");
  for (let i = 0; i < 5; i++) { kset(ox + 3, Y + i, oz + 4 + i, STAIR("+z")); kset(ox + 28, Y + i, oz + 4 + i, STAIR("+z")); }
  B(3, 5, 3, 3, 5, 9, "air"); B(28, 5, 3, 28, 5, 9, "air");
  B(1, 6, 14, 30, 10, 14, "stone_bricks"); for (const x of [8, 22]) B(x, 6, 14, x, 7, 14, "air");
  for (const x of [15, 16]) B(x, 0, 0, x, 1, 0, "air");
  const men = []; for (let i = 0; i < 4; i++) men.push(kitSoldier(1, { x: ox + 13 + i + 0.5, y: Y + 6, z: oz + 11.5 }, "rifle", "hold"));
  await kitWait(20);
  generals.set(KIT_PLAYER.id, { cursor: { x: ox + 15.5, y: Y, z: oz + 6.5 } });
  await giveOrderInner(KIT_PLAYER, { faction: 1, order: 7, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true });
  generals.delete(KIT_PLAYER.id);
  const t0 = tick(); let downAt = -1;
  await kitLoop(1200, () => { if (downAt < 0 && men.filter((e) => e.isValid && e.location.y < Y + 3).length >= 3) { downAt = tick() - t0; return true; } return false; });
  return { downAt };
};
KS.probe = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const cow = ow().spawnEntity("minecraft:cow", { x: ox + 0.5, y: Y, z: oz + 0.5 });
  const s1 = kitSoldier(1, { x: ox + 5.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(20);
  await kitOrder(1, { x: ox + 5, y: Y, z: oz + 15 });
  const p0 = { c: { ...cow.location }, s: { ...s1.location } };
  await kitLoop(400, () => false);
  return { cowMoved: +dist(p0.c, cow.location).toFixed(2), soldierMoved: +dist(p0.s, s1.location).toFixed(2), soldierAt: s1.location, func: sd(s1).func, note: notes.get(s1.id)?.text, groups: gdp(s1, "war:st") };
};
KS.rayprobe = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  kfill(ox - 5, Y, oz, ox + 5, Y + 5, oz, "stone_bricks");
  await kitWait(5);
  const out = [];
  const from = { x: ox + 0.5, y: Y + 1.5, z: oz - 10 };
  for (const [tx, ty, tz] of [[0.5, 1.5, 10], [3.2, 3.7, 6.5], [-2, 2.5, 20]]) {
    const to = { x: ox + tx, y: Y + ty, z: oz + tz }, L = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), u = { x: (to.x - from.x) / L, y: (to.y - from.y) / L, z: (to.z - from.z) / L };
    const row = { to: [tx, ty, tz], L: +L.toFixed(1) };
    for (const md of [5, 9.5, 10.5, 12, L - 0.4, 30, 64, 220]) {
      for (const opt of [{ maxDistance: md }, { maxDistance: md, includeLiquidBlocks: false, includePassableBlocks: false }]) {
        let r; try { const hb = ow().getBlockFromRay(from, u, opt); r = hb ? `${hb.block.location.z - oz}` : "none"; } catch (err) { r = "THREW"; }
        row[`${md.toFixed(1)}${Object.keys(opt).length > 1 ? "+" : ""}`] = r;
      }
    }
    out.push(row);
  }
  return { rays: out };
};
// the castle in the screenshots: a 12-man squad on a wall walkway (8 up, battlements), a lava moat below, a one-block
// brick-stair bridge from the wall down over the lava as the only way out; ordered to a field 120 blocks off, then on
// to a second spot 80 blocks to the side ("the top right")
KS.castle = async (o, ox, oz) => {
  floorAt(ox - 60, oz - 20, ox + 100, oz + 150);
  kfill(ox - 30, Y, oz, ox + 30, Y + 7, oz + 3, "stone_bricks");                       // the wall, walk on y=8
  for (let x = -30; x <= 30; x += 2) kset(ox + x, Y + 8, oz + 3, "stone_bricks");      // battlements on the moat side
  kfill(ox - 40, Y - 1, oz + 4, ox + 40, Y - 1, oz + 13, "lava"); kfill(ox - 40, Y - 2, oz + 4, ox + 40, Y - 2, oz + 13, "stone");
  kset(ox, Y + 8, oz + 3, "air");                                                      // the gap to the bridge
  for (let i = 0; i < 8; i++) { kset(ox, Y + 7 - i, oz + 4 + i, `brick_stairs ["weirdo_direction"=3]`); }   // down toward +z, over the lava
  kfill(ox, Y, oz + 12, ox, Y, oz + 13, "air");
  for (let k = 0; k < 20; k++) { const x = ox - 40 + ((k * 37) % 120), z = oz + 30 + ((k * 53) % 100); kfill(x, Y, z, x, Y + 3, z, "oak_log"); kfill(x - 2, Y + 3, z - 2, x + 2, Y + 5, z + 2, "oak_leaves"); }
  const team = []; for (let i = 0; i < 12; i++) team.push(kitSoldier(1, { x: ox - 11 + i * 2 + 0.5, y: Y + 8, z: oz + 1.5 }, ["rifle", "smg", "semi", "mg"][i % 4]));
  await kitWait(20);
  const legs = [{ x: ox, y: Y, z: oz + 120 }, { x: ox + 80, y: Y, z: oz + 130 }];
  const out = { legs: [] };
  for (const dest of legs) {
    await kitOrder(1, dest);
    const t0 = tick(); let arrived = -1, still = 0; const last = new Map(); let lava = 0;
    await kitLoop(Number(o.ticks ?? 3000), () => {
      const up = team.filter((e) => e.isValid && !isDown(e));
      for (const e of up) { const lp = last.get(e.id); if (lp && Math.hypot(lp.x - e.location.x, lp.z - e.location.z) < 0.3 && Math.hypot(e.location.x - dest.x, e.location.z - dest.z) > 14) still++; last.set(e.id, { ...e.location }); try { if (e.getComponent("minecraft:onfire") || e.isInWater === undefined) {} } catch {} }
      if (up.filter((e) => Math.hypot(e.location.x - dest.x, e.location.z - dest.z) < 14).length >= Math.ceil(up.length * 0.85)) { arrived = tick() - t0; return true; }
      return false;
    });
    out.legs.push({ arrived, alive: team.filter((e) => e.isValid && !isDown(e)).length, stillPerMan: +(still / 12).toFixed(1), final: team.slice(0, 6).map((e) => e.isValid ? `${Math.round(e.location.x - ox)},${Math.round(e.location.y - Y)},${Math.round(e.location.z - oz)}:${(notes.get(e.id)?.text ?? "").slice(0, 14)}` : "x") });
  }
  return out;
};
KS.load = async (o, ox, oz) => {                                      // how fast the server runs with N idle soldiers (or cows)
  const N = Number(o.n ?? 180);
  floorAt(ox - 60, oz - 90, ox + 60, oz + 90);
  for (let i = 0; i < N; i++) { const at = { x: ox + (i % 20) * 3 - 30 + 0.5, y: Y, z: oz - 60 + Math.floor(i / 20) * 3 + 0.5 }; if (o.cow) ow().spawnEntity("minecraft:cow", at); else kitSoldier(o.mixed ? 1 + (i % 2) : 1, at, "rifle", "hold"); }
  await kitWait(60);
  const t0 = tick(), r0 = Date.now();
  await kitLoop(Number(o.ticks ?? 400), () => false);
  const sec = (Date.now() - r0) / 1000, tpsA = +((tick() - t0) / sec).toFixed(1);
  let tpsB;
  if (o.nowp) {                                                         // the same, with every waypoint marker gone
    for (const w of allOf(WAYPOINT)) { try { w.remove(); } catch {} }
    const t1 = tick(), r1 = Date.now(); await kitLoop(Number(o.ticks ?? 400), () => { for (const w of allOf(WAYPOINT)) { try { w.remove(); } catch {} } return false; });
    tpsB = +((tick() - t1) / ((Date.now() - r1) / 1000)).toFixed(1);
  }
  if (o.cow) kcmd("kill @e[type=cow]");
  return { n: N, cow: !!o.cow, tps: tpsA, tpsNoWaypoints: tpsB, waypoints: allOf(WAYPOINT).length };
};
KS.big = async (o, ox, oz) => {
  const N = Number(o.n ?? 90);
  floorAt(ox - 60, oz - 90, ox + 60, oz + 90);
  setRelPair(1, 2, "1", false);
  const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi"];
  for (let i = 0; i < N; i++) kitSoldier(1, { x: ox + (i % 20) * 2 - 20 + 0.5, y: Y, z: oz - 60 - Math.floor(i / 20) * 2 + 0.5 }, W8[i % 6]);
  for (let i = 0; i < N; i++) kitSoldier(2, { x: ox + (i % 20) * 2 - 20 + 0.5, y: Y, z: oz + 60 + Math.floor(i / 20) * 2 + 0.5 }, W8[i % 6]);
  await kitWait(20);
  await kitOrder(1, { x: ox, y: Y, z: oz + 60 }); await kitOrder(2, { x: ox, y: Y, z: oz - 60 });
  globalThis.__dpReport?.(); globalThis.__evReport?.(1); const t0 = tick(), r0 = Date.now(); let slow = 0, last = Date.now(), worst = 0;
  await kitLoop(Number(o.ticks ?? 600), () => { const now = Date.now(), dt = now - last; last = now; worst = Math.max(worst, dt); if (dt > 600) slow++; return false; });
  const sec = (Date.now() - r0) / 1000, ticks = tick() - t0;
  return { ev: globalThis.__evReport?.(tick() - t0), dp: globalThis.__dpReport?.(), n: N, ticks, realSec: +sec.toFixed(1), tps: +(ticks / sec).toFixed(1), worstGapMs: worst, left1: kitSoldiers(1).filter((e) => !isDown(e)).length, left2: kitSoldiers(2).filter((e) => !isDown(e)).length, ...kitShotStats(t0) };
};
function kitShotStats(t0) {
  const a = KSHOTS.filter((x) => x.t >= t0);
  const by = (f) => { const s = a.filter((x) => x.f === f); return { n: s.length, blind: s.length ? +(s.filter((x) => x.blind).length / s.length).toFixed(3) : 0, cover: s.length ? +(s.filter((x) => x.cover).length / s.length).toFixed(3) : 0, hit: s.length ? +(s.filter((x) => x.hit).length / s.length).toFixed(3) : 0 }; };
  return { shots: a.length, s1: by(1), s2: by(2) };
}
// ---- the runner
const kitWait = (n) => new Promise((res) => system.runTimeout(res, n));
function kitLoop(max, f) { return new Promise((res) => { const t0 = tick(); const id = system.runInterval(() => { let done = false; try { done = f(); } catch (err) { console.warn(`KIT loop error ${err}`); }
  if (KIT?.trace && (tick() - t0) % Number(KIT.trace) < 10) { try { const ps = globalThis.__planStats; if (ps) { console.warn(`PLAN jobs=${planJobs.length} exp/tick=${(ps.exp / Math.max(1, ps.ticks)).toFixed(0)} ms/tick=${(ps.ms / Math.max(1, ps.ticks)).toFixed(1)} reads/tick=${(ps.reads / Math.max(1, ps.ticks)).toFixed(0)} done=${ps.done} dropped=${ps.dropped} meanDoneTicks=${(ps.doneT / Math.max(1, ps.done)).toFixed(0)}`); globalThis.__planStats = { exp: 0, ms: 0, reads: 0, ticks: 0, done: 0, dropped: 0, doneT: 0 }; } console.warn(`TRACE ${tick() - t0} ` + kitSoldiers().slice(0, 12).map((e) => `${(e.location.x - KIT.ox).toFixed(1)},${(e.location.y - Y).toFixed(1)},${(e.location.z - KIT.oz).toFixed(1)}${isDown(e) ? "D" : ""}:${(notes.get(e.id)?.text ?? "").slice(0, 18)}:${JSON.parse(String(gdp(e, "war:st") ?? "{}")).g ?? ""}:${sd(e).func}`).join(" | ")); } catch (err) { console.warn(`TRACE err ${err}`); } }
  if (done || tick() - t0 >= max) { system.clearRun(id); res(); } }, 10); }); }
let kitSlot = 0;
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "war:test") return;
  const [name, ...args] = String(ev.message ?? "").trim().split(/\s+/);
  const o = Object.fromEntries(args.map((a) => a.split("=")));
  if (!KS[name]) { console.warn(`WARTEST {"error":"unknown scenario ${name}"}`); return; }
  (async () => {
    const ox = 3000 + (kitSlot++ % 6) * 800, oz = 0;
    KIT = { name, ox, oz, trace: o.trace, dbg: o.dbg }; if (o.trace) globalThis.__planStats = { exp: 0, ms: 0, reads: 0, ticks: 0, done: 0, dropped: 0, doneT: 0 };
    try {
      for (const e of [...allOf(SOLDIER), ...allOf(WAYPOINT), ...allOf(HOUND)]) { try { e.remove(); } catch {} }   // (leftovers of an interrupted run)
      kcmd("tickingarea remove_all"); kcmd("time set noon"); kcmd("gamerule dodaylightcycle false"); await kitWait(40);
       const r = name === "castle" ? [ox - 60, oz - 20, ox + 100, oz + 150] : name === "probe" || name === "rayprobe" ? [ox - 20, oz - 20, ox + 20, oz + 20] : name === "trip" && o.mode === "flat" ? [ox - 60, oz - 330, ox + 60, oz + 20] : name === "big" || name === "load" ? [ox - 60, oz - 90, ox + 60, oz + 90] : [ox - 30, oz - 180, ox + 80, oz + 50];
      // (a ticking area keeps the land loaded and its mobs moving with no player near; at most ~100 chunks each)
      const w = r[2] - r[0], h = r[3] - r[1];
      const parts = Math.max(1, Math.ceil((Math.ceil(w / 16) + 1) * (Math.ceil(h / 16) + 1) / 90));
      for (let k = 0; k < parts; k++) { const z0 = r[1] + Math.floor((h * k) / parts), z1 = r[1] + Math.floor((h * (k + 1)) / parts); kcmd(`tickingarea add ${r[0]} 0 ${z0} ${r[2]} 0 ${z1} kit${k} true`); }
      // wait until every corner of the area is loaded (up to 30 s)
      for (let k = 0; k < 60; k++) { let ok = true; for (const [x, z] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]], [(r[0] + r[2]) >> 1, (r[1] + r[3]) >> 1]]) { try { if (!ow().getBlock({ x, y: Y, z })) ok = false; else { const t = ow().spawnEntity("war:blank", { x: x + 0.5, y: Y + 1, z: z + 0.5 }); t.remove(); } } catch { ok = false; } } if (ok) break; await kitWait(10); }   // (loaded AND ticking: something can be spawned there)
      await kitWait(20);
      const res = await KS[name](o, ox, oz);
      console.warn(`WARTEST ${JSON.stringify({ scenario: name, args: o, ...res, errors: ERRS.size })}`);
    } catch (err) { console.warn(`WARTEST ${JSON.stringify({ scenario: name, args: o, crash: String(err), stack: String(err?.stack ?? "").slice(0, 300) })}`); }
    finally {
      for (const e of allOf(SOLDIER)) { try { e.remove(); } catch {} }
      for (const e of [...allOf(WAYPOINT), ...allOf(HOUND)]) { try { e.remove(); } catch {} }
      try { personal.clear(); travelTo.clear(); gliders.clear(); combatLock.clear(); } catch {}
      try { for (const k of Object.keys(getMarches())) delete getMarches()[k]; } catch {}
      KIT = null;
      console.warn("WARTEST_DONE");
    }
  })();
});
// old versions fire the pack's bullets: on a server without the pack they become real arrows (registered for the stats)
system.run(() => {
  try {
    const proto = Object.getPrototypeOf(world.getDimension("overworld")), spawn0 = proto.spawnEntity;
    proto.spawnEntity = function (id, loc, opt) {
      if (typeof id === "string" && /^ww:n.*_projectile$/.test(id)) {
        const b = spawn0.call(this, "minecraft:arrow", loc);
        const rec = { t: tick(), f: 0, blind: false, cover: false, hit: false, pending: true };
        KSHOTS.push(rec); ARROWS.set(b.id, { rec, from: { ...loc }, td: undefined });
        system.run(() => { try { const o = b.getComponent("minecraft:projectile")?.owner; if (o?.isValid) { rec.f = Number(P(o, "war:faction")); rec.blind = !kitSeeAny(o, loc); const a = ARROWS.get(b.id); if (a) a.td = kitTargetD(o, loc); } } catch {} });
        return b;
      }
      return spawn0.call(this, id, loc, opt);
    };
  } catch (err) { console.warn(`KIT spawn wrap failed ${err}`); }
});
// dynamic-property writes, by key: count and bytes (the server warns above 10 MB a minute)
const DPSTAT = new Map(); let dpWrapped = false;
function dpWrap(obj) { const proto = Object.getPrototypeOf(obj), f = proto.setDynamicProperty; if (!f || f.__kit) return; const w = function (k, v) { const r = DPSTAT.get(k) ?? { n: 0, b: 0 }; r.n++; r.b += v === undefined ? 0 : typeof v === "string" ? v.length : 8; DPSTAT.set(k, r); return f.call(this, k, v); }; w.__kit = true; proto.setDynamicProperty = w; }
system.runInterval(() => { if (dpWrapped) return; try { dpWrap(world); const s = allOf(SOLDIER)[0] ?? allOf(WAYPOINT)[0]; if (s) { dpWrap(s); dpWrapped = true; } } catch {} }, 20);
globalThis.__dpReport = () => { const a = [...DPSTAT].sort((x, y) => y[1].b - x[1].b).slice(0, 12).map(([k, r]) => `${k}:${r.n}x/${(r.b / 1024).toFixed(0)}KB`); DPSTAT.clear(); return a; };
// entity events (component group swaps) and teleports, counted
const EVSTAT = new Map(); let evWrapped = false;
system.runInterval(() => { if (evWrapped) return; try { const s = allOf(SOLDIER)[0]; if (!s) return; const proto = Object.getPrototypeOf(s); for (const fn of ["triggerEvent", "teleport", "applyImpulse", "clearVelocity", "addTag", "removeTag", "setProperty"]) { const f = proto[fn]; if (!f || f.__kit) continue; const w = function (...a) { let k = fn === "triggerEvent" ? `ev:${String(a[0]).split(":").pop().replace(/[0-9]+$/, "#")}` : fn; if (fn === "teleport") { const ln = (new Error().stack ?? "").split("\n").slice(2, 4).map((x) => (x.match(/main\.js:(\d+)/) ?? [])[1]).join("<"); k = `tp@${ln}${this.typeId === SOLDIER ? "" : ":mk"}`; } EVSTAT.set(k, (EVSTAT.get(k) ?? 0) + 1); return f.apply(this, a); }; w.__kit = true; proto[fn] = w; } evWrapped = true; } catch {} }, 20);
globalThis.__evReport = (ticks) => { const a = [...EVSTAT].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, n]) => `${k}:${(n / Math.max(1, ticks)).toFixed(1)}/t`); EVSTAT.clear(); return a; };
