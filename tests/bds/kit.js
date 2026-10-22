
// ================================================================ War Engine test kit (real Bedrock Dedicated Server)
// Appended to a TEST COPY of main.js only (never shipped). "/scriptevent war:test <scenario>" builds the scenario in the
// real world (on a stone floor at y=100, kept running by a ticking area), spawns the soldiers, gives the orders, measures
// and prints one line "WARTEST {json}" to the server log. Without the gun pack on the server: gunners keep their guns
// (the precise hits need no bullets); an old version that fires the pack's bullets fires real arrows instead (real
// projectile physics: they drop and slow down like the pack's).
const KIT_PLAYER = { id: "kit-player", name: "Kit", typeId: "minecraft:player", isValid: true, get location() { return KIT ? { x: KIT.ox, y: 100, z: KIT.oz - 20 } : { x: 0, y: 100, z: 0 }; },
  get dimension() { return world.getDimension("overworld"); }, onScreenDisplay: { setActionBar() {}, setTitle() {} }, sendMessage() {},
  hasTag: () => false, getTags: () => [], addTag() {}, removeTag() {}, getRotation: () => ({ x: 0, y: 0 }), getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
  getEntitiesFromViewDirection: () => [], getBlockFromViewDirection: () => undefined, getDynamicProperty() { return undefined; }, setDynamicProperty() {}, getGameMode: () => "Survival", getComponent: () => undefined };
