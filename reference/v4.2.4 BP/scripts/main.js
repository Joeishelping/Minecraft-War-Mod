// War Engine v4.2.4: faction NPC war framework
import { world, system, Player, ItemStack, EquipmentSlot, GameMode } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import { SKINS } from "./skins.js";

// ================================================================ constants
const SOLDIER = "war:soldier", HOUND = "war:hound", WAYPOINT = "war:waypoint", FLAG = "war:flag";
const VEHICLES = ["war:boat", "war:plane", "war:tank"];
const NF = 20, NSLOT = 1600;
// Marker numbers are two-part (row x column, 40 x 40 = 1600). A soldier and his marker share a row tag
// and a column tag, so each soldier checks only 80 conditions for 1600 possible markers.
const GRID = 40;
const rowOf = (s) => Math.floor((s - 1) / GRID) + 1, colOf = (s) => ((s - 1) % GRID) + 1;
function tagMarker(ent, s) {
  for (const t of ent.getTags()) if (t.startsWith("war_wr") || t.startsWith("war_wc") || t.startsWith("war_wp")) ent.removeTag(t);
  if (s) { ent.addTag(`war_wr${rowOf(s)}`); ent.addTag(`war_wc${colOf(s)}`); }
}
function untagMarker(ent) { for (const t of ent.getTags()) if (t.startsWith("war_wr") || t.startsWith("war_wc") || t.startsWith("war_wp")) ent.removeTag(t); }
const COLORS = [
  ["White", "§f"], ["Red", "§c"], ["Blue", "§9"], ["Green", "§2"], ["Yellow", "§e"],
  ["Purple", "§5"], ["Orange", "§6"], ["Black", "§8"], ["Gray", "§7"], ["Pink", "§d"],
  ["Cyan", "§3"], ["Brown", "§n"], ["Lime", "§a"], ["Light Blue", "§b"], ["Magenta", "§u"],
  ["Gold", "§p"], ["Navy", "§1"], ["Maroon", "§4"], ["Olive", "§g"], ["Teal", "§s"],
];
const DIV = {
  foot: { name: "Foot Soldier", hp: "hp_40", weapon: true },
  garrison: { name: "Garrison", hp: "hp_40", weapon: true },
  guard: { name: "Guard", hp: "hp_60", weapon: true },
  medic: { name: "Medic", hp: "hp_30", weapon: false },
  grenadier: { name: "SB Grenadier", hp: "hp_40", weapon: false },
  houndmaster: { name: "Houndmaster", hp: "hp_40", weapon: true },
  cavalier: { name: "Cavalier", hp: "hp_80", weapon: true },
};
const ARMY_FUNCS = [["hold", "Hold"], ["patrol", "Patrol"], ["follow", "Follow me"]];
const FUNCS = {
  foot: ARMY_FUNCS, grenadier: ARMY_FUNCS, houndmaster: ARMY_FUNCS, cavalier: ARMY_FUNCS,
  garrison: [["post", "Man post"], ["sentry", "Sentry"], ["patrol", "Patrol"]],
  guard: [["escort", "Escort me"], ["stand", "Stand guard"], ["patrol", "Patrol"]],
  medic: [["squad", "Stay with squad"], ["follow", "Follow me"]],
};
const FUNC_LABEL = { charge: "Charging", ...Object.fromEntries(Object.values(FUNCS).flat()) };
const ANCHORED = ["hold", "patrol", "post", "sentry", "stand"];
const REL_TXT = { "1": "§cHOSTILE", "0": "§7NEUTRAL", "2": "§aALLY" };

// ================================================================ weapons & gun loadouts
// Gun types fire the gun pack's own NPC bullets (its script applies the damage).
// A faction's loadout only decides which gun model is held and which gunshot plays.
const WEAPONS = [["sword", "Sword"], ["crossbow", "Crossbow"], ["rifle", "Rifle"], ["semi", "Semi-auto"], ["smg", "SMG"],
  ["mg", "Machine gun"], ["shotgun", "Shotgun"], ["at", "Anti-tank"], ["pistol", "Pistol"]];
const GUNS = ["rifle", "semi", "smg", "mg", "shotgun", "at", "pistol"];
const LOADOUTS = {
  american: { name: "American", rifle: "m1903", semi: "garand", smg: "thompson", mg: "bar", shotgun: "model1912", at: "bazooka", pistol: "m1911" },
  german: { name: "German", rifle: "kar98", semi: "g43", smg: "mp40", mg: "mg42", shotgun: "model1912", at: "pzb39", pistol: "p08" },
  soviet: { name: "Eastern European", rifle: "mosin", semi: "svt38", smg: "ppsh41d", mg: "dp28", shotgun: "model1912", at: "bazooka", pistol: "tt33" },
  japanese: { name: "Eastern", rifle: "type99", semi: "type99", smg: "type100", mg: "type96", shotgun: "model1912", at: "bazooka", pistol: "nagant" },
  western: { name: "Western European", rifle: "m1903", semi: "garand", smg: "mab38", mg: "lewis", shotgun: "model1912", at: "bazooka", pistol: "mas35" },
};
const LOADOUT_KEYS = Object.keys(LOADOUTS);
const BULLETS = ["ww:nrifle_projectile", "ww:nsemi_projectile", "ww:nsmg_projectile", "ww:nlmg_projectile", "ww:nshotgun_projectile", "ww:nbazooka_projectile"];
function loadoutOf(f) {
  const all = getJSON(world, "war:loadouts", {});
  return LOADOUTS[all[f]] ? all[f] : "american";
}
const gunModel = (f, weapon) => LOADOUTS[loadoutOf(f)][weapon];
let gunPackWarned = false;
// order must match the resource pack's gun render controllers (war:gun = index + 1)
const GUN_MODELS = ["m1903", "garand", "thompson", "bar", "model1912", "bazooka", "m1911", "kar98", "g43", "mp40", "mg42", "pzb39", "p08", "mosin", "svt38", "ppsh41d", "dp28", "tt33", "type99", "type100", "type96", "nagant", "mab38", "lewis", "mas35"];

