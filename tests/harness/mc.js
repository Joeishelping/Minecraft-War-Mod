// Headless stand-in for @minecraft/server, good enough to run War Engine's main.js against a voxel world.
// It is NOT Minecraft: vanilla navigation, physics and the gun pack are approximated. Its job is to catch crashes,
// measure API cost per tick (the real source of lag in Bedrock scripts), and replay scenarios (stairs, buildings,
// downed soldiers, big battles) the same way every time so before/after changes can be compared.
import fs from "node:fs";
import path from "node:path";

export const SIM = {
  tick: 0, loading: true, calls: new Map(), entities: new Map(), blocks: new Map(), states: new Map(),
  bounds: { x0: -200, x1: 200, z0: -200, z1: 200, y0: -10, y1: 120 }, groundY: 0, nextId: 1,
  intervals: [], timeouts: [], callsBy: new Map(), cur: undefined, seed: 1, log: [], shots: [], hits: 0, defs: {}, dynWorld: new Map(),
  errors: [], gameMode: "creative",
};
const count = (k) => { SIM.calls.set(k, (SIM.calls.get(k) ?? 0) + 1); if (SIM.cur) { const m = SIM.callsBy.get(SIM.cur) ?? new Map(); m.set(k, (m.get(k) ?? 0) + 1); SIM.callsBy.set(SIM.cur, m); } };
// deterministic random (scenarios replay the same way)
let rs = 12345;
export function seed(n) { rs = n >>> 0 || 1; }
Math.random = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };

// ---------------------------------------------------------------- blocks
const PASS = ["short_grass", "tall_grass", "fern", "flower", "torch", "carpet", "pressure_plate", "ladder", "vine", "button", "sign", "rail"];
const k3 = (x, y, z) => `${x},${y},${z}`;
export function setBlock(x, y, z, id) { if (id === "air" || id === "minecraft:air") SIM.blocks.delete(k3(x, y, z)); else SIM.blocks.set(k3(x, y, z), id.includes(":") ? id : `minecraft:${id}`); }
export function fill(x0, y0, z0, x1, y1, z1, id) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) setBlock(x, y, z, id);
}
export function idAt(x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  const v = SIM.blocks.get(k3(x, y, z));
  if (v) return v;
  return y < SIM.groundY ? (y < SIM.groundY - 3 ? "minecraft:stone" : "minecraft:dirt") : "minecraft:air";
}
const isOpen = (x, y, z) => !!SIM.states.get(k3(Math.floor(x), Math.floor(y), Math.floor(z)))?.open_bit;
// can a body pass through this cell?
export function passCell(x, y, z) {
  const id = idAt(x, y, z);
  if (id === "minecraft:air" || id.includes("water")) return true;
  if (id.includes("door") && !id.includes("iron") && !id.includes("trapdoor")) return true;       // mobs open wooden doors
  if ((id.includes("trapdoor") || id.includes("fence_gate") || id.includes("iron_door")) && isOpen(x, y, z)) return true;
  return PASS.some((p) => id.includes(p)) && !id.includes("grass_block");
}
const solidCell = (x, y, z) => !passCell(x, y, z);
const stepBlock = (x, y, z) => { const id = idAt(x, y, z); return id.includes("stairs") || id.includes("slab"); };
// rays stop at anything that isn't air/plant/open thing (glass stops them too, as in the game)
const rayStops = (x, y, z) => { const id = idAt(x, y, z); if (id === "minecraft:air" || id.includes("water")) return false; if (PASS.some((p) => id.includes(p)) && !id.includes("grass_block")) return false; if ((id.includes("door") || id.includes("gate")) && isOpen(x, y, z)) return false; return true; };
function inBounds(x, z) { const b = SIM.bounds; return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1; }
class Permutation {
  constructor(loc) { this.loc = loc; }
  getState(n) { return SIM.states.get(k3(this.loc.x, this.loc.y, this.loc.z))?.[n] ?? false; }
  withState(n, v) { const p = new Permutation(this.loc); p.pending = { n, v }; return p; }
}
class Block {
  constructor(dim, x, y, z) { this.dimension = dim; this.location = { x, y, z }; this.x = x; this.y = y; this.z = z; this.typeId = idAt(x, y, z); }
  get isAir() { return this.typeId === "minecraft:air"; }
  get isLiquid() { return this.typeId.includes("water") || this.typeId.includes("lava"); }
  get permutation() { return new Permutation(this.location); }
  setPermutation(p) { count("setPermutation"); if (p.pending) { const k = k3(this.x, this.y, this.z); const s = SIM.states.get(k) ?? {}; s[p.pending.n] = p.pending.v; SIM.states.set(k, s); } }
  setType(id) { count("setType"); setBlock(this.x, this.y, this.z, id); this.typeId = idAt(this.x, this.y, this.z); }
}
function skyAt(x, y, z) {
  x = Math.floor(x); z = Math.floor(z);
  for (let yy = Math.floor(y); yy <= SIM.bounds.y1; yy++) if (SIM.blocks.has(k3(x, yy, z)) && rayStops(x, yy, z) && !idAt(x, yy, z).includes("leaves")) return 0;
  return 15;
}