const ow = () => world.getDimension("overworld");
const kcmd = (c) => { try { return ow().runCommand(c); } catch (err) { console.warn(`KIT cmd failed: ${c} :: ${err}`); } };
function kfill(x0, y0, z0, x1, y1, z1, b) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)], [az, bz] = [Math.min(z0, z1), Math.max(z0, z1)];
  for (let x = ax; x <= bx; x += 32) for (let z = az; z <= bz; z += 32) for (let y = ay; y <= by; y += 30) kcmd(`fill ${x} ${y} ${z} ${Math.min(bx, x + 31)} ${Math.min(by, y + 29)} ${Math.min(bz, z + 31)} ${b}`);
  try { terrainForget(); } catch {}
}
const kset = (x, y, z, b) => { const r = kcmd(`setblock ${x} ${y} ${z} ${b}`); try { terrainChanged(ow().id, x, y, z); } catch {} return r; };   // (like a player placing it: the soldiers notice)
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
    if (e.id === o.id || isDown(e) || Number(P(e, "war:faction")) === f || dist(e.location, from) > 220) continue;
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
// how Bedrock counts "MB of dynamic properties saved": N writes of a small value, to the world or to one soldier
KS.dpbench = async (o, ox, oz) => {
  const N = Number(o.n ?? 1000), who = o.on === "soldier" ? kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold") : world;
  await kitWait(1300);                                                         // (a clean minute first)
  const pad = "x".repeat(Number(o.size ?? 1));
  for (let i = 0; i < N; i++) who.setDynamicProperty("war:bench", pad + (i % 10));
  await kitWait(1300);
  try { who.setDynamicProperty("war:bench", undefined); } catch {}
  return { on: o.on ?? "world", n: N, size: who === world ? world.getDynamicPropertyTotalByteCount() : who.getDynamicPropertyTotalByteCount() };
};
// many soldiers, each changing one small value once a second for a minute (no AI: they're held)
KS.dpmany = async (o, ox, oz) => {
  const N = Number(o.n ?? 180), men = [];
  floorAt(ox - 60, oz - 90, ox + 60, oz + 90);
  for (let i = 0; i < N; i++) men.push(kitSoldier(1, { x: ox + (i % 20) * 3 - 30 + 0.5, y: Y, z: oz - 60 + Math.floor(i / 20) * 3 + 0.5 }, "rifle", "hold"));
  await kitWait(1300);
  for (let s = 0; s < 60; s++) { for (const e of men) { try { e.setDynamicProperty("war:bench", String(s % 10)); } catch {} } await kitWait(20); }
  await kitWait(200);
  return { n: N };
};
// entities that move but whose properties never change: is their whole record saved again when they move?
KS.dpmove = async (o, ox, oz) => {
  const N = Number(o.n ?? 180), men = [], pad = "x".repeat(Number(o.size ?? 2000));
  floorAt(ox - 60, oz - 90, ox + 60, oz + 90);
  for (let i = 0; i < N; i++) { const e = ow().spawnEntity("minecraft:armor_stand", { x: ox + (i % 20) * 3 - 30 + 0.5, y: Y, z: oz - 60 + Math.floor(i / 20) * 3 + 0.5 }); e.setDynamicProperty("war:pad", pad); men.push(e); }
  await kitWait(1300);
  for (let t = 0; t < 1200; t++) { const dx = t % 2 ? 0.1 : -0.1; for (const e of men) { try { const l = e.location; e.teleport({ x: l.x + dx, y: l.y, z: l.z }); } catch {} } await kitWait(1); }
  await kitWait(200);
  for (const e of men) { try { e.remove(); } catch {} }
  return { n: N };
};
// v9.1: which vanilla mounts take a soldier as a rider (by script), and do they move with him on
KS.mounts = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  kfill(ox + 10, Y - 1, oz - 20, ox + 20, Y - 1, oz + 20, "water");
  const types = ["minecraft:horse", "minecraft:donkey", "minecraft:mule", "minecraft:camel", "minecraft:pig", "minecraft:llama", "minecraft:skeleton_horse", "minecraft:boat", "minecraft:chest_boat"];
  const out = {};
  let i = 0;
  for (const t of types) {
    const water = t.includes("boat");
    const at = water ? { x: ox + 15.5, y: Y - 0.5, z: oz - 15 + i * 4 + 0.5 } : { x: ox - 20 + i * 4 + 0.5, y: Y, z: oz + 0.5 };
    i++;
    const r = { };
    try {
      const m = ow().spawnEntity(t, at);
      const s0 = kitSoldier(1, { x: at.x, y: Y, z: at.z + 1 }, "rifle", "hold");
      await kitWait(10);
      r.sad0 = m.hasComponent?.("minecraft:is_saddled");
      try { const inv = m.getComponent("minecraft:inventory")?.container; if (inv && o.saddle) { inv.setItem(0, new ItemStack("minecraft:saddle", 1)); } r.inv = inv?.size; } catch (err) { r.invErr = String(err).slice(0, 60); }
      await kitWait(5);
      r.sad1 = m.hasComponent?.("minecraft:is_saddled");
      const rd = m.getComponent("minecraft:rideable");
      r.seats = rd?.seatCount; r.family = rd?.getFamilyTypes?.();
      if (o.wide) { s0.triggerEvent("war:mount_on"); await kitWait(2); }
      try { r.add = rd?.addRider(s0) ?? "no rideable"; } catch (err) { r.add = `throw ${String(err).slice(0, 60)}`; }
      if (o.wide) { await kitWait(2); s0.triggerEvent("war:mount_off"); }
      await kitWait(10);
      r.riding = s0.getComponent("minecraft:riding")?.entityRidingOn?.typeId ?? null;
      const p0 = { ...m.location };
      for (let k = 0; k < 20; k++) { try { m.applyImpulse({ x: 0, y: 0, z: 0.15 }); } catch {} await kitWait(1); }
      r.moved = +Math.hypot(m.location.x - p0.x, m.location.z - p0.z).toFixed(1);
      r.stillOn = s0.getComponent("minecraft:riding")?.entityRidingOn?.id === m.id;
      try { m.remove(); } catch {} try { s0.remove(); } catch {}
    } catch (err) { r.err = String(err).slice(0, 80); }
    out[t.replace("minecraft:", "")] = r;
  }
  return { mounts: out };
};
// v9.1: Mount up (saddled camels), ride 40 blocks to a charge point, Dismount
KS.ride = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 70, oz + 30);
  const men = [], mounts = [];
  for (let i = 0; i < 3; i++) {
    const m = ow().spawnEntity("minecraft:camel", { x: ox - 10 + i * 4 + 0.5, y: Y, z: oz + 4.5 });
    try { m.getComponent("minecraft:inventory")?.container?.setItem(0, new ItemStack("minecraft:saddle", 1)); } catch {}
    mounts.push(m);
    men.push(kitSoldier(1, { x: ox - 10 + i * 4 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  }
  await kitWait(20);
  await giveOrderInner(KIT_PLAYER, { faction: 1, order: ORDERS.findIndex((q) => q[0] === "mount"), squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: ox, cz: oz, cy: Y });
  await kitWait(40);
  const riding = () => men.filter((e) => e.isValid && e.getComponent("minecraft:riding")?.entityRidingOn?.typeId === "minecraft:camel").length;
  const r = { mounted: riding() };
  const dest = { x: ox + 40, y: Y, z: oz };
  await kitOrder(1, dest);
  let arrived = -1; const t0 = tick();
  for (let t = 0; t < 900 && arrived < 0; t += 10) { await kitWait(10); if (men.filter((e) => e.isValid && Math.hypot(e.location.x - dest.x, e.location.z - dest.z) < 7).length >= 2) arrived = tick() - t0; }
  r.arrivedTicks = arrived; r.stillMounted = riding(); r.final = men.map((e) => `${Math.round(e.location.x - ox)},${Math.round(e.location.z - oz)}`);
  await giveOrderInner(KIT_PLAYER, { faction: 1, order: ORDERS.findIndex((q) => q[0] === "dismount"), squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: ox, cz: oz, cy: Y });
  await kitWait(20);
  r.afterDismount = riding();
  for (const m of mounts) { try { m.remove(); } catch {} }
  return r;
};
// v9.2: a live grenade at a soldier's feet: does it hurt him, and do the men near it run?
KS.nade = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const men = []; for (let i = 0; i < 4; i++) men.push(kitSoldier(1, { x: ox + i * 1.5 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(40);
  const hp0 = men.map((e) => e.getComponent("minecraft:health").currentValue), p0 = men.map((e) => ({ ...e.location }));
  const thrower = o.by ? kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 15.5 }, "rifle", "hold") : undefined;
  liveNades.push({ dim: ow(), at: { x: ox + 1.5, y: Y, z: oz + 1.5 }, boom: tick() + Number(o.fuse ?? 30), by: thrower });
  await kitWait(28);
  const moved = men.map((e, i) => +Math.hypot(e.location.x - p0[i].x, e.location.z - p0[i].z).toFixed(1));
  await kitWait(20);
  return { hp0, hp1: men.map((e) => e.isValid ? (downed.has(e.id) ? "down" : e.getComponent("minecraft:health").currentValue) : "dead"), movedBeforeBoom: moved };
};
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
// v9.2: upstairs, the enemy below. mode=order: told to a point on the ground floor (inside); mode=free: holding up
// there, free to fight (roam). How soon they're down, how many, and how many stand idle under a busy label.
KS.downFight = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 60, ox + 80, oz + 50);
  const B = (x0, y0, z0, x1, y1, z1, b) => kfill(ox + x0, Y + y0, oz + z0, ox + x1, Y + y1, oz + z1, b);
  B(0, 0, 0, 47, 18, 29, "stone_bricks"); B(1, 0, 1, 46, 17, 28, "air");
  B(1, 6, 1, 46, 6, 28, "oak_planks"); B(1, 12, 1, 46, 12, 28, "oak_planks");
  B(16, 0, 1, 16, 5, 28, "stone_bricks"); B(32, 0, 1, 32, 5, 28, "stone_bricks");
  for (const x of [16, 32]) for (const z of [8, 20]) B(x, 0, z, x, 1, z, "air");
  for (let i = 0; i < 6; i++) kset(ox + 40 + i, Y + i, oz + 26, STAIR("+x")); B(39, 6, 26, 45, 6, 26, "air");
  for (let i = 0; i < 6; i++) kset(ox + 3 + i, Y + 6 + i, oz + 3, STAIR("+x")); B(2, 12, 3, 8, 12, 3, "air");
  for (const x of [23, 24]) B(x, 0, 0, x, 1, 0, "air");
  setRelPair(1, 2, "1", false);
  const att = [], def = [];
  for (let i = 0; i < 10; i++) att.push(kitSoldier(1, { x: ox + 8 + i * 3 + 0.5, y: Y + 7, z: oz + 8.5 + (i % 3) * 4 }, ["rifle", "smg", "semi", "mg"][i % 4], o.mode === "free" ? "patrol" : "hold"));
  for (let i = 0; i < 8; i++) def.push(kitSoldier(2, { x: ox + 4 + i * 1.5 + 0.5, y: Y, z: oz + 14.5 + (i % 2) * 3 }, ["rifle", "smg", "semi", "mg"][i % 4], "hold"));
  await kitWait(40);
  if (o.mode !== "free") await kitOrder(1, { x: ox + 24, y: Y, z: oz + 14 });
  const t0 = tick();
  let firstDown = -1, down30 = 0, down60 = 0, idleLbl = 0, lblN = 0; const hist = new Map(), lab = {};
  await kitLoop(Number(o.ticks ?? 2400), () => {
    const A = att.filter((e) => e.isValid && !isDown(e)), D = def.filter((e) => e.isValid && !isDown(e));
    const dn = A.filter((e) => e.location.y < Y + 3).length;
    if (dn && firstDown < 0) firstDown = tick() - t0;
    if (tick() - t0 <= 600) down30 = Math.max(down30, dn); if (tick() - t0 <= 1200) down60 = Math.max(down60, dn);
    if ((tick() - t0) % 20 === 0) for (const e of A) {
      const n = notes.get(e.id); const h = hist.get(e.id) ?? []; h.push({ ...e.location }); if (h.length > 6) h.shift(); hist.set(e.id, h);
      if (!n) continue;
      const busy = /working out the way|advancing|in reserve|assaulting|moving to engage|storming/.test(n.text);
      if (!busy) continue; lblN++; lab[n.text] = (lab[n.text] ?? 0) + 1;
      if (h.length >= 6 && Math.hypot(h[0].x - e.location.x, h[0].z - e.location.z) < 0.8 && Math.abs(h[0].y - e.location.y) < 0.8 && now0(e)) idleLbl++;
    }
    return !A.length || !D.length;
  });
  function now0(e) { return !(gunState.get(e.id)?.lastShot > tick() - 60); }
  return { mode: o.mode ?? "order", ticks: tick() - t0, firstDown, down30, down60, attLeft: att.filter((e) => e.isValid && !isDown(e)).length, defLeft: def.filter((e) => e.isValid && !isDown(e)).length, idleBusyLabel: lblN ? +(idleLbl / lblN).toFixed(2) : 0, labels: lab };
};
// v9.2: the new vehicles: they spawn, carry soldiers, a soldier in the gun seat counts as the gunner, an unpiloted
// helicopter in the air settles to the ground, and each blows up when destroyed
KS.vehicles = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  kfill(ox + 8, Y - 3, oz - 10, ox + 25, Y - 1, oz + 10, "water");
  const r = {};
  const tr = ow().spawnEntity("war:truck", { x: ox - 10.5, y: Y, z: oz + 0.5 });
  const gb = ow().spawnEntity("war:gunboat", { x: ox + 16.5, y: Y - 1, z: oz + 0.5 });
  const he = ow().spawnEntity("war:heli", { x: ox - 10.5, y: Y + 12, z: oz + 15.5 });
  const men = []; for (let i = 0; i < 4; i++) men.push(kitSoldier(1, { x: ox + i * 2 + 0.5, y: Y, z: oz - 8.5 }, "rifle", "hold"));
  await kitWait(20);
  r.truckSeats = tr.getComponent("minecraft:rideable")?.seatCount; r.boatSeats = gb.getComponent("minecraft:rideable")?.seatCount; r.heliSeats = he.getComponent("minecraft:rideable")?.seatCount;
  try { tr.getComponent("minecraft:rideable").addRider(men[0]); } catch {}
  try { gb.getComponent("minecraft:rideable").addRider(men[1]); gb.getComponent("minecraft:rideable").addRider(men[2]); } catch {}
  await kitWait(10);
  r.inTruck = men[0].getComponent("minecraft:riding")?.entityRidingOn?.typeId ?? null;
  r.boatGunner = ridingNest(men[2]); r.boatDriverNotGunner = !ridingNest(men[1]);
  const h0 = he.location.y;
  await kitWait(200);
  r.heliFell = +(h0 - he.location.y).toFixed(1); r.boatY = +(gb.location.y - Y).toFixed(1);
  const tk = ow().spawnEntity("war:tank", { x: ox - 20.5, y: Y, z: oz - 15.5 });
  await kitWait(5);
  const kill = (v) => { try { return v.applyDamage(500, { cause: "entityExplosion" }); } catch (err) { return String(err).slice(0, 40); } };
  r.dmg = [tr, gb, he, tk].map(kill);
  await kitWait(30);
  r.gone = [tr, gb, he, tk].map((v) => !v.isValid || (v.getComponent("minecraft:health")?.currentValue ?? 0) <= 0);
  r.hp = [tr, gb, he, tk].map((v) => { try { return v.getComponent("minecraft:health")?.currentValue; } catch { return "x"; } });
  return r;
};
// v9.2: idle men light a campfire, sit round it; an order gets them up and the fire goes out when they've gone
KS.camp = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  globalThis.__campChance = 1;
  const men = []; for (let i = 0; i < 4; i++) men.push(kitSoldier(1, { x: ox + i * 1.5 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  let lit = -1, sat = 0; const t0 = tick();
  const p0 = men.map((m) => ({ ...m.location }));
  await kitLoop(2400, () => { if (lit < 0 && CAMPS.length) lit = tick() - t0; sat = Math.max(sat, seated.size); return lit >= 0 && sat >= 3; });
  await kitWait(100);
  const moved = Math.max(...men.map((m, i) => Math.hypot(m.location.x - p0[i].x, m.location.z - p0[i].z)));
  const r = { moved: Math.round(moved * 10) / 10, minFireGap: CAMPS[0] ? Math.round(Math.min(...men.map((m) => Math.hypot(m.location.x - CAMPS[0].at.x - 0.5, m.location.z - CAMPS[0].at.z - 0.5))) * 10) / 10 : null, lit, sat, fireBlock: CAMPS[0] ? ow().getBlock(CAMPS[0].at)?.typeId : null, hp: men.map((m) => { try { return Math.round(m.getComponent("minecraft:health").currentValue); } catch { return "x"; } }) };
  await kitOrder(1, { x: ox + 10, y: Y, z: oz + 10 });
  await kitWait(60);
  r.seatedAfterOrder = seated.size;
  await kitWait(260);
  r.campsLeft = CAMPS.length;
  globalThis.__campChance = undefined;
  return r;
};
// v9.4: World Animals (installed on the test server): a wild lion is shot; a deer walking by isn't; a lion tamed by a
// player of faction 1 (tag war_f1) isn't; a tamed, saddled elephant is ridden on "Mount up"; a stack of idle men spreads
KS.animals = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 60, oz + 40);
  kcmd("gamerule domobspawning false");
  for (const a of ow().getEntities({ families: ["worldanimals"] })) { try { a.remove(); } catch {} }
  for (const a of ow().getEntities({ families: ["monster"] })) { try { a.remove(); } catch {} }
  const r = {};
  const men = []; for (let i = 0; i < 4; i++) men.push(kitSoldier(1, { x: ox + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(40);
  const hp = (m) => { try { return Math.round(m.getComponent("minecraft:health").currentValue); } catch { return "x"; } };
  // a deer and a tamed lion, close
  const deer = ow().spawnEntity("worldanimals:deer", { x: ox + 3.5, y: Y, z: oz + 6.5 });
  const pet = ow().spawnEntity("worldanimals:lion", { x: ox - 3.5, y: Y, z: oz + 6.5 });
  try { pet.triggerEvent("minecraft:on_tame"); pet.addTag("war_f1"); } catch (err) { r.petErr = String(err).slice(0, 60); }
  const d0 = hp(deer), p0 = hp(pet);
  await kitWait(300);
  r.deer = { hp0: d0, hp: deer.isValid ? hp(deer) : "dead" }; r.pet = { hp0: p0, hp: pet.isValid ? hp(pet) : "dead" };
  // a wild lion 14 blocks off
  const lion = ow().spawnEntity("worldanimals:lion", { x: ox + 3.5, y: Y, z: oz - 14.5 });
  try { if (lion.hasComponent("minecraft:is_baby")) lion.triggerEvent("minecraft:ageable_grow_up"); } catch {}   // (a cub doesn't hunt)
  await kitWait(2); r.lionBaby = (() => { try { return lion.hasComponent("minecraft:is_baby"); } catch { return "x"; } })();
  const lionHp0 = hp(lion), shots0 = KSHOTS.length;
  const t0 = tick(); let lionDead = -1, minD = 99, aimed = 0, inSnap = 0;
  await kitLoop(900, () => {
    if (!lion.isValid || (lion.getComponent("minecraft:health")?.currentValue ?? 0) <= 0) { lionDead = tick() - t0; return true; }
    minD = Math.min(minD, ...men.map((m) => dist(m.location, lion.location)));
    if (men.some((m) => gunState.get(m.id)?.target?.id === lion.id)) aimed++;
    if (tick() % 100 === 0 && r.dbg === undefined) r.dbg = [];
    if (tick() % 100 === 0 && men[0].isValid) r.dbg.push({ d: Math.round(dist(men[0].location, lion.location)), tf: isTargetFor(men[0], sd(men[0]), lion), thr: perc.get(men[0].id)?.threat?.typeId ?? null, al: perc.get(men[0].id)?.alert, tg: gunState.get(men[0].id)?.target?.typeId ?? null, ch: (() => { try { return canHit(men[0], lion); } catch (err) { return String(err).slice(0, 40); } })(), rg: sd(men[0]).ranged });
    if ((combatants.get("overworld") ?? []).some((c) => c.id === lion.id)) inSnap++;
    return false; });
  r.lionHp = [lionHp0, lion.isValid ? hp(lion) : "dead"]; r.shots = KSHOTS.slice(shots0).length; r.hits = KSHOTS.slice(shots0).filter((q) => q.hit).length;
  r.lionDeadTicks = lionDead; r.lionMinD = Math.round(minD); r.lionAimedTicks = aimed; r.lionInSnap = inSnap; r.menHp = men.map(hp); r.menDown = men.filter((m) => !m.isValid || downed.has(m.id)).length;
  try { if (deer.isValid) deer.remove(); if (pet.isValid) pet.remove(); } catch {}
  // a tamed, saddled elephant: Mount up
  const el = ow().spawnEntity("worldanimals:african_elephant", { x: ox + 3.5, y: Y, z: oz + 5.5 });
  try { el.triggerEvent("minecraft:on_tame"); el.triggerEvent("minecraft:on_saddle"); } catch (err) { r.elErr = String(err).slice(0, 60); }
  await kitWait(10);
  r.elSaddled = !!el.hasComponent?.("minecraft:is_saddled"); r.elFamily = (() => { try { return el.getComponent("minecraft:type_family")?.hasTypeFamily("war_mount"); } catch { return "x"; } })();
  await giveOrderInner(KIT_PLAYER, { faction: 1, order: ORDERS.findIndex((q) => q[0] === "mount"), squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: ox, cz: oz, cy: Y });
  await kitWait(40);
  const rider = men.find((m) => m.isValid && m.getComponent("minecraft:riding")?.entityRidingOn?.id === el.id);
  r.elRidden = !!rider;
  if (rider) {
    const e0 = { ...el.location }, dest = { x: ox + 40, y: Y, z: oz + 5 };
    await kitOrder(1, dest);
    await kitWait(400);
    r.elMoved = Math.round(Math.hypot(el.location.x - e0.x, el.location.z - e0.z));
    r.elStillRidden = rider.getComponent("minecraft:riding")?.entityRidingOn?.id === el.id;
  }
  await giveOrderInner(KIT_PLAYER, { faction: 1, order: ORDERS.findIndex((q) => q[0] === "dismount"), squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: ox, cz: oz, cy: Y });
  try { el.remove(); } catch {}
  // two idle men standing on the same spot (a hold): one steps aside
  const a = kitSoldier(2, { x: ox + 20.5, y: Y, z: oz + 20.5 }, "rifle", "hold"), b = kitSoldier(2, { x: ox + 20.6, y: Y, z: oz + 20.6 }, "rifle", "hold");
  await kitWait(300);
  r.stackGap = a.isValid && b.isValid ? Math.round(Math.hypot(a.location.x - b.location.x, a.location.z - b.location.z) * 10) / 10 : "one died";
  return r;
};
// v9.4: idle men on a hold spawned on top of each other: does one of each pair step aside (and nobody else move)?
KS.stack = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  const pairs = []; for (let i = 0; i < 4; i++) pairs.push([kitSoldier(1, { x: ox + i * 8 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), kitSoldier(1, { x: ox + i * 8 + 0.6, y: Y, z: oz + 0.6 }, "rifle", "hold")]);
  const gaps = [];
  for (const w of [100, 200, 300]) { await kitWait(100); gaps.push(pairs.map(([a, b]) => Math.round(Math.hypot(a.location.x - b.location.x, a.location.z - b.location.z) * 10) / 10)); }
  const st = pairs.flat().map((e) => { const d = sd(e); return `${d.func}/${notes.get(e.id)?.text ?? notes.get(e.id) ?? "-"}`; });
  return { gaps, st: st.slice(0, 4) };
};
// v9.5: the new lines: a story gets a mate's reaction, an idle question gets its answer, "Hold position!" a "Copy that!"
KS.talk = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const men = []; for (let i = 0; i < 4; i++) men.push(kitSoldier(1, { x: ox + 20 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(40);
  const r = { story: callout(men[0], "STORY", { key: "story_1", event: true }) };
  await kitWait(80);
  for (let i = 0; i < 6; i++) { lastCall.clear(); heardLine.length = 0; callout(men[i % 4], "IDLE"); await kitWait(90); }
  for (let i = 0; i < 6; i++) { lastCall.clear(); heardLine.length = 0; callout(men[i % 4], "Hold position!"); await kitWait(40); }
  r.said = Object.fromEntries(Object.entries(globalThis.__v9 ?? {}).filter(([k]) => k.startsWith("say:")));
  return r;
};
// v9.5: wounded men falling back with nobody after them: how long until they go back to their order?
KS.retreat = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const men = []; for (let i = 0; i < 3; i++) men.push(kitSoldier(1, { x: ox + 20 + i * 3 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(40);
  for (const m of men) { try { m.getComponent("minecraft:health").setCurrentValue(4); sdp(m, "war:retreat", true); sdp(m, "war:hurt", tick() - 400); } catch {} }
  const t0 = tick(); let back = -1;
  await kitLoop(2400, () => { if (men.every((m) => !sd(m).retreat)) { back = tick() - t0; return true; } return false; });
  return { backTicks: back, hp: men.map((m) => Math.round(m.getComponent("minecraft:health").currentValue)) };
};
// v9.5: the user's fight: a squad on a high terrace ordered down open stairs to a bridge, the enemy holding beyond it and
// shooting. Does someone throw smoke over the move, and do they get down and across instead of standing there?
KS.bridge = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 30, ox + 80, oz + 30);
  kfill(ox, Y, oz - 8, ox + 14, Y + 5, oz + 8, "stone");
  for (let k = 0; k < 6; k++) kfill(ox + 15 + k, Y + 5 - k, oz - 3, ox + 15 + k, Y + 5 - k, oz + 3, STAIR("-x"));
  if (o.cover !== "0") for (const x of [26, 33, 40, 47]) for (const z of [-6, 1, 7]) kfill(ox + x, Y, oz + z + ((x / 7) % 2 ? 0 : -2), ox + x, Y + 1, oz + z + 1 + ((x / 7) % 2 ? 0 : -2), "stone_bricks");   // (pillars and low walls on the way, like a real street)
  setRelPair(1, 2, "1", false);
  const att = [], def = [];
  for (let i = 0; i < 6; i++) att.push(kitSoldier(1, { x: ox + 4 + i * 1.6 + 0.5, y: Y + 6, z: oz - 4 + (i % 3) * 4 + 0.5 }, ["rifle", "smg", "semi", "rifle", "mg", "rifle"][i], "hold"));
  for (let i = 0; i < 6; i++) def.push(kitSoldier(2, { x: ox + 56.5, y: Y, z: oz - 7.5 + i * 3 }, ["rifle", "semi", "rifle", "smg", "rifle", "mg"][i], "post"));
  await kitWait(140);                                                             // (the firefight gets going)
  const dest = { x: ox + 42, y: Y, z: oz };
  await kitOrder(1, dest);
  const t0 = tick(); let firstDown = -1, allDown = -1, there = -1, maxThere = 0;
  await kitLoop(Number(o.ticks ?? 1600), () => {
    const A = att.filter((e) => e.isValid && !isDown(e));
    const dn = A.filter((e) => e.location.y < Y + 1).length;
    if (dn && firstDown < 0) firstDown = tick() - t0;
    if (A.length && dn === A.length && allDown < 0) allDown = tick() - t0;
    const th = A.filter((e) => flat(e.location, dest) < 9).length; maxThere = Math.max(maxThere, th);
    if (th >= Math.ceil(A.length / 2) && A.length && there < 0) there = tick() - t0;
    return false; });
  return { firstDown, allDown, halfThere: there, maxThere, attLeft: att.filter((e) => e.isValid && !isDown(e)).length, defLeft: def.filter((e) => e.isValid && !isDown(e)).length };
};
// v9.7: two lines fight it out in the open: bodies, outright kills, limbs, and the bodies go after a minute
KS.gore = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 50, oz + 30);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  setRelPair(1, 2, "1", false);
  const W = ["rifle", "sniper", "shotgun", "mg", "rifle", "semi", "smg", "rifle"];
  for (let i = 0; i < 8; i++) { kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 10 + i * 3 + 0.5 }, W[i], "hold"); kitSoldier(2, { x: ox + 22.5, y: Y, z: oz - 10 + i * 3 + 0.5 }, W[(i + 3) % 8], "hold"); }
  await kitLoop(Number(o.ticks ?? 1600), () => kitSoldiers(1).filter((e) => !isDown(e)).length === 0 || kitSoldiers(2).filter((e) => !isDown(e)).length === 0);
  const cs = ow().getEntities({ type: "war:corpse" });
  const r = { corpses: cs.length, gibs: cs.filter((c) => c.getProperty("war:gib")).length, limbless: cs.filter((c) => !c.getProperty("war:gib") && c.getProperty("war:limb") > 0).length, skins: [...new Set(cs.map((c) => c.getProperty("war:faction")))] };
  await kitWait(1260);
  r.corpsesAfterMinute = ow().getEntities({ type: "war:corpse" }).length;
  return r;
};
// v9.7: the two new orders: Cover the spot (they face it) and Hold fire until I shoot (stance back when you fire)
KS.orders2 = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 30, oz + 20);
  const men = []; for (let i = 0; i < 3; i++) men.push(kitSoldier(1, { x: ox + 20 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(40);
  const base = { faction: 1, squad: 0, count: 0, radius: 200, stance: "aggressive", ao: 100, free: true, target: 5, cx: ox, cz: oz, cy: Y };
  await giveOrderInner(KIT_PLAYER, { ...base, order: ORDERS.findIndex((q) => q[0] === "cover") });
  await kitWait(60);
  const r = { covering: men.filter((e) => coverWatch.has(e.id)).length, cone: men.filter((e) => hornCone.has(e.id)).length };
  await giveOrderInner(KIT_PLAYER, { ...base, order: ORDERS.findIndex((q) => q[0] === "waitfire") });
  await kitWait(10);
  r.holding = men.filter((e) => String(gdp(e, "war:stance")) === "holdfire").length;
  openFireFor(KIT_PLAYER.id);
  await kitWait(5);
  r.afterFire = men.map((e) => String(gdp(e, "war:stance")));
  return r;
};
// v9.7: a forced dismemberment: the body is missing the limb and the limb lies apart
KS.gib = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const v = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(20);
  killHow.set(v.id, { limb: 2, dir: { x: 1, y: 0, z: 0 }, power: 0.4 });
  killReal(v);
  await kitWait(40);
  const cs = ow().getEntities({ type: "war:corpse", location: { x: ox, y: Y, z: oz }, maxDistance: 12 });
  return { n: cs.length, parts: cs.map((c) => ({ limb: c.getProperty("war:limb"), gib: c.getProperty("war:gib"), d: Math.round(Math.hypot(c.location.x - ox, c.location.z - oz) * 10) / 10 })), soldierGone: !v.isValid };
};
// v9.9: bodies don't shove the living: a man standing where a body lands stays put, and the body lands on the ground
KS.noshove = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  const z = ow().spawnEntity("minecraft:pig", { x: ox + 3.5, y: Y, z: oz + 0.5 });
  try { z.addEffect("slowness", 400, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(20);
  const p0 = { ...a.location }, z0 = { ...z.location };
  const cs = [];
  for (let i = 0; i < 4; i++) { cs.push(ow().spawnEntity("war:corpse", { x: ox + 0.5 + (i % 2) * 0.2, y: Y + 0.5, z: oz + 0.5 })); if (!o.ctrl) cs.push(ow().spawnEntity("war:corpse", { x: ox + 3.5, y: Y + 0.5, z: oz + 0.5 + (i % 2) * 0.2 })); }
  await kitWait(60);
  const r = { soldierMoved: Math.round(Math.hypot(a.location.x - p0.x, a.location.z - p0.z) * 100) / 100, pigMoved: Math.round(Math.hypot(z.location.x - z0.x, z.location.z - z0.z) * 100) / 100,
    bodyY: cs.map((c) => Math.round((c.location.y - Y) * 100) / 100), bodySpread: Math.round(Math.max(...cs.slice(0, 8).filter((c, i) => i % 2 === 0).map((c) => Math.hypot(c.location.x - ox - 0.5, c.location.z - oz - 0.5))) * 100) / 100 };
  for (const c of cs) { try { c.remove(); } catch {} } try { z.remove(); } catch {}
  return r;
};
// v9.9: a body can't be broken: punches, fire, lava and blasts leave it (and drop nothing)
KS.bodyhit = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  for (const c of ow().getEntities({ type: "minecraft:item", location: { x: ox, y: Y, z: oz }, maxDistance: 20 })) { try { c.remove(); } catch {} }
  const cs = [0, 1, 2, 3].map((i) => ow().spawnEntity("war:corpse", { x: ox + 0.5 + i * 3, y: Y, z: oz + 0.5 }));
  await kitWait(10);
  const pig = ow().spawnEntity("minecraft:pig", { x: ox + 0.5, y: Y, z: oz + 3.5 });
  try { cs[0].applyDamage(50, { cause: "entityAttack", damagingEntity: pig }); } catch (e) { console.warn("dmg " + e); }
  try { cs[1].applyDamage(50); } catch {}
  try { cs[2].setOnFire(5); } catch {}
  try { explode(ow(), { x: ox + 9.5, y: Y + 0.5, z: oz + 1.5 }, 3, { breaksBlocks: false }); } catch (e) { console.warn("ex " + e); }
  await kitWait(40);
  const items = ow().getEntities({ type: "minecraft:item", location: { x: ox, y: Y, z: oz }, maxDistance: 20 }).map((i) => { try { return i.getComponent("minecraft:item")?.itemStack?.typeId; } catch { return "?"; } });
  const all = ow().getEntities({ type: "war:corpse", location: { x: ox, y: Y, z: oz }, maxDistance: 20 });
  const r = { alive: cs.map((c) => c.isValid), bodies: all.length, at: all.map((c) => Math.round((c.location.x - ox) * 10) / 10), items };
  for (const c of all) { try { c.remove(); } catch {} } try { pig.remove(); } catch {}
  return r;
};
// v9.10: ragdoll deaths: shot from the front he goes over backwards, from behind onto his face, a blast throws and
// somersaults him; with a wall behind him he falls another way; every body ends flat and still within a few seconds
KS.ragdoll = async (o, ox, oz) => {
  floorAt(ox - 15, oz - 15, ox + 25, oz + 15);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  kfill(ox + 4, Y, oz - 1, ox + 4, Y + 1, oz + 1, "stone_bricks");                     // (low cover: the second man folds over it)
  kfill(ox + 12, Y, oz - 3, ox + 16, Y, oz + 3, "stone_bricks"); kfill(ox + 13, Y + 1, oz - 3, ox + 16, Y + 1, oz + 3, "stone_bricks");   // (a step down for the third)
  const cases = [
    { at: { x: ox - 6, z: oz }, dir: { x: 0, y: 0, z: 1 }, power: 0.25 },
    { at: { x: ox + 3, z: oz }, dir: { x: 1, y: 0, z: 0 }, power: 0.3 },
    { at: { x: ox + 13, z: oz }, dir: { x: -1, y: 0, z: 0 }, power: 0.3, y: 2 },
    { at: { x: ox + 20, z: oz }, dir: { x: 1, y: 0, z: 0 }, power: 0.9, mask: 1 | 2 | 16 },
  ];
  const men = cases.map((k) => kitSoldier(1, { x: k.at.x + 0.5, y: Y + (k.y ?? 0), z: k.at.z + 0.5 }, "rifle", "hold"));
  await kitWait(20);
  men.forEach((v, i) => { const k = cases[i]; killHow.set(v.id, { limb: k.mask ? 1 : 0, mask: k.mask, dir: k.dir, power: k.power }); killReal(v); });
  let peak = 0, firstStill = -1;
  for (let k = 0; k < 120; k++) { await kitWait(1); const act = [...RD.values()].filter((q) => q.act).length; peak = Math.max(peak, act); if (act === 0 && firstStill < 0) firstStill = k; }
  const all = ow().getEntities({ type: "war:corpse", location: { x: ox + 5, y: Y, z: oz }, maxDistance: 30 });
  const rep = all.map((c) => ({ gib: c.getProperty("war:gib"), limb: c.getProperty("war:limb"), x: Math.round((c.location.x - ox) * 10) / 10, y: Math.round((c.location.y - Y) * 100) / 100, tb: c.getProperty("war:tb"), sim: RD.has(c.id) }));
  // a grenade among the bodies wakes them
  const b0 = all.find((c) => !c.getProperty("war:gib") && Math.abs(c.location.x - (ox - 5.5)) < 2), p0 = b0 ? { ...b0.location } : undefined;
  explode(ow(), { x: ox - 6.5, y: Y + 0.5, z: oz + (p0 ? p0.z - oz : 0) - 1 }, 3, { breaksBlocks: false });
  await kitWait(60);
  const nb = p0 && ow().getEntities({ type: "war:corpse", location: p0, maxDistance: 10 }).filter((c) => !c.getProperty("war:gib"))[0];
  const after = nb ? { moved: Math.round(Math.hypot(nb.location.x - p0.x, nb.location.z - p0.z) * 10) / 10, sameEntity: nb.id === b0.id, tracked: RD.has(nb.id) } : "gone";
  return { peakActive: peak, allStillAfterTicks: firstStill, bodies: rep, blastMoved: after };
};
// v9.25: a long march over the real land (hills, trees, water: no test floor) into an ambush set beside the route. Every
// 2 s: how far along they are, how spread, how many moving, how many have the enemy, who's firing, who's down, what
// they say they're doing. Stuck = a man under orders who hasn't moved 1 block in 5 s.
function groundAt(x, z) {
  for (let y = 200; y > 40; y--) { const b = ow().getBlock({ x, y, z }); if (!b || b.isAir || b.typeId.includes("leaves") || b.typeId.includes("log") || b.typeId.includes("grass") && !b.typeId.includes("grass_block") || b.typeId.includes("flower") || b.typeId.includes("fern") || b.typeId.includes("snow_layer") || b.typeId.includes("vine")) continue; return { y: y + 1, liquid: b.isLiquid }; }
  return { y: Y, liquid: false };
}
// a spot a man can stand on near (x, z): open at feet and head (not inside a tree trunk or a bush)
function standSpot(x, z) {
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
    const g = groundAt(x + dx, z + dz); let ok = true;
    for (const yy of [g.y, g.y + 1]) { const b = ow().getBlock({ x: x + dx, y: yy, z: z + dz }); if (b && !b.isAir && !passable(b)) ok = false; }
    if (ok) return { x: x + dx + 0.5, y: g.y, z: z + dz + 0.5 };
  }
  const g = groundAt(x, z); return { x: x + 0.5, y: g.y, z: z + 0.5 };
}
KS.wild = async (o, ox, oz) => {
  const N = Number(o.n ?? 10), E = Number(o.e ?? 6), x0 = ox + Number(o.dx ?? 0);
  const start = { x: x0, z: oz - 170 }, dest = { x: x0, z: oz + 40 };
  const g0 = groundAt(start.x, start.z), g1 = groundAt(dest.x, dest.z);
  const men = []; for (let i = 0; i < N; i++) { const x = start.x + (i % 5) * 2 - 4, z = start.z - Math.floor(i / 5) * 2; men.push(kitSoldier(1, standSpot(x, z), ["rifle", "smg", "semi", "mg", "rifle"][i % 5], "hold")); }
  const amb = []; const ax = o.hill ? dest.x - 2 : x0 + Number(o.side ?? 14), az = o.hill ? dest.z - 2 : oz + Number(o.az ?? -20);   // (hill=1: they hold the objective itself)
  for (let i = 0; i < E; i++) { const x = ax + (i % 3) * 2, z = az + Math.floor(i / 3) * 3; amb.push(kitSoldier(2, standSpot(x, z), ["rifle", "semi", "mg"][i % 3], "hold")); }
  setRelPair(1, 2, "1", false);
  await kitWait(20);
  await kitOrder(1, { x: dest.x + 0.5, y: g1.y, z: dest.z + 0.5 });
  if (globalThis.__GR) globalThis.__GR = {};
  const t0 = tick(), up = (L) => L.filter((e) => e.isValid && !downed.has(e.id) && !isDown(e)), last = new Map(), stillSince = new Map();
  const tl = [], NS = {}, DBS = {}, prevAt = new Map(); let stuckMax = 0, maxStuckAt;
  await kitLoop(Number(o.ticks ?? 3600), () => {
    const now = tick(), t = now - t0, U = up(men);
    for (const e of U) { const l = e.location, p = last.get(e.id); if (!p || Math.hypot(l.x - p.x, l.z - p.z) > 1) { last.set(e.id, { x: l.x, z: l.z }); stillSince.set(e.id, now); } }
    for (const e of U) { const l = e.location, q = prevAt.get(e.id) ?? l; prevAt.set(e.id, { x: l.x, z: l.z }); const still = Math.hypot(l.x - q.x, l.z - q.z) < 0.4, k = (still ? "STILL " : "move ") + (notes.get(e.id)?.text ?? "-").replace(/[0-9(),]+/g, "").slice(0, 26); NS[k] = (NS[k] ?? 0) + 1; if (still && globalThis.__DB) { const kb = k + " @" + (globalThis.__DB.get(e.id) ?? "-") + "/" + (gliders.has(e.id) ? globalThis.__GL?.get(e.id) ?? "g?" : "-") + " st" + (getJSON(e, "war:st", {}).g ?? "") ; DBS[kb] = (DBS[kb] ?? 0) + 1; } }
    if (t % 40 < 10) {
      const cz = U.reduce((a, e) => a + e.location.z, 0) / Math.max(1, U.length), cx = U.reduce((a, e) => a + e.location.x, 0) / Math.max(1, U.length);
      const spread = Math.max(0, ...U.map((e) => Math.hypot(e.location.x - cx, e.location.z - cz)));
      const stuck = U.filter((e) => now - (stillSince.get(e.id) ?? now) > 100 && !perc.get(e.id)?.threat);
      const stuckFight = U.filter((e) => now - (stillSince.get(e.id) ?? now) > 100 && perc.get(e.id)?.threat);
      if (stuck.length > stuckMax) { stuckMax = stuck.length; maxStuckAt = stuck.map((e) => `${Math.round(e.location.x - ox)},${Math.round(e.location.y)},${Math.round(e.location.z - oz)}:${(notes.get(e.id)?.text ?? "").slice(0, 26)}`); }
      const thr = U.filter((e) => perc.get(e.id)?.threat).length, fire = U.filter((e) => now - (lastFired(e.id) ?? -999) < 40).length;
      const nh = {}; for (const e of U) { const k = (notes.get(e.id)?.text ?? "-").slice(0, 22); nh[k] = (nh[k] ?? 0) + 1; }
      if (o.t1 !== undefined && t >= Number(o.t1) * 20 && t <= Number(o.t2 ?? 9999) * 20) for (const e of U) { const g = gliders.get(e.id), m = marker(Number(gdp(e, "war:goal") ?? 0)); tl.push(`   #${men.indexOf(e)} ${(e.location.x - ox).toFixed(1)},${e.location.y.toFixed(1)},${(e.location.z - oz).toFixed(1)} mk${m ? (m.location.x - ox).toFixed(1) + "," + m.location.y.toFixed(1) + "," + (m.location.z - oz).toFixed(1) : "-"} gl${g ? `k${g.k}/${g.pts.length}${g.paused ? "P" : ""}b${g.blocked ?? 0}w${g.wait ?? 0}` : "-"} fg${(forceGlide.get(e.id) ?? 0) > now ? 1 : 0} gb${(glideBan.get(e.id) ?? 0) > now ? 1 : 0} @${globalThis.__DB?.get(e.id) ?? ""} st${getJSON(e, "war:st", {}).g ?? ""} [${(notes.get(e.id)?.text ?? "").slice(0, 24)}]`); }
      if (o.detail && thr) for (const e of U) { const th = perc.get(e.id)?.threat, gs = gunState.get(e.id), v = e.getVelocity(); tl.push(`   #${men.indexOf(e)} ${Math.round(e.location.x - ox)},${Math.round(e.location.y)},${Math.round(e.location.z - oz)} v${Math.hypot(v.x, v.z).toFixed(2)} th${th?.isValid ? Math.round(dist(th.location, e.location)) + (canHit(e, th) ? "LOS" : "x") : "-"} tg${gs?.target ? "Y" : "-"} f${sd(e).func} ord${gdp(e, "war:ordergoal") !== undefined ? 1 : 0} lock${combatLock.has(e.id) ? 1 : 0} [${(notes.get(e.id)?.text ?? "").slice(0, 30)}]`); }
      tl.push(`${(t / 20).toFixed(0)}s z${Math.round(cz - oz)} sp${spread.toFixed(0)} up${U.length}/${up(amb).length} thr${thr} fire${fire} stuck${stuck.length}/${stuckFight.length} ${Object.entries(nh).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}x${v}`).join(";")}`);
    }
    return up(men).length === 0 || up(amb).length === 0 && up(men).filter((e) => Math.hypot(e.location.x - dest.x, e.location.z - dest.z) < 14).length >= Math.ceil(up(men).length * 0.8);
  });
  const r = { dbs: Object.entries(DBS).sort((a, b) => b[1] - a[1]).slice(0, 30), notes: Object.entries(NS).sort((a, b) => b[1] - a[1]).slice(0, 24), gr: globalThis.__GR, ground: [g0.y, g1.y, g0.liquid, g1.liquid], secs: Math.round((tick() - t0) / 20), menUp: up(men).length, ambUp: up(amb).length, there: up(men).filter((e) => Math.hypot(e.location.x - dest.x, e.location.z - dest.z) < 14).length, stuckMax, maxStuckAt, ...kitShotStats(t0), tl };
  for (const e of [...men, ...amb]) try { e.remove(); } catch {}
  return r;
};
// v9.25: one man on real ground walking to a marker 6 blocks ahead (straight, walkable): does Minecraft's walking take
// him there? mode fixed: the marker stays put; hop: moved 0.5 along every 4 ticks (as the route driver does)
KS.mkwild = async (o, ox, oz) => {
  const res = {};
  for (const mode of ["fixed", "hop", "hop2"]) {
    const out = [];
    for (let k = 0; k < 12; k++) {
      const x = ox + (k % 4) * 9, z = oz - 160 + Math.floor(k / 4) * 50 + (mode === "hop" ? 15 : mode === "hop2" ? 30 : 0), g = groundAt(x, z);
      const e = kitSoldier(1, { x: x + 0.5, y: g.y, z: z + 0.5 }, "rifle", "hold");
      await kitWait(10);
      const g2 = groundAt(x, z + 6), tgt = { x: x + 0.5, y: g2.y, z: z + 6.5 };
      if (!straightReach(ow(), e.location, tgt)) { out.push("noreach"); try { e.remove(); } catch {} continue; }
      if (o.nobrain) held.set(e.id, { by: "kit" });
      const slot = myMarker(e, tgt, "war:mymk", 0.1); setGoal(e, slot); setGroups(e, { g: "g_wp", s: "s_4" });
      const z0 = e.location.z;
      for (let t = 0; t < 40; t++) { await kitWait(1); if (mode !== "fixed" && t % 4 === 0) myMarker(e, { x: tgt.x, y: groundAt(Math.floor(tgt.x), Math.floor(e.location.z + 6)).y, z: e.location.z + 6 }, "war:mymk", mode === "hop2" ? 1.5 : 0.1); }
      out.push(+(e.location.z - z0).toFixed(1) + (o.nobrain ? "" : ":" + (notes.get(e.id)?.text ?? "").slice(0, 12)));
      held.delete(e.id); try { e.remove(); } catch {}
    }
    res[mode] = out.join(" ");
  }
  return res;
};
// v9.26: two squads on real land ordered across to each other's side: they meet somewhere in the middle. Per side: how
// many up, shots, hits; every 5 s each side's centre, spread and what they're doing; stuck = no 1 block in 5 s.
KS.wildmeet = async (o, ox, oz) => {
  const N = Number(o.n ?? 8), D = Number(o.dist ?? 120), x0 = ox + Number(o.dx ?? 0);
  const A = { x: x0, z: oz - 20 - D }, B = { x: x0, z: oz - 20 };   // (inside the test's loaded area: -180..+50)
  const W5 = ["rifle", "smg", "semi", "mg", "rifle"], side = (f, at) => { const L = []; for (let i = 0; i < N; i++) { const x = at.x + (i % 4) * 2 - 3, z = at.z + Math.floor(i / 4) * 2 * (f === 1 ? -1 : 1); L.push(kitSoldier(f, standSpot(x, z), W5[i % 5], "hold")); } return L; };
  const s1 = (o.order ? 1 : 0) % 2 ? side(2, B) : side(1, A), s2 = (o.order ? 1 : 0) % 2 ? side(1, A) : side(2, B), a = s1[0] && P(s1[0], "war:faction") === 1 ? s1 : s2, b = a === s1 ? s2 : s1;
  setRelPair(1, 2, "1", false);
  await kitWait(20);
  const gA = groundAt(A.x, A.z), gB = groundAt(B.x, B.z);
  await Promise.all([kitOrder(1, { x: B.x + 0.5, y: gB.y, z: B.z + 0.5 }), kitOrder(2, { x: A.x + 0.5, y: gA.y, z: A.z + 0.5 })]);
  if (globalThis.__GR) globalThis.__GR = {};
  const t0 = tick(), up = (L) => L.filter((e) => e.isValid && !downed.has(e.id) && !isDown(e)), last = new Map(), stillSince = new Map(), tl = [], NS = {};
  let stuckMax = 0, stuckAt;
  await kitLoop(Number(o.ticks ?? 3600), () => {
    const now = tick(), t = now - t0;
    for (const e of [...up(a), ...up(b)]) { const l = e.location, p = last.get(e.id); if (!p || Math.hypot(l.x - p.x, l.z - p.z) > 1) { last.set(e.id, { x: l.x, z: l.z }); stillSince.set(e.id, now); } const k = `${P(e, "war:faction")}:${(notes.get(e.id)?.text ?? "-").replace(/[0-9(),]+/g, "").slice(0, 24)}`; NS[k] = (NS[k] ?? 0) + 1; }
    if (t % 100 < 10) {
      const row = [a, b].map((L, i) => { const U = up(L); if (!U.length) return `f${i + 1}: none`; const cx = U.reduce((q, e) => q + e.location.x, 0) / U.length, cz = U.reduce((q, e) => q + e.location.z, 0) / U.length; const st = U.filter((e) => now - (stillSince.get(e.id) ?? now) > 100); const thr = U.filter((e) => perc.get(e.id)?.threat).length, fire = U.filter((e) => now - (lastFired(e.id) ?? -999) < 40).length; return `f${i + 1} up${U.length} z${Math.round(cz - oz)} sp${Math.round(Math.max(0, ...U.map((e) => Math.hypot(e.location.x - cx, e.location.z - cz))))} thr${thr} fire${fire} stuck${st.length}`; });
      const st = [...up(a), ...up(b)].filter((e) => now - (stillSince.get(e.id) ?? now) > 100 && !perc.get(e.id)?.threat);
      if (st.length > stuckMax) { stuckMax = st.length; stuckAt = st.map((e) => `f${P(e, "war:faction")} ${Math.round(e.location.x - ox)},${Math.round(e.location.y)},${Math.round(e.location.z - oz)}:${(notes.get(e.id)?.text ?? "").slice(0, 24)}`); }
      tl.push(`${Math.round(t / 20)}s ${row.join(" | ")}`);
      if (o.t1 !== undefined && t >= Number(o.t1) * 20 && t <= Number(o.t2 ?? 9999) * 20) for (const e of [...up(a), ...up(b)]) { const pr = personal.get(e.id), th = perc.get(e.id)?.threat; tl.push(`   f${P(e, "war:faction")} ${(e.location.x - ox).toFixed(1)},${e.location.y.toFixed(1)},${(e.location.z - oz).toFixed(1)} still${Math.round((now - (stillSince.get(e.id) ?? now)) / 20)} pr${pr ? `${pr.kind}:${pr.pts ? pr.idx + "/" + pr.pts.length : pr.planning ? "plan" : "-"}${(pr.hold ?? 0) > now ? "H" : ""}` : "-"} gl${(() => { const g = gliders.get(e.id); return g ? `k${g.k}${g.paused ? "P" : ""}b${g.blocked ?? 0}w${g.wait ?? 0}L${g.lane ?? 0}` : "-"; })()} gb${(glideBan.get(e.id) ?? 0) > now ? 1 : 0} @${globalThis.__GL?.get(e.id) ?? ""} th${th?.isValid ? Math.round(dist(th.location, e.location)) + (canHit(e, th) ? "L" : "x") : "-"} [${(notes.get(e.id)?.text ?? "").slice(0, 30)}]`); }
    }
    return !up(a).length || !up(b).length;
  });
  const r = { gr: globalThis.__GR, ground: [gA.y, gB.y], secs: Math.round((tick() - t0) / 20), up1: up(a).length, up2: up(b).length, stuckMax, stuckAt, ...kitShotStats(t0), notes: Object.entries(NS).sort((x, y) => y[1] - x[1]).slice(0, 16), tl };
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  return r;
};
// v9.26: you walk 150 blocks over real land with 6 men following you (Follow me): how far behind are they, does anyone
// get left behind or stuck, and how long after you stop are they all with you?
KS.wildfollow = async (o, ox, oz) => {
  const x0 = ox + Number(o.dx ?? 0), z0 = oz - 170, g0 = groundAt(x0, z0);
  const ld = ow().spawnEntity("minecraft:armor_stand", { x: x0 + 0.5, y: g0.y, z: z0 + 0.5 });
  globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
  const V0 = globalThis.__viewers; globalThis.__viewers = () => { try { return [{ d: "minecraft:overworld", x: ld.location.x, z: ld.location.z }]; } catch { return []; } };   // (you're the one watching: they're near you)
  const fs = [0, 1, 2, 3, 4, 5].map((i) => { const e = kitSoldier(1, standSpot(x0 - 3 + (i % 3) * 2, z0 - 3 - Math.floor(i / 3) * 2), "rifle", "hold"); sdp(e, "war:squad", 0); giveFunction(e, "follow", ld); return e; });
  await kitWait(60);
  const v = Number(o.v ?? 0.2), tl = []; let sum = 0, n = 0, worst = 0;
  const gaps = () => fs.filter((e) => e.isValid).map((e) => flat(e.location, ld.location));
  // (you walk a real route, as a player would: round the cliffs, not straight up them)
  let route; planRoute(ow(), { x: x0 + 0.5, y: g0.y, z: z0 + 0.5 }, { x: x0 + 0.5, z: z0 + 150.5 }, (pts) => { route = pts ?? []; }, { max: 200000, maxRadius: 300 });
  for (let k = 0; k < 600 && !route; k++) await kitWait(1);
  if (!route?.length) route = [{ x: x0 + 0.5, y: g0.y, z: z0 + 0.5 }];
  const along = []; for (let i = 1; i < route.length; i++) { const a0 = route[i - 1], b0 = route[i], L = Math.hypot(b0.x - a0.x, b0.z - a0.z) || 1e-6; for (let s0 = 0; s0 < L; s0 += v) along.push({ x: a0.x + (b0.x - a0.x) * s0 / L, y: s0 / L < 0.5 ? a0.y : b0.y, z: a0.z + (b0.z - a0.z) * s0 / L }); }
  for (let k = 0; k < along.length; k++) {
    ld.teleport(along[k]); await kitWait(1);
    if (k > 60 && k % 10 === 0) { const G = gaps(), m = G.reduce((a, b) => a + b, 0) / Math.max(1, G.length); sum += m; n++; worst = Math.max(worst, ...G); }
    if (o.tr && k >= Number(o.tr) && k <= Number(o.tr) + 200 && k % 10 === 0) { const now = tick(); for (const e of (o.men ? String(o.men).split(",").map((q) => fs[Number(q)]) : fs.slice(0, 3))) { const pr = personal.get(e.id), g = gliders.get(e.id), v0 = e.getVelocity(), here = `${(e.location.x - ox).toFixed(1)},${e.location.y.toFixed(1)},${(e.location.z - oz).toFixed(1)}`, lp = (globalThis.__LP ??= new Map()).get(e.id) ?? e.location, mv0 = flat(lp, e.location); globalThis.__LP.set(e.id, { ...e.location }); tl.push(`  ${k} #${fs.indexOf(e)} ${here} mv${mv0.toFixed(1)} gap${Math.round(flat(e.location, ld.location))} pr${pr ? `${pr.kind}${pr.trail ? "T" : ""}:${pr.planning ? "PLAN" : pr.pts ? pr.idx + "/" + pr.pts.length : "-"}${(pr.hold ?? 0) > now ? "H" : ""}` : "-"} gl${g ? "k" + g.k + (g.paused ? "P" : "") + "b" + (g.blocked ?? 0) : "-"} hur${(HURRY.get(e.id) ?? 0) > now ? 1 : 0} @${globalThis.__DB?.get(e.id) ?? ""}/${globalThis.__GL?.get(e.id) ?? ""} st${getJSON(e, "war:st", {}).g ?? ""}/${getJSON(e, "war:st", {}).s ?? ""} v${Math.hypot(v0.x, v0.z).toFixed(2)} [${(notes.get(e.id)?.text ?? "").slice(0, 22)}]`); } }
    if (k % 100 === 0) tl.push(`${Math.round(k / 20)}s you z${Math.round(ld.location.z - oz)} gaps ${gaps().map((q) => Math.round(q)).join(",")} [${fs.map((e) => (notes.get(e.id)?.text ?? "").slice(0, 14)).join("|")}]`);
  }
  let t = 0; for (; t < 600; t += 10) { await kitWait(10); if (gaps().every((q) => q < 6)) break; }
  const r = { routeLen: along.length, avgGap: +(sum / Math.max(1, n)).toFixed(1), worst: Math.round(worst), allWithYou: t >= 600 ? `no (${gaps().map((q) => Math.round(q)).join(",")})` : `${(t / 20).toFixed(1)} s`, tl };
  globalThis.__fakeLeader = undefined; globalThis.__viewers = V0;
  for (const e of [...fs, ld]) try { e.remove(); } catch {}
  return r;
};
// v9.26: battle learning, switched on: a few short fights; does each faction's learned record change?
KS.learnprobe = async (o, ox, oz) => {
  sdp(world, "war:set_learn", true); learned = {}; saveLearned();
  const fights = [];
  floorAt(ox - 30, oz - 40, ox + 30, oz + 40);
  for (let i = 0; i < Number(o.k ?? 3); i++) {
    const a = [], b = [], up = (L) => L.filter((e) => e.isValid && !downed.has(e.id) && !isDown(e)).length;
    for (let j = 0; j < 5; j++) { a.push(kitSoldier(1, { x: ox - 6 + j * 3 + 0.5, y: Y, z: oz - 18 + 0.5 }, ["rifle", "smg", "semi", "mg", "rifle"][j], "hold")); b.push(kitSoldier(2, { x: ox - 6 + j * 3 + 0.5, y: Y, z: oz + 18 + 0.5 }, ["rifle", "smg", "semi", "mg", "rifle"][j], "hold")); }
    setRelPair(1, 2, "1", false);
    const t0 = tick(); await kitLoop(Number(o.max ?? 3000), () => !up(a) || !up(b));
    await kitWait(300);                                  // ("area clear": the fight is scored with everyone still there)
    fights.push(`${Math.round((tick() - t0) / 20)}s ${up(a)}-${up(b)}`);
    for (const e of [...a, ...b]) try { e.remove(); } catch {}
    await kitWait(40);
  }
  const L = getLearned(), out = {};
  for (const f of Object.keys(L)) { const m = L[f]; out[f] = { n: m.n, base: +m.base.toFixed(3), moved: Object.entries(m.mean).map(([k, v]) => [k, +(v - (BW_DEF()[k] ?? 0)).toFixed(3)]).filter(([, d]) => Math.abs(d) > 0.0005) }; }
  const words = [1, 2].map((f) => learnSummary(f).replace(/§./g, ""));
  sdp(world, "war:set_learn", undefined);
  return { fights, learned: out, words };
};
// v9.27: men down in a hole (3 deep, sheer sides: a natural pit, a ravine floor, a crater) ordered somewhere: how long
// until they're out? depth=d, n=men, mode=march|follow
KS.pit = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 50, oz + 30);
  const D = Number(o.depth ?? 3), N = Number(o.n ?? 3);
  kfill(ox - 2, Y - D, oz - 2, ox + 2, Y - 1, oz + 2, "air"); kfill(ox - 3, Y - D - 1, oz - 3, ox + 3, Y - D - 1, oz + 3, "stone");
  for (const [x0, z0, x1, z1] of [[-3, -3, 3, -3], [-3, 3, 3, 3], [-3, -3, -3, 3], [3, -3, 3, 3]]) kfill(ox + x0, Y - D, oz + z0, ox + x1, Y - 1, oz + z1, "stone");
  terrainForget();
  const men = []; for (let i = 0; i < N; i++) men.push(kitSoldier(1, { x: ox - 1 + i + 0.5, y: Y - D, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(20);
  await kitOrder(1, { x: ox + 40.5, y: Y, z: oz + 0.5 });
  const t0 = tick(); let out = -1, there = -1;
  await kitLoop(Number(o.ticks ?? 2400), () => { const t = tick() - t0; if (out < 0 && men.every((e) => e.location.y >= Y - 0.2)) out = t; if (there < 0 && men.every((e) => flat(e.location, { x: ox + 40.5, z: oz + 0.5 }) < 8)) { there = t; return true; } return false; });
  const r = { outSecs: out < 0 ? -1 : +(out / 20).toFixed(1), thereSecs: there < 0 ? -1 : +(there / 20).toFixed(1), final: men.map((e) => `${Math.round(e.location.x - ox)},${Math.round(e.location.y - Y)},${Math.round(e.location.z - oz)}:${(notes.get(e.id)?.text ?? "").slice(0, 20)}`) };
  for (const e of men) try { e.remove(); } catch {}
  return r;
};
// a map of the land around a spot: per column, the ground's height and what's on it (debugging the wild march)
// the blocks in a small box, layer by layer (y from low to high): "." air, "~" water, else the first 4 letters of the block
KS.box = async (o, ox, oz) => {
  const cx = ox + Number(o.x ?? 0), cz = oz + Number(o.z ?? 0), cy = Number(o.y ?? 64), R = Number(o.r ?? 2), out = [];
  for (let y = cy - 1; y <= cy + 2; y++) { out.push(`y${y}`); for (let z = cz - R; z <= cz + R; z++) { const row = []; for (let x = cx - R; x <= cx + R; x++) { const b = ow().getBlock({ x, y, z }); row.push(!b ? "?" : b.isAir ? "...." : b.isLiquid ? "~~~~" : b.typeId.replace("minecraft:", "").slice(0, 10).padEnd(10) + (passable(b) ? "P" : "_")); } out.push(`${z - oz}: ${row.join(" ")}`); } }
  return { out };
};
KS.look = async (o, ox, oz) => {
  const cx = ox + Number(o.x ?? 0), cz = oz + Number(o.z ?? 0), R = Number(o.r ?? 5), rows = [];
  for (let z = cz - R; z <= cz + R; z++) { const row = []; for (let x = cx - R; x <= cx + R; x++) { const g = groundAt(x, z); const at = ow().getBlock({ x, y: g.y, z }), un = ow().getBlock({ x, y: g.y - 1, z }); row.push(`${g.y}${(un?.typeId ?? "?").replace("minecraft:", "").slice(0, 4)}${at && !at.isAir ? "+" + at.typeId.replace("minecraft:", "").slice(0, 4) : ""}`); } rows.push(`${z - oz}: ` + row.join(" ")); }
  return { rows };
};
// v9.25: men bunched on one spot (stuck, confused) killed together: does any body fly off? (the highest any body got)
KS.pile = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const n = Number(o.n ?? 8), sp = Number(o.spread ?? 0.5);
  if (o.wall) kfill(ox + 1, Y, oz - 2, ox + 1, Y + 3, oz + 2, "stone_bricks");
  const men = []; for (let i = 0; i < n; i++) men.push(kitSoldier(1, { x: ox + 0.5 + (Math.random() - 0.5) * sp + (o.wall && i < 2 ? 0.9 : 0), y: Y, z: oz + 0.5 + (Math.random() - 0.5) * sp }, "rifle", "hold"));
  await kitWait(10);
  if (o.wall) for (const v of men.slice(0, 2)) try { v.teleport({ x: ox + 1.5, y: Y + 0.5, z: oz + 0.5 }); } catch {}   // (two stuck inside the wall)
  men.forEach((v, i) => { if (o.oneshot || i % 2) killHow.set(v.id, { limb: 0, dir: { x: Math.random() - 0.5, y: 0, z: Math.random() - 0.5 }, power: 0.3 }); killReal(v); });
  let maxY = 0, maxAt = -1;
  for (let k = 0; k < 200; k++) {
    await kitWait(1);
    for (const s of RD.values()) { for (const q of s.pts) { const h = q.p.y - Y; if (h > maxY) { maxY = h; maxAt = k; } } }
  }
  const bodies = ow().getEntities({ type: "war:corpse", location: { x: ox, y: Y, z: oz }, maxDistance: 60 }).map((c) => Math.round((c.location.y - Y) * 100) / 100);
  return { maxPointY: Math.round(maxY * 100) / 100, maxAt, bodiesY: bodies.sort((a, b) => b - a) };
};
// v9.11: 20 men killed in the same instant: how long does the ragdoll work take per tick?
KS.ragperf = async (o, ox, oz) => {
  floorAt(ox - 15, oz - 15, ox + 15, oz + 15);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const men = []; for (let i = 0; i < 20; i++) men.push(kitSoldier(1, { x: ox - 8 + (i % 5) * 4 + 0.5, y: Y, z: oz - 8 + Math.floor(i / 5) * 4 + 0.5 }, "rifle", "hold"));
  await kitWait(20);
  globalThis.__rdMs = 0; globalThis.__ph = undefined; globalThis.__scTot = 0; globalThis.__scN = 0;
  men.forEach((v, i) => { killHow.set(v.id, { limb: 0, mask: i % 4 === 0 ? 2 : 0, dir: { x: 1, y: 0, z: 0 }, power: i % 3 === 0 ? 0.9 : 0.3 }); killReal(v); });
  let peak = 0; for (let k = 0; k < 100; k++) { await kitWait(1); peak = Math.max(peak, [...RD.values()].filter((q) => q.act).length); }
  return { phases: globalThis.__ph, scTot: globalThis.__scTot, scN: globalThis.__scN, worstTickMs: globalThis.__rdMs, peakActive: peak, tracked: RD.size, stillActive: [...RD.values()].filter((q) => q.act).length };
};
// v9.11: a body wears the skin the man wore: his own, or his faction's
KS.corpseskin = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const keep = getJSON(world, "war:fskins", {});
  setJSON(world, "war:fskins", { ...keep, 1: 7 });
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), b = kitSoldier(1, { x: ox + 4.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  setP(b, "war:skin", 12); sdp(b, "p_war:skin", 12);
  await kitWait(10); syncSkin(a); syncSkin(b); await kitWait(5);
  const drawn = [a.getProperty("war:skin"), b.getProperty("war:skin")];
  killReal(a); killReal(b); await kitWait(10);
  const near = (x) => ow().getEntities({ type: "war:corpse", location: { x, y: Y, z: oz + 0.5 }, maxDistance: 2.5 })[0]?.getProperty("war:skin");
  setJSON(world, "war:fskins", keep);
  return { soldiersDrawn: drawn, bodies: [near(ox + 0.5), near(ox + 4.5)] };
};
// v9.13: cavalry on real mounts: each rider gets his own tamed, saddled mount, rides it, and fights from it
function kitCav(f, at, weapon, mount) {
  const e = ow().spawnEntity(SOLDIER, at, { spawnEvent: "war:init" });
  const ne = setupSoldier(e, { faction: f, squad: 2, weapon, ranged: isRangedW(weapon), div: "cavalier", radius: 8, func: "__none", mount }, KIT_PLAYER) ?? e;
  const x = ne?.isValid ? ne : e; giveFunction(x, "hold", KIT_PLAYER); return x;
}
KS.cavalry = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  for (const t of ["minecraft:horse", "minecraft:camel", "minecraft:pig", "worldanimals:lion"]) for (const m of ow().getEntities({ type: t, location: { x: ox, y: Y, z: oz }, maxDistance: 60 })) { try { m.remove(); } catch {} }
  setRelPair(1, 2, "1", true);
  const riders = [kitCav(1, { x: ox - 20.5, y: Y, z: oz - 4.5 }, "sword", "minecraft:horse"), kitCav(1, { x: ox - 20.5, y: Y, z: oz + 0.5 }, "smg", "minecraft:horse"),
    kitCav(1, { x: ox - 20.5, y: Y, z: oz + 4.5 }, "spear", "minecraft:camel"), kitCav(1, { x: ox - 22.5, y: Y, z: oz + 8.5 }, "rifle", o.wa ? "worldanimals:lion" : "minecraft:pig")];
  const old = kitSoldier(1, { x: ox - 24.5, y: Y, z: oz - 8.5 }, "sword", "hold"); sdp(old, "war:div", "cavalier"); setP(old, "war:cav", true);   // (an old-style cavalier)
  await kitWait(60);
  const st = () => [...riders, old].map((e) => { if (!e.isValid) return "dead"; const m = e.getComponent("minecraft:riding")?.entityRidingOn; return m ? `${m.typeId.split(":")[1]}${m.hasComponent("minecraft:is_saddled") ? "+saddle" : ""}${m.hasComponent("minecraft:is_tamed") ? "+tame" : ""}` : "on foot"; });
  const mounted = st(), cavBody = P(old, "war:cav");
  const foes = [0, 1, 2, 3, 4, 5].map((i) => kitSoldier(2, { x: ox + 12.5, y: Y, z: oz - 6.5 + i * 2.5 }, i % 2 ? "rifle" : "sword", "hold"));
  const startX = riders.map((e) => e.location.x);
  let minD = riders.map(() => 99);
  for (let k = 0; k < 40; k++) { await kitWait(10); riders.forEach((r, i) => { if (!r.isValid) return; for (const f of foes) if (f.isValid && !isDown(f)) minD[i] = Math.min(minD[i], Math.round(dist(r.location, f.location) * 10) / 10); }); }
  const foesLeft = foes.filter((f) => f.isValid && !isDown(f)).length;
  return { mounted, oldCavBodyGone: !cavBody, closestToFoes: minD, ridersMoved: riders.map((e, i) => e.isValid ? Math.round(Math.abs(e.location.x - startX[i])) : "dead"), foesLeftOf6: foesLeft, after: st(), mounts: ow().getEntities({ tags: ["war_cav"], location: { x: ox, y: Y, z: oz }, maxDistance: 80 }).length };
};
// v9.13: how much a round takes off men in no armor / iron / netherite (and a zombie in netherite, for comparison)
KS.armordmg = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  const tiers = ["none", "leather", "iron", "netherite"];
  const men = tiers.map((t, i) => { const e = kitSoldier(1, { x: ox - 6 + i * 4 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); sdp(e, "war:armor", t); equipArmor(e, t); return e; });
  const shooter = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 6.5 }, "rifle", "hold");
  await kitWait(20);
  const out = {};
  for (const cause of ["none", "entityAttack", "projectile-no-entity"]) {
    out[cause] = {};
    for (const [i, e] of men.entries()) {
      const h = e.getComponent("minecraft:health"); h.setCurrentValue(h.effectiveMax); const before = h.currentValue;
      await kitWait(12);
      try { if (cause === "none") e.applyDamage(7); else if (cause === "entityAttack") e.applyDamage(7, { cause: "entityAttack", damagingEntity: shooter }); else e.applyDamage(7, { cause: "projectile" }); } catch (err) { out[cause].err = String(err).slice(0, 80); }
      await kitWait(2);
      out[cause][tiers[i]] = Math.round((before - h.currentValue) * 10) / 10;
    }
  }
  for (const e of [...men, shooter]) try { e.remove(); } catch {}
  return out;
};
// v9.13: does the game hand us the damage before armor, or after? (a netherite man on 5 HP takes a 7)
KS.armorpre = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  const tiers = ["none", "netherite"], seen = {};
  const men = tiers.map((t, i) => { const e = kitSoldier(1, { x: ox - 3 + i * 6 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); sdp(e, "war:armor", t); equipArmor(e, t); return e; });
  const sub = world.beforeEvents.entityHurt.subscribe((ev) => { try { const i = men.findIndex((m) => m.id === ev.hurtEntity.id); if (i >= 0) seen[tiers[i]] = ev.damage; } catch {} });
  await kitWait(20);
  const out = {};
  for (const [i, e] of men.entries()) { const h = e.getComponent("minecraft:health"); h.setCurrentValue(5); e.applyDamage(7); await kitWait(3); out[tiers[i]] = { eventSaw: seen[tiers[i]], hpAfter: e.isValid ? Math.round(h.currentValue * 10) / 10 : "dead", downed: downed.has(e.id) }; }
  world.beforeEvents.entityHurt.unsubscribe(sub);
  for (const e of men) try { e.remove(); } catch {}
  return out;
};
// v9.13: time to drop a man (no armor / iron / netherite) under a 6-gun squad's fire at 16 blocks
KS.ttk = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const tier = o.tier ?? "netherite";
  const t = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, o.w ?? "rifle", "hold"); sdp(t, "war:armor", tier); equipArmor(t, tier); sdp(t, "war:stance", "holdfire");
  const guns = ["rifle", "rifle", "smg", "smg", "mg", "semi"].map((w, i) => kitSoldier(2, { x: ox - 7.5 + i * 3, y: Y, z: oz + 16.5 }, w, "hold"));
  const t0 = tick(); let hits = 0;
  const sub = world.afterEvents.entityHurt.subscribe((ev) => { if (ev.hurtEntity?.id === t.id) hits++; });
  let k = 0; while (k < 600 && t.isValid && !isDown(t)) { await kitWait(5); k += 5; }
  world.afterEvents.entityHurt.unsubscribe(sub);
  const r = { tier, secondsToDrop: k >= 600 ? ">30" : Math.round((tick() - t0) / 2) / 10, hits };
  for (const e of [t, ...guns]) try { e.remove(); } catch {}
  return r;
};
// v9.13: "entityAttack" from a shooter: armor applies? and two rounds in the same tick?
KS.atkdmg = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  const tiers = ["none", "netherite"];
  const men = tiers.map((t, i) => { const e = kitSoldier(1, { x: ox - 3 + i * 6 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); sdp(e, "war:armor", t); equipArmor(e, t); return e; });
  const sh = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 5.5 }, "rifle", "hold");
  await kitWait(20);
  const out = {};
  for (const [i, e] of men.entries()) {
    const h = e.getComponent("minecraft:health"); h.setCurrentValue(16);
    let err; try { e.applyDamage(4, { cause: "entityAttack", damagingEntity: sh }); } catch (x) { err = String(x).slice(0, 60); }
    await kitWait(1); const one = 16 - h.currentValue;
    try { e.applyDamage(4, { cause: "entityAttack", damagingEntity: sh }); e.applyDamage(4, { cause: "entityAttack", damagingEntity: sh }); } catch {}
    await kitWait(1); const two = 16 - one - h.currentValue;
    await kitWait(12); const b3 = h.currentValue; try { e.applyDamage(4, { cause: "entityAttack", damagingEntity: sh }); } catch {} await kitWait(1);
    out[tiers[i]] = { first: Math.round(one * 10) / 10, nextTwoSameTick: Math.round(two * 10) / 10, after12ticks: Math.round((b3 - h.currentValue) * 10) / 10, err };
  }
  for (const e of [...men, sh]) try { e.remove(); } catch {}
  return out;
};
// v9.14: a horse tamed and saddled the robust way (taming component, saddle in its inventory)
KS.horseprobe = async (o, ox, oz) => {
  floorAt(ox - 6, oz - 6, ox + 6, oz + 6);
  const h = ow().spawnEntity("minecraft:horse", { x: ox + 0.5, y: Y, z: oz + 0.5 }, o.ev ? { spawnEvent: o.ev } : undefined);
  await kitWait(5);
  const r = { baby: h.hasComponent("minecraft:is_baby"), comps: ["minecraft:tamemount", "minecraft:inventory", "minecraft:equippable", "minecraft:rideable", "minecraft:is_tamed", "minecraft:is_saddled"].filter((c) => { try { return h.hasComponent(c); } catch { return false; } }) };
  try { r.tame = String(h.getComponent("minecraft:tamemount")?.tame?.(false)); } catch (e) { r.tameErr = String(e).slice(0, 80); }
  await kitWait(2); r.tamedAfter = h.hasComponent("minecraft:is_tamed");
  try { const inv = h.getComponent("minecraft:inventory")?.container; r.invSize = inv?.size; inv?.setItem(0, new ItemStack("minecraft:saddle", 1)); } catch (e) { r.invErr = String(e).slice(0, 80); }
  await kitWait(3); r.saddledAfter = h.hasComponent("minecraft:is_saddled");
  const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 1.5 }, "rifle", "hold");
  await kitWait(5); mountSoldier(e, h, false); await kitWait(40);
  r.riding = e.getComponent("minecraft:riding")?.entityRidingOn?.typeId ?? "no";
  try { e.remove(); h.remove(); } catch {}
  return r;
};
// v9.14: a man going down wounded falls like a body, then lies where his body came to rest; a rider is thrown off
KS.downfall = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), r = kitCav(1, { x: ox + 6.5, y: Y, z: oz + 0.5 }, "smg", "minecraft:horse");
  await kitWait(60);
  const riding0 = !!r.getComponent("minecraft:riding")?.entityRidingOn, p0 = { ...a.location };
  const dbg = [];
  const sub = world.beforeEvents.entityHurt.subscribe((ev) => { try { if (ev.hurtEntity.id === a.id || ev.hurtEntity.id === r.id) dbg.push({ dmg: ev.damage, hp: ev.hurtEntity.getComponent("minecraft:health")?.currentValue, cause: ev.damageSource.cause }); } catch {} });
  for (const e of [a, r]) { const h = e.getComponent("minecraft:health"); h.setCurrentValue(2); }
  await kitWait(2);
  for (const e of [a, r]) { lastHit.set(e.id, { t: tick(), dir: { x: 1, y: 0, z: 0 }, weapon: "rifle", dd: 10 }); e.applyDamage(3); }
  await kitWait(5);
  world.beforeEvents.entityHurt.unsubscribe(sub);
  if (!a.isValid || !r.isValid) return { dbg, kh: [killHow.get(a.id), killHow.get(r.id)] };
  if (!a.isValid || !r.isValid) return { gone: [a.isValid, r.isValid], dying: [dying.has(a.id), dying.has(r.id)] };
  const mid = { hidden: [a, r].map((e) => !!e.getProperty("war:hide")), falling: [a, r].map((e) => FALLS.has(e.id)) };
  await kitWait(90);
  const end = { downed: [a, r].map((e) => downed.has(e.id)), hidden: [a, r].map((e) => !!e.getProperty("war:hide")), falling: [a, r].map((e) => FALLS.has(e.id)), moved: Math.round(dist(a.location, p0) * 10) / 10, riderOff: !r.getComponent("minecraft:riding")?.entityRidingOn, fallBodies: ow().getEntities({ type: "war:corpse", location: { x: ox, y: Y, z: oz }, maxDistance: 20 }).length };
  revive(a); revive(r); await kitWait(80);
  const after = { riderBackOn: !!r.getComponent("minecraft:riding")?.entityRidingOn };
  for (const e of [a, r]) try { e.remove(); } catch {}
  return { riding0, mid, end, after };
};
// v9.14: content levels switch weapons over and back
KS.content = async (o, ox, oz) => {
  floorAt(ox - 6, oz - 6, ox + 6, oz + 6);
  const keep = setting("content", "full");
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "mg", "hold");
  await kitWait(10);
  const out = { full: sd(a).weapon };
  for (const m of ["light", "vanilla", "full"]) { sdp(world, "war:set_content", m); await kitWait(60); out[m] = sd(a).weapon + "/" + String(gdp(a, "war:weapon0") ?? "-"); }
  sdp(world, "war:set_content", keep); try { a.remove(); } catch {}
  return out;
};
// v9.14: a surrendered man is taken prisoner by the enemy near him and marched to their lines; his own side frees him
KS.prisoners = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const p = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  const cap = kitSoldier(1, { x: ox + 5.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); setGoal(cap, makeWaypoint(ow(), { x: ox + 15.5, y: Y, z: oz + 0.5 })); sdp(cap, "war:home", Number(gdp(cap, "war:goal") ?? 0));
  await kitWait(10);
  isoSurrender(p, 1);
  let t = 0; while (t < 200 && !pows.has(p.id)) { await kitWait(10); t += 10; }
  const taken = pows.has(p.id), mode = pows.get(p.id)?.mode, p0 = { ...p.location };
  await kitWait(200);
  const marched = Math.round(dist(p.location, p0) * 10) / 10;
  try { cap.remove(); } catch {}
  const fr = kitSoldier(2, { x: p.location.x + 1, y: p.location.y, z: p.location.z }, "rifle", "hold");
  await kitWait(100);
  const freed = !pows.has(p.id);
  for (const e of [p, fr]) try { e.remove(); } catch {}
  return { taken, takenAfterTicks: t, mode, marchedBlocks: marched, freedByHisSide: freed };
};
// v9.14: a round through a lying body kicks it; a body wears the armor he wore; bodies dropped on each other pile up
KS.bodyfx = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); sdp(a, "war:armor", "iron"); equipArmor(a, "iron");
  await kitWait(10);
  killHow.set(a.id, { limb: 0, dir: { x: 0, y: 0, z: 1 }, power: 0.1 }); killReal(a);
  await kitWait(60);
  const sa = [...RD.values()].find((q) => !q.gib && dist(q.pts[0].p, { x: ox + 0.5, y: Y, z: oz + 0.5 }) < 3), hz = sa ? vmul(vadd(sa.pts[0].p, sa.pts[3].p), 0.5) : { x: ox + 0.5, z: oz + 1 };
  const b = kitSoldier(1, { x: hz.x, y: Y, z: hz.z }, "rifle", "hold");
  await kitWait(4);
  killHow.set(b.id, { limb: 0, dir: { x: 0, y: 0, z: 1 }, power: 0.1 }); killReal(b);
  await kitWait(80);
  const cs = ow().getEntities({ type: "war:corpse", location: { x: ox, y: Y, z: oz }, maxDistance: 6 });
  const heights = cs.map((c) => { const s2 = RD.get(c.id); return s2 ? Math.round(Math.max(...s2.pts.map((q) => q.p.y)) * 100 - Y * 100) / 100 : "?"; });
  const armor = cs.map((c) => c.getProperty("war:armor"));
  const s1 = RD.get(cs[0]?.id), h0 = s1 ? { ...s1.pts[3].p } : undefined, before = cs.map((c) => RD.get(c.id)?.pts.map((q) => ({ ...q.p })));
  const sh = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz - 8.5 }, "rifle", "hold");
  if (h0) rdShot(ow(), { x: h0.x, y: h0.y + 0.05, z: h0.z - 6 }, { x: 0, y: 0, z: 1 }, 10);
  await kitWait(20);
  const kicked = cs.map((c, i) => { const st = RD.get(c.id); return st && before[i] ? Math.round(Math.max(...st.pts.map((q, k) => dist(q.p, before[i][k]))) * 100) / 100 : "?"; });
  try { sh.remove(); } catch {}
  return { bodies: cs.length, armorProps: armor, topOfEachBody: heights, kickedBy: kicked };
};
// v9.14: what health the game reports in the hurt event: for a vanilla blast and for a script hit
KS.hpseen = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), b = kitSoldier(1, { x: ox + 6.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(10);
  const seen = [];
  const sub = world.beforeEvents.entityHurt.subscribe((ev) => { try { const v = ev.hurtEntity; if (v.id === a.id || v.id === b.id) seen.push({ who: v.id === a.id ? "blast" : "script", dmg: Math.round(ev.damage * 10) / 10, hpSeen: v.getComponent("minecraft:health")?.currentValue, pre: PRE_HP.get(v.id) }); ev.cancel = true; } catch {} });
  for (const e of [a, b]) e.getComponent("minecraft:health").setCurrentValue(14);
  await kitWait(2);
  ow().createExplosion({ x: ox + 0.5, y: Y + 0.5, z: oz + 2.5 }, 1.5, { breaksBlocks: false });
  preHp(b); b.applyDamage(4);
  await kitWait(2);
  world.beforeEvents.entityHurt.unsubscribe(sub);
  for (const e of [a, b]) try { e.remove(); } catch {}
  return { seen };
};
// v9.14: who makes waypoints, and how many, while cavalry ride an order through a walled course
KS.wpcount = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  kfill(ox - 10, Y, oz - 20, ox - 10, Y + 2, oz + 15, "stone_bricks");                    // (a wall to get round)
  const counts = {}, orig = makeWaypoint;
  makeWaypoint = (...a) => { const st = String(new Error().stack).split("\n")[2]?.trim().split(" ")[1] ?? "?"; counts[st] = (counts[st] ?? 0) + 1; return orig(...a); };
  const n0 = allOf(WAYPOINT).length;
  const riders = [0, 1, 2, 3].map((i) => kitCav(1, { x: ox - 25.5, y: Y, z: oz - 3 + i * 2 + 0.5 }, i % 2 ? "smg" : "sword", "minecraft:horse"));
  await kitWait(60);
  await kitOrder(1, { x: ox + 20, y: Y, z: oz }, "hold");
  const startX = riders.map((e) => e.location.x);
  const trace = [];
  for (let k = 0; k < 6; k++) { await kitWait(100); trace.push(riders.map((e) => { const R = RIDE_RT.get(e.id); const m = e.getComponent("minecraft:riding")?.entityRidingOn, v = m?.getVelocity(); return `${(e.location.x - ox).toFixed(1)},${(e.location.z - oz).toFixed(1)} ${R ? (R.planning ? "plan" : R.pts ? `r${R.idx}/${R.pts.length} p0=${(R.pts[R.idx].x - ox).toFixed(1)},${R.pts[R.idx].y - Y},${(R.pts[R.idx].z - oz).toFixed(1)} p+=${R.pts[R.idx + 1] ? (R.pts[R.idx + 1].x - ox).toFixed(1) + "," + (R.pts[R.idx + 1].z - oz).toFixed(1) : "-"}` : "none") : "-"} v=${v ? Math.hypot(v.x, v.z).toFixed(3) : "?"} my=${m ? (m.location.y - Y).toFixed(2) : "?"}`; }).join(" | ")); }
  makeWaypoint = orig;
  return { trace, madeBy: counts, waypointsNow: allOf(WAYPOINT).length - n0, mounted: riders.map((e) => !!e.getComponent("minecraft:riding")?.entityRidingOn), progressX: riders.map((e, i) => Math.round(e.location.x - startX[i])), reached: riders.filter((e) => e.location.x > ox + 14).length };
};
// v9.14: a game version without "spawn_tame_adult": does a cavalier still end up riding his horse?
KS.horsenoevt = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 40 })) { try { m.remove(); } catch {} }
  const keep = CAV_MOUNTS[0][2]; CAV_MOUNTS[0][2] = o.ev ?? "minecraft:no_such_event";
  const rs = [0, 1, 2].map((i) => kitCav(1, { x: ox + i * 4 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "minecraft:horse"));
  const trace = [];
  for (let k = 0; k < 8; k++) { await kitWait(40); trace.push(rs.map((e) => { const m = world.getEntity(String(gdp(e, "war:mountId") ?? "")); return `${e.getComponent("minecraft:riding")?.entityRidingOn ? "ON" : "off"}${m ? (m.hasComponent("minecraft:is_tamed") ? "/tame" : "/wild") + (m.hasComponent("minecraft:is_saddled") ? "+sad" : "") : "/nohorse"}`; }).join(" ")); }
  CAV_MOUNTS[0][2] = keep;
  for (const e of rs) try { e.remove(); } catch {}
  return { trace };
};
// v9.14: a horse left wild-but-saddled by the old code: is it put right, and ridden?
KS.horseold = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  let h; try { h = ow().spawnEntity("minecraft:horse", { x: ox + 0.5, y: Y, z: oz + 2.5 }, { spawnEvent: "minecraft:no_such_event", initialPersistence: true }); } catch (x) { return { spawnThrew: String(x).slice(0, 80) }; }
  await kitWait(3); try { h.triggerEvent("minecraft:horse_saddled"); } catch {} try { h.getComponent("minecraft:tamemount")?.tame(false); } catch {}
  const comps = ["minecraft:tamemount", "minecraft:rideable", "minecraft:is_baby", "minecraft:inventory"].filter((c) => h.hasComponent(c));
  await kitWait(5);
  const before = (h.hasComponent("minecraft:is_tamed") ? "tame" : "wild") + (h.hasComponent("minecraft:is_saddled") ? "+sad" : "");
  const e = kitCav(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "minecraft:horse");
  await kitWait(5);
  { const own = world.getEntity(String(gdp(e, "war:mountId") ?? "")); try { own?.getComponent("minecraft:rideable")?.ejectRider(e); own?.remove(); } catch {} }
  sdp(e, "war:mountId", h.id); sdp(e, "war:mountTry", undefined); mountOf.delete(e.id);
  await kitWait(120);
  const after = (h.hasComponent("minecraft:is_tamed") ? "tame" : "wild") + (h.hasComponent("minecraft:is_saddled") ? "+sad" : "");
  const r = { comps, before, after, riding: e.getComponent("minecraft:riding")?.entityRidingOn?.id === h.id };
  try { e.remove(); h.remove(); } catch {}
  return r;
};
// v9.14: how the game counts "MB of dynamic properties saved": many small writes on soldiers, or few writes on the world
KS.dpcost = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  const men = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => kitSoldier(1, { x: ox + i - 4.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(20);
  if (o.mode === "ent") { for (let k = 0; k < 300; k++) { for (const e of men) e.setDynamicProperty("war:dptest", k); await kitWait(1); } }
  else if (o.mode === "tpmk") { const mk = []; for (let i = 0; i < 40; i++) { const sl = makeWaypoint(ow(), { x: ox + (i % 8) * 3 - 12, y: Y, z: oz + Math.floor(i / 8) * 3 - 6 }, false); const m = marker(sl); if (m) mk.push(m); } for (let k = 0; k < 1300; k++) { for (let j = 0; j < 13; j++) { const m = mk[(k * 13 + j) % mk.length]; try { m.teleport({ x: m.location.x + (Math.random() - 0.5) * 2, y: Y, z: m.location.z + (Math.random() - 0.5) * 2 }); } catch {} } await kitWait(1); } for (const m of mk) try { m.remove(); } catch {} }
  else if (o.mode === "tags") { for (let k = 0; k < 1300; k++) { for (let j = 0; j < 13; j++) { const e = men[(k * 13 + j) % men.length]; try { if (k % 2) e.removeTag(`war_t${j}`); else e.addTag(`war_t${j}`); } catch {} } await kitWait(1); } }
  else if (o.mode === "tpsol") { for (let k = 0; k < 1300; k++) { for (let j = 0; j < 6; j++) { const e = men[(k * 6 + j) % men.length]; try { e.teleport({ x: e.location.x + (Math.random() - 0.5) * 0.4, y: e.location.y, z: e.location.z + (Math.random() - 0.5) * 0.4 }); } catch {} } await kitWait(1); } }
  else if (o.mode === "churn") { const live = []; for (let k = 0; k < 1300; k++) { if (k % 2 === 0) { const sl = makeWaypoint(ow(), { x: ox + (Math.random() - 0.5) * 14, y: Y, z: oz + (Math.random() - 0.5) * 14 }, false); const m = marker(sl); if (m) live.push(m); while (live.length > 40) { try { live.shift().remove(); } catch {} } } await kitWait(1); } for (const m of live) try { m.remove(); } catch {} }
  else if (o.mode === "world") { const big = "x".repeat(Number(o.kb ?? 30) * 1024); for (let k = 0; k < 100; k++) { world.setDynamicProperty("war:dptest", big + k); await kitWait(10); } world.setDynamicProperty("war:dptest", undefined); }
  for (const e of men) try { e.remove(); } catch {}
  return { mode: o.mode };
};
// v9.14: 180 soldiers standing about (or marching, no fight): is the "MB saved" from their mere presence and movement?
KS.dpidle = async (o, ox, oz) => {
  floorAt(ox - 60, oz - 90, ox + 60, oz + 90);
  setRelPair(1, 2, "0", false);
  for (let i = 0; i < 180; i++) kitSoldier(1 + (i % 2), { x: ox + (i % 20) * 2 - 20 + 0.5, y: Y, z: oz - 40 + Math.floor(i / 20) * 4 + 0.5 }, "rifle");
  await kitWait(20);
  globalThis.__dpReport?.(); globalThis.__evReport?.(1); const t0 = tick();
  const wset = world.setDynamicProperty; if (o.nows) world.setDynamicProperty = function (k, v) { if (k === "war:marches2" || k === "war:slotrefs") return; return wset.call(world, k, v); };
  if (o.march) { await kitOrder(1, { x: ox, y: Y, z: oz + 70 }); await kitOrder(2, { x: ox, y: Y, z: oz - 70 }); }
  await kitWait(1200);
  if (o.nows) delete world.setDynamicProperty;
  const wk = [...DPSTAT].filter(([k]) => k.startsWith("W/")).map(([k, r]) => `${k}:${r.n}x/${(r.b / 1024).toFixed(0)}KB`);
  return { wk, n: kitSoldiers().length, dp: globalThis.__dpReport?.(), ev: globalThis.__evReport?.(tick() - t0), wps: allOf(WAYPOINT).length };
};
// v9.14: 180 men moved every tick: does "MB saved" scale with how much data each one carries?
KS.dpmove = async (o, ox, oz) => {
  floorAt(ox - 60, oz - 90, ox + 60, oz + 90);
  const men = []; for (let i = 0; i < 180; i++) men.push(kitSoldier(1, { x: ox + (i % 20) * 2 - 20 + 0.5, y: Y, z: oz - 40 + Math.floor(i / 20) * 4 + 0.5 }, "rifle", "hold"));
  await kitWait(20);
  if (o.strip) for (const e of men) { try { for (const k of e.getDynamicPropertyIds()) e.setDynamicProperty(k, undefined); } catch {} }
  for (let k = 0; k < 1300; k++) { for (const e of men) { try { e.teleport({ x: e.location.x + (k % 2 ? 0.3 : -0.3), y: e.location.y, z: e.location.z }); } catch {} } await kitWait(1); }
  return { n: men.length, bytes: men[0].getDynamicPropertyTotalByteCount() };
};
// v9.7: a downed man in plain view of the enemy (who hold their fire) next to a wall: does he crawl behind it?
KS.crawl = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 30, oz + 20);
  kfill(ox + 3, Y, oz - 2, ox + 3, Y + 1, oz + 2, "stone_bricks");            // (a low wall 2 blocks from him, between him and them)
  setRelPair(1, 2, "1", false);
  const v = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 4.5 }, "rifle", "hold");
  const foes = []; for (let i = 0; i < 2; i++) { const f = kitSoldier(2, { x: ox + 20.5, y: Y, z: oz + 4.5 + i * 2 }, "rifle", "hold"); sdp(f, "war:stance", "holdfire"); foes.push(f); }
  await kitWait(40);
  const p0 = { ...v.location };
  goDown(v, foes[0]);
  await kitWait(200);
  return { moved: Math.round(flat(p0, v.location) * 10) / 10, behindWall: v.location.z < oz + 2.6 && v.location.x < ox + 3, downed: downed.has(v.id), crawlProp: !!v.getProperty("war:crawl") };
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
  if (o.view !== undefined) KIT.view = Number(o.view);
  floorAt(ox - 60, oz - 90, ox + 60, oz + 90);
  setRelPair(1, 2, "1", false);
  const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi"];
  for (let i = 0; i < N; i++) kitSoldier(1, { x: ox + (i % 20) * 2 - 20 + 0.5, y: Y, z: oz - 60 - Math.floor(i / 20) * 2 + 0.5 }, W8[i % 6]);
  for (let i = 0; i < N; i++) kitSoldier(2, { x: ox + (i % 20) * 2 - 20 + 0.5, y: Y, z: oz + 60 + Math.floor(i / 20) * 2 + 0.5 }, W8[i % 6]);
  await kitWait(20);
  await kitOrder(1, { x: ox, y: Y, z: oz + 60 }); await kitOrder(2, { x: ox, y: Y, z: oz - 60 });
  globalThis.__profDump?.(true); globalThis.__MC = undefined; globalThis.__PS = undefined; globalThis.__dpReport?.(); globalThis.__evReport?.(1); globalThis.__rdTot = 0; globalThis.__scTot = 0; globalThis.__scN = 0; const t0 = tick(), r0 = Date.now(); let slow = 0, last = Date.now(), worst = 0;
  let mid;
  await kitLoop(Number(o.ticks ?? 600), () => { const now = Date.now(), dt = now - last; last = now; worst = Math.max(worst, dt); if (dt > 600) slow++;
    if (!mid && tick() - t0 > 400) { const sz = allOf(SOLDIER).map((e) => { try { return e.getDynamicPropertyTotalByteCount(); } catch { return 0; } }).sort((a, b) => b - a); const keys = {}; const big = allOf(SOLDIER)[0]; try { for (const k of big.getDynamicPropertyIds()) { const v = big.getDynamicProperty(k); keys[k] = typeof v === "string" ? v.length : 8; } } catch {} mid = { n: sz.length, avg: Math.round(sz.reduce((a, b) => a + b, 0) / Math.max(1, sz.length)), max: sz[0], world: world.getDynamicPropertyTotalByteCount(), wps: allOf(WAYPOINT).length, keys: Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 12) }; }
    return false; });
  const sec = (Date.now() - r0) / 1000, ticks = tick() - t0;
  const MC = globalThis.__MC; if (MC) { globalThis.__MC = undefined; }
  const PS = globalThis.__PS; if (PS) { globalThis.__PS = undefined; }
  return { perc: PS ? Object.fromEntries(Object.entries(PS).map(([k, v]) => [k, +(v / ticks).toFixed(2)])) : undefined, mem: MC ? Object.fromEntries(Object.entries(MC).map(([k, v]) => [k, +(v / ticks).toFixed(0)])) : undefined, load: typeof scriptAvg === "number" ? { scriptAvg: +scriptAvg.toFixed(1), aiLoad: +aiLoad().toFixed(2) } : undefined, prof: globalThis.__profDump?.(false), mid, bodyMsPerTick: +((globalThis.__rdTot + globalThis.__scTot) / Math.max(1, tick() - t0)).toFixed(2), corpses: globalThis.__scN, corpseMsEach: +(globalThis.__scTot / Math.max(1, globalThis.__scN)).toFixed(1), ev: globalThis.__evReport?.(tick() - t0), dp: globalThis.__dpReport?.(), n: N, ticks, realSec: +sec.toFixed(1), tps: +(ticks / sec).toFixed(1), worstGapMs: worst, left1: kitSoldiers(1).filter((e) => !isDown(e)).length, left2: kitSoldiers(2).filter((e) => !isDown(e)).length, ...kitShotStats(t0) };
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
globalThis.__viewers = () => (KIT ? [{ d: "minecraft:overworld", x: KIT.ox + 20 + Number(KIT.view ?? 0), z: KIT.oz }] : []);   // (the test site counts as watched, as a real battle is)
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "war:test") return;
  const [name, ...args] = String(ev.message ?? "").trim().split(/\s+/);
  const o = Object.fromEntries(args.map((a) => a.split("=")));
  if (!KS[name]) { console.warn(`WARTEST {"error":"unknown scenario ${name}"}`); return; }
  (async () => {
    const ox = o.ox !== undefined ? Number(o.ox) : 3000 + (kitSlot++ % 6) * 800, oz = o.oz !== undefined ? Number(o.oz) : 0;   // (ox/oz: somewhere of the test's own choosing, e.g. untouched land)
    KIT = { name, ox, oz, trace: o.trace, dbg: o.dbg }; if (o.trace) globalThis.__planStats = { exp: 0, ms: 0, reads: 0, ticks: 0, done: 0, dropped: 0, doneT: 0 };
    try {
      for (const e of [...allOf(SOLDIER), ...allOf(WAYPOINT), ...allOf(HOUND)]) { try { e.remove(); } catch {} }   // (leftovers of an interrupted run)
      kcmd("tickingarea remove_all"); kcmd("time set noon"); kcmd("gamerule dodaylightcycle false"); await kitWait(40);
       const r = name === "castle" ? [ox - 60, oz - 20, ox + 100, oz + 150] : name === "probe" || name === "rayprobe" ? [ox - 20, oz - 20, ox + 20, oz + 20] : name === "trip" && o.mode === "flat" ? [ox - 60, oz - 330, ox + 60, oz + 20] : name === "big" || name === "loopprof" || name === "load" || name === "dpidle" || name === "dpmove" ? [ox - 60, oz - 90, ox + 60, oz + 90] : [ox - 30, oz - 180, ox + 80, oz + 50];
      // (a ticking area keeps the land loaded and its mobs moving with no player near; at most ~100 chunks each)
      const w = r[2] - r[0], h = r[3] - r[1];
      const parts = Math.max(1, Math.ceil((Math.ceil(w / 16) + 1) * (Math.ceil(h / 16) + 1) / 90));
      for (let k = 0; k < parts; k++) { const z0 = r[1] + Math.floor((h * k) / parts), z1 = r[1] + Math.floor((h * (k + 1)) / parts); kcmd(`tickingarea add ${r[0]} 0 ${z0} ${r[2]} 0 ${z1} kit${k} true`); }
      // wait until every corner of the area is loaded (up to 30 s)
      for (let k = 0; k < 60; k++) { let ok = true; for (const [x, z] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]], [(r[0] + r[2]) >> 1, (r[1] + r[3]) >> 1]]) { try { if (!ow().getBlock({ x, y: Y, z })) ok = false; else { const t = ow().spawnEntity("war:blank", { x: x + 0.5, y: Y + 1, z: z + 0.5 }); t.remove(); } } catch { ok = false; } } if (ok) break; await kitWait(10); }   // (loaded AND ticking: something can be spawned there)
      await kitWait(20);
      globalThis.__v9 = {};
      const res = await KS[name](o, ox, oz);
      const dpSize = {}; try { const sizes = allOf(SOLDIER).map((e) => e.getDynamicPropertyTotalByteCount()); dpSize.soldierAvg = Math.round(sizes.reduce((t, v) => t + v, 0) / Math.max(1, sizes.length)); dpSize.soldierMax = Math.max(0, ...sizes); dpSize.world = world.getDynamicPropertyTotalByteCount(); const big = allOf(SOLDIER)[0]; if (big) dpSize.keys = big.getDynamicPropertyIds().map((k) => `${k}:${String(big.getDynamicProperty(k) ?? "").length}`).sort((x, y) => Number(y.split(":").pop()) - Number(x.split(":").pop())).slice(0, 8); const wk = world.getDynamicPropertyIds().map((k) => `${k}:${String(world.getDynamicProperty(k) ?? "").length}`).sort((x, y) => Number(y.split(":").pop()) - Number(x.split(":").pop())).slice(0, 8); dpSize.worldKeys = wk; } catch (err) { dpSize.err = String(err); }
      console.warn(`WARTEST ${JSON.stringify({ scenario: name, args: o, ...res, v9: globalThis.__v9, dpSize, errors: ERRS.size, errList: [...ERRS].slice(0, 3) })}`);
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
function dpWrap(obj) { const proto = Object.getPrototypeOf(obj), f = proto.setDynamicProperty; if (!f || f.__kit) return; const w = function (k, v) { const ty = this === world ? "W" : String(this.typeId ?? "?").replace("war:", ""); const r = DPSTAT.get(`${ty}/${k}`) ?? { n: 0, b: 0 }; r.n++; r.b += v === undefined ? 0 : typeof v === "string" ? v.length : 8; DPSTAT.set(`${ty}/${k}`, r); return f.call(this, k, v); }; w.__kit = true; proto.setDynamicProperty = w; }
system.runInterval(() => { if (dpWrapped) return; try { dpWrap(world); const s = allOf(SOLDIER)[0] ?? allOf(WAYPOINT)[0]; if (s) { dpWrap(s); dpWrapped = true; } } catch {} }, 20);
globalThis.__dpReport = () => { const a = [...DPSTAT].sort((x, y) => y[1].n - x[1].n).slice(0, 16).map(([k, r]) => `${k}:${r.n}x/${(r.b / 1024).toFixed(0)}KB`); DPSTAT.clear(); return a; };
// entity events (component group swaps) and teleports, counted
const EVSTAT = new Map(); let evWrapped = false;
system.runInterval(() => { if (evWrapped) return; try { const s = allOf(SOLDIER)[0]; if (!s) return; const proto = Object.getPrototypeOf(s); for (const fn of ["triggerEvent", "teleport", "applyImpulse", "clearVelocity", "addTag", "removeTag", "setProperty"]) { const f = proto[fn]; if (!f || f.__kit) continue; const w = function (...a) { let k = fn === "triggerEvent" ? `ev:${String(a[0]).split(":").pop().replace(/[0-9]+$/, "#")}` : fn; if (fn === "teleport") { const ln = (new Error().stack ?? "").split("\n").slice(2, 4).map((x) => (x.match(/main\.js:(\d+)/) ?? [])[1]).join("<"); k = `tp@${ln}${this.typeId === SOLDIER ? "" : ":mk"}`; } EVSTAT.set(k, (EVSTAT.get(k) ?? 0) + 1); return f.apply(this, a); }; w.__kit = true; proto[fn] = w; } evWrapped = true; } catch {} }, 20);
globalThis.__evReport = (ticks) => { const a = [...EVSTAT].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, n]) => `${k}:${(n / Math.max(1, ticks)).toFixed(1)}/t`); EVSTAT.clear(); return a; };
// v9.15: an unhorsed cavalier walks back to his horse; a riderless, ownerless war horse is taken away; MG nests go
KS.horseback = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 60 })) { try { m.remove(); } catch {} }
  const e = kitCav(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "minecraft:horse");
  await kitWait(60);
  const h = world.getEntity(String(gdp(e, "war:mountId") ?? ""));
  const was = !!e.getComponent("minecraft:riding")?.entityRidingOn;
  try { h.getComponent("minecraft:rideable").ejectRider(e); } catch {}
  mountOf.delete(e.id);
  await kitWait(2);
  try { h.teleport({ x: ox + (o.d ?? 20) + 0.5, y: Y, z: oz + 0.5 }); } catch {}
  const trace = [];
  let back;
  for (let k = 0; k < 30; k++) { await kitWait(20); const on = e.getComponent("minecraft:riding")?.entityRidingOn; trace.push(`${Math.round(dist(e.location, h.location))}${on ? "ON" : ""}`); if (on?.id === h.id) { back = k; break; } }
  // a lone horse (no owner): taken away once it's been alone long enough
  const lone = ow().spawnEntity("minecraft:horse", { x: ox - 10.5, y: Y, z: oz + 0.5 }, { spawnEvent: "minecraft:spawn_adult" }); lone.addTag("war_cav");
  const nest = ow().spawnEntity("war:mg_nest", { x: ox - 5.5, y: Y, z: oz - 5.5 });
  await kitWait(620); CAV_LONE.set(lone.id, tick() - 7000); await kitWait(620);
  const r = { wasRiding: was, backAfterSec: back, trace: trace.join(" "), loneGone: !lone.isValid, nestGone: !nest.isValid, ownStays: !!h?.isValid };
  try { e.remove(); h.remove(); } catch {}
  return r;
};
// v9.15: shields: given to swords / spears / crossbows (not guns), a raised one stops blows from the front only;
// shield wall against shooters; the squad's sergeant wears the officer insignia
KS.shields = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  setRelPair(1, 2, "0", false);
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "sword", "hold"), g = kitSoldier(1, { x: ox + 3.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  const b = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 3.5 }, "sword", "hold");
  await kitWait(80);
  const offhand = (e) => { try { return e.runCommand("testfor @s[hasitem={item=shield,location=slot.weapon.offhand}]").successCount > 0; } catch { return "err"; } };
  const has = { sword: offhand(a), rifle: offhand(g) };
  // blows: raised, from in front / from behind
  const hit = (from, raised) => {
    a.teleport({ x: ox + 0.5, y: Y, z: oz + 0.5 }); a.setRotation({ x: 0, y: 0 });                 // (facing +z)
    b.teleport({ x: ox + 0.5, y: Y, z: oz + (from === "front" ? 2.5 : -2.5) });
    setP(a, "war:block", raised); SHIELD_ON.set(a.id, true);
    const h = a.getComponent("minecraft:health"); h.setCurrentValue(h.effectiveMax); const before = h.currentValue;
    a.applyDamage(6, { cause: "entityAttack", damagingEntity: b });
    return Math.round((before - h.currentValue) * 10) / 10;
  };
  const dmg = { frontRaised: hit("front", true), backRaised: hit("back", true), frontRaised2: hit("front", true) };
  for (const e of [a, g, b]) try { e.remove(); } catch {}
  await kitWait(5);
  // the wall: 4 shields + 2 crossbows holding, enemy riflemen 25 blocks off
  setRelPair(1, 2, "1", true);
  const ours = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox - 3 + i * 2 + 0.5, y: Y, z: oz - 2.5 }, "sword", "hold")).concat([0, 1].map((i) => kitSoldier(1, { x: ox - 1 + i * 2 + 0.5, y: Y, z: oz - 5.5 }, "crossbow", "hold")));
  const foes = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 2 + i * 2 + 0.5, y: Y, z: oz + 22.5 }, "rifle", "hold"));
  let walls = 0, raised = 0, maxRaised = 0, officers = new Set(); const zt = [];
  for (let k = 0; k < 30; k++) {
    await kitWait(10);
    const S = squads.get(squadKey(ours[0], sd(ours[0])));
    if (S?.wall) walls++;
    zt.push(ours.slice(0, 4).map((e) => e.isValid ? Math.round(e.location.z - oz) : 'x').join('/') + (S?.wall ? 'W' : ''));
    const r = ours.filter((e) => e.isValid && e.getProperty("war:block")).length; raised += r; maxRaised = Math.max(maxRaised, r);
    for (const e of [...ours, ...foes]) try { if (e.isValid && e.getProperty("war:officer")) officers.add(`${sd(e).faction}:${e.id.slice(-3)}`); } catch {}
  }
  const line = ours.slice(0, 4).filter((e) => e.isValid).map((e) => `${Math.round(e.location.x - ox)},${Math.round(e.location.z - oz)}`);
  return { has, dmg, wallSamples: walls, raisedAvg: Math.round(raised / 30 * 10) / 10, maxRaised, officers: [...officers], line, hits: SHIELD_HIT.size, zt: zt.join(' ') };
};
// v9.15: the bodyguard detail: diamond around the principal, a man between him and a threat, close in when he's hit
KS.guards = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  const pr = ow().spawnEntity("minecraft:armor_stand", { x: ox + 0.5, y: Y, z: oz + 0.5 });
  pr.setRotation({ x: 0, y: 0 });
  globalThis.__fakeLeader = (id) => (id === pr.id ? pr : undefined);
  const gs = [0, 1, 2, 3].map((i) => {
    const e = ow().spawnEntity(SOLDIER, { x: ox + (i - 1.5) * 2 + 0.5, y: Y, z: oz - 4.5 }, { spawnEvent: "war:init" });
    const ne = setupSoldier(e, { faction: 1, squad: 3, weapon: i % 2 ? "sword" : "smg", ranged: i % 2 === 0, div: "guard", radius: 8, func: "__none", owner: pr.id }, KIT_PLAYER) ?? e;
    const x = ne?.isValid ? ne : e; sdp(x, "war:func", "escort"); sdp(x, "war:leader", pr.id); sdDrop(x); return x;
  });
  const rel = () => gs.map((e) => e.isValid ? `${(e.location.x - ox - 0.5).toFixed(1)},${(e.location.z - oz - 0.5).toFixed(1)}` : "x");
  await kitWait(140);
  const calm = rel(), calmNotes = gs.map((e) => notes.get(e.id)?.text ?? "");
  setRelPair(1, 2, "1", true);
  const foe = kitSoldier(2, { x: ox + 12.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  try { foe.addEffect("slowness", 2000, { amplifier: 10, showParticles: false }); } catch {}
  const ct = [];
  for (let k = 0; k < 8; k++) { await kitWait(10); ct.push(gs.map((e) => `${(e.location.x - ox - 0.5).toFixed(0)}:${(notes.get(e.id)?.text ?? "").slice(0, 14)}:${sd(e).weapon}:${(gs.indexOf(e))}`).join("|")); }
  const D = DETAIL.get(pr.id);
  const sh = gs.find((e) => e.id === D?.shieldId);
  const threatX = sh ? (sh.location.x - ox - 0.5).toFixed(1) : "none";
  const contact = rel();
  try { foe.remove(); } catch {}
  OWNER_HURT.set(pr.id, { t: tick(), by: undefined }); DETAIL.delete(pr.id);
  await kitWait(60);
  const tight = gs.filter((e) => e.isValid).map((e) => Math.hypot(e.location.x - ox - 0.5, e.location.z - oz - 0.5).toFixed(1));
  globalThis.__fakeLeader = undefined;
  try { pr.remove(); } catch {}
  return { ct, calm, calmNotes, contact, shieldManX: threatX, detail: D ? { n: D.ids.length, threat: !!D.threat } : null, tightDist: tight };
};
// v9.15: night: muzzle flashes, and a flare that lights the ground and cleans its light up after
KS.flares = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  kcmd("time set midnight"); await kitWait(110);
  setRelPair(1, 2, "1", true);
  const a = [0, 1, 2].map((i) => kitSoldier(1, { x: ox - 2 + i * 2 + 0.5, y: Y, z: oz - 12.5 }, "rifle", "hold"));
  const b = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 2 + i * 2 + 0.5, y: Y, z: oz + 12.5 }, "rifle", "hold"));
  for (const e of [...a, ...b]) try { e.addEffect("resistance", 4000, { amplifier: 255, showParticles: false }); } catch {}
  let peakLights = 0, flares = 0;
  for (let k = 0; k < 60; k++) { await kitWait(20); peakLights = Math.max(peakLights, FLARE_LIGHTS.size); flares = Math.max(flares, FLARES.length); }
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  for (let k = 0; k < 30 && FLARES.length; k++) await kitWait(20);
  let left = 0; for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) for (let y = Y; y < Y + 10; y++) { try { if (ow().getBlock({ x: ox + x, y, z: oz + z })?.typeId.startsWith("minecraft:light_block")) left++; } catch {} }
  kcmd("time set noon");
  return { night: NIGHT, flaresSeen: flares, peakLights, lightsLeft: left, stillTracked: FLARE_LIGHTS.size, perm: lightPerm()?.type?.id };
};
// v9.15.1: the detail keeps up: the principal walks, turns and sprints; how far is each guard from his spot / from him?
KS.guardwalk = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const pr = ow().spawnEntity("minecraft:armor_stand", { x: ox - 20.5, y: Y, z: oz - 20.5 });
  globalThis.__fakeLeader = (id) => (id === pr.id ? pr : undefined);
  const n = o.n ?? 4;
  const gs = [...Array(n).keys()].map((i) => {
    const e = ow().spawnEntity(SOLDIER, { x: ox - 22.5 + i, y: Y, z: oz - 23.5 }, { spawnEvent: "war:init" });
    const ne = setupSoldier(e, { faction: 1, squad: 3, weapon: i % 2 ? "sword" : "smg", ranged: i % 2 === 0, div: "guard", radius: 8, func: "__none", owner: pr.id }, KIT_PLAYER) ?? e;
    const x = ne?.isValid ? ne : e; sdp(x, "war:func", "escort"); sdp(x, "war:leader", pr.id); sdDrop(x); return x;
  });
  await kitWait(100);
  const rows = [];
  const sample = (tag) => {
    const D = DETAIL.get(pr.id);
    const ds = gs.map((e) => Math.hypot(e.location.x - pr.location.x, e.location.z - pr.location.z));
    const off = D ? gs.map((e) => { const sp = detailSpot(e, sd(e), pr, D, tick()); return sp && !sp.engage ? Math.hypot(sp.x - e.location.x, sp.z - e.location.z) : -1; }) : [];
    rows.push(`${tag}:max${Math.max(...ds).toFixed(1)}/off${off.length ? Math.max(...off).toFixed(1) : "?"}`);
    return { maxD: Math.max(...ds), maxOff: Math.max(...off) };
  };
  const stats = { still: sample("still") };
  const legs = [[0.2, 0, 120, "walk"], [0, 0.28, 100, "sprint"], [-0.2, 0.0, 80, "back"]];
  for (const [vx, vz, T, tag] of legs) {
    let worstD = 0, worstOff = 0;
    for (let k = 0; k < T; k++) { const l = pr.location; pr.teleport({ x: l.x + vx, y: Y, z: l.z + vz }); await kitWait(1); if (k % 10 === 9) { const s = sample(tag); if (k > 30) { worstD = Math.max(worstD, s.maxD); worstOff = Math.max(worstOff, s.maxOff); } } }
    stats[tag] = { worstD: +worstD.toFixed(1), worstOff: +worstOff.toFixed(1) };
  }
  await kitWait(60); stats.stopped = sample("stop");
  globalThis.__fakeLeader = undefined; try { pr.remove(); } catch {}
  return { stats, rows: rows.join(" ") };
};
// v9.16: how human do they look? head pitch (|x|: tilted up/down), yaw flicking (turn direction reversing tick to tick),
// and stop-go (velocity reversing), idle, in a skirmish, and on a guard detail
KS.jitter = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const meas = async (list, T) => {
    const last = new Map(); let n = 0, pitchSum = 0, pitchMax = 0, steep = 0, flick = 0, turns = 0, rev = 0, moves = 0;
    for (let k = 0; k < T; k++) {
      await kitWait(1);
      for (const e of list) {
        if (!e.isValid) continue;
        const r = e.getRotation(), v = e.getVelocity(), L = last.get(e.id);
        const px = Math.abs(r.x); n++; pitchSum += px; pitchMax = Math.max(pitchMax, px); if (px > 25) steep++;
        if (L) {
          const dy = ((r.y - L.y + 540) % 360) - 180;
          if (Math.abs(dy) > 2) { turns++; if (L.dy && Math.sign(dy) !== Math.sign(L.dy) && Math.abs(L.dy) > 2) flick++; }
          const sp = Math.hypot(v.x, v.z), lsp = Math.hypot(L.v.x, L.v.z);
          if (sp > 0.03 && lsp > 0.03) { moves++; if ((v.x * L.v.x + v.z * L.v.z) / (sp * lsp) < -0.3) rev++; }
          last.set(e.id, { y: r.y, dy: Math.abs(dy) > 2 ? dy : L.dy, v });
        } else last.set(e.id, { y: r.y, dy: 0, v });
      }
    }
    return { pitchAvg: +(pitchSum / Math.max(1, n)).toFixed(1), pitchMax: Math.round(pitchMax), steepPct: +(100 * steep / Math.max(1, n)).toFixed(1), flicksPerTurn: +(flick / Math.max(1, turns)).toFixed(2), turnPct: +(100 * turns / Math.max(1, n)).toFixed(1), reversePct: +(100 * rev / Math.max(1, moves)).toFixed(1) };
  };
  const res = {};
  // idle
  const idle = [...Array(8).keys()].map((i) => kitSoldier(1, { x: ox - 8 + i * 2 + 0.5, y: Y, z: oz - 30.5 }, i % 2 ? "rifle" : "sword", "hold"));
  await kitWait(60); res.idle = await meas(idle, 200);
  for (const e of idle) try { e.remove(); } catch {}
  // skirmish
  setRelPair(1, 2, "1", true);
  const a = [...Array(5).keys()].map((i) => kitSoldier(1, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz - 14.5 }, i % 2 ? "rifle" : "smg", "hold"));
  const b = [...Array(5).keys()].map((i) => kitSoldier(2, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz + 14.5 }, i % 2 ? "rifle" : "smg", "hold"));
  for (const e of [...a, ...b]) try { e.addEffect("resistance", 2000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(40); res.fight = await meas([...a, ...b], 300);
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  // guard detail around a walking principal
  const pr = ow().spawnEntity("minecraft:armor_stand", { x: ox + 20.5, y: Y, z: oz - 20.5 });
  globalThis.__fakeLeader = (id) => (id === pr.id ? pr : undefined);
  const gs = [0, 1, 2, 3].map((i) => { const e = ow().spawnEntity(SOLDIER, { x: ox + 18.5 + i, y: Y, z: oz - 23.5 }, { spawnEvent: "war:init" }); const ne = setupSoldier(e, { faction: 1, squad: 3, weapon: i % 2 ? "sword" : "smg", ranged: i % 2 === 0, div: "guard", radius: 8, func: "__none", owner: pr.id }, KIT_PLAYER) ?? e; const x = ne?.isValid ? ne : e; sdp(x, "war:func", "escort"); sdp(x, "war:leader", pr.id); sdDrop(x); return x; });
  await kitWait(80);
  const walker = (async () => { for (let k = 0; k < 200; k++) { const l = pr.location; pr.teleport({ x: l.x + (k < 100 ? 0 : -0.2), y: Y, z: l.z + (k < 100 ? 0.2 : 0) }); await kitWait(1); } })();
  res.detail = await meas(gs, 200); await walker;
  globalThis.__fakeLeader = undefined; try { pr.remove(); } catch {}
  return res;
};
KS.yawtrace = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const idle = [kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 30.5 }, "sword", "hold"), kitSoldier(1, { x: ox + 3.5, y: Y, z: oz - 30.5 }, "rifle", "hold")];
  setRelPair(1, 2, "1", true);
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 14.5 }, "rifle", "hold"), b = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 14.5 }, "rifle", "hold");
  for (const e of [a, b]) try { e.addEffect("resistance", 2000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(60);
  const tr = { idleS: [], idleR: [], fight: [] };
  for (let k = 0; k < 120; k++) {
    await kitWait(1);
    const f = (e) => { const r = e.getRotation(); return `${Math.round(r.y)}/${Math.round(r.x)}`; };
    tr.idleS.push(f(idle[0])); tr.idleR.push(f(idle[1])); tr.fight.push(f(a) + (notes.get(a.id)?.text ?? "").slice(0, 6));
  }
  const pitchy = []; for (const e of idle) pitchy.push(`${sd(e).weapon}:${notes.get(e.id)?.text}`);
  return { idleS: tr.idleS.join(" "), idleR: tr.idleR.join(" "), fight: tr.fight.slice(0, 80).join(" "), pitchy };
};
KS.nod = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const res = {};
  for (const [tag, war, w] of [["swordPeace", false, "sword"], ["swordWar", true, "sword"], ["crossWar", true, "crossbow"], ["swordWarNoMk", true, "sword"]]) {
    setRelPair(1, 2, war ? "1" : "0", war);
    const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 30.5 }, w, "hold");
    const f = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 14.5 }, "rifle", "post");
    try { f.addEffect("resistance", 2000, { amplifier: 255, showParticles: false }); f.addEffect("slowness", 2000, { amplifier: 255, showParticles: false }); } catch {}
    await kitWait(40);
    let spikes = 0; const at = [];
    for (let k = 0; k < 160; k++) {
      if (tag === "swordWarNoMk") { sdp(e, "war:goal", 0); }
      await kitWait(1);
      const x = e.getRotation().x;
      if (Math.abs(x) > 25) { spikes++; if (at.length < 4) at.push(`${Math.round(x)}:${getJSON(e, "war:st", {}).g}/${getJSON(e, "war:st", {}).t}/${getJSON(e, "war:st", {}).w}:${notes.get(e.id)?.text}`); }
    }
    res[tag] = { spikes, at };
    for (const x of [e, f]) try { x.remove(); } catch {}
    await kitWait(5);
  }
  return res;
};
KS.nod2 = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "0", false);
  const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 30.5 }, "sword", "hold");
  await kitWait(40);
  const proto = Object.getPrototypeOf(e), calls = [];
  const wrap = (name) => { const orig = proto[name]; proto[name] = function (...a) { if (this.id === e.id) calls.push({ t: tick(), name, arg: JSON.stringify(a).slice(0, 80), st: String(new Error().stack).split("\n").slice(2, 4).map((s) => s.trim().slice(0, 60)).join(" < ") }); return orig.apply(this, a); }; return () => { proto[name] = orig; }; };
  const un = ["setRotation", "teleport", "applyImpulse", "triggerEvent", "clearVelocity", "applyKnockback"].map(wrap);
  const spikes = [];
  let prev = 0;
  for (let k = 0; k < 160; k++) { await kitWait(1); const x = e.getRotation().x; if (Math.abs(x) > 25 && Math.abs(prev) <= 25) spikes.push(tick()); prev = x; }
  un.forEach((f) => f());
  const near = spikes.slice(0, 3).map((t) => ({ t, calls: calls.filter((c) => c.t >= t - 3 && c.t <= t).map((c) => `${c.t - t}:${c.name}${c.arg}@${c.st}`) }));
  const kinds = {}; for (const c of calls) kinds[c.name] = (kinds[c.name] ?? 0) + 1;
  return { spikes: spikes.length, kinds, near };
};
KS.nod3 = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "0", false);
  const res = {};
  const variants = [["base", {}], ["w_none", { w: "w_none" }], ["w_ranged", { w: "w_ranged" }], ["t_mid", { t: "t_mid" }], ["g_none", { g: "g_none" }], ["g_post", { g: "g_post" }], ["noShield", {}]];
  for (const [tag, gr] of variants) {
    const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 30.5 }, "sword", "hold");
    await kitWait(30);
    if (tag === "noShield") { SHIELD_ON.set(e.id, false); e.runCommand("replaceitem entity @s slot.weapon.offhand 0 air"); }
    let spikes = 0, prev = 0;
    for (let k = 0; k < 160; k++) { if (Object.keys(gr).length) { const st = getJSON(e, "war:st", {}); for (const [kk, v] of Object.entries(gr)) if (st[kk] !== v) setGroups(e, { [kk]: v }); } await kitWait(1); const x = e.getRotation().x; if (Math.abs(x) > 25 && Math.abs(prev) <= 25) spikes++; prev = x; }
    res[tag] = spikes; try { e.remove(); } catch {} await kitWait(3);
  }
  return res;
};
KS.flick = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "1", true);
  const a = [...Array(5).keys()].map((i) => kitSoldier(1, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz - 14.5 }, ["rifle", "smg", "sword", "crossbow", "rifle"][i], "hold"));
  const b = [...Array(5).keys()].map((i) => kitSoldier(2, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz + 14.5 }, ["rifle", "smg", "sword", "crossbow", "rifle"][i], "hold"));
  const all = [...a, ...b];
  for (const e of all) try { e.addEffect("resistance", 2000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(40);
  const st = new Map(all.map((e) => [e.id, { last: e.getRotation().y, ldy: 0, fl: 0, tr: [], notes: new Set(), pitch: 0 }]));
  for (let k = 0; k < 200; k++) {
    await kitWait(1);
    for (const e of all) {
      if (!e.isValid) continue;
      const s = st.get(e.id), r = e.getRotation(), dy = ((r.y - s.last + 540) % 360) - 180;
      if (Math.abs(dy) > 2) { if (s.ldy && Math.sign(dy) !== Math.sign(s.ldy)) s.fl++; s.ldy = dy; }
      s.last = r.y; s.pitch = Math.max(s.pitch, Math.abs(r.x));
      if (k < 60) s.tr.push(Math.round(r.y)); s.notes.add(notes.get(e.id)?.text ?? "-");
    }
  }
  return { rows: all.map((e) => { const s = st.get(e.id); return `${sd(e).faction}${sd(e).weapon}: flicks ${s.fl} pitchMax ${Math.round(s.pitch)} | ${[...s.notes].slice(0, 4).join(",")} | ${s.tr.join(" ")}`; }) };
};
KS.flick2 = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "1", true);
  const a = [...Array(3).keys()].map((i) => kitSoldier(1, { x: ox - 3 + i * 3 + 0.5, y: Y, z: oz - 14.5 }, o.w ?? "smg", "hold"));
  const b = [...Array(3).keys()].map((i) => kitSoldier(2, { x: ox - 3 + i * 3 + 0.5, y: Y, z: oz + 14.5 }, "rifle", "hold"));
  for (const e of [...a, ...b]) try { e.addEffect("resistance", 2000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(40);
  const e = a[1], proto = Object.getPrototypeOf(e), calls = [];
  const wrap = (name) => { const orig = proto[name]; proto[name] = function (...x) { if (this.id === e.id) calls.push(`${tick()}:${name}${JSON.stringify(x[name === "teleport" ? 1 : 0] ?? {}).slice(0, 40)}@${String(new Error().stack).split("\n").slice(2, 3).map((s) => s.trim().replace(/.*main\.js:/, "L").slice(0, 20)).join("")}`); return orig.apply(this, x); }; return () => { proto[name] = orig; }; };
  const un = ["setRotation", "teleport"].map(wrap);
  const tr = [];
  for (let k = 0; k < 80; k++) { await kitWait(1); tr.push(`${tick()}:${Math.round(e.getRotation().y)}`); }
  un.forEach((f) => f());
  return { tr: tr.join(" "), calls: calls.slice(0, 60) };
};
KS.tswitch = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "1", true);
  const a = [...Array(5).keys()].map((i) => kitSoldier(1, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz - 14.5 }, i % 2 ? "smg" : "rifle", "hold"));
  const b = [...Array(5).keys()].map((i) => kitSoldier(2, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz + 14.5 }, i % 2 ? "smg" : "rifle", "hold"));
  const all = [...a, ...b];
  for (const e of all) try { e.addEffect("resistance", 2000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(40);
  const last = new Map(), sw = new Map(), pth = new Map(), psw = new Map(), seq = new Map();
  for (let k = 0; k < 300; k++) {
    await kitWait(1);
    for (const e of all) {
      const g = gunState.get(e.id)?.target?.id, p = perc.get(e.id)?.threat?.id;
      if (last.has(e.id) && last.get(e.id) !== g) { sw.set(e.id, (sw.get(e.id) ?? 0) + 1); const s = seq.get(e.id) ?? []; s.push(`${k}:${g ? g.slice(-3) : "-"}`); seq.set(e.id, s); }
      if (pth.has(e.id) && pth.get(e.id) !== p) psw.set(e.id, (psw.get(e.id) ?? 0) + 1);
      last.set(e.id, g); pth.set(e.id, p);
    }
  }
  return { gunSwitchesPer15s: all.map((e) => sw.get(e.id) ?? 0), threatSwitches: all.map((e) => psw.get(e.id) ?? 0), seq: all.slice(0, 3).map((e) => (seq.get(e.id) ?? []).join(" ")) };
};
KS.marchpitch = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 80, ox + 30, oz + 30);
  const men = [...Array(8).keys()].map((i) => kitSoldier(1, { x: ox - 4 + i + 0.5, y: Y, z: oz + 20.5 }, i % 2 ? "sword" : "rifle", "hold"));
  await kitWait(20);
  await kitOrder(1, { x: ox + 0.5, y: Y, z: oz - 60.5 }, "hold");
  let n = 0, sum = 0, mx = 0, steep = 0;
  for (let k = 0; k < 400; k++) { await kitWait(1); for (const e of men) { if (!e.isValid) continue; const x = Math.abs(e.getRotation().x); n++; sum += x; mx = Math.max(mx, x); if (x > 20) steep++; } }
  return { pitchAvg: +(sum / n).toFixed(1), pitchMax: Math.round(mx), steepPct: +(100 * steep / n).toFixed(1), moved: men.map((e) => Math.round(oz + 20.5 - e.location.z)) };
};
// v9.17: mounts face where they go; a rider killed in the saddle falls cleanly
KS.cavface = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  for (const t of ["minecraft:horse", "minecraft:camel", "minecraft:donkey"]) for (const m of ow().getEntities({ type: t, location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
  setRelPair(1, 2, "1", true);
  const riders = [["rifle", "minecraft:horse"], ["sword", "minecraft:horse"], ["smg", "minecraft:camel"], ["spear", "minecraft:donkey"]].map(([w, m], i) => kitCav(1, { x: ox - 25.5, y: Y, z: oz - 6 + i * 4 + 0.5 }, w, m));
  const foes = [0, 1, 2].map((i) => kitSoldier(2, { x: ox + 15.5, y: Y, z: oz - 4 + i * 4 + 0.5 }, "rifle", "hold"));
  for (const e of [...riders, ...foes]) try { e.addEffect("resistance", 3000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(60);
  let n = 0, side = 0, sum = 0, hops = 0, ticks = 0; const per = {};
  const lastVy = new Map();
  for (let k = 0; k < 300; k++) {
    await kitWait(1);
    for (const e of riders) {
      const m = e.isValid ? e.getComponent("minecraft:riding")?.entityRidingOn : undefined; if (!m) continue;
      const v = m.getVelocity(), sp = Math.hypot(v.x, v.z); ticks++;
      if (v.y > 0.25 && (lastVy.get(m.id) ?? 0) <= 0.25) hops++; lastVy.set(m.id, v.y);
      if (sp < 0.1) continue;
      const yaw = m.getRotation().y * Math.PI / 180, fx = -Math.sin(yaw), fz = Math.cos(yaw);
      const ang = Math.acos(Math.max(-1, Math.min(1, (fx * v.x + fz * v.z) / sp))) * 180 / Math.PI;
      n++; sum += ang; if (ang > 30) side++;
      const t = m.typeId.split(":")[1]; per[t] = per[t] ?? { n: 0, side: 0 }; per[t].n++; if (ang > 30) per[t].side++;
    }
  }
  const res = { movingSamples: n, avgAngle: +(sum / Math.max(1, n)).toFixed(1), sidewaysPct: +(100 * side / Math.max(1, n)).toFixed(1), hopsPerMin: +(hops / Math.max(1, ticks) * 1200).toFixed(1), per };
  // kill one rider at a gallop: trace his body
  const r = riders.find((e) => e.isValid && e.getComponent("minecraft:riding")?.entityRidingOn);
  if (r) {
    const m = r.getComponent("minecraft:riding").entityRidingOn, mv = m.getVelocity();
    const before = new Set(ow().getEntities({ type: "war:corpse" }).map((c) => c.id));
    r.removeEffect("resistance"); killHow.set(r.id, { limb: 0, dir: { x: 1, y: 0, z: 0 }, power: 0.3 }); killReal(r);
    await kitWait(3);
    const c = ow().getEntities({ type: "war:corpse" }).find((q) => !before.has(q.id));
    const tr = []; let ups = 0, py;
    for (let k = 0; k < 50 && c?.isValid; k++) { const y = c.location.y; if (py !== undefined && y > py + 0.04) ups++; py = y; if (k % 3 === 0) tr.push((y - Y).toFixed(2)); await kitWait(1); }
    res.riderDeath = { horseSpeed: +Math.hypot(mv.x, mv.z).toFixed(2), corpse: !!c, bounces: ups, hipY: tr.join(" ") };
  }
  return res;
};
KS.horsetrace = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
  setRelPair(1, 2, "1", true);
  const r = kitCav(1, { x: ox - 25.5, y: Y, z: oz + 0.5 }, o.w ?? "rifle", "minecraft:horse");
  const foes = [0, 1].map((i) => kitSoldier(2, { x: ox + 15.5, y: Y, z: oz - 2 + i * 4 + 0.5 }, "rifle", "hold"));
  for (const e of [r, ...foes]) try { e.addEffect("resistance", 3000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(60);
  const tr = [];
  for (let k = 0; k < 80; k++) {
    await kitWait(1);
    const m = r.getComponent("minecraft:riding")?.entityRidingOn; if (!m) { tr.push("off"); continue; }
    const v = m.getVelocity(), sp = Math.hypot(v.x, v.z), vy = sp > 0.03 ? Math.round(Math.atan2(-v.x, v.z) * 180 / Math.PI) : "-";
    tr.push(`h${Math.round(m.getRotation().y)}/s${Math.round(MOUNT_HEAD.get(m.id) ?? 999)}/r${Math.round(r.getRotation().y)}/v${vy}`);
  }
  return { tr: tr.join(" ") };
};
KS.falltime = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const cases = [["noDir", undefined], ["weak", { dir: { x: 1, y: 0, z: 0 }, power: 0.12 }], ["rifle", { dir: { x: 0, y: 0, z: 1 }, power: 0.3 }], ["head", { dir: { x: -1, y: 0, z: 0 }, power: 0.25, head: true }]];
  const out = {};
  for (const [tag, how] of cases) {
    const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
    await kitWait(20);
    if (how) killHow.set(e.id, { limb: 0, ...how });
    const before = new Set(ow().getEntities({ type: "war:corpse" }).map((c) => c.id));
    killReal(e);
    let c, t = 0, headDown, hipDown;
    for (; t < 80; t++) {
      await kitWait(1);
      c = c ?? ow().getEntities({ type: "war:corpse" }).find((q) => !before.has(q.id) && !q.getProperty("war:gib"));
      const s = c ? RD.get(c.id) : undefined; if (!s) continue;
      const hip = (s.pts[0].p.y + s.pts[1].p.y) / 2 - Y, head = s.pts[4].p.y - Y;
      if (hipDown === undefined && hip < 0.45) hipDown = t;
      if (headDown === undefined && head < 0.6) headDown = t;
      if (hipDown !== undefined && headDown !== undefined) break;
    }
    out[tag] = { hipDownTick: hipDown, headDownTick: headDown };
    for (const q of ow().getEntities({ type: "war:corpse" })) try { q.remove(); } catch {}
    RD.clear(); await kitWait(5);
  }
  return out;
};
KS.ridedown = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
  setRelPair(1, 2, "1", true);
  const r = kitCav(1, { x: ox - 15.5, y: Y, z: oz + 0.5 }, "rifle", "minecraft:horse");
  const foe = kitSoldier(2, { x: ox + 15.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); foe.addEffect("resistance", 3000, { amplifier: 255, showParticles: false });
  await kitWait(80);
  const h = r.getComponent("minecraft:riding")?.entityRidingOn;
  const hp = r.getComponent("minecraft:health"); hp.setCurrentValue(2);
  r.applyDamage(6);                                              // (goes down wounded, thrown from the saddle)
  const tr = []; let jumps = 0, last;
  for (let k = 0; k < 160; k++) {
    await kitWait(1);
    if (!r.isValid) { tr.push("x"); break; }
    const l = r.location, hide = r.getProperty("war:hide");
    if (last && !hide && Math.hypot(l.x - last.x, l.z - last.z, l.y - last.y) > 0.25) jumps++;
    if (!hide) last = { ...l };
    if (k < 40) tr.push(`${k}:hp${r.getComponent("minecraft:health")?.currentValue}/${r.getComponent("minecraft:riding") ? "R" : "-"}/${dying.has(r.id) ? "D" : ""}${downed.has(r.id) ? "W" : ""}`);
    else if (k % 8 === 0) tr.push(`${hide ? "H" : ""}${(l.x - ox).toFixed(1)},${(l.y - Y).toFixed(1)}${h?.isValid ? "|h" + dist(h.location, l).toFixed(1) : ""}`);
  }
  return { downed: downed.has(r.id), jumpsWhileLying: jumps, tr: tr.join(" ") };
};
KS.ridekill = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  setRelPair(1, 2, "1", true);
  const r = kitCav(1, { x: ox - 15.5, y: Y, z: oz + 0.5 }, "rifle", "minecraft:horse");
  const foe = kitSoldier(2, { x: ox + 15.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); foe.addEffect("resistance", 3000, { amplifier: 255, showParticles: false });
  await kitWait(80);
  const tr = [];
  if (o.mode === "down") { r.getComponent("minecraft:health").setCurrentValue(3); preHp(r); r.applyDamage(5); }
  else if (o.mode === "one") { r.getComponent("minecraft:health").setCurrentValue(2); await kitWait(15); killHow.set(r.id, { limb: 0, dir: { x: 1, y: 0, z: 0 }, power: 0.3 }); const keep = Math.random; Math.random = () => 0.0; preHp(r); r.applyDamage(30); Math.random = keep; }
  else { preHp(r); r.applyDamage(60); }
  for (let k = 0; k < 40; k++) {
    await kitWait(1);
    const c = ow().getEntities({ type: "war:corpse" }).length;
    tr.push(`${k}:${r.isValid ? "v" : "-"}${r.isValid && r.getComponent("minecraft:riding") ? "R" : ""}${r.isValid && downed.has(r.id) ? "W" : ""}${r.isValid && r.getProperty("war:hide") ? "H" : ""}c${c}`);
  }
  return { tr: tr.join(" ") };
};
// v9.18: names and ranks in the faction's language, buddies, experience, medals, grudges
KS.identity = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  const keep = getJSON(world, "war:vlang", {});
  setJSON(world, "war:vlang", { ...keep, 1: "german", 2: "korean" });
  setRelPair(1, 2, "1", true);
  const a = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox - 3 + i * 2 + 0.5, y: Y, z: oz - 12.5 }, "rifle", "hold"));
  const b = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 2 + i * 2 + 0.5, y: Y, z: oz + 12.5 }, "smg", "hold"));
  for (const e of a) try { e.addEffect("resistance", 4000, { amplifier: 255, showParticles: false }); } catch {}
  await kitWait(40);
  for (const e of [...a, ...b]) updateName(e);
  const names = [...a, ...b].map((e) => strip(e.nameTag).split("\n")[0]);
  await kitWait(260);
  const buddies = a.map((e) => { const x = gdp(e, "war:buddy"); return x ? a.findIndex((q) => q.id === x) : -1; });
  let left = b.filter((e) => e.isValid).length, t = 0;
  for (; t < 60 && left; t++) { await kitWait(20); left = b.filter((e) => e.isValid && !downed.has(e.id)).length; for (const e of b) if (e.isValid && downed.has(e.id)) killReal(e); }
  await kitWait(80);
  const after = a.map((e) => ({ name: soldierName(e), xp: xpOf(e), vet: e.getProperty("war:vet"), medals: e.getProperty("war:medals"), trait: traitOf(e) }));
  // the other language: switch faction 1 to Haitian Creole and look again
  setJSON(world, "war:vlang", { ...keep, 1: "haitian", 2: "korean" });
  const haitian = a.map((e) => soldierName(e));
  setJSON(world, "war:vlang", keep);
  return { names, buddies, enemiesLeft: left, after, haitian };
};
// v9.19: reactions, limping, cowering, rout and rally, white flag, grenade thrown back
KS.human = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  setRelPair(1, 2, "0", false);
  const r = {};
  // leg hit -> stagger + limp; arm/body -> flinch
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), sh = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 8.5 }, "rifle", "hold");
  await kitWait(20);
  lastHit.set(a.id, { t: tick(), leg: true, head: false, dir: { x: 0, y: 0, z: -1 }, by: sh.id }); a.applyDamage(3);
  await kitWait(2); r.legReact = a.getProperty("war:react"); await kitWait(25); r.limp = a.getProperty("war:limp"); r.reactAfter = a.getProperty("war:react");
  // pinned: cowers
  suppB.set(a.id, 25); await kitWait(25); r.cowerPose = a.getProperty("war:pose"); suppB.delete(a.id);
  // surrender: hands up, kneeling
  surrender(a, 2); await kitWait(25); r.hands = a.getProperty("war:hands"); r.surrPose = a.getProperty("war:pose");
  resume(a); await kitWait(3); r.handsAfter = a.getProperty("war:hands");
  for (const e of [a, sh]) try { e.remove(); } catch {}
  // grenade thrown back (forced chance)
  setRelPair(1, 2, "1", true);
  const thrower = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 14.5 }, "rifle", "hold"), vet = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  Object.assign(idRec(vet), { x: 30, t: "brave" }); idSave(vet, idRec(vet));
  await kitWait(10);
  const G = { dim: ow(), at: { x: ox + 1.5, y: Y, z: oz + 0.5 }, boom: tick() + 40, by: thrower }; liveNades.push(G);
  const keep = Math.random; Math.random = () => 0.01; await kitWait(20); Math.random = keep;
  r.thrownBack = !!G.back; r.nadeNow = G.at ? Math.round(dist(G.at, thrower.location)) : -1;
  await kitWait(40);
  for (const e of [thrower, vet]) try { e.remove(); } catch {}
  return r;
};
KS.rout = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "1", true);
  const a = [...Array(6).keys()].map((i) => { const e = kitSoldier(1, { x: ox - 6 + i * 2 + 0.5, y: Y, z: oz - 10.5 }, "rifle", "hold"); Object.assign(idRec(e), { t: "steady" }); return e; });
  const b = [...Array(12).keys()].map((i) => kitSoldier(2, { x: ox - 12 + i * 2 + 0.5, y: Y, z: oz + 14.5 }, i % 2 ? "smg" : "rifle", "hold"));
  for (const e of b) try { e.addEffect("resistance", 4000, { amplifier: 3, showParticles: false }); } catch {}
  let shakenMax = 0;
  const tr = [];
  for (let k = 0; k < 45; k++) { await kitWait(20); shakenMax = Math.max(shakenMax, a.filter((e) => e.isValid && shaken.has(e.id)).length); const q = a.find((e) => e.isValid); const S = q ? squads.get(squadKey(q, sd(q))) : undefined; if (S && k % 3 === 0) tr.push(`${a.filter((e) => e.isValid && !downed.has(e.id)).length}/${S.startN}/${S.ratio?.toFixed?.(2)}/${S.known?.size}/${S.contactT >= 0 ? "c" : "-"}${S.routT ? "R" : ""}`); }
  return { tr: tr.join(" "), shakenMax, surrendered: a.filter((e) => e.isValid && sd(e).surr).length, alive: a.filter((e) => e.isValid).length };
};
// v9.20: ammo runs out and is shared; a scout goes ahead and reports when back; a tripwire inside a door
KS.tactics = async (o, ox, oz) => {
  floorAt(ox - 50, oz - 50, ox + 50, oz + 50);
  const r = {};
  // ammo: a rifleman with 2 rounds left fires, runs dry, a squad mate shares
  setRelPair(1, 2, "1", true);
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 10.5 }, "rifle", "hold"), mate = kitSoldier(1, { x: ox + 3.5, y: Y, z: oz - 10.5 }, "rifle", "hold");
  const tgt = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 14.5 }, "rifle", "hold");
  for (const e of [a, mate, tgt]) try { e.addEffect("resistance", 3000, { amplifier: 255, showParticles: false }); } catch {}
  RESERVE.set(a.id, 2); RESERVE.set(mate.id, 0);
  let dry = -1; for (let k = 0; k < 30; k++) { await kitWait(10); if (OUT_OF.has(a.id) && dry < 0) dry = k; }
  r.ranDry = dry >= 0; r.bayonet = getJSON(a, "war:st", {}).w;
  RESERVE.set(mate.id, 50); await kitWait(80); r.shared = !OUT_OF.has(a.id); r.reserveAfter = RESERVE.get(a.id);
  for (const e of [a, mate, tgt]) try { e.remove(); } catch {}
  // scout: a patrolling squad, enemy 45 blocks ahead behind a wall
  setRelPair(1, 2, "1", true);
  const sq = [0, 1, 2, 3, 4].map((i) => kitSoldier(1, { x: ox - 4 + i * 2 + 0.5, y: Y, z: oz - 40.5 }, "rifle", "hold"));
  const en = [0, 1].map((i) => kitSoldier(2, { x: ox - 1 + i * 2 + 0.5, y: Y, z: oz + 30.5 }, "rifle", "post"));
  await kitWait(20);
  await kitOrder(1, { x: ox + 0.5, y: Y, z: oz + 25.5 }, "hold");
  const S0 = () => squads.get(squadKey(sq[0], sd(sq[0])));
  const trace = [];
  for (let k = 0; k < 30; k++) { await kitWait(20); const sc = [...SCOUTS.entries()][0]; trace.push(`${sc ? sc[1].phase[0] + sc[1].intel.size : "-"}/${S0()?.known?.size ?? 0}`); }
  r.scout = trace.join(" ");
  for (const e of [...sq, ...en]) try { e.remove(); } catch {}
  return r;
};
KS.trap = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  // a small house: stone walls, roof, an oak door on the south side
  kcmd(`fill ${ox - 3} ${Y} ${oz - 3} ${ox + 3} ${Y + 3} ${oz + 3} stone_bricks`); kcmd(`fill ${ox - 2} ${Y} ${oz - 2} ${ox + 2} ${Y + 2} ${oz + 2} air`);
  kcmd(`setblock ${ox} ${Y} ${oz + 3} wooden_door ["direction"=1]`); kcmd(`setblock ${ox} ${Y + 1} ${oz + 3} wooden_door ["direction"=1,"upper_block_bit"=true]`);
  await kitWait(5);
  setRelPair(1, 2, "1", true);
  const d = [0, 1, 2].map((i) => kitSoldier(1, { x: ox - 1 + i + 0.5, y: Y, z: oz - 1.5 }, "rifle", "hold"));
  await kitWait(220);
  const S = squads.get(squadKey(d[0], sd(d[0])));
  const dbg = { wire: wirePerm()?.type?.id ?? String(wirePerm()), squad: !!S, n: S?.ours?.length, known: S?.known?.size, trapT: S?.trapT, indoors: d.map((e) => isIndoors(e)), func: sd(d[0]).func, door: ow().getBlock({ x: ox, y: Y, z: oz + 3 })?.typeId };
  const set = TRAPS.length, at = TRAPS[0]?.at;
  let block; try { block = at ? ow().getBlock(at).typeId : undefined; } catch {}
  // an enemy walks in
  const en = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 6.5 }, "sword", "hold");
  const keep = Math.random; Math.random = () => 0.99;
  if (at) en.teleport({ x: at.x + 0.5, y: at.y, z: at.z + 0.5 });
  await kitWait(10); Math.random = keep;
  const r = { dbg, trapsSet: set, block, left: TRAPS.length };
  let after; try { after = at ? ow().getBlock(at).typeId : undefined; } catch {}
  r.afterBlock = after; r.wallsIntact = ow().getBlock({ x: ox, y: Y + 2, z: oz + 3 })?.typeId;
  for (const e of [...d, en]) try { e.remove(); } catch {}
  kcmd(`fill ${ox - 3} ${Y} ${oz - 3} ${ox + 3} ${Y + 3} ${oz + 3} air`);
  return r;
};
KS.ammo = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  setRelPair(1, 2, "0", false);
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "smg", "hold"), b = kitSoldier(1, { x: ox + 4.5, y: Y, z: oz + 0.5 }, "smg", "hold");
  await kitWait(10);
  const st = { ammo: 0, next: 0 }, spec = GUN_SPEC.smg;
  RESERVE.set(a.id, 25); const r1 = reloadGun(a, st, spec), loaded1 = st.ammo, left1 = RESERVE.get(a.id);
  const r2 = reloadGun(a, st, spec), loaded2 = st.ammo;
  const r3 = reloadGun(a, st, spec), out = OUT_OF.has(a.id);
  await kitWait(25); const w = getJSON(a, "war:st", {}).w;
  RESERVE.set(b.id, 100); await kitWait(90);
  const r = { r1, loaded1, left1, r2, loaded2, r3, out, bayonet: w, sharedTo: RESERVE.get(a.id), mateLeft: RESERVE.get(b.id), outAfter: OUT_OF.has(a.id) };
  for (const e of [a, b]) try { e.remove(); } catch {}
  return r;
};
// v9.21: sleeping and the watch at night (and waking on contact); bodies cleared gracefully; undo; a reinforcement wave
KS.worldlife = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const r = {};
  setRelPair(1, 2, "1", true);
  kcmd("time set midnight"); await kitWait(110);
  const sq = [0, 1, 2, 3, 4, 5].map((i) => kitSoldier(1, { x: ox - 5 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  for (const e of sq) sdp(e, "war:ordt", -999999);
  await kitWait(500);
  r.night = NIGHT; r.asleep = sq.filter((e) => SLEEP.has(e.id)).length; r.watch = [...(WATCH.values())].map((w) => w.ids.size);
  r.sleepProp = sq.filter((e) => e.getProperty("war:sleep")).length;
  r.gunHidden = sq.filter((e) => SLEEP.has(e.id) && !e.getProperty("war:gun")).length;
  const en = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 25.5 }, "rifle", "hold"); en.addEffect("resistance", 2000, { amplifier: 255, showParticles: false });
  for (const e of sq) e.addEffect("resistance", 2000, { amplifier: 255, showParticles: false });
  await kitWait(80); r.asleepAfterContact = sq.filter((e) => SLEEP.has(e.id)).length;
  try { en.remove(); } catch {}
  kcmd("time set noon"); await kitWait(110);
  // undo: an order, then undo it
  snapUndo(KIT_PLAYER, sq); const before = sq.map((e) => sd(e).func);
  await kitOrder(1, { x: ox + 0.5, y: Y, z: oz + 30.5 }, "hold"); await kitWait(40);
  const moved = sq.filter((e) => gdp(e, "war:catchup") !== undefined || sd(e).func === "charge").length;
  UNDO.set(KIT_PLAYER.id, UNDO.get(KIT_PLAYER.id)); undoOrder(KIT_PLAYER); await kitWait(10);
  r.undo = { before: before[0], movedByOrder: moved, after: sd(sq[0]).func, catchupAfter: sq.filter((e) => gdp(e, "war:catchup") !== undefined).length };
  for (const e of sq) try { e.remove(); } catch {}
  // bodies: 40 men killed in front of nobody: at most ~32 stay
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} } CORPSES.length = 0; RD.clear();
  const many = [...Array(40).keys()].map((i) => kitSoldier(1, { x: ox - 20 + (i % 10) * 4 + 0.5, y: Y, z: oz - 30 + Math.floor(i / 10) * 4 + 0.5 }, "rifle", "hold"));
  await kitWait(20); for (const e of many) killReal(e); await kitWait(80);
  r.bodies = ow().getEntities({ type: "war:corpse" }).filter((c) => !c.getProperty("war:gib")).length; r.tracked = CORPSES.length;
  // a reinforcement wave
  globalThis.__fakeLeader = (id) => (id === KIT_PLAYER.id ? KIT_PLAYER : undefined);
  setReinf([{ id: 1, dim: "minecraft:overworld", at: { x: ox + 0.5, y: Y, z: oz - 35.5 }, f: 1, n: 4, mix: "mixguns", every: 10, waves: 1, to: { x: ox + 0.5, y: Y, z: oz + 10.5 }, mode: "spot", done: 0, next: 0, owner: KIT_PLAYER.id, squad: 9 }]);
  const n0 = allOf(SOLDIER).length; await kitWait(160);
  r.reinforced = allOf(SOLDIER).length - n0; r.reinfLeft = getReinf().length;
  globalThis.__fakeLeader = undefined;
  return r;
};
// v9.22: a battle saved and loaded back: the same men, ranks, temperaments, kit and places
KS.bsave = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  setRelPair(1, 2, "0", false);
  const men = [0, 1, 2, 3].map((i) => kitSoldier(1 + (i % 2), { x: ox - 3 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, i % 2 ? "smg" : "sword", "hold"));
  Object.assign(idRec(men[0]), { x: 25 }); idSave(men[0], idRec(men[0])); Object.assign(idRec(men[1]), { t: "hothead" }); idSave(men[1], idRec(men[1])); setP(men[2], "war:medals", 5);
  await kitWait(20);
  const before = men.map((e) => `${soldierName(e)}|${traitOf(e)}|${sd(e).weapon}|${Math.round(e.location.x - ox)}|${e.getProperty("war:medals")}`);
  const n = battleSave(KIT_PLAYER, 5);
  const n2 = battleLoad(KIT_PLAYER, 5, true);
  await kitWait(20);
  const after = allOf(SOLDIER).filter((e) => dist(e.location, { x: ox, y: Y, z: oz }) < 10).sort((a, b) => a.location.x - b.location.x).map((e) => `${soldierName(e)}|${traitOf(e)}|${sd(e).weapon}|${Math.round(e.location.x - ox)}|${e.getProperty("war:medals")}`);
  for (let i = 0; i < 40; i++) world.setDynamicProperty(`war:bsave5_${i}`, undefined);
  return { saved: n, loaded: n2, before, after };
};
// v9.23: which loops cost the most in a big battle (ms over the run, by where each loop is made)
KS.loopprof = async (o, ox, oz) => {
  globalThis.__loopProf = {};
  const r = await KS.big({ n: o.n ?? 90 }, ox, oz);
  const P0 = globalThis.__loopProf; globalThis.__loopProf = undefined;
  const top = Object.entries(P0).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}:${v}`);
  return { tps: r.tps, top };
};
KS.namefollow = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  const keep = getJSON(world, "war:vlang", {});
  setJSON(world, "war:vlang", { ...keep, 1: "en_us" });
  const men = [0, 1, 2].map((i) => kitSoldier(1, { x: ox + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(120); const before = men.map((e) => strip(e.nameTag).split("\n")[0]);
  setJSON(world, "war:vlang", { ...keep, 1: "greek" });
  await kitWait(130); const after = men.map((e) => strip(e.nameTag).split("\n")[0]);
  setJSON(world, "war:vlang", keep);
  return { before, after };
};

// v9.19: Signal Flag signals, First Aid Kit, barbed wire, ammo crate
KS.items = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  setRelPair(1, 2, "1", true);
  const r = {};
  const men = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox + i * 1.2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  for (const e of men) sdp(e, "war:cmdr", KIT_PLAYER.id);
  await kitWait(20);
  r.mine = mySoldiers(KIT_PLAYER).length;
  giveSignal(KIT_PLAYER, 8); await kitWait(80); r.spreadPlan = men.map((e) => personal.get(e.id)?.kind ?? sd(e).func);
  let mind = 99; for (const a of men) for (const b of men) if (a !== b) mind = Math.min(mind, dist(a.location, b.location));
  r.spreadMinGap = Math.round(mind * 10) / 10;
  giveSignal(KIT_PLAYER, 6); await kitWait(5); r.followFunc = men.map((e) => sd(e).func);
  // first aid on a downed man
  const hurt = men[0]; hurt.applyDamage(15); await kitWait(5); goDown(hurt); await kitWait(10);
  r.downedBefore = downed.has(hurt.id);
  await firstAid(KIT_PLAYER, hurt); await kitWait(5);
  r.downedAfter = downed.has(hurt.id); r.hp = Math.round(hurt.getComponent("minecraft:health").currentValue);
  for (const e of men) try { e.remove(); } catch {}
  // wire: a man ordered through a wire line gets slowed
  for (let x = ox - 3; x <= ox + 3; x++) { kset(x, Y, oz + 6, "war:barbed_wire"); placedAdd("wire", "minecraft:overworld", x, Y, oz + 6); }
  r.wireBlock = ow().getBlock({ x: ox, y: Y, z: oz + 6 })?.typeId;
  const w = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 6.5 }, "rifle", "hold");
  await kitWait(25); r.wireSlowed = !!w.getEffect("slowness"); r.wireHp = Math.round(w.getComponent("minecraft:health").currentValue);
  try { w.remove(); } catch {}
  for (let x = ox - 3; x <= ox + 3; x++) { kset(x, Y, oz + 6, "air"); placedDel("wire", "minecraft:overworld", x, Y, oz + 6); }
  // crate: a dry rifleman walks to a crate and refills
  kset(ox + 12, Y, oz, "war:ammo_crate"); placedAdd("crate", "minecraft:overworld", ox + 12, Y, oz);
  const dry = kitSoldier(1, { x: ox - 8 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(10); RESERVE.set(dry.id, 0); OUT_OF.set(dry.id, tick());
  const tr = []; for (let i = 0; i < 8; i++) { const g = gunState.get(dry.id); if (g) g.lastShot = tick(); await kitWait(50); tr.push(Math.round(dist(dry.location, { x: ox + 12.5, y: Y, z: oz + 0.5 }))); } r.crateTrail = tr;
  r.crateDist = Math.round(dist(dry.location, { x: ox + 12.5, y: Y, z: oz + 0.5 })); r.reserve = RESERVE.get(dry.id); r.stillDry = OUT_OF.has(dry.id);
  try { dry.remove(); } catch {} kset(ox + 12, Y, oz, "air"); placedDel("crate", "minecraft:overworld", ox + 12, Y, oz);
  return r;
};
KS.pdbg = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(20);
  const to = walkableNear(e.dimension, ox + 8.5, oz + 0.5, Y);
  planPersonalTo(e, "settle", to, tick());
  const tr = [];
  for (let i = 0; i < 10; i++) { await kitWait(10); const pr = personal.get(e.id); tr.push(`${Math.round((e.location.x - ox) * 10) / 10}|${pr ? (pr.planning ? "plan" : pr.pts ? pr.pts.length : "none") : "-"}|${e.getProperty("war:goal") ?? ""}|${note && (globalThis.__lastNote?.get?.(e.id) ?? "")}`); }
  try { e.remove(); } catch {}
  return { to, tr };
};
KS.pdbg2 = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  kset(ox + 12, Y, oz, "war:ammo_crate"); placedAdd("crate", "minecraft:overworld", ox + 12, Y, oz);
  const e = kitSoldier(1, { x: ox - 8 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(10); RESERVE.set(e.id, 0); OUT_OF.set(e.id, tick());
  const c = crateNear(e, 32); const to = c && walkableNear(e.dimension, c.x + 0.5, c.z + 1.5, c.y);
  const tr = [];
  for (let i = 0; i < 12; i++) { const g = gunState.get(e.id); if (g) g.lastShot = tick(); await kitWait(20); const pr = personal.get(e.id); tr.push(`${Math.round((e.location.x - ox) * 10) / 10}|${pr ? pr.kind + (pr.planning ? "plan" : pr.pts ? pr.pts.length : "none") : "-"}|${OUT_OF.has(e.id)}`); }
  try { e.remove(); } catch {} kset(ox + 12, Y, oz, "air"); placedDel("crate", "minecraft:overworld", ox + 12, Y, oz);
  return { c, to, size: placed("crate").size, tr };
};
KS.names2 = async (o, ox, oz) => {
  floorAt(ox - 15, oz - 15, ox + 15, oz + 15);
  const keep = getJSON(world, "war:vlang", {});
  setJSON(world, "war:vlang", { ...keep, 1: "us_mix", 2: "greek" });
  const men = [...Array(12).keys()].map((i) => kitSoldier(1, { x: ox - 6 + i + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  for (const e of men) { Object.assign(idRec(e), { s: 5000 }); idSave(e, idRec(e)); NAME_KEY.delete(e.id); }         // all the same name to start: the squad check must sort it out
  const gr = [0, 1].map((i) => kitSoldier(2, { x: ox + i * 2 + 0.5, y: Y, z: oz + 8.5 }, "rifle", "hold"));
  await kitWait(260);
  const names = men.map((e) => surname(e));
  const r = { heritage: men.map((e) => voiceOfMan(e)), names, uniq: new Set(names).size, full: men.slice(0, 3).map((e) => fullName(e)), greek: gr.map((e) => fullName(e)) };
  // seeds spread: how the 60/40 mix comes out over 1000 men
  let aave = 0; const fake = { id: "x" }; for (let i = 0; i < 1000; i++) { const s0 = Math.floor(Math.random() * 1000000); aave += (Math.floor(s0 / 1000) % 1000) / 1000 >= 0.6 ? 1 : 0; } r.aavePer1000 = aave;
  // a nickname: three saves
  for (let i = 0; i < 3; i++) creditSave(men[0]);
  r.nick = soldierName(men[0]); r.tag = strip(men[0].nameTag).split("\n")[0];
  setJSON(world, "war:vlang", keep);
  return r;
};
// v9.19: off-duty life, sentry beat, scavenging the dead, blast shock
KS.life = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 30, oz + 20);
  setRelPair(1, 2, "1", true);
  kcmd("time set noon");
  const r = {};
  const men = [0, 1, 2, 3, 4, 5].map((i) => kitSoldier(1, { x: ox + 10 + (i % 3) * 2.5 + 0.5, y: Y, z: oz + Math.floor(i / 3) * 2 + 0.5 }, "rifle", "hold"));
  for (const e of men) sdp(e, "war:ordt", -999999);
  const seen = new Set(); let gunHid = 0;
  for (let i = 0; i < 40; i++) { await kitWait(20); for (const e of men) { const a = e.getProperty("war:idle"); if (a) { seen.add(a); if (!e.getProperty("war:gun")) gunHid++; } } }
  r.idleActs = [...seen].sort(); r.gunHidSamples = gunHid;
  // an enemy shows up: idling stops
  const en = kitSoldier(2, { x: ox + 12.5, y: Y, z: oz + 25.5 }, "rifle", "hold"); en.addEffect("resistance", 600, { amplifier: 255, showParticles: false });
  for (const e of men) e.addEffect("resistance", 600, { amplifier: 255, showParticles: false });
  await kitWait(60); r.idleInFight = men.filter((e) => e.getProperty("war:idle")).length;
  // blast nearby: the men round it are shaken
  explode(ow(), { x: ox + 12.5, y: Y, z: oz + 6.5 }, 1, { breaksBlocks: false, causesFire: false });
  await kitWait(2); r.shocked = men.filter((e) => (SHOCK.get(e.id) ?? 0) > tick()).length;
  try { en.remove(); } catch {}
  for (const e of men) try { e.remove(); } catch {}
  // sentry walks a beat
  const s = kitSoldier(1, { x: ox - 10.5, y: Y, z: oz - 10.5 }, "rifle", "sentry"); sdp(s, "war:ordt", -999999);
  let far = 0; const s0 = { ...s.location };
  for (let i = 0; i < 25; i++) { await kitWait(20); far = Math.max(far, flat(s.location, s0)); }
  r.sentryBeat = Math.round(far * 10) / 10;
  try { s.remove(); } catch {}
  // dry rifleman takes a dead man's rounds
  const dry = kitSoldier(1, { x: ox - 8.5, y: Y, z: oz + 8.5 }, "rifle", "hold");
  await kitWait(10); RESERVE.set(dry.id, 0); OUT_OF.set(dry.id, tick());
  BODY_KIT.set("fake-body", { dim: "minecraft:overworld", at: { x: ox + 2.5, y: Y, z: oz + 8.5 }, w: "rifle", n: 40, t: tick() });
  for (let i = 0; i < 12; i++) { const g = gunState.get(dry.id); if (g) g.lastShot = tick(); await kitWait(25); if (!OUT_OF.has(dry.id)) break; }
  r.scavenged = !OUT_OF.has(dry.id); r.reserve = RESERVE.get(dry.id); r.kitLeft = BODY_KIT.has("fake-body");
  try { dry.remove(); } catch {}
  return r;
};
KS.beat = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const s = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "sentry"); sdp(s, "war:ordt", -999999);
  const tr = [];
  for (let i = 0; i < 15; i++) { await kitWait(20); const pr = personal.get(s.id); tr.push(`${Math.round(flat(s.location, { x: ox + 0.5, z: oz + 0.5 }) * 10) / 10}|${pr ? pr.kind : "-"}`); }
  const r = { func: sd(s).func, goal: gdp(s, "war:goal"), mk: !!marker(Number(gdp(s, "war:goal") ?? 0)), known: squads.get(squadKey(s, sd(s)))?.known?.size, tr };
  try { s.remove(); } catch {}
  return r;
};
// v9.19: duels, helmets, glass, spears against a charge
const v9get = (k) => globalThis.__v9?.[k] ?? 0;
KS.combat2 = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
  setRelPair(1, 2, "1", true);
  const r = {};
  const s0 = { ...globalThis.__v9 };
  // swords
  const a = [0, 1, 2].map((i) => kitSoldier(1, { x: ox - 3 + i * 3 + 0.5, y: Y, z: oz - 3.5 }, "sword", "hold"));
  const b = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 3 + i * 3 + 0.5, y: Y, z: oz + 3.5 }, "sword", "hold"));
  await kitWait(300);
  r.duel = { parry: v9get("parry"), riposte: v9get("riposte"), bash: v9get("shieldBash") };
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  // helmets: iron-armoured men under rifle fire
  const tgt = [0, 1, 2].map((i) => { const e = kitSoldier(2, { x: ox - 3 + i * 3 + 0.5, y: Y, z: oz + 14.5 }, "rifle", "hold"); sdp(e, "war:armor", "iron"); equipArmor(e, "iron"); sdp(e, "war:armor", "iron"); e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); e.addEffect("regeneration", 3000, { amplifier: 4, showParticles: false }); return e; });
  const sh = [0, 1, 2].map((i) => kitSoldier(1, { x: ox - 3 + i * 3 + 0.5, y: Y, z: oz - 6.5 }, "rifle", "hold"));
  for (let i = 0; i < 60; i++) { const g = sh[i % 3], t = tgt[i % 3]; if (!g.isValid || !t.isValid) continue; const h = headLoc(g), c = headLoc(t); hitscan(g, GUN_SPEC.rifle, h, { x: c.x - h.x, y: c.y - 0.15 - h.y, z: c.z - h.z }, 40, "rifle"); await kitWait(3); }
  r.helmet = { ping: v9get("helmetPing"), off: v9get("helmetOff"), armor: String(gdp(tgt[0], "war:armor")) };
  for (const e of [...tgt, ...sh]) try { e.remove(); } catch {}
  // glass: a pane between, shots that hit it go through (count hits on a man behind)
  kfill(ox - 4, Y, oz + 5, ox + 4, Y + 3, oz + 5, "glass_pane");
  let hits = 0; const sub = (ev) => { try { if (ev.hurtEntity?.typeId === SOLDIER) hits++; } catch {} };
  const behind = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 8.5 }, "rifle", "hold"); behind.addEffect("resistance", 3000, { amplifier: 2, showParticles: false }); behind.addEffect("regeneration", 3000, { amplifier: 5, showParticles: false });
  const gunner = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 2.5 }, "rifle", "hold"); await kitWait(20);
  world.afterEvents.entityHurt.subscribe(sub);
  for (let i = 0; i < 20; i++) { const h = headLoc(gunner), c = chest(behind); hitscan(gunner, GUN_SPEC.rifle, h, { x: c.x - h.x, y: c.y - h.y, z: c.z - h.z }, 30, "rifle"); await kitWait(2); }
  world.afterEvents.entityHurt.unsubscribe(sub);
  r.glassHits = hits;
  kfill(ox - 4, Y, oz + 5, ox + 4, Y + 3, oz + 5, "stone");
  hits = 0; world.afterEvents.entityHurt.subscribe(sub);
  for (let i = 0; i < 20; i++) { const h = headLoc(gunner), c = chest(behind); hitscan(gunner, GUN_SPEC.rifle, h, { x: c.x - h.x, y: c.y - h.y, z: c.z - h.z }, 30, "rifle"); await kitWait(2); }
  world.afterEvents.entityHurt.unsubscribe(sub);
  r.stoneHits = hits;
  kfill(ox - 4, Y, oz + 5, ox + 4, Y + 3, oz + 5, "air");
  for (const e of [behind, gunner]) try { e.remove(); } catch {}
  // cavalry into a spear line
  const spears = [0, 1, 2, 3].map((i) => { const e = kitSoldier(2, { x: ox - 3 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "spear", "post"); e.setRotation({ x: 0, y: 180 }); return e; });
  const cav = [0, 1].map((i) => kitCav(1, { x: ox - 1 + i * 2 + 0.5, y: Y, z: oz - 22.5 }, "sword", "minecraft:horse"));
  await kitWait(400);
  r.spearStop = v9get("spearStop"); r.chargeHit = v9get("chargeHit");
  for (const e of [...spears, ...cav]) try { e.remove(); } catch {}
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
  return r;
};
KS.glass = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 15);
  const keepBuild = gdp(world, "war:set_build"); sdp(world, "war:set_build", false);   // (no window-breaking: this is about rounds)
  setRelPair(1, 2, "1", true);
  kfill(ox - 4, Y, oz + 5, ox + 4, Y + 3, oz + 5, o.b ?? "glass_pane"); await kitWait(10);
  const behind = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 8.5 }, "rifle", "hold"); behind.addEffect("regeneration", 3000, { amplifier: 5, showParticles: false });
  const gunner = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz - 2.5 }, "rifle", "hold"); await kitWait(20);
  const out = []; globalThis.__warShot = (q) => out.push(`${q.hit ? "HIT" : "miss"} bd=${Math.round(q.blockD * 10) / 10}`);
  const h = headLoc(gunner), c = chest(behind);
  const rh = rayHit(ow(), h, (() => { const dx = c.x - h.x, dy = c.y - h.y, dz = c.z - h.z, L = Math.hypot(dx, dy, dz); return { x: dx / L, y: dy / L, z: dz / L }; })(), 30);
  for (let i = 0; i < 3; i++) { hitscan(gunner, GUN_SPEC.rifle, h, { x: c.x - h.x, y: c.y - h.y, z: c.z - h.z }, 30, "rifle"); await kitWait(2); }
  globalThis.__warShot = undefined;
  kfill(ox - 4, Y, oz + 5, ox + 4, Y + 3, oz + 5, "air");
  for (const e of [behind, gunner]) try { e.remove(); } catch {}
  const dv = (() => { const dx = c.x - h.x, dy = c.y - h.y, dz = c.z - h.z, L = Math.hypot(dx, dy, dz); return { x: dx / L, y: dy / L, z: dz / L }; })();
  let ents = []; try { ents = ow().getEntitiesFromRay(h, dv, { maxDistance: 30 }).map((q) => `${q.entity.typeId}@${Math.round(q.distance)}:${hittable(q.entity, gunner)}`); } catch (err) { ents = [String(err)]; }
  const at = ow().getBlock({ x: Math.floor(h.x + dv.x * 7.95), y: Math.floor(h.y + dv.y * 7.95), z: Math.floor(h.z + dv.z * 7.95) })?.typeId;
  sdp(world, "war:set_build", keepBuild);
  return { perr: globalThis.__pierceErr, first: rh?.hb?.block?.typeId, loc: rh?.hb?.block?.location, d: rh?.d, at, ents, h, c, out };
};
KS.reinfskin = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const sk = skinChoices()[0]?.slot ?? 3;
  const old = [0, 1, 2].map((i) => { const e = kitSoldier(1, { x: ox + i * 2 + 0.5, y: Y, z: oz + 10.5 }, "rifle", "hold"); setP(e, "war:skin", sk); return e; });
  globalThis.__fakeLeader = (id) => (id === KIT_PLAYER.id ? KIT_PLAYER : undefined);
  const before = new Set(allOf(SOLDIER).map((e) => e.id));
  setReinf([{ id: 2, dim: "minecraft:overworld", at: { x: ox + 0.5, y: Y, z: oz - 10.5 }, f: 1, n: 3, mix: "rifle", every: 10, waves: 1, mode: "spot", done: 0, next: 0, owner: KIT_PLAYER.id, squad: 9 }]);
  await kitWait(80);
  globalThis.__fakeLeader = undefined;
  const fresh = allOf(SOLDIER).filter((e) => !before.has(e.id));
  const r = { want: sk, got: fresh.map((e) => e.getProperty("war:skin")) };
  for (const e of [...old, ...fresh]) try { e.remove(); } catch {}
  setReinf([]);
  return r;
};
KS.prisoners = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  setRelPair(1, 2, "1", true);
  const caps = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox - 3 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, i % 2 ? "sword" : "rifle", "hold"));
  const pr = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 2 + i * 2 + 0.5, y: Y, z: oz + 4.5 }, "rifle", "hold"));
  await kitWait(10);
  for (const e of pr) soldierTakes(e, caps[0]);
  const r = { tags: pr.map((e) => e.getTags().filter((t) => t.startsWith("war_")).join(",")) };
  await kitWait(400);
  r.alive = pr.filter((e) => e.isValid).length; r.pows = pr.filter((e) => e.isValid && pows.has(e.id)).length;
  r.hp = pr.map((e) => (e.isValid ? Math.round(e.getComponent("minecraft:health").currentValue) : 0));
  for (const e of [...caps, ...pr]) try { e.remove(); } catch {}
  return r;
};
KS.skinmix = async (o, ox, oz) => {
  floorAt(ox - 15, oz - 15, ox + 15, oz + 15);
  const keepL = getJSON(world, "war:vlang", {}), k1 = getJSON(world, "war:fskins", {}), k2 = getJSON(world, "war:fgroups", {});
  setJSON(world, "war:vlang", { ...keepL, 1: "en_us", 2: "german" });
  setJSON(world, "war:fskins", { ...k1, 1: 3, 2: 10 }); setJSON(world, "war:fgroups", { ...k2, 1: [{ lang: "aave", skin: 18, pct: 30 }], 2: [{ lang: "russian", skin: 13, pct: 20 }, { lang: "dutch", skin: 0, pct: 10 }] });
  const a = [...Array(30).keys()].map((i) => kitSoldier(1, { x: ox - 15 + i + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  const b = [...Array(30).keys()].map((i) => kitSoldier(2, { x: ox - 15 + i + 0.5, y: Y, z: oz + 6.5 }, "rifle", "hold"));
  await kitWait(o.w ?? 30);
  const inC = (e, k) => CULTURE[k].names.includes(surname(e));
  const r = {
    us: { aave: a.filter((e) => voiceOfMan(e) === "aave").length, match: a.filter((e) => (voiceOfMan(e) === "aave") === (e.getProperty("war:skin") === 18) && inC(e, voiceOfMan(e))).length },
    de: b.map((e) => `${voiceOfMan(e).slice(0, 2)}${e.getProperty("war:skin")}`).reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}),
    sample: [a.find((e) => voiceOfMan(e) === "aave"), b.find((e) => voiceOfMan(e) === "russian")].map((e) => e && strip(e.nameTag).split("\n")[0]),
  };
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  setJSON(world, "war:vlang", keepL); setJSON(world, "war:fskins", k1); setJSON(world, "war:fgroups", k2);
  return r;
};
// v9.19: second-guessing meter: decision changes, flip-flops (A->B->A within 3 s) and which pairs flip, movement
// reversals, yaw flicks, target switches, goal-group changes (the game's own movement switching)
let o_detail = false;
async function churn(list, T) {
  const st = new Map(), pairs = {}, ditherWhat = {}, stallWhat = {}; let want = 0, stall = 0, dither = 0, acts = 0, flips = 0, tsw = 0, gsw = 0, rev = 0, moves = 0, flick = 0, turns = 0, samples = 0, bigFlick = 0;
  for (let k = 0; k < T; k++) {
    await kitWait(1);
    const now = tick();
    for (const e of list) {
      if (!e?.isValid) continue;
      let S = st.get(e.id); if (!S) { S = { hist: [] }; st.set(e.id, S); }
      const B = brain.get(e.id), act = B?.act ?? "", g = getJSON(e, "war:st", {}).g ?? "", tg = gunState.get(e.id)?.target?.id ?? "";
      samples++;
      if (S.act !== undefined && act !== S.act) {
        acts++; S.hist.push({ a: act, t: now });
        const h = S.hist; if (h.length >= 3 && h[h.length - 3].a === act && now - h[h.length - 3].t <= 60) { flips++; const kk = `${h[h.length - 2].a}<>${act}`; pairs[kk] = (pairs[kk] ?? 0) + 1; }
        if (h.length > 6) h.shift();
      }
      if (S.g !== undefined && g !== S.g) gsw++;
      if (S.tg !== undefined && tg !== S.tg && tg && S.tg) tsw++;
      const v = e.getVelocity(), r = e.getRotation();
      if (S.v) { const sp = Math.hypot(v.x, v.z), lsp = Math.hypot(S.v.x, S.v.z); if (sp > 0.04 && lsp > 0.04) { moves++; if ((v.x * S.v.x + v.z * S.v.z) / (sp * lsp) < -0.3) rev++; } }
      if (S.y !== undefined) { const dy = ((r.y - S.y + 540) % 360) - 180; if (Math.abs(dy) > 3) { turns++; if (S.dy && Math.sign(dy) !== Math.sign(S.dy)) { flick++; if (Math.abs(dy) > 12 && Math.abs(S.dy) > 12 && now - (S.dyT ?? -99) < 10) bigFlick++; } S.dy = dy; S.dyT = now; } }
      S.act = act; S.g = g; S.tg = tg; S.v = v; S.y = r.y;
      // v9.20.3: hesitation (meant to be going somewhere, standing still a second or more) and dithering (lots of walking,
      // little getting anywhere, over 3 s)
      const l = e.location, gm = marker(Number(gdp(e, "war:goal") ?? 0));
      const wants = (g === "g_wp" || g === "g_owner") && !downed.has(e.id) && (!gm || flat(gm.location, l) > 3.2) && !isRiding(e);
      if (wants) { want++; if (Math.hypot(v.x, v.z) < 0.015 && (!S.lp || flat(S.lp, l) < 0.02)) { S.still = (S.still ?? 0) + 1; if (S.still > 20) { stall++; const prx = personal.get(e.id), gmk = marker(Number(gdp(e, "war:goal") ?? 0)); const nt = (notes.get(e.id)?.text ?? "?").slice(0, 26) + "/" + (act || "-") + (o_detail ? `|${prx ? prx.kind + (prx.planning ? "P" : "") : "-"}${gliders.has(e.id) ? "G" : ""}${climbing.has(e.id) ? "C" : ""}|dy${gmk ? Math.round(gmk.location.y - e.location.y) : "?"}|in${isIndoors(e) ? 1 : 0}` : ""); stallWhat[nt] = (stallWhat[nt] ?? 0) + 1; } } else S.still = 0; } else S.still = 0;
      if (S.lp) S.path = (S.path ?? 0) + flat(S.lp, l);
      S.lp = { x: l.x, y: l.y, z: l.z };
      if (!S.w0 || now - S.w0.t >= 60) { if (S.w0 && S.path > 3 && flat(S.w0, l) < S.path * 0.35) { dither++; if (S.ditherAct === undefined) S.ditherAct = act || g; ditherWhat[act || g] = (ditherWhat[act || g] ?? 0) + 1; } S.w0 = { x: l.x, z: l.z, t: now }; S.path = 0; }
    }
  }
  const perMin = (n) => +((n / Math.max(1, list.length)) * (1200 / T)).toFixed(1);
  return { actsPerMin: perMin(acts), flipsPerMin: perMin(flips), groupSwPerMin: perMin(gsw), targetSwPerMin: perMin(tsw), revPct: +(100 * rev / Math.max(1, moves)).toFixed(1), flickPerTurn: +(flick / Math.max(1, turns)).toFixed(2), bigFlickPerMin: perMin(bigFlick), stallPct: +(100 * stall / Math.max(1, want)).toFixed(1), ditherPerMin: perMin(dither * 1), stallWhat: Object.entries(stallWhat).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`), ditherWhat: Object.entries(ditherWhat).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`), topFlips: Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`) };
}
KS.brainy = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const res = {};
  // a line of cover in the middle (half walls), like a real field
  for (const z of [oz - 8, oz + 8]) for (let x = ox - 12; x <= ox + 12; x += 4) { kset(x, Y, z, "cobblestone_wall"); kset(x + 1, Y, z, "cobblestone_wall"); }
  const idle = [...Array(6).keys()].map((i) => kitSoldier(1, { x: ox - 30 + i * 2 + 0.5, y: Y, z: oz - 30.5 }, i % 2 ? "rifle" : "smg", "hold"));
  await kitWait(40); res.idle = await churn(idle, 300);
  for (const e of idle) try { e.remove(); } catch {}
  setRelPair(1, 2, "1", true);
  const n = o.n ?? 6;
  const a = [...Array(n).keys()].map((i) => kitSoldier(1, { x: ox - 10 + i * 3 + 0.5, y: Y, z: oz - 16.5 }, ["rifle", "smg", "rifle", "semi", "mg", "rifle"][i % 6], "hold"));
  const b = [...Array(n).keys()].map((i) => kitSoldier(2, { x: ox - 10 + i * 3 + 0.5, y: Y, z: oz + 16.5 }, ["rifle", "smg", "rifle", "semi", "mg", "rifle"][i % 6], "hold"));
  for (const e of [...a, ...b]) try { e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); e.addEffect("regeneration", 3000, { amplifier: 2, showParticles: false }); } catch {}
  await kitWait(40); res.fight = await churn([...a, ...b], o.t ?? 600);
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  // a squad ordered across the field
  const m = [...Array(6).keys()].map((i) => kitSoldier(1, { x: ox - 30 + i * 2 + 0.5, y: Y, z: oz + 30.5 }, "rifle", "hold"));
  await kitWait(20); await kitOrder(1, { x: ox + 30.5, y: Y, z: oz + 30.5 }, "hold");
  res.march = await churn(m, 300);
  for (const e of m) try { e.remove(); } catch {}
  return res;
};
// who turns a man: every setRotation / teleport-with-rotation on him, with the line that did it
KS.whoturns = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const m = [...Array(4).keys()].map((i) => kitSoldier(1, { x: (o.fight ? ox - 3 : ox - 30) + i * 2 + 0.5, y: Y, z: oz + 0.5 }, o.w ?? "rifle", "hold"));
  await kitWait(20);
  const P0 = Object.getPrototypeOf(m[0]), ids = new Set(m.map((e) => e.id)), by = {};
  const line = () => (String(new Error().stack).split("\n").map((l) => Number((l.match(/main\.js:(\d+)/) ?? [])[1] ?? 0)).filter((n) => n > 40).slice(0, 2).join(">"));
  const oS = P0.setRotation, oT = P0.teleport;
  P0.setRotation = function (r) { if (ids.has(this.id)) { const k = `rot@${line()}`; by[k] = (by[k] ?? 0) + 1; } return oS.call(this, r); };
  P0.teleport = function (l, opt) { if (ids.has(this.id) && opt?.rotation) { const k = `tp@${line()}`; by[k] = (by[k] ?? 0) + 1; } return oT.call(this, l, opt); };
  const oK = P0.applyKnockback, oI = P0.applyImpulse;
  P0.applyKnockback = function (...a) { if (ids.has(this.id)) { const k = `kb@${line()}`; by[k] = (by[k] ?? 0) + 1; } return oK.apply(this, a); };
  P0.applyImpulse = function (...a) { if (ids.has(this.id)) { const k = `imp@${line()}`; by[k] = (by[k] ?? 0) + 1; } return oI.apply(this, a); };
  if (o.fight) { setRelPair(1, 2, "1", true); const b = [...Array(4).keys()].map((i) => kitSoldier(2, { x: ox - 3 + i * 2 + 0.5, y: Y, z: oz + (o.w ? 8.5 : 25.5) }, o.w ?? "rifle", "hold")); for (const e of [...m, ...b]) e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); }
  else await kitOrder(1, { x: ox + 30.5, y: Y, z: oz + 0.5 }, "hold");
  const tr = []; let last = m[0].getRotation().y;
  const c = await churn(m, 200);
  P0.setRotation = oS; P0.teleport = oT; P0.applyKnockback = oK; P0.applyImpulse = oI;
  return { churn: c, by };
};
KS.yawser = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const m = [...Array(4).keys()].map((i) => kitSoldier(1, { x: ox - 30 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(20); await kitOrder(1, { x: ox + 30.5, y: Y, z: oz + (o.dz ?? 0) + 0.5 }, "hold");
  const tr = []; let ly = m[1].getRotation().y;
  for (let k = 0; k < 160; k++) { await kitWait(1); const r = m[1].getRotation(), l = m[1].location; const dy = ((r.y - ly + 540) % 360) - 180; ly = r.y; if (Math.abs(dy) > 0.5) tr.push(`${k}:${Math.round(r.y)}(${Math.round(dy)})${gliders.has(m[1].id) ? "G" : ""}`); }
  for (const e of m) try { e.remove(); } catch {}
  return { tr: tr.join(" ") };
};
KS.mktrace = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const m = [...Array(4).keys()].map((i) => kitSoldier(1, { x: ox - 30 + i * 2 + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(20); await kitOrder(1, { x: ox + 30.5, y: Y, z: oz + (o.dz ?? 12) + 0.5 }, "hold");
  const w = m[Number(o.i ?? 1)], tr = []; let ly = w.getRotation().y;
  for (let k = 0; k < 200; k++) {
    await kitWait(1);
    const r = w.getRotation(), l = w.location, s = Number(gdp(w, "war:mymk") ?? 0), mp = mkPos.get(s);
    const dy = ((r.y - ly + 540) % 360) - 180; ly = r.y;
    const toMk = mp ? Math.round((Math.atan2(-(mp.x - l.x), mp.z - l.z) * 180) / Math.PI) : "-";
    if (Math.abs(dy) > 8) tr.push(`${k}:y${Math.round(r.y)}(${Math.round(dy)}) mk${toMk}@${mp ? Math.round(Math.hypot(mp.x - l.x, mp.z - l.z) * 10) / 10 : "-"} g=${getJSON(w, "war:st", {}).g}${gliders.has(w.id) ? " G" : ""}`);
  }
  for (const e of m) try { e.remove(); } catch {}
  return { tr };
};
KS.brainy2 = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const res = {};
  setRelPair(1, 2, "1", true);
  const a = [...Array(5).keys()].map((i) => kitSoldier(1, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz - 8.5 }, i % 2 ? "sword" : "spear", "hold"));
  const b = [...Array(5).keys()].map((i) => kitSoldier(2, { x: ox - 6 + i * 3 + 0.5, y: Y, z: oz + 8.5 }, i % 2 ? "sword" : "spear", "hold"));
  for (const e of [...a, ...b]) try { e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); e.addEffect("regeneration", 3000, { amplifier: 3, showParticles: false }); } catch {}
  res.melee = await churn([...a, ...b], 400);
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  // guards round a walking principal
  const pr = ow().spawnEntity("minecraft:armor_stand", { x: ox + 20.5, y: Y, z: oz - 20.5 });
  globalThis.__fakeLeader = (id) => (id === pr.id ? pr : undefined);
  const gs = [0, 1, 2, 3].map((i) => { const e = ow().spawnEntity(SOLDIER, { x: ox + 18.5 + i, y: Y, z: oz - 23.5 }, { spawnEvent: "war:init" }); const ne = setupSoldier(e, { faction: 1, squad: 3, weapon: i % 2 ? "sword" : "rifle", ranged: !!(i % 2 === 0), div: "guard", radius: 8, func: "__none", owner: pr.id }, KIT_PLAYER) ?? e; giveFunction(ne, "escort", pr); return ne; });
  await kitWait(60);
  const walker = (async () => { for (let k = 0; k < 300; k++) { const l = pr.location; const ph = Math.floor(k / 75) % 4; pr.teleport({ x: l.x + [0.15, 0, -0.15, 0][ph], y: Y, z: l.z + [0, 0.15, 0, -0.15][ph] }); await kitWait(1); } })();
  res.guard = await churn(gs, 300); await walker;
  globalThis.__fakeLeader = undefined; try { pr.remove(); } catch {} for (const e of gs) try { e.remove(); } catch {}
  // a squad following a walking leader
  const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox - 20.5, y: Y, z: oz + 20.5 });
  globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
  const fs = [0, 1, 2, 3, 4].map((i) => { const e = kitSoldier(1, { x: ox - 22.5 + i, y: Y, z: oz + 17.5 }, "rifle", "hold"); giveFunction(e, "follow", ld); return e; });
  await kitWait(60);
  const w2 = (async () => { for (let k = 0; k < 300; k++) { const l = ld.location; ld.teleport({ x: l.x + 0.12, y: Y, z: l.z + (k % 150 < 75 ? 0.05 : -0.05) }); await kitWait(1); } })();
  res.follow = await churn(fs, 300); await w2;
  globalThis.__fakeLeader = undefined; try { ld.remove(); } catch {} for (const e of fs) try { e.remove(); } catch {}
  return res;
};
KS.followform = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const res = {};
  for (const shape of ["column", "line", "wedge"]) {
    const fk = getJSON(world, "war:fshape", {}); fk["1|0"] = shape; setJSON(world, "war:fshape", fk);
    const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox - 20.5, y: Y, z: oz + 0.5 });
    globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
    const fs = [0, 1, 2, 3, 4].map((i) => { const e = kitSoldier(1, { x: ox - 22.5 + i, y: Y, z: oz - 3.5 }, "rifle", "hold"); sdp(e, "war:squad", 0); giveFunction(e, "follow", ld); return e; });
    await kitWait(60);
    let gapSum = 0, n = 0, minPair = 99;
    for (let k = 0; k < 240; k++) {
      const l = ld.location; ld.teleport({ x: l.x + 0.13, y: Y, z: l.z + (k < 120 ? 0 : 0.06) }); await kitWait(1);
      if (k > 60 && k % 10 === 0) { const F = FOLLOW.get(ld.id); if (!F) continue; for (const e of fs) { const sp = followSlot(e, sd(e), ld, F); if (sp) { gapSum += Math.hypot(sp.x - e.location.x, sp.z - e.location.z); n++; } } for (const a of fs) for (const b of fs) if (a !== b) minPair = Math.min(minPair, flat(a.location, b.location)); }
    }
    res[shape] = { avgGap: +(gapSum / Math.max(1, n)).toFixed(2), minPair: +minPair.toFixed(2), notes: fs.map((e) => notes.get(e.id)?.text ?? "").slice(0, 2) };
    globalThis.__fakeLeader = undefined; try { ld.remove(); } catch {} for (const e of fs) try { e.remove(); } catch {}
  }
  const fk = getJSON(world, "war:fshape", {}); delete fk["1|0"]; setJSON(world, "war:fshape", fk);
  return res;
};
// v9.20.3: prisoners keep close behind whoever took them (a soldier or you), across open ground and round a wall
KS.powfollow = async (o, ox, oz) => {
  floorAt(ox - 45, oz - 45, ox + 45, oz + 45);
  setRelPair(1, 2, "1", true);
  const res = {};
  for (const who of ["soldier", "player"]) {
    for (let x = ox - 10; x <= ox + 30; x++) for (let y = Y; y < Y + 3; y++) kset(x, y, oz + 12, "stone");   // a wall, open at its west end
    const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox - 20.5, y: Y, z: oz + 0.5 });
    globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
    let cap = ld;
    if (who === "soldier") { cap = kitSoldier(1, { x: ox - 22.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); sdp(cap, "war:squad", 0); sdp(cap, "war:home", undefined); giveFunction(cap, "follow", ld); }
    const pr = [0, 1].map((i) => kitSoldier(2, { x: ox - 24.5 + i, y: Y, z: oz - 3.5 }, "rifle", "hold"));
    await kitWait(20);
    for (const e of pr) { if (who === "soldier") soldierTakes(e, cap); else makePow(e, cap); }
    await kitWait(40);
    let sum = 0, n = 0, worst = 0; const trace = [], now0 = () => tick();
    const gap = () => { for (const e of pr) { const g = flat(e.location, cap.location); sum += g; n++; worst = Math.max(worst, g); } };
    for (let k = 0; k < 300; k++) { const l = ld.location; ld.teleport({ x: l.x + Number(o.v ?? 0.15), y: Y, z: l.z }); await kitWait(1); if (k > 40 && k % 10 === 0) gap(); if (o.tr && k % 30 === 0) trace.push(pr.map((e) => { const pw = pows.get(e.id); return `${flat(e.location, cap.location).toFixed(1)}/${personal.get(e.id)?.kind ?? "-"}${personal.get(e.id)?.planning ? "P" : ""}/${pw?.sr ? "sr" : ""}/${now0() - (pw?.on ?? -999)}/${getJSON(e, "war:st", {}).g ?? ""}`; }).join(" ")); }
    const open = { avg: +(sum / Math.max(1, n)).toFixed(1), worst: +worst.toFixed(1) };
    // the leader goes round to the far side of the wall (the prisoners have to go round its end)
    ld.teleport({ x: ox + 10.5, y: Y, z: oz + 16.5 });
    let t = 0; for (; t < 600; t += 10) { await kitWait(10); if (pr.every((e) => e.isValid && flat(e.location, cap.location) < 6 && e.location.z > oz + 12)) break; }
    res[who] = { trace: o.tr ? trace : undefined, open, roundWall: t >= 600 ? "no" : `${(t / 20).toFixed(1)} s`, end: pr.map((e) => +flat(e.location, cap.location).toFixed(1)), mode: pr.map((e) => pows.get(e.id)?.mode), captorOk: pr.every((e) => pows.get(e.id)?.captor === cap.id), notes: pr.map((e) => notes.get(e.id)?.text ?? "") };
    globalThis.__fakeLeader = undefined;
    for (const e of [...pr, ld, cap]) try { e.remove(); } catch {}
    for (let x = ox - 10; x <= ox + 30; x++) for (let y = Y; y < Y + 3; y++) kset(x, y, oz + 12, "air");
  }
  // the captor falls: one of his side takes the prisoner over
  const c1 = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), c2 = kitSoldier(1, { x: ox + 3.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  sdp(c1, "war:home", undefined);
  const p1 = kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 3.5 }, "rifle", "hold");
  await kitWait(20); soldierTakes(p1, c1); await kitWait(20); c1.remove(); await kitWait(80);
  res.handover = { to: pows.get(p1.id)?.captor === c2.id, mode: pows.get(p1.id)?.mode, d: +flat(p1.location, c2.location).toFixed(1) };
  for (const e of [c2, p1]) try { e.remove(); } catch {}
  return res;
};
// v9.20.3: "follow me" squads at your walking pace, after a dash ahead, and round a wall
KS.followfar = async (o, ox, oz) => {
  floorAt(ox - 45, oz - 45, ox + 45, oz + 45);
  for (let x = ox - 10; x <= ox + 30; x++) for (let y = Y; y < Y + 3; y++) kset(x, y, oz + 12, "stone");
  const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox - 20.5, y: Y, z: oz + 0.5 });
  globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
  const fs = [0, 1, 2, 3].map((i) => { const e = kitSoldier(1, { x: ox - 22.5 + i, y: Y, z: oz - 3.5 }, "rifle", "hold"); sdp(e, "war:squad", 0); giveFunction(e, "follow", ld); return e; });
  await kitWait(60);
  const res = {}, v = Number(o.v ?? 0.21);
  const avgTo = () => { const F = FOLLOW.get(ld.id); let s = 0, n = 0; for (const e of fs) { const sp = F && followSlot(e, sd(e), ld, F); s += sp ? flat(sp, e.location) : flat(ld.location, e.location); n++; } return s / n; };
  let sum = 0, n = 0, worst = 0;
  const trace = [], tr = (tag) => { if (!o.tr) return; const F = FOLLOW.get(ld.id); trace.push(tag + " " + fs.map((e) => { const sp = F && followSlot(e, sd(e), ld, F); const l = e.location, pr = personal.get(e.id); return `(${Math.round(l.x - ox)},${Math.round(l.z - oz)})${pr?.pts ? pr.idx + "/" + pr.pts.length : ""} ${sp ? flat(sp, e.location).toFixed(1) : "?"}/${personal.get(e.id)?.kind ?? "-"}${personal.get(e.id)?.planning ? "P" : ""}/${getJSON(e, "war:st", {}).g ?? ""}/${getJSON(e, "war:st", {}).s ?? ""}`; }).join(" ")); };
  for (let k = 0; k < 200; k++) { const l = ld.location; ld.teleport({ x: l.x + v, y: Y, z: l.z }); await kitWait(1); if (k > 40 && k % 10 === 0) { const g = avgTo(); sum += g; n++; worst = Math.max(worst, g); } if (k % 20 === 0) tr("w" + k); }
  res.walk = { avgGap: +(sum / n).toFixed(1), worst: +worst.toFixed(1) };
  { const l = ld.location; ld.teleport({ x: l.x + 18, y: Y, z: l.z }); }          // a dash ahead (you sprint off)
  let t = 0; for (; t < 400; t += 5) { await kitWait(5); if (t % 20 === 0) tr("d" + t); if (avgTo() < 2) break; }
  res.dash = `${(t / 20).toFixed(1)} s`;
  ld.teleport({ x: ox + 10.5, y: Y, z: oz + 16.5 });                               // round the wall
  t = 0; for (; t < 800; t += 10) { await kitWait(10); if (t % 40 === 0) tr("r" + t); if (fs.every((e) => e.location.z > oz + 12 && flat(e.location, ld.location) < 8)) break; }
  res.roundWall = t >= 800 ? `no (${fs.map((e) => Math.round(flat(e.location, ld.location))).join(",")})` : `${(t / 20).toFixed(1)} s`;
  res.notes = fs.map((e) => notes.get(e.id)?.text ?? ""); if (o.tr) res.trace = trace;
  globalThis.__fakeLeader = undefined;
  for (const e of [...fs, ld]) try { e.remove(); } catch {}
  for (let x = ox - 10; x <= ox + 30; x++) for (let y = Y; y < Y + 3; y++) kset(x, y, oz + 12, "air");
  return res;
};
KS.walldbg = async (o, ox, oz) => {
  floorAt(ox - 45, oz - 45, ox + 45, oz + 45);
  for (let x = ox - 10; x <= ox + 30; x++) for (let y = Y; y < Y + 3; y++) kset(x, y, oz + 12, "stone");
  await kitWait(5);
  const dim = ow(), from = { x: ox + 26.5, y: Y, z: oz + 10.5 }, to = { x: ox + 10.5, y: Y, z: oz + 16.5 };
  const r = { blk: tBlock(dim, ox + 20.5, Y, oz + 12.5)?.typeId, blk2: tBlock(dim, ox + 20.5, Y + 2, oz + 12.5)?.typeId, standWall: standAt(dim, ox + 20, Y, oz + 12), standTop: standAt(dim, ox + 20, Y + 3, oz + 12), floor: tBlock(dim, ox + 20.5, Y - 1, oz + 10.5)?.typeId, Y };
  const q = quickRoute(dim, from, to); r.quick = q ? q.length + " " + q.filter((p, i) => i % 4 === 0).map((p) => `${Math.round(p.x - ox)},${p.y - Y},${Math.round(p.z - oz)}`).join(" ") : "none";
  r.sr = straightReach(dim, from, to);
  await new Promise((res) => planRoute(dim, from, to, (pts, partial) => { r.plan = pts ? `${pts.length}${partial ? " PARTIAL" : ""} ` + pts.map((p) => `${Math.round(p.x - ox)},${p.y - Y},${Math.round(p.z - oz)}`).join(" ") : "none"; res(); }, { max: 6000, maxRadius: 50 }));
  for (let x = ox - 10; x <= ox + 30; x++) for (let y = Y; y < Y + 3; y++) kset(x, y, oz + 12, "air");
  return r;
};
// v9.20.3: the audit: every kind of NPC through the hesitation / jitter meter. o.only=<name> runs one part.
KS.audit = async (o, ox, oz) => {
  const res = {}, run = (k) => !o.only || String(o.only).split(",").includes(k); o_detail = !!o.detail; globalThis.__noKick = !!o.nokick;
  const tough = (list) => { for (const e of list) try { e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); e.addEffect("regeneration", 3000, { amplifier: 2, showParticles: false }); } catch {} };
  const clear = (list) => { for (const e of list) try { e.remove(); } catch {} };
  const T = Number(o.t ?? 500);
  setRelPair(1, 2, "1", true);
  if (run("cover")) {                                              // an open fight with a line of half walls on each side
    floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
    for (const z of [oz - 8, oz + 8]) for (let x = ox - 12; x <= ox + 12; x += 4) { kset(x, Y, z, "cobblestone_wall"); kset(x + 1, Y, z, "cobblestone_wall"); }
    const a = [...Array(6).keys()].map((i) => kitSoldier(1, { x: ox - 10 + i * 3 + 0.5, y: Y, z: oz - 16.5 }, ["rifle", "smg", "rifle", "semi", "mg", "rifle"][i], "hold"));
    const b = [...Array(6).keys()].map((i) => kitSoldier(2, { x: ox - 10 + i * 3 + 0.5, y: Y, z: oz + 16.5 }, ["rifle", "smg", "rifle", "semi", "mg", "rifle"][i], "hold"));
    tough([...a, ...b]); await kitWait(40);
    // arrival: every move to a spot (cover, a firing position, a new position): how close he got, and how long it took
    const mv = new Map(), done = []; let astop = false;
    (async () => { while (!astop) { const now = tick(); for (const e of [...a, ...b]) { if (!e.isValid) continue; const B = brain.get(e.id), act = B?.act, tg = B?.target;
      const cur = mv.get(e.id), key = act && tg && ["cover", "position", "relocate", "mgpos", "peek"].includes(act) ? `${act}@${Math.round(tg.x)},${Math.round(tg.z)}` : undefined;
      if (cur && cur.key !== key) { done.push({ act: cur.act, min: +cur.min.toFixed(2), secs: +((now - cur.t0) / 20).toFixed(1) }); mv.delete(e.id); }
      if (key) { const c = mv.get(e.id) ?? { key, act, min: 99, t0: now }; c.min = Math.min(c.min, flat(tg, e.location)); mv.set(e.id, c); } } await kitWait(2); } })();
    res.cover = await churn([...a, ...b], T); astop = true;
    const by = {}; for (const d0 of done) { const q = by[d0.act] ??= { n: 0, reached: 0, minSum: 0, secs: 0 }; q.n++; if (d0.min < 1.2) q.reached++; q.minSum += d0.min; q.secs += d0.secs; }
    res.coverArrive = Object.fromEntries(Object.entries(by).map(([k, q]) => [k, `${q.reached}/${q.n} reached, avg closest ${(q.minSum / q.n).toFixed(1)}, avg ${(q.secs / q.n).toFixed(1)}s`]));
    clear([...a, ...b]);
  }
  if (run("house")) {                                              // a house held upstairs, stormed
    floorAt(ox - 20, oz - 40, ox + 40, oz + 30);
    const B = (x0, y0, z0, x1, y1, z1, bl) => kfill(ox + x0, Y + y0, oz + z0, ox + x1, Y + y1, oz + z1, bl);
    B(0, 0, 0, 15, 9, 11, "stone_bricks"); B(1, 0, 1, 14, 8, 10, "air"); B(1, 4, 1, 14, 4, 10, "oak_planks");
    for (let i = 0; i < 4; i++) kset(ox + 2, Y + i, oz + 3 + i, STAIR("+z")); B(2, 4, 3, 2, 4, 7, "air");
    B(7, 0, 0, 8, 1, 0, "air"); for (const x of [4, 11]) B(x, 6, 0, x, 6, 0, "air");
    const d = [...Array(4).keys()].map((i) => kitSoldier(2, { x: ox + 6 + i * 1.5 + 0.5, y: Y + 5, z: oz + 6.5 }, ["rifle", "smg", "semi", "rifle"][i], "hold"));
    const a = [...Array(6).keys()].map((i) => kitSoldier(1, { x: ox + 3 + i * 2 + 0.5, y: Y, z: oz - 25.5 }, ["rifle", "smg", "semi", "rifle", "smg", "mg"][i], "hold"));
    tough([...a, ...d]); await kitWait(30); await kitOrder(1, { x: ox + 8, y: Y + 5, z: oz + 7 });
    const htr = []; const snap = () => htr.push([...a, ...d].map((e) => { if (!e.isValid) return "x"; const l = e.location, pr = personal.get(e.id); return `${Math.round(l.x - ox)},${Math.round(l.y - Y)},${Math.round(l.z - oz)}${downed.has(e.id) ? "D" : ""}${pr ? ":" + pr.kind + (pr.planning ? "P" : pr.pts ? pr.idx + "/" + pr.pts.length : "-") : ""}{${brain.get(e.id)?.role?.job ?? ""}/${squads.get(squadKey(e, sd(e)))?.bplan?.kind ?? ""}}[${(notes.get(e.id)?.text ?? "").slice(0, 22)}]`; }).join(" "));
    let hstop = false; if (o.tr) (async () => { while (!hstop) { snap(); await kitWait(40); } })();
    res.house = { att: await churn(a, T + 300) }; hstop = true; res.house.def = { inside: d.filter((e) => e.isValid && e.location.y > Y + 4).length }; if (o.tr) res.house.trace = htr;
    res.house.attUp = a.filter((e) => e.isValid && e.location.y > Y + 4).length;
    clear([...a, ...d]);
  }
  if (run("hounds")) {
    floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
    const ms = [kitSoldier(1, { x: ox - 15.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), kitSoldier(2, { x: ox + 15.5, y: Y, z: oz + 0.5 }, "rifle", "hold")];
    const hs = [];
    for (const m of ms) for (let i = 0; i < 3; i++) { const h = ow().spawnEntity(HOUND, { x: m.location.x + i - 1, y: Y, z: m.location.z + 2 }); sdp(h, "war:master", m.id); setP(h, "war:faction", Number(P(m, "war:faction"))); applyRelations(h); hs.push(h); }
    const foes = [0, 1, 2].map((i) => kitSoldier(2, { x: ox + 12.5, y: Y, z: oz - 4.5 + i * 4 }, "sword", "hold"));
    tough([...ms, ...hs, ...foes]); await kitWait(20);
    res.hounds = await churn(hs, T); res.hounds.alive = hs.filter((h) => h.isValid).length;
    clear([...ms, ...hs, ...foes]);
  }
  if (run("cav")) {
    floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
    for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
    const r = [kitCav(1, { x: ox - 20.5, y: Y, z: oz - 4.5 }, "sword", "minecraft:horse"), kitCav(1, { x: ox - 20.5, y: Y, z: oz + 0.5 }, "smg", "minecraft:horse"), kitCav(1, { x: ox - 20.5, y: Y, z: oz + 4.5 }, "spear", "minecraft:horse")];
    const f = [0, 1, 2, 3, 4].map((i) => kitSoldier(2, { x: ox + 12.5, y: Y, z: oz - 6.5 + i * 3 }, i % 2 ? "rifle" : "sword", "hold"));
    tough([...r, ...f]); await kitWait(40);
    const mounts = () => r.map((e) => e.getComponent("minecraft:riding")?.entityRidingOn).filter((m) => m?.isValid);
    res.cav = { riders: await churn(r, T) }; res.cav.horses = await churn(mounts(), 200); res.cav.foot = await churn(f, 200);
    for (const m of mounts()) try { m.remove(); } catch {}
    clear([...r, ...f]);
  }
  if (run("patrol")) {                                             // no enemy about: patrol and roam
    floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
    const p = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox - 10.5 + i * 2, y: Y, z: oz + 0.5 }, "rifle", "patrol"));
    const rm = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox + 10.5 + i * 2, y: Y, z: oz + 0.5 }, "rifle", "roam"));
    await kitWait(40);
    const ptr = []; let pstop = false; if (o.tr) (async () => { while (!pstop) { ptr.push(p.map((e) => { const l = e.location, st = getJSON(e, "war:st", {}), gm = marker(Number(gdp(e, "war:goal") ?? 0)), v = e.getVelocity(); return `${Math.round(l.x - ox)},${Math.round(l.z - oz)} ${st.g ?? ""} gm${gm ? flat(gm.location, l).toFixed(1) : "-"} v${Math.hypot(v.x, v.z).toFixed(2)} [${(notes.get(e.id)?.text ?? "").slice(0, 18)}]`; }).join(" | ")); await kitWait(20); } })();
    res.patrol = await churn(p, T); pstop = true; if (o.tr) res.patrol.trace = ptr; res.roam = await churn(rm, 200);
    clear([...p, ...rm]);
  }
  if (run("followfight")) {                                        // following you when the enemy turns up
    floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
    const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox + 0.5, y: Y, z: oz + 0.5 });
    globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
    const fs = [0, 1, 2, 3].map((i) => { const e = kitSoldier(1, { x: ox - 2.5 + i, y: Y, z: oz - 3.5 }, "rifle", "hold"); sdp(e, "war:squad", 0); giveFunction(e, "follow", ld); return e; });
    await kitWait(60);
    const en = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 3.5 + i * 3, y: Y, z: oz + 26.5 }, "rifle", "hold"));
    tough([...fs, ...en]);
    const ftr = []; let fstop = false; if (o.tr) (async () => { while (!fstop) { ftr.push(fs.map((e) => { const l = e.location, st = getJSON(e, "war:st", {}), gm = marker(Number(gdp(e, "war:goal") ?? 0)), v = e.getVelocity(), pr = personal.get(e.id); return `${Math.round(l.x - ox)},${Math.round(l.z - oz)} ${st.g ?? ""}/${st.s ?? ""} gm${gm ? flat(gm.location, l).toFixed(1) : "-"} v${Math.hypot(v.x, v.z).toFixed(2)} ${pr ? pr.kind + (pr.planning ? "P" : (pr.idx ?? 0) + "/" + (pr.pts?.length ?? 0)) : ""} {${brain.get(e.id)?.act ?? ""}} [${(notes.get(e.id)?.text ?? "").slice(0, 20)}]`; }).join(" | ")); await kitWait(20); } })();
    res.followfight = await churn(fs, T); fstop = true; if (o.tr) res.followfight.trace = ftr;
    res.followfight.stayed = fs.map((e) => Math.round(flat(e.location, ld.location)));
    globalThis.__fakeLeader = undefined; clear([...fs, ...en, ld]);
  }
  if (run("crew")) {                                               // a truck driven after you, the men aboard firing at an enemy off to the side
    floorAt(ox - 50, oz - 50, ox + 50, oz + 50);
    const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox + 35.5, y: Y, z: oz + 0.5 });
    globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
    const tr = ow().spawnEntity("war:truck", { x: ox - 25.5, y: Y, z: oz + 0.5 });
    const crew = [0, 1, 2].map((i) => { const e = kitSoldier(1, { x: ox - 25.5 + i, y: Y, z: oz + 2.5 }, "rifle", "hold"); giveFunction(e, "follow", ld); return e; });
    const en = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 5.5 + i * 6, y: Y, z: oz + 18.5 }, "rifle", "hold"));
    tough([...crew, ...en]); await kitWait(10);
    const rd = tr.getComponent("minecraft:rideable"); for (const e of crew) { try { e.teleport(tr.location); rd.addRider(e); } catch {} }
    await kitWait(5);
    res.crew = await churn(crew, 300); res.crew.aboard = rd.getRiders().length; res.crew.truckTo = Math.round(flat(tr.location, ld.location));
    res.crew.truck = await churn([tr], 100);
    globalThis.__fakeLeader = undefined; clear([...crew, ...en, tr, ld]);
  }
  if (run("medic")) {
    floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
    const men = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox - 4.5 + i * 3, y: Y, z: oz + 0.5 }, "rifle", "hold"));
    const med = ow().spawnEntity(SOLDIER, { x: ox + 0.5, y: Y, z: oz - 8.5 }, { spawnEvent: "war:init" });
    const mm = setupSoldier(med, { faction: 1, squad: 1, weapon: "rifle", ranged: true, div: "medic", radius: 8, func: "__none" }, KIT_PLAYER) ?? med; giveFunction(mm, "squad", KIT_PLAYER);
    await kitWait(40); goDown(men[0]); goDown(men[2]);
    const mtr = []; let mstop = false; if (o.tr) (async () => { while (!mstop) { const l = mm.location, pr = personal.get(mm.id), st = getJSON(mm, "war:st", {}); mtr.push(`${Math.round(l.x - ox)},${Math.round(l.z - oz)} ${st.g ?? ""}/${st.s ?? ""} ${pr ? pr.kind + (pr.planning ? "P" : (pr.idx ?? 0) + "/" + (pr.pts?.length ?? 0)) : ""} [${notes.get(mm.id)?.text ?? ""}] d0=${men[0].isValid ? flat(men[0].location, l).toFixed(1) + (downed.has(men[0].id) ? "D" : "") : "x"} d2=${men[2].isValid ? flat(men[2].location, l).toFixed(1) + (downed.has(men[2].id) ? "D" : "") : "x"}`); await kitWait(20); } })();
    const c = await churn([mm], 400); mstop = true;
    res.medic = { ...c, stillDown: [men[0], men[2]].filter((e) => e.isValid && downed.has(e.id)).length }; if (o.tr) res.medic.trace = mtr;
    clear([...men, mm]);
  }
  return res;
};
KS.cavtrace = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  for (const m of ow().getEntities({ type: "minecraft:horse", location: { x: ox, y: Y, z: oz }, maxDistance: 80 })) { try { m.remove(); } catch {} }
  setRelPair(1, 2, "1", true);
  const r = [kitCav(1, { x: ox - 20.5, y: Y, z: oz - 4.5 }, "sword", "minecraft:horse"), kitCav(1, { x: ox - 20.5, y: Y, z: oz + 0.5 }, "smg", "minecraft:horse"), kitCav(1, { x: ox - 20.5, y: Y, z: oz + 4.5 }, "spear", "minecraft:horse")];
  const f = [0, 1, 2, 3, 4].map((i) => kitSoldier(2, { x: ox + 12.5, y: Y, z: oz - 6.5 + i * 3 }, i % 2 ? "rifle" : "sword", "hold"));
  for (const e of [...r, ...f]) try { e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); e.addEffect("regeneration", 3000, { amplifier: 2, showParticles: false }); } catch {}
  await kitWait(40);
  const w = r[Number(o.i ?? 0)], tr = []; let last = "";
  for (let k = 0; k < Number(o.t ?? 200); k++) {
    await kitWait(1);
    const m = w.getComponent("minecraft:riding")?.entityRidingOn; if (!m) { tr.push(`${k}:off`); continue; }
    const v = m.getVelocity(), sp = Math.hypot(v.x, v.z), rr = w.getRotation();
    const s0 = `h${Math.round(m.getRotation().y)} r${Math.round(rr.y)}/${Math.round(rr.x)} sp${sp.toFixed(2)} ${getJSON(w, "war:st", {}).w ?? ""} ${notes.get(w.id)?.text ?? ""}`;
    if (s0 !== last) tr.push(`${k}:${s0}`); last = s0;
  }
  for (const e of [...r, ...f]) { try { e.getComponent("minecraft:riding")?.entityRidingOn?.remove(); } catch {} try { e.remove(); } catch {} }
  return { tr };
};
KS.pattrace = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const p = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox - 10.5 + i * 2, y: Y, z: oz + 0.5 }, "rifle", "patrol"));
  await kitWait(40);
  const tr = [], last = new Map(); let still = 0, want = 0;
  for (let k = 0; k < Number(o.t ?? 400); k++) {
    await kitWait(1);
    p.forEach((e, i) => {
      const l = e.location, v = e.getVelocity(), st = getJSON(e, "war:st", {}), gl = Number(gdp(e, "war:goal") ?? 0), gm = marker(gl), sp = Math.hypot(v.x, v.z);
      const tags = e.getTags().filter((t) => t.startsWith("war_gr") || t.startsWith("war_gc")).join(",");
      const mt = gm ? gm.getTags().filter((t) => t.startsWith("war_wr") || t.startsWith("war_wc")).join(",") : "";
      const gd = gm ? flat(gm.location, l) : -1;
      if (st.g === "g_wp" && gd > 3.2) { want++; if (sp < 0.015) still++; }
      const s0 = `${st.g}/${st.s} slot${gl} d${gd.toFixed(0)} ${tags}|${mt} ${sp < 0.015 ? "STILL" : "mv"} [${notes.get(e.id)?.text ?? ""}]`;
      if (last.get(i) !== s0) { tr.push(`${k} #${i} ${s0}`); last.set(i, s0); }
    });
  }
  for (const e of p) try { e.remove(); } catch {}
  return { stillPct: +(100 * still / Math.max(1, want)).toFixed(1), tr: tr.slice(0, 150) };
};
KS.crewtrace = async (o, ox, oz) => {
  floorAt(ox - 50, oz - 50, ox + 50, oz + 50);
  setRelPair(1, 2, "1", true);
  const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox + 35.5, y: Y, z: oz + 0.5 });
  globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
  const tr = ow().spawnEntity(o.v ?? "war:truck", { x: ox - 25.5, y: Y, z: oz + 0.5 });
  const crew = [0, 1, 2].map((i) => { const e = kitSoldier(1, { x: ox - 25.5 + i, y: Y, z: oz + 2.5 }, "rifle", "hold"); giveFunction(e, "follow", ld); return e; });
  const en = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 5.5 + i * 6, y: Y, z: oz + 18.5 }, "rifle", "hold"));
  for (const e of [...crew, ...en]) try { e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); } catch {}
  await kitWait(10);
  const rd = tr.getComponent("minecraft:rideable"); for (const e of crew) { try { e.teleport(tr.location); rd.addRider(e); } catch {} }
  await kitWait(5);
  const w = crew[Number(o.i ?? 1)], out = []; let last = "";
  for (let k = 0; k < 200; k++) {
    await kitWait(1);
    const r = w.getRotation(), s0 = `v${Math.round(tr.getRotation().y)} r${Math.round(r.y)}/${Math.round(r.x)} t:${gunState.get(w.id)?.target ? "Y" : "-"} ${notes.get(w.id)?.text ?? ""}`;
    if (s0 !== last) out.push(`${k}:${s0}`); last = s0;
  }
  const shotsRes = crew.map((c) => gunState.get(c.id)?.lastShot ?? -1).map((t) => t < 0 ? "never" : `${tick() - t} ticks ago`);
  globalThis.__fakeLeader = undefined; for (const e of [...crew, ...en, tr, ld]) try { e.remove(); } catch {}
  return { mo: mountOf.has(w.id), shots0: shotsRes, shots: crew.map((c) => gunState.get(c.id)?.lastShot ?? -1).map((t) => t < 0 ? "never" : `${tick() - t} ticks ago`), enemyHp: en.map((x) => x.isValid ? Math.round(x.getComponent("minecraft:health").currentValue) : "x"), out: out.slice(0, 30) };
};
KS.advtrace = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "1", true);
  const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox + 0.5, y: Y, z: oz + 0.5 });
  globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
  const fs = [0, 1, 2, 3].map((i) => { const e = kitSoldier(1, { x: ox - 2.5 + i, y: Y, z: oz - 3.5 }, "rifle", "hold"); sdp(e, "war:squad", 0); if (!o.hold) giveFunction(e, "follow", ld); return e; });
  await kitWait(60);
  const en = [0, 1, 2].map((i) => kitSoldier(2, { x: ox - 3.5 + i * 3, y: Y, z: oz + 26.5 }, "rifle", "hold"));
  for (const e of [...fs, ...en]) try { e.addEffect("resistance", 3000, { amplifier: 3, showParticles: false }); e.addEffect("regeneration", 3000, { amplifier: 2, showParticles: false }); } catch {}
  const out = [], last = new Map();
  for (let k = 0; k < 400; k++) {
    await kitWait(1);
    fs.forEach((e, i) => {
      const B = brain.get(e.id), st = getJSON(e, "war:st", {}), gm = marker(Number(gdp(e, "war:goal") ?? 0)), v = e.getVelocity(), sp = Math.hypot(v.x, v.z), gs = gunState.get(e.id);
      const yaw = e.getRotation().y, way = gm ? (Math.atan2(-(gm.location.x - e.location.x), gm.location.z - e.location.z) * 180) / Math.PI : yaw, off = Math.round(Math.abs(((yaw - way + 540) % 360) - 180) / 10) * 10;
      const s0 = `${B?.act ?? ""} ${st.g}/${st.s} mk${gm ? flat(gm.location, e.location).toFixed(0) : "-"} ${sp < 0.015 ? "STILL" : "mv"} off${off} pose${P(e, "war:pose") ?? ""} [${notes.get(e.id)?.text ?? ""}]`;
      if (last.get(i) !== s0) { out.push(`${k} #${i} ${s0}`); last.set(i, s0); }
    });
  }
  globalThis.__fakeLeader = undefined; for (const e of [...fs, ...en, ld]) try { e.remove(); } catch {}
  return { out: out.slice(0, 160) };
};
KS.rotmove = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const res = {};
  for (const off of [0, 45, 90, 135]) {
    const e = kitSoldier(1, { x: ox - 15.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
    await kitWait(10);
    const slot = myMarker(e, { x: ox + 20.5, y: Y, z: oz + 0.5 }, "war:mymk", 0.4); setGoal(e, slot); setGroups(e, { g: "g_wp", s: "s_4" });
    const x0 = e.location.x; let k = 0;
    for (; k < 120; k++) { await kitWait(1); if (off && k % 2 === 0) { try { e.setRotation({ x: 0, y: -90 + off }); } catch {} } }   // (yaw -90 faces +x)
    res[`off${off}`] = +((e.location.x - x0) / (k / 20)).toFixed(2);
    try { e.remove(); } catch {}
  }
  return res;
};
KS.marchtrace = async (o, ox, oz) => {
  floorAt(ox - 45, oz - 45, ox + 45, oz + 45);
  const m = [...Array(6).keys()].map((i) => kitSoldier(1, { x: ox - 30 + i * 2 + 0.5, y: Y, z: oz + 30.5 }, "rifle", "hold"));
  await kitWait(20);
  const ids = new Set(m.map((e) => e.id)), callers = {}, proto = Object.getPrototypeOf(m[0]), orig = proto.setRotation;
  proto.setRotation = function (r) { try { if (ids.has(this.id)) { const ln = (new Error().stack ?? "").split("\n").slice(2, 4).map((x) => x.trim().replace(/^at /, "").replace(/\(.*main\.js:?/, "(").replace(/\)$/, "")).join(" < "); callers[ln] = (callers[ln] ?? 0) + 1; } } catch {} return orig.call(this, r); };
  await kitOrder(1, { x: ox + 30.5, y: Y, z: oz + 30.5 }, "hold");
  const out = [], last = new Map();
  for (let k = 0; k < 400; k++) {
    await kitWait(1);
    m.forEach((e, i) => {
      const st = getJSON(e, "war:st", {}), gl = Number(gdp(e, "war:goal") ?? 0), gm = marker(gl), cu = Number(gdp(e, "war:catchup") ?? 0), v = e.getVelocity(), sp = Math.hypot(v.x, v.z);
      const yaw = e.getRotation().y, way = gm ? (Math.atan2(-(gm.location.x - e.location.x), gm.location.z - e.location.z) * 180) / Math.PI : yaw, off = Math.round(Math.abs(((yaw - way + 540) % 360) - 180) / 10) * 10;
      const s0 = `x${Math.round(e.location.x - ox)} ${st.g}/${st.s} goal${gl}${gl === cu ? "=cu" : ""} mk${gm ? flat(gm.location, e.location).toFixed(0) : "-"} ${sp < 0.015 ? "STILL" : "mv"} off${off} gl${gliders.has(e.id) ? 1 : 0} fm${formMode.has(e.id) ? 1 : 0} [${notes.get(e.id)?.text ?? ""}]`;
      if (last.get(i) !== s0) { out.push(`${k} #${i} ${s0}`); last.set(i, s0); }
    });
  }
  proto.setRotation = orig;
  for (const e of m) try { e.remove(); } catch {}
  return { callers, out: out.slice(0, 60) };
};
KS.mkmove = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const res = {};
  for (const mode of ["fixed8", "fixed20", "hop4every4", "hop1every4", "lead8"]) {
    const e = kitSoldier(1, { x: ox - 15.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
    await kitWait(10); try { e.setRotation({ x: 0, y: 0 }); } catch {}
    let tx = mode === "fixed20" ? 20 : 8;
    const slot = myMarker(e, { x: e.location.x + tx, y: Y, z: oz + 0.5 }, "war:mymk", 0.1); setGoal(e, slot); setGroups(e, { g: "g_wp", s: "s_4" });
    const x0 = e.location.x; let start = -1, still = 0;
    for (let k = 0; k < 100; k++) {
      await kitWait(1);
      const v = e.getVelocity(), sp = Math.hypot(v.x, v.z);
      if (start < 0 && sp > 0.03) start = k; if (start >= 0 && sp < 0.015) still++;
      if (k % 4 === 0) {
        const l = e.location;
        if (mode === "hop4every4") myMarker(e, { x: l.x + 8 + (k % 8 ? 2 : -2), y: Y, z: oz + 0.5 + (k % 8 ? 1 : -1) }, "war:mymk", 0.1);
        if (mode === "hop1every4") myMarker(e, { x: l.x + 8, y: Y, z: oz + 0.5 }, "war:mymk", 0.1);
        if (mode === "lead8") myMarker(e, { x: l.x + 8, y: Y, z: oz + 0.5 }, "war:mymk", 1.5);
      }
    }
    res[mode] = { startTick: start, speed: +((e.location.x - x0) / 5).toFixed(2), stillTicksAfterStart: still };
    try { e.remove(); } catch {}
  }
  return res;
};
KS.mkpark = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const res = {};
  for (const mode of (o.modes ? String(o.modes).split(",") : ["switch", "parked", "parkedPost", "switchPost"])) {
    const e = kitSoldier(1, { x: ox - 15.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
    globalThis.__noThink ??= new Set(); globalThis.__noThink.add(e.id);
    await kitWait(10); try { e.setRotation({ x: 0, y: 0 }); } catch {}
    const g0 = mode.includes("Post") ? "g_post" : "g_wp";
    if (mode.startsWith("parked")) { const sl = myMarker(e, { ...e.location }, "war:mymk", 0.1); setGoal(e, sl); setGroups(e, { g: g0, s: "s_4" }); }
    else setGroups(e, { g: "g_none", s: "s_4" });
    await kitWait(60);
    const sl = myMarker(e, { x: e.location.x + 8, y: Y, z: oz + 0.5 }, "war:mymk", 0.1); setGoal(e, sl); setGroups(e, { g: g0 });
    if (mode.includes("Face")) try { e.setRotation({ x: 0, y: -90 }); } catch {}
    if (mode.includes("Push")) try { e.applyImpulse({ x: 0.12, y: 0, z: 0 }); } catch {}
    const x0 = e.location.x; const at = {};
    for (let k = 1; k <= 80; k++) { await kitWait(1); if ([5, 10, 20, 40].includes(k)) at[k] = +(e.location.x - x0).toFixed(1); }
    res[mode] = { at, moved: +(e.location.x - x0).toFixed(1) };
    globalThis.__noThink.delete(e.id); try { e.remove(); } catch {}
  }
  return res;
};
// v9.21.1: bodies never stay forever: from an earlier load, unstamped (older versions), past 10 minutes, back in loaded ground
KS.bodies = async (o, ox, oz) => {
  floorAt(ox - 20, oz - 20, ox + 20, oz + 20);
  const dim = ow(), r = { loadEvent: !!world.afterEvents.entityLoad };
  const mk = (dx) => dim.spawnEntity("war:corpse", { x: ox + dx + 0.5, y: Y, z: oz + 0.5 });
  const prev = mk(-6); prev.setDynamicProperty("war:bs", BODY_SESSION + 1); prev.setDynamicProperty("war:bt", tick());   // an earlier load's
  const bare = mk(-3);                                                                                                // an older version's (no stamp)
  const v = kitSoldier(1, { x: ox + 3.5, y: Y, z: oz + 0.5 }, "rifle", "hold"); await kitWait(10);
  try { v.applyDamage(500); } catch {} await kitWait(60);
  const fresh = dim.getEntities({ type: "war:corpse", location: { x: ox + 3.5, y: Y, z: oz + 0.5 }, maxDistance: 4 })[0];
  r.freshStamped = !!fresh && fresh.getDynamicProperty("war:bs") === BODY_SESSION;
  const n1 = sweepBodies(); await kitWait(5);
  r.firstSweep = { cleared: n1, prevGone: !prev.isValid, bareGone: !bare.isValid, freshKept: !!fresh?.isValid };
  // forgotten (as if it was unloaded and dropped from the list): counted again, not cleared
  if (fresh?.isValid) { const i = CORPSES.findIndex((q) => q.id === fresh.id); if (i >= 0) CORPSES.splice(i, 1); }
  sweepBodies(); r.recounted = !!fresh && CORPSES.some((q) => q.id === fresh.id);
  // past 10 minutes
  if (fresh?.isValid) fresh.setDynamicProperty("war:bt", tick() - BODY_LIFE - 20);
  sweepBodies(); await kitWait(5); r.expiredGone = !fresh?.isValid;
  for (const e of [prev, bare, fresh, v]) try { e?.remove(); } catch {}
  return r;
};
// v9.21.2: a prisoner's guards fall one by one: the next of the same group takes him each time; all gone, a third side at
// war with him takes him; left alone in their charge's absence, a passing enemy picks him up
KS.powchain = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  setRelPair(1, 2, "1", false); setRelPair(3, 2, "1", false); setRelPair(1, 3, "0", false);
  const tough = (e) => { try { e.addEffect("resistance", 3000, { amplifier: 255, showParticles: false }); } catch {} return e; };
  const g = [0, 1, 2].map((i) => { const e = tough(kitSoldier(1, { x: ox - 4.5 + i * 3, y: Y, z: oz + 0.5 }, "rifle", "hold")); sdp(e, "war:squad", 4); sdp(e, "war:home", undefined); return e; });
  const p = tough(kitSoldier(2, { x: ox + 0.5, y: Y, z: oz + 3.5 }, "rifle", "hold"));
  await kitWait(20);
  soldierTakes(p, g[0]);
  const cap = () => { const pw = pows.get(p.id); return pw ? world.getEntity(pw.captor) : undefined; };
  const who = () => { const pw = pows.get(p.id); const c = cap(); return pw ? `${pw.mode}:f${pw.cf}:${c ? (g.indexOf(c) >= 0 ? "g" + g.indexOf(c) : "f" + P(c, "war:faction")) : "none"}` : "free"; };
  const r = { start: who(), steps: [] };
  for (let k = 0; k < 2; k++) { cap()?.remove(); await kitWait(60); r.steps.push(who()); }   // his guard falls: the next of the group
  const third = tough(kitSoldier(3, { x: ox + 8.5, y: Y, z: oz + 10.5 }, "rifle", "hold"));
  await kitWait(20); cap()?.remove(); await kitWait(80); r.steps.push(who());          // the last of the group gone: the third side has him
  r.distToThird = +flat(p.location, third.location).toFixed(1);
  third.remove(); await kitWait(80); r.alone = who();                                 // nobody left: left where he is
  const passer = tough(kitSoldier(1, { x: p.location.x + 12.5, y: Y, z: p.location.z + 0.5 }, "rifle", "hold"));
  await kitWait(100); r.picked = who(); r.alive = p.isValid;
  for (const e of [passer, p, ...g]) try { e.remove(); } catch {}
  setRelPair(3, 2, "0", false);
  return r;
};
// v9.21.3: his own side all round him: a surrendered man is back in the fight, a prisoner is freed (guard or not);
// not with only two of them, nor when the enemy round him outnumbers them
KS.rejoin = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  setRelPair(1, 2, "1", false);
  const tough = (e) => { try { e.addEffect("resistance", 3000, { amplifier: 255, showParticles: false }); e.addEffect("weakness", 3000, { amplifier: 255, showParticles: false }); } catch {} return e; };
  const all = [], sp = (f, x, z) => { const e = tough(kitSoldier(f, { x: ox + x + 0.5, y: Y, z: oz + z + 0.5 }, "rifle", "hold")); all.push(e); return e; };
  const st = (e) => pows.has(e.id) ? "prisoner" : gdp(e, "war:surr") ? "surrendered" : "free";
  const r = {};
  // 1. a man who surrendered (his captor gone), then three of his own come up
  { const en = sp(1, -30, -30), m = sp(2, -30, -27); await kitWait(10); isoSurrender(m, 1); en.remove(); await kitWait(10);
    r.surrBefore = st(m); for (let i = 0; i < 3; i++) sp(2, -33 + i * 3, -24); await kitWait(100);
    r.surrAfter = st(m); r.surrArmed = Number(P(m, "war:gun") ?? 0) > 0 || sd(m).weapon === "sword"; r.hands = !!P(m, "war:hands"); }
  // 2. a prisoner with his guard right there: three of his own come up
  { const g = sp(1, 0, -30), p = sp(2, 0, -27); await kitWait(10); soldierTakes(p, g); sdp(g, "war:home", undefined); await kitWait(20);
    r.guardedBefore = st(p); for (let i = 0; i < 3; i++) sp(2, -3 + i * 3, -24); await kitWait(100); r.guardedAfter = st(p); }
  // 3. only two of his own
  { const g = sp(1, 30, -30), p = sp(2, 30, -27); await kitWait(10); soldierTakes(p, g); await kitWait(20);
    for (let i = 0; i < 2; i++) sp(2, 28 + i * 3, -24); await kitWait(100); r.twoOnly = st(p); }
  // 4. three of his own, but four of the enemy round him
  { const gs = [0, 1, 2, 3].map((i) => sp(1, -30 + i * 2, 20)), p = sp(2, -27, 23); await kitWait(10); soldierTakes(p, gs[0]); await kitWait(20);
    for (let i = 0; i < 3; i++) sp(2, -30 + i * 3, 26); await kitWait(100); r.outnumbered = st(p); }
  for (const e of all) try { e.remove(); } catch {}
  return r;
};
KS.homeorder = async (o, ox, oz) => {
  floorAt(ox - 40, oz - 40, ox + 40, oz + 40);
  const fl = ow().spawnEntity(FLAG, { x: ox + 30.5, y: Y, z: oz + 0.5 }); setP(fl, "war:faction", 1); setP(fl, "war:rally", false); sdp(fl, "war:hq", true); claimSlot(fl);
  const men = [0, 1, 2, 3].map((i) => kitSoldier(1, { x: ox - 25.5 + i, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  await kitWait(20);
  const r = { hq: hqFlag(ow(), men[0].location, 1)?.id === fl.id };
  await giveOrderInner(KIT_PLAYER, { faction: 1, order: ORDERS.findIndex((x) => x[0] === "home"), squad: 0, count: 0, radius: 400, stance: "aggressive", ao: 100, free: true }, men);
  await kitWait(500);
  r.distToHq = men.map((e) => Math.round(flat(e.location, fl.location)));
  r.who = men.map((e) => { const d = sd(e), pr = personal.get(e.id); return `${d.func}/${notes.get(e.id)?.text ?? ""}/${pr ? pr.kind : "-"}/scout${SCOUTS.has(e.id) ? 1 : 0}/watch${[...DAYWATCH.values()].some((W) => W.ids.includes(e.id)) ? 1 : 0}/${getJSON(e, "war:st", {}).g}`; });
  // healing at the HQ
  const h = men[0].getComponent("minecraft:health"); h.setCurrentValue(8); await kitWait(400); r.healedTo = Math.round(h.currentValue);
  for (const e of men) try { e.remove(); } catch {} try { fl.remove(); } catch {}
  return r;
};
KS.watch = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  kcmd("time set noon");
  const men = [...Array(8).keys()].map((i) => kitSoldier(1, { x: ox - 4 + i + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"));
  for (const e of men) sdp(e, "war:ordt", -999999);
  await kitWait(400);
  const W = DAYWATCH.get(squadKey(men[0], sd(men[0])));
  const c = { x: men.reduce((a, e) => a + e.location.x, 0) / 8, z: men.reduce((a, e) => a + e.location.z, 0) / 8 };
  const r = { watchers: W?.ids.length ?? 0, out: (W?.ids ?? []).map((id) => { const e = world.getEntity(id); return e ? `${Math.round(flat(e.location, { x: ox, z: oz }))}:${notes.get(id)?.text}` : "-"; }) };
  for (const e of men) try { e.remove(); } catch {}
  return r;
};
// v9.19: missions, driven the way the menu sets them up
KS.missions = async (o, ox, oz) => {
  floorAt(ox - 60, oz - 60, ox + 60, oz + 60);
  globalThis.__fakeLeader = (id) => (id === KIT_PLAYER.id ? KIT_PLAYER : undefined);
  const r = {}, dim = ow();
  // attack / defend
  setRelPair(1, 2, "1", true);
  const obj = { x: ox + 0.5, y: Y, z: oz + 0.5 };
  const defs = msSpawn(KIT_PLAYER, dim, obj, 1, 6, "rifle", "hold", MS_SQ.def, 5);
  const atts = msSpawn(KIT_PLAYER, dim, { x: ox + 0.5, y: Y, z: oz - 45.5 }, 2, 10, "mixguns", "hold", MS_SQ.att, 3);
  await kitWait(40); msMarch(KIT_PLAYER, atts, 2, MS_SQ.att, obj);
  MISSION = { kind: "Attack / Defend", type: "ad", dim: dim.id, obj, defs, atts, df: 1, af: 2, end: tick() + (o.t ?? 1600), t0: tick() };
  let k = 0; while (MISSION && k < 90) { await kitWait(20); k++; }
  r.ad = { over: !MISSION, secs: k, defLeft: msUp(defs).length, attLeft: msUp(atts).length };
  MISSION = undefined;
  for (const e of [...defs, ...atts]) try { e.remove(); } catch {}
  // escort
  const A = { x: ox - 40.5, y: Y, z: oz + 30.5 }, B = { x: ox + 40.5, y: Y, z: oz + 30.5 };
  const vip = msSpawn(KIT_PLAYER, dim, A, 1, 1, "sword", "hold", MS_SQ.esc, 1)[0]; if (!vip) { globalThis.__fakeLeader = undefined; r.esc = "VIP not placed (unloaded ground?)"; return r; } sdp(vip, "war:custom", "§6VIP");
  const esc = msSpawn(KIT_PLAYER, dim, A, 1, 3, "rifle", "hold", MS_SQ.esc, 3);
  await kitWait(30); msMarch(KIT_PLAYER, [vip, ...esc], 1, MS_SQ.esc, B);
  MISSION = { kind: "Escort", type: "esc", dim: dim.id, vip, esc, ambs: [], B, vf: 1, ef: 2, t0: tick() };
  k = 0; while (MISSION && k < 60) { await kitWait(20); k++; }
  r.esc = { over: !MISSION, secs: k, vipTogo: vip.isValid ? Math.round(flat(vip.location, B)) : -1 };
  MISSION = undefined;
  for (const e of [vip, ...esc]) try { e.remove(); } catch {}
  globalThis.__fakeLeader = undefined;
  return r;
};
KS.waves = async (o, ox, oz) => {
  floorAt(ox - 60, oz - 60, ox + 60, oz + 60);
  globalThis.__fakeLeader = (id) => (id === KIT_PLAYER.id ? KIT_PLAYER : undefined);
  setRelPair(1, 2, "1", true);
  MISSION = { kind: "Wave survival", type: "wave", dim: "minecraft:overworld", pid: KIT_PLAYER.id, ef: 2, n0: 3, grow: 2, gap: 200, mix: "rifle", far: 40, wave: 0, next: tick() + 20, men: [], t0: tick(), kills: 0 };
  const seen = [];
  for (let k = 0; k < 25; k++) { await kitWait(20); seen.push(`${MISSION?.wave}:${MISSION ? msUp(MISSION.men).length : "-"}`); }
  const near = MISSION ? msUp(MISSION.men).map((e) => Math.round(flat(e.location, KIT_PLAYER.location))) : [];
  for (const e of MISSION?.men ?? []) try { e.remove(); } catch {}
  MISSION = undefined; globalThis.__fakeLeader = undefined;
  return { seen: seen.join(" "), distToPlayer: near };
};
KS.wallbody = async (o, ox, oz) => {
  floorAt(ox - 15, oz - 15, ox + 15, oz + 15);
  kfill(ox - 3, Y, oz + 2, ox + 3, Y + 3, oz + 2, "stone");
  const res = {};
  for (const [name, at] of [["wall", { x: ox + 0.5, y: Y, z: oz + 1.3 }], ["open", { x: ox + 8.5, y: Y, z: oz - 8.5 }]]) {
    const e = kitSoldier(1, at, "rifle", "hold"); await kitWait(10);
    const before = new Set(CORPSES.map((q) => q.id));
    killHow.set(e.id, { limb: 0, dir: { x: 0, y: 0, z: 1 }, power: 0.3 }); killReal(e);
    await kitWait(120);
    const c = CORPSES.find((q) => !before.has(q.id)), st = c && RD.get(c.id);
    res.n = allOf(SOLDIER).length; res.lod = lodOn(); res.perf = perfLevel();
    res[name] = st ? { t: st.t, headUp: +(st.pts[4].p.y - Y).toFixed(2), hipUp: +(((st.pts[0].p.y + st.pts[1].p.y) / 2) - Y).toFixed(2) } : "no body state";
  }
  kfill(ox - 3, Y, oz + 2, ox + 3, Y + 3, oz + 2, "air");
  return res;
};
// v9.19: the one-record identity: an old soldier (separate keys) is moved over on first read, nothing lost
KS.idrec = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(5);
  ID_CACHE.delete(e.id); sdp(e, "war:id", undefined);
  for (const [k, v] of [["war:nseed", 123456], ["war:xp", 14], ["war:trait", "brave"], ["war:nick", "Lucky"], ["war:nk_save", 2]]) sdp(e, k, v);
  const r = { name: soldierName(e), xp: xpOf(e), trait: traitOf(e), rec: String(gdp(e, "war:id")), oldLeft: ["war:nseed", "war:xp", "war:trait", "war:nick", "war:nk_save"].filter((k) => gdp(e, k) !== undefined) };
  creditSave(e); r.afterSave = idRec(e).c;
  // settings code round trip
  const code = settingsCode(); sdp(world, "war:set_vfreq", 2); const n = loadSettingsCode(code); r.codeLen = code.length; r.loaded = n; r.vfreqBack = setting("vfreq", 1);
  try { e.remove(); } catch {}
  return r;
};
KS.raytype = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 15);
  kfill(ox - 4, Y, oz + 5, ox + 4, Y + 3, oz + 5, o.b ?? "oak_planks"); await kitWait(10);
  const h = { x: ox + 0.5, y: Y + 1.62, z: oz - 2.5 }, u = { x: 0, y: -0.04, z: 1 }; const L = Math.hypot(u.x, u.y, u.z); u.x /= L; u.y /= L; u.z /= L;
  const hb = ow().getBlockFromRay(h, u, { maxDistance: 30, includeLiquidBlocks: false, includePassableBlocks: false });
  const rh = rayHit(ow(), h, u, 30);
  return { direct: ow().getBlock({ x: ox, y: Y + 1, z: oz + 5 })?.typeId, rayBlock: hb?.block?.typeId, rayLoc: hb?.block?.location, rhType: rh?.hb?.block?.typeId, pierce: rh ? pierces(rh.hb.block.typeId) : null };
};
// v9.19: soldiers at the wheel drive the truck / troop boat after the man they follow
KS.crewdrive = async (o, ox, oz) => {
  floorAt(ox - 50, oz - 50, ox + 50, oz + 50);
  const res = {};
  const ld = ow().spawnEntity("minecraft:armor_stand", { x: ox + 35.5, y: Y, z: oz + 0.5 });
  globalThis.__fakeLeader = (id) => (id === ld.id ? ld : undefined);
  // truck on the ground
  const tr = ow().spawnEntity("war:truck", { x: ox - 10.5, y: Y, z: oz + 0.5 });
  const crew = [0, 1, 2].map((i) => { const e = kitSoldier(1, { x: ox - 10.5 + i, y: Y, z: oz + 2.5 }, "rifle", "hold"); giveFunction(e, "follow", ld); return e; });
  await kitWait(10);
  const rd = tr.getComponent("minecraft:rideable"); for (const e of crew) { try { e.teleport(tr.location); rd.addRider(e); } catch {} }
  await kitWait(5); res.truckRiders = rd.getRiders().length;
  const t0 = flat(tr.location, ld.location); await kitWait(300); res.truck = { start: Math.round(t0), end: Math.round(flat(tr.location, ld.location)), aboard: rd.getRiders().length };
  for (const e of crew) try { e.remove(); } catch {} try { tr.remove(); } catch {}
  // troop boat on a lake
  kfill(ox - 30, Y - 3, oz + 15, ox + 30, Y - 1, oz + 35, "water");
  ld.teleport({ x: ox + 28.5, y: Y, z: oz + 25.5 });
  const bt = ow().spawnEntity("war:boat", { x: ox - 25.5, y: Y - 1, z: oz + 25.5 });
  const bc = [0, 1].map((i) => { const e = kitSoldier(1, { x: ox - 25.5, y: Y, z: oz + 13.5 + i }, "rifle", "hold"); giveFunction(e, "follow", ld); return e; });
  await kitWait(10);
  const rb = bt.getComponent("minecraft:rideable"); for (const e of bc) { try { e.teleport(bt.location); rb.addRider(e); } catch {} }
  await kitWait(5); res.boatRiders = rb.getRiders().length;
  const b0 = flat(bt.location, ld.location); await kitWait(300); res.boat = { start: Math.round(b0), end: Math.round(flat(bt.location, ld.location)), aboard: rb.getRiders().length };
  for (const e of bc) try { e.remove(); } catch {} try { bt.remove(); } catch {}
  kfill(ox - 30, Y - 3, oz + 15, ox + 30, Y - 1, oz + 35, "stone");
  globalThis.__fakeLeader = undefined; try { ld.remove(); } catch {}
  return res;
};
// micro-benchmarks of the hottest little calls (ms per 100k)
KS.micro = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(10);
  const dim = e.dimension, N = 100000, r = {};
  const T = (k, f) => { const t = Date.now(); for (let i = 0; i < N; i++) f(i); r[k] = Date.now() - t; };
  T("empty", () => {});
  T("dim.id", () => dim.id);
  T("e.dimension", () => e.dimension);
  T("e.location", () => e.location);
  T("e.id", () => e.id);
  T("e.isValid", () => e.isValid);
  T("bkey", (i) => bkey("minecraft:overworld", ox + (i & 7), Y, oz));
  T("tBlock cached", (i) => tBlock(dim, ox + (i & 7), Y - 1, oz));
  T("gdp", () => gdp(e, "war:goal"));
  T("sd", () => sd(e));
  T("P", () => P(e, "war:faction"));
  T("standAt", (i) => standAt(dim, Math.floor(ox) + (i & 7), Y, Math.floor(oz)));
  T("dangerNear", (i) => dangerNear(dim, { x: ox + (i & 7), y: Y, z: oz }));
  T("Math.hypot", (i) => Math.hypot(i, 2, 3));
  T("getRotation", () => e.getRotation());
  T("getVelocity", () => e.getVelocity());
  const N2 = 5000, R = (k, f) => { const t = Date.now(); for (let i = 0; i < N2; i++) f(i); r[k] = +((Date.now() - t) * 100000 / N2).toFixed(0); };
  R("ray 10 (per 100k)", (i) => rayHit(dim, { x: ox + 0.5, y: Y + 1.6, z: oz + 0.5 }, { x: 1, y: 0, z: 0 }, 10));
  R("ray 40 (per 100k)", (i) => rayHit(dim, { x: ox + 0.5, y: Y + 1.6, z: oz + 0.5 }, { x: 0.7071, y: 0, z: 0.7071 }, 40));
  R("nearSnap (per 100k)", (i) => nearSnap(dim.id, { x: ox, y: Y, z: oz }, 30));
  R("getEntities r30 (per 100k)", (i) => dim.getEntities({ location: { x: ox, y: Y, z: oz }, maxDistance: 30 }));
  return r;
};
// v9.22: a wounded man's falling body removed mid-fall (cleanup, a blast swap): he must not stay hidden
KS.fallrm = async (o, ox, oz) => {
  floorAt(ox - 10, oz - 10, ox + 10, oz + 10);
  for (const c of ow().getEntities({ type: "war:corpse" })) { try { c.remove(); } catch {} }
  const a = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold"), b = kitSoldier(1, { x: ox + 4.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(60);
  for (const e of [a, b]) { e.getComponent("minecraft:health").setCurrentValue(2); }
  await kitWait(2);
  for (const e of [a, b]) { lastHit.set(e.id, { t: tick(), dir: { x: 1, y: 0, z: 0 }, weapon: "rifle", dd: 10 }); e.applyDamage(3); }
  await kitWait(3);
  const mid = { hidden: [a, b].map((e) => !!e.getProperty("war:hide")), falling: [a, b].map((e) => FALLS.has(e.id)) };
  try { world.getEntity(FALLS.get(a.id))?.remove(); } catch {}   // a: his body is simply removed (as cleanup did)
  await kitWait(80);                                              // b: falls normally
  const end = { hidden: [a, b].map((e) => !!e.getProperty("war:hide")), falling: [a, b].map((e) => FALLS.has(e.id)), downed: [a, b].map((e) => downed.has(e.id)) };
  for (const e of [a, b]) { try { revive(e); } catch {} }
  await kitWait(20);
  for (const e of [a, b]) try { e.remove(); } catch {}
  return { mid, end, ok: !end.hidden[0] && !end.hidden[1] };
};
// can the entity getters be wrapped (per-tick memory), and what does it cost
KS.patchprobe = async (o, ox, oz) => {
  floorAt(ox - 8, oz - 8, ox + 8, oz + 8);
  const e = kitSoldier(1, { x: ox + 0.5, y: Y, z: oz + 0.5 }, "rifle", "hold");
  await kitWait(10);
  const EP = Object.getPrototypeOf(Player.prototype), r = { proto: EP?.constructor?.name };
  for (const k of ["location", "dimension", "isValid", "id"]) { let pd; for (let p = EP; p && !pd; p = Object.getPrototypeOf(p)) pd = Object.getOwnPropertyDescriptor(p, k); r["pd_" + k] = pd ? { get: !!pd.get, conf: pd.configurable, own: !!Object.getOwnPropertyDescriptor(EP, k) } : (Object.getOwnPropertyDescriptor(e, k) ? "instance" : "none"); }
  for (const k of ["teleport", "remove", "tryTeleport"]) { const pd = Object.getOwnPropertyDescriptor(EP, k); r[k] = pd ? { w: pd.writable, conf: pd.configurable } : "none"; }
  const all = allOf(SOLDIER); r.sameObj = all[0] === allOf(SOLDIER)[0]; const g1 = world.getEntity(e.id), g2 = world.getEntity(e.id); r.getEntitySame = g1 === g2; r.getEntityVsList = g1 === all.find((x) => x.id === e.id);
  const N = 50000, T = (k, f) => { const t = Date.now(); for (let i = 0; i < N; i++) f(i); r[k] = +((Date.now() - t) * 100000 / N).toFixed(0); };
  const WM = new WeakMap(), MM = new Map();
  T("location", () => e.location); T("dimension", () => e.dimension); T("isValid", () => e.isValid); T("id", () => e.id);
  WM.set(e, { t: 1, l: e.location }); MM.set(e.id, { t: 1, l: e.location });
  T("weakmap get", () => { const c = WM.get(e); return c && c.t === 1 ? c.l : 0; });
  T("map by id get", () => { const c = MM.get(e.id); return c && c.t === 1 ? c.l : 0; });
  return r;
};
// v9.22: the stair-entrance search, old sweep vs new (steps first): same answers, and how long each takes
KS.mouths = async (o, ox, oz) => {
  floorAt(ox - 30, oz - 30, ox + 30, oz + 30);
  kfill(ox - 6, Y, oz - 6, ox + 6, Y + 3, oz + 6, "stone"); kfill(ox - 6, Y + 4, oz - 6, ox + 6, Y + 8, oz + 6, "air");   // a raised block, 4 high, roof open
  for (let i = 0; i < 4; i++) kset(ox + 7 + i, Y + 3 - i, oz, STAIR("-x"));            // stairs down to +x
  for (let i = 0; i < 4; i++) kset(ox, Y + 3 - i, oz - 7 - i, STAIR("+z"));            // stairs down to -z
  for (let i = 0; i < 4; i++) kset(ox - 7, Y + i, oz + 3, "ladder");                   // a ladder on the -x side
  kfill(ox + 14, Y, oz + 10, ox + 18, Y + 1, oz + 14, "stone"); kset(ox + 13, Y, oz + 12, STAIR("+x")); kset(ox + 13, Y + 1, oz + 12, "air");   // a little step-up
  await kitWait(10); terrainForget();
  const old = (dim, at, R) => {
    const fy = Math.floor(at.y + 0.01), now = tick(), raw = [], bx = Math.floor(at.x), bz = Math.floor(at.z);
    try { for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) { const x = bx + dx, z = bz + dz;
      if (!standAt(dim, x, fy, z, now) || stairish(tBlock(dim, x + 0.5, fy - 1, z + 0.5))) continue;
      for (const [qx, qz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const s1 = tBlock(dim, x + qx + 0.5, fy - 1, z + qz + 0.5), s2 = tBlock(dim, x + qx + 0.5, fy - 2, z + qz + 0.5); if (stairish(s1) || (stairish(s2) && passable(s1))) { raw.push({ x: x + 0.5, y: fy, z: z + 0.5 }); break; } } } } catch {}
    const list = []; for (const p of raw) { const m = list.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 3.5); if (m) { m.n++; m.x += (p.x - m.x) / m.n; m.z += (p.z - m.z) / m.n; } else list.push({ ...p, n: 1 }); } return list; };
  const dim = ow(), r = { cases: [], same: 0, diff: 0 };
  let tOld = 0, tNew = 0;
  for (const [px, py, pz, R] of [[ox, Y + 4, oz, 18], [ox, Y + 4, oz, 6], [ox, Y + 4, oz, 32], [ox + 12, Y, oz, 18], [ox - 10, Y, oz - 10, 24], [ox + 14, Y, oz + 12, 6], [ox + 16, Y + 2, oz + 12, 8]]) {
    MOUTHS.clear(); terrainForget();
    let t = Date.now(); const a = old(dim, { x: px, y: py, z: pz }, R); tOld += Date.now() - t;
    terrainForget(); MOUTHS.clear();
    t = Date.now(); const b = stairMouths(dim, { x: px, y: py, z: pz }, R); tNew += Date.now() - t;
    const sa = JSON.stringify(a.map((m) => [m.x.toFixed(2), m.y, m.z.toFixed(2), m.n])), sb = JSON.stringify(b.map((m) => [m.x.toFixed(2), m.y, m.z.toFixed(2), m.n]));
    if (sa === sb) r.same++; else { r.diff++; r.cases.push({ at: [px - ox, py - Y, pz - oz, R], old: sa.slice(0, 200), new: sb.slice(0, 200) }); }
  }
  r.msOld = tOld; r.msNew = tNew;
  return r;
};
// v9.23: battle pace on the real game: two lines of n facing each other `dist` apart, holding; ends when one side has
// <= 25% on its feet (or `max` ticks). pace=normal|fast|slow sets the Battle pace for this run.
// world-level state (settings, faction data) as the soldiers see it
KS.wdp = async () => { const o = {}; for (const id of world.getDynamicPropertyIds()) { const v = world.getDynamicProperty(id); const t = typeof v === "string" ? v.slice(0, 160) : v; if (!/^war:(chron|purge|blk|dp|idr|cache)/.test(id)) o[id] = t; } return o; };
KS.pace = async (o, ox, oz) => {
  const n = Number(o.n ?? 10), D = Number(o.dist ?? 50), max = Number(o.max ?? 4800);
  if (o.pace) sdp(world, "war:set_pace", String(o.pace));
  floorAt(ox - 30, oz - D / 2 - 12, ox + 30, oz + D / 2 + 12);
  for (const [x, z] of [[-14, -10], [10, -14], [0, -4], [16, -6]]) for (const k of [1, -1]) kfill(Math.min(ox + x * k, ox + x * k + 3 * k), Y, oz + z * k, Math.max(ox + x * k, ox + x * k + 3 * k), Y, oz + z * k, "cobblestone");
  terrainForget();
  setRelPair(1, 2, "1", false);
  const W8 = ["rifle", "smg", "semi", "mg", "rifle", "semi", "smg", "rifle"], a = [], b = [];
  for (let i = 0; i < n; i++) {
    const x = (i % 8) * 2.5 - 8.75;
    const fl = o.flip ? -1 : 1;   // (flip=1: faction 1 on the other side: is it the side or the faction?)
    const mk1 = () => { const s1 = kitSoldier(1, { x: ox - fl * x, y: Y, z: oz - fl * (D / 2 + Math.floor(i / 8) * 2.5) + 0.5 }, W8[i % 8], "hold"); s1.setRotation({ x: 0, y: fl > 0 ? 0 : 180 }); a.push(s1); };
    const mk2 = () => { const s2 = kitSoldier(2, { x: ox + fl * x, y: Y, z: oz + fl * (D / 2 + Math.floor(i / 8) * 2.5) + 0.5 }, W8[i % 8], "hold"); s2.setRotation({ x: 0, y: fl > 0 ? 180 : 0 }); b.push(s2); };
    if (o.order) { mk2(); mk1(); } else { mk1(); mk2(); }   // (order=1: faction 2 spawned first)
  }
  const up = (L) => L.filter((e) => e.isValid && !downed.has(e.id) && !isDown(e)).length;
  const t0 = tick(); let firstDown = -1, t = 0;
  if (globalThis.__FD) globalThis.__FD = {};
  await kitLoop(max, () => { t = tick() - t0; if (firstDown < 0 && (up(a) < n || up(b) < n)) firstDown = t; return up(a) <= n * 0.25 || up(b) <= n * 0.25; });
  const r = { pace: String(setting("pace", "normal")), seconds: +((tick() - t0) / 20).toFixed(1), firstDownS: +(firstDown / 20).toFixed(1), up1: up(a), up2: up(b), winner: up(a) > up(b) ? 1 : up(b) > up(a) ? 2 : 0, ...kitShotStats(t0), fd: globalThis.__FD };
  sdp(world, "war:set_pace", undefined);
  for (const e of [...a, ...b]) try { e.remove(); } catch {}
  return r;
};