// ================================================================ caches & world data
let relCache, namesCache, squadsCache;
let markerCache = new Map();
function getRel() {
  if (relCache) return relCache;
  let r = world.getDynamicProperty("war:rel");
  if (typeof r !== "string" || r.length !== NF * NF) {
    r = "";
    for (let a = 1; a <= NF; a++) for (let b = 1; b <= NF; b++) r += a === b ? "2" : "1";
    world.setDynamicProperty("war:rel", r);
  }
  return (relCache = r);
}
const relAt = (a, b) => (a && b ? getRel()[(a - 1) * NF + (b - 1)] : "0");
const relVersion = () => Number(world.getDynamicProperty("war:relv") ?? 0);
function setRelPair(a, b, v, announce = true) {
  if (!a || !b || a === b || relAt(a, b) === v) return;
  const arr = getRel().split("");
  arr[(a - 1) * NF + (b - 1)] = v;
  arr[(b - 1) * NF + (a - 1)] = v;
  relCache = arr.join("");
  world.setDynamicProperty("war:rel", relCache);
  world.setDynamicProperty("war:relv", relVersion() + 1);
  if (announce) say(`${factionLabel(a)} §fis now ${REL_TXT[v]}§r§f with ${factionLabel(b)}`);
}
const isHostile = (a, b) => !!a && !!b && a !== b && relAt(a, b) === "1";
const isFriendly = (a, b) => !!a && !!b && (a === b || relAt(a, b) === "2");
function getNames() {
  if (namesCache) return namesCache;
  try { const n = JSON.parse(String(world.getDynamicProperty("war:names") ?? "[]")); if (Array.isArray(n)) return (namesCache = n); } catch {}
  return (namesCache = []);
}
function getSquads() {
  if (squadsCache) return squadsCache;
  try { const s = JSON.parse(String(world.getDynamicProperty("war:squads") ?? "{}")); if (s && typeof s === "object") return (squadsCache = s); } catch {}
  return (squadsCache = {});
}
const squadName = (f, n) => (n ? (getSquads()[f]?.[n - 1] || `Squad ${n}`) : "No squad");
const squadList = (f, first) => [first, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}: ${squadName(f, n)}`)];
const setting = (k, def) => { const v = world.getDynamicProperty(`war:set_${k}`); return v === undefined ? def : v; };
function factionLabel(f, plain = false) {
  if (!f) return plain ? "None" : "§7None§r";
  const [color, code] = COLORS[f - 1];
  const custom = getNames()[f - 1];
  const txt = custom ? `${color} (${custom})` : color;
  return plain ? txt : `${code}${txt}§r`;
}
const factionList = () => COLORS.map((_, i) => factionLabel(i + 1));

// ================================================================ helpers
const sleep = (t) => new Promise((res) => system.runTimeout(() => res(undefined), t));
async function show(form, player) {
  for (let i = 0; i < 20; i++) {
    const r = await form.show(player);
    if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy) { await sleep(5); continue; }
    return r;
  }
  return undefined;
}
function getJSON(h, key, fallback) {
  try { const v = h.getDynamicProperty(key); if (typeof v === "string") return JSON.parse(v); } catch {}
  return fallback;
}
const setJSON = (h, key, val) => h.setDynamicProperty(key, JSON.stringify(val));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const findPlayer = (id) => (id ? world.getAllPlayers().find((p) => p.id === id) : undefined);
const tick = () => system.currentTick;
const DIMS = ["overworld", "nether", "the_end"];
function allOf(type) {
  const out = [];
  for (const d of DIMS) { try { out.push(...world.getDimension(d).getEntities({ type })); } catch {} }
  return out;
}
const isRiding = (e) => { try { return !!e.getComponent("minecraft:riding"); } catch { return false; } };
const fwdFromYaw = (yaw) => ({ x: -Math.sin((yaw * Math.PI) / 180), z: Math.cos((yaw * Math.PI) / 180) });
function giveItem(player, id) {
  try { player.getComponent("minecraft:inventory").container.addItem(new ItemStack(id, 1)); } catch {}
}
function mainhand(player) {
  try { return player.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand)?.typeId; } catch { return undefined; }
}

// ================================================================ entity properties
// Values set on the same tick an entity spawns can be dropped by the game, so every
// property is mirrored in a dynamic property and re-applied until it sticks.
const PROPS = ["war:faction", "war:skin", "war:ranged", "war:cav", "war:medic", "war:rally", "war:gun", "war:firing", "war:aiming"];
function P(e, key) {
  const v = e.getDynamicProperty(`p_${key}`);
  if (v !== undefined) return v;
  try { return e.getProperty(key); } catch { return undefined; }
}
function setP(e, key, val) {
  e.setDynamicProperty(`p_${key}`, val);
  try { e.setProperty(key, val); } catch {}
  const ent = e;
  system.runTimeout(() => { if (ent.isValid) syncProps(ent); }, 2);
}
function syncProps(e) {
  for (const k of PROPS) {
    const v = e.getDynamicProperty(`p_${k}`);
    if (v === undefined) continue;
    try { if (e.getProperty(k) !== v) e.setProperty(k, v); } catch {}
  }
}

// ================================================================ players
function playerFaction(p) {
  for (let i = 1; i <= NF; i++) if (p.hasTag(`war_f${i}`)) return i;
  return 0;
}
function setPlayerFaction(p, f) {
  for (let i = 1; i <= NF; i++) p.removeTag(`war_f${i}`);
  if (f) p.addTag(`war_f${f}`);
  try { p.nameTag = f ? `${COLORS[f - 1][1]}[${COLORS[f - 1][0]}]§r ${p.name}` : p.name; } catch {}
}
const factionOf = (e) => (e.typeId === "minecraft:player" ? playerFaction(e) : e.getDynamicProperty("war:surr") ? 0 : Number(P(e, "war:faction") ?? 0));

// ================================================================ soldier data
function sd(e) {
  return {
    faction: Number(P(e, "war:faction") ?? 0),
    skin: Number(P(e, "war:skin") ?? 0),
    ranged: Boolean(P(e, "war:ranged")),
    weapon: String(e.getDynamicProperty("war:weapon") ?? (P(e, "war:ranged") ? "crossbow" : "sword")),
    div: String(e.getDynamicProperty("war:div") ?? "foot"),
    func: String(e.getDynamicProperty("war:func") ?? "hold"),
    squad: Number(e.getDynamicProperty("war:squad") ?? 0),
    radius: Number(e.getDynamicProperty("war:radius") ?? 8),
    owner: e.getDynamicProperty("war:owner"),
    leader: e.getDynamicProperty("war:leader"),
    goal: Number(e.getDynamicProperty("war:goal") ?? 0),
    custom: String(e.getDynamicProperty("war:custom") ?? ""),
    retreat: Boolean(e.getDynamicProperty("war:retreat")),
    surr: Number(e.getDynamicProperty("war:surr") ?? 0),
    armor: String(e.getDynamicProperty("war:armor") ?? "none"),
  };
}
const snapshot = (e) => {
  const d = sd(e);
  return { faction: d.faction, skin: d.skin, ranged: d.ranged, weapon: d.weapon, div: d.div, func: d.func, squad: d.squad, radius: d.radius, custom: d.custom, armor: d.armor };
};

function applyRelations(e) {
  const surr = !!e.getDynamicProperty("war:surr");
  const f = Number(P(e, "war:faction") ?? 0);
  for (let i = 1; i <= NF; i++) {
    const wantH = !surr && f > 0 && i !== f && relAt(f, i) === "1";
    if (wantH !== e.hasTag(`war_h${i}`)) wantH ? e.addTag(`war_h${i}`) : e.removeTag(`war_h${i}`);
    const wantF = !surr && i === f;
    if (wantF !== e.hasTag(`war_f${i}`)) wantF ? e.addTag(`war_f${i}`) : e.removeTag(`war_f${i}`);
  }
  e.setDynamicProperty("war:relv", relVersion());
  updateName(e);
}
function updateName(e) {
  const f = Number(P(e, "war:faction") ?? 0);
  const code = f ? COLORS[f - 1][1] : "§7";
  let txt;
  if (e.typeId === HOUND) txt = "War Hound";
  else {
    const d = sd(e);
    txt = (d.custom || DIV[d.div]?.name || "Soldier") + (d.squad ? ` §7- ${squadName(f, d.squad)}` : "");
    if (d.surr) txt += " §7(surrendered)";
    else if (d.retreat) txt += " §c(falling back)";
    const ro = String(e.getDynamicProperty("war:readout") ?? "");
    if (ro) txt += `\n§8${ro}`;
  }
  try { e.nameTag = `${code}[${factionLabel(f, true)}]§r ${txt}`; } catch {}
}
function setGroups(e, want) {
  const cur = getJSON(e, "war:st", {});
  let changed = false;
  for (const k of ["w", "t", "g", "s", "d", "r"]) {
    if (want[k] && cur[k] !== want[k]) { e.triggerEvent(`war:${want[k]}`); cur[k] = want[k]; changed = true; }
  }
  if (changed) setJSON(e, "war:st", cur);
}
function equip(e, item) {
  if (e.typeId === SOLDIER) { try { setP(e, "war:gun", 0); } catch {} }
  if (item.startsWith("ww:")) {
    try {
      e.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${item}`);
      setP(e, "war:gun", GUN_MODELS.indexOf(item.slice(3)) + 1); // the soldier model draws the pack's gun
      return;
    }
    catch {
      e.setDynamicProperty("war:weapon", "crossbow");
      try { e.runCommand("replaceitem entity @s slot.weapon.mainhand 0 crossbow"); } catch {}
      if (!gunPackWarned) { gunPackWarned = true; world.sendMessage("§cGun soldiers need the TWW Gun Pack active in this world. Using crossbows instead."); }
      return;
    }
  }
  try { e.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${item}`); }
  catch { if (item === "iron_spear") { try { e.runCommand("replaceitem entity @s slot.weapon.mainhand 0 trident"); } catch {} } }
}
const ARMOR = ["none", "leather", "iron", "netherite"];
const ARMOR_LABEL = ["No armor", "Leather (full set)", "Iron (full set)", "Netherite (full set)"];
function equipArmor(e, tier) {
  const t = ARMOR.includes(tier) ? tier : "none";
  const parts = [["slot.armor.head", "helmet"], ["slot.armor.chest", "chestplate"], ["slot.armor.legs", "leggings"], ["slot.armor.feet", "boots"]];
  for (const [slot, piece] of parts) {
    try { e.runCommand(`replaceitem entity @s ${slot} 0 ${t === "none" ? "air" : `${t}_${piece}`}`); } catch {}
  }
}
function weaponItem(e) {
  const d = sd(e);
  if (d.surr || d.div === "medic") return "air";
  if (d.div === "grenadier" && Number(e.getDynamicProperty("war:snow") ?? 3) > 0) return "snowball";
  if (GUNS.includes(d.weapon)) return `ww:${gunModel(d.faction, d.weapon)}`;
  if (d.ranged) return "crossbow";
  return d.div === "cavalier" ? "air" : "iron_sword"; // the cavalier's lance is part of its model
}

// ================================================================ waypoints & flags
const slotOf = (m) => Number(m.getDynamicProperty("war:slot") ?? 0);
const markers = () => [...allOf(WAYPOINT), ...allOf(FLAG)];
function marker(slot) {
  if (!slot) return undefined;
  if (!markerCache.has(slot)) markerCache.set(slot, markers().find((m) => slotOf(m) === slot));
  const m = markerCache.get(slot);
  return m && m.isValid ? m : undefined;
}
function claimSlot(m) {
  const taken = new Set(markers().map(slotOf));
  for (const v of threatSlot.values()) taken.add(v);
  const assign = (i) => { m.setDynamicProperty("war:slot", i); tagMarker(m, i); m.setDynamicProperty("war:born", Date.now()); markerCache.delete(i); return i; };
  for (let i = 1; i <= NSLOT; i++) if (!taken.has(i)) return assign(i);
  // all slots taken: recycle the oldest marker nobody uses any more
  const used = usedSlots();
  let old, ob = Infinity;
  for (const w of allOf(WAYPOINT)) {
    if (w.id === m.id) continue;
    const sl = slotOf(w), b = Number(w.getDynamicProperty("war:born") ?? 0);
    if (!used.has(sl) && b < ob) { ob = b; old = w; }
  }
  if (old) { const sl = slotOf(old); try { old.remove(); } catch {} return assign(sl); }
  return 0;
}
function makeWaypoint(dim, loc, reuse = true) {
  if (reuse) {
    const near = dim.getEntities({ type: WAYPOINT, location: loc, maxDistance: 2.5 })[0];
    if (near && slotOf(near)) return slotOf(near);
  }
  const m = dim.spawnEntity(WAYPOINT, loc);
  try { m.addEffect("invisibility", 20000000, { showParticles: false }); } catch {}
  const s = claimSlot(m);
  if (!s) m.remove();
  else { const seen = getJSON(world, "war:slotseen", {}); seen[s] = Date.now(); setJSON(world, "war:slotseen", seen); }
  return s;
}
function setGoal(e, slot) {
  for (const t of e.getTags()) if (t.startsWith("war_go") || t.startsWith("war_gr") || t.startsWith("war_gc")) e.removeTag(t);
  if (slot) { e.addTag(`war_gr${rowOf(slot)}`); e.addTag(`war_gc${colOf(slot)}`); }
  e.setDynamicProperty("war:goal", slot);
  try { noteRefs(e); } catch {}
}
const SLOT_KEYS = ["war:goal", "war:home", "war:mwp", "war:chargegoal", "war:ordergoal", "war:catchup"];
let slotRefs = null; // soldier id -> [slots] (last known, kept while he's out of range)
function getRefs() { if (!slotRefs) slotRefs = getJSON(world, "war:slotrefs", {}); return slotRefs; }
function noteRefs(e) {
  const r = SLOT_KEYS.map((k) => Number(e.getDynamicProperty(k) ?? 0)).filter((x) => x > 0);
  getRefs()[e.id] = [...new Set(r)];
}
function usedSlots() {
  const used = new Set();
  for (const list of Object.values(getRefs())) for (const sl of list) used.add(sl);
  for (const m of Object.values(getMarches())) for (const l of m.lanes) used.add(l);
  for (const v of threatSlot.values()) used.add(v);
  return used;
}
function gcWaypoints(soldiers) {
  for (const s of soldiers) { try { noteRefs(s); } catch {} }
  const used = usedSlots();
  const now = Date.now();
  for (const m of [...allOf(WAYPOINT), ...allOf(FLAG)]) {
    try { if (slotOf(m) && !m.hasTag(`war_wr${rowOf(slotOf(m))}`)) tagMarker(m, slotOf(m)); } catch {}   // migrate old tags
  }
  for (const m of allOf(WAYPOINT)) {
    try {
      m.addEffect("invisibility", 20000000, { showParticles: false });   // no shadow "dots"
      const born = Number(m.getDynamicProperty("war:born") ?? 0);
      if (!used.has(slotOf(m)) && now - born > 30000) m.remove();
    } catch {}
  }
  setJSON(world, "war:slotrefs", getRefs());
}
function nearestFlag(dim, loc, pred, maxD = 300) {
  let best, bd = maxD;
  for (const f of dim.getEntities({ type: FLAG, location: loc, maxDistance: maxD })) {
    if (!pred(f)) continue;
    const d0 = dist(f.location, loc);
    if (d0 < bd) { bd = d0; best = f; }
  }
  return best;
}

// ================================================================ setup
function setupSoldier(e, s, player, { heal = true } = {}) {
  const div = DIV[s.div] ? s.div : "foot";
  setP(e, "war:faction", s.faction ?? 0);
  const weapon = div === "medic" || div === "grenadier" ? "sword" : (s.weapon && WEAPONS.some((w) => w[0] === s.weapon) ? s.weapon : (s.ranged ? "crossbow" : "sword"));
  e.setDynamicProperty("war:weapon", weapon);
  setP(e, "war:ranged", weapon !== "sword");
  setP(e, "war:skin", s.skin ?? 0);
  setP(e, "war:cav", div === "cavalier");
  setP(e, "war:medic", div === "medic");
  e.setDynamicProperty("war:div", div);
  e.setDynamicProperty("war:squad", s.squad ?? 0);
  e.setDynamicProperty("war:radius", s.radius ?? 8);
  e.setDynamicProperty("war:custom", s.custom ?? "");
  e.setDynamicProperty("war:armor", s.armor ?? "none");
  if (div === "guard") e.setDynamicProperty("war:owner", s.owner ?? player?.id);
  if (div === "houndmaster") e.addTag("war_hm"); else e.removeTag("war_hm");
  e.triggerEvent(div === "cavalier" ? "war:body_cav" : "war:body_foot");
  if (heal) e.triggerEvent(`war:${DIV[div].hp}`);
  equip(e, weaponItem(e));
  equipArmor(e, s.armor ?? "none");
  applyRelations(e);
  if (s.func === "__none") return e;
  const ok = FUNCS[div].some((f) => f[0] === s.func);
  return giveFunction(e, ok ? s.func : FUNCS[div][0][0], player);
}

function replaceSoldier(e) {
  const s = { ...snapshot(e), owner: e.getDynamicProperty("war:owner") };
  const hp = e.getComponent("minecraft:health");
  const cur = hp ? hp.currentValue : undefined;
  const n = e.dimension.spawnEntity(SOLDIER, e.location, { spawnEvent: "war:init" });
  setupSoldier(n, { ...s, func: "__none" }, undefined);
  try { if (cur !== undefined) n.getComponent("minecraft:health").setCurrentValue(cur); } catch {}
  e.remove();
  return n;
}
function retame(e, player) {
  const t = e.getComponent("minecraft:tameable");
  if (!t || !player) return e;
  let owner;
  try { owner = t.tamedToPlayerId; } catch {}
  if (owner === player.id) return e;
  try { t.tame(player); } catch {}
  try { owner = t.tamedToPlayerId; } catch {}
  if (owner === player.id || !owner) return e;
  const n = replaceSoldier(e);
  try { n.getComponent("minecraft:tameable").tame(player); } catch {}
  return n;
}

// Give a soldier a function; goalSlot optionally points it at a waypoint/flag.
function marchMembership(e, slot) {
  const ms = getMarches();
  let changed = false;
  for (const m of Object.values(ms)) {
    m.members = m.members ?? [];
    const inLanes = slot && m.lanes.includes(slot);
    const has = m.members.includes(e.id);
    if (inLanes && !has) { m.members.push(e.id); changed = true; }
    else if (!inLanes && has) { m.members = m.members.filter((x) => x !== e.id); changed = true; }
  }
  if (changed) saveMarches();
}
// wipe everything left over from earlier orders: searches, noises, water exits, catch-ups, fall-backs
function freshMind(e) {
  const s = perc.get(e.id);
  if (s) { s.threat = undefined; s.searchUntil = 0; s.lastSeen = undefined; s.noise = undefined; s.noiseT = -999; s.alert = "calm"; s.seen.clear(); }
  crossing.delete(e.id); exitSpot.delete(e.id); wetSince.delete(e.id); assist.delete(e.id);
  e.setDynamicProperty("war:retreat", false); e.setDynamicProperty("war:retreatUntil", 0);
  e.setDynamicProperty("war:calm", 0); e.setDynamicProperty("war:stuck", 0);
  e.setDynamicProperty("war:ordergoal", undefined); e.setDynamicProperty("war:catchup", undefined);
}
function giveFunction(e, func, player, goalSlot) {
  e.setDynamicProperty("war:ordergoal", undefined);
  e.setDynamicProperty("war:catchup", undefined);
  const d = sd(e);
  e.setDynamicProperty("war:func", func);
  e.setDynamicProperty("war:retreat", false);
  if (func === "follow" || func === "escort") {
    const leader = func === "escort" ? findPlayer(d.owner) ?? player : player;
    if (leader) { e = retame(e, leader); e.setDynamicProperty("war:leader", leader.id); }
    setGoal(e, 0);
  } else if (func === "charge") {
    setGoal(e, goalSlot ?? 0);
    e.setDynamicProperty("war:chargegoal", goalSlot ?? 0);
  } else if (func === "squad") {
    let slot = Number(e.getDynamicProperty("war:mwp") ?? 0);
    if (!marker(slot)) { slot = makeWaypoint(e.dimension, e.location, false); e.setDynamicProperty("war:mwp", slot); }
    setGoal(e, slot);
  } else {
    const slot = goalSlot ?? makeWaypoint(e.dimension, e.location);
    setGoal(e, slot);
    e.setDynamicProperty("war:home", slot);
  }
  updateName(e);
  setJSON(e, "war:st", {});
  try { marchMembership(e, Number(e.getDynamicProperty("war:goal") ?? 0)); } catch {}
  think(e);
  return e;
}

// ================================================================ surrender
function surrender(e, captor) {
  const d = sd(e);
  if (d.surr) return;
  e.setDynamicProperty("war:prevfunc", d.func);
  e.setDynamicProperty("war:surr", captor);
  const slot = makeWaypoint(e.dimension, e.location);
  setGoal(e, slot);
  e.setDynamicProperty("war:home", slot);
  equip(e, "air");
  applyRelations(e);
  setGroups(e, { w: "w_none", t: "t_off", g: "g_post", s: "s_1", d: "d_off", r: "r_off" });
}
function resume(e) {
  if (!e.getDynamicProperty("war:surr")) return;
  e.setDynamicProperty("war:surr", 0);
  equip(e, weaponItem(e));
  applyRelations(e);
  const prev = String(e.getDynamicProperty("war:prevfunc") ?? "hold");
  const d = sd(e);
  giveFunction(e, prev === "follow" || prev === "escort" ? prev : prev === "charge" ? "hold" : prev, findPlayer(d.leader));
}

// ================================================================ the brain
function speedGroup(e, urgent) {
  const until = Number(e.getDynamicProperty("war:pacet") ?? 0), was = e.getDynamicProperty("war:pace");
  const mode = urgent ? "u" : "w";
  if (typeof was === "string" && was.startsWith(mode) && tick() < until) return was.slice(1);
  const g = speedGroupRoll(e, urgent);
  e.setDynamicProperty("war:pace", mode + g);
  e.setDynamicProperty("war:pacet", tick() + 160 + Math.floor(Math.random() * 80));
  return g;
}
function speedGroupRoll(e, urgent) {
  const cav = !!P(e, "war:cav");
  const pace = e.id.charCodeAt(e.id.length - 1) % 3; // personal pace: slow, steady, quick
  let s = urgent ? 3 + Math.floor(Math.random() * 3) : 1 + pace + (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0);
  s = Math.max(1, Math.min(5, s));
  if (cav) s = 5 + Math.max(1, Math.min(3, Math.ceil(s / 2)));
  return `s_${s}`;
}

function think(e) {
  const d = sd(e);
  const now = tick();
  // while engaging, the order's own goal is parked in war:ordergoal
  const parked = e.getDynamicProperty("war:ordergoal");
  if (parked !== undefined) d.goal = Number(parked);
  if (d.surr) {
    // resume when the war with the captor is over
    if (!isHostile(d.faction, d.surr)) resume(e);
    else setGroups(e, { w: "w_none", t: "t_off", g: "g_post", s: "s_1", d: "d_off", r: "r_off" });
    return;
  }
  const riding = isRiding(e);
  const hp = e.getComponent("minecraft:health");
  const hpr = hp ? hp.currentValue / hp.effectiveMax : 1;
  const lastHurt = Number(e.getDynamicProperty("war:hurt") ?? -9999);
  const alert = Number(e.getDynamicProperty("war:alert") ?? -9999) > now;
  const fighting = now - lastHurt < 80;

  // ---- morale
  let foes = 0, friends = 0;
  for (const o of e.dimension.getEntities({ location: e.location, maxDistance: 12 })) {
    if (o.id === e.id || (o.typeId !== SOLDIER && o.typeId !== "minecraft:player" && o.typeId !== HOUND)) continue;
    const of = factionOf(o);
    if (isHostile(d.faction, of)) foes++;
    else if (isFriendly(d.faction, of)) friends++;
  }
  let retreat = d.retreat;
  const canRetreat = !riding && (d.div !== "garrison" || d.func === "patrol");
  if (!retreat && canRetreat && (hpr < 0.3 || (hpr < 0.6 && foes >= friends * 2 + 3))) {
    retreat = true;
    e.setDynamicProperty("war:retreat", true);
    if (e.getDynamicProperty("war:ordergoal") !== undefined) { setGoal(e, Number(e.getDynamicProperty("war:ordergoal"))); e.setDynamicProperty("war:ordergoal", undefined); }
    updateName(e);
  } else if (retreat && hpr > 0.75 && foes <= friends + 1 && now > Number(e.getDynamicProperty("war:retreatUntil") ?? 0)) {
    retreat = false;
    e.setDynamicProperty("war:retreat", false);
    const home = Number(e.getDynamicProperty("war:home") ?? 0);
    if (ANCHORED.includes(d.func)) setGoal(e, home);
    else if (d.func === "squad") setGoal(e, Number(e.getDynamicProperty("war:mwp") ?? 0));
    else if (d.func === "charge") setGoal(e, Number(e.getDynamicProperty("war:chargegoal") ?? 0)); // rejoin the charge
    else setGoal(e, 0);
    d.goal = Number(e.getDynamicProperty("war:goal") ?? 0);
    updateName(e);
  }
  if (hp && hpr < 1 && now - lastHurt > 200) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + (retreat ? 2 : 1)));

  // ---- weapon
  let weapon = GUNS.includes(d.weapon) ? `w_${d.weapon}` : d.ranged ? "w_ranged" : d.div === "cavalier" ? "w_lance" : "w_melee";
  if (d.div === "medic") weapon = "w_keepaway";
  if (d.div === "grenadier") {
    const snow = Number(e.getDynamicProperty("war:snow") ?? 3);
    if (snow > 0) { weapon = "w_keepaway"; grenadier(e, d, now); }
    else weapon = "w_ranged";
  }
  if (d.div === "medic") medic(e, d, now);

  const pat = `g_pat${d.radius <= 5 ? 4 : d.radius <= 10 ? 8 : 14}`;
  const melee = weapon === "w_melee" || weapon === "w_lance";
  let want;
  if (retreat) {
    const rally = nearestFlag(e.dimension, e.location, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 128);
    const slot = rally ? slotOf(rally) : Number(e.getDynamicProperty("war:home") ?? 0);
    if (slot !== d.goal) setGoal(e, slot);
    // healed on the way? the check above already flips them back next pass
    want = { w: weapon, t: "t_off", g: slot ? "g_wp" : "g_flee", s: speedGroup(e, true), d: "d_off", r: "r_off" }; // no fighting back while falling back
  } else {
    const anchor = ["hold", "post", "sentry", "stand"].includes(d.func) ? marker(d.goal) : undefined;
    const cu = d.func === "charge" ? e.getDynamicProperty("war:catchup") : undefined;
    const engaged = engagement(e, d, now, d.goal, melee) ?? waterExit(e, d, now) ??
      (cu !== undefined && marker(Number(cu)) ? (note(e, "catching up"), { g: "g_wp", slot: Number(cu), t: "t_mid", urgent: true }) : undefined);
    // how far each stationary order may leave its spot to fight: post barely, hold to meet a charge, sentry its whole radius
    const leash = d.func === "post" ? (melee ? 4 : 2) : d.func === "sentry" ? d.radius + 4 : d.func === "hold" ? 18 : 4;
    if (anchor && !riding && dist(e.location, anchor.location) > leash + 2 && Number(e.getDynamicProperty("war:calm") ?? 0) <= now) {
      e.setDynamicProperty("war:calm", now + 60); // chased too far: walk back to the line
    }
    const calm = Number(e.getDynamicProperty("war:calm") ?? 0) > now;
    const walk = speedGroup(e, fighting || alert);
    switch (d.func) {
      case "hold": want = { w: weapon, t: melee ? "t_short" : "t_mid", g: "g_wp", s: walk, d: "d_off" }; break;
      case "patrol": want = { w: weapon, t: "t_mid", g: pat, s: walk, d: d.div === "guard" ? "d_on" : "d_off" }; break;
      case "follow": want = { w: weapon, t: "t_mid", g: "g_owner", s: speedGroup(e, true), d: "d_off" }; break;
      case "escort": want = { w: weapon, t: "t_off", g: "g_owner", s: speedGroup(e, true), d: "d_on" }; break; // bodyguards: defend, don't chase
      case "post": want = { w: weapon, t: melee && !alert ? "t_short" : "t_mid", g: "g_post", s: walk, d: "d_off" }; break;
      case "sentry": want = { w: weapon, t: `t_s${d.radius <= 8 ? 8 : d.radius <= 16 ? 16 : d.radius <= 24 ? 24 : 32}`, g: "g_post", s: walk, d: "d_off" }; break; // sortie within its radius
      case "stand": want = { w: weapon, t: "t_mid", g: "g_post", s: walk, d: "d_on" }; break;
      case "squad": medicAnchor(e, d); want = { w: weapon, t: "t_off", g: "g_wp", s: walk, d: "d_off" }; break;
      case "charge": {
        const m = marker(d.goal);
        if (arriveCharge(e, d)) return; // arrived: take a formation spot, then hold or patrol
        want = { w: weapon, t: "t_mid", g: m ? "g_wp" : "g_none", s: speedGroup(e, true), d: "d_off" };
        break;
      }
      default: want = { w: weapon, t: "t_mid", g: "g_wp", s: walk, d: "d_off" };
    }
    want.r = d.div === "medic" ? "r_off" : "r_on";
    // contact rule: units on the move engage what they see, and react to what they hear or what the squad reports
    // (contact is handled by perception/engagement below)
    if (d.weapon === "at") want.t = "t_at";                                        // anti-tank: only enemy-crewed vehicles
    else if (["rifle", "mg"].includes(d.weapon) && want.t === "t_mid") want.t = "t_far"; // long guns see farther
    // a gunner with an enemy right on top of him fights hand-to-hand, then goes back to shooting
    if (GUNS.includes(d.weapon) && d.weapon !== "at" && closeEnemy(e, d, 2.5)) want.w = "w_melee";
    if (d.div === "medic") want.t = "t_off";
    if (calm) { want.w = "w_none"; want.t = "t_off"; }
    // ---- perception overrides the order while there's something to deal with; then the order resumes
    if (engaged && !calm) {
      if (e.getDynamicProperty("war:ordergoal") === undefined) e.setDynamicProperty("war:ordergoal", d.goal);
      setGoal(e, engaged.slot ?? 0);
      e.setDynamicProperty("war:ordergoal", d.goal);
      want.g = engaged.g;
      if (want.t !== "t_at") want.t = engaged.t;
      want.s = engaged.slow ? "s_1" : speedGroup(e, engaged.urgent);
    } else if (e.getDynamicProperty("war:ordergoal") !== undefined) {
      setGoal(e, Number(e.getDynamicProperty("war:ordergoal")));  // back to the order
      e.setDynamicProperty("war:ordergoal", undefined);
    }
  }
  setGroups(e, want);
  if (!riding) unstick(e, d, fighting);
}

function closeEnemy(e, d, r) {
  for (const o of nearbyCombatants(e.dimension.id, e.location, r)) {
    if (o.id !== e.id && (o.typeId === SOLDIER || o.typeId === HOUND || o.typeId === "minecraft:player") && isHostile(d.faction, factionOf(o))) return o;
  }
  return undefined;
}

// Medic waypoint drifts to the centre of its squad (or nearby allies).
function medicAnchor(e, d) {
  const m = marker(Number(e.getDynamicProperty("war:mwp") ?? 0));
  if (!m) return;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const o of e.dimension.getEntities({ type: SOLDIER, location: e.location, maxDistance: d.squad ? 64 : 16 })) {
    const od = sd(o);
    if (o.id === e.id || od.div === "medic" || od.faction !== d.faction || (d.squad && od.squad !== d.squad)) continue;
    sx += o.location.x; sy += o.location.y; sz += o.location.z; n++;
  }
  if (!n) return;
  const c = { x: sx / n, y: sy / n, z: sz / n };
  if (dist(c, m.location) > 3) { try { m.teleport(c); } catch {} }
}
function medic(e, d, now) {
  if (Number(e.getDynamicProperty("war:healt") ?? 0) > now) return;
  let best, bestR = 0.8;
  for (const o of e.dimension.getEntities({ location: e.location, maxDistance: 8 })) {
    if (o.id === e.id || (o.typeId !== SOLDIER && o.typeId !== "minecraft:player" && o.typeId !== HOUND)) continue;
    if (!isFriendly(d.faction, factionOf(o))) continue;
    const h = o.getComponent("minecraft:health");
    if (!h) continue;
    const r = h.currentValue / h.effectiveMax;
    if (r < bestR) { bestR = r; best = o; }
  }
  if (!best) return;
  e.setDynamicProperty("war:healt", now + 60);
  const tgt = best;
  try {
    const from = { x: e.location.x, y: e.location.y + 1.5, z: e.location.z };
    const p = e.dimension.spawnEntity("minecraft:splash_potion", from);
    const dx = tgt.location.x - from.x, dz = tgt.location.z - from.z, dy = tgt.location.y + 1 - from.y;
    const l = Math.hypot(dx, dz) || 1;
    p.getComponent("minecraft:projectile")?.shoot({ x: (dx / l) * 0.5, y: 0.25 + dy * 0.05, z: (dz / l) * 0.5 }, { owner: e });
  } catch {}
  system.runTimeout(() => {
    if (!tgt.isValid) return;
    const h = tgt.getComponent("minecraft:health");
    if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 4));
    try { tgt.dimension.spawnParticle("minecraft:heart_particle", { x: tgt.location.x, y: tgt.location.y + 2, z: tgt.location.z }); } catch {}
  }, 12);
}
function grenadier(e, d, now) {
  if (Number(e.getDynamicProperty("war:snowt") ?? 0) > now) return;
  // only enemy soldiers, hounds, players, and tanks with an enemy crew; never mobs or empty targets
  let best, bd = 32;
  for (const o of e.dimension.getEntities({ location: e.location, maxDistance: 32 })) {
    if (o.id === e.id) continue;
    let ok = false;
    if (o.typeId === SOLDIER || o.typeId === HOUND) ok = isHostile(d.faction, factionOf(o));
    else if (o.typeId === "minecraft:player") { try { ok = o.getGameMode() !== GameMode.Creative && isHostile(d.faction, factionOf(o)); } catch {} }
    else if (o.typeId === "war:tank") {
      const crew = o.getComponent("minecraft:rideable")?.getRiders() ?? [];
      ok = crew.some((c) => isHostile(d.faction, factionOf(c)));
    }
    if (!ok) continue;
    const dd = dist(o.location, e.location);
    if (dd < bd && dd > 3) { bd = dd; best = o; }
  }
  if (!best) return;
  const snow = Number(e.getDynamicProperty("war:snow") ?? 3) - 1;
  e.setDynamicProperty("war:snow", snow);
  e.setDynamicProperty("war:snowt", now + 200); // 10 s
  try {
    const from = { x: e.location.x, y: e.location.y + 1.6, z: e.location.z };
    const sb = e.dimension.spawnEntity("minecraft:snowball", from);
    const dx = best.location.x - from.x, dz = best.location.z - from.z, l = Math.hypot(dx, dz) || 1;
    // lobbed arc (~40 degrees), speed scaled to distance; snowball gravity is about 0.03 per tick
    const ang = (40 * Math.PI) / 180;
    const sp = Math.min(1.9, Math.sqrt((0.03 * l) / Math.sin(2 * ang)) * 1.08);
    sb.getComponent("minecraft:projectile")?.shoot({ x: (dx / l) * sp * Math.cos(ang), y: sp * Math.sin(ang), z: (dz / l) * sp * Math.cos(ang) }, { owner: e });
  } catch {}
  if (snow <= 0) { setP(e, "war:ranged", true); equip(e, "crossbow"); }
}

// Stuck detection + catch-up teleports (works across dimensions for leaders).
function unstick(e, d, fighting) {
  const now = tick();
  let goalLoc, stop = 3;
  if ((d.func === "follow" || d.func === "escort") && d.leader) {
    const p = findPlayer(d.leader);
    if (p) {
      if (isRiding(p)) return; // leader in a vehicle: swim after / wait
      if (p.dimension.id !== e.dimension.id || dist(p.location, e.location) > 24) { tpNear(e, p.location, p.dimension); return; }
      goalLoc = p.location;
    }
  } else {
    const m = marker(Number(e.getDynamicProperty("war:goal") ?? 0));
    if (m) { goalLoc = m.location; stop = d.func === "patrol" ? d.radius + 2 : 4; }
  }
  if (!goalLoc || fighting) return;
  const far = flat(goalLoc, e.location);
  if (far <= stop + 2) return;
  const dim = e.dimension, p0 = e.location;
  const hx = (goalLoc.x - p0.x) / (far || 1), hz = (goalLoc.z - p0.z) / (far || 1);
  // ---- fall awareness first: is the way forward a drop?
  if (now % 20 < 10) { try { if (descend(e, goalLoc)) return; } catch {} }
  // ---- climb assist (every second): step up, boost over 2-high walls, hop small gaps
  if (now % 20 < 10) {
    const ax = p0.x + hx * 0.9, az = p0.z + hz * 0.9, y = Math.floor(p0.y);
    const at = (dy) => solidAt(dim, { x: ax, y: y + dy, z: az });
    if (at(0) && !at(1) && !at(2)) {                      // 1-block step
      push(e, { x: hx * 0.15, y: 0.42, z: hz * 0.15 }, 2);
    } else if (at(0) && at(1) && !at(2) && !at(3)) {      // 2-high wall: boost onto it
      const top = { x: Math.floor(ax) + 0.5, y: y + 2, z: Math.floor(az) + 0.5 };
      if (standable(dim, top)) { try { e.teleport(top); } catch {} }
    } else if (!at(-1) && !at(-2)) {                      // hole ahead: hop it if there's ground beyond
      const bx = p0.x + hx * 2, bz = p0.z + hz * 2;
      if (standable(dim, { x: Math.floor(bx) + 0.5, y, z: Math.floor(bz) + 0.5 })) push(e, { x: hx * 0.55, y: 0.32, z: hz * 0.55 }, 2);
    }
  }
  // ---- stuck recovery (every 5 s): side-step, then back off, then a short teleport as last resort
  const lpt = Number(e.getDynamicProperty("war:lpt") ?? 0);
  if (now - lpt < 100) return;
  const lp = e.getDynamicProperty("war:lp");
  const moved = lp && typeof lp === "object" ? dist(lp, p0) : 99;
  e.setDynamicProperty("war:lp", { x: p0.x, y: p0.y, z: p0.z });
  e.setDynamicProperty("war:lpt", now);
  let stage = Number(e.getDynamicProperty("war:stuck") ?? 0);
  if (moved >= 1) { if (stage) e.setDynamicProperty("war:stuck", 0); return; }
  stage++;
  e.setDynamicProperty("war:stuck", stage);
  const side = e.id.charCodeAt(e.id.length - 1) % 2 ? 1 : -1;
  try {
    if (stage === 1) push(e, { x: -hz * side * 0.6, y: 0.2, z: hx * side * 0.6 }, 2);
    else if (stage === 2) push(e, { x: -hx * 0.7 - hz * side * 0.3, y: 0.2, z: -hz * 0.7 + hx * side * 0.3 }, 2);
    else {
      if (far < 10) tpNear(e, goalLoc, dim);
      else tpNear(e, { x: p0.x + hx * 4, y: p0.y, z: p0.z + hz * 4 }, dim);
      e.setDynamicProperty("war:stuck", 0);
    }
  } catch {}
}
function standable(dim, loc) {
  try {
    const feet = dim.getBlock(loc), head = dim.getBlock({ x: loc.x, y: loc.y + 1, z: loc.z }), floor = dim.getBlock({ x: loc.x, y: loc.y - 1, z: loc.z });
    return feet?.isAir && head?.isAir && floor && !floor.isAir && !floor.isLiquid;
  } catch { return false; }
}
function tpNear(e, loc, dim) {
  const base = { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z) + 0.5 };
  for (const dy of [0, 1, -1, 2, -2, 3])
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2]]) {
      const c = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
      if (standable(dim, c)) { try { e.teleport(c, { dimension: dim }); } catch {} return; }
    }
}

world.afterEvents.entitySpawn.subscribe((ev) => {
  const b = ev.entity;
  let id;
  try { id = b.typeId; } catch { return; }
  if (!BULLETS.includes(id)) return;
  system.run(() => {
    try {
      const owner = b.getComponent("minecraft:projectile")?.owner;
      if (!owner || owner.typeId !== SOLDIER) return;
      const d = sd(owner);
      if (!GUNS.includes(d.weapon)) return;
      const m = gunModel(d.faction, d.weapon);
      owner.dimension.playSound(`${m}_shot_mid`, owner.location, { volume: 1.5 });
      try { owner.dimension.playSound(`${m}_shot_far`, owner.location, { volume: 6 }); } catch {}
      setP(owner, "war:firing", true);
      const o = owner;
      system.runTimeout(() => { if (o.isValid) setP(o, "war:firing", false); }, 4);
      try {
        const h = owner.getHeadLocation(), v = owner.getViewDirection();
        owner.dimension.spawnParticle("ww:flash", { x: h.x + v.x * 1.3, y: h.y - 0.25 + v.y * 1.3, z: h.z + v.z * 1.3 });
      } catch {}
    } catch {}
  });
});

// ================================================================ main loops
let phase = 0;
system.runInterval(() => {
  markerCache = new Map();
  phase ^= 1;
  const v = relVersion();
  const soldiers = allOf(SOLDIER);
  for (const e of soldiers) {
    try {
      if (e.getDynamicProperty("war:div") === undefined) { setupSoldier(e, { faction: 0, div: "foot", func: "hold" }, undefined); continue; }
      syncProps(e);
      // old one-number goal tags (v4.2.1 and earlier): re-tag with the two-part scheme
      if (!e.hasTag("war_g2")) { setGoal(e, Number(e.getDynamicProperty("war:goal") ?? 0)); e.addTag("war_g2"); }
      // soldiers armed before guns were drawn on the model: re-arm once
      if (e.getDynamicProperty("p_war:gun") === undefined && GUNS.includes(String(e.getDynamicProperty("war:weapon") ?? ""))) equip(e, weaponItem(e));
      if (e.getDynamicProperty("war:relv") !== v) applyRelations(e);
      if ((e.id.charCodeAt(e.id.length - 1) & 1) === phase) think(e);
    } catch {}
  }
  for (const h of allOf(HOUND)) {
    try {
      syncProps(h);
      const m = world.getEntity(String(h.getDynamicProperty("war:master") ?? ""));
      if (m && m.isValid) {
        // hounds always share their master's faction and stay near him
        if (P(h, "war:faction") !== P(m, "war:faction") || !!m.getDynamicProperty("war:surr") !== !!h.getDynamicProperty("war:surr")) {
          setP(h, "war:faction", P(m, "war:faction"));
          h.setDynamicProperty("war:surr", m.getDynamicProperty("war:surr") ?? 0);
          applyRelations(h);
        }
        if (m.dimension.id !== h.dimension.id || dist(m.location, h.location) > 24) tpNear(h, m.location, m.dimension);
      }
      if (h.getDynamicProperty("war:relv") !== v) applyRelations(h);
    } catch {}
  }
  if (tick() % 200 < 10) { try { gcWaypoints(soldiers); } catch {} }
}, 10);

world.beforeEvents.entityHurt.subscribe((ev) => {
  // tanks shrug off small arms; no single hit takes more than ~a third of one
  try {
    if (ev.hurtEntity?.typeId === "war:tank") {
      const c = String(ev.damageSource.cause ?? "");
      const blast = c.includes("xplosion");
      if (!blast && ev.damage <= 25) ev.damage = ev.damage * 0.1;
      ev.damage = Math.min(ev.damage, 30);
      return;
    }
  } catch {}
  try {
    const v = ev.hurtEntity, a = ev.damageSource.damagingEntity;
    if (!a || !v || a.id === v.id) return;
    const fa = factionOf(a), fv = factionOf(v);
    if (fa && fv && isFriendly(fa, fv)) ev.damage = ev.damage * 0.25; // friendly fire: possible, but difficult
  } catch {}
});
world.afterEvents.entityHurt.subscribe((ev) => {
  try { chronHit(ev.damageSource.damagingEntity, ev.hurtEntity); } catch {}
  const v = ev.hurtEntity;
  if (!v?.isValid || (v.typeId !== SOLDIER && v.typeId !== "minecraft:player" && v.typeId !== HOUND)) return;
  const f = factionOf(v);
  if (!f) return;
  const now = tick();
  if (v.typeId === SOLDIER) v.setDynamicProperty("war:hurt", now);
  const sq = v.typeId === SOLDIER ? sd(v).squad : 0;
  for (const o of v.dimension.getEntities({ type: SOLDIER, location: v.location, maxDistance: 64 })) {
    const of = Number(P(o, "war:faction"));
    if (!isFriendly(of, f)) continue;
    const near = dist(o.location, v.location) <= 16;
    if (near || (sq && of === f && sd(o).squad === sq)) o.setDynamicProperty("war:alert", now + 200); // squad shares contact
  }
});

// ---- flags: capture
system.runInterval(() => {
  for (const flag of allOf(FLAG)) {
    try {
      if (P(flag, "war:rally")) continue;
      const owner = Number(P(flag, "war:faction"));
      const counts = new Map();
      for (const o of flag.dimension.getEntities({ location: flag.location, maxDistance: 7 })) {
        if (o.typeId !== SOLDIER && o.typeId !== "minecraft:player" && o.typeId !== HOUND) continue;
        const f = factionOf(o);
        if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      let defended = false, cap = 0, capN = 0;
      for (const [f, n] of counts) {
        if (isFriendly(owner, f)) defended = true;
        else if (isHostile(owner, f) && n > capN) { cap = f; capN = n; }
      }
      let prog = Number(flag.getDynamicProperty("war:cap") ?? 0);
      prog = defended || !cap ? Math.max(0, prog - 1) : prog + 1;
      flag.setDynamicProperty("war:cap", prog);
      if (cap && !defended && prog > 0) {
        for (const p of flag.dimension.getPlayers({ location: flag.location, maxDistance: 20 }))
          p.onScreenDisplay.setActionBar(`${factionLabel(cap)} §fcapturing ${factionLabel(owner)}§f's flag ${"§a|".repeat(prog)}${"§7|".repeat(Math.max(0, 8 - prog))}`);
      }
      if (prog >= 8) {
        flag.setDynamicProperty("war:cap", 0);
        setP(flag, "war:faction", cap);
        say(`§l${factionLabel(cap)} §r§fcaptured ${factionLabel(owner)}§f's war flag!`);
        chronFlagCaptured(flag.dimension, flag.location, `${factionLabel(cap, true)} captured ${factionLabel(owner, true)}'s war flag.`);
        if (setting("capture", "neutral") === "neutral") {
          setRelPair(owner, cap, "0");
          for (const e of [...allOf(SOLDIER), ...allOf(HOUND)]) { try { applyRelations(e); } catch {} }
        } else {
          for (const e of flag.dimension.getEntities({ type: SOLDIER, location: flag.location, maxDistance: 64 })) {
            if (Number(P(e, "war:faction")) === owner) surrender(e, cap);
          }
          say(`${factionLabel(owner)} §7soldiers near the flag have surrendered.`);
        }
      }
    } catch {}
  }
}, 40);