// ---------------------------------------------------------------- events
class Signal { constructor(name) { this.name = name; this.subs = []; } subscribe(f) { this.subs.push(f); return f; } unsubscribe(f) { this.subs = this.subs.filter((x) => x !== f); }
  fire(ev) { for (const f of this.subs) { try { f(ev); } catch (err) { SIM.errors.push(`${this.name}: ${err?.stack ?? err}`); } } } }
const after = {}, before = {};
for (const n of ["entityDie", "entityHitEntity", "entityHurt", "entitySpawn", "itemUse", "playerInteractWithEntity", "playerSpawn", "playerSwingStart", "worldLoad", "playerLeave", "entityRemove"]) after[n] = new Signal(n);
for (const n of ["entityHurt", "playerInteractWithEntity", "startup"]) before[n] = new Signal(n);

// ---------------------------------------------------------------- entity definitions (from the add-on's JSON)
export function loadDefs(bpDir) {
  for (const f of fs.readdirSync(path.join(bpDir, "entities"))) {
    const j = JSON.parse(fs.readFileSync(path.join(bpDir, "entities", f), "utf8"));
    const e = j["minecraft:entity"]; if (!e) continue;
    SIM.defs[e.description.identifier] = e;
  }
}

// ---------------------------------------------------------------- entities
const dimCache = new Map();
class Component { constructor(o) { Object.defineProperties(this, Object.getOwnPropertyDescriptors(o)); } }
export class Entity {
  constructor(type, loc, dim) {
    this.id = String(-(SIM.nextId++) * 4294967296 - 1234567);
    this.typeId = type; this._loc = { ...loc }; this.dimension = dim; this._valid = true; this.nameTag = "";
    this.tags = new Set(); this.dyn = new Map(); this.props = new Map(); this.groups = new Set(); this.vel = { x: 0, y: 0, z: 0 };
    this.rot = { x: 0, y: 0 }; this.hp = 20; this.maxHp = 20; this.onGround = true; this.path = undefined; this.pathT = -99; this.target = undefined; this.atkT = 0;
    this.effects = new Map(); this.riding = undefined; this.riders = []; this.isSneaking = false; this.mainhand = "air";
    const def = SIM.defs[type];
    if (def) {
      for (const [k, v] of Object.entries(def.description.properties ?? {})) this.props.set(k, v.default);
      const h = def.components?.["minecraft:health"]; if (h) { this.hp = h.value; this.maxHp = h.max ?? h.value; }
    }
    if (type === "war:waypoint" || type === "war:flag") { this.hp = 1000; this.maxHp = 1000; this.static = true; }
    SIM.entities.set(this.id, this);
  }
  get location() { count("location"); return { ...this._loc }; }
  get isValid() { return this._valid; }
  isValidFn() { return this._valid; }
  getDynamicProperty(k) { count("getDynamicProperty"); return this.dyn.get(k); }
  setDynamicProperty(k, v) { count("setDynamicProperty"); if (v === undefined) this.dyn.delete(k); else this.dyn.set(k, typeof v === "object" ? { ...v } : v); }
  getProperty(k) { count("getProperty"); return this.props.get(k); }
  setProperty(k, v) { count("setProperty"); this.props.set(k, v); }
  getTags() { count("getTags"); return [...this.tags]; }
  hasTag(t) { count("hasTag"); return this.tags.has(t); }
  addTag(t) { count("addTag"); this.tags.add(t); return true; }
  removeTag(t) { count("removeTag"); return this.tags.delete(t); }
  triggerEvent(ev) {
    count("triggerEvent");
    const def = SIM.defs[this.typeId]; const e = def?.events?.[ev];
    if (!e) return;
    const apply = (x) => { for (const g of x.remove?.component_groups ?? []) this.groups.delete(g); for (const g of x.add?.component_groups ?? []) this.groups.add(g); if (x.sequence) for (const s of x.sequence) apply(s); };
    apply(e); this.behaviour = undefined;
    const hpG = [...this.groups].find((g) => g.startsWith("war:hp_"));
    if (hpG && ev.startsWith("war:hp_")) { const h = def.component_groups[hpG]["minecraft:health"]; this.maxHp = h.max; this.hp = h.value; }
  }
  // the parts of the active component groups the simulation cares about
  beh() {
    if (this.behaviour) return this.behaviour;
    const def = SIM.defs[this.typeId]; const b = { move: 0.25 };
    const comps = { ...(def?.components ?? {}) };
    for (const g of this.groups) Object.assign(comps, def?.component_groups?.[g] ?? {});
    if (comps["minecraft:movement"]) b.move = comps["minecraft:movement"].value;
    const fm = comps["minecraft:behavior.follow_mob"]; if (fm) b.follow = { stop: fm.stop_distance ?? 3, range: fm.search_range ?? 64, speed: fm.speed_multiplier ?? 1, post: JSON.stringify(fm.filters).includes("war_wp") };
    const nt = comps["minecraft:behavior.nearest_attackable_target"]; if (nt) b.targetR = nt.within_radius ?? 16;
    const ra = comps["minecraft:behavior.ranged_attack"]; if (ra) b.ranged = { r: ra.attack_radius, p: ra.priority };
    const ma = comps["minecraft:behavior.melee_attack"]; if (ma) b.melee = { speed: ma.speed_multiplier ?? 1, dmg: comps["minecraft:attack"]?.damage ?? 2 };
    if (comps["minecraft:behavior.hurt_by_target"]) b.hurtBy = true;
    if (comps["minecraft:behavior.follow_owner"]) b.owner = true;
    return (this.behaviour = b);
  }
  getComponent(name) {
    count("getComponent");
    const n = name.replace("minecraft:", "");
    const self = this;
    if (n === "health") { if (this.static && this.typeId !== "war:waypoint") return undefined; return new Component({ get currentValue() { return self.hp; }, get effectiveMax() { return self.maxHp; }, defaultValue: this.maxHp, setCurrentValue(v) { count("setCurrentValue"); self.hp = Math.max(0, Math.min(self.maxHp, v)); return true; } }); }
    if (n === "riding") return this.riding ? new Component({ entityRidingOn: this.riding }) : undefined;
    if (n === "rideable") return this.typeId.startsWith("war:") && ["war:tank", "war:boat", "war:plane", "war:mg_nest"].includes(this.typeId) ? new Component({ seatCount: 2, getRiders: () => [...self.riders], addRider: () => false, ejectRider() {} }) : undefined;
    if (n === "projectile") return this.isBullet ? new Component({ get owner() { return self.owner; }, set owner(v) { self.owner = v; }, shoot(v, o) { if (o?.owner) self.owner = o.owner; self.vel = { ...v }; self.fired = true; } }) : undefined;
    if (n === "tameable") return new Component({ tamedToPlayerId: this.tamedTo, tame(p) { self.tamedTo = p.id; return true; } });
    if (n === "equippable") return new Component({ getEquipment: () => undefined, setEquipment() {} });
    if (n === "inventory") return new Component({ container: { addItem() {}, setItem() {}, getItem() {} } });
    return undefined;
  }
  teleport(loc, opts) { count("teleport"); this._loc = { ...loc }; if (opts?.dimension) this.dimension = opts.dimension; this.vel = { x: 0, y: 0, z: 0 }; }
  tryTeleport(loc, opts) { this.teleport(loc, opts); return true; }
  applyImpulse(v) { count("applyImpulse"); if (this.isPlayer) return; this.vel.x += v.x; this.vel.y += v.y; this.vel.z += v.z; }
  clearVelocity() { count("clearVelocity"); this.vel = { x: 0, y: 0, z: 0 }; }
  getVelocity() { count("getVelocity"); return { ...this.vel }; }
  getRotation() { count("getRotation"); return { ...this.rot }; }
  setRotation(r) { count("setRotation"); this.rot = { ...r }; }
  getHeadLocation() { count("getHeadLocation"); return { x: this._loc.x, y: this._loc.y + (this.typeId === "war:soldier" || this.isPlayer ? 1.62 : 0.5), z: this._loc.z }; }
  getViewDirection() { const y = this.rot.y * Math.PI / 180; return { x: -Math.sin(y), y: 0, z: Math.cos(y) }; }
  get isInWater() { return idAt(this._loc.x, this._loc.y + 0.2, this._loc.z).includes("water"); }
  applyDamage(amount, opts) { count("applyDamage"); return damage(this, amount, opts?.damagingEntity, opts?.cause ?? "entityAttack"); }
  kill() { count("kill"); return damage(this, 99999, undefined, "override"); }
  remove() { count("remove"); if (!this._valid) return; this._valid = false; SIM.entities.delete(this.id); for (const r of this.riders) r.riding = undefined; }
  runCommand(cmd) {
    count("runCommand");
    const m = /replaceitem entity @s slot\.weapon\.mainhand 0 (\S+)/.exec(cmd);
    if (m) { if (m[1].startsWith("ww:") && !SIM.gunPack) throw new Error("unknown item"); this.mainhand = m[1]; }
    return { successCount: 1 };
  }
  addEffect(t, d, o) { count("addEffect"); this.effects.set(t, { until: SIM.tick + d, amp: o?.amplifier ?? 0 }); }
  removeEffect(t) { this.effects.delete(t); return true; }
  getEffect(t) { return this.effects.get(t); }
  getEntitiesFromViewDirection() { return []; }
  getBlockFromViewDirection() { return undefined; }
  getGameMode() { return SIM.gameMode === "creative" ? GameMode.Creative : GameMode.Survival; }
}
export class Player extends Entity {
  constructor(loc, dim) { super("minecraft:player", loc, dim); this.isPlayer = true; this.name = "Tester"; this.onScreenDisplay = { setActionBar: (t) => SIM.log.push(`[bar] ${t}`), setTitle() {} }; this.camera = { setCamera() {}, clear() {} }; this.hp = 20; this.maxHp = 20; }
  sendMessage(m) { SIM.log.push(`[msg] ${m}`); }
  playSound() {}
}
function damage(v, amount, src, cause) {
  if (!v._valid || v.static) return false;
  const ev = { hurtEntity: v, damage: amount, damageSource: { damagingEntity: src, cause }, cancel: false };
  before.entityHurt.fire(ev);
  if (ev.cancel) return false;
  if (v.isPlayer && SIM.gameMode === "creative") return false;
  v.hp -= ev.damage;
  after.entityHurt.fire({ hurtEntity: v, damage: ev.damage, damageSource: { damagingEntity: src, cause } });
  if (v.hurtByTarget === undefined && src && v.beh?.().hurtBy) v.target = src;
  if (v.hp <= 0 && v._valid) {
    after.entityDie.fire({ deadEntity: v, damageSource: { damagingEntity: src, cause } });
    v.remove();
  }
  return true;
}

