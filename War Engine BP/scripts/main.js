// War Engine v7.0: faction NPC war framework
import { world, system, Player, ItemStack, EquipmentSlot, GameMode } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import { SKINS } from "./skins.js";
import { WarAPI } from "./api.js";
// v6.2: errors are never silent any more in the core loops: counted per system, written to the content log (with the
// first lines of the stack) at most once a minute per system, and shown in chat when "Show soldier decisions" is on.
const ERRS = new Map(); // system -> { n, t }
function oops(sys, err) {
  try {
    const now = system.currentTick, r = ERRS.get(sys) ?? { n: 0, t: -99999 };
    r.n++;
    if (now - r.t >= 1200) {
      r.t = now;
      const msg = `War Engine: ${sys} error (x${r.n}): ${String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ")}`;
      console.warn(msg);
      try { if (world.getDynamicProperty("war:set_readout")) world.sendMessage(`§c${msg.slice(0, 180)}`); } catch {}
      r.n = 0;
    }
    ERRS.set(sys, r);
  } catch {}
}
{ const ri = system.runInterval.bind(system); system.runInterval = (f, n) => ri(() => { try { f(); } catch (err) { oops("loop", err); } }, n); }
import "./extensions/index.js";

// ================================================================ constants
const SOLDIER = "war:soldier", HOUND = "war:hound", WAYPOINT = "war:waypoint", FLAG = "war:flag";
const VEHICLES = ["war:boat", "war:plane", "war:tank"];
const NF = 40, NSLOT = 1600;   // (v6.6: 40 factions, was 20)
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
  // v6.6: 20 more
  ["Jet", "§0"], ["Quartz", "§h"], ["Iron", "§i"], ["Netherite", "§j"], ["Crimson", "§m"],
  ["Emerald", "§q"], ["Lapis", "§t"], ["Amber", "§v"], ["Coral", "§c"], ["Indigo", "§1"],
  ["Forest", "§2"], ["Sand", "§e"], ["Lavender", "§d"], ["Rust", "§6"], ["Silver", "§7"],
  ["Rose", "§c"], ["Mint", "§a"], ["Sky", "§b"], ["Plum", "§5"], ["Khaki", "§g"],
];
const DIV = {
  foot: { name: "Foot Soldier", hp: "hp_40", weapon: true },
  garrison: { name: "Garrison", hp: "hp_40", weapon: true },
  guard: { name: "Guard", hp: "hp_60", weapon: true },
  medic: { name: "Medic", hp: "hp_30", weapon: false },
  grenadier: { name: "Demolition", hp: "hp_40", weapon: false },
  houndmaster: { name: "Houndmaster", hp: "hp_40", weapon: true },
  cavalier: { name: "Cavalier", hp: "hp_80", weapon: true },
};
// v6.0: the armband each type wears (RP: controller.render.war_band): 1 green foot, 2 white/red cross medic, 3 blue guard,
// 4 yellow garrison, 5 orange grenadier, 6 brown houndmaster (cavalry: none)
const ROLE_OF = { foot: 1, medic: 2, guard: 3, garrison: 4, grenadier: 5, houndmaster: 6, cavalier: 0 };
const roleFor = (e) => (setting("bands", true) ? ROLE_OF[String(gdp(e, "war:div") ?? "foot")] ?? 0 : 0);
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
  ["mg", "Machine gun"], ["shotgun", "Shotgun"], ["pistol", "Pistol"], ["sniper", "Sniper"], ["spear", "Spear"]];   // (v6.6: spear)
// v6.7: the Demolition unit's own kits (nobody else gets these): grenades or molotovs with a pistol, or a bazooka
const DEMO = [["grenade", "Grenades"], ["molotov", "Molotovs"], ["at", "Bazooka"]];   // (v6.9.1: no sidearm: the throw is the weapon)
const ALL_WEAPONS = [...WEAPONS, ["at", "Anti-tank"], ["molotov", "Molotovs"]];   // (older soldiers may still carry these)
const MELEE_W = ["sword", "spear", "molotov"];                  // hand-to-hand weapons (everything else shoots)
const isRangedW = (w) => !MELEE_W.includes(w);
const GUNS = ["rifle", "semi", "smg", "mg", "shotgun", "at", "pistol", "sniper"];
const LOADOUTS = {
  american: { name: "American", rifle: "m1903", semi: "garand", smg: "thompson", mg: "bar", shotgun: "model1912", at: "bazooka", pistol: "m1911", sniper: "m1903s" },
  german: { name: "German", rifle: "kar98", semi: "g43", smg: "mp40", mg: "mg42", shotgun: "model1912", at: "pzb39", pistol: "p08", sniper: "kar98s" },
  soviet: { name: "Eastern European", rifle: "mosin", semi: "svt38", smg: "ppsh41d", mg: "dp28", shotgun: "model1912", at: "bazooka", pistol: "tt33", sniper: "kar98s" },
  japanese: { name: "Eastern", rifle: "type99", semi: "type99", smg: "type100", mg: "type96", shotgun: "model1912", at: "bazooka", pistol: "nagant", sniper: "kar98s" },
  western: { name: "Western European", rifle: "m1903", semi: "garand", smg: "mab38", mg: "lewis", shotgun: "model1912", at: "bazooka", pistol: "mas35", sniper: "m1903s" },
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
const GUN_MODELS = ["m1903", "garand", "thompson", "bar", "model1912", "bazooka", "m1911", "kar98", "g43", "mp40", "mg42", "pzb39", "p08", "mosin", "svt38", "ppsh41d", "dp28", "tt33", "type99", "type100", "type96", "nagant", "mab38", "lewis", "mas35", "m1903s", "kar98s"];

// ================================================================ caches & world data
let relCache, namesCache, squadsCache;
let markerCache = new Map();
function getRel() {
  if (relCache) return relCache;
  let r = gdp(world, "war:rel");
  if (typeof r !== "string" || r.length !== NF * NF) {
    // v6.6: everyone starts NEUTRAL (was hostile). A world from before keeps the relations it had: an older, smaller
    // table (20 factions) is copied in and the new factions start neutral to everyone
    const old = typeof r === "string" ? r : "", on = Math.round(Math.sqrt(old.length));
    let out = "";
    for (let a = 1; a <= NF; a++) for (let b = 1; b <= NF; b++) out += a === b ? "2" : on * on === old.length && a <= on && b <= on ? old[(a - 1) * on + (b - 1)] : "0";
    r = out;
    sdp(world, "war:rel", r);
  }
  return (relCache = r);
}
const relAt = (a, b) => (a && b ? getRel()[(a - 1) * NF + (b - 1)] : "0");
const relVersion = () => Number(gdp(world, "war:relv") ?? 0);
function setRelPair(a, b, v, announce = true) {
  if (!a || !b || a === b || relAt(a, b) === v) return;
  const arr = getRel().split("");
  arr[(a - 1) * NF + (b - 1)] = v;
  arr[(b - 1) * NF + (a - 1)] = v;
  relCache = arr.join("");
  sdp(world, "war:rel", relCache);
  sdp(world, "war:relv", relVersion() + 1);
  if (announce) say(`${factionLabel(a)} §fis now ${REL_TXT[v]}§r§f with ${factionLabel(b)}`);
}
const isHostile = (a, b) => !!a && !!b && a !== b && relAt(a, b) === "1";
const isFriendly = (a, b) => !!a && !!b && (a === b || relAt(a, b) === "2");
function getNames() {
  if (namesCache) return namesCache;
  try { const n = JSON.parse(String(gdp(world, "war:names") ?? "[]")); if (Array.isArray(n)) return (namesCache = n); } catch {}
  return (namesCache = []);
}
function getSquads() {
  if (squadsCache) return squadsCache;
  try { const s = JSON.parse(String(gdp(world, "war:squads") ?? "{}")); if (s && typeof s === "object") return (squadsCache = s); } catch {}
  return (squadsCache = {});
}
const squadName = (f, n) => (n ? (getSquads()[f]?.[n - 1] || `Squad ${n}`) : "No squad");
const squadList = (f, first) => [first, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}: ${squadName(f, n)}`)];
const setting = (k, def) => { const v = gdp(world, `war:set_${k}`); return v === undefined ? def : v; };
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
// v7.0: every list in every menu A-Z (by what it shows: a renamed faction sorts by its name). "All...", "None", "My
// faction", "No squad", "(keep...)" stay on top; "« Back", "Cancel", "+ Create" at the bottom. Lists of 3 or fewer (a
// stance, Less / Normal / A lot) keep their natural order. Done once here, for every form: each list is shown sorted
// and the answer is turned back into the original choice, so no menu's logic changes.
const sortKey = (t) => { let k = String(t ?? "").replace(/§./g, "").trim(); const m = k.match(/^[^()]+ \((.+)\)$/); if (m) k = m[1]; return k.replace(/^[⚑\s]+/, "").replace(/^coalition:\s*/i, "").replace(/^\d+:\s*/, "").toLowerCase(); };
const PIN_FIRST = /^(my faction|all |all$|none|no squad|faction uniform|\(keep|yes)/i, PIN_LAST = /^(«|back|cancel|close|done|\+ |§a\+ )/i;
function sortPerm(labels) {
  const plain = labels.map((l) => String(l ?? "").replace(/§./g, "").trim()), idx = labels.map((_, i) => i);
  const first = idx.filter((i) => PIN_FIRST.test(plain[i])), last = idx.filter((i) => !first.includes(i) && PIN_LAST.test(plain[i]));
  const mid = idx.filter((i) => !first.includes(i) && !last.includes(i)).sort((a, b) => sortKey(labels[a]).localeCompare(sortKey(labels[b]), undefined, { numeric: true }));
  return [...first, ...mid, ...last];
}
const facOrder = () => !setting("abc", true) ? Array.from({ length: NF }, (_, i) => i + 1) : Array.from({ length: NF }, (_, i) => i + 1).sort((a, b) => sortKey(factionLabel(a)).localeCompare(sortKey(factionLabel(b)), undefined, { numeric: true }));
let ABC_OK = false;   // all-or-nothing: if any of the form methods can't be wrapped, nothing is sorted (answers stay exact)
try {
  const MP = ModalFormData.prototype, AP = ActionFormData.prototype, orig = {};
  for (const m of ["slider", "toggle", "textField", "dropdown"]) orig[m] = MP[m];
  for (const m of ["slider", "toggle", "textField"]) { const o = orig[m]; if (o) MP[m] = function (...a) { (this.__f ??= []).push(null); return o.apply(this, a); }; }
  const dd = orig.dropdown;
  MP.dropdown = function (label, opts, o = {}) {
    this.__f ??= [];
    if (!ABC_OK || !setting("abc", true) || !Array.isArray(opts) || opts.length < 4) { this.__f.push(null); return dd.call(this, label, opts, o); }
    const perm = sortPerm(opts); this.__f.push(perm);
    return dd.call(this, label, perm.map((i) => opts[i]), { ...o, defaultValueIndex: Math.max(0, perm.indexOf(o?.defaultValueIndex ?? 0)) });
  };
  const bt = AP.button;
  AP.__flush = function () {
    if (this.__done) return; this.__done = true;
    const b = this.__b ?? [], perm = ABC_OK && setting("abc", true) && b.length >= 4 ? sortPerm(b.map((x) => x[0])) : b.map((_, i) => i);
    this.__perm = perm;
    for (const i of perm) bt.apply(this, b[i]);
  };
  AP.button = function (text, icon) { (this.__b ??= []).push(icon === undefined ? [text] : [text, icon]); return this; };   // (after __flush exists: never a form whose buttons can't be added)
  ABC_OK = MP.dropdown !== dd && AP.button !== bt && ["slider", "toggle", "textField"].every((m) => !orig[m] || MP[m] !== orig[m]);
  if (!ABC_OK) { for (const m of Object.keys(orig)) { try { MP[m] = orig[m]; } catch {} } try { AP.button = bt; } catch {} }
} catch { ABC_OK = false; }
async function show(form, player) {
  if (typeof form.__flush === "function" && form.__b) form.__flush();
  for (let i = 0; i < 20; i++) {
    const r = await form.show(player);
    if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy) { await sleep(5); continue; }
    if (form.__perm && r.selection !== undefined) return { canceled: r.canceled, cancelationReason: r.cancelationReason, selection: form.__perm[r.selection] };
    if (form.__f && r.formValues) return { canceled: r.canceled, cancelationReason: r.cancelationReason, formValues: r.formValues.map((v, i) => (form.__f[i] && typeof v === "number" ? form.__f[i][v] : v)) };
    return r;
  }
  return undefined;
}
function getJSON(h, key, fallback) {
  try { const v = gdp(h, key); if (typeof v === "string") return JSON.parse(v); } catch {}
  return fallback;
}
const setJSON = (h, key, val) => sdp(h, key, JSON.stringify(val));
// v5.4: dynamic properties are mirrored in memory. Reading one from the game is a slow native call and the brain
// reads hundreds per tick; only this add-on writes them, so the mirror is always right. Unchanged values aren't rewritten.
const DPC = new Map(); // entity id ("@world" for the world) -> Map(key -> value)
const dpMap = (h) => { const id = h === world ? "@world" : h.id; let m = DPC.get(id); if (!m) { m = new Map(); DPC.set(id, m); } return m; };
// v5.6: bookkeeping that only matters while the world runs (stuck checks, pace rolls, heal timers) never touches the
// game's storage at all
const TRANSIENT = new Set(["p_war:firing", "p_war:aiming", "p_war:pose", "war:lp", "war:lpt", "war:pace", "war:pacet", "war:selfheal", "war:stuck", "war:calm", "war:readout", "war:healt", "war:covert"]);
function gdp(h, k) {
  const m = dpMap(h);
  if (m.has(k)) return m.get(k);
  if (TRANSIENT.has(k)) return undefined;
  const v = h.getDynamicProperty(k);
  m.set(k, v);
  return v;
}
function sdp(h, k, v) {
  const m = dpMap(h);
  if (m.has(k) && m.get(k) === v && (v === undefined || typeof v !== "object")) return;
  if (!TRANSIENT.has(k)) h.setDynamicProperty(k, v);
  m.set(k, v && typeof v === "object" ? { ...v } : v);
}
system.runInterval(() => { for (const id of [...DPC.keys()]) if (id !== "@world" && !world.getEntity(id)) DPC.delete(id); }, 1200);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const findPlayer = (id) => (id ? world.getAllPlayers().find((p) => p.id === id) : undefined);
const tick = () => system.currentTick;
const DIMS = ["overworld", "nether", "the_end"];
const allOfCache = new Map(); // type -> { t, list }  (one world search per type per tick)
// v6.3: soldiers picked up with the TP wand (soldier id -> { by: player id }). They are left out of allOf, so nothing
// thinks for them, moves them, aims or shoots with them, or rescues them while they're carried.
const held = new Map();
function allOf(type) {
  const now = system.currentTick, c = allOfCache.get(type);
  if (c && c.t === now) { if (!c.checked) { c.list = c.list.filter((e) => e.isValid); c.checked = true; } return c.list; }
  let out = [];
  for (const d of DIMS) { try { out.push(...world.getDimension(d).getEntities({ type })); } catch {} }
  if (type === SOLDIER && held.size) out = out.filter((e) => !held.has(e.id));
  allOfCache.set(type, { t: now, list: out });
  return out;
}
const rideMemo = new Map(); // id -> { t, v, on }
function rideInfo(e) {
  const now = system.currentTick, c = rideMemo.get(e.id);
  if (c && now - c.t < 5) return c;
  let on;
  try { on = e.getComponent("minecraft:riding")?.entityRidingOn; } catch {}
  const r = { t: now, v: !!on, on: on?.typeId };
  rideMemo.set(e.id, r);
  if (rideMemo.size > 4000) rideMemo.clear();
  return r;
}
const isRiding = (e) => { try { return rideInfo(e).v; } catch { return false; } };
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
const PROPS = ["war:faction", "war:skin", "war:ranged", "war:cav", "war:medic", "war:rally", "war:gun", "war:firing", "war:aiming", "war:down", "war:nest", "war:pose", "war:role"];
const propMemo = new Map(); // "id|key" -> value read from the entity (only this add-on changes them, through setP)
function P(e, key) {
  const v = gdp(e, `p_${key}`);
  if (v !== undefined) return v;
  const mk = `${e.id}|${key}`;
  if (propMemo.has(mk)) return propMemo.get(mk);
  let r; try { r = e.getProperty(key); } catch {}
  propMemo.set(mk, r);
  if (propMemo.size > 20000) propMemo.clear();
  return r;
}
function setP(e, key, val) {
  if (gdp(e, `p_${key}`) === val) return;                       // v5.9: nothing changes: nothing to send
  sdDrop(e);
  propMemo.delete(`${e.id}|${key}`);
  sdp(e, `p_${key}`, val);
  try { e.setProperty(key, val); } catch {}
  const ent = e;
  system.runTimeout(() => { try { if (ent.isValid && gdp(ent, `p_${key}`) === val && ent.getProperty(key) !== val) ent.setProperty(key, val); } catch {} }, 2);   // (re-applied if the game dropped it: just this one)
}
function syncProps(e) {
  if (e.typeId === SOLDIER) syncSkin(e);
  for (const k of PROPS) {
    if (k === "war:skin" && e.typeId === SOLDIER) continue;
    const v = gdp(e, `p_${k}`);
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
const factionOf = (e) => (e.typeId === "minecraft:player" ? playerFaction(e) : gdp(e, "war:surr") ? 0 : Number(P(e, "war:faction") ?? 0));

// ================================================================ soldier data
const sdCache = new Map(); // id -> { t, d }
const sdDrop = (e) => { try { sdCache.delete(e.id); } catch {} };
function sd(e) {
  const c = sdCache.get(e.id), now = system.currentTick;
  if (c && now - c.t <= 2) return c.d;
  const d = sdRead(e);
  sdCache.set(e.id, { t: now, d });
  if (sdCache.size > 3000) sdCache.clear();
  return d;
}
function sdRead(e) {
  return {
    faction: Number(P(e, "war:faction") ?? 0),
    skin: Number(P(e, "war:skin") ?? 0),
    ranged: Boolean(P(e, "war:ranged")),
    weapon: String(gdp(e, "war:weapon") ?? (P(e, "war:ranged") ? "crossbow" : "sword")),
    div: String(gdp(e, "war:div") ?? "foot"),
    func: String(gdp(e, "war:func") ?? "hold"),
    squad: Number(gdp(e, "war:squad") ?? 0),
    radius: Number(gdp(e, "war:radius") ?? 8),
    owner: gdp(e, "war:owner"),
    leader: gdp(e, "war:leader"),
    goal: Number(gdp(e, "war:goal") ?? 0),
    custom: String(gdp(e, "war:custom") ?? ""),
    retreat: Boolean(gdp(e, "war:retreat")),
    surr: Number(gdp(e, "war:surr") ?? 0),
    armor: String(gdp(e, "war:armor") ?? "none"),
  };
}
const snapshot = (e) => {
  const d = sd(e);
  return { faction: d.faction, skin: d.skin, ranged: d.ranged, weapon: d.div === "grenadier" ? String(gdp(e, "war:kit") ?? "grenade") : d.weapon, div: d.div, func: d.func, squad: d.squad, radius: d.radius, custom: d.custom, armor: d.armor };
};

function applyRelations(e) {
  const surr = !!gdp(e, "war:surr");
  const f = Number(P(e, "war:faction") ?? 0);
  for (let i = 1; i <= NF; i++) {
    const wantH = !surr && f > 0 && i !== f && relAt(f, i) === "1";
    if (wantH !== e.hasTag(`war_h${i}`)) wantH ? e.addTag(`war_h${i}`) : e.removeTag(`war_h${i}`);
    const wantF = !surr && i === f;
    if (wantF !== e.hasTag(`war_f${i}`)) wantF ? e.addTag(`war_f${i}`) : e.removeTag(`war_f${i}`);
  }
  sdp(e, "war:relv", relVersion());
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
    if (downed.has(e.id)) txt += " §4(DOWNED - right-click)";
    else if (pows.has(e.id)) txt += " §6(prisoner)";
    else if (d.surr) txt += " §7(surrendered)";
    else if (d.retreat) txt += " §c(falling back)";
    if (e.typeId === SOLDIER) txt += `\n${healthBar(e)}`;
    const ro = String(gdp(e, "war:readout") ?? "");
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
      const SCOPED = { kar98s: "kar98", m1903s: "m1903" };
      const model = item.slice(3), held = SCOPED[model] ? `ww:${SCOPED[model]}` : item;
      e.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${held}`);
      setP(e, "war:gun", GUN_MODELS.indexOf(model) + 1); // the soldier model draws the pack's gun
      return;
    }
    catch {
      sdp(e, "war:weapon", "crossbow");
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
  if (d.div === "grenadier" && gdp(e, "war:throw")) return "air";  // (v6.9.1: grenades / molotovs only, no gun)
  if (GUNS.includes(d.weapon)) return `ww:${gunModel(d.faction, d.weapon)}`;
  if (d.weapon === "spear") return "iron_spear";                  // (no spear in this game version: a trident)
  if (d.ranged) return "crossbow";
  return d.div === "cavalier" ? "air" : "iron_sword"; // the cavalier's lance is part of its model
}

// ================================================================ waypoints & flags
const slotOf = (m) => Number(gdp(m, "war:slot") ?? 0);
const markers = () => [...allOf(WAYPOINT), ...allOf(FLAG)];
let markerIndexT = -1;
function marker(slot) {
  if (!slot) return undefined;
  if (markerIndexT !== tick() && !markerCache.has(slot)) {                 // v5.9: one pass builds the whole index (no scan per lookup)
    markerIndexT = tick();
    for (const m of markers()) { try { const sl = slotOf(m); if (sl && !markerCache.has(sl)) markerCache.set(sl, m); } catch {} }
  }
  if (!markerCache.has(slot)) markerCache.set(slot, markers().find((m) => slotOf(m) === slot));   // (made since the index: look once)
  const m = markerCache.get(slot);
  return m && m.isValid ? m : undefined;
}
function claimSlot(m) {
  const taken = new Set(markers().map(slotOf));
  for (const v of threatSlot.values()) taken.add(v);
  const assign = (i) => { sdp(m, "war:slot", i); tagMarker(m, i); sdp(m, "war:born", Date.now()); markerCache.set(i, m); return i; };
  for (let i = 1; i <= NSLOT; i++) if (!taken.has(i)) return assign(i);
  // all slots taken: recycle the oldest marker nobody uses any more
  const used = usedSlots();
  let old, ob = Infinity;
  for (const w of allOf(WAYPOINT)) {
    if (w.id === m.id) continue;
    const sl = slotOf(w), b = Number(gdp(w, "war:born") ?? 0);
    if (!used.has(sl) && b < ob) { ob = b; old = w; }
  }
  if (old) { const sl = slotOf(old); try { old.remove(); } catch {} return assign(sl); }
  return 0;
}
function makeWaypoint(dim, loc, reuse = true) {
  if (reuse) {
    const near = dim.getEntities({ type: WAYPOINT, location: loc, maxDistance: 2.5, excludeTags: ["war_mine"] })[0];   // never someone's personal marker
    if (near && slotOf(near)) return slotOf(near);
  }
  const m = dim.spawnEntity(WAYPOINT, loc);
  allOfCache.delete(WAYPOINT);                                   // v5.3: the next claim this tick sees this marker too (no shared numbers)
  try { m.addEffect("invisibility", 20000000, { showParticles: false }); } catch {}
  const s = claimSlot(m);
  if (!s) m.remove();
  else { const seen = getJSON(world, "war:slotseen", {}); seen[s] = Date.now(); setJSON(world, "war:slotseen", seen); }
  return s;
}
function setGoal(e, slot) {
  for (const t of e.getTags()) if (t.startsWith("war_go") || t.startsWith("war_gr") || t.startsWith("war_gc")) e.removeTag(t);
  if (slot) { e.addTag(`war_gr${rowOf(slot)}`); e.addTag(`war_gc${colOf(slot)}`); }
  sdp(e, "war:goal", slot);
  try { noteRefs(e); } catch {}
}
const SLOT_KEYS = ["war:goal", "war:home", "war:mwp", "war:chargegoal", "war:ordergoal", "war:catchup", "war:mymk", "war:fmk"];
let slotRefs = null; // soldier id -> [slots] (last known, kept while he's out of range)
function getRefs() { if (!slotRefs) slotRefs = getJSON(world, "war:slotrefs", {}); return slotRefs; }
function noteRefs(e) {
  const r = SLOT_KEYS.map((k) => Number(gdp(e, k) ?? 0)).filter((x) => x > 0);
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
      const born = Number(gdp(m, "war:born") ?? 0);
      if (!used.has(slotOf(m)) && now - born > 30000) m.remove();
    } catch {}
  }
  setJSON(world, "war:slotrefs", getRefs());
}
function nearestFlag(dim, loc, pred, maxD = 300) {
  let best, bd = maxD;
  for (const f of allOf(FLAG)) {
    if (f.dimension.id !== dim.id || Math.abs(f.location.x - loc.x) > maxD || Math.abs(f.location.z - loc.z) > maxD || !pred(f)) continue;
    const d0 = dist(f.location, loc);
    if (d0 < bd) { bd = d0; best = f; }
  }
  return best;
}

// ================================================================ setup
function setupSoldier(e, s, player, { heal = true } = {}) {
  sdDrop(e);
  const div = DIV[s.div] ? s.div : "foot";
  setP(e, "war:faction", s.faction ?? 0);
  let weapon = div === "medic" ? "sword" : (s.weapon && ALL_WEAPONS.some((w) => w[0] === s.weapon) ? s.weapon : (s.ranged ? "crossbow" : "sword"));
  if (div === "grenadier") {                                       // v6.7: Demolition: kit = grenades / molotovs (with a pistol) or a bazooka
    const kit = DEMO.some((k) => k[0] === s.weapon) ? s.weapon : String(gdp(e, "war:kit") ?? "grenade");
    sdp(e, "war:kit", kit); sdp(e, "war:throw", kit === "at" ? undefined : kit);
    weapon = kit === "at" ? "at" : "pistol";
  } else { sdp(e, "war:kit", undefined); sdp(e, "war:throw", undefined); }
  sdp(e, "war:weapon", weapon);
  setP(e, "war:ranged", isRangedW(weapon));
  setP(e, "war:skin", s.skin ?? 0);
  setP(e, "war:cav", div === "cavalier");
  setP(e, "war:medic", div === "medic");
  setP(e, "war:role", setting("bands", true) ? ROLE_OF[div] ?? 0 : 0);
  sdp(e, "war:div", div);
  sdp(e, "war:squad", s.squad ?? 0);
  sdp(e, "war:radius", s.radius ?? 8);
  sdp(e, "war:custom", s.custom ?? "");
  sdp(e, "war:armor", s.armor ?? "none");
  if (div === "guard") sdp(e, "war:owner", s.owner ?? player?.id);
  if (div === "houndmaster") e.addTag("war_hm"); else e.removeTag("war_hm");
  e.triggerEvent(div === "cavalier" ? "war:body_cav" : "war:body_foot");
  if (heal) e.triggerEvent(`war:${DIV[div].hp}`);
  equip(e, weaponItem(e));
  equipArmor(e, s.armor ?? "none");
  applyRelations(e);
  for (const f of WarAPI.hooks.setup) { try { f(e, s); } catch {} }
  if (s.func === "__none") return e;
  const ok = FUNCS[div].some((f) => f[0] === s.func);
  return giveFunction(e, ok ? s.func : FUNCS[div][0][0], player);
}

function replaceSoldier(e) {
  const s = { ...snapshot(e), owner: gdp(e, "war:owner") };
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
  try { sdDrop(e); } catch {}
  travelTo.delete(e.id); climbing.delete(e.id); try { remoteSettled.delete(e.id); combatLock.delete(e.id); } catch {}
  medicTask.delete(e.id); personal.delete(e.id);
  shaken.delete(e.id); sweep.delete(e.id); brain.delete(e.id); reinforcing.delete(e.id); hornCone.delete(e.id);
  const s = perc.get(e.id);
  if (s) { s.threat = undefined; s.searchUntil = 0; s.lastSeen = undefined; s.noise = undefined; s.noiseT = -999; s.alert = "calm"; s.seen.clear(); }
  crossing.delete(e.id); exitSpot.delete(e.id); wetSince.delete(e.id); assist.delete(e.id);
  sdp(e, "war:retreat", false); sdp(e, "war:retreatUntil", 0);
  sdp(e, "war:calm", 0); sdp(e, "war:stuck", 0);
  sdp(e, "war:ordergoal", undefined); sdp(e, "war:catchup", undefined);
}
function giveFunction(e, func, player, goalSlot) {
  sdDrop(e);
  sdp(e, "war:ordergoal", undefined);
  sdp(e, "war:catchup", undefined);
  const d = sd(e);
  sdp(e, "war:func", func);
  sdp(e, "war:retreat", false);
  if (func === "follow" || func === "escort") {
    const leader = func === "escort" ? findPlayer(d.owner) ?? player : player;
    if (leader) { e = retame(e, leader); sdp(e, "war:leader", leader.id); }
    setGoal(e, 0);
  } else if (func === "charge") {
    setGoal(e, goalSlot ?? 0);
    sdp(e, "war:chargegoal", goalSlot ?? 0);
  } else if (func === "squad") {
    let slot = Number(gdp(e, "war:mwp") ?? 0);
    if (!marker(slot)) { slot = makeWaypoint(e.dimension, e.location, false); sdp(e, "war:mwp", slot); }
    setGoal(e, slot);
  } else {
    const slot = goalSlot ?? makeWaypoint(e.dimension, e.location);
    setGoal(e, slot);
    sdp(e, "war:home", slot);
  }
  updateName(e);
  setJSON(e, "war:st", {});
  try { marchMembership(e, Number(gdp(e, "war:goal") ?? 0)); } catch {}
  think(e);
  return e;
}

// ================================================================ surrender
function surrender(e, captor) {
  try { sdDrop(e); } catch {}
  const d = sd(e);
  if (d.surr) return;
  callout(e, "Don't shoot!");                                    // (v6.6)
  sdp(e, "war:prevfunc", d.func);
  sdp(e, "war:surr", captor);
  const slot = makeWaypoint(e.dimension, e.location);
  setGoal(e, slot);
  sdp(e, "war:home", slot);
  equip(e, "air");
  applyRelations(e);
  setGroups(e, { w: "w_none", t: "t_off", g: "g_post", s: "s_1", d: "d_off", r: "r_off" });
}
function resume(e) {
  try { sdDrop(e); } catch {}
  if (!gdp(e, "war:surr")) return;
  sdp(e, "war:surr", 0);
  equip(e, weaponItem(e));
  applyRelations(e);
  const prev = String(gdp(e, "war:prevfunc") ?? "hold");
  const d = sd(e);
  giveFunction(e, prev === "follow" || prev === "escort" ? prev : prev === "charge" ? "hold" : prev, findPlayer(d.leader));
}

// ================================================================ the brain
function speedGroup(e, urgent) {
  const until = Number(gdp(e, "war:pacet") ?? 0), was = gdp(e, "war:pace");
  const mode = urgent ? "u" : "w";
  if (typeof was === "string" && was.startsWith(mode) && tick() < until) return was.slice(1);
  const g = speedGroupRoll(e, urgent);
  sdp(e, "war:pace", mode + g);
  sdp(e, "war:pacet", tick() + 160 + Math.floor(Math.random() * 80));
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
  sdDrop(e);
  if (!downed.has(e.id) && gdp(e, "war:downed") !== undefined) downed.set(e.id, tick() + 300);   // still down after a reload
  if (downed.has(e.id)) { setGroups(e, { w: "w_none", t: "t_off", g: "g_none", s: "s_1", d: "d_off", r: "r_off" }); return; }
  if (!pows.has(e.id) && gdp(e, "war:pow") !== undefined) { try { pows.set(e.id, JSON.parse(String(gdp(e, "war:pow")))); } catch {} }
  if (!ridingNest(e) && (P(e, "war:nest") || gdp(e, "war:gunSaved"))) { setP(e, "war:nest", false); sdp(e, "war:gunSaved", undefined); if (!pows.has(e.id)) equip(e, weaponItem(e)); }
  if (pows.has(e.id) && Number(P(e, "war:gun") ?? 0) !== 0) { setP(e, "war:gun", 0); equip(e, "air"); }   // stays disarmed
  if (pows.has(e.id)) { const pm = powMove(e, tick()); if (pm) { if (pm.slot !== undefined) setGoal(e, pm.g === "g_wp" ? pm.slot : 0); setGroups(e, { w: pm.w, t: pm.t, g: pm.g, s: pm.s, d: pm.d, r: pm.r }); } return; }
  const d = sd(e);
  const now = tick();
  // while engaging, the order's own goal is parked in war:ordergoal
  const parked = gdp(e, "war:ordergoal");
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
  const lastHurt = Number(gdp(e, "war:hurt") ?? -9999);
  const alert = (alertUntil.get(e.id) ?? -9999) > now;
  const fighting = now - lastHurt < 80;

  // ---- morale
  let foes = 0, friends = 0;
  for (const c of nearSnap(e.dimension.id, e.location, 12)) {               // (v5.9: factions from the shared snapshot)
    if (c.id === e.id || c.down || (c.type !== SOLDIER && c.type !== "minecraft:player" && c.type !== HOUND)) continue;
    if (isHostile(d.faction, c.f)) foes++;
    else if (isFriendly(d.faction, c.f)) friends++;
  }
  let retreat = d.retreat;
  const canRetreat = !riding && (d.div !== "garrison" || d.func === "patrol");
  if (!retreat && canRetreat && (hpr < 0.3 || (hpr < 0.6 && foes >= friends * 2 + 3))) {
    retreat = true;
    sdp(e, "war:retreat", true);
    if (gdp(e, "war:ordergoal") !== undefined) { setGoal(e, Number(gdp(e, "war:ordergoal"))); sdp(e, "war:ordergoal", undefined); }
    updateName(e);
  } else if (retreat && hpr > 0.75 && foes <= friends + 1 && now > Number(gdp(e, "war:retreatUntil") ?? 0) &&
             (hpr >= 0.95 || !nearestFlag(e.dimension, e.location, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 128))) {
    retreat = false;
    sdp(e, "war:retreat", false);
    const home = Number(gdp(e, "war:home") ?? 0);
    if (ANCHORED.includes(d.func)) setGoal(e, home);
    else if (d.func === "squad") setGoal(e, Number(gdp(e, "war:mwp") ?? 0));
    else if (d.func === "charge") setGoal(e, Number(gdp(e, "war:chargegoal") ?? 0)); // rejoin the charge
    else setGoal(e, 0);
    d.goal = Number(gdp(e, "war:goal") ?? 0);
    updateName(e);
  }
  if (hp && hpr < 1 && now - lastHurt > 200) {
    const rf = nearestFlag(e.dimension, e.location, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 8);
    let heal = 0;
    if (rf) heal = 2;                                              // at a rally point: real healing
    else if (now - Number(gdp(e, "war:selfheal") ?? -9999) > 340) { heal = 1; sdp(e, "war:selfheal", now); } // alone: ~1 HP per 17 s
    if (heal) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + heal));
  }

  // ---- weapon
  let weapon = GUNS.includes(d.weapon) ? `w_${d.weapon}` : d.weapon === "spear" && d.div !== "cavalier" ? "w_spear" : d.ranged ? "w_ranged" : d.div === "cavalier" ? "w_lance" : "w_melee";
  // v6.7: Demolition (and any older molotov soldier): throws now and then, fights with his pistol / sword between throws
  if (d.div === "grenadier" && !gdp(e, "war:kit")) { setupSoldier(e, { ...snapshot(e), weapon: "grenade", func: "__none" }, undefined, { heal: false }); return; }   // an old snowball grenadier: re-kitted once
  const thr = gdp(e, "war:throw") ?? (d.weapon === "molotov" ? "molotov" : undefined);
  if (thr === "grenade") grenade(e, d, now); else if (thr === "molotov") molotov(e, d, now);
  if (d.div === "medic") weapon = "w_keepaway";
  if (d.div === "medic") medic(e, d, now);

  const pat = `g_pat${d.radius <= 5 ? 4 : d.radius <= 10 ? 8 : 14}`;
  const melee = weapon === "w_melee" || weapon === "w_lance" || weapon === "w_spear";
  let want;
  if (retreat) {
    const rally = nearestFlag(e.dimension, e.location, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 128);
    // falling back along a real route to the rally flag (not a straight line Minecraft has to work out)
    const mv = rally ? travel(e, rally.location, "rally", now, true) : undefined;
    const slot = mv?.slot ?? (rally ? slotOf(rally) : Number(gdp(e, "war:home") ?? 0));
    if (slot !== d.goal) setGoal(e, slot);
    want = { w: weapon, t: "t_off", g: mv ? mv.g : slot ? "g_wp" : "g_flee", s: speedGroup(e, true), d: "d_off", r: "r_off" }; // no fighting back while falling back
  } else {
    const anchor = ["hold", "post", "sentry", "stand"].includes(d.func) ? marker(d.goal) : undefined;
    const cu = d.func === "charge" ? gdp(e, "war:catchup") : undefined;
    const bLeash = d.func === "post" ? 2 : d.func === "sentry" ? d.radius + 4 : d.func === "hold" ? (freeOf(e) ? aoOf(e) : 18) : 6;
    const wet = inWater(e);
    // v5.6: a fresh order is obeyed at once: for ~5 s after it nothing stops him to fight (he still shoots on the move)
    const fresh = now - Number(gdp(e, "war:ordt") ?? -99999) < 100 && (["charge", "follow", "patrol"].includes(d.func) || (anchor && dist(anchor.location, e.location) > 6));
    const fight = !fresh && !wet;
    const engaged = medicMove(e, d, now) ?? shakenMove(e, d, now) ?? waterExit(e, d, now) ?? (fresh || wet ? undefined : reflexMove(e, d, now, anchor, bLeash)) ?? extDecide("first", e, d, now) ?? (personal.has(e.id) ? followPersonal(e, now) : undefined) ?? spreadMove(e, now) ?? (fight ? combatMove(e, d, now, melee, anchor, bLeash) : undefined) ?? (fight ? engagement(e, d, now, d.goal, melee) : undefined) ?? (fresh ? undefined : reinforceMove(e, d, now)) ??
      (cu !== undefined && marker(Number(cu)) ? (note(e, formMode.has(e.id) ? "marching" : "catching up"), { g: "g_wp", slot: Number(cu), t: "t_mid", urgent: true }) : undefined) ??
      patrolSweep(e, d, now) ?? followLeader(e, d, now) ?? extDecide("last", e, d, now);
    // how far each stationary order may leave its spot to fight: post barely, hold to meet a charge, sentry its whole radius
    const leash = d.func === "post" ? (melee ? 4 : 2) : d.func === "sentry" ? d.radius + 4 : d.func === "hold" ? (freeOf(e) ? aoOf(e) : 18) : (freeOf(e) && d.func === "stand" ? 12 : 4);
    if (anchor && !riding && dist(e.location, anchor.location) > leash + 2 && Number(gdp(e, "war:calm") ?? 0) <= now) {
      sdp(e, "war:calm", now + 60); // chased too far: walk back to the line
    }
    const calm = Number(gdp(e, "war:calm") ?? 0) > now;
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
        const mm = laneOf.has(d.goal) ? getMarches()[laneOf.get(d.goal)] : undefined;
        const waitRoute = !!mm && !mm.path && !mm.early && !mm.final;          // v5.4: the lanes aren't placed yet (indoors): wait where he is, don't all walk to one spot
        want = { w: weapon, t: "t_mid", g: m && !waitRoute ? "g_wp" : "g_none", s: speedGroup(e, true), d: "d_off" };
        break;
      }
      default: want = { w: weapon, t: "t_mid", g: "g_wp", s: walk, d: "d_off" };
    }
    want.r = d.div === "medic" ? "r_off" : "r_on";
    // contact rule: units on the move engage what they see, and react to what they hear or what the squad reports
    // (contact is handled by perception/engagement below)
    if (d.weapon === "at") want.t = "t_at";                                        // anti-tank: only enemy-crewed vehicles
    else if (["rifle", "mg"].includes(d.weapon) && want.t === "t_mid") want.t = "t_far"; // long guns see farther
    if (d.div === "medic") want.t = "t_off";
    if (calm) { want.w = "w_none"; want.t = "t_off"; }
    // ---- perception overrides the order while there's something to deal with; then the order resumes
    if (engaged && !calm) {
      if (gdp(e, "war:ordergoal") === undefined) sdp(e, "war:ordergoal", d.goal);
      setGoal(e, engaged.slot ?? 0);
      sdp(e, "war:ordergoal", d.goal);
      want.g = engaged.g;
      if (want.t !== "t_at") want.t = engaged.t;
      want.s = engaged.slow ? "s_1" : speedGroup(e, engaged.urgent);
    } else if (gdp(e, "war:ordergoal") !== undefined) {
      setGoal(e, Number(gdp(e, "war:ordergoal")));  // back to the order
      sdp(e, "war:ordergoal", undefined);
    }
    // v5.4: gunners are aimed, fired and moved by the script alone. Vanilla targeting would walk them at the enemy on
    // its own (straight at a building, off the route) and override their orders: it stays off for them.
    if (GUNS.includes(d.weapon)) { want.t = "t_off"; want.r = "r_off"; }
    // a gunner with an enemy right on top of him fights hand-to-hand, then goes back to shooting
    if (GUNS.includes(d.weapon) && d.weapon !== "at" && !calm && closeEnemy(e, d, 2.5)) { want.w = "w_melee"; want.t = "t_short"; want.r = "r_on"; }
  }
  for (const f of WarAPI.hooks.think) { try { f(e, d, want, now); } catch {} }   // extensions may adjust the decision
  // v6.2: standing on a bridge / ledge / wall-top edge and not being carried along a route: Minecraft's own walking is
  // never in charge there (it cuts corners off the side). He stands; the route driver carries him when he moves.
  if (!riding && want.g === "g_wp" && !gliders.has(e.id) && !climbing.has(e.id) && onPassage(e)) want.g = "g_none";
  setGroups(e, want);
  if (!riding) unstick(e, d, fighting);
}

function closeEnemy(e, d, r) {
  for (const c of nearSnap(e.dimension.id, e.location, r)) {           // (v5.9: factions from the shared snapshot)
    if (c.id !== e.id && c.f && (c.type === SOLDIER || c.type === HOUND || c.type === "minecraft:player") && isHostile(d.faction, c.f) && c.e.isValid) return c.e;
  }
  return undefined;
}

// Medic waypoint drifts to the centre of its squad (or nearby allies).
function medicAnchor(e, d) {
  const m = marker(Number(gdp(e, "war:mwp") ?? 0));
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
  if (Number(gdp(e, "war:healt") ?? 0) > now) return;
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
  sdp(e, "war:healt", now + 60);
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
// (v6.7: the snowball grenadier is gone: the Demolition unit throws real grenades / molotovs, or fires a bazooka)

// ================================================================ v6.6: molotovs
// A molotov soldier fights with a sword and now and then lobs a firebomb at an enemy 5-18 blocks away: 3 carried, 15 s
// between throws, one back every 90 s. Where it lands, a 2.5-block patch burns for 6 s: anyone standing in it catches
// fire (friend or foe, so he never throws where a friend stands nearby). No blocks are touched (nothing is set alight,
// nothing breaks). Soldiers caught in a burning patch get out of it.
const MOLO = { max: 5, cd: 120, rMin: 7, rMax: 24, refill: 400, radius: 4, life: 180, burn: 5, squadGap: 50 };   // (v6.9.1: a 4-block patch for 9 s, thrown far more often)
const squadMolo = new Map(); // squad -> next tick one of them may throw (v6.6: one bottle at a time, not a volley)
const fires = []; // { dim, at, until, f }
// v6.9.1: a thrower has no gun: an enemy closing in (inside ~8 blocks) and he backs off to throwing distance first
const kiteT = new Map();
function throwerKite(e, d, now) {
  if (now - (kiteT.get(e.id) ?? -99) < 30 || held.has(e.id) || climbing.has(e.id) || isRiding(e)) return false;
  let foe;
  for (const c of nearSnap(e.dimension.id, e.location, 8)) if (!c.down && c.f && c.id !== e.id && isHostile(d.faction, c.f) && (!foe || c.dd < foe.dd)) foe = c;
  if (!foe) return false;
  kiteT.set(e.id, now);
  const l = e.location, dx = l.x - foe.x, dz = l.z - foe.z, L = Math.hypot(dx, dz) || 1;
  for (const side of [0, 0.6, -0.6]) {
    const ax = dx / L + (-dz / L) * side, az = dz / L + (dx / L) * side, aL = Math.hypot(ax, az);
    const out = walkableNear(e.dimension, l.x + (ax / aL) * 9, l.z + (az / aL) * 9, l.y);
    if (out && Math.abs(out.y - l.y) <= 2 && !dangerNear(e.dimension, out)) { planPersonalTo(e, "settle", out, now); note(e, "backing off to throw"); return true; }
  }
  return false;
}
function molotov(e, d, now) {
  if (downed.has(e.id) || d.surr) return;
  if (throwerKite(e, d, now)) return;
  let n = Number(gdp(e, "war:molo") ?? MOLO.max);
  if (n < MOLO.max && now - Number(gdp(e, "war:molor") ?? now) > MOLO.refill) { n++; sdp(e, "war:molo", n); sdp(e, "war:molor", n < MOLO.max ? now : undefined); }
  if (n <= 0 || Number(gdp(e, "war:molot") ?? 0) > now) return;
  const sq = `${d.faction}:${d.squad}`;
  if (now < (squadMolo.get(sq) ?? 0)) return;
  // the best target in reach: the enemy with the most enemies packed around him (a bottle on a crowd)
  let t, bs = -1e9;
  for (const c of nearSnap(e.dimension.id, e.location, MOLO.rMax)) {
    if (c.down || !c.f || !isHostile(d.faction, c.f) || !c.e.isValid || downed.has(c.id) || c.dd < MOLO.rMin) continue;
    let pack = 0; for (const q of nearSnap(e.dimension.id, c, MOLO.radius + 0.5)) if (!q.down && q.f && isHostile(d.faction, q.f)) pack++;
    const sc = pack * 3 - c.dd * 0.1;
    if (sc > bs) { bs = sc; t = c.e; }
  }
  if (!t?.isValid) return;
  const dd = dist(t.location, e.location);
  if (dd < MOLO.rMin || dd > MOLO.rMax || Math.abs(t.location.y - e.location.y) > 6) return;
  if (!clearShot(e.dimension, headLoc(e), { x: t.location.x, y: t.location.y + 1.6, z: t.location.z })) return;   // he must see where he throws
  if (nearSnap(t.dimension.id, t.location, MOLO.radius + 3).some((c) => !c.down && (c.type === SOLDIER || c.type === "minecraft:player" || c.type === HOUND) && c.f && isFriendly(d.faction, c.f))) return;   // never on (or near) a friend
  turnTo(e, t.location, 180);                                    // (v6.9.2: facing the throw)
  sdp(e, "war:molo", n - 1); sdp(e, "war:molot", now + MOLO.cd); squadMolo.set(sq, now + MOLO.squadGap);
  if (!gdp(e, "war:molor")) sdp(e, "war:molor", now);
  callout(e, "Grenade!");
  const err = Math.min(2, dd / 10);                              // a lob isn't a rifle shot
  const at = { x: t.location.x + (Math.random() - 0.5) * err * 2, y: t.location.y, z: t.location.z + (Math.random() - 0.5) * err * 2 };
  throwMolotov(e, at, dd);
}
function throwMolotov(e, at, dd) {
  const dim = e.dimension, from = headLoc(e), T = Math.round(12 + dd * 0.9), f = Number(P(e, "war:faction") ?? 0);
  const g = walkableNear(dim, at.x, at.z, at.y) ?? at;            // lands on the ground there
  try { dim.playSound("random.bow", from, { volume: 0.6, pitch: 0.7 }); } catch {}
  for (let k = 1; k <= T; k += 2) system.runTimeout(() => {      // the bottle's arc (a trail of flame)
    try { const u = k / T, h = Math.max(3, dd * 0.35); dim.spawnParticle("minecraft:basic_flame_particle", { x: from.x + (g.x - from.x) * u, y: from.y + (g.y + 0.3 - from.y) * u + 4 * h * u * (1 - u), z: from.z + (g.z - from.z) * u }); } catch {}
  }, k);
  system.runTimeout(() => {
    try { dim.playSound("random.glass", g, { volume: 1.0, pitch: 0.9 }); dim.playSound("mob.ghast.fireball", g, { volume: 0.5, pitch: 1.3 }); } catch {}
    fires.push({ dim, at: { x: g.x, y: g.y, z: g.z }, until: tick() + MOLO.life, f });
  }, T);
}
system.runInterval(() => {
  const now = tick();
  for (let i = fires.length - 1; i >= 0; i--) {
    const F = fires[i];
    if (now >= F.until) { fires.splice(i, 1); continue; }
    try {
      for (let k = 0; k < 14; k++) {                              // flames over the patch
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * MOLO.radius;
        F.dim.spawnParticle(k % 3 ? "minecraft:basic_flame_particle" : "minecraft:large_smoke_particle", { x: F.at.x + Math.cos(a) * r, y: F.at.y + 0.15, z: F.at.z + Math.sin(a) * r });
      }
      for (const o of F.dim.getEntities({ location: F.at, maxDistance: MOLO.radius + 0.6 })) {
        if (o.typeId === "minecraft:item" || o.typeId === WAYPOINT || o.typeId === FLAG || VEHICLES.includes(o.typeId) || Math.abs(o.location.y - F.at.y) > 1.6) continue;
        if (o.typeId === "minecraft:player") { try { if (!playerFair(o)) continue; } catch {} }
        try { o.setOnFire(MOLO.burn, true); } catch {}
        if (o.typeId === SOLDIER && !downed.has(o.id) && !held.has(o.id) && now - Number(fleeFire.get(o.id) ?? -99) > 20) {   // out of the fire
          fleeFire.set(o.id, now);
          const l = o.location, dx = l.x - F.at.x, dz = l.z - F.at.z, L = Math.hypot(dx, dz) || 1;
          const out = walkableNear(o.dimension, F.at.x + (dx / L) * (MOLO.radius + 2), F.at.z + (dz / L) * (MOLO.radius + 2), l.y);
          if (out && !dangerNear(o.dimension, out)) { planPersonalTo(o, "settle", out, now); note(o, "getting out of the fire"); }
        }
      }
    } catch {}
  }
}, 10);
const fleeFire = new Map();

// ================================================================ v6.7: grenades (the Demolition unit's "Grenades" kit)
// Lobbed at a group of enemies 8-22 blocks away (3 carried, 12 s between throws, one back every 90 s, one per squad every
// 4 s, never where a friend stands within 5 of the target). It lands, fizzes ~1.5 s (anyone close by scrambles away),
// then goes off: a real explosion that hurts and knocks people about (off a wall, too) but never breaks blocks.
const NADE = { max: 6, cd: 100, rMin: 7, rMax: 24, refill: 300, fuse: 30, power: 3.0, safe: 6, squadGap: 40 };   // (v6.9.1: a thrower's only weapon: more of them, more often, a bigger blast)
const THROW_RANGE = 20;
const squadNade = new Map();
const liveNades = []; // { dim, at, boom, by }
function grenade(e, d, now) {
  if (downed.has(e.id) || d.surr) return;
  if (throwerKite(e, d, now)) return;
  let n = Number(gdp(e, "war:nade") ?? NADE.max);
  if (n < NADE.max && now - Number(gdp(e, "war:nader") ?? now) > NADE.refill) { n++; sdp(e, "war:nade", n); sdp(e, "war:nader", n < NADE.max ? now : undefined); }
  if (n <= 0 || Number(gdp(e, "war:nadet") ?? 0) > now) return;
  const sq = `${d.faction}:${d.squad}`;
  if (now < (squadNade.get(sq) ?? 0)) return;
  let t, bs = -1e9;
  for (const c of nearSnap(e.dimension.id, e.location, NADE.rMax)) {
    if (c.down || !c.f || !isHostile(d.faction, c.f) || !c.e.isValid || downed.has(c.id) || c.dd < NADE.rMin) continue;
    let pack = 0; for (const q of nearSnap(e.dimension.id, c, 3.5)) if (!q.down && q.f && isHostile(d.faction, q.f)) pack++;
    const sc = pack * 3 - c.dd * 0.1;
    if (sc > bs) { bs = sc; t = c.e; }
  }
  if (!t?.isValid || Math.abs(t.location.y - e.location.y) > 8) return;
  if (!clearShot(e.dimension, headLoc(e), { x: t.location.x, y: t.location.y + 1.6, z: t.location.z })) return;
  if (nearSnap(t.dimension.id, t.location, NADE.safe).some((c) => !c.down && (c.type === SOLDIER || c.type === "minecraft:player" || c.type === HOUND) && c.f && isFriendly(d.faction, c.f))) return;
  turnTo(e, t.location, 180);                                    // (v6.9.2: he faces where he throws: it went out of his back)
  sdp(e, "war:nade", n - 1); sdp(e, "war:nadet", now + NADE.cd); squadNade.set(sq, now + NADE.squadGap);
  if (!gdp(e, "war:nader")) sdp(e, "war:nader", now);
  callout(e, "Grenade!");
  const dd = dist(t.location, e.location), err = Math.min(2.5, dd / 9);
  const at = { x: t.location.x + (Math.random() - 0.5) * err * 2, y: t.location.y, z: t.location.z + (Math.random() - 0.5) * err * 2 };
  const dim = e.dimension, from = headLoc(e), T = Math.round(12 + dd * 0.9), g = walkableNear(dim, at.x, at.z, at.y) ?? at, by = e;
  try { dim.playSound("random.bow", from, { volume: 0.6, pitch: 0.6 }); } catch {}
  for (let k = 1; k <= T; k += 2) system.runTimeout(() => {
    try { const u = k / T, h = Math.max(3, dd * 0.35); dim.spawnParticle("minecraft:basic_smoke_particle", { x: from.x + (g.x - from.x) * u, y: from.y + (g.y + 0.3 - from.y) * u + 4 * h * u * (1 - u), z: from.z + (g.z - from.z) * u }); } catch {}
  }, k);
  system.runTimeout(() => {
    try { dim.playSound("random.fuse", g, { volume: 0.8, pitch: 1.4 }); } catch {}
    liveNades.push({ dim, at: { x: g.x, y: g.y, z: g.z }, boom: tick() + NADE.fuse, by });
    try { const w = nearSnap(dim.id, g, 7).find((c) => c.type === SOLDIER && !c.down && c.id !== by?.id && c.e.isValid); if (w) callout(w.e, "Grenade!"); } catch {}   // (v6.8: the warning)
  }, T);
}
system.runInterval(() => {
  const now = tick();
  for (let i = liveNades.length - 1; i >= 0; i--) {
    const G = liveNades[i];
    try {
      if (now >= G.boom) {
        liveNades.splice(i, 1);
        const o = { breaksBlocks: false, causesFire: false };
        if (G.by?.isValid) o.source = G.by;
        G.dim.createExplosion(G.at, NADE.power, o);
        continue;
      }
      G.dim.spawnParticle("minecraft:basic_smoke_particle", { x: G.at.x, y: G.at.y + 0.2, z: G.at.z });
      for (const c of nearSnap(G.dim.id, G.at, 4.5)) {               // a live grenade at his feet: get away from it
        if (c.type !== SOLDIER || c.down || held.has(c.id) || !c.e.isValid || now - Number(fleeFire.get(c.id) ?? -99) < 15) continue;
        fleeFire.set(c.id, now);
        const l = c.e.location, dx = l.x - G.at.x, dz = l.z - G.at.z, L = Math.hypot(dx, dz) || 1;
        const out = walkableNear(c.e.dimension, G.at.x + (dx / L) * 6, G.at.z + (dz / L) * 6, l.y);
        if (out && !dangerNear(c.e.dimension, out)) { planPersonalTo(c.e, "settle", out, now); note(c.e, "getting away from a grenade"); }
      }
    } catch { liveNades.splice(i, 1); }
  }
}, 5);

// Stuck detection + catch-up teleports (works across dimensions for leaders).
function unstick(e, d, fighting) {
  const now = tick();
  let goalLoc, stop = 3;
  if ((d.func === "follow" || d.func === "escort") && d.leader) {
    const p = findPlayer(d.leader);
    if (p) {
      if (isRiding(p)) return; // leader in a vehicle: swim after / wait
      if (p.dimension.id !== e.dimension.id || dist(p.location, e.location) > 64) { tpNear(e, p.location, p.dimension); return; }   // (another dimension / far behind only)
      goalLoc = p.location;
    }
  } else {
    const m = marker(Number(gdp(e, "war:goal") ?? 0));
    if (m) { goalLoc = m.location; stop = d.func === "patrol" ? d.radius + 2 : 4; }
  }
  if (!goalLoc || fighting) return;
  const far = flat(goalLoc, e.location);
  if (far <= stop + 2) return;
  const dim = e.dimension, p0 = e.location;
  const hx = (goalLoc.x - p0.x) / (far || 1), hz = (goalLoc.z - p0.z) / (far || 1);
  const onRoute = routeOf(e);                                     // v5.3: the route already decided every step, drop and climb
  if (climbing.has(e.id)) return;
  // ---- fall awareness first: is the way forward a drop?
  if (now % 20 < 10 && !onRoute) { try { if (descend(e, goalLoc)) return; } catch {} }
  // ---- climb assist (every second): step up, boost over 2-high walls, hop small gaps (off-route only)
  if (now % 20 < 10 && !onRoute) {
    const ax = p0.x + hx * 0.9, az = p0.z + hz * 0.9, y = Math.floor(p0.y);
    const at = (dy) => { try { const b = tBlock(dim, ax, y + dy, az); return !!b && !b.isAir && !b.isLiquid; } catch { return false; } };
    if (at(0) && !at(1) && !at(2)) {                      // 1-block step
      push(e, { x: hx * 0.15, y: 0.42, z: hz * 0.15 }, 2);
    } else if (at(0) && at(1) && !at(2) && !at(3)) {      // 2-high wall: boost onto it
      const top = { x: Math.floor(ax) + 0.5, y: y + 2, z: Math.floor(az) + 0.5 };
      if (standable(dim, top) && goalLoc.y >= top.y - 0.5 && !dangerNear(dim, top)) { try { e.teleport(top); } catch {} }   // (v6.1: only when his goal is up there, never onto a battlement over a drop / lava)
    } else if (!at(-1) && !at(-2)) {                      // hole ahead: hop it if there's ground beyond
      const bx = p0.x + hx * 2, bz = p0.z + hz * 2;
      if (standable(dim, { x: Math.floor(bx) + 0.5, y, z: Math.floor(bz) + 0.5 })) push(e, { x: hx * 0.55, y: 0.32, z: hz * 0.55 }, 2);
    }
  }
  // ---- stuck recovery (every 5 s): side-step, then back off, then a short teleport as last resort
  const lpt = Number(gdp(e, "war:lpt") ?? 0);
  if (now - lpt < 100) return;
  const lp = gdp(e, "war:lp");
  const moved = lp && typeof lp === "object" ? dist(lp, p0) : 99;
  sdp(e, "war:lp", { x: p0.x, y: p0.y, z: p0.z });
  sdp(e, "war:lpt", now);
  let stage = Number(gdp(e, "war:stuck") ?? 0);
  if (moved >= 1) { if (stage) sdp(e, "war:stuck", 0); return; }
  stage++;
  if (stage >= 2 && personal.has(e.id) && !personal.get(e.id).planning) { personal.delete(e.id); travelTo.delete(e.id); rTrack.delete(e.id); sdp(e, "war:stuck", 0); return; }   // his route didn't work from here: plan again
  if (stage >= 2 && isIndoors(e) && !personal.has(e.id)) { planPersonal(e, "exit", outsideGoal, now); sdp(e, "war:stuck", 0); return; }
  if (stage >= 2 && canBuild(e, now) && (breakSoft(e, goalLoc, now) || placeStep(e, goalLoc, now))) { sdp(e, "war:stuck", 0); return; }
  sdp(e, "war:stuck", stage);
  const side = e.id.charCodeAt(e.id.length - 1) % 2 ? 1 : -1;
  try {
    if (stage === 1) push(e, { x: -hz * side * 0.6, y: 0.2, z: hx * side * 0.6 }, 2);
    else if (stage === 2) push(e, { x: -hx * 0.7 - hz * side * 0.3, y: 0.2, z: -hz * 0.7 + hx * side * 0.3 }, 2);
    else {
      // v5.8: no more teleporting out of trouble (it put men on top of walls): he works out a real route to his goal
      // from where he stands (ladders, stairs, doors), and the glider / climber walk it
      if (!personal.has(e.id)) { planPersonalTo(e, "settle", { x: goalLoc.x, y: goalLoc.y, z: goalLoc.z }, now); note(e, "finding a way"); }
      sdp(e, "war:stuck", 0);
    }
  } catch {}
}
function standable(dim, loc) {
  try {
    const feet = tBlock(dim, loc.x, loc.y, loc.z), head = tBlock(dim, loc.x, loc.y + 1, loc.z), floor = tBlock(dim, loc.x, loc.y - 1, loc.z);   // (terrain memory)
    return feet?.isAir && head?.isAir && floor && !floor.isAir && !floor.isLiquid;
  } catch { return false; }
}
function tpNear(e, loc, dim, sameLevel = false) {
  const base = { x: Math.floor(loc.x) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z) + 0.5 };
  for (const dy of sameLevel ? [0, 1, -1] : [0, 1, -1, 2, -2, 3])
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
        const h = headLoc(owner), v = owner.getViewDirection();
        owner.dimension.spawnParticle("ww:flash", { x: h.x + v.x * 1.3, y: h.y - 0.25 + v.y * 1.3, z: h.z + v.z * 1.3 });
      } catch {}
    } catch {}
  });
});

// ================================================================ main loops
let phase = 0;
const propSync = new Map(); // id -> tick his entity properties were last re-applied
// v5.9: thinking is a rotation with a fixed budget per tick: up to ~480 soldiers each think every second; beyond that each
// thinks a little less often, but the work per tick never grows (no lag spikes in 200 v 200). Soldiers in the
// background (far from every player, not fighting, not moving, not just ordered) think every third turn.
const THINK_MAX = 24;
let thinkCursor = 0, thinkAcc = 0;
const thinkPass = new Map(), g2Done = new Set();
system.runInterval(() => {
  if (tick() % 10 === 0) markerCache = new Map();
  const list = allOf(SOLDIER), n = list.length;
  if (!n) return;
  const v = relVersion(), now = tick();
  thinkAcc = Math.min(THINK_MAX, thinkAcc + n / 20);                  // (each soldier once per 20 ticks, not more often: re-deciding too often made squads flip-flop)
  const per = Math.min(n, Math.floor(thinkAcc));
  thinkAcc -= per;
  for (let k = 0; k < per; k++) {
    const e = list[(thinkCursor + k) % n];
    try {
      if (!e.isValid) continue;
      if (gdp(e, "war:div") === undefined) { setupSoldier(e, { faction: 0, div: "foot", func: "hold" }, undefined); continue; }
      if (!propSync.has(e.id)) freshSeen(e);                               // v6.0: first time this session
      if (now - (propSync.get(e.id) ?? -9999) > 200) { propSync.set(e.id, now); syncProps(e); }
      // old one-number goal tags (v4.2.1 and earlier): re-tag with the two-part scheme
      if (!g2Done.has(e.id)) { g2Done.add(e.id); if (!e.hasTag("war_g2")) { setGoal(e, Number(gdp(e, "war:goal") ?? 0)); e.addTag("war_g2"); } }
      // soldiers armed before guns were drawn on the model: re-arm once
      if (gdp(e, "p_war:gun") === undefined && GUNS.includes(String(gdp(e, "war:weapon") ?? ""))) equip(e, weaponItem(e));
      if (gdp(e, "war:relv") !== v) applyRelations(e);
      const pass = (thinkPass.get(e.id) ?? 0) + 1; thinkPass.set(e.id, pass);
      if (!isHot(e, now) && pass % 3) continue;
      think(e);
    } catch (err) { oops("think", err); }
  }
  thinkCursor = (thinkCursor + per) % n;
  if (now % 1200 === 0) { for (const id of [...thinkPass.keys()]) if (!world.getEntity(id)) { thinkPass.delete(id); g2Done.delete(id); hotMemo.delete(id); } }
}, 1);
// v6.0: the moment-to-moment look (pose, aiming, firing) isn't saved with the world, but the game keeps the entity's
// last values: after a reload a soldier could stay kneeling / prone / aiming forever. Reset once per session; guards
// made before v6.0 get their new health.
function freshSeen(e) {
  for (const [k, v] of [["war:pose", 0], ["war:firing", false], ["war:aiming", false]]) { try { if (e.getProperty(k) !== v) e.setProperty(k, v); } catch {} sdp(e, `p_${k}`, v); propMemo.delete(`${e.id}|${k}`); }
  poseOf.delete(e.id);
  try { if (gdp(e, "war:div") === "guard") { const h = e.getComponent("minecraft:health"); if (h && h.effectiveMax < 40) e.triggerEvent("war:hp_60"); } } catch {}
  try { setP(e, "war:role", roleFor(e)); } catch {}
}
// "hot": fighting, moving, near a player, just ordered or hurt; worked out at most every second per soldier
const hotMemo = new Map();
function isHot(e, now) {
  const c = hotMemo.get(e.id);
  if (c && now - c.t < 20) return c.v;
  let v = false;
  try {
    const d = sd(e);
    v = !!perc.get(e.id)?.threat || personal.has(e.id) || gliders.has(e.id) || climbing.has(e.id) || ["charge", "follow", "escort", "patrol"].includes(d.func) || d.retreat ||
      now - Number(gdp(e, "war:ordt") ?? -99999) < 200 || now - Number(gdp(e, "war:hurt") ?? -99999) < 200 || !!squads.get(squadKey(e, d))?.known?.size;
    if (!v) { const mid = laneOf.get(Number(gdp(e, "war:ordergoal") ?? gdp(e, "war:goal") ?? 0)); const m = mid ? getMarches()[mid] : undefined; if (m && !m.final) v = true; }   // marching
    if (!v) { for (const c of nearSnap(e.dimension.id, e.location, 80)) if (!c.down && c.f && isHostile(d.faction, c.f)) { v = true; break; } }   // an enemy anywhere near
    if (!v) { const l = e.location; for (const p of world.getAllPlayers()) { const pl = p.location; if (Math.abs(pl.x - l.x) < 96 && Math.abs(pl.z - l.z) < 96) { v = true; break; } } }
  } catch { v = true; }
  hotMemo.set(e.id, { t: now, v });
  return v;
}
system.runInterval(() => {
  const v = relVersion();
  for (const h of allOf(HOUND)) {
    try {
      syncProps(h);
      const m = world.getEntity(String(gdp(h, "war:master") ?? ""));
      if (m && m.isValid) {
        // hounds always share their master's faction and stay near him
        if (P(h, "war:faction") !== P(m, "war:faction") || !!gdp(m, "war:surr") !== !!gdp(h, "war:surr")) {
          setP(h, "war:faction", P(m, "war:faction"));
          sdp(h, "war:surr", gdp(m, "war:surr") ?? 0);
          applyRelations(h);
        }
        if (m.dimension.id !== h.dimension.id || dist(m.location, h.location) > 24) tpNear(h, m.location, m.dimension);
      }
      if (gdp(h, "war:relv") !== v) applyRelations(h);
    } catch {}
  }
  if (tick() % 200 < 10) { try { gcWaypoints(allOf(SOLDIER)); } catch {} }
}, 10);

const CIVILIANS = ["minecraft:villager_v2", "minecraft:villager", "minecraft:wandering_trader"];
world.beforeEvents.entityHurt.subscribe((ev) => {
  try {
    const v = ev.hurtEntity;
    if (v && held.has(v.id)) { ev.cancel = true; return; }                   // v6.3: carried with the TP wand: untouchable
    const src = ev.damageSource?.damagingEntity;
    if (v?.typeId === SOLDIER && src?.typeId === "minecraft:player" && mainhand(src) === TP_WAND) {   // v6.3: the TP wand picks him up, no harm done
      ev.cancel = true;
      system.run(() => { try { pickUp(src, v); } catch (err) { oops("tp wand", err); } });
      return;
    }
    if (v?.typeId === SOLDIER && !downed.has(v.id)) {
      const cause = String(ev.damageSource.cause ?? "");
      const h = v.getComponent("minecraft:health");
      const noDown = ["cavalier", "houndmaster"].includes(String(gdp(v, "war:div") ?? ""));   // (v6.9.3: riders and dog handlers just die)
      if (h && ev.damage >= h.currentValue && cause !== "void" && !dying.has(v.id) && !noDown) {
        ev.cancel = true;                                            // falls wounded instead of dying
        let killer; try { killer = ev.damageSource?.damagingEntity; } catch {}
        system.run(() => { try { if (v.isValid) { const hh = v.getComponent("minecraft:health"); if (hh) hh.setCurrentValue(1); goDown(v, killer); } } catch {} });
        return;
      }
    }
  } catch {}
  try {
    const v = ev.hurtEntity, a = ev.damageSource.damagingEntity;
    if (v && CIVILIANS.includes(v.typeId) && setting("civil", true) && a &&
        (a.typeId === SOLDIER || a.typeId === HOUND || (a.typeId === "minecraft:player" && String(ev.damageSource.cause ?? "").includes("xplosion")))) { ev.cancel = true; return; }
  } catch {}
  try {   // realism: damage in soldier combat
    const k = realism().dmg;
    const hv = ev.hurtEntity;
    const bySoldier = ev.damageSource.damagingEntity?.typeId === SOLDIER ||
      (hv?.typeId === "minecraft:player" && !ev.damageSource.damagingEntity && tick() - (shotAtPlayer.get(hv.id) ?? -999) < 12);
    if (k !== 1 && (hv?.typeId === SOLDIER || bySoldier)) ev.damage = ev.damage * k;
  } catch {}
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
  if (v.typeId === SOLDIER) sdp(v, "war:hurt", now);
  const sq = v.typeId === SOLDIER ? sd(v).squad : 0;
  for (const c of nearSnap(v.dimension.id, v.location, 64)) {           // (v5.9: factions from the shared snapshot)
    if (c.type !== SOLDIER || !isFriendly(c.f, f)) continue;
    if (c.dd <= 16 || (sq && c.f === f && c.e.isValid && sd(c.e).squad === sq)) alertUntil.set(c.id, now + 200); // squad shares contact
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
      let prog = Number(gdp(flag, "war:cap") ?? 0);
      prog = defended || !cap ? Math.max(0, prog - 1) : prog + 1;
      sdp(flag, "war:cap", prog);
      if (cap && !defended && prog > 0) {
        for (const p of flag.dimension.getPlayers({ location: flag.location, maxDistance: 20 }))
          p.onScreenDisplay.setActionBar(`${factionLabel(cap)} §fcapturing ${factionLabel(owner)}§f's flag ${"§a|".repeat(prog)}${"§7|".repeat(Math.max(0, 8 - prog))}`);
      }
      if (prog >= 8) {
        sdp(flag, "war:cap", 0);
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
  if (VEHICLES.includes(t.typeId) || t.typeId === NEST) {
    const item = { "war:boat": "war:boat_item", "war:plane": "war:plane_item", "war:tank": "war:tank_item", "war:mg_nest": "war:mg_nest_item" }[t.typeId];
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
  for (const e of allOf(SOLDIER)) { try { if (Number(P(e, "war:faction")) === f && gdp(e, "war:surr")) resume(e); } catch {} }
  for (const e of [...allOf(SOLDIER), ...allOf(HOUND)]) { try { applyRelations(e); } catch {} }
}

// ---- players: guards come to you when you respawn
world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  setPlayerFaction(p, playerFaction(p));
  if (ev.initialSpawn) return;
  system.runTimeout(() => {
    for (const g of allOf(SOLDIER)) {
      try { if (gdp(g, "war:owner") === p.id && sd(g).div === "guard") tpNear(g, p.location, p.dimension); } catch {}
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
const mountedAt = new Map(); // player id -> tick he got into a vehicle
world.afterEvents.playerSwingStart.subscribe((ev) => {
  const v = myVehicle(ev.player) ?? (ridingNest(ev.player) ? ev.player.getComponent("minecraft:riding")?.entityRidingOn : undefined);
  if (!v || v.typeId === "war:boat") return;
  const src = String(ev.swingSource ?? "");
  if (src && !["Attack", "None", "Mine"].includes(src)) return;            // entering (Interact), using items etc. never fire
  if (tick() - (mountedAt.get(ev.player.id) ?? -999) < 20) return;          // first second in the seat: ignore
  fireRequests.set(ev.player.id, tick());
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
  const eye = headLoc(shooter), dir = shooter.getViewDirection(), dim = v.dimension;
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
  const prevRiders = riderCache.get(v.id) ?? [];
  for (const r of riders) if (r.typeId === "minecraft:player" && !prevRiders.includes(r.id)) { mountedAt.set(r.id, tick()); fireRequests.delete(r.id); }
  riderCache.set(v.id, riders.map((r) => r.id));
  if (v.typeId !== "war:boat") {
    const loc0 = v.location;
    let wet = false;
    try { wet = !!v.dimension.getBlock({ x: loc0.x, y: loc0.y + (v.typeId === "war:tank" ? 1.0 : 0.3), z: loc0.z })?.typeId.includes("water"); } catch {}
    if (wet) { // deep water: tanks flood, planes ditch
      say(`§7A ${v.typeId === "war:plane" ? "war plane" : "tank"} went into the water ${placeName(v.dimension, loc0)}.`);
      if (v.typeId === "war:plane") { crashPlane(v, riders); return; }
      for (const r of riders) killReal(r);
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
    const fast = st.speed > 0.35 || nv.y < -0.25;
    const moved = dist(st.last, loc);
    if (st.age > 20 && fast && !landing && (blockedAhead(v, dir, 2.5, [0.3, 1.0, 1.8]) || moved < 0.1 || (ground && nv.y < -0.25))) {
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
  for (const r of riders) killReal(r);
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
  try {
    const n = ev.target;
    if (n?.typeId === NEST) {
      const r = (n.getComponent("minecraft:rideable")?.getRiders() ?? [])[0];
      if (r?.typeId === SOLDIER && isFriendly(playerFaction(ev.player), Number(P(r, "war:faction")))) {
        const p = ev.player;
        system.run(() => { try { n.getComponent("minecraft:rideable")?.ejectRider(r); n.getComponent("minecraft:rideable")?.addRider(p); note(r, "handed over the gun"); } catch {} });
        ev.cancel = true; return;
      }
    }
  } catch {}
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
    case TP_WAND: return run(async () => putDown(player));
    case "war:boat_item": return run(() => placeVehicle(player, "war:boat"));
    case "war:plane_item": return run(() => placeVehicle(player, "war:plane"));
    case "war:tank_item": return run(() => placeVehicle(player, "war:tank"));
    case "war:war_horn": return run(() => blowHorn(player));
    case "war:mg_nest_item": return run(() => placeVehicle(player, NEST));
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
function spawnPoints(player, count, shift = 0) {
  const v = player.getViewDirection();
  const base0 = lookedSpot(player, 48) ?? { x: player.location.x + v.x * 3, y: player.location.y, z: player.location.z + v.z * 3 };
  const len = Math.hypot(v.x, v.z) || 1, fwd = { x: v.x / len, z: v.z / len }, right = { x: -fwd.z, z: fwd.x };
  let base = base0;                                               // (v6.6: side by side for a coalition: each faction its own block)
  if (shift) base = walkableNear(player.dimension, base0.x + right.x * shift, base0.z + right.z * shift, base0.y) ?? { x: base0.x + right.x * shift, y: base0.y, z: base0.z + right.z * shift };
  const perRow = Math.min(6, count), pts = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow), col = (i % perRow) - (perRow - 1) / 2;
    pts.push({ x: base.x + right.x * col * 1.5 + fwd.x * row * 1.5, y: base.y, z: base.z + right.z * col * 1.5 + fwd.z * row * 1.5 });
  }
  return { base, pts };
}
function spawnArmy(player, s, count, shift = 0, given) {
  const { base, pts } = given ?? spawnPoints(player, count, shift);
  const slot = ANCHORED.includes(s.func) ? makeWaypoint(player.dimension, base) : undefined;
  let n = 0;
  for (const p of pts) {
    try {
      const e = player.dimension.spawnEntity(SOLDIER, p, { spawnEvent: "war:init" });
      const MIXG = ["rifle", "smg", "semi", "mg"], MIXM = ["sword", "crossbow"];
      const w = s.weapon === "mixguns" ? MIXG[n % 4] : s.weapon === "mixmelee" ? MIXM[n % 2] : s.weapon;
      const fin = setupSoldier(e, { ...s, weapon: w, ranged: isRangedW(w), func: "__none", owner: player.id }, player);
      giveFunction(fin, s.func, player, slot);
      if (s.div === "houndmaster") {
        for (let i = 0; i < 5; i++) {
          const h = player.dimension.spawnEntity(HOUND, { x: p.x + (Math.random() - 0.5) * 2, y: p.y, z: p.z + (Math.random() - 0.5) * 2 });
          sdp(h, "war:master", fin.id);
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
  const WL = div === "cavalier" ? WEAPONS.slice(0, 2) : [...WEAPONS, ["mixguns", "Mixed guns (rifle / SMG / semi-auto / MG)"], ["mixmelee", "Mixed melee (swords + crossbows)"]];
  const wl = WL.map((w) => (w[0] === "sword" && div === "cavalier" ? "Spear" : w[1]));
  const wIdx = Math.max(0, WL.findIndex((w) => w[0] === (def.weapon ?? (def.ranged ? "crossbow" : "sword"))));
  const funcs = FUNCS[div];
  // v6.6: a whole coalition at once (2+ member factions). v6.9.2: "How many" is the TOTAL, shared out between the member
  // factions and mixed through one formation (30 for a 3-faction coalition: 10 each, side by side in the ranks)
  const coals = getCoals().filter((c) => (c.members ?? []).length >= 2);
  const facOpts = [...factionList(), ...coals.map((c) => `§l⚑ Coalition: ${c.name}§r (${c.members.length} factions)`)];
  const f = new ModalFormData().title(`Spawn: ${DIV[div].name}`)
    .dropdown("Faction or coalition", facOpts, { defaultValueIndex: Math.min(facOpts.length - 1, def.coal !== undefined && coals[def.coal] ? NF + def.coal : Math.max(0, def.faction - 1)) })
    .dropdown("Squad", squadList(def.faction, "No squad"), { defaultValueIndex: def.squad })
    .dropdown("Function", funcs.map((x) => x[1]), { defaultValueIndex: Math.min(def.func, funcs.length - 1) })
    .dropdown(div === "grenadier" ? "Kit" : "Weapon", DIV[div].weapon ? wl : div === "grenadier" ? DEMO.map((k) => k[1]) : ["None (heals)"], { defaultValueIndex: DIV[div].weapon ? wIdx : div === "grenadier" ? Math.max(0, DEMO.findIndex((k) => k[0] === def.weapon)) : 0 })
    .slider("How many (a coalition: in total, mixed)", 1, 30, { valueStep: 1, defaultValue: def.count })
    .slider("Patrol / sentry radius", 4, 150, { valueStep: 2, defaultValue: def.radius });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  const pick = Number(v[0]), coal = pick >= NF ? coals[pick - NF] : undefined;
  const cfg = { faction: coal ? (def.faction || 1) : pick + 1, coal: coal ? pick - NF : undefined, squad: Number(v[1]), func: Number(v[2]), weapon: DIV[div].weapon ? WL[Number(v[3])][0] : div === "grenadier" ? DEMO[Number(v[3])][0] : "sword", count: Number(v[4]), radius: Number(v[5]) };
  setJSON(player, key, cfg);
  if (coal) {
    const mem = coal.members.slice(0, Math.max(1, cfg.count));         // (fewer men than factions: the first few get one each)
    const all = spawnPoints(player, cfg.count);
    let total = 0;
    const counts = mem.map((fac, k) => {
      const pts = all.pts.filter((_, i) => i % mem.length === k);       // every Nth place in the ranks: mixed, not in blocks
      const n = pts.length ? spawnArmy(player, { faction: fac, squad: cfg.squad, weapon: cfg.weapon, ranged: isRangedW(cfg.weapon), div, radius: cfg.radius, func: funcs[cfg.func][0] }, pts.length, 0, { base: all.base, pts }) : 0;
      total += n; return n;
    });
    player.onScreenDisplay.setActionBar(`§aSpawned ${total} ${DIV[div].name}s for §l${coal.name}§r§a, mixed: ${mem.map((m, k) => `${counts[k]} ${factionLabel(m)}`).join("§a, ")}`);
    return;
  }
  const n = spawnArmy(player, { faction: cfg.faction, squad: cfg.squad, weapon: cfg.weapon, ranged: isRangedW(cfg.weapon), div, radius: cfg.radius, func: funcs[cfg.func][0] }, cfg.count);
  player.onScreenDisplay.setActionBar(`§aSpawned ${n} ${factionLabel(cfg.faction)} §a${DIV[div].name}${n > 1 ? "s" : ""} §7(${funcs[cfg.func][1]}${cfg.squad ? ", " + squadName(cfg.faction, cfg.squad) : ""})`);
}

// ================================================================ Command Baton (army only)
const ORDERS = [["charge", "Charge POS"], ["hold", "Hold here"], ["patrol", "Patrol here"], ["follow", "Follow me"], ["fallback", "Fall back"], ["board", "Board the vehicle I'm looking at"], ["mark", "Mark this spot (where I'm standing)"], ["roam", "Roam the area (any floor, free to hunt)"]];
const mapFunc = (order, div) => (div === "garrison" ? { hold: "post", patrol: "patrol", roam: "patrol", follow: "follow", charge: "charge" } : { hold: "hold", patrol: "patrol", roam: "patrol", follow: "follow", charge: "charge" })[order];   // (v7.0: roam = a free patrol)

async function batonUse(player) {
  const inGeneral = generals.has(player.id);
  try { await batonUseInner(player); }
  finally { if (inGeneral && generals.has(player.id)) { endGeneral(player); player.onScreenDisplay.setActionBar("§7General's view closed."); } }
}
async function batonUseInner(player) {
  const veh = myVehicle(player);
  if (veh && (await vehicleMenu(player, veh))) return;
  let cfg = getJSON(player, "war:lastorder", undefined);
  if (!cfg || !player.isSneaking) {
    const def = cfg ?? { faction: playerFaction(player), order: 0, squad: 0, count: 0, radius: 200 };
    const ff = new ActionFormData().title("Orders: which faction?");
    const facOpts = [];
    if (playerFaction(player)) { facOpts.push(playerFaction(player)); ff.button(`My faction: ${factionLabel(playerFaction(player))}`); }
    facOpts.push(0); ff.button("All factions");
    // v6.9.3: whole coalitions, ordered as one army (every member faction's soldiers within range)
    const coalsO = getCoals().map((c, i) => ({ c, i })).filter((x) => (x.c.members ?? []).length >= 1);
    for (const x of coalsO) { facOpts.push({ coal: x.i }); ff.button(`§l⚑ ${x.c.name}§r\n${x.c.members.map((m) => factionLabel(m)).join(" ")}`); }
    for (let i = 1; i <= NF; i++) if (i !== playerFaction(player)) { facOpts.push(i); ff.button(factionLabel(i)); }
    const fr = await show(ff, player);
    if (!fr || fr.canceled || fr.selection === undefined) return;
    const pickF = facOpts[fr.selection], coalPick = typeof pickF === "object" ? pickF.coal : undefined;
    const fac = coalPick !== undefined ? 0 : pickF;
    const of = new ModalFormData().title(`Orders: ${coalPick !== undefined ? getCoals()[coalPick].name : factionLabel(fac, true)}`)
      .dropdown("Order", ORDERS.map((o) => o[1]), { defaultValueIndex: def.order })
      .dropdown("Squad (Garrison only obeys when its squad is picked)", coalPick !== undefined ? ["All squads", ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Squad ${n} (in every member faction)`)] : squadList(fac, "All squads"), { defaultValueIndex: fac === def.faction && def.coal === coalPick ? def.squad : 0 })
      .slider("How many (0 = all)", 0, 100, { valueStep: 5, defaultValue: def.count })
      .slider("Soldiers within (blocks)", 16, 200, { valueStep: 8, defaultValue: def.radius })
      .dropdown("Stance", ["Aggressive (chase what they see)", "Defensive (hold and shoot what comes)", "Hold fire (only shoot back)"], { defaultValueIndex: Math.max(0, ["aggressive", "defensive", "holdfire"].indexOf(def.stance ?? "aggressive")) })
      .slider("Area of operations (blocks)", 40, 200, { valueStep: 10, defaultValue: def.ao ?? 100 })
      .dropdown("Freedom", ["Use judgment (fight anywhere in the area, help nearby friends)", "Exactly as ordered"], { defaultValueIndex: def.free === false ? 1 : 0 });
    const or = await show(of, player);
    if (!or || or.canceled || !or.formValues) return;
    const v = or.formValues.map(Number);
    cfg = { faction: fac, coal: coalPick, order: v[0], squad: v[1], count: v[2], radius: v[3], stance: ["aggressive", "defensive", "holdfire"][v[4]] ?? "aggressive", ao: Math.round(v[5] ?? 100), free: v[6] !== 1 };
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
      const THEN = ["hold", "patrol", "roam"];
      const df = new ModalFormData().title("Charge POS");
      if (tr.selection >= 2 && tr.selection <= 4) df.slider("How far (blocks)", 25, 1000, { valueStep: 25, defaultValue: Math.min(1000, def.far ?? 100) });
      if (tr.selection === 5) {
        df.textField("X", "e.g. 1200", { defaultValue: String(Math.round(def.cx ?? player.location.x)) });
        df.textField("Z", "e.g. -340", { defaultValue: String(Math.round(def.cz ?? player.location.z)) });
      }
      df.dropdown("When they arrive", ["Hold the area", "Patrol the area", "Roam the area"], { defaultValueIndex: Math.max(0, THEN.indexOf(def.then ?? "hold")) });
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
  if (cfg.target === 0) return generals.get(player.id)?.cursor ?? aimFar(player);
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
async function giveOrderInner(player, cfg, given) {
  let order = ORDERS[cfg.order][0];
  if (order === "mark") { await markSpot(player); return; }
  const now = tick();
  const coalMembers = cfg.coal !== undefined ? (getCoals()[cfg.coal]?.members ?? []) : [];
  if (cfg.coal !== undefined && !coalMembers.length) { player.onScreenDisplay.setActionBar("§7That coalition has no factions (or is gone)."); return; }
  let pool = given ?? player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: cfg.radius }).filter((e) => {
    const d = sd(e);
    if (d.surr || d.div === "guard" || d.div === "medic" || isRiding(e)) return false;
    if (cfg.coal !== undefined) { if (!coalMembers.includes(d.faction)) return false; }   // (v6.9.3: a coalition order)
    else if (cfg.faction && d.faction !== cfg.faction) return false;
    if (cfg.squad && d.squad !== cfg.squad) return false;
    if (d.div === "garrison" && !cfg.squad) return false; // garrison only answers to its own squad
    return true;
  });
  // fresh soldiers first, then nearest
  pool.sort((a, b) => {
    const fa = now - Number(gdp(a, "war:ordt") ?? -99999) < 2400 ? 1 : 0;
    const fb = now - Number(gdp(b, "war:ordt") ?? -99999) < 2400 ? 1 : 0;
    return fa - fb || dist(a.location, player.location) - dist(b.location, player.location);
  });
  if (cfg.count && !given) pool = pool.slice(0, cfg.count);
  if (!pool.length) { player.onScreenDisplay.setActionBar("§7No soldiers matched that order."); return; }
  if (cfg.coal !== undefined && !given) {                         // v6.9.3: a coalition: the same order to each member faction's men
    const byF = new Map(); for (const e of pool) { const f = sd(e).faction; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(e); }
    for (const [f, grp] of byF) await giveOrderInner(player, { ...cfg, coal: undefined, faction: f }, grp);
    player.onScreenDisplay.setActionBar(`§e${ORDERS[cfg.order][1]}: §f${pool.length} soldiers of §l${getCoals()[cfg.coal]?.name ?? "the coalition"}§r §7(${[...byF].map(([f, g]) => `${g.length} ${factionLabel(f, true)}`).join(", ")})`);
    return;
  }

  if (order === "board") {
    let veh;
    try { veh = player.getEntitiesFromViewDirection({ maxDistance: 64 }).map((h) => h.entity).find((x) => VEHICLES.includes(x.typeId)); } catch {}
    if (!veh) { player.onScreenDisplay.setActionBar("§cLook at a boat, plane or tank."); return; }
    const rd = veh.getComponent("minecraft:rideable");
    const free = Math.max(0, rd.seatCount - rd.getRiders().length);
    let n = 0;
    for (const e of pool.filter((x) => sd(x).div !== "cavalier").slice(0, free)) {
      try { e.teleport({ x: veh.location.x, y: veh.location.y + 0.5, z: veh.location.z }); if (rd.addRider(e)) { n++; sdp(e, "war:ordt", now); } } catch {}
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
    const cxz = pool.reduce((a, e) => ({ x: a.x + e.location.x / pool.length, y: a.y + e.location.y / pool.length, z: a.z + e.location.z / pool.length }), { x: 0, y: 0, z: 0 });
    let near = false;
    try { near = !!dest && dist(cxz, dest) <= 14 && Math.abs((dest.y ?? cxz.y) - cxz.y) <= 1 && !!player.dimension.getBlock(dest) && localReach(player.dimension, cxz, dest); } catch {}
    if (near) { slot = makeWaypoint(player.dimension, dest); march = undefined; }       // close and on the same level: Minecraft walks them there
    else {
      const fac = cfg.faction || sd(pool[0]).faction;
      if (dest && Math.hypot(dest.x - cxz.x, dest.z - cxz.z) > orderLimit()) { factionMsg(fac, `§cToo far: ${Math.round(Math.hypot(dest.x - cxz.x, dest.z - cxz.z))} blocks (limit ${orderLimit()}). Pick a closer point.`, player); return; }
      march = dest ? startMarch(player, pool, dest, cfg.then ?? "hold") : undefined; slot = march ? march.lanes[0] : 0;
      if (march && dest) announceMarch(player, fac, getMarches()[march.id], cxz);
    }
  } else if (order === "hold" || order === "patrol" || order === "roam") {
    const spot = generals.get(player.id)?.cursor ?? aimFar(player);
    if (!spot) { player.onScreenDisplay.setActionBar("§cLook at the ground where they should go."); return; }
    let loaded = !spot.estimated;
    try { if (loaded) loaded = !!player.dimension.getBlock(spot); } catch { loaded = false; }
    // v5.8: a spot they can't plainly walk to on their own level (up a ladder, on a wall, another floor, past a
    // building) is reached by a real route like any march; only plain short moves are left to Minecraft's walking
    const pc = pool.reduce((a, e) => ({ x: a.x + e.location.x / pool.length, y: a.y + e.location.y / pool.length, z: a.z + e.location.z / pool.length }), { x: 0, y: 0, z: 0 });
    let plain = false;
    try { plain = loaded && Math.abs(spot.y - pc.y) <= 1.5 && localReach(player.dimension, pc, spot); } catch {}
    if (!loaded || dist(spot, player.location) > 48 || !plain) {
      // far away / not plainly reachable: march there along a route first, then hold / patrol
      const fac = cfg.faction || sd(pool[0]).faction;
      if (Math.hypot(spot.x - pc.x, spot.z - pc.z) > orderLimit()) { factionMsg(fac, `§cToo far: ${Math.round(Math.hypot(spot.x - pc.x, spot.z - pc.z))} blocks (limit ${orderLimit()}). Pick a closer point.`, player); return; }
      march = startMarch(player, pool, spot, order);
      if (march) { cfg = { ...cfg, then: order }; order = "charge"; slot = march.lanes[0]; announceMarch(player, fac, getMarches()[march.id], pc); }
      else { spotCenter = spot; slot = makeWaypoint(player.dimension, spot); }
    } else {
      spotCenter = spot;
      slot = makeWaypoint(player.dimension, spot);
    }
  }
  if ((order === "charge" || order === "hold" || order === "patrol" || order === "roam") && !slot) { gcWaypoints(allOf(SOLDIER)); player.onScreenDisplay.setActionBar("§eMarkers were full and have been cleaned up. Give the order again."); return; }
  let n = 0;
  for (const e of pool) {
    try {
      freshMind(e);                                            // the newest order overrides everything
      sdp(e, "war:ordt", now);
      sdp(e, "war:ao", cfg.ao ?? 100);
      sdp(e, "war:free", cfg.free !== false);
      sdp(e, "war:cmdr", player.id);
      sdp(e, "war:roam", order === "roam" || (order === "charge" && cfg.then === "roam") ? true : undefined);   // (v7.0)
      if (order !== "fallback") sdp(e, "war:stance", cfg.stance ?? "aggressive");
      if (order === "fallback") {
        sdp(e, "war:retreat", true);
        sdp(e, "war:retreatUntil", now + 600);
        updateName(e); setJSON(e, "war:st", {}); think(e);
      } else if (spotCenter) {
        // each soldier gets its own spot around the target instead of one crowded point
        giveFunction(e, mapFunc(order, sd(e).div), player, formationSlot(e.dimension, spotCenter, e, order === "patrol" || order === "roam" ? 4 : 2.5) || slot);
      } else if (march) {
        sdp(e, "war:then", cfg.then ?? "hold");
        giveFunction(e, mapFunc(order, sd(e).div), player, march.lanes[n % march.lanes.length]); // each soldier gets a lane
      } else {
        giveFunction(e, mapFunc(order, sd(e).div), player, slot);
      }
      n++;
    } catch {}
  }
  player.onScreenDisplay.setActionBar(`§e${ORDERS[cfg.order][1]}: §f${n} soldier${n === 1 ? "" : "s"} §7(sneak + use repeats)`);
  for (const f of WarAPI.hooks.order) { try { f(player, cfg, pool); } catch {} }
}

// ================================================================ Unit Wand
const skinChoices = () => SKINS.map((name, i) => ({ name, slot: i + 1 })).filter((s) => s.name && s.name.trim());
async function unitWand(player, e) {
  if (e && (isDowned(e) || isPow(e))) { await captiveMenu(player, e); return; }
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
    for (const h of allOf(HOUND)) if (gdp(h, "war:master") === e.id) h.remove();
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
    .dropdown(d.div === "grenadier" ? "Kit" : "Weapon", d.div === "grenadier" ? DEMO.map((k) => k[1]) : DIV[d.div].weapon ? (d.div === "cavalier" ? WEAPONS.slice(0, 2) : WEAPONS).map((w) => (w[0] === "sword" && d.div === "cavalier" ? "Spear" : w[1])) : ["(fixed for this unit)"], { defaultValueIndex: d.div === "grenadier" ? Math.max(0, DEMO.findIndex((k) => k[0] === String(gdp(e, "war:kit") ?? "grenade"))) : DIV[d.div].weapon ? Math.max(0, (d.div === "cavalier" ? WEAPONS.slice(0, 2) : WEAPONS).findIndex((w) => w[0] === d.weapon)) : 0 })
    .dropdown("Armor", ARMOR_LABEL, { defaultValueIndex: Math.max(0, ARMOR.indexOf(d.armor)) })
    .dropdown("Skin", ["Faction uniform", ...skins.map((s) => s.name)], { defaultValueIndex: Math.max(0, skins.findIndex((s) => s.slot === d.skin) + 1) })
    .slider("Patrol / sentry radius", 4, 150, { valueStep: 2, defaultValue: Math.min(150, Math.max(4, d.radius)) })
    .textField("Name (blank = automatic)", "e.g. Sgt. Rossi", { defaultValue: d.custom })
    .dropdown("Stance", ["Aggressive", "Defensive", "Hold fire"], { defaultValueIndex: Math.max(0, ["aggressive", "defensive", "holdfire"].indexOf(String(gdp(e, "war:stance") ?? "aggressive"))) });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues || !e.isValid) return;
  const v = r.formValues;
  const skinIdx = Number(v[5]);
  const wpn = d.div === "grenadier" ? DEMO[Number(v[3])][0] : DIV[d.div].weapon ? (d.div === "cavalier" ? WEAPONS.slice(0, 2) : WEAPONS)[Number(v[3])][0] : d.weapon;
  const s = { ...snapshot(e), faction: Number(v[0]), squad: Number(v[1]), weapon: wpn, ranged: isRangedW(wpn),
    armor: ARMOR[Number(v[4])] ?? "none",
    skin: skinIdx ? skins[skinIdx - 1].slot : 0, radius: Number(v[6]), custom: String(v[7]).trim(), owner: d.owner, func: "__none" };
  const func = funcs[Number(v[2])][0];
  sdp(e, "war:stance", ["aggressive", "defensive", "holdfire"][Number(v[8])] ?? "aggressive");
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
async function warTable(player, pre) {
  const af = new ActionFormData().title("War Table").body(`Your faction: ${factionLabel(playerFaction(player))}`)
    .button("Join a faction").button("Leave my faction").button("Diplomacy").button("Name factions").button("Name squads").button("Settings").button("Coalitions").button("War archive").button("Test battle").button("Cleanup / repair");
  const r = pre !== undefined ? { selection: pre, canceled: false } : await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection === 8) { await testBattle(player); return; }
  if (r.selection === 9) { await cleanupMenu(player); return; }
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
    // v6.6: one page. Every other faction has its own Neutral / Hostile / Ally choice right there; Save applies all
    // the changes at once and the same page comes straight back (close it when you're done)
    const VALS = ["0", "1", "2"], LBL = ["§7Neutral", "§cHostile", "§aAlly"];
    while (true) {
      const others = facOrder().filter((b) => b !== a);                 // (v7.0: A-Z)
      const mf = new ModalFormData().title(`Relations: ${factionLabel(a, true)}`)
        .dropdown("§lSet everyone to", ["§7(keep the choices below)", ...LBL], { defaultValueIndex: 0 });
      for (const b of others) mf.dropdown(factionLabel(b), LBL, { defaultValueIndex: Math.max(0, VALS.indexOf(relAt(a, b))) });
      mf.submitButton("Save (stays open)");
      const mr = await show(mf, player);
      if (!mr || mr.canceled || !mr.formValues) return;
      const all = Number(mr.formValues[0]);
      let changed = 0;
      others.forEach((b, i) => {
        const v = all ? VALS[all - 1] : VALS[Number(mr.formValues[i + 1])];
        if (relAt(a, b) !== v) { setRelPair(a, b, v, false); changed++; }
      });
      if (changed) {
        for (const e of [...allOf(SOLDIER), ...allOf(HOUND)]) { try { applyRelations(e); } catch {} }
        say(`${factionLabel(a)} §fchanged ${changed} relation${changed === 1 ? "" : "s"}${all ? `: now ${LBL[all - 1]}§f with everyone` : ""}.`);
      }
    }
  } else if (r.selection === 3) {
    const names = getNames();
    const nf = new ModalFormData().title("Name factions");
    COLORS.forEach(([c, code], i) => nf.textField(`${code}${c}`, "country name (optional)", { defaultValue: names[i] ?? "" }));
    const nr = await show(nf, player);
    if (!nr || nr.canceled || !nr.formValues) return;
    namesCache = nr.formValues.map((x) => String(x).trim().slice(0, 24));
    sdp(world, "war:names", JSON.stringify(namesCache));
    sdp(world, "war:relv", relVersion() + 1);
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
    sdp(world, "war:squads", JSON.stringify(all));
    sdp(world, "war:relv", relVersion() + 1);
    player.sendMessage("§aSquad names saved.");
  } else if (r.selection === 6) {
    await coalitions(player);
  } else if (r.selection === 7) {
    await warArchive(player);
  } else if (r.selection === 5) {
    const which = await show(new ActionFormData().title("Settings").button("General").button("Gun loadouts (per faction)").button("Realism (battle tuning)").button("Faction skins").button("Callout language (per faction)").button("« Back"), player);
    if (!which || which.canceled || which.selection === undefined) return;
    if (which.selection === 5) return warTable(player);
    if (which.selection === 4) { await voiceMenu(player); return warTable(player, 5); }   // (v6.5)
    if (which.selection === 1) { await loadoutMenu(player); return warTable(player, 5); }
    if (which.selection === 3) { await factionSkinMenu(player); return warTable(player, 5); }
    if (which.selection === 2) {
      const cur = (k) => Math.round(Number(setting(k, 100)));
      const rf = new ModalFormData().title("Realism")
        .slider("Damage (% of normal)", 25, 200, { valueStep: 25, defaultValue: cur("r_dmg") })
        .slider("Reaction speed (% of normal)", 50, 200, { valueStep: 25, defaultValue: cur("r_react") });
      const rr = await show(rf, player);
      if (!rr || rr.canceled || !rr.formValues) return;
      sdp(world, "war:set_r_dmg", Math.round(Number(rr.formValues[0])));
      sdp(world, "war:set_r_react", Math.round(Number(rr.formValues[1])));
      player.sendMessage(`§aRealism saved: damage ${rr.formValues[0]}%, reaction speed ${rr.formValues[1]}%.`);
      return warTable(player, 5);
    }
    const sf = new ModalFormData().title("Settings")
      .dropdown("When a war flag is captured", ["The two factions become Neutral", "Nearby losers surrender (war continues)"], { defaultValueIndex: setting("capture", "neutral") === "neutral" ? 0 : 1 })
      .toggle("Explosions break blocks (bombs, crashes)", { defaultValue: !!setting("blockdmg", true) })
      .dropdown("Spacing between moving soldiers", ["1 block", "1.5 blocks", "2 blocks"], { defaultValueIndex: Math.max(0, [1, 1.5, 2].indexOf(Number(setting("spacing", 1.5)))) })
      .toggle("Show soldier decisions (for testing)", { defaultValue: !!setting("readout", false) })
      .toggle("Soldiers spare villagers and traders", { defaultValue: !!setting("civil", true) })
      .toggle("Soldiers may place / break blocks when stuck (restored after ~1 min)", { defaultValue: !!setting("build", true) })
      .toggle("Close-combat drills (cover-and-move, shoot-and-scoot, flinch)", { defaultValue: !!setting("drills", true) })
      .toggle("Kneel in firefights", { defaultValue: !!setting("poses", true) })
      .toggle("Soldiers cut off and outnumbered may surrender", { defaultValue: !!setting("isosurr", true) })
      .toggle("Battle learning (factions adapt their tactics from their own battles)", { defaultValue: !!setting("learn", true) })
      .toggle("Rescue stuck soldiers (teleport to a squad mate, last resort only)", { defaultValue: !!setting("rescue", true) })
      .toggle("On the march, finish an enemy off before carrying on", { defaultValue: !!setting("commit", true) })
      .toggle("Armbands showing each soldier's type", { defaultValue: !!setting("bands", true) })
      .toggle("§cReset what every faction has learned", { defaultValue: false })
      .toggle("Menus in A-Z order", { defaultValue: !!setting("abc", true) });
    const sr = await show(sf, player);
    if (!sr || sr.canceled || !sr.formValues) return;
    sdp(world, "war:set_capture", sr.formValues[0] === 0 ? "neutral" : "surrender");
    sdp(world, "war:set_blockdmg", !!sr.formValues[1]);
    sdp(world, "war:set_spacing", [1, 1.5, 2][Number(sr.formValues[2])] ?? 1.5);
    sdp(world, "war:set_readout", !!sr.formValues[3]);
    sdp(world, "war:set_civil", !!sr.formValues[4]);
    sdp(world, "war:set_build", !!sr.formValues[5]);
    sdp(world, "war:set_drills", !!sr.formValues[6]);
    sdp(world, "war:set_poses", !!sr.formValues[7]);
    sdp(world, "war:set_isosurr", !!sr.formValues[8]);
    sdp(world, "war:set_learn", !!sr.formValues[9]);
    sdp(world, "war:set_rescue", !!sr.formValues[10]);
    sdp(world, "war:set_commit", !!sr.formValues[11]);
    sdp(world, "war:set_bands", !!sr.formValues[12]);
    for (const e of allOf(SOLDIER)) { try { setP(e, "war:role", roleFor(e)); } catch {} }
    if (sr.formValues[13]) { learned = {}; saveLearned(); player.sendMessage("§eEvery faction's learned tactics were reset to the defaults."); }
    sdp(world, "war:set_abc", !!sr.formValues[14]);
    player.sendMessage("§aSettings saved.");
    return warTable(player, 5);
    player.sendMessage("§aSettings saved.");
  }
}

// ================================================================ v6.2: cleanup & repair
// Everything this add-on puts in the world, removable on demand. Only loaded things can be touched by any script (or
// /kill), so a removal is also written down: anything older than it (or of that faction) is removed the moment its land
// loads. Repair deletes nothing: it cancels every march and stuck route and has every soldier hold where he stands.
const PACK = [SOLDIER, HOUND, "war:mg_nest", ...VEHICLES, FLAG, WAYPOINT, "war:bomb", "war:shell", "war:blank"];
const purgeState = () => getJSON(world, "war:purge", { gen: 1, all: 0, f: {} });
function entFaction(o) {
  try {
    if (o.typeId === SOLDIER || o.typeId === HOUND || o.typeId === FLAG) return Number(P(o, "war:faction") ?? 0);
    if (VEHICLES.includes(o.typeId) || o.typeId === "war:mg_nest") return vehicleFaction(o) || Number(gdp(o, "war:faction") ?? 0);
  } catch {}
  return 0;
}
function isPurged(o, ps) {
  const g = Number(gdp(o, "war:gen") ?? 0);
  if (ps.all && g < ps.all) return true;
  const f = entFaction(o);
  return !!(f && ps.f[f] && g < ps.f[f]);
}
function removeEnt(o) {
  try { if (o.typeId === SOLDIER) { downed.delete(o.id); pows.delete(o.id); personal.delete(o.id); gliders.delete(o.id); climbing.delete(o.id); } } catch {}
  try { o.remove(); } catch { try { o.kill(); } catch {} }
}
// new things are stamped with the current generation; things from before a removal are removed when they load
world.afterEvents.entitySpawn.subscribe((ev) => { try { const o = ev.entity; if (PACK.includes(o.typeId) && gdp(o, "war:gen") === undefined) sdp(o, "war:gen", purgeState().gen); } catch {} });
system.runInterval(() => {
  const ps = purgeState();
  if (!ps.all && !Object.keys(ps.f).length) return;
  for (const did of ["overworld", "nether", "the_end"]) {
    let dim; try { dim = world.getDimension(did); } catch { continue; }
    for (const type of PACK) {
      let list = []; try { list = dim.getEntities({ type }); } catch {}
      for (const o of list) { try { if (isPurged(o, ps)) removeEnt(o); else if (gdp(o, "war:gen") === undefined) sdp(o, "war:gen", ps.gen); } catch {} }
    }
  }
}, 100);
function clearMarches(filter) {
  const ms = getMarches();
  for (const [id, m] of Object.entries(ms)) { if (filter && !filter(m)) continue; for (const sl of m.lanes ?? []) laneOf.delete(sl); delete ms[id]; }
  saveMarches();
}
async function confirm(player, title, text) {
  const r = await show(new ActionFormData().title(title).body(text).button("§cYes, do it").button("Cancel"), player);
  return !!r && !r.canceled && r.selection === 0;
}
async function cleanupMenu(player) {
  const r = await show(new ActionFormData().title("Cleanup / repair").body("Fix stuck soldiers, or remove War Engine things from the world.")
    .button("Repair (deletes nothing)\nstop all marches, every soldier holds where he is")
    .button("Remove everything near me").button("Remove one faction's units").button("§cRemove everything from War Engine"), player);
  if (!r || r.canceled || r.selection === undefined) return;
  const now = tick();
  for (const pid of [...holding.keys()]) releaseAll(pid, undefined);   // (v6.3: anyone carried with the TP wand is put down where he is first)
  if (r.selection === 0) {
    clearMarches();
    personal.clear(); travelTo.clear(); gliders.clear(); climbing.clear(); combatLock.clear(); formMode.clear(); driveOn.clear(); remoteSettled.clear(); pressing.clear(); planJobs.length = 0;
    let n = 0;
    for (const e of allOf(SOLDIER)) {
      try {
        if (downed.has(e.id) || pows.has(e.id)) continue;
        freshMind(e);
        const d = sd(e), func = d.func === "charge" ? (FUNCS[d.div]?.[0]?.[0] ?? "hold") : d.func;
        giveFunction(e, func, player, ["hold", "post", "sentry", "stand", "patrol"].includes(func) ? makeWaypoint(e.dimension, e.location, false) : undefined);
        n++;
      } catch {}
    }
    try { gcWaypoints(allOf(SOLDIER)); } catch {}
    player.sendMessage(`§aRepaired: ${n} soldiers hold where they stand, all marches and routes cleared.`);
    return;
  }
  if (r.selection === 1) {
    const mr = await show(new ModalFormData().title("Remove near me").slider("Radius (blocks)", 8, 160, { valueStep: 8, defaultValue: 32 }), player);
    if (!mr || mr.canceled || !mr.formValues) return;
    const R = Number(mr.formValues[0]);
    if (!(await confirm(player, "Remove near me", `Remove every War Engine soldier, hound, vehicle, nest, flag and marker within ${R} blocks?`))) return;
    let n = 0;
    for (const o of player.dimension.getEntities({ location: player.location, maxDistance: R })) if (PACK.includes(o.typeId)) { removeEnt(o); n++; }
    player.sendMessage(`§aRemoved ${n} things within ${R} blocks.`);
    return;
  }
  if (r.selection === 2) {
    const ff = new ActionFormData().title("Remove one faction's units");
    for (const l of factionList()) ff.button(l);
    const fr = await show(ff, player);
    if (!fr || fr.canceled || fr.selection === undefined) return;
    const f = fr.selection + 1;
    if (!(await confirm(player, "Remove a faction", `Remove every soldier, hound, vehicle, nest and flag of ${factionLabel(f)} (everywhere: things in unloaded land go when it loads)?`))) return;
    const ps = purgeState(); ps.gen++; ps.f[f] = ps.gen; setJSON(world, "war:purge", ps);
    clearMarches((m) => m.fac === f);
    let n = 0;
    for (const did of ["overworld", "nether", "the_end"]) { let dim; try { dim = world.getDimension(did); } catch { continue; } for (const type of PACK) { try { for (const o of dim.getEntities({ type })) if (entFaction(o) === f) { removeEnt(o); n++; } } catch {} } }
    player.sendMessage(`§aRemoved ${n} loaded units of ${factionLabel(f)}; the rest go when their land loads.`);
    return;
  }
  if (r.selection === 3) {
    if (!(await confirm(player, "§cRemove everything", "Remove EVERY War Engine soldier, hound, vehicle, nest, flag and marker in the world, and every march? (Things in unloaded land go when it loads. Settings, factions and names are kept.)"))) return;
    const ps = purgeState(); ps.gen++; ps.all = ps.gen; ps.f = {}; setJSON(world, "war:purge", ps);
    clearMarches();
    personal.clear(); travelTo.clear(); gliders.clear(); climbing.clear(); combatLock.clear(); planJobs.length = 0;
    try { slotRefs = {}; setJSON(world, "war:slotrefs", {}); } catch {}
    try { TROUBLE.clear(); world.setDynamicProperty("war:trouble", undefined); } catch {}   // (v6.4: and the learned trouble spots)
    let n = 0;
    for (const did of ["overworld", "nether", "the_end"]) { let dim; try { dim = world.getDimension(did); } catch { continue; } for (const type of PACK) { try { for (const o of dim.getEntities({ type })) { removeEnt(o); n++; } } catch {} } }
    player.sendMessage(`§aRemoved ${n} loaded War Engine things; anything in unloaded land goes when it loads.`);
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
  for (let i = 0; i < n; i++) sdp(world, `${prefix}${i}`, str.slice(i * 30000, (i + 1) * 30000));
  sdp(world, `${prefix}n`, n);
}
function loadChunks(prefix) {
  const n = Number(gdp(world, `${prefix}n`) ?? 0);
  let out = "";
  for (let i = 0; i < n; i++) out += String(gdp(world, `${prefix}${i}`) ?? "");
  return out;
}
function chronLoad() {
  try { chron = JSON.parse(String(gdp(world, "war:chron") ?? "null")); } catch { chron = null; }
  try { chronEvents = chron ? JSON.parse(loadChunks("war:chronE") || "[]") : []; } catch { chronEvents = []; }
}
function chronSave() {
  sdp(world, "war:chron", JSON.stringify(chron));
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
  sdp(world, "war:chron", "null");
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
  const FO = facOrder();
  FO.forEach((fac) => f.dropdown(factionLabel(fac), LOADOUT_KEYS.map((k) => LOADOUTS[k].name), { defaultValueIndex: Math.max(0, LOADOUT_KEYS.indexOf(loadoutOf(fac))) }));
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const changed = [];
  r.formValues.forEach((v, i) => {
    const k = LOADOUT_KEYS[Number(v)], fac = FO[i];
    if (k !== loadoutOf(fac)) changed.push(fac);
    all[fac] = k;
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
    const add = (arr) => { for (const o of arr) { try { if (held.has(o.id)) continue; const l = o.location, ty = o.typeId; const id = o.id; list.push({ e: o, id, type: ty, x: l.x, y: l.y, z: l.z, f: ty === SOLDIER || ty === HOUND || ty === "minecraft:player" ? factionOf(o) : 0, down: downed.has(id) || pows.has(id) }); } catch {} } };
    try { add(dim.getEntities({ type: SOLDIER })); } catch {}
    try { add(dim.getEntities({ type: HOUND })); } catch {}
    try { add(dim.getPlayers()); } catch {}
    for (const t of VEHICLES) { try { add(dim.getEntities({ type: t })); } catch {} }
    try { add(dim.getEntities({ families: ["monster"] })); } catch {}
    // v5.7: a 32-block grid, so "who is near me" looks at the nearby cells only
    const grid = new Map();
    for (const c of list) { const k = Math.floor(c.x / 32) * 100000 + Math.floor(c.z / 32); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(c); }
    list.grid = grid;
    next.set(`minecraft:${did}`, list); next.set(did, list);
  }
  combatants = next;
}
// snapshot entries within r (positions up to half a second old), each with .dd = its distance
function nearSnap(dimId, loc, r) {
  const list = combatants.get(dimId);
  const out = [];
  if (!list) return out;
  const g = list.grid, r2 = r * r;
  const cx0 = Math.floor((loc.x - r) / 32), cx1 = Math.floor((loc.x + r) / 32), cz0 = Math.floor((loc.z - r) / 32), cz1 = Math.floor((loc.z + r) / 32);
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const a = g?.get(cx * 100000 + cz);
    if (!a) continue;
    for (const c of a) { const dx = c.x - loc.x, dy = c.y - loc.y, dz = c.z - loc.z, q = dx * dx + dy * dy + dz * dz; if (q <= r2) { c.dd = Math.sqrt(q); out.push(c); } }
  }
  return out;
}
system.runInterval(refreshCombatants, 10);
function nearbyCombatants(dimId, loc, r) {
  const out = [];
  for (const c of nearSnap(dimId, loc, r)) if (c.e.isValid) out.push(c.e);
  return out;
}

// ================================================================ Hearing
// Gunfire and explosions alert soldiers within ~64 blocks who are hostile to whoever made the noise.
const alertUntil = new Map(); // soldier id -> tick (v5.4: in memory; it was a property write per soldier per bullet)
const noiseT = new Map();     // maker id -> tick his noise was last spread (an MG burst is one noise, not thirty)
function noise(dim, loc, maker) {
  const now = tick();
  if (maker) { if (now - (noiseT.get(maker.id) ?? -99) < 10) { noiseFrom.set(maker.id, now); return; } noiseT.set(maker.id, now); }
  try { hearNoise(dim, loc, maker); } catch {}
  const mf = maker ? factionOf(maker) : 0;
  for (const o of nearbyCombatants(dim.id, loc, 64)) {
    if (o.typeId !== SOLDIER) continue;
    try {
      const of = Number(P(o, "war:faction"));
      if (!mf || isHostile(of, mf)) alertUntil.set(o.id, now + 200);
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
  try { blastDamage(dim, loc, power, opts?.source); } catch {}
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
  rifle:   { bullet: "ww:nrifle_projectile",   sight: 200, fire: 200, mag: 1,  gap: 0, reload: 30,  speed: 5.0, spread: 0.007 },
  semi:    { bullet: "ww:nsemi_projectile",    sight: 200, fire: 200, mag: 8,  gap: 13, reload: 20, speed: 5.0, spread: 0.009 },   // (v6.7: 8 rounds at the old pace: ~14 ticks a shot, in a burst and overall)
  smg:     { bullet: "ww:nsmg_projectile",     sight: 200, fire: 120, mag: 20, gap: 2, reload: 35,  speed: 4.5, spread: 0.018 },
  mg:      { bullet: "ww:nlmg_projectile",     sight: 200, fire: 200, mag: 30, gap: 2, reload: 50, speed: 5.0, spread: 0.010 },
  shotgun: { bullet: "ww:nshotgun_projectile", sight: 200, fire: 40,  mag: 1,  gap: 0, reload: 20,  speed: 3.5, spread: 0.035 },   // (v6.6: a pump takes a second)
  at:      { bullet: "ww:nbazooka_projectile", sight: 200, fire: 120, mag: 1,  gap: 0, reload: 70, speed: 2.3, spread: 0.010 },
  pistol:  { bullet: "ww:nsemi_projectile",    sight: 200, fire: 200, mag: 7,  gap: 14, reload: 20, speed: 4.5, spread: 0.015 },   // (v6.7: 7 rounds at the old pace: ~15 ticks a shot, in a burst and overall)
  sniper:  { bullet: "ww:nrifle_projectile",   sight: 250, fire: 250, mag: 1,  gap: 0, reload: 45,  speed: 6.0, spread: 0.0025 },
};
const gunState = new Map(); // soldier id -> { target, ammo, next, seen, check, step }
function chest(o) { const l = o.location; const ps = o.typeId === SOLDIER ? (poseOf.get(o.id) ?? 0) : 0; return { x: l.x, y: l.y + (o.typeId === "war:tank" ? 1.0 : o.typeId === HOUND ? 0.5 : ps === 2 ? 0.35 : ps === 1 ? 0.85 : 1.2), z: l.z }; }
const LOS = new Map(); let losThisTick = 0;
system.runInterval(() => { losThisTick = 0; if (LOS.size > 8000) LOS.clear(); }, 1);
function clearShot(dim, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, l = Math.hypot(dx, dy, dz);
  if (l < 0.5) return true;
  // v5.7: two number keys (each end rounded to a block, half-blocks in height) in nested maps instead of one long text key
  const ka = bkey("", Math.round(from.x), Math.round(from.y * 2), Math.round(from.z)), kb = bkey("", Math.round(to.x), Math.round(to.y * 2), Math.round(to.z));
  let inner = LOS.get(ka);
  if (!inner) { inner = new Map(); LOS.set(ka, inner); }
  const c = inner.get(kb), now = tick();
  if (c && now - c.t < (bigBattle ? 20 : 10)) return c.v;
  if (losThisTick > (bigBattle ? 160 : 260)) return c && now - c.t < 60 ? c.v : false;  // over the per-tick cap: reuse what we knew, if it's recent (v6.0: lower caps; v6.9: never an old answer from where he no longer is)
  losThisTick++;
  let v = false;
  try { v = !dim.getBlockFromRay(from, { x: dx / l, y: dy / l, z: dz / l }, { maxDistance: l - 0.3, includeLiquidBlocks: false, includePassableBlocks: false }); } catch {}
  inner.set(kb, { v, t: now });
  return v;
}
function vehicleFaction(v) { for (let i = 1; i <= NF; i++) if (v.hasTag(`war_f${i}`)) return i; return 0; }
// players in creative or spectator are never targets; survival/adventure players on a hostile faction (or who attacked) are
const modeMemo = new Map(); // player id -> { t, fair }
function playerFair(p) {
  const c = modeMemo.get(p.id);
  if (c && tick() - c.t < 20) return c.fair;
  let fair = false;
  try { const m = p.getGameMode(); fair = m !== GameMode.Spectator && m !== GameMode.Creative; } catch {}
  modeMemo.set(p.id, { t: tick(), fair });
  return fair;
}
function isTargetFor(e, d, o) {
  if (o.id === e.id) return false;
  if (o.typeId === SOLDIER && (downed.has(o.id) || pows.has(o.id))) return false;   // nobody shoots the downed or prisoners
  if (d.weapon === "at" && (VEHICLES.includes(o.typeId) || d.div !== "grenadier")) return VEHICLES.includes(o.typeId) && isHostile(d.faction, vehicleFaction(o));   // (v6.9.1: the Demolition bazooka fires at men too)
  if (d.weapon === "at" && isMob(o)) return false;                    // (v6.9.3: never a rocket at a zombie or a creeper: only the enemy's army)
  if (VEHICLES.includes(o.typeId)) return false;
  if (o.typeId === SOLDIER || o.typeId === HOUND) return isHostile(d.faction, factionOf(o)) || isProvoker(d.faction, o, tick());
  if (o.typeId === "minecraft:player") { try { return playerFair(o) && (isHostile(d.faction, factionOf(o)) || isProvoker(d.faction, o, tick())); } catch { return false; } }
  // vanilla mobs: only once one of them has attacked one of ours, and only when it's close
  const as = assist.get(e.id);
  if ((as && as.id === o.id && tick() - as.t < 200) || attackedRecently(e, o, tick())) return true;
  const dd = dist(o.location, e.location), id = o.typeId;
  if (id.includes("creeper")) return dd <= 10;                                        // shoot it before it gets here
  if (["skeleton", "stray", "pillager", "witch", "blaze", "bogged"].some((k) => id.includes(k))) return dd <= 20;   // shooting at us
  return dd <= 9;                                                                      // anything hostile this close is a danger
}
function pickTarget(e, d, spec) {
  const eye = headLoc(e);
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
  const h = headLoc(e), c = chest(target);
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
// being fired on (hits or misses): the target and anyone right beside him know where it's coming from
const firedAt = new Map(); // id -> { by, t }
function firedOn(t, shooter, now) {
  try {
    for (const o of nearbyCombatants(t.dimension.id, t.location, 3)) if (o.typeId === SOLDIER) {
      firedAt.set(o.id, { by: shooter.id, t: now });
      const a = (shotsAtMe.get(o.id) ?? []).filter((x) => now - x < 40); a.push(now); shotsAtMe.set(o.id, a);   // (v5.8: incoming fire, hits or misses)
    }
  } catch {}
}
// can the bullet actually get there? checked from the muzzle, at the chest and a bit above it
function muzzleOf(e, t) {
  const h = headLoc(e), c = chest(t);
  const dx = c.x - h.x, dy = c.y - h.y, dz = c.z - h.z, l = Math.hypot(dx, dy, dz) || 1;
  return { x: h.x + (dx / l) * 0.9, y: h.y - 0.2 + (dy / l) * 0.9, z: h.z + (dz / l) * 0.9 };
}
// v5.4: the part of him that can be hit from here: his chest, or else his head (in a window, over a wall, at a
// parapet). A defender a step back from a window shows only his head; before, the attackers never fired back at him.
const headOf = (t) => { const c = chest(t); return { x: c.x, y: c.y + 0.4, z: c.z }; };
const aimMemo = new Map(); // "shooter>target" -> { t, v }  (v5.7: one aim check per pair per 3 ticks)
function aimAt(e, t) {
  const mk = `${e.id}>${t.id}`, c = aimMemo.get(mk), now = tick();
  if (c && now - c.t < 3) return c.v;
  const v = aimAtRaw(e, t);
  aimMemo.set(mk, { t: now, v });
  if (aimMemo.size > 4000) aimMemo.clear();
  return v;
}
function aimAtRaw(e, t) {
  try {
    const m = muzzleOf(e, t), c = chest(t);
    if (clearShot(e.dimension, m, c) && clearShot(e.dimension, m, { x: c.x, y: c.y + 0.35, z: c.z })) return c;
    if (t.typeId !== SOLDIER && t.typeId !== "minecraft:player") return undefined;
    const hd = headOf(t);
    if (clearShot(e.dimension, m, hd) && clearShot(e.dimension, m, { x: hd.x, y: hd.y + 0.15, z: hd.z })) return hd;
  } catch {}
  return undefined;
}
const canHit = (e, t) => !!aimAt(e, t);
// a soldier's eyes, worked out instead of asked from the game (v5.6: the gun loop asked for it hundreds of times a tick)
function headLoc(o) {
  if (o.typeId !== SOLDIER) return o.getHeadLocation();
  const l = o.location, ps = poseOf.get(o.id) ?? 0;
  return { x: l.x, y: l.y + (ps === 2 ? 0.45 : ps === 1 ? 1.1 : 1.62), z: l.z };
}
// v6.9.2: the trigger is only pulled on a line that's open RIGHT NOW (one fresh ray, not the shared line-of-sight memory,
// which works per block and lasts up to a second). A man stepping behind cover is not shot at through it: the leading
// aim is dropped if it would put the shot into the wall, and with neither line open he holds his fire. What still hits a
// wall is the spread of a real shot, and only that can go through (wallbang).
function openNow(dim, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz);
  if (L < 0.6) return true;
  try { return !dim.getBlockFromRay(a, { x: dx / L, y: dy / L, z: dz / L }, { maxDistance: L - 0.4, includeLiquidBlocks: false, includePassableBlocks: false }); } catch { return true; }
}
// known only by ear: kept (and moved) unless he's actually been seen more recently
function hearIt(S, ent, at, t) { const q = S.known.get(ent.id); if (q && !q.heard && q.t >= t) return; S.known.set(ent.id, { ent, x: at.x, y: at.y, z: at.z, t, heard: true }); }
// v7.0: gunfire is heard (64 blocks): the last second or two of shots, by faction
const SHOTS = [];
function noteShot(e) { try { const l = e.location; SHOTS.push({ id: e.id, f: Number(P(e, "war:faction") ?? 0), x: l.x, y: l.y, z: l.z, t: tick() }); while (SHOTS.length && tick() - SHOTS[0].t > 60) SHOTS.shift(); if (SHOTS.length > 400) SHOTS.splice(0, SHOTS.length - 400); } catch {} }
function fireGun(e, spec, t, aim) {
  const h = headLoc(e), c0 = aim ?? chest(t);
  let c = c0;
  try { const v = t.getVelocity(); const tt = Math.hypot(c0.x - h.x, c0.y - h.y, c0.z - h.z) / spec.speed; c = { x: c0.x + v.x * tt, y: c0.y, z: c0.z + v.z * tt }; } catch {}  // lead the target
  const mz = { x: h.x, y: h.y - 0.2, z: h.z };
  if (!openNow(e.dimension, mz, c)) { if (c !== c0 && openNow(e.dimension, mz, c0)) c = c0; else return false; }
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
  wallbang(e, spec, from, dir, l + 2);
  noteShot(e);
  return true;
}
// v6.9: through the wall, by accident. Nobody aims at a wall: but a shot that goes wide into cover, a burst at a window
// that clips the frame, a man who ducks behind a fence as the trigger is pulled: about 3 in 10 of those go through, if
// the wall is no more than 3 blocks thick and isn't made of something no bullet gets through (obsidian, bedrock, iron,
// netherite...). The bullet comes out the far side and flies on. (The one that hit the wall still hits it.)
const BULLETPROOF = ["obsidian", "bedrock", "barrier", "reinforced_deepslate", "netherite_block", "ancient_debris", "iron_block", "iron_door", "iron_trapdoor", "iron_bars", "anvil", "enchanting_table", "end_portal_frame", "respawn_anchor", "ender_chest", "structure_block", "command_block", "jigsaw", "end_gateway", "end_portal", "border_block"];
const WALLBANG = { chance: 0.3, thick: 3, perTick: 8 };
let bangsThisTick = 0, bangTick = -1;
function wallbang(e, spec, from, dir, maxL) {
  try {
    if (spec.bullet === "ww:nbazooka_projectile" || Math.random() >= WALLBANG.chance) return;
    const now = tick(); if (now !== bangTick) { bangTick = now; bangsThisTick = 0; }
    if (bangsThisTick >= WALLBANG.perTick) return;
    bangsThisTick++;
    const dim = e.dimension, n = Math.hypot(dir.x, dir.y, dir.z) || 1, u = { x: dir.x / n, y: dir.y / n, z: dir.z / n };
    const hit = dim.getBlockFromRay(from, u, { maxDistance: maxL, includeLiquidBlocks: false, includePassableBlocks: false });
    if (!hit?.block) return;                                          // nothing in the way: the bullet itself does the rest
    const bl = hit.block.location;
    let t = Math.max(0, (bl.x + 0.5 - from.x) * u.x + (bl.y + 0.5 - from.y) * u.y + (bl.z + 0.5 - from.z) * u.z - 1.2);
    const cells = new Set(); let out;
    for (let k = 0; k < 60 && t < maxL; k++, t += 0.15) {
      const x = Math.floor(from.x + u.x * t), y = Math.floor(from.y + u.y * t), z = Math.floor(from.z + u.z * t);
      const b = tBlock(dim, x, y, z);
      if (!b) return;
      if (!(b.isAir || b.isLiquid || passable(b))) {
        if (BULLETPROOF.some((w) => b.typeId.includes(w))) return;
        cells.add(`${x},${y},${z}`);
        if (cells.size > WALLBANG.thick) return;                      // too thick
      } else if (cells.size) { out = t; break; }
    }
    if (out === undefined) return;
    const at = { x: from.x + u.x * (out + 0.3), y: from.y + u.y * (out + 0.3), z: from.z + u.z * (out + 0.3) };
    const sp = spec.speed * (0.85 - 0.1 * cells.size);               // (slowed by the wall)
    const b2 = dim.spawnEntity(spec.bullet, at);
    const pc = b2.getComponent("minecraft:projectile");
    if (pc) { pc.owner = e; pc.shoot({ x: u.x * sp, y: u.y * sp, z: u.z * sp }); }
    wallbangs++;
  } catch {}
}
let wallbangs = 0;
const bangCount = () => wallbangs;
// v7.0: the nearest enemies (up to 4 checked) that his bullet can actually reach right now
function altTarget(e, d, now) {
  const near = nearSnap(e.dimension.id, e.location, 48).filter((c) => !c.down && c.id !== e.id && (c.type === SOLDIER || c.type === HOUND || c.type === "minecraft:player") && c.f && isHostile(d.faction, c.f) && c.e.isValid).sort((a, b) => a.dd - b.dd).slice(0, 4);
  const seen = perc.get(e.id)?.seen;                                        // only men he's actually had in view (noticed): no instant
  for (const c of near) if (seen?.has(c.id) && now - seen.get(c.id) >= 10 && isTargetFor(e, d, c.e) && canHit(e, c.e)) return c.e;   // shots at someone he never saw
  return undefined;
}
function gunTick(e, now) {
  if (downed.has(e.id)) return;
  const d = sd(e);
  const onNest = ridingNest(e);
  const spec = onNest ? NEST_SPEC : GUN_SPEC[d.weapon];
  if (pows.has(e.id)) return;
  // (v6.9.2: falling back he still fires at anyone within 20: a wounded man in a building with nowhere to run used to
  //  stand there and die without a shot)
  const backOff = d.retreat && !(perc.get(e.id)?.threat?.isValid && dist(perc.get(e.id).threat.location, e.location) < 20);
  if (!spec || d.surr || backOff || d.div === "medic" || (!onNest && !P(e, "war:gun"))) { if (P(e, "war:aiming")) setP(e, "war:aiming", false); return; }
  let st = gunState.get(e.id);
  if (!st) { st = { target: undefined, ammo: spec.mag, next: 0, seen: -999, check: 0, step: 0, back: 0 }; gunState.set(e.id, st); }
  if (now >= st.check) {
    st.check = now + 5;
    const ps = perc.get(e.id);
    const prev = st.target;
    const t = ps?.threat;
    st.target = t && t.isValid && canHit(e, t) ? t : undefined;         // only targets the bullet can actually reach
    if (!st.target && prev?.isValid && prev !== t && !downed.has(prev.id) && canHit(e, prev)) st.target = prev;   // (v7.0: still on the one he's shooting: no flip-flopping, which reset his aim every time)
    if (!st.target && !onNest && (t?.isValid || ps?.alert !== "calm" || squads.get(squadKey(e, d))?.known?.size)) st.target = altTarget(e, d, now);   // (v7.0: the one he's watching is out of reach: any other enemy he CAN hit)
    if (st.target && (!prev || prev.id !== st.target.id)) {
      if (!prev && Math.random() < 0.25) callout(e, "Enemy spotted!");   // (v6.9.1: eyes on a new one)
      const ang = facingAngle(e, st.target.location);          // new target: the aim needs to settle
      st.next = Math.max(st.next, now + (ang < 60 ? 6 : ang < 120 ? 12 : 20));
      st.wild = ang >= 120 ? 2 : 0;                             // first shots after a big turn are less accurate
    }
    const stance = String(gdp(e, "war:stance") ?? "aggressive");
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
  const aiming = now - st.seen < 40 || (st.supp?.until ?? 0) > now;
  if (!!P(e, "war:aiming") !== aiming) setP(e, "war:aiming", aiming);
  if (!st.target && st.supp && now < st.supp.until && now >= st.next && st.supp.ent?.isValid && !downed.has(st.supp.ent.id)) {   // v5.4: suppressing a window / doorway
    const p = st.supp.p, hl = headLoc(e);
    // v6.9: only while there's still a line from where he stands NOW to that window / doorway. He kept walking (into a
    // building, behind a wall) and kept firing at the old spot: into the ceiling, into the wall in front of him.
    if (!openNow(e.dimension, hl, p) && !openNow(e.dimension, hl, { x: p.x, y: p.y + 0.4, z: p.z })) { st.supp = undefined; st.next = now + 4; return; }   // (v6.9.2: a fresh ray, not the memory)
    if (!friendlyInLine(e, d, hl, p, st.supp.ent) && turnTo(e, p, 20) <= 25) {
      fireAtPoint(e, spec, { x: p.x, y: p.y - 1, z: p.z });
      st.lastShot = now; st.ammo--;
      if (st.ammo > 0) st.next = now + Math.max(2, spec.gap); else { st.ammo = spec.mag; st.next = now + spec.reload + Math.floor(Math.random() * 8); }
    } else st.next = now + 4;
    return;
  }
  if (!st.target || now < st.next) return;
  const t = st.target;
  if (!t.isValid) { st.target = undefined; return; }
  if (!shotAt(e, d, t, now)) return;                                    // beyond the gun's useful range, or a head too far to hit: close in first (v5.4)
  if (closeEnemy(e, d, 2.5)) return;                                    // hand-to-hand right now
  if (d.weapon === "at" && !VEHICLES.includes(t.typeId) && dist(t.location, e.location) < 6) { st.next = now + 6; return; }   // (v6.9.1: no rocket at a man this close: the blast would take him too)
  const from = headLoc(e);
  if (friendlyInLine(e, d, from, chest(t), t)) {                        // never shoot through a friendly
    if (now >= st.step && !isRiding(e)) { st.step = now + 25; sidestep(e, d, t); }
    st.next = now + 6;
    return;
  }
  if (turnTo(e, t.location, 20) > 25) { st.next = now + 2; return; } // still turning toward him
  const aim = aimAt(e, t);
  if (!aim) { st.next = now + 6; st.target = undefined; return; } // the shot would hit the terrain: don't waste it
  const shaky = ((suppB.get(e.id) ?? 0) > 8 ? 1.8 : 1) * woundK(e);  // pinned down / badly wounded: shaky aim
  const fired = st.wild > 0 ? fireGun(e, { ...spec, spread: spec.spread * 3 * shaky }, t, aim) : fireGun(e, shaky === 1 ? spec : { ...spec, spread: spec.spread * shaky }, t, aim);
  if (!fired) { st.next = now + 4; aimMemo.delete(`${e.id}>${t.id}`); return; }   // (v6.9.2: no open line this instant: hold fire)
  if (st.wild > 0) st.wild--;
  firedOn(t, e, now);
  if (t.typeId === "minecraft:player") shotAtPlayer.set(t.id, now);
  if (d.weapon === "mg" && st.ammo === spec.mag) callout(e, "Suppressing!");
  st.lastShot = now;
  suppressNear(t, d.weapon);
  st.ammo--;
  if (st.ammo > 0) st.next = now + Math.max(1, spec.gap);
  else {
    st.ammo = spec.mag; st.next = now + spec.reload + Math.floor(Math.random() * 8);
    try { e.dimension.playSound("random.click", e.location, { volume: 0.35, pitch: 0.7 }); } catch {}   // a quiet reload
    if (Math.random() < 0.6 && perc.get(e.id)?.threat) callout(e, "Reloading!");   // (not every reload, and only in a fight)
  }
}
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const st = gunState.get(e.id);
      if (st && !st.target && !(st.supp && st.supp.until > now) && now < st.check && !(now - st.seen < 42)) continue;   // v5.7: nothing to aim at until his next look
      if (GUNS.includes(String(gdp(e, "war:weapon") ?? "")) || ridingNest(e)) gunTick(e, now);
    } catch {}
  }
  if (now % 200 === 0) for (const id of [...gunState.keys()]) if (!world.getEntity(id)) gunState.delete(id);
}, 2);   // v5.7: every other tick (no gun fires faster than that)
world.afterEvents.entitySpawn.subscribe((ev) => { try { if (ev.entity.typeId === "war:blank") ev.entity.remove(); } catch {} });

// ================================================================ Taking cover (experimental)
const coverClaim = new Map(); // id -> { x, z, t } : cover spots already taken
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
      if (Number(gdp(e, "war:covert") ?? 0) > now) return;
      sdp(e, "war:covert", now + 200);
      const anchor = ["hold", "sentry", "stand"].includes(d.func) ? marker(d.goal) : undefined;
      const leash = stepLeash(d) + 1;
      const shooter = a.getHeadLocation ? headLoc(a) : a.location;
      for (const [id, c] of [...coverClaim]) if (now - c.t > 300 || id === e.id) coverClaim.delete(id);
      for (const r of [1.5, 3, 4.5]) for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const spot = { x: Math.floor(e.location.x + Math.cos(ang) * r) + 0.5, y: Math.floor(e.location.y), z: Math.floor(e.location.z + Math.sin(ang) * r) + 0.5 };
        if (anchor && flat(spot, anchor.location) > leash) continue;
        if (!standable(e.dimension, spot)) continue;
        if ([...coverClaim.values()].some((c) => Math.hypot(c.x - spot.x, c.z - spot.z) < 1.8)) continue;               // someone else's spot
        if (nearbyCombatants(e.dimension.id, spot, 1.2).some((o) => o.typeId === SOLDIER && o.id !== e.id)) continue;  // someone standing there
        const head = { x: spot.x, y: spot.y + 1.5, z: spot.z };
        if (!clearShot(e.dimension, head, shooter)) { coverClaim.set(e.id, { x: spot.x, z: spot.z, t: now }); nudge(e, spot, 0.3 + r * 0.12); return; } // blocked from the shooter: cover
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
const aimedBy = new Map();     // target id -> Set(soldier ids whose threat he is)  (v5.7: fire distribution)
system.runInterval(() => { for (const [id, set] of [...aimedBy]) { for (const sid of [...set]) if (perc.get(sid)?.threat?.id !== id) set.delete(sid); if (!set.size) aimedBy.delete(id); } }, 100);
const squadTarget = new Map(); // "faction:squad" -> { id, t }
const lastPos = new Map();     // combatant id -> {x,y,z,t}  (to tell moving from still)
const P1 = () => perc;         // (debug handle)
function pstate(e) {
  let s = perc.get(e.id);
  if (!s) { s = { seen: new Map(), threat: undefined, threatT: 0, lastSeen: undefined, lostT: 0, noise: undefined, noiseT: -999, alert: "calm", searchUntil: 0, pursue: 0 }; perc.set(e.id, s); }
  return s;
}
function sightOf(d) { return d.weapon === "sniper" ? 250 : GUNS.includes(d.weapon) ? 200 : 60; } // melee soldiers watch the near area
const lightMemo = new Map(); let todT = -1, todV = 6000;
function lightAt(dim, loc) {
  try {
    if (tick() !== todT) { todT = tick(); todV = world.getTimeOfDay(); }
    const k = `${dim.id}|${Math.floor(loc.x / 2)}|${Math.floor(loc.y)}|${Math.floor(loc.z / 2)}`, c = lightMemo.get(k);   // v5.6: light is remembered ~5 s per spot
    let block, sky;
    if (c && tick() - c.t < 100) { block = c.b; sky = c.s; }
    else { block = dim.getLightLevel(loc); sky = dim.getSkyLightLevel(loc); lightMemo.set(k, { b: block, s: sky, t: tick() }); if (lightMemo.size > 20000) lightMemo.clear(); }
    const t = todV; // 0..24000, night roughly 13000..23000
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
  const ps = poseOf.get(o.id) ?? 0; if (ps === 1) v *= 0.75; else if (ps === 2) v *= 0.5;  // kneeling / prone: a smaller shape
  return v;
}
const noiseFrom = new Map(); // entity id -> tick it last made combat noise
// Provocation: whoever attacks a faction's soldier or player becomes fair game for that faction
// (within ~48 blocks) for a while, even through Hold fire and even if his faction is neutral.
const provoked = new Map();  // "faction:attackerId" -> until tick
const assist = new Map();    // soldier id -> { id, t } : an attacker hurting a comrade nearby
function isProvoker(f, o, now) { return (provoked.get(`${f}:${o.id}`) ?? 0) > now; }
const provokedT = new Map(); // faction -> tick it was last provoked (v5.9: no provocation lookups for factions nobody attacked)
const rotMemo = new Map(); // id -> { t, y } (one rotation read per soldier per tick)
function facingAngle(e, to) {
  let r = rotMemo.get(e.id);
  if (!r || r.t !== tick()) { r = { t: tick(), y: e.getRotation().y }; rotMemo.set(e.id, r); if (rotMemo.size > 4000) rotMemo.clear(); }
  const yaw = r.y * Math.PI / 180;
  const fx = -Math.sin(yaw), fz = Math.cos(yaw);
  const dx = to.x - e.location.x, dz = to.z - e.location.z, l = Math.hypot(dx, dz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / l))) * 180 / Math.PI; // 0 = straight ahead
}
function reactionDelay(e, o, dd, now) {
  const ang = facingAngle(e, o.location);
  let t = ang < 60 ? 10 : ang < 120 ? 20 : 34;                 // front ~0.5 s, side ~1 s, behind ~1.7 s
  if (dd > 60) t += 10; if (dd > 120) t += 15;                   // far figures take longer to pick out
  t /= Math.max(0.25, realism().react);
  if (dd < 6) t *= 0.5;
  if (now - Number(noiseFrom.get(o.id) ?? -999) < 40) t *= 0.6;
  return t;
}
function attackedRecently(e, by, now, window = 100) { const h = hurtBy.get(e.id); return !!h && h.id === by.id && now - h.t < window; }
const hpMemo = new Map(); // id -> { t, r }  (health share, re-read at most every half second)
function hpRatio(o) {
  const c = hpMemo.get(o.id), now = tick();
  if (c && now - c.t < 10) return c.r;
  let r = 1; try { const h = o.getComponent("minecraft:health"); if (h) r = h.currentValue / h.effectiveMax; } catch {}
  hpMemo.set(o.id, { t: now, r }); if (hpMemo.size > 4000) hpMemo.clear();
  return r;
}
const isMob = (o) => o.typeId !== SOLDIER && o.typeId !== HOUND && o.typeId !== "minecraft:player" && !VEHICLES.includes(o.typeId);
function threatScore(e, d, o, dd, now) {
  let s = 100 - dd;                                              // closer = more dangerous
  if (isMob(o)) s -= 90;                                         // zombies are a nuisance, soldiers are the threat
  else s += 40;
  if (isProvoker(d.faction, o, now)) s += 50;
  if (d.weapon === "sniper" && o.typeId === "minecraft:player") s += 25;           // snipers hunt the leaders
  if (inHornCone(e, o, now)) s += 40;                                              // the War Horn's direction
  if (attackedRecently(e, o, now, 60) && dd < 6) s += 200;                         // self-defense comes first, always
  const as = assist.get(e.id);
  if (as && as.id === o.id && now - as.t < 200) s += 100;        // he's shooting at my comrades
  if (attackedRecently(e, o, now)) s += 120;                     // attacking me
  if (d.squad) {
    const st = squadTarget.get(`${d.faction}:${d.squad}`);
    const load = (aimedBy.get(o.id)?.size ?? 0) - (aimedBy.get(o.id)?.has(e.id) ? 1 : 0);   // squad mates already on him (not counting me)
    if (st && st.id === o.id && now - st.t < 100 && (bwOf(d.faction).dist === false || load < 3)) s += 40;   // focus fire: the squad's target (until it's covered)
    if (bwOf(d.faction).dist !== false && load >= 2 && !(attackedRecently(e, o, now, 60) && dd < 6)) s -= 14 * (load - 1);   // v5.7: two on him already: spread the fire
  }
  if (o.typeId === SOLDIER) {
    try {
      const od = sd(o);
      if (od.div === "medic") s -= 30;
      if (od.retreat) s -= 40;                                   // fleeing enemies last
      if (GUNS.includes(od.weapon) || od.ranged) s += 10;
      if (od.weapon === "mg") s += 12;                             // machine gunners first
      if (d.weapon === "sniper" && (od.weapon === "mg" || od.weapon === "at")) s += 20;
      const egs = gunState.get(o.id);
      if (egs && egs.ammo === (GUN_SPEC[od.weapon]?.mag ?? 1) && egs.next - now > 20) s += 8;  // caught reloading
      if (hpRatio(o) < 0.35) s += 15;  // finish off the wounded
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
  const eye = headLoc(e);
  // v5.7/5.9: cheap screen on the shared snapshot (friends, the downed, far mobs out), near ground first and wider only
  // if it's quiet nearby; the full target check only for the nearest few
  const prov = now - (provokedT.get(d.faction) ?? -99999) < 1200;
  const screen = (list) => {
    const out = [];
    for (const c of list) {
      if (c.id === e.id || c.down) continue;
      if (c.type === SOLDIER || c.type === HOUND || c.type === "minecraft:player") { if (c.f === d.faction && c.f) continue; if (!isHostile(d.faction, c.f) && !(prov && isProvoker(d.faction, c.e, now))) continue; }
      else if (VEHICLES.includes(c.type)) { if (d.weapon !== "at") continue; }
      else if (c.dd > 20) continue;
      out.push(c);
    }
    return out;
  };
  let near = screen(nearSnap(e.dimension.id, e.location, Math.min(base, 64)));
  if (near.length < 4 && base > 64) near = screen(nearSnap(e.dimension.id, e.location, base));
  if (near.length > 8) {                                              // the nearest 8 (a partial pick, not a full sort)
    const k8 = [];
    for (const c of near) {
      if (k8.length === 8 && c.dd >= k8[7].dd) continue;
      let j = Math.min(k8.length, 7);
      while (j > 0 && k8[j - 1].dd > c.dd) { k8[j] = k8[j - 1]; j--; }
      k8[j] = c;
    }
    near = k8;
  }
  const all = [];
  for (const c of near) { if (c.e.isValid && isTargetFor(e, d, c.e)) all.push({ o: c.e, dd: c.dd }); }
  const soldiersAround = all.some((c) => !isMob(c.o));
  const cands = all
    // mid-battle, distant mobs are ignored unless they're on top of him or attacking
    .filter((c) => !isMob(c.o) || !soldiersAround || c.dd < 6 || attackedRecently(e, c.o, now))
    .sort((a, b) => (Number(isMob(a.o)) - Number(isMob(b.o))) || a.dd - b.dd)
    .slice(0, bigBattle ? 3 : 5);                                // nearest few only (keeps raycasts cheap; v6.0: 3 in a huge battle)
  const visible = new Set();
  let best, bestScore = -1e9;
  for (const { o, dd } of cands) {
    const reach = base * (0.35 + 0.65 * lightAt(e.dimension, o.location) / 15) * visibility(o, now);
    const asg = assist.get(e.id);
    const fa = firedAt.get(e.id);
    const attacking = attackedRecently(e, o, now) || (!!asg && asg.id === o.id && now - asg.t < 200) || (!!fa && fa.by === o.id && now - fa.t < 100);
    if (dd > reach && !attacking) continue;
    if (!attacking && !clearShot(e.dimension, eye, chest(o)) && !((o.typeId === SOLDIER || o.typeId === "minecraft:player") && clearShot(e.dimension, eye, headOf(o)))) continue;   // a head in a window counts
    visible.add(o.id);
    if (!s.seen.has(o.id)) s.seen.set(o.id, now);
    const shared = d.squad && squadTarget.get(`${d.faction}:${d.squad}`)?.id === o.id;
    if (!attacking && !shared && now - s.seen.get(o.id) < reactionDelay(e, o, dd, now)) continue; // not noticed yet
    const sc = threatScore(e, d, o, dd, now);
    if (sc > bestScore) { bestScore = sc; best = o; }
  }
  for (const id of [...s.seen.keys()]) if (!visible.has(id)) s.seen.delete(id);
  if (best) {
    if (!s.threat || s.threat.id !== best.id) { s.threatT = now; if (!s.threat && Math.random() < 0.75) callout(e, "Enemy spotted!"); }
    if (s.threat?.id !== best.id) { if (s.threat) aimedBy.get(s.threat.id)?.delete(e.id); let set = aimedBy.get(best.id); if (!set) { set = new Set(); aimedBy.set(best.id, set); } set.add(e.id); }
    s.threat = best; s.lastSeen = { ...best.location }; s.lostT = 0; s.alert = "combat";
    if (d.squad) squadTarget.set(`${d.faction}:${d.squad}`, { id: best.id, t: now });
  } else if (s.threat) {
    if (!s.lostT) s.lostT = now;
    if (!s.threat.isValid || now - s.lostT > 40) {                // lost him: search ~5 s (v6.3: was 10). Killed him: nothing to search for
      const dead = !s.threat.isValid || downed.has(s.threat.id) || pows.has(s.threat.id) || (s.threat.getComponent?.("minecraft:health")?.currentValue ?? 1) <= 0;
      aimedBy.get(s.threat.id)?.delete(e.id); s.threat = undefined; s.searchUntil = s.lastSeen && !dead ? now + 100 : 0;
    }
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
      provoked.set(`${fv}:${a.id}`, now + 1200); provokedT.set(fv, now);   // ~1 minute
      if (!isMob(a)) { try { helpInArea(v, a, fv, now); } catch {} }
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
// v5.9: perception is a rotation with a fixed budget per tick too (everyone every ~half second up to ~320 soldiers);
// soldiers in the background look every third turn
const PERC_MAX = 32;
let percCursor = 0, percAcc = 0, bigBattle = false;
const percPass = new Map();
system.runInterval(() => {
  const now = tick();
  const list = allOf(SOLDIER), n = list.length;
  if (n) {
    bigBattle = n > 300;
    percAcc = Math.min(bigBattle ? 24 : PERC_MAX, percAcc + n / 10);
    const per = Math.min(n, Math.floor(percAcc));
    percAcc -= per;
    for (let k = 0; k < per; k++) {
      const e = list[(percCursor + k) % n];
      try {
        if (!e.isValid) continue;
        const pass = (percPass.get(e.id) ?? 0) + 1; percPass.set(e.id, pass);
        if (!isHot(e, now) && pass % 3) continue;
        perceive(e, now);
      } catch (err) { oops("perception", err); }
    }
    percCursor = (percCursor + per) % n;
  }
  if (now % 400 === 0) {
    for (const id of [...perc.keys()]) if (!world.getEntity(id)) perc.delete(id);
    for (const [id, h] of [...hurtBy]) if (now - h.t > 400) hurtBy.delete(id);
    for (const [k, t] of [...squadTarget]) if (now - t.t > 400) squadTarget.delete(k);
    for (const id of [...percPass.keys()]) if (!world.getEntity(id)) percPass.delete(id);
  }
}, 1);

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
  const goals = new Set(allOf(SOLDIER).map((s) => Number(gdp(s, "war:goal") ?? 0)));
  for (const [id, slot] of [...threatSlot]) {
    if (goals.has(slot)) continue;
    const t = world.getEntity(id);
    try { if (t) untagMarker(t); } catch {}
    threatSlot.delete(id);
  }
}, 40);

// ---- the decision: what this soldier does about what he perceives, by stance and order
const ANCHOR_LEASH = (d, melee) => d.func === "post" ? (melee ? 4 : 2) : d.func === "sentry" ? d.radius + 4 : d.func === "hold" ? 18 : d.func === "stand" ? 4 : Infinity;
// v6.0: committing to a fight. On the move (a march, a patrol) a soldier who has engaged an enemy soldier or player
// fights him until he's down, gone (nobody in the squad has seen him for 15 s) or far away, and only then goes back
// to the order: no more "shoot, march on, see him again, stop again" loops. A new order breaks the lock at once.
const combatLock = new Map(); // id -> { id, ent, t (start), seenT, at }
const LOCK_LOST = 120;   // (v6.3: 6 s, was 15: they stood scanning long after the fight was over)
const gun0 = (d) => GUNS.includes(d.weapon) || MELEE_W.includes(d.weapon) || d.weapon === "crossbow";
function updateLock(e, d, s, now) {
  let L = combatLock.get(e.id);
  const t = s?.threat;
  if (t?.isValid && (t.typeId === SOLDIER || t.typeId === "minecraft:player") && !downed.has(t.id)) {
    const dd = dist(t.location, e.location);
    if (L?.id === t.id || dd <= Math.max(60, engageRange(e, d, t, now))) {
      if (!L || L.id !== t.id) { L = { id: t.id, ent: t, t: now }; combatLock.set(e.id, L); }
      L.seenT = now; L.at = { x: t.location.x, y: t.location.y, z: t.location.z };
    }
  }
  if (!L) return undefined;
  const mo = marchOfE(e);
  if (mo?.dest && Math.hypot(L.at.x - mo.dest.x, L.at.z - mo.dest.z) < 35) { combatLock.delete(e.id); return undefined; }   // the enemy IS the objective: pressing on there is the fight
  const S = squads.get(squadKey(e, d)), q = S?.known?.get(L.id);
  if (q && now - q.t < 40 && q.t > (L.seenT ?? 0)) { L.seenT = q.t; L.at = { x: q.x, y: q.y, z: q.z }; }   // a mate still sees him
  const ent = L.ent;
  const gone = !ent?.isValid || downed.has(L.id) || pows.has(L.id) || (ent.typeId === SOLDIER && gdp(ent, "war:surr")) || !isHostile(d.faction, factionOf(ent))
    || (ent.typeId === "minecraft:player" && (ent.getComponent("minecraft:health")?.currentValue ?? 1) <= 0);   // (v6.3: a killed player stays a valid entity)
  if (gone || now - L.seenT > LOCK_LOST || Number(gdp(e, "war:ordt") ?? -1) > L.t || dist(L.at, e.location) > 110) { combatLock.delete(e.id); return undefined; }
  return L;
}
function engagement(e, d, now, orderGoal, melee) {
  const s = perc.get(e.id);
  if (!s || d.retreat || d.surr || d.div === "medic" || d.func === "escort" || d.func === "squad") return undefined;
  const L = ["charge", "patrol"].includes(d.func) && setting("commit", true) ? updateLock(e, d, s, now) : undefined;
  const stance = String(gdp(e, "war:stance") ?? "aggressive");
  const anchor = ["hold", "post", "sentry", "stand"].includes(d.func) ? marker(orderGoal) : undefined;
  let leash = ANCHOR_LEASH(d, melee);
  if (freeOf(e) && d.func === "hold") leash = aoOf(e);                        // the whole area of operations is theirs
  const gun = GUNS.includes(d.weapon);
  const t = s.threat;
  if (t && t.isValid) {
    if (stance === "holdfire" && !isProvoker(d.faction, t, now)) return undefined; // hold fire until someone of ours is attacked
    turnTo(e, t.location);
    const dd = dist(t.location, e.location);
    if (anchor && flat(t.location, anchor.location) > leash) {        // fight from the post
      // v6.4: ...from the best spot of it: no shot from where he stands (behind a merlon, back from a window) -> the
      // spot within his post's reach that sees the enemy (a battlement gap, the window), never further
      if (gun && !canHit(e, t) && spendDecision()) {
        const tc = chest(t);
        const spot = spotNear(e, (w) => clearShot(e.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, tc), anchor, Math.max(leash, 2.5), 6);
        if (spot) { const mv = moveTo(e, spot, now, true, "spot"); if (mv) { note(e, "taking a firing slot"); return mv; } }
      }
      note(e, "holding post"); return undefined;
    }
    if (stance === "defensive") { note(e, "defending"); return { g: "g_none", t: melee ? "t_short" : "t_mid", urgent: false }; }
    if (isMob(t) && dd > 10) return undefined;                  // shoot an attacking mob if it's there, never chase it
    if (gun) {
      // v5.4: stop to shoot only within the gun's useful range and with a clear shot; no clear shot -> go and get one
      // (a spot nearby that sees him, his floor if he's above or below, or along a real route toward him)
      const range = engageRange(e, d, t, now);
      const stopRange = Math.min(range, ["charge", "follow"].includes(d.func) && !L ? 45 : 90);
      if (dd <= stopRange && shotAt(e, d, t, now)) { note(e, "firing"); return { g: "g_none", t: "t_mid", urgent: false }; } // stop and shoot
      if (dd <= stopRange) {
        const tc = chest(t);
        const spot = spotNear(e, (w) => clearShot(e.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, tc), anchor, leash, 8);
        if (spot) { const mv = moveTo(e, spot, now, true, "spot"); if (mv) { note(e, "moving for a clear shot"); return mv; } }
        if (anchor && freeOf(e) === false) return undefined;                                   // exactly as ordered: stay
        if (t.location.y < e.location.y - 2.5) { const pq = perchFor(e, tc, anchor, leash, now); if (pq) { const mv = moveTo(e, pq, now, true, "spot"); if (mv) { note(e, "stepping up to the edge for a shot"); return mv; } } }   // (v6.9)
        const goPlan = ["sortie", "assault"].includes(squads.get(squadKey(e, d))?.bplan?.kind) && brain.get(e.id)?.role?.kind === "advance";   // (v7.0: only his part in the squad's plan takes him down)
        if (anchor && t.location.y < e.location.y - 2.5 && Math.abs(anchor.location.y - e.location.y) < 1.5 && !goPlan) { note(e, "holding the high ground"); return { g: "g_none", t: "t_mid", urgent: false }; }   // (v6.9: told to hold a roof / a wall: he never gives it up to go down to them)
        if (Math.abs(t.location.y - e.location.y) > 2.5) {
          if (!personal.has(e.id)) planPersonalTo(e, "advance", { x: t.location.x, y: t.location.y, z: t.location.z }, now);
          return followPersonal(e, now);
        }
        note(e, "moving for a clear shot");
        return travel(e, t.location, "engage", now, true);
      }
      const moving = ["charge", "follow", "patrol"].includes(d.func) && !L;   // (locked on: he goes after him, not on with the order)
      if (dd > 60 || moving) { note(e, dd > range ? `closing in (${Math.round(dd)} blocks)` : `firing at ${Math.round(dd)} blocks`); return undefined; } // keep to the order: it's taking him there (the brain fights close in)
      if (!anchor) { note(e, "closing in"); return travel(e, t.location, "engage", now, true); }        // a real route, not vanilla's beeline
    } else if (dd > 40 && !attackedRecently(e, t, now)) return undefined;     // melee doesn't run 100 blocks after someone
    note(e, isMob(t) ? "fighting a mob" : "engaging");
    const slot = slotForThreat(t);
    return slot ? { g: "g_wp", slot, t: "t_mid", urgent: true } : { g: "g_none", t: "t_mid", urgent: true };
  }
  if (L?.at && gun0(d)) {                                                     // locked on and he's out of sight: hunt him down
    const dl = dist(L.at, e.location);
    if (dl > 5) { note(e, "hunting the enemy"); return travel(e, L.at, "engage", now, true); }
    if (now - L.seenT > 50) { combatLock.delete(e.id); return undefined; }   // (v6.3: where he was last seen and he's not there: a quick look, then on)
    note(e, "searching for the enemy");
    turnTo(e, { x: e.location.x + Math.cos(now / 7), z: e.location.z + Math.sin(now / 7) }, 25);
    return { g: "g_none", t: "t_mid", urgent: false };
  }
  const moving = ["charge", "follow", "patrol"].includes(d.func);
  if (moving && s.searchUntil > now + 40) s.searchUntil = now + 40;          // marching: a quick look, then carry on
  if (anchor && s.searchUntil > now + 40) s.searchUntil = now + 40;          // posts: don't wander off searching
  if (s.searchUntil > now && s.lastSeen && stance !== "defensive" && stance !== "holdfire") {
    if (dist(e.location, s.lastSeen) < 3) { s.searchUntil = Math.min(s.searchUntil, now + 40); turnTo(e, { x: e.location.x + Math.cos(now / 7), z: e.location.z + Math.sin(now / 7) }, 25); }
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
function saveMarches() {
  const slim = {};
  for (const [id, m] of Object.entries(marches ?? {})) { const { path, legs, ...rest } = m; slim[id] = rest; }
  try { setJSON(world, "war:marches2", slim); } catch {}
}
const spacingSetting = () => Math.max(1, Math.min(2, Number(setting("spacing", 1.5))));
const HAZARD = ["lava", "fire", "magma", "cactus", "sweet_berry", "powder_snow", "campfire"];
const CLIMB = ["ladder", "vine", "scaffolding"];
// v5.7: what a block type means for walking is worked out once per type and remembered (these checks run hundreds of
// thousands of times in a battle; scanning name lists every time was the add-on's biggest CPU cost)
const TYPE_INFO = new Map();
function TI(id) {
  let t = TYPE_INFO.get(id);
  if (t) return t;
  const door = id.includes("door"), trap = id.includes("trapdoor"), iron = id.includes("iron");
  t = {
    woodDoor: door && !iron && !trap,
    climb: CLIMB.some((k) => id.includes(k)),
    plantish: PASSABLE.some((q) => id.includes(q)) && !id.includes("grass_block"),
    ironDoor: id.includes("iron_door") && !trap,
    plate: id.includes("pressure_plate"),
    openableId: (trap && !iron) || id.includes("fence_gate") || (door && !iron),
    openable: (trap && !iron) || id.includes("fence_gate"),
    tall: id.includes("fence") || /_wall$/.test(id) || id.endsWith(":cobblestone_wall"),
    trap, leaves: id.includes("leaves"), hazard: HAZARD.some((h) => id.includes(h)), water: id.includes("water"),
    stairs: id.includes("stairs") || id.includes("slab"),
  };
  t.pass = t.woodDoor || t.plantish;
  TYPE_INFO.set(id, t);
  return t;
}
const isClimb = (b) => !!b && TI(b.typeId).climb;
const isWoodDoor = (b) => !!b && TI(b.typeId).woodDoor;
const PASSABLE = ["ladder", "vine", "scaffolding", "short_grass", "tall_grass", "fern", "flower", "dandelion", "poppy", "tulip", "orchid", "allium", "bluet", "daisy", "cornflower", "lily", "bush", "sapling", "snow_layer", "torch", "carpet", "vine", "button", "lever", "rail", "redstone_wire", "pressure_plate", "sign", "dead_bush", "seagrass"];
const passable = (b) => !!b && (b.isAir || TI(b.typeId).pass);
// a spot a soldier can stand on, searched up and down from refY; undefined if none (or not loaded)
function walkableNear(dim, x, z, refY) {
  const bx = Math.floor(x) + 0.5, bz = Math.floor(z) + 0.5;
  for (const dy of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) {
    const y = Math.floor(refY) + dy;
    try {
      const floor = tBlock(dim, bx, y - 1, bz), feet = tBlock(dim, bx, y, bz), head = tBlock(dim, bx, y + 1, bz);
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
  if (isIndoorsAt(dim, center)) {
    // indoors: on the march, single file along the route behind the guide (never all on one spot); on arrival,
    // separate spots in the same room, on the same floor
    m.lanes.forEach((slot, i) => {
      let at = center;
      if (!m.final && m.path) at = m.path[Math.max(0, (m.idx ?? 0) - i * 2)];
      else if (i) {
        for (let r = 1.5; r <= 4.5 && at === center; r += 1.5) for (let k = 0; k < 8; k++) {
          const a = ((k + i * 3) / 8) * Math.PI * 2, w = walkableNear(dim, center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, center.y);
          if (w && Math.abs(w.y - center.y) <= 0.5 && !dangerNear(dim, w) && localReach(dim, center, w)) { at = w; break; }
        }
      }
      try { marker(slot)?.teleport(at); } catch {}
    });
    m.shape = "single file"; return;
  }
  const S = spacingSetting() * 2, fx = Math.cos(heading), fz = Math.sin(heading), rx = -fz, rz = fx;
  m.lanes.forEach((slot, i) => {
    const [ox, oy] = SHAPES[shape][i % 6];
    const x = center.x + rx * ox * S + fx * oy * S, z = center.z + rz * ox * S + fz * oy * S;
    let w = walkableNear(dim, x, z, center.y);
    if (w && (dangerNear(dim, w) || (m.final && !localReach(dim, center, w)))) w = undefined;   // (v6.2: never a lane by a drop / lava)
    if (!w || Math.abs(w.y - center.y) > 1) {                   // unusable spot: nearest usable one around it
      w = undefined;
      for (let r = 1; r <= 3 && !w; r++) for (let k = 0; k < 8 && !w; k++) {
        const a = (k / 8) * Math.PI * 2;
        const c2 = walkableNear(dim, x + Math.cos(a) * r, z + Math.sin(a) * r, center.y);
        if (c2 && dangerNear(dim, c2)) continue;
        if (c2 && Math.abs(c2.y - center.y) <= 1) w = c2;
      }
      if (!w) for (let r = 4; r <= 8 && !w; r += 2) for (let k = 0; k < 12 && !w; k++) {   // (v6.4: still nothing: further out, rather than in the water)
        const c2 = walkableNear(dim, center.x + Math.cos((k / 12) * Math.PI * 2) * r, center.z + Math.sin((k / 12) * Math.PI * 2) * r, center.y);
        if (c2 && !dangerNear(dim, c2) && Math.abs(c2.y - center.y) <= 2) w = c2;
      }
      w = w ?? center;
    }
    try { marker(slot)?.teleport(w); } catch {}
  });
  m.shape = shape;
}
// v5.9: every marching soldier's own spot in the formation: the shape's six places side by side, further rows behind
// for bigger squads; in single file (narrow ground, indoors) the route itself, a couple of points apart. Each spot is
// solid ground on the guide's level that he can walk to in a line from the guide, else the route behind the guide.
const formMode = new Set(); // soldiers on a march walking to their own formation spot
const driveOn = new Map();  // id -> { off } soldiers stepping the route themselves (with the hold time before switching back)
// a new catch-up marker: if he was walking to the old one, he walks to the new one at once (not at his next thought)
function setCatchup(e, slot) {
  const old = gdp(e, "war:catchup");
  if (old === slot) return;
  sdp(e, "war:catchup", slot);
  if (old !== undefined && Number(gdp(e, "war:goal") ?? 0) === Number(old)) setGoal(e, slot);
}
function placeFormation(m, dim, p0, list, shape) {
  // Minecraft's walking stops 3 blocks short of a marker: the markers ride ~3 blocks of route ahead of the places
  const path = m.path ?? [p0];
  let ci = m.path ? Math.min(path.length - 1, m.idx ?? 0) : 0, len = 0;
  while (ci < path.length - 1 && len < 3) { const a = path[ci], b = path[ci + 1]; len += Math.hypot(b.x - a.x, b.z - a.z); ci++; }
  const p = m.path ? path[ci] : { x: p0.x + Math.cos(m.heading) * 3, y: p0.y, z: p0.z + Math.sin(m.heading) * 3 };
  const S = spacingSetting() * 2, fx = Math.cos(m.heading), fz = Math.sin(m.heading), rx = -fz, rz = fx;
  const pat = SHAPES[shape] ?? SHAPES.line;
  const single = shape === "column" || shape === "single file";
  const back = (k) => path[Math.max(0, ci - k)];
  list.forEach((e, i) => {
    if (personal.has(e.id)) return;                                 // on an errand of his own
    const cu = gdp(e, "war:catchup");
    if (gdp(e, "war:ordergoal") !== undefined && (cu === undefined || Number(gdp(e, "war:goal") ?? 0) !== Number(cu))) return;   // fighting: the brain moves him
    let at;
    if (single) at = back((i + 1) * 2);
    else {
      const [ox, oy] = pat[i % pat.length], row = Math.floor(i / pat.length);
      const x = p.x + rx * ox * S + fx * (oy - row * 1.5) * S, z = p.z + rz * ox * S + fz * (oy - row * 1.5) * S;
      const w = walkableNear(dim, x, z, p.y);
      if (w && Math.abs(w.y - p.y) <= 1 && !dangerNear(dim, w) && straightReach(dim, p, w)) at = w;   // (v6.2: never beside a drop / lava)
      else at = back(2 + row * 2 + (i % 2));
    }
    const slot = myMarker(e, at, "war:fmk");                      // (his own formation marker: never the one his fight moves use)
    if (slot) setCatchup(e, slot);
  });
}
// ================================================================ v6.2: orders: the limit and telling the faction
const orderLimit = () => Math.max(50, Number(setting("olimit", 500)));
const msgSeen = new Map(); // text -> tick (the same message at most every 3 s)
function factionMsg(f, text, fallback) {
  const now = tick();
  if (now - (msgSeen.get(text) ?? -999) < 60) return;
  msgSeen.set(text, now);
  if (msgSeen.size > 200) msgSeen.clear();
  let sent = false;
  if (f) for (const p of world.getAllPlayers()) { try { if (playerFaction(p) === f) { p.sendMessage(text); sent = true; } } catch {} }
  if (!sent && fallback) { try { fallback.sendMessage(text); } catch {} }
}
function announceMarch(player, fac, m, from) {
  if (!m) return;
  const d = Math.round(Math.hypot(m.dest.x - from.x, m.dest.z - from.z));
  let loaded = true;
  try { loaded = !!player.dimension.getBlock({ x: m.dest.x, y: Number.isFinite(m.dest.y) ? m.dest.y : from.y, z: m.dest.z }); } catch { loaded = false; }
  factionMsg(fac, `§7${squadLabel(m)} -> (${Math.round(m.dest.x)}, ${Math.round(m.dest.z)}), ${d} blocks${loaded ? "" : " (part of the way isn't loaded yet: they go as far as it is and carry on as it loads)"}`, player);
}
const squadLabel = (m) => { if (!m.sq) return "Your soldiers"; let n; try { n = getSquads()[m.fac]?.[m.sq - 1]; } catch {} return n || `Squad ${m.sq}`; };
// v6.4: an order to a spot nobody can stand on (water, lava, the air beside a cliff): the nearest dry, safe spot to it,
// on the squad's side. Ordered into a pond by a wall, the whole squad used to "arrive" in the water and stay there.
function dryDest(dim, dest, from) {
  try {
    const x = Math.floor(dest.x), y = Math.floor(Number.isFinite(dest.y) ? dest.y : from.y), z = Math.floor(dest.z);
    const wetAt = (q) => { for (const k of [0, -1]) { const b = tBlock(dim, q.x, q.y + k, q.z); if (b && (b.typeId.includes("water") || b.typeId.includes("lava"))) return true; } return false; };
    const here = walkableNear(dim, dest.x, dest.z, y);
    if (here && Math.abs(here.y - y) <= 2 && !wetAt(here) && !dangerNear(dim, here)) return dest;
    let best, bs = 1e9;
    const L = Math.hypot(from.x - dest.x, from.z - dest.z) || 1, ux = (from.x - dest.x) / L, uz = (from.z - dest.z) / L;
    for (let r = 1; r <= 10; r++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, w = walkableNear(dim, x + 0.5 + Math.cos(a) * r, z + 0.5 + Math.sin(a) * r, y);
        if (!w || wetAt(w) || dangerNear(dim, w) || Math.abs(w.y - y) > 3) continue;
        const proj = (w.x - dest.x) * ux + (w.z - dest.z) * uz;   // >0: on the squad's side of the spot
        const sc = r * 2 + (proj < 0 ? -proj * 3 : 0) + Math.abs(w.y - y);   // close to the spot, on the squad's side (not past a wall)
        if (sc < bs) { bs = sc; best = w; }
      }
      if (best && bs < r * 2) break;                            // nothing further out can beat it
    }
    return best ? { x: best.x, y: best.y, z: best.z } : dest;
  } catch { return dest; }
}
function startMarch(player, pool, dest, then) {
  let cx = 0, cy = 0, cz = 0;
  for (const e of pool) { cx += e.location.x; cy += e.location.y; cz += e.location.z; }
  cx /= pool.length; cy /= pool.length; cz /= pool.length;
  const dim = player.dimension, from = { x: cx, y: cy, z: cz };
  dest = dryDest(dim, dest, from);
  const m = { pos: from, dest, dim: dim.id, then, final: false, lanes: [], heading: Math.atan2(dest.z - cz, dest.x - cx),
    path: undefined, idx: 0, planning: false, progT: tick(), replans: 0, members: pool.map((e) => e.id), fac: sd(pool[0]).faction, sq: sd(pool[0]).squad };
  const nLanes = Math.min(6, Math.max(2, Math.ceil(pool.length / 4)));
  for (let i = 0; i < nLanes; i++) { const s = makeWaypoint(dim, from, false); if (s) m.lanes.push(s); }
  if (!m.lanes.length) return undefined;
  const id = `m${tick()}_${m.lanes[0]}`;
  getMarches()[id] = m;
  for (const s of m.lanes) laneOf.set(s, id);
  // don't stand around while the route is worked out: start walking toward the destination
  const L0 = Math.hypot(dest.x - cx, dest.z - cz) || 1, st0 = Math.min(12, L0);
  const first = walkableNear(dim, cx + ((dest.x - cx) / L0) * st0, cz + ((dest.z - cz) / L0) * st0, cy);
  try { if (first && !isIndoorsAt(dim, from) && Math.abs(first.y - cy) <= 1 && localReach(dim, from, first)) { placeLanes(m, dim, first, m.heading, "line"); m.early = true; m.earlyAt = { x: first.x, y: first.y, z: first.z }; } } catch {}   // v5.4: no standing around (outdoors)
  requestPlan(id, m, from);
  saveMarches();
  callout(pool[Math.floor(Math.random() * pool.length)], "Follow me!");   // (v6.5)
  return { id, lanes: m.lanes };
}
// Long or blocked routes: first a coarse map (4-block cells, ~420 blocks around) finds which WAY works
// (e.g. around the mountain), split into legs of ~28 blocks; each leg is then planned block by block.
// "wide" = after a dead end: search wider and less straight-at-the-goal.
function requestPlan(id, m, from, wide = false) {
  const dim = world.getDimension(m.dim);
  m.planning = true;
  const far = Math.hypot(m.dest.x - from.x, m.dest.z - from.z) > 160;   // (v6.2: was 280: at the game's real script speed a 200-block fine search took ages and hit its size cap)
  // (v6.2: also when only the final leg is left of an earlier coarse plan, e.g. one cut short by unloaded land: a fine
  // search all the way to a far destination took a minute of planning while the squad stood at the end of its route)
  if ((!m.legs || m.legs.length <= 1) && far) {
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
    }, { step: 4, maxRadius: 420, max: wide ? 16000 : 9000, weight: wide ? 1.0 : 1.2, dead: m.dead, prio: true });
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
    // v6.1: no full route within the direct search (a big detour around a long wall, a river, a mountain): plan it the
    // way long orders are planned, on the coarse map that looks ~400 blocks around, in short legs
    if ((!pts || (partial && !frontier)) && lastLeg && !mm.legs?.length && !mm.coarse) { mm.coarse = true; requestPlan(id, mm, from, wide); return; }
    mm.frontier = !!(partial && frontier);                      // stopped at unloaded land: just the next stretch, not a dead end
    if (pts && partial) {                                       // v6.2: a route cut short never ends down in a pit (a trench with no way out)
      const top = Math.max(...pts.slice(-8).map((q) => q.y));
      let n = pts.length;
      while (n > 2 && pts[n - 1].y <= top - 2 && !pts[n - 1].climb) n--;
      if (n < pts.length) pts = pts.slice(0, n);
    }
    if (pts) { mm.path = pts; mm.idx = 0; mm.bestIdx = 0; }
    else if (!lastLeg) {                                        // this leg point can't be reached: it was a bad corridor
      markDeadEnd(mm, target);
      mm.path = undefined;                                      // the march loop will plan again (a new corridor)
    } else if (!mm.path) {                                      // nothing found yet: head straight and try again later
      mm.path = [{ x: from.x, y: from.y, z: from.z, w: false }, { x: target.x, y: target.y ?? from.y, z: target.z, w: false }];
      mm.path.guess = true;                                     // v5.9: a guess, not a route: never carried along it (that went through walls)
      mm.idx = 0; mm.bestIdx = 0;
    }
    mm.progT = tick();
    saveMarches();
  }, { step: 1, maxRadius: 300, max: 120000, weight: wide ? 1.0 : 1.15, dead: m.dead, prio: true });
}
function markDeadEnd(m, at, small = false) {
  const near = (m.dead ?? []).filter((z) => Math.hypot(z.x - at.x, z.z - at.z) < 30).length;
  m.dead = (m.dead ?? []).concat([{ x: at.x, z: at.z, r: small ? 4 + 2 * Math.min(3, near) : 14 + 6 * Math.min(4, near) }]).slice(-16);
  m.legs = undefined;                                          // the corridor was wrong: rethink the whole way
}
// v5.3: how far along a route a soldier is. 3D (another floor is far away, not close) and windowed: it only
// moves a little back or forward from where he was, so a spiral stair or a ladder shaft can't make him "jump"
// to a point above or below him. One cheap search per soldier instead of scanning the whole route every time.
const rTrack = new Map(); // soldier id -> { pts, i, t }
const r3 = (p, l) => Math.hypot(p.x - l.x, p.z - l.z) + Math.abs(p.y - l.y) * 3;
function nearestIdx(pts, loc, lo, hi, prefer) {
  let bi = prefer ?? lo, bd = prefer !== undefined && pts[prefer] ? r3(pts[prefer], loc) - 0.01 : 1e9;
  for (let i = lo; i < hi; i++) { const d0 = r3(pts[i], loc); if (d0 < bd) { bd = d0; bi = i; } }
  return bi;
}
function trackIdx(id, pts, loc) {
  let t = rTrack.get(id);
  if (!t || t.pts !== pts) { t = { pts, i: nearestIdx(pts, loc, 0, pts.length), t: tick() }; rTrack.set(id, t); return t.i; }
  if (tick() - t.t > 200) t.i = nearestIdx(pts, loc, 0, pts.length);                        // long gap (unloaded, teleported): look again
  else t.i = nearestIdx(pts, loc, Math.max(0, t.i - 3), Math.min(pts.length, t.i + 14), t.i);
  t.t = tick();
  return t.i;
}
system.runInterval(() => { for (const id of [...rTrack.keys()]) if (!world.getEntity(id)) rTrack.delete(id); }, 1200);
// a point is a "gate" when ordinary walking can't be trusted past it: a ladder, a change of level, something to open
const isGate = (a, b) => b.climb || a.climb || b.open || Math.abs(b.y - a.y) >= 2;
// how far ahead along the route the guide may go: about maxLen blocks of route, but never past a gate
// (the group gets to the foot of the ladder / stair / door first, then the next stretch opens up)
function lookahead(pts, from, maxLen) {
  let len = 0, j = from;
  const y0 = pts[from].y;
  while (j < pts.length - 1) {
    const a = pts[j], b = pts[j + 1];
    if (isGate(a, b) && j > from) break;
    if (Math.abs(b.y - y0) > 1.5 && j > from) break;                                    // one level at a time
    len += Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y);
    j++;
    if (len >= maxLen || b.climb) break;
  }
  return j;
}
function routeProgress(m, loc, id) {
  if (id) return trackIdx(id, m.path, loc);
  return nearestIdx(m.path, loc, 0, m.path.length);
}
// next route point that's a few blocks ahead of the lead (route distance, not straight-line), stopping at gates
function advance(m, c) { void m; void c; }   // (v5.3: the guide position is set from the lead's progress above)
// ---- the march loop (v5.4). The guide (formation lanes) runs ~6 blocks of route ahead of the front of the group and
// never waits at a stair, ladder or door. Where plain walking can't be trusted (indoors, stairs, ladders, doors, a level
// change just ahead) and for stragglers, each soldier follows the route himself on his own marker, in single file
// (the route driver below), so nobody piles onto one spot. Downed, captured or mounted members don't set the pace
// and nobody waits for them; they rejoin if they get back up.
const marchActive = (e) => !downed.has(e.id) && !pows.has(e.id) && !isRiding(e) && !sd(e).surr;
// does the route need careful single-file following from point i on (for a soldier at loc)?
// standing on stairs or a slab (castle wall stairs, a staircase in a house): Minecraft's walking gets confused there
function onStairs(dim, p) { try { const b = tBlock(dim, p.x, Math.floor(p.y + 0.01) - 1, p.z), c = tBlock(dim, p.x, Math.floor(p.y + 0.01), p.z); return [b, c].some((x) => !!x && (x.typeId.includes("stairs") || x.typeId.includes("slab"))); } catch { return false; } }
function tightAt(dim, pts, i, loc) {
  if (isIndoorsAt(dim, loc) || onStairs(dim, loc)) return true;
  for (let k = Math.max(0, i - 1); k < Math.min(pts.length - 1, i + 4); k++) if (isGate(pts[k], pts[k + 1]) || onStairs(dim, pts[k + 1]) || edgeAt(dim, pts[k + 1])) return true;   // a ladder, a door, a drop, stairs, v6.0: a bridge / ledge (a step up a hill isn't)
  return false;
}
// v6.0: a route point with a drop of 2+ blocks right beside it (a plank bridge over a trench, a wall-top, a ledge, a
// narrow path along a cliff): Minecraft's walking cuts corners there and falls in. Remembered per spot.
const EDGE = new Map();
function edgeAt(dim, p) {
  const x = Math.floor(p.x), y = Math.floor(p.y + 0.01), z = Math.floor(p.z), k = bkey(dim.id, x, y, z), now = tick();
  const c = EDGE.get(k);
  if (c && now - c.t < 600) return c.v;
  let v = false;
  try {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const f1 = tBlock(dim, x + dx + 0.5, y - 1, z + dz + 0.5), f2 = tBlock(dim, x + dx + 0.5, y - 2, z + dz + 0.5), at = tBlock(dim, x + dx + 0.5, y, z + dz + 0.5);
      if (at && passable(at) && f1 && passable(f1) && !f1.isLiquid && f2 && passable(f2) && !f2.isLiquid) { v = true; break; }
    }
  } catch {}
  EDGE.set(k, { v, t: now });
  if (EDGE.size > 20000) EDGE.clear();
  return v;
}
system.runInterval(() => {
  const ms = getMarches();
  const ids = Object.keys(ms);
  if (!ids.length) return;
  const now = tick();
  const byId = new Map(allOf(SOLDIER).map((e) => [e.id, e]));
  let changed = false;
  for (const id of ids) {
    const m = ms[id];
    m.members = m.members ?? [];
    if (!m.members.length) { for (const s of m.lanes) laneOf.delete(s); delete ms[id]; changed = true; continue; } // everyone arrived, died or got new orders
    const all = m.members.map((x) => byId.get(x)).filter((e) => e);
    if (!all.length) continue;                                  // out of range: keep the order, resume when they load again
    const members = all.filter(marchActive);
    if (!members.length) continue;                              // everyone down or captured: nothing to lead
    if (!m.path && !m.planning && !m.final) {                    // (after a reload) plan again from the group
      let x = 0, y = 0, z = 0; for (const e of members) { x += e.location.x; y += e.location.y; z += e.location.z; }
      requestPlan(id, m, { x: x / members.length, y: y / members.length, z: z / members.length }); changed = true; continue;
    }
    if (!m.path && m.earlyAt && !m.final) {                     // v5.9: walking off while the route is worked out: each to his own spot too
      const dim0 = world.getDimension(m.dim);
      for (const e of members) if (!driveOn.has(e.id)) formMode.add(e.id);
      placeFormation(m, dim0, m.earlyAt, members.filter((e) => formMode.has(e.id)), "line");
      continue;
    }
    if (m.final || m.planning || !m.path) continue;
    const dim = world.getDimension(m.dim);
    let cx = 0, cy = 0, cz = 0;
    for (const e of members) { cx += e.location.x; cy += e.location.y; cz += e.location.z; }
    const c = { x: cx / members.length, y: cy / members.length, z: cz / members.length };
    // (v6.0: really fighting: following something else than his march marker. Walking to his catch-up/formation marker
    // also parks the order goal, and counting that as fighting kept the march's stall detector from ever firing)
    const fighting = members.some((e) => gdp(e, "war:ordergoal") !== undefined && Number(gdp(e, "war:goal") ?? 0) !== Number(gdp(e, "war:catchup") ?? -1));
    // v6.0: someone's locked in a fight: the squad holds together here (v6.2: at most ~20 s, then the march carries on)
    let contact = members.some((e) => combatLock.has(e.id));
    if (contact) { m.contactT = m.contactT ?? now; if (now - m.contactT > 400) contact = false; } else if (m.contactT !== undefined && now - m.contactT > 500) m.contactT = undefined;
    // the front of the group sets the pace (60th percentile of the members who are up and moving)
    const progOf = new Map(members.map((e) => [e.id, routeProgress(m, e.location, e.id)]));
    const prog = [...progOf.values()].sort((a, b) => b - a);
    const lead = prog[Math.floor((prog.length - 1) * 0.4)];
    let j = lead, len = 0;                                       // ~6 blocks of route ahead of the lead, gates or not
    while (j < m.path.length - 1 && len < 6) { const a = m.path[j], b = m.path[j + 1]; len += Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y); j++; }
    if (j >= m.path.length - 4) j = m.path.length - 1;               // v6.0: the last few points: straight to the end of the stretch
    // v6.0: under fire the march bounds: ~3 s forward, ~3 s down and firing, instead of walking steadily into the guns
    const underFire = members.some((e) => now - (hurtBy.get(e.id)?.t ?? -999) < 60 || (shotsAtMe.get(e.id) ?? []).some((t) => now - t < 40));
    if (underFire) m.fireT = now;
    // v6.2: stopping (to bound, or to hold for a fight) only while someone is actually firing back: shot at from a window
    // they can't answer (only a head showing, too far), standing still in the open just got them killed: keep closing in
    const replying = members.some((e) => now - (gunState.get(e.id)?.lastShot ?? -999) < 80);
    if (underFire && !replying && contact) contact = false;
    const bounding = replying && now - (m.fireT ?? -999) < 200 && Math.floor(now / 60) % 2 === 1 && Math.hypot(m.dest.x - c.x, m.dest.z - c.z) < 80;   // (v6.2: near the objective only, not on a long road)
    if (!contact && !bounding) m.idx = Math.min(m.path.length - 1, Math.max(m.idx ?? 0, j));
    if (lead > (m.bestIdx ?? 0)) { m.wides = 0; m.edgeMsg = m.frontier ? m.edgeMsg : false; }
    if (lead > (m.bestIdx ?? 0) || fighting || contact || bounding) { m.bestIdx = Math.max(m.bestIdx ?? 0, lead); m.progT = now; }
    // who follows the route himself: anyone in a tight stretch, and anyone well behind the guide. v5.9: once he
    // drives he keeps driving until he's been clear and caught up for 1.5 s (no flip-flopping between the two); everyone
    // else walks to his OWN formation spot (v5.4-5.8: up to four men shared one lane marker and jostled for it)
    for (const e of all) {
      if (!marchActive(e)) { formMode.delete(e.id); driveOn.delete(e.id); if (gdp(e, "war:catchup") !== undefined) sdp(e, "war:catchup", undefined); continue; }
      const pi = progOf.get(e.id) ?? 0;
      // (a straggler ~20 blocks back, a tight stretch, or v6.0: his formation place isn't a plain straight walk from where
      // he is: a trench, a drop, a wall between: Minecraft's walking would drop him in or get him stuck)
      const fm = formMode.has(e.id) ? marker(Number(gdp(e, "war:fmk") ?? 0)) : undefined;
      const raw = m.idx - pi >= 10 || tightAt(dim, m.path, pi, e.location) || (fm && !straightReach(dim, e.location, fm.location));
      let dv = driveOn.get(e.id);
      if (raw) { dv = { off: 0 }; driveOn.set(e.id, dv); }
      else if (dv && (++dv.off >= 3 && m.idx - pi <= 6)) { driveOn.delete(e.id); dv = undefined; }
      if (dv) {
        formMode.delete(e.id);
        const slot = myMarker(e, m.path[Math.min(m.path.length - 1, lookahead(m.path, pi, 4))]);   // the route driver moves it from here
        if (slot) setCatchup(e, slot);
      } else formMode.add(e.id);                                  // (his formation spot is placed below)
    }
    const last = m.path[m.path.length - 1];
    // (v6.0: the squad stops ~3 blocks short of its markers: "at the end" when the front is within a few points of it;
    // waiting for the exact last point froze long marches at the end of a leg)
    const atEnd = m.idx >= m.path.length - 1 && (flat(last, c) < 8 || (prog[0] >= m.path.length - 4 && !m.path.guess));   // (v6.2: a guessed straight line is never "arrived": it said "in position" 100 blocks short)
    if (atEnd) {
      const lt = m.legT ?? { x: m.dest.x, z: m.dest.z, final: true };
      const atDest = Math.hypot(m.dest.x - last.x, m.dest.z - last.z) <= 6 && (!Number.isFinite(m.dest.y) || Math.abs(m.dest.y - last.y) <= 2) && !last.climb;
      if (atDest) {
        // arrived: lanes become formation spots at the destination
        m.final = true; m.finalT = now; m.dest.y = last.y; m.pos = { x: last.x, y: last.y, z: last.z };
        placeLanes(m, dim, m.pos, m.heading, "line");
        factionMsg(m.fac, `§a${squadLabel(m)} in position at (${Math.round(last.x)}, ${Math.round(last.z)})`);
        if (all[0]) callout(all[Math.floor(Math.random() * all.length)], "Hold position!");
        for (const e of all) sdp(e, "war:catchup", undefined);   // stragglers now just join the formation
      } else if (!lt.final && Math.hypot(lt.x - last.x, lt.z - last.z) <= 8) {
        m.legs?.shift();                                         // leg done: plan the next one
        requestPlan(id, m, c);
      } else if (m.frontier) {
        // reached the edge of the loaded land: plan the next stretch. v6.2: if that ends at the same edge again, the land
        // beyond isn't loaded: say so once and only look again every 10 s (it used to re-plan every half second)
        const same = m.edgeAt && Math.hypot(m.edgeAt.x - last.x, m.edgeAt.z - last.z) < 4;
        m.edgeAt = { x: last.x, z: last.z };
        if (same) {
          if (!m.edgeMsg) { m.edgeMsg = true; factionMsg(m.fac, `§e${squadLabel(m)} is waiting at the edge of the loaded land near (${Math.round(last.x)}, ${Math.round(last.z)}): they carry on when it loads (come closer).`); }
          if (now - (m.edgeT ?? -9999) < 200) { changed = true; continue; }
          m.edgeT = now;
          // is the land just past the edge (toward the destination) loaded now? If not, nothing to plan: stay put
          const L = Math.hypot(m.dest.x - last.x, m.dest.z - last.z) || 1;
          let beyond = false;
          try { beyond = !!dim.getBlock({ x: last.x + ((m.dest.x - last.x) / L) * 10, y: last.y, z: last.z + ((m.dest.z - last.z) / L) * 10 }); } catch {}
          if (!beyond) { changed = true; continue; }
        } else m.edgeMsg = false;
        requestPlan(id, m, c);
      } else {
        markDeadEnd(m, last);                                    // the route ran out short of the target: a dead end
        requestPlan(id, m, c, true);
      }
      changed = true; continue;
    }
    if (now - m.progT > 300 && m.frontier) {                     // v6.2: at the edge of the loaded land: wait for it (told once)
      if (!m.edgeMsg) { m.edgeMsg = true; factionMsg(m.fac, `§e${squadLabel(m)} is waiting at the edge of the loaded land (${Math.round(c.x)}, ${Math.round(c.z)}): they carry on when it loads (come closer).`); }
      if (now - (m.wideT ?? -9999) > 200) { m.wideT = now; requestPlan(id, m, c); changed = true; continue; }
    } else if (now - m.progT > 300 && ((m.wides ?? 0) >= 3 || m.replans >= 30)) {   // v6.2: really no way: say so and hold
      m.final = true; m.finalT = now; m.stuck = true;
      const leadE = members.reduce((b, e) => ((progOf.get(e.id) ?? 0) > (progOf.get(b.id) ?? 0) ? e : b), members[0]);
      m.pos = { x: leadE.location.x, y: Math.floor(leadE.location.y + 0.01), z: leadE.location.z };
      placeLanes(m, dim, m.pos, m.heading, "line");
      for (const e of all) sdp(e, "war:catchup", undefined);
      factionMsg(m.fac, `§e${squadLabel(m)} can't find a way to (${Math.round(m.dest.x)}, ${Math.round(m.dest.z)}). Holding at (${Math.round(m.pos.x)}, ${Math.round(m.pos.z)}).`);
      changed = true; continue;
    }
    if (now - m.progT > 300 && m.replans < 30 && now - (m.wideT ?? -9999) > 400) {   // no new ground for ~15 s: a dead end -> rethink wider (v6.1: at most every 20 s)
      m.wideT = now; m.wides = (m.wides ?? 0) + 1;
      const leadE = members.reduce((b, e) => ((progOf.get(e.id) ?? 0) > (progOf.get(b.id) ?? 0) ? e : b), members[0]);
      const pi0 = progOf.get(leadE.id) ?? 0;
      const tightSpot = isIndoorsAt(dim, leadE.location) || m.path.slice(Math.max(0, pi0 - 1), pi0 + 4).some((p, k, arr) => k && isGate(arr[k - 1], p));
      markDeadEnd(m, leadE.location, tightSpot);                 // stalled in a building / at a door: only that spot, not the whole building
      requestPlan(id, m, leadE.location, true); changed = true; continue;
    }
    const p = m.path[m.idx], prev = m.path[Math.max(0, m.idx - 1)];
    m.heading = Math.atan2(p.z - prev.z, p.x - prev.x) || m.heading;
    const narrow = p.w || prev.w;
    const shape = narrow ? "column" : chooseShape(dim, p, m.heading, members, now);
    placeLanes(m, dim, p, m.heading, shape);
    m.pos = { x: p.x, y: p.y, z: p.z };
    placeFormation(m, dim, p, members.filter((e) => formMode.has(e.id)), m.shape ?? shape);
    changed = true;
  }
  if (changed) saveMarches();
}, 10);
// is this soldier's current route stretch a planned water crossing?
function plannedSwim(e) {
  const g = Number(gdp(e, "war:ordergoal") ?? gdp(e, "war:goal") ?? 0);
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
  // v5.4: arrived = at his spot, or close to it for a while (a spot he can't quite reach must not hold him in the charge forever)
  if (dist(e.location, lane.location) > 4 && !(m?.finalT !== undefined && tick() - m.finalT > 200 && flat(e.location, lane.location) < 12 && Math.abs(e.location.y - lane.location.y) < 3)) return false;
  const then = m?.then ?? gdp(e, "war:then") ?? "hold";
  radio(e, `in position (${Math.round(e.location.x)}, ${Math.round(e.location.z)}), ${then === "patrol" ? "patrolling" : "holding"}`);
  // v5.4: his own spot around his lane (several men share a lane: they no longer hold on one spot)
  let spot = d.goal;
  try { spot = formationSlot(e.dimension, lane.location, e, then === "patrol" ? 3 : 2) || d.goal; } catch {}
  giveFunction(e, then === "patrol" || then === "roam" ? "patrol" : (d.div === "garrison" ? "post" : "hold"), undefined, spot);
  return true;
}
// formation spots for Hold here / Patrol here (and as a fallback)
// v5.4: every soldier gets his own spot (up to 17 around the point), never one shared by two
const FORM_OFFS = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.4], [0, 1.4], [-1.4, 0], [1.4, 0], [-2, -2], [2, -2], [-2, 2], [2, 2], [0, -2.8], [0, 2.8], [-2.8, 0], [2.8, 0]];
function formationSlot(dim, center, e, spread = 3) {
  const S = spread * spacingSetting() / 1.5, now = tick();
  for (const off of FORM_OFFS) {
    const spot = walkableNear(dim, center.x + off[0] * S, center.z + off[1] * S, center.y);
    if (!spot || Math.abs(spot.y - center.y) > 1 || dangerNear(dim, spot) || claimedByOther(spot, e.id, now) || !localReach(dim, center, spot)) continue;   // never into a pit or another room (v6.2: or beside a drop / lava)
    claimSpot(e, spot, now);
    return makeWaypoint(dim, spot, false) || makeWaypoint(dim, center);
  }
  return makeWaypoint(dim, center);
}
// keep a little space between moving soldiers (spacing setting, 1-2 blocks)
system.runInterval(() => {
  const sp = spacingSetting();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e);
      if (isRiding(e) || gdp(e, "war:ordergoal") !== undefined || d.func === "post") continue;
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
function note(e, text) { if (typeof text === "string") notes.set(e.id, { text, t: tick() }); }
system.runInterval(() => {
  const on = !!setting("readout", false);
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const n = notes.get(e.id);
      const want = on && n && now - n.t < 60 ? n.text : "";
      if ((gdp(e, "war:readout") ?? "") !== want) { sdp(e, "war:readout", want); updateName(e); }
    } catch {}
  }
  if (now % 400 < 20) for (const id of [...notes.keys()]) if (!world.getEntity(id)) notes.delete(id);
}, 20);

// ================================================================ Water: get back on land
// A soldier in water that he doesn't need to be in swims for the nearest land toward his goal.
function inWater(e) {
  try { if (typeof e.isInWater === "boolean") return e.isInWater; } catch {}
  try { const b = e.dimension.getBlock({ x: e.location.x, y: e.location.y + 0.2, z: e.location.z }); return !!b && b.typeId.includes("water"); } catch { return false; }
}
function goalPoint(e) {
  const d = sd(e);
  const g = marker(Number(gdp(e, "war:ordergoal") ?? gdp(e, "war:goal") ?? 0));
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
  // a planned crossing: commit to it until out on land. v6.4: along the route (not straight at the destination: with the
  // destination behind a wall that pushed the whole squad into the wall), not at all while the glider is carrying him,
  // and given up after 10 s wet without getting anywhere (then: the nearest bank he can really climb out on)
  const wet = now - wetSince.get(e.id);
  if (wet > 200 && (swimGiveUp.get(e.id) ?? 0) <= now && !wetProgress(e, now)) { swimGiveUp.set(e.id, now + 300); noteTrouble(e.dimension, e.location, 1); }
  if ((crossing.has(e.id) || (d.func === "charge" && plannedSwim(e))) && (swimGiveUp.get(e.id) ?? 0) <= now) {
    crossing.set(e.id, true); note(e, "crossing water");
    if (!gliders.has(e.id)) swimOn(e);
    return undefined;
  }
  crossing.delete(e.id);
  // already heading for a shore: keep going there
  const ex = exitSpot.get(e.id);
  if (ex && marker(ex.slot) && now - ex.t < 300) { swimTo(e, ex.at); return { g: "g_wp", slot: ex.slot, t: "t_mid", urgent: true }; }
  if (now - wetSince.get(e.id) < 10) return undefined;
  const goal = goalPoint(e), p = e.location;
  const surf = waterSurface(e.dimension, p);
  let best, bs = 1e9;
  for (let r = 2; r <= 16; r += 2) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const w = walkableNear(e.dimension, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, p.y);
      if (!w || w.y > surf + 1.1 || failedNear(e, w, now)) continue;   // (v6.4: only a bank he can climb out on: never the top of a wall)
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
// v6.4: toward the next bit of his route that's on land (not straight at the destination), else the destination
function swimOn(e) {
  const r = routeOf(e);
  if (r?.pts) for (let k = r.idx; k < Math.min(r.pts.length, r.idx + 24); k++) { const q = r.pts[k]; if (!q.w && flat(q, e.location) > 0.8) { swimTo(e, q); return; } }
  const g = goalPoint(e); if (g) swimTo(e, g);
}
// the top of the water he's in (where a bank must be within a block to climb out)
function waterSurface(dim, p) {
  let y = Math.floor(p.y + 0.2);
  for (let k = 0; k < 6; k++) { const b = tBlock(dim, p.x, y + 1, p.z); if (!b || !b.typeId.includes("water")) break; y++; }
  return y + 1;
}
// getting anywhere in the water: closer to his goal than 5 s ago
const wetTrack = new Map(); // id -> { t, d }
const swimGiveUp = new Map(); // id -> until when he's stopped trying to cross and makes for the nearest climbable bank
function wetProgress(e, now) {
  const g = goalPoint(e); if (!g) return false;
  const dd = flat(g, e.location), w = wetTrack.get(e.id);
  if (!w || now - w.t > 100) { const ok = !w || dd < w.d - 2; wetTrack.set(e.id, { t: now, d: dd }); return ok; }
  return true;
}

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
  const eye = headLoc(player), dir = player.getViewDirection(), dim = player.dimension;
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
    if (downed.has(id)) continue;                                   // nothing moves the downed
    if (now - (pushCool.get(id) ?? -99) < (it.p >= 3 ? 4 : 8)) continue;
    try {
      if (!it.e.isValid) continue;
      let v = it.vec;
      if (!stepping.has(id) && (Math.abs(v.x) > 0.01 || Math.abs(v.z) > 0.01) && !safeAhead(it.e, v.x, v.z)) v = { x: 0, y: Math.min(0.02, v.y ?? 0), z: 0 };   // v6.1: no shove over an edge or into lava
      it.e.applyImpulse(v); pushCool.set(id, now);
    } catch {}
  }
  pushes.clear();
  if (now % 400 < 2) for (const id of [...pushCool.keys()]) if (now - pushCool.get(id) > 400) pushCool.delete(id);
}, 2);

// ================================================================ Route planner (A*, the army's GPS)
// Reads the real terrain around the army and finds the cheapest route: flat ground and bridges are
// cheap, climbing costs a little, safe drops are cheap, swimming is expensive but allowed, lava /
// fire / deadly drops / walls over 2 blocks are impossible. Runs in small slices every tick.
const planJobs = [];
// Every route reads the world through this memory: a block is read from the game once and remembered for ~30 s,
// so plans share what others already read. Fresh reads are capped per tick for the whole add-on (no lag spikes).
const TERRAIN = new Map();            // "dim|x|y|z" -> { typeId, isAir, isLiquid, t }
let freshReads = 0, readBudget = 1500;
system.runInterval(() => { freshReads = 0; }, 1);
system.runInterval(() => { const now = tick(); if (TERRAIN.size > 150000) TERRAIN.clear(); else for (const [k, v] of TERRAIN) if (now - v.t > 600) TERRAIN.delete(k); }, 600);
// v5.7: terrain memory keys are numbers (no text built per lookup); far-out coordinates fall back to text
const dimIx = (id) => id.endsWith("nether") ? 1 : id.endsWith("the_end") ? 2 : 0;
function bkey(dimId, x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  if (x < -1048576 || x >= 1048576 || z < -1048576 || z >= 1048576 || y < -64 || y >= 448) return `${dimId}|${x}|${y}|${z}`;
  return (((x + 1048576) * 2097152 + (z + 1048576)) * 512 + (y + 64)) * 3 + dimIx(dimId);
}
function tBlock(dim, x, y, z) {
  const key = bkey(dim.id, x, y, z);
  const c = TERRAIN.get(key);
  if (c) return c;
  freshReads++;
  const b = dim.getBlock({ x, y, z });                                   // throws when unloaded (callers handle it)
  if (!b) return undefined;
  const v = { typeId: b.typeId, isAir: b.isAir, isLiquid: b.isLiquid, t: tick() };
  if (OPENABLE_ID(b.typeId)) { try { v.open = !!b.permutation.getState("open_bit"); } catch {} }
  TERRAIN.set(key, v);
  return v;
}
const SKY = new Map();
function tSky(dim, x, y, z) {
  const key = bkey(dim.id, x, y, z);
  const c = SKY.get(key);
  if (c !== undefined) return c;
  freshReads++;
  const v = dim.getSkyLightLevel({ x, y, z });
  if (SKY.size > 100000) SKY.clear();
  SKY.set(key, v);
  return v;
}
const isIronDoor = (b) => !!b && TI(b.typeId).ironDoor;
const isPlate = (b) => !!b && TI(b.typeId).plate;
// v5.3: blocks a soldier can open himself on the way (wooden trapdoors, fence gates); the route follower opens them
const OPENABLE_ID = (id) => TI(id).openableId;
const isOpenable = (b) => !!b && TI(b.typeId).openable;
// fences, walls and fence gates are 1.5 high: nobody steps up onto them, so they are never a floor
const isTall = (b) => !!b && TI(b.typeId).tall;
const pathable = (b) => passable(b) || isOpenable(b);
// a real floor: solid under the feet (a ladder counts: he can stand on its top rung); not a plant, torch, open trapdoor or fence
const isFloor = (b) => { if (!b || b.isAir || b.isLiquid) return false; const t = TI(b.typeId); return !t.tall && !(t.trap && b.open) && (!t.pass || t.climb) && !t.leaves && !t.hazard; };
const PLAN_BUDGET = 700;          // node expansions per tick, shared by all plans (a big search takes a few seconds)
function cellAt(job, x, z, refY) {
  const key = job.step > 1 ? job.nkey(x, z, 0) : job.nkey(x, z, Math.floor(refY));
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
      const floor = tBlock(dim, bx, y - 1, bz), feet = tBlock(dim, bx, y, bz), head = tBlock(dim, bx, y + 1, bz);
      if (!floor || !feet || !head) { found = null; break; }
      if (job.step === 1 && isIronDoor(feet) && !floor.isAir && !floor.isLiquid) { found = { x, z, y, w: false, iron: true }; break; }  // iron door: see expansion
      if (feet.typeId.includes("water") && passable(head)) { found = { x, z, y, w: true }; break; }  // surface water: swim
      if (feet.typeId.includes("water")) continue;
      if (job.step === 1 && isClimb(feet) && pathable(head)) { found = { x, z, y, w: false, climb: true }; break; }   // on a ladder
      if (!isFloor(floor)) continue;
      if (!pathable(feet) || !pathable(head)) continue;
      // a shoreline cell (water right next to it) costs a little extra, so routes keep off the water's edge;
      // a ledge cell (a drop of 3+ right beside it) costs extra too, so routes don't hug the edge of pits and walls
      let shore = false, ledge = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nf = tBlock(dim, bx + dx, y - 1, bz + dz);
        if (nf && nf.typeId.includes("water")) { shore = true; break; }
        if (job.step === 1 && !ledge && nf && (nf.isAir || passable(nf))) {
          const n2 = tBlock(dim, bx + dx, y - 2, bz + dz), n3 = tBlock(dim, bx + dx, y - 3, bz + dz);
          if (n2 && n3 && (n2.isAir || passable(n2)) && (n3.isAir || passable(n3))) ledge = true;
        }
      }
      let cave = false;
      try {
        if (tSky(dim, bx, y, bz) < 6) {
          for (let k = 2; k <= 6; k++) { const up = tBlock(dim, bx, y + k, bz); if (up && !up.isAir) { cave = ["stone", "dirt", "deepslate", "gravel", "tuff", "granite", "diorite", "andesite"].some((n) => up.typeId.includes(n)) && !up.typeId.includes("brick"); break; } }
        }
      } catch {}  // natural rock overhead: underground
      const hatchBelow = job.step === 1 && floor.typeId.includes("trapdoor") && isClimb(tBlock(dim, bx, y - 2, bz));     // standing on a hatch over a ladder: can go down
      found = { x, z, y, w: false, shore, cave, ledge, open: job.step === 1 && (isOpenable(feet) || isOpenable(head) || isWoodDoor(feet)) && !isClimb(feet), climb: job.step === 1 && (isClimb(floor) || hatchBelow) }; break;   // standing on top of a ladder: can climb down
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
    if (dy > 1 && !(a.w && !b.w && dy === 2)) return Infinity;    // only steps a soldier can always take (v6.4: and out of
    if (dy === 2) base += 1.5;                                  // the water onto a bank a block above its surface: from the
    if (dy === 1) base += 0.4;                                  // top water block that's 2 up; a route used to end in the stream)
    else if (dy < 0) {
      const h = -dy;
      if (!b.w) {
        if (h > 8) return Infinity;                             // deadly drop
        if (h > 3) base += 0.3 * h + 30;                        // a drop that costs some health (v7.0: only when there's no stair: men jumped off balconies)
        if (h >= 3) base += 14;                                 // no walking back up from here (pits): only if it really pays
      }
    }
  }
  if (job && inDead(job, b)) base += 40 * step;                 // a known dead end: only if there's truly nothing else
  if (step === 1 && TROUBLE.size && job?.dim) base += troubleAt(job.dim.id, b.x, b.z) * 2.5;   // v6.4: remembered trouble: round it if there's a way
  if (step === 1 && KILLZONE.size && job?.dim) base += killAt(job.dim.id, b.x, b.z) * 6;      // v6.9.2: stairs where men were just cut down: the other way up
  if (job?.danger && step === 1) base += exposedCost(job, b);   // v5.7: in a fight, ground the enemy can see costs extra
  if (b.w) base *= 10;                                          // swimming: only when it saves a lot
  else if (b.shore) base += 0.6;                                // keep off the shoreline
  if (b.ledge) base += 1.2;                                      // keep away from the edge of a drop
  if (b.open) base += 0.5;                                       // a trapdoor / gate to open: fine, but not for nothing
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
    step, weight: opts.weight ?? 1.25, dead: opts.dead ?? [], goalFn: opts.goalFn, accept: opts.accept, prio: !!opts.prio,
    danger: opts.danger?.length ? opts.danger : undefined, exposed: new Map(), rays: 0 };
  // v6.1: number keys relative to the start (text keys for every searched cell were the planner's memory hog: a long
  // detour could build hundreds of thousands of them and crash the game's script engine)
  const enc = (x, z, y) => ((x - sx + 4096) * 8192 + (z - sz + 4096)) * 1024 + ((y ?? 0) + 256);
  const nkey = (x, z, y) => step > 1 ? enc(x, z, 0) : enc(x, z, y);
  job.nkey = nkey;
  job.dec = (k) => { const y = (k % 1024) - 256, r = Math.floor(k / 1024); return { x: Math.floor(r / 8192) - 4096 + sx, z: (r % 8192) - 4096 + sz, y }; };
  const s0 = cellAt(job, sx, sz, start.y) ?? { x: sx, z: sz, y: Math.floor(start.y), w: false };
  job.cells.set(nkey(sx, sz, s0.y), s0);
  const h0 = job.goalFn ? 0 : Math.hypot(job.goal.x - sx, job.goal.z - sz);
  job.open.push({ x: sx, z: sz, y: s0.y, w: s0.w, climb: !!s0.climb, f: h0 });
  job.g.set(nkey(sx, sz, s0.y), 0);
  job.best = { x: sx, z: sz, key: nkey(sx, sz, s0.y) }; job.bestH = h0;
  if (planJobs.length >= 30) {                                         // v6.1: never more than 30 searches in memory at once
    const old = planJobs.findIndex((j) => !j.prio);
    if (old >= 0) { const [j] = planJobs.splice(old, 1); try { j.onDone(undefined, true, false); } catch {} }
  }
  planJobs.push(job);
}
// a cell the known enemies can see (chest height), checked once per cell per route, with a ray budget per route
function exposedCost(job, b) {
  const k = `${b.x},${b.y},${b.z}`;
  let v = job.exposed.get(k);
  if (v === undefined) {
    v = 0;
    if (job.rays < 300) {
      const c = { x: b.x + 0.5, y: b.y + 1.2, z: b.z + 0.5 };
      for (const q of job.danger) {
        if (Math.abs(q.x - c.x) > 90 || Math.abs(q.z - c.z) > 90) continue;
        job.rays++;
        if (clearShot(job.dim, q, c)) { v = 4; break; }
      }
    }
    job.exposed.set(k, v);
  }
  return v;
}
function finishJob(job, endKey, partial = false) {
  const pts = [];
  let k = endKey;
  while (k !== undefined) { const { x, z, y } = job.dec(k); const c = job.cells.get(k); pts.push({ x: x + 0.5, y: c && c.y !== undefined ? c.y : y, z: z + 0.5, w: !!c?.w, climb: !!c?.climb, open: !!c?.open }); k = job.came.get(k); }
  pts.reverse();
  // keep a point every ~6 blocks, at turns, height changes and water edges
  const out = [];
  let last;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], prev = pts[i - 1], next = pts[i + 1];
    const turn = prev && next && ((next.x - p.x) * (p.z - prev.z) - (next.z - p.z) * (p.x - prev.x)) !== 0;
    const edge = prev && (prev.w !== p.w || Math.abs(prev.y - p.y) >= 1 || p.climb || prev.climb || p.open || (next && (next.climb || next.open)));
    const step = job.step > 1 ? 6 : 2;                                  // fine routes: dense (no room for shortcuts into pits)
    if (i === 0 || i === pts.length - 1 || edge || turn || (last && flat(last, p) >= step)) { out.push(p); last = p; }
  }
  try { job.onDone(out.length > 1 ? out : undefined, partial, !!job.hitUnloaded); } catch {}
}
let jobTurn = 0;
system.runInterval(() => {
  let budget = PLAN_BUDGET;
  let rounds = 0;
  const tStart = Date.now();
  while (budget > 0 && planJobs.length && freshReads < readBudget && rounds < planJobs.length * 4 && Date.now() - tStart < 3) {
    rounds++;
    jobTurn = (jobTurn + 1) % planJobs.length;
    const prioJob = planJobs.find((j) => j.prio);
    const job = prioJob && rounds % 2 ? prioJob : planJobs[jobTurn];
    let share = Math.max(40, Math.floor(PLAN_BUDGET / planJobs.length)) * (job.prio ? 3 : 1);
    let finished = false;
    while (share-- > 0 && budget-- > 0 && freshReads < readBudget && ((budget & 31) || Date.now() - tStart < 3)) {
      if (!job.open.size || job.exp >= job.max || job.cells.size > 90000 || job.open.size > 60000) {   // (v6.1: and a hard size cap: never a memory blow-up)
        // no full route: go as far as we can toward the goal (re-planned later)
        const bk = job.best.key ?? job.nkey(job.best.x, job.best.z, 0);
        if (job.bestH < Math.hypot(job.goal.x - job.origin.x, job.goal.z - job.origin.z) - 6) finishJob(job, bk, true); else { try { job.onDone(undefined, true, !!job.hitUnloaded); } catch {} }
        finished = true; break;
      }
      const n = job.open.pop();
      const nk = job.nkey(n.x, n.z, n.y);
      if (job.closed.has(nk)) continue;
      job.closed.add(nk);
      job.exp++;
      const hz = job.goal.y === undefined ? 0 : Math.abs(n.y - job.goal.y);
      const h = Math.hypot(job.goal.x - n.x, job.goal.z - n.z) + hz * 0.5;
      if (h < job.bestH) { job.bestH = h; job.best = { x: n.x, z: n.z, key: nk }; }
      // right spot AND right height: on his feet (not on a ladder) and on the goal's level; a near level is only
      // accepted after a long search (the clicked height can be a little off, e.g. on a tree or a roof edge)
      const reached = job.goalFn ? job.goalFn(job.dim, n) : (Math.hypot(job.goal.x - n.x, job.goal.z - n.z) <= Math.max(2, job.step * 1.5) &&
        (job.step > 1 || (!n.climb && (hz <= 0.5 || (hz <= 1.5 && job.exp > 1500) || (hz <= 3 && job.exp > 4000)))));   // v5.4: the right floor (a stair below it isn't "there")
      if (reached || (job.accept && job.exp > 1 && job.accept(n))) { finishJob(job, nk); finished = true; break; }
      const cur = { y: n.y, w: n.w, climb: n.climb };
      const S = job.step;
      for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const dx = ddx * S, dz = ddz * S;
        const x = n.x + dx, z = n.z + dz;
        if (Math.hypot(x - job.origin.x, z - job.origin.z) > job.maxRadius) continue;
        const c = cellAt(job, x, z, n.y);
        if (!c) continue;
        const key = job.nkey(x, z, c.y);
        if (job.closed.has(key)) continue;
        if (c.iron) {                                                  // an iron door opens only from a side with a pressure plate
          let plate = false;
          try { plate = isPlate(tBlock(job.dim, n.x + 0.5, n.y, n.z + 0.5)); } catch {}
          if (!plate) continue;
        }
        if (job.step === 1 && c.y !== n.y) {
          // a drop needs open air all the way down; a step up needs headroom above where he stands
          let ok = true;
          try {
            if (c.y < n.y) { for (let yy = c.y + 2; yy <= n.y + 1; yy++) { const b = tBlock(job.dim, x + 0.5, yy, z + 0.5); if (!pathable(b) && !isIronDoor(b)) { ok = false; break; } } }
            else { const b = tBlock(job.dim, n.x + 0.5, n.y + 2, n.z + 0.5); if (!pathable(b) && !isIronDoor(b)) ok = false; }
          } catch { ok = false; }
          if (!ok) continue;
        }
        const diag = dx !== 0 && dz !== 0;
        if (diag && S === 1) { // no cutting corners
          const c1 = cellAt(job, n.x + dx, n.z, n.y), c2 = cellAt(job, n.x, n.z + dz, n.y);
          if (!c1 || !c2 || c1.iron || c2.iron || Math.abs(c1.y - n.y) > 1 || Math.abs(c2.y - n.y) > 1) continue;
        }
        const sc = stepCost(cur, c, diag, job);
        if (!isFinite(sc)) continue;
        const g = (job.g.get(nk) ?? 0) + sc;
        if (g >= (job.g.get(key) ?? Infinity)) continue;
        job.g.set(key, g); job.came.set(key, nk);
        job.open.push({ x, z, y: c.y, w: c.w, climb: !!c.climb, f: g + (job.goalFn ? 0 : job.weight * (Math.hypot(job.goal.x - x, job.goal.z - z) + (job.goal.y === undefined ? 0 : Math.abs(c.y - job.goal.y) * 0.5))) }); // aimed search
      }
      // ladders: climb straight up or down while the ladder continues (and off the bottom onto the ground)
      if (job.step === 1 && n.climb) {
        for (const dy of [1, -1]) {
          const yy = n.y + dy;
          let c2 = null;
          try {
            const feet = tBlock(job.dim, n.x + 0.5, yy, n.z + 0.5), head = tBlock(job.dim, n.x + 0.5, yy + 1, n.z + 0.5), fl = tBlock(job.dim, n.x + 0.5, yy - 1, n.z + 0.5);
            const hatch = feet && feet.typeId.includes("trapdoor") && isOpenable(feet) && isClimb(tBlock(job.dim, n.x + 0.5, yy - 1, n.z + 0.5));   // a trapdoor over a ladder: climbable once open
            if (feet && head && pathable(head) && (isClimb(feet) || hatch)) c2 = { x: n.x, z: n.z, y: yy, w: false, climb: true, open: !!hatch };
            else if (dy < 0 && feet && fl && pathable(feet) && pathable(head) && isFloor(fl)) c2 = { x: n.x, z: n.z, y: yy, w: false };
          } catch {}
          if (!c2) continue;
          const key = job.nkey(n.x, n.z, yy);
          if (job.closed.has(key)) continue;
          job.cells.set(key, c2);
          const g = (job.g.get(nk) ?? 0) + 1.6;
          if (g >= (job.g.get(key) ?? Infinity)) continue;
          job.g.set(key, g); job.came.set(key, nk);
          job.open.push({ x: n.x, z: n.z, y: yy, w: false, climb: !!c2.climb, f: g + (job.goalFn ? 0 : job.weight * Math.hypot(job.goal.x - n.x, job.goal.z - n.z)) });
        }
      }
    }
    if (finished) { planJobs.splice(planJobs.indexOf(job), 1); jobTurn = Math.max(0, Math.min(jobTurn, planJobs.length - 1)); }
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

// ================================================================ Part A (v4.5)
// Mission orders with areas of operation, wide patrol sweeps, direct blast damage on this add-on's
// units, rare personal "shaken" breaks, rules of engagement, and realism sliders.
const realism = () => ({ dmg: Number(setting("r_dmg", 100)) / 100, react: Number(setting("r_react", 100)) / 100 });
const aoOf = (e) => Number(gdp(e, "war:ao") ?? 100);
const freeOf = (e) => gdp(e, "war:free") !== false;   // "use judgment" (default) vs "exactly as ordered"

// ---- blast damage applied directly (tank shells, plane bombs, crashes): soldiers, hounds, tanks, planes, boats
function blastDamage(dim, loc, power, src) {
  // kill zone (~3 blocks for a shell): almost certainly lethal; heavy damage out to ~6; light to the edge (~9)
  const r = power * 1.8, core = power * 0.6;
  let n = 0;
  for (const o of dim.getEntities({ location: loc, maxDistance: r })) {
    if (!(o.typeId === SOLDIER || o.typeId === HOUND || VEHICLES.includes(o.typeId) || o.typeId === NEST)) continue;
    const dd = dist({ x: o.location.x, y: o.location.y + 0.9, z: o.location.z }, loc);
    const dmg = dd <= core ? power * 5 : Math.round(Math.max(1, power * 3.2 * (1 - (dd - core) / (r - core)) + 1));
    if (dmg <= 0) continue;
    try { o.applyDamage(dmg, { cause: "entityExplosion", damagingEntity: src?.isValid ? src : undefined }); n++; }
    catch { try { o.applyDamage(dmg, { cause: "entityExplosion" }); n++; } catch {} }
  }
  if (n && src?.typeId === "minecraft:player" && setting("readout", false)) { try { src.onScreenDisplay.setActionBar(`§7Blast hit ${n} unit${n === 1 ? "" : "s"}`); } catch {} }
}

// ---- areas of operation: who's defending where (for helping friends in trouble inside your area)
function anchorOf(e) {
  const parked = gdp(e, "war:ordergoal");
  const g = Number(parked ?? gdp(e, "war:goal") ?? 0);
  return marker(g) ?? marker(Number(gdp(e, "war:home") ?? 0));
}
const helpT = new Map(); // "faction:attacker" -> tick the call for help last went out (v5.4: once per 2 s, not once per bullet)
function helpInArea(victim, attacker, fv, now) {
  const hk = `${fv}:${attacker.id}`;
  if (now - (helpT.get(hk) ?? -99) < 40) return;
  helpT.set(hk, now);
  if (helpT.size > 2000) helpT.clear();
  for (const c of nearSnap(victim.dimension.id, victim.location, 200)) {
    if (c.type !== SOLDIER || c.id === victim.id || c.down || !isFriendly(c.f, fv)) continue;
    const o = c.e;
    try {
      if (!o.isValid || !freeOf(o)) continue;
      const d = sd(o);
      if (!["hold", "patrol", "stand", "sentry"].includes(d.func) || d.retreat || d.surr) continue;
      const a = anchorOf(o);
      if (a && flat(a.location, victim.location) <= aoOf(o)) assist.set(o.id, { id: attacker.id, t: now });   // trouble inside my area: go help
    } catch {}
  }
}

// ---- patrol: a wide sweep of the whole area (not a stroll around one spot)
const sweep = new Map(); // id -> { slot, at, t }
function patrolSweep(e, d, now) {
  if (d.func !== "patrol" || d.retreat || isRiding(e)) return undefined;
  const roam = !!gdp(e, "war:roam");
  const r = roam ? Math.max(d.radius, Math.min(150, aoOf(e))) : Math.max(d.radius, freeOf(e) ? Math.min(150, aoOf(e)) : d.radius);
  // every patrol uses the sweep: points on his level (v7.0: reached by a real route if need be, not only a plain walk:
  // a patrol in a cramped building walks out through the doors). Roam: anywhere in the area, any floor.
  const a = anchorOf(e);
  if (!a) return undefined;
  let sw = sweep.get(e.id);
  if (sw && !personal.has(e.id) && flat(sw.at, e.location) > 4 && now - sw.t > 400) sw = undefined;   // (no way there: another)
  if (!sw || !marker(sw.slot) || flat(sw.at, e.location) < 4 || now - sw.t > 900) {
    let spot;
    const inB = isIndoorsAt(e.dimension, a.location);
    for (let k = 0; k < 12 && !spot; k++) {
      const ang = Math.random() * Math.PI * 2, rr = (inB && !roam ? Math.min(r, 6 + k * 2) : r) * (0.35 + Math.random() * 0.6);   // (in a building: its rooms first, wider each try)
      const refY = roam ? a.location.y + Math.round((Math.random() * 2 - 1) * 10) : a.location.y;
      const base = roam && Math.random() < 0.5 ? e.location : a.location;     // (roaming: from where he is, too)
      spot = walkableNear(e.dimension, base.x + Math.cos(ang) * rr * (roam && base === e.location ? 0.5 : 1), base.z + Math.sin(ang) * rr * (roam && base === e.location ? 0.5 : 1), refY);
      if (spot && !roam && Math.abs(spot.y - a.location.y) > 1) spot = undefined;    // a patrol keeps to its level
      if (spot && troubleAt(e.dimension.id, spot.x, spot.z) >= 3) spot = undefined;
    }
    if (!spot) return undefined;
    const slot = makeWaypoint(e.dimension, spot);
    if (!slot) return undefined;
    sw = { slot, at: spot, t: now }; sweep.set(e.id, sw);
  }
  note(e, roam ? "roaming" : "patrolling");
  return travel(e, sw.at, "patrol", now, false);
}

// ---- breaking and running: rare, personal, temporary. Never more than ~1 in 8 of a squad at once.
const shaken = new Map();     // id -> { slot, at, until, recoverUntil, key }
const breakCool = new Map();  // id -> tick he may break again
const recentDeaths = [];      // { x, z, dim, f, t }
const recentHits = new Map(); // id -> [ticks]
const breakKey = (e, d) => d.squad ? `${d.faction}:${d.squad}` : `${d.faction}`;
world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const v = ev.deadEntity;
    if (v.typeId !== SOLDIER && v.typeId !== "minecraft:player") return;
    try { const fv = factionOf(v); const near = nearbyCombatants(v.dimension.id, v.location, 10).find((o) => o.typeId === SOLDIER && o.id !== v.id && Number(P(o, "war:faction")) === fv); if (near) callout(near, "Man down!"); } catch {}
    recentDeaths.push({ x: v.location.x, z: v.location.z, dim: v.dimension.id, f: factionOf(v), t: tick() });
    while (recentDeaths.length > 200) recentDeaths.shift();
  } catch {}
});
world.afterEvents.entityHurt.subscribe((ev) => {
  const v = ev.hurtEntity;
  if (v?.typeId !== SOLDIER) return;
  if (Math.random() < 0.6 && !downed.has(v.id)) callout(v, "I'm hit!");
  const arr = recentHits.get(v.id) ?? []; arr.push(tick()); recentHits.set(v.id, arr.filter((t) => tick() - t < 100));
});
function stressOf(e, d, now) {
  let st = 0;
  if (recentDeaths.some((x) => x.dim === e.dimension.id && x.f === d.faction && now - x.t < 200 && Math.hypot(x.x - e.location.x, x.z - e.location.z) < 6)) st += 3; // a comrade fell beside him
  if ((recentHits.get(e.id) ?? []).filter((t) => now - t < 100).length >= 3) st += 2;       // being hit repeatedly
  const hp = e.getComponent("minecraft:health");
  if (hp && hp.currentValue / hp.effectiveMax < 0.35) st += 2;
  let foes = 0, friends = 0;
  for (const c of nearSnap(e.dimension.id, e.location, 24)) {
    if (c.id === e.id || c.down || (c.type !== SOLDIER && c.type !== HOUND && c.type !== "minecraft:player")) continue;
    if (isHostile(d.faction, c.f)) foes++; else if (isFriendly(d.faction, c.f)) friends++;
  }
  if (foes >= (friends + 1) * 2) st += 2;                                                    // badly outnumbered here
  else if (foes > friends + 1) st += 1;                                                      // his side is losing here
  return st;
}
function shakenMove(e, d, now) {
  const sk = shaken.get(e.id);
  if (sk) {
    if (sk.recoverUntil) {
      if (now >= sk.recoverUntil) { shaken.delete(e.id); breakCool.set(e.id, now + 4800); note(e, "back in the fight"); return undefined; }
      note(e, "shaken"); return { g: "g_none", t: "t_off", urgent: false };
    }
    if (flat(sk.at, e.location) < 3 || now > sk.until) sk.recoverUntil = now + 200 + Math.floor(Math.random() * 200); // 10-20 s to recover
    note(e, "shaken: running"); return { g: "g_wp", slot: sk.slot, t: "t_off", urgent: true };
  }
  // should he break? checked every ~2 s while in combat
  if (now % 40 >= 10 || d.div === "guard" || d.div === "medic" || isRiding(e) || d.retreat || d.surr) return undefined;
  if (!perc.get(e.id)?.threat || (breakCool.get(e.id) ?? 0) > now) return undefined;
  const st = stressOf(e, d, now);
  if (st < 4) return undefined;
  let chance = 0.04 + (st - 4) * 0.03;                                                       // rare: a few % per check
  if (d.func === "post") chance *= 0.1;                                                      // garrisons on posts almost never break
  if (Math.random() >= chance) return undefined;
  const key = breakKey(e, d);
  const squadSize = allOf(SOLDIER).filter((o) => { try { return breakKey(o, sd(o)) === key; } catch { return false; } }).length;
  const broken = [...shaken.values()].filter((x) => x.key === key).length;
  if (broken >= Math.max(1, Math.floor(squadSize / 8))) return undefined;                      // never more than ~1 in 8 at once
  // where to run: the nearest friendly rally flag within 64, else ~25 blocks directly away from the threat
  let spot;
  const rally = nearestFlag(e.dimension, e.location, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 64);
  if (rally) spot = walkableNear(e.dimension, rally.location.x, rally.location.z, rally.location.y);
  if (!spot) {
    const t = perc.get(e.id).threat, p = e.location;
    const dx = p.x - t.location.x, dz = p.z - t.location.z, L = Math.hypot(dx, dz) || 1;
    spot = walkableNear(e.dimension, p.x + (dx / L) * 25, p.z + (dz / L) * 25, p.y);
  }
  if (!spot) return undefined;
  const slot = makeWaypoint(e.dimension, spot);
  if (!slot) return undefined;
  shaken.set(e.id, { slot, at: spot, until: now + 400, key });
  callout(e, "Fall back!");
  note(e, "shaken: running");
  return { g: "g_wp", slot, t: "t_off", urgent: true };
}

// ================================================================ Part B: the brain (v4.6)
// Same structure as the simulator brain that was tuned by self-play (BW = the evolved weights).
// Squads share what any member sees; attacking squads run fix -> flank -> assault with timing; each
// gunner weighs fire / advance / cover / peek / suppress / flank / fall back / key terrain about
// twice a second and commits to the choice. Orders still rule: a new order wipes all of this.
const BW = {"fire":0.516,"expo":0.418,"adv":0.933,"close":0.55,"timing":0.884,"assault":0.899,"cover":0.439,"peek":0.72,"supp":0.5,"fall":0.155,"flankShare":0.17,"flankDist":33.963,"stallT":252.376,"ratioFix":1.483,"commit":10,"goodHit":0.21,"terrain":0.2};   // evolved by self-play in the battle simulator
// per-faction weights (empty in play: everyone uses BW). The self-play tuner gives two sides different weights.
const BW_F = {};
const bwOf = (f) => BW_F[f] ?? learnedBW(f) ?? BW;
const squads = new Map();   // unit key -> { known: Map(id->{ent,x,y,z,t}), plan, contactT, flankPt, flankSlot, flankers:Set, suppressors:Set, enemyC, ratio, keyPt, t }
const brain = new Map();    // soldier id -> { act, decT, spot, slot }
const suppB = new Map();    // soldier id -> suppression points (from fire landing on/near him)
const squadKey = (e, d) => d.squad ? `${d.faction}:${d.squad}` : `${d.faction}:c${Math.floor(e.location.x / 48)},${Math.floor(e.location.z / 48)}`;
const bPower = (o) => { try { const h = o.getComponent("minecraft:health"); const od = o.typeId === SOLDIER ? sd(o) : null;
  return (h ? h.currentValue / h.effectiveMax : 1) * (o.typeId === "minecraft:player" ? 1.5 : od && GUNS.includes(od.weapon) ? (od.weapon === "mg" ? 1.4 : 1) : 0.6); } catch { return 1; } };
function openGroundB(dim, a, b) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(4, Math.ceil(L / 2));
  let bad = 0, py = a.y;
  for (let k = 1; k < n; k++) {
    const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n;
    const w = walkableNear(dim, x, z, py);
    if (!w || Math.abs(w.y - py) > 1) bad++; else py = w.y;
  }
  return bad / n < 0.12;
}
function exposureAt(dim, p, known) {
  let n = 0;
  for (const k of known) { try { if (clearShot(dim, { x: k.x, y: k.y + 1.6, z: k.z }, { x: p.x, y: p.y + 1.2, z: p.z })) n++; } catch {} }
  return n;
}
// ---- squad loop: shared knowledge, plan, key terrain (every second)
system.runInterval(() => {
  const now = tick();
  const groups = new Map();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e);
      if (d.surr || d.div === "medic" || d.div === "guard" || !d.faction || isRiding(e) || downed.has(e.id) || pows.has(e.id)) continue;
      const k = squadKey(e, d);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    } catch {}
  }
  for (const [k, ours] of groups) {
    try {
      const BW = squads.get(k)?.bw ?? bwOf(sd(ours[0]).faction);
      let S = squads.get(k);
      if (!S) { S = { known: new Map(), plan: "advance", contactT: -1, flankers: new Set(), suppressors: new Set(), t: now }; squads.set(k, S); }
      S.t = now; S.n = ours.length;
      const d0 = sd(ours[0]);
      const oc0 = ours.reduce((a, e) => ({ x: a.x + e.location.x / ours.length, z: a.z + e.location.z / ours.length }), { x: 0, z: 0 });
      // shared knowledge: everything any member has seen (a shout away)
      for (const e of ours) {
        const s = perc.get(e.id);
        if (!s) continue;
        const ids = new Set([...s.seen.keys()]); if (s.threat?.isValid) ids.add(s.threat.id);
        for (const id of ids) { const o = world.getEntity(id); if (o?.isValid && !isMob(o)) S.known.set(id, { ent: o, x: o.location.x, y: o.location.y, z: o.location.z, t: now }); }
      }
      // v6.9.2: heard, not seen: boots on the stairs, a fight in the room below. An enemy soldier within 10 blocks (walls
      // and floors between) is known to the squad roughly where he is: enough to cover the stairs or the door he'll come
      // through, never a target to shoot at.
      for (const e of ours) for (const c of nearSnap(e.dimension.id, e.location, 10)) {
        if (c.down || c.type !== SOLDIER || !c.f || !isHostile(d0.faction, c.f) || !c.e.isValid) continue;
        hearIt(S, c.e, c, now - 20);
      }
      // v7.0: the wider picture. Every ~5 s: enemy soldiers within 32 (movement, voices: "they're in that building").
      // Every second: gunfire within 64 gives the shooter away; and whoever is shooting at one of us is known.
      if (now % 100 < 20) for (const e of ours) for (const c of nearSnap(e.dimension.id, e.location, 32)) {
        if (c.down || c.type !== SOLDIER || !c.f || !isHostile(d0.faction, c.f) || !c.e.isValid) continue;
        hearIt(S, c.e, c, now - 60);
      }
      for (const sh of SHOTS) {
        if (now - sh.t > 40 || !isHostile(d0.faction, sh.f)) continue;
        if (Math.hypot(sh.x - oc0.x, sh.z - oc0.z) > 64) continue;
        const o = world.getEntity(sh.id); if (o?.isValid && !downed.has(o.id)) hearIt(S, o, sh, now - 30);
      }
      for (const e of ours) { const fa = firedAt.get(e.id); if (fa && now - fa.t < 40) { const o = world.getEntity(fa.by); if (o?.isValid && !downed.has(o.id)) hearIt(S, o, o.location, now - 20); } }
      for (const [id, kk] of [...S.known]) if (!kk.ent.isValid || now - kk.t > 300 || downed.has(id) || pows.has(id)) S.known.delete(id);
      const known = [...S.known.values()];
      const oc = { x: 0, y: 0, z: 0 }; for (const e of ours) { oc.x += e.location.x; oc.y += e.location.y; oc.z += e.location.z; }
      oc.x /= ours.length; oc.y /= ours.length; oc.z /= ours.length; S.ourC = oc;
      if (!known.length) {
        if (S.contactT >= 0) { radio(ours[0], "area clear, carrying on", true); learnEnd(S, ours.length, now); callout(ours[Math.floor(Math.random() * ours.length)], "Clear!"); }   // v5.4: no regroup halt (it waited on the downed)
        if (S.plan !== "advance") { S.plan = "advance"; S.flankers.clear(); S.suppressors.clear(); S.flankPt = undefined; S.contactT = -1; }
        S.counter = false;
        helpCall.delete(k); continue;
      }
      if (S.contactT < 0) {
        S.contactT = now; callout(ours[Math.floor(Math.random() * ours.length)], "Contact!");
        learnStart(S, d0.faction, ours.length, known, now);
        const ec = { x: known.reduce((t, q) => t + q.x, 0) / known.length, z: known.reduce((t, q) => t + q.z, 0) / known.length };
        radio(ours[0], `contact! about ${known.length} enem${known.length === 1 ? "y" : "ies"} to the ${bearing(ours[0].location, ec)}, ${Math.round(dist(ours[0].location, { ...ec, y: ours[0].location.y }))} blocks`, true);
      }
      if (S.eng) for (const q of known) S.eng.enemies.add(q.ent.id);
      S.enemyC = { x: known.reduce((t, q) => t + q.x, 0) / known.length, y: known.reduce((t, q) => t + q.y, 0) / known.length, z: known.reduce((t, q) => t + q.z, 0) / known.length };
      S.ratio = ours.reduce((t, e) => t + bPower(e), 0) / Math.max(0.5, known.reduce((t, q) => t + bPower(q.ent), 0));
      const aggressive = String(gdp(ours[0], "war:stance") ?? "aggressive") === "aggressive";
      // v6.9.1: a squad told to hold, free to use judgment, out in the open (not holding a building or the high ground),
      // that has the upper hand in a firefight that's gone on a while counter-attacks: the same contact / flank /
      // assault plan as a squad on the move. It ends when the fight does (or turns), and they go back to their spots.
      // Before, a squad on Hold only ever stood and traded fire: no flanking, no charge, no bounding.
      const nearK = known.reduce((m, q) => Math.min(m, Math.hypot(q.x - oc.x, q.z - oc.z)), 1e9);
      const counterOk = aggressive && ours.every((e) => sd(e).func === "hold") && freeOf(ours[0]) && oc.y - S.enemyC.y < 2.5 && !isIndoors(ours[0]) && nearK <= Math.min(aoOf(ours[0]), 90);
      if (!counterOk || S.ratio < 0.8) S.counter = false;
      else if (!S.counter && S.ratio >= 1.2 && now - S.contactT > BW.stallT * 0.5) { S.counter = true; callout(ours[Math.floor(Math.random() * ours.length)], "Moving up!"); radio(ours[0], "pushing forward", true); }
      const attacking = (ours.some((e) => ["charge", "follow", "patrol"].includes(sd(e).func)) && aggressive) || !!S.counter;
      squadHelpTargets(k, S, ours, now);
      const mem = adaptSquad(k, S, now);
      S.siege = mem.siegeUntil > now;
      if (!attacking) { S.plan = "defend"; }
      else {
        const height = oc.y - S.enemyC.y;
        let cov = 0, pairs = 0;
        for (const q of known.slice(0, 4)) for (const e of ours.slice(0, 4)) {
          if (!clearShot(e.dimension, headLoc(e), chest(q.ent))) continue;
          pairs++; if (!clearShot(e.dimension, headLoc(e), { x: q.x, y: q.y + 0.5, z: q.z })) cov++;
        }
        const dug = height <= -2 || (pairs > 0 && cov / pairs > 0.4);
        if (S.plan === "advance" || S.plan === "defend") S.plan = "contact";
        if (S.plan === "contact") {
          const stalled = now - S.contactT > BW.stallT;
          if ((dug || stalled) && S.ratio >= 0.9 && !S.flankPt && !S.siege) {
            const guns = ours.filter((e) => GUNS.includes(sd(e).weapon)).sort((a, b) => (Number(sd(b).weapon === "mg") - Number(sd(a).weapon === "mg")) || (a.id < b.id ? -1 : 1));
            const nF = Math.max(2, Math.round(guns.length * BW.flankShare));
            const dx = S.enemyC.x - oc.x, dz = S.enemyC.z - oc.z, L = Math.hypot(dx, dz) || 1;
            let best, bExp = 1e9;
            for (const sg of [1, -1]) {
              if (mem.failedSides.has(sg)) continue;                    // that side already failed: try the other
              const w = walkableNear(ours[0].dimension, S.enemyC.x + (-dz / L) * BW.flankDist * sg + (dx / L) * 3, S.enemyC.z + (dx / L) * BW.flankDist * sg + (dz / L) * 3, S.enemyC.y);
              if (!w || !openGroundB(ours[0].dimension, oc, w)) continue;
              const mid = { x: (oc.x + w.x) / 2, y: (oc.y + w.y) / 2, z: (oc.z + w.z) / 2 };
              const exp = exposureAt(ours[0].dimension, mid, known) + known.filter((q) => Math.hypot(q.x - w.x, q.z - w.z) < 20).length * 2; // covered approach
              if (exp < bExp) { bExp = exp; best = w; S.flankSide = sg; }
            }
            if (best && guns.length >= 4) {
              const slot = makeWaypoint(ours[0].dimension, best);
              if (slot) {
                S.flankPt = best; S.flankSlot = slot; S.plan = "fix";
                callout(ours[0], "Flanking!"); radio(ours[0], `pinning them down, ${nF} flanking`, true);
                guns.slice(guns.length - nF).forEach((e) => S.flankers.add(e.id));
                guns.slice(0, guns.length - nF).forEach((e) => S.suppressors.add(e.id));
                const cmdr = findPlayer(gdp(ours[0], "war:cmdr"));
                try { cmdr?.onScreenDisplay.setActionBar(`§e${d0.squad ? squadName(d0.faction, d0.squad) : factionLabel(d0.faction, true)}: §fpinning them, ${nF} flanking`); } catch {}
              }
            } else if (!dug) S.plan = "assault";
          } else if (!dug && S.ratio >= BW.ratioFix && !S.siege) { S.plan = "assault"; callout(ours[0], "Charge!"); }
        }
        if (S.plan === "fix") {
          const fl = ours.filter((e) => S.flankers.has(e.id));
          const inPlace = fl.length && fl.filter((e) => flat(S.flankPt, e.location) < 8 || now - (gunState.get(e.id)?.lastShot ?? -999) < 20).length >= Math.ceil(fl.length / 2);
          if (inPlace || now - S.contactT > BW.stallT * 3 || !fl.length) { S.plan = "assault"; S.flankers.clear(); S.suppressors.clear(); callout(ours[0], "Go, go, go!"); radio(ours[0], "assaulting the position", true); }
        }
        if (S.plan === "assault" && S.ratio < 0.5) S.plan = "contact";
      }
      try { buildingPlan(k, S, ours, known, now); } catch (err) { oops("building plan", err); }   // v7.0
      // key terrain: the highest nearby ground that sees the enemy
      if (!S.keyPt || now % 200 < 20) {
        let best, bh = -1e9;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2, r = 6 + (i % 3) * 5;
          const w = walkableNear(ours[0].dimension, oc.x + Math.cos(a) * r, oc.z + Math.sin(a) * r, oc.y);
          if (!w) continue;
          const sc = w.y * 2 + (exposureAt(ours[0].dimension, w, known.slice(0, 3)) > 0 ? 5 : 0);
          if (sc > bh) { bh = sc; best = w; }
        }
        S.keyPt = best;
      }
    } catch {}
  }
  // v7.0: the radio net: squads of one faction (and its allies) within ~96 blocks share what they know, roughly
  for (const [ka, A] of squads) {
    if (now - A.t > 40 || !A.ourC) continue;
    const fa = Number(ka.split(":")[0]);
    for (const [kb, B2] of squads) {
      if (ka === kb || now - B2.t > 40 || !B2.ourC || !B2.known?.size) continue;
      const fb = Number(kb.split(":")[0]);
      if (fa !== fb && !isFriendly(fa, fb)) continue;
      if (Math.hypot(A.ourC.x - B2.ourC.x, A.ourC.z - B2.ourC.z) > 96) continue;
      for (const [id, q] of B2.known) if (!A.known.has(id) && now - q.t < 100) A.known.set(id, { ...q, t: q.t - 20, heard: true });
    }
  }
  for (const [k, S] of [...squads]) if (now - S.t > 600) { learnEnd(S, 0, now); squads.delete(k); }   // a squad gone (wiped out / out of range) ends its fight
  for (const [id, v] of [...suppB]) { const nv = v - 2; if (nv <= 0) suppB.delete(id); else suppB.set(id, nv); }
}, 20);
// suppression: fire landing on or near a soldier (hits or misses) shakes his aim and pushes him to cover
function suppressNear(t, w) { try { for (const o of nearbyCombatants(t.dimension.id, t.location, 3)) if (o.typeId === SOLDIER) suppB.set(o.id, Math.min(30, (suppB.get(o.id) ?? 0) + (w === "mg" ? 1.6 : w === "smg" ? 0.8 : 0.4))); } catch {} }
// fire at a position (suppressing a last known position, no clear view needed)
function fireAtPoint(e, spec, p) {
  const h = headLoc(e);
  let dx = p.x - h.x, dy = p.y + 1 - h.y, dz = p.z - h.z;
  const n = Math.hypot(dx, dy, dz) || 1;
  const r = () => (Math.random() + Math.random() - 1) * spec.spread * 3;
  const dir = { x: dx / n + r(), y: dy / n + r(), z: dz / n + r() };
  const from = { x: h.x + dir.x * 0.9, y: h.y - 0.2 + dir.y * 0.9, z: h.z + dir.z * 0.9 };
  try {
    const b = e.dimension.spawnEntity(spec.bullet, from);
    const pc = b.getComponent("minecraft:projectile");
    if (pc) { pc.owner = e; pc.shoot({ x: dir.x * spec.speed, y: dir.y * spec.speed, z: dir.z * spec.speed }); }
  } catch {}
  wallbang(e, spec, from, dir, n + 2);
  noteShot(e);
  for (const o of nearbyCombatants(e.dimension.id, p, 4)) if (o.typeId === SOLDIER) suppB.set(o.id, Math.min(30, (suppB.get(o.id) ?? 0) + 1));
}
function nearestKnownB(S, e) { let b, bd = 1e9; for (const q of S.known.values()) { const dd = Math.hypot(q.x - e.location.x, q.z - e.location.z); if (dd < bd) { bd = dd; b = q; } } return b ? { q: b, dd: bd } : undefined; }
function spotNear(e, test, anchor, leash, maxR = 4) {
  let best, bd = 1e9, tests = 0;
  const now = tick();
  for (let r = 1; r <= maxR; r++) for (let i = 0; i < 12; i++) {
    if (r >= bd || tests > 16) break;
    const a = (i / 12) * Math.PI * 2;
    const w = walkableNear(e.dimension, e.location.x + Math.cos(a) * r, e.location.z + Math.sin(a) * r, e.location.y);
    if (!w || Math.abs(w.y - e.location.y) > 1) continue;
    if (anchor && flat(w, anchor.location) > leash) continue;
    if (nearbyCombatants(e.dimension.id, w, 1.4).some((o) => o.typeId === SOLDIER && o.id !== e.id)) continue;
    if (claimedByOther(w, e.id, now)) continue;
    tests++;
    if (!test(w)) continue;
    if (r > 2 && !localReach(e.dimension, e.location, w)) continue;
    bd = r; best = w;
  }
  if (best) claimSpot(e, best, now);
  return best;
}
// ---- each gunner's decision (about twice a second, then he commits)
// a quick walk check (same rules as the route planner, small area): can he get there on foot from here?
const STAND = new Map();
system.runInterval(() => { if (STAND.size > 60000) STAND.clear(); }, 200);
const reachMemo = new Map(); // "from cell>to cell" -> { v, t }  (v5.7: the same question is asked every thought)
function localReach(dim, from, to, maxNodes = 400) {
  if (Math.abs(to.y - from.y) > 3) return false;
  if (flat(from, to) < 1.5) return true;
  const mk = `${dim.id[10] ?? ""}${Math.floor(from.x)},${Math.floor(from.y)},${Math.floor(from.z)}>${Math.floor(to.x)},${Math.floor(to.y)},${Math.floor(to.z)}`;
  const c = reachMemo.get(mk), now = tick();
  if (c && now - c.t < 100 && (c.v || c.n >= maxNodes)) return c.v;   // a "no" from a smaller search doesn't answer a bigger one
  const v = straightReach(dim, from, to) || localReachBFS(dim, from, to, maxNodes);   // (v5.9: open ground answers with a dozen lookups)
  reachMemo.set(mk, { v, t: now, n: maxNodes });
  if (reachMemo.size > 6000) reachMemo.clear();
  return v;
}
// "can stand here" (feet and head open, solid floor), shared by every search (~10 s)
function standAt(dim, x, y, z, now = tick()) {
  const k = bkey(dim.id, x, y, z), c = STAND.get(k);
  if (c !== undefined && now - c.t < 200) return c.v;
  let v = false;
  try { const f = tBlock(dim, x + 0.5, y - 1, z + 0.5), ft = tBlock(dim, x + 0.5, y, z + 0.5), h = tBlock(dim, x + 0.5, y + 1, z + 0.5);
    v = !!f && !!ft && !!h && !f.isAir && !f.isLiquid && !TI(f.typeId).hazard && passable(ft) && passable(h); } catch {}   // (v6.1: never on magma / a campfire)
  STAND.set(k, { v, t: now });
  return v;
}
// v5.9: a walk in a straight line, a block at a time, up or down at most one block per step (most spots in the open)
function straightReach(dim, from, to, endOk = false) {
  const L = flat(from, to);
  if (L > 16) return false;
  const n = Math.ceil(L), now = tick();
  let y = Math.floor(from.y + 0.01);
  for (let k = 1; k <= n; k++) {
    const x = Math.floor(from.x + ((to.x - from.x) * k) / n), z = Math.floor(from.z + ((to.z - from.z) * k) / n);
    if (dangerNear(dim, { x: x + 0.5, y, z: z + 0.5 }) && !(endOk && k === n)) return false;   // v6.2: past an edge / lava: not a walk for Minecraft (v6.9: but a perch at the end is)
    if (standAt(dim, x, y, z, now)) continue;
    if (standAt(dim, x, y + 1, z, now)) {                                       // a step up: room over his head to jump it
      const px = from.x + ((to.x - from.x) * (k - 1)) / n, pz = from.z + ((to.z - from.z) * (k - 1)) / n;
      try { if (!passable(tBlock(dim, px, y + 2, pz))) return false; } catch { return false; }
      y++; continue;
    }
    if (standAt(dim, x, y - 1, z, now)) { y--; continue; }
    return false;
  }
  return Math.abs(y - Math.floor(to.y + 0.01)) <= 1;
}
// v6.2: an instant short route (up to ~14 blocks) from the same search: every block on the way, for the glider / route
// driver to carry him along. Short moves (cover, a clear shot, making room) never wait for the planner.
function shortPath(dim, from, to, maxNodes = 700) {
  const sx = Math.floor(from.x), sz = Math.floor(from.z), tx = Math.floor(to.x), tz = Math.floor(to.z), now = tick();
  const sy = Math.floor(from.y + 0.01), rk = (x, y, z) => ((x - sx + 32) * 64 + (z - sz + 32)) * 1024 + (y - sy + 512);
  const par = new Map([[rk(sx, sy, sz), -1]]), q = [[sx, sy, sz]];
  for (let i = 0; i < q.length && i < maxNodes; i++) {
    const [x, y, z] = q[i];
    if (Math.abs(x - tx) <= 0 && Math.abs(z - tz) <= 0 && Math.abs(y - to.y) <= 1.5) {
      const out = []; let k = rk(x, y, z), c = [x, y, z];
      const byKey = new Map(q.map((p) => [rk(p[0], p[1], p[2]), p]));
      while (c) { out.push({ x: c[0] + 0.5, y: c[1], z: c[2] + 0.5, w: false, climb: false, open: false }); const pk = par.get(k); if (pk === undefined || pk === -1) break; k = pk; c = byKey.get(pk); }
      return out.reverse();
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1, -2]) {
      const nx = x + dx, nz = z + dz, ny = y + dy, k = rk(nx, ny, nz);
      if (par.has(k) || Math.abs(nx - sx) > 15 || Math.abs(nz - sz) > 15) continue;
      if (!standAt(dim, nx, ny, nz, now)) continue;
      if (dy === 1) { try { if (!passable(tBlock(dim, x + 0.5, y + 2, z + 0.5))) continue; } catch { continue; } }
      par.set(k, rk(x, y, z)); q.push([nx, ny, nz]); break;
    }
  }
  return undefined;
}
function localReachBFS(dim, from, to, maxNodes) {
  const sx = Math.floor(from.x), sz = Math.floor(from.z), tx = Math.floor(to.x), tz = Math.floor(to.z);
  const did = dim.id, now = tick();
  const stand = (x, y, z) => standAt(dim, x, y, z, now);
  const sy = Math.floor(from.y), rk = (x, y, z) => ((x - sx + 32) * 64 + (z - sz + 32)) * 1024 + (y - sy + 512);
  const seen = new Set([rk(sx, sy, sz)]), q = [[sx, sy, sz]];
  for (let i = 0; i < q.length && i < maxNodes; i++) {
    const [x, y, z] = q[i];
    if (Math.abs(x - tx) <= 1 && Math.abs(z - tz) <= 1 && Math.abs(y - to.y) <= 1.5) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1, -2, -3]) {
      const nx = x + dx, nz = z + dz, ny = y + dy, k = rk(nx, ny, nz);
      if (seen.has(k) || Math.abs(nx - sx) > 14 || Math.abs(nz - sz) > 14) continue;
      if (!stand(nx, ny, nz)) continue;
      if (dy === 1) { try { if (!passable(tBlock(dim, x + 0.5, y + 2, z + 0.5))) continue; } catch { continue; } }
      seen.add(k); q.push([nx, ny, nz]); break;
    }
  }
  return false;
}
function planPersonalTo(e, kind, dest, now) {
  const pr = { pts: undefined, idx: 0, kind, t: now, planning: true, dest: { x: dest.x, y: dest.y, z: dest.z } };
  personal.set(e.id, pr);
  const hit = cachedRoute(e.dimension, e.location, dest);                       // a squad mate just worked this out: use his route
  if (hit) { pr.planning = false; pr.pts = hit; return; }
  if (flat(e.location, dest) <= 14 && Math.abs(dest.y - e.location.y) <= 3) {   // v6.2: a short hop: instant route, no waiting
    const sp = shortPath(e.dimension, e.location, dest);
    if (sp && sp.length > 1) { pr.planning = false; pr.pts = sp; return; }
  }
  if (planJobs.length > 28) { pr.planning = false; pr.pts = undefined; pr.t = now - 10000; return; }   // planner busy: try again shortly
  const dim = e.dimension;
  // v5.4: going for the enemy's floor, the route ends as soon as it's on that floor near him (the first room, not his feet)
  const gy = Math.floor(dest.y);
  const accept = kind === "advance" && Number.isFinite(dest.y) ? (n) => !n.climb && Math.abs(n.y - gy) <= 1 && Math.hypot(n.x + 0.5 - dest.x, n.z + 0.5 - dest.z) <= 12 : undefined;
  const far = flat(e.location, dest);                                           // v5.4: the search is sized to the trip (a short hop never ties up the planner)
  const Sq = squads.get(squadKey(e, sd(e)));
  const danger = bwOf(sd(e).faction).cov !== false && Sq?.known?.size && ["advance", "engage", "spot", "rally", "refuge", "exit", "settle"].includes(kind)
    ? [...Sq.known.values()].filter((q) => now - q.t < 300).slice(0, 4).map((q) => ({ x: q.x, y: q.y + 1.6, z: q.z })) : undefined;
  planRoute(dim, e.location, dest, (pts, partial) => { pr.planning = false; pr.pts = pts; pr.idx = 0; if (pts && !partial) rememberRoute(dim, dest, pts); }, { max: Math.max(3000, Math.min(20000, Math.round(far * 300))), maxRadius: Math.min(90, far + 30), accept, danger });
}
function brainMove(e, d, now, melee, anchor, leash) {
  const BW = squads.get(squadKey(e, d))?.bw ?? bwOf(d.faction);
  if (d.retreat || d.surr || d.div === "medic" || d.div === "guard" || isRiding(e)) return undefined;
  const stance = String(gdp(e, "war:stance") ?? "aggressive");
  if (stance === "holdfire") return undefined;
  const S = squads.get(squadKey(e, d));
  if (!S || !S.known.size) { brain.delete(e.id); return undefined; }
  if (["charge", "follow", "patrol"].includes(d.func)) {
    const n0 = nearestKnownB(S, e);
    const hit = now - (hurtBy.get(e.id)?.t ?? -999) < 100 || now - (firedAt.get(e.id)?.t ?? -999) < 60;
    if (!n0 || (n0.dd > 50 && !hit)) return undefined;                 // far away: keep to the order, shoot on the move
    // the enemy is on another level (down the stairs, up on the wall): go along a real route, not a straight line
    if (!melee && n0.dd <= 40 && Math.abs(n0.q.y - e.location.y) > 3 && !personal.has(e.id) && now - (brain.get(e.id)?.routeT ?? -999) > 200) {
      const Bx = brain.get(e.id) ?? { act: "", decT: -999 }; Bx.routeT = now; brain.set(e.id, Bx);
      planPersonalTo(e, "advance", { x: n0.q.x, y: n0.q.y, z: n0.q.z }, now);
      return followPersonal(e, now);
    }
  }
  let B = brain.get(e.id);
  if (!B) { B = { act: "", decT: -999 }; brain.set(e.id, B); }
  const go = (spot, urgent = true) => { if (!spot) return undefined;
    if (!(B.reachSpot && flat(B.reachSpot, spot) < 0.6 && Math.abs(B.reachSpot.y - spot.y) < 0.6)) {   /* (checked once per spot, not every thought) */
      if (!localReach(e.dimension, e.location, spot)) { B.act = ""; return undefined; }   /* not reachable on foot from here: skip it */
      B.reachSpot = { x: spot.x, y: spot.y, z: spot.z };
    }
    return moveTo(e, spot, now, urgent, "spot"); };   // v6.2: through the movement gate (safe spots; routes where a straight walk isn't safe)
  const known = [...S.known.values()];
  if (melee) {
    const n = nearestKnownB(S, e);
    if (n && n.dd < (S.plan === "assault" ? 90 : 60)) { note(e, "charging"); return undefined; }       // engagement charges him in
    return undefined;
  }
  if (!GUNS.includes(d.weapon)) return undefined;
  const ps = perc.get(e.id), t = ps?.threat?.isValid ? ps.threat : undefined;
  if (now - B.decT >= BW.commit && spendDecision()) {
    B.decT = now;
    const bold = boldOf(e), winning = S.ratio > 1.5;
    const dd = t ? dist(t.location, e.location) : 1e9;
    const shot = !!shotAt(e, d, t, now);
    const exposure = exposureAt(e.dimension, e.location, known.slice(0, 3));
    B.exp = exposure;
    const covered = t ? !clearShot(e.dimension, chest(t), { x: e.location.x, y: e.location.y + 0.5, z: e.location.z }) : false;
    const underFire = now - (firedAt.get(e.id)?.t ?? -999) < 40 || attackedRecently(e, t ?? e, now, 40);
    const p = t ? Math.min(1, (GOOD_RANGE_B[d.weapon] ?? 40) / Math.max(1, dd)) * (shot ? 1 : 0) : 0;
    const gs = t?.typeId === SOLDIER ? gunState.get(t.id) : undefined;
    const enemyWeak = !!t && ((gs && gs.ammo === (GUN_SPEC[sd(t).weapon]?.mag ?? 1) && gs.next - now > 20) || (suppB.get(t.id) ?? 0) > 8 || now - (hurtBy.get(t.id)?.t ?? -999) < 30);
    const moving = ["charge", "follow", "patrol"].includes(d.func) || !!S.counter;   // (v6.9.1: or counter-attacking from Hold)
    const opts = [];
    if (S.flankers.has(e.id) && S.plan === "fix" && S.flankPt && flat(S.flankPt, e.location) > 6) opts.push(["flank", 3]);
    if (t && shot) opts.push(["fire", BW.fire * p * (S.suppressors.has(e.id) ? 1.5 : 1) - BW.expo * exposure * (covered ? 0.3 : 1)]);
    const needGround = moving ? (t ? (dd > (GOOD_RANGE_B[d.weapon] ?? 40) * BW.close ? 1 : 0.35) : 1) : 0;
    opts.push(["advance", bold * (BW.adv * needGround + (enemyWeak ? BW.timing : 0) + (S.plan === "assault" ? BW.assault : 0) + (winning ? 0.3 : 0)) - (S.plan === "fix" && S.suppressors.has(e.id) ? 0.8 : 0) - 0.15 * exposure * (1 - BW.close) - (S.siege ? 0.5 : 0) - (d.weapon === "sniper" ? 0.6 : 0)]);
    if (underFire && !covered && exposure > 0) opts.push(["cover", (2 - bold) * BW.cover * exposure + ((suppB.get(e.id) ?? 0) > 8 ? 0.4 : 0)]);
    const shotBy = firedAt.get(e.id), returning = !!shotBy && now - shotBy.t < 60;
    B.supp = !shot && (S.suppressors.has(e.id) || d.weapon === "mg" || returning) ? suppressPoint(e, d, S, now) : undefined;   // v5.4: only a fresh sighting, in range, with a line to it
    if (B.supp) opts.push(["suppress", BW.supp + (S.plan === "fix" ? 0.4 : 0)]);
    if (!shot) opts.push(["peek", BW.peek]);
    const hp = e.getComponent("minecraft:health");
    if (hp && hp.currentValue < 5 && exposure >= 2) opts.push(["fallback", BW.fall]);
    if (!moving) opts.push(["hold", 0.5 + (t ? 0 : 0.3)]);
    const tac = BW.tac !== false;
    if (tac && !moving && S.enemyC && (!shot || (underFire && exposure > 0)) && now - (B.posT ?? -999) > 60) opts.push(["position", 0.55 + (!shot ? 0.35 : 0) + (underFire && exposure > 0 ? 0.5 : 0)]);   // v5.6: a better firing position near his post
    if (S.keyPt && (d.weapon === "mg" || d.weapon === "sniper" || !moving) && !shot) opts.push(["terrain", BW.terrain + (d.weapon === "sniper" ? 0.8 : 0)]);
    if (d.weapon === "sniper" && t && shot) opts.push(["fire", 1.6]);                  // a sniper with a shot takes it
    if ((!moving || underFire) && S.enemyC) {
      const threatAt = t?.isValid ? t.location : S.enemyC;            // the nearest danger decides which side is safe
      const sbs = sandbagSpot(e, threatAt, anchor, leash, now);
      if (sbs) {
        const holding = B.act === "sandbag" && B.sandbag && flat(B.sandbag, sbs) < 1.5;
        B.sandbag = sbs;
        opts.push(["sandbag", (holding ? 2.2 : 1.2) + (underFire ? 0.5 : 0)]);  // once there, he stays while the bags shield him
      }
    }
    opts.sort((a, b) => b[1] - a[1]);
    const prevAct = B.act;
    B.act = opts[0][0];
    if (B.act !== prevAct) decisionLine(e, B.act, underFire);           // (v6.9.1: what he's doing, out loud)
    B.spot = undefined;
    const ts = (o) => { const r = tac ? tacSpot(e, d, S, { anchor, leash, ...o }, now) : undefined; if (r?.spot) B.reachSpot = r.spot; return r; };   // (its spot is known reachable)
    if (B.act === "cover") {
      const r = ts({ rMin: 1.5, rMax: 6, wCover: 1.6, wShot: 0.7, margin: 0.3 });     // v5.6: real cover that can still fire back
      B.target = r ? r.spot : spotNear(e, (w) => !t || !clearShot(e.dimension, chest(t), { x: w.x, y: w.y + 0.5, z: w.z }), anchor, leash);
      if (r?.stay) B.act = shot ? "fire" : "hold";
    } else if (B.act === "position") {
      B.posT = now;
      const r = ts({ rMin: 1.5, rMax: Math.min(9, leash ?? 9), wCover: 1, wShot: 1.4, margin: 0.6 });
      B.target = r?.spot; if (!B.target) B.act = shot ? "fire" : "hold";
    }
    else if (B.act === "peek") {
      const n = nearestKnownB(S, e);
      // rare, believable mistake: a stale sighting (2+ s old, not shooting at us) is remembered a little off
      let tp = n?.q; if (tp && now - tp.t > 40 && !underFire && Math.random() < 0.05) tp = { ...tp, x: tp.x + (Math.random() - 0.5) * 10, z: tp.z + (Math.random() - 0.5) * 10 };
      const r = tac && tp && tp === n?.q ? ts({ rMin: 1.5, rMax: 8, wCover: 0.6, wShot: 2, margin: 0.2 }) : undefined;   // v5.6: a spot with a shot, and cover if there is any
      B.target = r?.spot ?? (tp ? spotNear(e, (w) => clearShot(e.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, { x: tp.x, y: tp.y + 1.2, z: tp.z }), anchor, leash, 8) : undefined);
    } else if (B.act === "fallback") {
      const n = nearestKnownB(S, e);
      if (n) { const dx = e.location.x - n.q.x, dz = e.location.z - n.q.z, L = Math.hypot(dx, dz) || 1; B.target = walkableNear(e.dimension, e.location.x + dx / L * 8, e.location.z + dz / L * 8, e.location.y); }
    } else if (B.act === "advance" && S.plan !== "advance" && moving && tac && (B.target = ts({ rMin: 4, rMax: 10, toward: S.enemyC, wProg: 1.3, wCover: 1, wShot: 0.6, margin: -9 })?.spot)) {
      // v5.6: bounding from cover to cover toward the enemy (the evaluator's pick, kept in B.target)
    } else if (B.act === "advance" && S.plan !== "advance" && moving) {
      // covered approach: of three directions toward the enemy, the least exposed
      const g = S.enemyC; const dx = g.x - e.location.x, dz = g.z - e.location.z, L = Math.hypot(dx, dz) || 1;
      let best, be = 1e9;
      for (const a of [0, 0.5, -0.5]) {
        const c = Math.cos(a), sn = Math.sin(a);
        const w = walkableNear(e.dimension, e.location.x + (dx / L * c - dz / L * sn) * 8, e.location.z + (dx / L * sn + dz / L * c) * 8, e.location.y);
        if (!w) continue;
        const ex = exposureAt(e.dimension, w, known.slice(0, 3)) + (a ? 0.3 : 0);
        if (ex < be) { be = ex; best = w; }
      }
      B.target = best;
    } else B.target = undefined;
  }
  {
    const bm = buildingMove(e, d, now, S, t, B, now - (firedAt.get(e.id)?.t ?? -999) < 40, B.exp ?? 0, ["charge", "follow", "patrol"].includes(d.func), anchor);
    if (bm) return bm;
  }
  switch (B.act) {
    case "flank": note(e, "flanking"); return S.flankSlot && marker(S.flankSlot) ? { g: "g_wp", slot: S.flankSlot, t: "t_mid", urgent: true } : undefined;
    case "fire": note(e, "firing"); return { g: "g_none", t: "t_mid", urgent: false };
    case "cover": note(e, "taking cover"); return B.target ? go(B.target) : { g: "g_none", t: "t_mid", urgent: false };
    case "peek": note(e, "peeking for a shot"); return B.target ? go(B.target) : undefined;
    case "suppress": {
      const q = B.supp, spec = GUN_SPEC[d.weapon], gs = gunState.get(e.id);
      if (!q || now - q.t > 60 || !q.ent?.isValid || downed.has(q.ent.id)) { B.act = ""; B.decT = -999; return undefined; }   // nothing fresh to pin down: decide again
      note(e, "suppressing");
      if (gs) gs.supp = { p: q.aim ?? { x: q.x, y: q.y + 1.2, z: q.z }, until: now + 30, ent: q.ent };   // the gun loop keeps up the fire (bursts at the gun's own rate)
      turnTo(e, q, 20);
      // on the move (not pinning for a flank): keep walking while suppressing
      if (["charge", "follow", "patrol"].includes(d.func) && S.plan !== "fix") return undefined;
      return { g: "g_none", t: "t_mid", urgent: false };
    }
    case "fallback": note(e, "falling back"); return B.target ? go(B.target) : undefined;
    case "terrain": note(e, "taking high ground"); return S.keyPt ? go(S.keyPt, false) : undefined;
    case "position": if (!B.target || flat(B.target, e.location) < 0.9) { B.act = "hold"; return undefined; } note(e, "taking a firing position"); return go(B.target, false);
    case "sandbag": {
      if (!B.sandbag) return undefined;
      const dSb = flat(B.sandbag, e.location);
      if (dSb > 0.45) {
        note(e, "taking the sandbags");
        if (dSb < 3.5) { push(e, { x: (B.sandbag.x - e.location.x) * 0.3, y: 0.02, z: (B.sandbag.z - e.location.z) * 0.3 }, 3); return { g: "g_none", t: "t_mid", urgent: false }; }
        return go(B.sandbag);
      }
      // at the bags: fire over them; step back out of sight to reload, then back up
      const gs = gunState.get(e.id), reloading = gs && gs.ammo === (GUN_SPEC[d.weapon]?.mag ?? 1) && gs.next - now > 10;
      if (reloading && S.enemyC) {
        const dx = e.location.x - S.enemyC.x, dz = e.location.z - S.enemyC.z, L = Math.hypot(dx, dz) || 1;
        const duck = walkableNear(e.dimension, B.sandbag.x + (dx / L) * 1.2, B.sandbag.z + (dz / L) * 1.2, B.sandbag.y);
        if (duck) { note(e, "ducking behind the bags"); return go(duck); }
      }
      note(e, "firing over the sandbags");
      return { g: "g_none", t: "t_mid", urgent: false };
    }
    case "hold": return undefined;
    case "advance": note(e, S.plan === "assault" ? "assaulting" : "advancing"); return B.target ? go(B.target) : undefined;
  }
  return undefined;
}
// "good shot" range per weapon (same model as the simulator)
function erfB(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const GOOD_RANGE_B = {};
for (const [k, spec] of Object.entries(GUN_SPEC)) {
  const sig = spec.spread * 0.653; let dd = 4;
  while (dd < spec.fire) { const sdv = Math.max(1e-4, sig * dd * Math.SQRT2); if (Math.abs(erfB(0.3 / sdv)) * Math.abs(erfB(0.9 / sdv)) < BW.goodHit) break; dd += 2; }
  GOOD_RANGE_B[k] = dd;
}

// ================================================================ Part C1 (v4.7)
// ---- personalities: every soldier is a little bolder or more careful (stable per soldier)
const boldOf = (e) => { let h = 0; for (const ch of e.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 0.8 + (h % 41) / 100; }; // 0.80 .. 1.20
// ---- performance: brain decisions are budgeted per tick so huge battles never spike
let decisionBudget = 0;
system.runInterval(() => { decisionBudget = 20; }, 1);
const spendDecision = () => (decisionBudget-- > 0);

// ---- fluid water crossings: in water a soldier only ever keeps moving: steady strokes along his route,
// a boost up the bank as soon as he touches it. No firing / peeking / taking cover in the water.
const wetMemo = new Map(); // id -> { t, v }  (v5.9: dry soldiers are checked once a second, not 5 times)
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const w = wetMemo.get(e.id);
      if (w && !w.v && now - w.t < 20) continue;
      const wet = !isRiding(e) && inWater(e);
      wetMemo.set(e.id, { t: now, v: wet });
      if (!wet) continue;
      const g = goalPoint(e);
      if (!g) continue;
      const p = e.location, dx = g.x - p.x, dz = g.z - p.z, l = Math.hypot(dx, dz) || 1;
      if (l < 2) continue;
      let bank = false;
      try {
        const ax = p.x + (dx / l) * 0.9, az = p.z + (dz / l) * 0.9, y = Math.floor(p.y);
        const f = e.dimension.getBlock({ x: ax, y, z: az }), h = e.dimension.getBlock({ x: ax, y: y + 1, z: az });
        bank = !!f && !f.isAir && !f.isLiquid && !!h && passable(h);
      } catch {}
      push(e, { x: (dx / l) * 0.32, y: bank ? 0.55 : 0.05, z: (dz / l) * 0.32 }, 2);
      note(e, bank ? "climbing out" : "swimming across");
    } catch {}
  }
}, 4);

function reinforceMove(e, d, now) {
  if (d.retreat || d.surr || d.div === "medic" || d.div === "guard" || isRiding(e) || now % 40 >= 20 && !reinforcing.has(e.id)) return reinforcing.get(e.id)?.mv;
  const spot = reinforceSpot(e, d, now);
  if (!spot) { reinforcing.delete(e.id); return undefined; }
  const prev = reinforcing.get(e.id);
  if (prev && flat(prev.at, spot) < 6) return travel(e, prev.at, "reinforce", now, true);
  const mv = travel(e, spot, "reinforce", now, true);
  if (!mv) return undefined;
  reinforcing.set(e.id, { at: spot, slot: mv.slot ?? 0, mv });
  note(e, "reinforcing"); callout(e, "Moving up!");
  return mv;
}
const reinforcing = new Map();
// ---- squads helping each other: a squad being mauled draws help from free squads nearby, who come in
// from the side (crossfire), never from the same direction
const helpCall = new Map(); // helped squad key -> { enemyC, ourC, t, dim, f }
function squadHelpTargets(k, S, ours, now) {
  if (S.known.size && S.ratio < 0.8 && S.enemyC) helpCall.set(k, { enemyC: S.enemyC, ourC: S.ourC, t: now, dim: ours[0].dimension.id, f: sd(ours[0]).faction });
  else if (helpCall.has(k) && now - helpCall.get(k).t > 200) helpCall.delete(k);
}
function reinforceSpot(e, d, now) {
  if (!freeOf(e) || d.func === "post") return undefined;
  const myKey = squadKey(e, d);
  const mine = squads.get(myKey);
  if (mine && mine.known.size) return undefined;                       // we're busy ourselves
  let best, bd = 1e9;
  for (const [k, h] of helpCall) {
    if (k === myKey || h.dim !== e.dimension.id || !isFriendly(d.faction, h.f) || now - h.t > 200) continue;
    const dd = Math.hypot(h.enemyC.x - e.location.x, h.enemyC.z - e.location.z);
    if (dd < 140 && dd < bd) { bd = dd; best = h; }
  }
  if (!best) return undefined;
  // come in from the side: 90 degrees off the line between the mauled squad and its enemy
  const dx = best.enemyC.x - best.ourC.x, dz = best.enemyC.z - best.ourC.z, L = Math.hypot(dx, dz) || 1;
  const side = ((e.location.x - best.enemyC.x) * (-dz) + (e.location.z - best.enemyC.z) * dx) >= 0 ? 1 : -1;
  return walkableNear(e.dimension, best.enemyC.x + (-dz / L) * 30 * side, best.enemyC.z + (dx / L) * 30 * side, best.enemyC.y);
}

// ---- adapting: remember what failed. A flank that didn't break them -> next time the other side;
// an assault that stalled -> pin them again; the same approach failing twice -> stop trying it for a while
const squadMemory = new Map(); // key -> { failedSides: Set, flankFails, assaultFails, siegeUntil, lastPlan, lastEnemyPower, planT }
function adaptSquad(k, S, now, BW = bwOf(Number(String(k).split(":")[0]))) {
  const m = squadMemory.get(k) ?? { failedSides: new Set(), flankFails: 0, assaultFails: 0, siegeUntil: 0, lastPlan: "", planT: now };
  squadMemory.set(k, m);
  if (S.plan !== m.lastPlan) { m.lastPlan = S.plan; m.planT = now; m.startRatio = S.ratio; }
  if (S.plan === "fix" && now - m.planT > BW.stallT * 3 && S.ratio <= (m.startRatio ?? S.ratio) + 0.05) {
    m.flankFails++; if (S.flankSide) m.failedSides.add(S.flankSide);           // the flank went nowhere
  }
  if (S.plan === "contact" && m.lastPlanWasAssault) { m.assaultFails++; m.lastPlanWasAssault = false; }
  if (S.plan === "assault") m.lastPlanWasAssault = true;
  if (m.flankFails + m.assaultFails >= 2 && !m.siegeUntil) { m.siegeUntil = now + 1200; m.flankFails = 0; m.assaultFails = 0; } // 1 min: pin and grind, no more rushes
  if (m.siegeUntil && now > m.siegeUntil) { m.siegeUntil = 0; m.failedSides.clear(); }
  return m;
}

// ---- the War Horn: aim with your eyes. Use = your soldiers nearby attack that way, everything in that
// direction is their priority. Sneak + use = they focus fire that way without moving.
const hornCone = new Map(); // soldier id -> { x, z, dx, dz, until }
function inHornCone(e, o, now) {
  const h = hornCone.get(e.id);
  if (!h || now > h.until) return false;
  const vx = o.location.x - h.x, vz = o.location.z - h.z, L = Math.hypot(vx, vz) || 1;
  return (vx * h.dx + vz * h.dz) / L > 0.866;                          // within ~30 degrees of the horn's direction
}
async function blowHorn(player) {
  const f = playerFaction(player);
  if (!f) { player.sendMessage("§cJoin a faction at the War Table first."); return; }
  const dir = player.getViewDirection(), hl = Math.hypot(dir.x, dir.z) || 1;
  const now = tick();
  const holdFire = player.isSneaking;
  const soldiers = player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: 64 })
    .filter((e) => { try { const d = sd(e); return d.faction === f && !d.surr && d.div !== "guard" && d.div !== "medic" && !isRiding(e); } catch { return false; } });
  if (!soldiers.length) { player.onScreenDisplay.setActionBar("§7No soldiers of yours within 64 blocks."); return; }
  for (const e of soldiers) hornCone.set(e.id, { x: player.location.x, z: player.location.z, dx: dir.x / hl, dz: dir.z / hl, until: now + (holdFire ? 600 : 1200) });
  try { player.dimension.playSound("raid.horn", player.location, { volume: 4, pitch: holdFire ? 1.3 : 1 }); } catch {}
  if (holdFire) { player.onScreenDisplay.setActionBar(`§eFire that way! §f${soldiers.length} soldiers`); return; }
  // attack that way: a Charge POS aimed by your eyes (to what you're looking at, or ~100 blocks out)
  let pt = aimFar(player);
  if (!pt || pt.estimated || dist(pt, player.location) > 200) pt = { x: player.location.x + (dir.x / hl) * 100, y: player.location.y, z: player.location.z + (dir.z / hl) * 100 };
  const march = startMarch(player, soldiers, pt, "hold");
  if (!march) return;
  let n = 0;
  for (const e of soldiers) {
    freshMind(e);
    sdp(e, "war:cmdr", player.id); sdp(e, "war:stance", "aggressive"); sdp(e, "war:ordt", now);
    sdp(e, "war:ao", 100); sdp(e, "war:free", true); sdp(e, "war:then", "hold");
    hornCone.set(e.id, { x: player.location.x, z: player.location.z, dx: dir.x / hl, dz: dir.z / hl, until: now + 1200 });
    giveFunction(e, mapFunc("charge", sd(e).div), player, march.lanes[n % march.lanes.length]); n++;
  }
  player.onScreenDisplay.setActionBar(`§eAttack that way! §f${n} soldiers`);
}
// your own shots: when you hit someone, your soldiers nearby go after him too
world.afterEvents.entityHurt.subscribe((ev) => {
  const a = ev.damageSource.damagingEntity, v = ev.hurtEntity;
  if (a?.typeId !== "minecraft:player" || !v?.isValid || v.id === a.id) return;
  const f = playerFaction(a);
  if (!f || (v.typeId !== SOLDIER && v.typeId !== "minecraft:player" && v.typeId !== HOUND && !VEHICLES.includes(v.typeId))) return;
  if (isFriendly(f, factionOf(v))) return;
  const now = tick();
  for (const o of nearbyCombatants(a.dimension.id, a.location, 48)) {
    if (o.typeId !== SOLDIER) continue;
    try { if (Number(P(o, "war:faction")) === f) { assist.set(o.id, { id: v.id, t: now }); provoked.set(`${f}:${v.id}`, now + 1200); provokedT.set(f, now); } } catch {}
  }
});

// ---- v6.5: battle chatter, spoken. Each faction's soldiers shout in its language (War Table -> Settings -> Callout
// language); what you read on screen stays English. Recorded lines live in the resource pack (sounds/war_voice/<lang>/),
// one sound event per line: war.voice.<lang>.<line>. A language with no recordings yet just stays silent.
const VOICE_KEYS = ["none", "en_us", "en_gb", "greek", "korean", "spanish", "hebrew", "dutch", "german", "mongolian", "russian", "italian", "hindi", "igbo", "haitian", "arabic_sy", "chinese", "maya", "aave"];
const VOICE_NAMES = ["None (silent)", "US English", "British English", "Greek", "Korean", "Spanish", "Hebrew", "Dutch", "German", "Mongolian", "Russian", "Italian", "Hindi", "Igbo", "Haitian Creole", "Syrian Arabic (mixed)", "Chinese (Mandarin)", "Yucatec Maya", "AAVE"];
function voiceOf(f) { const v = getJSON(world, "war:vlang", {})[f]; return VOICE_KEYS.includes(v) ? v : "en_us"; }
// the English line (as the code calls it) -> the recorded line. Lines with no recording (Reloading, Grenade, On the gun) are silent
const CALL_KEY = { "Enemy spotted!": "spotted", "Contact!": "contact", "Flanking!": "flanking", "Charge!": "charge", "Go, go, go!": "gogogo",
  "Moving up!": "moving_up", "Suppressing!": "suppressing", "I'm hit!": "hit", "Man down!": "man_down", "You're okay!": "okay", "Fall back!": "fall_back",
  "Cover me!": "cover_me", "Target down!": "target_down", "Clear!": "clear", "Hold position!": "hold", "Follow me!": "follow",
  "Medic!": "medic", "Thanks!": "thanks", "Reloading!": "reloading", "Grenade!": "grenade", "Don't shoot!": "surrender", "Taking fire!": "under_fire" };
// lines each language has recordings for (the rest stay silent until recorded and added here)
const BASE_LINES = ["spotted", "contact", "flanking", "charge", "gogogo", "moving_up", "suppressing", "hit", "man_down", "okay", "fall_back", "cover_me", "target_down", "clear", "hold", "follow"];
const MORE_LINES = ["under_fire", "idle_quiet", "idle_sharp", "idle_smoke", "idle_done", "idle_legs", "medic", "thanks", "surrender", "reloading", "grenade"];
const VOICE_HAS = Object.fromEntries(["en_us", "greek", "korean", "mongolian", "hebrew", "spanish", "german", "aave"].map((l) => [l, [...BASE_LINES, ...MORE_LINES]]));   // (v6.7: recorded so far)
const IDLE_LINES = ["idle_quiet", "idle_sharp", "idle_smoke", "idle_done", "idle_legs"];
const voiceHas = (lang, key) => (VOICE_HAS[lang] ?? BASE_LINES).includes(key);
const CALL_ALL = BASE_LINES;
const lastCall = new Map(); // soldier id / squad line -> tick
let callSec = -1, callsThisSec = 0;
// v6.8: every line, what it says (English, for subtitles and the test menu) and when it's used
const LINE_INFO = {
  spotted: ["Enemy spotted!", "first sees an enemy"], contact: ["Contact!", "his squad first makes contact"],
  flanking: ["Flanking!", "the squad sends men round the side"], charge: ["Charge!", "the squad assaults"],
  gogogo: ["Go, go, go!", "the assault goes in"], moving_up: ["Moving up!", "moving forward under fire, reinforcing, a medic on his way"],
  suppressing: ["Suppressing!", "pinning the enemy down, covering a mate who reloads"], hit: ["I'm hit!", "wounded"],
  man_down: ["Man down!", "a squad mate falls nearby"], okay: ["You're okay!", "a medic revives someone"],
  fall_back: ["Fall back!", "shaken, or the squad pulls back"], cover_me: ["Cover me!", "bounding forward while mates cover"],
  target_down: ["Target down!", "the man he shot goes down"], clear: ["Clear!", "the fight is over"],
  hold: ["Hold position!", "the march arrives"], follow: ["Follow me!", "a march starts"],
  under_fire: ["Taking heavy fire!", "shot at, pinned down"], idle_quiet: ["Sector's locked down...", "idle"],
  idle_sharp: ["Head on a swivel, stay frosty.", "idle"], idle_smoke: ["Anyone got a dart?", "idle (tired)"],
  idle_done: ["So done with this deployment...", "idle (tired)"], idle_legs: ["My legs are shot...", "idle (tired)"],
  medic: ["Medic! I'm hit!", "down, and no medic coming"], thanks: ["Good looking out, brother.", "just revived"],
  surrender: ["Don't shoot!", "surrendering"], reloading: ["Dry, cover me while I swap!", "reloading in a fight"],
  grenade: ["Frag out! Get down!", "throwing a grenade / molotov, or one lands near him"],
};
const heardLine = []; // recent lines: { key, dim, x, z, t } (nobody repeats a line someone near just said)
const LINE_WIN = (key) => (IDLE_LINES.includes(key) ? 6000 : key === "medic" ? 240 : key === "hit" || key === "man_down" || key === "target_down" ? 60 : 100);   // (v6.9.1: 5 s for battle lines, was 8)
const callGap = () => [120, 60, 30][Math.max(0, Math.min(2, Number(setting("vfreq", 1))))];   // per man: Low / Normal / High
function playLine(dim, at, lang, key, pitch = 1, who) {
  try { dim.playSound(`war.voice.${lang}.${key}`, at, { volume: 1.0, pitch }); } catch {}
  if (setting("vsubs", false) || who?.forceSubs) {
    const txt = `§7${who?.label ?? "Soldier"}:§f "${LINE_INFO[key]?.[0] ?? key}"`;
    for (const p of world.getAllPlayers()) { try { if (p.dimension.id === dim.id && dist(p.location, at) <= 24) p.onScreenDisplay.setActionBar(txt); } catch {} }
  }
}
function callout(e, text, opt = {}) {
  try {
    if (!e?.isValid || held.has(e.id) || (downed.has(e.id) && !["I'm hit!", "Medic!", "Don't shoot!"].includes(text) && !opt.force)) return false;
    const test = text === "Testing!";
    const f = Number(P(e, "war:faction") ?? 0), lang = opt.lang ?? voiceOf(f);
    if (!lang || lang === "none") return false;
    const has = VOICE_HAS[lang] ?? BASE_LINES, now = tick(), l = e.location, did = e.dimension.id;
    const saidNear = (k, win) => heardLine.some((h) => h.key === k && h.f === f && h.dim === did && now - h.t < win && Math.abs(h.x - l.x) < 40 && Math.abs(h.z - l.z) < 40);   // (v6.9.3: per faction: two sides can both shout "Contact!")
    let key = opt.key ?? (test ? has[Math.floor(Math.random() * has.length)] : CALL_KEY[text]);
    if (text === "IDLE") { const fresh = IDLE_LINES.filter((k) => voiceHas(lang, k) && !saidNear(k, 6000)); key = fresh[Math.floor(Math.random() * fresh.length)]; }
    if (!key || !voiceHas(lang, key)) return false;
    if (!test && !opt.force) {
      if (now - (lastCall.get(e.id) ?? -9999) < callGap()) return false;        // one shout per man every few seconds
      if (saidNear(key, LINE_WIN(key))) return false;                         // v6.8: never the same line from two men at once (any squad)
      const sec = Math.floor(now / 20); if (sec !== callSec) { callSec = sec; callsThisSec = 0; }
      if (callsThisSec >= 6 || !playerNear(e, 32)) return false;            // (v6.9.3: up to 6 a second, overlapping: a battle sounds like one)              // never a wall of noise; nobody near: no sound
    }
    lastCall.set(e.id, now); callsThisSec++;
    if (lastCall.size > 4000) lastCall.clear();
    heardLine.push({ key, f, dim: did, x: l.x, z: l.z, t: now });
    while (heardLine.length && now - heardLine[0].t > 6000) heardLine.shift();
    if (heardLine.length > 300) heardLine.splice(0, heardLine.length - 300);
    const pitch = 0.92 + ((e.id.charCodeAt(e.id.length - 1) * 7) % 17) / 100 - (downed.has(e.id) ? 0.05 : 0);   // his own voice (weaker when he's down)
    playLine(e.dimension, headLoc(e), lang, key, pitch, { label: `${factionLabel(f)}§7 ${squadName(f, sd(e).squad)}`, forceSubs: opt.subs });
    if (!opt.force) afterLine(e, key, now);                                  // (a test line gets no answer)
    return true;
  } catch { return false; }
}
// v6.8: the squad answers. A man reloading gets cover ("Suppressing!"), a wounded man's call is answered by the medic
// coming ("Moving up!"), "Contact!" gets "Enemy spotted!" from someone else, idle talk is sometimes answered.
// v6.9.1: a new decision in a fight gets its line (the dedupe and per-man gaps keep it from becoming a chorus)
function decisionLine(e, act, underFire) {
  const r = Math.random();
  if (act === "flank") { if (r < 0.6) callout(e, "Flanking!"); }
  else if (act === "suppress") { if (r < 0.45) callout(e, "Suppressing!"); }
  else if (act === "fallback") { if (r < 0.6) callout(e, "Fall back!"); }
  else if (act === "cover") { if (r < 0.45) callout(e, underFire ? "Taking fire!" : "Cover me!"); }
  else if (act === "advance") { if (r < (underFire ? 0.4 : 0.2)) callout(e, r < 0.15 ? "Cover me!" : "Moving up!"); }
  else if (act === "peek" || act === "position" || act === "terrain") { if (r < 0.2) callout(e, "Cover me!"); }
}
function afterLine(e, key, now) {
  // (the mate is looked up on the reply's own tick: nearSnap rewrites each entry's distance, and a line can be said
  //  in the middle of someone's target scan over that same list)
  const d = sd(e), dimId = e.dimension.id, at = { ...e.location };
  const mate = (r) => { for (const c of nearSnap(dimId, at, r)) if (c.id !== e.id && c.type === SOLDIER && !c.down && c.f === d.faction && c.e.isValid && sd(c.e).squad === d.squad) return c.e; };
  const reply = (r, text, delay) => system.runTimeout(() => { try { const who = mate(r); if (who?.isValid) callout(who, text); } catch {} }, delay);
  if (key === "reloading" && Math.random() < 0.6) reply(10, "Suppressing!", 18);
  else if (key === "contact" && Math.random() < 0.5) reply(16, "Enemy spotted!", 30);
  else if (key === "hit" && Math.random() < 0.4) reply(10, "Man down!", 20);
  else if (IDLE_LINES.includes(key) && Math.random() < 0.45) reply(10, "IDLE", 70 + Math.floor(Math.random() * 40));
  else if (key === "clear" && Math.random() < 0.35) reply(16, "Hold position!", 40);
}
async function voiceMenu(player) {
  const pick = await show(new ActionFormData().title("Callouts")
    .button("Set the language per faction").button("Test: soldiers near me each say a line").button("Test: play EVERY line, one by one")
    .button("Test: play one line...").button("How often they talk / subtitles").button("« Back"), player);
  if (!pick || pick.canceled || pick.selection === undefined) return;
  if (pick.selection === 1) { testCallouts(player); return; }
  if (pick.selection === 2) { testEveryLine(player); return; }
  if (pick.selection === 3) { await testOneLine(player); return; }
  if (pick.selection === 4) {
    const r = await show(new ModalFormData().title("Callouts").dropdown("How often they talk", ["Less", "Normal", "A lot"], { defaultValueIndex: Number(setting("vfreq", 1)) })
      .toggle("Subtitles (the line, in English, on screen)", { defaultValue: !!setting("vsubs", false) }), player);
    if (!r || r.canceled || !r.formValues) return;
    sdp(world, "war:set_vfreq", Number(r.formValues[0])); sdp(world, "war:set_vsubs", !!r.formValues[1]);
    player.sendMessage("§aCallout settings saved.");
    return;
  }
  if (pick.selection === 5) return;
  const all = getJSON(world, "war:vlang", {});
  const f = new ModalFormData().title("Callout language");
  const FO = facOrder();
  FO.forEach((fac) => f.dropdown(factionLabel(fac), VOICE_NAMES, { defaultValueIndex: Math.max(0, VOICE_KEYS.indexOf(voiceOf(fac))) }));
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  r.formValues.forEach((v, i) => { all[FO[i]] = VOICE_KEYS[Number(v)]; });
  setJSON(world, "war:vlang", all);
  player.sendMessage("§aCallout languages saved.");
}

// ---- test battle: two balanced squads in front of you, ordered to fight
async function testBattle(player) {
  const names = COLORS.map((_, i) => factionLabel(i + 1));
  const f = new ModalFormData().title("Test battle")
    .dropdown("Side A", names, { defaultValueIndex: 1 }).dropdown("Side B", names, { defaultValueIndex: 2 })
    .slider("Soldiers per side", 4, 20, { valueStep: 2, defaultValue: 8 })
    .dropdown("Weapons", ["Mixed guns", "Rifles", "SMGs", "Swords", "Mixed guns + swords"], { defaultValueIndex: 0 })
    .slider("Distance apart (blocks)", 30, 120, { valueStep: 10, defaultValue: 60 });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const [ia, ib, n, wi, gap] = r.formValues.map(Number);
  const A = ia + 1, B = ib + 1;
  if (A === B) { player.sendMessage("§cPick two different factions."); return; }
  setRelPair(A, B, "1", true);                                        // they're at war for the test
  const MIX = [["rifle", "smg", "semi", "mg"], ["rifle"], ["smg"], ["sword"], ["rifle", "sword", "smg", "sword"]][wi];
  const dir = player.getViewDirection(), hl = Math.hypot(dir.x, dir.z) || 1, fx = dir.x / hl, fz = dir.z / hl;
  const c = { x: player.location.x + fx * (gap / 2 + 12), z: player.location.z + fz * (gap / 2 + 12) };
  const posA = { x: c.x - (-fz) * gap / 2, z: c.z - fx * gap / 2 }, posB = { x: c.x + (-fz) * gap / 2, z: c.z + fx * gap / 2 };
  const spawnSide = (fac, pos) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const g = walkableNear(player.dimension, pos.x + (i % 4 - 1.5) * 2.5, pos.z + (Math.floor(i / 4) - 1) * 2.5, player.location.y);
      if (!g) continue;
      const e = player.dimension.spawnEntity(SOLDIER, g);
      const weapon = MIX[i % MIX.length];
      setupSoldier(e, { faction: fac, squad: 0, weapon, ranged: isRangedW(weapon), div: "foot", radius: 8, func: "__none" }, player);
      out.push(e);
    }
    return out;
  };
  const sa = spawnSide(A, posA), sb = spawnSide(B, posB);
  if (!sa.length || !sb.length) { player.sendMessage("§cNot enough open ground in front of you."); return; }
  const go = (pool, target) => {
    const m = startMarch(player, pool, { x: target.x, y: player.location.y, z: target.z }, "hold");
    if (!m) return;
    pool.forEach((e, i) => { sdp(e, "war:stance", "aggressive"); sdp(e, "war:ao", 100); sdp(e, "war:free", true); giveFunction(e, "charge", player, m.lanes[i % m.lanes.length]); });
  };
  go(sa, posB); go(sb, posA);
  player.sendMessage(`§aTest battle: ${factionLabel(A)} vs ${factionLabel(B)}, ${sa.length} v ${sb.length}. They're now Hostile.`);
}

// ================================================================ Part C2 (v4.8)
// ---- downed, not dead: at 0 HP a soldier falls wounded for ~30 s. A friendly player (right-click) or a
// medic revives him; otherwise he dies. Hit again while down, he dies. Enemies leave the downed alone.
const downed = new Map(); // id -> until tick
const isDowned = (e) => downed.has(e.id);
const downPos = new Map(); // id -> where he fell
const medicCall = new Map(); // id -> last "Medic!" (v6.6)
// v6.7: "Taking heavy fire!": hit by an enemy's shot now and then (the per-man / per-squad limits keep it rare)
world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const v = ev.hurtEntity, src = ev.damageSource?.damagingEntity;
    if (v?.typeId !== SOLDIER || downed.has(v.id) || ev.damageSource?.cause !== "projectile" || !src?.isValid) return;
    if (Math.random() < 0.45 && isHostile(Number(P(v, "war:faction") ?? 0), factionOf(src))) callout(v, "Taking fire!");
  } catch {}
});
// v6.7: idle talk. A squad near a player that's had nothing to do for a minute (no enemy seen, not marching, nobody
// fighting): now and then one of them says something. At most one line per squad every ~1.5-2.5 min, one every 30 s
// anywhere; the first sign of a fight and it stops.
const squadBusyT = new Map(), squadIdleT = new Map();
let idleAnyT = -9999;
system.runInterval(() => {
  const now = tick();
  const groups = new Map();
  for (const p of world.getAllPlayers()) {
    for (const c of nearSnap(p.dimension.id, p.location, 24)) {
      if (c.type !== SOLDIER || c.down || held.has(c.id) || !c.e.isValid) continue;
      const d = sd(c.e), k = `${d.faction}:${d.squad}`;
      if (perc.get(c.id)?.threat || combatLock.has(c.id) || (perc.get(c.id)?.alert ?? "calm") !== "calm" || (marchOfE(c.e) && !marchOfE(c.e).final)) squadBusyT.set(k, now);
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c.e);
    }
  }
  if (now - idleAnyT < 300) return;
  for (const [k, list] of groups) {
    if (now - (squadBusyT.get(k) ?? -9999) < 800 || now - (squadIdleT.get(k) ?? -9999) < 900 + ((k.length * 97) % 900)) continue;   // (v6.8: calm 40 s, then a line every 45-90 s)
    if (Math.random() > 0.5) continue;
    squadIdleT.set(k, now); idleAnyT = now;
    callout(list[Math.floor(Math.random() * list.length)], "IDLE");
    break;
  }
}, 100);
function goDown(e, killer) {
  const now = tick();
  try {                                                          // (v6.5) the man who dropped him calls it
    let ke = killer?.isValid ? killer : undefined;
    if (!ke) { const k = hurtBy.get(e.id); if (k && now - k.t < 40) ke = world.getEntity(k.id); }
    if (ke?.typeId === SOLDIER) callout(ke, "Target down!");
  } catch {}
  downed.set(e.id, now + 600);
  downPos.set(e.id, { ...e.location });
  noteKillzone(e);
  sdp(e, "war:downed", now + 600);
  try { e.addEffect("slowness", 640, { amplifier: 6, showParticles: false }); e.addEffect("weakness", 640, { amplifier: 4, showParticles: false }); } catch {}
  setGroups(e, { w: "w_none", t: "t_off", g: "g_none", s: "s_1", d: "d_off", r: "r_off" });
  setP(e, "war:down", true);
  updateName(e);
  radio(e, "man down, needs a medic");
  try { const fv = Number(P(e, "war:faction")); const near = nearbyCombatants(e.dimension.id, e.location, 10).find((o) => o.typeId === SOLDIER && o.id !== e.id && Number(P(o, "war:faction")) === fv && !downed.has(o.id)); if (near) callout(near, "Man down!"); } catch {}
  // v6.9.1: he calls for a medic right away (~1.5 s after he drops), not up to 18 s later
  medicCall.set(e.id, now);
  system.runTimeout(() => { try { if (e.isValid && downed.has(e.id) && !medicComing(e.id, tick())) callout(e, "Medic!"); } catch {} }, 30);
}
function medicComing(id, now) {
  for (const [mid, mt] of medicTask) if (mt.target === id && now - (mt.t ?? 0) < 60) { const m = world.getEntity(mid); if (m?.isValid && !downed.has(mid)) return true; }
  return false;
}
function revive(e, hpTo = 6) {
  downed.delete(e.id); downPos.delete(e.id);
  setP(e, "war:down", false);
  sdp(e, "war:downed", undefined);
  try { e.removeEffect("slowness"); e.removeEffect("weakness"); } catch {}
  const h = e.getComponent("minecraft:health");
  if (h) h.setCurrentValue(Math.min(h.effectiveMax, hpTo));
  try { e.dimension.spawnParticle("minecraft:heart_particle", { x: e.location.x, y: e.location.y + 2, z: e.location.z }); } catch {}
  updateName(e);
}
system.runInterval(() => {
  const now = tick();
  for (const [id, until] of [...downed]) {
    if (held.has(id)) continue;                                   // (v6.3: carried with the TP wand)
    const e = world.getEntity(id);
    if (!e?.isValid) { downed.delete(id); continue; }
    if (now >= until) {
      downed.delete(id); downPos.delete(id);
      try { sdp(e, "war:downed", undefined); } catch {}
      killReal(e);
      system.runTimeout(() => { try { if (e.isValid) e.remove(); } catch {} }, 6);       // if the kill didn't take, he's removed
      continue;
    }
    // calling for a medic: at once when he drops (goDown), then every ~10 s while no medic is on his way (v6.9.1: was
    // every 18 s and only half the wounded). Two men down side by side don't both yell it: a "Medic!" heard within 40
    // blocks in the last 12 s keeps the others quiet.
    if (now % 20 === 0 && now - Number(medicCall.get(id) ?? -9999) > 200) {
      medicCall.set(id, now);
      if (!medicComing(id, now)) callout(e, "Medic!");
    }
    // pinned where he fell, lying down, at the edge of death: no getting up on his own
    try {
      const at = downPos.get(id) ?? e.location; if (!downPos.has(id)) downPos.set(id, { ...at });
      if (dist(at, e.location) > 0.6) e.teleport(at);
      e.clearVelocity?.();
      const hh = e.getComponent("minecraft:health"); if (hh && hh.currentValue !== 1) hh.setCurrentValue(1);
      if (!P(e, "war:down")) setP(e, "war:down", true);
    } catch {}
    try { if (now % 20 === 0) e.dimension.spawnParticle("minecraft:basic_smoke_particle", { x: e.location.x, y: e.location.y + 0.3, z: e.location.z }); } catch {}
  }
}, 10);
world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  const e = ev.target, p = ev.player;
  if (e?.typeId !== SOLDIER || !(isDowned(e) || isPow(e))) return;
  if ((ev.beforeItemStack ?? ev.itemStack)?.typeId === "war:unit_wand" || (ev.beforeItemStack ?? ev.itemStack)?.typeId === TP_WAND) return;     // the wand opens the same menu itself
  system.run(() => captiveMenu(p, e).catch(() => {}));
});

// ---- health bar in the name tag (green -> yellow -> red); wounds slow and shake a soldier
function healthBar(e) {
  const h = e.getComponent("minecraft:health");
  if (!h) return "";
  const r = Math.max(0, h.currentValue / h.effectiveMax), n = Math.round(r * 6);
  const col = r > 0.6 ? "§a" : r > 0.3 ? "§e" : "§c";
  return `${col}${"■".repeat(n)}§8${"■".repeat(6 - n)}`;
}
const woundK = (e) => { const h = e.getComponent("minecraft:health"); if (!h) return 1; const r = h.currentValue / h.effectiveMax; return r < 0.5 ? 1 + (0.5 - r) * 2 : 1; }; // up to 2x worse aim
const lastHp = new Map();
system.runInterval(() => {
  for (const e of allOf(SOLDIER)) {
    try {
      const h = e.getComponent("minecraft:health"); if (!h) continue;
      const v = Math.round(h.currentValue);
      if (lastHp.get(e.id) !== v) { lastHp.set(e.id, v); updateName(e); }
      // badly wounded: slower
      if (!isDowned(e) && h.currentValue / h.effectiveMax < 0.35) { try { e.addEffect("slowness", 30, { amplifier: 0, showParticles: false }); } catch {} }
    } catch {}
  }
}, 10);

// ---- medics: go to the worst wounded (the downed first), revive / heal; otherwise wait at a rally flag
const medicTask = new Map(); // medic id -> { target, slot, t (last thought about it), bestD, progT, reachT }
const medicBan = new Map();  // "medic>patient" -> tick he may try again (couldn't reach him)
system.runInterval(() => { const now = tick(); for (const [k, v] of medicBan) if (now >= v) medicBan.delete(k); for (const [k, mt] of medicTask) if (now - (mt.t ?? 0) > 200) medicTask.delete(k); }, 200);
function medicMove(e, d, now) {
  if (d.div !== "medic" || d.surr || isRiding(e)) return undefined;
  let best, bs = -1;
  for (const o of nearbyCombatants(e.dimension.id, e.location, 40)) {
    if (o.id === e.id || o.typeId !== SOLDIER) continue;
    if (now < (medicBan.get(`${e.id}>${o.id}`) ?? 0)) continue;          // (v6.9: one he couldn't get to; tried again later)
    try {
      if (!isFriendly(d.faction, Number(P(o, "war:faction")))) continue;
      const h = o.getComponent("minecraft:health"); if (!h) continue;
      const need = isDowned(o) ? 10 : 1 - h.currentValue / h.effectiveMax;
      if (need < 0.25) continue;
      const sc = need * 10 - dist(o.location, e.location) * 0.1;
      if (sc > bs) { bs = sc; best = o; }
    } catch {}
  }
  if (best) {
    // v6.9: beside him (lying on a step, a slab or the edge of a roof counts): kneel, then up he gets. Before, the revive
    // only happened on certain ticks of a 2 s clock, and a medic whose thought fell between them never revived anyone.
    const dd = flat(best.location, e.location), dy = Math.abs(best.location.y - e.location.y);
    let mt = medicTask.get(e.id);
    if (!mt || mt.target !== best.id) { mt = { target: best.id, slot: 0, t: now, bestD: dd, progT: now }; medicTask.set(e.id, mt); if (isDowned(best)) callout(e, "Moving up!"); }   // (v6.8: the medic answers "Medic!")
    mt.t = now;
    if (dd < 2.8 && dy < 2.2) {
      mt.progT = now;
      if (isDowned(best)) {
        mt.reachT ??= now;
        note(e, "treating a downed soldier");
        if (now - mt.reachT >= 20) { revive(best, 8); mt.reachT = undefined; note(e, "revived a soldier"); callout(e, "You're okay!"); const rb = best; system.runTimeout(() => callout(rb, "Thanks!"), 30); }
      }
      turnTo(e, best.location, 30);
      return { g: "g_none", t: "t_off", urgent: false };
    }
    mt.reachT = undefined;
    if (dd < mt.bestD - 1) { mt.bestD = dd; mt.progT = now; }
    if (now - mt.progT > 300) {                                     // no closer for 15 s: he can't get there from here
      medicBan.set(`${e.id}>${best.id}`, now + 600); medicTask.delete(e.id); note(e, "can't reach him");
      return undefined;
    }
    if (!mt.slot || !marker(mt.slot) || now % 40 < 10) { try { mt.slot = makeWaypoint(e.dimension, best.location) ?? 0; } catch { mt.slot = 0; } }
    note(e, isDowned(best) ? "going to a downed soldier" : "treating the wounded");
    const mv = travel(e, best.location, "medic", now, true);
    return mv ? { ...mv, t: "t_off" } : undefined;
  }
  medicTask.delete(e.id);
  // nobody to treat: station at a friendly rally flag within 64 (where the wounded come)
  const rally = nearestFlag(e.dimension, e.location, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 64);
  if (rally && dist(rally.location, e.location) > 5) { note(e, "waiting at the rally point"); return { g: "g_wp", slot: slotOf(rally), t: "t_off", urgent: false }; }
  return undefined;
}

// ---- radio reports to the commander (chat), a few per minute per squad at most
const lastRadio = new Map();
function radio(e, text, force = false) {
  try {
    const d = sd(e), cmdr = findPlayer(gdp(e, "war:cmdr"));
    if (!cmdr) return;
    const k = squadKey(e, d), now = tick();
    if (!force && now - (lastRadio.get(k) ?? -9999) < 200) return;
    lastRadio.set(k, now);
    const name = d.squad ? squadName(d.faction, d.squad) : factionLabel(d.faction, true);
    cmdr.sendMessage(`§7[Radio] §e${name}§7: ${text}`);
  } catch {}
}
const bearing = (from, to) => { const a = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI + 360) % 360; return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(a / 45) % 8]; };

// ---- infantry and tanks: stay out of an enemy tank's line of fire; advance behind friendly tanks
system.runInterval(() => {
  for (const tk of vehicleList) {
    try {
      if (tk.typeId !== "war:tank" || !tk.isValid) continue;
      const crew = tk.getComponent("minecraft:rideable")?.getRiders() ?? [];
      if (!crew.length) continue;
      const tf = factionOf(crew[0]);
      const yaw = tk.getRotation().y * Math.PI / 180, fx = -Math.sin(yaw), fz = Math.cos(yaw);
      for (const o of nearbyCombatants(tk.dimension.id, tk.location, 60)) {
        if (o.typeId !== SOLDIER || isDowned(o)) continue;
        if (!isHostile(Number(P(o, "war:faction")), tf)) continue;
        const vx = o.location.x - tk.location.x, vz = o.location.z - tk.location.z, L = Math.hypot(vx, vz) || 1;
        if ((vx * fx + vz * fz) / L < 0.96) continue;                               // not in front of the gun
        const side = (vx * (-fz) + vz * fx) >= 0 ? 1 : -1;
        push(o, { x: -fz * side * 0.5, y: 0.1, z: fx * side * 0.5 }, 3);              // dive aside
        note(o, "dodging the tank's gun");
      }
    } catch {}
  }
}, 20);

// ---- building / breaking (only when truly stuck and enabled): a few steps up, or a soft block out of the way.
// Everything placed or broken is put back after ~1 minute.
const SOFT = ["leaves", "dirt", "grass_block", "sand", "gravel", "glass", "wool", "planks", "mud", "snow", "clay", "hay", "moss", "vine", "bush", "fence"];
const restoreList = []; // { dim, loc, typeId, at }
const buildBudget = new Map(); // id -> { n, reset }
function canBuild(e, now) {
  if (!setting("build", true)) return false;
  let b = buildBudget.get(e.id);
  if (!b || now > b.reset) { b = { n: 0, reset: now + 1200 }; buildBudget.set(e.id, b); }
  return b.n < 4;
}
function spendBuild(e) { const b = buildBudget.get(e.id); if (b) b.n++; }
function placeStep(e, goalLoc, now) {
  // stuck below a wall: stand on a placed block to rise one step (at most a 3-4 block wall)
  const p = e.location, dim = e.dimension, y = Math.floor(p.y);
  const hx = goalLoc.x - p.x, hz = goalLoc.z - p.z, l = Math.hypot(hx, hz) || 1;
  const ax = p.x + (hx / l) * 0.9, az = p.z + (hz / l) * 0.9;
  let wall = 0;
  for (let k = 0; k < 6; k++) { try { const b = dim.getBlock({ x: ax, y: y + k, z: az }); if (b && !b.isAir && !passable(b)) wall = k + 1; else break; } catch { break; } }
  if (wall < 2 || wall > 4 || goalLoc.y < p.y + 1) return false;
  if (dangerNear(dim, { x: ax, y: y + wall, z: az })) return false;   // v6.1: never builds his way up onto a wall-top over a drop / lava
  try {
    const here = dim.getBlock({ x: p.x, y, z: p.z }), above = dim.getBlock({ x: p.x, y: y + 2, z: p.z });
    if (!here || !here.isAir || !above || !above.isAir) return false;
    e.teleport({ x: Math.floor(p.x) + 0.5, y: y + 1, z: Math.floor(p.z) + 0.5 });
    here.setType("minecraft:cobblestone");
    restoreList.push({ dim: dim.id, loc: { x: Math.floor(p.x), y, z: Math.floor(p.z) }, typeId: "minecraft:air", placed: "minecraft:cobblestone", at: now + 1200 });
    spendBuild(e); note(e, "building a step");
    return true;
  } catch { return false; }
}
function breakSoft(e, goalLoc, now) {
  const p = e.location, dim = e.dimension, y = Math.floor(p.y);
  const hx = goalLoc.x - p.x, hz = goalLoc.z - p.z, l = Math.hypot(hx, hz) || 1;
  const ax = p.x + (hx / l) * 0.9, az = p.z + (hz / l) * 0.9;
  for (const dy of [1, 0]) {
    try {
      const b = dim.getBlock({ x: ax, y: y + dy, z: az });
      if (!b || b.isAir || passable(b) || !SOFT.some((s) => b.typeId.includes(s))) continue;
      restoreList.push({ dim: dim.id, loc: { x: Math.floor(ax), y: y + dy, z: Math.floor(az) }, typeId: b.typeId, placed: "minecraft:air", at: now + 1200 });
      b.setType("minecraft:air");
      spendBuild(e); note(e, "clearing the way");
      return true;
    } catch {}
  }
  return false;
}
system.runInterval(() => {
  const now = tick();
  for (let i = restoreList.length - 1; i >= 0; i--) {
    const r = restoreList[i];
    if (now < r.at) continue;
    try {
      const b = world.getDimension(r.dim).getBlock(r.loc);
      if (b && b.typeId === r.placed && !nearbyCombatants(r.dim, { x: r.loc.x + 0.5, y: r.loc.y, z: r.loc.z + 0.5 }, 1.2).length) { b.setType(r.typeId); restoreList.splice(i, 1); }
      else if (b && b.typeId !== r.placed) restoreList.splice(i, 1);          // someone changed it since: leave it
    } catch { if (now - r.at > 6000) restoreList.splice(i, 1); }              // unloaded: try again later (give up after 5 min)
  }
}, 40);

// ---- faction skins: a default skin per faction (individual Unit Wand skins still win)
const factionSkin = (f) => Number(getJSON(world, "war:fskins", {})[f] ?? 0);
async function factionSkinMenu(player) {
  const all = getJSON(world, "war:fskins", {});
  const choices = [{ name: "Faction uniform", slot: 0 }, ...skinChoices()];
  const f = new ModalFormData().title("Faction skins");
  const FO = facOrder();
  FO.forEach((fac) => f.dropdown(factionLabel(fac), choices.map((c) => c.name), { defaultValueIndex: Math.max(0, choices.findIndex((c) => c.slot === Number(all[fac] ?? 0))) }));
  f.toggle("Also apply to soldiers with their own skin (everyone matches)", { defaultValue: false });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const vals = r.formValues;
  for (let i = 0; i < COLORS.length; i++) all[FO[i]] = choices[Number(vals[i])]?.slot ?? 0;
  setJSON(world, "war:fskins", all);
  const everyone = !!vals[COLORS.length];
  let n = 0;
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e);
      if (everyone) { setP(e, "war:skin", 0); }
      syncSkin(e); n++;
    } catch {}
  }
  player.sendMessage(`§aFaction skins saved${everyone ? " and applied to everyone" : ""}.`);
}
// the skin actually drawn: his own Unit Wand skin, else his faction's skin, else the faction uniform
function syncSkin(e) {
  try {
    const own = Number(gdp(e, "p_war:skin") ?? 0);
    const eff = own || factionSkin(Number(P(e, "war:faction") ?? 0));
    if (e.getProperty("war:skin") !== eff) e.setProperty("war:skin", eff);
  } catch {}
}

// ================================================================ v4.9: fixes + sandbags + MG nests
// ---- deaths the add-on causes on purpose (out of time while downed, plane crash, tank sinking) skip downing
const dying = new Set();
function killReal(e) {
  dying.add(e.id);
  try { e.applyDamage(1000, { cause: "override" }); } catch {}
  system.runTimeout(() => { try { if (e.isValid) e.kill(); } catch {} }, 2);
  system.runTimeout(() => { try { if (e.isValid) e.remove(); } catch {} dying.delete(e.id); }, 6);
}

// ---- POWs: captured enemies are unarmed, never shot, follow their captor at a distance or sit in "jail"
const pows = new Map(); // id -> { captor, mode: "follow"|"jail", at, slot }
function makePow(e, captor) {
  downed.delete(e.id); downPos.delete(e.id); sdp(e, "war:downed", undefined); setP(e, "war:down", false);
  try { e.removeEffect("slowness"); e.removeEffect("weakness"); } catch {}
  const h = e.getComponent("minecraft:health"); if (h) h.setCurrentValue(Math.max(h.currentValue, 6));
  pows.set(e.id, { captor: captor.id, mode: "follow" });
  sdp(e, "war:pow", JSON.stringify({ captor: captor.id, mode: "follow" }));
  equip(e, "air"); setP(e, "war:gun", 0);
  updateName(e);
}
function freePow(e, rearm) {
  pows.delete(e.id); sdp(e, "war:pow", undefined);
  if (rearm) equip(e, weaponItem(e));
  updateName(e);
}
const isPow = (e) => pows.has(e.id);
function powMove(e, now) {
  const pw = pows.get(e.id);
  if (!pw) return undefined;
  const g = { w: "w_none", t: "t_off", d: "d_off", r: "r_off", s: "s_1" };
  if (pw.mode === "jail") {
    if (!pw.slot || !marker(pw.slot)) pw.slot = makeWaypoint(e.dimension, pw.at ?? e.location);
    const a = marker(pw.slot);
    return { ...g, g: a && flat(a.location, e.location) > 3 ? "g_wp" : "g_none", slot: pw.slot };
  }
  const c = findPlayer(pw.captor);
  if (!c || c.dimension.id !== e.dimension.id) return { ...g, g: "g_none", slot: 0 };
  const dd = dist(c.location, e.location);
  if (dd <= 7) return { ...g, g: "g_none", slot: 0 };                    // close enough: wait (not on your heels)
  const dx = e.location.x - c.location.x, dz = e.location.z - c.location.z, L = Math.hypot(dx, dz) || 1;
  const spot = walkableNear(e.dimension, c.location.x + (dx / L) * 6, c.location.z + (dz / L) * 6, c.location.y) ?? c.location;
  if (!pw.slot || !marker(pw.slot) || flat(marker(pw.slot).location, spot) > 3) pw.slot = makeWaypoint(e.dimension, spot);
  return { ...g, g: "g_wp", slot: pw.slot, s: dd > 20 ? "s_3" : "s_2" };
}
// ---- callouts: test button (every soldier near you calls out once, right now)
function testCallouts(player) {
  let n = 0;
  const used = new Set();
  for (const e of player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: 24 })) {
    const lang = voiceOf(Number(P(e, "war:faction") ?? 0)), has = (VOICE_HAS[lang] ?? BASE_LINES).filter((k) => !used.has(k));
    if (!has.length || lang === "none") continue;
    const key = has[Math.floor(Math.random() * has.length)]; used.add(key);   // (every soldier a different line)
    system.runTimeout(() => callout(e, "", { key, force: true, subs: true }), n * 50); n++;
    if (n >= 8) break;
  }
  player.sendMessage(n ? `§7${n} soldier${n === 1 ? "" : "s"} called out. Heard nothing? Check the "Hostile creatures" volume slider.` : "§7No soldiers within 24 blocks.");
}

// v6.8: hear every line in turn from the soldier nearest you (in his faction's language), with what it is on screen
function testEveryLine(player) {
  const e = player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: 24, closest: 1 })[0];
  if (!e) { player.sendMessage("§7No soldier within 24 blocks."); return; }
  const lang = voiceOf(Number(P(e, "war:faction") ?? 0));
  if (lang === "none") { player.sendMessage("§7His faction's callouts are set to None."); return; }
  const keys = Object.keys(LINE_INFO).filter((k) => voiceHas(lang, k));
  keys.forEach((k, i) => system.runTimeout(() => {
    try {
      if (!e.isValid) return;
      callout(e, "", { key: k, force: true });
      player.onScreenDisplay.setActionBar(`§e${i + 1}/${keys.length} §f"${LINE_INFO[k][0]}" §7(when: ${LINE_INFO[k][1]})`);
    } catch {}
  }, i * 80));
  player.sendMessage(`§7Playing ${keys.length} lines (${VOICE_NAMES[VOICE_KEYS.indexOf(lang)] ?? lang}), one every 4 s.`);
}
async function testOneLine(player) {
  const keys = Object.keys(LINE_INFO);
  const r = await show(new ModalFormData().title("Play one line").dropdown("Line", keys.map((k) => `${LINE_INFO[k][0]}  §7(${LINE_INFO[k][1]})`))
    .dropdown("Language", VOICE_NAMES.slice(1), { defaultValueIndex: 0 }), player);
  if (!r || r.canceled || !r.formValues) return;
  const key = keys[Number(r.formValues[0])], lang = VOICE_KEYS[Number(r.formValues[1]) + 1];
  if (!voiceHas(lang, key)) { player.sendMessage(`§7No ${VOICE_NAMES[VOICE_KEYS.indexOf(lang)]} recording of that line yet.`); return; }
  const e = player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: 24, closest: 1 })[0];
  if (e) callout(e, "", { key, lang, force: true, subs: true });
  else playLine(player.dimension, player.location, lang, key, 1, { label: "Test", forceSubs: true });
}

// ---- soldier damage to players follows the Realism slider too (gun-pack bullets often carry no shooter)
const shotAtPlayer = new Map(); // player id -> tick a soldier last fired at him

// ---- sandbags: soldiers know them as cover / peek spots
const SANDBAG = "war:sandbag";
// v5.9: sandbags are remembered where they are placed / broken (saved in the world) instead of scanning thousands of
// blocks around every soldier (that scan was the lag when soldiers were spread out). Sandbags placed before v5.9 are
// found by a small scan right around soldiers (once per area).
let sandbagReg = null; // Map "dim|x|y|z" -> {dim, x, y, z}
function sbReg() {
  if (!sandbagReg) { sandbagReg = new Map(); for (const s of getJSON(world, "war:sandbags", [])) sandbagReg.set(`${s.dim}|${s.x}|${s.y}|${s.z}`, s); }
  return sandbagReg;
}
let sbDirty = false;
function sbAdd(dimId, x, y, z) { const k = `${dimId}|${x}|${y}|${z}`; if (!sbReg().has(k)) { sbReg().set(k, { dim: dimId, x, y, z }); sbDirty = true; } }
function sbDel(dimId, x, y, z) { if (sbReg().delete(`${dimId}|${x}|${y}|${z}`)) sbDirty = true; }
system.runInterval(() => { if (!sbDirty) return; sbDirty = false; try { setJSON(world, "war:sandbags", [...sbReg().values()].slice(-3000)); } catch {} }, 200);
try { world.afterEvents.playerPlaceBlock.subscribe((ev) => { try { const b = ev.block; if (b.typeId === SANDBAG) sbAdd(b.dimension.id, b.x, b.y, b.z); } catch {} }); } catch {}
try { world.afterEvents.playerBreakBlock.subscribe((ev) => { try { if (ev.brokenBlockPermutation?.type?.id === SANDBAG) sbDel(ev.block.dimension.id, ev.block.x, ev.block.y, ev.block.z); } catch {} }); } catch {}
const sbScanned = new Set(); // "dim|cx|cz" 16-block areas already scanned for old sandbags
function sandbagsNear(dim, loc, r, now) {
  const area = `${dim.id}|${Math.floor(loc.x / 16)}|${Math.floor(loc.z / 16)}`;
  if (!sbScanned.has(area)) {                                         // old sandbags: a small look around him, once per area
    sbScanned.add(area);
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (const dy of [0, -1]) {
      try { const b = tBlock(dim, loc.x + dx, loc.y + dy, loc.z + dz); if (b?.typeId === SANDBAG) sbAdd(dim.id, Math.floor(loc.x + dx), Math.floor(loc.y + dy), Math.floor(loc.z + dz)); } catch {}
    }
  }
  const out = [];
  for (const s of sbReg().values()) {
    if (s.dim !== dim.id || Math.abs(s.y - loc.y) > 3 || Math.hypot(s.x + 0.5 - loc.x, s.z + 0.5 - loc.z) > r) continue;
    try { const b = tBlock(dim, s.x, s.y, s.z); if (b && b.typeId !== SANDBAG) { sbDel(s.dim, s.x, s.y, s.z); continue; } } catch {}   // gone (blown up)
    out.push(s);
  }
  return out;
}
// a spot right behind a sandbag, with the sandbag between it and the enemy
function sandbagSpot(e, enemyC, anchor, leash, now) {
  let best, bd = 1e9;
  for (const sb of sandbagsNear(e.dimension, e.location, 12, now)) {
    const dx = enemyC.x - (sb.x + 0.5), dz = enemyC.z - (sb.z + 0.5), L = Math.hypot(dx, dz) || 1;
    const spot = walkableNear(e.dimension, sb.x + 0.5 - (dx / L) * 1.0, sb.z + 0.5 - (dz / L) * 1.0, sb.y);
    if (!spot || Math.abs(spot.y - sb.y) > 0.6 || !localReach(e.dimension, e.location, spot)) continue;
    if (anchor && flat(spot, anchor.location) > leash) continue;
    if (nearbyCombatants(e.dimension.id, spot, 1.2).some((o) => o.typeId === SOLDIER && o.id !== e.id)) continue;
    const dd = dist(spot, e.location);
    if (dd < bd) { bd = dd; best = spot; }
  }
  return best;
}

// ---- MG nests: a placeable emplacement a soldier or a player can man
const NEST = "war:mg_nest";
const NEST_SPEC = { bullet: "ww:nlmg_projectile", sight: 200, fire: 200, mag: 40, gap: 2, reload: 50, speed: 5.0, spread: 0.006 };
const nestRider = (n) => (n.getComponent("minecraft:rideable")?.getRiders() ?? [])[0];
function ridingNest(e) { try { return rideInfo(e).on === NEST; } catch { return false; } }
const nestState = new Map(); // nest id -> { ammo, next }
system.runInterval(() => {
  const now = tick();
  for (const n of allOf(NEST)) {
    try {
      const r = nestRider(n);
      n.clearVelocity?.();
      if (!r) continue;
      let st = nestState.get(n.id); if (!st) { st = { ammo: NEST_SPEC.mag, next: 0 }; nestState.set(n.id, st); }
      if (r.typeId === "minecraft:player") {
        n.setRotation({ x: 0, y: r.getRotation().y });                         // the gun follows your view
        if (consumeFire(r) && now >= st.next) {
          const dir = r.getViewDirection(), h = headLoc(r);
          for (let k = 0; k < 6 && st.ammo > 0; k++) {
            system.runTimeout(() => {
              try {
                const s = NEST_SPEC.spread, rr = () => (Math.random() + Math.random() - 1) * s * 1.6;
                const d2 = { x: dir.x + rr(), y: dir.y + rr(), z: dir.z + rr() };
                const b = n.dimension.spawnEntity(NEST_SPEC.bullet, { x: h.x + d2.x * 1.4, y: h.y - 0.2 + d2.y * 1.4, z: h.z + d2.z * 1.4 });
                const pc = b.getComponent("minecraft:projectile"); if (pc) { pc.owner = r; pc.shoot({ x: d2.x * NEST_SPEC.speed, y: d2.y * NEST_SPEC.speed, z: d2.z * NEST_SPEC.speed }); }
                n.dimension.playSound("mg42_shot_mid", n.location, { volume: 2 });
              } catch {}
            }, k * 2);
            st.ammo--;
          }
          st.next = now + 12;
          if (st.ammo <= 0) { st.ammo = NEST_SPEC.mag; st.next = now + NEST_SPEC.reload; try { r.onScreenDisplay.setActionBar("§7Reloading..."); } catch {} }
          else try { r.onScreenDisplay.setActionBar(`§7MG ${st.ammo}/${NEST_SPEC.mag}`); } catch {}
        }
      } else if (r.typeId === SOLDIER) {
        if (Number(P(r, "war:gun") ?? 0) !== 0) { sdp(r, "war:gunSaved", true); setP(r, "war:gun", 0); }   // his own gun is put away
        if (!P(r, "war:nest")) setP(r, "war:nest", true);                                                     // standing, hands on the gun
        const t = perc.get(r.id)?.threat;
        if (t?.isValid) {
          const want = (Math.atan2(-(t.location.x - n.location.x), t.location.z - n.location.z) * 180) / Math.PI;
          n.setRotation({ x: 0, y: turnToward(n.getRotation().y, want, 9) });                              // smooth traverse
          r.setRotation({ x: 0, y: n.getRotation().y });
          // overrun from behind or the side up close: get off the gun
          const vx = t.location.x - n.location.x, vz = t.location.z - n.location.z, L = Math.hypot(vx, vz) || 1, yaw = n.getRotation().y * Math.PI / 180;
          if (L < 6 && (vx * -Math.sin(yaw) + vz * Math.cos(yaw)) / L < 0) { n.getComponent("minecraft:rideable")?.ejectRider(r); }
        }
      }
    } catch {}
  }
}, 2);
// soldiers holding a position man an empty nest close by (further out once the enemy shows up)
system.runInterval(() => {
  for (const n of allOf(NEST)) {
    try {
      if (nestRider(n)) continue;
      let best, bd = 15;
      for (const o of nearbyCombatants(n.dimension.id, n.location, 15)) {
        if (o.typeId !== SOLDIER || isRiding(o) || isDowned(o) || isPow(o)) continue;
        const d = sd(o);
        if (!["hold", "post", "sentry", "stand"].includes(d.func) || d.div === "medic" || d.div === "guard" || d.retreat) continue;
        const dd = dist(o.location, n.location);
        const contact = !!squads.get(squadKey(o, d))?.known?.size;
        if (dd > 9 && !contact) continue;                                // far ones only come once there's a fight
        if (dd < bd) { bd = dd; best = o; }
      }
      if (best) { n.getComponent("minecraft:rideable")?.addRider(best); note(best, "manning the MG"); callout(best, "On the gun!"); }
    } catch {}
  }
}, 40);

// one menu for the downed and for prisoners (Unit Wand or right-click)
async function captiveMenu(p, e) {
  const pf = playerFaction(p), ef = Number(P(e, "war:faction"));
  const friendly = isFriendly(pf, ef);
  if (isPow(e)) {
    const pw = pows.get(e.id);
    if (friendly) { const r = await show(new ActionFormData().title("Captured comrade").button("Free and rearm him"), p); if (r && !r.canceled && r.selection === 0) { freePow(e, true); p.onScreenDisplay.setActionBar("§aFreed and rearmed."); } return; }
    const r = await show(new ActionFormData().title("Prisoner").button(pw.mode === "jail" ? "Follow me" : "Imprison (stay here)").button("Release (goes home unarmed)").button("§cKill"), p);
    if (!r || r.canceled || r.selection === undefined || !e.isValid) return;
    if (r.selection === 0) {
      if (pw.mode === "jail") { pw.mode = "follow"; pw.captor = p.id; pw.slot = undefined; }
      else { pw.mode = "jail"; pw.at = { ...e.location }; pw.slot = makeWaypoint(e.dimension, e.location); }
      sdp(e, "war:pow", JSON.stringify({ captor: pw.captor, mode: pw.mode, at: pw.at }));
      p.onScreenDisplay.setActionBar(pw.mode === "jail" ? "§7Imprisoned here." : "§7He follows you.");
    } else if (r.selection === 1) { freePow(e, false); p.onScreenDisplay.setActionBar("§7Released."); }
    else { pows.delete(e.id); killReal(e); }
    return;
  }
  if (friendly) { revive(e, 6); p.onScreenDisplay.setActionBar("§aRevived."); return; }
  const r = await show(new ActionFormData().title("Downed enemy").button("Capture").button("§cKill"), p);
  if (!r || r.canceled || r.selection === undefined || !e.isValid || !isDowned(e)) return;
  if (r.selection === 0) { makePow(e, p); p.onScreenDisplay.setActionBar("§aCaptured. He follows you at a distance."); }
  else killReal(e);
}

// ================================================================ v5.0: buildings, castles, general's view
// ---- indoors? (a roof over his head)
function isIndoors(e) {
  try {
    const p = e.location;
    if (tSky(e.dimension, p.x, p.y + 1, p.z) >= 10) return false;
    for (let k = 2; k <= 7; k++) { const b = tBlock(e.dimension, p.x, p.y + k, p.z); if (b && !b.isAir && !passable(b) && !b.typeId.includes("leaves")) return true; }
  } catch {}
  return false;
}
// ---- personal routes (3D): the quickest way out of a building, or into one for refuge
const personal = new Map(); // id -> { pts, idx, kind, t, planning }
function planPersonal(e, kind, goalFn, now, max = 20000, radius = 60) {
  const pr = { pts: undefined, idx: 0, kind, t: now, planning: true };
  personal.set(e.id, pr);
  planRoute(e.dimension, e.location, { x: e.location.x, z: e.location.z }, (pts) => { pr.planning = false; pr.pts = pts; pr.idx = 0; }, { goalFn, max, maxRadius: radius });
}
// v5.3: is there any roof at all within ~24 blocks? (a few cached samples; remembered per 16-block area for 30 s)
// Saves an expensive search for a building that isn't there (open fields, beaches, hills).
const roofMemo = new Map(); // "dim:cx,cz" -> { v, t }
function roofNear(e, now) {
  const k = `${e.dimension.id}:${Math.floor(e.location.x / 16)},${Math.floor(e.location.z / 16)}`;
  const c = roofMemo.get(k);
  if (c && now - c.t < 600) return c.v;
  let v = false;
  for (let i = 0; i < 24 && !v; i++) {
    const a = (i / 8) * Math.PI * 2, r = 6 + 6 * Math.floor(i / 8);
    const w = walkableNear(e.dimension, e.location.x + Math.cos(a) * r, e.location.z + Math.sin(a) * r, e.location.y);
    if (w && insideGoal(e.dimension, { x: Math.floor(w.x), y: w.y, z: Math.floor(w.z) })) v = true;
  }
  roofMemo.set(k, { v, t: now });
  if (roofMemo.size > 500) roofMemo.clear();
  return v;
}
function followPersonal(e, now) {
  const pr = personal.get(e.id);
  if (!pr) return undefined;
  const drop = () => { personal.delete(e.id); travelTo.delete(e.id); return undefined; };
  if (pr.planning) { if (now - pr.t > 160) return drop(); return now - pr.t < 40 ? { g: "g_none", t: "t_mid", urgent: false } : undefined; }   // a short wait for the route; never frozen
  if (!pr.pts) return drop();
  const i = trackIdx(e.id, pr.pts, e.location);
  pr.idx = i;
  // v5.4: a route is never a prison. No progress for 6 s (blocked, pushed off it) or far past its time: dropped,
  // and the brain decides again from where he is
  if (pr.bestI === undefined || i > pr.bestI) { pr.bestI = i; pr.progT = now; }
  if (now - (pr.progT ?? now) > 120 && (pr.hold ?? 0) <= now) return drop();
  if (now - pr.t > 400 + pr.pts.length * 16) return drop();
  const end = pr.pts[pr.pts.length - 1];
  if (i >= pr.pts.length - 2 && dist(end, e.location) < 2 && Math.abs(end.y - e.location.y) < 0.6) { drop(); if (pr.kind === "advance") spreadOut(e, now, end); return undefined; }   // there
  // a fight on the way: errands are dropped (the brain fights); moving up to the enemy, he stops to take a clear shot
  const t = perc.get(e.id)?.threat;
  if (t?.isValid && ["patrol", "reinforce", "regroup"].includes(pr.kind)) return drop();
  if ((pr.kind === "advance" || pr.kind === "engage") && stackAtStairs(e, pr, i, now)) { pr.hold = now + 25; pr.progT = now; note(e, "stacking up at the stairs"); return { g: "g_none", t: "t_mid", urgent: false }; }   // (v6.9.2)
  if (t?.isValid && (pr.kind === "advance" || pr.kind === "engage")) {
    if (shotAt(e, sd(e), t, now) && !tightAt(e.dimension, pr.pts, i, e.location)) { pr.hold = now + 30; pr.progT = now; note(e, "firing on the way"); return { g: "g_none", t: "t_mid", urgent: false }; }   // (never stops on the stairs: the men behind need them)
  }
  note(e, { exit: "getting out of the building", advance: "moving to the enemy's level", refuge: "taking refuge inside", patrol: "patrolling", reinforce: "reinforcing", regroup: "regrouping", medic: "going to the wounded", rally: "falling back to the rally point" }[pr.kind] ?? "on the move");
  const slot = myMarker(e, pr.pts[lookahead(pr.pts, i, 5)]);           // (the route driver keeps it moving between thoughts)
  return slot ? { g: "g_wp", slot, t: "t_mid", urgent: true } : undefined;
}
const outsideGoal = (dim, n) => { try { return !n.climb && tSky(dim, n.x + 0.5, n.y + 1, n.z + 0.5) >= 13; } catch { return false; } };
const insideGoal = (dim, n) => { try {
  if (n.climb || tSky(dim, n.x + 0.5, n.y + 1, n.z + 0.5) >= 8) return false;
  for (let k = 2; k <= 6; k++) { const b = tBlock(dim, n.x + 0.5, n.y + k, n.z + 0.5); if (b && !b.isAir && !passable(b)) return !["stone", "dirt", "deepslate"].some((s) => b.typeId.includes(s)) || b.typeId.includes("brick"); }
  return false; } catch { return false; } };
// ---- windows: from inside, open a firing slot by breaking ONE glass block toward the enemy (put back later)
function openWindow(e, t, now) {
  if (!setting("build", true) || !canBuild(e, now)) return false;
  try {
    const h = headLoc(e), c = chest(t), dx = c.x - h.x, dy = c.y - h.y, dz = c.z - h.z, L = Math.hypot(dx, dy, dz) || 1;
    const hit = e.dimension.getBlockFromRay(h, { x: dx / L, y: dy / L, z: dz / L }, { maxDistance: 4, includePassableBlocks: false });
    const b = hit?.block;
    if (!b || !b.typeId.includes("glass")) return false;
    restoreList.push({ dim: e.dimension.id, loc: { ...b.location }, typeId: b.typeId, placed: "minecraft:air", at: now + 2400 });
    b.setType("minecraft:air"); spendBuild(e); note(e, "breaking a window to fire");
    return true;
  } catch { return false; }
}
// ---- holding a door from inside: two blocks in, facing it
const doorLook = new Map();
function doorSpot(e, now) {
  if (now - (doorLook.get(e.id) ?? -9999) < 200) return undefined;   // a door search at most every 10 s
  doorLook.set(e.id, now);
  try {
    const p = e.location;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (const dy of [0]) {
      const b = tBlock(e.dimension, p.x + dx, Math.floor(p.y) + dy, p.z + dz);
      if (!isWoodDoor(b)) continue;
      for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const w = walkableNear(e.dimension, b.location.x + 0.5 + ox, b.location.z + 0.5 + oz, p.y);
        if (w && isIndoorsAt(e.dimension, w)) return w;
      }
    }
  } catch {}
  return undefined;
}
function isIndoorsAt(dim, p) { return insideGoal(dim, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }); }
// building tactics inside the brain: get out under fire, take refuge when caught in the open, man windows, hold doors
function buildingMove(e, d, now, S, t, B, underFire, exposure, moving, anchor) {
  const pr = personal.get(e.id);
  if (pr) return followPersonal(e, now);
  { const br = buildingRole(e, d, now, S, B, t); if (br) return br; }        // v7.0: his part of the squad's plan
  { const ss = seekShot(e, d, now, S, B, t); if (ss) return ss; }           // v7.0: no line on them: go and get one
  if (d.func === "post" || isRiding(e)) return undefined;
  const inside = isIndoors(e);
  const supp = (suppB.get(e.id) ?? 0) > 8;
  const defending = ["hold", "post", "sentry", "stand"].includes(d.func) && (!anchor || isIndoorsAt(e.dimension, anchor.location) || flat(anchor.location, e.location) < 12);
  if (inside && defending && S?.known?.size) {
    // the building is theirs: everyone on alert, facing the way in, firing from doorways and windows
    if (t?.isValid && canHit(e, t)) { turnTo(e, t.location, 25); B.huntT = undefined; return undefined; }   // a shot: take it
    if (GUNS.includes(d.weapon)) { const sw = stairWatch(e, d, S, now, B); if (sw) return sw; }   // (v6.9.2: the enemy's below: cover the stairheads)
    if (GUNS.includes(d.weapon)) { const hm = huntContact(e, d, S, now, B); if (hm) return hm; }   // (v6.9.3: in the next room: go and fight them)
    if (t?.isValid) { turnTo(e, t.location, 25); if (!canHit(e, t) && openWindow(e, t, now)) return { g: "g_none", t: "t_mid", urgent: false }; }
    note(e, "defending the building");
    return undefined;                                                   // (the brain / gunfire do the fighting from here)
  }
  if (inside && !defending && (supp || (underFire && exposure >= 2) || (S && S.ratio < 0.6 && S.known.size)) && now - (B.exitT ?? -9999) > 300) {
    B.exitT = now; planPersonal(e, "exit", outsideGoal, now); return followPersonal(e, now);         // trapped inside under fire: get out
  }
  if (!inside && underFire && exposure >= 3 && S && S.ratio < 0.8 && now - (B.refT ?? -9999) > 400) {
    B.refT = now;
    if (roofNear(e, now)) { planPersonal(e, "refuge", insideGoal, now, 6000, 32); return followPersonal(e, now); }   // caught in the open: into a building
  }
  if (inside && t?.isValid && !canHit(e, t)) {
    if (openWindow(e, t, now)) return { g: "g_none", t: "t_mid", urgent: false };
    if (!moving && S && (e.id.charCodeAt(e.id.length - 1) % 5 === 0)) {                               // one in five holds a door
      const ds = doorSpot(e, now);
      if (ds && (!anchor || flat(ds, anchor.location) < 20)) { note(e, "holding the door"); const sl = makeWaypoint(e.dimension, ds); return sl ? { g: "g_wp", slot: sl, t: "t_mid", urgent: false } : undefined; }
    }
  }
  return undefined;
}

// ================================================================ v7.0: the building brain
// Fights in and around buildings. Each squad reads the situation (who's inside, who's outside, on which floor) and
// picks a plan, weighted by the odds and a little chance, so the same fight doesn't play out the same way twice. It
// keeps a plan for 25-45 s, then looks again. Each man gets his own part of it.
//   inside, enemy outside or below: man the windows / secure the building (spread over every floor) / sortie
//   inside, enemy on another floor: storm it (split between the staircases) / secure / windows
//   outside, enemy inside: contain (take spots that see the windows and doors) / assault (in, through every way in)
const BPLANS = { windows: "manning the windows", secure: "securing the building", sortie: "going out after them", contain: "covering the building", assault: "storming the building" };
function buildingPlan(k, S, ours, known, now) {
  const dim = ours[0].dimension, oc = S.ourC;
  if (!known.length || !oc) { S.bplan = undefined; return; }
  const inside = ours.filter((e) => isIndoors(e)).length / ours.length;
  const kIn = known.filter((q) => isIndoorsAt(dim, q)).length / known.length;
  if (ours.some((e) => now - (gunState.get(e.id)?.lastShot ?? -999) < 80)) S.fightT = now;
  const quiet = now - (S.fightT ?? S.contactT ?? now);
  const stance = String(gdp(ours[0], "war:stance") ?? "aggressive"), bold = stance === "aggressive" && freeOf(ours[0]);
  const B0 = S.bplan;
  if (B0 && now < B0.until && !((B0.kind === "sortie" || B0.kind === "assault") && S.ratio < 0.55)) return;
  const opts = [];
  const otherFloor = known.filter((q) => Math.abs(q.y - oc.y) > 2.5 && isIndoorsAt(dim, q)).length;
  if (inside >= 0.5) {
    const outOrBelow = known.filter((q) => q.y < oc.y - 2.5 || !isIndoorsAt(dim, q)).length;
    if (outOrBelow) opts.push(["windows", 1.0 + (quiet > 200 ? 0.3 : 0)]);
    opts.push(["secure", 0.7 + (S.n >= 5 ? 0.3 : 0) + (S.ratio < 0.9 ? 0.4 : 0)]);
    if (bold && (S.ratio >= 1.25 || (S.ratio >= 1.0 && quiet > 600))) opts.push(["sortie", 0.3 + (S.ratio >= 1.5 ? 0.7 : 0) + (quiet > 600 ? 0.4 : 0)]);   // (out the door into their guns: only with the upper hand, or a long stalemate)
    if (bold && otherFloor && S.ratio >= 0.8) opts.push(["assault", 0.6 + (S.ratio >= 1.2 ? 0.7 : 0) + (quiet > 300 ? 0.4 : 0)]);
  } else if (kIn >= 0.5) {
    opts.push(["contain", 0.8 + (S.ratio < 1 ? 0.6 : 0)]);
    if (bold) opts.push(["assault", 0.5 + (S.ratio >= 1.1 ? 0.8 : 0) + (quiet > 300 ? 0.6 : 0)]);
  }
  if (!opts.length) { S.bplan = undefined; return; }
  const sum = opts.reduce((t, o) => t + o[1], 0);
  let r = Math.random() * sum, pick = opts[0][0];
  for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
  S.bplan = { kind: pick, t: now, until: now + 500 + Math.floor(Math.random() * 400) };
  if (pick !== B0?.kind) {
    radio(ours[0], BPLANS[pick], true);
    callout(ours[Math.floor(Math.random() * ours.length)], pick === "sortie" || pick === "assault" ? "Moving up!" : "Hold position!");
  }
}
// every place a man can stand inside this building (every floor), sampled; remembered for a while
const BCELLS = new Map();
function buildingCells(dim, at, R = 18) {
  const k = `${dim.id}|${Math.floor(at.x / 16)}|${Math.floor(at.z / 16)}|${Math.floor(at.y / 16)}`, now = tick(), c = BCELLS.get(k);
  if (c && now - c.t < 600) return c.list;
  const list = [], seen = new Set(), y0 = Math.floor(at.y);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(at.x + (Math.random() * 2 - 1) * R), z = Math.floor(at.z + (Math.random() * 2 - 1) * R);
    for (let y = y0 + 12; y >= y0 - 12; y--) {
      if (!standAt(dim, x, y, z, now)) continue;
      const q = { x: x + 0.5, y, z: z + 0.5 }, kk = `${x},${y},${z}`;
      if (!seen.has(kk) && isIndoorsAt(dim, q) && !onWayThrough(dim, q)) { seen.add(kk); list.push(q); }
    }
  }
  BCELLS.set(k, { t: now, list });
  if (BCELLS.size > 200) BCELLS.clear();
  return list;
}
// a spot (any floor, or round him outside) with a clear shot at one of the enemies the squad knows about
function shotSpot(e, S, now, maxRays = 12) {
  const dim = e.dimension, l = e.location;
  const targets = [...S.known.values()].filter((q) => q.ent?.isValid && !downed.has(q.ent.id)).sort((a, b) => dist(a, l) - dist(b, l)).slice(0, 2);
  if (!targets.length) return undefined;
  const cands = [];
  if (isIndoors(e)) for (const q of buildingCells(dim, l)) cands.push(q);
  for (let r = 3; r <= 13; r += 2.5) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + r; const w = walkableNear(dim, l.x + Math.cos(a) * r, l.z + Math.sin(a) * r, l.y); if (w && Math.abs(w.y - l.y) <= 1.5) cands.push(w); }
  const mates = nearbyCombatants(dim.id, l, 24).filter((o) => o.typeId === SOLDIER && o.id !== e.id && !downed.has(o.id));
  const scored = cands.filter((q) => !claimedByOther(q, e.id, now) && !failedNear(e, q, now) && !mates.some((m) => Math.hypot(m.location.x - q.x, m.location.z - q.z) < 1.6 && Math.abs(m.location.y - q.y) < 1.5) && !targets.some((t) => dist(t, q) < 4))
    .map((q) => ({ q, c: flat(q, l) + Math.abs(q.y - l.y) * 3 })).sort((a, b) => a.c - b.c);
  let rays = 0;
  for (const { q } of scored) {
    if (rays >= maxRays) break;
    for (const t of targets) { rays++; if (clearShot(dim, { x: q.x, y: q.y + 1.6, z: q.z }, { x: t.x, y: t.y + 1.3, z: t.z })) return { spot: q, face: t }; }
  }
  return undefined;
}
// securing the building: spread over its floors and rooms, a few blocks from every mate's spot, near the ways in
function secureSpot(e, S, now) {
  const dim = e.dimension, l = e.location, cells = buildingCells(dim, l);
  if (!cells.length) return undefined;
  const taken = [];
  for (const [id, B] of brain) if (id !== e.id && B.role?.spot && now - B.role.t < 600) taken.push(B.role.spot);
  for (const o of nearbyCombatants(dim.id, l, 30)) if (o.typeId === SOLDIER && o.id !== e.id && Number(P(o, "war:faction")) === sd(e).faction) taken.push(o.location);
  const mouths = stairMouths(dim, l, 18);
  let best, bs = -1e9;
  for (let i = 0; i < Math.min(40, cells.length); i++) {
    const q = cells[Math.floor(Math.random() * cells.length)];
    if (claimedByOther(q, e.id, now)) continue;
    let near = 99; for (const t of taken) if (Math.abs(t.y - q.y) < 2.5) near = Math.min(near, Math.hypot(t.x - q.x, t.z - q.z));
    const watch = mouths.some((m) => Math.abs(m.y - q.y) < 1 && flat(m, q) >= 3 && flat(m, q) <= 7) ? 2 : 0;
    const sc = Math.min(near, 8) + watch - flat(q, l) * 0.08 - Math.abs(q.y - l.y) * 0.1;
    if (sc > bs) { bs = sc; best = q; }
  }
  if (!best) return undefined;
  const face = [...S.known.values()].sort((a, b) => dist(a, best) - dist(b, best))[0];
  return { spot: best, face };
}
// storming: the man's own way up (or in): the staircases are dealt out round the squad
function assaultSpot(e, d, S, now) {
  const dim = e.dimension, l = e.location;
  const known = [...S.known.values()].filter((q) => q.ent?.isValid && !downed.has(q.ent.id));
  if (!known.length) return undefined;
  const ec = known.reduce((a, q) => ({ x: a.x + q.x / known.length, y: a.y + q.y / known.length, z: a.z + q.z / known.length }), { x: 0, y: 0, z: 0 });
  const mates = [...squads.get(squadKey(e, d)) ? nearbyCombatants(dim.id, l, 40).filter((o) => o.typeId === SOLDIER && !downed.has(o.id) && Number(P(o, "war:faction")) === d.faction && sd(o).squad === d.squad).map((o) => o.id) : [e.id]].sort();
  const i = Math.max(0, mates.indexOf(e.id));
  if (ec.y > l.y + 2.5) {                                                   // they're upstairs: up every staircase at once
    const fy = Math.round(known.sort((a, b) => dist(a, ec) - dist(b, ec))[0].y);
    const mouths = stairMouths(dim, { x: ec.x, y: fy, z: ec.z }, 24).filter((m) => Math.abs(m.y - fy) < 1);
    if (mouths.length) { const m = mouths[i % mouths.length]; return { spot: { x: m.x, y: m.y, z: m.z }, face: ec, kind: "advance" }; }
  }
  const q = known.sort((a, b) => dist(a, l) - dist(b, l))[0];
  return { spot: { x: q.x, y: q.y, z: q.z }, face: q, kind: "advance" };
}
function buildingRole(e, d, now, S, B, t) {
  const P0 = S?.bplan;
  if (!P0 || !GUNS.includes(d.weapon) || d.func === "post" || d.retreat) return undefined;
  if (t?.isValid && canHit(e, t)) return undefined;                          // a shot: take it (the plan waits)
  let R = B.role;
  if (!R || R.planT !== P0.t || (R.fail ?? 0) >= 2) {
    let a;
    const odd = (e.id.charCodeAt(e.id.length - 1) & 1) === 1;
    if (P0.kind === "windows") a = shotSpot(e, S, now);
    else if (P0.kind === "secure") a = secureSpot(e, S, now);
    else if (P0.kind === "contain") a = shotSpot(e, S, now) ?? secureSpot(e, S, now);
    else if (P0.kind === "sortie") a = odd || S.ratio >= 1.6 ? assaultSpot(e, d, S, now) : shotSpot(e, S, now);   // half go, half cover them from the windows
    else if (P0.kind === "assault") a = assaultSpot(e, d, S, now);
    if (!a) { const crowd = nearbyCombatants(e.dimension.id, e.location, 1.8).filter((o) => o.typeId === SOLDIER && o.id !== e.id && !downed.has(o.id)).length; if (crowd >= 1 && isIndoors(e)) a = secureSpot(e, S, now); }   // (nothing for him to do and on top of a mate: spread out)
    R = { planT: P0.t, t: now, spot: a?.spot, face: a?.face, kind: a?.kind ?? "engage", fail: 0 };
    B.role = R;
    if (R.spot) claimSpot(e, R.spot, now);
  }
  if (!R.spot) return undefined;
  const l = e.location;
  if (flat(R.spot, l) < 1.4 && Math.abs(R.spot.y - l.y) < 1.2) {
    if (R.kind === "advance") { B.role = { ...R, spot: undefined }; return undefined; }   // got there: the fight takes over
    if (R.face) turnTo(e, R.face, 20);
    note(e, BPLANS[P0.kind]); return { g: "g_none", t: "t_mid", urgent: false };
  }
  if (now - R.t > 500) { R.fail++; R.t = now; failSpots.set(e.id, [...(failSpots.get(e.id) ?? []), { x: R.spot.x, z: R.spot.z, t: now }].slice(-6)); B.role = undefined; return undefined; }
  note(e, BPLANS[P0.kind]);
  const cur = travelTo.get(e.id);
  if (!personal.has(e.id) || !cur || flat(cur, R.spot) > 1.5 || Math.abs(cur.y - R.spot.y) > 1.5) { travelTo.set(e.id, { ...R.spot }); planPersonalTo(e, R.kind, R.spot, now); }
  return followPersonal(e, now) ?? { g: "g_none", t: "t_mid", urgent: false };
}
// anyone in or at a building with the enemy near and nothing to shoot at for a while: go and find a line (out from under
// the balcony, to the rail, to the next window), instead of standing there firing into the ceiling
function seekShot(e, d, now, S, B, t) {
  if (!GUNS.includes(d.weapon) || d.func === "post" || !S?.known?.size) return undefined;
  if (t?.isValid && canHit(e, t)) { B.seekT = undefined; return undefined; }
  const g = gunState.get(e.id);
  if (now - (g?.lastShot ?? -999) < 80) return undefined;
  const near = [...S.known.values()].some((q) => dist(q, e.location) < 35);
  if (!near) return undefined;
  B.seekT ??= now;
  if (now - B.seekT < 60) return undefined;
  if (B.seek && now - B.seek.t < 160) {
    const sp = B.seek.spot;
    if (flat(sp, e.location) < 1.4 && Math.abs(sp.y - e.location.y) < 1.2) { turnTo(e, B.seek.face, 20); return undefined; }
    note(e, "moving for a clear shot");
    return (Math.abs(sp.y - e.location.y) < 1.2 ? moveTo(e, sp, now, true, "spot") : undefined) ?? travel(e, sp, "engage", now, true);   // (same level: the movement gate, which allows a perch at an edge)
  }
  if (now - (B.seekPlanT ?? -999) < 100) return undefined;
  B.seekPlanT = now;
  const a = shotSpot(e, S, now, 10);
  if (!a) return undefined;
  B.seek = { spot: a.spot, face: a.face, t: now }; claimSpot(e, a.spot, now);
  note(e, "moving for a clear shot");
  return (Math.abs(a.spot.y - e.location.y) < 1.2 ? moveTo(e, a.spot, now, true, "spot") : undefined) ?? travel(e, a.spot, "engage", now, true);
}
// ================================================================ v6.9.2: staircases are choke points
// The top of a staircase (or ladder) is where anyone coming up has to show himself, one at a time. Defenders holding a
// floor with the enemy below take spots that watch each stairhead on their floor (split between the stairheads, the one
// nearest the enemy first). Attackers going up gather at the foot of the stairs ("stacking up"), then go up together
// ("Go, go, go!") instead of one by one into the guns. A staircase where men were cut down is remembered for a while
// as a killing ground: routes prefer another way up (the other staircase) if there is one.
const MOUTHS = new Map(); // area key -> { t, list: [{ x, y, z }] }
const stairish = (b) => !!b && (b.typeId.includes("stairs") || isClimb(b));
function stairMouths(dim, at, R = 18) {
  const fy = Math.floor(at.y + 0.01), k = `${dim.id}|${Math.floor(at.x / 8)}|${fy}|${Math.floor(at.z / 8)}`, now = tick();
  const c = MOUTHS.get(k);
  if (c && now - c.t < 400) return c.list;
  const raw = [], bx = Math.floor(at.x), bz = Math.floor(at.z);
  try {
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const x = bx + dx, z = bz + dz;
      if (!standAt(dim, x, fy, z, now) || stairish(tBlock(dim, x + 0.5, fy - 1, z + 0.5))) continue;   // a floor cell (not a step itself)
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const s1 = tBlock(dim, x + ox + 0.5, fy - 1, z + oz + 0.5), s2 = tBlock(dim, x + ox + 0.5, fy - 2, z + oz + 0.5);
        if (stairish(s1) || (stairish(s2) && passable(s1))) { raw.push({ x: x + 0.5, y: fy, z: z + 0.5 }); break; }   // steps leading down from here
      }
    }
  } catch {}
  const list = [];
  for (const p of raw) { const m = list.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 3.5); if (m) { m.n++; m.x += (p.x - m.x) / m.n; m.z += (p.z - m.z) / m.n; } else list.push({ ...p, n: 1 }); }
  MOUTHS.set(k, { t: now, list });
  if (MOUTHS.size > 300) MOUTHS.clear();
  return list;
}
// the killing ground memory (short: ~2 min), per 2x2 cell, with the floor
const KILLZONE = new Map(); // "dim|cx|cz" -> { n, t }
function noteKillzone(e) {
  try {
    const l = e.location, dim = e.dimension;
    const nearMouth = onStairs(dim, l) || stairMouths(dim, l, 6).some((m) => Math.hypot(m.x - l.x, m.z - l.z) < 2.5 && Math.abs(m.y - l.y) < 1.5);
    if (!nearMouth) return;
    const kk = troubleKey(dim.id, l.x, l.z), r = KILLZONE.get(kk) ?? { n: 0, t: 0 };
    r.n = Math.min(6, r.n + 2); r.t = tick(); KILLZONE.set(kk, r);
  } catch {}
}
const killAt = (dimId, x, z) => { const r = KILLZONE.get(troubleKey(dimId, x, z)); return r && tick() - r.t < 2400 ? r.n : 0; };
system.runInterval(() => { const now = tick(); for (const [k, r] of KILLZONE) if (now - r.t > 2400) KILLZONE.delete(k); }, 200);
// defenders: a spot 3-7 blocks from a stairhead, on the same floor, that sees a man's head coming up it
function stairWatch(e, d, S, now, B) {
  const dim = e.dimension, l = e.location;
  const below = [...S.known.values()].filter((q) => q.y < l.y - 2.5 && Math.hypot(q.x - l.x, q.z - l.z) < 40);
  if (!below.length) { B.stair = undefined; return undefined; }
  if (B.stair && now - B.stair.t < 200 && marker(B.stair.slot)) {
    const sp = B.stair.spot;
    if (flat(sp, l) < 1.3 && Math.abs(sp.y - l.y) < 1) { turnTo(e, B.stair.mouth, 25); note(e, "covering the stairs"); return { g: "g_none", t: "t_mid", urgent: false }; }
    note(e, "taking the stairs"); return { g: "g_wp", slot: B.stair.slot, t: "t_mid", urgent: true };
  }
  const mouths = stairMouths(dim, l).filter((m) => Math.abs(m.y - Math.floor(l.y + 0.01)) < 1 && flat(m, l) < 20);
  if (!mouths.length) return undefined;
  const ec = below.reduce((a, q) => ({ x: a.x + q.x / below.length, z: a.z + q.z / below.length }), { x: 0, z: 0 });
  mouths.sort((a, b) => Math.hypot(a.x - ec.x, a.z - ec.z) - Math.hypot(b.x - ec.x, b.z - ec.z));
  // my share: the squad's defenders on this floor in id order, dealt round the stairheads (nearest the enemy first)
  const mates = nearbyCombatants(dim.id, l, 24).filter((o) => o.typeId === SOLDIER && !downed.has(o.id) && sd(o).squad === d.squad && Number(P(o, "war:faction")) === d.faction && Math.abs(o.location.y - l.y) < 2 && GUNS.includes(sd(o).weapon)).map((o) => o.id).sort();
  const i = Math.max(0, mates.indexOf(e.id)), mouth = mouths[i % mouths.length];
  const head = { x: mouth.x, y: mouth.y + 0.6, z: mouth.z };                // a man's head as he comes up the last step
  let best, bs = -1e9, rays = 0;
  for (let r = 3; r <= 7 && rays < 14; r++) for (let k = 0; k < 8 && rays < 14; k++) {
    const a = (k / 8) * Math.PI * 2 + i * 0.7;
    const q = walkableNear(dim, mouth.x + Math.cos(a) * r, mouth.z + Math.sin(a) * r, mouth.y);
    if (!q || Math.abs(q.y - mouth.y) > 0 || onWayThrough(dim, q) || claimedByOther(q, e.id, now) || mouths.some((m) => flat(m, q) < 2)) continue;
    rays++;
    if (!clearShot(dim, { x: q.x, y: q.y + 1.6, z: q.z }, head)) continue;
    const sc = -Math.abs(r - 5) - flat(q, l) * 0.15;
    if (sc > bs) { bs = sc; best = q; }
  }
  if (!best) return undefined;
  claimSpot(e, best, now);
  const slot = myMarker(e, best);
  if (!slot) return undefined;
  B.stair = { mouth, spot: best, slot, t: now };
  if (Math.random() < 0.4) callout(e, "Hold position!");
  note(e, "taking the stairs");
  return { g: "g_wp", slot, t: "t_mid", urgent: true };
}
// v6.9.3: inside, the enemy known (seen or heard) on this floor within 30 blocks, and nothing to shoot at for 3 s: go
// and engage him along a real route (through the doorway, round the corner); the route stops him as soon as he has a
// shot. Before, a squad holding a hallway beside the room the enemy had walked into stood there for the whole fight,
// and so did the enemy: both sides "defending the building", nobody fighting.
function huntContact(e, d, S, now, B) {
  const l = e.location;
  if (B.stair && now - B.stair.t < 400) return undefined;                  // watching a stairhead: that IS the fight, he stays
  let best, bd = 1e9;
  for (const q of S.known.values()) { if (Math.abs(q.y - l.y) > 2.5 || onStairs(e.dimension, q) || q.y < l.y - 1) continue; const dd = Math.hypot(q.x - l.x, q.z - l.z); if (dd < bd && dd < 30) { bd = dd; best = q; } }   // (one coming up the stairs: let him come)
  if (!best) { B.huntT = undefined; return undefined; }
  const g = gunState.get(e.id);
  if (now - (g?.lastShot ?? -999) < 60) { B.huntT = undefined; return undefined; }   // he's fighting
  B.huntT ??= now;
  if (now - B.huntT < 60) return undefined;
  if (S.ratio !== undefined && S.ratio < 0.6) return undefined;                // badly outnumbered: hold and let them come
  if (!personal.has(e.id) || now - (B.huntPlanT ?? -999) > 200) { B.huntPlanT = now; planPersonalTo(e, "engage", { x: best.x, y: best.y, z: best.z }, now); }
  note(e, "moving to engage");
  return followPersonal(e, now);
}
// attackers: about to climb to a floor where the enemy is: wait at the foot for the others, then all go
const stackUp = new Map(); // "squad|stair cell" -> { t0, go }
function stackAtStairs(e, pr, i, now) {
  const d = sd(e), S = squads.get(squadKey(e, d)), l = e.location;
  if (!S?.known?.size || (S.n ?? 0) < 2) return false;
  let climb = -1;
  for (let k = i; k < Math.min(pr.pts.length, i + 4); k++) if (pr.pts[k].y > l.y + 0.4 && onStairs(e.dimension, pr.pts[k])) { climb = k; break; }
  if (climb < 0 || flat(pr.pts[climb], l) > 3) return false;
  const up = [...S.known.values()].some((q) => q.y >= l.y + 2.5 && Math.hypot(q.x - l.x, q.z - l.z) < 30);
  if (!up) return false;
  const p = pr.pts[climb], key = `${squadKey(e, d)}|${Math.floor(p.x)}|${Math.floor(p.y)}|${Math.floor(p.z)}`;
  let st = stackUp.get(key);
  if (!st || now - st.t0 > 900) { st = { t0: now, go: 0 }; stackUp.set(key, st); if (stackUp.size > 200) stackUp.clear(); }
  if (st.go && now - st.go < 200) return false;                              // the stack is going: up he goes
  const here = nearbyCombatants(e.dimension.id, l, 5).filter((o) => o.typeId === SOLDIER && !downed.has(o.id) && Number(P(o, "war:faction")) === d.faction && sd(o).squad === d.squad).length;   // (him included)
  if (here >= Math.min(3, S.n) || now - st.t0 > 120) { st.go = now; callout(e, "Go, go, go!"); radio(e, "going up the stairs", true); return false; }
  return true;
}
// ---- general's view: the camera hangs above a ground cursor and looks straight down, so the middle of your
// screen (your crosshair) IS the cursor. Look further up to push it out (up to ~160 blocks), down to pull it in;
// turn to swing it around. You stay where you are. Any baton order (or backing out) ends it; so does dying.
const generals = new Map(); // player id -> { cursor }
function generalCursor(p) {
  const rot = p.getRotation(), yaw = rot.y * Math.PI / 180;
  const pitch = Math.max(-30, Math.min(90, rot.x));                    // 90 = looking straight down
  const reach = Math.max(0, (90 - pitch) / 120) * 160;                 // straight down: here; level: ~120; up: ~160
  const x = p.location.x - Math.sin(yaw) * reach, z = p.location.z + Math.cos(yaw) * reach;
  let y = p.location.y;
  try { const top = p.dimension.getTopmostBlock({ x, z }); if (top) y = top.location.y + 1; } catch {}
  return { x, y, z };
}
function endGeneral(player) {
  generals.delete(player.id);
  try { player.camera.clear(); } catch {}
}
function toggleGeneral(player) {
  if (generals.has(player.id)) { endGeneral(player); player.onScreenDisplay.setActionBar("§7General's view off."); return; }
  generals.set(player.id, { cursor: generalCursor(player) });
  player.onScreenDisplay.setActionBar("§eGeneral's view: your crosshair is the ground target. Use the baton to order; that ends the view.");
}
system.runInterval(() => {
  for (const [id, g] of [...generals]) {
    const p = findPlayer(id);
    if (!p) { generals.delete(id); continue; }
    try {
      g.cursor = generalCursor(p);
      p.camera.setCamera("minecraft:free", { location: { x: g.cursor.x, y: g.cursor.y + 55, z: g.cursor.z }, rotation: { x: 90, y: p.getRotation().y }, easeOptions: { easeTime: 0.15 } });
      p.dimension.spawnParticle("minecraft:villager_happy", { x: g.cursor.x, y: g.cursor.y + 0.5, z: g.cursor.z });
      const f = playerFaction(p);
      for (const [k, S] of squads) {
        if (!S.ourC || !k.startsWith(`${f}:`)) continue;
        p.dimension.spawnParticle(S.known?.size ? "minecraft:redstone_ore_dust_particle" : "minecraft:blue_flame_particle", { x: S.ourC.x, y: S.ourC.y + 4, z: S.ourC.z });
      }
    } catch {}
  }
}, 4);
// never stuck in it: cleared on death, on respawn, and when you join
world.afterEvents.entityDie.subscribe((ev) => { try { if (ev.deadEntity.typeId === "minecraft:player") endGeneral(ev.deadEntity); } catch {} });
world.afterEvents.playerSpawn.subscribe((ev) => { try { endGeneral(ev.player); } catch {} });

// ================================================================ v5.2: one movement system
// ---- ladders: Minecraft's walking won't climb on purpose, so a soldier whose route goes up/down a ladder is
// moved along the ladder directly (step by step), then stepped onto the next route point.
const climbing = new Map(); // id -> { x, z, toY, exit, t }
function routeOf(e) {
  const pr = personal.get(e.id);
  if (pr?.pts) return { pts: pr.pts, idx: trackIdx(e.id, pr.pts, e.location) };
  const g = Number(gdp(e, "war:ordergoal") ?? gdp(e, "war:goal") ?? 0);
  const id = laneOf.get(g); const m = id ? getMarches()[id] : undefined;
  if (m?.path) return { pts: m.path, idx: routeProgress(m, e.location, e.id) };
  return undefined;
}
function startClimbIfNeeded(e) {
  if (climbing.has(e.id) || isRiding(e)) return;
  const r = routeOf(e);
  if (!r) return;
  const pts = r.pts;
  for (let i = Math.max(0, r.idx - 1); i < Math.min(pts.length, r.idx + 4); i++) {
    const p = pts[i];
    if (!p.climb) continue;
    if (Math.hypot(p.x - e.location.x, p.z - e.location.z) > 1.3 || Math.abs(p.y - e.location.y) > 1.3) continue;   // his ladder, on his level
    // the run of ladder points from here: climb to its far end, then step to the point after it
    let j = i; while (j + 1 < pts.length && pts[j + 1].climb && Math.hypot(pts[j + 1].x - p.x, pts[j + 1].z - p.z) < 0.6) j++;
    if (j + 1 <= r.idx) continue;                                   // v5.3: that ladder is behind him (he just got off it)
    const exit = pts[Math.min(pts.length - 1, j + 1)];
    const toY = pts[j].y;
    if (Math.abs(toY - e.location.y) < 0.6 && (!exit || Math.abs(exit.y - e.location.y) < 0.6)) return;
    climbing.set(e.id, { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5, toY, exit, t: tick() });
    for (let yy = Math.min(e.location.y, toY) - 1; yy <= Math.max(e.location.y, toY) + 2; yy++) openAt(e.dimension, { x: p.x, y: yy, z: p.z });   // trapdoors in the shaft
    note(e, "climbing the ladder");
    return;
  }
}
system.runInterval(() => {
  const now = tick();
  for (const [id, c] of [...climbing]) {
    const e = world.getEntity(id);
    if (!e?.isValid || now - c.t > 400) { climbing.delete(id); if (e?.isValid) ladderFail.set(id, now); continue; }
    try {
      const y = e.location.y, dy = c.toY - y;
      if (Math.abs(dy) > 0.15) {
        const ny = y + Math.sign(dy) * Math.min(0.2, Math.abs(dy));
        if (!glideFree(e.dimension, c.x, ny, c.z) || (dy > 0 && !cellOpen(tBlock(e.dimension, c.x, Math.floor(ny + 0.01) + 2, c.z)) && ny + 1.8 > Math.floor(ny + 0.01) + 2)) {
          c.blocked = (c.blocked ?? 0) + 1;                                                    // v5.9: a shut trapdoor / a ceiling: never into it
          if (c.blocked === 3) openAt(e.dimension, { x: c.x, y: Math.floor(ny) + 2, z: c.z });
          if (c.blocked > 12) { climbing.delete(id); glideBan.set(id, now + 60); personal.delete(id); ladderFail.set(id, now); }
          continue;
        }
        e.teleport({ x: c.x, y: ny, z: c.z });                                                 // up or down the ladder
      } else {
        // step off onto the next point: only a short step into open space (v5.9: never through a wall or far)
        if (c.exit && Math.hypot(c.exit.x - c.x, c.exit.z - c.z) <= 1.6 && Math.abs(c.exit.y - y) <= 1.2 && glideFree(e.dimension, c.exit.x, c.exit.y, c.exit.z)) e.teleport({ x: c.exit.x, y: c.exit.y, z: c.exit.z });
        climbing.delete(id);
      }
    } catch { climbing.delete(id); }
  }
}, 1);
system.runInterval(() => { for (const e of allOf(SOLDIER)) { try { if (personal.has(e.id) || gdp(e, "war:catchup") !== undefined) startClimbIfNeeded(e); } catch {} } }, 4);   // (v5.9: only men stepping a route themselves)

// ================================================================ v6.0: rescue (the last resort, and ONLY for these)
// 1. stuck inside blocks (feet or head in a solid block for 2 s): out to the nearest open spot, else to a squad mate;
// 2. caught in a loop: on a march / his own route, not fighting, no real progress for 30 s while a squad mate IS
//    getting on: put next to that mate;
// 3. a ladder climb that failed: put next to a mate who got past it.
// "A mate doing well": same march (or squad), on his feet, not fighting, moved recently, further along, on solid
// ground. At most one rescue per soldier per minute. Everything else is walked, climbed and planned, never teleported.
const ladderFail = new Map(); // id -> tick a climb gave up
const rescueMark = new Map(); // id -> { x, y, z, t } where/when he last made real progress
const rescueT = new Map();    // id -> tick of his last rescue
const pressing = new Map();   // id -> { x, y, z, t, n } (v6.2: going nowhere while wanting to walk)
const insideN = new Map();    // id -> checks in a row inside a block
// his body (mid and head, not his feet: path blocks, soul sand and the like sit his feet a little inside the block)
function insideBlock(e) {
  try { const l = e.location; return !cellOpen(tBlock(e.dimension, l.x, l.y + 0.6, l.z)) || !cellOpen(tBlock(e.dimension, l.x, l.y + 1.5, l.z)); } catch { return false; }
}
function marchOfE(e) {
  const g = Number(gdp(e, "war:ordergoal") ?? gdp(e, "war:goal") ?? 0);
  const id = laneOf.get(g) ?? laneOf.get(Number(gdp(e, "war:chargegoal") ?? 0));
  return id ? getMarches()[id] : undefined;
}
function doingWell(o, now, m) {
  if (!o?.isValid || downed.has(o.id) || pows.has(o.id) || isRiding(o) || climbing.has(o.id) || combatLock.has(o.id)) return false;
  const mk = rescueMark.get(o.id);
  const there = m?.final && m.pos && Math.hypot(o.location.x - m.pos.x, o.location.z - m.pos.z) < 15 && Math.abs(o.location.y - m.pos.y) < 3;   // made it to the destination
  if (!there && (!mk || now - mk.t > 200)) return false;          // he's not getting anywhere either
  const l = o.location;
  return standAt(o.dimension, Math.floor(l.x), Math.floor(l.y + 0.01), Math.floor(l.z), now) && glideFree(o.dimension, l.x, l.y, l.z);
}
function rescueTo(e, why, now) {
  const d = sd(e), m = marchOfE(e);
  const pool = m ? m.members.map((id) => world.getEntity(id)).filter(Boolean) : nearbyCombatants(e.dimension.id, e.location, 96).filter((o) => o.typeId === SOLDIER && Number(P(o, "war:faction") ?? 0) === d.faction && sd(o).squad === d.squad);
  let best, bs = -1e9;
  const myP = m?.path ? routeProgress(m, e.location, e.id) : 0;
  for (const o of pool) {
    if (o.id === e.id || o.dimension.id !== e.dimension.id || !doingWell(o, now, m) || dist(o.location, e.location) < 3) continue;
    const sc = m?.final && m.pos ? -flat(o.location, m.pos) : m?.path ? routeProgress(m, o.location, o.id) - myP : -dist(o.location, e.location) / 10;
    if (sc > bs) { bs = sc; best = o; }
  }
  if (!best) return false;
  const l = best.location, b = best.getViewDirection?.() ?? { x: 0, z: 0 };
  // a free spot by him (behind him first), never on top of anyone
  const occupied = (q) => nearSnap(e.dimension.id, q, 1.5).some((c) => c.id !== e.id && c.type === SOLDIER && Math.abs(c.y - q.y) < 1.5) || claimedByOther(q, e.id, now) || dangerNear(e.dimension, q);   // (v6.2: 1.5 from everyone, never by a drop / lava)
  let to;
  for (const [ox, oz] of [[-(b.x ?? 0) * 1.5, -(b.z ?? 0) * 1.5], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1.5, 1.5], [-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5]]) {
    const q = { x: Math.floor(l.x + ox) + 0.5, y: Math.floor(l.y + 0.01), z: Math.floor(l.z + oz) + 0.5 };
    if (standAt(e.dimension, Math.floor(q.x), q.y, Math.floor(q.z), now) && glideFree(e.dimension, q.x, q.y, q.z) && !occupied(q) && localReach(e.dimension, l, q, 60)) { to = q; break; }
  }
  if (!to) return false;
  try { e.teleport(to, { dimension: best.dimension }); claimSpot(e, to, now); } catch { return false; }
  afterRescue(e, now, why);
  return true;
}
// v6.2: nobody to rescue him to (his whole squad is down in the pit with him): up onto a free spot on his own route ahead
function pitOut(e, m, now) {
  if (!m?.path) return false;
  const l = e.location, pts = m.path, pi = routeProgress(m, l, e.id);
  const free = (q) => !nearSnap(e.dimension.id, q, 1.5).some((c) => c.id !== e.id && c.type === SOLDIER && Math.abs(c.y - q.y) < 1.5) && !claimedByOther(q, e.id, now) && !dangerNear(e.dimension, q);
  for (let k = Math.max(0, pi - 6); k < Math.min(pts.length, pi + 16); k++) {
    const p = pts[k];
    if (p.y < l.y + 1.5 || p.climb || p.w || flat(p, l) > 12) continue;
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = { x: Math.floor(p.x + ox) + 0.5, y: Math.floor(p.y + 0.01), z: Math.floor(p.z + oz) + 0.5 };
      if (!standAt(e.dimension, Math.floor(q.x), q.y, Math.floor(q.z), now) || !glideFree(e.dimension, q.x, q.y, q.z) || !free(q)) continue;
      try { e.teleport(q); claimSpot(e, q, now); } catch { return false; }
      afterRescue(e, now, "helped out of a pit");
      return true;
    }
  }
  return false;
}
function afterRescue(e, now, why) {
  rescueT.set(e.id, now); rescueMark.set(e.id, { ...e.location, t: now }); insideN.delete(e.id);
  personal.delete(e.id); travelTo.delete(e.id); gliders.delete(e.id); climbing.delete(e.id); ladderFail.delete(e.id); driveOn.delete(e.id);
  note(e, why);
}
system.runInterval(() => {
  const now = tick();
  if (!setting("rescue", true)) return;
  let rescuesNow = 0;
  for (const e of allOf(SOLDIER)) {
    try {
      if (downed.has(e.id) || pows.has(e.id) || isRiding(e) || ridingNest(e)) { rescueMark.delete(e.id); continue; }
      const l = e.location, m0 = marchOfE(e);
      let mk = rescueMark.get(e.id);
      // progress: on a march, getting further along its route (pacing up and down a trench isn't progress); otherwise moving
      const pi = m0?.path && !m0.final ? routeProgress(m0, l, e.id) : undefined;
      const dd = m0?.final && m0.pos ? Math.hypot(l.x - m0.pos.x, l.z - m0.pos.z) + Math.abs(l.y - m0.pos.y) : undefined;   // arrived march: getting closer to it
      const moved = pi !== undefined ? pi >= (mk?.pi ?? -1) + 3 || pi < (mk?.pi ?? 0) - 10 : dd !== undefined ? dd < (mk?.dd ?? 1e9) - 3 : Math.hypot(l.x - (mk?.x ?? 1e9), l.z - (mk?.z ?? 0)) > 3 || Math.abs(l.y - (mk?.y ?? 0)) > 2;
      if (!mk || moved) { mk = { x: l.x, y: l.y, z: l.z, t: now, pi, dd }; rescueMark.set(e.id, mk); }
      const busy = combatLock.has(e.id) || !!perc.get(e.id)?.threat || gdp(e, "war:ordergoal") !== undefined && Number(gdp(e, "war:goal") ?? 0) !== Number(gdp(e, "war:catchup") ?? -1) || (m0 && m0.members.some((id) => combatLock.has(id)));
      if (busy) mk.t = now;                                           // fighting (or his squad is): that's not being stuck
      // v6.2: pressing into a wall / going nowhere: he wants to walk to a marker well away, he's simulated (not frozen
      // out of range) and he's got nowhere for 3 s. 1st: re-decide (that spot is avoided for 15 s); 2nd: a fresh route
      // to his order's goal; still stuck ~12 s on and not in a firefight: rescue (below).
      const goal = Number(gdp(e, "war:goal") ?? 0);
      let pz = pressing.get(e.id);
      if (!pz || Math.hypot(l.x - pz.x, l.z - pz.z) > 2 || Math.abs(l.y - pz.y) > 1.5) { pz = { x: l.x, y: l.y, z: l.z, t: now, n: 0 }; pressing.set(e.id, pz); }
      if (!isRemote(e) && !gliders.has(e.id) && !climbing.has(e.id) && wantsWalk(e, goal) && now - pz.t >= 60) {
        pz.n++; pz.t = now;
        const mk = marker(goal);
        if (pz.n >= 2) { noteTrouble(e.dimension, l, 1); if (mk) noteTrouble(e.dimension, mk.location, 1); }   // (v6.4: learned)
        if (mk) { const fl = failSpots.get(e.id) ?? []; fl.push({ x: mk.location.x, z: mk.location.z, t: now }); failSpots.set(e.id, fl.slice(-6)); }
        const B = brain.get(e.id);
        if (B) { B.act = ""; B.decT = -999; B.reachSpot = undefined; B.spread = undefined; B.reflex = undefined; }
        drill.get(e.id) && (drill.get(e.id).scoot = undefined);
        // v6.4: a man on a post (put on a wall, a window, a gate) is never teleported to his squad: he gives up that move and
        // holds where he is (the wall-top defenders who ended up on the far side of the wall)
        if (pz.n >= 2 && POST_FUNCS.includes(sd(e).func)) { personal.delete(e.id); travelTo.delete(e.id); setGroups(e, { g: "g_none" }); note(e, "holding here"); continue; }
        if (pz.n === 1) {
          // v6.4: shake loose, the way a hit does it: a hop and a step back / aside (never toward a drop or lava)
          if (mk && !busy && !dangerNear(e.dimension, l) && !inWater(e)) {   // (not in a fight: there standing still is often the point)
            const dx = l.x - mk.location.x, dz = l.z - mk.location.z, L0 = Math.hypot(dx, dz) || 1, side = (e.id.charCodeAt(e.id.length - 1) & 1) ? 1 : -1;
            const vx = (dx / L0) * 0.22 + (-dz / L0) * side * 0.18, vz = (dz / L0) * 0.22 + (dx / L0) * side * 0.18;
            if (safeAhead(e, vx, vz)) push(e, { x: vx, y: 0.36, z: vz }, 3);
          }
          note(e, "trying something else"); try { think(e); } catch {}
        }
        else if (pz.n === 2) { personal.delete(e.id); travelTo.delete(e.id); const gp = goalPoint(e); if (gp) planPersonalTo(e, "settle", { x: gp.x, y: gp.y, z: gp.z }, now); note(e, "finding a way"); }
        else if (pz.n >= 4 && !busy && now - (rescueT.get(e.id) ?? -99999) >= 1200 && rescuesNow < 2) { if (rescueTo(e, "caught up with his squad", now)) { rescuesNow++; pressing.delete(e.id); continue; } }
      }
      if (now - (rescueT.get(e.id) ?? -99999) < 1200) continue;     // one rescue a minute at most
      // 0. (v6.2) down in a pit below his route with no way up found (a trench with no steps): out, even if his whole squad
      // is down there with him (a crowd normally means "held up", not stuck)
      { const br = belowRoute.get(e.id); if (br && br.n >= 3 && now - br.t < 300 && !busy && rescuesNow < 2) { belowRoute.delete(e.id); noteTrouble(e.dimension, l, 3); if (rescueTo(e, "helped out of a pit", now) || pitOut(e, m0, now)) { rescuesNow++; continue; } } }
      // 1. inside a block
      if (!climbing.has(e.id) && insideBlock(e)) {
        const n = (insideN.get(e.id) ?? 0) + 1; insideN.set(e.id, n);
        if (n >= 2) {
          const bx = Math.floor(l.x), by = Math.floor(l.y + 0.01), bz = Math.floor(l.z);
          let out;
          for (let r = 1; r <= 3 && !out; r++) for (let dy = -1; dy <= 2 && !out; dy++) for (let dx = -r; dx <= r && !out; dx++) for (let dz = -r; dz <= r && !out; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (standAt(e.dimension, bx + dx, by + dy, bz + dz, now)) out = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 };
          }
          if (out) { try { e.teleport(out); afterRescue(e, "freed from a wall", now); } catch {} }
          else rescueTo(e, "freed from a wall", now);
          continue;
        }
      } else insideN.delete(e.id);
      // 3. a ladder that beat him
      const lf = ladderFail.get(e.id);
      if (lf !== undefined) { ladderFail.delete(e.id); if (now - lf < 100 && rescueTo(e, "helped up the ladder", now)) continue; }
      // 2. a loop: he should be moving, isn't fighting, and hasn't got anywhere for 30 s
      if (now - mk.t < 600) continue;
      const m = m0;
      const moving = (m && !m.final && m.path) || (m?.final && dd > 20) || personal.has(e.id);
      if (!moving || combatLock.has(e.id) || perc.get(e.id)?.threat) continue;
      if (m && m.members.some((id) => combatLock.has(id))) continue;   // the squad is holding for a fight: not stuck
      if (squads.get(squadKey(e, sd(e)))?.known?.size) continue;     // his squad is in contact: that's fighting, not stuck
      if (pi !== undefined) { const q = m.path[pi]; if (q && Math.hypot(q.x - l.x, q.z - l.z) < 4 && Math.abs(q.y - l.y) < 1.5) continue; }   // on his route, at its level: a queue, not a trap
      { const df = sd(e).faction; let crowd = 0, foe = false;            // a battle nearby, or jammed in a crowd: not stuck
        for (const c of nearSnap(e.dimension.id, l, 40)) { if (c.id === e.id || c.down) continue; if (c.f && isHostile(df, c.f)) { foe = true; break; } if (c.dd < 4 && c.type === SOLDIER) crowd++; }
        if (foe || crowd >= 4) continue; }
      // cut off: no squad mate within 10 blocks (held up in his own squad's crowd isn't stuck: they'll move on)
      const mates = m ? m.members : [];
      if (mates.some((id) => { if (id === e.id) return false; const o = world.getEntity(id); return o?.isValid && !downed.has(id) && dist(o.location, l) < 10 && doingWell(o, now, m); })) continue;   // (a mate stuck with him doesn't count)
      if (rescuesNow >= 2) continue;
      if (POST_FUNCS.includes(sd(e).func)) { personal.delete(e.id); travelTo.delete(e.id); continue; }   // (v6.4: never off his post: give up the move)
      if (rescueTo(e, "caught up with his squad", now)) { rescuesNow++; noteTrouble(e.dimension, l, 2); }
    } catch {}
  }
  if (now % 1200 < 20) for (const id of [...rescueMark.keys()]) if (!world.getEntity(id)) { rescueMark.delete(id); rescueT.delete(id); insideN.delete(id); ladderFail.delete(id); combatLock.delete(id); remoteMemo.delete(id); remoteSettled.delete(id); pressing.delete(id); failSpots.delete(id); belowRoute.delete(id); }
}, 20);

// ---- one way to travel anywhere: a direct step only when it's close and plainly reachable on foot;
// otherwise a proper dense route (the same planner and follower as every march)
const travelTo = new Map(); // id -> destination of his current personal route
// ================================================================ v6.2: the movement gate
// Every move a fight decides on (cover, a clear shot, making room, shoot-and-scoot, the brain's positions) comes here.
// A spot beside lava / a drop is moved to the nearest safe cell (or the move is dropped); Minecraft's own walking is only
// used for a plain, safe straight walk off any bridge or ledge; everything else is a route the script carries him along
// (short ones are instant). Fixing a movement bug here fixes it for every system at once.
const belowRoute = new Map(); // id -> { n, t }: times he was found below his route with no way up onto it (v6.2)
const failSpots = new Map(); // id -> [{ x, z, t }] spots he pressed toward and never reached (v6.2)
const failedNear = (e, q, now) => (failSpots.get(e.id) ?? []).some((f) => now - f.t < 300 && Math.hypot(f.x - q.x, f.z - q.z) < 2);
// v6.4: a firing slot: a gap in a battlement (an embrasure between two merlons, or a window in a wall-walk). It's next to
// the drop, but the drop is only straight ahead and there's solid cover on both sides at body height: a soldier stands
// there to shoot down at the enemy, he doesn't walk along it. v6.2 counted it as a ledge and never let anyone into it:
// wall defenders stood back from the merlons, saw nothing, and "took a firing position" for ever.
function firingSlot(dim, q) {
  const x = Math.floor(q.x), y = Math.floor(q.y + 0.01), z = Math.floor(q.z);
  let ax = 0, az = 0, n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && dropOrHazard(dim, x + dx + 0.5, y, z + dz + 0.5)) { ax += dx; az += dz; n++; if (hazardCell(dim, x + dx + 0.5, y, z + dz + 0.5)) return false; }
  if (!n || (ax && az)) return false;                               // drops on two sides (a corner, a bare wall-top): not a slot
  const solid = (bx, bz) => { try { const a = tBlock(dim, bx + 0.5, y, bz + 0.5), b = tBlock(dim, bx + 0.5, y + 1, bz + 0.5); return !!a && !!b && !(a.isAir || passable(a)) && !(b.isAir || passable(b)); } catch { return false; } };
  return ax ? solid(x, z - 1) && solid(x, z + 1) : solid(x - 1, z) && solid(x + 1, z);   // cover on both sides
}
// v6.9: a perch: the edge of a roof or a wall-top with no battlement, the drop straight ahead (one side, not a corner, no
// lava below). A man who wants a shot down at the enemy may stand there; nobody walks along it, and no enemy who could
// shove him off (a player, a hound, a man with a blade) is within 6.
function perchSpot(e, q) {
  const dim = e.dimension, x = Math.floor(q.x), y = Math.floor(q.y + 0.01), z = Math.floor(q.z);
  let ax = 0, az = 0, n = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (dropOrHazard(dim, x + dx + 0.5, y, z + dz + 0.5)) { if (hazardCell(dim, x + dx + 0.5, y, z + dz + 0.5) || hazardBelow(dim, x + dx + 0.5, y, z + dz + 0.5)) return false; ax += dx; az += dz; n++; }
  if (n !== 1) return false;
  const df = Number(P(e, "war:faction") ?? 0);
  for (const c of nearSnap(dim.id, q, 6)) if (!c.down && c.id !== e.id && (c.type === "minecraft:player" || c.type === HOUND || (c.type === SOLDIER && !GUNS.includes(String(gdp(c.e, "war:weapon") ?? "")))) && isHostile(df, c.f)) return false;
  return true;
}
// v6.9: the nearest edge cell (a perch or a battlement gap) within 8 on his level with a shot down at the enemy. The
// ordinary search for a clear shot only looks a block or two around him, and on a roof every such spot is blind.
function perchFor(e, tc, anchor, leash, now) {
  const dim = e.dimension, l = e.location, bx = Math.floor(l.x), by = Math.floor(l.y + 0.01), bz = Math.floor(l.z);
  const cands = [];
  for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
    const r = Math.hypot(dx, dz); if (r > 8) continue;
    const q = { x: bx + dx + 0.5, y: by, z: bz + dz + 0.5 };
    if (anchor && flat(q, anchor.location) > Math.max(leash, 8)) continue;
    if (!dangerNear(dim, q) || !standAt(dim, bx + dx, by, bz + dz, now) || claimedByOther(q, e.id, now) || failedNear(e, q, now)) continue;
    cands.push({ q, r });
  }
  cands.sort((a, b) => a.r - b.r);
  let rays = 0;
  for (const { q } of cands) {
    if (!firingSlot(dim, q) && !perchSpot(e, q)) continue;
    if (++rays > 8) break;
    if (clearShot(dim, { x: q.x, y: q.y + 1.6, z: q.z }, tc)) return q;
  }
  return undefined;
}
function hazardBelow(dim, x, y, z) { for (let k = 1; k <= 12; k++) { const b = tBlock(dim, x, y - k, z); if (!b) return false; if (b.typeId.includes("lava") || TI(b.typeId).hazard) return true; if (!(b.isAir || passable(b))) return false; } return false; }
function safeSpot(e, spot, now, shot = false) {
  const dim = e.dimension;
  if (!spot) return undefined;
  if ((!dangerNear(dim, spot) || firingSlot(dim, spot) || (shot && perchSpot(e, spot))) && !claimedByOther(spot, e.id, now) && !failedNear(e, spot, now) && troubleAt(dim.id, spot.x, spot.z) < 3) return spot;
  const bx = Math.floor(spot.x), by = Math.floor(spot.y + 0.01), bz = Math.floor(spot.z);
  let best, bd = 1e9;
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (const dy of [0, 1, -1]) {
    const q = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 };
    if (!standAt(dim, bx + dx, by + dy, bz + dz, now) || (dangerNear(dim, q) && !firingSlot(dim, q)) || claimedByOther(q, e.id, now) || failedNear(e, q, now) || troubleAt(dim.id, q.x, q.z) >= 3) continue;
    const dd = Math.hypot(dx, dz) + Math.abs(dy);
    if (dd < bd) { bd = dd; best = q; }
  }
  return best;
}
const onPassage = (e) => dangerNear(e.dimension, e.location);
function moveTo(e, spot, now, urgent = true, kind = "spot") {
  const s0 = safeSpot(e, spot, now, kind === "spot");
  if (!s0) return undefined;
  claimSpot(e, s0, now);
  const perch = kind === "spot" && dangerNear(e.dimension, s0) && !firingSlot(e.dimension, s0);   // (v6.9: a step up to the edge of a roof: a plain walk, he stops there)
  if (isIndoors(e) || onStairs(e.dimension, e.location) || onPassage(e) || !straightReach(e.dimension, e.location, s0, perch)) return travel(e, s0, kind, now, urgent);
  const slot = myMarker(e, s0);
  // (v6.9: to a perch, Minecraft's own chase is off for the few steps: with an enemy below that it can't see, it walked
  //  him toward the enemy (or nowhere) instead of to the edge. The script's gun doesn't need it.)
  return slot ? { g: "g_wp", slot, t: perch ? "t_off" : "t_mid", urgent } : undefined;
}
function travel(e, dest, kind, now, urgent = false) {
  if (!dest) return undefined;
  // v6.9: a man holding a roof, a wall-top or an upper floor stays up there: no move of the fight takes him down off it
  if (kind !== "rally" && kind !== "medic") { const d = sd(e); if (POST_FUNCS.includes(d.func)) { const an = marker(d.goal); if (an && an.location.y - dest.y > 3 && e.location.y > an.location.y - 1.5 && !squads.get(squadKey(e, d))?.bplan) return undefined; } }   // (v7.0: the squad's plan can take him anywhere)
  const inside = isIndoors(e) || onStairs(e.dimension, e.location);  // v5.5: indoors / on stairs every move is a real route (the glider walks it)
  if (!inside && !onPassage(e) && flat(dest, e.location) <= 12 && Math.abs(dest.y - e.location.y) <= 1 && straightReach(e.dimension, e.location, dest)) {   // (v6.2: only a safe straight walk)
    const slot = myMarker(e, dest);
    return slot ? { g: "g_wp", slot, t: "t_mid", urgent } : undefined;
  }
  if (inside && flat(dest, e.location) < 1) return undefined;
  const cur = travelTo.get(e.id), pr = personal.get(e.id);
  if (!pr || !cur || flat(cur, dest) > (inside ? 1.5 : 6)) {          // a new destination: plan a route to it
    travelTo.set(e.id, { ...dest });
    planPersonalTo(e, kind, dest, now);
  }
  return followPersonal(e, now);
}

// ================================================================ v5.3: route stepping, shared routes, close-combat drills
// ---- one marker per soldier for his own moves (personal routes, short hops, brain spots). It is moved, never
// re-spawned, so a soldier crossing a castle no longer leaves a trail of markers behind him (lag).
function myMarker(e, loc, key = "war:mymk") {
  let s = Number(gdp(e, key) ?? 0);
  const m = s ? marker(s) : undefined;
  if (!m) {
    s = makeWaypoint(e.dimension, loc, false);
    if (!s) return 0;
    try { marker(s)?.addTag("war_mine"); } catch {}
    sdp(e, key, s);
    try { noteRefs(e); } catch {}
    return s;
  }
  if (dist(m.location, loc) > 0.4) { try { m.teleport(loc); } catch {} }
  return s;
}

// ---- shared routes: squad mates heading to the same place reuse a route one of them just worked out
// (from the nearest point on it, same floor, reachable on foot). Fewer plans = less lag, and they move together.
const routeCache = []; // { dim, goal, pts, t }
function rememberRoute(dim, dest, pts) {
  const end = pts[pts.length - 1];
  routeCache.push({ dim: dim.id, goal: { x: dest.x, y: Number.isFinite(dest.y) ? dest.y : end.y, z: dest.z }, pts, t: tick() });
  if (routeCache.length > 40) routeCache.shift();
}
function cachedRoute(dim, from, dest) {
  const now = tick();
  for (let k = routeCache.length - 1; k >= 0; k--) {
    const c = routeCache[k];
    if (now - c.t > 400) { routeCache.splice(k, 1); continue; }
    if (c.dim !== dim.id || r3(c.goal, { x: dest.x, y: Number.isFinite(dest.y) ? dest.y : c.goal.y, z: dest.z }) > 3) continue;
    const i = nearestIdx(c.pts, from, 0, c.pts.length);
    if (r3(c.pts[i], from) > 3 || c.pts[i].climb) continue;
    if (!localReach(dim, from, c.pts[i])) continue;
    return c.pts.slice(i);
  }
  return undefined;
}

// ---- doors, trapdoors and fence gates on the route: opened as he gets there, shut again once everyone is through
const opened = []; // { dim, loc, at }
const hopT = new Map(); // id -> tick of his last step-up hop
function openAt(dim, loc) {
  try {
    const p = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
    const b = dim.getBlock(p);
    if (!b || !OPENABLE_ID(b.typeId) || b.typeId.includes("iron")) return;
    if (b.permutation.getState("open_bit")) return;
    b.setPermutation(b.permutation.withState("open_bit", true));
    TERRAIN.delete(bkey(dim.id, p.x, p.y, p.z));
    if (!opened.some((o) => o.dim === dim.id && o.loc.x === p.x && o.loc.y === p.y && o.loc.z === p.z)) opened.push({ dim: dim.id, loc: p, at: tick() + 60 });
  } catch {}
}
system.runInterval(() => {
  const now = tick();
  for (let i = opened.length - 1; i >= 0; i--) {
    const o = opened[i];
    if (now < o.at) continue;
    try {
      if (nearbyCombatants(o.dim, { x: o.loc.x + 0.5, y: o.loc.y, z: o.loc.z + 0.5 }, 2.2).some((c) => c.typeId === SOLDIER || c.typeId === "minecraft:player")) { o.at = now + 40; continue; }
      const b = world.getDimension(o.dim).getBlock(o.loc);
      if (b && OPENABLE_ID(b.typeId)) b.setPermutation(b.permutation.withState("open_bit", false));
      TERRAIN.delete(bkey(o.dim, o.loc.x, o.loc.y, o.loc.z));
      opened.splice(i, 1);
    } catch { if (now - o.at > 6000) opened.splice(i, 1); }
  }
}, 20);

// ---- the stepper: where plain walking toward the guide can't be trusted (stairs, ladders, doors, trapdoors, gates,
// tight rooms), the soldier is walked point by point along his own route. The climber takes over on a ladder.
function stepAlong(e, pts, i, firm = false) {
  if (climbing.has(e.id) || gliders.has(e.id) || isRiding(e) || downed.has(e.id)) return;
  let k = i;
  while (k < pts.length - 1 && r3(pts[k], e.location) < 0.9) k++;
  const p = pts[k];
  if (!p) return;
  for (const q of [pts[k], pts[k + 1]]) {                                   // open what's in the way, here and next
    if (!q || dist(q, e.location) > 3) continue;
    openAt(e.dimension, q); openAt(e.dimension, { x: q.x, y: q.y + 1, z: q.z });
  }
  const dx = p.x - e.location.x, dz = p.z - e.location.z, L = Math.hypot(dx, dz);
  if (p.climb && L <= 1.1 && Math.abs(p.y - e.location.y) <= 1.3) { startClimbIfNeeded(e); return; }   // on the ladder: climb
  if (L < 0.25) return;
  // brake near drops: if just past this point (or beside the way down) there's a drop, step gently so he can't overshoot
  let cap = 0.6;
  try {
    const ux = dx / L, uz = dz / L;
    const dropAt = (x, z) => { const f1 = tBlock(e.dimension, x, p.y - 1, z), f2 = tBlock(e.dimension, x, p.y - 2, z); return !!f1 && !!f2 && (f1.isAir || passable(f1)) && (f2.isAir || passable(f2)); };
    if (p.y < e.location.y - 0.5 || dropAt(p.x + ux, p.z + uz) || dropAt(p.x - uz, p.z + ux) || dropAt(p.x + uz, p.z - ux)) cap = 0.2;
  } catch {}
  const s = Math.min(1, cap / Math.max(0.01, L * 0.25));
  const up = p.y > e.location.y + 0.5 && !p.climb;
  let face = false;                                                         // a full block in front at his feet: hop first, then forward
  if (up) {
    const full = (b) => !!b && !pathable(b) && !b.typeId.includes("stairs") && !b.typeId.includes("slab");
    try { face = full(tBlock(e.dimension, e.location.x + (dx / L) * 0.8, Math.floor(e.location.y), e.location.z + (dz / L) * 0.8)) || (L < 1.6 && full(tBlock(e.dimension, p.x, Math.floor(e.location.y), p.z))); } catch {}   // v5.4: also the step's own cell
  }
  if (face) {
    if (tick() - (hopT.get(e.id) ?? -99) < 12) return;
    hopT.set(e.id, tick());
    push(e, { x: dx / L * 0.04, y: 0.42, z: dz / L * 0.04 }, 3);
    const fwd = cap < 0.6 ? 0.16 : 0.3;                                       // a drop beyond: land on the step, don't sail past it
    const ent = e, vx = dx / L * fwd, vz = dz / L * fwd;
    system.runTimeout(() => { try { if (ent.isValid) push(ent, { x: vx, y: 0, z: vz }, 3); } catch {} }, 5);   // over the edge once he's up
    return;
  }
  push(e, { x: dx * 0.25 * s, y: 0.05, z: dz * 0.25 * s }, firm ? 3 : 2);   // (firm: every 4 ticks, so a file of men keeps moving on the stairs)             // stairs / slabs: walked up (mobs step half blocks), never jumped
}
// ---- the route driver (v5.4): four times a second, every soldier on a route of his own (a personal route, or a march
// stretch he follows himself) gets his marker moved along it, a few blocks ahead of him and never past a stair, ladder
// or door until he reaches it; at those he is stepped through point by point. Single file: a soldier right behind a
// squad mate who is further along waits a moment instead of walking into him (no piles at the top of the stairs).
// how far along the route his marker goes: ~maxLen blocks, up and down ordinary stairs (Minecraft walks those well),
// but never past a ladder, something to open, or a drop of 2+ (he's stepped through those himself)
function driveAhead(pts, i, maxLen) {
  let len = 0, j = i;
  while (j < pts.length - 1) {
    const a = pts[j], b = pts[j + 1];
    if (j > i && (a.climb || b.climb || b.open || Math.abs(b.y - a.y) >= 2)) break;
    len += Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(b.y - a.y);
    j++;
    if (len >= maxLen || b.climb) break;
  }
  return Math.min(pts.length - 1, j);
}
function queuedBehind(e, pts, i) {
  const nx = pts[Math.min(pts.length - 1, i + 1)], end = pts[pts.length - 1];
  const hx = nx.x - e.location.x, hz = nx.z - e.location.z, hl = Math.hypot(hx, hz);
  const myEnd = r3(end, e.location), f = Number(P(e, "war:faction") ?? 0);
  const myM = marchOfE(e);
  for (const c of nearSnap(e.dimension.id, e.location, 4.5)) {          // (v6.0: the shared snapshot, factions pre-read; live positions)
    if (c.id === e.id || c.type !== SOLDIER || c.down || c.f !== f || !c.e.isValid) continue;
    const o = c.e, ol = o.location;
    // v6.3: a man of another squad coming the other way isn't a queue: they pass each other (in a gap, both sides used
    // to wait for the other one, then shove through, jammed on one spot)
    if (myM) { const oM = marchOfE(o); if (oM && oM !== myM && !oM.final && Math.cos((oM.heading ?? 0) - (myM.heading ?? 0)) < -0.3) continue; }
    if (Math.abs(ol.y - e.location.y) > 1.2 || Math.hypot(ol.x - e.location.x, ol.z - e.location.z) > 1.2) continue;
    const ox = ol.x - e.location.x, oz = ol.z - e.location.z;
    if (Math.hypot(ox, oz) < 0.4) { if (o.id < e.id) return true; continue; }  // on the same spot: one of them waits
    if (hl > 0.2 && (ox * hx + oz * hz) / hl < 0.15) continue;               // not in front of him
    const oEnd = r3(end, o.location);
    if (oEnd < myEnd - 0.4 || (Math.abs(oEnd - myEnd) <= 0.4 && o.id < e.id)) return true;   // he's further along: let him go first
  }
  return false;
}
// ---- settling on his spot: Minecraft's walking calls anything within 3 blocks "there", so a soldier can end up holding
// on the stairs below his spot, in a doorway, or a floor under it. He's stepped the last bit: up the rest of the march's
// route if his spot is on another floor, else straight onto it.
const settleT = new Map();
function settle(e, slot, m) {
  const sp = marker(slot), now = tick();
  if (!sp || gdp(e, "war:ordergoal") !== undefined || personal.has(e.id) || now - (settleT.get(e.id) ?? -999) < 100) return;
  const p = e.location, at = sp.location, dd = dist(p, at);
  if (dd < 0.9 || dd > 12) return;
  const off = Math.abs(at.y - p.y) > 0.8;
  if (!off && (dd > 3.3 || !onWayThrough(e.dimension, p))) return;               // on his level and not in anyone's way: fine
  if (!m?.final && !["hold", "post", "sentry", "stand", "patrol"].includes(sd(e).func)) return;
  settleT.set(e.id, now);
  planPersonalTo(e, "settle", { x: at.x, y: at.y, z: at.z }, now);                // a short real route onto it (never a straight line off a stair)
  note(e, "taking his spot");
}
const stepping = new Set(); // soldiers following a route of their own right now (the edge guard watches only them)
// v6.2: out of range. Beyond the game's simulation distance (4 chunks by default, ~64 blocks from every player) the land
// is still loaded but mobs don't move at all: their own walking simply doesn't run. A squad sent far away used to walk
// ~64 blocks from you and freeze there ("doesn't take long orders"). Out there the script carries them along their route
// itself (scripts still run in loaded land), at walking pace, single file. Back in range, normal walking takes over.
// out of range nobody walks to a formation spot, so at the end of the known route each man steps onto his own free
// cell (at most 3 blocks, safe ground, 1.5 from everyone) instead of all standing on the last route point
const remoteSettled = new Map(); // id -> cell he settled on
function remoteSpread(e, now, endK) {
  const l = e.location, dim = e.dimension;
  const at = (q) => `${Math.floor(q.x)},${Math.floor(q.z)}|${endK}`;   // his cell, for this route end (a longer route moves him on)
  const crowded = (q) => nearSnap(dim.id, q, 1.4).some((c) => c.id !== e.id && c.type === SOLDIER && !c.down && Math.abs(c.y - q.y) < 1.5) || claimedByOther(q, e.id, now);
  if (remoteSettled.get(e.id) === at(l)) return;   // he's settled here: later arrivals move, not him
  remoteSettled.set(e.id, at(l));
  if (!crowded(l)) return;
  const bx = Math.floor(l.x), by = Math.floor(l.y + 0.01), bz = Math.floor(l.z);
  for (let r = 1; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    for (const dy of [0, 1, -1]) {
      const q = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 };
      if (!standAt(dim, bx + dx, by + dy, bz + dz, now) || dangerNear(dim, q) || crowded(q) || !localReach(dim, l, q, 60)) continue;
      try { e.teleport(q); claimSpot(e, q, now); remoteSettled.set(e.id, at(q)); } catch {}
      return;
    }
  }
}
// Detected, not guessed: the add-on can't read the simulation distance setting, so a soldier counts as out of range only
// when he should be walking but hasn't moved by a hair for ~2 s (mobs the game doesn't simulate are frozen exactly) and
// no player is within 32 blocks. The moment he moves on his own again (or a player comes near) he's back to normal.
const remoteMemo = new Map(); // id -> { x, y, z, frozen (ticks), on }
function trackRemote(e, now, wantsToMove) {
  const l = e.location;
  let r = remoteMemo.get(e.id);
  if (!r) { r = { x: l.x, y: l.y, z: l.z, frozen: 0, on: false }; remoteMemo.set(e.id, r); return; }
  const moved = l.x !== r.x || l.y !== r.y || l.z !== r.z;
  r.x = l.x; r.y = l.y; r.z = l.z;
  if (moved) { if (!gliders.has(e.id) && !climbing.has(e.id)) { r.frozen = 0; r.on = false; } return; }   // he moved by himself: simulated
  if (wantsToMove) r.frozen += 4;
  if (r.frozen >= 40 && !playerNear(e, 32)) r.on = true;
}
// he's set to walk (Minecraft's walking on) toward a marker that's well away from him
function wantsWalk(e, goal) {
  const mk = goal ? marker(goal) : undefined;
  if (!mk || dist(mk.location, e.location) <= 4) return false;
  const g = getJSON(e, "war:st", {}).g;
  return g === "g_wp" || (g === "g_none" && !gliders.has(e.id) && dangerNear(e.dimension, e.location));   // (v6.2: or held still on a ledge with somewhere to go)
}
function playerNear(e, R) {
  try { const l = e.location, did = e.dimension.id; for (const p of world.getAllPlayers()) { if (p.dimension.id !== did) continue; const pl = p.location; if (Math.abs(pl.x - l.x) <= R && Math.abs(pl.z - l.z) <= R) return true; } } catch {}
  return false;
}
function isRemote(e) {
  const r = remoteMemo.get(e.id);
  if (!r?.on) return false;
  if (playerNear(e, 32)) { r.on = false; r.frozen = 0; return false; }
  return true;
}
system.runInterval(() => {
  const now = tick();
  stepping.clear();
  for (const e of allOf(SOLDIER)) {
    try {
      if (climbing.has(e.id) || isRiding(e) || downed.has(e.id) || pows.has(e.id)) continue;
      let pts, i, own = false;
      const pr = personal.get(e.id);
      if (pr) {
        if (!pr.pts || pr.planning || (pr.hold ?? 0) > now) continue;
        pts = pr.pts; i = trackIdx(e.id, pts, e.location); own = true;
      } else {
        const og = gdp(e, "war:ordergoal"), goal = Number(gdp(e, "war:goal") ?? 0);
        const cu = Number(gdp(e, "war:catchup") ?? 0);
        if (og !== undefined && goal !== cu) continue;                         // fighting: the brain moves him
        const mid = laneOf.get(Number(og ?? goal)) ?? laneOf.get(Number(gdp(e, "war:chargegoal") ?? 0));
        const m = mid ? getMarches()[mid] : undefined;
        if (!m?.path || m.final) { settle(e, og === undefined ? goal : Number(og), m); continue; }
        pts = m.path; i = routeProgress(m, e.location, e.id);
        trackRemote(e, now, wantsWalk(e, goal));
        own = (!!cu && goal === cu && !formMode.has(e.id)) || isRemote(e);   // (v6.2: out of range: always carried)
        if (!own) {                                                           // on the formation lanes: only help at a gate / when the lane is too close to walk to
          const mk = marker(goal);
          const close = !mk || dist(mk.location, e.location) <= 3.3;
          if ((close && !formMode.has(e.id)) || pts.slice(i, i + 3).some((q) => q.climb || q.open)) stepAlong(e, pts, i);
          continue;
        }
      }
      // v5.5: a tight stretch (indoors, stairs, a ladder, door or drop near): he is CARRIED along his route by the glider,
      // in single file, at walking pace (Minecraft's own walking stays idle: it was what got lost on stairs and in
      // doorways). Open ground: the marker runs ahead and Minecraft walks him at full pace.
      stepping.add(e.id);
      // v6.0: on open ground Minecraft walks him in a straight line to his marker, so the marker only goes as far ahead
      // as a straight walk is safe (no trench, gap or drop on the way); not even the next point: he's carried
      let ahead = -1;
      if (!pts.guess) for (let k = Math.min(pts.length - 1, driveAhead(pts, i, 7)); k > i; k--) if (straightReach(e.dimension, e.location, pts[k])) { ahead = k; break; }
      if (pr) trackRemote(e, now, wantsWalk(e, Number(gdp(e, "war:goal") ?? 0)));
      const remote = isRemote(e);
      // (v6.2: also mid-glide: queued for the last point, he'd wait his turn there forever behind whoever stands on it)
      const endK = `${Math.floor(pts[pts.length - 1].x)},${Math.floor(pts[pts.length - 1].z)}`;
      if (remote && (i >= pts.length - 2 || remoteSettled.get(e.id)?.endsWith(`|${endK}`))) { gliders.delete(e.id); remoteSpread(e, now, endK); continue; }   // the end of the known route: his own spot (and he stays on it)
      const tight = !pts.guess && (glideBan.get(e.id) ?? 0) <= now && (remote || ahead < 0 || tightAt(e.dimension, pts, i, e.location));
      if (tight) {
        const g = gliders.get(e.id);
        if (!remote && stackAtStairs(e, { pts }, i, now)) {           // (v6.9.2: the enemy's up there: gather at the foot, then all go)
          gliders.set(e.id, { pts, k: g && g.pts === pts ? g.k : glideStart(pts, i, e.location), t: now, paused: true, wait: 0, blocked: 0 });
          myMarker(e, e.location); note(e, "stacking up at the stairs");
          continue;
        }
        const queued = queuedBehind(e, pts, i);
        const wait = queued ? (g?.wait ?? 0) + 4 : 0;
        const k = g && g.pts === pts ? g.k : glideStart(pts, i, e.location);
        gliders.set(e.id, { pts, k, t: now, paused: queued && wait < 50 && floorUnder(e.dimension, e.location.x, e.location.y, e.location.z), wait, blocked: g && g.pts === pts ? g.blocked : 0 });   // (v6.2: blocked kept: it was reset every refresh, so a man below his route was never let go)   // (never paused over a gap)   // never waits more than 2.5 s for anyone (no deadlocks)
        myMarker(e, e.location);
        note(e, queued && wait < 50 ? "waiting his turn" : remote ? "marching (out of range)" : "on the way through");
        continue;
      }
      gliders.delete(e.id);
      const tgt = pts[ahead >= 0 ? ahead : driveAhead(pts, i, 7)];
      myMarker(e, tgt);
      if (dist(tgt, e.location) <= 3.3) stepAlong(e, pts, i);
    } catch (err) { oops("route driver", err); }
  }
}, 4);

// ---- close-combat drills (War Table -> Settings -> General). They sit on top of the brain's decision:
// cover-and-move (half the squad covers while the other half moves, swapping every few seconds, movers weave
// under fire), shoot-and-scoot (no standing in one exposed spot trading fire for long), and flinching when hit.
const drill = new Map(); // id -> { fx, fz, since, scoot, scootUntil }
const teamOf = (e) => (e.id.charCodeAt(e.id.length - 1) + (e.id.charCodeAt(e.id.length - 2) || 0)) & 1;
function drillMove(e, d, now, melee, anchor, leash) {
  const mv = brainMove(e, d, now, melee, anchor, leash);
  if (!setting("drills", true) || melee || !GUNS.includes(d.weapon) || isRiding(e) || personal.has(e.id)) return mv;
  const B = brain.get(e.id), S = squads.get(squadKey(e, d));
  if (!B || !S || !S.known.size) { drill.delete(e.id); return mv; }
  let D = drill.get(e.id);
  if (!D) { D = { fx: e.location.x, fz: e.location.z, since: now }; drill.set(e.id, D); }
  const underFire = now - (firedAt.get(e.id)?.t ?? -999) < 40 || now - (hurtBy.get(e.id)?.t ?? -999) < 60;
  const t = perc.get(e.id)?.threat;
  // ---- shoot and scoot
  if (D.scoot) {
    if (now > D.scootUntil || flat(D.scoot, e.location) < 1.2) { D.scoot = undefined; D.fx = e.location.x; D.fz = e.location.z; D.since = now; }
    else { note(e, "shifting position"); const s = myMarker(e, D.scoot); return s ? { g: "g_wp", slot: s, t: "t_mid", urgent: true } : mv; }
  }
  if (Math.hypot(e.location.x - D.fx, e.location.z - D.fz) > 1.5) { D.fx = e.location.x; D.fz = e.location.z; D.since = now; }
  if (B.act === "fire" && d.func !== "post" && underFire && t?.isValid && now - D.since > 120 + (e.id.charCodeAt(e.id.length - 1) % 5) * 12 && spendDecision()) {
    D.since = now;
    const tc = chest(t);
    const spot0 = spotNear(e, (w) => flat(w, e.location) >= 2.5 && clearShot(e.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, tc), anchor, leash);
    const spot = spot0 && !onPassage(e) ? safeSpot(e, spot0, now) : undefined;   // (v6.2: never on a bridge / ledge, never to a spot by an edge)
    if (spot && straightReach(e.dimension, e.location, spot)) {
      D.scoot = spot; D.scootUntil = now + 60;
      for (const st of gunState.values()) if (st.target?.id === e.id) st.next = Math.max(st.next, now + 8);   // those aiming at him lose their sight picture
      note(e, "shifting position"); if (Math.random() < 0.4) callout(e, Math.random() < 0.5 ? "Moving up!" : "Cover me!");
      const s = myMarker(e, spot);
      if (s) return { g: "g_wp", slot: s, t: "t_mid", urgent: true };
    }
  }
  // ---- cover and move
  if (B.act === "advance" && (S.plan === "contact" || S.plan === "assault") && (S.n ?? 0) >= 3 && (["charge", "follow", "patrol"].includes(d.func) || S.counter)) {
    const moving = (Math.floor(now / 70) & 1) === teamOf(e);
    if (!moving && t?.isValid && shotAt(e, d, t, now)) { note(e, "covering the advance"); return { g: "g_none", t: "t_mid", urgent: false }; }
    if (!moving) {                                                       // v5.4: no aimed shot: covering fire on the window / doorway they were just seen in
      const q = ["mg", "rifle", "semi"].includes(d.weapon) ? suppressPoint(e, d, S, now) : undefined, gs = gunState.get(e.id);
      if (q && gs && now - q.t <= 40) { gs.supp = { p: q.aim, until: now + 30, ent: q.ent }; turnTo(e, q, 20); note(e, "covering fire"); if (Math.random() < 0.2) callout(e, "Suppressing!"); return { g: "g_none", t: "t_mid", urgent: false }; }
    }
    if (moving && mv && underFire && S.enemyC && !isIndoors(e)) {
      const dx = S.enemyC.x - e.location.x, dz = S.enemyC.z - e.location.z, L = Math.hypot(dx, dz) || 1;
      const side = ((Math.floor(now / 14) + teamOf(e)) & 1) ? 1 : -1;
      const sx = e.location.x + (-dz / L) * side * 1.2, sz = e.location.z + (dx / L) * side * 1.2;
      const w = walkableNear(e.dimension, sx, sz, e.location.y);
      if (w && Math.abs(w.y - e.location.y) <= 0.6) push(e, { x: (-dz / L) * side * 0.14, y: 0, z: (dx / L) * side * 0.14 }, 2);   // weave, never off a ledge
      note(e, S.plan === "assault" ? "assaulting (bounding)" : "advancing (bounding)");
      if (Math.random() < 0.4) callout(e, "Cover me!"); else if (Math.random() < 0.3) callout(e, "Moving up!");   // (v6.8: more often)
    }
  }
  return mv;
}
system.runInterval(() => { for (const id of [...drill.keys()]) if (!world.getEntity(id)) drill.delete(id); }, 1200);
const flinchT = new Map();
world.afterEvents.entityHurt.subscribe((ev) => {
  const v = ev.hurtEntity;
  if (v?.typeId !== SOLDIER || ev.damage < 1) return;
  try {
    if (!setting("drills", true)) return;
    const st = gunState.get(v.id), now = tick();
    if (!st || now - (flinchT.get(v.id) ?? -99) < 20) return;
    flinchT.set(v.id, now);
    st.next = Math.max(st.next, now + 5 + Math.floor(Math.random() * 6));   // hit: aim knocked off for a moment
    st.wild = Math.max(st.wild ?? 0, 1);                                     // and the next shot is rushed
  } catch {}
});

// ---- kneeling and prone (War Table -> Settings -> General). Only while still and fighting; up on his feet to move.
// A kneeling / prone soldier is a smaller, lower target (low walls and sandbags really cover him). He only goes
// down as low as he can still shoot from.
const poseOf = new Map();  // id -> 1 kneel, 2 prone
const poseSeen = new Map(); // id -> { x, z, t } where he last stood still from
function wantPose(e, now) {
  if (downed.has(e.id) || pows.has(e.id) || isRiding(e) || climbing.has(e.id) || inWater(e) || personal.has(e.id)) return 0;
  const d = sd(e);
  if (d.surr || d.div === "cavalier" || d.div === "medic" || !GUNS.includes(d.weapon) || !P(e, "war:gun")) return 0;
  const l = e.location, ps = poseSeen.get(e.id);
  if (!ps || Math.hypot(l.x - ps.x, l.z - ps.z) > 0.35) { poseSeen.set(e.id, { x: l.x, z: l.z, t: now }); return 0; }   // moving: on his feet
  const still = now - ps.t;
  const act = brain.get(e.id)?.act ?? "";
  if (["advance", "flank", "peek", "fallback", "terrain", "cover"].includes(act) && still < 40) return 0;
  const aiming = now - (gunState.get(e.id)?.seen ?? -999) < 40;
  const supp = suppB.get(e.id) ?? 0;
  if ((!aiming && supp < 6) || still < 15) return 0;
  const t = perc.get(e.id)?.threat;
  const tc = t?.isValid ? chest(t) : undefined;
  const from = (h) => ({ x: l.x, y: l.y + h, z: l.z });
  if (tc && dist(t.location, l) < 10) return clearShot(e.dimension, from(1.1), tc) ? 1 : 0;   // enemy close: ready to get up
  const low = !isIndoors(e) && ((["mg", "sniper"].includes(d.weapon) && still > 40) || supp > 16);
  if (low && (!tc || clearShot(e.dimension, from(0.5), tc))) return 1;   // v6.0: no more going prone (the gun model can't follow it: it pointed straight up)
  if (!tc || clearShot(e.dimension, from(1.1), tc)) return 1;
  return 0;
}
system.runInterval(() => {
  const on = !!setting("poses", true), now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const want = on ? wantPose(e, now) : 0;
      if ((poseOf.get(e.id) ?? 0) !== want) { if (want) poseOf.set(e.id, want); else poseOf.delete(e.id); setP(e, "war:pose", want); }
    } catch {}
  }
  if (now % 1200 < 10) for (const id of [...poseSeen.keys()]) if (!world.getEntity(id)) { poseSeen.delete(id); poseOf.delete(id); }
}, 10);

// ---- surrender when cut off (War Table -> Settings -> General): alone (no friend within 12 blocks) in a fight with
// 5+ enemies around, or 3+ while badly hurt. Hands up: nobody shoots him. An enemy player right-clicks to take him
// prisoner; a friendly player right-click frees him; if the enemy moves on, he rejoins his unit.
function isoSurrender(e, captor) {
  for (const k of [...provoked.keys()]) if (k.endsWith(`:${e.id}`)) provoked.delete(k);   // no longer a target for anyone
  personal.delete(e.id); travelTo.delete(e.id); drill.delete(e.id);
  surrender(e, captor);
  sdp(e, "war:surrIso", Date.now());
  radio(e, "one of ours was cut off and surrendered", true);
  updateName(e);
}
function isoRelease(e, d) {
  const since = Number(gdp(e, "war:surrIso") ?? 0);
  if (!since || Date.now() - since < 20000) return;                       // (flag-capture surrenders keep the old rules)
  for (const o of nearbyCombatants(e.dimension.id, e.location, 16)) {
    if (o.id === e.id || isMob(o) || VEHICLES.includes(o.typeId)) continue;
    if (o.typeId === SOLDIER && (downed.has(o.id) || pows.has(o.id))) continue;
    if (isHostile(d.faction, factionOf(o))) return;
  }
  sdp(e, "war:surrIso", undefined);
  resume(e);
}
system.runInterval(() => {
  const on = !!setting("isosurr", true), now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e);
      if (d.surr) { isoRelease(e, d); continue; }
      if (!on || !d.faction || downed.has(e.id) || pows.has(e.id) || isRiding(e) || d.div === "guard" || d.func === "escort") continue;
      if (!perc.get(e.id)?.threat && now - Number(gdp(e, "war:hurt") ?? -9999) > 200) continue;
      let friends = 0, foes = 0, nearest, nd = 1e9;
      for (const o of nearbyCombatants(e.dimension.id, e.location, 12)) {
        if (o.id === e.id || isMob(o) || VEHICLES.includes(o.typeId)) continue;
        if (o.typeId === SOLDIER && (downed.has(o.id) || pows.has(o.id))) continue;
        const of = factionOf(o);
        if (isFriendly(d.faction, of)) { friends++; break; }
        if (isHostile(d.faction, of)) { foes++; const dd = dist(o.location, e.location); if (dd < nd) { nd = dd; nearest = o; } }
      }
      if (friends || !nearest) continue;
      const hp = e.getComponent("minecraft:health"), hpr = hp ? hp.currentValue / hp.effectiveMax : 1;
      if (!(foes >= 5 || (foes >= 3 && hpr < 0.5) || (foes >= 2 && hpr < 0.25))) continue;
      if (Math.random() > 0.35 + (1 - boldOf(e))) continue;                  // not everyone gives up at the first look
      isoSurrender(e, factionOf(nearest));
    } catch {}
  }
}, 60);
world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  const e = ev.target, p = ev.player;
  if (e?.typeId !== SOLDIER || !gdp(e, "war:surrIso") || pows.has(e.id)) return;
  if ((ev.beforeItemStack ?? ev.itemStack)?.typeId === "war:unit_wand") return;
  system.run(() => {
    try {
      if (!e.isValid) return;
      const f = Number(P(e, "war:faction")), pf = playerFaction(p);
      if (isFriendly(pf, f)) { sdp(e, "war:surrIso", undefined); resume(e); p.onScreenDisplay.setActionBar("§aHe's back with us."); return; }
      sdp(e, "war:surr", 0); sdp(e, "war:surrIso", undefined);
      makePow(e, p); applyRelations(e);
      p.onScreenDisplay.setActionBar("§aTaken prisoner. He follows you at a distance.");
    } catch {}
  });
});

// ---- v6.4: trouble memory (the army learns the map). Every spot where a soldier got properly stuck (pressing into a
// wall, needing a rescue, trapped below his route, giving up a swim, a carried step that kept failing) is remembered
// in the world, per 2x2 cell, with a weight. Routes go round remembered trouble when there's another way, and fight
// moves don't pick those spots. It persists with the world, fades if a spot stops causing trouble, and is capped.
const TROUBLE = new Map(); // "dim|cx|cz" -> { n, t }
let troubleDirty = false;
const troubleKey = (dimId, x, z) => `${dimId}|${Math.floor(x) >> 1}|${Math.floor(z) >> 1}`;
function noteTrouble(dim, l, w = 1) {
  try {
    const k = troubleKey(dim.id ?? dim, l.x, l.z), r = TROUBLE.get(k) ?? { n: 0, t: 0 };
    r.n = Math.min(8, r.n + w); r.t = tick(); TROUBLE.set(k, r); troubleDirty = true;
    if (TROUBLE.size > 400) { let ok, ot = Infinity; for (const [kk, v] of TROUBLE) if (v.t < ot) { ot = v.t; ok = kk; } TROUBLE.delete(ok); }
  } catch {}
}
const troubleAt = (dimId, x, z) => TROUBLE.size ? (TROUBLE.get(troubleKey(dimId, x, z))?.n ?? 0) : 0;
system.runInterval(() => {
  const now = tick();
  if (now === 40 || (TROUBLE.size === 0 && now % 600 === 40)) {            // load once (after the world is up)
    try { const raw = world.getDynamicProperty("war:trouble"); if (typeof raw === "string" && !TROUBLE.size) for (const [k, n] of Object.entries(JSON.parse(raw))) TROUBLE.set(k, { n: Number(n) || 0, t: now }); } catch {}
  }
  if (now % 6000 === 0) for (const [k, v] of [...TROUBLE]) if (now - v.t > 6000) { v.n -= 1; v.t = now; troubleDirty = true; if (v.n <= 0) TROUBLE.delete(k); }   // fades: -1 every 5 min untouched
  if (troubleDirty && now % 600 === 0) {
    troubleDirty = false;
    try { const o = {}; for (const [k, v] of TROUBLE) o[k] = v.n; world.setDynamicProperty("war:trouble", JSON.stringify(o)); } catch {}
  }
}, 20);
// ---- v6.1: is the ground a step ahead (in the direction dx, dz) safe? No drop of 2+ blocks, no lava / fire / magma
const DANGER = new Map(); // cell -> { v, t }: a drop of 2+ or a hazard right next to this cell
function hazardCell(dim, x, y, z) {
  try {
    const f = tBlock(dim, x, y, z), u = tBlock(dim, x, y - 1, z);
    return (!!f && (TI(f.typeId).hazard || f.typeId.includes("lava"))) || (!!u && (TI(u.typeId).hazard || u.typeId.includes("lava")));
  } catch { return false; }
}
function dropOrHazard(dim, x, fy, z) {
  if (hazardCell(dim, x, fy, z)) return true;
  try {
    const f = tBlock(dim, x, fy, z);
    if (!f || !(f.isAir || passable(f))) return false;                // a wall / a step up: not a drop
    for (const k of [1, 2]) { const b = tBlock(dim, x, fy - k, z); if (!b || !(b.isAir || passable(b)) || isClimb(b) || b.typeId.includes("water")) return false; if (b.typeId.includes("lava")) return true; }
    return true;
  } catch { return false; }
}
function dangerNear(dim, l) {
  const x = Math.floor(l.x), y = Math.floor(l.y + 0.01), z = Math.floor(l.z), k = bkey(dim.id, x, y, z), now = tick();
  const c = DANGER.get(k);
  if (c && now - c.t < 600) return c.v;
  let v = false;
  for (let dx = -1; dx <= 1 && !v; dx++) for (let dz = -1; dz <= 1 && !v; dz++) if ((dx || dz) && dropOrHazard(dim, x + dx + 0.5, y, z + dz + 0.5)) v = true;
  DANGER.set(k, { v, t: now });
  if (DANGER.size > 20000) DANGER.clear();
  return v;
}
function safeAhead(e, dx, dz) {
  const l = e.location;
  if (!dangerNear(e.dimension, l)) return true;
  const L = Math.hypot(dx, dz) || 1, fy = Math.floor(l.y + 0.01);
  for (const r of [0.6, 1.2]) if (dropOrHazard(e.dimension, l.x + (dx / L) * r, fy, l.z + (dz / L) * r)) return false;
  return true;
}
// v6.1: the same edge guard for everyone else standing by a drop or lava (fighting on a wall-top, by a lava moat):
// any momentum toward the edge is cancelled. Only soldiers whose cell is next to danger are checked (remembered per cell).
system.runInterval(() => {
  for (const e of allOf(SOLDIER)) {
    try {
      if (stepping.has(e.id) || climbing.has(e.id) || (gliders.has(e.id) && !gliders.get(e.id).paused) || downed.has(e.id) || isRiding(e) || staggered(e.id)) continue;   // (v6.3: knocked: his momentum is his)
      if (!dangerNear(e.dimension, e.location)) continue;
      // v6.2: on a bridge / ledge / wall-top edge, walking by himself: stop him now and put him on his route (carried)
      if (!gliders.has(e.id) && getJSON(e, "war:st", {}).g === "g_wp") {
        setGroups(e, { g: "g_none" });
        try { e.clearVelocity(); } catch {}
        const r = routeOf(e);
        if (r?.pts && !r.pts.guess && r.idx < r.pts.length - 1) gliders.set(e.id, { pts: r.pts, k: glideStart(r.pts, r.idx, e.location), t: tick(), paused: false, wait: 0 });
        continue;
      }
      const v = e.getVelocity();
      if (Math.hypot(v.x, v.z) < 0.02) continue;
      const l = e.location, fy = Math.floor(l.y + 0.01);
      let cx = 0, cz = 0;
      if (Math.abs(v.x) > 0.02 && dropOrHazard(e.dimension, l.x + Math.sign(v.x) * 0.45 + v.x * 2, fy, l.z)) cx = -v.x;
      if (Math.abs(v.z) > 0.02 && dropOrHazard(e.dimension, l.x, fy, l.z + Math.sign(v.z) * 0.45 + v.z * 2)) cz = -v.z;
      if (cx || cz) { e.applyImpulse({ x: cx, y: 0, z: cz }); note(e, "stopped at the edge"); }
    } catch {}
  }
}, 2);
// ---- edge guard: a soldier on a planned route who is sliding toward a drop of 3+ blocks that his route doesn't take
// (momentum from a push, a hop, a shove) is stopped at the edge. Drops the route really takes are left alone.
system.runInterval(() => {
  for (const id of stepping) {
    const e = world.getEntity(id);
    try {
      if (!e?.isValid) { stepping.delete(id); continue; }
      if (climbing.has(e.id) || gliders.has(e.id) || downed.has(e.id) || isRiding(e) || staggered(e.id)) continue;   // (v5.9: only men the route driver steps; v6.3: not while knocked)
      const r = routeOf(e);
      if (!r) continue;
      const v = e.getVelocity(), sp = Math.hypot(v.x, v.z);
      if (sp < 0.03) continue;
      const l = e.location, fy = Math.floor(l.y + 0.01);
      const pts = r.pts, i = r.idx;
      // a drop: nothing at his feet there (not a step up) and open air 3 deep below it
      const dropAt = (x, z) => {
        if (Math.floor(x) === Math.floor(l.x) && Math.floor(z) === Math.floor(l.z)) return false;
        const f = tBlock(e.dimension, x, fy, z);
        if (!f || !(f.isAir || passable(f))) return false;
        return [1, 2, 3].every((k) => { const b = tBlock(e.dimension, x, fy - k, z); return !!b && (b.isAir || passable(b)) && !isClimb(b) && !b.typeId.includes("water"); });
      };
      const intended = (x, z) => { for (let k = Math.max(0, i - 1); k < Math.min(pts.length, i + 5); k++) if (pts[k].y <= fy - 2 && Math.hypot(pts[k].x - x, pts[k].z - z) < 2.5) return true; return false; };
      // only the part of his momentum that points at the drop is cancelled; he keeps moving along the edge
      let cx = 0, cz = 0;
      if (Math.abs(v.x) > 0.02) { const x = l.x + Math.sign(v.x) * 0.45 + v.x * 2; if (dropAt(x, l.z) && !intended(x, l.z)) cx = -v.x; }
      if (Math.abs(v.z) > 0.02) { const z = l.z + Math.sign(v.z) * 0.45 + v.z * 2; if (dropAt(l.x, z) && !intended(l.x, z)) cz = -v.z; }
      if (cx || cz) { e.applyImpulse({ x: cx, y: 0, z: cz }); note(e, "stopped at the edge"); }
    } catch {}
  }
}, 1);

// ================================================================ v6.3: knocked over the edge, wary of edges
// v6.2's edge safety (the edge guards, men held still on a bridge, the glider) cancelled every bit of momentum by a drop
// or lava, so nobody could ever be knocked in. Now a hit from an enemy player, an enemy soldier or hound, a mob or an
// explosion staggers him for ~0.7 s: nothing touches his momentum and the knockback plays out (over the edge, if that's
// where it sends him). His own moves stay safe. No friendly fire, and gun bullets don't count (a wall of riflemen would
// empty itself).
const stagger = new Map(); // soldier id -> tick the stagger ends
const staggered = (id) => (stagger.get(id) ?? 0) > tick();
function friendlySource(v, src) {
  const df = Number(P(v, "war:faction") ?? 0);
  if (src.typeId === "minecraft:player") { const f = playerFaction(src); return !!f && (f === df || !isHostile(df, f)); }
  if (src.typeId === SOLDIER || src.typeId === HOUND) { const f = Number(P(src, "war:faction") ?? 0); return f === df || !isHostile(df, f); }
  return false;                                                  // mobs (and anything else) are never friendly
}
function knocksOver(v, src, cause) {
  if (cause === "entityExplosion" || cause === "blockExplosion") return !src?.isValid || !friendlySource(v, src);
  if (!src?.isValid || friendlySource(v, src)) return false;
  if (cause === "projectile") return isMob(src);                // a skeleton's arrow: yes. Bullets from soldiers / players: no
  return cause === "entityAttack";
}
world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const v = ev.hurtEntity;
    if (v?.typeId !== SOLDIER || held.has(v.id)) return;
    const s0 = ev.damageSource;
    if (knocksOver(v, s0?.damagingEntity, String(s0?.cause ?? ""))) { stagger.set(v.id, tick() + 14); gliders.delete(v.id); }
  } catch {}
});
// wary of the edge: a soldier standing by a drop or lava with an enemy who could knock him over close by (a player, a
// melee soldier, a hound, a mob, within 5 blocks) steps onto the nearest safe cell, away from him. Men on a post step back
// at most 2 blocks (they don't abandon a wall-top). On a narrow wall or a 1-wide bridge there may be nowhere safe: then he stays.
const edgeFearT = new Map(); // soldier id -> next check
const POST_FUNCS = ["hold", "post", "sentry", "stand"];
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      if (now < (edgeFearT.get(e.id) ?? 0) || downed.has(e.id) || pows.has(e.id) || climbing.has(e.id) || isRiding(e) || staggered(e.id)) continue;
      const l = e.location, dim = e.dimension;
      if (!dangerNear(dim, l)) continue;
      const df = Number(P(e, "war:faction") ?? 0);
      let foe;
      for (const c of nearSnap(dim.id, l, 5)) {
        if (c.id === e.id || c.down) continue;
        const threat = c.type === "minecraft:player" || c.type === HOUND ? isHostile(df, c.f)
          : c.type === SOLDIER ? isHostile(df, c.f) && !GUNS.includes(String(gdp(c.e, "war:weapon") ?? ""))
          : isMob(c.e);
        if (threat && (!foe || c.dd < foe.dd)) foe = c;
      }
      if (!foe) continue;
      edgeFearT.set(e.id, now + 40);
      const R = POST_FUNCS.includes(sd(e).func) ? 2 : 4;
      const bx = Math.floor(l.x), by = Math.floor(l.y + 0.01), bz = Math.floor(l.z);
      let best, bs = -1e9;
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
        if (!dx && !dz) continue;
        for (const dy of [0, 1, -1]) {
          const q = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 };
          if (!standAt(dim, bx + dx, by + dy, bz + dz, now) || dangerNear(dim, q) || claimedByOther(q, e.id, now)) continue;
          const sc = Math.hypot(q.x - foe.x, q.z - foe.z) - Math.hypot(dx, dz) * 1.5;   // away from him, but not far
          if (sc > bs) { bs = sc; best = q; }
          break;
        }
      }
      if (!best) continue;
      claimSpot(e, best, now);
      planPersonalTo(e, "settle", best, now);
      note(e, "backing away from the edge");
      edgeFearT.set(e.id, now + 60);
    } catch {}
  }
}, 10);

// ================================================================ v6.3: the TP wand
// Hit one of your own soldiers with it: he's picked up (no harm done), hidden, and carried with you; up to 10. While
// carried he can't be hurt, doesn't shoot, think or move, and nobody sees him. Right-click: they're all put down around
// your feet (each on his own safe cell) and carry on with what they were doing; a man on a post takes the new spot as his post.
const TP_WAND = "war:tp_wand", TP_MAX = 10;
const holding = new Map(); // player id -> [soldier ids]
function pickUp(p, e) {
  if (!e?.isValid || e.typeId !== SOLDIER || held.has(e.id)) return;
  const pf = playerFaction(p);
  if (!pf || Number(P(e, "war:faction") ?? 0) !== pf) { p.onScreenDisplay.setActionBar("§cThe TP wand only picks up your own faction's soldiers."); return; }
  if (isRiding(e)) { p.onScreenDisplay.setActionBar("§cHe has to get off first."); return; }
  const list = holding.get(p.id) ?? [];
  if (list.length >= TP_MAX) { p.onScreenDisplay.setActionBar(`§eYou're carrying ${TP_MAX} already. Right-click to put them down.`); return; }
  list.push(e.id); holding.set(p.id, list);
  held.set(e.id, { by: p.id });
  allOfCache.delete(SOLDIER);
  gliders.delete(e.id); personal.delete(e.id); travelTo.delete(e.id); climbing.delete(e.id); combatLock.delete(e.id);
  stepping.delete(e.id); driveOn.delete(e.id); formMode.delete(e.id); stagger.delete(e.id);
  try { e.triggerEvent("war:held_on"); } catch {}
  try { setP(e, "war:held", true); setP(e, "war:aiming", false); setP(e, "war:firing", false); } catch {}
  try { setGroups(e, { g: "g_none", t: "t_off" }); } catch {}
  try { e.nameTag = ""; } catch {}
  sdp(e, "war:held", 1);                                         // (remembered: after a reload he's put down where he is)
  try { e.teleport(p.location, { dimension: p.dimension }); } catch {}
  p.onScreenDisplay.setActionBar(`§aPicked up (${list.length}/${TP_MAX}). Right-click with the wand to put them down.`);
}
// a free safe cell around the player for each man (never stacked, never by a drop or lava)
function dropCell(p, placed, now) {
  const dim = p.dimension, l = p.location, bx = Math.floor(l.x), by = Math.floor(l.y + 0.01), bz = Math.floor(l.z);
  for (const r of [1, 2, 3, 4, 0]) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    for (const dy of [0, 1, -1]) {
      const q = { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 };
      if (!standAt(dim, bx + dx, by + dy, bz + dz, now) || !glideFree(dim, q.x, q.y, q.z) || dangerNear(dim, q)) continue;
      if (placed.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 1.2 && Math.abs(o.y - q.y) < 1.5)) continue;
      if (nearSnap(dim.id, q, 1.0).some((c) => c.type === SOLDIER && Math.abs(c.y - q.y) < 1.5)) continue;
      return q;
    }
  }
  return undefined;
}
function letGo(e, now) {
  held.delete(e.id); allOfCache.delete(SOLDIER);
  try { e.triggerEvent("war:held_off"); e.triggerEvent(P(e, "war:cav") ? "war:body_cav" : "war:body_foot"); } catch {}
  try { setP(e, "war:held", false); } catch {}
  sdp(e, "war:held", undefined);
  rescueMark.delete(e.id); pressing.delete(e.id); remoteMemo.delete(e.id); remoteSettled.delete(e.id); rTrack.delete(e.id);
  if (downed.has(e.id)) { downPos.set(e.id, { ...e.location }); updateName(e); return; }
  const d = sd(e);
  if (POST_FUNCS.includes(d.func) || d.func === "patrol") { freshMind(e); giveFunction(e, d.func, undefined, makeWaypoint(e.dimension, e.location, false)); }
  else { setJSON(e, "war:st", {}); try { think(e); } catch {} }   // a march / charge / follow just carries on from here
  updateName(e);
  note(e, "put down");
}
function releaseAll(pid, p) {
  const list = holding.get(pid) ?? [];
  holding.delete(pid);
  const now = tick(), placed = [];
  let n = 0;
  for (const id of list) {
    const e = world.getEntity(id);
    if (!e?.isValid) { held.delete(id); continue; }
    if (p?.isValid) {
      const to = dropCell(p, placed, now);
      try { e.teleport(to ?? p.location, { dimension: p.dimension }); } catch {}
      if (to) placed.push(to);
    }
    try { e.clearVelocity?.(); } catch {}
    letGo(e, now);
    n++;
  }
  return n;
}
function putDown(p) {
  const n = releaseAll(p.id, p);
  p.onScreenDisplay.setActionBar(n ? `§aPut down ${n}.` : "§7Hit one of your soldiers with the TP wand to pick him up.");
}
// carried: they stay right with you (hidden, tiny, untouchable). If you leave or the game reloads, they're put down
// where they are.
system.runInterval(() => {
  for (const [pid, list] of [...holding]) {
    const p = world.getEntity(pid);
    if (!p?.isValid) { releaseAll(pid, undefined); continue; }
    const l = p.location;
    for (const id of list) {
      const e = world.getEntity(id);
      if (!e?.isValid) continue;
      try { if (e.dimension.id !== p.dimension.id || Math.abs(e.location.x - l.x) + Math.abs(e.location.y - l.y) + Math.abs(e.location.z - l.z) > 0.05) e.teleport({ x: l.x, y: l.y, z: l.z }, { dimension: p.dimension }); e.clearVelocity?.(); } catch {}
    }
  }
}, 1);
world.afterEvents.entityDie.subscribe((ev) => { try { const d = ev.deadEntity; if (d?.typeId === "minecraft:player" && holding.has(d.id)) releaseAll(d.id, d); } catch {} });
world.beforeEvents.playerLeave?.subscribe((ev) => { try { const pid = ev.player.id; system.run(() => releaseAll(pid, undefined)); } catch {} });
// after a reload (nobody is carrying him any more): put down where he is
system.runInterval(() => {
  for (const d of DIMS) {
    let list = [];
    try { list = world.getDimension(d).getEntities({ type: SOLDIER }); } catch {}
    for (const e of list) { try { if (!held.has(e.id) && gdp(e, "war:held")) letGo(e, tick()); } catch {} }
  }
}, 100);

// ================================================================ v5.4: fighting where it counts, spreading out, no piles
// ---- how far each gun is worth firing. Attackers close in to this before they shoot (no plinking at a building from
// 150 blocks); defenders on a position open up a bit earlier, and anyone shot at shoots back from further.
let HEAD_K = 0.75;   // a head-only target is taken out to this share of the gun's range (self-play tuned below)
const EFFECTIVE = { rifle: 70, semi: 60, smg: 35, mg: 75, shotgun: 16, at: 60, pistol: 25, sniper: 220 };
function engageRange(e, d, t, now) {
  const spec = GUN_SPEC[d.weapon];
  if (!spec) return 0;
  if (d.div === "grenadier" && gdp(e, "war:throw")) return THROW_RANGE;   // (v6.9.1: a thrower closes to throwing range and stops there)
  let r = EFFECTIVE[d.weapon] ?? 40;
  if (["hold", "post", "sentry", "stand"].includes(d.func)) r *= 1.4;
  const fa = firedAt.get(e.id);
  if (t && (attackedRecently(e, t, now, 80) || (fa && fa.by === t.id && now - fa.t < 80))) r *= 1.15;
  return Math.min(spec.fire, r);
}
// the shot this gunner would really take at t right now: in range, and only a head (in a window, over a wall) from close
// enough to have a fair chance of hitting it. undefined = no shot: he closes in or moves for a better one.
function shotAt(e, d, t, now) {
  if (!t?.isValid) return undefined;
  const aim = aimAt(e, t);
  if (!aim) return undefined;
  const dd = dist(t.location, e.location), r = ridingNest(e) ? 140 : engageRange(e, d, t, now);
  if (dd > r) return undefined;
  const fa = firedAt.get(e.id);
  const returning = attackedRecently(e, t, now, 80) || (fa && fa.by === t.id && now - fa.t < 80);   // (v6.2: he's shooting at us: return fire at whatever shows)
  if (aim.y > chest(t).y + 0.1 && dd > r * (bwOf(d.faction).headK ?? HEAD_K) && d.weapon !== "sniper" && !returning) return undefined;
  return aim;
}
// ---- suppression only where it makes sense: an enemy seen in the last 3 s, within range, and a clear line to the
// spot he was at (the window or doorway he ducked behind). Never at a remembered position behind a wall.
function suppressPoint(e, d, S, now) {
  if (!GUN_SPEC[d.weapon] || !S) return undefined;
  const h = headLoc(e);
  let best, bd = 1e9;
  for (const q of S.known.values()) {
    if (now - q.t > 30) continue;
    const dd = Math.hypot(q.x - h.x, q.z - h.z);
    if (dd >= bd || dd > engageRange(e, d, q.ent, now)) continue;
    let p = { x: q.x, y: q.y + 1.2, z: q.z };
    if (!clearShot(e.dimension, h, p)) { p = { x: q.x, y: q.y + 1.6, z: q.z }; if (!clearShot(e.dimension, h, p)) continue; }   // the window he's in
    bd = dd; best = { ...q, aim: p };
  }
  return best;
}
// ---- spots squad mates have picked (so two never pick the same one)
const spotClaims = new Map(); // soldier id -> { x, y, z, t }
function claimedByOther(p, id, now) {
  for (const [cid, c] of spotClaims) {
    if (now - c.t > 200) { spotClaims.delete(cid); continue; }
    if (cid !== id && Math.hypot(c.x - p.x, c.z - p.z) < 1.6 && Math.abs(c.y - p.y) < 1.5) return true;
  }
  return false;
}
const claimSpot = (e, p, now) => spotClaims.set(e.id, { x: p.x, y: p.y, z: p.z, t: now });
// right on a stair, ladder or doorway: a bad place to stop (everyone behind needs it)
function onWayThrough(dim, p) {
  try {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [-1, 0]) {
      const b = tBlock(dim, p.x + dx, p.y + dy, p.z + dz);
      if (b && (b.typeId.includes("stairs") || isClimb(b) || (b.typeId.includes("door") && !b.typeId.includes("trapdoor")))) return true;
    }
  } catch {}
  return false;
}
// a free spot near `center` on its level, reachable on foot from where he is, not taken, not in a doorway or on the
// stairs; `good(w)` adds a preference (e.g. a line of sight to the enemy). Bounded work: a few rays at most.
function freeSpot(e, center, rMin, rMax, good, now, anchor, leash) {
  let best, bs = -1e9, rays = 0;
  for (let r = rMin; r <= rMax + 0.01; r += 1.5) for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + r * 0.7;
    const w = walkableNear(e.dimension, center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, center.y);
    if (!w || Math.abs(w.y - center.y) > 0.6) continue;
    if (anchor && flat(w, anchor.location) > leash) continue;
    if (claimedByOther(w, e.id, now) || onWayThrough(e.dimension, w)) continue;
    if (nearbyCombatants(e.dimension.id, w, 1.3).some((o) => o.typeId === SOLDIER && o.id !== e.id)) continue;
    let sc = -r * 0.3;
    if (good && rays < 8) { rays++; if (good(w)) sc += 3; }
    if (sc <= bs || !localReach(e.dimension, e.location, w)) continue;
    bs = sc; best = w;
  }
  return best;
}
// ---- at the end of the way up (or down) to the enemy: step off the stairs into the room, each to his own spot
function spreadOut(e, now, at) {
  const B = brain.get(e.id) ?? { act: "", decT: -999 }; brain.set(e.id, B);
  const S = squads.get(squadKey(e, sd(e))), n = S ? nearestKnownB(S, e) : undefined;
  const good = n ? (w) => clearShot(e.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, { x: n.q.x, y: n.q.y + 1.2, z: n.q.z }) : undefined;
  const spot = freeSpot(e, at, 2, 7, good, now);
  if (!spot) return;
  claimSpot(e, spot, now);
  B.spread = { spot, until: now + 120 };
  note(e, "spreading out");
}
// ---- nobody stands on top of a squad mate: the one who isn't first steps to a free spot close by
const crowdT = new Map();
function unCrowd(e, d, now, anchor, leash) {
  if ((crowdT.get(e.id) ?? 0) > now || isRiding(e) || personal.has(e.id)) return undefined;
  const f = d.faction;
  const mates = nearbyCombatants(e.dimension.id, e.location, 1.2).filter((o) => o.typeId === SOLDIER && o.id !== e.id && !downed.has(o.id) && Math.abs(o.location.y - e.location.y) < 1 && Number(P(o, "war:faction") ?? 0) === f);
  if (!mates.length || !mates.some((o) => o.id < e.id)) return undefined;
  crowdT.set(e.id, now + 40);
  const t = perc.get(e.id)?.threat;
  const good = t?.isValid ? (w) => clearShot(e.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, chest(t)) : undefined;
  const spot0 = freeSpot(e, e.location, 1.5, 4.5, good, now, anchor, leash);
  const spot = spot0 ? safeSpot(e, spot0, now) : undefined;
  if (!spot || onPassage(e) || !straightReach(e.dimension, e.location, spot)) return undefined;   // (v6.2: making room never means stepping toward an edge)
  claimSpot(e, spot, now);
  const B = brain.get(e.id) ?? { act: "", decT: -999 }; brain.set(e.id, B);
  B.spread = { spot, until: now + 60 };
  note(e, "making room");
  const slot = myMarker(e, spot);
  return slot ? { g: "g_wp", slot, t: "t_mid", urgent: false } : undefined;
}
// the brain's spot to spread to, while it lasts
function spreadMove(e, now) {
  const B = brain.get(e.id), sp = B?.spread;
  if (!sp) return undefined;
  if (now > sp.until || flat(sp.spot, e.location) < 0.8) { B.spread = undefined; return undefined; }
  claimSpot(e, sp.spot, now);
  if (isIndoors(e) || onStairs(e.dimension, e.location) || onPassage(e) || !straightReach(e.dimension, e.location, sp.spot)) return travel(e, sp.spot, "spot", now, false);   // v5.5: walked there by the glider (v6.2: or anywhere not a plain safe walk)
  const slot = myMarker(e, sp.spot);
  if (flat(sp.spot, e.location) < 3.2) push(e, { x: (sp.spot.x - e.location.x) * 0.15, y: 0.02, z: (sp.spot.z - e.location.z) * 0.15 }, 2);   // the last steps (followers stop short of the marker)
  return slot ? { g: "g_wp", slot, t: "t_mid", urgent: false } : undefined;
}
system.runInterval(() => { const now = tick(); for (const [id, c] of [...spotClaims]) if (now - c.t > 200) spotClaims.delete(id); for (const [id, t] of [...crowdT]) if (t < now) crowdT.delete(id); }, 200);
// the brain's move, then (if he's standing still in a pile) making room
function combatMove(e, d, now, melee, anchor, leash) {
  const mv = drillMove(e, d, now, melee, anchor, leash);
  if (mv && mv.g !== "g_none") return mv;
  const anchored = ["hold", "post", "sentry", "stand"].includes(d.func);
  if (!mv && !anchored) return mv;                                // marching on: spacing is the formation's job
  if (!squads.get(squadKey(e, d))?.known?.size) return mv;        // no fight: each has his own spot already
  return unCrowd(e, d, now, anchor, leash) ?? mv;
}

// ================================================================ v5.5: the glider
// Through stairs, doorways, ladders' surroundings, drops and indoor rooms a soldier is moved by the script itself along
// his planned route, a little every tick (like the ladder climber), facing where he walks. Up a step he rises a third of
// the way across, down a step he drops past the middle, doors and trapdoors are opened as he reaches them. Nothing here
// depends on Minecraft's pathing or on pushes, so he can't get lost, stuck on a stair edge, or pile into the man ahead.
const gliders = new Map(); // id -> { pts, k (index of the point he's heading to), t (last refresh), paused, wait }
const GLIDE_SPEED = 0.17;  // blocks per tick (~3.4 blocks/s, a brisk walk)
const glideBan = new Map(); // id -> tick until which the glider leaves him alone (it was blocked)
// a cell he can be carried into: open (or a stair / slab / open-able door / ladder / water) at feet and head
function cellOpen(b) {
  if (!b) return false;
  if (b.isAir || b.isLiquid) return true;
  const t = TI(b.typeId);
  return t.pass || t.climb || t.stairs || t.openableId || t.plate;
}
function glideFree(dim, x, y, z) {
  try {
    const fy = Math.floor(y + 0.01);
    return cellOpen(tBlock(dim, x, fy, z)) && cellOpen(tBlock(dim, x, fy + 1, z));
  } catch { return true; }
}
function floorUnder(dim, x, y, z) {
  try {
    const fy = Math.floor(y + 0.01), here = tBlock(dim, x, fy, z), under = tBlock(dim, x, fy - 1, z);
    if (here && !here.isAir && (TI(here.typeId).stairs || TI(here.typeId).climb)) return true;   // on a stair / slab / ladder
    return !!under && !under.isAir && (!passable(under) || TI(under.typeId).climb || TI(under.typeId).stairs) || !!under?.isLiquid;
  } catch { return true; }
}
function glideStart(pts, i, loc) {
  let k = Math.min(pts.length - 1, i + 1);
  // not at his point yet: that one first. v6.3: unless he's already past it toward the next one (then going back to it
  // first carried him half a block backwards, his own walking took him forward again, and round it went: stuck in a gap)
  const past = k !== i && i < pts.length && ((loc.x - pts[i].x) * (pts[k].x - pts[i].x) + (loc.z - pts[i].z) * (pts[k].z - pts[i].z)) > 0 && Math.abs(pts[k].y - pts[i].y) < 0.5 && Math.abs(loc.y - pts[i].y) < 0.6;
  if (!past && i < pts.length && Math.hypot(pts[i].x - loc.x, pts[i].z - loc.z) > 0.3 && r3(pts[i], loc) < r3(pts[k], loc)) k = i;
  return k;
}
system.runInterval(() => {
  const now = tick();
  for (const [id, g] of [...gliders]) {
    if (now - g.t > 8) { gliders.delete(id); continue; }          // the driver stopped refreshing him: back to normal walking
    if (staggered(id)) continue;                                  // (v6.3: knocked: not carried, not held still, until he's found his feet)
    if (g.paused) { try { const pe = world.getEntity(id); if (pe?.isValid && dangerNear(pe.dimension, pe.location)) pe.clearVelocity(); } catch {} continue; }   // (v6.2: waiting his turn on a bridge: no knockback off it)
    const e = world.getEntity(id);
    if (!e?.isValid || climbing.has(id) || downed.has(id) || isRiding(e)) { gliders.delete(id); continue; }
    try {
      const pts = g.pts;
      if (g.k >= pts.length) { gliders.delete(id); continue; }
      const b = pts[g.k], a = pts[Math.max(0, g.k - 1)];
      const p = e.location;
      const dx = b.x - p.x, dz = b.z - p.z, L = Math.hypot(dx, dz);
      if (b.climb && L < 0.35) { beginClimb(e, pts, g.k); gliders.delete(id); continue; }   // at the ladder: the climber takes him (v5.7: walked right up to it first)
      if (L < 2.5) { openAt(e.dimension, b); openAt(e.dimension, { x: b.x, y: b.y + 1, z: b.z }); }
      const stp = Math.min(GLIDE_SPEED, L);
      const nx = L > 0.001 ? p.x + (dx / L) * stp : b.x, nz = L > 0.001 ? p.z + (dz / L) * stp : b.z;
      const seg = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const f = 1 - Math.hypot(b.x - nx, b.z - nz) / seg;
      let y = b.climb ? p.y : b.y > a.y ? (f >= 0.3 ? b.y : a.y) : b.y < a.y ? (f >= 0.6 ? b.y : a.y) : b.y;   // (to a ladder: on his own level)
      // v6.4: swimming: carried at the surface (in the top water block), not along the bottom; and out onto a bank up to
      // a block above the water (from the bottom, the bank looked like a wall: "below his route", stuck in the stream)
      let surf;
      if (b.w || a.w || inWater(e)) {
        surf = waterSurface(e.dimension, b.w ? b : p);
        if (b.w) y = Math.max(y, surf - 1);
      }
      if (y > p.y + 1.1 && !(surf !== undefined && inWater(e) && y <= surf + 1.2)) {   // v6.0: he's below his route (fell off it): never lifted up to it
        g.blocked = (g.blocked ?? 0) + 1;
        if (g.blocked > 10) {                                      // v6.2: a short route of his own back up onto it (out of a trench, off a ledge below)
          gliders.delete(id); personal.delete(id); travelTo.delete(id);
          const bt = belowRoute.get(id); belowRoute.set(id, { n: bt && now - bt.t < 300 ? bt.n + 1 : 1, t: now });   // (again and again: no way up: the rescue lifts him out)
          const tgt = pts[Math.min(pts.length - 1, g.k + 3)];
          if (tgt) planPersonalTo(e, "settle", { x: tgt.x, y: tgt.y, z: tgt.z }, now); else glideBan.set(id, now + 60);
        }
        continue;
      }
      if (!glideFree(e.dimension, nx, y, nz)) {                    // v6.0: up a full step as he reaches it, down only once he's over the drop
        for (const yy of [b.y, a.y, p.y]) if (yy !== y && yy <= p.y + 1.1 && glideFree(e.dimension, nx, yy, nz)) { y = yy; break; }   // (never lifted more than a step)
      }
      const nb = pts[Math.min(pts.length - 1, g.k + 1)];
      // v5.9: never into a wall. The step must be open at his feet and head (corners cut between two route points,
      // a door shut behind someone, a block placed since the route was planned): slide along the wall if one axis is
      // free; blocked for a moment: off the glider, and a personal route is worked out again from where he stands.
      // v6.0: and never out over thin air (a diagonal across the corner of a trench or a gap beside a bridge): the step
      // must have ground under it, unless the route itself drops there (or swims)
      const dropOk = b.y < a.y - 0.5 || b.w || a.w;
      const ok = (x, z) => glideFree(e.dimension, x, y, z) && (dropOk || floorUnder(e.dimension, x, y, z));
      let tx = nx, tz = nz;
      if (!ok(tx, tz)) {
        if (ok(nx, p.z)) tz = p.z;
        else if (ok(p.x, nz)) tx = p.x;
        else if (L <= 1.6 && b.y <= p.y + 1.1 && glideFree(e.dimension, b.x, b.y, b.z) && floorUnder(e.dimension, b.x, b.y, b.z)) {   // right by the point: one step onto it
          e.teleport({ x: b.x, y: b.y, z: b.z }, { facingLocation: { x: nb.x, y: b.y + 1.5, z: nb.z } });
          g.k++; g.blocked = 0; continue;
        } else {
          g.blocked = (g.blocked ?? 0) + 1;
          if (g.blocked > 10) {
            gliders.delete(id); glideBan.set(id, now + 60); personal.delete(id); travelTo.delete(id);   // (the brain / settle work out a new way)
            // v6.2: on a bridge / ledge he can't just be left there: a fresh short route from exactly where he stands
            if (dangerNear(e.dimension, e.location)) { const tgt = pts[Math.min(pts.length - 1, g.k + 3)]; if (tgt) { glideBan.delete(id); planPersonalTo(e, "settle", { x: tgt.x, y: tgt.y, z: tgt.z }, now); } }
          }
          continue;
        }
      }
      g.blocked = 0;
      const gt = gunState.get(id)?.target;                          // (v7.0: a target in sight: he faces him as he goes, and can fire)
      const look = gt?.isValid && dist(gt.location, e.location) < 40 ? { x: gt.location.x, y: gt.location.y + 1.4, z: gt.location.z } : { x: nb.x, y: y + 1.5, z: nb.z };
      e.teleport({ x: tx, y, z: tz }, { facingLocation: look });
      if (Math.hypot(b.x - tx, b.z - tz) < 0.05) g.k++;
    } catch (err) { gliders.delete(id); oops("glider", err); }
  }
}, 1);

// ================================================================ v5.6: tactical positions
// The way a good squad leader reads ground: every candidate spot around a soldier is scored for cover from the enemies
// the squad knows about (their eyes can't see his chest there), a shot at one of them within his gun's range, ground
// gained toward the objective, a little height, and against crowding a mate, standing in a doorway or on the stairs,
// or a long walk. Cheap terms first; line-of-sight rays only for the few most promising spots (bounded per call and per
// tick), and the spot must be reachable on foot. Used to bound forward from cover to cover, to take cover that can still
// fire back, to peek, and to pick firing positions when holding.
const TW = { cover: 2.0, shot: 2.0, prog: 1.6, height: 0.2, crowd: 1.6, dist: 0.06 };
let tacBudget = 0;
system.runInterval(() => { tacBudget = 3; }, 1);
function tacSpot(e, d, S, o, now) {
  if ((tacBudget <= 0 && !o.force) || !S?.known?.size) return undefined;
  tacBudget--;
  const here = e.location, dim = e.dimension;
  const known = [...S.known.values()].filter((q) => now - q.t < 300 && q.ent?.isValid && !downed.has(q.ent.id))
    .sort((a, b) => flat(a, here) - flat(b, here)).slice(0, 2);
  if (!known.length) return undefined;
  const range = engageRange(e, d, undefined, now) || 40, f = d.faction;
  const center = o.center ?? here;
  const cands = [{ x: here.x, y: Math.floor(here.y + 0.01), z: here.z, r: 0 }];
  for (let r = o.rMin; r <= o.rMax + 0.01; r += 2) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + r * 0.9;
    const w = walkableNear(dim, center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, here.y);
    if (!w || Math.abs(w.y - here.y) > 1.5) continue;
    if (o.anchor && flat(w, o.anchor.location) > o.leash) continue;
    cands.push({ ...w, r: flat(w, here) });
  }
  const mates = nearbyCombatants(dim.id, center, o.rMax + 5).filter((m) => m.typeId === SOLDIER && m.id !== e.id && !downed.has(m.id) && Number(P(m, "war:faction") ?? 0) === f);
  const scored = [];
  for (const c of cands) {
    if (c.r > 0 && claimedByOther(c, e.id, now)) continue;
    let s = -TW.dist * c.r + TW.height * Math.max(-2, Math.min(3, c.y - here.y));
    if (o.toward) {
      const g = flat(here, o.toward) - flat(c, o.toward);
      s += TW.prog * (o.wProg ?? 1) * Math.max(-1, Math.min(1, g / 6));
      if (c.r > 0 && g < 1.5) s -= 1;                                    // a bound that gains nothing isn't a bound
    }
    let crowd = 0;
    for (const m of mates) { const ml = m.location; if (Math.hypot(ml.x - c.x, ml.z - c.z) < 1.6 && Math.abs(ml.y - c.y) < 1.5) crowd++; }
    c.s = s - TW.crowd * crowd;
    scored.push(c);
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.filter((c) => c.r === 0 || !onWayThrough(dim, c)).slice(0, 6);   // (doorway / stairs check only for the leaders)
  if (!top.includes(scored.find((c) => c.r === 0) ?? top[0])) { const h = scored.find((c) => c.r === 0); if (h) top.push(h); }   // always judge where he stands too
  // v6.9: and the two spots nearest the enemy (the edge of a roof, the front of a wall-top): the cheap first cut ranks
  // them low for the walk, and then nobody ever looked to see they were the only places with a shot down at him
  const kq = known[0];
  for (const c of scored.filter((c) => c.r > 0 && !top.includes(c)).sort((a, b) => flat(a, kq) - flat(b, kq)).slice(0, 2)) top.push(c);
  let rays = 0;
  for (const c of top) {
    let cover = 0, shot = 0;
    for (const q of known) {
      if (rays > 30) break;
      rays++;
      if (!clearShot(dim, { x: q.x, y: q.y + 1.6, z: q.z }, { x: c.x, y: c.y + 1.1, z: c.z })) cover += 1 / known.length;   // his chest hidden from that enemy
      if (Math.hypot(q.x - c.x, q.z - c.z) <= range) { rays++; if (clearShot(dim, { x: c.x, y: c.y + 1.62, z: c.z }, { x: q.x, y: q.y + 1.5, z: q.z })) shot = 1; }
    }
    c.s += TW.cover * (o.wCover ?? 1) * cover + TW.shot * (o.wShot ?? 1) * shot;
    c.cover = cover; c.shot = shot;
  }
  top.sort((a, b) => b.s - a.s);
  const cur = top.find((c) => c.r === 0);
  for (const c of top) {
    if (c.r === 0) return { spot: undefined, stay: true, score: c.s, cover: c.cover, shot: c.shot };   // where he is is best: stay
    if (cur && c.s < cur.s + (o.margin ?? 0.4)) return { spot: undefined, stay: true, score: cur.s };   // not worth the move
    if (localReach(dim, here, c, 40 + Math.round(c.r * c.r * 1.6))) { claimSpot(e, c, now); return { spot: { x: c.x, y: c.y, z: c.z }, score: c.s, cover: c.cover, shot: c.shot, reach: true }; }
  }
  return undefined;
}

// ================================================================ v5.6: extensions
// Registered behaviours get their turn in the decision chain ("first": before the combat brain; "last": when nothing
// else wants the soldier). Their errors never reach the core. See scripts/api.js and DEVELOPING.md.
function extDecide(when, e, d, now) {
  for (const b of WarAPI.behaviors) {
    if (b.when !== when) continue;
    try { const mv = b.decide(e, d, now, WarAPI.lib); if (mv) { if (mv.note) note(e, mv.note); return mv; } } catch {}
  }
  return undefined;
}
function nearestBlock(e, test, r = 8) {
  let best, bd = 1e9;
  const p = e.location;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const dy of [0, 1]) {
    try { const b = tBlock(e.dimension, p.x + dx, Math.floor(p.y) + dy, p.z + dz); if (b && test(b)) { const dd = Math.hypot(dx, dz); if (dd < bd) { bd = dd; best = { x: Math.floor(p.x + dx) + 0.5, y: Math.floor(p.y) + dy, z: Math.floor(p.z + dz) + 0.5 }; } } } catch {}
  }
  return best;
}
system.runInterval(() => { if (!WarAPI.hooks.tick.length) return; const now = tick(); for (const f of WarAPI.hooks.tick) { try { f(now); } catch {} } }, 1);
WarAPI.lib = {
  SOLDIER, world, system, tick, sd, gdp, sdp, P, setP, note, dist, flat, allOf, nearbyCombatants, marker, makeWaypoint, myMarker, setGoal,
  travel, planPersonalTo, followPersonal, personal, perc, squads, squadKey, gunState, brain, isHostile, isFriendly, factionOf, isDowned, isPow,
  shotAt, aimAt, canHit, clearShot, chest, headLoc, engageRange, tacSpot, freeSpot, spotNear, walkableNear, localReach, isIndoors, onStairs,
  tBlock, turnTo, push, radio, giveFunction, startMarch, nearestBlock, GUN_SPEC, EFFECTIVE, BW,
  straightReach, standAt, edgeAt, combatLock, glideFree, insideBlock, ROLE_OF,
};

// the climb itself, from a route: up or down the run of ladder points starting at k, then onto the point after it
function beginClimb(e, pts, k) {
  const p = pts[k];
  let j = k;
  while (j + 1 < pts.length && pts[j + 1].climb && Math.hypot(pts[j + 1].x - p.x, pts[j + 1].z - p.z) < 0.6) j++;
  const exit = pts[Math.min(pts.length - 1, j + 1)], toY = pts[j].y;
  climbing.set(e.id, { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5, toY, exit, t: tick() });
  for (let yy = Math.min(e.location.y, toY) - 1; yy <= Math.max(e.location.y, toY) + 2; yy++) openAt(e.dimension, { x: p.x, y: yy, z: p.z });   // trapdoors in the shaft
  note(e, "climbing the ladder");
}

// v5.8: following the player up a ladder, onto a wall or to another floor: a real route to him (the glider and climber
// walk it) instead of Minecraft's walking (which can't use ladders) and a catch-up teleport
function followLeader(e, d, now) {
  if (d.func !== "follow" && d.func !== "escort") return undefined;
  const p = findPlayer(d.leader);
  if (!p || p.dimension.id !== e.dimension.id || isRiding(p)) return undefined;
  const pl = p.location, dd = dist(pl, e.location);
  if (dd < 4 || dd > 64) return undefined;
  const off = Math.abs(pl.y - e.location.y) >= 2;
  if (!off && (dd < 10 || localReach(e.dimension, e.location, pl))) return undefined;   // plain walking: Minecraft's follow does it
  note(e, "following you");
  return travel(e, { x: pl.x, y: Math.floor(pl.y + 0.01), z: pl.z }, "follow", now, true);
}

// ================================================================ v5.8: reflexes
// ---- instant self-defence: the moment an enemy hurts a soldier, that enemy is his target (no waiting for his next
// look), his gun re-aims at once, and if the attacker is within arm's reach he fights hand-to-hand right away.
world.afterEvents.entityHurt.subscribe((ev) => {
  const v = ev.hurtEntity, a = ev.damageSource.damagingEntity;
  if (v?.typeId !== SOLDIER || !a?.isValid || a.id === v.id || downed.has(v.id)) return;
  system.run(() => {
    try {
      if (!v.isValid || downed.has(v.id)) return;
      const d = sd(v), now = tick();
      if (d.surr || pows.has(v.id) || bwOf(d.faction).react === false || !isTargetFor(v, d, a)) return;
      const s = pstate(v);
      const dd = dist(a.location, v.location), cur = s.threat?.isValid ? dist(s.threat.location, v.location) : 1e9;
      if (!s.threat || s.threat.id === a.id || dd < cur || dd < 8) {
        if (s.threat?.id !== a.id) { if (s.threat) aimedBy.get(s.threat.id)?.delete(v.id); let set = aimedBy.get(a.id); if (!set) { set = new Set(); aimedBy.set(a.id, set); } set.add(v.id); }
        s.threat = a; s.lastSeen = { ...a.location }; s.lostT = 0; s.alert = "combat"; s.seen.set(a.id, now - 100);
      }
      const st = gunState.get(v.id);
      if (st) { st.check = now; st.next = Math.min(st.next, now + 4); }
      if (dd < 3 && GUNS.includes(d.weapon) && d.weapon !== "at") { setGroups(v, { w: "w_melee", t: "t_short", r: "r_on" }); turnTo(v, a.location, 60); }
      const hits = (reflexHits.get(v.id) ?? []).filter((t) => now - t < 60); hits.push(now); reflexHits.set(v.id, hits);
      if (now - (brain.get(v.id)?.reflexT ?? -999) >= 60) { try { think(v); } catch {} }   // hit: react now, not at his next thought
    } catch {}
  });
});
const reflexHits = new Map(); // id -> ticks he was hit
const shotsAtMe = new Map();  // id -> ticks shots came at him (hits or misses)
system.runInterval(() => { const now = tick(); for (const [id, a] of [...shotsAtMe]) if (!a.some((t) => now - t < 40)) shotsAtMe.delete(id); }, 200);
system.runInterval(() => { const now = tick(); for (const [id, h] of [...reflexHits]) if (!h.some((t) => now - t < 100)) reflexHits.delete(id); }, 200);
// ---- under fire in the open: hit twice in 3 s, or pinned by fire, while exposed to the shooter: get out of it NOW.
// The best nearby spot that hides him from the known enemies and (if possible) still lets him shoot back; no such
// spot: break the line of fire sideways. Runs outside the normal decision budget.
function reflexMove(e, d, now, anchor, leash) {
  if (bwOf(d.faction).reflex === false) return undefined;
  if (!GUNS.includes(d.weapon) || d.func === "post" || isRiding(e) || climbing.has(e.id) || gliders.has(e.id) || onPassage(e)) return undefined;   // (v6.2: on a bridge / ledge: no dodging, sideways is the drop)
  const B = brain.get(e.id) ?? { act: "", decT: -999 }; brain.set(e.id, B);
  const R = B.reflex;
  if (R) {
    if (now > R.until || flat(R.spot, e.location) < 0.8) { B.reflex = undefined; B.decT = -999; return undefined; }   // there (or gave up): the brain decides again
    note(e, R.kind);
    const slot = myMarker(e, R.spot);
    if (flat(R.spot, e.location) < 3.2) push(e, { x: (R.spot.x - e.location.x) * 0.2, y: 0.02, z: (R.spot.z - e.location.z) * 0.2 }, 3);
    return slot ? { g: "g_wp", slot, t: "t_mid", urgent: true } : undefined;
  }
  if (now - (B.reflexT ?? -999) < 60) return undefined;
  const hits = (reflexHits.get(e.id) ?? []).filter((t) => now - t < 60).length;
  const incoming = (shotsAtMe.get(e.id) ?? []).filter((t) => now - t < 40).length;
  const pinned = (suppB.get(e.id) ?? 0) > 5;
  if (hits < 1 && incoming < 2 && !pinned) return undefined;                              // v5.8: the first hit, or shots coming in, is enough
  const S = squads.get(squadKey(e, d));
  const shooter = hurtBy.get(e.id), sh = shooter ? world.getEntity(shooter.id) : undefined;
  const from = sh?.isValid ? headLoc(sh) : undefined;
  if (from && !clearShot(e.dimension, from, chest(e))) return undefined;                 // already out of his sight
  B.reflexT = now;
  const S0 = squads.get(squadKey(e, d));
  if (S0?.plan === "assault" && ["charge", "follow", "patrol"].includes(d.func)) return undefined;   // the squad is going in: no ducking now
  // attacking an enemy who is inside a building: ducking only stalls the attack in front of men who stay hidden, so
  // attackers keep pushing (the brain's covered bounds and suppression carry them in); in the open, take the best cover
  const mover = ["charge", "follow", "patrol"].includes(d.func);
  if (mover && S?.enemyC && isIndoorsAt(e.dimension, S.enemyC) && hpRatio(e) > 0.4) return undefined;
  const r = S?.known?.size ? tacSpot(e, d, S, { rMin: 1.5, rMax: 7, wCover: 2.5, wShot: 0.8, margin: 0.2, anchor, leash, force: true }, now) : undefined;
  let spot = r?.spot, kind = "taking cover under fire";
  if (!spot && from) {                                                                    // no cover near: off his line of fire, sideways
    const dx = e.location.x - from.x, dz = e.location.z - from.z, L = Math.hypot(dx, dz) || 1, side = (e.id.charCodeAt(e.id.length - 1) & 1) ? 1 : -1;
    for (const k of [3, -3, 4.5, -4.5]) {
      const w = walkableNear(e.dimension, e.location.x + (-dz / L) * k * side, e.location.z + (dx / L) * k * side, e.location.y);
      if (w && Math.abs(w.y - e.location.y) <= 1 && (!anchor || flat(w, anchor.location) <= leash) && localReach(e.dimension, e.location, w, 120)) { spot = w; kind = "breaking the line of fire"; break; }
    }
  }
  if (spot) spot = safeSpot(e, spot, now);
  if (!spot || !straightReach(e.dimension, e.location, spot)) return undefined;
  claimSpot(e, spot, now);
  if (Math.random() < 0.4) callout(e, "Taking fire!");                  // (v6.9.1)
  B.reflex = { spot, until: now + 50, kind };
  const st = gunState.get(e.id); if (st) st.check = now;
  note(e, kind);
  const slot = myMarker(e, spot);
  return slot ? { g: "g_wp", slot, t: "t_mid", urgent: true } : undefined;
}

// ================================================================ v5.8: battle learning
// Each faction learns its own tactics from its own fights (an evolution strategy, the kind used to train game AI):
// every time a squad makes contact it fights with a slightly varied copy of the faction's weights (how much it values
// firing, advancing, cover, peeking, suppressing, flanking, assaulting, falling back...). When the fight is over it is
// scored: the share of the enemies it saw that went down, minus the share of its own men lost. Variations that did
// better than the faction's recent average pull the weights toward themselves; worse ones push away. Weights stay
// inside safe bounds and drift gently back toward the self-play-tuned defaults, so learning can't run away. It is saved
// in the world (War Table -> Settings to switch it off or reset it).
const LEARN_SPACE = { fire: [0.2, 1.5], expo: [0, 1.2], adv: [0.3, 1.6], close: [0.2, 1], timing: [0, 1.6], assault: [0, 1.6], cover: [0, 1.6], peek: [0, 1.6], supp: [0, 1.6], fall: [0, 1], flankShare: [0.1, 0.5], ratioFix: [0.8, 2.5], headK: [0.5, 0.95] };
let learned = null; // faction -> { mean: {k: v}, base, n }
function getLearned() { if (!learned) learned = getJSON(world, "war:learn", {}); return learned; }
function saveLearned() { try { setJSON(world, "war:learn", learned ?? {}); } catch {} }
const learnOn = () => setting("learn", true) !== false;
const BW_DEF = () => ({ ...BW, headK: HEAD_K });
function learnedBW(f) {
  if (!f || !learnOn()) return undefined;
  const L = getLearned()[f];
  return L?.mean ? { ...BW_DEF(), ...L.mean } : undefined;
}
const gaussR = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random());
function learnStart(S, f, n, known, now) {
  S.bw = undefined; S.eng = undefined;
  if (!learnOn() || !f || BW_F[f]) return;                     // (a side given fixed weights, e.g. in a test, doesn't learn)
  const mean = { ...BW_DEF(), ...bwOf(f) }, w = { ...mean }, eps = {};
  for (const [k, [lo, hi]] of Object.entries(LEARN_SPACE)) { const e = gaussR() * (hi - lo) * 0.08; eps[k] = e / ((hi - lo) * 0.08); w[k] = Math.min(hi, Math.max(lo, (mean[k] ?? BW[k] ?? 0) + e)); }
  S.bw = w;
  S.eng = { f, t0: now, n0: n, eps, enemies: new Set(known.map((q) => q.ent.id)) };
}
function learnEnd(S, nNow, now) {
  const g = S.eng;
  S.eng = undefined; S.bw = undefined;
  if (!g || !learnOn() || now - g.t0 < 100 || !g.enemies.size) return;   // too short / nobody seen: nothing to learn
  let down = 0;
  for (const id of g.enemies) { const o = world.getEntity(id); if (!o?.isValid || downed.has(id) || pows.has(id) || (o.typeId === SOLDIER && gdp(o, "war:surr"))) down++; }
  const score = down / g.enemies.size - Math.max(0, g.n0 - nNow) / Math.max(1, g.n0);
  const all = getLearned(), L = all[g.f] ?? (all[g.f] = { mean: {}, base: 0, n: 0 });
  const adv = score - L.base;
  L.base += 0.15 * (score - L.base);
  L.n++;
  const def = BW_DEF();
  for (const [k, [lo, hi]] of Object.entries(LEARN_SPACE)) {
    const cur = L.mean[k] ?? def[k];
    let v = cur + 0.35 * adv * g.eps[k] * (hi - lo) * 0.08;   // toward variations that beat the average
    v += 0.02 * (def[k] - v);                                    // and a gentle pull home
    L.mean[k] = +Math.min(hi, Math.max(lo, v)).toFixed(4);
  }
  saveLearned();
}