// ---- flags: breaking (own faction or creative), and vehicle pickup
const flagHits = new Map();
world.afterEvents.entityHitEntity.subscribe((ev) => {
  const p = ev.damagingEntity, t = ev.hitEntity;
  if (!(p instanceof Player) || !t?.isValid) return;
  if (t.typeId === FLAG) {
    const f = Number(P(t, "war:faction"));
    const creative = p.getGameMode() === GameMode.Creative;
    if (!creative && playerFaction(p) !== f) { p.onScreenDisplay.setActionBar("§cYou can't break an enemy flag. Capture it!"); return; }
    const n = (flagHits.get(t.id) ?? 0) + 1;
    flagHits.set(t.id, n);
    if (n < 3) { p.onScreenDisplay.setActionBar(`§7Breaking flag... ${n}/3`); return; }
    flagHits.delete(t.id);
    const war = !P(t, "war:rally");
    t.remove();
    giveItem(p, "war:flag");
    if (war && f) withdraw(f);
    return;
  }
  if (VEHICLES.includes(t.typeId)) {
    const item = { "war:boat": "war:boat_item", "war:plane": "war:plane_item", "war:tank": "war:tank_item" }[t.typeId];
    if (mainhand(p) !== item) return;
    const riders = t.getComponent("minecraft:rideable")?.getRiders() ?? [];
    if (riders.length) { p.onScreenDisplay.setActionBar("§cEveryone has to get out first."); return; }
    t.remove();
    giveItem(p, item);
  }
});

// Breaking your own war flag: wars with that faction go neutral until it places one again.
function withdraw(f) {
  const store = getJSON(world, "war:withdrawn", {});
  const list = new Set(store[f] ?? []);
  for (let b = 1; b <= NF; b++) if (isHostile(f, b)) { list.add(b); setRelPair(f, b, "0", false); }
  store[f] = [...list];
  setJSON(world, "war:withdrawn", store);
  say(`${factionLabel(f)} §ftook down its war flag. Its wars are on hold (Neutral) until it places one again.`);
  for (const e of [...allOf(SOLDIER), ...allOf(HOUND)]) { try { applyRelations(e); } catch {} }
}
function warFlagPlaced(f) {
  const store = getJSON(world, "war:withdrawn", {});
  const list = store[f] ?? [];
  for (const b of list) if (relAt(f, b) === "0") setRelPair(f, b, "1", false);
  if (list.length) say(`${factionLabel(f)} §fraised its war flag again. §cThe war resumes.`);
  delete store[f];
  setJSON(world, "war:withdrawn", store);
  for (const e of allOf(SOLDIER)) { try { if (Number(P(e, "war:faction")) === f && e.getDynamicProperty("war:surr")) resume(e); } catch {} }
  for (const e of [...allOf(SOLDIER), ...allOf(HOUND)]) { try { applyRelations(e); } catch {} }
}

// ---- players: guards come to you when you respawn
world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  setPlayerFaction(p, playerFaction(p));
  if (ev.initialSpawn) return;
  system.runTimeout(() => {
    for (const g of allOf(SOLDIER)) {
      try { if (g.getDynamicProperty("war:owner") === p.id && sd(g).div === "guard") tpNear(g, p.location, p.dimension); } catch {}
    }
  }, 20);
});

// ================================================================ vehicles
// Steering: the pilot's mouse sets the heading, W/S set speed. Jump fires (plane: bomb, tank: shell).
// Using the Command Baton while seated opens the vehicle menu (board / disembark / fire).
const vstate = new Map();      // id -> {speed, last, cd, age, dir, dim}
const riderCache = new Map();  // id -> rider ids
const projectiles = new Map(); // entity -> {kind, owner, age} (bombs)
const shells = [];             // scripted tank shells
let vehicleList = [];
const HUD = {
  "war:plane": "§7W/S speed · mouse steer · left-click bomb · §fslot 9: bombsight§7 · baton menu",
  "war:tank": "§7W/S drive · mouse turn · left-click fire · baton menu",
  "war:boat": "§7W/S row · mouse steer · baton menu",
};
const RELOAD = { "war:plane": 160, "war:tank": 60 }; // ticks: bomb 8 s, cannon 3 s
function reloadBar(v, st) {
  const total = RELOAD[v.typeId];
  if (!total) return "";
  const name = v.typeId === "war:plane" ? "BOMB" : "CANNON";
  const left = Math.max(0, st.cd - tick());
  if (!left) return `§a§l${name} READY§r`;
  const filled = Math.round((1 - left / total) * 10);
  return `§c${name} §f${"█".repeat(filled)}§8${"█".repeat(10 - filled)} §f${Math.ceil(left / 20)}s`;
}
// where the shot will land, shown as a marker in the world
function tankAim(v, pilot) {
  const look = pilot.getViewDirection(), f = fwdFromYaw(v.getRotation().y), loc = v.location;
  const ly = Math.max(-0.15, Math.min(0.3, look.y)), lh = Math.hypot(look.x, look.z) || 1;
  const dir = { x: (look.x / lh) * Math.sqrt(1 - ly * ly), y: ly, z: (look.z / lh) * Math.sqrt(1 - ly * ly) };
  const from = { x: loc.x + f.x * 4.2, y: loc.y + 1.5, z: loc.z + f.z * 4.2 };
  let hit;
  try { const b = v.dimension.getBlockFromRay(from, dir, { maxDistance: 100, includeLiquidBlocks: false, includePassableBlocks: false }); if (b) hit = { x: b.block.location.x + b.faceLocation.x, y: b.block.location.y + b.faceLocation.y, z: b.block.location.z + b.faceLocation.z }; } catch {}
  return hit;
}
function bombAim(v, nv) {
  const dim = v.dimension;
  let p = { x: v.location.x, y: v.location.y - 1.2, z: v.location.z };
  let vel = { x: nv.x * 0.8, y: -0.1, z: nv.z * 0.8 };
  for (let i = 0; i < 160; i++) {
    vel = { x: vel.x * 0.98, y: (vel.y - 0.04) * 0.98, z: vel.z * 0.98 };
    p = { x: p.x + vel.x, y: p.y + vel.y, z: p.z + vel.z };
    if (solidAt(dim, p)) return { x: p.x, y: Math.floor(p.y) + 1.1, z: p.z };
  }
  return undefined;
}
function marker3(dim, at, particle) {
  for (const o of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) {
    try { dim.spawnParticle(particle, { x: at.x + o[0], y: at.y + 0.2, z: at.z + o[1] }); } catch {}
  }
}
system.runInterval(() => { vehicleList = VEHICLES.flatMap((t) => allOf(t)); }, 20);
system.runInterval(() => {
  for (const v of vehicleList) { try { if (v.isValid) drive(v); } catch {} }
  stepShells();
  for (const [b, info] of [...projectiles]) {
    try {
      if (!b.isValid) { projectiles.delete(b); continue; }
      info.age++;
      const vel = b.getVelocity();
      const sp = Math.hypot(vel.x, vel.y, vel.z);
      const dir = sp > 0.01 ? { x: vel.x / sp, y: vel.y / sp, z: vel.z / sp } : { x: 0, y: -1, z: 0 };
      let hit = info.age > (info.kind === "shell" ? 40 : 200); // shells reach roughly 100 blocks
      if (!hit) hit = solidAt(b.dimension, b.location);
      if (!hit) { try { hit = !!b.dimension.getBlockFromRay(b.location, dir, { maxDistance: Math.max(0.8, sp * 1.2), includeLiquidBlocks: false, includePassableBlocks: false }); } catch {} }
      if (!hit && info.age > 1) {
        try {
          hit = b.dimension.getEntitiesFromRay(b.location, dir, { maxDistance: Math.max(1, sp * 1.2) }).some((h) => {
            const o = h.entity;
            return o.id !== b.id && o.id !== info.owner && !VEHICLES.includes(o.typeId) && o.typeId !== "war:bomb" && o.typeId !== "war:shell" &&
              o.typeId !== WAYPOINT && o.typeId !== FLAG && !(riderCache.get(info.owner) ?? []).includes(o.id);
          });
        } catch {}
      }
      if (!hit && info.age > 1) {
        hit = b.dimension.getEntities({ location: b.location, maxDistance: 1.6 }).some((o) =>
          o.id !== b.id && o.id !== info.owner && !VEHICLES.includes(o.typeId) && o.typeId !== "war:bomb" && o.typeId !== "war:shell" &&
          o.typeId !== WAYPOINT && o.typeId !== FLAG && !(riderCache.get(info.owner) ?? []).includes(o.id));
      }
      if (hit) {
        explode(b.dimension, b.location, 4, { breaksBlocks: !!setting("blockdmg", true), causesFire: false, source: info.src?.isValid ? info.src : undefined });
        projectiles.delete(b);
        b.remove();
      }
    } catch { projectiles.delete(b); }
  }
}, 1);

const chaseCam = new Set(); // players using the chase camera
const bombsight = new Set(); // pilots currently looking through the bombsight
function updateBombsight(pilot, v) {
  const want = pilot.selectedSlotIndex === 8;
  if (want) {
    const loc = v.location;
    let y = loc.y - 1.6;
    if (solidAt(v.dimension, { x: loc.x, y, z: loc.z })) y = loc.y + 0.3;
    try { pilot.camera.setCamera("minecraft:free", { location: { x: loc.x, y, z: loc.z }, rotation: { x: 90, y: v.getRotation().y } }); bombsight.add(pilot.id); } catch {}
  } else if (bombsight.has(pilot.id)) {
    bombsight.delete(pilot.id);
    try {
      if (chaseCam.has(pilot.id)) pilot.camera.setCamera("minecraft:fixed_boom", { entityOffset: { x: 0, y: 2.5, z: 0 }, viewOffset: { x: 0, y: 0 } });
      else pilot.camera.clear();
    } catch {}
  }
}
system.runInterval(() => {
  for (const id of [...chaseCam]) {
    const p = findPlayer(id);
    if (!p || !myVehicle(p)) { chaseCam.delete(id); try { p?.camera.clear(); } catch {} }
  }
  for (const id of [...bombsight]) {
    const p = findPlayer(id);
    if (!p || myVehicle(p)?.typeId !== "war:plane") { bombsight.delete(id); try { p?.camera.clear(); } catch {} }
  }
}, 10);
const fireRequests = new Map(); // player id -> tick of last left-click
world.afterEvents.playerSwingStart.subscribe((ev) => {
  const v = myVehicle(ev.player);
  if (v && v.typeId !== "war:boat") fireRequests.set(ev.player.id, tick());
});
function consumeFire(p) {
  const t = fireRequests.get(p.id);
  if (t === undefined || tick() - t > 4) return false;
  fireRequests.delete(p.id);
  return true;
}
function solidAt(dim, loc) {
  try { const b = dim.getBlock(loc); return !!b && !b.isAir && !b.isLiquid; } catch { return false; }
}
function blockedAhead(v, dir, reach, heights) {
  for (const h of heights) {
    try {
      const from = { x: v.location.x, y: v.location.y + h, z: v.location.z };
      if (v.dimension.getBlockFromRay(from, dir, { maxDistance: reach, includeLiquidBlocks: false, includePassableBlocks: false })) return true;
    } catch {}
  }
  return false;
}
function yawOf(d) { return (Math.atan2(-d.x, d.z) * 180) / Math.PI; }
function turnToward(cur, want, maxStep) {
  const diff = ((want - cur + 540) % 360) - 180;
  return cur + Math.max(-maxStep, Math.min(maxStep, diff));
}
// What's under the shooter's crosshair (block or entity), up to `range` blocks.
function aimPoint(v, shooter, range = 150) {
  const eye = shooter.getHeadLocation(), dir = shooter.getViewDirection(), dim = v.dimension;
  const crew = (v.getComponent("minecraft:rideable")?.getRiders() ?? []).map((r) => r.id);
  let best = range, at;
  try {
    const b = dim.getBlockFromRay(eye, dir, { maxDistance: range, includeLiquidBlocks: false, includePassableBlocks: false });
    if (b) {
      const p = { x: b.block.location.x + b.faceLocation.x, y: b.block.location.y + b.faceLocation.y, z: b.block.location.z + b.faceLocation.z };
      best = dist(eye, p); at = p;
    }
  } catch {}
  try {
    for (const h of dim.getEntitiesFromRay(eye, dir, { maxDistance: best })) {
      const o = h.entity;
      if (o.id === v.id || crew.includes(o.id) || o.typeId === WAYPOINT || o.typeId === "war:shell" || o.typeId === "war:bomb") continue;
      if (h.distance < best) { best = h.distance; at = { x: eye.x + dir.x * best, y: eye.y + dir.y * best, z: eye.z + dir.z * best }; }
      break;
    }
  } catch {}
  return { point: at ?? { x: eye.x + dir.x * range, y: eye.y + dir.y * range, z: eye.z + dir.z * range }, hit: !!at };
}
// Shells fly in a straight line from the barrel to the crosshair point, 4 blocks per tick.
function fireShell(v, shooter) {
  const f = fwdFromYaw(v.getRotation().y), loc = v.location;
  const muzzle = { x: loc.x + f.x * 4.2, y: loc.y + 1.6, z: loc.z + f.z * 4.2 };
  const { point } = aimPoint(v, shooter);
  const dx = point.x - muzzle.x, dy = point.y - muzzle.y, dz = point.z - muzzle.z, l = Math.hypot(dx, dy, dz) || 1;
  try {
    const ent = v.dimension.spawnEntity("war:shell", muzzle);
    shells.push({ ent, pos: muzzle, dir: { x: dx / l, y: dy / l, z: dz / l }, left: l, owner: v.id, src: shooter, dim: v.dimension });
  } catch {}
}
function stepShells() {
  for (let i = shells.length - 1; i >= 0; i--) {
    const sh = shells[i];
    let boom;
    const step = Math.min(4, sh.left);
    try {
      const b = sh.dim.getBlockFromRay(sh.pos, sh.dir, { maxDistance: Math.max(0.1, step), includeLiquidBlocks: false, includePassableBlocks: false });
      if (b) boom = { x: b.block.location.x + b.faceLocation.x, y: b.block.location.y + b.faceLocation.y, z: b.block.location.z + b.faceLocation.z };
    } catch {}
    if (!boom) {
      try {
        const crew = riderCache.get(sh.owner) ?? [];
        const h = sh.dim.getEntitiesFromRay(sh.pos, sh.dir, { maxDistance: Math.max(0.1, step) }).find((x) =>
          x.entity.id !== sh.owner && !crew.includes(x.entity.id) && x.entity.id !== sh.ent?.id &&
          ![WAYPOINT, "war:shell", "war:bomb"].includes(x.entity.typeId));
        if (h) {
          boom = { x: sh.pos.x + sh.dir.x * h.distance, y: sh.pos.y + sh.dir.y * h.distance, z: sh.pos.z + sh.dir.z * h.distance };
          hurt(h.entity, 30, sh.src); // direct hit
        }
      } catch {}
    }
    sh.pos = { x: sh.pos.x + sh.dir.x * step, y: sh.pos.y + sh.dir.y * step, z: sh.pos.z + sh.dir.z * step };
    sh.left -= step;
    if (!boom && sh.left <= 0.01) boom = sh.pos; // reached the aim point, or max range in open air
    if (boom) {
      explode(sh.dim, boom, 5, { breaksBlocks: !!setting("blockdmg", true), causesFire: false, source: sh.src?.isValid ? sh.src : undefined });
      try { sh.ent?.remove(); } catch {}
      shells.splice(i, 1);
    } else { try { sh.ent?.teleport(sh.pos); } catch {} }
  }
}
function fire(kind, v, pilot, from, vel) {
  try {
    const b = v.dimension.spawnEntity(kind === "shell" ? "war:shell" : "war:bomb", from);
    b.applyImpulse(vel);
    projectiles.set(b, { kind, owner: v.id, age: 0, src: pilot });
  } catch {}
}

function drive(v) {
  const rideable = v.getComponent("minecraft:rideable");
  const riders = rideable ? rideable.getRiders() : [];
  riderCache.set(v.id, riders.map((r) => r.id));
  if (v.typeId !== "war:boat") {
    const loc0 = v.location;
    let wet = false;
    try { wet = !!v.dimension.getBlock({ x: loc0.x, y: loc0.y + (v.typeId === "war:tank" ? 1.0 : 0.3), z: loc0.z })?.typeId.includes("water"); } catch {}
    if (wet) { // deep water: tanks flood, planes ditch
      say(`§7A ${v.typeId === "war:plane" ? "war plane" : "tank"} went into the water ${placeName(v.dimension, loc0)}.`);
      if (v.typeId === "war:plane") { crashPlane(v, riders); return; }
      for (const r of riders) { try { r.kill(); } catch {} }
      const dim0 = v.dimension; vstate.delete(v.id); riderCache.delete(v.id);
      try { v.remove(); } catch {}
      explode(dim0, loc0, 3, { breaksBlocks: !!setting("blockdmg", true), causesFire: false });
      return;
    }
  }
  if (tick() % 20 === 0) {
    const cf = riders.length ? factionOf(riders[0]) : 0;
    for (let i = 1; i <= NF; i++) { const want = i === cf; if (want !== v.hasTag(`war_f${i}`)) want ? v.addTag(`war_f${i}`) : v.removeTag(`war_f${i}`); }
  }
  const players = riders.filter((r) => r.typeId === "minecraft:player");
  const pilot = players[0];
  const gunner = v.typeId === "war:tank" ? players[1] ?? pilot : pilot; // 2nd player in a tank aims and fires
  const st = vstate.get(v.id) ?? { speed: 0, last: v.location, cd: 0, age: 0, dir: undefined };
  st.age++;
  const loc = v.location, vel = v.getVelocity();
  const ground = solidAt(v.dimension, { x: loc.x, y: loc.y - 0.2, z: loc.z });
  if (pilot && st.age % 5 === 0 && v.typeId !== "war:plane") {
    const bar = reloadBar(v, st);
    const role = v.typeId === "war:tank" && gunner !== pilot ? `§7Driver · gunner: ${gunner.name}` : HUD[v.typeId] ?? "";
    try { pilot.onScreenDisplay.setActionBar(bar ? `${bar}\n${role}` : role); } catch {}
    if (gunner && gunner !== pilot) { try { gunner.onScreenDisplay.setActionBar(`${bar}\n§7Gunner · aim with mouse · left-click fire`); } catch {} }
    if (v.typeId === "war:tank" && gunner) { const a = aimPoint(v, gunner); if (a.hit) marker3(v.dimension, a.point, "minecraft:villager_happy"); }
  }
  const jump = gunner ? consumeFire(gunner) : false;
  if (gunner && gunner !== pilot) consumeFire(pilot); // the driver's clicks don't fire

  if (v.typeId === "war:plane") {
    // ---- flight model: throttle, limited climb/turn, climbing costs speed, stall, ceiling, assists
    const mv = pilot ? pilot.inputInfo.getMovementVector() : { x: 0, y: 0 };
    if (st.throttle === undefined) { st.throttle = 0; st.pitch = 0; st.yaw = v.getRotation().y; }
    if (pilot) st.throttle = Math.max(0, Math.min(1, st.throttle + mv.y * 0.02)); // W/S move the throttle; it holds when released
    else st.throttle = Math.max(0, st.throttle - 0.02);
    const RAD = Math.PI / 180;
    const clearance = (() => { // blocks of air under the plane (up to 40)
      for (let i = 1; i <= 40; i++) if (solidAt(v.dimension, { x: loc.x, y: loc.y - i, z: loc.z })) return i - 1;
      return 40;
    })();
    let warn = "";
    if (pilot) {
      updateBombsight(pilot, v);
      const look = pilot.getViewDirection();
      const lookPitch = Math.asin(Math.max(-1, Math.min(1, look.y))) / RAD;
      // turning: a few degrees per tick, wider when fast
      const turnRate = 3.2 - Math.min(1.6, st.speed * 1.4);
      st.yaw = turnToward(st.yaw, pilot.getRotation().y, ground && st.speed < 0.2 ? 2.5 : turnRate);
      // pitch target: follows the mouse within limits; looking roughly level levels the plane (auto-level)
      let tp = Math.abs(lookPitch) < 8 ? 0 : Math.max(-35, Math.min(25, lookPitch));
      if (ground && st.speed < 0.5) tp = 0;                                  // take-off: need speed first
      if (ground && st.speed >= 0.5) tp = Math.max(tp, lookPitch > 5 ? 10 : 0);
      if (loc.y > 250) tp = Math.min(tp, -2);                                 // ceiling: thin air
      if (!ground && st.speed < 0.4) tp = Math.min(tp, -20);                  // stall: the nose drops
      // ground warning + gentle automatic pull-up (overridden by a deliberate steep dive)
      const dirNow = { x: -Math.sin(st.yaw * RAD) * Math.cos(st.pitch * RAD), y: Math.sin(st.pitch * RAD), z: Math.cos(st.yaw * RAD) * Math.cos(st.pitch * RAD) };
      if (!ground && st.speed > 0.45) {
        let hit = false;
        try { hit = !!v.dimension.getBlockFromRay({ x: loc.x, y: loc.y + 0.6, z: loc.z }, dirNow, { maxDistance: Math.max(6, st.speed * 40), includeLiquidBlocks: true, includePassableBlocks: false }); } catch {}
        if (hit) {
          warn = "§c§l! PULL UP !";
          let close = false;
          try { close = !!v.dimension.getBlockFromRay({ x: loc.x, y: loc.y + 0.6, z: loc.z }, dirNow, { maxDistance: Math.max(4, st.speed * 18), includeLiquidBlocks: true, includePassableBlocks: false }); } catch {}
          if (close && lookPitch > -45) tp = Math.max(tp, 15);
        }
      }
      st.pitch += Math.max(-1.6, Math.min(1.6, tp - st.pitch));
      if (st.age % 5 === 0 && !ground) { const at = bombAim(v, { x: dirNow.x * st.speed, y: 0, z: dirNow.z * st.speed }); if (at) marker3(v.dimension, at, "minecraft:redstone_ore_dust_particle"); }
      if (jump && st.cd <= tick() && !ground) {
        st.cd = tick() + RELOAD["war:plane"];
        fire("bomb", v, pilot, { x: loc.x, y: loc.y - 1.2, z: loc.z }, { x: dirNow.x * st.speed * 0.8, y: -0.1, z: dirNow.z * st.speed * 0.8 });
      }
    } else if (!ground) st.pitch = Math.max(-40, st.pitch - 1.5);           // nobody flying: the nose drops
    // speed: throttle pulls toward its target; climbing bleeds speed, diving adds it
    const targetSpeed = st.throttle * 1.1;
    st.speed += (targetSpeed - st.speed) * 0.02 - Math.sin(st.pitch * RAD) * 0.012;
    if (ground) st.speed = Math.min(st.speed, targetSpeed + 0.05);
    st.speed = Math.max(0, Math.min(1.4, st.speed));
    const dir = { x: -Math.sin(st.yaw * RAD) * Math.cos(st.pitch * RAD), y: Math.sin(st.pitch * RAD), z: Math.cos(st.yaw * RAD) * Math.cos(st.pitch * RAD) };
    st.dir = dir;
    let nv = { x: dir.x * st.speed, y: dir.y * st.speed, z: dir.z * st.speed };
    if (!ground && st.speed < 0.4) nv.y = Math.min(nv.y, -0.15 - (0.4 - st.speed) * 0.5);  // below flying speed it sinks
    // landing assist: low and slow over the ground settles gently
    const landing = !ground && clearance < 4 && st.speed < 0.6 && st.pitch <= 2;
    if (landing) nv.y = Math.max(nv.y, -0.08);
    if (ground && nv.y < 0) nv.y = 0;
    if (!pilot && ground) nv = { x: 0, y: 0, z: 0 };
    v.setRotation({ x: 0, y: st.yaw });
    v.clearVelocity(); v.applyImpulse(nv);
    if (pilot && st.age % 5 === 0) {
      const bar = reloadBar(v, st);
      const info = `§7Throttle ${Math.round(st.throttle * 100)}% · Speed ${Math.round(st.speed * 20 * 3.6)} km/h · Alt ${Math.round(loc.y)}${loc.y > 245 ? " §e(ceiling)" : ""}${!ground && st.speed < 0.45 ? " §c(STALL)" : ""}`;
      try { pilot.onScreenDisplay.setActionBar([warn, bar, info].filter(Boolean).join("\n")); } catch {}
    }
    // crash: flying fast into anything solid, or hitting the ground hard (a gentle landing is fine)
    const fast = st.speed > 0.55 || nv.y < -0.4;
    const moved = dist(st.last, loc);
    if (st.age > 20 && fast && !landing && (blockedAhead(v, dir, 2.5, [0.3, 1.0, 1.8]) || moved < 0.1 || (ground && nv.y < -0.4))) {
      crashPlane(v, riders); return;
    }
  } else {
    const boat = v.typeId === "war:boat";
    let target = { x: 0, z: 0 };
    if (pilot) {
      const mv = pilot.inputInfo.getMovementVector();
      const yaw = turnToward(v.getRotation().y, pilot.getRotation().y, boat ? 5 : 3.5);
      v.setRotation({ x: 0, y: yaw });
      let inWater = false;
      if (boat) { try { inWater = !!v.dimension.getBlock({ x: loc.x, y: loc.y - 0.1, z: loc.z })?.isLiquid || !!v.dimension.getBlock(loc)?.isLiquid; } catch {} }
      const max = boat ? (inWater ? 0.45 : 0.04) : 0.22;
      const f = fwdFromYaw(yaw);
      const sp = mv.y * (mv.y < 0 ? max * 0.5 : max);
      target = { x: f.x * sp, z: f.z * sp };
      if (!boat && jump && st.cd <= tick()) {
        st.cd = tick() + RELOAD["war:tank"];
        fireShell(v, gunner);
      }
    }
    v.applyImpulse({ x: (target.x - vel.x) * 0.5, y: 0, z: (target.z - vel.z) * 0.5 });
    if (!boat && st.age % 20 === 0) {
      for (const r of riders) { try { r.addEffect("invisibility", 45, { showParticles: false }); } catch {} } // crew is inside
    }
  }
  st.last = { x: loc.x, y: loc.y, z: loc.z };
  st.dim = v.dimension.id;
  vstate.set(v.id, st);
}
function crashPlane(v, riders) {
  const loc = v.location, dim = v.dimension;
  stopEngine(v.id);
  chronLog(`A war plane crashed ${placeName(dim, loc)}${riders.length ? `, killing ${riders.length} aboard` : ""}.`);
  for (const r of riders) { try { r.kill(); } catch {} }
  vstate.delete(v.id);
  riderCache.delete(v.id);
  try { v.remove(); } catch {}
  explode(dim, loc, 5, { breaksBlocks: !!setting("blockdmg", true), causesFire: true });
}
world.afterEvents.entityDie.subscribe((ev) => {
  const v = ev.deadEntity;
  if (v.typeId !== "war:plane" && v.typeId !== "war:tank") return;
  let loc, dim;
  try { loc = v.location; dim = v.dimension; } catch {
    const st = vstate.get(v.id);
    if (!st) return;
    loc = st.last; dim = world.getDimension(st.dim ?? "overworld");
  }
  if (v.typeId === "war:plane") {
    for (const id of riderCache.get(v.id) ?? []) { try { world.getEntity(id)?.kill(); } catch {} }
  }
  chronLog(`A ${v.typeId === "war:plane" ? "war plane was shot down" : "tank was destroyed"} ${placeName(dim, loc)}.`);
  explode(dim, loc, v.typeId === "war:plane" ? 5 : 3, { breaksBlocks: !!setting("blockdmg", true), causesFire: v.typeId === "war:plane" });
});