// ---------------------------------------------------------------- dimension
const famOf = (e) => SIM.defs[e.typeId]?.components?.["minecraft:type_family"]?.family ?? (e.isPlayer ? ["player"] : []);
export class Dimension {
  constructor(id) { this.id = `minecraft:${id}`; }
  getBlock(loc) {
    count("getBlock");
    const x = Math.floor(loc.x), y = Math.floor(loc.y), z = Math.floor(loc.z);
    if (!inBounds(x, z)) throw new Error("LocationInUnloadedChunkError");
    if (y < SIM.bounds.y0 || y > SIM.bounds.y1) return undefined;
    return new Block(this, x, y, z);
  }
  getTopmostBlock(loc) { for (let y = SIM.bounds.y1; y >= SIM.bounds.y0; y--) if (solidCell(loc.x, y, loc.z)) return new Block(this, Math.floor(loc.x), y, Math.floor(loc.z)); return undefined; }
  getBlockFromRay(from, dir, opts = {}) {
    count("getBlockFromRay");
    const max = opts.maxDistance ?? 64, st = 0.1;
    let lx, ly, lz;
    for (let t = 0; t <= max; t += st) {
      const x = Math.floor(from.x + dir.x * t), y = Math.floor(from.y + dir.y * t), z = Math.floor(from.z + dir.z * t);
      if (x === lx && y === ly && z === lz) continue; lx = x; ly = y; lz = z;
      if (!inBounds(x, z)) return undefined;
      if (rayStops(x, y, z)) return { block: new Block(this, x, y, z), face: "Up", faceLocation: { x: 0.5, y: 0.5, z: 0.5 } };
    }
    return undefined;
  }
  getEntitiesFromRay() { return []; }
  getLightLevel(loc) { count("getLightLevel"); return Math.max(12, skyAt(loc.x, loc.y, loc.z)); }
  getSkyLightLevel(loc) { count("getSkyLightLevel"); return skyAt(loc.x, loc.y, loc.z); }
  getEntities(q = {}) {
    count("getEntities");
    const out = [];
    for (const e of SIM.entities.values()) {
      if (!e._valid || e.dimension !== this) continue;
      if (q.type && e.typeId !== q.type) continue;
      if (q.excludeTypes && q.excludeTypes.includes(e.typeId)) continue;
      if (q.families && !q.families.every((f) => famOf(e).includes(f))) continue;
      if (q.tags && !q.tags.every((t) => e.tags.has(t))) continue;
      if (q.excludeTags && q.excludeTags.some((t) => e.tags.has(t))) continue;
      if (q.location && q.maxDistance !== undefined) { const l = e._loc; if (Math.hypot(l.x - q.location.x, l.y - q.location.y, l.z - q.location.z) > q.maxDistance) continue; }
      out.push(e);
    }
    return out;
  }
  getPlayers(q = {}) { return this.getEntities({ ...q, type: "minecraft:player" }); }
  spawnEntity(type, loc, opts) {
    count("spawnEntity");
    if (!inBounds(Math.floor(loc.x), Math.floor(loc.z))) throw new Error("unloaded");
    const e = new Entity(type, loc, this);
    if (type.startsWith("ww:")) { e.isBullet = true; e.born = SIM.tick; e.from = { ...loc }; }
    if (type === "minecraft:snowball" || type === "minecraft:splash_potion") { e.isBullet = true; e.harmless = true; e.born = SIM.tick; }
    if (type === "war:soldier" && opts?.spawnEvent) e.triggerEvent(opts.spawnEvent);
    after.entitySpawn.fire({ entity: e, cause: "Spawned" });
    return e;
  }
  spawnParticle() { count("spawnParticle"); }
  playSound() { count("playSound"); }
  createExplosion(loc, power, opts) {
    count("createExplosion");
    for (const e of [...SIM.entities.values()]) { if (!e._valid || e.static || e.isBullet) continue; const d = Math.hypot(e._loc.x - loc.x, e._loc.y - loc.y, e._loc.z - loc.z); if (d < power * 2) damage(e, Math.round(power * 4 * (1 - d / (power * 2))), opts?.source, "entityExplosion"); }
    return true;
  }
  runCommand(cmd) { count("runCommand"); return { successCount: 1 }; }
}
for (const d of ["overworld", "nether", "the_end"]) dimCache.set(d, new Dimension(d));
export const overworld = dimCache.get("overworld");