// Players always get in: soldiers make room (and never keep the driver's seat).
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const v = ev.target, p = ev.player;
  if (!v || !VEHICLES.includes(v.typeId)) return;
  let riders, seatCount;
  try { const r = v.getComponent("minecraft:rideable"); riders = r.getRiders(); seatCount = r.seatCount; } catch { return; }
  if (riders.some((r) => r.id === p.id)) return;
  const anyPlayer = riders.some((r) => r.typeId === "minecraft:player");
  const soldiers = riders.filter((r) => r.typeId === SOLDIER);
  const needDriver = !anyPlayer && soldiers.length > 0;
  const full = riders.length >= seatCount;
  if (!needDriver && !full) return; // normal boarding
  ev.cancel = true;
  system.run(() => {
    try {
      const rd = v.getComponent("minecraft:rideable");
      const out = needDriver ? soldiers : soldiers.slice(-1);
      for (const s of out) rd.ejectRider(s);
      let ok = false;
      try { ok = rd.addRider(p); } catch {}
      if (!ok) p.onScreenDisplay.setActionBar("§eSeat cleared. Right-click again to get in.");
      if (needDriver) system.runTimeout(() => { for (const s of out) { try { if (s.isValid && !isRiding(s)) rd.addRider(s); } catch {} } }, 10);
    } catch {}
  });
});
function myVehicle(player) {
  try { const e = player.getComponent("minecraft:riding")?.entityRidingOn; return e && VEHICLES.includes(e.typeId) ? e : undefined; } catch { return undefined; }
}
async function vehicleMenu(player, v) {
  const rideable = v.getComponent("minecraft:rideable");
  const soldiers = () => rideable.getRiders().filter((x) => x.typeId === SOLDIER);
  const free = Math.max(0, rideable.seatCount - rideable.getRiders().length);
  const opts = [];
  if (v.typeId !== "war:tank") opts.push(["board", `Units: get in  §8(${free} seats free)`], ["guards", "My guards: get in"], ["out", `Units: get out  §8(${soldiers().length} aboard)`]);
  opts.push(["cam", chaseCam.has(player.id) ? "Camera: back to normal" : "Camera: chase view (pulled back)"]);
  if (v.typeId === "war:plane") opts.push(["bomb", "Drop bomb"]);
  if (v.typeId === "war:tank") opts.push(["shell", "Fire cannon"]);
  opts.push(["army", "Army orders..."]);
  const af = new ActionFormData().title(v.typeId === "war:plane" ? "War Plane" : v.typeId === "war:tank" ? "Tank" : "Troop Boat")
    .body("Units within 24 blocks of the vehicle can board.");
  for (const o of opts) af.button(o[1]);
  const r = await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return true;
  const pick = opts[r.selection][0];
  if (pick === "army") return false;
  if (pick === "cam") {
    if (chaseCam.has(player.id)) { chaseCam.delete(player.id); try { player.camera.clear(); } catch {} }
    else {
      try { player.camera.setCamera("minecraft:fixed_boom", { entityOffset: { x: 0, y: 2.5, z: 0 }, viewOffset: { x: 0, y: 0 } }); chaseCam.add(player.id); }
      catch { player.onScreenDisplay.setActionBar("§cChase camera isn't available in this game version."); }
    }
    return true;
  }
  const st = vstate.get(v.id);
  if (pick === "bomb" || pick === "shell") {
    if (st && st.cd > tick()) { player.onScreenDisplay.setActionBar("§cStill reloading."); return true; }
    if (st) st.cd = tick() + RELOAD[v.typeId];
    fireNow(v, player, pick);
    return true;
  }
  if (pick === "out") {
    const list = soldiers();
    for (const s of list) {
      rideable.ejectRider(s);
      const sv = s;
      system.runTimeout(() => {
        if (!sv.isValid) return;
        const d = sd(sv);
        tpNear(sv, sv.location, sv.dimension);
        if (!["follow", "escort"].includes(d.func)) giveFunction(sv, d.div === "garrison" ? "post" : d.div === "guard" ? "stand" : "hold", player);
      }, 10);
    }
    player.onScreenDisplay.setActionBar(`§aUnits out: ${list.length}`);
    return true;
  }
  if (!free) { player.onScreenDisplay.setActionBar("§cNo free seats."); return true; }
  const pf = playerFaction(player);
  const cands = v.dimension.getEntities({ type: SOLDIER, location: v.location, maxDistance: 24 }).filter((e) => {
    const d = sd(e);
    if (isRiding(e) || d.surr || d.div === "cavalier") return false;
    return pick === "guards" ? d.div === "guard" && d.owner === player.id : d.div !== "guard" && (!pf || d.faction === pf);
  }).sort((a, b) => dist(a.location, v.location) - dist(b.location, v.location)).slice(0, free);
  let n = 0;
  for (const e of cands) {
    try { e.teleport({ x: v.location.x, y: v.location.y + 0.5, z: v.location.z }); if (rideable.addRider(e)) n++; } catch {}
  }
  player.onScreenDisplay.setActionBar(`§aUnits in: ${n}`);
  return true;
}
function fireNow(v, player, kind) {
  const loc = v.location, f = fwdFromYaw(v.getRotation().y);
  if (kind === "bomb") fire("bomb", v, player, { x: loc.x, y: loc.y - 1.2, z: loc.z }, { x: f.x * 0.3, y: -0.1, z: f.z * 0.3 });
  else fireShell(v, player);
}
async function placeVehicle(player, type) {
  const spot = lookedSpot(player, 16);
  if (!spot) { player.onScreenDisplay.setActionBar("§7Look at where to place it."); return; }
  const v = player.dimension.spawnEntity(type, spot);
  v.setRotation({ x: 0, y: player.getRotation().y });
  player.onScreenDisplay.setActionBar("§aPlaced. Right-click to get in. Hit it with this item to pick it up.");
}

// ================================================================ tool dispatch
const lastUse = new Map();
function tool(player, typeId, target) {
  if (!(player instanceof Player)) return;
  if (tick() - (lastUse.get(player.id) ?? -100) < 6) return;
  lastUse.set(player.id, tick());
  const run = (fn) => system.run(() => fn().catch((err) => player.sendMessage(`§cWar Engine error: ${err}`)));
  if (typeId?.startsWith("war:egg_")) return run(() => eggUse(player, typeId.slice(8)));
  switch (typeId) {
    case "war:command_baton": return run(() => batonUse(player));
    case "war:chronicle": return run(() => chronicleUse(player));
    case "war:flag": return run(() => placeFlag(player));
    case "war:unit_wand": return run(() => unitWand(player, target ?? lookedAt(player, SOLDIER)));
    case "war:boat_item": return run(() => placeVehicle(player, "war:boat"));
    case "war:plane_item": return run(() => placeVehicle(player, "war:plane"));
    case "war:tank_item": return run(() => placeVehicle(player, "war:tank"));
  }
}
system.beforeEvents.startup.subscribe((ev) => {
  ev.itemComponentRegistry.registerCustomComponent("war:tool", {
    onUse: (e) => tool(e.source, e.itemStack?.typeId),
    onUseOn: (e) => tool(e.source, e.itemStack?.typeId),
  });
  ev.blockComponentRegistry.registerCustomComponent("war:table", {
    onPlayerInteract: (e) => { const p = e.player; if (p) system.run(() => warTable(p).catch(() => {})); },
  });
});
world.afterEvents.itemUse.subscribe((ev) => tool(ev.source, ev.itemStack?.typeId));
world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  if (ev.target?.typeId !== SOLDIER) return;
  tool(ev.player, (ev.beforeItemStack ?? ev.itemStack)?.typeId, ev.target);
});
function lookedAt(player, type) {
  try { return player.getEntitiesFromViewDirection({ maxDistance: 16, type })[0]?.entity; } catch { return undefined; }
}
function lookedSpot(player, maxD = 64) {
  const hit = player.getBlockFromViewDirection({ maxDistance: maxD });
  if (!hit) return undefined;
  const b = hit.block.location;
  const off = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] }[hit.face] ?? [0, 1, 0];
  return { x: b.x + 0.5 + off[0], y: b.y + off[1], z: b.z + 0.5 + off[2] };
}
function spawnPoints(player, count) {
  const v = player.getViewDirection();
  const base = lookedSpot(player, 48) ?? { x: player.location.x + v.x * 3, y: player.location.y, z: player.location.z + v.z * 3 };
  const len = Math.hypot(v.x, v.z) || 1, fwd = { x: v.x / len, z: v.z / len }, right = { x: -fwd.z, z: fwd.x };
  const perRow = Math.min(6, count), pts = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow), col = (i % perRow) - (perRow - 1) / 2;
    pts.push({ x: base.x + right.x * col * 1.5 + fwd.x * row * 1.5, y: base.y, z: base.z + right.z * col * 1.5 + fwd.z * row * 1.5 });
  }
  return { base, pts };
}
function spawnArmy(player, s, count) {
  const { base, pts } = spawnPoints(player, count);
  const slot = ANCHORED.includes(s.func) ? makeWaypoint(player.dimension, base) : undefined;
  let n = 0;
  for (const p of pts) {
    try {
      const e = player.dimension.spawnEntity(SOLDIER, p, { spawnEvent: "war:init" });
      const fin = setupSoldier(e, { ...s, func: "__none", owner: player.id }, player);
      giveFunction(fin, s.func, player, slot);
      if (s.div === "houndmaster") {
        for (let i = 0; i < 5; i++) {
          const h = player.dimension.spawnEntity(HOUND, { x: p.x + (Math.random() - 0.5) * 2, y: p.y, z: p.z + (Math.random() - 0.5) * 2 });
          h.setDynamicProperty("war:master", fin.id);
          setP(h, "war:faction", s.faction);
          applyRelations(h);
        }
      }
      n++;
    } catch {}
  }
  return n;
}

// ================================================================ eggs (always a form, prefilled)
async function eggUse(player, div) {
  if (!DIV[div]) return;
  const key = `war:egg_${div}`;
  const def = getJSON(player, key, { faction: playerFaction(player) || 1, squad: 0, func: 0, weapon: "sword", count: 1, radius: 8 });
  const WL = div === "cavalier" ? WEAPONS.slice(0, 2) : WEAPONS;
  const wl = WL.map((w) => (w[0] === "sword" && div === "cavalier" ? "Spear" : w[1]));
  const wIdx = Math.max(0, WL.findIndex((w) => w[0] === (def.weapon ?? (def.ranged ? "crossbow" : "sword"))));
  const funcs = FUNCS[div];
  const f = new ModalFormData().title(`Spawn: ${DIV[div].name}`)
    .dropdown("Faction", factionList(), { defaultValueIndex: Math.max(0, def.faction - 1) })
    .dropdown("Squad", squadList(def.faction, "No squad"), { defaultValueIndex: def.squad })
    .dropdown("Function", funcs.map((x) => x[1]), { defaultValueIndex: Math.min(def.func, funcs.length - 1) })
    .dropdown("Weapon", DIV[div].weapon ? wl : [div === "medic" ? "None (heals)" : "Snowballs, then Crossbow"], { defaultValueIndex: DIV[div].weapon ? wIdx : 0 })
    .slider("How many", 1, 30, { valueStep: 1, defaultValue: def.count })
    .slider("Patrol / sentry radius", 4, 32, { valueStep: 1, defaultValue: def.radius });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  const cfg = { faction: Number(v[0]) + 1, squad: Number(v[1]), func: Number(v[2]), weapon: DIV[div].weapon ? WL[Number(v[3])][0] : "sword", count: Number(v[4]), radius: Number(v[5]) };
  setJSON(player, key, cfg);
  const n = spawnArmy(player, { faction: cfg.faction, squad: cfg.squad, weapon: cfg.weapon, ranged: cfg.weapon !== "sword", div, radius: cfg.radius, func: funcs[cfg.func][0] }, cfg.count);
  player.onScreenDisplay.setActionBar(`§aSpawned ${n} ${factionLabel(cfg.faction)} §a${DIV[div].name}${n > 1 ? "s" : ""} §7(${funcs[cfg.func][1]}${cfg.squad ? ", " + squadName(cfg.faction, cfg.squad) : ""})`);
}

// ================================================================ Command Baton (army only)
const ORDERS = [["charge", "Charge POS"], ["hold", "Hold here"], ["patrol", "Patrol here"], ["follow", "Follow me"], ["fallback", "Fall back"], ["board", "Board the vehicle I'm looking at"], ["mark", "Mark this spot (where I'm standing)"]];
const mapFunc = (order, div) => (div === "garrison" ? { hold: "post", patrol: "patrol", follow: "follow", charge: "charge" } : { hold: "hold", patrol: "patrol", follow: "follow", charge: "charge" })[order];

async function batonUse(player) {
  const veh = myVehicle(player);
  if (veh && (await vehicleMenu(player, veh))) return;
  let cfg = getJSON(player, "war:lastorder", undefined);
  if (!cfg || !player.isSneaking) {
    const def = cfg ?? { faction: playerFaction(player), order: 0, squad: 0, count: 0, radius: 200 };
    const ff = new ActionFormData().title("Orders: which faction?");
    const facOpts = [];
    if (playerFaction(player)) { facOpts.push(playerFaction(player)); ff.button(`My faction: ${factionLabel(playerFaction(player))}`); }
    facOpts.push(0); ff.button("All factions");
    for (let i = 1; i <= NF; i++) if (i !== playerFaction(player)) { facOpts.push(i); ff.button(factionLabel(i)); }
    const fr = await show(ff, player);
    if (!fr || fr.canceled || fr.selection === undefined) return;
    const fac = facOpts[fr.selection];
    const of = new ModalFormData().title(`Orders: ${factionLabel(fac, true)}`)
      .dropdown("Order", ORDERS.map((o) => o[1]), { defaultValueIndex: def.order })
      .dropdown("Squad (Garrison only obeys when its squad is picked)", squadList(fac, "All squads"), { defaultValueIndex: fac === def.faction ? def.squad : 0 })
      .slider("How many (0 = all)", 0, 100, { valueStep: 5, defaultValue: def.count })
      .slider("Soldiers within (blocks)", 16, 200, { valueStep: 8, defaultValue: def.radius })
      .dropdown("Stance", ["Aggressive (chase what they see)", "Defensive (hold and shoot what comes)", "Hold fire (only shoot back)"], { defaultValueIndex: Math.max(0, ["aggressive", "defensive", "holdfire"].indexOf(def.stance ?? "aggressive")) });
    const or = await show(of, player);
    if (!or || or.canceled || !or.formValues) return;
    const v = or.formValues.map(Number);
    cfg = { faction: fac, order: v[0], squad: v[1], count: v[2], radius: v[3], stance: ["aggressive", "defensive", "holdfire"][v[4]] ?? "aggressive" };
    if (ORDERS[cfg.order][0] === "mark") { await markSpot(player); return; }
    if (ORDERS[cfg.order][0] === "charge") {
      const tf = new ActionFormData().title("Charge POS: where?").button("Where I'm looking (any distance)").button("Nearest enemy war flag")
        .button("Forward").button("Left").button("Right").button("Coordinates").button("Marked spot");
      const tr = await show(tf, player);
      if (!tr || tr.canceled || tr.selection === undefined) return;
      cfg.target = tr.selection;
      cfg.far = def.far ?? 100;
      if (tr.selection === 6) {
        const mk = await pickMark(player);
        if (!mk) return;
        cfg.target = 5; cfg.cx = mk.x; cfg.cz = mk.z; cfg.cy = mk.y;
      }
      const THEN = ["hold", "patrol"];
      const df = new ModalFormData().title("Charge POS");
      if (tr.selection >= 2 && tr.selection <= 4) df.slider("How far (blocks)", 25, 1000, { valueStep: 25, defaultValue: Math.min(1000, def.far ?? 100) });
      if (tr.selection === 5) {
        df.textField("X", "e.g. 1200", { defaultValue: String(Math.round(def.cx ?? player.location.x)) });
        df.textField("Z", "e.g. -340", { defaultValue: String(Math.round(def.cz ?? player.location.z)) });
      }
      df.dropdown("When they arrive", ["Hold the area", "Patrol the area"], { defaultValueIndex: Math.max(0, THEN.indexOf(def.then ?? "hold")) });
      const dr = await show(df, player);
      if (!dr || dr.canceled || !dr.formValues) return;
      const fv = dr.formValues;
      if (tr.selection >= 2 && tr.selection <= 4) cfg.far = Number(fv[0]);
      if (tr.selection === 5) {
        cfg.cy = undefined;
        cfg.cx = Number(String(fv[0]).trim()); cfg.cz = Number(String(fv[1]).trim());
        if (!Number.isFinite(cfg.cx) || !Number.isFinite(cfg.cz)) { player.sendMessage("§cX and Z must be numbers."); return; }
      }
      cfg.then = THEN[Number(fv[fv.length - 1])] ?? "hold";
    }
    setJSON(player, "war:lastorder", cfg);
  }
  await giveOrder(player, cfg);
}

function chargePoint(player, cfg) {
  if (cfg.target === 0) return aimFar(player);
  if (cfg.target === 5) return { x: cfg.cx + 0.5, y: cfg.cy, z: cfg.cz + 0.5 };
  if (cfg.target === 1) {
    const f = nearestFlag(player.dimension, player.location, (fl) => !P(fl, "war:rally") &&
      (cfg.faction ? isHostile(cfg.faction, Number(P(fl, "war:faction"))) : Number(P(fl, "war:faction")) !== playerFaction(player)), 400);
    return f ? { slot: slotOf(f) } : undefined;
  }
  const yaw = player.getRotation().y + (cfg.target === 3 ? -90 : cfg.target === 4 ? 90 : 0);
  const f = fwdFromYaw(yaw);
  // far points may be in unloaded land: the march finds the ground when it gets there
  return { x: player.location.x + f.x * cfg.far, y: player.location.y, z: player.location.z + f.z * cfg.far };
}

async function giveOrder(player, cfg) {
  try { await giveOrderInner(player, cfg); }
  catch (err) { player.onScreenDisplay.setActionBar(`§cThat order couldn't be given here (${String(err).slice(0, 60)}).`); }
}
async function giveOrderInner(player, cfg) {
  let order = ORDERS[cfg.order][0];
  if (order === "mark") { await markSpot(player); return; }
  const now = tick();
  let pool = player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: cfg.radius }).filter((e) => {
    const d = sd(e);
    if (d.surr || d.div === "guard" || d.div === "medic" || isRiding(e)) return false;
    if (cfg.faction && d.faction !== cfg.faction) return false;
    if (cfg.squad && d.squad !== cfg.squad) return false;
    if (d.div === "garrison" && !cfg.squad) return false; // garrison only answers to its own squad
    return true;
  });
  // fresh soldiers first, then nearest
  pool.sort((a, b) => {
    const fa = now - Number(a.getDynamicProperty("war:ordt") ?? -99999) < 2400 ? 1 : 0;
    const fb = now - Number(b.getDynamicProperty("war:ordt") ?? -99999) < 2400 ? 1 : 0;
    return fa - fb || dist(a.location, player.location) - dist(b.location, player.location);
  });
  if (cfg.count) pool = pool.slice(0, cfg.count);
  if (!pool.length) { player.onScreenDisplay.setActionBar("§7No soldiers matched that order."); return; }

  if (order === "board") {
    let veh;
    try { veh = player.getEntitiesFromViewDirection({ maxDistance: 64 }).map((h) => h.entity).find((x) => VEHICLES.includes(x.typeId)); } catch {}
    if (!veh) { player.onScreenDisplay.setActionBar("§cLook at a boat, plane or tank."); return; }
    const rd = veh.getComponent("minecraft:rideable");
    const free = Math.max(0, rd.seatCount - rd.getRiders().length);
    let n = 0;
    for (const e of pool.filter((x) => sd(x).div !== "cavalier").slice(0, free)) {
      try { e.teleport({ x: veh.location.x, y: veh.location.y + 0.5, z: veh.location.z }); if (rd.addRider(e)) { n++; e.setDynamicProperty("war:ordt", now); } } catch {}
    }
    player.onScreenDisplay.setActionBar(`§eBoarded: §f${n} §7(${free - n} seats left)`);
    return;
  }
  let slot, spotCenter, march;
  if (order === "charge") {
    const pt = chargePoint(player, cfg);
    if (!pt) { player.onScreenDisplay.setActionBar("§cCouldn't find that position."); return; }
    let dest = pt;
    if ("slot" in pt) { const fl = marker(pt.slot); dest = fl ? { x: fl.location.x, y: fl.location.y, z: fl.location.z } : undefined; }
    march = dest ? startMarch(player, pool, dest, cfg.then ?? "hold") : undefined;
    slot = march ? march.lanes[0] : 0;
  } else if (order === "hold" || order === "patrol") {
    const spot = aimFar(player);
    if (!spot) { player.onScreenDisplay.setActionBar("§cLook at the ground where they should go."); return; }
    let loaded = !spot.estimated;
    try { if (loaded) loaded = !!player.dimension.getBlock(spot); } catch { loaded = false; }
    if (!loaded || dist(spot, player.location) > 48) {
      // far away: march there in formation first, then hold / patrol
      march = startMarch(player, pool, spot, order);
      if (!march) { spotCenter = spot; slot = makeWaypoint(player.dimension, spot); }
      cfg = { ...cfg, then: order };
      order = "charge";
      slot = march.lanes[0];
    } else {
      spotCenter = spot;
      slot = makeWaypoint(player.dimension, spot);
    }
  }
  if ((order === "charge" || order === "hold" || order === "patrol") && !slot) { gcWaypoints(allOf(SOLDIER)); player.onScreenDisplay.setActionBar("§eMarkers were full and have been cleaned up. Give the order again."); return; }
  let n = 0;
  for (const e of pool) {
    try {
      freshMind(e);                                            // the newest order overrides everything
      e.setDynamicProperty("war:ordt", now);
      if (order !== "fallback") e.setDynamicProperty("war:stance", cfg.stance ?? "aggressive");
      if (order === "fallback") {
        e.setDynamicProperty("war:retreat", true);
        e.setDynamicProperty("war:retreatUntil", now + 600);
        updateName(e); setJSON(e, "war:st", {}); think(e);
      } else if (spotCenter) {
        // each soldier gets its own spot around the target instead of one crowded point
        giveFunction(e, mapFunc(order, sd(e).div), player, formationSlot(e.dimension, spotCenter, e, order === "patrol" ? 4 : 2.5) || slot);
      } else if (march) {
        e.setDynamicProperty("war:then", cfg.then ?? "hold");
        giveFunction(e, mapFunc(order, sd(e).div), player, march.lanes[n % march.lanes.length]); // each soldier gets a lane
      } else {
        giveFunction(e, mapFunc(order, sd(e).div), player, slot);
      }
      n++;
    } catch {}
  }
  player.onScreenDisplay.setActionBar(`§e${ORDERS[cfg.order][1]}: §f${n} soldier${n === 1 ? "" : "s"} §7(sneak + use repeats)`);
}

// ================================================================ Unit Wand
const skinChoices = () => SKINS.map((name, i) => ({ name, slot: i + 1 })).filter((s) => s.name && s.name.trim());
async function unitWand(player, e) {
  const tpl = getJSON(player, "war:template", undefined);
  const opts = [];
  const mine = e && sd(e).div === "guard" && sd(e).owner === player.id;
  if (e) {
    opts.push(["edit", "Edit this soldier"], ["copy", "Copy this soldier"]);
    if (mine) opts.push(["guards", "Guard orders"]);
    if (tpl) opts.push(["paste1", "Paste copy onto this soldier"]);
    opts.push(["dismiss1", "§cDismiss this soldier"]);
  } else {
    opts.push(["guards", "My guards: orders"]);
  }
  if (tpl) opts.push(["spawn", "Spawn copies"], ["pasteN", "Paste copy onto nearby soldiers"]);
  opts.push(["dismissN", "§cDismiss a faction nearby"]);
  const af = new ActionFormData().title("Unit Wand")
    .body((e ? e.nameTag + "\n" : "") + (tpl ? `§7Copied: ${factionLabel(tpl.faction)} §7${DIV[tpl.div]?.name}` : "§7Nothing copied."));
  for (const o of opts) af.button(o[1]);
  const r = await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return;
  const pick = opts[r.selection][0];
  if (e && !e.isValid) return;

  if (pick === "edit") await editSoldier(player, e);
  else if (pick === "copy") { setJSON(player, "war:template", snapshot(e)); player.onScreenDisplay.setActionBar("§aCopied."); }
  else if (pick === "paste1") pasteOnto(e, tpl, player);
  else if (pick === "dismiss1") {
    for (const h of allOf(HOUND)) if (h.getDynamicProperty("war:master") === e.id) h.remove();
    e.remove(); player.onScreenDisplay.setActionBar("§7Dismissed.");
  }
  else if (pick === "guards") await guardOrders(player, mine ? e : undefined);
  else if (pick === "spawn") {
    const mr = await show(new ModalFormData().title("Spawn copies").slider("How many", 1, 30, { valueStep: 1, defaultValue: 5 }), player);
    if (!mr || mr.canceled || !mr.formValues) return;
    const n = spawnArmy(player, tpl, Number(mr.formValues[0]));
    player.onScreenDisplay.setActionBar(`§aSpawned ${n} copies.`);
  } else if (pick === "pasteN") {
    const mr = await show(new ModalFormData().title("Paste onto nearby soldiers")
      .slider("Radius", 4, 64, { valueStep: 4, defaultValue: 16 })
      .toggle("Only soldiers of the copied faction", { defaultValue: true })
      .toggle("Skin only (keep everything else)", { defaultValue: true }), player);
    if (!mr || mr.canceled || !mr.formValues) return;
    const [rad, same, skinOnly] = mr.formValues;
    let n = 0;
    for (const s of player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: Number(rad) })) {
      if (same && sd(s).faction !== tpl.faction) continue;
      if (skinOnly) setP(s, "war:skin", tpl.skin); else pasteOnto(s, tpl, player);
      n++;
    }
    player.onScreenDisplay.setActionBar(`§aPasted onto ${n} soldiers.`);
  } else if (pick === "dismissN") {
    const mr = await show(new ModalFormData().title("Dismiss soldiers")
      .dropdown("Faction", ["All factions", ...factionList()], { defaultValueIndex: 0 })
      .slider("Radius", 8, 200, { valueStep: 8, defaultValue: 48 }), player);
    if (!mr || mr.canceled || !mr.formValues) return;
    const fac = Number(mr.formValues[0]);
    let n = 0;
    for (const t of [SOLDIER, HOUND]) for (const s of player.dimension.getEntities({ type: t, location: player.location, maxDistance: Number(mr.formValues[1]) })) {
      if (fac && Number(P(s, "war:faction")) !== fac) continue;
      delete getRefs()[s.id];
      s.remove(); n++;
    }
    player.onScreenDisplay.setActionBar(`§7Dismissed ${n}.`);
  }
}
async function editSoldier(player, e) {
  const d = sd(e);
  const funcs = FUNCS[d.div];
  const skins = skinChoices();
  const f = new ModalFormData().title(`Edit ${DIV[d.div].name}`)
    .dropdown("Faction", ["None", ...factionList()], { defaultValueIndex: d.faction })
    .dropdown("Squad", squadList(d.faction, "No squad"), { defaultValueIndex: d.squad })
    .dropdown("Function", funcs.map((x) => x[1]), { defaultValueIndex: Math.max(0, funcs.findIndex((x) => x[0] === d.func)) })
    .dropdown("Weapon", DIV[d.div].weapon ? (d.div === "cavalier" ? WEAPONS.slice(0, 2) : WEAPONS).map((w) => (w[0] === "sword" && d.div === "cavalier" ? "Spear" : w[1])) : ["(fixed for this unit)"], { defaultValueIndex: DIV[d.div].weapon ? Math.max(0, (d.div === "cavalier" ? WEAPONS.slice(0, 2) : WEAPONS).findIndex((w) => w[0] === d.weapon)) : 0 })
    .dropdown("Armor", ARMOR_LABEL, { defaultValueIndex: Math.max(0, ARMOR.indexOf(d.armor)) })
    .dropdown("Skin", ["Faction uniform", ...skins.map((s) => s.name)], { defaultValueIndex: Math.max(0, skins.findIndex((s) => s.slot === d.skin) + 1) })
    .slider("Patrol / sentry radius", 4, 32, { valueStep: 1, defaultValue: Math.min(32, Math.max(4, d.radius)) })
    .textField("Name (blank = automatic)", "e.g. Sgt. Rossi", { defaultValue: d.custom })
    .dropdown("Stance", ["Aggressive", "Defensive", "Hold fire"], { defaultValueIndex: Math.max(0, ["aggressive", "defensive", "holdfire"].indexOf(String(e.getDynamicProperty("war:stance") ?? "aggressive"))) });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues || !e.isValid) return;
  const v = r.formValues;
  const skinIdx = Number(v[5]);
  const wpn = DIV[d.div].weapon ? (d.div === "cavalier" ? WEAPONS.slice(0, 2) : WEAPONS)[Number(v[3])][0] : d.weapon;
  const s = { ...snapshot(e), faction: Number(v[0]), squad: Number(v[1]), weapon: wpn, ranged: wpn !== "sword",
    armor: ARMOR[Number(v[4])] ?? "none",
    skin: skinIdx ? skins[skinIdx - 1].slot : 0, radius: Number(v[6]), custom: String(v[7]).trim(), owner: d.owner, func: "__none" };
  const func = funcs[Number(v[2])][0];
  e.setDynamicProperty("war:stance", ["aggressive", "defensive", "holdfire"][Number(v[8])] ?? "aggressive");
  const ne = setupSoldier(e, s, player, { heal: false });
  giveFunction(ne, func, player, ANCHORED.includes(func) && func === d.func ? d.goal || undefined : undefined);
  player.onScreenDisplay.setActionBar("§aSoldier updated.");
}
function pasteOnto(e, tpl, player) {
  if (!e.isValid) return;
  const d = sd(e);
  // division stays the soldier's own
  const s = { ...tpl, div: d.div, custom: d.custom, owner: d.owner, func: FUNCS[d.div].some((x) => x[0] === tpl.func) ? tpl.func : d.func };
  setupSoldier(e, s, player, { heal: false });
}
async function guardOrders(player, one) {
  const f = new ModalFormData().title("Guard orders")
    .dropdown("Order", ["Escort me", "Stand guard here", "Patrol here"], { defaultValueIndex: 0 })
    .toggle("Apply to all my guards", { defaultValue: !one });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const func = ["escort", "stand", "patrol"][Number(r.formValues[0])];
  const targets = r.formValues[1] || !one
    ? allOf(SOLDIER).filter((g) => sd(g).div === "guard" && sd(g).owner === player.id)
    : [one];
  const spot = func === "escort" ? undefined : lookedSpot(player, 64) ?? player.location;
  const slot = spot ? makeWaypoint(player.dimension, spot) : undefined;
  for (const g of targets) { try { giveFunction(g, func, player, slot); } catch {} }
  player.onScreenDisplay.setActionBar(`§aGuards: ${["Escort", "Stand guard", "Patrol"][Number(r.formValues[0])]} (${targets.length})`);
}

// ================================================================ Flags
async function placeFlag(player) {
  const spot = lookedSpot(player, 32);
  if (!spot) { player.onScreenDisplay.setActionBar("§7Look at the ground to place a flag."); return; }
  const f = new ModalFormData().title("Place a flag")
    .dropdown("Faction", factionList(), { defaultValueIndex: Math.max(0, playerFaction(player) - 1) })
    .dropdown("Type", ["War flag (heart of the battle)", "Rally flag (wounded fall back here)"], { defaultValueIndex: 0 });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const fac = Number(r.formValues[0]) + 1, rally = r.formValues[1] === 1;
  const fl = player.dimension.spawnEntity(FLAG, spot);
  setP(fl, "war:faction", fac);
  setP(fl, "war:rally", rally);
  if (!claimSlot(fl)) { fl.remove(); player.sendMessage("§cToo many flags/markers in the world."); return; }
  if (!rally) warFlagPlaced(fac);
  chronLog(`${player.name} raised a ${rally ? "rally" : "war"} flag for ${factionLabel(fac, true)} ${placeName(player.dimension, spot)}.`);
  player.onScreenDisplay.setActionBar(`§a${rally ? "Rally" : "War"} flag placed for ${factionLabel(fac)}§a.`);
}

// ================================================================ War Table
async function warTable(player) {
  const af = new ActionFormData().title("War Table").body(`Your faction: ${factionLabel(playerFaction(player))}`)
    .button("Join a faction").button("Leave my faction").button("Diplomacy").button("Name factions").button("Name squads").button("Settings").button("Coalitions").button("War archive");
  const r = await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return;
  const pickFaction = async (title) => {
    const jf = new ActionFormData().title(title);
    for (const l of factionList()) jf.button(l);
    const jr = await show(jf, player);
    return jr && !jr.canceled && jr.selection !== undefined ? jr.selection + 1 : 0;
  };
  if (r.selection === 0) {
    const f = await pickFaction("Join a faction");
    if (!f) return;
    setPlayerFaction(player, f);
    say(`§e${player.name} §rjoined ${factionLabel(f)}`);
  } else if (r.selection === 1) {
    setPlayerFaction(player, 0);
    player.sendMessage("§7You left your faction. Soldiers will ignore you.");
  } else if (r.selection === 2) {
    const a = await pickFaction("Diplomacy: pick a faction");
    if (!a) return;
    while (true) {
      const others = Array.from({ length: NF }, (_, i) => i + 1).filter((b) => b !== a);
      const mf = new ActionFormData().title(`Relations: ${factionLabel(a, true)}`).body("Tap a faction to set its relation. Applies to both sides instantly.");
      for (const b of others) mf.button(`${factionLabel(b)}\n${REL_TXT[relAt(a, b)]}`);
      const mr = await show(mf, player);
      if (!mr || mr.canceled || mr.selection === undefined) return;
      const b = others[mr.selection];
      const cur = relAt(a, b);
      const vals = ["1", "0", "2"];
      const cf = new ActionFormData().title(`${factionLabel(a, true)} and ${factionLabel(b, true)}`).body(`Currently: ${REL_TXT[cur]}`);
      for (const val of vals) cf.button(`${REL_TXT[val]}${val === cur ? "  §8(current)" : ""}`);
      const cr = await show(cf, player);
      if (!cr || cr.canceled || cr.selection === undefined) continue;
      setRelPair(a, b, vals[cr.selection]);
      for (const e of [...allOf(SOLDIER), ...allOf(HOUND)]) { try { applyRelations(e); } catch {} }
    }
  } else if (r.selection === 3) {
    const names = getNames();
    const nf = new ModalFormData().title("Name factions");
    COLORS.forEach(([c, code], i) => nf.textField(`${code}${c}`, "country name (optional)", { defaultValue: names[i] ?? "" }));
    const nr = await show(nf, player);
    if (!nr || nr.canceled || !nr.formValues) return;
    namesCache = nr.formValues.map((x) => String(x).trim().slice(0, 24));
    world.setDynamicProperty("war:names", JSON.stringify(namesCache));
    world.setDynamicProperty("war:relv", relVersion() + 1);
    player.sendMessage("§aFaction names saved.");
  } else if (r.selection === 4) {
    const f = await pickFaction("Name squads: pick a faction");
    if (!f) return;
    const cur = getSquads()[f] ?? [];
    const nf = new ModalFormData().title(`Squads of ${factionLabel(f, true)}`);
    for (let i = 1; i <= 9; i++) nf.textField(`Squad ${i}`, "e.g. Castle", { defaultValue: cur[i - 1] ?? "" });
    const nr = await show(nf, player);
    if (!nr || nr.canceled || !nr.formValues) return;
    const all = getSquads();
    all[f] = nr.formValues.map((x) => String(x).trim().slice(0, 20));
    squadsCache = all;
    world.setDynamicProperty("war:squads", JSON.stringify(all));
    world.setDynamicProperty("war:relv", relVersion() + 1);
    player.sendMessage("§aSquad names saved.");
  } else if (r.selection === 6) {
    await coalitions(player);
  } else if (r.selection === 7) {
    await warArchive(player);
  } else if (r.selection === 5) {
    const which = await show(new ActionFormData().title("Settings").button("General").button("Gun loadouts (per faction)"), player);
    if (!which || which.canceled || which.selection === undefined) return;
    if (which.selection === 1) { await loadoutMenu(player); return; }
    const sf = new ModalFormData().title("Settings")
      .dropdown("When a war flag is captured", ["The two factions become Neutral", "Nearby losers surrender (war continues)"], { defaultValueIndex: setting("capture", "neutral") === "neutral" ? 0 : 1 })
      .toggle("Explosions break blocks (bombs, crashes)", { defaultValue: !!setting("blockdmg", true) })
      .slider("Spacing between moving soldiers (blocks)", 1, 2, { valueStep: 0.5, defaultValue: Number(setting("spacing", 1.5)) })
      .toggle("Show soldier decisions (for testing)", { defaultValue: !!setting("readout", false) });
    const sr = await show(sf, player);
    if (!sr || sr.canceled || !sr.formValues) return;
    world.setDynamicProperty("war:set_capture", sr.formValues[0] === 0 ? "neutral" : "surrender");
    world.setDynamicProperty("war:set_blockdmg", !!sr.formValues[1]);
    world.setDynamicProperty("war:set_spacing", Number(sr.formValues[2]));
    world.setDynamicProperty("war:set_readout", !!sr.formValues[3]);
    player.sendMessage("§aSettings saved.");
  }
}

// ================================================================ Coalitions
// A named bloc of factions. Members are allied; one tap sets relations for every member.
const getCoals = () => getJSON(world, "war:coal", []);
const saveCoals = (c) => setJSON(world, "war:coal", c);
const coalOf = (f) => getCoals().findIndex((c) => c.members.includes(f));
function refreshAll() { for (const e of [...allOf(SOLDIER), ...allOf(HOUND)]) { try { applyRelations(e); } catch {} } }

async function coalitions(player) {
  while (true) {
    const coals = getCoals();
    const af = new ActionFormData().title("Coalitions").body(coals.length ? "Pick a coalition, or create one." : "No coalitions yet.");
    for (const c of coals) af.button(`§l${c.name}§r\n${c.members.map((m) => factionLabel(m)).join(" ") || "§7(empty)"}`);
    af.button("§a+ Create coalition");
    const r = await show(af, player);
    if (!r || r.canceled || r.selection === undefined) return;
    if (r.selection === coals.length) {
      const nr = await show(new ModalFormData().title("Create coalition").textField("Name", "e.g. Northern Pact"), player);
      if (!nr || nr.canceled || !nr.formValues) continue;
      const name = String(nr.formValues[0]).trim().slice(0, 24) || `Coalition ${coals.length + 1}`;
      coals.push({ name, members: [] }); saveCoals(coals);
      say(`§eNew coalition: §l${name}`);
      continue;
    }
    await coalitionMenu(player, r.selection);
  }
}

async function coalitionMenu(player, idx) {
  while (true) {
    const coals = getCoals();
    const c = coals[idx];
    if (!c) return;
    const af = new ActionFormData().title(c.name).body(`Members: ${c.members.map((m) => factionLabel(m)).join(", ") || "none"}`)
      .button("Add a faction").button("Remove a faction").button("Set relation with...").button("§cDelete coalition");
    const r = await show(af, player);
    if (!r || r.canceled || r.selection === undefined) return;
    if (r.selection === 0) {
      const free = Array.from({ length: NF }, (_, i) => i + 1).filter((f) => coalOf(f) === -1);
      if (!free.length) { player.sendMessage("§7Every faction is already in a coalition."); continue; }
      const pf = new ActionFormData().title(`Add to ${c.name}`).body("A faction can be in one coalition at a time.");
      for (const f of free) pf.button(factionLabel(f));
      const pr = await show(pf, player);
      if (!pr || pr.canceled || pr.selection === undefined) continue;
      const f = free[pr.selection];
      for (const m of c.members) setRelPair(f, m, "2", false); // members are allies
      c.members.push(f); saveCoals(coals); refreshAll();
      say(`${factionLabel(f)} §fjoined §l${c.name}§r§f.`);
    } else if (r.selection === 1) {
      if (!c.members.length) continue;
      const pf = new ActionFormData().title(`Remove from ${c.name}`).body("Relations stay as they are; change them in Diplomacy if needed.");
      for (const f of c.members) pf.button(factionLabel(f));
      const pr = await show(pf, player);
      if (pr === undefined || pr.canceled || pr.selection === undefined) continue;
      const f = c.members[pr.selection];
      c.members.splice(pr.selection, 1); saveCoals(coals);
      say(`${factionLabel(f)} §fleft §l${c.name}§r§f.`);
    } else if (r.selection === 2) {
      // targets: other coalitions, then factions outside this coalition
      const targets = [];
      const tf = new ActionFormData().title(`${c.name}: relation with...`);
      coals.forEach((o, i) => { if (i !== idx) { targets.push({ name: `§l${o.name}§r`, members: o.members }); tf.button(`§l${o.name}§r (coalition)`); } });
      for (let f = 1; f <= NF; f++) if (!c.members.includes(f)) { targets.push({ name: factionLabel(f), members: [f] }); tf.button(factionLabel(f)); }
      const tr = await show(tf, player);
      if (!tr || tr.canceled || tr.selection === undefined) continue;
      const t = targets[tr.selection];
      const vals = ["1", "0", "2"];
      const cf = new ActionFormData().title(`${c.name} and ${t.name}`);
      for (const val of vals) cf.button(REL_TXT[val]);
      const cr = await show(cf, player);
      if (!cr || cr.canceled || cr.selection === undefined) continue;
      const v = vals[cr.selection];
      for (const a of c.members) for (const b of t.members) setRelPair(a, b, v, false);
      refreshAll();
      say(`§l${c.name}§r §fis now ${REL_TXT[v]}§r§f with ${t.name}`);
    } else {
      coals.splice(idx, 1); saveCoals(coals);
      say(`§7Coalition §l${c.name}§r§7 was dissolved. Relations stay as they are.`);
      return;
    }
  }
}

// ================================================================ War Chronicle
// One war is recorded at a time. Everything the mod does, plus player deaths, is logged
// until the war is ended; then the record becomes an editable book.
let chron = null;          // { name, startDay, startDate, deaths:{f:n}, pdeaths, battles, flags, by }
let chronEvents = [];      // [{ d: day, t: text }]
let chronDirty = false;
const battles = [];        // active battles: { x, y, z, dim, start, last, factions:Set, cas:{f:n}, named:[], flag }
const strip = (t) => String(t).replace(/§./g, "");
const day = () => { try { return world.getDay(); } catch { return 0; } };
function saveChunks(prefix, str) {
  const n = Math.ceil(str.length / 30000) || 1;
  for (let i = 0; i < n; i++) world.setDynamicProperty(`${prefix}${i}`, str.slice(i * 30000, (i + 1) * 30000));
  world.setDynamicProperty(`${prefix}n`, n);
}
function loadChunks(prefix) {
  const n = Number(world.getDynamicProperty(`${prefix}n`) ?? 0);
  let out = "";
  for (let i = 0; i < n; i++) out += String(world.getDynamicProperty(`${prefix}${i}`) ?? "");
  return out;
}
function chronLoad() {
  try { chron = JSON.parse(String(world.getDynamicProperty("war:chron") ?? "null")); } catch { chron = null; }
  try { chronEvents = chron ? JSON.parse(loadChunks("war:chronE") || "[]") : []; } catch { chronEvents = []; }
}
function chronSave() {
  world.setDynamicProperty("war:chron", JSON.stringify(chron));
  saveChunks("war:chronE", JSON.stringify(chronEvents));
  chronDirty = false;
}
function chronLog(text) {
  if (!chron) return;
  chronEvents.push({ d: day(), t: strip(text) });
  chronDirty = true;
}
function say(msg) { world.sendMessage(msg); chronLog(msg); }
system.run(() => chronLoad());
system.runInterval(() => { if (chronDirty) { try { chronSave(); } catch {} } }, 100);

// ---- battles: hostile hits within 64 blocks of each other form one battle; 2 quiet minutes closes it
function placeName(dim, loc) {
  const f = nearestFlag(dim, loc, () => true, 96);
  const xyz = `${Math.round(loc.x)}, ${Math.round(loc.y)}, ${Math.round(loc.z)}`;
  return f ? `near ${strip(factionLabel(Number(P(f, "war:faction")), true))}'s flag (${xyz})` : `at ${xyz}`;
}
function battleAt(dim, loc) {
  let b = battles.find((x) => x.dim === dim.id && Math.hypot(x.x - loc.x, x.z - loc.z) < 64);
  if (!b) {
    b = { x: loc.x, y: loc.y, z: loc.z, dim: dim.id, start: tick(), last: tick(), factions: new Set(), cas: {}, named: [], flag: "" };
    battles.push(b);
  }
  return b;
}
function chronHit(a, v) {
  if (!chron || !a || !v) return;
  const fa = factionOf(a), fv = factionOf(v);
  if (!isHostile(fa, fv)) return;
  const b = battleAt(v.dimension, v.location);
  b.last = tick(); b.factions.add(fa); b.factions.add(fv);
}
system.runInterval(() => {
  for (let i = battles.length - 1; i >= 0; i--) {
    const b = battles[i];
    if (tick() - b.last < 2400) continue;
    battles.splice(i, 1);
    if (!chron) continue;
    chron.battles++;
    const dim = world.getDimension(b.dim);
    const sides = [...b.factions].map((f) => `${strip(factionLabel(f, true))} lost ${b.cas[f] ?? 0}`).join(", ");
    const named = b.named.length ? ` Fallen: ${b.named.slice(0, 6).join(", ")}${b.named.length > 6 ? "..." : ""}.` : "";
    const outcome = b.flag ? ` ${b.flag}` : " Inconclusive.";
    chronLog(`BATTLE #${chron.battles} ${placeName(dim, b)}, ${Math.max(1, Math.round((b.last - b.start) / 1200))} min. ${sides}.${outcome}${named}`);
  }
}, 100);

// ---- deaths
world.afterEvents.entityDie.subscribe((ev) => {
  if (!chron) return;
  const e = ev.deadEntity, src = ev.damageSource?.damagingEntity;
  let f = 0, name = "", loc, dim;
  try { loc = e.location; dim = e.dimension; } catch {}
  if (e instanceof Player) {
    chron.pdeaths++;
    f = playerFaction(e);
    let by = ev.damageSource?.cause ?? "unknown causes";
    try { if (src) by = src instanceof Player ? src.name : strip(src.nameTag || src.typeId.replace("minecraft:", "")); } catch {}
    chronLog(`${e.name}${f ? ` (${strip(factionLabel(f, true))})` : ""} was killed by ${by}.`);
    name = e.name;
  } else if (e.typeId === SOLDIER) {
    try { f = Number(P(e, "war:faction")); } catch {}
    if (f) chron.deaths[f] = (chron.deaths[f] ?? 0) + 1;
    let d;
    try { d = sd(e); } catch {}
    if (d && (d.custom || d.div === "guard")) {
      name = strip(e.nameTag);
      say(`§7☠ ${e.nameTag} §7has fallen.`);
    }
  } else return;
  chronDirty = true;
  if (loc && dim && f) {
    const b = battles.find((x) => x.dim === dim.id && Math.hypot(x.x - loc.x, x.z - loc.z) < 64);
    if (b) { b.cas[f] = (b.cas[f] ?? 0) + 1; if (name) b.named.push(name); }
  }
});
function chronFlagCaptured(dim, loc, text) {
  if (!chron) return;
  chron.flags++;
  const b = battles.find((x) => x.dim === dim.id && Math.hypot(x.x - loc.x, x.z - loc.z) < 64);
  if (b) b.flag = strip(text);
}

// ---- live display while holding the Chronicle
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    if (mainhand(p) !== "war:chronicle") continue;
    if (!chron) { p.onScreenDisplay.setActionBar("§7No war is being recorded. Use the Chronicle to start one."); continue; }
    const losses = Object.entries(chron.deaths).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([f, n]) => `${COLORS[Number(f) - 1][1]}${COLORS[Number(f) - 1][0]} ${n} lost`).join(" §7· ");
    p.onScreenDisplay.setActionBar(`§l§e${chron.name}§r §7· Day ${day() - chron.startDay + 1} · ${chron.battles} battles · ${chron.flags} flags taken${losses ? "\n" + losses : ""}`);
  }
}, 10);

// ---- the item
async function chronicleUse(player) {
  if (!chron) {
    const r = await show(new ModalFormData().title("Start a war").textField("Name of the war", "e.g. WW1"), player);
    if (!r || r.canceled || !r.formValues) return;
    const name = String(r.formValues[0]).trim().slice(0, 32) || "The War";
    chron = { name, startDay: day(), startDate: new Date().toISOString().slice(0, 10), deaths: {}, pdeaths: 0, battles: 0, flags: 0, by: player.name };
    chronEvents = [];
    chronLog(`${name} begins. Recording started by ${player.name}.`);
    chronSave();
    world.sendMessage(`§l§c${name}§r §fhas begun. §7Everything is now being recorded.`);
    return;
  }
  const af = new ActionFormData().title(chron.name).body(`Day ${day() - chron.startDay + 1} · ${chron.battles} battles · ${chron.flags} flags taken · ${chron.pdeaths} player deaths`)
    .button("Add an entry").button("Recent events").button("§cEnd the war");
  const r = await show(af, player);
  if (!r || r.canceled || r.selection === undefined || !chron) return;
  if (r.selection === 0) {
    const er = await show(new ModalFormData().title("Add an entry").textField("Your entry", "e.g. The treaty of the bridge was signed."), player);
    if (!er || er.canceled || !er.formValues) return;
    const txt = String(er.formValues[0]).trim().slice(0, 600);
    if (txt) { chronEvents.push({ d: day(), t: `[${player.name}] ${txt}`, entry: true }); chronDirty = true; player.onScreenDisplay.setActionBar("§aEntry added."); }
  } else if (r.selection === 1) {
    const last = chronEvents.slice(-15).map((ev) => `§7Day ${ev.d - chron.startDay + 1}:§r ${ev.t}`).join("\n\n");
    await show(new ActionFormData().title(`${chron.name}: recent`).body(last || "Nothing recorded yet.").button("Close"), player);
  } else {
    const cr = await show(new ActionFormData().title(`End ${chron.name}?`).body("Recording stops and you receive the finished book.").button("§cYes, end it").button("Not yet"), player);
    if (!cr || cr.canceled || cr.selection !== 0 || !chron) return;
    for (const b of battles) b.last = -99999;            // close open battles into the record
    system.runTimeout(() => finishWar(player), 120);
    player.onScreenDisplay.setActionBar("§7Closing the record...");
  }
}