// ---------------------------------------------------------------- world / system
export const world = {
  afterEvents: after, beforeEvents: before,
  getDimension: (id) => { count("getDimension"); return dimCache.get(String(id).replace("minecraft:", "")); },
  getDynamicProperty(k) { count("world.getDynamicProperty"); if (SIM.loading) throw new Error("Native function [World::getDynamicProperty] cannot be used in early execution"); return SIM.dynWorld.get(k); },
  setDynamicProperty(k, v) { count("world.setDynamicProperty"); if (SIM.loading) throw new Error("Native function [World::setDynamicProperty] cannot be used in early execution"); if (v === undefined) SIM.dynWorld.delete(k); else SIM.dynWorld.set(k, v); if (typeof v === "string" && v.length > 32767) throw new Error("dynamic property too large"); },
  getEntity: (id) => { count("getEntity"); const e = SIM.entities.get(id); return e && e._valid ? e : undefined; },
  getAllPlayers: () => [...SIM.entities.values()].filter((e) => e.isPlayer && e._valid),
  getPlayers: () => [...SIM.entities.values()].filter((e) => e.isPlayer && e._valid),
  sendMessage: (m) => SIM.log.push(`[world] ${m}`),
  getDay: () => 1, getTimeOfDay: () => 6000, getAbsoluteTime: () => SIM.tick,
};
export const system = {
  get currentTick() { return SIM.tick; },
  runInterval(f, n = 1) { const h = { f, n: Math.max(1, n), next: SIM.tick + Math.max(1, n), id: SIM.intervals.length + 1, src: new Error().stack.split("\n")[2]?.trim() }; SIM.intervals.push(h); return h.id; },
  runTimeout(f, n = 1) { const h = { f, at: SIM.tick + Math.max(1, n) }; SIM.timeouts.push(h); return 0; },
  run(f) { SIM.timeouts.push({ f, at: SIM.tick + 1 }); return 0; },
  clearRun() {},
  beforeEvents: { startup: before.startup, watchdogTerminate: new Signal("wd") },
  afterEvents: { scriptEventReceive: new Signal("se") },
};
export const GameMode = { Creative: "Creative", Survival: "Survival", Adventure: "Adventure", Spectator: "Spectator", creative: "Creative", survival: "Survival", adventure: "Adventure", spectator: "Spectator" };
export const EquipmentSlot = { Mainhand: "Mainhand", Offhand: "Offhand", Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet" };
export class ItemStack { constructor(id, n = 1) { this.typeId = id.includes(":") ? id : `minecraft:${id}`; this.amount = n; } }
export const EntityDamageCause = {};
export const BlockPermutation = { resolve: (id) => ({ id }) };

// ---------------------------------------------------------------- vanilla-ish navigation (A* on the grid; no ladders)
function standableNav(x, y, z) { return passCell(x, y, z) && passCell(x, y + 1, z) && solidCell(x, y - 1, z) && !idAt(x, y - 1, z).includes("fence"); }
export function navPath(from, to, maxNodes = 900) {
  const sx = Math.floor(from.x), sy = Math.floor(from.y + 0.01), sz = Math.floor(from.z), tx = Math.floor(to.x), ty = Math.floor(to.y + 0.01), tz = Math.floor(to.z);
  const key = (x, y, z) => `${x},${y},${z}`;
  const open = [[Math.hypot(tx - sx, tz - sz) + Math.abs(ty - sy), 0, sx, sy, sz]], g = new Map([[key(sx, sy, sz), 0]]), came = new Map();
  let best = key(sx, sy, sz), bh = Infinity, n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, gc, x, y, z] = open.splice(bi, 1)[0];
    const h = Math.hypot(tx - x, tz - z) + Math.abs(ty - y) * 1.5;
    const ck = key(x, y, z);
    if (h < bh) { bh = h; best = ck; }
    if (Math.abs(tx - x) <= 1 && Math.abs(tz - z) <= 1 && Math.abs(ty - y) <= 1) { best = ck; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (!inBounds(nx, nz)) continue;
      if (dx && dz && (!passCell(x + dx, y, z) || !passCell(x, y, z + dz) || !passCell(x + dx, y + 1, z) || !passCell(x, y + 1, z + dz))) continue;
      for (const dy of [0, 1, -1, -2, -3]) {
        const ny = y + dy;
        if (!standableNav(nx, ny, nz)) continue;
        if (dy === 1 && !passCell(x, y + 2, z)) continue;
        if (dy < 0) { let ok = true; for (let yy = ny + 1; yy <= y + 1; yy++) if (!passCell(nx, yy, nz)) ok = false; if (!ok) continue; }
        const nk = key(nx, ny, nz), ng = gc + (dx && dz ? 1.41 : 1) + (dy > 0 ? 0.5 : dy < -1 ? 1 : 0);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, ck); open.push([ng + Math.hypot(tx - nx, tz - nz) + Math.abs(ty - ny), ng, nx, ny, nz]); }
        break;
      }
    }
  }
  const pts = []; let k = best;
  while (k) { const [x, y, z] = k.split(",").map(Number); pts.push({ x: x + 0.5, y, z: z + 0.5 }); k = came.get(k); }
  return pts.reverse();
}
const hostileTo = (a, b) => { for (const t of a.tags) if (t.startsWith("war_h") && b.tags.has(`war_f${t.slice(5)}`)) return true; return false; };
function los(a, b) {
  const h = a.getHeadLocation(), c = { x: b._loc.x, y: b._loc.y + 1.2, z: b._loc.z };
  const dx = c.x - h.x, dy = c.y - h.y, dz = c.z - h.z, L = Math.hypot(dx, dy, dz) || 1;
  return !overworld.getBlockFromRay(h, { x: dx / L, y: dy / L, z: dz / L }, { maxDistance: L - 0.3 });
}
function markerFor(e) {
  // follow_mob filters: self war_grR + war_gcC  <-> other war_wrR + war_wcC
  let r, c; for (const t of e.tags) { if (t.startsWith("war_gr")) r = t.slice(6); else if (t.startsWith("war_gc")) c = t.slice(6); }
  if (!r || !c) return undefined;
  let best, bd = 64;
  for (const o of SIM.entities.values()) {
    if (!o._valid || o === e || !o.tags.has(`war_wr${r}`) || !o.tags.has(`war_wc${c}`)) continue;
    const d = Math.hypot(o._loc.x - e._loc.x, o._loc.y - e._loc.y, o._loc.z - e._loc.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
function aiTick(e) {
  if (e.isPlayer || e.static || e.isBullet || e.typeId !== "war:soldier" || e.riding) return;
  const b = e.beh();
  const slow = e.effects.get("slowness"); const slowK = slow && slow.until > SIM.tick ? Math.max(0.05, 1 - 0.15 * (slow.amp + 1)) : 1;
  const speed = b.move * 0.45 * slowK;
  // targets (vanilla targeting picks the nearest hostile it can see)
  if (b.targetR && SIM.tick % 5 === 0) {
    if (e.target && (!e.target._valid || Math.hypot(e.target._loc.x - e._loc.x, e.target._loc.z - e._loc.z) > b.targetR * 1.5)) e.target = undefined;
    if (!e.target) {
      let best, bd = b.targetR;
      for (const o of SIM.entities.values()) { if (!o._valid || o === e || o.static || o.isBullet || !hostileTo(e, o)) continue; const d = Math.hypot(o._loc.x - e._loc.x, o._loc.y - e._loc.y, o._loc.z - e._loc.z); if (d < bd && los(e, o)) { bd = d; best = o; } }
      e.target = best;
    }
  }
  if (!b.targetR && !b.hurtBy) e.target = undefined;
  let goal, stop = 0.5, mult = 1;
  const t = e.target?._valid ? e.target : undefined;
  if (t && b.melee) { goal = t._loc; stop = 1.2; mult = b.melee.speed; const d = Math.hypot(t._loc.x - e._loc.x, t._loc.y - e._loc.y, t._loc.z - e._loc.z); if (d < 2.2 && SIM.tick - e.atkT > 20) { e.atkT = SIM.tick; damage(t, b.melee.dmg, e, "entityAttack"); } }
  else if (t && b.ranged) { const d = Math.hypot(t._loc.x - e._loc.x, t._loc.z - e._loc.z); if (d > b.ranged.r || !los(e, t)) { goal = t._loc; stop = 2; } else { goal = undefined; e.mode = "ranged-stand"; } }
  if (!goal && !(t && b.ranged) && b.follow) { const m = markerFor(e); if (m) { goal = m._loc; stop = b.follow.stop; mult = b.follow.speed; } }
  e.navGoal = goal;
  let want = { x: 0, z: 0 };
  if (goal) {
    const d = Math.hypot(goal.x - e._loc.x, goal.y - e._loc.y, goal.z - e._loc.z);
    if (d > stop) {
      if (!e.path || SIM.tick - e.pathT > 20 || !e.pathGoal || Math.hypot(e.pathGoal.x - goal.x, e.pathGoal.y - goal.y, e.pathGoal.z - goal.z) > 1.5) { e.path = navPath(e._loc, goal); e.pathT = SIM.tick; e.pathGoal = { ...goal }; e.pi = 1; SIM.calls.set("~navPath", (SIM.calls.get("~navPath") ?? 0) + 1); }
      let p = e.path[e.pi];
      while (p && Math.hypot(p.x - e._loc.x, p.z - e._loc.z) < 0.35 && Math.abs(p.y - e._loc.y) < 1.1) { e.pi++; p = e.path[e.pi]; }
      if (p) { const dx = p.x - e._loc.x, dz = p.z - e._loc.z, L = Math.hypot(dx, dz) || 1; want = { x: dx / L * speed * mult, z: dz / L * speed * mult }; e.jumpWanted = p.y > e._loc.y + 0.5; }
      else if (e.path.length <= 1 || e.pi >= e.path.length) { const dx = goal.x - e._loc.x, dz = goal.z - e._loc.z, L = Math.hypot(dx, dz) || 1; if (L > stop) want = { x: dx / L * speed * mult, z: dz / L * speed * mult }; }
    }
  }
  e.walk = want;
}
// ---------------------------------------------------------------- physics
function physTick(e) {
  if (e.static || e.isPlayer || e.riding) return;
  if (e.isBullet) return bulletTick(e);
  const l = e._loc;
  const inW = idAt(l.x, l.y + 0.2, l.z).includes("water");
  // horizontal: walking intent plus whatever impulse momentum is left
  const w = e.walk ?? { x: 0, z: 0 };
  let vx = e.vel.x + w.x, vz = e.vel.z + w.z;
  const tryMove = (nx, nz) => {
    const fy = Math.floor(l.y + 0.01);
    if (passCell(nx, fy, nz) && passCell(nx, fy + 1, nz)) return true;
    // a step: stairs/slabs are walked up; full blocks need a jump (vanilla navigation or a script hop)
    if ((stepBlock(nx, fy, nz) || (e.jumpWanted && e.onGround) || e.vel.y > 0.3) && passCell(nx, fy + 1, nz) && passCell(nx, fy + 2, nz) && passCell(Math.floor(l.x), fy + 2, Math.floor(l.z))) { l.y = fy + 1; return true; }
    return false;
  };
  const nx = l.x + vx; if (tryMove(nx, l.z)) l.x = nx; else { e.vel.x = 0; vx = 0; }
  const nz = l.z + vz; if (tryMove(l.x, nz)) l.z = nz; else { e.vel.z = 0; vz = 0; }
  // ladders: walking into a ladder climbs it (can_climb)
  const onLadder = idAt(l.x, l.y, l.z).includes("ladder");
  // vertical
  const below = solidCell(l.x, l.y - 0.05, l.z) && !(onLadder && e.vel.y < 0 && false);
  if (e.vel.y > 0.01) { const ny = l.y + e.vel.y; if (passCell(l.x, ny + 1.8, l.z)) l.y = ny; else e.vel.y = 0; e.vel.y = (e.vel.y - 0.08) * 0.98; e.onGround = false; }
  else if (onLadder) { e.vel.y = 0; e.onGround = true; }
  else if (inW) { e.vel.y = Math.min(0.06, e.vel.y + 0.02); const ny = l.y + e.vel.y; if (passCell(l.x, ny, l.z)) l.y = ny; e.onGround = false; }
  else if (!below) { e.vel.y = (e.vel.y - 0.08) * 0.98; let ny = l.y + e.vel.y; const fy = Math.floor(l.y); if (Math.floor(ny) < fy && solidCell(l.x, fy - 1, l.z)) ny = fy; if (Math.floor(ny) < fy - 1 && solidCell(l.x, Math.floor(ny), l.z)) ny = Math.floor(ny) + 1; l.y = ny; e.onGround = false; e.fallFrom = e.fallFrom ?? l.y; }
  else { if (!e.onGround && e.fallFrom !== undefined) { const h = e.fallFrom - l.y; if (h > 3.5) damage(e, Math.floor(h - 3), undefined, "fall"); } e.fallFrom = undefined; e.onGround = true; l.y = Math.floor(l.y + 0.05); if (e.vel.y < 0) e.vel.y = 0; }
  const fr = e.onGround ? 0.546 : 0.91;
  e.vel.x *= fr; e.vel.z *= fr;
  if (Math.abs(e.vel.x) < 0.003) e.vel.x = 0; if (Math.abs(e.vel.z) < 0.003) e.vel.z = 0;
  if (l.y < SIM.bounds.y0) damage(e, 1000, undefined, "void");
}
const BULLET_DMG = { "ww:nrifle_projectile": 7, "ww:nsemi_projectile": 6, "ww:nsmg_projectile": 4, "ww:nlmg_projectile": 5, "ww:nshotgun_projectile": 9, "ww:nbazooka_projectile": 10 };
function bulletTick(b) {
  if (!b.fired) { if (SIM.tick - b.born > 2) b.remove(); return; }
  if (b.harmless) { if (SIM.tick - b.born > 40) b.remove(); return; }
  if (!b.shotLog) { b.shotLog = { from: { ...b._loc }, owner: b.owner, t: SIM.tick, nearEnemy: false, hit: false }; SIM.shots.push(b.shotLog); }
  const steps = Math.ceil(Math.hypot(b.vel.x, b.vel.y, b.vel.z) / 0.25);
  for (let i = 0; i < steps; i++) {
    const l = b._loc; l.x += b.vel.x / steps; l.y += b.vel.y / steps; l.z += b.vel.z / steps;
    if (!inBounds(Math.floor(l.x), Math.floor(l.z))) { b.remove(); return; }
    for (const o of SIM.entities.values()) {
      if (!o._valid || o === b.owner || o.static || o.isBullet || (o.typeId !== "war:soldier" && !o.isPlayer)) continue;
      const dx = o._loc.x - l.x, dz = o._loc.z - l.z, dy = l.y - o._loc.y;
      if (Math.hypot(dx, dz) < 2.5 && dy > -0.5 && dy < 2.5 && b.owner && hostileTo(b.owner, o)) b.shotLog.nearEnemy = true;
      if (Math.hypot(dx, dz) < 0.35 && dy > 0 && dy < 1.9) { b.shotLog.hit = true; SIM.hits++; damage(o, BULLET_DMG[b.typeId] ?? 5, b.owner, "projectile"); b.remove(); return; }
    }
    if (rayStops(l.x, l.y, l.z)) { b.shotLog.block = true; b.remove(); return; }
  }
  if (SIM.tick - b.born > 60) b.remove();
}

// ---------------------------------------------------------------- the clock
export function finishLoading() {
  SIM.loading = false;
  before.startup.fire({ itemComponentRegistry: { registerCustomComponent() {} }, blockComponentRegistry: { registerCustomComponent() {} } });
  after.worldLoad.fire({});
}
export const timing = new Map(); // interval source -> ms
export function step(n = 1, profile = false) {
  for (let k = 0; k < n; k++) {
    SIM.tick++;
    for (const h of SIM.intervals) {
      if (SIM.tick < h.next) continue;
      h.next = SIM.tick + h.n;
      const t0 = profile ? performance.now() : 0;
      SIM.cur = h.src;
      try { h.f(); } catch (err) { SIM.errors.push(`interval ${h.src}: ${err?.stack ?? err}`); }
      SIM.cur = undefined;
      if (profile) timing.set(h.src, (timing.get(h.src) ?? 0) + performance.now() - t0);
    }
    const due = SIM.timeouts.filter((h) => h.at <= SIM.tick);
    SIM.timeouts = SIM.timeouts.filter((h) => h.at > SIM.tick);
    SIM.cur = "timeouts";
    for (const h of due) { try { h.f(); } catch (err) { SIM.errors.push(`timeout: ${err?.stack ?? err}`); } }
    SIM.cur = undefined;
    for (const e of [...SIM.entities.values()]) { try { aiTick(e); physTick(e); } catch (err) { SIM.errors.push(`sim: ${err?.stack ?? err}`); } }
  }
}
export function debugHook() {
  after.entityHurt.subscribe((ev) => { if (process.env.HURTLOG) console.error(`hurt t=${SIM.tick} ${ev.hurtEntity.typeId} f=${ev.hurtEntity.props?.get("war:faction")} dmg=${ev.damage} cause=${ev.damageSource.cause} by=${ev.damageSource.damagingEntity?.typeId ?? "-"} at=${Object.values(ev.hurtEntity._loc).map((v) => v.toFixed(1))}`); });
}