function buildPages(c, events) {
  const pages = [];
  const days = day() - c.startDay + 1;
  const losses = Object.entries(c.deaths).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${strip(factionLabel(Number(f), true))}: ${n}`);
  pages.push(strip(`${c.name}\n(Over)\n\nStarted ${c.startDate}\nLasted ${days} day${days === 1 ? "" : "s"}\nBattles: ${c.battles}\nFlags taken: ${c.flags}\nPlayer deaths: ${c.pdeaths}\n\nSoldiers lost:\n${losses.join("\n") || "none"}`));
  const log = events.filter((e) => !e.entry), entries = events.filter((e) => e.entry);
  const toPages = (list, title) => {
    let page = title ? `${title}\n\n` : "";
    for (const ev of list) {
      const line = `Day ${ev.d - c.startDay + 1}: ${ev.t}\n\n`;
      if ((page + line).length > 240) { if (page.trim()) pages.push(page.trim()); page = line.slice(0, 240); }
      else page += line;
    }
    if (page.trim()) pages.push(page.trim());
  };
  // keep the book within 50 pages: condense the middle of very long logs
  let shown = log;
  if (log.length > 120) {
    const keep = 50;
    shown = [...log.slice(0, keep), { d: log[keep].d, t: `... ${log.length - keep * 2} events condensed (full record in the War Table archive) ...` }, ...log.slice(-keep)];
  }
  toPages(shown, "THE RECORD");
  if (entries.length) toPages(entries, "ENTRIES");
  return pages.slice(0, 50);
}
function makeBook(name, pages) {
  const it = new ItemStack("minecraft:writable_book", 1);
  try { it.nameTag = `${name} (Over)`; } catch {}
  try { it.getComponent("minecraft:book")?.setContents(pages); } catch {}
  return it;
}
function finishWar(player) {
  if (!chron) return;
  chronLog(`${chron.name} is over. Recording ended by ${player.name}.`);
  const pages = buildPages(chron, chronEvents);
  // archive (full log + book pages) so anyone can print it again
  const arch = getJSON(world, "war:arch", []);
  const id = arch.length;
  arch.push({ name: chron.name, start: chron.startDate, battles: chron.battles });
  setJSON(world, "war:arch", arch);
  saveChunks(`war:archP${id}_`, JSON.stringify(pages));
  saveChunks(`war:archE${id}_`, JSON.stringify(chronEvents));
  try { player.getComponent("minecraft:inventory").container.addItem(makeBook(chron.name, pages)); } catch {}
  world.sendMessage(`§l§e${chron.name}§r §fis over. §7The chronicle has been written.`);
  chron = null; chronEvents = [];
  world.setDynamicProperty("war:chron", "null");
  saveChunks("war:chronE", "[]");
}
async function warArchive(player) {
  const arch = getJSON(world, "war:arch", []);
  if (!arch.length) { player.sendMessage("§7No finished wars yet."); return; }
  const af = new ActionFormData().title("War archive").body("Print a copy of a finished war's chronicle.");
  for (const w of arch) af.button(`${w.name}\n§8${w.start} · ${w.battles} battles`);
  const r = await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return;
  let pages = [];
  try { pages = JSON.parse(loadChunks(`war:archP${r.selection}_`) || "[]"); } catch {}
  try { player.getComponent("minecraft:inventory").container.addItem(makeBook(arch[r.selection].name, pages)); } catch {}
  player.onScreenDisplay.setActionBar("§aCopy printed.");
}

// ================================================================ Gun loadouts
async function loadoutMenu(player) {
  const all = getJSON(world, "war:loadouts", {});
  const f = new ModalFormData().title("Gun loadouts");
  COLORS.forEach((_, i) => f.dropdown(factionLabel(i + 1), LOADOUT_KEYS.map((k) => LOADOUTS[k].name), { defaultValueIndex: Math.max(0, LOADOUT_KEYS.indexOf(loadoutOf(i + 1))) }));
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const changed = [];
  r.formValues.forEach((v, i) => {
    const k = LOADOUT_KEYS[Number(v)];
    if (k !== loadoutOf(i + 1)) changed.push(i + 1);
    all[i + 1] = k;
  });
  setJSON(world, "war:loadouts", all);
  // re-arm soldiers of factions whose loadout changed
  for (const e of allOf(SOLDIER)) {
    try { const d = sd(e); if (changed.includes(d.faction) && GUNS.includes(d.weapon)) equip(e, weaponItem(e)); } catch {}
  }
  player.sendMessage(`§aLoadouts saved${changed.length ? ` (${changed.length} faction${changed.length > 1 ? "s" : ""} re-armed)` : ""}.`);
}

// ================================================================ Shared awareness scan
// One scan per dimension every half second, shared by every soldier (keeps big armies cheap).
let combatants = new Map(); // dim id -> [{ e, x, y, z }]
function refreshCombatants() {
  const next = new Map();
  for (const did of DIMS) {
    let dim;
    try { dim = world.getDimension(did); } catch { continue; }
    const list = [];
    const add = (arr) => { for (const o of arr) { try { const l = o.location; list.push({ e: o, x: l.x, y: l.y, z: l.z }); } catch {} } };
    try { add(dim.getEntities({ type: SOLDIER })); } catch {}
    try { add(dim.getEntities({ type: HOUND })); } catch {}
    try { add(dim.getPlayers()); } catch {}
    for (const t of VEHICLES) { try { add(dim.getEntities({ type: t })); } catch {} }
    try { add(dim.getEntities({ families: ["monster"] })); } catch {}
    next.set(`minecraft:${did}`, list); next.set(did, list);
  }
  combatants = next;
}
system.runInterval(refreshCombatants, 10);
function nearbyCombatants(dimId, loc, r) {
  const out = [];
  for (const c of combatants.get(dimId) ?? []) {
    const dx = c.x - loc.x, dy = c.y - loc.y, dz = c.z - loc.z;
    if (dx * dx + dy * dy + dz * dz <= r * r && c.e.isValid) out.push(c.e);
  }
  return out;
}

// ================================================================ Hearing
// Gunfire and explosions alert soldiers within ~64 blocks who are hostile to whoever made the noise.
function noise(dim, loc, maker) {
  try { hearNoise(dim, loc, maker); } catch {}
  const mf = maker ? factionOf(maker) : 0;
  const now = tick();
  for (const o of nearbyCombatants(dim.id, loc, 64)) {
    if (o.typeId !== SOLDIER) continue;
    try {
      const of = Number(P(o, "war:faction"));
      if (!mf || isHostile(of, mf)) o.setDynamicProperty("war:alert", now + 200);
    } catch {}
  }
}
world.afterEvents.entitySpawn.subscribe((ev) => {
  const b = ev.entity;
  let id;
  try { id = b.typeId; } catch { return; }
  if (!id.startsWith("ww:") || !id.includes("projectile")) return;
  system.run(() => {
    try { const owner = b.getComponent("minecraft:projectile")?.owner; if (owner) noise(owner.dimension, owner.location, owner); } catch {}
  });
});

// ================================================================ Explosions that always go off
// If crediting the blast to someone is refused by the game, explode anyway without credit.
function explode(dim, loc, power, opts) {
  try { dim.createExplosion(loc, power, opts); }
  catch { const o = { ...opts }; delete o.source; try { dim.createExplosion(loc, power, o); } catch {} }
  try { noise(dim, loc, opts?.source); } catch {}
}
function hurt(ent, amount, src) {
  try { ent.applyDamage(amount, { cause: "entityExplosion", damagingEntity: src?.isValid ? src : undefined }); }
  catch { try { ent.applyDamage(amount); } catch {} }
}

// ================================================================ Gunfire (script-driven)
// sight: how far a gunner notices enemies; fire: the gun's effective range (it closes in to fire).
// spread is an aiming error angle (radians). Because a target looks smaller the farther it is, a
// fixed error gives: 0-20 very likely, 20-50 likely, 50-100 more misses, 100-200 possible but rare.
// Weapons differ: rifles/MGs keep accuracy at range; pistols, SMGs and shotguns fall off fast.
const GUN_SPEC = {
  rifle:   { bullet: "ww:nrifle_projectile",   sight: 200, fire: 200, mag: 1,  gap: 0, reload: 60,  speed: 5.0, spread: 0.007 },
  semi:    { bullet: "ww:nsemi_projectile",    sight: 200, fire: 200, mag: 3,  gap: 8, reload: 50,  speed: 5.0, spread: 0.009 },
  smg:     { bullet: "ww:nsmg_projectile",     sight: 200, fire: 120, mag: 20, gap: 2, reload: 70,  speed: 4.5, spread: 0.018 },
  mg:      { bullet: "ww:nlmg_projectile",     sight: 200, fire: 200, mag: 30, gap: 2, reload: 100, speed: 5.0, spread: 0.010 },
  shotgun: { bullet: "ww:nshotgun_projectile", sight: 200, fire: 40,  mag: 1,  gap: 0, reload: 30,  speed: 3.5, spread: 0.035 },
  at:      { bullet: "ww:nbazooka_projectile", sight: 200, fire: 120, mag: 1,  gap: 0, reload: 140, speed: 2.3, spread: 0.010 },
  pistol:  { bullet: "ww:nsemi_projectile",    sight: 200, fire: 200, mag: 2,  gap: 8, reload: 40,  speed: 4.5, spread: 0.015 },
};
const gunState = new Map(); // soldier id -> { target, ammo, next, seen, check, step }
function chest(o) { const l = o.location; return { x: l.x, y: l.y + (o.typeId === "war:tank" ? 1.0 : o.typeId === HOUND ? 0.5 : 1.2), z: l.z }; }
function clearShot(dim, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, l = Math.hypot(dx, dy, dz);
  if (l < 0.5) return true;
  try { return !dim.getBlockFromRay(from, { x: dx / l, y: dy / l, z: dz / l }, { maxDistance: l - 0.3, includeLiquidBlocks: false, includePassableBlocks: false }); }
  catch { return false; }
}
function vehicleFaction(v) { for (let i = 1; i <= NF; i++) if (v.hasTag(`war_f${i}`)) return i; return 0; }
function isTargetFor(e, d, o) {
  if (o.id === e.id) return false;
  if (d.weapon === "at") return VEHICLES.includes(o.typeId) && isHostile(d.faction, vehicleFaction(o));
  if (VEHICLES.includes(o.typeId)) return false;
  if (o.typeId === SOLDIER || o.typeId === HOUND) return isHostile(d.faction, factionOf(o)) || isProvoker(d.faction, o, tick());
  if (o.typeId === "minecraft:player") { try { return o.getGameMode() !== GameMode.Creative && o.getGameMode() !== GameMode.Spectator && (isHostile(d.faction, factionOf(o)) || isProvoker(d.faction, o, tick())); } catch { return false; } }
  // vanilla mobs: only once one of them has attacked one of ours, and only when it's close
  const as = assist.get(e.id);
  return (as && as.id === o.id && tick() - as.t < 200) || attackedRecently(e, o, tick()) || (dist(o.location, e.location) <= 4 && isProvoker(d.faction, o, tick()));
}
function pickTarget(e, d, spec) {
  const eye = e.getHeadLocation();
  let best, bd = spec.sight + 0.01;
  for (const o of nearbyCombatants(e.dimension.id, e.location, spec.sight)) {
    if (!isTargetFor(e, d, o)) continue;
    const dd = dist(o.location, e.location);
    if (dd < bd && clearShot(e.dimension, eye, chest(o))) { bd = dd; best = o; }
  }
  return best;
}
// Is a friendly (or ally) in or near the line of fire?
function friendlyInLine(e, d, from, to, target) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  for (const o of nearbyCombatants(e.dimension.id, from, L + 2)) {
    if (o.id === e.id || o.id === target.id || VEHICLES.includes(o.typeId)) continue;
    if (!(o.typeId === SOLDIER || o.typeId === HOUND || o.typeId === "minecraft:player")) continue;
    if (!isFriendly(d.faction, factionOf(o))) continue;
    const c = chest(o);
    const px = c.x - from.x, py = c.y - from.y, pz = c.z - from.z;
    const along = px * ux + py * uy + pz * uz;
    if (along < 0.5 || along > L - 0.5) continue;
    const off = Math.hypot(px - ux * along, py - uy * along, pz - uz * along);
    if (off < 1.1) return true;
  }
  return false;
}
// How far a soldier may step aside for a clean shot, by order.
function stepLeash(d) {
  if (d.func === "post") return 1;
  if (d.func === "hold" || d.func === "stand") return 2;
  if (d.func === "sentry") return d.radius;
  return 3;
}
function nudge(e, toward, strength = 0.45, p = 3) {
  const dx = toward.x - e.location.x, dz = toward.z - e.location.z, l = Math.hypot(dx, dz) || 1;
  push(e, { x: (dx / l) * strength, y: 0.12, z: (dz / l) * strength }, p);
}
// Find a sidestep spot (perpendicular to the line of fire) with a clean line, within the order's leash.
function sidestep(e, d, target) {
  const leash = stepLeash(d);
  const anchor = ["hold", "post", "sentry", "stand"].includes(d.func) ? marker(d.goal) : undefined;
  const h = e.getHeadLocation(), c = chest(target);
  const dx = c.x - h.x, dz = c.z - h.z, l = Math.hypot(dx, dz) || 1;
  const px = -dz / l, pz = dx / l;
  for (const k of [1, -1, 2, -2, 3, -3]) {
    if (Math.abs(k) > Math.min(3, leash)) continue;
    const spot = { x: e.location.x + px * k, y: e.location.y, z: e.location.z + pz * k };
    if (anchor && flat(spot, anchor.location) > leash + 1) continue;
    if (!standable(e.dimension, { x: Math.floor(spot.x) + 0.5, y: Math.floor(spot.y), z: Math.floor(spot.z) + 0.5 })) continue;
    const eye = { x: spot.x, y: h.y, z: spot.z };
    if (clearShot(e.dimension, eye, c) && !friendlyInLine(e, d, eye, c, target)) { nudge(e, spot, 0.35 + 0.1 * Math.abs(k)); return true; }
  }
  return false;
}
function fireGun(e, spec, t) {
  const h = e.getHeadLocation(), c = chest(t);
  let dx = c.x - h.x, dy = c.y - h.y, dz = c.z - h.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  if (spec.bullet === "ww:nbazooka_projectile") dy += (l * 0.03 * l) / (spec.speed * 2); // lift for the rocket's drop
  const n = Math.hypot(dx, dy, dz) || 1;
  const r = () => (Math.random() + Math.random() - 1) * spec.spread * 1.6;
  const dir = { x: dx / n + r(), y: dy / n + r(), z: dz / n + r() };
  const from = { x: h.x + dir.x * 0.9, y: h.y - 0.2 + dir.y * 0.9, z: h.z + dir.z * 0.9 };
  try {
    const b = e.dimension.spawnEntity(spec.bullet, from);
    const pc = b.getComponent("minecraft:projectile");
    if (pc) { pc.owner = e; pc.shoot({ x: dir.x * spec.speed, y: dir.y * spec.speed, z: dir.z * spec.speed }); }
  } catch {}
}
function gunTick(e, now) {
  const d = sd(e);
  const spec = GUN_SPEC[d.weapon];
  if (!spec || d.surr || d.retreat || d.div === "medic" || !P(e, "war:gun")) { if (P(e, "war:aiming")) setP(e, "war:aiming", false); return; }
  let st = gunState.get(e.id);
  if (!st) { st = { target: undefined, ammo: spec.mag, next: 0, seen: -999, check: 0, step: 0, back: 0 }; gunState.set(e.id, st); }
  if (now >= st.check) {
    st.check = now + 5;
    const ps = perc.get(e.id);
    const prev = st.target;
    const t = ps?.threat;
    st.target = t && t.isValid && clearShot(e.dimension, e.getHeadLocation(), chest(t)) ? t : undefined;
    if (st.target && (!prev || prev.id !== st.target.id)) {
      const ang = facingAngle(e, st.target.location);          // new target: the aim needs to settle
      st.next = Math.max(st.next, now + (ang < 60 ? 6 : ang < 120 ? 12 : 20));
      st.wild = ang >= 120 ? 2 : 0;                             // first shots after a big turn are less accurate
    }
    const stance = String(e.getDynamicProperty("war:stance") ?? "aggressive");
    if (st.target && stance === "holdfire" && !isProvoker(d.faction, st.target, now)) st.target = undefined;
    if (st.target) st.seen = now;
    // rushed: back off and sidestep instead of standing still (not when pinned to a post)
    if (st.target && !isMob(st.target) && now >= st.back && d.func !== "post" && !isRiding(e)) {
      const td = dist(st.target.location, e.location);
      if (td < 4 && td > 2.5) {
        st.back = now + 20;
        const a = e.location, b = st.target.location, l = Math.hypot(a.x - b.x, a.z - b.z) || 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        nudge(e, { x: a.x + ((a.x - b.x) / l) * 3 + (-(a.z - b.z) / l) * side, y: a.y, z: a.z + ((a.z - b.z) / l) * 3 + ((a.x - b.x) / l) * side }, 0.5);
      }
    }
  }
  const aiming = now - st.seen < 40;
  if (!!P(e, "war:aiming") !== aiming) setP(e, "war:aiming", aiming);
  if (!st.target || now < st.next) return;
  const t = st.target;
  if (!t.isValid) { st.target = undefined; return; }
  if (dist(t.location, e.location) > spec.fire) return;                // seen but out of range: keep closing in
  if (closeEnemy(e, d, 2.5)) return;                                    // hand-to-hand right now
  const from = e.getHeadLocation();
  if (friendlyInLine(e, d, from, chest(t), t)) {                        // never shoot through a friendly
    if (now >= st.step && !isRiding(e)) { st.step = now + 25; sidestep(e, d, t); }
    st.next = now + 6;
    return;
  }
  if (turnTo(e, t.location, 20) > 25) { st.next = now + 2; return; } // still turning toward him
  if (st.wild > 0) { st.wild--; fireGun(e, { ...spec, spread: spec.spread * 3 }, t); }
  else fireGun(e, spec, t);
  st.ammo--;
  if (st.ammo > 0) st.next = now + Math.max(1, spec.gap);
  else { st.ammo = spec.mag; st.next = now + spec.reload + Math.floor(Math.random() * 15); }
}
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try { if (GUNS.includes(String(e.getDynamicProperty("war:weapon") ?? ""))) gunTick(e, now); } catch {}
  }
  if (now % 200 === 0) for (const id of [...gunState.keys()]) if (!world.getEntity(id)) gunState.delete(id);
}, 1);
world.afterEvents.entitySpawn.subscribe((ev) => { try { if (ev.entity.typeId === "war:blank") ev.entity.remove(); } catch {} });

// ================================================================ Taking cover (experimental)
// A gunner hit from range looks within ~3 blocks for a spot with a block between him and the shooter.
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity, a = ev.damageSource.damagingEntity;
  if (!e?.isValid || e.typeId !== SOLDIER || !a?.isValid) return;
  system.run(() => {
    try {
      const d = sd(e);
      if (!GUNS.includes(d.weapon) || d.surr || isRiding(e) || d.func === "post") return;
      if (a.typeId !== SOLDIER && a.typeId !== "minecraft:player") return;   // mobs don't send anyone to cover
      if (dist(a.location, e.location) < 8) return;
      const now = tick();
      if (Number(e.getDynamicProperty("war:covert") ?? 0) > now) return;
      e.setDynamicProperty("war:covert", now + 200);
      const anchor = ["hold", "sentry", "stand"].includes(d.func) ? marker(d.goal) : undefined;
      const leash = stepLeash(d) + 1;
      const shooter = a.getHeadLocation ? a.getHeadLocation() : a.location;
      for (const r of [1.5, 3]) for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const spot = { x: Math.floor(e.location.x + Math.cos(ang) * r) + 0.5, y: Math.floor(e.location.y), z: Math.floor(e.location.z + Math.sin(ang) * r) + 0.5 };
        if (anchor && flat(spot, anchor.location) > leash) continue;
        if (!standable(e.dimension, spot)) continue;
        const head = { x: spot.x, y: spot.y + 1.5, z: spot.z };
        if (!clearShot(e.dimension, head, shooter)) { nudge(e, spot, 0.3 + r * 0.12); return; } // blocked from the shooter: cover
      }
    } catch {}
  });
});

// ================================================================ Flee explosives
system.runInterval(() => {
  const threats = [];
  for (const [b] of projectiles) { try { if (b.isValid) threats.push(b); } catch {} }
  for (const did of DIMS) { try { threats.push(...world.getDimension(did).getEntities({ type: "minecraft:tnt" })); } catch {} }
  for (const t of threats) {
    for (const o of nearbyCombatants(t.dimension.id, t.location, 7)) {
      if (o.typeId !== SOLDIER || isRiding(o)) continue;
      const a = o.location, b = t.location, l = Math.hypot(a.x - b.x, a.z - b.z) || 1;
      push(o, { x: ((a.x - b.x) / l) * 0.6, y: 0.15, z: ((a.z - b.z) / l) * 0.6 }, 4); // escape beats everything
    }
  }
}, 4);

// ================================================================ Engine sounds
// Short sounds repeated while moving, so nothing lingers; the plane's engine is stopped when it stops.
const engineOn = new Map(); // plane id -> {dim, loc}
function stopEngine(id) {
  const info = engineOn.get(id);
  if (!info) return;
  engineOn.delete(id);
  try { world.getDimension(info.dim).runCommand(`stopsound @a[x=${Math.floor(info.loc.x)},y=${Math.floor(info.loc.y)},z=${Math.floor(info.loc.z)},r=160] plane.fly`); } catch {}
}
system.runInterval(() => {
  const alive = new Set();
  for (const v of vehicleList) {
    try {
      if (!v.isValid || v.typeId === "war:boat") continue;
      const vel = v.getVelocity(), sp = Math.hypot(vel.x, vel.y, vel.z);
      if (v.typeId === "war:plane") {
        const st = vstate.get(v.id);
        if (st && st.speed > 0.08) {
          alive.add(v.id);
          if (!engineOn.has(v.id) || tick() % 30 < 6) v.dimension.playSound("plane.fly", v.location, { volume: 2 + st.speed * 4, pitch: 0.8 + st.speed * 0.4 });
          engineOn.set(v.id, { dim: v.dimension.id, loc: v.location });
        }
      } else if (sp > 0.03) {
        v.dimension.playSound("mob.ravager.step", v.location, { volume: 1.2, pitch: 0.5 + Math.min(0.3, sp) });
      }
    } catch {}
  }
  for (const id of [...engineOn.keys()]) if (!alive.has(id)) stopEngine(id); // stopped, landed or destroyed
}, 6);

// ================================================================ Perception & decisions (Phase 1)
// Every soldier perceives all around him with human limits: reaction time depends on where the
// enemy is relative to his facing, sight shrinks in darkness, sneaking/still targets are harder to
// spot, gunfire gives a position away. Threats are scored; a squad shares its target (focus fire).
// Internal alert levels: calm -> suspicious (heard something) -> combat (sees an enemy).
const perc = new Map();        // soldier id -> { seen: Map(id -> since), threat, threatT, lastSeen, lostT, noise, noiseT, alert, searchUntil, prevPos }
const hurtBy = new Map();      // entity id -> { id, t }   (who last attacked it)
const squadTarget = new Map(); // "faction:squad" -> { id, t }
const lastPos = new Map();     // combatant id -> {x,y,z,t}  (to tell moving from still)
const P1 = () => perc;         // (debug handle)
function pstate(e) {
  let s = perc.get(e.id);
  if (!s) { s = { seen: new Map(), threat: undefined, threatT: 0, lastSeen: undefined, lostT: 0, noise: undefined, noiseT: -999, alert: "calm", searchUntil: 0, pursue: 0 }; perc.set(e.id, s); }
  return s;
}
function sightOf(d) { return GUNS.includes(d.weapon) ? 200 : 60; } // melee soldiers watch the near area
function lightAt(dim, loc) {
  try {
    const block = dim.getLightLevel(loc), sky = dim.getSkyLightLevel(loc);
    const t = world.getTimeOfDay(); // 0..24000, night roughly 13000..23000
    const day = t < 12500 || t > 23200 ? 1 : t < 13500 ? 1 - (t - 12500) / 1000 * 0.7 : t > 22200 ? 0.3 + (t - 22200) / 1000 * 0.7 : 0.3;
    return Math.max(block, sky * day);
  } catch { return 15; }
}
function visibility(o, now) {
  let v = 1;
  try { if (o.typeId === "minecraft:player" && o.isSneaking) v *= 0.5; } catch {}
  const lp = lastPos.get(o.id), l = o.location;
  if (lp && now - lp.t <= 20 && Math.hypot(l.x - lp.x, l.z - lp.z) < 0.15) v *= 0.8;   // standing still
  lastPos.set(o.id, { x: l.x, y: l.y, z: l.z, t: now });
  if (now - Number(noiseFrom.get(o.id) ?? -999) < 60) v *= 1.6;                          // just fired: gives himself away
  return v;
}
const noiseFrom = new Map(); // entity id -> tick it last made combat noise
// Provocation: whoever attacks a faction's soldier or player becomes fair game for that faction
// (within ~48 blocks) for a while, even through Hold fire and even if his faction is neutral.
const provoked = new Map();  // "faction:attackerId" -> until tick
const assist = new Map();    // soldier id -> { id, t } : an attacker hurting a comrade nearby
function isProvoker(f, o, now) { return (provoked.get(`${f}:${o.id}`) ?? 0) > now; }
function facingAngle(e, to) {
  const yaw = e.getRotation().y * Math.PI / 180;
  const fx = -Math.sin(yaw), fz = Math.cos(yaw);
  const dx = to.x - e.location.x, dz = to.z - e.location.z, l = Math.hypot(dx, dz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / l))) * 180 / Math.PI; // 0 = straight ahead
}
function reactionDelay(e, o, dd, now) {
  const ang = facingAngle(e, o.location);
  let t = ang < 60 ? 10 : ang < 120 ? 20 : 34;                 // front ~0.5 s, side ~1 s, behind ~1.7 s
  if (dd > 60) t += 10; if (dd > 120) t += 15;                   // far figures take longer to pick out
  if (dd < 6) t *= 0.5;
  if (now - Number(noiseFrom.get(o.id) ?? -999) < 40) t *= 0.6;
  return t;
}
function attackedRecently(e, by, now, window = 100) { const h = hurtBy.get(e.id); return !!h && h.id === by.id && now - h.t < window; }
const isMob = (o) => o.typeId !== SOLDIER && o.typeId !== HOUND && o.typeId !== "minecraft:player" && !VEHICLES.includes(o.typeId);
function threatScore(e, d, o, dd, now) {
  let s = 100 - dd;                                              // closer = more dangerous
  if (isMob(o)) s -= 90;                                         // zombies are a nuisance, soldiers are the threat
  else s += 40;
  if (isProvoker(d.faction, o, now)) s += 50;
  const as = assist.get(e.id);
  if (as && as.id === o.id && now - as.t < 200) s += 100;        // he's shooting at my comrades
  if (attackedRecently(e, o, now)) s += 120;                     // attacking me
  if (d.squad) {
    const st = squadTarget.get(`${d.faction}:${d.squad}`);
    if (st && st.id === o.id && now - st.t < 100) s += 40;       // focus fire: the squad's target
  }
  if (o.typeId === SOLDIER) {
    try {
      const od = sd(o);
      if (od.div === "medic") s -= 30;
      if (od.retreat) s -= 40;                                   // fleeing enemies last
      if (GUNS.includes(od.weapon) || od.ranged) s += 10;
      const h = o.getComponent("minecraft:health");
      if (h && h.currentValue / h.effectiveMax < 0.35) s += 15;  // finish off the wounded
    } catch {}
  }
  if (dd < 4) s += 60;                                           // something right on top of him overrides focus fire
  return s;
}
function perceive(e, now) {
  const d = sd(e);
  const s = pstate(e);
  if (d.surr || d.div === "medic") { s.threat = undefined; s.alert = "calm"; return; }
  const base = sightOf(d);
  const eye = e.getHeadLocation();
  const all = nearbyCombatants(e.dimension.id, e.location, base)
    .filter((o) => isTargetFor(e, d, o))
    .map((o) => ({ o, dd: dist(o.location, e.location) }));
  const soldiersAround = all.some((c) => !isMob(c.o));
  const cands = all
    // mid-battle, distant mobs are ignored unless they're on top of him or attacking
    .filter((c) => !isMob(c.o) || !soldiersAround || c.dd < 6 || attackedRecently(e, c.o, now))
    .sort((a, b) => (Number(isMob(a.o)) - Number(isMob(b.o))) || a.dd - b.dd)
    .slice(0, 8);                                                // nearest few only (keeps raycasts cheap)
  const visible = new Set();
  let best, bestScore = -1e9;
  for (const { o, dd } of cands) {
    const reach = base * (0.35 + 0.65 * lightAt(e.dimension, o.location) / 15) * visibility(o, now);
    const asg = assist.get(e.id);
    const attacking = attackedRecently(e, o, now) || (!!asg && asg.id === o.id && now - asg.t < 200);
    if (dd > reach && !attacking) continue;
    if (!clearShot(e.dimension, eye, chest(o)) && !attacking) continue;
    visible.add(o.id);
    if (!s.seen.has(o.id)) s.seen.set(o.id, now);
    const shared = d.squad && squadTarget.get(`${d.faction}:${d.squad}`)?.id === o.id;
    if (!attacking && !shared && now - s.seen.get(o.id) < reactionDelay(e, o, dd, now)) continue; // not noticed yet
    const sc = threatScore(e, d, o, dd, now);
    if (sc > bestScore) { bestScore = sc; best = o; }
  }
  for (const id of [...s.seen.keys()]) if (!visible.has(id)) s.seen.delete(id);
  if (best) {
    if (!s.threat || s.threat.id !== best.id) s.threatT = now;
    s.threat = best; s.lastSeen = { ...best.location }; s.lostT = 0; s.alert = "combat";
    if (d.squad) squadTarget.set(`${d.faction}:${d.squad}`, { id: best.id, t: now });
  } else if (s.threat) {
    if (!s.lostT) s.lostT = now;
    if (!s.threat.isValid || now - s.lostT > 40) { s.threat = undefined; s.searchUntil = s.lastSeen ? now + 200 : 0; } // lost him: search ~10 s
  }
  if (!s.threat) {
    if (s.searchUntil > now) s.alert = "combat";
    else if (now - s.noiseT < 160) s.alert = "suspicious";
    else s.alert = "calm";
  }
}
// combat noise: gunfire / explosions / hits make nearby soldiers suspicious and point them at the source
function hearNoise(dim, loc, maker) {
  const now = tick();
  if (maker) noiseFrom.set(maker.id, now);
  const mf = maker ? factionOf(maker) : 0;
  for (const o of nearbyCombatants(dim.id, loc, 64)) {
    if (o.typeId !== SOLDIER) continue;
    try { if (!mf || isHostile(Number(P(o, "war:faction")), mf)) { const s = pstate(o); s.noise = { x: loc.x, y: loc.y, z: loc.z }; s.noiseT = now; } } catch {}
  }
}
world.afterEvents.entityHurt.subscribe((ev) => {
  const v = ev.hurtEntity, a = ev.damageSource.damagingEntity;
  if (!v?.isValid || !a) return;
  const now = tick();
  hurtBy.set(v.id, { id: a.id, t: now });
  try {
    const fv = v.typeId === SOLDIER || v.typeId === "minecraft:player" || v.typeId === HOUND ? factionOf(v) : 0;
    const fa = factionOf(a);
    if (fv && a.id !== v.id && !isFriendly(fv, fa)) {
      provoked.set(`${fv}:${a.id}`, now + 1200);                       // ~1 minute
      if (isMob(a)) {
        // a mob: the closest few soldiers help (if nothing more dangerous is around)
        const near = nearbyCombatants(v.dimension.id, v.location, 16)
          .filter((o) => o.typeId === SOLDIER && o.id !== v.id && isFriendly(Number(P(o, "war:faction")), fv) && !perc.get(o.id)?.threat)
          .sort((x, y) => dist(x.location, v.location) - dist(y.location, v.location)).slice(0, 4);
        for (const o of near) assist.set(o.id, { id: a.id, t: now });
      } else {
        for (const o of nearbyCombatants(v.dimension.id, v.location, 48)) {
          if (o.typeId !== SOLDIER || o.id === v.id) continue;
          if (!isFriendly(Number(P(o, "war:faction")), fv)) continue;
          if (dist(o.location, v.location) <= 24 || Number(P(o, "war:faction")) === fv) assist.set(o.id, { id: a.id, t: now }); // defend comrades
        }
      }
    }
  } catch {}
  try {
    if (v.typeId === SOLDIER) {                                   // the squad learns who is shooting at them
      const d = sd(v);
      if (d.squad && isHostile(d.faction, factionOf(a))) squadTarget.set(`${d.faction}:${d.squad}`, { id: a.id, t: now });
    }
  } catch {}
});
let percPhase = 0;
system.runInterval(() => {
  const now = tick();
  percPhase ^= 1;
  for (const e of allOf(SOLDIER)) {
    if ((e.id.charCodeAt(e.id.length - 1) & 1) !== percPhase) continue; // each soldier ~every 10 ticks
    try { perceive(e, now); } catch {}
  }
  if (now % 400 === 0) {
    for (const id of [...perc.keys()]) if (!world.getEntity(id)) perc.delete(id);
    for (const [id, h] of [...hurtBy]) if (now - h.t > 400) hurtBy.delete(id);
    for (const [k, t] of [...squadTarget]) if (now - t.t > 400) squadTarget.delete(k);
  }
}, 5);

// ---- turning at a human speed (no instant spin)
function turnTo(e, at, maxStep = 18) {
  try {
    const want = (Math.atan2(-(at.x - e.location.x), at.z - e.location.z) * 180) / Math.PI;
    const cur = e.getRotation().y;
    e.setRotation({ x: 0, y: turnToward(cur, want, maxStep) });
    return Math.abs(((want - cur + 540) % 360) - 180);
  } catch { return 0; }
}

// ---- threat slots: a hunted enemy carries a waypoint tag so pursuers path straight to him
const threatSlot = new Map(); // entity id -> slot
function slotForThreat(t) {
  if (threatSlot.has(t.id)) return threatSlot.get(t.id);
  const used = new Set([...markers().map(slotOf), ...threatSlot.values()]);
  for (let i = 1; i <= NSLOT; i++) if (!used.has(i)) { try { tagMarker(t, i); } catch { return 0; } threatSlot.set(t.id, i); return i; }
  return 0;
}
system.runInterval(() => {
  const goals = new Set(allOf(SOLDIER).map((s) => Number(s.getDynamicProperty("war:goal") ?? 0)));
  for (const [id, slot] of [...threatSlot]) {
    if (goals.has(slot)) continue;
    const t = world.getEntity(id);
    try { if (t) untagMarker(t); } catch {}
    threatSlot.delete(id);
  }
}, 40);

// ---- the decision: what this soldier does about what he perceives, by stance and order
const ANCHOR_LEASH = (d, melee) => d.func === "post" ? (melee ? 4 : 2) : d.func === "sentry" ? d.radius + 4 : d.func === "hold" ? 18 : d.func === "stand" ? 4 : Infinity;
function engagement(e, d, now, orderGoal, melee) {
  const s = perc.get(e.id);
  if (!s || d.retreat || d.surr || d.div === "medic" || d.func === "escort" || d.func === "squad") return undefined;
  const stance = String(e.getDynamicProperty("war:stance") ?? "aggressive");
  const anchor = ["hold", "post", "sentry", "stand"].includes(d.func) ? marker(orderGoal) : undefined;
  const leash = ANCHOR_LEASH(d, melee);
  const gun = GUNS.includes(d.weapon);
  const t = s.threat;
  if (t && t.isValid) {
    if (stance === "holdfire" && !isProvoker(d.faction, t, now)) return undefined; // hold fire until someone of ours is attacked
    turnTo(e, t.location);
    const dd = dist(t.location, e.location);
    if (anchor && flat(t.location, anchor.location) > leash) { note(e, "holding post"); return undefined; } // fight from the post
    if (stance === "defensive") { note(e, "defending"); return { g: "g_none", t: melee ? "t_short" : "t_mid", urgent: false }; }
    if (isMob(t) && dd > 10) return undefined;                  // shoot an attacking mob if it's there, never chase it
    if (gun) {
      const fire = GUN_SPEC[d.weapon]?.fire ?? 30;
      const stopRange = Math.min(fire * 0.9, ["charge", "follow"].includes(d.func) ? 45 : 90);
      if (dd <= stopRange && clearShot(e.dimension, e.getHeadLocation(), chest(t))) { note(e, "firing"); return { g: "g_none", t: "t_mid", urgent: false }; } // stop and shoot
      if (dd > 60) { note(e, `firing at ${Math.round(dd)} blocks`); return undefined; } // far: keep to the order, shoot on the move
    } else if (dd > 40 && !attackedRecently(e, t, now)) return undefined;     // melee doesn't run 100 blocks after someone
    note(e, isMob(t) ? "fighting a mob" : "engaging");
    const slot = slotForThreat(t);
    return slot ? { g: "g_wp", slot, t: "t_mid", urgent: true } : { g: "g_none", t: "t_mid", urgent: true };
  }
  const moving = ["charge", "follow", "patrol"].includes(d.func);
  if (moving && s.searchUntil > now + 60) s.searchUntil = now + 60;          // marching: a quick look, then carry on
  if (anchor && s.searchUntil > now + 60) s.searchUntil = now + 60;          // posts: don't wander off searching
  if (s.searchUntil > now && s.lastSeen && stance !== "defensive" && stance !== "holdfire") {
    if (dist(e.location, s.lastSeen) < 3) { s.searchUntil = Math.min(s.searchUntil, now + 60); turnTo(e, { x: e.location.x + Math.cos(now / 7), z: e.location.z + Math.sin(now / 7) }, 25); }
    if (!anchor || flat(s.lastSeen, anchor.location) <= leash) {
      const slot = makeWaypoint(e.dimension, s.lastSeen);
      if (slot) return { g: "g_wp", slot, t: "t_mid", urgent: false };
    }
  }
  if (s.alert === "suspicious" && s.noise && stance !== "holdfire") {
    turnTo(e, s.noise, 12);                                    // face the noise
    if (!moving && !anchor && now - s.noiseT < 40) { note(e, "listening"); return { g: "g_none", t: melee ? "t_short" : "t_mid", urgent: false, slow: true }; }
  }
  return undefined;
}

// ================================================================ Marches, formations and route-finding
// A virtual guide walks ahead of the group in stages on real, walkable ground (never leaves, roofs,
// lava, fire or deep water), probing left/right around obstacles and preferring gates and doors;
// if the group stalls it reroutes at an angle. The group follows a set of lane points that form a
// column, line, wedge or loose skirmish depending on the ground and the situation.
let marches = null;            // id -> { pos, dest, dim, then, final, lanes:[slot], heading, best, bestT, detour }
const laneOf = new Map();      // lane slot -> march id
function getMarches() {
  if (!marches) {
    marches = getJSON(world, "war:marches2", {}); laneOf.clear();
    for (const [id, m] of Object.entries(marches)) { for (const s of m.lanes) laneOf.set(s, id); if (m.planning) { m.planning = false; m.path = undefined; } }
  }
  return marches;
}
function saveMarches() { setJSON(world, "war:marches2", marches ?? {}); }
const spacingSetting = () => Math.max(1, Math.min(2, Number(setting("spacing", 1.5))));
const HAZARD = ["lava", "fire", "magma", "cactus", "sweet_berry", "powder_snow", "campfire"];
const PASSABLE = ["air", "short_grass", "tall_grass", "fern", "flower", "dandelion", "poppy", "tulip", "orchid", "allium", "bluet", "daisy", "cornflower", "lily", "bush", "sapling", "snow_layer", "torch", "carpet", "vine", "button", "lever", "rail", "redstone_wire", "pressure_plate", "sign", "dead_bush", "seagrass"];
const passable = (b) => !!b && (b.isAir || (PASSABLE.some((p) => b.typeId.includes(p)) && !b.typeId.includes("grass_block")));
// a spot a soldier can stand on, searched up and down from refY; undefined if none (or not loaded)
function walkableNear(dim, x, z, refY) {
  const bx = Math.floor(x) + 0.5, bz = Math.floor(z) + 0.5;
  for (const dy of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
    const y = Math.floor(refY) + dy;
    try {
      const floor = dim.getBlock({ x: bx, y: y - 1, z: bz }), feet = dim.getBlock({ x: bx, y, z: bz }), head = dim.getBlock({ x: bx, y: y + 1, z: bz });
      if (!floor || !feet || !head) return undefined;
      if (floor.isAir || floor.isLiquid || floor.typeId.includes("leaves") || HAZARD.some((h) => floor.typeId.includes(h))) continue;
      if (!passable(feet) || !passable(head)) continue;
      return { x: bx, y, z: bz };
    } catch { return undefined; }
  }
  return undefined;
}
function hazardBetween(dim, a, b, allowWater = false) {
  const n = Math.max(4, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const g = walkableNear(dim, x, z, a.y + (b.y - a.y) * t);       // is there walkable ground (a bridge counts)?
    if (g) continue;
    if (allowWater) {
      try { const w = dim.getBlock({ x, y: Math.floor(a.y + (b.y - a.y) * t) - 1, z }); if (w && w.typeId.includes("water")) continue; } catch {}
    }
    return true;
  }
  return false;
}
function findGate(dim, from, dest) {
  const fx = dest.x - from.x, fz = dest.z - from.z, l = Math.hypot(fx, fz) || 1;
  let best, bd = 1e9;
  for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (const dy of [0, 1]) {
    if ((dx * fx + dz * fz) / l < -2) continue; // only ahead-ish
    try {
      const b = dim.getBlock({ x: from.x + dx, y: Math.floor(from.y) + dy, z: from.z + dz });
      if (!b || !(b.typeId.includes("door") || b.typeId.includes("fence_gate"))) continue;
      const dd = Math.hypot(dest.x - (from.x + dx), dest.z - (from.z + dz));
      if (dd < bd) { bd = dd; best = { x: Math.floor(from.x + dx) + 0.5, y: Math.floor(from.y) + dy, z: Math.floor(from.z + dz) + 0.5 }; }
    } catch {}
  }
  return best;
}
function nextStage(dim, from, dest, m) {
  const dry = nextStageInner(dim, from, dest, { ...m, wet: false });
  if (dry) return dry;
  return nextStageInner(dim, from, dest, { ...m, wet: true }); // no dry way: crossing water is allowed
}
function nextStageInner(dim, from, dest, m) {
  const L = Math.hypot(dest.x - from.x, dest.z - from.z) || 1;
  const base = Math.atan2(dest.z - from.z, dest.x - from.x);
  const step = Math.min(16, L);
  let best;
  for (const a of [0, 20, -20, 40, -40, 60, -60, 85, -85]) {
    const ang = base + ((a + (m.detour ?? 0)) * Math.PI) / 180;
    for (const st of [step, step * 0.6]) {
      const w = walkableNear(dim, from.x + Math.cos(ang) * st, from.z + Math.sin(ang) * st, from.y);
      if (!w || hazardBetween(dim, from, w, !!m.wet)) continue;
      const score = Math.hypot(dest.x - w.x, dest.z - w.z) + Math.abs(w.y - from.y) * 1.5;
      if (!best || score < best.score) best = { ...w, score };
    }
    if (best && a === 0) break; // straight ahead works
  }
  return best;
}
const SHAPES = {
  column: [[0, 0], [0, -1], [0, -2], [0, -3], [0, -4], [0, -5]],
  line: [[-0.5, 0], [0.5, 0], [-1.5, 0], [1.5, 0], [-2.5, 0], [2.5, 0]],
  wedge: [[0, 0], [-1, -1], [1, -1], [-2, -2], [2, -2], [0, -2]],
  skirmish: [[-1.5, 0], [1.5, 0], [-3, -1], [3, -1], [-4.5, -1.5], [4.5, -1.5]],
};
function chooseShape(dim, pos, heading, members, now) {
  const rx = -Math.sin(heading), rz = Math.cos(heading);
  let width = 1;
  for (const side of [1, -1]) for (let k = 1; k <= 4; k++) { if (!walkableNear(dim, pos.x + rx * k * side, pos.z + rz * k * side, pos.y)) break; width++; }
  if (width < 5) return "column";                                                   // narrow: street, bridge, path
  const underFire = members.some((e) => now - (hurtBy.get(e.id)?.t ?? -999) < 100);
  if (underFire) return "skirmish";                                                 // spread out under fire
  const enemyKnown = members.some((e) => perc.get(e.id)?.alert === "combat");
  return enemyKnown ? "wedge" : "line";                                            // wedge toward a known enemy
}
function placeLanes(m, dim, center, heading, shape) {
  const S = spacingSetting() * 2, fx = Math.cos(heading), fz = Math.sin(heading), rx = -fz, rz = fx;
  m.lanes.forEach((slot, i) => {
    const [ox, oy] = SHAPES[shape][i % 6];
    const x = center.x + rx * ox * S + fx * oy * S, z = center.z + rz * ox * S + fz * oy * S;
    let w = walkableNear(dim, x, z, center.y);
    if (!w || Math.abs(w.y - center.y) > 1) {                   // unusable spot: nearest usable one around it
      w = undefined;
      for (let r = 1; r <= 3 && !w; r++) for (let k = 0; k < 8 && !w; k++) {
        const a = (k / 8) * Math.PI * 2;
        const c2 = walkableNear(dim, x + Math.cos(a) * r, z + Math.sin(a) * r, center.y);
        if (c2 && Math.abs(c2.y - center.y) <= 1) w = c2;
      }
      w = w ?? center;
    }
    try { marker(slot)?.teleport(w); } catch {}
  });
  m.shape = shape;
}
function startMarch(player, pool, dest, then) {
  let cx = 0, cy = 0, cz = 0;
  for (const e of pool) { cx += e.location.x; cy += e.location.y; cz += e.location.z; }
  cx /= pool.length; cy /= pool.length; cz /= pool.length;
  const dim = player.dimension, from = { x: cx, y: cy, z: cz };
  const m = { pos: from, dest, dim: dim.id, then, final: false, lanes: [], heading: Math.atan2(dest.z - cz, dest.x - cx),
    path: undefined, idx: 0, planning: false, progT: tick(), replans: 0, members: pool.map((e) => e.id) };
  const nLanes = Math.min(6, Math.max(2, Math.ceil(pool.length / 4)));
  for (let i = 0; i < nLanes; i++) { const s = makeWaypoint(dim, from, false); if (s) m.lanes.push(s); }
  if (!m.lanes.length) return undefined;
  const id = `m${tick()}_${m.lanes[0]}`;
  getMarches()[id] = m;
  for (const s of m.lanes) laneOf.set(s, id);
  // don't stand around while the route is worked out: start walking toward the destination
  const L0 = Math.hypot(dest.x - cx, dest.z - cz) || 1, st0 = Math.min(12, L0);
  const first = walkableNear(dim, cx + ((dest.x - cx) / L0) * st0, cz + ((dest.z - cz) / L0) * st0, cy);
  if (first) placeLanes(m, dim, first, m.heading, "line");
  requestPlan(id, m, from);
  saveMarches();
  return { id, lanes: m.lanes };
}
// Long or blocked routes: first a coarse map (4-block cells, ~420 blocks around) finds which WAY works
// (e.g. around the mountain), split into legs of ~28 blocks; each leg is then planned block by block.
// "wide" = after a dead end: search wider and less straight-at-the-goal.
function requestPlan(id, m, from, wide = false) {
  const dim = world.getDimension(m.dim);
  m.planning = true;
  const far = Math.hypot(m.dest.x - from.x, m.dest.z - from.z) > 280;
  if ((!m.legs || !m.legs.length) && far) {
    planRoute(dim, from, { x: m.dest.x, z: m.dest.z }, (pts) => {
      const mm = getMarches()[id];
      if (!mm) return;
      const legs = [];
      if (pts) {
        let lastL = from;
        for (const p of pts.slice(1)) if (flat(p, lastL) >= 28) { legs.push({ x: p.x, y: p.y, z: p.z }); lastL = p; }
      }
      legs.push({ x: mm.dest.x, y: mm.dest.y, z: mm.dest.z });
      mm.legs = legs;
      planLeg(id, mm, from, wide);
    }, { step: 4, maxRadius: 420, max: wide ? 16000 : 9000, weight: wide ? 1.0 : 1.2, dead: m.dead });
    return;
  }
  planLeg(id, m, from, wide);
}
function planLeg(id, m, from, wide) {
  const dim = world.getDimension(m.dim);
  m.planning = true;
  const target = m.legs?.[0] ?? m.dest;
  const lastLeg = !m.legs || m.legs.length <= 1;
  m.legT = { x: target.x, y: target.y, z: target.z, final: lastLeg };
  planRoute(dim, from, lastLeg ? m.dest : { x: target.x, z: target.z }, (pts, partial, frontier) => {
    const mm = getMarches()[id];
    if (!mm) return;
    mm.planning = false;
    mm.replans++;
    mm.frontier = !!(partial && frontier);                      // stopped at unloaded land: just the next stretch, not a dead end
    if (pts) { mm.path = pts; mm.idx = 0; mm.bestIdx = 0; }
    else if (!lastLeg) {                                        // this leg point can't be reached: it was a bad corridor
      markDeadEnd(mm, target);
      mm.path = undefined;                                      // the march loop will plan again (a new corridor)
    } else if (!mm.path) {                                      // nothing found yet: head straight and try again later
      mm.path = [{ x: from.x, y: from.y, z: from.z, w: false }, { x: target.x, y: target.y ?? from.y, z: target.z, w: false }];
      mm.idx = 0; mm.bestIdx = 0;
    }
    mm.progT = tick();
    saveMarches();
  }, { step: 1, maxRadius: 300, max: 120000, weight: wide ? 1.0 : 1.15, dead: m.dead });
}
function markDeadEnd(m, at) {
  const near = (m.dead ?? []).filter((z) => Math.hypot(z.x - at.x, z.z - at.z) < 30).length;
  m.dead = (m.dead ?? []).concat([{ x: at.x, z: at.z, r: 14 + 6 * Math.min(4, near) }]).slice(-16);
  m.legs = undefined;                                          // the corridor was wrong: rethink the whole way
}
// how far along the route a position is (index of the nearest route point)
function routeProgress(m, loc) {
  let bi = 0, bd = 1e9;
  for (let i = 0; i < m.path.length; i++) { const d0 = flat(m.path[i], loc); if (d0 < bd) { bd = d0; bi = i; } }
  return bi;
}
// next route point that's at least a few blocks from the group
function advance(m, c) {
  while (m.idx < m.path.length - 1 && flat(m.path[m.idx], c) < 6) m.idx++;
}
system.runInterval(() => {
  const ms = getMarches();
  const ids = Object.keys(ms);
  if (!ids.length) return;
  const now = tick();
  const soldiers = allOf(SOLDIER);
  let changed = false;
  for (const id of ids) {
    const m = ms[id];
    m.members = m.members ?? [];
    if (!m.members.length) { for (const s of m.lanes) laneOf.delete(s); delete ms[id]; changed = true; continue; } // everyone arrived, died or got new orders
    const members = soldiers.filter((e) => m.members.includes(e.id));
    if (!members.length) continue;                              // out of range: keep the order, resume when they load again
    if (!m.path && !m.planning && !m.final) {                    // (after a reload) plan again from the group
      let x = 0, y = 0, z = 0; for (const e of members) { x += e.location.x; y += e.location.y; z += e.location.z; }
      requestPlan(id, m, { x: x / members.length, y: y / members.length, z: z / members.length }); changed = true; continue;
    }
    if (m.final || m.planning || !m.path) continue;
    const dim = world.getDimension(m.dim);
    let cx = 0, cy = 0, cz = 0;
    for (const e of members) { cx += e.location.x; cy += e.location.y; cz += e.location.z; }
    const c = { x: cx / members.length, y: cy / members.length, z: cz / members.length };
    const fighting = members.some((e) => e.getDynamicProperty("war:ordergoal") !== undefined);
    const before = m.idx;
    // the lead sets the pace: progress = how far along the route the front half has got
    const prog = members.map((e) => routeProgress(m, e.location)).sort((a, b) => b - a);
    const lead = prog[Math.floor((prog.length - 1) / 2)];
    m.idx = Math.max(m.idx, Math.min(m.path.length - 1, lead + 2));
    advance(m, c);
    if (lead > (m.bestIdx ?? 0) || fighting) { m.bestIdx = Math.max(m.bestIdx ?? 0, lead); m.progT = now; }
    // stragglers well behind get their own catch-up point along the route (nobody waits for them)
    for (const e of members) {
      const pi = routeProgress(m, e.location);
      if (m.idx - pi >= 4) {
        const tgt = m.path[Math.min(m.path.length - 1, pi + 2)];
        const slot = makeWaypoint(dim, tgt);
        if (slot) e.setDynamicProperty("war:catchup", slot);     // the brain walks him there (no waiting for him)
      } else if (e.getDynamicProperty("war:catchup") !== undefined) e.setDynamicProperty("war:catchup", undefined);
    }
    const last = m.path[m.path.length - 1];
    const atEnd = m.idx >= m.path.length - 1 && flat(last, c) < 8;
    if (atEnd) {
      const lt = m.legT ?? { x: m.dest.x, z: m.dest.z, final: true };
      const atDest = Math.hypot(m.dest.x - last.x, m.dest.z - last.z) <= 6 && (!Number.isFinite(m.dest.y) || Math.abs(m.dest.y - last.y) <= 4);
      if (atDest) {
        // arrived: lanes become formation spots at the destination
        m.final = true; m.dest.y = last.y; m.pos = { x: last.x, y: last.y, z: last.z };
        placeLanes(m, dim, m.pos, m.heading, "line");
      } else if (!lt.final && Math.hypot(lt.x - last.x, lt.z - last.z) <= 8) {
        m.legs?.shift();                                         // leg done: plan the next one
        requestPlan(id, m, c);
      } else if (m.frontier) {
        requestPlan(id, m, c);                                   // reached the edge of the loaded land: plan the next stretch
      } else {
        markDeadEnd(m, last);                                    // the route ran out short of the target: a dead end
        requestPlan(id, m, c, true);
      }
      changed = true; continue;
    }
    if (now - m.progT > 300 && m.replans < 60) {               // no new ground for ~15 s: a dead end -> rethink wider
      const leadE = members.reduce((b, e) => (routeProgress(m, e.location) > routeProgress(m, b.location) ? e : b), members[0]);
      markDeadEnd(m, leadE.location);
      requestPlan(id, m, leadE.location, true); changed = true; continue;
    }
    const p = m.path[m.idx], prev = m.path[Math.max(0, m.idx - 1)];
    m.heading = Math.atan2(p.z - prev.z, p.x - prev.x) || m.heading;
    const narrow = p.w || prev.w;
    placeLanes(m, dim, p, m.heading, narrow ? "column" : chooseShape(dim, p, m.heading, members, now));
    m.pos = { x: p.x, y: p.y, z: p.z };
    changed = true;
  }
  if (changed) saveMarches();
}, 10);
// is this soldier's current route stretch a planned water crossing?
function plannedSwim(e) {
  const g = Number(e.getDynamicProperty("war:ordergoal") ?? e.getDynamicProperty("war:goal") ?? 0);
  const id = laneOf.get(g); const m = id ? getMarches()[id] : undefined;
  if (!m || !m.path) return false;
  return m.path.some((p) => p.w && flat(p, e.location) < 14);    // the route crosses water right here
}
function arriveCharge(e, d) {
  const id = laneOf.get(d.goal) ?? (getMarches(), laneOf.get(d.goal));
  const m = id ? getMarches()[id] : undefined;
  const lane = marker(d.goal);
  if (!lane) return false;
  if (m && !m.final) return false;                   // still marching
  if (dist(e.location, lane.location) > 4) return false;
  const then = m?.then ?? e.getDynamicProperty("war:then") ?? "hold";
  giveFunction(e, then === "patrol" ? "patrol" : (d.div === "garrison" ? "post" : "hold"), undefined, d.goal);
  return true;
}
// formation spots for Hold here / Patrol here (and as a fallback)
function formationSlot(dim, center, e, spread = 3) {
  const S = spread * spacingSetting() / 1.5;
  const k = e.id.charCodeAt(e.id.length - 1) % 4;
  const off = [[-1, -1], [1, -1], [-1, 1], [1, 1]][k];
  const spot = walkableNear(dim, center.x + off[0] * S, center.z + off[1] * S, center.y) ?? center;
  return makeWaypoint(dim, spot) || makeWaypoint(dim, center);
}
// keep a little space between moving soldiers (spacing setting, 1-2 blocks)
system.runInterval(() => {
  const sp = spacingSetting();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e);
      if (isRiding(e) || e.getDynamicProperty("war:ordergoal") !== undefined || d.func === "post") continue;
      const moving = ["charge", "patrol", "follow"].includes(d.func);
      for (const o of nearbyCombatants(e.dimension.id, e.location, moving ? sp : 0.8)) {   // standing: only un-stack
        if (o.id === e.id || o.typeId !== SOLDIER) continue;
        const a = e.location, b = o.location, l = Math.hypot(a.x - b.x, a.z - b.z) || 0.01;
        push(e, { x: ((a.x - b.x) / l) * 0.08, y: 0, z: ((a.z - b.z) / l) * 0.08 }, 1);
        break;
      }
    } catch {}
  }
}, 10);

// ================================================================ Decision readout (hidden testing setting)
// Soldiers always think; this only makes the latest decision visible above their heads.
const notes = new Map(); // soldier id -> { text, t }
function note(e, text) { notes.set(e.id, { text, t: tick() }); }
system.runInterval(() => {
  const on = !!setting("readout", false);
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const n = notes.get(e.id);
      const want = on && n && now - n.t < 60 ? n.text : "";
      if ((e.getDynamicProperty("war:readout") ?? "") !== want) { e.setDynamicProperty("war:readout", want); updateName(e); }
    } catch {}
  }
  if (now % 400 < 20) for (const id of [...notes.keys()]) if (!world.getEntity(id)) notes.delete(id);
}, 20);

// ================================================================ Water: get back on land
// A soldier in water that he doesn't need to be in swims for the nearest land toward his goal.
function inWater(e) {
  try { const b = e.dimension.getBlock({ x: e.location.x, y: e.location.y + 0.2, z: e.location.z }); return !!b && b.typeId.includes("water"); } catch { return false; }
}
function goalPoint(e) {
  const d = sd(e);
  const g = marker(Number(e.getDynamicProperty("war:ordergoal") ?? e.getDynamicProperty("war:goal") ?? 0));
  if (g) return g.location;
  if (d.leader) { const p = findPlayer(d.leader); if (p && p.dimension.id === e.dimension.id) return p.location; }
  return undefined;
}
const wetSince = new Map(); // soldier id -> tick he entered water
const crossing = new Map();  // soldier id -> true while committed to a planned crossing
const exitSpot = new Map();  // soldier id -> { slot, at, t } chosen shore (kept until reached)
function waterExit(e, d, now) {
  if (isRiding(e) || !inWater(e)) {
    wetSince.delete(e.id);
    if (crossing.has(e.id)) crossing.delete(e.id);
    if (exitSpot.has(e.id)) exitSpot.delete(e.id);
    return undefined;
  }
  if (!wetSince.has(e.id)) wetSince.set(e.id, now);
  // a planned crossing: commit to it until out on land
  if (crossing.has(e.id) || (d.func === "charge" && plannedSwim(e))) { crossing.set(e.id, true); note(e, "crossing water"); swimOn(e); return undefined; }
  // already heading for a shore: keep going there
  const ex = exitSpot.get(e.id);
  if (ex && marker(ex.slot) && now - ex.t < 300) { swimTo(e, ex.at); return { g: "g_wp", slot: ex.slot, t: "t_mid", urgent: true }; }
  if (now - wetSince.get(e.id) < 10) return undefined;
  const goal = goalPoint(e), p = e.location;
  let best, bs = 1e9;
  for (let r = 2; r <= 16; r += 2) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const w = walkableNear(e.dimension, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.y);
      if (!w) continue;
      const sc = r * 2 + (goal ? Math.hypot(goal.x - w.x, goal.z - w.z) * 0.5 : 0);
      if (sc < bs) { bs = sc; best = w; }
    }
    if (best) break;
  }
  if (!best) { swimOn(e); return undefined; }                       // open water: keep moving toward the goal
  const slot = makeWaypoint(e.dimension, best);
  if (!slot) return undefined;
  exitSpot.set(e.id, { slot, at: best, t: now });
  note(e, "getting out of the water");
  swimTo(e, best);
  return { g: "g_wp", slot, t: "t_mid", urgent: true };
}
// swimming with purpose: a steady stroke toward the target, and a boost up onto the bank
function swimTo(e, at) {
  const p = e.location, dx = at.x - p.x, dz = at.z - p.z, l = Math.hypot(dx, dz) || 1;
  let bank = false;
  try {
    const ax = p.x + (dx / l) * 0.9, az = p.z + (dz / l) * 0.9, y = Math.floor(p.y);
    const f = e.dimension.getBlock({ x: ax, y, z: az }), h = e.dimension.getBlock({ x: ax, y: y + 1, z: az });
    bank = !!f && !f.isAir && !f.isLiquid && !!h && passable(h);
  } catch {}
  push(e, { x: (dx / l) * 0.22, y: bank ? 0.5 : 0.04, z: (dz / l) * 0.22 }, 2);
}
function swimOn(e) { const g = goalPoint(e); if (g) swimTo(e, g); }

// ================================================================ Fall awareness
// Before stepping off a ledge, a soldier works out the fall: free up to ~3 blocks, then ~1 HP per
// block. He only drops if it costs less than about a third of his current health (any height into
// water at least 2 deep). Never into lava or fire. Otherwise he looks along the ledge for a better way.
function dropInfo(dim, x, z, fromY) {
  for (let h = 1; h <= 40; h++) {
    let b;
    try { b = dim.getBlock({ x, y: fromY - h, z }); } catch { return undefined; }
    if (!b) return undefined;
    if (b.isAir || passable(b)) continue;
    const id = b.typeId;
    if (id.includes("water")) {
      let deep = 1;
      try { const b2 = dim.getBlock({ x, y: fromY - h - 1, z }); if (b2 && b2.typeId.includes("water")) deep = 2; } catch {}
      return { h: h - 1, water: deep >= 2, bad: false };
    }
    return { h: h - 1, water: false, bad: HAZARD.some((k) => id.includes(k)) };
  }
  return { h: 40, water: false, bad: true };
}
function safeDrop(e, info) {
  if (!info || info.bad) return false;
  if (info.water) return true;
  if (info.h <= 3) return true;
  const hp = e.getComponent("minecraft:health");
  const cur = hp ? hp.currentValue : 16;
  return info.h - 3 < cur * 0.33;
}
// returns true if it handled the move (dropped or headed to a better way down)
function descend(e, goalLoc) {
  const p = e.location, dim = e.dimension;
  if (goalLoc.y > p.y - 2) return false;                         // goal isn't below him
  const hx = goalLoc.x - p.x, hz = goalLoc.z - p.z, l = Math.hypot(hx, hz) || 1;
  const ax = Math.floor(p.x + (hx / l) * 1.2) + 0.5, az = Math.floor(p.z + (hz / l) * 1.2) + 0.5;
  const fy = Math.floor(p.y);
  let ahead;
  try { ahead = dim.getBlock({ x: ax, y: fy - 1, z: az }); } catch { return false; }
  if (!ahead || !(ahead.isAir || passable(ahead))) return false;  // not at an edge
  const info = dropInfo(dim, ax, az, fy);
  if (safeDrop(e, info)) { note(e, info.h > 3 ? `dropping ${info.h} blocks` : "stepping down"); push(e, { x: (hx / l) * 0.3, y: 0.05, z: (hz / l) * 0.3 }, 2); return true; }
  // too high here: look along the ledge (within ~12 blocks) for a safe way down
  let best, bs = 1e9;
  for (let r = 2; r <= 12; r += 2) for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = Math.floor(p.x + Math.cos(a) * r) + 0.5, z = Math.floor(p.z + Math.sin(a) * r) + 0.5;
    const top = walkableNear(dim, x, z, p.y);
    if (!top || Math.abs(top.y - fy) > 1) continue;
    for (let j = 0; j < 4; j++) {
      const b = j * Math.PI / 2;
      const ex = Math.floor(x + Math.cos(b)) + 0.5, ez = Math.floor(z + Math.sin(b)) + 0.5;
      let eb; try { eb = dim.getBlock({ x: ex, y: top.y - 1, z: ez }); } catch { continue; }
      if (!eb || !(eb.isAir || passable(eb))) continue;
      const inf = dropInfo(dim, ex, ez, top.y);
      if (!safeDrop(e, inf)) continue;
      const sc = r + inf.h * 0.5 + Math.hypot(goalLoc.x - ex, goalLoc.z - ez) * 0.2;
      if (sc < bs) { bs = sc; best = { x, z }; }
    }
  }
  if (best) { note(e, "finding a way down"); nudge(e, { x: best.x, y: p.y, z: best.z }, 0.3, 2); return true; }
  note(e, "waiting: drop too high");
  return true;                                                    // stay put rather than die
}

// ================================================================ Long-range aiming and marked spots
// "Where I'm looking" works at any distance: the view ray is followed through loaded land; past the
// edge of what the game runs, the destination is estimated along the same line.
function aimFar(player) {
  try { const s = lookedSpot(player, 200); if (s) return s; } catch {}
  const eye = player.getHeadLocation(), dir = player.getViewDirection(), dim = player.dimension;
  let lastGroundY = player.location.y, tExit = 0;
  for (let t = 4; t <= 600; t += 4) {
    const p = { x: eye.x + dir.x * t, y: eye.y + dir.y * t, z: eye.z + dir.z * t };
    let b;
    try { b = dim.getBlock(p); } catch { tExit = t; break; }        // left the loaded area
    if (!b) { tExit = t; break; }
    if (!b.isAir && !passable(b) && !b.typeId.includes("water")) return { x: p.x, y: p.y + 1, z: p.z };
    const g = walkableNear(dim, p.x, p.z, lastGroundY);
    if (g) lastGroundY = g.y;
  }
  if (!tExit) tExit = 600;
  // estimate: where the view line meets the last known ground height, else a bit past the edge
  let t = tExit + 48;
  if (dir.y < -0.02) t = Math.max(tExit, Math.min(800, (lastGroundY - eye.y) / dir.y));
  else if (dir.y > 0.02) t = Math.min(800, tExit + 48 + dir.y * 400); // looking up at a far hill: go farther
  const hl = Math.hypot(dir.x, dir.z) || 1;
  return { x: eye.x + (dir.x / hl) * t, y: lastGroundY, z: eye.z + (dir.z / hl) * t, estimated: true };
}
const getMarks = () => getJSON(world, "war:marks", []);
async function markSpot(player) {
  const r = await show(new ModalFormData().title("Mark this spot").textField("Name", "e.g. Eastern mountain"), player);
  if (!r || r.canceled || !r.formValues) return;
  const name = String(r.formValues[0]).trim().slice(0, 32) || `Mark ${getMarks().length + 1}`;
  const marks = getMarks().filter((m) => m.name !== name);
  const l = player.location;
  marks.push({ name, x: l.x, y: l.y, z: l.z, dim: player.dimension.id });
  setJSON(world, "war:marks", marks.slice(-30));
  player.onScreenDisplay.setActionBar(`§aMarked "${name}" at ${Math.round(l.x)}, ${Math.round(l.y)}, ${Math.round(l.z)}`);
}
async function pickMark(player) {
  const marks = getMarks().filter((m) => m.dim === player.dimension.id);
  if (!marks.length) { player.sendMessage("§7No marked spots yet. Use the Command Baton > Mark this spot while standing there."); return undefined; }
  const af = new ActionFormData().title("Marked spots");
  for (const m of marks) af.button(`${m.name}\n§8${Math.round(m.x)}, ${Math.round(m.y)}, ${Math.round(m.z)} · ${Math.round(Math.hypot(m.x - player.location.x, m.z - player.location.z))} blocks`);
  af.button("§cDelete a mark...");
  const r = await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return undefined;
  if (r.selection === marks.length) {
    const df = new ActionFormData().title("Delete which mark?");
    for (const m of marks) df.button(m.name);
    const dr = await show(df, player);
    if (dr && !dr.canceled && dr.selection !== undefined) setJSON(world, "war:marks", getMarks().filter((m) => m.name !== marks[dr.selection].name));
    return undefined;
  }
  return marks[r.selection];
}

// ================================================================ Movement arbiter
// Every system that wants to move a soldier proposes a push with a priority; each soldier gets at
// most one push at a time (escape 4 > combat 3 > route 2 > spacing 1), so nothing fights anything.
const pushes = new Map();   // soldier id -> { e, vec, p }
const pushCool = new Map(); // soldier id -> tick of last push
function push(e, vec, p = 2) {
  const cur = pushes.get(e.id);
  if (!cur || p > cur.p) pushes.set(e.id, { e, vec, p });
}
system.runInterval(() => {
  const now = tick();
  for (const [id, it] of pushes) {
    if (now - (pushCool.get(id) ?? -99) < (it.p >= 3 ? 4 : 8)) continue;
    try { if (it.e.isValid) { it.e.applyImpulse(it.vec); pushCool.set(id, now); } } catch {}
  }
  pushes.clear();
  if (now % 400 < 2) for (const id of [...pushCool.keys()]) if (now - pushCool.get(id) > 400) pushCool.delete(id);
}, 2);

// ================================================================ Route planner (A*, the army's GPS)
// Reads the real terrain around the army and finds the cheapest route: flat ground and bridges are
// cheap, climbing costs a little, safe drops are cheap, swimming is expensive but allowed, lava /
// fire / deadly drops / walls over 2 blocks are impossible. Runs in small slices every tick.
const planJobs = [];
const PLAN_BUDGET = 700;          // node expansions per tick, shared by all plans (a big search takes a few seconds)
function cellAt(job, x, z, refY) {
  const key = `${x},${z}`;
  const c = job.cells.get(key);
  if (c !== undefined) {
    if (c.miss !== undefined) { if (Math.abs(c.miss - refY) <= 2) return null; }   // "no ground here" only counts for that height
    else if (c.unloaded) return null;
    else if (Math.abs(c.y - refY) <= 9) return c;
  }
  let found = null;
  const dim = job.dim;
  const bx = x + 0.5, bz = z + 0.5;
  const DY = job.step > 1 ? [0, 1, -1, 2, -2, 3, -3, 4, -4, -5, -6, -7, -8, -9, -10, 5, 6] : [0, 1, -1, 2, -2, -3, -4, -5, -6, -7, -8];
  try {
    for (const dy of DY) {
      const y = Math.floor(refY) + dy;
      const floor = dim.getBlock({ x: bx, y: y - 1, z: bz }), feet = dim.getBlock({ x: bx, y, z: bz }), head = dim.getBlock({ x: bx, y: y + 1, z: bz });
      if (!floor || !feet || !head) { found = null; break; }
      if (feet.typeId.includes("water") && passable(head)) { found = { x, z, y, w: true }; break; }  // surface water: swim
      if (feet.typeId.includes("water")) continue;
      if (floor.isAir || floor.isLiquid || floor.typeId.includes("leaves") || HAZARD.some((h) => floor.typeId.includes(h))) continue;
      if (!passable(feet) || !passable(head)) continue;
      // a shoreline cell (water right next to it) costs a little extra, so routes keep off the water's edge
      let shore = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nb = dim.getBlock({ x: bx + dx, y, z: bz + dz }), nf = dim.getBlock({ x: bx + dx, y: y - 1, z: bz + dz });
        if ((nb && nb.typeId.includes("water")) || (nf && nf.typeId.includes("water"))) { shore = true; break; }
      }
      let cave = false;
      try { cave = dim.getSkyLightLevel({ x: bx, y, z: bz }) < 6; } catch {}  // no open sky: underground
      found = { x, z, y, w: false, shore, cave }; break;
    }
  } catch { job.cells.set(key, { unloaded: true }); job.hitUnloaded = true; return null; }  // unloaded: can't plan through it
  job.cells.set(key, found ?? { miss: Math.floor(refY) });
  return found;
}
function inDead(job, b) {
  if (Math.hypot(b.x - job.origin.x, b.z - job.origin.z) < 10) return false;   // never trap him where he stands
  for (const z of job.dead ?? []) if (Math.hypot(b.x - z.x, b.z - z.z) < z.r) return true;
  return false;
}
function stepCost(a, b, diag, job) {
  const step = job?.step ?? 1;
  let base = (diag ? 1.414 : 1) * step;
  const dy = b.y - a.y;
  if (step > 1) {
    // coarse map (4-block cells): judge slopes over the whole cell
    if (dy > 4 || (a.w && dy > 2)) return Infinity;
    if (dy > 2) base += 20 * (dy - 2) + 10;                     // steep over a whole cell: probably a cliff
    else if (dy > 0) base += dy * 0.8;
    else if (-dy > 10 && !b.w) return Infinity;
    else if (-dy > 5 && !b.w) base += (-dy) * 0.3;
  } else {
    if (dy > 1) return Infinity;                                // only steps a soldier can always take
    if (dy === 1) base += 0.4;
    else if (dy < 0) {
      const h = -dy;
      if (!b.w) {
        if (h > 8) return Infinity;                             // deadly drop
        if (h > 3) base += 0.3 * h;                             // a drop that costs some health
      }
    }
  }
  if (job && inDead(job, b)) base += 40 * step;                 // a known dead end: only if there's truly nothing else
  if (b.w) base *= 10;                                          // swimming: only when it saves a lot
  else if (b.shore) base += 0.6;                                // keep off the shoreline
  if (b.cave) base += 8 * (job?.step ?? 1);                     // caves are traps: only if there's truly no open route
  return base;
}
class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
function planRoute(dim, start, goal, onDone, opts = {}) {
  const step = opts.step ?? 1;
  const maxRadius = opts.maxRadius ?? 170;
  const snap = (v) => Math.floor(v / step) * step;
  const sx = snap(start.x), sz = snap(start.z);
  const gy = Number.isFinite(goal.y) ? Math.floor(goal.y) : undefined;
  const job = { dim, goal: { x: Math.floor(goal.x), z: Math.floor(goal.z), y: step > 1 ? undefined : gy }, cells: new Map(), open: new Heap(), g: new Map(), came: new Map(),
    closed: new Set(), best: undefined, bestH: Infinity, exp: 0, max: opts.max ?? 9000, onDone, origin: { x: sx, z: sz }, maxRadius,
    step, weight: opts.weight ?? 1.25, dead: opts.dead ?? [] };
  const s0 = cellAt(job, sx, sz, start.y) ?? { x: sx, z: sz, y: Math.floor(start.y), w: false };
  job.cells.set(`${sx},${sz}`, s0);
  const h0 = Math.hypot(job.goal.x - sx, job.goal.z - sz);
  job.open.push({ x: sx, z: sz, y: s0.y, w: s0.w, f: h0 });
  job.g.set(`${sx},${sz}`, 0);
  job.best = { x: sx, z: sz }; job.bestH = h0;
  planJobs.push(job);
}
function finishJob(job, endKey, partial = false) {
  const pts = [];
  let k = endKey;
  while (k) { const [x, z] = k.split(",").map(Number); const c = job.cells.get(k); pts.push({ x: x + 0.5, y: c && c.y !== undefined ? c.y : 0, z: z + 0.5, w: !!c?.w }); k = job.came.get(k); }
  pts.reverse();
  // keep a point every ~6 blocks, at turns, height changes and water edges
  const out = [];
  let last;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    const turn = prev && next && ((next.x - p.x) * (p.z - prev.z) - (next.z - p.z) * (p.x - prev.x)) !== 0;
    const edge = prev && (prev.w !== p.w || Math.abs(prev.y - p.y) >= 2);
    if (i === 0 || i === pts.length - 1 || edge || (turn && last && flat(last, p) >= 3) || (last && flat(last, p) >= 6)) { out.push(p); last = p; }
  }
  try { job.onDone(out.length > 1 ? out : undefined, partial, !!job.hitUnloaded); } catch {}
}
system.runInterval(() => {
  let budget = PLAN_BUDGET;
  while (budget > 0 && planJobs.length) {
    const job = planJobs[0];
    let finished = false;
    while (budget-- > 0) {
      if (!job.open.size || job.exp >= job.max) {
        // no full route: go as far as we can toward the goal (re-planned later)
        const bk = `${job.best.x},${job.best.z}`;
        if (job.bestH < Math.hypot(job.goal.x - job.origin.x, job.goal.z - job.origin.z) - 6) finishJob(job, bk, true); else { try { job.onDone(undefined, true, !!job.hitUnloaded); } catch {} }
        finished = true; break;
      }
      const n = job.open.pop();
      const nk = `${n.x},${n.z}`;
      if (job.closed.has(nk)) continue;
      job.closed.add(nk);
      job.exp++;
      const hz = job.goal.y === undefined ? 0 : Math.abs(n.y - job.goal.y);
      const h = Math.hypot(job.goal.x - n.x, job.goal.z - n.z) + hz * 0.5;
      if (h < job.bestH) { job.bestH = h; job.best = { x: n.x, z: n.z }; }
      if (Math.hypot(job.goal.x - n.x, job.goal.z - n.z) <= Math.max(2, job.step * 1.5) && hz <= 3) { finishJob(job, nk); finished = true; break; } // right spot AND right height
      const cur = { y: n.y, w: n.w };
      const S = job.step;
      for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const dx = ddx * S, dz = ddz * S;
        const x = n.x + dx, z = n.z + dz, key = `${x},${z}`;
        if (job.closed.has(key)) continue;
        if (Math.hypot(x - job.origin.x, z - job.origin.z) > job.maxRadius) continue;
        const c = cellAt(job, x, z, n.y);
        if (!c) continue;
        const diag = dx !== 0 && dz !== 0;
        if (diag && S === 1) { // no cutting corners
          const c1 = cellAt(job, n.x + dx, n.z, n.y), c2 = cellAt(job, n.x, n.z + dz, n.y);
          if (!c1 || !c2 || Math.abs(c1.y - n.y) > 1 || Math.abs(c2.y - n.y) > 1) continue;
        }
        const sc = stepCost(cur, c, diag, job);
        if (!isFinite(sc)) continue;
        const g = (job.g.get(nk) ?? 0) + sc;
        if (g >= (job.g.get(key) ?? Infinity)) continue;
        job.g.set(key, g); job.came.set(key, nk);
        job.open.push({ x, z, y: c.y, w: c.w, f: g + job.weight * (Math.hypot(job.goal.x - x, job.goal.z - z) + (job.goal.y === undefined ? 0 : Math.abs(c.y - job.goal.y) * 0.5)) }); // aimed search
      }
    }
    if (finished) planJobs.shift();
    else if (budget <= 0) break;
  }
}, 1);

world.afterEvents.entityDie.subscribe((ev) => {
  try {
    if (ev.deadEntity.typeId !== SOLDIER) return;
    const id = ev.deadEntity.id;
    delete getRefs()[id];
    let changed = false;
    for (const m of Object.values(getMarches())) if (m.members?.includes(id)) { m.members = m.members.filter((x) => x !== id); changed = true; }
    if (changed) saveMarches();
  } catch {}
});
