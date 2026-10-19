// War Engine v7.1: faction NPC war framework
import { world, system, Player, ItemStack, EquipmentSlot, GameMode, MolangVariableMap, BlockPermutation } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import { SKINS } from "./skins.js";
import { WarAPI } from "./api.js";
import { CULTURE, MIXES } from "./names.js";
import { GUIDE } from "./guide.js";
import { VOICE_KEYS, VOICE_NAMES, CALL_KEY, BASE_LINES, MORE_LINES, VOICE_HAS, EN_LINES, IDLE_ASK, STORIES, IDLE_LINES, LINE_INFO } from "./voices.js";
// v6.2: errors are never silent any more in the core loops: counted per system, written to the content log (with the
// first lines of the stack) at most once a minute per system, and shown in chat when "Show soldier decisions" is on.
// v9.19: an entity's health component, fetched once and kept (asking the game for it was ~40 calls a tick in a big battle)
const HP_COMP = new Map();
function hpOf(e) {
  if (!e) return undefined;
  let c = HP_COMP.get(e.id);
  if (c) { try { c.currentValue; return c; } catch { HP_COMP.delete(e.id); } }
  try { c = e.getComponent("minecraft:health"); if (c) { HP_COMP.set(e.id, c); if (HP_COMP.size > 3000) HP_COMP.clear(); } return c; } catch { return undefined; }
}
const ERRS = new Map(); // system -> { n, t }
const ERR_LOG = [];     // v9.19: the last 20 (time, system, message)
function oops(sys, err) {
  try {
    const now = tick(), r = ERRS.get(sys) ?? { n: 0, t: -99999 };
    r.n++;
    if (now - r.t >= 1200) {
      r.t = now;
      const msg = `War Engine: ${sys} error (x${r.n}): ${String(err?.stack ?? err).split("\n").slice(0, 3).join(" | ")}`;
      console.warn(msg);
      ERR_LOG.push({ t: Date.now(), sys, msg: String(err?.message ?? err).slice(0, 160) }); if (ERR_LOG.length > 20) ERR_LOG.shift();   // (v9.19: War Table > Settings > Recent problems)
      try { if (world.getDynamicProperty("war:set_readout")) world.sendMessage(`§c${msg.slice(0, 180)}`); } catch {}
      r.n = 0;
    }
    ERRS.set(sys, r);
  } catch {}
}
{ const ri = system.runInterval.bind(system); system.runInterval = (f, n) => {
  const site = (String(new Error().stack).split("\n").map((l) => Number((l.match(/main\.js:(\d+)/) ?? [])[1] ?? 0)).find((n) => n > 40) ?? "?");   // (v9.23: where the loop was made, for the loop profiler: test servers only)
  return ri(() => { const P0 = globalThis.__loopProf; if (P0) { const t = Date.now(); try { f(); } catch (err) { oops("loop", err); } const k = `${site}/${n}`; P0[k] = (P0[k] ?? 0) + Date.now() - t; } else { try { f(); } catch (err) { oops("loop", err); } } }, n);
}; }
import "./extensions/index.js";
// v8.1: the current tick, read from the game ONCE per tick. Asking the game (system.currentTick) is a call into the
// engine, and the add-on asked millions of times a battle: on a real server that alone was 45% of all its work in a
// 90 v 90 (half the lag). This interval is registered first, so it runs before every other one in the tick.
// v8.2: level of detail. When the server falls behind (a big battle), every soldier looks and thinks a little less
// often (down to ~40% of normal) so the game keeps running at full speed; as it catches up they go back to normal.
const aiLoad = () => Math.min(2.5, Math.max(1, tickGap / 52));
let TICK_NOW = 0, tickGap = 50, lastTickMs = 0;   // (tickGap: real ms between ticks, smoothed: 50 = the server keeps pace)
system.runInterval(() => { TICK_NOW = system.currentTick; const t = Date.now(); if (lastTickMs) tickGap = tickGap * 0.95 + Math.min(500, t - lastTickMs) * 0.05; lastTickMs = t; }, 1);

// ================================================================ constants
const SOLDIER = "war:soldier", HOUND = "war:hound", WAYPOINT = "war:waypoint", FLAG = "war:flag";
const VEHICLES = ["war:boat", "war:plane", "war:tank", "war:truck", "war:gunboat", "war:heli"];   // (v9.2: truck, Coast Guard gunboat, helicopter)
const WATERCRAFT = ["war:boat", "war:gunboat"], MG_SEAT = ["war:gunboat", "war:heli"];
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
const TRANSIENT = new Set(["war:born", "p_war:block", "war:st", "p_war:firing", "p_war:aiming", "p_war:pose", "war:lp", "war:lpt", "war:pace", "war:pacet", "war:selfheal", "war:stuck", "war:calm", "war:readout", "war:healt", "war:covert"]);
// (only records whose being up to 30 s old after a reload is harmless: the waypoint he was walking to, the march he was
//  catching up, his own markers, who hit him last. His orders, being down, falling back and his entity properties are
//  written at once: an old copy of those would bring back a state he'd left.)
const LAZY = new Set(["war:goal", "war:catchup", "war:hurt", "war:mymk", "war:fmk", "war:ordergoal", "war:retreatUntil"]);   // (v9.15: + the parked order goal and retreat timer: rewritten hundreds of times a minute on a march)
const lazyKey = (k) => LAZY.has(k);
function gdp(h, k) {
  const m = dpMap(h);
  if (m.has(k)) return m.get(k);
  if (TRANSIENT.has(k)) return undefined;
  let v;
  if (h !== world && lazyKey(k)) {                                   // (v9.0: the packed record first, then the old single one)
    let pk = m.get("\u0000lz");
    if (pk === undefined) { try { const raw = h.getDynamicProperty("war:lz"); pk = typeof raw === "string" ? JSON.parse(raw) : null; } catch { pk = null; } m.set("\u0000lz", pk); }
    if (pk && Object.prototype.hasOwnProperty.call(pk, k)) { v = pk[k] === null ? undefined : pk[k]; m.set(k, v); return v; }
  }
  v = h.getDynamicProperty(k);
  m.set(k, v);
  return v;
}
// v9.0: the busiest per-soldier records (his state groups, the waypoint he's walking to, the march he's catching up,
// who hurt him last) change many times a second in a battle. Bedrock saves ALL of an entity's properties again on
// every single write (a 90 v 90 measured 31 MB a minute; the game warns at 10), so these are kept in memory and
// written to the world at most once every 30 s per soldier. A reload loses at most the last 30 s of where he was
// walking to, which the march picks up again anyway. (Measured on a real server: with these writes switched off the
// warning went away; with the world's own writes switched off it stayed.)
const lazyDirty = new Map(); // entity id -> { h, keys: Set, t }
function sdp(h, k, v) {
  const m = dpMap(h);
  if (m.has(k) && m.get(k) === v && (v === undefined || typeof v !== "object")) return;
  if (h !== world && lazyKey(k)) {
    m.set(k, v && typeof v === "object" ? { ...v } : v);
    let L = lazyDirty.get(h.id); if (!L) { L = { h, keys: new Set(), t: tick() }; lazyDirty.set(h.id, L); }
    L.keys.add(k);
    return;
  }
  if (!TRANSIENT.has(k)) h.setDynamicProperty(k, v);
  m.set(k, v && typeof v === "object" ? { ...v } : v);
}
system.runInterval(() => {
  const now = tick();
  let n = 0;
  for (const [id, L] of lazyDirty) {
    if (now - L.t < 600) continue;
    lazyDirty.delete(id);
    try {                                                            // one write per soldier: every busy record packed together
      if (!L.h.isValid) continue;
      const m = dpMap(L.h), pk = { ...(m.get("\u0000lz") ?? {}) };
      for (const k of L.keys) { const v = m.get(k); pk[k] = v === undefined ? null : v; }
      m.set("\u0000lz", pk);
      L.h.setDynamicProperty("war:lz", JSON.stringify(pk));
    } catch {}
    if (++n >= 40) break;                                            // (spread out: a few dozen soldiers a second at most)
  }
}, 20);
system.runInterval(() => { for (const id of [...DPC.keys()]) if (id !== "@world" && !world.getEntity(id)) DPC.delete(id); }, 1200);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const findPlayer = (id) => (id ? world.getAllPlayers().find((p) => p.id === id) ?? globalThis.__fakeLeader?.(id) : undefined);   // (__fakeLeader: test kits only)
const tick = () => TICK_NOW || system.currentTick;
const DIMS = ["overworld", "nether", "the_end"];
const allOfCache = new Map(); // type -> { t, list }  (one world search per type per tick)
// v6.3: soldiers picked up with the TP wand (soldier id -> { by: player id }). They are left out of allOf, so nothing
// thinks for them, moves them, aims or shoots with them, or rescues them while they're carried.
const held = new Map();
function allOf(type) {
  const now = tick(), c = allOfCache.get(type);
  if (c && c.t === now) { if (!c.checked) { c.list = c.list.filter((e) => e.isValid); c.checked = true; } return c.list; }
  let out = [];
  for (const d of DIMS) { try { out.push(...world.getDimension(d).getEntities({ type })); } catch {} }
  if (type === SOLDIER && held.size) out = out.filter((e) => !held.has(e.id));
  allOfCache.set(type, { t: now, list: out });
  return out;
}
const rideMemo = new Map(); // id -> { t, v, on }
function rideInfo(e) {
  const now = tick(), c = rideMemo.get(e.id);
  if (c && now - c.t < 5) return c;
  let on;
  try { on = e.getComponent("minecraft:riding")?.entityRidingOn; } catch {}
  const r = { t: now, v: !!on, on: on?.typeId };
  rideMemo.set(e.id, r);
  try { if (e.typeId === SOLDIER && on && VEHICLES.includes(on.typeId)) { if (VEH_LOOK.get(e.id)?.m !== on) VEH_LOOK.set(e.id, { e, m: on }); } else VEH_LOOK.delete(e.id); } catch {}
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
const PROPS = ["war:idle", "war:faction", "war:skin", "war:ranged", "war:cav", "war:medic", "war:rally", "war:gun", "war:firing", "war:aiming", "war:down", "war:nest", "war:pose", "war:role", "war:officer", "war:vet", "war:medals"];
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
  const c = sdCache.get(e.id), now = tick();
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
  const surr = !!gdp(e, "war:surr") || pows.has(e.id) || gdp(e, "war:pow") !== undefined;   // (v9.19: a prisoner is nobody's enemy: before, taking him gave him back his tags and men cut him down)
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
    txt = (d.custom || (e.typeId === SOLDIER ? `${soldierName(e)}${d.div && d.div !== "foot" ? ` §8${DIV[d.div]?.name ?? ""}§r` : ""}` : DIV[d.div]?.name || "Soldier")) + (d.squad ? ` §7- ${squadName(f, d.squad)}` : "");   // (v9.18: his name and rank)
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
  try { sdp(e, "war:nohelm", undefined); } catch {}
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
  return "iron_sword";
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
  let m;
  try { m = dim.spawnEntity(WAYPOINT, loc); } catch { return 0; }   // (v9.0: a spot in an unloaded chunk: no marker, the caller tries again later)
  allOfCache.delete(WAYPOINT);                                   // v5.3: the next claim this tick sees this marker too (no shared numbers)
  try { m.addEffect("invisibility", 20000000, { showParticles: false }); } catch {}
  const s = claimSlot(m);
  try { mkPos.delete(s); } catch {}                                 // (a new marker on this number: no remembered place)
  if (!s) m.remove();
  // (v8.2: no "war:slotseen" record any more: nothing ever read it, and rewriting it in full for every new waypoint
  //  was 3.6 MB of saved data every 30 s in a big battle on a real server)
  return s;
}
function setGoal(e, slot) {
  if (Number(gdp(e, "war:goal") ?? 0) === (slot || 0) && GOAL_SET.get(e.id) === (slot || 0)) return;   // (v9.20.3: the same goal: nothing to change. Taking the tags off and putting them back every thought cost calls, and could make the game's following let go of its marker)
  GOAL_SET.set(e.id, slot || 0);
  for (const t of e.getTags()) if (t.startsWith("war_go") || t.startsWith("war_gr") || t.startsWith("war_gc")) e.removeTag(t);
  if (slot) { e.addTag(`war_gr${rowOf(slot)}`); e.addTag(`war_gc${colOf(slot)}`); }
  sdp(e, "war:goal", slot);
  try { noteRefs(e); } catch {}
}
const GOAL_SET = new Map();   // soldier id -> the goal slot his tags were last set for (this session)
system.runInterval(() => { for (const id of [...GOAL_SET.keys()]) if (!world.getEntity(id)) GOAL_SET.delete(id); }, 1200);
const SLOT_KEYS = ["war:goal", "war:home", "war:mwp", "war:chargegoal", "war:ordergoal", "war:catchup", "war:mymk", "war:fmk"];
let slotRefs = null; // soldier id -> [slots] (last known, kept while he's out of range)
function getRefs() { if (!slotRefs) slotRefs = getJSON(world, "war:slotrefs", {}); return slotRefs; }
const refSeen = new Map(); // soldier id -> tick he was last seen this session
function noteRefs(e) {
  const r = SLOT_KEYS.map((k) => Number(gdp(e, k) ?? 0)).filter((x) => x > 0);
  getRefs()[e.id] = [...new Set(r)];
  refSeen.set(e.id, tick());
}
function usedSlots() {
  const used = new Set();
  for (const list of Object.values(getRefs())) for (const sl of list) used.add(sl);
  for (const m of Object.values(getMarches())) for (const l of m.lanes) used.add(l);
  for (const v of threatSlot.values()) used.add(v);
  return used;
}
// v9.14: markers run short: what holds them that nobody's used for 5 minutes lets go (old marches, soldiers out of sight)
function freeSlots() {
  const now = tick(), ms = getMarches(), byId = new Set(allOf(SOLDIER).map((e) => e.id));
  for (const [id, m] of Object.entries(ms)) if (!(m.members ?? []).some((x) => byId.has(x)) && now - (m.seenT ?? now) > 6000) { for (const s2 of m.lanes ?? []) laneOf.delete(s2); delete ms[id]; }
  try { saveMarches(); } catch {}
  const refs = getRefs();
  for (const id of Object.keys(refs)) if (!byId.has(id) && now - (refSeen.get(id) ?? now) > 6000) { delete refs[id]; refSeen.delete(id); }
  gcWaypoints(allOf(SOLDIER));
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
  // (v9.0: a soldier not seen for an hour of play is gone for good, or so far away his old waypoints don't matter: his
  //  entry goes, so the list doesn't grow with every soldier the world has ever had)
  const now2 = tick(), refs = getRefs();
  for (const id of Object.keys(refs)) { if (!refSeen.has(id)) refSeen.set(id, now2); else if (now2 - refSeen.get(id) > 72000) { delete refs[id]; refSeen.delete(id); } }
  // (a saved value holds at most 32767 characters: past ~24000 the soldiers longest out of sight go first)
  let txt = JSON.stringify(refs);
  if (txt.length > 24000) {
    const order = Object.keys(refs).sort((a, b) => (refSeen.get(a) ?? 0) - (refSeen.get(b) ?? 0));
    let len = txt.length;
    for (const id of order) { if (len <= 18000) break; len -= id.length + JSON.stringify(refs[id]).length + 4; delete refs[id]; refSeen.delete(id); }
  }
  setJSON(world, "war:slotrefs", refs);
}
system.runTimeout(() => { try { if (world.getDynamicProperty("war:slotseen") !== undefined) world.setDynamicProperty("war:slotseen", undefined); } catch {} }, 100);   // (v9.0: a record nothing has used since v8.2)
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
  weapon = cmFix(e, div, weapon);                                  // (v9.14: the content level)
  sdp(e, "war:weapon", weapon);
  setP(e, "war:ranged", isRangedW(weapon));
  setP(e, "war:skin", s.skin ?? 0);
  if (!s.skin) syncSkin(e);                                        // (v9.19: the faction's skin at once, not on the next sync)
  setP(e, "war:cav", false);                                       // (v9.13: cavalry ride real mounts)
  if (div === "cavalier" && s.mount) sdp(e, "war:mount", s.mount);
  setP(e, "war:medic", div === "medic");
  setP(e, "war:role", setting("bands", true) ? ROLE_OF[div] ?? 0 : 0);
  sdp(e, "war:div", div);
  sdp(e, "war:squad", s.squad ?? 0);
  sdp(e, "war:radius", s.radius ?? 8);
  sdp(e, "war:custom", s.custom ?? "");
  sdp(e, "war:armor", s.armor ?? "none");
  if (div === "guard") sdp(e, "war:owner", s.owner ?? player?.id);
  if (div === "houndmaster") e.addTag("war_hm"); else e.removeTag("war_hm");
  e.triggerEvent("war:body_foot");
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
  const hp = hpOf(e);
  const cur = hp ? hp.currentValue : undefined;
  const n = e.dimension.spawnEntity(SOLDIER, e.location, { spawnEvent: "war:init" });
  setupSoldier(n, { ...s, func: "__none" }, undefined);
  try { if (cur !== undefined) hpOf(n).setCurrentValue(cur); } catch {}
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

// v9.14: content level. "vanilla": only what the game itself has (swords, spears, crossbows; vanilla mounts; no add-on
// vehicles), "light": no MG, sniper or bazooka and only sensible mounts, "full": everything. Soldiers already out
// there switch over by themselves, and get their own weapons back when it's switched up again.
const contentMode = () => { const v = String(setting("content", "full")); return v === "vanilla" || v === "light" ? v : "full"; };
const CM_OFF = { vanilla: ["rifle", "semi", "smg", "mg", "shotgun", "pistol", "sniper", "at", "molotov", "mixguns"], light: ["mg", "sniper", "at"], full: [] };
const cmWeaponOK = (w) => !CM_OFF[contentMode()].includes(w);
function cmWeapon(w) {
  if (cmWeaponOK(w)) return w;
  if (contentMode() === "light") return { mg: "semi", sniper: "rifle", at: "rifle" }[w] ?? "rifle";
  return w === "molotov" ? "sword" : "crossbow";
}
const CM_LIGHT_MOUNTS = ["minecraft:horse", "minecraft:donkey", "minecraft:mule", "minecraft:camel", "worldanimals:african_elephant", "worldanimals:asian_elephant"];
// (v9.14: a Cavalier's own mount, from the egg or the wand, is one of the sensible ones at every level (vanilla ones only at
//  Vanilla); anything else saddleable can still be ridden the manual way: saddle it and give "Mount up")
const cmMountOK = (t) => CM_LIGHT_MOUNTS.includes(t) && (contentMode() !== "vanilla" || t.startsWith("minecraft:"));
// the loadout he actually carries under the current level (his chosen one is kept, for when it's allowed again)
function cmFix(e, div, w) {
  const m = contentMode();
  if (div === "grenadier") {
    const kit = String(gdp(e, "war:kit") ?? "grenade"), k = m === "vanilla" ? "" : m === "light" && kit === "at" ? "grenade" : kit;
    sdp(e, "war:throw", k && k !== "at" ? k : undefined);
    sdp(e, "war:cmv", m);
    return !k ? "crossbow" : k === "at" ? "at" : "pistol";
  }
  const fin = cmWeapon(w);
  sdp(e, "war:weapon0", fin !== w ? w : undefined);
  sdp(e, "war:cmv", m);
  return fin;
}
function cmApply(e, d) {
  const w0 = String(gdp(e, "war:weapon0") ?? d.weapon), fin = cmFix(e, d.div, w0);
  sdp(e, "war:weapon", fin); setP(e, "war:ranged", isRangedW(fin)); sdDrop(e);
  try { equip(e, weaponItem(e)); } catch {}
}
// ================================================================ surrender
function surrender(e, captor) {
  try { sdDrop(e); } catch {}
  const d = sd(e);
  if (d.surr) return;
  callout(e, "Don't shoot!", { event: true });                   // (v6.6)
  try {                                                          // (v9.5: the nearest enemy soldier covers him)
    const at = { ...e.location }, did = e.dimension.id, f0 = d.faction;
    system.runTimeout(() => { try { const c = nearSnap(did, at, 16).filter((q) => q.type === SOLDIER && !q.down && q.f && isHostile(q.f, f0) && q.e.isValid).sort((a, b) => a.dd - b.dd)[0]; if (c) callout(c.e, "Hands up!", { event: true }); } catch {} }, 25);
  } catch {}
  sdp(e, "war:prevfunc", d.func);
  sdp(e, "war:surr", captor);
  const slot = makeWaypoint(e.dimension, e.location);
  setGoal(e, slot);
  sdp(e, "war:home", slot);
  equip(e, "air");
  setP(e, "war:hands", true);                                    // (v9.19: hands up)
  applyRelations(e);
  setGroups(e, { w: "w_none", t: "t_off", g: "g_post", s: "s_1", d: "d_off", r: "r_off" });
}
function resume(e) {
  try { sdDrop(e); } catch {}
  if (!gdp(e, "war:surr")) return;
  sdp(e, "war:surr", 0);
  setP(e, "war:hands", false);
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
  // v9.22: under fire they move like players: a dash or a charge at a player's pace (s_6/s_7: you walking to sprinting),
  // not a jog slower than you walk; an ordinary move at a brisk walk, each man at his own pace
  let s = urgent ? 6 + (Math.random() < 0.5 ? 0 : 1) : 2 + pace + (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0);
  s = Math.max(2, Math.min(urgent ? 7 : 5, s));
  if (cav) s = 5 + Math.max(1, Math.min(3, Math.ceil(s / 2)));
  return `s_${s}`;
}

function think(e) {
  if (globalThis.__noThink?.has(e.id)) return;                                     // (test kits only)
  sdDrop(e);
  try { if (!FALLS.has(e.id) && e.getProperty("war:hide")) { setP(e, "war:hide", false); equip(e, weaponItem(e)); } } catch {}   // (v9.14: never left hidden after a reload mid-fall)
  if (!downed.has(e.id) && gdp(e, "war:downed") !== undefined) downed.set(e.id, tick() + 300);   // still down after a reload
  if (downed.has(e.id)) { setGroups(e, { w: "w_none", t: "t_off", g: "g_none", s: "s_1", d: "d_off", r: "r_off" }); return; }
  if (!pows.has(e.id) && gdp(e, "war:pow") !== undefined) { try { pows.set(e.id, JSON.parse(String(gdp(e, "war:pow")))); } catch {} }
  if (!ridingNest(e) && (P(e, "war:nest") || gdp(e, "war:gunSaved"))) { setP(e, "war:nest", false); sdp(e, "war:gunSaved", undefined); if (!pows.has(e.id)) equip(e, weaponItem(e)); }
  if (pows.has(e.id) && Number(P(e, "war:gun") ?? 0) !== 0) { setP(e, "war:gun", 0); equip(e, "air"); }   // stays disarmed
  if (pows.has(e.id)) { const pm = powMove(e, tick()); if (pm) { if (pm.slot !== undefined) setGoal(e, pm.g === "g_wp" ? pm.slot : 0); setGroups(e, { w: pm.w, t: pm.t, g: pm.g, s: pm.s, d: pm.d, r: pm.r }); } return; }
  let d = sd(e);
  const now = tick();
  if (gdp(e, "war:cmv") !== contentMode()) { cmApply(e, d); d = sd(e); }   // (v9.14: the content level changed)
  // while engaging, the order's own goal is parked in war:ordergoal
  const parked = gdp(e, "war:ordergoal");
  if (parked !== undefined) d.goal = Number(parked);
  if (d.surr) {
    // (v9.1: a man who surrendered stays surrendered, war or peace, until a player of his own faction comes for him)
    setGroups(e, { w: "w_none", t: "t_off", g: "g_post", s: "s_1", d: "d_off", r: "r_off" });
    return;
  }
  const riding = isRiding(e);
  const hp = hpOf(e);
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
  if (!retreat && canRetreat && (hpr < retreatHp(e) || (hpr < 0.6 && foes >= friends * 2 + 3))) {
    retreat = true;
    sdp(e, "war:retreat", true);
    if (gdp(e, "war:ordergoal") !== undefined) { setGoal(e, Number(gdp(e, "war:ordergoal"))); sdp(e, "war:ordergoal", undefined); }
    updateName(e);
  } else if (retreat && now > Number(gdp(e, "war:retreatUntil") ?? 0) && (
             (hpr > 0.75 && foes <= friends + 1 && (hpr >= 0.95 || !nearestFlag(e.dimension, e.location, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 128))) ||
             // v9.5: or simply safe: nobody hostile near, not hit for 15 s, no fight going on for his squad: he goes back to
             // his order wounded (he heals on the way), instead of hiding for minutes with nobody after him
             (foes === 0 && now - lastHurt > 300 && !inFight(e, squads.get(squadKey(e, d)), now)))) {
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
    const rf = nearestFlag(e.dimension, e.location, (f) => (!!P(f, "war:rally") || !!gdp(f, "war:hq")) && isFriendly(d.faction, Number(P(f, "war:faction"))), 8);
    let heal = 0;
    if (rf) heal = 2;                                              // at a rally point (v9.19: or the HQ): real healing
    else if (now - Number(gdp(e, "war:selfheal") ?? -9999) > 340) { heal = 1; sdp(e, "war:selfheal", now); } // alone: ~1 HP per 17 s
    if (heal) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + heal));
  }

  // ---- weapon
  let weapon = GUNS.includes(d.weapon) ? `w_${d.weapon}` : d.weapon === "spear" ? "w_spear" : d.ranged ? "w_ranged" : "w_melee";
  if (d.div === "cavalier") cavTick(e, d, now);
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
    // v9.7: falling back by bounds. Two or more of the squad pulling back with the enemy in sight: half of them turn and
    // fire for ~3 s while the other half runs, then they swap. A badly hurt man (under 30%) just runs.
    try {
      const th = perc.get(e.id)?.threat;
      if (hpr >= 0.3 && GUNS.includes(d.weapon) && th?.isValid && dist(th.location, e.location) < 40) {
        const S = squads.get(squadKey(e, d)), mates = (S?.ours ?? []).filter((o) => o.isValid && o.id !== e.id && sd(o).retreat && !downed.has(o.id));
        if (mates.length >= 1 && ((e.id.charCodeAt(e.id.length - 1) + Math.floor(now / 60)) % 2 === 0)) {
          want = { w: weapon, t: "t_mid", g: "g_none", s: speedGroup(e, true), d: "d_off", r: "r_off" };
          note(e, "covering the pull-back"); v9stat("retreatCover");
        }
      }
    } catch {}
  } else {
    const anchor = ["hold", "post", "sentry", "stand"].includes(d.func) ? marker(d.goal) : undefined;
    const cu = d.func === "charge" ? gdp(e, "war:catchup") : undefined;
    const bLeash = d.func === "post" ? 2 : d.func === "sentry" ? d.radius + 4 : d.func === "hold" ? (freeOf(e) ? aoOf(e) : 18) : 6;
    const wet = inWater(e);
    // v5.6: a fresh order is obeyed at once: for ~5 s after it nothing stops him to fight (he still shoots on the move)
    const fresh = now - Number(gdp(e, "war:ordt") ?? -99999) < 100 && (["charge", "follow", "patrol"].includes(d.func) || (anchor && dist(anchor.location, e.location) > 6));
    const fight = !fresh && !wet;
    const engaged = campMove(e, now) ?? medicMove(e, d, now) ?? casevacMove(e, d, now) ?? shakenMove(e, d, now) ?? waterExit(e, d, now) ?? (fresh || wet ? undefined : reflexMove(e, d, now, anchor, bLeash)) ?? extDecide("first", e, d, now) ?? (personal.has(e.id) ? followPersonal(e, now) : undefined) ?? spreadMove(e, now) ?? (fight ? combatMove(e, d, now, melee, anchor, bLeash) : undefined) ?? (fight ? engagement(e, d, now, d.goal, melee) : undefined) ?? (fresh ? undefined : reinforceMove(e, d, now)) ??
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
      want.s = engaged.slow ? "s_1" : engaged.s ?? speedGroup(e, engaged.urgent);   // (v9.20.3: a pace the move asks for is kept: catching you up was walked at a stroll)
    } else if (gdp(e, "war:ordergoal") !== undefined) {
      setGoal(e, Number(gdp(e, "war:ordergoal")));  // back to the order
      sdp(e, "war:ordergoal", undefined);
    }
    // v5.4: gunners are aimed, fired and moved by the script alone. Vanilla targeting would walk them at the enemy on
    // its own (straight at a building, off the route) and override their orders: it stays off for them.
    if (GUNS.includes(d.weapon)) { want.t = "t_off"; want.r = "r_off"; }
    // a gunner with an enemy right on top of him fights hand-to-hand, then goes back to shooting
    // (v9.2: by what makes sense: see chooseArm. The sword only when the gun is the wrong tool at that range)
    if (GUNS.includes(d.weapon) && (!calm || ARM.has(e.id))) { if (chooseArm(e, d, now, calm) === "blade") { want.w = "w_melee"; want.t = "t_short"; want.r = "r_on"; } }
  }
  // v9.16: at his post he simply stands. Left "following" his marker from a step away, the game's walking kept re-aiming
  // his head down at it (a nod every second, gun pointing at the ground) and shuffling him round it
  if (!retreat && (want.g === "g_wp" || want.g === "g_post") && !riding) {
    try {
      const an = ["hold", "post", "sentry", "stand"].includes(d.func) && gdp(e, "war:ordergoal") === undefined ? marker(Number(gdp(e, "war:goal") ?? 0)) : undefined;   // (v9.20.3: his post, not a spot the fight sends him to: stopped 1.8 short of that, the move never finished)
      if (an && !perc.get(e.id)?.threat?.isValid && flat(an.location, e.location) < (want.g === "g_post" ? 1.8 : 3.0) && Math.abs(an.location.y - e.location.y) < 1.5) want.g = "g_none";
    } catch {}
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
    const h = hpOf(o);
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
    const h = hpOf(tgt);
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
  if (downed.has(e.id) || d.surr || SAFE.has(e.id)) return;
  if (throwerKite(e, d, now)) return;
  let n = Number(gdp(e, "war:molo") ?? MOLO.max);
  if (n < MOLO.max && now - Number(gdp(e, "war:molor") ?? now) > MOLO.refill) { n++; sdp(e, "war:molo", n); sdp(e, "war:molor", n < MOLO.max ? now : undefined); }
  if (n <= 0 || Number(gdp(e, "war:molot") ?? 0) > now) return;
  const sq = `${d.faction}:${d.squad}`;
  if (now < (squadMolo.get(sq) ?? 0)) return;
  // the best target in reach: the enemy with the most enemies packed around him (a bottle on a crowd)
  let t, bs = -1e9;
  for (const c of nearSnap(e.dimension.id, e.location, MOLO.rMax)) {
    if (c.down || !c.f || !isHostile(d.faction, c.f) || !c.e.isValid || downed.has(c.id) || c.dd < MOLO.rMin || SAFE.has(c.id)) continue;
    let pack = 0; for (const q of nearSnap(e.dimension.id, c, MOLO.radius + 0.5)) if (!q.down && q.f && isHostile(d.faction, q.f)) pack++;
    const sc = pack * 3 - c.dd * 0.1;
    if (sc > bs) { bs = sc; t = c.e; }
  }
  if (!t?.isValid) return;
  const dd = dist(t.location, e.location);
  if (dd < MOLO.rMin || dd > MOLO.rMax || Math.abs(t.location.y - e.location.y) > 6) return;
  if (!openNow(e.dimension, headLoc(e), { x: t.location.x, y: t.location.y + 1.6, z: t.location.z })) return;   // he must see where he throws (v7.1: a fresh look)
  if (nearSnap(t.dimension.id, t.location, MOLO.radius + 3).some((c) => !c.down && (c.type === SOLDIER || c.type === "minecraft:player" || c.type === HOUND) && c.f && isFriendly(d.faction, c.f))) return;   // never on (or near) a friend
  turnTo(e, t.location, 180);                                    // (v6.9.2: facing the throw)
  sdp(e, "war:molo", n - 1); sdp(e, "war:molot", now + MOLO.cd); squadMolo.set(sq, now + MOLO.squadGap);
  if (!gdp(e, "war:molor")) sdp(e, "war:molor", now);
  callout(e, "Grenade!", { event: true });
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
  if (downed.has(e.id) || d.surr || SAFE.has(e.id)) return;
  if (throwerKite(e, d, now)) return;
  let n = Number(gdp(e, "war:nade") ?? NADE.max);
  if (n < NADE.max && now - Number(gdp(e, "war:nader") ?? now) > NADE.refill) { n++; sdp(e, "war:nade", n); sdp(e, "war:nader", n < NADE.max ? now : undefined); }
  if (n <= 0 || Number(gdp(e, "war:nadet") ?? 0) > now) return;
  const sq = `${d.faction}:${d.squad}`;
  if (now < (squadNade.get(sq) ?? 0)) return;
  let t, bs = -1e9;
  for (const c of nearSnap(e.dimension.id, e.location, NADE.rMax)) {
    if (c.down || !c.f || !isHostile(d.faction, c.f) || !c.e.isValid || downed.has(c.id) || c.dd < NADE.rMin || SAFE.has(c.id)) continue;
    let pack = 0; for (const q of nearSnap(e.dimension.id, c, 3.5)) if (!q.down && q.f && isHostile(d.faction, q.f)) pack++;
    const sc = pack * 3 - c.dd * 0.1;
    if (sc > bs) { bs = sc; t = c.e; }
  }
  if (!t?.isValid || Math.abs(t.location.y - e.location.y) > 8) return;
  if (!openNow(e.dimension, headLoc(e), { x: t.location.x, y: t.location.y + 1.6, z: t.location.z })) return;
  if (nearSnap(t.dimension.id, t.location, NADE.safe).some((c) => !c.down && (c.type === SOLDIER || c.type === "minecraft:player" || c.type === HOUND) && c.f && isFriendly(d.faction, c.f))) return;
  turnTo(e, t.location, 180);                                    // (v6.9.2: he faces where he throws: it went out of his back)
  sdp(e, "war:nade", n - 1); sdp(e, "war:nadet", now + NADE.cd); squadNade.set(sq, now + NADE.squadGap);
  if (!gdp(e, "war:nader")) sdp(e, "war:nader", now);
  callout(e, "Grenade!", { event: true });
  const dd = dist(t.location, e.location), err = Math.min(2.5, dd / 9);
  const at = { x: t.location.x + (Math.random() - 0.5) * err * 2, y: t.location.y, z: t.location.z + (Math.random() - 0.5) * err * 2 };
  const dim = e.dimension, from = headLoc(e), T = Math.round(12 + dd * 0.9), g = walkableNear(dim, at.x, at.z, at.y) ?? at, by = e;
  const cook = vetTier(e) >= 2 || traitOf(e) === "brave" ? 10 + Math.floor(Math.random() * 10) : 0;   // (v9.19: an old hand cooks it: no time to throw it back)
  try { dim.playSound("random.bow", from, { volume: 0.6, pitch: 0.6 }); } catch {}
  for (let k = 1; k <= T; k += 2) system.runTimeout(() => {
    try { const u = k / T, h = Math.max(3, dd * 0.35); dim.spawnParticle("minecraft:basic_smoke_particle", { x: from.x + (g.x - from.x) * u, y: from.y + (g.y + 0.3 - from.y) * u + 4 * h * u * (1 - u), z: from.z + (g.z - from.z) * u }); } catch {}
  }, k);
  system.runTimeout(() => {
    try { dim.playSound("random.fuse", g, { volume: 0.8, pitch: 1.4 }); } catch {}
    liveNades.push({ dim, at: { x: g.x, y: g.y, z: g.z }, boom: tick() + NADE.fuse - cook, by });
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
        // (v9.2: through explode(): the game refuses a soldier as an explosion's source, and that error used to be
        //  swallowed here, so a soldier's grenade never went off at all. explode() retries without one and deals the
        //  add-on's own blast damage)
        explode(G.dim, G.at, NADE.power, { breaksBlocks: false, causesFire: false, source: G.by?.isValid ? G.by : undefined });
        continue;
      }
      G.dim.spawnParticle("minecraft:basic_smoke_particle", { x: G.at.x, y: G.at.y + 0.2, z: G.at.z });
      for (const c of nearSnap(G.dim.id, G.at, 5.5)) {               // a live grenade at his feet: get away from it
        if (c.type !== SOLDIER || c.down || held.has(c.id) || !c.e.isValid || now - Number(fleeFire.get(c.id) ?? -99) < 15) continue;
        G.seen ??= new Map();                                            // (v9.2: each man needs a moment to notice it: 0.3-0.8 s)
        if (!G.seen.has(c.id)) G.seen.set(c.id, now + 6 + Math.floor(Math.random() * 11));
        if (now < G.seen.get(c.id)) continue;
        if (!G.back && c.dd < 2.4 && G.boom - now > 18 && throwBack(G, c.e, now)) break;   // (v9.19: he grabs it and throws it back)
        fleeFire.set(c.id, now);
        const l = c.e.location, dx = l.x - G.at.x, dz = l.z - G.at.z, L = Math.hypot(dx, dz) || 1;
        // (v9.2: a dive first: the route below takes a moment, and a grenade doesn't wait; before, most men hadn't
        //  moved a block by the time it went off)
        if (!isRiding(c.e)) { try { c.e.applyImpulse({ x: (dx / L) * 0.42, y: 0.22, z: (dz / L) * 0.42 }); } catch {} }
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
      shotFx(owner);
    } catch {}
  });
});
// v9.7: a shot as each player hears it: up close the sharp report; further off the distant one, from the right
// direction; past ~120 blocks a faint, low crack; past 260 nothing
let PLAYERS_LIST = [], NIGHT = false;
system.runInterval(() => { try { PLAYERS_LIST = world.getAllPlayers(); } catch {} }, 20);
system.runInterval(() => { try { const t = world.getTimeOfDay(); NIGHT = t >= 12800 && t <= 23200; } catch {} }, 100);
function gunSound(owner, m) {
  const l = owner.location, did = owner.dimension.id;
  for (const p of PLAYERS_LIST) {
    try {
      if (!p.isValid || p.dimension.id !== did) continue;
      const pl = p.location, dd = Math.hypot(pl.x - l.x, pl.y - l.y, pl.z - l.z);
      if (dd <= 40) { p.playSound(`${m}_shot_mid`, { location: l, volume: 1.5 }); continue; }
      if (dd > 260) continue;
      const k = Math.min(dd, 20) / dd, at = { x: pl.x + (l.x - pl.x) * k, y: pl.y + (l.y - pl.y) * k, z: pl.z + (l.z - pl.z) * k };
      if (dd <= 120) p.playSound(`${m}_shot_far`, { location: at, volume: 1.6 - (dd - 40) / 120, pitch: 0.97 });
      else p.playSound(`${m}_shot_far`, { location: at, volume: Math.max(0.15, 0.7 * (1 - (dd - 120) / 140)), pitch: 0.82 });
    } catch {}
  }
}
// the bang, the flash and the firing pose of one shot (v8.0: also for precise hits, which spawn no bullet)
const FX_T = new Map();   // v9.19: id -> tick of his last smoke puff (one every few shots in a burst)
function shotFx(owner) {
    try {
      const d = sd(owner);
      if (!GUNS.includes(d.weapon)) return;
      const m = gunModel(d.faction, d.weapon);
      gunSound(owner, m);                                                // (v9.7: each player hears it by how far away it is)
      setP(owner, "war:firing", true);
      const o = owner;
      system.runTimeout(() => { if (o.isValid) setP(o, "war:firing", false); }, 4);
      try {
        const h = headLoc(owner), v = owner.getViewDirection();
        owner.dimension.spawnParticle("ww:flash", { x: h.x + v.x * 1.3, y: h.y - 0.25 + v.y * 1.3, z: h.z + v.z * 1.3 });
        if (NIGHT && setting("nightfx", true)) owner.dimension.spawnParticle("war:muzzle", { x: h.x + v.x * 1.4, y: h.y - 0.25 + v.y * 1.4, z: h.z + v.z * 1.4 });   // (v9.15: a flash you see across the field at night)
        // v9.19: a puff of smoke at the muzzle and a brass casing thrown out (only where a player can see it)
        const now = tick();
        if (perfLevel() !== "low" && now - (FX_T.get(owner.id) ?? -99) >= 4 && playerNearAt(owner.dimension.id, owner.location, 32)) {
          FX_T.set(owner.id, now);
          owner.dimension.spawnParticle("war:gunsmoke", { x: h.x + v.x * 1.5, y: h.y - 0.25 + v.y * 1.5, z: h.z + v.z * 1.5 });
          if (!["at", "shotgun"].includes(d.weapon)) {
            owner.dimension.spawnParticle("war:casing", { x: h.x - v.z * 0.35 + v.x * 0.4, y: h.y - 0.35, z: h.z + v.x * 0.35 + v.z * 0.4 });
            if (Math.random() < 0.25) { const l = owner.location, dm = owner.dimension; system.runTimeout(() => { try { dm.playSound("war.casing", { x: l.x - v.z * 0.8, y: l.y, z: l.z + v.x * 0.8 }, { volume: 0.5, pitch: 0.9 + Math.random() * 0.2 }); } catch {} }, 12); }
          }
        }
      } catch {}
    } catch {}
}

// ================================================================ main loops
let phase = 0;
const propSync = new Map(); // id -> tick his entity properties were last re-applied
// v5.9: thinking is a rotation with a fixed budget per tick: up to ~480 soldiers each think every second; beyond that each
// thinks a little less often, but the work per tick never grows (no lag spikes in 200 v 200). Soldiers in the
// background (far from every player, not fighting, not moving, not just ordered) think every third turn.
const THINK_MAX = 24;
// v9.2: level of detail by distance. A soldier no player is within 96 blocks of thinks and looks around half as often
// again (in a fight every 2nd pass, quiet every 6th): nobody sees him, and his fight still plays out. Player positions
// are read once a second.
let PLAYER_POS = [];
system.runInterval(() => { try { PLAYER_POS = world.getAllPlayers().map((p) => ({ d: p.dimension.id, x: p.location.x, z: p.location.z })); const xv = globalThis.__viewers?.(); if (xv) PLAYER_POS.push(...xv); } catch {} }, 20);   // (__viewers: test kits only)
const farFromPlayers = (e) => { const l = e.location, d = e.dimension.id, R = FAR_R(); for (const p of PLAYER_POS) if (p.d === d && Math.abs(p.x - l.x) < R && Math.abs(p.z - l.z) < R) return false; return true; };   // (v9.22: closer in on Low, or in a huge battle)
let thinkCursor = 0, thinkAcc = 0;
const thinkPass = new Map(), g2Done = new Set();
system.runInterval(() => {
  if (tick() % 10 === 0) markerCache = new Map();
  const list = allOf(SOLDIER), n = list.length;
  if (!n) return;
  const v = relVersion(), now = tick();
  thinkAcc = Math.min(THINK_MAX, thinkAcc + n / (20 * aiLoad()));                  // (each soldier once per 20 ticks, not more often: re-deciding too often made squads flip-flop)
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
      const hot = isHot(e, now);
      if (!hot && pass % 3) continue;
      if (pass % (hot ? (lodOn() ? 4 : 2) : 6) && farFromPlayers(e)) continue;                    // (v9.2: nobody near to see him; v9.22: a huge battle: the far ones decide half as often)
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
  // v9.19: an off-duty moment or a sleep cut short by the reload: on his feet with his rifle again
  try { if (P(e, "war:idle") || P(e, "war:sleep")) { setP(e, "war:idle", 0); setP(e, "war:sleep", false); if (!pows.has(e.id) && !gdp(e, "war:surr") && !downed.has(e.id)) equip(e, weaponItem(e)); } } catch {}
  try { if (gdp(e, "war:div") === "guard") { const h = hpOf(e); if (h && h.effectiveMax < 40) e.triggerEvent("war:hp_60"); } } catch {}
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

// ================================================================ v9.7: bodies, blood, one-shot kills, (rare) dismemberment
// A soldier who dies leaves a body (his own skin, lying as the wounded do) that the hit or blast throws a little and
// that slides, falls and gets shoved like anything else; it stays up to 10 minutes (16 / 32 / 48 at most by the
// Performance setting: the oldest go first, out of sight; see pruneBodies and sweepBodies) and has no brain, so it
// costs next to nothing. Not every lethal hit leaves a wounded man: a headshot from a
// rifle or sniper, a shotgun blast at point blank, a big explosion, now and then a burst of MG fire kill outright.
// Rarely (a grenade or shell, a sniper's headshot, a point-blank shotgun) a limb comes off: the body is missing it and
// it lies a little way off. Blood sprays on every hit. War Table -> Settings: Gore (on by default) turns the blood
// and the limbs off; the bodies and the outright kills stay.
const lastHit = new Map();   // soldier id -> { t, head, weapon, dd, dir }   (our precise rounds: where they hit)
const killHow = new Map();   // soldier id -> { limb, dir, power }
const CORPSES = [];          // [{ id, t }]
const gore = () => setting("gore", true) !== false;
const LIMB_ANY = () => 1 + Math.floor(Math.random() * 5), LIMB_ARMLEG = () => 2 + Math.floor(Math.random() * 4);
// v9.14: damage the add-on deals itself (every soldier's round, every blast) is already off a man's health when the game
// asks whether to allow it, so "is this the blow that drops him?" was judged against health already lowered by that
// same blow: a man on 12 hit for 7 went down, and overkill one-shots were far too common. His health just before the
// hit is noted here and used instead.
const PRE_HP = new Map();
function preHp(o) { try { if (o?.typeId !== SOLDIER) return; const h = hpOf(o); if (!h) return; PRE_HP.set(o.id, h.currentValue); if (PRE_HP.size === 1) system.run(() => PRE_HP.clear()); } catch {} }
// (and it's the same for the game's own damage: a TNT blast, a sword. Whether this game version takes the blow off before
// asking is learned from our own hits, where his health before is known; it was so on every version tested)
let PRE_SUB = true;
function hpBefore(v, h, dmg) {
  const seen = h?.currentValue ?? 1, pre = PRE_HP.get(v.id);
  if (pre !== undefined) { if (Math.abs(seen - (pre - dmg)) < 0.05) PRE_SUB = true; else if (Math.abs(seen - pre) < 0.05 && dmg > 0.1) PRE_SUB = false; return pre; }
  return PRE_SUB ? seen + dmg : seen;
}
function oneShot(v, ev, cause) {
  // v9.7 (rev.): it's the force of the blow that decides. A blow far bigger than what he had left (a second round
  // into a man already hurt, buckshot at close range) kills outright; one that only just takes him down leaves him
  // wounded. A blast kills outright and throws him away from it the closer he was, and very close tears him apart.
  const now = tick(), lh = lastHit.get(v.id), fresh = !!lh && now - lh.t <= 1;
  const hp = hpBefore(v, hpOf(v), ev.damage), over = ev.damage - hp;
  const src = ev.damageSource?.damagingEntity;
  const away = (from) => { const dx = v.location.x - from.x, dz = v.location.z - from.z, L = Math.hypot(dx, dz) || 1; return { x: dx / L, y: 0, z: dz / L }; };
  let how;
  if (cause.includes("xplosion")) {
    const c = { x: v.location.x, y: v.location.y + 0.9, z: v.location.z };
    let b, bd = 1e9; for (const q of BLASTS) { if (q.dim !== v.dimension.id || now - q.t > 3) continue; const dd = dist(q.at, c); if (dd < bd) { bd = dd; b = q; } }
    const pw = b?.power ?? 3, dd = b ? bd : ev.damage >= 12 ? 1 : 4, dir = b ? away(b.at) : src?.isValid ? away(src.location) : undefined;
    if (dd <= pw * 0.75 || over >= 8) { how = { limb: Math.random() < (dd <= pw * 0.45 ? 0.55 : 0.25) ? LIMB_ANY() : 0, dir, power: 0.45 + 0.2 * Math.max(0, pw * 1.2 - dd) };
      if (how.limb && dd <= pw * 0.3) { how.mask = 1 << (how.limb - 1); for (let k = 0; k < 2; k++) if (Math.random() < 0.6) how.mask |= 1 << (LIMB_ANY() - 1); } }
    else if (dd <= pw * 1.3 && Math.random() < 0.5) how = { limb: 0, dir, power: 0.35 };
  } else {
    const dir = fresh ? lh.dir : src?.isValid ? away(src.location) : undefined;
    if (fresh && lh.head && ["sniper", "rifle", "semi"].includes(lh.weapon)) { if (Math.random() < 0.75) how = { head: true, limb: over >= 4 && Math.random() < (lh.weapon === "sniper" ? 0.35 : over >= 8 ? 0.12 : 0) ? 1 : 0, dir, power: 0.25 }; }
    else if (fresh && lh.weapon === "shotgun" && lh.dd < 6 && over >= 2) how = { limb: Math.random() < 0.2 ? LIMB_ARMLEG() : 0, dir, power: 0.55 };
    else if (over >= 4) { if (Math.random() < 0.8) how = { limb: over >= 6 && Math.random() < 0.12 ? LIMB_ARMLEG() : 0, dir, power: Math.min(0.5, 0.2 + over * 0.03) }; }
    else if (cause === "fall" && ev.damage >= 10) how = { limb: 0, power: 0.05 };
  }
  if (!how) return false;
  if (!gore()) how.limb = 0;
  killHow.set(v.id, how); v9stat(how.limb ? "dismember" : "oneShot");
  return true;
}
// v9.11: real ragdolls. A dead man is a jointed body of 9 points (hips, shoulders, head, hands, feet) held together
// by bones: gravity, the shot that killed him, a blast, the ground and walls do the rest. He crumples, tumbles down
// stairs, flops over ledges, folds over cover. The points drive one body model (torso, head, two arms, two legs, each
// on its own joint), so nothing comes apart unless it's meant to: a limb or the head torn off is its own tumbling
// piece. Each body runs only while it moves (a second or two) and then sleeps; a later blast wakes it again.
const RD = new Map();                      // entity id -> sim { c, pts, cons, gib, act, still, t, sent, ... }
const RD_ACTIVE_MAX_BY = { low: 4, medium: 10, high: 16 };   // (v9.22: by the Performance setting)
const RD_G = 0.075;
const V3 = (x, y, z) => ({ x, y, z });
const vadd = (a, b) => V3(a.x + b.x, a.y + b.y, a.z + b.z), vsub = (a, b) => V3(a.x - b.x, a.y - b.y, a.z - b.z), vmul = (a, k) => V3(a.x * k, a.y * k, a.z * k);
const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z, vcross = (a, b) => V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const vlen = (a) => Math.hypot(a.x, a.y, a.z), vnorm = (a) => { const L = vlen(a) || 1; return V3(a.x / L, a.y / L, a.z / L); };
const DEG = 180 / Math.PI, clamp1 = (x) => Math.max(-1, Math.min(1, x));
const RD_F0 = V3(0, 0, 1), RD_R0 = V3(-1, 0, 0), RD_U0 = V3(0, 1, 0);      // (the body model's own front / right / up: entity yaw 0)
// points: 0 left hip, 1 right hip, 2 left shoulder, 3 right shoulder, 4 head, 5 right hand, 6 left hand, 7 right foot, 8 left foot,
// 9 right elbow, 10 left elbow, 11 right knee, 12 left knee
// rest offsets from the middle of the hips, in blocks, as [right, up, front]
const RD_REST = [[-1.9 / 16, 0, 0], [1.9 / 16, 0, 0], [-5 / 16, 10 / 16, 0], [5 / 16, 10 / 16, 0], [0, 16 / 16, 0], [5 / 16, 0, 0], [-5 / 16, 0, 0], [1.9 / 16, -12 / 16, 0], [-1.9 / 16, -12 / 16, 0],
  [5 / 16, 6 / 16, -0.02], [-5 / 16, 6 / 16, -0.02], [1.9 / 16, -6 / 16, 0.03], [-1.9 / 16, -6 / 16, 0.03]];   // (knees a touch forward: they buckle, not lock)
const RD_RAD = [0.13, 0.13, 0.13, 0.13, 0.25, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12];
const RD_MASS = [1.4, 1.4, 1.2, 1.2, 0.8, 0.35, 0.35, 0.45, 0.45, 0.4, 0.4, 0.6, 0.6];
const RD_LIMB = { 1: [4], 2: [5], 3: [6], 4: [7], 5: [8] };   // limb -> its end point (head, right arm, left arm, right leg, left leg)
const RD_BODY_PROPS = ["war:ta", "war:tb", "war:tg", "war:ha", "war:hb", "war:raa", "war:rab", "war:laa", "war:lab", "war:rla", "war:rlb", "war:lla", "war:llb", "war:rac", "war:rad", "war:lac", "war:lad", "war:rlc", "war:rld", "war:llc", "war:lld"];
const hardAt = (dim, l) => { try { const b = dim.getBlock(l); return !!b && !b.isLiquid && !passable(b); } catch { return false; } };
const RD_CELLS = new Map();   // "dim|x|y|z" -> solid? (shared by every body: they fall in the same places; cleared every 10 s)
const rdSolid = (s, x, y, z) => {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), k = s.dim.id + "|" + bx + "," + by + "," + bz;
  let v = RD_CELLS.get(k);
  if (v === undefined) { v = hardAt(s.dim, { x: bx + 0.5, y: by + 0.5, z: bz + 0.5 }); RD_CELLS.set(k, v); }
  return v;
};
system.runInterval(() => RD_CELLS.clear(), 200);
function rdCons(lying, mask) {
  const P = RD_REST.map(([r, u, f]) => V3(r, u, f)), d = (i, j) => vlen(vsub(P[i], P[j]));
  const cs = [], rig = (i, j) => cs.push([i, j, d(i, j), d(i, j)]), rng = (i, j, lo, hi) => cs.push([i, j, lo, hi]);
  for (const [i, j] of [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]) rig(i, j);                   // (the torso: one rigid piece)
  if (!(mask & 1)) { rig(4, 2); rig(4, 3); rng(4, 0, d(4, 0) * 0.86, d(4, 0)); rng(4, 1, d(4, 1) * 0.86, d(4, 1)); }   // (the neck: a nod, no more)
  if (!(mask & 2)) { rig(3, 9); rig(9, 5); rng(5, 3, 0.33, 9); rng(5, 2, 0.4, 9); rng(9, 2, 0.4, 9); }        // (arms: elbow; the hand can't go through the chest)
  if (!(mask & 4)) { rig(2, 10); rig(10, 6); rng(6, 2, 0.33, 9); rng(6, 3, 0.4, 9); rng(10, 3, 0.4, 9); }
  if (!(mask & 8)) { rig(1, 11); rig(11, 7); rng(7, 1, 0.32, 9); rng(11, 3, 0.72, 9); rng(7, 3, 0.75, 9); }   // (legs: knee; the thigh no further up than a right angle)
  if (!(mask & 16)) { rig(0, 12); rig(12, 8); rng(8, 0, 0.32, 9); rng(12, 2, 0.72, 9); rng(8, 2, 0.75, 9); }
  if (!(mask & 24)) { rng(7, 8, 0.14, 9); rng(11, 12, 0.12, 9); }
  return cs;
}
function rdFrame(p) {
  const hc = vmul(vadd(p[0], p[1]), 0.5), sc = vmul(vadd(p[2], p[3]), 0.5);
  const U = vnorm(vsub(sc, hc)); let R = vsub(p[3], p[2]); R = vnorm(vsub(R, vmul(U, vdot(R, U))));
  return { hc, U, R, F: vcross(U, R) };
}
// the angles that turn the model's bones to match the points: torso Y-X-Y (t_a, t_b, t_g); a limb Y then X from hanging down;
// the head Y then X from pointing up. (Bone X turns his top toward his front, bone Y turns his front toward his right.)
function rdTorsoAngles(fr) {
  const uF = vdot(fr.U, RD_F0), uR = vdot(fr.U, RD_R0), uU = vdot(fr.U, RD_U0);
  const b = Math.acos(clamp1(uU)), a = Math.sin(b) < 1e-3 ? 0 : Math.atan2(uR, uF);
  const Fp = vsub(vmul(vadd(vmul(RD_F0, Math.cos(a)), vmul(RD_R0, Math.sin(a))), Math.cos(b)), vmul(RD_U0, Math.sin(b)));
  const Rp = vsub(vmul(RD_R0, Math.cos(a)), vmul(RD_F0, Math.sin(a)));
  return [a * DEG, b * DEG, Math.atan2(vdot(fr.F, Rp), vdot(fr.F, Fp)) * DEG];
}
function rdLimbAngles(F, R, U, d, up, prevA) {
  const dF = vdot(d, F), dR = vdot(d, R), dU = vdot(d, U), s = up ? 1 : -1;
  const b = Math.acos(clamp1(s * dU));
  return [Math.sin(b) < 0.03 ? (prevA ?? 0) : Math.atan2(s * dR, s * dF) * DEG, b * DEG];
}
function rdAngles(s) {
  const p = s.pts.map((q) => q.p);
  if (s.gib) {
    const d = vnorm(vsub(p[1], p[0]));
    return rdLimbAngles(RD_F0, RD_R0, RD_U0, d, s.gib === 1, s.sent[0]);
  }
  const fr = rdFrame(p), out = rdTorsoAngles(fr);
  const J = (r, u) => vadd(fr.hc, vadd(vmul(fr.R, r), vmul(fr.U, u)));                    // (the joints where the model has them)
  const lim = [[J(0, 12 / 16), p[4], true], [J(5 / 16, 10 / 16), p[9], false], [J(-5 / 16, 10 / 16), p[10], false], [J(1.9 / 16, 0), p[11], false], [J(-1.9 / 16, 0), p[12], false]];
  const seg = [];
  lim.forEach(([from, to, up], i) => { const [a, b] = rdLimbAngles(fr.F, fr.R, fr.U, vnorm(vsub(to, from)), up, s.sent[3 + i * 2]); out.push(a, b); seg.push([a, b]); });
  [[9, 5], [10, 6], [11, 7], [12, 8]].forEach(([j, e], i) => {                                    // (forearm / shin: turned from the upper segment)
    const [a, b] = seg[i + 1], c1 = Math.cos(a / DEG), s1 = Math.sin(a / DEG), c2 = Math.cos(b / DEG), s2 = Math.sin(b / DEG);
    const F1 = vadd(vmul(fr.F, c1), vmul(fr.R, s1)), R1 = vsub(vmul(fr.R, c1), vmul(fr.F, s1));   // (Y turn)
    const F2 = vsub(vmul(F1, c2), vmul(fr.U, s2)), U2 = vadd(vmul(fr.U, c2), vmul(F1, s2));          // (then X turn)
    const r = rdLimbAngles(F2, R1, U2, vnorm(vsub(p[e], p[j])), false, s.sent[13 + i * 2]); out.push(r[0], r[1]);
  });
  return out;
}
function rdStep(s) {
  for (let i = 0; i < s.pts.length; i++) {
    const q = s.pts[i], r = s.rad[i];
    let vx = (q.p.x - q.o.x) * 0.99, vy = (q.p.y - q.o.y) * 0.99 - RD_G, vz = (q.p.z - q.o.z) * 0.99;
    let x = q.p.x, y = q.p.y, z = q.p.z, ground = false;
    // v9.19: a wall holds what leans on it (friction): a man dying against a wall slumps down it, he doesn't drop flat
    if (vy < 0 && !s.gib && (rdSolid(s, x + r + 0.06, y, z) || rdSolid(s, x - r - 0.06, y, z) || rdSolid(s, x, y, z + r + 0.06) || rdSolid(s, x, y, z - r - 0.06))) vy = vy < -0.2 ? vy * 0.4 : vy * 0.03;
    if (vy < 0 && rdSolid(s, x, y + vy - r, z)) { y = Math.floor(y + vy - r) + 1 + r; vy = vy < -0.2 ? -vy * 0.15 : 0; ground = true; }
    else if (vy > 0 && rdSolid(s, x, y + vy + r, z)) { vy = -vy * 0.2; }
    else y += vy;
    if (vx && rdSolid(s, x + vx + Math.sign(vx) * r, y, z)) vx = s.gib ? -vx * 0.2 : 0; else x += vx;   // (v9.19: a body stops against a wall, it doesn't bounce off it)
    if (vz && rdSolid(s, x, y, z + vz + Math.sign(vz) * r)) vz = s.gib ? -vz * 0.2 : 0; else z += vz;
    if (ground || rdSolid(s, x, y - r - 0.03, z)) { vx *= 0.55; vz *= 0.55; }                   // (dragging on the ground)
    q.o = V3(x - vx, y - vy, z - vz); q.p = V3(x, y, z);
  }
  for (let it = 0; it < 6; it++) {
    for (const [i, j, lo, hi] of s.cons) {
      const a = s.pts[i], b = s.pts[j], dv = vsub(b.p, a.p), L = vlen(dv) || 1e-6;
      const t = L < lo ? lo : L > hi ? hi : L; if (t === L) continue;
      const wa = 1 / s.mass[i], wb = 1 / s.mass[j], k = (L - t) / L / (wa + wb);
      a.p = vadd(a.p, vmul(dv, k * wa)); b.p = vsub(b.p, vmul(dv, k * wb));
    }
    if (!s.gib && it % 2 === 1) {                                                                  // (knees bend forward only, elbows back only)
      const F = rdFrame(s.pts.map((q) => q.p)).F;
      for (const [top, mid, end, sg] of s.hinges) {
        const m = vmul(vadd(s.pts[top].p, s.pts[end].p), 0.5), off = vdot(vsub(s.pts[mid].p, m), F) * sg;
        if (off < -0.004) s.pts[mid].p = vadd(s.pts[mid].p, vmul(F, -off * sg));
      }
    }
  }
  if (s.near) for (const o of s.near) {                                                            // (v9.14: bodies pile up on each other, no clipping)
    if (!o.c?.isValid) continue;
    for (const q of s.pts) for (const [i, j, lo, hi] of o.cons) {                                   // (against the other body's bones, not just its joints)
      if (lo !== hi) continue;
      const a = o.pts[i].p, b = o.pts[j].p, ab = vsub(b, a), L2 = vdot(ab, ab) || 1e-6;
      const k = Math.max(0, Math.min(1, vdot(vsub(q.p, a), ab) / L2)), c = vadd(a, vmul(ab, k)), n = vsub(q.p, c), d = vlen(n);
      if (d >= 0.24) continue;
      const nn = d > 1e-4 ? vmul(n, 1 / d) : V3(0, 1, 0), up = nn.y > -0.2 ? V3(nn.x * 0.4, Math.max(nn.y, 0.6), nn.z * 0.4) : nn;   // (mostly up: he lands on it)
      const L = vlen(up) || 1; q.p = vadd(c, vmul(up, 0.24 / L));
      if (q.o.y < q.p.y - 0.02 && q.p.y - q.o.y > 0) q.o = V3(q.o.x, Math.min(q.o.y, q.p.y), q.o.z);
      q.o = V3(q.p.x - (q.p.x - q.o.x) * 0.6, Math.max(q.o.y, q.p.y - 0.01), q.p.z - (q.p.z - q.o.z) * 0.6);   // (friction on him)
    }
  }
  let mv = 0;
  for (let i = 0; i < s.pts.length; i++) {                                                         // (nothing ends up inside a block)
    const q = s.pts[i], r = s.rad[i];
    if (rdSolid(s, q.p.x, q.p.y - r, q.p.z) && !rdSolid(s, q.p.x, q.p.y - r + 1, q.p.z)) { const ny = Math.floor(q.p.y - r) + 1 + r; q.o = V3(q.o.x, q.o.y + (ny - q.p.y), q.o.z); q.p = V3(q.p.x, ny, q.p.z); }
    mv = Math.max(mv, vlen(vsub(q.p, q.o)));
  }
  s.t++; s.still = mv < (s.t > 50 ? 0.03 : 0.006) ? s.still + 1 : 0;
  return s.still >= 8 || s.t >= 160;
}
function rdRender(s, final) {
  const c = s.c; if (!c?.isValid) return;
  const p = s.pts.map((q) => q.p);
  const at = s.gib ? vmul(vadd(p[0], p[1]), 0.5) : vmul(vadd(p[0], p[1]), 0.5);
  if (final || !s.at || Math.abs(at.x - s.at.x) + Math.abs(at.y - s.at.y) + Math.abs(at.z - s.at.z) > 0.015) { try { c.teleport(at, { rotation: { x: 0, y: 0 } }); s.at = at; } catch {} }   // (not moved: nothing to send)
  const ang = rdAngles(s), keys = s.gib ? ["war:ga", "war:gb"] : RD_BODY_PROPS;
  ang.forEach((v, i) => { const val = Math.round(v * 10) / 10; if (final || s.sent[i] === undefined || Math.abs(val - s.sent[i]) >= 1.5) { try { c.setProperty(keys[i], Math.max(-180, Math.min(180, val))); s.sent[i] = val; } catch {} } });
  if (s.squirt && s.t < 50 && s.t % 4 === 0 && gore()) {                                            // (a stump keeps pumping for a while)
    const from = s.gib ? p[0] : s.squirt.map((i) => p[i]).reduce((a, b) => vadd(a, vmul(b, 1 / s.squirt.length)), V3(0, 0, 0));
    sprayBlood(s.dim, from, 0);
  }
}
// v9.14: the cheap way down: laid flat along the way he was going, on his back or his face, on the ground under him
function rdLay(s) {
  const p = s.pts.map((q) => q.p), hc = vmul(vadd(p[0], p[1]), 0.5);
  if (s.gib) { const L = vlen(vsub(p[1], p[0])); let y = hc.y; for (let k = 0; k < 6 && !rdSolid(s, hc.x, y - 0.2, hc.z); k++) y -= 1; y = Math.floor(y - 0.2) + 1.12; s.pts[0].p = s.pts[0].o = V3(hc.x - L / 2, y, hc.z); s.pts[1].p = s.pts[1].o = V3(hc.x + L / 2, y, hc.z); return; }
  const v = vsub(s.pts[2].p, s.pts[2].o), L0 = Math.hypot(v.x, v.z), dir = L0 > 0.01 ? V3(v.x / L0, 0, v.z / L0) : V3(1, 0, 0);
  const up = Math.random() < 0.65, U = dir, F = up ? V3(0, 1, 0) : V3(0, -1, 0), R = vcross(F, U);
  let y = hc.y; for (let k = 0; k < 6 && !rdSolid(s, hc.x, y - 0.2, hc.z); k++) y -= 1; y = Math.floor(y - 0.2) + 1.13;
  const base = V3(hc.x, y, hc.z), spread = [0, 0, 0, 0, 0, 0.25 + Math.random() * 0.3, -0.25 - Math.random() * 0.3, 0.06, -0.06, 0.12, -0.12, 0.03, -0.03];
  RD_REST.forEach(([r, u, f], i) => { const q = vadd(base, vadd(vmul(R, r + (spread[i] ?? 0)), vmul(U, u))); s.pts[i].p = q; s.pts[i].o = q; });
}
// a new body (or a torn-off piece) from where the man stood
function rdStart(c, gibIdx, pts, vel, mask, squirt) {
  const s = { c, dim: c.dimension, gib: gibIdx, cells: RD_CELLS, t: 0, still: 0, sent: gibIdx ? [] : RD_BODY_PROPS.map(() => 0), squirt,
    pts: pts.map((p, i) => ({ p, o: vsub(p, vel[i]) })) };
  if (gibIdx) { const L = vlen(vsub(pts[1], pts[0])); s.cons = [[0, 1, L, L]]; s.rad = [0.12, 0.12]; s.mass = [1, 1]; }
  else { s.cons = rdCons(false, mask); s.rad = RD_RAD; s.mass = RD_MASS; s.hinges = [[3, 9, 5, -1], [2, 10, 6, -1], [1, 11, 7, 1], [0, 12, 8, 1]].filter(([, , e]) => !(mask & { 5: 2, 6: 4, 7: 8, 8: 16 }[e])); }
  RD.set(c.id, s); s.act = true;
  const actives = [...RD.values()].filter((q) => q.act).length;
  if ((actives > (RD_ACTIVE_MAX_BY[perfLevel()] ?? 10) || (lodOn() && !playerNearAt(c.dimension.id, c.location, 48))) && !s.fall) { rdLay(s); s.act = false; rdRender(s, true); }   // (v9.22: or nobody near enough to watch it fall)   // (too many falling at once: this one is laid down where he fell, no physics)   // (too many falling at once: this one falls in one go)
  else rdRender(s, true);
  return s;
}
let RD_RR = 0;
system.runInterval(() => {
  if (!RD.size) return;
  const t0 = Date.now(), all = [...RD];
  const n = all.length, start = RD_RR % Math.max(1, n); RD_RR++;
  for (let k = 0; k < n; k++) {
    const [id, s] = all[(start + k) % n];
    if (Date.now() - t0 > ({ low: 1.5, medium: 3, high: 5 }[perfLevel()] ?? 3)) break;                 // (v9.14: ms a tick for all of them, by the Performance setting; the rest go on next tick)
    try {
      if (!s.c?.isValid) { RD.delete(id); continue; }
      if (!s.act) continue;
      if (s.t % 10 === 0) { const h0 = s.pts[0].p; s.near = [...RD.values()].filter((o) => o !== s && !o.gib && o.dim.id === s.dim.id && Math.abs(o.pts[0].p.x - h0.x) < 2.5 && Math.abs(o.pts[0].p.z - h0.z) < 2.5 && Math.abs(o.pts[0].p.y - h0.y) < 2.5); }
      let done = rdStep(s);
      if (s.fall && s.t >= 70) done = true;
      if (done || s.t < 10 || s.t % 3 === 0) rdRender(s, done);                                // (v9.17: every tick while he drops, so the fall isn't choppy; then every 3rd)
      if (done && s.fall) { finishFall(s); RD.delete(id); continue; }
      if (done) { s.act = false; if (!s.gib && !s.pooled && !s.fall && gore()) { s.pooled = true; const p0 = s.pts[0].p, p1 = s.pts[1].p, p2 = s.pts[2].p; try { s.dim.spawnParticle("war:bpool", { x: (p0.x + p1.x + p2.x) / 3, y: Math.min(p0.y, p1.y) - 0.1, z: (p0.z + p1.z + p2.z) / 3 }); } catch {} } }
    } catch (err) { RD.delete(id); oops("ragdoll", err); }
  }
  const ms = Date.now() - t0; if (ms > (globalThis.__rdMs ?? 0)) globalThis.__rdMs = ms; globalThis.__rdTot = (globalThis.__rdTot ?? 0) + ms;
}, 1);
function rdShot(dim, from, u, end) {
  for (const s of RD.values()) {
    if (s.dim.id !== dim.id) continue;
    const h = s.pts[0].p, hx = h.x - from.x, hy = h.y - from.y, hz = h.z - from.z, t0 = hx * u.x + hy * u.y + hz * u.z;
    if (t0 < -1.5 || t0 > end + 1.5) continue;
    if (Math.hypot(hx - u.x * t0, hy - u.y * t0, hz - u.z * t0) > 2) continue;
    for (const q of s.pts) {
      const qx = q.p.x - from.x, qy = q.p.y - from.y, qz = q.p.z - from.z, t = qx * u.x + qy * u.y + qz * u.z;
      if (t < 0 || t > end) continue;
      if (Math.hypot(qx - u.x * t, qy - u.y * t, qz - u.z * t) > 0.28) continue;
      q.o = vsub(q.o, V3(u.x * 0.34, 0.12 + u.y * 0.1, u.z * 0.34));                              // (a jolt: up off the ground and along the round)
      s.act = true; s.still = 0; s.t = Math.min(s.t, 100);
      if (gore()) sprayBlood(dim, q.p, 0);
      return;                                                                                       // (one body per round)
    }
  }
}
function rdBlast(dim, at, power) {                                                                 // (a blast throws the dead too)
  for (const s of RD.values()) {
    if (s.dim.id !== dim.id) continue;
    for (const q of s.pts) {
      const dv = vsub(q.p, at), L = vlen(dv); if (L > power * 2.2) continue;
      const k = Math.min(0.9, (power * 2.2 - L) * 0.16), n = vnorm(V3(dv.x, Math.max(0.3, dv.y + 0.4), dv.z));
      q.o = vsub(q.o, vmul(n, k * (0.8 + Math.random() * 0.4)));
      s.act = true; s.still = 0; s.t = Math.min(s.t, 60);
    }
  }
}
// blood: a spray of drops that fly, land and leave splats on the ground (crit: a big burst)
function sprayBlood(dim, at, crit) {
  if (!gore()) return;
  try { const m = new MolangVariableMap(); m.setFloat("variable.crit", crit ? 1 : 0); dim.spawnParticle("war:bspray", at, m); } catch { try { dim.spawnParticle("war:bspray", at); } catch {} }
}
// v9.14: a wounded man drops the way the dead do (the same physics), then lies where he fell: while his body falls the
// soldier himself is hidden; when it comes to rest he's put down there, lying the way it lies, and carries on wounded.
const FALLS = new Map();   // soldier id -> fall body id
function downFall(e) {
  try {
    if (FALLS.has(e.id) || !e.isValid) return;
    const on = e.getComponent("minecraft:riding")?.entityRidingOn;
    if (on) { try { on.getComponent("minecraft:rideable")?.ejectRider(e); } catch {} mountOf.delete(e.id); }   // (thrown from the saddle)
    const lh = lastHit.get(e.id), how = { fall: true, dir: lh && tick() - lh.t <= 3 ? lh.dir : undefined, power: 0.18, head: lh?.head };
    const b = spawnCorpse(e, how); if (!b) return;
    FALLS.set(e.id, b.id);
    setP(e, "war:hide", true); equip(e, "air");
  } catch {}
}
function finishFall(s) {
  const id = s.fall; FALLS.delete(id);
  try { s.c?.remove(); } catch {}
  const e = world.getEntity(id); if (!e?.isValid) return;
  try {
    const p = s.pts.map((q) => q.p), fr = rdFrame(p), hips = vmul(vadd(p[0], p[1]), 0.5);
    let hx = fr.U.x, hz = fr.U.z; const L = Math.hypot(hx, hz) || 1; hx /= L; hz /= L; if (L < 0.05) { hx = 1; hz = 0; }
    let at = { x: hips.x - hx * 0.75, y: hips.y - 0.13, z: hips.z - hz * 0.75 };                 // (his feet: the downed pose lies back from them)
    if (solidAt(e.dimension, { x: at.x, y: at.y + 0.3, z: at.z })) at = { x: hips.x, y: hips.y - 0.13, z: hips.z };
    e.teleport(at, { rotation: { x: 0, y: (Math.atan2(hx, -hz) * 180) / Math.PI } });
    if (downed.has(id)) downPos.set(id, { ...at });
  } catch {}
  try { setP(e, "war:hide", false); equip(e, weaponItem(e)); } catch {}
}
function spawnCorpse(v, how) { const T0 = Date.now(); try { return spawnCorpse0(v, how); } finally { globalThis.__scTot = (globalThis.__scTot ?? 0) + Date.now() - T0; globalThis.__scN = (globalThis.__scN ?? 0) + 1; } }
function spawnCorpse0(v, how) {
  const dim = v.dimension, l = v.location, now = tick();
  const f = Number(P(v, "war:faction") ?? 0), med = !!P(v, "war:medic"), yaw = (() => { try { return v.getRotation().y; } catch { return 0; } })();
  let sk = 0, cav = false; try { sk = Number(v.getProperty("war:skin") ?? 0); cav = !!v.getProperty("war:cav"); } catch {}   // (the skin he's drawn with: his own, or his faction's)
  if (!sk) sk = Number(gdp(v, "p_war:skin") ?? 0) || factionSkinFor(v, f);
  let mo = V3(0, 0, 0); try { const q = v.getVelocity(); mo = V3(Math.max(-0.4, Math.min(0.4, q.x)), 0, Math.max(-0.4, Math.min(0.4, q.z))); } catch {}
  const mask = gore() && !how?.fall ? (how?.mask ?? (how?.limb ? 1 << (how.limb - 1) : 0)) : 0;
  const make = (at, gibIdx) => {
    const c = dim.spawnEntity("war:corpse", at);
    try { c.setProperty("war:faction", Math.max(0, Math.min(40, f))); c.setProperty("war:skin", Math.max(0, Math.min(64, sk))); c.setProperty("war:medic", med); try { c.setProperty("war:cav", cav); } catch {} try { c.setProperty("war:armor", Math.max(0, ARMOR.indexOf(String(gdp(v, "war:armor") ?? "none")))); } catch {} if (gibIdx) { c.setProperty("war:gib", true); c.setProperty("war:limb", gibIdx); } else c.setProperty("war:limb", mask); c.setRotation({ x: 0, y: 0 }); } catch {}
    stampBody(c, now);
    if (!how?.fall) CORPSES.push({ id: c.id, t: now });
    return c;
  };
  // where his joints are now: standing (or lying, if he was already down), facing where he faced
  const Fs = V3(-Math.sin(yaw / DEG), 0, Math.cos(yaw / DEG)), Us = V3(0, 1, 0), Rs = vcross(Fs, Us);
  let F = Fs, U = Us, R = Rs, hc = V3(l.x, l.y + 0.76, l.z);
  if (how?.lying) { U = vmul(Fs, -1); F = Us; hc = vadd(V3(l.x, l.y + 0.14, l.z), vmul(Fs, -0.75)); }
  const pts = RD_REST.map(([r, u, fw]) => vadd(hc, vadd(vmul(R, r), vadd(vmul(U, u), vmul(F, fw)))));
  // how the blow moves each part: a round pushes the upper body most (he folds), a headshot snaps the head, a blast throws everything
  const dir = how?.dir ?? vmul(Fs, -1), pw = how?.power ?? 0.15, blast = pw >= 0.45;
  const base = blast ? 0.12 + pw * 0.22 : 0.06 + pw * 0.22, share = [0.6, 0.6, 1.25, 1.25, 1.5, 1.3, 1.3, 0.15, 0.15, 1.25, 1.25, 0.35, 0.35];
  const vel = pts.map((p, i) => {
    let v0 = vmul(V3(dir.x, 0, dir.z), base * (blast ? 1 : share[i]));
    if (blast) v0 = vadd(v0, V3((Math.random() - 0.5) * 0.18, 0.2 + pw * 0.2 + Math.random() * 0.1, (Math.random() - 0.5) * 0.18));
    else v0 = vadd(v0, V3((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.03));
    if (i === 4 && how?.head) v0 = vadd(v0, vmul(V3(dir.x, 0.15, dir.z), 0.22));
    if (i === 11 || i === 12) v0 = vadd(v0, vmul(R, (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.03)));   // (knees fall to a side)
    return vadd(v0, vmul(mo, i >= 7 && i !== 9 && i !== 10 ? 0.4 : 1));                       // (a running man keeps going: his feet catch)
  });
  const squirt = mask & 1 ? [2, 3] : mask & 2 ? [3] : mask & 4 ? [2] : mask & 8 ? [1] : mask & 16 ? [0] : undefined;
  const body = make(hc, 0);
  const bs = rdStart(body, 0, pts, vel, mask, squirt);
  if (how?.fall) { bs.fall = v.id; bs.act = true; return body; }   // (v9.14: a wounded man's fall: no gibs, no burst)
  // torn-off pieces: their own physics, thrown harder
  const GIB = { 1: [[2, 3], 4, 1], 2: [[3], 5, 2], 3: [[2], 6, 3], 4: [[1], 7, 4], 5: [[0], 8, 5] };
  for (let k = 1; k <= 5; k++) {
    if (!(mask & (1 << (k - 1)))) continue;
    const [js, end, gi] = GIB[k];
    let a = js.map((j) => pts[j]).reduce((s2, q) => vadd(s2, vmul(q, 1 / js.length)), V3(0, 0, 0));
    if (k === 1) a = vadd(a, vmul(U, 2 / 16));
    const b = k === 1 ? vadd(a, vmul(U, 0.5)) : pts[end];
    const g = make(vmul(vadd(a, b), 0.5), gi), kick = blast ? 0.25 : 0.12;
    const ga = Math.random() * Math.PI * 2, side = V3(Math.cos(ga) * kick, 0.2 + Math.random() * 0.15, Math.sin(ga) * kick);
    const va = vadd(vmul(vel[end], 0.85), side), vb = vadd(va, V3((Math.random() - 0.5) * 0.3, 0.1, (Math.random() - 0.5) * 0.3));
    rdStart(g, gi, [a, b], [va, vb], 0, [0]);
    try { dim.playSound("war.gibs", a, { volume: 0.9 }); } catch {}
  }
  sprayBlood(dim, chest(v), mask || how?.head || blast ? 1 : 0);
  return body;
}
world.afterEvents.entityDie.subscribe((ev) => {
  const v = ev.deadEntity;
  try {
    if (v?.typeId !== SOLDIER || held.has(v.id)) return;
    const how = killHow.get(v.id); killHow.delete(v.id); lastHit.delete(v.id);
    const fb = FALLS.get(v.id);
    if (fb) { FALLS.delete(v.id); const st = RD.get(fb); if (st) { st.fall = undefined; CORPSES.push({ id: fb, t: tick() }); bodyKit(v, fb); system.run(() => { try { if (v.isValid) v.remove(); } catch {} }); return; } }
    const h2 = how ?? { dir: undefined, power: 0.12 }; if (downed.has(v.id)) h2.lying = true;   // (killed where he lay: he's already down)
    try { v.setProperty("war:hide", true); } catch {}                    // (v9.19: gone the same tick the body appears: no double, no red death tilt)
    const body = spawnCorpse(v, h2); if (body) bodyKit(v, body.id);
    system.run(() => { try { if (v.isValid) v.remove(); } catch {} });          // (the body takes his place: no death spin)
  } catch {}
});
function bleed(v, dir, big) {                                                       // v9.11: blood where he's hit
  if (!gore()) return;
  try { const c = chest(v); sprayBlood(v.dimension, dir ? { x: c.x + dir.x * 0.25, y: c.y, z: c.z + dir.z * 0.25 } : c, big); } catch {}
}
const hitDir = (v, src) => { try { const lh = lastHit.get(v.id); if (lh && tick() - lh.t <= 1 && lh.dir) return lh.dir; if (src?.isValid) { const dx = v.location.x - src.location.x, dz = v.location.z - src.location.z, L = Math.hypot(dx, dz) || 1; return { x: dx / L, y: 0, z: dz / L }; } } catch {} return undefined; };
world.afterEvents.entityHurt.subscribe((ev) => {                                  // blood on every hit
  try { const v = ev.hurtEntity; if (v?.typeId !== SOLDIER || !gore() || ev.damage < 1) return; const now = tick(); if (now - (bloodT.get(v.id) ?? -99) < 4) return; bloodT.set(v.id, now); let src; try { src = ev.damageSource?.damagingEntity; } catch {} bleed(v, hitDir(v, src), false); } catch {}
});
const bloodT = new Map();
try {
  world.beforeEvents.entityRemove.subscribe((ev) => {                          // v9.9: a blast that would break a body throws it instead
    try {
      const c = ev.removedEntity; if (c?.typeId !== "war:corpse") return;
      const now = tick(), at = c.location, dimId = c.dimension.id;
      const b = BLASTS.find((q) => q.dim === dimId && now - q.t <= 3 && dist(q.at, at) <= q.power * 2 + 1); if (!b) return;
      const pr = {}; for (const k of ["war:faction", "war:skin", "war:medic", "war:limb", "war:gib", "war:ga", "war:gb", "war:cav", "war:armor", ...RD_BODY_PROPS]) { try { pr[k] = c.getProperty(k); } catch {} }
      const old = c.id, st = RD.get(old);
      let bs, bt; try { bs = c.getDynamicProperty("war:bs"); bt = c.getDynamicProperty("war:bt"); } catch {}
      if (bs !== BODY_SESSION) return;                                           // (a body from an earlier load: let it go)
      system.run(() => {
        try {
          const dim = world.getDimension(dimId), n = dim.spawnEntity("war:corpse", { x: at.x, y: at.y + 0.1, z: at.z });
          stampBody(n, Number(bt ?? now));
          for (const k in pr) try { if (pr[k] !== undefined) n.setProperty(k, pr[k]); } catch {}
          try { n.setRotation({ x: 0, y: 0 }); } catch {}
          if (st) { RD.delete(old); st.c = n; st.sent = []; RD.set(n.id, st); st.act = true; st.still = 0; }
          const e = CORPSES.find((q) => q.id === old); if (e) e.id = n.id; else CORPSES.push({ id: n.id, t: now });
        } catch {}
      });
    } catch {}
  });
} catch {}
system.runInterval(() => {
  const now = tick();
  // (v9.19: no more "a minute, then gone": that popped bodies away in front of the player. pruneBodies decides, out of sight)
  for (const [id, h] of [...lastHit]) if (now - h.t > 40) lastHit.delete(id);
  if (bloodT.size > 2000) bloodT.clear();
}, 40);
system.runTimeout(() => { try { for (const dim of DIMS.map((d) => world.getDimension(d))) for (const c of dim.getEntities({ type: "war:corpse" })) clearBody(c); } catch {} }, 100);   // (bodies left from before a reload)
// v9.21.1: bodies never stay forever. Each body carries the load (session) it was made in and when. A body from an
// earlier load, or older than 10 minutes, is cleared whenever it turns up: when its ground is loaded again (walking
// back to an old battlefield), or by a sweep every 30 s. Before, only bodies in loaded ground were cleared at startup,
// and a body that was unloaded (you walked away) was forgotten and then stayed for good. One in a player's view sinks
// into the ground over a few seconds instead of vanishing.
const BODY_SESSION = 1 + Math.floor(Math.random() * 2e9);
function stampBody(c, born) { try { c.setDynamicProperty("war:bs", BODY_SESSION); c.setDynamicProperty("war:bt", born ?? tick()); } catch {} }
function bodyState(c, now) {
  try {
    if (c.getDynamicProperty("war:bs") !== BODY_SESSION) return "old";
    return now - Number(c.getDynamicProperty("war:bt") ?? 0) > BODY_LIFE ? "expired" : "ok";
  } catch { return "old"; }
}
const BODY_LIFE = 12000;   // 10 minutes
function clearBody(c) {
  try {
    if (!c?.isValid) return;
    const id = c.id;
    if (SINKING.has(id)) return;
    RD.delete(id);
    if (bodySeen(c)) { SINKING.set(id, 60); return; }                         // (in view: sinks out of sight)
    c.remove();
    const i = CORPSES.findIndex((o) => o.id === id); if (i >= 0) CORPSES.splice(i, 1);
  } catch {}
}
function sweepBodies() {
  const now = tick(), falling = new Set(FALLS.values()), known = new Set(CORPSES.map((o) => o.id));
  let n = 0;
  for (const dim of DIMS.map((d) => world.getDimension(d))) {
    let list = []; try { list = dim.getEntities({ type: "war:corpse" }); } catch {}
    for (const c of list) {
      if (falling.has(c.id) || SINKING.has(c.id)) continue;
      const st = bodyState(c, now);
      if (st !== "ok") { clearBody(c); n++; continue; }
      if (!known.has(c.id)) CORPSES.push({ id: c.id, t: Number(c.getDynamicProperty("war:bt") ?? now) });   // (back in loaded ground: counted again)
    }
  }
  if (n) CORPSES.sort((a, b) => a.t - b.t);
  return n;
}
system.runInterval(() => { try { sweepBodies(); } catch {} }, 600);
try {
  world.afterEvents.entityLoad.subscribe((ev) => {
    try {
      const c = ev.entity; if (c?.typeId !== "war:corpse") return;
      system.runTimeout(() => { try { if (c.isValid && ![...FALLS.values()].includes(c.id) && bodyState(c, tick()) !== "ok") clearBody(c); } catch {} }, 10);
    } catch {}
  });
} catch {}

const CIVILIANS = ["minecraft:villager_v2", "minecraft:villager", "minecraft:wandering_trader"];
world.beforeEvents.entityHurt.subscribe((ev) => {
  try {
    const v = ev.hurtEntity;
    if (v?.typeId === "war:corpse") {                                        // v9.9: a body can't be broken (v9.11: blasts throw it through its ragdoll)
      ev.cancel = true;
      return;
    }
    if (v && held.has(v.id)) { ev.cancel = true; return; }                   // v6.3: carried with the TP wand: untouchable
    const src = ev.damageSource?.damagingEntity;
    if (v?.typeId === SOLDIER && src?.typeId === "minecraft:player" && mainhand(src) === TP_WAND) {   // v6.3: the TP wand picks him up, no harm done
      ev.cancel = true;
      system.run(() => { try { pickUp(src, v); } catch (err) { oops("tp wand", err); } });
      return;
    }
    if (v?.typeId === SOLDIER && (src?.typeId === SOLDIER || src?.typeId === HOUND) && (pows.has(v.id) || gdp(v, "war:surr"))) { ev.cancel = true; return; }   // v9.19: soldiers never cut down a prisoner or a man with his hands up
    if (v?.typeId === SOLDIER && !downed.has(v.id) && meleeDuel(v, ev)) { ev.cancel = true; return; }   // v9.19: parried
    if (src?.typeId === SOLDIER && String(ev.damageSource?.cause ?? "") === "entityAttack") chargeBlow(src, v, ev);   // v9.19: a charging rider's blow
    if (v && v.typeId !== SOLDIER && v.typeId !== "minecraft:player" && RIDDEN.has(v.id)) system.run(() => horseShy(v));   // v9.19: a mount that's hit shies
    if (v?.typeId === SOLDIER && !downed.has(v.id) && SHIELD_ON.get(v.id)) {   // v9.15: a shield takes what comes at it from the front
      const r = shieldBlock(v, ev);
      if (r >= 1) { ev.cancel = true; return; }
      if (r > 0) ev.damage = ev.damage * (1 - r);
    }
    if (v?.typeId === SOLDIER && !downed.has(v.id)) {
      const cause = String(ev.damageSource.cause ?? "");
      const h = hpOf(v);
      const noDown = ["houndmaster"].includes(String(gdp(v, "war:div") ?? ""));   // (v6.9.3: dog handlers just die; v9.14: riders go down, thrown from the saddle)
      if (h && ev.damage >= hpBefore(v, h, ev.damage) && cause !== "void" && !dying.has(v.id) && !noDown && !oneShot(v, ev, cause)) {   // (v9.7: some hits kill outright)
        ev.cancel = true;                                            // falls wounded instead of dying
        let killer; try { killer = ev.damageSource?.damagingEntity; } catch {}
        const bd = hitDir(v, killer);
        system.run(() => { try { if (v.isValid) { const hh = hpOf(v); if (hh) hh.setCurrentValue(1); bleed(v, bd, false); goDown(v, killer); } } catch {} });
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
    const item = { "war:boat": "war:boat_item", "war:plane": "war:plane_item", "war:tank": "war:tank_item", "war:mg_nest": "war:mg_nest_item", "war:truck": "war:truck_item", "war:gunboat": "war:gunboat_item", "war:heli": "war:heli_item" }[t.typeId];
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
  "war:truck": "§7W/S drive · mouse steer · baton menu",
  "war:gunboat": "§7W/S throttle · mouse steer · gunner (2nd seat, or you): left-click the MG · baton menu",
  "war:heli": "§7W/S fly · mouse steer · look up/down: climb/descend · door gun: left-click · baton menu",
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
  if (!v || v.typeId === "war:boat" || v.typeId === "war:truck") return;
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
      if (rayHit(v.dimension, from, dir, reach)) return true;
    } catch {}
  }
  return false;
}
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
  if (!WATERCRAFT.includes(v.typeId)) {
    const loc0 = v.location;
    let wet = false;
    try { wet = !!v.dimension.getBlock({ x: loc0.x, y: loc0.y + (v.typeId === "war:tank" || v.typeId === "war:truck" ? 1.0 : 0.3), z: loc0.z })?.typeId.includes("water"); } catch {}
    if (wet) { // deep water: tanks flood, planes ditch
      say(`§7A ${{ "war:plane": "war plane", "war:heli": "helicopter", "war:truck": "truck" }[v.typeId] ?? "tank"} went into the water ${placeName(v.dimension, loc0)}.`);
      if (v.typeId === "war:plane" || v.typeId === "war:heli") { crashPlane(v, riders); return; }
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
  const gunner = v.typeId === "war:tank" || MG_SEAT.includes(v.typeId) ? players[1] ?? pilot : pilot; // 2nd player in a tank aims and fires (v9.2: and mans the gunboat's / helicopter's MG)
  const st = vstate.get(v.id) ?? { speed: 0, last: v.location, cd: 0, age: 0, dir: undefined };
  st.age++;
  const loc = v.location, vel = v.getVelocity();
  const ground = solidAt(v.dimension, { x: loc.x, y: loc.y - 0.2, z: loc.z });
  if (pilot && st.age % 5 === 0 && v.typeId !== "war:plane" && v.typeId !== "war:heli") {
    const bar = reloadBar(v, st);
    const role = v.typeId === "war:tank" && gunner !== pilot ? `§7Driver · gunner: ${gunner.name}` : HUD[v.typeId] ?? "";
    try { pilot.onScreenDisplay.setActionBar(bar ? `${bar}\n${role}` : role); } catch {}
    if (gunner && gunner !== pilot) { try { gunner.onScreenDisplay.setActionBar(`${bar}\n§7Gunner · aim with mouse · left-click fire`); } catch {} }
    if (v.typeId === "war:tank" && gunner) { const a = aimPoint(v, gunner); if (a.hit) marker3(v.dimension, a.point, "minecraft:villager_happy"); }
  }
  const jump = gunner ? consumeFire(gunner) : false;
  if (gunner && gunner !== pilot) consumeFire(pilot); // the driver's clicks don't fire

  if (MG_SEAT.includes(v.typeId) && jump && gunner) vehicleMG(v, gunner);   // (v9.2: the mounted MG: a burst per click)
  if (v.typeId === "war:heli") { heliFly(v, st, pilot, riders, loc, ground); st.last = { x: loc.x, y: loc.y, z: loc.z }; st.dim = v.dimension.id; vstate.set(v.id, st); return; }
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
    const boat = WATERCRAFT.includes(v.typeId);
    let target = { x: 0, z: 0 };
    if (pilot) {
      const mv = pilot.inputInfo.getMovementVector();
      const yaw = turnToward(v.getRotation().y, pilot.getRotation().y, boat ? 5 : 3.5);
      v.setRotation({ x: 0, y: yaw });
      let inWater = false;
      if (boat) { try { inWater = !!v.dimension.getBlock({ x: loc.x, y: loc.y - 0.1, z: loc.z })?.isLiquid || !!v.dimension.getBlock(loc)?.isLiquid; } catch {} }
      const max = boat ? (inWater ? (v.typeId === "war:gunboat" ? 0.6 : 0.45) : 0.04) : v.typeId === "war:truck" ? 0.32 : 0.22;
      const f = fwdFromYaw(yaw);
      const sp = mv.y * (mv.y < 0 ? max * 0.5 : max);
      target = { x: f.x * sp, z: f.z * sp };
      if (v.typeId === "war:tank" && jump && st.cd <= tick()) {
        st.cd = tick() + RELOAD["war:tank"];
        fireShell(v, gunner);
      }
    }
    else if (CREW_DRIVEN.includes(v.typeId) && riders[0]?.typeId === SOLDIER) target = crewDrive(v, riders, st, loc, vel, boat);   // (v9.19: a soldier at the wheel)
    v.applyImpulse({ x: (target.x - vel.x) * 0.5, y: 0, z: (target.z - vel.z) * 0.5 });
    if (v.typeId === "war:tank" && st.age % 20 === 0) {
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
  if (!["war:plane", "war:tank", "war:truck", "war:gunboat", "war:heli"].includes(v.typeId)) return;
  let loc, dim;
  try { loc = v.location; dim = v.dimension; } catch {
    const st = vstate.get(v.id);
    if (!st) return;
    loc = st.last; dim = world.getDimension(st.dim ?? "overworld");
  }
  if (v.typeId === "war:plane" || v.typeId === "war:heli") {
    for (const id of riderCache.get(v.id) ?? []) { try { world.getEntity(id)?.kill(); } catch {} }
  }
  chronLog(`A ${{ "war:plane": "war plane was shot down", "war:heli": "helicopter was shot down", "war:truck": "truck was destroyed", "war:gunboat": "gunboat was sunk" }[v.typeId] ?? "tank was destroyed"} ${placeName(dim, loc)}.`);
  explode(dim, loc, v.typeId === "war:plane" || v.typeId === "war:heli" ? 5 : 3, { breaksBlocks: !!setting("blockdmg", true), causesFire: v.typeId === "war:plane" || v.typeId === "war:heli" });
});

// Players always get in: soldiers make room (and never keep the driver's seat).
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  try {
    const n = ev.target;
    if (n?.typeId === "war:corpse") { ev.cancel = true; return; }           // v9.9: (a body takes no armour, no items)
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
  if (v && isMount(v)) {                                        // (v9.2: your horse / camel / boat: a soldier on it makes room for you)
    try {
      const rd = v.getComponent("minecraft:rideable"), rs = rd?.getRiders() ?? [];
      if (rs.some((r) => r.id === p.id)) return;
      const sol = rs.filter((r) => r.typeId === SOLDIER);
      if (!sol.length) return;
      ev.cancel = true;
      system.run(() => {
        try {
          for (const s0 of sol) { rd.ejectRider(s0); mountOf.delete(s0.id); }
          rd.addRider(p);
          if (rd.seatCount > 1) system.runTimeout(() => { for (const s0 of sol.slice(0, rd.seatCount - 1)) { try { if (s0.isValid && !isRiding(s0)) mountSoldier(s0, v, true); } catch {} } }, 10);
        } catch {}
      });
    } catch {}
    return;
  }
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
  const af = new ActionFormData().title({ "war:plane": "War Plane", "war:tank": "Tank", "war:truck": "Transport Truck", "war:gunboat": "Coast Guard Gunboat", "war:heli": "Transport Helicopter" }[v.typeId] ?? "Troop Boat")
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
    case "war:truck_item": return run(() => placeVehicle(player, "war:truck"));
    case "war:gunboat_item": return run(() => placeVehicle(player, "war:gunboat"));
    case "war:heli_item": return run(() => placeVehicle(player, "war:heli"));
    case "war:war_horn": return run(() => blowHorn(player));
    case "war:signal_flag": return run(async () => giveSignal(player, SIG_SEL.get(player.id) ?? 0));
    case "war:first_aid": return run(() => firstAid(player, target));
    case "war:guide": return run(() => guideBook(player));
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
  const WL = (div === "cavalier" ? CAV_WEAPONS : [...WEAPONS, ["mixguns", "Mixed guns (rifle / SMG / semi-auto / MG)"], ["mixmelee", "Mixed melee (swords + crossbows)"]]).filter((w) => cmWeaponOK(w[0]));
  const wl = WL.map((w) => w[1]);
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
    .slider("Patrol / sentry radius", 4, 150, { valueStep: 2, defaultValue: def.radius })
    .dropdown("Armor", ARMOR_LABEL, { defaultValueIndex: Math.max(0, ARMOR.indexOf(def.armor ?? "none")) });   // (v9.13: armor straight from the egg)
  const ML = CAV_MOUNTS.filter((m) => cmMountOK(m[0]));
  if (div === "cavalier") f.dropdown("Mount", ML.map((m) => m[1]), { defaultValueIndex: Math.max(0, ML.findIndex((m) => m[0] === def.mount)) });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  const pick = Number(v[0]), coal = pick >= NF ? coals[pick - NF] : undefined;
  const cfg = { faction: coal ? (def.faction || 1) : pick + 1, coal: coal ? pick - NF : undefined, squad: Number(v[1]), func: Number(v[2]), weapon: DIV[div].weapon ? WL[Number(v[3])][0] : div === "grenadier" ? DEMO[Number(v[3])][0] : "sword", count: Number(v[4]), radius: Number(v[5]), armor: ARMOR[Number(v[6])] ?? "none", mount: div === "cavalier" ? ML[Number(v[7])]?.[0] : undefined };
  setJSON(player, key, cfg);
  if (coal) {
    const mem = coal.members.slice(0, Math.max(1, cfg.count));         // (fewer men than factions: the first few get one each)
    const all = spawnPoints(player, cfg.count);
    let total = 0;
    const counts = mem.map((fac, k) => {
      const pts = all.pts.filter((_, i) => i % mem.length === k);       // every Nth place in the ranks: mixed, not in blocks
      const n = pts.length ? spawnArmy(player, { faction: fac, squad: cfg.squad, weapon: cfg.weapon, ranged: isRangedW(cfg.weapon), div, radius: cfg.radius, func: funcs[cfg.func][0], mount: cfg.mount, armor: cfg.armor }, pts.length, 0, { base: all.base, pts }) : 0;
      total += n; return n;
    });
    player.onScreenDisplay.setActionBar(`§aSpawned ${total} ${DIV[div].name}s for §l${coal.name}§r§a, mixed: ${mem.map((m, k) => `${counts[k]} ${factionLabel(m)}`).join("§a, ")}`);
    return;
  }
  const n = spawnArmy(player, { faction: cfg.faction, squad: cfg.squad, weapon: cfg.weapon, ranged: isRangedW(cfg.weapon), div, radius: cfg.radius, func: funcs[cfg.func][0], mount: cfg.mount, armor: cfg.armor }, cfg.count);
  player.onScreenDisplay.setActionBar(`§aSpawned ${n} ${factionLabel(cfg.faction)} §a${DIV[div].name}${n > 1 ? "s" : ""} §7(${funcs[cfg.func][1]}${cfg.squad ? ", " + squadName(cfg.faction, cfg.squad) : ""})`);
}

// ================================================================ Command Baton (army only)
const ORDERS = [["charge", "Charge POS"], ["hold", "Hold here"], ["patrol", "Patrol here"], ["follow", "Follow me"], ["fallback", "Fall back"], ["board", "Board the vehicle I'm looking at"], ["mark", "Mark this spot (where I'm standing)"], ["roam", "Roam the area (any floor, free to hunt)"], ["mount", "Mount up (saddled horses, camels, boats nearby)"], ["dismount", "Dismount"], ["cover", "Cover the spot I'm looking at"], ["waitfire", "Hold fire until I shoot"], ["rallyflag", "Set a rally flag where I'm looking"], ["home", "Return to base (the faction's HQ flag)"]];
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
    facOpts.push("signals"); ff.button("§2Hand signals§r\nto the soldiers around me"); facOpts.push("undo"); ff.button("§6Undo my last order");   // (v9.21)
    const fr = await show(ff, player);
    if (!fr || fr.canceled || fr.selection === undefined) return;
    if (facOpts[fr.selection] === "signals") { await signalMenu(player); return; }
    if (facOpts[fr.selection] === "undo") { undoOrder(player); return; }
    const pickF = facOpts[fr.selection], coalPick = typeof pickF === "object" ? pickF.coal : undefined;
    const fac = coalPick !== undefined ? 0 : pickF;
    const of = new ModalFormData().title(`Orders: ${coalPick !== undefined ? getCoals()[coalPick].name : factionLabel(fac, true)}`)
      .dropdown("Order", ORDERS.map((o) => o[1]), { defaultValueIndex: def.order })
      .dropdown("Squad (Garrison only obeys when its squad is picked)", coalPick !== undefined ? ["All squads", ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Squad ${n} (in every member faction)`)] : squadList(fac, "All squads"), { defaultValueIndex: fac === def.faction && def.coal === coalPick ? def.squad : 0 })
      .slider("How many (0 = all)", 0, 100, { valueStep: 5, defaultValue: def.count })
      .slider("Soldiers within (blocks)", 16, 200, { valueStep: 8, defaultValue: def.radius })
      .dropdown("Stance", ["Aggressive (chase what they see)", "Defensive (hold and shoot what comes)", "Hold fire (only shoot back)"], { defaultValueIndex: Math.max(0, ["aggressive", "defensive", "holdfire"].indexOf(def.stance ?? "aggressive")) })
      .slider("Area of operations (blocks)", 40, 200, { valueStep: 10, defaultValue: def.ao ?? 100 })
      .dropdown("Freedom", ["Use judgment (fight anywhere in the area, help nearby friends)", "Exactly as ordered"], { defaultValueIndex: def.free === false ? 1 : 0 })
      .dropdown("Formation (on the march and following you)", FORM_NAMES, { defaultValueIndex: Math.max(0, FORM_KEYS.indexOf(def.shape ?? "auto")) });
    const or = await show(of, player);
    if (!or || or.canceled || !or.formValues) return;
    const v = or.formValues.map(Number);
    cfg = { faction: fac, coal: coalPick, order: v[0], squad: v[1], count: v[2], radius: v[3], stance: ["aggressive", "defensive", "holdfire"][v[4]] ?? "aggressive", ao: Math.round(v[5] ?? 100), free: v[6] !== 1, shape: FORM_KEYS[v[7]] ?? "auto" };
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

// v9.19: the formation a squad keeps (picked with the order; auto: by the ground and whether there's a fight)
const FORM_KEYS = ["auto", "line", "column", "wedge"], FORM_NAMES = ["Auto (by the ground and the fight)", "Line (abreast)", "Column (two files)", "Wedge"];
const forcedShape = (f, sq) => { const fk = getJSON(world, "war:fshape", {}); const v = fk[`${f}|${sq}`] ?? fk[`${f}|0`] ?? fk["0|0"]; return v && v !== "auto" ? v : undefined; };
// the faction's HQ: its headquarters flag, else its nearest war flag
function hqFlag(dim, at, fac) {
  return nearestFlag(dim, at, (f) => !!gdp(f, "war:hq") && Number(P(f, "war:faction")) === fac, 100000) ?? nearestFlag(dim, at, (f) => !P(f, "war:rally") && Number(P(f, "war:faction")) === fac, 100000);
}
async function giveOrder(player, cfg) {
  try { await giveOrderInner(player, cfg); }
  catch (err) { player.onScreenDisplay.setActionBar(`§cThat order couldn't be given here (${String(err).slice(0, 60)}).`); }
}
async function giveOrderInner(player, cfg, given) {
  let order = ORDERS[cfg.order][0];
  if (order === "mark") { await markSpot(player); return; }
  // v9.19: a rally flag where you're looking, for the faction you're ordering (no menu)
  if (order === "rallyflag") {
    const spot = lookedSpot(player, 64), fac = cfg.faction || playerFaction(player) || 1;
    if (!spot) { player.onScreenDisplay.setActionBar("§7Look at the ground where the rally flag should go."); return; }
    const fl = player.dimension.spawnEntity(FLAG, spot); setP(fl, "war:faction", fac); setP(fl, "war:rally", true);
    if (!claimSlot(fl)) { fl.remove(); player.sendMessage("§cToo many flags/markers in the world."); return; }
    player.onScreenDisplay.setActionBar(`§aRally flag set for ${factionLabel(fac)}§a: the wounded fall back to it and heal there.`); return;
  }
  // v9.19: back to base: the faction's HQ flag, else its nearest war flag (the march, then hold there)
  if (order === "home") {
    const fac = cfg.faction || playerFaction(player) || 1;
    const hq = hqFlag(player.dimension, player.location, fac);
    if (!hq) { player.onScreenDisplay.setActionBar(`§7${factionLabel(fac)}§7 has no HQ or war flag here. Place one with a Flag (type: Headquarters).`); return; }
    const l = hq.location;
    return giveOrderInner(player, { ...cfg, order: ORDERS.findIndex((o) => o[0] === "charge"), target: 5, cx: Math.floor(l.x), cz: Math.floor(l.z), cy: l.y, then: "hold" }, given);
  }
  if (cfg.shape) { const fk = getJSON(world, "war:fshape", {}); for (const fac of cfg.coal !== undefined ? (getCoals()[cfg.coal]?.members ?? []) : [cfg.faction || 0]) fk[`${fac}|${cfg.squad || 0}`] = cfg.shape; setJSON(world, "war:fshape", fk); }
  const now = tick();
  const coalMembers = cfg.coal !== undefined ? (getCoals()[cfg.coal]?.members ?? []) : [];
  if (cfg.coal !== undefined && !coalMembers.length) { player.onScreenDisplay.setActionBar("§7That coalition has no factions (or is gone)."); return; }
  let pool = given ?? player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: cfg.radius }).filter((e) => {
    const d = sd(e);
    if (d.surr || d.div === "guard" || d.div === "medic" || (isRiding(e) && !mountOf.has(e.id))) return false;   // (v9.1: a man on a horse or in a boat still takes orders)
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

  // v9.7: "Cover the spot I'm looking at": they stay on their order, face that spot and anything that shows up there
  // comes first (a 30-degree cone from each man to the spot, 2 minutes)
  if (order === "cover") {
    let at; try { const hit = player.getBlockFromViewDirection({ maxDistance: 150 }); if (hit) at = { x: hit.block.location.x + 0.5, y: hit.block.location.y + 1, z: hit.block.location.z + 0.5 }; } catch {}
    if (!at) { const v = player.getViewDirection(); at = { x: player.location.x + v.x * 60, y: player.location.y, z: player.location.z + v.z * 60 }; }
    for (const e of pool) { const dx = at.x - e.location.x, dz = at.z - e.location.z, L = Math.hypot(dx, dz) || 1; hornCone.set(e.id, { x: e.location.x, z: e.location.z, dx: dx / L, dz: dz / L, until: now + 2400 }); coverWatch.set(e.id, { at, until: now + 2400 }); }
    const w = pool.find((e) => e.isValid && !downed.has(e.id)); if (w) callout(w, "Copy that!", { event: true });
    player.onScreenDisplay.setActionBar(`§eCovering that spot: §f${pool.length} soldiers §7(2 min)`);
    return;
  }
  // v9.7: "Hold fire until I shoot": they hold fire (shooting back only if shot at) until you fire a gun or bow, or
  // hit anyone; then everyone opens up at once
  if (order === "waitfire") {
    for (const e of pool) { if (!waitFire.has(e.id)) waitFire.set(e.id, { pid: player.id, prev: String(gdp(e, "war:stance") ?? "aggressive"), until: now + 6000 }); sdp(e, "war:stance", "holdfire"); }
    const w = pool.find((e) => e.isValid && !downed.has(e.id)); if (w) callout(w, "Wait for it...", { event: true });
    player.onScreenDisplay.setActionBar(`§eHolding fire until you shoot: §f${pool.length} soldiers`);
    return;
  }
  if (order === "mount" || order === "dismount") {
    // v9.19: mounted up on your order, they follow you (in boats too: whoever's at the front rows after you)
    if (order === "mount") pool = pool.map((e) => { try { if (!isRiding(e) && sd(e).div !== "garrison") { personal.delete(e.id); travelTo.delete(e.id); const ne = giveFunction(e, "follow", player); return ne?.isValid ? ne : e; } } catch {} return e; }).filter((e) => e?.isValid);
    const n = order === "mount" ? mountUp(pool, false) : dismountAll(pool);
    if (order === "mount" && n) { const w = pool.find((e) => e.isValid && !downed.has(e.id)); if (w) callout(w, "Mount up!", { event: true }); }   // (v9.5)
    player.onScreenDisplay.setActionBar(order === "mount" ? (n ? `§eMounting up: §f${n}` : "§7No free saddled animals or boats near them (within 16 blocks).") : `§eDismounting: §f${n}`);
    return;
  }
  if (order === "board") {
    let veh;
    try { veh = player.getEntitiesFromViewDirection({ maxDistance: 64 }).map((h) => h.entity).find((x) => VEHICLES.includes(x.typeId)); } catch {}
    if (!veh) { player.onScreenDisplay.setActionBar("§cLook at a boat, plane or tank."); return; }
    const rd = veh.getComponent("minecraft:rideable");
    const free = Math.max(0, rd.seatCount - rd.getRiders().length);
    let n = 0;
    for (let e of pool.filter((x) => sd(x).div !== "cavalier").slice(0, free)) {
      try { const ne = giveFunction(e, "follow", player); if (ne?.isValid) e = ne; } catch {}   // (v9.19: aboard on your order: they follow you; a man at the wheel drives after you)
      try { e.teleport({ x: veh.location.x, y: veh.location.y + 0.5, z: veh.location.z }); if (rd.addRider(e)) { n++; sdp(e, "war:ordt", now); } } catch {}
    }
    player.onScreenDisplay.setActionBar(`§eBoarded: §f${n} §7(${free - n} seats left)${CREW_DRIVEN.includes(veh.typeId) ? " · if you don't take the wheel, they drive after you" : ""}`);
    return;
  }
  let slot, spotCenter, march, orderDest, walkTo;
  if (order === "charge") {
    const pt = chargePoint(player, cfg);
    if (!pt) { player.onScreenDisplay.setActionBar(cfg.target === 1 ? "§cNo enemy war flag within 400 blocks. §7(Only flags of factions you're at war with count; rally flags don't.)" : "§cCouldn't find that position."); return; }
    let dest = pt;
    if ("slot" in pt) { const fl = marker(pt.slot); dest = fl ? { x: fl.location.x, y: fl.location.y, z: fl.location.z } : undefined; }
    orderDest = dest;
    const cxz = pool.reduce((a, e) => ({ x: a.x + e.location.x / pool.length, y: a.y + e.location.y / pool.length, z: a.z + e.location.z / pool.length }), { x: 0, y: 0, z: 0 });
    let near = false;
    try { near = !!dest && dist(cxz, dest) <= 14 && Math.abs((dest.y ?? cxz.y) - cxz.y) <= 1 && !!player.dimension.getBlock(dest) && localReach(player.dimension, cxz, dest); } catch {}
    if (near) { slot = makeWaypoint(player.dimension, dest); march = undefined; }       // close and on the same level: Minecraft walks them there
    else if (dest && Number.isFinite(dest.y) && Math.hypot(dest.x - cxz.x, dest.z - cxz.z) <= 40) {
      // (v9.2: a short trip (40 blocks), another floor or round a wall: no march (its route and lanes took 20 s to get
      //  going indoors); each man gets his own route there at once, stairs and all, and the spot is held when he's there)
      slot = makeWaypoint(player.dimension, dest); walkTo = dest; spotCenter = dest; march = undefined;
    }
    else {
      const fac = cfg.faction || sd(pool[0]).faction;
      if (dest && Math.hypot(dest.x - cxz.x, dest.z - cxz.z) > orderLimit()) { factionMsg(fac, `§cToo far: ${Math.round(Math.hypot(dest.x - cxz.x, dest.z - cxz.z))} blocks (limit ${orderLimit()}). Pick a closer point.`, player); return; }
      march = dest ? startMarch(player, pool, dest, cfg.then ?? "hold") : undefined; slot = march ? march.lanes[0] : 0;
      if (march && dest) announceMarch(player, fac, getMarches()[march.id], cxz);
    }
  } else if (order === "hold" || order === "patrol" || order === "roam") {
    const spot = generals.get(player.id)?.cursor ?? aimFar(player);
    if (!spot) { player.onScreenDisplay.setActionBar("§cLook at the ground where they should go."); return; }
    orderDest = spot;
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
  if ((order === "charge" || order === "hold" || order === "patrol" || order === "roam") && !slot) {
    // v9.14: no marker for it: free what's held for nothing and try once more, straight away (no "give the order again")
    freeSlots();
    if (orderDest) { slot = makeWaypoint(player.dimension, orderDest); if (slot) { march = undefined; spotCenter = orderDest; walkTo = orderDest; } }
    if (!slot) {
      let loadedSpot = false; try { loadedSpot = !!orderDest && !!player.dimension.getBlock(orderDest); } catch {}
      player.onScreenDisplay.setActionBar(loadedSpot ? "§eEvery marker is in use. Remove some old soldiers (War Table > Cleanup) and try again." : "§eThat spot isn't loaded yet (too far from any player). Pick a closer spot, or walk nearer first.");
      return;
    }
  }
  try { snapUndo(player, pool); } catch {}                          // (v9.21: "Undo my last order")
  let n = 0;
  for (const e of pool) {
    try {
      freshMind(e);                                            // the newest order overrides everything
      if (mountOf.has(e.id) && orderDest) rideTo.set(e.id, { ...orderDest }); else rideTo.delete(e.id);   // (v9.1: in the saddle: he rides straight there)
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
        const fs = formationSlot(e.dimension, spotCenter, e, order === "patrol" || order === "roam" ? 4 : 2.5) || slot;
        if (walkTo) sdp(e, "war:then", cfg.then ?? "hold");                     // (on the way he's charging; there, he holds or patrols)
        giveFunction(e, mapFunc(order, sd(e).div), player, fs);
        if (walkTo && !mountOf.has(e.id)) { const m = marker(fs); planPersonalTo(e, "advance", m ? { ...m.location } : walkTo, now); }   // (v9.2: his own route there now)
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
// v9.14: re-kit a whole group at once: everyone within a radius (one faction, one kind of unit if you like); anything
// left on "Keep" stays as each man has it
async function groupEdit(player, e0) {
  const skins = skinChoices(), mounts = CAV_MOUNTS.filter((m) => cmMountOK(m[0])), wl = WEAPONS.filter((w) => cmWeaponOK(w[0]));
  const divs = Object.keys(DIV), f0 = e0 ? sd(e0).faction : playerFaction(player) || 1;
  const f = new ModalFormData().title("Edit everyone nearby")
    .slider("Within (blocks)", 4, 96, { valueStep: 4, defaultValue: 16 })
    .dropdown("Faction", ["Any faction", ...factionList()], { defaultValueIndex: f0 })
    .dropdown("Unit type", ["Every type", ...divs.map((k) => DIV[k].name)], { defaultValueIndex: 0 })
    .dropdown("Weapon", ["Keep", ...wl.map((w) => w[1])], { defaultValueIndex: 0 })
    .dropdown("Armor", ["Keep", ...ARMOR_LABEL], { defaultValueIndex: 0 })
    .dropdown("Skin", ["Keep", "Faction uniform", ...skins.map((k) => k.name)], { defaultValueIndex: 0 })
    .dropdown("Stance", ["Keep", "Aggressive", "Defensive", "Hold fire"], { defaultValueIndex: 0 })
    .dropdown("Mount (Cavaliers)", ["Keep", ...mounts.map((m) => m[1])], { defaultValueIndex: 0 });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues.map(Number), fac = v[1], div = v[2] ? divs[v[2] - 1] : undefined;
  const wpn = v[3] ? wl[v[3] - 1][0] : undefined, arm = v[4] ? ARMOR[v[4] - 1] : undefined, skin = v[5] === 0 ? undefined : v[5] === 1 ? 0 : skins[v[5] - 2].slot;
  const stance = v[6] ? ["aggressive", "defensive", "holdfire"][v[6] - 1] : undefined, mount = v[7] ? mounts[v[7] - 1][0] : undefined;
  let n = 0;
  for (const e of player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: v[0] })) {
    try {
      const d = sd(e);
      if (isDowned(e) || isPow(e) || d.surr || (fac && d.faction !== fac) || (div && d.div !== div)) continue;
      const okW = wpn && DIV[d.div].weapon && d.div !== "grenadier" && (d.div !== "cavalier" || CAV_WEAPONS.some((w) => w[0] === wpn));
      const s2 = { ...snapshot(e), func: "__none" };
      if (okW) { s2.weapon = wpn; s2.ranged = isRangedW(wpn); }
      if (arm) s2.armor = arm;
      if (skin !== undefined) s2.skin = skin;
      const func = d.func, goal = d.goal;
      if (stance) sdp(e, "war:stance", stance);
      if (mount && d.div === "cavalier" && mount !== cavMountOf(e)[0]) {
        const om = world.getEntity(String(gdp(e, "war:mountId") ?? ""));
        try { om?.getComponent("minecraft:rideable")?.ejectRider(e); if (om?.hasTag("war_cav")) om.remove(); } catch {}
        mountOf.delete(e.id); sdp(e, "war:mountId", undefined); sdp(e, "war:mountTry", undefined); sdp(e, "war:mount", mount);
      }
      if (okW || arm || skin !== undefined) { const ne = setupSoldier(e, s2, player, { heal: false }); giveFunction(ne ?? e, func, player, ANCHORED.includes(func) ? goal || undefined : undefined); }
      n++;
    } catch {}
  }
  player.onScreenDisplay.setActionBar(`§aChanged ${n} soldier${n === 1 ? "" : "s"}.`);
}
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
  opts.push(["groupN", "Edit everyone nearby (weapon, armor, skin, stance, mount)"]);
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
  else if (pick === "groupN") await groupEdit(player, e);
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
  const WLW = (d.div === "cavalier" ? CAV_WEAPONS : WEAPONS).filter((w) => cmWeaponOK(w[0]));
  const f = new ModalFormData().title(`Edit ${DIV[d.div].name}`)
    .dropdown("Faction", ["None", ...factionList()], { defaultValueIndex: d.faction })
    .dropdown("Squad", squadList(d.faction, "No squad"), { defaultValueIndex: d.squad })
    .dropdown("Function", funcs.map((x) => x[1]), { defaultValueIndex: Math.max(0, funcs.findIndex((x) => x[0] === d.func)) })
    .dropdown(d.div === "grenadier" ? "Kit" : "Weapon", d.div === "grenadier" ? DEMO.map((k) => k[1]) : DIV[d.div].weapon ? WLW.map((w) => w[1]) : ["(fixed for this unit)"], { defaultValueIndex: d.div === "grenadier" ? Math.max(0, DEMO.findIndex((k) => k[0] === String(gdp(e, "war:kit") ?? "grenade"))) : DIV[d.div].weapon ? Math.max(0, WLW.findIndex((w) => w[0] === String(gdp(e, "war:weapon0") ?? d.weapon))) : 0 })
    .dropdown("Armor", ARMOR_LABEL, { defaultValueIndex: Math.max(0, ARMOR.indexOf(d.armor)) })
    .dropdown("Skin", ["Faction uniform", ...skins.map((s) => s.name)], { defaultValueIndex: Math.max(0, skins.findIndex((s) => s.slot === d.skin) + 1) })
    .slider("Patrol / sentry radius", 4, 150, { valueStep: 2, defaultValue: Math.min(150, Math.max(4, d.radius)) })
    .textField("Name (blank = automatic)", "e.g. Sgt. Rossi", { defaultValue: d.custom })
    .dropdown("Stance", ["Aggressive", "Defensive", "Hold fire"], { defaultValueIndex: Math.max(0, ["aggressive", "defensive", "holdfire"].indexOf(String(gdp(e, "war:stance") ?? "aggressive"))) });
  const MLW = CAV_MOUNTS.filter((m) => cmMountOK(m[0]));
  if (d.div === "cavalier") f.dropdown("Mount", MLW.map((m) => m[1]), { defaultValueIndex: Math.max(0, MLW.indexOf(cavMountOf(e))) });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues || !e.isValid) return;
  const v = r.formValues;
  const skinIdx = Number(v[5]);
  const wpn = d.div === "grenadier" ? DEMO[Number(v[3])][0] : DIV[d.div].weapon ? (WLW[Number(v[3])] ?? WLW[0])[0] : d.weapon;
  const s = { ...snapshot(e), faction: Number(v[0]), squad: Number(v[1]), weapon: wpn, ranged: isRangedW(wpn),
    armor: ARMOR[Number(v[4])] ?? "none",
    skin: skinIdx ? skins[skinIdx - 1].slot : 0, radius: Number(v[6]), custom: String(v[7]).trim(), owner: d.owner, func: "__none" };
  const func = funcs[Number(v[2])][0];
  sdp(e, "war:stance", ["aggressive", "defensive", "holdfire"][Number(v[8])] ?? "aggressive");
  if (d.div === "cavalier" && v[9] !== undefined && MLW[Number(v[9])] && MLW[Number(v[9])][0] !== cavMountOf(e)[0]) {   // (a new mount: the old one goes, a fresh one comes)
    const old = gdp(e, "war:mountId"), om = old ? world.getEntity(String(old)) : undefined;
    try { om?.getComponent("minecraft:rideable")?.ejectRider(e); if (om?.hasTag("war_cav")) om.remove(); } catch {}
    mountOf.delete(e.id); sdp(e, "war:mountId", undefined); sdp(e, "war:mountTry", undefined); sdp(e, "war:mount", MLW[Number(v[9])][0]);
  }
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
    .dropdown("Type", ["War flag (heart of the battle)", "Rally flag (wounded fall back here)", "Headquarters (reinforcements arrive, men heal and rearm, 'Return to base' goes here)"], { defaultValueIndex: 0 });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const fac = Number(r.formValues[0]) + 1, rally = r.formValues[1] === 1, hq = r.formValues[1] === 2;
  const fl = player.dimension.spawnEntity(FLAG, spot);
  setP(fl, "war:faction", fac);
  setP(fl, "war:rally", rally);
  if (hq) sdp(fl, "war:hq", true);
  if (!claimSlot(fl)) { fl.remove(); player.sendMessage("§cToo many flags/markers in the world."); return; }
  if (!rally) warFlagPlaced(fac);
  chronLog(`${player.name} raised a ${rally ? "rally" : "war"} flag for ${factionLabel(fac, true)} ${placeName(player.dimension, spot)}.`);
  player.onScreenDisplay.setActionBar(`§a${rally ? "Rally" : "War"} flag placed for ${factionLabel(fac)}§a.`);
}

// ================================================================ War Table
async function warTable(player, pre) {
  const af = new ActionFormData().title("War Table").body(`Your faction: ${factionLabel(playerFaction(player))}`)
    .button("Join a faction").button("Leave my faction").button("Diplomacy").button("Name factions").button("Name squads").button("Settings").button("Coalitions").button("War archive").button("Test battle").button("Cleanup / repair").button("Neutral zones").button("Reinforcements").button("Save / load battles").button("§eMissions§r\nattack/defend, wave survival, escort");
  const r = pre !== undefined ? { selection: pre, canceled: false } : await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection === 8) { await testBattle(player); return; }
  if (r.selection === 9) { await cleanupMenu(player); return; }
  if (r.selection === 10) { await zoneMenu(player); return; }
  if (r.selection === 11) { await reinfMenu(player); return; }               // (v9.21)
  if (r.selection === 12) { await battleSaveMenu(player); return; }          // (v9.22)
  if (r.selection === 13) { await missionMenu(player); return; }             // (v9.19)
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
    const which = await show(new ActionFormData().title("Settings").button("General").button("Gun loadouts (per faction)").button("Realism (battle tuning)").button("Faction people (languages and skins)").button("Callout language (per faction)").button("« Back").button("§bQuick presets§r\nRealistic / Arcade / Cinematic").button("Performance").button("Export / import settings").button("Recent problems (script errors)"), player);
    if (!which || which.canceled || which.selection === undefined) return;
    if (which.selection === 5) return warTable(player);
    if (which.selection === 6) { await presetMenu(player); return warTable(player, 5); }   // (v9.22)
    if (which.selection === 7) { await perfMenu(player); return warTable(player, 5); }
    if (which.selection === 8) { await settingsShare(player); return warTable(player, 5); }   // (v9.19)
    if (which.selection === 9) { await problemsMenu(player); return warTable(player, 5); }    // (v9.19)
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
      .toggle("Battle learning (experimental: factions slowly adapt their tactics from their own battles)", { defaultValue: setting("learn", false) === true })
      .toggle("Rescue stuck soldiers (teleport to a squad mate, last resort only)", { defaultValue: !!setting("rescue", true) })
      .toggle("On the march, finish an enemy off before carrying on", { defaultValue: !!setting("commit", true) })
      .toggle("Armbands showing each soldier's type", { defaultValue: !!setting("bands", true) })
      .toggle("§cReset what every faction has learned", { defaultValue: false })
      .toggle("Menus in A-Z order", { defaultValue: !!setting("abc", true) })
      .dropdown("Radio messages", ["Off", "Important only", "Everything"], { defaultValueIndex: Number(setting("radio", 1)) })
      .toggle("Shot diagnostics (draw every shot's path, count shots not fired by the soldiers' aim)", { defaultValue: !!setting("diag", false) })
      .dropdown("Bullets", ["Precise (the hit is decided along the exact line of the shot)", "Gun pack's own bullets (flying projectiles)"], { defaultValueIndex: preciseHits() ? 0 : 1 })
      .toggle("Gore: blood, and now and then a limb coming off (bodies and outright kills stay either way)", { defaultValue: setting("gore", true) !== false })
      .dropdown("Content", ["Vanilla (only what the game has: swords, spears, crossbows, vanilla mounts, no add-on vehicles)", "Light (no MG, sniper or bazooka; sensible mounts only)", "Full experience"], { defaultValueIndex: ["vanilla", "light", "full"].indexOf(contentMode()) })
      .toggle("Shields for swordsmen, spearmen and crossbowmen", { defaultValue: setting("shields", true) !== false })
      .toggle("Night battles: muzzle flashes and illumination flares", { defaultValue: setting("nightfx", true) !== false })
      .toggle("Off duty: soldiers smoke as well as eat (camp life)", { defaultValue: setting("smoking", false) === true });
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
    sdp(world, "war:set_radio", Number(sr.formValues[15] ?? 1));
    sdp(world, "war:set_diag", !!sr.formValues[16]);
    sdp(world, "war:set_bullets", Number(sr.formValues[17] ?? 0) === 1 ? "pack" : "precise");
    sdp(world, "war:set_gore", !!sr.formValues[18]);
    const cm0 = contentMode(); sdp(world, "war:set_content", ["vanilla", "light", "full"][Number(sr.formValues[19] ?? 2)] ?? "full");
    sdp(world, "war:set_shields", !!sr.formValues[20]);
    sdp(world, "war:set_nightfx", !!sr.formValues[21]);
    sdp(world, "war:set_smoking", !!sr.formValues[22]);
    if (contentMode() !== cm0) player.sendMessage(`§eContent set to ${contentMode()}: soldiers switch their weapons and mounts over as they're near.`);
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
world.afterEvents.entitySpawn.subscribe((ev) => {                                // v9.14: vanilla content: no add-on vehicles (the item comes back)
  try {
    const o = ev.entity; if (contentMode() !== "vanilla" || !(VEHICLES.includes(o?.typeId) || o?.typeId === NEST)) return;
    const item = { "war:boat": "war:boat_item", "war:plane": "war:plane_item", "war:tank": "war:tank_item", "war:mg_nest": "war:mg_nest_item", "war:truck": "war:truck_item", "war:gunboat": "war:gunboat_item", "war:heli": "war:heli_item" }[o.typeId];
    const p = o.dimension.getPlayers({ location: o.location, maxDistance: 10, closest: 1 })[0];
    system.run(() => { try { if (o.isValid) o.remove(); if (p && item) { giveItem(p, item); p.onScreenDisplay.setActionBar("§7Vanilla content: add-on vehicles are off (War Table > Settings > Content)."); } } catch {} });
  } catch {}
});
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
    .button("Remove dead bodies\nevery body in loaded land")
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
  if (r.selection === 1) {   // v9.21.7: one button clears the battlefield of bodies
    let n = 0;
    for (const dim of DIMS.map((x) => world.getDimension(x))) {
      let list = []; try { list = dim.getEntities({ type: "war:corpse" }); } catch {}
      for (const c of list) { try { RD.delete(c.id); SINKING.delete(c.id); c.remove(); n++; } catch {} }
    }
    CORPSES.length = 0;
    player.sendMessage(n ? `§aRemoved ${n} dead bod${n === 1 ? "y" : "ies"}.` : "§7No dead bodies to remove.");
    return;
  }
  if (r.selection === 2) {
    const mr = await show(new ModalFormData().title("Remove near me").slider("Radius (blocks)", 8, 160, { valueStep: 8, defaultValue: 32 }), player);
    if (!mr || mr.canceled || !mr.formValues) return;
    const R = Number(mr.formValues[0]);
    if (!(await confirm(player, "Remove near me", `Remove every War Engine soldier, hound, vehicle, nest, flag and marker within ${R} blocks?`))) return;
    let n = 0;
    for (const o of player.dimension.getEntities({ location: player.location, maxDistance: R })) if (PACK.includes(o.typeId)) { removeEnt(o); n++; }
    player.sendMessage(`§aRemoved ${n} things within ${R} blocks.`);
    return;
  }
  if (r.selection === 3) {
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
  if (r.selection === 4) {
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
const entMemo = new Map(); // id -> entity (or null), for this tick only (v7.2: one lookup per id per tick, not one per squad mate)
system.runInterval(() => entMemo.clear(), 1);
// v9.4: World Animals v2 (Joeishelping/Animals): every animal has the family "worldanimals"; these attack people on
// sight. A tamed one carries its owner's faction tag war_f<n> (that add-on copies it), so it's friend or foe like him.
const WA_FAMILY = "worldanimals";
const WA_DANGER = new Set(["lion", "white_lion", "tiger", "white_tiger", "leopard", "panther", "bear", "hyenas", "hippopotamus", "crocodile", "komodo_dragon", "snake", "snake_coral", "shark", "white_shark", "tiger_shark",
  "american_alligator", "king_cobra", "rattlesnake"].map((k) => `worldanimals:${k}`));
// v9.22: the ones that never fight (an enemy's tamed duck is still just a duck); every other animal can, dogs included
const WA_PASSIVE = new Set(["ballena", "capuchin_monkeys", "deer", "dove", "duck", "emperor_penguin", "flamingo", "hermann_tortoise", "iguana", "indian_peafowl", "manta_ray", "opossum", "raccoon", "rat", "squirrel", "tucan", "turkey", "vulture",
  "duck_egg", "emperor_penguin_egg", "ostrich_egg", "turkey_egg"].map((k) => `worldanimals:${k}`));
const WA_SIGHT = 40, WA_CLOSE = 12;   // v9.22: a wild man-eater is shot on sight (gunners from 40 blocks, others once it's within 12)
function waMonster(o) { try { return o.matches({ families: ["monster"] }); } catch { return false; } }   // World Animals gives an animal "monster" while it's attacking
let raCache = { t: -1, s: new Set() };
function recentAttackers() {      // who has hurt one of ours in the last 10 s (one pass per tick, shared)
  const now = tick(); if (raCache.t === now) return raCache.s;
  const s0 = new Set(); for (const h of hurtBy.values()) if (now - h.t < 200) s0.add(h.id);
  raCache = { t: now, s: s0 }; return s0;
}
const isWA = (o) => typeof o.typeId === "string" && o.typeId.startsWith("worldanimals:");
function waFaction(o) { try { for (const t of o.getTags()) if (t.startsWith("war_f")) { const n = Number(t.slice(5)); if (n > 0) return n; } } catch {} return 0; }
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
    // v9.4: World Animals (another add-on): its man-eaters, and any animal that has just gone for one of ours. Deer,
    // birds, fish and the like aren't in the scan at all (nobody shoots them, and they cost nothing).
    // v9.22: and every animal tamed by someone of a faction, if it can fight (friend or foe is decided per soldier)
    try { const hit = recentAttackers(), seen = new Set(list.map((c) => c.id)); add(dim.getEntities({ families: [WA_FAMILY] }).filter((o) => !seen.has(o.id) && !o.hasComponent?.("minecraft:is_baby") && (WA_DANGER.has(o.typeId) || hit.has(o.id) || (!WA_PASSIVE.has(o.typeId) && waFaction(o) > 0)))); } catch {}
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
// (v8.1: "is he still there?" asked of the game once per soldier per tick, not on every search: on a real server those
//  calls were a large part of the lag in a big battle)
const validMemo = new Map(); let validT = -1;
function validNow(e) { const t = tick(); if (t !== validT) { validT = t; validMemo.clear(); } let v = validMemo.get(e.id); if (v === undefined) { v = e.isValid; validMemo.set(e.id, v); } return v; }
function nearbyCombatants(dimId, loc, r) {
  const out = [];
  for (const c of nearSnap(dimId, loc, r)) if (validNow(c.e)) out.push(c.e);
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
// v9.19: a blast close by (not close enough to hurt): the men near it duck, are half-deaf and slow for a few seconds
const SHOCK = new Map();   // id -> tick it wears off
function blastShock(dim, at, power) {
  const now = tick(), r = power * 2.5 + 3;
  for (const c of nearSnap(dim.id, at, r)) {
    if (c.type !== SOLDIER || c.down || !c.e.isValid) continue;
    SHOCK.set(c.id, now + 60 + Math.floor(Math.random() * 40));
    const st = gunState.get(c.id); if (st) st.next = Math.max(st.next ?? now, now + 25 + Math.floor(Math.random() * 20));
    try { setP(c.e, "war:react", 1); REACT_T.set(c.id, now + 10); c.e.addEffect("slowness", 50, { amplifier: 1, showParticles: false }); } catch {}
    if (Math.random() < 0.3) note(c.e, "ears ringing");
  }
  if (SHOCK.size > 500) for (const [k, t] of [...SHOCK]) if (t < now) SHOCK.delete(k);
}
const BLASTS = []; // v9.7: recent explosions { dim, at, power, t } (bodies thrown away from them, the nearest ones torn apart)
function explode(dim, loc, power, opts) {
  BLASTS.push({ dim: dim.id, at: { x: loc.x, y: loc.y, z: loc.z }, power, t: tick() }); if (BLASTS.length > 40) BLASTS.shift();
  try { rdBlast(dim, loc, power); } catch {}
  try { blastShock(dim, loc, power); } catch {}
  try { dim.createExplosion(loc, power, opts); }
  catch { const o = { ...opts }; delete o.source; try { dim.createExplosion(loc, power, o); } catch {} }
  try { blastDamage(dim, loc, power, opts?.source); } catch {}
  try { noise(dim, loc, opts?.source); } catch {}
}
function hurt(ent, amount, src) {
  preHp(ent);
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
// v9.4: a mob's middle from its own eye height (a lion, a spider, a slime are far lower than a man), once per kind
const MOB_MID = new Map();   // typeId -> height of its middle above its feet
function mobMid(o) {
  let m = MOB_MID.get(o.typeId);
  if (m === undefined) { m = 1.2; try { const h = o.getHeadLocation().y - o.location.y; if (h > 0.05 && h < 6) m = Math.max(0.25, Math.min(1.2, h * 0.75)); } catch {} if (o.hasComponent?.("minecraft:is_baby")) return m * 0.6; MOB_MID.set(o.typeId, m); }
  return m;
}
function chest(o) { const l = o.location, t = o.typeId; const ps = t === SOLDIER ? (poseOf.get(o.id) ?? 0) : 0; return { x: l.x, y: l.y + (t === "war:tank" ? 1.0 : t === HOUND ? 0.5 : t === SOLDIER ? (ps === 2 ? 0.35 : ps === 3 ? 0.7 : ps === 1 ? 0.85 : 1.2) : t === "minecraft:player" ? 1.2 : VEHICLES.includes(t) ? 1.2 : mobMid(o)), z: l.z }; }
// v8.1: THE "SEEING THROUGH WALLS" BUG. Bedrock's block ray counts its maxDistance in block CELLS stepped through
// (about |dx|+|dy|+|dz| on a diagonal), not in straight-line distance. Every line-of-sight check asked for the
// straight-line length, so on any slanted line (up to a window, across a courtyard) the ray gave up BEFORE it reached
// the wall and answered "clear": men "saw" and fired at enemies behind walls (measured in the real game: 92-99% of
// attackers' rounds went into walls). Found by running the add-on on a real Bedrock server; the test simulator's ray
// didn't have this quirk. Every ray now asks far enough in cells, then measures the real distance to what it hit.
function rayHit(dim, from, u, L, opts = {}) {
  const cells = (Math.abs(u.x) + Math.abs(u.y) + Math.abs(u.z)) * L + 3;
  const hb = dim.getBlockFromRay(from, u, { includeLiquidBlocks: false, includePassableBlocks: false, ...opts, maxDistance: cells });
  if (!hb) return undefined;
  const bl = hb.block.location, fl = hb.faceLocation ?? { x: 0.5, y: 0.5, z: 0.5 };
  const rel = Math.abs(fl.x) <= 1.001 && Math.abs(fl.y) <= 1.001 && Math.abs(fl.z) <= 1.001;   // (relative to the block's corner, as documented; absolute if not)
  const p = rel ? { x: bl.x + fl.x, y: bl.y + fl.y, z: bl.z + fl.z } : fl;
  const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
  return d <= L ? { hb, d, p } : undefined;
}
const LOS = new Map(); let losThisTick = 0;
const SMOKES = [];   // v9.0: smoke clouds (see the smoke section): nobody sees or shoots through one
let losEntries = 0;
system.runInterval(() => { losThisTick = 0; if (LOS.size > 8000 || losEntries > 60000) { LOS.clear(); losEntries = 0; } }, 1);   // (v8.2: the answers inside count too)
function clearShot(dim, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, l = Math.hypot(dx, dy, dz);
  if (l < 0.5) return true;
  if (SMOKES.length && smokeBlocks(dim.id, from, to)) return false;   // (v9.0: checked before the memory: a cloud comes and goes)
  // v5.7: two number keys (each end rounded to a block, half-blocks in height) in nested maps instead of one long text key
  const ka = bkey("", Math.round(from.x), Math.round(from.y * 2), Math.round(from.z)), kb = bkey("", Math.round(to.x), Math.round(to.y * 2), Math.round(to.z));
  let inner = LOS.get(ka);
  if (!inner) { inner = new Map(); LOS.set(ka, inner); }
  const c = inner.get(kb), now = tick();
  if (c && now - c.t < (bigBattle ? 20 : 10)) return c.v;
  if (losThisTick > (bigBattle ? 160 : 260)) return c && now - c.t < 60 ? c.v : false;  // over the per-tick cap: reuse what we knew, if it's recent (v6.0: lower caps; v6.9: never an old answer from where he no longer is)
  losThisTick++;
  let v = false;
  try { v = !rayHit(dim, from, { x: dx / l, y: dy / l, z: dz / l }, l - 0.3); } catch {}
  if (!inner.has(kb)) losEntries++;
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
  if (o.id === e.id || o.typeId === "war:corpse") return false;                 // (v9.7: a body is never a target)
  if (SAFE.size && (SAFE.has(o.id) || SAFE.has(e.id)) && !isMob(o)) return false;   // (v9.1: a neutral zone: nobody fights in or into it; a zombie is still a zombie)
  if (o.typeId === SOLDIER && (downed.has(o.id) || pows.has(o.id) || gdp(o, "war:surr"))) return false;   // nobody shoots the downed, prisoners or a man with his hands up (v9.19)
  if (d.weapon === "at" && (VEHICLES.includes(o.typeId) || d.div !== "grenadier")) return VEHICLES.includes(o.typeId) && isHostile(d.faction, vehicleFaction(o));   // (v6.9.1: the Demolition bazooka fires at men too)
  if (d.weapon === "at" && isMob(o)) return false;                    // (v6.9.3: never a rocket at a zombie or a creeper: only the enemy's army)
  if (VEHICLES.includes(o.typeId)) return false;
  if (o.typeId === SOLDIER || o.typeId === HOUND) return isHostile(d.faction, factionOf(o)) || isProvoker(d.faction, o, tick());
  if (o.typeId === "minecraft:player") { try { return playerFair(o) && (isHostile(d.faction, factionOf(o)) || isProvoker(d.faction, o, tick())); } catch { return false; } }
  // v9.4: a World Animals pet of ours or a friend's is never a target (even if it bit someone by mistake)
  // (and a pet of a faction we're not at war with is left alone unless it goes for us: it doesn't attack us either)
  let petCalm = false;
  if (isWA(o)) {
    const pf = waFaction(o);
    if (pf && (pf === d.faction || isFriendly(d.faction, pf))) return false;
    petCalm = !!pf && !isHostile(d.faction, pf);
    // v9.22: an animal tamed by a faction we're at war with is one of their fighters: fair game like their soldiers
    if (pf && !petCalm && !WA_PASSIVE.has(o.typeId)) return dist(o.location, e.location) <= 64;
  }
  // vanilla mobs: only once one of them has attacked one of ours, and only when it's close
  const as = assist.get(e.id);
  if ((as && as.id === o.id && tick() - as.t < 200) || attackedRecently(e, o, tick())) return true;
  if (petCalm) return false;
  const dd = dist(o.location, e.location), id = o.typeId;
  if (id.includes("creeper")) return dd <= 10;                                        // shoot it before it gets here
  if (["skeleton", "stray", "pillager", "witch", "blaze", "bogged"].some((k) => id.includes(k))) return dd <= 20;   // shooting at us
  // (v9.4: a rhino or an elephant only once it's charged one of ours; v9.22: a wild man-eater, or any wild animal that is
  //  on the attack right now, is shot on sight, before it gets to us)
  if (isWA(o)) { if (!WA_DANGER.has(id) && !waMonster(o)) return false; return dd <= (d.ranged ? WA_SIGHT : WA_CLOSE); }
  return dd <= 9;                                                                      // anything hostile this close is a danger
}
// Is a friendly (or ally) in or near the line of fire?
function friendlyInLine(e, d, from, to, target) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  for (const s0 of nearSnap(e.dimension.id, from, L + 2)) {             // (v8.1: from the half-second snapshot: no calls into the game per man)
    if (s0.id === e.id || s0.id === target.id || s0.down) continue;
    if (!(s0.type === SOLDIER || s0.type === HOUND || s0.type === "minecraft:player")) continue;
    if (!isFriendly(d.faction, s0.f)) continue;
    const c = { x: s0.x, y: s0.y + (s0.type === HOUND ? 0.5 : 1.2), z: s0.z };
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
  if (SMOKES.length && smokeBlocks(dim.id, a, b)) return false;
  try { return !rayHit(dim, a, { x: dx / L, y: dy / L, z: dz / L }, L - 0.4); } catch { return false; }   // (v8.1: can't tell: not clear)
}
// known only by ear: kept (and moved) unless he's actually been seen more recently
function hearIt(S, ent, at, t) { const q = S.known.get(ent.id); if (q && !q.heard && q.t >= t) return; S.known.set(ent.id, { ent, x: at.x, y: at.y, z: at.z, t, heard: true }); }
// v7.0: gunfire is heard (64 blocks): the last second or two of shots, by faction
const SHOTS = [];
function noteShot(e) { try { const l = e.location; SHOTS.push({ id: e.id, f: Number(P(e, "war:faction") ?? 0), x: l.x, y: l.y, z: l.z, t: tick() }); while (SHOTS.length && tick() - SHOTS[0].t > 60) SHOTS.shift(); if (SHOTS.length > 400) SHOTS.splice(0, SHOTS.length - 400); } catch {} }
// v7.4: shot diagnostics (Settings -> "Shot diagnostics"). Every round this add-on fires is drawn: green sparkles along
// where the round REALLY flies, a flame where it was aimed. Rounds a soldier fires that this add-on did NOT fire (the gun
// pack's own script, the game's own ranged attack) are counted, and every 5 s you're told: shots fired, rounds not ours,
// and the bullet drop the soldiers measured. If the marks on a wall have no green trail to them, it wasn't us.
const OURS = new Set();
let diagOurs = 0, diagForeign = 0, diagTraced = 0, diagSec = -1;
const diagOn = () => !!setting("diag", false);
function traceShot(b, aim) {
  const s = Math.floor(tick() / 20); if (s !== diagSec) { diagSec = s; diagTraced = 0; }
  if (++diagTraced > 12) return;
  try { b.dimension.spawnParticle("minecraft:basic_flame_particle", aim); } catch {}
  for (let k = 1; k <= 12; k++) system.runTimeout(() => { try { if (b.isValid) b.dimension.spawnParticle("minecraft:villager_happy", b.location); } catch {} }, k);
}
world.afterEvents.entitySpawn.subscribe((ev) => {
  const b = ev.entity; let id;
  try { id = b.typeId; } catch { return; }
  if (!id.startsWith("ww:") || !id.includes("projectile")) return;
  const bid = b.id;
  system.run(() => {
    try {
      if (OURS.has(bid)) { OURS.delete(bid); diagOurs++; return; }
      const o = b.isValid ? b.getComponent("minecraft:projectile")?.owner : undefined;
      if (o?.typeId === SOLDIER) diagForeign++;
    } catch {}
  });
});
system.runInterval(() => {
  if (OURS.size > 2000) OURS.clear();
  if (!diagOn()) { diagOurs = 0; diagForeign = 0; return; }
  const bl = [...BALL].filter(([t]) => t !== "ww:nbazooka_projectile").map(([, C]) => C);
  const n = bl.reduce((t, C) => t + C.n, 0), bad = bl.reduce((t, C) => t + (C.bad ?? 0), 0);
  const g = n ? bl.reduce((t, C) => t + C.g * C.n, 0) / n : 0, k = n ? bl.reduce((t, C) => t + C.k * C.n, 0) / n : 1;
  const txt = `§eShots (5 s): §f${diagOurs} by the soldiers' aim, §${diagForeign ? "c" : "f"}${diagForeign} NOT by it§e | bullet drop ${g.toFixed(3)}/tick, drag ${k.toFixed(3)} (${n} fit, ${bad} unfit${bad > n / 2 && bad ? ": aiming straight" : ""})`;
  for (const p of world.getAllPlayers()) { try { p.sendMessage(txt); } catch {} }
  diagOurs = 0; diagForeign = 0;
}, 100);
// v8.0: PRECISE HITS (Settings -> "Bullets", the default). The hit is decided by the script along the exact line of
// the shot (spread included), the way most shooters do rifle fire: the first man on the line is hit; if a wall comes
// first, the round stops in the wall. Nothing flies, so nothing can drop, drift or be steered by another add-on's own
// bullet code (the cause of the marks on walls nobody could see past). A faint tracer and a puff at the end show it.
// The gun pack still gives the gun models and sounds. Bazookas keep real rockets. "Gun pack bullets" is the old way.
const HIT_DMG = { rifle: 7, semi: 6, smg: 4, mg: 5, shotgun: 9, pistol: 5, sniper: 12 };
const HIT_CHANCE = { rifle: [0.7, 0.25, 70], semi: [0.65, 0.22, 60], smg: [0.6, 0.08, 40], mg: [0.5, 0.15, 70], shotgun: [0.8, 0.05, 25], pistol: [0.55, 0.08, 35], sniper: [0.85, 0.5, 150] };   // [chance close (8 blocks), chance far, "far" in blocks]
const preciseHits = () => setting("bullets", "precise") !== "pack";
const NOT_HITTABLE = ["war:corpse", WAYPOINT, FLAG, "war:blank", "war:bomb", "war:shell", "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:armor_stand"];
function hittable(o, shooter) {
  try {
    if (!o?.isValid || o.id === shooter.id || NOT_HITTABLE.includes(o.typeId) || o.typeId.includes("projectile")) return false;
    if (o.typeId === SOLDIER && (downed.has(o.id) || pows.has(o.id))) return false;     // (a round never finishes off the wounded)
    if (SAFE.has(o.id) && !isMob(shooter)) return false;                               // (v9.1: nor lands on anyone in a neutral zone)
    if (o.typeId === "minecraft:player") return playerFair(o);
    return !!hpOf(o);
  } catch { return false; }
}
const onNestW = (e) => (ridingNest(e) ? "mg" : ARM.get(e.id)?.arm === "pistol" ? "pistol" : undefined);   // (v9.2: the sidearm hits like a pistol)
// v9.19: armour. A helmet now and then turns a round aside (a "ping": no wound). And armour that's taken a lot of hits
// shows it: past a certain number the helmet is knocked off (gone for the rest of the fight, and no more pings).
const ARMOR_HITS = new Map();   // id -> hits taken in armour
function armorHit(v, head) {
  try {
    const a = String(gdp(v, "war:armor") ?? "none"); if (a === "none") return false;
    if (gdp(v, "war:nohelm")) return false;
    if (head && Math.random() < 0.12) {
      try { v.dimension.playSound("random.anvil_land", headLoc(v), { volume: 0.35, pitch: 1.9 }); v.dimension.spawnParticle("minecraft:critical_hit_emitter", headLoc(v)); } catch {}
      note(v, "his helmet stopped a round"); v9stat("helmetPing"); return true;
    }
    const n = (ARMOR_HITS.get(v.id) ?? 0) + 1; ARMOR_HITS.set(v.id, n); if (ARMOR_HITS.size > 2000) ARMOR_HITS.clear();
    if (n >= ({ leather: 6, iron: 10, netherite: 16 }[a] ?? 10)) {
      sdp(v, "war:nohelm", true); ARMOR_HITS.delete(v.id);
      try { v.runCommand("replaceitem entity @s slot.armor.head 0 air"); v.dimension.playSound("random.break", headLoc(v), { volume: 0.6, pitch: 1.2 }); } catch {}
      note(v, "lost his helmet"); v9stat("helmetOff");
    }
  } catch {}
  return false;
}
// v9.19: what a round goes through: glass, panes, leaves, wool and thin wood (one block of it, losing some punch);
// stone, brick, metal and earth stop it, and a round that stops on stone or metal throws sparks.
const PIERCE = ["glass", "pane", "leaves", "wool", "carpet", "planks", "_door", "trapdoor", "fence", "sign", "banner", "hay", "ladder", "scaffolding", "bamboo", "ice", "barrel", "bookshelf", "chest", "crafting_table"];
const SPARK = ["stone", "brick", "iron", "copper", "deepslate", "andesite", "diorite", "granite", "basalt", "blackstone", "concrete", "terracotta", "quartz", "prismarine", "obsidian", "anvil", "chain", "lantern", "rail", "cauldron", "tuff"];
const pierces = (id) => !id.includes("iron") && PIERCE.some((k) => id.includes(k));
function hitscan(e, spec, from, dir, range, weapon) {
  const dim = e.dimension, n = Math.hypot(dir.x, dir.y, dir.z) || 1, u = { x: dir.x / n, y: dir.y / n, z: dir.z / n };
  let blockD = range, pierceAt = Infinity, stopId = "";
  try {
    const rh = rayHit(dim, from, u, range);
    if (rh) {
      blockD = rh.d; stopId = rh.hb.block.typeId;
      if (pierces(stopId) && spec.bullet !== "ww:nbazooka_projectile") {            // through it, once
        const bl = rh.hb.block.location; let t = rh.d + 0.03;                       // (just inside it: the hit point sits on the face)
        for (let k = 0; k < 14; k++, t += 0.15) { const q = { x: from.x + u.x * t, y: from.y + u.y * t, z: from.z + u.z * t }; if (Math.floor(q.x) !== bl.x || Math.floor(q.y) !== bl.y || Math.floor(q.z) !== bl.z) break; }
        const back = { x: from.x + u.x * (t + 0.05), y: from.y + u.y * (t + 0.05), z: from.z + u.z * (t + 0.05) };
        const rh2 = rayHit(dim, back, u, Math.max(0, range - t));
        pierceAt = rh.d; blockD = Math.min(range, t + (rh2 ? rh2.d : range)); stopId = rh2?.hb?.block?.typeId ?? "";
        if (rh2 && pierces(stopId)) stopId = "";
        try { dim.spawnParticle("minecraft:basic_crit_particle", rh.p); } catch {}
      }
    }
  } catch {}
  let hit;
  try {
    const hits = dim.getEntitiesFromRay(from, u, pierceAt < Infinity ? { maxDistance: blockD + 0.3, ignoreBlockCollision: true } : { maxDistance: blockD + 0.3 }).sort((a, b) => a.distance - b.distance);   // (v9.19: past the pane it went through)
    for (const r of hits) { if (r.distance > blockD + 0.3) break; if (hittable(r.entity, e)) { hit = r; break; } }
  } catch {}
  const end = hit ? hit.distance : blockD;
  if (RD.size) try { rdShot(dim, from, u, end); } catch {}                // (v9.14: rounds kick the bodies they pass through)
  if (hit) {
    let dmg = (HIT_DMG[weapon] ?? 5) * (hit.distance > pierceAt ? 0.6 : 1);    // (v9.19: through a window or a plank wall: weaker)
    if (hit.entity.typeId === SOLDIER && armorHit(hit.entity, from.y + u.y * hit.distance - hit.entity.location.y > 1.42)) dmg = 0;   // (v9.19: his helmet took it)
    try { SHOT_BY.set(hit.entity.id, { id: e.id, t: tick() }); } catch {}
    try { const he = hit.entity; if (he.typeId === SOLDIER) { const hy = from.y + u.y * hit.distance - he.location.y; lastHit.set(he.id, { t: tick(), head: hy > 1.42, leg: hy < 0.72, weapon, dd: hit.distance, dir: u, by: e.id }); } } catch {}   // (v9.7: where it hit him)
    // v9.13: a player is hit like any mob would hit him: his armor counts and the game's short pause between hits holds, so a
    // squad's fire can't empty a full set of netherite in a second. (Soldiers on soldiers stay as they were: armor counts there
    // already, and a man in netherite lasts about three times as long as one in none.)
    preHp(hit.entity);
    if (hit.entity.typeId === "minecraft:player") { try { hit.entity.applyDamage(dmg, { cause: "entityAttack", damagingEntity: e }); } catch { try { hit.entity.applyDamage(dmg); } catch {} } }
    else if (dmg > 0) try { hit.entity.applyDamage(dmg); } catch {}
  }
  else if (stopId && blockD < range && SPARK.some((k) => stopId.includes(k)) && Math.random() < 0.5) {   // (v9.19: a ricochet off stone or steel)
    try { const q = { x: from.x + u.x * (blockD - 0.05), y: from.y + u.y * (blockD - 0.05), z: from.z + u.z * (blockD - 0.05) }; dim.spawnParticle("minecraft:critical_hit_emitter", q); if (Math.random() < 0.2) dim.playSound("random.anvil_land", q, { volume: 0.08, pitch: 2 }); } catch {}
  }
  try {                                                                  // the tracer (every ~3 blocks) and where it ended
    const k0 = 2 + Math.random() * 2;
    if (NIGHT) for (let t = k0, c = 0; t < end && c < 24; t += 1.5, c++) dim.spawnParticle("war:tracer", { x: from.x + u.x * t, y: from.y + u.y * t, z: from.z + u.z * t });   // (v9.7: glowing tracers in the dark)
    else for (let t = k0, c = 0; t < end && c < 14; t += 3, c++) dim.spawnParticle("minecraft:basic_crit_particle", { x: from.x + u.x * t, y: from.y + u.y * t, z: from.z + u.z * t });
    if (!hit && end < range) dim.spawnParticle("minecraft:basic_smoke_particle", { x: from.x + u.x * end, y: from.y + u.y * end, z: from.z + u.z * end });
  } catch {}
  shotFx(e); if (diagOn()) diagOurs++;
  try { bulletCrack(dim, from, u, end, hit?.entity, e); } catch {}
  try { noise(dim, e.location, e); } catch {}
  try { globalThis.__warShot?.({ from: { ...from }, dir: u, owner: e, hit: !!hit, hitId: hit?.entity?.id, block: !hit && end < range, blockD: end, typeId: spec.bullet, end: { x: from.x + u.x * end, y: from.y + u.y * end, z: from.z + u.z * end } }); } catch {}
  return !!hit;
}
// v7.3: ballistics, measured in the game, not assumed. The gun pack's bullets may drop (gravity) and slow down (drag):
// a round aimed straight at a man in an upper window then hits the wall under it. Each bullet type's drop and drag are
// measured from real rounds in flight (their speed 2 and 3 ticks after the shot); the aim is lifted to make the CURVED
// flight meet the target, and the clear-flight check follows the curve, not a straight line.
const BALL = new Map(); // bullet type -> { g, k, n, bad }
function ballOf(type) {                                            // (a type not measured yet: the pack's other bullets)
  const B = BALL.get(type); if (B && B.n >= 2) return B;
  let g = 0, k = 0, n = 0; for (const [t2, C] of BALL) if (t2 !== "ww:nbazooka_projectile" && type !== "ww:nbazooka_projectile" && C.n >= 2) { g += C.g * C.n; k += C.k * C.n; n += C.n; }
  return n ? { g: g / n, k: k / n, n: 0 } : (B ?? { g: 0, k: 1, n: 0 });
}
// v7.4: measured from where the round actually IS (not from its speed, which the gun pack may not report the way the
// game does): its position 2 and 4 ticks after the shot, against the flight the drop/drag model predicts. Only a
// model that fits those positions to within half a block is believed; rounds that fit no model at all (moved by the
// pack's own script, say) count as "unfit", and while most rounds are unfit the aim stays straight.
function measureBall(b, type, p0, v0) {
  const B0 = BALL.get(type); if (B0 && B0.n >= 40) return;
  const seen = [];
  for (const tk of [2, 4]) system.runTimeout(() => {
    try { if (!b.isValid) return; const l = b.location; seen.push({ tk, x: l.x, y: l.y, z: l.z }); } catch { return; }
    if (seen.length < 2) return;
    let best, be = 1e9;
    for (let gi = 0; gi <= 12; gi++) for (let ki = 0; ki <= 10; ki++) for (const off of [-1, 0, 1]) {
      const g = gi * 0.01, k = 1 - ki * 0.005;
      const path = flightPath(p0, v0, 1e9, { g, k }, 8);
      let err = 0; for (const q of seen) { const pp = path[Math.max(0, Math.min(path.length - 1, q.tk + off))]; err = Math.max(err, Math.hypot(pp.x - q.x, pp.y - q.y, pp.z - q.z)); }
      if (err < be) { be = err; best = { g, k }; }
    }
    const C = BALL.get(type) ?? { g: 0, k: 1, n: 0, bad: 0 };
    if (!best || be > 0.5) { C.bad = (C.bad ?? 0) + 1; BALL.set(type, C); return; }
    C.g = (C.g * C.n + best.g) / (C.n + 1); C.k = (C.k * C.n + best.k) / (C.n + 1); C.n++; BALL.set(type, C);
  }, tk);
}
const ballBelieved = (B) => !B.bad || (B.n ?? 0) >= (B.bad ?? 0) * 2;
// where a round fired from p with velocity v is, tick by tick, until it has flown `L` blocks across (the game's order:
// move, then slow down and fall)
function flightPath(p, v, L, B, maxT = 80) {
  const pts = [{ ...p }]; let x = p.x, y = p.y, z = p.z, vx = v.x, vy = v.y, vz = v.z, across = 0;
  for (let i = 0; i < maxT && across < L; i++) {
    x += vx; y += vy; z += vz; across = Math.hypot(x - p.x, z - p.z);
    pts.push({ x, y, z });
    vx *= B.k; vz *= B.k; vy = vy * B.k - B.g;
  }
  return pts;
}
// the height the round is at when it has flown `L` across, aimed along unit u at speed sp
function heightAt(p, u, sp, L, B) {
  const pts = flightPath(p, { x: u.x * sp, y: u.y * sp, z: u.z * sp }, L, B);
  const a = pts[Math.max(0, pts.length - 2)], b = pts[pts.length - 1];
  const da = Math.hypot(a.x - p.x, a.z - p.z), db = Math.hypot(b.x - p.x, b.z - p.z);
  if (db < L - 0.01) return -1e9;                                    // (never gets there)
  const f = db > da ? (L - da) / (db - da) : 1;
  return a.y + (b.y - a.y) * f;
}
// the curved flight of this round is clear of blocks up to `L` across (a ray per two ticks of flight)
function flightClear(dim, p, v, L, B) {
  if (B.g < 0.002 && B.k > 0.998) {                                  // a straight round: one ray, L across
    const n = Math.hypot(v.x, v.y, v.z) || 1, hz = Math.hypot(v.x, v.z) / n, f = hz > 0.05 ? L / hz : L;
    return openNow(dim, p, { x: p.x + (v.x / n) * f, y: p.y + (v.y / n) * f, z: p.z + (v.z / n) * f });
  }
  const pts = flightPath(p, v, L, B);
  let a = pts[0];
  for (let i = 2; i < pts.length; i += 2) { if (!openNow(dim, a, pts[i])) return false; a = pts[i]; }
  return a === pts[pts.length - 1] || openNow(dim, a, pts[pts.length - 1]);
}
function fireGun(e, spec, t, aim) {
  const h = headLoc(e), c0 = aim ?? chest(t);
  let c = c0;
  try { const v = t.getVelocity(); const tt = Math.hypot(c0.x - h.x, c0.y - h.y, c0.z - h.z) / spec.speed; c = { x: c0.x + v.x * tt, y: c0.y, z: c0.z + v.z * tt }; } catch {}  // lead the target
  const mz = { x: h.x, y: h.y - 0.2, z: h.z };
  if (!openNow(e.dimension, mz, c0)) return false;                       // (v7.1: he must see him NOW, not just where he's heading)
  if (c !== c0 && !openNow(e.dimension, mz, c)) c = c0;
  let dx = c.x - h.x, dy = c.y - (h.y - 0.2), dz = c.z - h.z;           // (v8.0: aimed FROM THE MUZZLE, 0.2 under his eyes: aimed from the eyes, every round flew 0.2 low, clipping sills and floor edges)
  const l = Math.hypot(dx, dy, dz) || 1, Lh = Math.hypot(dx, dz);
  const precise = preciseHits() && spec.bullet !== "ww:nbazooka_projectile";
  const BL0 = ballOf(spec.bullet), BL = precise ? { g: 0, k: 1, n: 0 } : ballBelieved(BL0) ? BL0 : { g: 0, k: 1, n: 0 };
  if (precise) { /* a straight line: nothing to lift */ }
  else if (BL.n < 5 && spec.bullet === "ww:nbazooka_projectile") dy += (l * 0.03 * l) / (spec.speed * 2); // lift for the rocket's drop (until it's been measured)
  else if (BL.g >= 0.002 || BL.k <= 0.998) {                           // v7.3: lift the aim so the curve meets him
    const p0 = { x: h.x, y: h.y - 0.2, z: h.z };
    for (let it = 0; it < 4; it++) {
      const m = Math.hypot(dx, dy, dz) || 1, y = heightAt(p0, { x: dx / m, y: dy / m, z: dz / m }, spec.speed, Lh, BL);
      if (y < -1e8) break;
      const err = c.y - y; if (Math.abs(err) < 0.05) break;
      dy += err;
    }
    dy = Math.min(dy, c.y - h.y + Lh * 0.1);                         // (never more than ~6 degrees over the man: a bad measurement can't send rounds over the roof)
  }
  const n = Math.hypot(dx, dy, dz) || 1;
  const r = () => (Math.random() + Math.random() - 1) * spec.spread * (precise ? 2.4 : 1.6);   // (v8.0: a precise hit has no flight time to miss a moving man in: a little wider spread)
  // v7.2: the round itself must have a clear flight. The spread is drawn first and the actual line of THIS round is
  // checked up to the man: if it would go into the wall, the window frame or the parapet in front of him, another
  // draw (as a marksman waits for the sight picture); three bad draws and he doesn't fire at all (he looks for a
  // better spot instead). A man showing only a sliver behind cover is not "a shot". What still lands in a wall is a
  // miss that flew PAST him, into whatever is behind.
  let dir, from;
  if (precise) {                                                     // (v8.0: the aim line is clear, so he fires: where the spread sends the round is where it goes, a miss by the frame included)
    const fv = { x: h.x + (dx / n) * 0.9, y: h.y - 0.2 + (dy / n) * 0.9, z: h.z + (dz / n) * 0.9 };
    if (!openNow(e.dimension, mz, fv) || !openNow(e.dimension, fv, c)) { const g = gunState.get(e.id); if (g) g.coverMiss = (g.coverMiss ?? 0) + 1; return false; }
    // how much of him is open to this gun: four lines across the spread; any of them blocked is a man half behind cover:
    // not a shot (he waits or moves for a better one), so the rounds that do go mostly fly true (checked per 10 ticks)
    const g = gunState.get(e.id);
    if (g && (g.expoT === undefined || tick() - g.expoT > 10 || g.expoId !== t.id)) {
      let clear = 0;
      // (the edges of his spread, not random draws: high, low, left and right at its full reach, so a
      //  line that grazes a sill or a floor edge is always caught)
      const sp = spec.spread * 2.4 * 1.0, hz = Math.hypot(dx, dz) || 1, px = -dz / hz, pz = dx / hz;
      for (const [oy, os] of [[sp, 0], [-sp, 0], [0, sp], [0, -sp]]) { const dv = { x: dx / n + px * os, y: dy / n + oy, z: dz / n + pz * os }, dl = Math.hypot(dv.x, dv.y, dv.z) || 1; if (openNow(e.dimension, fv, { x: fv.x + (dv.x / dl) * Math.max(0.5, l - 1), y: fv.y + (dv.y / dl) * Math.max(0.5, l - 1), z: fv.z + (dv.z / dl) * Math.max(0.5, l - 1) })) clear++; }
      g.expo = clear / 4; g.expoT = tick(); g.expoId = t.id;
    }
    if (g && g.expo < 1) { g.coverMiss = (g.coverMiss ?? 0) + 1; return false; }
    if (g) g.coverMiss = 0;
    // v8.1: hit or miss is a CHANCE (as in most shooters), by weapon and range: a rifle is good at range, an SMG only
    // close. Less when he's wounded or pinned (a shakier aim), at a moving or kneeling man. A hit goes into his body;
    // a miss goes clear past him (half a block to a block and a half to one side or over), into whatever is behind.
    const w = onNestW(e) ?? sd(e).weapon, HC = HIT_CHANCE[w] ?? HIT_CHANCE.rifle;
    let p = HC[0] + (HC[1] - HC[0]) * Math.max(0, Math.min(1, (l - 8) / Math.max(1, HC[2] - 8)));
    p /= Math.max(1, spec.spread / ((GUN_SPEC[w] ?? spec).spread || spec.spread));   // (shaky: wounded, pinned, just turned)
    try { const v = t.getVelocity(); if (Math.hypot(v.x, v.z) > 0.08) p *= 0.8; } catch {}
    if ((poseOf.get(t.id) ?? 0) >= 1) p *= 0.85;
    const ux = dx / n, uy = dy / n, uz = dz / n, hz = Math.hypot(ux, uz) || 1, px = -uz / hz, pz = ux / hz;
    let shot;
    if (Math.random() < p) shot = { x: ux + r() * 0.3, y: uy + r() * 0.3, z: uz + r() * 0.3 };
    else {
      const off = (0.6 + Math.random() * 0.9) / Math.max(2, l);
      const sides = [{ x: ux + px * off, y: uy + r() * 0.3, z: uz + pz * off }, { x: ux - px * off, y: uy + r() * 0.3, z: uz - pz * off }, { x: ux + r() * 0.3, y: uy + off, z: uz + r() * 0.3 }].sort(() => Math.random() - 0.5);
      const reach = l + 1.5;
      shot = sides.find((d) => { const dl = Math.hypot(d.x, d.y, d.z) || 1; return openNow(e.dimension, fv, { x: fv.x + (d.x / dl) * reach, y: fv.y + (d.y / dl) * reach, z: fv.z + (d.z / dl) * reach }); });   // (a miss past him on a side that's open: not into the frame beside him)
      if (!shot) { if (g) g.coverMiss = (g.coverMiss ?? 0) + 1; return false; }                    // (boxed in by cover all round: he's not really in the open)
    }
    hitscan(e, spec, fv, shot, Math.min(spec.fire + 20, 220), w); noteShot(e); return true;
  }
  for (let k = 0; k < 3 && !dir; k++) {
    const dv = { x: dx / n + r(), y: dy / n + r(), z: dz / n + r() };
    const fv = { x: h.x + dv.x * 0.9, y: h.y - 0.2 + dv.y * 0.9, z: h.z + dv.z * 0.9 };
    const dl = Math.hypot(dv.x, dv.y, dv.z) || 1, reach = Math.max(0.5, Lh - 1.3);
    if (openNow(e.dimension, mz, fv) && flightClear(e.dimension, fv, { x: dv.x / dl * spec.speed, y: dv.y / dl * spec.speed, z: dv.z / dl * spec.speed }, reach, BL)) { dir = dv; from = fv; }
  }
  if (!dir) { const g = gunState.get(e.id); if (g) g.coverMiss = (g.coverMiss ?? 0) + 1; return false; }
  { const g = gunState.get(e.id); if (g) g.coverMiss = 0; }
  try {
    const b = e.dimension.spawnEntity(spec.bullet, from);
    const pc = b.getComponent("minecraft:projectile");
    if (pc) {
      const v0 = { x: dir.x * spec.speed, y: dir.y * spec.speed, z: dir.z * spec.speed };
      OURS.add(b.id); pc.owner = e; pc.shoot(v0);
      if (Lh > 12) measureBall(b, spec.bullet, from, v0);
      if (diagOn()) traceShot(b, c);
    }
  } catch {}
  noteShot(e);                                                       // (v7.2: no more wallbang: a round only leaves the gun on a clear line)
  return true;
}
// v6.9: through the wall, by accident. Nobody aims at a wall: but a shot that goes wide into cover, a burst at a window
// that clips the frame, a man who ducks behind a fence as the trigger is pulled: about 3 in 10 of those go through, if
// the wall is no more than 3 blocks thick and isn't made of something no bullet gets through (obsidian, bedrock, iron,
// netherite...). The bullet comes out the far side and flies on. (The one that hit the wall still hits it.)
const BULLETPROOF = ["obsidian", "bedrock", "barrier", "reinforced_deepslate", "netherite_block", "ancient_debris", "iron_block", "iron_door", "iron_trapdoor", "iron_bars", "anvil", "enchanting_table", "end_portal_frame", "respawn_anchor", "ender_chest", "structure_block", "command_block", "jigsaw", "end_gateway", "end_portal", "border_block"];
const WALLBANG = { chance: 0.1, thick: 3, perTick: 8 };   // (v7.1: rare: 1 in 10 of the shots that go into a wall)
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
  if (SCOUTS.has(e.id) && now - Number(gdp(e, "war:hurt") ?? -9999) > 60) return;   // (v9.20: a scout doesn't give himself away)
  if (SLEEP.has(e.id) || DESERT.has(e.id)) return;
  const arm = ARM.get(e.id);
  const spec = onNest ? NEST_SPEC : GUN_SPEC[arm?.arm === "pistol" ? "pistol" : d.weapon];
  if (pows.has(e.id)) return;
  // (v6.9.2: falling back he still fires at anyone within 20: a wounded man in a building with nowhere to run used to
  //  stand there and die without a shot)
  const backOff = d.retreat && !(perc.get(e.id)?.threat?.isValid && dist(perc.get(e.id).threat.location, e.location) < 20);
  if (!spec || d.surr || backOff || d.div === "medic" || (!onNest && !P(e, "war:gun"))) { if (P(e, "war:aiming")) setP(e, "war:aiming", false); return; }
  let st = gunState.get(e.id);
  if (!st) { st = { target: undefined, ammo: spec.mag, next: 0, seen: -999, check: 0, step: 0, back: 0 }; gunState.set(e.id, st); }
  if (st.ammo <= 0) { if (now < st.next) return; if (!reloadGun(e, st, spec)) { st.next = now + 60; return; } }   // (v9.20: an empty gun until there's ammo to load)
  if (now >= st.check) {
    st.check = now + Math.round(5 * aiLoad());
    const ps = perc.get(e.id);
    const prev = st.target;
    const t = ps?.threat;
    const tHit = !!(t && t.isValid && canHit(e, t));
    if (tHit) { st.hitT = now; st.hitId = t.id; }
    st.target = tHit ? t : undefined;                                   // only targets the bullet can actually reach
    if (!st.target && prev?.isValid && prev !== t && !downed.has(prev.id) && canHit(e, prev)) st.target = prev;   // (v7.0: still on the one he's shooting: no flip-flopping, which reset his aim every time)
    // v9.19: the man he's fighting ducked out of sight a moment ago: he keeps his sights where he was for 2 s, ready for
    // him to show again, instead of swinging onto someone else and straight back (the head-flicking in a firefight)
    const waiting = !st.target && t?.isValid && st.hitId === t.id && now - (st.hitT ?? -999) < 40 && !downed.has(t.id);
    if (!st.target && !waiting && !onNest && (t?.isValid || ps?.alert !== "calm" || squads.get(squadKey(e, d))?.known?.size)) st.target = altTarget(e, d, now);   // (v7.0: the one he's watching is out of reach: any other enemy he CAN hit)
    if (waiting) { const c = altTarget(e, d, now); if (c && dist(c.location, e.location) < 8) st.target = c; }   // (unless another is right on top of him)
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
    const hl = headLoc(e), en = st.supp.ent;
    // v7.1: he fires only at what he can SEE, right now: the man himself (his chest, or his head in a window). Not
    // where he was a moment ago, not where he was heard: that was all the "shooting at walls" (and, with the wall
    // let through, shooting people through walls they never saw). If you can't see him, they can't see him.
    const vc = chest(en), vh = headOf(en);
    const p = openNow(e.dimension, hl, vc) ? vc : openNow(e.dimension, hl, vh) ? vh : undefined;
    if (!p) { st.supp = undefined; st.next = now + 4; return; }
    if (!friendlyInLine(e, d, hl, p, st.supp.ent) && aimTurn(e, p, 20) <= 25) {
      if (!fireAtPoint(e, spec, { x: p.x, y: p.y - 1, z: p.z })) { st.next = now + 4; return; }
      st.lastShot = now; st.ammo--;
      if (st.ammo > 0) st.next = now + Math.max(2, spec.gap); else st.next = now + (reloadGun(e, st, spec) ? spec.reload + Math.floor(Math.random() * 8) : 60);
    } else st.next = now + 4;
    return;
  }
  if (!st.target && now >= st.next && !onNest && SMOKES.length && smokeShot(e, d, spec, st, now)) return;   // (v9.2: into the smoke he just went into)
  if (!st.target || now < st.next) return;
  const t = st.target;
  if (ambushHold(e, d, t, now)) { st.next = now + 2; return; }          // v9.0: an ambush: nobody fires until it's sprung
  if (!t.isValid || downed.has(t.id) || pows.has(t.id)) { st.target = undefined; st.check = now; return; }   // (v7.1: down or surrendered: no more rounds into him, or past him into the wall)
  if (!shotAt(e, d, t, now)) return;                                    // beyond the gun's useful range, or a head too far to hit: close in first (v5.4)
  if (arm?.arm === "blade" || (arm?.jamUntil ?? 0) > now && arm.arm === "main") return;   // (v9.2: sword out / clearing a jam)
  if (d.weapon === "at" && !VEHICLES.includes(t.typeId) && dist(t.location, e.location) < 6) { st.next = now + 6; return; }   // (v6.9.1: no rocket at a man this close: the blast would take him too)
  const from = headLoc(e);
  if (friendlyInLine(e, d, from, chest(t), t)) {                        // never shoot through a friendly
    if (now >= st.step && !isRiding(e)) { st.step = now + 25; sidestep(e, d, t); }
    st.next = now + 6;
    return;
  }
  if (aimTurn(e, t.location, 20) > 25) { st.next = now + 2; return; } // still turning toward him (v9.20.3: or off to the side of where he's walking)
  // v9.19: how he stands: kneeling steadies the gun, running throws it off; an MG gunner who's just moved sets up first
  let vel = 0; try { const q = e.getVelocity(); vel = Math.hypot(q.x, q.z); } catch {}
  if (vel > 0.06) st.movedT = now;
  if (d.weapon === "mg" && !onNest && !isRiding(e) && now - (st.movedT ?? -999) < 30) { if (st.movedT === now) note(e, "setting up the gun"); st.next = now + 4; return; }
  const stance = vel > 0.12 ? 1.6 : vel > 0.06 ? 1.25 : (poseOf.get(e.id) ?? 0) === 1 ? 0.8 : 1;
  st.burst = now - (st.lastShot ?? -999) <= Math.max(1, spec.gap) + 3 ? (st.burst ?? 0) + 1 : 0;
  const climb = ["mg", "smg"].includes(d.weapon) ? 1 + Math.min(st.burst, 12) * 0.06 : 1;   // (the muzzle climbs through a long burst)
  const aim = aimAt(e, t);
  if (!aim) { st.next = now + 6; st.target = undefined; return; } // the shot would hit the terrain: don't waste it
  const shaky = ((suppB.get(e.id) ?? 0) > 8 ? 1.8 : 1) * woundK(e) * vetAim(e) * ((ARM_HIT.get(e.id) ?? 0) > now ? 1.7 : 1) * ((poseOf.get(e.id) ?? 0) === 3 ? 2.5 : 1) * stance * climb * ((SHOCK.get(e.id) ?? 0) > now ? 1.8 : 1);   // (v9.19: a wounded arm; firing blind from cover)  // pinned down / badly wounded: shaky aim (v9.18: veterans steadier)
  const fired = st.wild > 0 ? fireGun(e, { ...spec, spread: spec.spread * 3 * shaky }, t, aim) : fireGun(e, shaky === 1 ? spec : { ...spec, spread: spec.spread * shaky }, t, aim);
  if (!fired) { st.next = now + 4; aimMemo.delete(`${e.id}>${t.id}`); return; }   // (v6.9.2: no open line this instant: hold fire)
  if (st.wild > 0) st.wild--;
  firedOn(t, e, now);
  if (t.typeId === "minecraft:player") shotAtPlayer.set(t.id, now);
  if (d.weapon === "mg" && st.ammo === spec.mag) callout(e, "Suppressing!");
  st.lastShot = now;
  suppressNear(t, d.weapon);
  st.ammo--;
  if (!onNest && Math.random() < (JAM[arm?.arm === "pistol" ? "pistol" : d.weapon] ?? 0)) jamGun(e, d, now);   // (v9.2: rarely, a jam)
  if (st.ammo > 0) st.next = now + Math.max(1, spec.gap);
  else {
    st.next = now + (reloadGun(e, st, spec) ? spec.reload + Math.floor(Math.random() * 8) : 60); st.reloadUntil = st.next;
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
      if (!v.isValid || WATERCRAFT.includes(v.typeId)) continue;
      const vel = v.getVelocity(), sp = Math.hypot(vel.x, vel.y, vel.z);
      if (v.typeId === "war:plane" || v.typeId === "war:heli") {
        const st = vstate.get(v.id);
        if (st && (st.speed > 0.08 || (st.rpm ?? 0) > 0.3)) {
          alive.add(v.id);
          if (!engineOn.has(v.id) || tick() % 30 < 6) v.dimension.playSound("plane.fly", v.location, v.typeId === "war:heli" ? { volume: 3, pitch: 0.45 + (st.rpm ?? 0) * 0.15 } : { volume: 2 + st.speed * 4, pitch: 0.8 + st.speed * 0.4 });
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
  let r = 1; try { const h = hpOf(o); if (h) r = h.currentValue / h.effectiveMax; } catch {}
  hpMemo.set(o.id, { t: now, r }); if (hpMemo.size > 4000) hpMemo.clear();
  return r;
}
const isMob = (o) => o.typeId !== "war:corpse" && o.typeId !== SOLDIER && o.typeId !== HOUND && o.typeId !== "minecraft:player" && !VEHICLES.includes(o.typeId);
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
  // v9.16: he sticks with the man he's on. Re-picking from scratch every look swung every gun between enemies about
  // twice a second (the fire-spreading and squad-target bonuses chasing each other); now he changes only for something
  // clearly more urgent, and hardly at all in his first 4 s on a man
  if (GRUDGE.get(e.id)?.id === o.id) s += 90;
  if (OFFICER_IDS.has(o.id)) s += d.weapon === "sniper" ? 35 : 6;  // (v9.20: snipers pick off the men giving the orders)                    // (v9.18: the man who killed his buddy)
  const ps = perc.get(e.id);
  if (ps?.threat?.id === o.id) { s += 65; if (now - (ps.threatT ?? -999) < 80) s += 60; }
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
      else if (c.dd > (c.type.startsWith("worldanimals:") ? WA_SIGHT : 20)) continue;   // (v9.22: a man-eater is seen farther off)
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
  for (const c of near) { if (validNow(c.e) && isTargetFor(e, d, c.e)) all.push({ o: c.e, dd: c.dd }); }
  const soldiersAround = all.some((c) => !isMob(c.o));
  const cands = all
    // mid-battle, distant mobs are ignored unless they're on top of him or attacking
    .filter((c) => !isMob(c.o) || !soldiersAround || c.dd < 6 || attackedRecently(e, c.o, now))
    .sort((a, b) => (Number(isMob(a.o)) - Number(isMob(b.o))) || a.dd - b.dd)
    .slice(0, bigBattle ? 3 : 5);                                // nearest few only (keeps raycasts cheap; v6.0: 3 in a huge battle)
  const visible = new Set();
  let best, bestScore = -1e9;
  for (const { o, dd } of cands) {
    const reach = base * (0.35 + 0.65 * lightAt(e.dimension, o.location) / 15) * visibility(o, now) * WEATHER_K * (SLEEP.has(e.id) ? 0.15 : 1);   // (v9.21: rain, a storm; asleep he only notices what's right on top of him)
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
    if (!s.threat || s.threat.id !== best.id) { s.threatT = now; if (!s.threat && Math.random() < 0.75) { if (!(WA_DANGER.has(best.typeId) && callout(e, "Animal!"))) callout(e, "Enemy spotted!"); } }
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
  for (const c of nearSnap(dim.id, loc, 64)) {                          // (v8.1: from the snapshot: no calls into the game per listener)
    if (c.type !== SOLDIER || c.down) continue;
    try { if (!mf || isHostile(c.f, mf)) { const s = perc.get(c.id) ?? pstate(c.e); s.noise = { x: loc.x, y: loc.y, z: loc.z }; s.noiseT = now; } } catch {}
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
    percAcc = Math.min(bigBattle ? 24 : PERC_MAX, percAcc + n / (10 * aiLoad()));
    const per = Math.min(n, Math.floor(percAcc));
    percAcc -= per;
    for (let k = 0; k < per; k++) {
      const e = list[(percCursor + k) % n];
      try {
        if (!e.isValid) continue;
        const pass = (percPass.get(e.id) ?? 0) + 1; percPass.set(e.id, pass);
        const hot = isHot(e, now);
        if (!hot && pass % 3) continue;
        if (pass % (hot ? (lodOn() ? 4 : 2) : 6) && farFromPlayers(e)) continue;                  // (v9.2; v9.22: a huge battle: the far ones look about half as often)
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
    // v9.17: in the saddle he sits square to his mount (the game turns a horse to face wherever its rider faces: a man
    // aiming off to the side swung his horse sideways). He shoots from the saddle at anything up to ~100° off his line.
    const MO = mountOf.get(e.id), hd = MO ? MOUNT_HEAD.get(MO.id) : undefined;
    if (hd !== undefined) { const off = Math.abs(((want - hd + 540) % 360) - 180); return Math.max(0, off - 100); }
    { const VL = VEH_LOOK.get(e.id); if (VL?.look !== undefined) return Math.abs(((want - VL.look + 540) % 360) - 180); }   // (v9.20.3: in a vehicle seat the look driver turns him)
    const now = tick(), m = rotMemo.get(e.id);
    const cur = m && m.t === now ? m.y : e.getRotation().y;            // (one read per tick at most)
    const off = Math.abs(((want - cur + 540) % 360) - 180);
    if (off > 0.5) { const y = turnToward(cur, want, maxStep); e.setRotation({ x: 0, y }); rotMemo.set(e.id, { t: now, y }); }   // (already facing him: nothing to send)
    else rotMemo.set(e.id, { t: now, y: cur });
    return off;
  } catch { return 0; }
}

// v9.20.3: the gun's turn, for a man on the move. Minecraft walks a man only the way his body faces: turned 45 degrees
// off his path he made a fifth of his pace, 90 degrees and he stood still. The gun swung him round to anyone off to the
// side and he stopped dead mid-advance, again and again ("going nowhere"). Walking, he aims and fires only inside 40
// degrees of his way; anything wider waits till he stops (or the brain stops him to fire).
function aimTurn(e, at, maxStep) {
  try {
    if (!isRiding(e) && !gliders.has(e.id) && !climbing.has(e.id)) {
      const g = getJSON(e, "war:st", {}).g;
      if (g === "g_wp" || g === "g_post" || g === "g_owner") {
        const gm = g === "g_owner" ? undefined : marker(Number(gdp(e, "war:goal") ?? 0)), l = e.location;
        let hx, hz;
        if (gm && flat(gm.location, l) > (g === "g_post" ? 1.5 : 3.2)) { hx = gm.location.x - l.x; hz = gm.location.z - l.z; }
        else { const v = e.getVelocity(); if (Math.hypot(v.x, v.z) > 0.06) { hx = v.x; hz = v.z; } }
        if (hx !== undefined) {
          const way = (Math.atan2(-hx, hz) * 180) / Math.PI, want = (Math.atan2(-(at.x - l.x), at.z - l.z) * 180) / Math.PI;
          if (Math.abs(((want - way + 540) % 360) - 180) > 40) return 999;                 // off to the side: not while walking
        }
      }
    }
  } catch {}
  return turnTo(e, at, maxStep);
}
// v9.16: where a carried man faces: a heading turned at a human pace, the head level (a mild tilt only toward a man
// he's aiming at). A facing point a fraction of a block away tipped him to look straight up or down.
function faceRot(e, from, at, maxStep = 22, pitchTo, cur0) {
  const cur = cur0 ?? e.getRotation().y;
  const dx = at.x - from.x, dz = at.z - from.z;
  const want = Math.hypot(dx, dz) < 0.05 ? cur : (Math.atan2(-dx, dz) * 180) / Math.PI;
  let x = 0;
  if (pitchTo) { const hd = Math.hypot(pitchTo.x - from.x, pitchTo.z - from.z); if (hd > 2) x = Math.max(-25, Math.min(25, (-Math.atan2(pitchTo.y - (from.y + 1.5), hd) * 180) / Math.PI)); }
  return { x, y: turnToward(cur, want, maxStep) };
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
    || (ent.typeId === "minecraft:player" && (hpOf(ent)?.currentValue ?? 1) <= 0);   // (v6.3: a killed player stays a valid entity)
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
  const moving0 = ["charge", "follow", "patrol"].includes(d.func);
  const t = s.threat;
  if (t && t.isValid) {
    if (stance === "holdfire" && !isProvoker(d.faction, t, now)) return undefined; // hold fire until someone of ours is attacked
    { const gt = gunState.get(e.id)?.target; const look = gt?.isValid && !downed.has(gt.id) ? gt : t;
      if (!(MELEE_W.includes(d.weapon) || OUT_OF.has(e.id)) || dist(look.location, e.location) > 5) aimTurn(e, look.location, 18); }   // (v9.19: a man in a sword fight is faced by his own swing; two of us turning him made him twitch)   // (v9.19: one place to look: the man his gun is on, else his threat; two disagreeing turned his head back and forth)
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
    if (isMob(t) && gun && (moving0 || marchOfE(e))) return undefined;   // (v7.2: on the move a mob never stops the order: he shoots it as he goes)
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
// (v8.2: marches are saved at most every 5 s (a write of every march, every half second, was over a megabyte of saved
//  data a minute: the server warns at 10 MB a minute, and the saving itself was lag)
let marchesDirty = false;
function saveMarches() { marchesDirty = true; }
system.runInterval(() => { if (marchesDirty) { marchesDirty = false; saveMarchesNow(); } }, 100);
function saveMarchesNow() {
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
    web: id === "minecraft:web" || id.endsWith("cobweb") || id === "war:barbed_wire",
  };
  t.pass = t.woodDoor || t.plantish || t.web;   // (v9.1: a cobweb can be walked through, slowly: routes go round it if they can)
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
const SHAPES = {
  column: [[0, 0], [0, -1], [0, -2], [0, -3], [0, -4], [0, -5]],
  line: [[-0.5, 0], [0.5, 0], [-1.5, 0], [1.5, 0], [-2.5, 0], [2.5, 0]],
  wedge: [[0, 0], [-1, -1], [1, -1], [-2, -2], [2, -2], [0, -2]],
  skirmish: [[-1.5, 0], [1.5, 0], [-3, -1], [3, -1], [-4.5, -1.5], [4.5, -1.5]],
};
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
    if (pts && mm.keep !== undefined && mm.path && !mm.path.guess) {   // v7.2: the next leg joins on: men still behind keep their way
      const lo = Math.max(0, Math.min(mm.keep, ...mm.members.map((mid) => rTrack.get(mid)?.pts === mm.path ? rTrack.get(mid).i : mm.keep)) - 4);
      mm.path = mm.path.slice(lo, mm.keep + 1).concat(pts); mm.idx = 0; mm.bestIdx = mm.keep - lo; mm.keep = undefined;
    } else if (pts) { mm.path = pts; mm.idx = 0; mm.bestIdx = 0; mm.keep = undefined; }
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
  if (!t || t.pts !== pts) { let i = nearestIdx(pts, loc, 0, pts.length); for (let n = 0; i > 0 && n < 12 && !trackOk(id, pts, loc, i); n++) i--; t = { pts, i, t: tick() }; rTrack.set(id, t); return t.i; }
  let i;
  if (tick() - t.t > 200) { i = nearestIdx(pts, loc, 0, pts.length); for (let n = 0; i > 0 && n < 12 && !trackOk(id, pts, loc, i); n++) i--; }   // long gap (unloaded, teleported): look again
  else { i = nearestIdx(pts, loc, Math.max(0, t.i - 3), Math.min(pts.length, t.i + 14), t.i); while (i > t.i && !trackOk(id, pts, loc, i)) i--; }
  t.i = i; t.t = tick();
  return t.i;
}
// v9.20.3: may he be counted at route point k from where he stands? Not when it's the nearest point only through a wall
// (the route round the end of a wall passes close by on the far side: counted there, he cut the corner into the wall
// and stood pressing against it)
function trackOk(id, pts, loc, k) {
  const p = pts[k];
  if (!p || r3(p, loc) < 1.6) return true;
  const e = world.getEntity(id); if (!e) return true;
  const dim = e.dimension, n = Math.ceil(flat(loc, p) * 2);
  for (let s = 1; s < n; s++) {
    const f = s / n, x = loc.x + (p.x - loc.x) * f, z = loc.z + (p.z - loc.z) * f, y = Math.floor(loc.y + (p.y - loc.y) * f + 0.01) + 1;
    try { if (!passable(tBlock(dim, x, y, z))) return false; } catch { return true; }
  }
  return true;
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
    if (!all.length) {                                          // out of range: keep the order, resume when they load again
      if (m.seenT === undefined || m.seenT > now) { m.seenT = now; changed = true; }
      else if (now - m.seenT > 36000) { for (const s2 of m.lanes) laneOf.delete(s2); delete ms[id]; changed = true; }   // (v9.14: nobody of it seen for 30 min: gone; its markers were held for good)
      continue;
    }
    m.seenT = now;
    const members = all.filter(marchActive);
    if (!members.length) continue;                              // everyone down or captured: nothing to lead
    if (!m.path && !m.planning && !m.final) {                    // (after a reload) plan again from the group
      let x = 0, y = 0, z = 0; for (const e of members) { x += e.location.x; y += e.location.y; z += e.location.z; }
      requestPlan(id, m, { x: x / members.length, y: y / members.length, z: z / members.length }); changed = true; continue;
    }
    if (!m.path && m.earlyAt && !m.final) {                     // v5.9: walking off while the route is worked out: each to his own spot too
      const dim0 = world.getDimension(m.dim);
      for (const e of members) if (!driveOn.has(e.id)) formMode.add(e.id);
      placeFormation(m, dim0, m.earlyAt, members.filter((e) => formMode.has(e.id)), chooseShape(m, dim0, m.earlyAt, members));
      continue;
    }
    if (m.final && m.path && m.pos && !m.stuck) for (const e of all) {                    // v7.2: stragglers of an arrived march: on along the route, then their spot
      const cu = gdp(e, "war:catchup");
      if (cu === undefined) continue;
      if (!marchActive(e) || (flat(e.location, m.pos) < 12 && Math.abs(e.location.y - m.pos.y) < 2.5)) { sdp(e, "war:catchup", undefined); driveOn.delete(e.id); }
    }
    if (m.final || m.planning || !m.path) continue;
    const dim = world.getDimension(m.dim);
    let cx = 0, cy = 0, cz = 0;
    for (const e of members) { cx += e.location.x; cy += e.location.y; cz += e.location.z; }
    const c = { x: cx / members.length, y: cy / members.length, z: cz / members.length };
    // v7.2: EVERY MAN MARCHES ON HIS OWN. Up to v7.1 a shared guide (the formation lanes) moved on only as fast as the
    // slower ~60% of the squad, and everyone walked to a spot around it: three men snagged on a staircase, a mob in the
    // way or a jam in a doorway and the whole squad stood there ("one man makes 200 blocks, a squad doesn't"). Now each
    // man follows the squad's route by his OWN progress (the route driver: his own marker a few blocks ahead of him,
    // carried through stairs and doors, single file where it's tight, side by side in the open). Nobody waits for
    // anybody behind him; only a man far out in front eases off so the squad doesn't string out over 100 blocks.
    const progOf = new Map(members.map((e) => [e.id, routeProgress(m, e.location, e.id)]));
    const prog = [...progOf.values()].sort((a, b) => b - a);
    const lead = prog[0], tail = prog[Math.floor((prog.length - 1) * 0.7)];
    // real contact (an enemy soldier or player, never a mob): the squad stops and fights for up to ~20 s, then moves on
    let contact = members.some((e) => combatLock.has(e.id));
    if (contact) { m.contactT = m.contactT ?? now; if (now - m.contactT > 400) contact = false; } else if (m.contactT !== undefined && now - m.contactT > 500) m.contactT = undefined;
    m.hold = contact;
    m.idx = m.path.length - 1;
    m.paceIdx = tail + 24;                                        // (route points: ~24 blocks of route ahead of the tail at most)
    if (lead > (m.bestIdx ?? 0)) { m.wides = 0; m.edgeMsg = m.frontier ? m.edgeMsg : false; }
    if (lead > (m.bestIdx ?? 0) || contact) { m.bestIdx = Math.max(m.bestIdx ?? 0, lead); m.progT = now; }
    for (const e of all) {
      if (!marchActive(e)) { formMode.delete(e.id); driveOn.delete(e.id); if (gdp(e, "war:catchup") !== undefined) sdp(e, "war:catchup", undefined); continue; }
      formMode.delete(e.id);
      if (!driveOn.has(e.id)) driveOn.set(e.id, { off: 0 });
      const pi = progOf.get(e.id) ?? 0;
      const slot = myMarker(e, m.path[Math.min(m.path.length - 1, lookahead(m.path, pi, 4))], "war:mymk", 1.5);   // the route driver moves it on from here
      if (slot) setCatchup(e, slot);
    }
    const last = m.path[m.path.length - 1];
    // (v6.0: the squad stops ~3 blocks short of its markers: "at the end" when the front is within a few points of it;
    // waiting for the exact last point froze long marches at the end of a leg)
    const atEnd = !m.path.guess && (flat(last, c) < 8 || prog[0] >= m.path.length - 4);   // (v6.2: a guessed straight line is never "arrived")   // (v6.2: a guessed straight line is never "arrived": it said "in position" 100 blocks short)
    if (atEnd) {
      const lt = m.legT ?? { x: m.dest.x, z: m.dest.z, final: true };
      const atDest = Math.hypot(m.dest.x - last.x, m.dest.z - last.z) <= 6 && (!Number.isFinite(m.dest.y) || Math.abs(m.dest.y - last.y) <= 2) && !last.climb;
      if (atDest) {
        // arrived: lanes become formation spots at the destination
        m.final = true; m.finalT = now; m.dest.y = last.y; m.pos = { x: last.x, y: last.y, z: last.z };
        placeLanes(m, dim, m.pos, m.heading, "line");
        factionMsg(m.fac, `§a${squadLabel(m)} in position at (${Math.round(last.x)}, ${Math.round(last.z)})`);
        if (all[0]) callout(all[Math.floor(Math.random() * all.length)], "Hold position!");
        for (const e of all) if (flat(e.location, last) < 12 && Math.abs(e.location.y - last.y) < 2.5) sdp(e, "war:catchup", undefined);   // (v7.2: men still on the way keep following the route to it)
      } else if (!lt.final && Math.hypot(lt.x - last.x, lt.z - last.z) <= 8) {
        m.legs?.shift();                                         // leg done: plan the next one
        const fe = members.reduce((b, e) => ((progOf.get(e.id) ?? 0) > (progOf.get(b.id) ?? 0) ? e : b), members[0]);
        m.keep = Math.min(m.path.length - 1, progOf.get(fe.id) ?? 0);   // (v7.2: from the front man, and the route behind him is kept for the rest)
        requestPlan(id, m, fe.location);
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
    { const p = m.path[Math.min(m.path.length - 1, lead)], prev = m.path[Math.max(0, Math.min(m.path.length - 1, lead) - 2)];
      m.heading = Math.atan2(p.z - prev.z, p.x - prev.x) || m.heading;
      if (now % 40 < 10) placeLanes(m, dim, p, m.heading, chooseShape(m, dim, p, members));      // (the lanes are only the squad's banner now: where the front is)
      m.pos = { x: p.x, y: p.y, z: p.z }; }
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
  const hp = hpOf(e);
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
system.runInterval(() => { const now = tick(); if (TERRAIN.size > 100000) TERRAIN.clear(); else for (const [k, v] of TERRAIN) if (now - v.t > 600) TERRAIN.delete(k); }, 600);
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
  if (TERRAIN.size > 120000) TERRAIN.clear();                           // (v8.2: checked as it grows: up to 1500 new blocks a tick could pile up between the 30 s sweeps)
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
const pathable = (b) => passable(b) || isOpenable(b);
// a real floor: solid under the feet (a ladder counts: he can stand on its top rung); not a plant, torch, open trapdoor or fence
const isFloor = (b) => { if (!b || b.isAir || b.isLiquid) return false; const t = TI(b.typeId); return !t.tall && !(t.trap && b.open) && (!t.pass || t.climb) && !t.leaves && !t.hazard; };
let planCells = 0; const PLAN_CELLS_MAX = 160000;   // (v8.2: all route searches together: ~160k map cells, a few tens of MB at most)
const PLAN_BUDGET = 2000;         // node expansions per tick, shared by all plans (v8.1: the time limit is what really caps it)
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
      const web = TI(feet.typeId).web || TI(head.typeId).web;
      found = { x, z, y, w: false, shore, cave, ledge, web, open: job.step === 1 && (isOpenable(feet) || isOpenable(head) || isWoodDoor(feet)) && !isClimb(feet), climb: job.step === 1 && (isClimb(floor) || hatchBelow) }; break;   // standing on top of a ladder: can climb down
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
  // v6.4: remembered trouble: round it if there's a way. v7.1: never on a staircase or ladder: men get stuck on stairs
  // (and fall on them) far more than anywhere else, and the memory piled up there until every route avoided the stairs
  // and nobody went up or down at all. A stairhead men were cut down on still costs a little (the other way up first).
  if (step === 1 && job?.dim && (TROUBLE.size || KILLZONE.size)) {
    const tr = TROUBLE.size ? troubleAt(job.dim.id, b.x, b.z) : 0, kz = KILLZONE.size ? killAt(job.dim.id, b.x, b.z) : 0;
    if (tr || kz) { const st = b.climb || onStairs(job.dim, { x: b.x + 0.5, y: b.y, z: b.z + 0.5 }); base += st ? Math.min(3, kz) : tr * 2.5 + Math.min(12, kz * 3); }
  }
  if (job?.danger && step === 1) base += exposedCost(job, b);   // v5.7: in a fight, ground the enemy can see costs extra
  if (b.w) base *= 10;                                          // swimming: only when it saves a lot
  else if (b.shore) base += 0.6;                                // keep off the shoreline
  if (b.ledge) base += 1.2;                                      // keep away from the edge of a drop
  if (b.open) base += 0.5;                                       // a trapdoor / gate to open: fine, but not for nothing
  if (b.cave) base += 8 * (job?.step ?? 1);                     // caves are traps: only if there's truly no open route
  if (b.web) base += 25 * (job?.step ?? 1);                     // v9.1: a cobweb (crawling through it): round it unless that's 25 blocks longer
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
// v9.2: a quick, bounded search for trips within ~40 blocks (most of all moves inside and around buildings, and every
// "to the other floor" one): it walks floors and stairs (up or down a step, down two) straight to the goal, under a
// time cap (6 ms, 12 ms a tick in all), and answers at once. The full planner (danger, water, long ways round) only
// gets what this can't do. Before, a man going downstairs in a fight could wait 30 s or more in the planner's queue
// ("working out the way"), behind every other search, and the queue threw out the oldest searches when it was full.
let qrMs = 0, qrTick = -1;
function quickRoute(dim, from, to, maxNodes = 3000) {
  const now = tick(); if (now !== qrTick) { qrTick = now; qrMs = 0; }
  if (qrMs > 12) return undefined;
  const t0 = Date.now();
  const sx = Math.floor(from.x), sz = Math.floor(from.z), sy = Math.floor(from.y + 0.01), tx = Math.floor(to.x), tz = Math.floor(to.z), ty = Math.floor(to.y + 0.01);
  if (Math.abs(tx - sx) > 60 || Math.abs(tz - sz) > 60) return undefined;
  const K = (x, y, z) => ((x - sx + 64) * 128 + (z - sz + 64)) * 256 + (y - sy + 128);
  const g = new Map([[K(sx, sy, sz), 0]]), par = new Map([[K(sx, sy, sz), -1]]), pos = new Map([[K(sx, sy, sz), [sx, sy, sz]]]);
  const open = new Heap(); open.push({ x: sx, y: sy, z: sz, f: 0 });
  let n = 0, found;
  while (open.size && n < maxNodes) {
    const c = open.pop(); n++;
    if ((n & 63) === 0 && Date.now() - t0 > 6) break;
    if (c.x === tx && c.z === tz && Math.abs(c.y - ty) <= 1) { found = c; break; }
    const ck = K(c.x, c.y, c.z), cg = g.get(ck);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1, -2]) {
      const nx = c.x + dx, nz = c.z + dz, ny = c.y + dy, k = K(nx, ny, nz);
      if (Math.abs(nx - sx) > 62 || Math.abs(nz - sz) > 62) continue;
      if (!standAt(dim, nx, ny, nz, now)) continue;
      if (dy === 1) { try { if (!passable(tBlock(dim, c.x + 0.5, c.y + 2, c.z + 0.5))) continue; } catch { continue; } }
      const ng = cg + 1 + (dy ? 0.4 : 0) + (webAt(dim, nx, ny, nz) ? 25 : 0);
      if (ng < (g.get(k) ?? Infinity)) { g.set(k, ng); par.set(k, ck); pos.set(k, [nx, ny, nz]); open.push({ x: nx, y: ny, z: nz, f: ng + Math.abs(tx - nx) + Math.abs(tz - nz) + 3 * Math.abs(ty - ny) }); }
      break;                                                                     // (one height per column: the first that stands)
    }
  }
  qrMs += Date.now() - t0;
  if (!found) return undefined;
  const out = []; let k = K(found.x, found.y, found.z);
  while (k !== -1 && k !== undefined) { const p = pos.get(k); out.push({ x: p[0] + 0.5, y: p[1], z: p[2] + 0.5, w: false, climb: false, open: false }); k = par.get(k); }
  return out.reverse();
}
// v9.2: staircases, learned. Every route that goes over stairs teaches the flight (top, foot, the steps) for that
// place; a later trip to the other floor nearby is put together at once: walk to the flight (one floor, straight at
// it), the steps, walk on from the other end. Before, every man searched the whole floor for the stairs himself, and
// on a real server ten of those searches queued for many seconds.
const STAIRS = [];   // { dimId, top, foot, pts (top -> foot), t }
function learnStairs(dimId, pts) {
  if (!pts || pts.length < 4) return;
  let i = 0;
  while (i < pts.length - 2) {
    let j = i;
    while (j + 1 < pts.length && Math.abs(pts[j + 1].y - pts[j].y) === 1 && Math.sign(pts[j + 1].y - pts[j].y) === Math.sign(pts[i + 1].y - pts[i].y) && !pts[j + 1].climb) j++;
    if (j - i >= 3) {                                                            // a run of 3+ steps one way: a flight
      const run = pts.slice(Math.max(0, i - 1), Math.min(pts.length, j + 2)).map((p) => ({ x: p.x, y: p.y, z: p.z, w: false, climb: false, open: false }));
      const down = run[run.length - 1].y < run[0].y, flight = down ? run : run.slice().reverse();
      const top = flight[0], foot = flight[flight.length - 1];
      if (!STAIRS.some((s) => s.dimId === dimId && r3(s.top, top) < 2 && r3(s.foot, foot) < 2)) { STAIRS.push({ dimId, top, foot, pts: flight, t: tick() }); if (STAIRS.length > 200) STAIRS.shift(); }
      i = j;
    }
    i++;
  }
}
function portalRoute(dim, start, goal, depth = 0) {
  const sy = start.y, gy = goal.y;
  if (Math.abs(gy - sy) <= 2.5) return depth ? quickRoute(dim, start, goal, 2000) : undefined;
  const down = gy < sy;
  let best, bs = 1e9;
  for (const s of STAIRS) {
    if (s.dimId !== dim.id) continue;
    const a = down ? s.top : s.foot, b = down ? s.foot : s.top;
    if (Math.abs(a.y - sy) > 1.5 || flat(a, start) > 40 || (down ? b.y < gy - 1.5 : b.y > gy + 1.5)) continue;
    const sc = flat(a, start) + flat(b, goal) + Math.abs(b.y - gy) * 4;
    if (sc < bs) { bs = sc; best = s; }
  }
  if (!best) return undefined;
  const a = down ? best.top : best.foot, b = down ? best.foot : best.top, steps = down ? best.pts : best.pts.slice().reverse();
  const leg1 = flat(a, start) < 1.5 && Math.abs(a.y - sy) < 1 ? [{ x: start.x, y: Math.floor(sy), z: start.z, w: false, climb: false, open: false }] : quickRoute(dim, start, a, 2000);
  if (!leg1) return undefined;
  const rest = Math.abs(b.y - gy) <= 1.5 ? (flat(b, goal) < 1.5 ? [] : quickRoute(dim, b, goal, 2000)) : depth < 2 ? portalRoute(dim, b, goal, depth + 1) : undefined;
  if (!rest) return undefined;
  return [...leg1, ...steps, ...rest];
}
function planRoute(dim, start, goal, onDone, opts = {}) {
  if ((opts.step ?? 1) === 1 && !opts.goalFn && Number.isFinite(goal.y) && Math.hypot(goal.x - start.x, goal.z - start.z) <= 40) {
    const qr = Math.abs(goal.y - start.y) > 2.5 ? (STAIRS.length ? portalRoute(dim, start, goal) : undefined) : quickRoute(dim, start, goal);   // (a floor change with no flight known yet: the full planner, which teaches it)
    if (qr && qr.length > 1) { const job = { quick: true }; system.run(() => { if (!job.cancel) { try { onDone(qr, false); } catch {} } }); return job; }
  }
  { const od = onDone; onDone = (pts, ...rest) => { try { learnStairs(dim.id, pts); } catch {} return od(pts, ...rest); }; }   // (every route found teaches its stairs)
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
  if (planJobs.length >= 16) {                                         // v6.1: never more than 16 searches in memory at once (v8.2: was 30)
    const old = planJobs.findIndex((j) => !j.prio);
    if (old >= 0) { const [j] = planJobs.splice(old, 1); try { j.onDone(undefined, true, false); } catch {} }
  }
  job.t0 = tick(); planJobs.push(job);
  return job;
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
  { const ps = globalThis.__planStats; if (ps) { ps.done++; ps.doneT += tick() - (job.t0 ?? tick()); } }
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
  // (v8.1: dead jobs (the soldier gave up waiting or asked again) are dropped at once: on a real server they piled up
  //  and ate the planner's time. And the time per tick follows how the server is coping: up to 8 ms while it keeps
  //  pace, 3 ms when it's behind: at a flat 3 ms a route through a building took over a minute in the real game)
  for (let k = planJobs.length - 1; k >= 0; k--) if (planJobs[k].cancel) planJobs.splice(k, 1);
  planCells = 0; for (const j of planJobs) planCells += j.cells.size + j.open.size;
  if (planCells > PLAN_CELLS_MAX) {                                 // (over the memory budget: the biggest search that isn't a march gives up first)
    let big; for (const j of planJobs) if (!j.prio && (!big || j.cells.size > big.cells.size)) big = j;
    if (big) { planJobs.splice(planJobs.indexOf(big), 1); try { big.onDone(undefined, true, false); } catch {} }
  }
  const MS = tickGap < 58 ? 8 : tickGap < 75 ? 5 : 3;
  while (budget > 0 && planJobs.length && freshReads < readBudget && rounds < planJobs.length * 4 && Date.now() - tStart < MS) {
    rounds++;
    jobTurn = (jobTurn + 1) % planJobs.length;
    const prioJob = planJobs.find((j) => j.prio);
    const job = prioJob && rounds % 2 ? prioJob : planJobs[jobTurn];
    let share = Math.max(40, Math.floor(PLAN_BUDGET / planJobs.length)) * (job.prio ? 3 : 1);
    let finished = false;
    while (share-- > 0 && budget-- > 0 && freshReads < readBudget && ((budget & 31) || Date.now() - tStart < MS)) {
      if (!job.open.size || job.exp >= job.max || job.cells.size > Math.min(40000, job.max * 3 + 2000) || job.open.size > Math.min(25000, job.max * 2 + 1000) || planCells > PLAN_CELLS_MAX) {   // (v8.2: size caps per search AND for all searches together: a pile of big searches went over the game's script memory limit and crashed it)
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
  { const ps = globalThis.__planStats; if (ps) { ps.ticks++; ps.exp += PLAN_BUDGET - budget; ps.ms += Date.now() - tStart; ps.reads += freshReads; } }   // (test servers only)
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
    preHp(o);
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
// v9.2: a real fight near him: an enemy SEEN in the last 10 s, his squad firing in the last 20 s, or a threat in sight
function inFight(e, S, now) {
  if (perc.get(e.id)?.threat?.isValid) return true;
  if (!S) return false;
  if (S.fightT !== undefined && now - S.fightT < 400) return true;
  for (const q of S.known.values()) if (!q.heard && now - q.t < 200) return true;
  return false;
}
function patrolSweep(e, d, now) {
  if (d.func !== "patrol" || d.retreat || isRiding(e)) return undefined;
  if (inFight(e, squads.get(squadKey(e, d)), now)) { sweep.delete(e.id); return undefined; }   // (v8.2: in a fight a patrol stops wandering: the fight decides where he goes. v9.2: a real fight, not an enemy merely heard of somewhere around: that froze patrols for good)
  const roam = !!gdp(e, "war:roam");
  const r = roam ? Math.max(d.radius, Math.min(150, aoOf(e))) : d.radius;   // (v9.20.3: a patrol keeps to the radius it was given: "free to use judgment" made it the whole area, and a patrol of 8 wandered 50 blocks off. Roaming the area is its own order)
  // every patrol uses the sweep: points on his level (v7.0: reached by a real route if need be, not only a plain walk:
  // a patrol in a cramped building walks out through the doors). Roam: anywhere in the area, any floor.
  const a = anchorOf(e);
  if (!a) return undefined;
  let sw = sweep.get(e.id);
  if (sw && !personal.has(e.id) && flat(sw.at, e.location) > 4 && now - sw.t > 400) sw = undefined;   // (no way there: another)
  if (!sw || !marker(sw.slot) || flat(sw.at, e.location) < 5.5 || now - sw.t > 900) {   // (v9.20.3: the next leg picked as he comes up on this one: the game's walking stops 3 short, and he stood there till his next thought)
    let spot;
    // v7.2: every floor. A patrol in a building walks all of it (up and down the stairs), a roam the whole area at any
    // height; both from the ORDERED spot (not from where each man happens to be: "roam downstairs" brought nobody down),
    // never to a spot another man is already heading for, and not back to where he's just been.
    const inB = isIndoorsAt(e.dimension, a.location);
    const levels = [a.location.y];
    if (inB) { for (const q of buildingCells(e.dimension, a.location, Math.min(24, r + 6))) if (!levels.some((y) => Math.abs(y - q.y) < 2)) levels.push(q.y); }
    const others = [];
    for (const [id, w] of sweep) if (id !== e.id && now - w.t < 900) others.push(w.at);
    for (let k = 0; k < 14 && !spot; k++) {
      const ang = Math.random() * Math.PI * 2, rr = (inB ? Math.min(r, 6 + k * 2) : r) * (0.35 + Math.random() * 0.6);
      const refY = roam && !inB ? a.location.y + Math.round((Math.random() * 2 - 1) * 10) : levels[Math.floor(Math.random() * levels.length)];
      spot = walkableNear(e.dimension, a.location.x + Math.cos(ang) * rr, a.location.z + Math.sin(ang) * rr, refY);
      if (spot && !roam && !inB && Math.abs(spot.y - a.location.y) > 1) spot = undefined;      // (outdoors a patrol keeps to its level)
      if (spot && inB && !isIndoorsAt(e.dimension, spot) && !roam) spot = undefined;          // (a building patrol stays in the building)
      if (spot && troubleAt(e.dimension.id, spot.x, spot.z) >= 3) spot = undefined;
      if (spot && others.some((o) => flat(o, spot) < 4 && Math.abs(o.y - spot.y) < 2)) spot = undefined;
      if (spot && sw?.at && flat(sw.at, spot) < 5 && Math.abs(sw.at.y - spot.y) < 2 && k < 10) spot = undefined;
    }
    if (!spot) return undefined;
    const slot = makeWaypoint(e.dimension, spot);
    if (!slot) return undefined;
    sw = { slot, at: spot, t: now }; sweep.set(e.id, sw);
  }
  note(e, roam ? "roaming" : "patrolling");
  { const l = e.location, D = flat(sw.at, l);                                    // (v9.20.3: aimed a little past the point: he walks through it, not up to 3 blocks short of it and stops)
    if (D > 1 && D <= 12 && Math.abs(sw.at.y - l.y) <= 1 && !isIndoors(e)) {
      const past = walkableNear(e.dimension, sw.at.x + ((sw.at.x - l.x) / D) * 2.5, sw.at.z + ((sw.at.z - l.z) / D) * 2.5, sw.at.y);
      if (past && Math.abs(past.y - sw.at.y) <= 1 && straightReach(e.dimension, l, past)) { const slot = myMarker(e, past, "war:mymk", 1.0); if (slot) return { g: "g_wp", slot, t: "t_mid", urgent: false }; }
    } }
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
  const hp = hpOf(e);
  if (hp && hp.currentValue / hp.effectiveMax < 0.35) st += 2;
  let foes = 0, friends = 0;
  for (const c of nearSnap(e.dimension.id, e.location, 24)) {
    if (c.id === e.id || c.down || (c.type !== SOLDIER && c.type !== HOUND && c.type !== "minecraft:player")) continue;
    if (isHostile(d.faction, c.f)) foes++; else if (isFriendly(d.faction, c.f)) friends++;
  }
  st -= moraleOf(e, d, now);                                                                 // (v9.7: just won: steadier; just mauled: jumpier)
  st -= nerveOf(e); if ((GRIEF.get(e.id) ?? 0) > now) st += 3;                              // (v9.18: veterans and the brave hold; a man who just lost his buddy shakes)
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
  try { const t = perc.get(e.id)?.threat; if (t?.isValid && dist(t.location, e.location) > 8) smokeScreen(e, e.location, t.location, 2.5, "covering a man falling back"); } catch {}   // (v9.0)
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
const bPower = (o) => { try { const h = hpOf(o); const od = o.typeId === SOLDIER ? sd(o) : null;
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
      S.t = now; S.n = ours.length; S.ours = ours;
      const d0 = sd(ours[0]);
      const oc0 = ours.reduce((a, e) => ({ x: a.x + e.location.x / ours.length, z: a.z + e.location.z / ours.length }), { x: 0, z: 0 });
      // shared knowledge: everything any member has seen (a shout away)
      for (const e of ours) {
        const s = perc.get(e.id);
        if (!s) continue;
        if (SCOUTS.has(e.id)) { scoutSaw(e, s, now); continue; }                // (v9.20: a scout out ahead tells them when he's back)
        const ids = new Set([...s.seen.keys()]); if (s.threat?.isValid) ids.add(s.threat.id);
        for (const id of ids) { let o = entMemo.get(id); if (o === undefined) { o = world.getEntity(id) ?? null; entMemo.set(id, o); } if (o?.isValid && !isMob(o)) S.known.set(id, { ent: o, x: o.location.x, y: o.location.y, z: o.location.z, t: now }); }
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
      // (v8.2: a player in creative or spectator mode is never an enemy the squad knows about: heard or seen, he isn't
      //  hunted, grenaded or given covering fire; before, only the aimed shot skipped him)
      for (const [id, kk] of [...S.known]) if (!kk.ent.isValid || SAFE.has(id) || now - kk.t > 300 || downed.has(id) || pows.has(id) || (kk.ent.typeId === "minecraft:player" && !playerFair(kk.ent))) S.known.delete(id);
      const known = [...S.known.values()];
      const oc = { x: 0, y: 0, z: 0 }; for (const e of ours) { oc.x += e.location.x; oc.y += e.location.y; oc.z += e.location.z; }
      oc.x /= ours.length; oc.y /= ours.length; oc.z /= ours.length; S.ourC = oc;
      if (!known.length) {
        if (S.contactT >= 0) {
          radio(ours[0], "area clear, carrying on", true); learnEnd(S, ours.length, now); try { afterBattle(S, ours, now); } catch {} callout(ours[Math.floor(Math.random() * ours.length)], "Clear!");   // v5.4: no regroup halt (it waited on the downed)
          // v9.7: how it went: hardly a loss -> braver for a minute; half the squad gone -> jumpy for a minute
          const n0 = S.startN ?? ours.length, lost = n0 - ours.length;
          if (n0 >= 3) { if (lost <= n0 * 0.2) { squadMorale.set(k, { m: 1, until: now + 1200 }); v9stat("moraleUp"); radio(ours[0], "they're beaten, good work", true); } else if (lost >= n0 * 0.5) { squadMorale.set(k, { m: -1, until: now + 1200 }); v9stat("moraleDown"); } }
          S.startN = undefined;
        }
        if (S.plan !== "advance") { S.plan = "advance"; S.flankers.clear(); S.suppressors.clear(); S.flankPt = undefined; S.contactT = -1; }
        S.counter = false;
        helpCall.delete(k); continue;
      }
      if (S.contactT < 0) {
        ambushDecide(S, ours, known, now);                                // v9.0: they haven't seen us: lie in wait
        S.contactT = now; callout(ours[Math.floor(Math.random() * ours.length)], "Contact!");
        // v9.7: a man still walking a route worked out before anyone knew where the enemy was: worked out again, now
        // keeping out of their sight where there's a way (once per contact; the planner shares one route per spot)
        for (const e of ours) { const pr = personal.get(e.id); if (pr && pr.kind === "advance" && !pr.covered && !pr.planning && pr.dest && flat(pr.dest, e.location) > 10) { planPersonalTo(e, "advance", pr.dest, now); v9stat("coverReplan"); } }
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
      else if (S.leaderless > now) { /* (v9.7: nobody in charge for a moment: the plan stays as it was) */ }
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
                try { startFeint(S, guns.slice(0, guns.length - nF), oc, best, now); } catch {}   // (v9.20)
                const cmdr = findPlayer(gdp(ours[0], "war:cmdr"));
                try { cmdr?.onScreenDisplay.setActionBar(`§e${d0.squad ? squadName(d0.faction, d0.squad) : factionLabel(d0.faction, true)}: §fpinning them, ${nF} flanking`); } catch {}
              }
            } else if (!dug) S.plan = "assault";
          } else if (!dug && S.ratio >= BW.ratioFix && !S.siege) { S.plan = "assault"; callout(ours[0], "Charge!", { event: true }); }
        }
        if (S.plan === "fix") {
          const fl = ours.filter((e) => S.flankers.has(e.id));
          const inPlace = fl.length && fl.filter((e) => flat(S.flankPt, e.location) < 8 || now - (gunState.get(e.id)?.lastShot ?? -999) < 20).length >= Math.ceil(fl.length / 2);
          if (inPlace || now - S.contactT > BW.stallT * 3 || !fl.length) { S.plan = "assault"; S.flankers.clear(); S.suppressors.clear(); callout(ours[0], "Go, go, go!", { event: true }); radio(ours[0], "assaulting the position", true); }
        }
        if (S.plan === "assault" && S.ratio < 0.5) S.plan = "contact";
      }
      // v9.7: BOUNDING. A squad on the move in contact, under fire, enemy still 14+ blocks off: first 2 s of covering
      // fire from everyone, then two teams take turns: one dashes cover-to-cover toward the enemy (~3.5 s) while the other
      // stays put and keeps their heads down, then they swap. Close in (14 blocks) or the fight ends: back to normal.
      try {
        const gunsB = ours.filter((e) => GUNS.includes(sd(e).weapon) && sd(e).weapon !== "mg" && sd(e).weapon !== "sniper" && !downed.has(e.id)).sort((a, b) => (a.id < b.id ? -1 : 1));   // (the MG and the sniper cover from their own spots)
        const seenB = known.some((q) => !q.heard && now - q.t < 100);
        const boundOk = attacking && gunsB.length >= 4 && !(S.leaderless > now) && seenB && nearK > 14 && nearK <= 80 && S.plan !== "fix" && !S.siege && !(S.bplan && S.bplan.kind !== "attack") && (S.bound || underFire(ours, now, 60) >= 1);
        if (!boundOk) S.bound = undefined;
        else {
          if (!S.bound) { S.bound = { phase: "suppress", t: now, team: 0 }; v9stat("boundStart"); callout(gunsB[0], "Suppressing!", { event: true }); radio(gunsB[0], "covering fire, then we bound forward", true); }
          const Bd = S.bound;
          Bd.teams = new Map(gunsB.map((e) => [e.id, teamOf(e)]));   // (v9.20: fixed fire teams: each man with his buddy)
          if (Bd.phase === "suppress" && now - Bd.t >= 40) { Bd.phase = "bound"; Bd.team = 0; Bd.t = now; const m = gunsB.find((e) => teamOf(e) === 0); if (m) callout(m, "Cover me!", { event: true }); }
          else if (Bd.phase === "bound" && now - Bd.t >= 70) { Bd.team ^= 1; Bd.t = now; v9stat("boundSwap"); const m = gunsB.find((e) => teamOf(e) === Bd.team); if (m) callout(m, "Cover me!", { event: true }); }
        }
      } catch (err) { oops("bounding", err); }
      // v9.7: the MG sets up on the flank of the squad (10 blocks to one side, with a line on the nearest enemy), so his
      // fire crosses the enemy's front instead of coming from where everyone is
      try {
        if (!S.mgPt || now - (S.mgCk ?? -999) > 200) {
          S.mgCk = now;
          const old = S.mgPt; let pt;
          const mg = ours.find((e) => sd(e).weapon === "mg" && !downed.has(e.id));
          const nq = known.filter((q) => !q.heard).sort((a, b) => Math.hypot(a.x - oc.x, a.z - oc.z) - Math.hypot(b.x - oc.x, b.z - oc.z))[0];
          if (mg && nq) {
            const dx = nq.x - oc.x, dz = nq.z - oc.z, L = Math.hypot(dx, dz) || 1;
            for (const sg of [1, -1]) {
              const w = walkableNear(mg.dimension, oc.x + (-dz / L) * 10 * sg, oc.z + (dx / L) * 10 * sg, oc.y);
              if (w && Math.abs(w.y - oc.y) < 3 && clearShot(mg.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, { x: nq.x, y: nq.y + 1.2, z: nq.z })) { pt = w; break; }
            }
          }
          if (pt && old && flat(old, pt) < 4) pt = old;                            // (v9.20.3: about the same place: the same order, not a new one every 10 s)
          if (pt !== old) { S.mgPt = pt; S.mgT = now; }
        }
      } catch {}
      // v9.7: the sergeant: one man per squad runs it. If he goes down in a fight, the squad hesitates ~5 s (no new plan,
      // no bounding, slower decisions) until the next man takes over
      try {
        const sg = S.sgt ? world.getEntity(S.sgt) : undefined;
        if (!sg?.isValid || downed.has(S.sgt) || !ours.some((e) => e.id === S.sgt)) {
          if (S.sgt && known.some((q) => !q.heard)) { S.leaderless = now + 100; v9stat("sgtDown"); radio(ours[0], "the sergeant's down!", true); callout(ours[Math.floor(Math.random() * ours.length)], "Man down!", { event: true }); }
          const nx = ours.filter((e) => GUNS.includes(sd(e).weapon)).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? ours[0];
          S.sgt = nx?.id;
        }
        if (S.leaderless && now >= S.leaderless) { S.leaderless = undefined; const nx = world.getEntity(S.sgt); if (nx?.isValid) { callout(nx, "Follow me!", { event: true }); radio(nx, "I've got command, on me", true); } }
      } catch {}
      if (S.startN === undefined || S.contactT === now) S.startN = ours.length;
      try { squadSmoke(S, ours, known, now); } catch (err) { oops("smoke", err); }   // v9.0
      try { buildingPlan(k, S, ours, known, now); if (S.bplan) assignJobs(S, S.bplan, ours); else S.jobs = undefined; planCheck(S, ours, now); } catch (err) { oops("building plan", err); }   // v7.0 (v7.1: checked)
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
  let dx = p.x - h.x, dy = p.y + 1 - (h.y - 0.2), dz = p.z - h.z;   // (v8.0: from the muzzle)
  const n = Math.hypot(dx, dy, dz) || 1;
  const r = () => (Math.random() + Math.random() - 1) * spec.spread * 3;
  let dir, from;                                                     // (v7.2: as an aimed shot: only a round with a clear flight to him)
  for (let k = 0; k < 3 && !dir; k++) {
    const dv = { x: dx / n + r(), y: dy / n + r(), z: dz / n + r() }, dl = Math.hypot(dv.x, dv.y, dv.z) || 1, reach = Math.max(0.5, n - 1.3);
    const fv = { x: h.x + dv.x * 0.9, y: h.y - 0.2 + dv.y * 0.9, z: h.z + dv.z * 0.9 };
    if (openNow(e.dimension, h, fv) && openNow(e.dimension, fv, { x: fv.x + (dv.x / dl) * reach, y: fv.y + (dv.y / dl) * reach, z: fv.z + (dv.z / dl) * reach })) { dir = dv; from = fv; }
  }
  if (!dir) return false;
  if (preciseHits() && spec.bullet !== "ww:nbazooka_projectile") hitscan(e, spec, from, dir, Math.min(spec.fire + 20, 220), onNestW(e) ?? sd(e).weapon);
  else try {
    const b = e.dimension.spawnEntity(spec.bullet, from);
    const pc = b.getComponent("minecraft:projectile");
    if (pc) { OURS.add(b.id); pc.owner = e; pc.shoot({ x: dir.x * spec.speed, y: dir.y * spec.speed, z: dir.z * spec.speed }); if (diagOn()) traceShot(b, p); }
  } catch {}
  noteShot(e);                                                       // (v7.1: no wallbang from covering fire: only real aimed shots)
  for (const o of nearbyCombatants(e.dimension.id, p, 4)) if (o.typeId === SOLDIER) suppB.set(o.id, Math.min(30, (suppB.get(o.id) ?? 0) + 1));
  return true;
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
const webAt = (dim, x, y, z) => { try { return TI(tBlock(dim, x + 0.5, y, z + 0.5)?.typeId ?? "").web || TI(tBlock(dim, x + 0.5, y + 1, z + 0.5)?.typeId ?? "").web; } catch { return false; } };
// v5.9: a walk in a straight line, a block at a time, up or down at most one block per step (most spots in the open)
function straightReach(dim, from, to, endOk = false) {
  const L = flat(from, to);
  if (L > 16) return false;
  const n = Math.ceil(L), now = tick();
  let y = Math.floor(from.y + 0.01), lx = Math.floor(from.x), lz = Math.floor(from.z);
  // (v9.20.3: stepping from one cell to the next on a slant, one of the two cells at the corner must be open: a "straight
  //  walk" past the end of a wall cut its corner and stuck there)
  const roomAt = (x, z) => { try { const f0 = tBlock(dim, x + 0.5, y, z + 0.5), h0 = tBlock(dim, x + 0.5, y + 1, z + 0.5); return (passable(f0) && passable(h0)) || standAt(dim, x, y + 1, z, now); } catch { return false; } };
  for (let k = 1; k <= n; k++) {
    const x = Math.floor(from.x + ((to.x - from.x) * k) / n), z = Math.floor(from.z + ((to.z - from.z) * k) / n);
    if (x !== lx && z !== lz && !roomAt(lx, z) && !roomAt(x, lz)) return false;
    lx = x; lz = z;
    if (dangerNear(dim, { x: x + 0.5, y, z: z + 0.5 }) && !(endOk && k === n)) return false;   // v6.2: past an edge / lava: not a walk for Minecraft (v6.9: but a perch at the end is)
    if (webAt(dim, x, y, z)) return false;                                      // (v9.1: a cobweb on the line: not a walk, a route)
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
      if (!standAt(dim, nx, ny, nz, now) || webAt(dim, nx, ny, nz)) continue;   // (v9.1: short moves don't crawl through cobwebs; a real route can)
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
const PENDING = new Map(); // dest key -> { t, from, id }: routes being worked out right now (v7.3)
function planPersonalTo(e, kind, dest, now) {
  const pr = { pts: undefined, idx: 0, kind, t: now, planning: true, dest: { x: dest.x, y: dest.y, z: dest.z } };
  { const old = personal.get(e.id); if (old?.job && old.planning) old.job.cancel = true;   // (v8.1: his old search stops)
    const was = old?.planning ? old.prev : old?.pts ? { pts: old.pts, dest: old.dest } : undefined;
    if (was?.dest && flat(was.dest, dest) < 12 && Math.abs((was.dest.y ?? 0) - (dest.y ?? 0)) < 3) pr.prev = was; }   // (v9.20.3: the way he was going leads the same way: he keeps on it while the new one's worked out)
  personal.set(e.id, pr);
  const hit = cachedRoute(e.dimension, e.location, dest);                       // a squad mate just worked this out: use his route
  if (hit) { pr.planning = false; pr.pts = hit; return; }
  if (flat(e.location, dest) <= 14 && Math.abs(dest.y - e.location.y) <= 3) {   // v6.2: a short hop: instant route, no waiting
    const sp = shortPath(e.dimension, e.location, dest);
    if (sp && sp.length > 1) { pr.planning = false; pr.pts = sp; return; }
  }
  // v7.3: a squad mate near him is already working out a route to the same place: wait for that one and share it
  // (twelve men each planning the same long way through a building swamped the planner; none finished in time)
  const pk = `${e.dimension.id}|${Math.round(dest.x / 2)}|${Math.round(dest.y)}|${Math.round(dest.z / 2)}`, pd = PENDING.get(pk);
  if (pd && now - pd.t < 400 && dist(pd.from, e.location) < 10 && pd.id !== e.id) { pr.waitKey = pk; return; }
  if (planJobs.length > 28) { pr.planning = false; pr.pts = undefined; pr.t = now - 10000; return; }   // planner busy: try again shortly
  PENDING.set(pk, { t: now, from: { ...e.location }, id: e.id }); if (PENDING.size > 300) PENDING.clear();
  const dim = e.dimension;
  // v5.4: going for the enemy's floor, the route ends as soon as it's on that floor near him (the first room, not his feet)
  const gy = Math.floor(dest.y);
  const accept = kind === "advance" && Number.isFinite(dest.y) ? (n) => !n.climb && Math.abs(n.y - gy) <= 1 && Math.hypot(n.x + 0.5 - dest.x, n.z + 0.5 - dest.z) <= 12 : undefined;
  const far = flat(e.location, dest);                                           // v5.4: the search is sized to the trip (a short hop never ties up the planner)
  const Sq = squads.get(squadKey(e, sd(e)));
  const danger = bwOf(sd(e).faction).cov !== false && Sq?.known?.size && ["advance", "engage", "spot", "rally", "refuge", "exit", "settle"].includes(kind)
    ? [...Sq.known.values()].filter((q) => now - q.t < 300).slice(0, 4).map((q) => ({ x: q.x, y: q.y + 1.6, z: q.z })) : undefined;
  const otherFloor = Number.isFinite(dest.y) && Math.abs(dest.y - e.location.y) > 2.5;
  pr.covered = !!danger && !otherFloor;                                         // (v9.7: worked out knowing where the enemy looks)
  pr.job = planRoute(dim, e.location, dest, (pts, partial) => {
    PENDING.delete(pk);
    // (v7.3: a route cut short that ends on the wrong floor is no route: it left the stormers standing under the enemy)
    if (pts && partial && otherFloor && Math.abs(pts[pts.length - 1].y - dest.y) > 2) pts = undefined;
    pr.planning = false; pr.pts = pts; pr.idx = 0; if (pts && !partial) rememberRoute(dim, dest, pts);
  }, { max: Math.max(3000, Math.min(otherFloor ? 30000 : 20000, Math.round(far * (otherFloor ? 500 : 300)))), maxRadius: Math.min(90, far + (otherFloor ? 45 : 30)), accept,
    // (v9.2: finding the way to another floor, no flight known here yet: it goes first, and without the enemy-sight
    //  costs (a ray per square searched made it ~250 microseconds a square on a real server): once found, the stairs
    //  are learned and everyone else's trip to that floor is put together at once)
    danger: otherFloor ? undefined : danger, prio: otherFloor && far <= 60 && !STAIRS.some((sr) => sr.dimId === dim.id && flat(sr.top, e.location) < 48) });
}
function brainMove(e, d, now, melee, anchor, leash) {
  const BW = squads.get(squadKey(e, d))?.bw ?? bwOf(d.faction);
  if (d.retreat || d.surr || d.div === "medic" || d.div === "guard" || isRiding(e)) return undefined;
  const stance = String(gdp(e, "war:stance") ?? "aggressive");
  if (stance === "holdfire") return undefined;
  const S = squads.get(squadKey(e, d));
  if (S?.bplan?.kind === "garrison" && !S.known.size && !melee) {           // v7.2: holding a house, nobody about yet: everyone to his post in it
    let Bg = brain.get(e.id); if (!Bg) { Bg = { act: "", decT: -999 }; brain.set(e.id, Bg); }
    return buildingRole(e, d, now, S, Bg, undefined);
  }
  if (!S || !S.known.size) {                                           // (v9.19: a moment with no enemy in the list doesn't wipe his mind: 3 s)
    if (S) S.emptyT ??= now;
    if (!S || now - S.emptyT > 60) brain.delete(e.id);
    return undefined;
  }
  S.emptyT = undefined;
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
  if (now - B.decT >= BW.commit * (S.leaderless > now ? 3 : 1) && spendDecision()) {   // (v9.7: no sergeant for a moment: slower to react)
    B.decT = now;
    const bold = boldOf(e) * (1 + 0.15 * moraleOf(e, d, now)), winning = S.ratio > 1.5;   // (v9.7: a squad that just won pushes harder)
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
    const bTeam = S.bound?.teams?.get(e.id), bCover = bTeam !== undefined && (S.bound.phase === "suppress" || bTeam !== S.bound.team), bMove = bTeam !== undefined && !bCover;   // (v9.7: bounding)
    const opts = [];
    if (S.flankers.has(e.id) && S.plan === "fix" && S.flankPt && flat(S.flankPt, e.location) > 6) opts.push(["flank", 3]);
    if (t && shot) opts.push(["fire", BW.fire * p * (S.suppressors.has(e.id) ? 1.5 : 1) - BW.expo * exposure * (covered ? 0.3 : 1)]);
    const needGround = moving ? (t ? (dd > (GOOD_RANGE_B[d.weapon] ?? 40) * BW.close ? 1 : 0.35) : 1) : 0;
    opts.push(["advance", bold * (BW.adv * needGround + (enemyWeak ? BW.timing : 0) + (S.plan === "assault" ? BW.assault : 0) + (winning ? 0.3 : 0)) - (S.plan === "fix" && S.suppressors.has(e.id) ? 0.8 : 0) - 0.15 * exposure * (1 - BW.close) - (S.siege ? 0.5 : 0) - (d.weapon === "sniper" ? 0.6 : 0)]);
    if (underFire && !covered && exposure > 0) opts.push(["cover", (2 - bold) * BW.cover * exposure + ((suppB.get(e.id) ?? 0) > 8 ? 0.4 : 0)]);
    const shotBy = firedAt.get(e.id), returning = !!shotBy && now - shotBy.t < 60;
    B.supp = !shot && (S.suppressors.has(e.id) || d.weapon === "mg" || returning || bCover) ? suppressPoint(e, d, S, now) : undefined;   // v5.4: only a fresh sighting, in range, with a line to it
    if (B.supp) opts.push(["suppress", BW.supp + (S.plan === "fix" ? 0.4 : 0)]);
    if (!shot) opts.push(["peek", BW.peek]);
    const hp = hpOf(e);
    if (hp && hp.currentValue < 5 && exposure >= 2) opts.push(["fallback", BW.fall]);
    if (!moving) opts.push(["hold", 0.5 + (t ? 0 : 0.3)]);
    const tac = BW.tac !== false;
    if (tac && !moving && S.enemyC && (!shot || (underFire && exposure > 0)) && now - (B.posT ?? -999) > 60) opts.push(["position", 0.55 + (!shot ? 0.35 : 0) + (underFire && exposure > 0 ? 0.5 : 0)]);   // v5.6: a better firing position near his post
    if (S.keyPt && (d.weapon === "mg" || d.weapon === "sniper" || !moving) && !shot) opts.push(["terrain", BW.terrain + (d.weapon === "sniper" ? 0.8 : 0)]);
    if (d.weapon === "sniper" && t && shot) opts.push(["fire", 1.6]);                  // a sniper with a shot takes it
    // v9.7: a sniper moves after three shots from the same spot (they'll have spotted his flash by then)
    if (d.weapon === "sniper") {
      const gsn = gunState.get(e.id);
      if (gsn?.lastShot !== undefined && gsn.lastShot > (B.snLast ?? -1)) { B.snLast = gsn.lastShot; if (!B.snAt || flat(B.snAt, e.location) > 3) { B.snAt = { ...e.location }; B.snN = 0; } B.snN++; }
      if ((B.snN ?? 0) >= 3 && tac) opts.push(["relocate", 2.6]);
    }
    if (d.weapon === "mg" && S.mgPt && flat(S.mgPt, e.location) > 2.5 && ((B.mgDone ?? -1) !== S.mgT || B.act === "mgpos") && (!anchor || flat(S.mgPt, anchor.location) <= (leash ?? 99))) opts.push(["mgpos", 2.2]);   // (v9.7; v9.20.3: still on his way there, it stays his choice: marked done as he set off, it was dropped half a second later, every time)
    if ((!moving || underFire) && S.enemyC) {
      const threatAt = t?.isValid ? t.location : S.enemyC;            // the nearest danger decides which side is safe
      const sbs = sandbagSpot(e, threatAt, anchor, leash, now);
      if (sbs) {
        const holding = B.act === "sandbag" && B.sandbag && flat(B.sandbag, sbs) < 1.5;
        B.sandbag = sbs;
        opts.push(["sandbag", (holding ? 2.2 : 1.2) + (underFire ? 0.5 : 0)]);  // once there, he stays while the bags shield him
      }
    }
    if (bMove) opts.push(["advance", 1.4]);                              // (v9.7: his team's turn to dash; pinned in the open he may still dive for cover)
    if (bCover) {                                                       // (v9.7: his team covers: no advancing; shoot or pin them down, from cover if he's exposed)
      for (const o of opts) { if (o[0] === "advance" || o[0] === "flank") o[1] = -9; if (o[0] === "fire" || o[0] === "suppress") o[1] += 0.4; }
      if (!opts.some((o) => (o[0] === "fire" || o[0] === "suppress") && o[1] > 0)) opts.push(["hold", 1.2]);
    }
    opts.sort((a, b) => b[1] - a[1]);
    const prevAct = B.act;
    // v9.19: commitment. He sticks with what he's doing unless something else is clearly better (by more in the first
    // two seconds of it): re-scored every half second with no preference, a hair's difference flipped him between
    // firing, peeking and holding, and he looked like he couldn't make up his mind.
    { const cur = opts.find((o) => o[0] === prevAct);
      if (cur && cur !== opts[0] && cur[1] > 0 && opts[0][1] - cur[1] < (now - (B.actT ?? -999) < 40 ? 0.6 : 0.25)) { opts.splice(opts.indexOf(cur), 1); opts.unshift(cur); } }
    B.act = opts[0][0];
    if (B.act !== prevAct) { B.actT = now; decisionLine(e, B.act, underFire); }           // (v6.9.1: what he's doing, out loud)
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
    } else if (B.act === "relocate") {
      const r = ts({ rMin: 5, rMax: 14, wCover: 1, wShot: 1.6, margin: 0.4 });
      B.target = r?.spot && (!B.snAt || flat(r.spot, B.snAt) >= 4) ? r.spot : undefined; B.snN = 0;
      if (!B.target) B.act = shot ? "fire" : "hold"; else v9stat("sniperMove");
    } else if (B.act === "mgpos") {
      if (prevAct !== "mgpos" || !B.target || flat(B.target, S.mgPt) > 4) B.target = S.mgPt;   // (the same spot while he's going there)
      if (prevAct !== "mgpos") v9stat("mgFlank");
    } else if (B.act === "fallback") {
      const n = nearestKnownB(S, e);
      if (n) { const dx = e.location.x - n.q.x, dz = e.location.z - n.q.z, L = Math.hypot(dx, dz) || 1; B.target = walkableNear(e.dimension, e.location.x + dx / L * 8, e.location.z + dz / L * 8, e.location.y); }
    } else if (B.act === "advance" && bMove && tac) {
      // v9.7: a bound is a dash to real cover (3-8 blocks on), never into the open; no such spot: he stays and covers
      B.target = ts({ rMin: 3, rMax: 8, toward: S.enemyC, wProg: 1.0, wCover: 2.0, wShot: 0.3, margin: 0.2 })?.spot;
      if (!B.target) { B.act = t && shot ? "fire" : "hold"; v9stat("boundNoCover"); } else v9stat("boundDash");
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
      if (["charge", "follow", "patrol"].includes(d.func) && S.plan !== "fix" && !(S.bound?.teams?.has(e.id))) return undefined;   // (v9.7: a covering team stays put)
      return { g: "g_none", t: "t_mid", urgent: false };
    }
    case "fallback": note(e, "falling back"); return B.target ? go(B.target) : undefined;
    case "relocate": if (!B.target || flat(B.target, e.location) < 0.9) { B.act = "hold"; return undefined; } note(e, "changing position"); return go(B.target, true);
    case "mgpos": if (!B.target || flat(B.target, e.location) < 1.5) { B.act = "hold"; B.mgDone = S.mgT; return undefined; } note(e, "setting up the gun on the flank"); return go(B.target, true);
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
    case "hold": if (S.bound?.teams?.has(e.id)) { note(e, "covering"); return { g: "g_none", t: "t_mid", urgent: false }; } return undefined;   // (v9.7: covering his team's bound)
    case "advance": {                                                    // (v9.2: no point picked yet: the nearest enemy the squad knows of)
      const tg = B.target ?? nearestKnownB(S, e)?.q;
      if (!tg) return undefined;
      note(e, S.plan === "assault" ? "assaulting" : "advancing"); return go(tg);
    }
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
// v9.7: squad morale after a fight (+1 braver / -1 jumpy), for a minute
const squadMorale = new Map(); // squad key -> { m, until }
const moraleOf = (e, d, now = tick()) => { const m = squadMorale.get(squadKey(e, d)); return m && now < m.until ? m.m : 0; };
// ---- squads helping each other: a squad being mauled draws help from free squads nearby, who come in
// from the side (crossfire), never from the same direction
const helpCall = new Map(); // helped squad key -> { enemyC, ourC, t, dim, f }
function squadHelpTargets(k, S, ours, now) {
  const pinned = ours.filter((e) => (suppB.get(e.id) ?? 0) > 8).length * 2 > ours.length;   // (v9.7: most of the squad pinned down: also worth a flank by the neighbours)
  if (pinned) S.pinnedT = S.pinnedT ?? now; else S.pinnedT = undefined;
  if (S.known.size && S.enemyC && (S.ratio < 0.8 || (S.pinnedT !== undefined && now - S.pinnedT > 60))) { if (!helpCall.has(k)) v9stat("helpCall"); helpCall.set(k, { enemyC: S.enemyC, ourC: S.ourC, t: now, dim: ours[0].dimension.id, f: sd(ours[0]).faction }); }
  else if (helpCall.has(k) && now - helpCall.get(k).t > 200) helpCall.delete(k);
}
function reinforceSpot(e, d, now) {
  if (!freeOf(e) || d.func === "post") return undefined;
  const myKey = squadKey(e, d);
  const mine = squads.get(myKey);
  if (mine && [...mine.known.values()].some((q) => !q.heard)) return undefined;   // we're busy ourselves (v9.7: our own fight, not one we only heard of on the radio)
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
// v9.7: the two "watch" orders
const coverWatch = new Map(); // soldier id -> { at, until }   (Cover the spot I'm looking at)
const waitFire = new Map();   // soldier id -> { pid, prev stance, until }   (Hold fire until I shoot)
function openFireFor(pid) {
  const now = tick(); let first;
  for (const [id, w] of [...waitFire]) {
    if (w.pid !== pid) continue;
    waitFire.delete(id);
    const e = world.getEntity(id); if (!e?.isValid) continue;
    sdp(e, "war:stance", w.prev === "holdfire" ? "aggressive" : w.prev); sdDrop(e);
    const st = gunState.get(id); if (st) { st.next = Math.min(st.next ?? now, now + 1 + Math.floor(Math.random() * 4)); st.check = now; }
    first ??= e;
  }
  if (first) { if (!callout(first, "Open fire!", { event: true })) callout(first, "Charge!", { event: true }); v9stat("openFire"); }
}
world.afterEvents.itemUse.subscribe((ev) => { try { const t = ev.itemStack?.typeId ?? ""; if (waitFire.size && (t.startsWith("ww:") || /bow|crossbow|trident/.test(t))) openFireFor(ev.source.id); } catch {} });
world.afterEvents.entityHurt.subscribe((ev) => { try { if (!waitFire.size) return; let a = ev.damageSource?.damagingEntity; if (a?.typeId !== "minecraft:player") a = ev.damageSource?.damagingProjectile?.getComponent?.("minecraft:projectile")?.owner; if (a?.typeId === "minecraft:player") openFireFor(a.id); } catch {} });
system.runInterval(() => {
  const now = tick();
  for (const [id, c] of [...coverWatch]) {
    if (now > c.until) { coverWatch.delete(id); continue; }
    const e = world.getEntity(id); if (!e?.isValid) { coverWatch.delete(id); continue; }
    if (!perc.get(id)?.threat?.isValid && !downed.has(id)) turnTo(e, c.at, 25);          // (nothing to shoot: eyes on the spot)
  }
  for (const [id, w] of [...waitFire]) if (now > w.until) { const e = world.getEntity(id); if (e?.isValid) { sdp(e, "war:stance", w.prev); sdDrop(e); } waitFire.delete(id); }   // (nobody fired for 5 min: back to normal)
}, 20);
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
function voiceOf(f) { const v = getJSON(world, "war:vlang", {})[f]; return VOICE_KEYS.includes(v) ? v : "en_us"; }
// the English line (as the code calls it) -> the recorded line. Lines with no recording (Reloading, Grenade, On the gun) are silent
// lines each language has recordings for (the rest stay silent until recorded and added here)
const voiceHas = (lang, key) => key === "story" || (VOICE_HAS[lang] ?? BASE_LINES).includes(key);   // (v9.2: the campfire story: sounds/war_voice/<lang>/story.ogg, silent until it's there)
const CALL_ALL = BASE_LINES;
const lastCall = new Map(); // soldier id / squad line -> tick
let callSec = -1, callsThisSec = 0;
// v6.8: every line, what it says (English, for subtitles and the test menu) and when it's used
const heardLine = []; // recent lines: { key, dim, x, z, t } (nobody repeats a line someone near just said)
const LINE_WIN = (key) => (IDLE_LINES.includes(key) ? 6000 : key === "medic" ? 240 : key === "hit" || key === "man_down" || key === "target_down" ? 60 : 100);   // (v6.9.1: 5 s for battle lines, was 8)
const callGap = () => [120, 60, 30][Math.max(0, Math.min(2, Number(setting("vfreq", 1))))];   // per man: Low / Normal / High
function playLine(dim, at, lang, key, pitch = 1, who) {
  try { dim.playSound(`war.voice.${lang}.${key}`, at, { volume: who?.vol ?? 1.0, pitch }); } catch {}
  v9stat(`say:${key}`);                                                   // (test statistics only)
  if (setting("vsubs", false) || who?.forceSubs) {
    const txt = `§7${who?.label ?? "Soldier"}:§f "${LINE_INFO[key]?.[0] ?? key}"`;
    for (const p of world.getAllPlayers()) { try { if (p.dimension.id === dim.id && dist(p.location, at) <= 24) p.onScreenDisplay.setActionBar(txt); } catch {} }
  }
}
function callout(e, text, opt = {}) {
  try {
    if (!e?.isValid || held.has(e.id) || (downed.has(e.id) && !["I'm hit!", "Medic!", "Don't shoot!"].includes(text) && !opt.force)) return false;
    const test = text === "Testing!";
    const f = Number(P(e, "war:faction") ?? 0), lang = opt.lang ? heritage(e, opt.lang) : voiceOfMan(e);
    if (!lang || lang === "none") return false;
    if (!opt.force && !opt.event && ambushQuiet(e)) return false;          // (v9.0: lying in wait, nobody shouts)
    const has = VOICE_HAS[lang] ?? BASE_LINES, now = tick(), l = e.location, did = e.dimension.id;
    const saidNear = (k, win) => heardLine.some((h) => h.key === k && h.f === f && h.dim === did && now - h.t < win && Math.abs(h.x - l.x) < 40 && Math.abs(h.z - l.z) < 40);   // (v6.9.3: per faction: two sides can both shout "Contact!")
    let key = opt.key ?? (test ? has[Math.floor(Math.random() * has.length)] : CALL_KEY[text]);
    if (text === "IDLE") { const fresh = IDLE_LINES.filter((k) => voiceHas(lang, k) && !saidNear(k, 6000)); key = fresh[Math.floor(Math.random() * fresh.length)]; }
    if (!key || !voiceHas(lang, key)) return false;
    if (!test && !opt.force) {
      if (!opt.event && now - (lastCall.get(e.id) ?? -9999) < callGap()) return false;   // one shout per man every few seconds (v8.2: a one-off event or a squad decision always gets its line)
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
    // v9.19: at night with the enemy about but no shooting yet, it's said low (a whisper carries less far)
    let vol = 1; try { if (NIGHT && !perc.get(e.id)?.threat && squads.get(squadKey(e, sd(e)))?.known?.size && !["hit", "medic", "man_down", "grenade"].includes(key)) vol = 0.35; } catch {}
    playLine(e.dimension, headLoc(e), lang, key, pitch, { label: `${factionLabel(f)}§7 ${e.typeId === SOLDIER ? soldierName(e) : squadName(f, sd(e).squad)}${vol < 1 ? " §8(quietly)" : ""}`, forceSubs: opt.subs, vol });
    // v9.19: the men round him look at whoever's talking (out of a fight)
    if (!perc.get(e.id)?.threat && !squads.get(squadKey(e, sd(e)))?.known?.size && IDLE_LINES.includes(key)) for (const c of nearSnap(did, l, 6)) {   // (v9.19: only off duty, only chatter: never mid-fight)
      if (c.type !== SOLDIER || c.id === e.id || c.down || c.f !== f || !c.e.isValid || GLANCE.has(c.id) || perc.get(c.id)?.threat || personal.has(c.id)) continue;
      try { const cur = c.e.getRotation().y; GLANCE.set(c.id, { yaw: (Math.atan2(-(l.x - c.e.location.x), l.z - c.e.location.z) * 180) / Math.PI, until: now + 40 + Math.floor(Math.random() * 30), back: REST_YAW.get(c.id) ?? cur }); } catch {}
    }
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
  const reply = (r, text, delay, opt) => system.runTimeout(() => { try { const who = mate(r); if (who?.isValid) callout(who, text, opt); } catch {} }, delay);
  const lang = voiceOfMan(e), r0 = Math.random();
  // v9.5: the new back-and-forth (only where the language has the answer recorded)
  if (IDLE_ASK[key] && voiceHas(lang, IDLE_ASK[key])) { if (r0 < 0.85) reply(10, "REPLY", 45 + Math.floor(Math.random() * 25), { key: IDLE_ASK[key], event: true }); return; }
  if (STORIES.includes(key) || key === "story") { if (r0 < 0.7) reply(6, "REPLY", 30, { key: Math.random() < 0.5 ? "camp_laugh" : "camp_again", event: true }); return; }
  if (key === "target_down" && r0 < 0.3) { reply(12, "Nice shot!", 22); return; }
  if (key === "hit" && r0 < 0.25) { reply(10, "Hang on, I got you!", 22); return; }
  if (key === "cover_me" && r0 < 0.4) { reply(10, "On it!", 16); return; }
  if ((key === "hold" || key === "follow") && r0 < 0.4) { reply(16, "Copy that!", 20); return; }
  if (key === "reloading" && Math.random() < 0.6) reply(10, "Suppressing!", 18);
  else if (key === "contact" && Math.random() < 0.5) reply(16, "Enemy spotted!", 30);
  else if (key === "hit" && Math.random() < 0.4) reply(10, "Man down!", 20);
  else if (IDLE_LINES.includes(key) && Math.random() < 0.45) reply(10, "IDLE", 70 + Math.floor(Math.random() * 40));
  else if (key === "clear" && Math.random() < 0.35) reply(16, "Hold position!", 40);
}
async function voiceMenu(player) {
  const pick = await show(new ActionFormData().title("Callouts")
    .button("Set the language per faction").button("Test: soldiers near me each say a line").button("Test: play EVERY line, one by one")
    .button("Test: play one line...").button("How often they talk / subtitles / names").button("« Back"), player);
  if (!pick || pick.canceled || pick.selection === undefined) return;
  if (pick.selection === 1) { testCallouts(player); return; }
  if (pick.selection === 2) { testEveryLine(player); return; }
  if (pick.selection === 3) { await testOneLine(player); return; }
  if (pick.selection === 4) {
    const r = await show(new ModalFormData().title("Callouts").dropdown("How often they talk", ["Less", "Normal", "A lot"], { defaultValueIndex: Number(setting("vfreq", 1)) })
      .toggle("Subtitles (the line, in English, on screen)", { defaultValue: !!setting("vsubs", false) })
      .toggle("Mixed heritage names (about 1 in 7 men has a surname from another culture)", { defaultValue: !!setting("mixnames", false) }), player);
    if (!r || r.canceled || !r.formValues) return;
    sdp(world, "war:set_vfreq", Number(r.formValues[0])); sdp(world, "war:set_vsubs", !!r.formValues[1]); sdp(world, "war:set_mixnames", !!r.formValues[2]);
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
  for (const e of allOf(SOLDIER)) { try { updateName(e); NAME_KEY.delete(e.id); syncSkin(e); } catch {} }   // (v9.23: their names change with the language, now; v9.19: and a mixed faction's skins)
  player.sendMessage("§aCallout languages saved. Soldiers' names now follow each faction's language.");
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
  try { callMedic(e); } catch {}
  try { logTo(WOUNDS, e.id, now); const k = killer?.typeId === SOLDIER ? killer : lastAttacker(e, now); if (k?.typeId === SOLDIER && k.id !== e.id) giveXp(k, 2); } catch {}   // (v9.18)
  try {                                                          // (v6.5) the man who dropped him calls it
    let ke = killer?.isValid ? killer : undefined;
    if (!ke) { const k = hurtBy.get(e.id); if (k && now - k.t < 40) ke = world.getEntity(k.id); }
    if (ke?.typeId === SOLDIER) callout(ke, "Target down!");
  } catch {}
  downed.set(e.id, now + 600); v9stat("wentDown");
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
  downFall(e);                                                     // (v9.14: he drops like a body does)
}
function medicComing(id, now) {
  for (const [mid, mt] of medicTask) if (mt.target === id && now - (mt.t ?? 0) < 60) { const m = world.getEntity(mid); if (m?.isValid && !downed.has(mid)) return true; }
  return false;
}
function revive(e, hpTo = 6) {
  { const fb = FALLS.get(e.id), st = fb && RD.get(fb); if (st) { finishFall(st); RD.delete(fb); } }
  downed.delete(e.id); downPos.delete(e.id);
  setP(e, "war:down", false);
  sdp(e, "war:downed", undefined);
  try { e.removeEffect("slowness"); e.removeEffect("weakness"); } catch {}
  const h = hpOf(e);
  if (h) h.setCurrentValue(Math.min(h.effectiveMax, hpTo));
  try { e.dimension.spawnParticle("minecraft:heart_particle", { x: e.location.x, y: e.location.y + 2, z: e.location.z }); } catch {}
  nickCount(e, "lucky");
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
      if (FALLS.has(id)) throw 0;                                   // (v9.14: his body is still falling)
      const at = downPos.get(id) ?? e.location; if (!downPos.has(id)) downPos.set(id, { ...at });
      if (dist(at, e.location) > 0.6) e.teleport(at);
      e.clearVelocity?.();
      const hh = hpOf(e); if (hh && hh.currentValue !== 1) hh.setCurrentValue(1);
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
  const h = hpOf(e);
  if (!h) return "";
  const r = Math.max(0, h.currentValue / h.effectiveMax), n = Math.round(r * 6);
  const col = r > 0.6 ? "§a" : r > 0.3 ? "§e" : "§c";
  return `${col}${"■".repeat(n)}§8${"■".repeat(6 - n)}`;
}
const woundK = (e) => { const h = hpOf(e); if (!h) return 1; const r = h.currentValue / h.effectiveMax; return r < 0.5 ? 1 + (0.5 - r) * 2 : 1; }; // up to 2x worse aim
const lastHp = new Map();
system.runInterval(() => {
  for (const e of allOf(SOLDIER)) {
    try {
      const h = hpOf(e); if (!h) continue;
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
      const h = hpOf(o); if (!h) continue;
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
    // (v9.20.3: right beside him, not three blocks off: the game's walking stops 3 short of where it's sent, and a medic
    //  sent to the wounded man's own spot stood 2.8 blocks away forever, "going to a downed soldier", never in reach)
    if (dd < 2.8) mt.nearT ??= now; else mt.nearT = undefined;
    if ((dd < 1.9 || (dd < 2.8 && now - (mt.nearT ?? now) > 30)) && dy < 2.2) {
      mt.progT = now;
      if (isDowned(best)) {
        mt.reachT ??= now;
        note(e, "treating a downed soldier"); KNEEL.set(e.id, now + 20); turnTo(e, best.location, 30);
        if (now - mt.reachT >= 50) { revive(best, 8); creditSave(e); mt.reachT = undefined; note(e, "revived a soldier"); callout(e, "You're okay!", { event: true }); const rb = best; system.runTimeout(() => callout(rb, "Thanks!", { event: true }), 30); }
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
    if (dd < 6 && dy < 1.2 && !isIndoors(e) && straightReach(e.dimension, e.location, best.location, true)) {   // the last steps: sent just past him, so he stops at his side
      const bl = best.location, L = dd || 1, past = { x: bl.x + ((bl.x - e.location.x) / L) * 2.2, y: bl.y, z: bl.z + ((bl.z - e.location.z) / L) * 2.2 };
      const slot = myMarker(e, past, "war:mymk", 0.6);
      if (dd < 3.2) push(e, { x: ((bl.x - e.location.x) / L) * 0.12, y: 0, z: ((bl.z - e.location.z) / L) * 0.12 }, 2);
      if (slot) return { g: "g_wp", slot, t: "t_off", urgent: true };
    }
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
// v7.1: the radio is the commander's, and it's kept short. Settings -> General: Off / Important only (default: contact,
// area clear, in position, a man surrendered) / Everything. The same message from the same squad never twice in 30 s,
// and no more than one message every 3 s to a commander.
const IMPORTANT = /^(contact|area clear|in position|one of ours)/;
const radioSaid = new Map(), radioCmdrT = new Map();
function radio(e, text, force = false) {
  try {
    const lvl = Number(setting("radio", 1));
    if (lvl <= 0 || (lvl === 1 && !IMPORTANT.test(text) && force !== "story")) return;   // (v9.18: names, promotions, medals: always)
    const d = sd(e), cmdr = findPlayer(gdp(e, "war:cmdr"));
    if (!cmdr) return;
    const k = squadKey(e, d), now = tick();
    if (!force && now - (lastRadio.get(k) ?? -9999) < 200) return;
    const tk = `${k}|${text.replace(/\d+/g, "#")}`;
    if (now - (radioSaid.get(tk) ?? -9999) < 600 || now - (radioCmdrT.get(cmdr.id) ?? -9999) < 60) return;
    radioSaid.set(tk, now); radioCmdrT.set(cmdr.id, now);
    if (radioSaid.size > 500) radioSaid.clear();
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
// v9.19: a faction's people. Each faction has a primary language and skin (most of the men) and, if you like, a second
// and a third group, each with its own language, skin and share of the men. A soldier belongs to one group for good:
// his voice, his name and his skin all come from it (say a US army: US English; AAVE with the American Infantry
// (Black) skin, 30% of the men).
const fGroups = (f) => getJSON(world, "war:fgroups", {})[f] ?? [];
function groupOf(e, f) {
  const gs = fGroups(f);
  if (gs.length) {
    const r = (Math.floor(idSeed(e) / 31) % 100) / 100; let acc = 0;
    for (const g of gs) { acc += (g.pct ?? 0) / 100; if (r < acc) return { lang: VOICE_KEYS.includes(g.lang) ? g.lang : voiceOf(f), skin: Number(g.skin ?? 0) || factionSkin(f), n: 1 }; }
  }
  return { lang: voiceOf(f), skin: factionSkin(f), n: 0 };
}
async function factionSkinMenu(player) {
  const FO = facOrder();
  const allS = getJSON(world, "war:fskins", {}), allL = getJSON(world, "war:vlang", {}), allG = getJSON(world, "war:fgroups", {});
  const choices = [{ name: "Faction uniform", slot: 0 }, ...skinChoices()];
  const nm = (slot) => choices.find((c) => c.slot === Number(slot ?? 0))?.name ?? "Faction uniform";
  const ln = (k) => VOICE_NAMES[Math.max(0, VOICE_KEYS.indexOf(k))];
  const pick = new ActionFormData().title("Faction people: languages and skins").body("Pick a faction. Each has a primary language and skin, and optionally a second and third group of men with their own.");
  FO.forEach((fac) => { const gs = allG[fac] ?? []; pick.button(`${factionLabel(fac, true)}\n§8${ln(voiceOf(fac))} / ${nm(allS[fac])}${gs.map((g) => ` + ${g.pct}% ${ln(g.lang)}`).join("")}`); });
  const pr = await show(pick, player);
  if (!pr || pr.canceled || pr.selection === undefined) return;
  const fac = FO[pr.selection], gs = allG[fac] ?? [];
  const langIdx = (k) => Math.max(0, VOICE_KEYS.indexOf(k));
  const skinIdx = (sl) => Math.max(0, choices.findIndex((c) => c.slot === Number(sl ?? 0)));
  const f = new ModalFormData().title(`${factionLabel(fac, true)}`)
    .dropdown("Primary language", VOICE_NAMES, { defaultValueIndex: langIdx(voiceOf(fac)) })
    .dropdown("Primary skin", choices.map((c) => c.name), { defaultValueIndex: skinIdx(allS[fac]) });
  for (const [k, label] of [[0, "Second"], [1, "Third"]]) {
    const g = gs[k];
    f.dropdown(`${label} group: language (None: no ${label.toLowerCase()} group)`, ["None", ...VOICE_NAMES], { defaultValueIndex: g ? langIdx(g.lang) + 1 : 0 })
      .dropdown(`${label} group: skin`, ["Same as the primary skin", ...choices.slice(1).map((c) => c.name)], { defaultValueIndex: g?.skin ? skinIdx(g.skin) : 0 })
      .slider(`${label} group: share of the men (%)`, 5, 60, { valueStep: 5, defaultValue: g?.pct ?? (k ? 15 : 30) });
  }
  f.toggle("Also apply to soldiers with their own skin (everyone matches)", { defaultValue: false });
  const r = await show(f, player);
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues.map((x) => (typeof x === "boolean" ? x : Number(x)));
  allL[fac] = VOICE_KEYS[v[0]] ?? "en_us"; allS[fac] = choices[v[1]]?.slot ?? 0;
  const out = [];
  for (const k of [0, 1]) { const L = v[2 + k * 3], S0 = v[3 + k * 3], P0 = v[4 + k * 3]; if (L) out.push({ lang: VOICE_KEYS[L - 1], skin: S0 ? choices[S0]?.slot ?? 0 : 0, pct: P0 }); }
  const tot = out.reduce((t, g) => t + g.pct, 0); if (tot > 90) for (const g of out) g.pct = Math.floor((g.pct * 90) / tot);   // (the primary always keeps some men)
  if (out.length) allG[fac] = out; else delete allG[fac];
  setJSON(world, "war:vlang", allL); setJSON(world, "war:fskins", allS); setJSON(world, "war:fgroups", allG);
  const everyone = !!v[8];
  for (const e of allOf(SOLDIER)) {
    try { if (Number(P(e, "war:faction") ?? 0) !== fac) continue; if (everyone) setP(e, "war:skin", 0); syncSkin(e); NAME_KEY.delete(e.id); updateName(e); } catch {}
  }
  player.sendMessage(`§aSaved for ${factionLabel(fac, true)}§a: ${ln(allL[fac])} / ${nm(allS[fac])}${out.map((g) => `, ${g.pct}% ${ln(g.lang)} / ${g.skin ? nm(g.skin) : "primary skin"}`).join("")}.`);
}
const factionSkinFor = (e, f) => groupOf(e, f).skin;
// the skin actually drawn: his own Unit Wand skin, else his faction's skin, else the faction uniform
function syncSkin(e) {
  try {
    const own = Number(gdp(e, "p_war:skin") ?? 0);
    const eff = own || factionSkinFor(e, Number(P(e, "war:faction") ?? 0));
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
  const h = hpOf(e); if (h) h.setCurrentValue(Math.max(h.currentValue, 6));
  pows.set(e.id, { captor: captor.id, mode: "follow" });
  sdp(e, "war:pow", JSON.stringify({ captor: captor.id, mode: "follow" }));
  equip(e, "air"); setP(e, "war:gun", 0);
  applyRelations(e);                                               // (v9.19: no longer anybody's target)
  for (const S of squads.values()) S.known?.delete(e.id);          // (forgotten as an enemy, and nobody keeps aiming at him)
  for (const [id, st] of gunState) if (st.target?.id === e.id) { st.target = undefined; st.supp = undefined; }
  for (const [id, ps] of perc) if (ps?.threat?.id === e.id) ps.threat = undefined;
  dropPersonal(e); gliders.delete(e.id); brain.delete(e.id);                       // (v9.20.3: whatever he was doing (a charge, a route to the fight) is over)
  { const ps = perc.get(e.id); if (ps) ps.threat = undefined; }
  updateName(e);
}
function dropPersonal(e) { const pr = personal.get(e.id); if (pr?.job && pr.planning) pr.job.cancel = true; personal.delete(e.id); travelTo.delete(e.id); }
function freePow(e, rearm) {
  pows.delete(e.id); sdp(e, "war:pow", undefined); setP(e, "war:hands", false);
  if (rearm) equip(e, weaponItem(e));
  updateName(e);
}
const isPow = (e) => pows.has(e.id);
// v9.20.3: a prisoner keeps close behind whoever took him: you, if you did; the soldier who did, if a soldier did (and
// if that man falls, the nearest of his side takes charge of him). A soldier's prisoner goes with him till the man is
// back at his own lines, and is left there under guard. Close in, the follow driver carries him along at his captor's
// pace; further off he walks a straight line where there is one and a real route where there isn't.
function powCaptor(e, pw) {
  const c = findPlayer(pw.captor) ?? world.getEntity(pw.captor);
  if (c?.isValid && !downed.has(c.id) && !pows.has(c.id) && !(c.typeId === SOLDIER && gdp(c, "war:surr"))) return c;
  if (!pw.cf) return undefined;                                                   // (a player's prisoner waits for him)
  const n = powSuccessor(e, pw);
  if (!n) return undefined;
  if (n.how === "taken") { soldierTakes(e, n.c); v9stat("powRetaken"); return n.c; }   // (another side at war with him: their prisoner now)
  pw.captor = n.c.id; pw.on = undefined;
  try { pw.sqn = Number(sd(n.c).squad ?? 0); } catch {}
  sdp(e, "war:pow", powJSON(pw));
  note(n.c, "took charge of a prisoner"); v9stat(n.how === "group" ? "powHandover" : "powHandoverSide");
  return n.c;
}
// v9.21.2: who takes charge of a prisoner when the man guarding him falls: the next closest of the same group (squad),
// again and again as they fall; with all of them gone, the closest of the same side; with none of those, the closest
// soldier of another side at war with the prisoner, whose prisoner he then becomes (taken to their lines). Nobody near:
// he's left where he is (and may slip away).
function powSuccessor(e, pw) {
  const l = e.location, pf = Number(P(e, "war:faction") ?? 0);
  const near = nearSnap(e.dimension.id, l, 48).filter((o) => o.type === SOLDIER && !o.down && o.f && o.id !== e.id && !pows.has(o.id) && o.e?.isValid && !gdp(o.e, "war:surr")).sort((a, b) => a.dd - b.dd);
  if (pw.sqn) { const g = near.find((o) => o.f === pw.cf && Number(sd(o.e).squad ?? 0) === pw.sqn); if (g) return { c: g.e, how: "group" }; }
  const side = near.find((o) => o.f === pw.cf && o.dd <= 24); if (side) return { c: side.e, how: "side" };
  const other = near.find((o) => o.f !== pw.cf && isHostile(o.f, pf) && o.dd <= 24); if (other) return { c: other.e, how: "taken" };
  return undefined;
}
const powJSON = (pw) => JSON.stringify({ captor: pw.captor, mode: pw.mode, at: pw.at, cf: pw.cf, sqn: pw.sqn });
const POWHEAD = new Map();   // captor id -> { ref, last, head, pace, t }: which way he's going, and how fast
function captorHead(c, now) {
  let H = POWHEAD.get(c.id);
  if (H && H.t === now) return H;
  H ??= {}; const l = c.location;
  H.pace = H.last ? Math.min(0.6, Math.hypot(l.x - H.last.x, l.z - H.last.z) / Math.max(1, now - H.t)) : 0;
  if (H.ref) {
    const vx = l.x - H.ref.x, vz = l.z - H.ref.z, sp = Math.hypot(vx, vz);
    if (sp > 20) H.ref = { x: l.x, z: l.z };
    else if (sp > 0.8) { const hx = (H.head?.x ?? 0) * 0.4 + (vx / sp) * 0.6, hz = (H.head?.z ?? 1) * 0.4 + (vz / sp) * 0.6, L = Math.hypot(hx, hz) || 1; H.head = { x: hx / L, z: hz / L }; H.ref = { x: l.x, z: l.z }; }
  } else H.ref = { x: l.x, z: l.z };
  if (!H.head) { const f = fwdFromYaw(c.getRotation().y); H.head = { x: f.x, z: f.z }; }
  H.last = { x: l.x, z: l.z }; H.t = now;
  POWHEAD.set(c.id, H);
  return H;
}
function powSlot(e, c, pw, H) {
  const ids = []; for (const [id, q] of pows) if (q.captor === pw.captor && q.mode === "follow") ids.push(id);
  ids.sort();
  const i = Math.max(0, ids.indexOf(e.id)), back = 2.2 + Math.floor(i / 2) * 1.4, side = ids.length > 1 ? (i % 2 ? 0.7 : -0.7) : 0;
  const l = c.location, x = l.x - H.head.x * back - H.head.z * side, z = l.z - H.head.z * back + H.head.x * side;
  const w = walkableNear(e.dimension, x, z, l.y);
  return w && Math.abs(w.y - l.y) <= 2.5 ? { x: w.x, y: w.y, z: w.z } : { x: l.x, y: Math.floor(l.y + 0.01), z: l.z };
}
function powMove(e, now) {
  let pw = pows.get(e.id);
  if (!pw) return undefined;
  const g = { w: "w_none", t: "t_off", d: "d_off", r: "r_off", s: "s_1" };
  const save = () => sdp(e, "war:pow", powJSON(pw));
  if (personal.has(e.id) && personal.get(e.id).kind !== "follow") dropPersonal(e);   // (a prisoner goes nowhere of his own)
  if (pw.mode !== "jail") {
    const c = powCaptor(e, pw);
    pw = pows.get(e.id) ?? pw;                                                    // (taken by another side: a new record)
    if (!c && pw.cf) { pw.mode = "jail"; pw.at ??= { ...e.location }; pw.slot = undefined; save(); }   // (his guards are all gone: on to their lines by himself, as before)
    else if (c?.typeId === SOLDIER && pw.at && flat(c.location, pw.at) < 8 && Math.abs(c.location.y - pw.at.y) < 4) { pw.mode = "jail"; pw.slot = undefined; save(); note(c, "handed over a prisoner"); v9stat("powJailed"); }
    else {
      if (!c || c.dimension.id !== e.dimension.id) return { ...g, g: "g_none", slot: 0 };
      pw.on = now;
      const H = captorHead(c, now), sp = powSlot(e, c, pw, H), l = e.location;
      const gap = flat(sp, l), dd = dist(c.location, l);
      if (dd > 64) { tpNear(e, sp, e.dimension); v9stat("powCatchTp"); return { ...g, g: "g_none", slot: 0 }; }   // (far behind: the last resort)
      if (gap < 12 && Math.abs(sp.y - l.y) < 1.2 && (gap < 5 || straightReach(e.dimension, l, sp))) {   // near, nothing in the way: the driver below brings him in and keeps him there
        if (personal.get(e.id)?.kind === "follow") { personal.delete(e.id); travelTo.delete(e.id); }
        return { ...g, g: "g_none", slot: 0 };
      }
      const mv = catchUp(e, sp, c.location, now, H.head);
      return mv ? { ...g, g: mv.g, slot: mv.slot ?? 0, s: gap > 14 ? "s_7" : "s_6" } : { ...g, g: "g_none", slot: 0 };   // (quicker than you walk: he closes up)
    }
  }
  if (!pw.slot || !marker(pw.slot)) pw.slot = makeWaypoint(e.dimension, pw.at ?? e.location);
  const a = marker(pw.slot);
  if (a && flat(a.location, e.location) > 6) {                                     // (a long way to his captors' lines: a real route)
    const mv = catchUp(e, a.location, a.location, now);
    if (mv) return { ...g, g: mv.g, slot: mv.slot ?? 0, s: "s_2" };
  }
  if (personal.get(e.id)?.kind === "follow") { personal.delete(e.id); travelTo.delete(e.id); }
  return { ...g, g: a && flat(a.location, e.location) > 3 ? "g_wp" : "g_none", slot: pw.slot };
}
// catching up with someone on the move (a leader, a captor): a plain walk where there is one, a real route where there
// isn't (round a building, up the stairs, over a wall): Minecraft's own following gave up a little way off. A route
// is kept while the man ahead stays near its end (no stopping to work out a new one every few steps), and while one is
// being worked out he keeps walking his way.
function catchUp(e, spot, lead, now, ahead) {
  const l = e.location, mk = (q) => { const slot = myMarker(e, q, "war:mymk", 1.0); return slot ? { g: "g_wp", slot, t: "t_mid", urgent: true } : undefined; };
  let pr = personal.get(e.id);
  if (pr && pr.kind !== "follow") return followPersonal(e, now) ?? mk(spot);      // (on another errand's route: that first)
  const D = flat(spot, l), open = !isIndoors(e) && !onStairs(e.dimension, l);
  if (open && Math.abs(spot.y - l.y) <= 1 && D <= 16 && straightReach(e.dimension, l, spot)) {   // a plain walk
    if (pr) { personal.delete(e.id); travelTo.delete(e.id); }
    return mk(ahead ? { x: spot.x + ahead.x * 3, y: spot.y, z: spot.z + ahead.z * 3 } : spot);   // (a little ahead: the game's following stops short)
  }
  const to = { x: lead.x, y: Math.floor(lead.y + 0.01), z: lead.z };
  if (!pr || (!pr.planning && (!pr.pts || flat(pr.dest, to) > 10 || Math.abs(pr.dest.y - to.y) > 2))) { travelTo.set(e.id, to); planPersonalTo(e, "follow", to, now); pr = personal.get(e.id); }
  const r = followPersonal(e, now);
  if (r?.g === "g_wp") return r;
  // no route yet (being worked out): meanwhile a clear stretch his way, if there is one; else he waits for it
  if (open && D > 16 && Math.abs(spot.y - l.y) <= 3) {
    const m = walkableNear(e.dimension, l.x + ((spot.x - l.x) * 12) / D, l.z + ((spot.z - l.z) * 12) / D, l.y);
    if (m && Math.abs(m.y - l.y) <= 1 && straightReach(e.dimension, l, m)) return mk(m);
  }
  return personal.has(e.id) ? { g: "g_none", t: "t_mid", urgent: false } : mk(spot);
}
// one step of a follow driver: a man near his place is carried onto it at the pace of the man he follows, facing the
// way they're going; a wall, a drop or a step too high and his own walking takes over
function driveStep(e, sp, maxStep, head, avoid, reach = 7) {
  const l = e.location, dx = sp.x - l.x, dz = sp.z - l.z, L = Math.hypot(dx, dz);
  if (L > reach || Math.abs(sp.y - l.y) > 1.2 || L < 0.1) return false;
  const stp = Math.min(L, maxStep), nx = l.x + (dx / L) * stp, nz = l.z + (dz / L) * stp;
  if (avoid && Math.hypot(nx - avoid.x, nz - avoid.z) < 0.9) return false;               // (never into him)
  let ny; for (const yy of [l.y, Math.floor(l.y + 0.01) + 1, Math.floor(l.y + 0.01) + 0.5, l.y - 0.5]) { if (yy > l.y + 1.1) continue; if (glideFree(e.dimension, nx, yy, nz) && floorUnder(e.dimension, nx, yy, nz)) { ny = yy; break; } }
  if (ny === undefined || dangerNear(e.dimension, { x: nx, y: ny, z: nz })) return false;
  e.teleport({ x: nx, y: ny, z: nz }, { rotation: faceRot(e, { x: nx, y: ny, z: nz }, { x: nx + head.x * 6, z: nz + head.z * 6 }, 10) });
  return true;
}
system.runInterval(() => {                                                          // the prisoners' driver
  if (!pows.size) return;
  const now = tick();
  for (const [id, pw] of pows) {
    if (pw.mode === "jail" || now - (pw.on ?? -999) > 100) continue;
    try {
      const e = world.getEntity(id);
      if (!e?.isValid || downed.has(id) || isRiding(e) || climbing.has(id) || gliders.has(id) || personal.has(id) || staggered(id)) continue;
      const c = findPlayer(pw.captor) ?? world.getEntity(pw.captor);
      if (!c?.isValid || c.dimension.id !== e.dimension.id) continue;
      const H = captorHead(c, now), sp = powSlot(e, c, pw, H), L = flat(sp, e.location);
      if (L > 5 && now - (pw.srT ?? -99) >= 10) { pw.srT = now; pw.sr = straightReach(e.dimension, e.location, sp); }   // (a clear walk to his place: checked twice a second)
      const far = L > 5 && pw.sr;
      const base = far ? 0.3 : L > 1.5 ? Math.max(0.22, H.pace * 1.4) : 0.18;     // (behind his place: a little quicker than his captor till he's in it)
      if (!driveStep(e, sp, Math.min(0.42, Math.max(base, H.pace * 1.3)), H.head, c.location, far ? 12 : 7)) {
        pw.sr = false;
        if (L > 7 && now - (KICK.get(id) ?? -99) > 15) { KICK.set(id, now); try { think(e); } catch {} }   // (his captor got away from him: he goes now)
      }   // (blocked: walking / a route takes over)
    } catch {}
  }
}, 1);
system.runInterval(() => { const now = tick(); for (const [k, H] of [...POWHEAD]) if (now - H.t > 200) POWHEAD.delete(k); }, 200);
// ---- callouts: test button (every soldier near you calls out once, right now)
function testCallouts(player) {
  let n = 0;
  const used = new Set();
  for (const e of player.dimension.getEntities({ type: SOLDIER, location: player.location, maxDistance: 24 })) {
    const lang = voiceOfMan(e), has = (VOICE_HAS[lang] ?? BASE_LINES).filter((k) => !used.has(k));
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
  const lang = voiceOfMan(e);
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
  const key = keys[Number(r.formValues[0])], lang0 = VOICE_KEYS[Number(r.formValues[1]) + 1], lang = MIXES[lang0] ? MIXES[lang0][Math.floor(Math.random() * MIXES[lang0].length)][0] : lang0;
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

// ---- MG nests (removed in v9.15; the gunboat's / helicopter's MG seat still fires the same way)
const NEST = "war:mg_nest";
const NEST_SPEC = { bullet: "ww:nlmg_projectile", sight: 200, fire: 200, mag: 40, gap: 2, reload: 50, speed: 5.0, spread: 0.006 };
function ridingNest(e) { try { const on = rideInfo(e).on; return on === NEST || (MG_SEAT.includes(on) && gunSeat(e)); } catch { return false; } }
// v9.2: the gunboat's / helicopter's second seat is the MG: a soldier there fires it as from a nest
function gunSeat(e) { try { const v = e.getComponent("minecraft:riding")?.entityRidingOn; const rs = v?.getComponent("minecraft:rideable")?.getRiders() ?? []; return rs[1]?.id === e.id; } catch { return false; } }
// v9.15: MG nests are gone: any left in a world lets its gunner off (he takes his own gun back) and is taken away
system.runInterval(() => {
  for (const n of allOf(NEST)) { try { const rd = n.getComponent("minecraft:rideable"); for (const r of rd?.getRiders() ?? []) rd.ejectRider(r); n.remove(); } catch {} }
}, 100);

// one menu for the downed and for prisoners (Unit Wand or right-click)
async function captiveMenu(p, e) {
  const pf = playerFaction(p), ef = Number(P(e, "war:faction"));
  const friendly = isFriendly(pf, ef);
  if (isPow(e)) {
    const pw = pows.get(e.id);
    if (friendly && pf !== ef) { p.onScreenDisplay.setActionBar("§7A prisoner. Only his own side can free him."); return; }
    if (friendly) { const r = await show(new ActionFormData().title("Captured comrade").button("Free and rearm him"), p); if (r && !r.canceled && r.selection === 0) { freePow(e, true); p.onScreenDisplay.setActionBar("§aFreed and rearmed."); } return; }
    const r = await show(new ActionFormData().title("Prisoner").button(pw.mode === "jail" || pw.captor !== p.id ? "Follow me" : "Imprison (stay here)").button("Release (goes home unarmed)").button("§cKill"), p);
    if (!r || r.canceled || r.selection === undefined || !e.isValid) return;
    if (r.selection === 0) {
      if (pw.mode === "jail" || pw.captor !== p.id) { pw.mode = "follow"; pw.captor = p.id; pw.on = undefined; pw.slot = undefined; pw.cf = undefined; pw.at = undefined; }
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
// (v8.1: removing or replacing a soldier's route also stops its search, wherever in the code that happens: on a real
//  server searches nobody was waiting for any more filled the planner's queue)
class RouteTable extends Map {
  set(k, v) { const o = super.get(k); if (o && o !== v && o.job && o.planning) o.job.cancel = true; return super.set(k, v); }
  delete(k) { const o = super.get(k); if (o?.job && o.planning) o.job.cancel = true; return super.delete(k); }
  clear() { for (const o of super.values()) if (o?.job && o.planning) o.job.cancel = true; super.clear(); }
}
const personal = new RouteTable(); // id -> { pts, idx, kind, t, planning }
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
  const drop = () => { if (pr.job && pr.planning) pr.job.cancel = true; personal.delete(e.id); travelTo.delete(e.id); return undefined; };
  if (pr.planning && pr.waitKey) {                                     // (v7.3: a mate's route to the same place)
    const hit = cachedRoute(e.dimension, e.location, pr.dest);
    if (hit) { pr.planning = false; pr.pts = hit; pr.waitKey = undefined; pr.t = now; }
    else if (!PENDING.has(pr.waitKey) || now - pr.t > 400) { const k = pr.kind, d0 = pr.dest; personal.delete(e.id); PENDING.delete(pr.waitKey); planPersonalTo(e, k, d0, now); return { g: "g_none", t: "t_mid", urgent: false }; }
  }
  if (pr.planning && pr.dest && STAIRS.length && (now - pr.t) % 10 === 0 && Math.abs(pr.dest.y - e.location.y) > 2.5 && flat(pr.dest, e.location) <= 40) {
    const r = portalRoute(e.dimension, e.location, pr.dest);                  // (v9.2: the stairs were just learned: no more waiting)
    if (r && r.length > 1) { if (pr.job) pr.job.cancel = true; if (pr.waitKey) PENDING.delete(pr.waitKey); pr.planning = false; pr.pts = r; pr.idx = 0; pr.t = now; pr.waitKey = undefined; }
  }
  if (pr.planning) {
    if (now - pr.t > (["advance", "engage", "settle"].includes(pr.kind) ? 400 : 160)) { if (globalThis.__planStats) globalThis.__planStats.dropped++; return drop(); }
    if (pr.prev?.pts && now - pr.t < 100) {                                         // (v9.20.3: no standing about while it's worked out)
      const P = pr.prev.pts, k = nearestIdx(P, e.location, 0, P.length);
      if (k < P.length - 1 && r3(P[k], e.location) < 4) { const slot = myMarker(e, P[lookahead(P, k, 5)]); if (slot) return { g: "g_wp", slot, t: "t_mid", urgent: true }; }
    }
    return now - pr.t < 40 ? { g: "g_none", t: "t_mid", urgent: false } : undefined;
  }   // a short wait for the route; never frozen (v7.3: a long one gets time)
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
  if ((pr.kind === "advance" || pr.kind === "engage") && stackAtDoor(e, pr, i, now)) { pr.hold = now + 25; pr.progT = now; note(e, "stacking up at the door"); return { g: "g_none", t: "t_mid", urgent: false }; }   // (v9.0)
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
    const hit = rayHit(e.dimension, h, { x: dx / L, y: dy / L, z: dz / L }, 4)?.hb;
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
  { const ci = closeIn(e, d, now, S, B, t, anchor); if (ci) return ci; }   // v7.1: they know where he is and nobody's firing: go to him
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
const BPLANS = { windows: "manning the windows", secure: "securing the building", sortie: "going out after them", contain: "covering the building", assault: "storming the building", garrison: "holding the building", defend: "defending the building", attack: "attacking the building" };
// v7.2: doctrine, not a coin toss. Up to v7.1 a squad picked ONE plan at random (all to the windows, or all out the
// door...). Now a squad in a building always splits the jobs, the way a real section holds a house:
//   garrison (told to hold it, nobody seen yet) / defend (enemy outside or below): a few men inside the ground floor
//     covering the ways in BEFORE anyone breaks in, a man on each stairhead, the rest at the upper windows (the
//     dominating position). Once the enemy is inside, the door men fight them there and the stairs stay held.
//   attack (we're outside, they're in): a support group shooting at the windows from outside, and an assault group
//     that goes in, clears the ground floor and goes up every staircase where the enemy is.
// The shares change a little every plan (and with the odds and how long it's been quiet), so no two fights are the same.
function buildingPlan(k, S, ours, known, now) {
  const dim = ours[0].dimension, oc = S.ourC;
  if (!oc) { S.bplan = undefined; return; }
  S.roster = ours.filter((e) => GUNS.includes(sd(e).weapon) && !downed.has(e.id)).map((e) => e.id).sort();
  const inside = ours.filter((e) => isIndoors(e)).length / ours.length;
  // (v7.3: whose house is it? A squad told to hold a spot inside it defends it; anyone else attacks it, even once he's
  //  inside: the attackers who broke in took on the defenders' jobs, "covering the way in" by the door they came in by)
  const homeIn = ours.filter((e) => { if (!ANCHORED.includes(sd(e).func)) return false; const a = anchorOf(e); return !!a && isIndoorsAt(dim, a.location); }).length * 2 >= ours.length;
  const B0 = S.bplan;
  if (!known.length) {                                                         // nobody about: set up the house before they come
    if (inside >= 0.5 && homeIn && ours.length >= 2) { if (B0?.kind !== "garrison") S.bplan = { kind: "garrison", t: now, until: now + 2400, said: false, door: 0.25 + Math.random() * 0.1, attack: 0 }; return; }
    S.bplan = undefined; return;
  }
  const kIn = known.filter((q) => isIndoorsAt(dim, q)).length / known.length;
  if (ours.some((e) => now - (gunState.get(e.id)?.lastShot ?? -999) < 80)) S.fightT = now;
  const quiet = now - (S.fightT ?? S.contactT ?? now);
  const stance = String(gdp(ours[0], "war:stance") ?? "aggressive"), bold = stance === "aggressive" && freeOf(ours[0]);
  if (B0 && B0.kind !== "garrison" && now < B0.until && !((B0.kind === "sortie" || B0.kind === "assault") && S.ratio < 0.55)) return;
  const opts = [];
  const otherFloor = known.filter((q) => Math.abs(q.y - oc.y) > 2.5 && isIndoorsAt(dim, q)).length;
  if (homeIn && inside >= 0.5) {
    // v8.2: the house is broken into (enemy inside it): with the numbers, clear it (counterattack, decided, not a coin
    // toss); without them, hold what's held (the stairheads and windows). Nobody stands about while the house is lost.
    const inHouse = known.filter((q) => isIndoorsAt(dim, q)).length;
    if (inHouse && S.ratio >= 1.0 && bold) opts.push(["assault", 4.0]);
    else if (inHouse && S.ratio < 0.6) opts.push(["defend", 4.0]);
    opts.push(["defend", 2.0]);
    if (bold && !inHouse && (S.ratio >= 1.4 || (S.ratio >= 1.0 && quiet > 900))) opts.push(["sortie", 0.2 + (S.ratio >= 1.8 ? 0.6 : 0) + (quiet > 900 ? 0.4 : 0)]);   // (out the door into their guns: only with the upper hand)
    if (bold && otherFloor && S.ratio >= 0.8 && !inHouse) opts.push(["assault", 0.6 + (S.ratio >= 1.2 ? 0.7 : 0) + (quiet > 300 ? 0.5 : 0)]);
  } else if (!homeIn && (kIn >= 0.5 || inside >= 0.5)) {
    opts.push(["attack", 2.0]);
    if ((!bold || S.ratio < 0.6) && inside < 0.5) opts.push(["contain", 1.5]);   // (once inside: no going back to covering it from outside)
  }
  if (!opts.length) { S.bplan = undefined; return; }
  const sum = opts.reduce((t, o) => t + o[1], 0);
  let r = Math.random() * sum, pick = opts[0][0];
  for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
  const attack = Math.min(0.9, 0.5 + Math.random() * 0.25 + (quiet > 600 ? 0.2 : 0) + (S.ratio >= 1.5 ? 0.1 : 0));
  S.bplan = { kind: pick, t: now, until: now + 500 + Math.floor(Math.random() * 400), said: pick === B0?.kind, door: 0.2 + Math.random() * 0.15, attack };
}
// the ways into this building on its ground floor: inside cells with open ground outside right next to them
const ENTR = new Map();
function entrances(dim, at) {
  const k = `${dim.id}|${Math.floor(at.x / 16)}|${Math.floor(at.z / 16)}`, now = tick(), c = ENTR.get(k);
  if (c && now - c.t < 600) return c.list;
  const cells = buildingCells(dim, at, 24);
  const list = [];
  if (cells.length) {
    const gy = Math.min(...cells.map((q) => q.y)), bx = Math.floor(at.x), bz = Math.floor(at.z);
    for (let dx = -24; dx <= 24; dx++) for (let dz = -24; dz <= 24; dz++) {          // (a scan of the ground floor: sampling missed doorways)
      const x = bx + dx, z = bz + dz;
      if (!standAt(dim, x, gy, z, now)) continue;
      let out = false;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (standAt(dim, x + ox, gy, z + oz, now)) { const o = { x: x + ox + 0.5, y: gy, z: z + oz + 0.5 }; if (!isIndoorsAt(dim, o)) { out = true; break; } }
      if (!out) continue;
      const q = { x: x + 0.5, y: gy, z: z + 0.5 };
      if (!isIndoorsAt(dim, q) || list.some((m) => flat(m, q) < 3)) continue;
      list.push(q);
    }
  }
  ENTR.set(k, { t: now, list });
  if (ENTR.size > 200) ENTR.clear();
  return list;
}
// a spot inside, 3-7 blocks back from a way in, that sees anyone coming through it (each door man his own way in)
function doorWatchSpot(e, S, idx, now) {
  const dim = e.dimension, ents = entrances(dim, e.location);
  if (!ents.length) return undefined;
  const ec = S.enemyC;
  if (ec) ents.sort((a, b) => flat(a, ec) - flat(b, ec));
  const en = ents[idx % ents.length], eye = { x: en.x, y: en.y + 1.2, z: en.z };
  let best, bs = -1e9, rays = 0;
  for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
    const r = Math.hypot(dx, dz); if (r < 3 || r > 8) continue;
    const q = { x: Math.floor(en.x) + dx + 0.5, y: en.y, z: Math.floor(en.z) + dz + 0.5 };
    if (!standAt(dim, Math.floor(q.x), q.y, Math.floor(q.z), now) || !isIndoorsAt(dim, q)) continue;
    if (claimedByOther(q, e.id, now) || onWayThrough(dim, q) || failedNear(e, q, now)) continue;
    if (++rays > 30) break;
    if (!clearShot(dim, { x: q.x, y: q.y + 1.6, z: q.z }, eye)) continue;
    const sc = -Math.abs(r - 5) - flat(q, e.location) * 0.05 + Math.random() * 0.5;
    if (sc > bs) { bs = sc; best = q; }
  }
  return best ? { spot: best, face: eye } : undefined;
}
// a spot 3-7 blocks from a stairhead on its floor that sees a man's head coming up (the stairheads above the ground floor)
function stairGuardSpot(e, S, idx, now) {
  const dim = e.dimension, cells = buildingCells(dim, e.location, 24);
  if (!cells.length) return undefined;
  const gy = Math.min(...cells.map((q) => q.y));
  const floors = [...new Set(cells.filter((q) => q.y > gy + 2).map((q) => q.y))];
  const mouths = [];
  for (const fy of floors) for (const m of stairMouths(dim, { x: e.location.x, y: fy, z: e.location.z }, 20)) if (Math.abs(m.y - fy) < 1 && !mouths.some((o) => flat(o, m) < 3 && Math.abs(o.y - m.y) < 1)) mouths.push(m);
  if (!mouths.length) return undefined;
  mouths.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);                 // the lowest stairheads first (the first floor up)
  const mouth = mouths[idx % mouths.length], head = { x: mouth.x, y: mouth.y + 0.6, z: mouth.z };
  let best, bs = -1e9, rays = 0;
  for (let r = 3; r <= 7 && rays < 16; r++) for (let k = 0; k < 8 && rays < 16; k++) {
    const a = (k / 8) * Math.PI * 2 + idx * 0.7;
    const q = walkableNear(dim, mouth.x + Math.cos(a) * r, mouth.z + Math.sin(a) * r, mouth.y);
    if (!q || Math.abs(q.y - mouth.y) > 0 || onWayThrough(dim, q) || claimedByOther(q, e.id, now) || mouths.some((m) => flat(m, q) < 2 && Math.abs(m.y - q.y) < 1) || !isIndoorsAt(dim, q)) continue;
    rays++;
    if (!clearShot(dim, { x: q.x, y: q.y + 1.6, z: q.z }, head)) continue;
    const sc = -Math.abs(r - 5) + Math.random() * 0.5;
    if (sc > bs) { bs = sc; best = q; }
  }
  return best ? { spot: best, face: head, n: mouths.length } : undefined;
}
// v7.4: a REAL window: right beside the spot (1-2 blocks), at head height, an opening (air, glass, a pane, bars)
// with open sky beyond it. Returns the point just outside it, or undefined.
const SEE_THRU = (b) => !!b && (b.isAir || passable(b) || b.typeId.includes("glass") || b.typeId.includes("pane") || b.typeId.includes("bars"));
function windowAt(dim, q) {
  const solid = (b) => !!b && !SEE_THRU(b);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const r of [1, 2, 3]) {
    try {
      const x = q.x + dx * r, z = q.z + dz * r;
      const head = tBlock(dim, x, q.y + 1, z);
      if (!SEE_THRU(head)) break;                                        // a wall straight ahead: no window this way
      const sill = tBlock(dim, x, q.y, z), lintel = tBlock(dim, x, q.y + 2, z);
      if (!(solid(sill) || solid(lintel) || !(sill?.isAir || passable(sill)))) continue;   // open floor: look further
      const out = { x: x + dx, y: q.y + 1, z: z + dz }, far = { x: x + dx * 3, y: q.y, z: z + dz * 3 };
      if (SEE_THRU(tBlock(dim, out.x, out.y, out.z)) && !isIndoorsAt(dim, far)) return { x: x + dx * 6, y: q.y + 1, z: z + dz * 6 };
      break;
    } catch { break; }
  }
  return undefined;
}
// the upper windows: a spot by a real window on a floor above the ground, with a shot at the enemy if there is one;
// spread over the windows (and the sides of the building), never a ground-floor spot, never a blank wall
function overwatchSpot(e, S, now) {
  const dim = e.dimension, cells = buildingCells(dim, e.location, 24);
  if (!cells.length) return undefined;
  const gy = Math.min(...cells.map((q) => q.y)), multi = cells.some((q) => q.y > gy + 2);
  const pool = cells.filter((q) => (!multi || q.y > gy + 2) && !onWayThrough(dim, q) && !claimedByOther(q, e.id, now) && !failedNear(e, q, now));
  const taken = [];
  for (const [id, B] of brain) if (id !== e.id && B.role?.spot && now - B.role.t < 600) taken.push(B.role.spot);
  const known = S.known?.size ? [...S.known.values()].filter((q) => q.ent?.isValid && !downed.has(q.ent.id)).slice(0, 3) : [];
  let best, bs = -1e9, checks = 0;
  for (let i = 0; i < Math.min(60, pool.length) && checks < 30; i++) {
    const q = pool[Math.floor(Math.random() * pool.length)];
    const out = windowAt(dim, q); if (!out) continue;
    checks++;
    let near = 99; for (const t of taken) if (Math.abs(t.y - q.y) < 2.5) near = Math.min(near, Math.hypot(t.x - q.x, t.z - q.z));
    let shot = 0, face = out;
    for (const k of known) if (clearShot(dim, { x: q.x, y: q.y + 1.6, z: q.z }, { x: k.x, y: k.y + 1.3, z: k.z })) { shot = 6; face = k; break; }
    const toward = S.enemyC ? -Math.hypot(out.x - S.enemyC.x, out.z - S.enemyC.z) * 0.05 : 0;   // (the side facing them)
    const sc = shot + Math.min(near, 6) + toward - flat(q, e.location) * 0.04;
    if (sc > bs) { bs = sc; best = { spot: q, face }; }
  }
  return best;
}
// v7.1: a plan is only reported once the men are actually carrying it out (half of them have their part and are on it);
// one nobody can carry out (no spot with a shot, no way up) is dropped within 10 s for another
function planCheck(S, ours, now) {
  const P0 = S.bplan; if (!P0) return;
  let doing = 0;
  for (const e of ours) { const R = brain.get(e.id)?.role; if (R?.planT === P0.t && R.spot) doing++; }
  if (!P0.said && doing >= Math.max(1, Math.ceil(ours.length / 2))) {
    P0.said = true;
    radio(ours[0], BPLANS[P0.kind], true);
    // v8.2: the line fits the plan (storming in, a sortie out, pushing up, or holding / covering)
    const line = { assault: "Go, go, go!", sortie: "Charge!", attack: "Moving up!", contain: "Suppressing!" }[P0.kind] ?? "Hold position!";
    callout(ours[Math.floor(Math.random() * ours.length)], line, { event: true });
  }
  if (now - P0.t > 200 && doing < Math.max(1, Math.ceil(ours.length / 3))) P0.until = now;   // not working: think again
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
    for (const m of stairMouths(dim, { x: l.x, y: fy, z: l.z }, 32)) if (Math.abs(m.y - fy) < 1 && !mouths.some((o) => flat(o, m) < 3)) mouths.push(m);   // (v7.3: and the stairs near HIM: in a big hall they're rarely by the enemy)
    const fails = failSpots.get(e.id) ?? [];
    mouths.sort((a, b) => (fails.some((f) => Math.hypot(f.x - a.x, f.z - a.z) < 2) ? 1 : 0) - (fails.some((f) => Math.hypot(f.x - b.x, f.z - b.z) < 2) ? 1 : 0));
    if (mouths.length) { const m = mouths[i % mouths.length]; return { spot: { x: m.x, y: m.y, z: m.z }, face: ec, kind: "advance" }; }
  }
  const q = known.sort((a, b) => dist(a, l) - dist(b, l))[0];
  return { spot: { x: q.x, y: q.y, z: q.z }, face: q, kind: "advance" };
}
const JOB_NOTE = { door: "covering the way in", stairs: "holding the stairhead", overwatch: "watching from a window", assault: "storming the building", support: "covering the assault", reserve: "in reserve", secure: "covering the room" };
// v7.3: who does which job is decided for the whole squad at once, by where each man IS (the lowest men take the doors,
// the next the stairheads, the rest the upper windows; outside the building, the men furthest back give covering fire
// and the rest go in), and it STICKS: a new plan keeps every man on his job while that job still exists. Before, the
// jobs were dealt out by an id order every 25-45 s, so men upstairs were sent down to the door and back, and men on
// the ground floor were told "at the upper windows".
function assignJobs(S, P0, ours) {
  const gun = ours.filter((e) => GUNS.includes(sd(e).weapon) && !downed.has(e.id));
  const n = gun.length, side = P0.kind === "attack" ? "att" : P0.kind === "garrison" || P0.kind === "defend" ? "def" : undefined;
  if (!side) { S.jobs = undefined; return; }
  const keep = S.jobSide === side ? S.jobs ?? new Map() : new Map();
  const jobs = new Map();
  const want = side === "def"
    ? { door: n >= 3 ? Math.max(1, Math.round(n * (P0.door ?? 0.3))) : 0, stairs: n >= 4 ? Math.min(2, Math.max(1, Math.round(n * 0.15))) : 0 }
    : { support: ours.filter((e) => isIndoors(e)).length * 2 >= ours.length ? 0 : Math.max(0, n - Math.max(1, Math.round(n * (P0.attack ?? 0.6)))) };   // (v8.2: most of us inside: everyone storms)
  const count = (j) => [...jobs.values()].filter((x) => x === j).length;
  for (const e of gun) { const j = keep.get(e.id); if (j && (want[j] === undefined || count(j) < want[j])) jobs.set(e.id, j); }   // (sticky)
  const free = gun.filter((e) => !jobs.has(e.id));
  if (side === "def") {
    free.sort((a, b) => a.location.y - b.location.y || (a.id < b.id ? -1 : 1));   // the lowest men to the doors, then the stairheads
    for (const e of free) jobs.set(e.id, count("door") < want.door ? "door" : count("stairs") < want.stairs ? "stairs" : "overwatch");
  } else {
    const ec = S.enemyC ?? S.ourC;
    free.sort((a, b) => (isIndoors(a) ? 1 : 0) - (isIndoors(b) ? 1 : 0) || flat(b.location, ec) - flat(a.location, ec));   // outside and furthest back: support
    for (const e of free) jobs.set(e.id, !isIndoors(e) && count("support") < want.support ? "support" : "assault");
  }
  S.jobs = jobs; S.jobSide = side;
}
const JOB_GO = { door: "going to cover the way in", stairs: "going to hold the stairhead", overwatch: "going to a window", assault: "storming the building", support: "moving to cover the assault", reserve: "joining the reserve", secure: "taking up a spot inside" };
function jobSpot(e, d, S, job, now) {
  const ros = [...(S.jobs ?? new Map())].filter(([, j]) => j === job).map(([id]) => id).sort(), i = Math.max(0, ros.indexOf(e.id));
  if (job === "door") return doorWatchSpot(e, S, i, now);
  if (job === "stairs") return stairGuardSpot(e, S, i, now);
  if (job === "overwatch") return overwatchSpot(e, S, now);
  if (job === "support") return shotSpot(e, S, now);
  if (job === "assault") return assaultSpot(e, d, S, now);
  return undefined;
}
function buildingRole(e, d, now, S, B, t) {
  const P0 = S?.bplan;
  if (!P0 || !GUNS.includes(d.weapon) || d.func === "post" || d.retreat) return undefined;
  if (t?.isValid && canHit(e, t)) return undefined;                          // a shot: take it (the plan waits)
  let R = B.role;
  const job = S.jobs?.get(e.id);
  if (R && R.planT !== P0.t && job && R.job === job && R.spot && (R.fail ?? 0) < 2 && R.kind !== "advance") { R.planT = P0.t; R.t = Math.max(R.t, now - 300); }   // (same job under the new plan: same spot)
  if (!R || R.planT !== P0.t || (R.fail ?? 0) >= 2) {
    let a, jb = job;
    const odd = (e.id.charCodeAt(e.id.length - 1) & 1) === 1;
    if (jb) {
      a = jobSpot(e, d, S, jb, now);
      if (!a && jb === "support") { a = assaultSpot(e, d, S, now); jb = "assault"; }
      if (!a && (jb === "door" || jb === "stairs")) { a = overwatchSpot(e, S, now); jb = "overwatch"; }
      if (!a && jb === "overwatch" && (P0.kind === "defend" || P0.kind === "garrison")) { a = secureSpot(e, S, now); if (a) jb = "secure"; }   // (v9.20.3: holding the house, a man with no window keeps a room in it: the reserve ran out of the house they held)
      if (!a && jb === "overwatch") { jb = "reserve"; a = undefined; }    // (v7.4: no real window for him: the reserve, who go where the fight is)
    }
    else if (P0.kind === "windows") a = shotSpot(e, S, now);
    else if (P0.kind === "secure") a = secureSpot(e, S, now);
    else if (P0.kind === "contain") a = shotSpot(e, S, now) ?? secureSpot(e, S, now);
    else if (P0.kind === "sortie") a = odd || S.ratio >= 1.6 ? assaultSpot(e, d, S, now) : shotSpot(e, S, now);   // half go, half cover them from the windows
    else if (P0.kind === "assault") a = assaultSpot(e, d, S, now);
    if (!a) { const crowd = nearbyCombatants(e.dimension.id, e.location, 1.8).filter((o) => o.typeId === SOLDIER && o.id !== e.id && !downed.has(o.id)).length; if (crowd >= 1 && isIndoors(e)) a = secureSpot(e, S, now); }   // (nothing for him to do and on top of a mate: spread out)
    R = { planT: P0.t, t: now, spot: a?.spot, face: a?.face, kind: a?.kind ?? "engage", fail: 0, job: jb };
    B.role = R;
    if (R.spot) claimSpot(e, R.spot, now);
  }
  if (!R.spot) {
    if (R.job !== "reserve") return undefined;
    if (!S.known.size) { note(e, JOB_NOTE.reserve); return undefined; }
    // (v9.2: the reserve in a fight is the men who go where it is: up to the nearest enemy known, until he has a shot)
    const nk = nearestKnownB(S, e);
    if (!nk || nk.dd < 8 || (t?.isValid && canHit(e, t))) return undefined;
    if ((P0.kind === "defend" || P0.kind === "garrison") && isIndoors(e) && !isIndoorsAt(e.dimension, nk.q)) { note(e, JOB_NOTE.reserve); return { g: "g_none", t: "t_mid", urgent: false }; }   // (v9.20.3: holding the house: he waits inside for them)
    if (!personal.has(e.id) || now - (B.resT ?? -999) > 200) { B.resT = now; planPersonalTo(e, "engage", { x: nk.q.x, y: nk.q.y, z: nk.q.z }, now); }
    note(e, "reserve: moving up to the fight");
    return followPersonal(e, now);
  }
  const l = e.location;
  // (v7.4: committed to moving, not to a spot: a man at a window with no shot from it for 10 s in a fight goes and finds
  //  one (the brain's shot-seeking and closing-in take over); the door and stairhead men stay: waiting IS their job)
  if (S.known.size && (R.job === "overwatch" || R.job === "support") && flat(R.spot, l) < 1.4 && Math.abs(R.spot.y - l.y) < 1.2) {
    if (now - (gunState.get(e.id)?.lastShot ?? -999) < 60 || (t?.isValid && canHit(e, t))) R.idleT = now; else R.idleT ??= now;
    if (now - R.idleT > 200) { B.role = { ...R, planT: R.planT, spot: undefined, job: "reserve" }; S.jobs?.set(e.id, "reserve"); note(e, "moving to the fight"); return undefined; }
  }
  // (v7.2: the enemy's got in on his floor: the door men and anyone without a shot go and fight them there)
  if (S.known.size && (R.job === "door" || R.job === "overwatch" || R.job === "secure") && [...S.known.values()].some((q) => Math.abs(q.y - l.y) < 2.5 && dist(q, l) < 25 && isIndoorsAt(e.dimension, q))) return undefined;
  if (flat(R.spot, l) < 1.4 && Math.abs(R.spot.y - l.y) < 1.2) {
    if (R.kind === "advance") { B.role = { ...R, spot: undefined }; return undefined; }   // got there: the fight takes over
    if (R.face) turnTo(e, R.face, 20);
    R.t = now;                                                                 // (on his spot: no time-out)
    note(e, R.job ? JOB_NOTE[R.job] : BPLANS[P0.kind]); return { g: "g_none", t: "t_mid", urgent: false };
  }
  if (now - R.t > 600) { R.fail++; R.t = now; failSpots.set(e.id, [...(failSpots.get(e.id) ?? []), { x: R.spot.x, z: R.spot.z, t: now }].slice(-6)); B.role = R.fail >= 2 ? undefined : { ...R, planT: -1 }; return undefined; }
  const cur = travelTo.get(e.id);
  if (!personal.has(e.id) || !cur || flat(cur, R.spot) > 1.5 || Math.abs(cur.y - R.spot.y) > 1.5) {
    if (R.planned && now - R.planned < 60) R.miss = (R.miss ?? 0) + 1;             // (the last route to it came to nothing at once)
    if ((R.miss ?? 0) >= 3) { failSpots.set(e.id, [...(failSpots.get(e.id) ?? []), { x: R.spot.x, z: R.spot.z, t: now }].slice(-6)); B.role = { ...R, planT: -1, fail: (R.fail ?? 0) + 1, miss: 0 }; note(e, "looking for a way"); return undefined; }
    R.planned = now; travelTo.set(e.id, { ...R.spot }); planPersonalTo(e, R.kind, R.spot, now);
  }
  const mv = followPersonal(e, now);
  if (personal.get(e.id)?.planning) note(e, "working out the way"); else note(e, R.job ? JOB_GO[R.job] : BPLANS[P0.kind]);   // (v7.3: what he's actually doing)
  return mv ?? { g: "g_none", t: "t_mid", urgent: false };
}
// v7.1: the stalemate breaker. The squad knows where the enemy is (seen or heard), nobody in it has fired for 15 s, and
// he's free to use judgment: he goes to the nearest of them along a real route (doors, stairs, round the building),
// and the route stops him the moment he has a shot. Not a man holding a roof or wall over them, not one watching a
// stairhead, not a squad badly outnumbered.
function closeIn(e, d, now, S, B, t, anchor) {
  if (!GUNS.includes(d.weapon) || d.func === "post" || !freeOf(e) || String(gdp(e, "war:stance") ?? "aggressive") !== "aggressive" || !S?.known?.size) return undefined;
  if (t?.isValid && canHit(e, t)) { B.closeT = undefined; return undefined; }
  if (now - (S.fightT ?? S.contactT ?? now) < 300 || (S.ratio ?? 1) < 0.7) return undefined;
  if (B.stair && now - B.stair.t < 400) return undefined;
  const l = e.location;
  let q, bd = 1e9;
  for (const k of S.known.values()) { if (!k.ent?.isValid || downed.has(k.ent.id)) continue; const dd = dist(k, l); if (dd < bd) { bd = dd; q = k; } }
  if (!q || bd > Math.min(aoOf(e), 90)) return undefined;
  if (anchor && !isIndoorsAt(e.dimension, anchor.location) && q.y < anchor.location.y - 2.5 && Math.abs(l.y - anchor.location.y) < 1.5) return undefined;   // the high ground: keep it
  if (!personal.has(e.id) || now - (B.closeT ?? -999) > 200) { B.closeT = now; planPersonalTo(e, "advance", { x: q.x, y: q.y, z: q.z }, now); }
  note(e, "closing in");
  return followPersonal(e, now);
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
  if (st.wait && now < st.wait) return true;                                 // (v9.7: the grenade's on its way: wait for the bang)
  if (here >= Math.min(3, S.n) || now - st.t0 > 120) {
    // v9.7: clearing it first: an enemy known near the top of the flight, one man lobs a grenade up, and they go when it's gone off
    if (!st.frag) {
      st.frag = now;
      const top = [...S.known.values()].filter((q) => q.y >= l.y + 2.5 && Math.hypot(q.x - p.x, q.z - p.z) < 10).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      const thrower = (S.ours ?? []).find((o) => o.isValid && !downed.has(o.id) && flat(o.location, l) < 6 && now - (breachFragUsed.get(o.id) ?? -99999) > 2400 && GUNS.includes(sd(o).weapon));
      const friendIn = top && nearbyCombatants(e.dimension.id, top, NADE.safe).some((o) => (o.typeId === SOLDIER || o.typeId === "minecraft:player") && isFriendly(d.faction, factionOf(o)) && !downed.has(o.id));
      if (top && thrower && !friendIn) { breachFragUsed.set(thrower.id, now); const T = lobGrenade(thrower, { x: top.x, y: top.y, z: top.z }); st.wait = now + T + NADE.fuse + 4; v9stat("stairFrag"); radio(thrower, "grenade up the stairs, then we go", true); return true; }
    }
    st.go = now; callout(e, "Go, go, go!", { event: true }); radio(e, "going up the stairs", true); return false;
  }
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
          if (out) { try { e.teleport(out); afterRescue(e, now, "freed from a wall"); } catch {} }
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
  // (v9.20.3: the last few blocks with the walking that stops at a block, not three: sent to a spot of cover he stopped
  //  three blocks short of it, in the open, and his move to it never finished)
  return slot ? { g: flat(s0, e.location) < 6 ? "g_post" : "g_wp", slot, t: perch ? "t_off" : "t_mid", urgent } : undefined;
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
// (v8.2: tol: how far off the marker may be before it's moved. A walking man's marker (3+ blocks ahead, and Minecraft's
//  walking stops 3 short of it anyway) needs no move for less than 1.5 blocks: on a real server these teleports were
//  ~50 a tick in a 90 v 90. Where he must stand exactly (a firing spot, his place) it's still 0.4.)
const mkPos = new Map(); // slot -> last place it was put
function myMarker(e, loc, key = "war:mymk", tol = 0.4) {
  let s = Number(gdp(e, key) ?? 0);
  if (s && tol > 0.4) { const p = mkPos.get(s); if (p && Math.hypot(p.x - loc.x, p.y - loc.y, p.z - loc.z) <= tol) return s; }
  const m = s ? marker(s) : undefined;
  if (!m) {
    s = makeWaypoint(e.dimension, loc, false);
    if (!s) return 0;
    try { marker(s)?.addTag("war_mine"); } catch {}
    sdp(e, key, s);
    try { noteRefs(e); } catch {}
    return s;
  }
  const lp = mkPos.get(s) ?? m.location;
  if (dist(lp, loc) > tol) { try { m.teleport(loc); mkPos.set(s, { x: loc.x, y: loc.y, z: loc.z }); } catch {} }
  else if (!mkPos.has(s)) mkPos.set(s, { x: lp.x, y: lp.y, z: lp.z });
  if (mkPos.size > 5000) mkPos.clear();
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
    if (r3(c.pts[i], from) > 5 || c.pts[i].climb) continue;             // (v7.3: 5, was 3: squad mates a few steps apart share it)
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
// v7.2: his own place across the route in the open (0, right, left, further right, further left...), so a squad on
// the move is a loose group side by side and not a file of men treading on each other's heels. Only where that spot is
// plain open ground on his level that he can walk straight to; anywhere else he keeps to the route itself.
function sideBySide(e, m, pts, k, tgt) {
  const n = m.members.indexOf(e.id); if (n <= 0) return undefined;
  const lane = [0, 1, -1, 2, -2, 3, -3][n % 7]; if (!lane) return undefined;
  // (v9.19: the line's direction over a longer stretch of the route: two grid points apart it flipped between straight
  //  and diagonal, and the lane swung from one side to the other: the men zig-zagged and their heads swung with it)
  const a = pts[Math.max(0, k - 6)], c = pts[Math.min(pts.length - 1, k + 4)], b = pts[k], L = Math.hypot(c.x - a.x, c.z - a.z);
  if (L < 1.5) return undefined;
  const sp = 2.2 * spacingSetting() / 1.5, x = b.x + (-(c.z - a.z) / L) * lane * sp, z = b.z + ((c.x - a.x) / L) * lane * sp;
  try {
    const w = walkableNear(e.dimension, x, z, b.y);
    if (!w || Math.abs(w.y - b.y) > 0.6 || dangerNear(e.dimension, w) || !straightReach(e.dimension, e.location, w) || !straightReach(e.dimension, w, tgt)) { return undefined; }
    return w;
  } catch { return undefined; }
}
// v7.2: his own watchdog on a march (nobody else's progress counts): no headway along the route for 3 s while he's
// meant to be walking it -> 1) the script carries him over the bit he's stuck on (stairs, a door, a mob in the way);
// 6 s -> 2) a fresh short route of his own from where he stands to a bit further along; 15 s -> 3) put on the route a
// few blocks ahead of where he was (the last resort: nothing else got him on, and nobody waits for him).
const marchWatch = new Map(); // id -> { i, t, n, path }
const forceGlide = new Map(); // id -> tick until which his route is walked by the script even in the open
function marchStuck(e, m, pts, i, now) {
  let w = marchWatch.get(e.id);
  if (!w || w.path !== pts || i > w.i || flat(e.location, w.at) > 2.5) { marchWatch.set(e.id, { i: Math.max(i, w?.path === pts ? w.i : 0), t: now, n: 0, path: pts, at: { ...e.location } }); return false; }
  if (i >= pts.length - 3 || gliders.get(e.id)?.paused || combatLock.has(e.id) || perc.get(e.id)?.threat && !isMob(perc.get(e.id).threat)) { w.t = now; return false; }
  const idle = now - w.t;
  if (w.n === 0 && idle >= 60) { w.n = 1; glideBan.delete(e.id); forceGlide.set(e.id, now + 120); note(e, "getting past"); return false; }
  if (w.n === 1 && idle >= 120) {
    w.n = 2; forceGlide.delete(e.id);
    const tgt = pts[Math.min(pts.length - 1, i + 10)];
    planPersonalTo(e, "settle", { x: tgt.x, y: tgt.y, z: tgt.z }, now); note(e, "finding a way");
    return true;
  }
  if (w.n === 2 && idle >= 300 && setting("rescue", true) && !personal.has(e.id)) {
    w.n = 3;
    const free = (q) => !nearSnap(e.dimension.id, q, 1.2).some((c) => c.id !== e.id && c.type === SOLDIER && Math.abs(c.y - q.y) < 1.5) && !dangerNear(e.dimension, q);
    for (let k = i + 3; k < Math.min(pts.length, i + 14); k++) {
      const q = pts[k]; if (q.climb || q.w || q.open) continue;
      const fq = { x: Math.floor(q.x) + 0.5, y: Math.floor(q.y + 0.01), z: Math.floor(q.z) + 0.5 };
      if (!standAt(e.dimension, Math.floor(fq.x), fq.y, Math.floor(fq.z), now) || !glideFree(e.dimension, fq.x, fq.y, fq.z) || !free(fq)) continue;
      try { e.teleport(fq); } catch { break; }
      afterRescue(e, now, "caught up along the route"); marchWatch.delete(e.id);
      return true;
    }
    w.t = now; w.n = 0;                                            // nowhere free just now: start over
  }
  return false;
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
// v9.21.6: far sight. Bedrock stops drawing mobs about 64 blocks from you (a fixed limit: no setting raises it, and no
// add-on can), while a sniper sees 250. Particles, though, are drawn at any distance. So past 62 blocks, out to 250,
// every soldier is drawn for each player as a small picture of himself: his own uniform (cut from his own skin),
// facing you, lit by the light where he stands, gliding with him between updates, kneeling or lying as he does.
// Walls, hills and fog hide it just like the man himself. Riders inside vehicles aren't drawn (they're inside).
const FAR_IN = 62, FAR_OUT = 250, FAR_EVERY = 4;
const farMemo = new Map(); // id -> { x, y, z, t (last drawn), i (sprite), it (when the sprite was read) }
let farCur = 0;
function farSprite(e, m, now) {
  if (m.i !== undefined && now - m.it < 200) return m.i;
  let i = -1;
  try {
    if (!e.getProperty("war:hide")) {
      const f = Math.max(1, Math.min(40, Number(e.getProperty("war:faction") ?? 1) || 1)), sk = Number(e.getProperty("war:skin") ?? 0);
      i = sk > 0 && sk <= 64 ? 39 + sk : e.getProperty("war:medic") ? 104 + (f - 1) : f - 1;   // (the same pick as the soldier's own render controller; a rider wears his foot uniform)
    }
  } catch {}
  m.i = i; m.it = now;
  return i;
}
system.runInterval(() => {
  let ps; try { ps = world.getAllPlayers(); } catch { return; }
  if (!ps.length) return;
  const eyes = [];
  for (const p of ps) { try { eyes.push({ p, d: p.dimension.id, l: p.getHeadLocation() }); } catch {} }
  let all; try { all = allOf(SOLDIER); } catch { return; }
  const n = all.length; if (!n || !eyes.length) return;
  const now = tick(), per = Math.ceil(n / FAR_EVERY);
  if (farCur >= n) farCur = 0;
  for (let k = 0; k < per; k++) {
    const e = all[(farCur + k) % n];
    try {
      if (!e.isValid) continue;
      const l = e.location, did = e.dimension.id;
      let to;
      for (const v of eyes) {
        if (v.d !== did) continue;
        const dd = Math.hypot(l.x - v.l.x, l.y - v.l.y, l.z - v.l.z);
        if (dd > FAR_IN && dd <= FAR_OUT) (to ??= []).push(v.p);
      }
      let m = farMemo.get(e.id);
      if (!m) { m = { x: l.x, y: l.y, z: l.z, t: now }; farMemo.set(e.id, m); }
      const gap = Math.max(1, now - m.t), vx = (l.x - m.x) / gap, vz = (l.z - m.z) / gap;
      m.x = l.x; m.y = l.y; m.z = l.z; m.t = now;
      if (!to) continue;
      const ri = rideInfo(e);
      if (ri.v && VEHICLES.includes(ri.on)) continue;
      const i = farSprite(e, m, now);
      if (i < 0) continue;
      const down = downed.has(e.id), kneel = !down && poseOf.get(e.id) === 1;
      const sp = Math.hypot(vx, vz), move = sp > 0.01 && sp < 0.8;   // (blocks a tick; a teleport isn't walking)
      const mv = new MolangVariableMap();
      mv.setFloat("variable.u", (i % 16) * 16); mv.setFloat("variable.v", Math.floor(i / 16) * 32);
      mv.setFloat("variable.w", 0.46); mv.setFloat("variable.h", kneel ? 0.7 : 0.92);
      mv.setFloat("variable.rot", down ? 90 : 0);
      mv.setFloat("variable.spd", move ? sp * 20 : 0); mv.setFloat("variable.dx", move ? vx / sp : 0); mv.setFloat("variable.dz", move ? vz / sp : 0);
      mv.setFloat("variable.life", (FAR_EVERY * 2 + 1) / 20);   // (outlasts one missed update: never a flicker)
      const at = { x: l.x, y: l.y + (down ? 0.3 : kneel ? 0.7 : 0.92), z: l.z };
      for (const p of to) { try { p.spawnParticle("war:far", at, mv); } catch {} }
    } catch {}
  }
  farCur = (farCur + per) % n;
  if (farMemo.size > 4000) farMemo.clear();
}, 1);
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
  // v8.2: a test, not a guess. Standing still for 2 s isn't proof (a man waiting his turn at a stair stands still): before
  // he's taken to be out of range, he's given a tiny nudge; if the game moves him, it IS simulating him and he walks on
  // his own. While he's being carried the test is repeated every ~5 s. (False alarms had men carried, teleport by
  // teleport, the whole way: the jerky "tweaking", heavy lag, and squads bunched where the carrying ended.)
  if (r.probe) {
    if (now - r.probe.t >= 4) {
      const ok = Math.hypot(l.x - r.probe.x, l.z - r.probe.z) > 0.004 || Math.abs(l.y - r.probe.y) > 0.004;
      r.probe = undefined; r.lastProbe = now;
      if (ok) { r.frozen = 0; r.on = false; gliders.delete(e.id); } else r.on = true;
    }
    return;
  }
  if (moved) { if (!gliders.has(e.id) && !climbing.has(e.id)) { r.frozen = 0; r.on = false; } else if (r.on && now - (r.lastProbe ?? 0) > 100) startProbe(e, r, now); return; }   // he moved by himself: simulated
  if (wantsToMove) r.frozen += 4;
  if (r.frozen >= 40 && !playerNear(e, 56) && now - (r.lastProbe ?? -999) > 40) startProbe(e, r, now);
}
function startProbe(e, r, now) {
  gliders.delete(e.id); glideBan.set(e.id, now + 6);
  const l = e.location; r.probe = { t: now, x: l.x, y: l.y, z: l.z };
  try { e.applyImpulse({ x: (Math.random() - 0.5) * 0.06, y: 0.02, z: (Math.random() - 0.5) * 0.06 }); } catch {}
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
  try { const xv = globalThis.__viewers?.(); if (xv) { const l = e.location; return xv.some((v) => v.d === e.dimension.id && Math.abs(v.x - l.x) <= R && Math.abs(v.z - l.z) <= R); } } catch {}   // (test kits only)
  return false;
}
function isRemote(e) {
  const r = remoteMemo.get(e.id);
  if (!r?.on) return false;
  if (playerNear(e, 56)) { r.on = false; r.frozen = 0; return false; }
  return true;
}
system.runInterval(() => {
  const now = tick();
  stepping.clear();
  for (const e of allOf(SOLDIER)) {
    try {
      if (climbing.has(e.id) || isRiding(e) || downed.has(e.id) || (pows.has(e.id) && !personal.has(e.id))) continue;   // (v9.20.3: a prisoner on his way after his captor is carried too)
      let pts, i, own = false, mm;
      const pr = personal.get(e.id);
      if (pr) {
        if (!pr.pts || pr.planning || (pr.hold ?? 0) > now) continue;
        pts = pr.pts; i = trackIdx(e.id, pts, e.location); own = true;
      } else {
        if (pows.has(e.id)) continue;
        { const fd = sd(e); if ((fd.func === "follow" || fd.func === "escort") && fd.leader) continue; }   // (v9.20.3: a man following you is on no march: its lanes and "taking his spot" aren't his)
        const og = gdp(e, "war:ordergoal"), goal = Number(gdp(e, "war:goal") ?? 0);
        const cu = Number(gdp(e, "war:catchup") ?? 0);
        if (og !== undefined && goal !== cu) continue;                         // fighting: the brain moves him
        const mid = laneOf.get(Number(og ?? goal)) ?? laneOf.get(Number(gdp(e, "war:chargegoal") ?? 0));
        const m = mid ? getMarches()[mid] : undefined;
        if (!m?.path || (m.final && !(cu && goal === cu))) { settle(e, og === undefined ? goal : Number(og), m); continue; }
        pts = m.path; i = routeProgress(m, e.location, e.id); mm = m;
        trackRemote(e, now, wantsWalk(e, goal));
        own = (!!cu && goal === cu && !formMode.has(e.id)) || isRemote(e);   // (v6.2: out of range: always carried)
        if (own && !isRemote(e)) {
          // v7.2: the squad's in a real fight: hold here (the brain moves the men who see the enemy)
          if (m.hold && !m.final) { gliders.delete(e.id); myMarker(e, e.location); note(e, "holding (contact)"); marchWatch.delete(e.id); continue; }
          // far out in front of the squad: ease off till it closes up (never on a stair or in a doorway)
          if (!m.final && i > (m.paceIdx ?? Infinity) && !tightAt(e.dimension, pts, i, e.location)) { gliders.delete(e.id); myMarker(e, e.location); note(e, "waiting for the squad"); marchWatch.delete(e.id); continue; }
          if (marchStuck(e, m, pts, i, now)) continue;
        }
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
      // v6.0: on open ground Minecraft walks him in a straight line to his marker, so the marker only goes as far ahead
      // as a straight walk is safe (no trench, gap or drop on the way); not even the next point: he's carried
      let ahead = -1;
      if (!pts.guess) for (let k = Math.min(pts.length - 1, driveAhead(pts, i, 7)); k > i; k--) if (straightReach(e.dimension, e.location, pts[k])) { ahead = k; break; }
      if (pr) trackRemote(e, now, wantsWalk(e, Number(gdp(e, "war:goal") ?? 0)));
      const remote = isRemote(e);
      // (v6.2: also mid-glide: queued for the last point, he'd wait his turn there forever behind whoever stands on it)
      const endK = `${Math.floor(pts[pts.length - 1].x)},${Math.floor(pts[pts.length - 1].z)}`;
      if (remote && (i >= pts.length - 2 || remoteSettled.get(e.id)?.endsWith(`|${endK}`))) { gliders.delete(e.id); remoteSpread(e, now, endK); continue; }   // the end of the known route: his own spot (and he stays on it)
      const tight = !pts.guess && (glideBan.get(e.id) ?? 0) <= now && (remote || ahead < 0 || (forceGlide.get(e.id) ?? 0) > now || tightAt(e.dimension, pts, i, e.location));
      if (tight || ahead < 0 || onPassage(e)) stepping.add(e.id);         // (v7.2: the edge guard watches only men where there's an edge to mind)
      if (tight) {
        const g = gliders.get(e.id);
        const atDoor = !remote && !pows.has(e.id) && stackAtDoor(e, { pts }, i, now);       // (v9.0: they're in there: stack at the door, frag in, all go)
        if (atDoor || (!remote && !pows.has(e.id) && stackAtStairs(e, { pts }, i, now))) {   // (v6.9.2: the enemy's up there: gather at the foot, then all go)
          gliders.set(e.id, { yaw: g?.yaw, pts, k: g && g.pts === pts ? g.k : glideStart(pts, i, e.location), t: now, paused: true, wait: 0, blocked: 0 });
          myMarker(e, e.location); note(e, atDoor ? "stacking up at the door" : "stacking up at the stairs");
          continue;
        }
        const queued = queuedBehind(e, pts, i);
        const wait = queued ? (g?.wait ?? 0) + 4 : 0;
        const k = g && g.pts === pts ? g.k : glideStart(pts, i, e.location);
        gliders.set(e.id, { yaw: g?.yaw, pts, k, t: now, paused: queued && wait < 50 && floorUnder(e.dimension, e.location.x, e.location.y, e.location.z), wait, blocked: g && g.pts === pts ? g.blocked : 0 });   // (v6.2: blocked kept: it was reset every refresh, so a man below his route was never let go)   // (never paused over a gap)   // never waits more than 2.5 s for anyone (no deadlocks)
        myMarker(e, e.location);
        note(e, queued && wait < 50 ? "waiting his turn" : remote ? "marching (out of range)" : "on the way through");
        continue;
      }
      gliders.delete(e.id);
      let tgt = pts[ahead >= 0 ? ahead : driveAhead(pts, i, 7)];
      if (mm && !mm.final && ahead >= 0) tgt = sideBySide(e, mm, pts, ahead, tgt) ?? tgt;   // (v7.2: in the open, side by side, not nose to tail)
      myMarker(e, tgt, "war:mymk", dist(tgt, e.location) > 4 ? 1.5 : 0.4);
      if (dist(tgt, e.location) <= 3.3) stepAlong(e, pts, i);
    } catch (err) { oops("route driver", err); }
  }
}, 4);

// ---- close-combat drills (War Table -> Settings -> General). They sit on top of the brain's decision:
// cover-and-move (half the squad covers while the other half moves, swapping every few seconds, movers weave
// under fire), shoot-and-scoot (no standing in one exposed spot trading fire for long), and flinching when hit.
const drill = new Map(); // id -> { fx, fz, since, scoot, scootUntil }
// (v9.20: the fire teams: each man with his buddy; the same split everywhere bounding asks for it)
function teamOf(e) { const b = String(gdp(e, "war:buddy") ?? ""); const k = b && b < e.id ? b : e.id; let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0; return Math.abs(h) % 2; }
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
const KNEEL = new Map();   // v9.19: id -> tick: on one knee (treating a wounded man)
function wantPose(e, now) {
  if (downed.has(e.id) || pows.has(e.id) || isRiding(e) || climbing.has(e.id) || inWater(e) || personal.has(e.id)) return 0;
  if ((KNEEL.get(e.id) ?? 0) > now) return 1;
  const d = sd(e);
  if (d.surr || ((suppB.get(e.id) ?? 0) > 14 && now - (gunState.get(e.id)?.lastShot ?? -999) > 25 && d.div !== "cavalier")) {   // (v9.19; the cheap checks first)
    const v = e.getVelocity(), still = Math.hypot(v.x, v.z) < 0.03;
    if (d.surr) return still ? 1 : 0;                                                    // hands up, on his knees
    if (still) return 3;                                                                 // pinned: head down behind cover
  }
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
// prisoner; only a player of his own faction can bring him back (v9.1: before, he also rejoined once the enemy moved
// on, or the war ended, or his faction raised its flag again: a surrender is now a surrender).
function isoSurrender(e, captor) {
  for (const k of [...provoked.keys()]) if (k.endsWith(`:${e.id}`)) provoked.delete(k);   // no longer a target for anyone
  personal.delete(e.id); travelTo.delete(e.id); drill.delete(e.id);
  surrender(e, captor);
  sdp(e, "war:surrIso", Date.now());
  radio(e, "one of ours was cut off and surrendered", true);
  updateName(e);
}
system.runInterval(() => {
  const on = !!setting("isosurr", true), now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e);
      if (d.surr) continue;                                                 // (v9.1: he stays that way until his own side comes for him)
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
      const hp = hpOf(e), hpr = hp ? hp.currentValue / hp.effectiveMax : 1;
      if (!(foes >= 5 || (foes >= 3 && hpr < 0.5) || (foes >= 2 && hpr < 0.25))) continue;
      if (Math.random() > 0.35 + (1 - boldOf(e))) continue;                  // not everyone gives up at the first look
      isoSurrender(e, factionOf(nearest));
    } catch {}
  }
}, 60);
// v9.14: soldiers take each other prisoner. A man who surrendered is taken by the nearest enemy soldier within 10 blocks
// (when the fight round him is over) and marched to that side's lines: their nearest war flag, else the captor's own
// post. The wounded, once the winners hold the ground, are sometimes taken too instead of left to bleed out. A prisoner
// whose side reaches him with no guard near is freed; one left unguarded for long may slip away.
function soldierTakes(e, captor) {
  const cf = Number(P(captor, "war:faction") ?? 0);
  const fl = nearestFlag(captor.dimension, captor.location, (f) => Number(P(f, "war:faction")) === cf, 200);
  const home = marker(Number(gdp(captor, "war:home") ?? 0));
  const at0 = fl?.location ?? home?.location, at = at0 ? { ...at0 } : undefined;   // (v9.20.3: no lines of his own: the prisoner just stays with him)
  if (gdp(e, "war:surr")) { sdp(e, "war:surr", 0); sdp(e, "war:surrIso", undefined); }
  const wasDown = downed.has(e.id);
  makePow(e, captor);
  if (wasDown) { try { KNEEL.set(captor.id, tick() + 40); e.dimension.spawnParticle("minecraft:heart_particle", { x: e.location.x, y: e.location.y + 1.5, z: e.location.z }); note(captor, "bandaging a wounded prisoner"); v9stat("bandaged"); } catch {} }
  const pw = pows.get(e.id); pw.mode = "follow"; pw.at = at; pw.cf = cf; pw.t = tick();   // (v9.20.3: goes along with his captor, was sent off on his own)
  try { pw.sqn = Number(sd(captor).squad ?? 0); } catch {}                       // (v9.21.2: his group: the next of them takes over if he falls)
  sdp(e, "war:pow", powJSON(pw));
  applyRelations(e);
  callout(captor, "Hands up!", { event: true }); v9stat("taken");
  note(captor, "took a prisoner"); updateName(e);
}
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const pw = pows.get(e.id), surr = !pw && gdp(e, "war:surr"), down = !pw && downed.has(e.id) && !FALLS.has(e.id);
      if (!pw && !surr && !down) continue;
      const f = Number(P(e, "war:faction") ?? 0), near = nearSnap(e.dimension.id, e.location, 16);
      // v9.21.3: his own side all round him (3+ on their feet within 8 blocks, more of them than of the enemy): a
      // prisoner is set free (guard or no guard), a man who surrendered picks his gun back up and is in the fight again
      if ((pw || surr) && ownRound(e, f, near)) {
        const by = near.filter((c) => !c.down && c.type === SOLDIER && c.f === f && c.id !== e.id && !pows.has(c.id)).sort((a, b) => a.dd - b.dd)[0];
        if (pw) { freePow(e, true); applyRelations(e); giveFunction(e, "hold"); if (by) callout(by.e, "We've got you!", { event: true }); note(e, "freed by his own"); v9stat("freedByOwn"); }
        else { sdp(e, "war:surrIso", undefined); resume(e); callout(e, "Thanks!", { event: true }); note(e, "back in the fight"); v9stat("unsurrendered"); }
        updateName(e); continue;
      }
      if (pw) {
        const cf = pw.cf ?? (findPlayer(pw.captor) ? playerFaction(findPlayer(pw.captor)) : 0);
        const guard = near.some((c) => !c.down && c.dd < 12 && (c.type === SOLDIER || c.type === "minecraft:player") && c.f && c.f === cf);
        const friend = near.find((c) => !c.down && c.dd < 3 && c.type === SOLDIER && c.f === f && c.id !== e.id && !pows.has(c.id));
        if (friend && !guard) { freePow(e, true); applyRelations(e); giveFunction(e, "hold"); callout(friend.e, "We've got you!", { event: true }); v9stat("freed"); continue; }
        if (pw.mode === "jail" && !guard && pw.cf) {
          const tk = near.find((c) => c.type === SOLDIER && !c.down && c.f && c.f !== pw.cf && isHostile(c.f, f) && c.dd < 16 && !pows.has(c.id) && c.e?.isValid && !gdp(c.e, "war:surr"));
          if (tk) { soldierTakes(e, tk.e); v9stat("powRetaken"); continue; }        // (v9.21.2: his guards are gone, another side at war with him finds him: theirs now)
          pw.alone = (pw.alone ?? 0) + 1; if (pw.alone > 30 && Math.random() < 0.05) { freePow(e, true); applyRelations(e); giveFunction(e, "hold"); v9stat("escaped"); }
        }
        else pw.alone = 0;
        continue;
      }
      // a captor: the nearest enemy soldier on his feet, with no fight on round here (none of the man's side standing near)
      const own = near.some((c) => !c.down && c.type !== HOUND && c.id !== e.id && c.f === f && !pows.has(c.id) && !(c.type === SOLDIER && gdp(c.e, "war:surr")));
      if (own) continue;
      const cap = near.filter((c) => c.type === SOLDIER && !c.down && c.f && isHostile(c.f, f) && !pows.has(c.id) && !gdp(c.e, "war:surr") && c.dd < (down ? 6 : 10)).sort((a, b) => a.dd - b.dd)[0];
      if (!cap) continue;
      if (down) { const k = `${e.id}`; if (PRIZE.has(k)) continue; PRIZE.add(k); if (Math.random() < 0.2) continue; }   // (v9.19: the wounded: most of the time)
      soldierTakes(e, cap.e);
    } catch {}
  }
  if (PRIZE.size > 500) PRIZE.clear();
}, 40);
const PRIZE = new Set();
const AMMO_LIMITED = false;   // v9.21.4: nobody runs dry any more (the old "Limited ammo" setting is gone); reloads stay
function ownRound(e, f, near) {
  let own = 0, foe = 0;
  for (const c of near) {
    if (c.down || c.id === e.id || !c.f || (c.type !== SOLDIER && c.type !== "minecraft:player")) continue;
    if (c.type === SOLDIER && (pows.has(c.id) || !c.e?.isValid || gdp(c.e, "war:surr"))) continue;
    if (c.f === f) { if (c.dd <= 8) own++; }
    else if (isHostile(c.f, f) && c.dd <= 12) foe++;
  }
  return own >= 3 && own > foe;
}
world.afterEvents.playerInteractWithEntity.subscribe((ev) => {                     // v9.14: your side's prisoner: you set him free
  const e = ev.target, p = ev.player;
  if (e?.typeId !== SOLDIER || !pows.has(e.id) || (ev.beforeItemStack ?? ev.itemStack)?.typeId === "war:unit_wand") return;
  system.run(() => { try { const pf = playerFaction(p); if (pf && pf === Number(P(e, "war:faction"))) { freePow(e, true); applyRelations(e); giveFunction(e, "follow", p); p.onScreenDisplay.setActionBar("§aFreed. He's with you."); } } catch {} });
});
world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  const e = ev.target, p = ev.player;
  if (e?.typeId !== SOLDIER || !gdp(e, "war:surr") || pows.has(e.id)) return;   // (v9.1: any surrendered man, cut off or at a lost flag)
  if ((ev.beforeItemStack ?? ev.itemStack)?.typeId === "war:unit_wand") return;
  system.run(() => {
    try {
      if (!e.isValid) return;
      const f = Number(P(e, "war:faction")), pf = playerFaction(p);
      if (pf && pf === f) { sdp(e, "war:surrIso", undefined); resume(e); p.onScreenDisplay.setActionBar("§aHe's back with us."); return; }
      if (!isHostile(pf, f)) { p.onScreenDisplay.setActionBar("§7He's surrendered. Only his own side can bring him back."); return; }
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
    if (dim.getBlock && onStairs(dim, l)) return;                     // (v7.1: stairs are never "trouble": everyone needs them)
    const k = troubleKey(dim.id ?? dim, l.x, l.z), r = TROUBLE.get(k) ?? { n: 0, t: 0 };
    r.n = Math.min(8, r.n + w); r.t = tick(); TROUBLE.set(k, r); troubleDirty = true;
    if (TROUBLE.size > 400) { let ok, ot = Infinity; for (const [kk, v] of TROUBLE) if (v.t < ot) { ot = v.t; ok = kk; } TROUBLE.delete(ok); }
  } catch {}
}
const troubleAt = (dimId, x, z) => TROUBLE.size ? (TROUBLE.get(troubleKey(dimId, x, z))?.n ?? 0) : 0;
system.runInterval(() => {
  const now = tick();
  if (now === 40 || (TROUBLE.size === 0 && now % 600 === 40)) {            // load once (after the world is up)
    try { if (world.getDynamicProperty("war:troublever") !== 71) { world.setDynamicProperty("war:trouble", undefined); world.setDynamicProperty("war:troublever", 71); } } catch {}   // v7.1: the old memory (piled up on stairs) is wiped once
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
// v9.20.3: the ground changed (a block placed or broken, blown up, pushed by a piston, a door opened): what the soldiers
// knew about those blocks is forgotten at once, and a route through there is worked out again. Before, what they had
// read stayed in mind for up to a minute: a wall you'd just built was walked into, a gap you'd just made was walked round.
const TCHG = [];
function terrainChanged(dimId, x, y, z) { if (TCHG.length < 4000) TCHG.push({ dimId, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }); }
system.runInterval(() => {
  if (!TCHG.length) return;
  const list = TCHG.splice(0), cols = new Set();
  for (const c of list) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      cols.add(`${c.x + dx},${c.z + dz}`);
      for (let dy = -2; dy <= 2; dy++) { const k = bkey(c.dimId, c.x + dx, c.y + dy, c.z + dz); TERRAIN.delete(k); STAND.delete(k); DANGER.delete(k); }
      if (!dx && !dz) for (let dy = -16; dy <= 1; dy++) SKY.delete(bkey(c.dimId, c.x, c.y + dy, c.z));   // (a roof put on or taken off: the light under it)
    }
  }
  reachMemo.clear();
  const hit = (p) => cols.has(`${Math.floor(p.x)},${Math.floor(p.z)}`);
  for (let i = routeCache.length - 1; i >= 0; i--) if (routeCache[i].pts.some(hit)) routeCache.splice(i, 1);
  for (let i = STAIRS.length - 1; i >= 0; i--) if (STAIRS[i].pts?.some(hit)) STAIRS.splice(i, 1);
  for (const [id, pr] of [...personal]) if (pr?.pts && !pr.planning && pr.pts.slice(Math.max(0, (pr.idx ?? 0) - 1)).some(hit)) { personal.delete(id); travelTo.delete(id); gliders.delete(id); }
}, 1);
function terrainForget() { TCHG.length = 0; TERRAIN.clear(); STAND.clear(); DANGER.clear(); SKY.clear(); reachMemo.clear(); routeCache.length = 0; STAIRS.length = 0; }   // (a whole stretch rebuilt at once)
try { world.afterEvents.playerPlaceBlock.subscribe((ev) => { try { const b = ev.block; terrainChanged(b.dimension.id, b.x, b.y, b.z); } catch {} }); } catch {}
try { world.afterEvents.playerBreakBlock.subscribe((ev) => { try { const b = ev.block; terrainChanged(b.dimension.id, b.x, b.y, b.z); } catch {} }); } catch {}
try { world.afterEvents.blockExplode.subscribe((ev) => { try { const b = ev.block; terrainChanged(b.dimension.id, b.x, b.y, b.z); } catch {} }); } catch {}
try { world.afterEvents.pistonActivate.subscribe((ev) => { try { const b = ev.block; terrainChanged(b.dimension.id, b.x, b.y, b.z); for (const l of ev.piston.getAttachedBlocksLocations?.() ?? []) terrainChanged(b.dimension.id, l.x, l.y, l.z); } catch {} }); } catch {}
try { world.afterEvents.playerInteractWithBlock.subscribe((ev) => { try { const b = ev.block; if (OPENABLE_ID(b.typeId)) terrainChanged(b.dimension.id, b.x, b.y, b.z); } catch {} }); } catch {}

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
  try { e.triggerEvent("war:held_off"); e.triggerEvent("war:body_foot"); } catch {}
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
    if (now - q.t > 30 || q.heard || !q.ent?.isValid) continue;           // (v7.1: seen, not heard)
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
  const mates = nearbyCombatants(e.dimension.id, e.location, 1.2).filter((o) => o.isValid && o.typeId === SOLDIER && o.id !== e.id && !downed.has(o.id) && Math.abs(o.location.y - e.location.y) < 1 && Number(P(o, "war:faction") ?? 0) === f);
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
// v9.4: no fight, standing at his post / hold on top of a squad mate (closer than 1.6 blocks): one of the two takes a
// step or two straight away from him, on safe ground. No markers and no routes: he stays right by his spot.
function idleSpace(e, d, now, anchor, leash) {
  if (!["hold", "post", "sentry", "stand"].includes(d.func) || campOf.has(e.id) || mountOf.has(e.id) || isRiding(e)) return undefined;
  const l = e.location;
  const mates = nearSnap(e.dimension.id, l, 1.6).filter((c) => c.id !== e.id && c.id < e.id && c.type === SOLDIER && !c.down && c.f === d.faction && Math.abs(c.y - l.y) < 1);
  if (!mates.length) return undefined;                            // (of two on the same spot, only one moves)
  try { const v = e.getVelocity(); if (Math.hypot(v.x, v.z) > 0.12) return undefined; } catch { return undefined; }
  let ax = 0, az = 0;
  for (const c of mates) { const dx = l.x - c.x, dz = l.z - c.z, L = Math.hypot(dx, dz); if (L > 0.05) { ax += dx / L; az += dz / L; } }
  const a0 = Math.hypot(ax, az) > 0.1 ? Math.atan2(az, ax) : (e.id.charCodeAt(e.id.length - 1) % 8) * Math.PI / 4;
  for (const da of [0, 0.8, -0.8, 1.6, -1.6, Math.PI]) {           // straight away from him, else the nearest free side
    const a = a0 + da, ux = Math.cos(a), uz = Math.sin(a), to = { x: l.x + ux * 1.6, y: l.y, z: l.z + uz * 1.6 };
    if (!straightReach(e.dimension, l, to) || dangerNear(e.dimension, to)) continue;
    push(e, { x: ux * 0.22, y: 0.02, z: uz * 0.22 }, 2);
    note(e, "making room");
    return { g: "g_none", t: "t_mid", urgent: false };
  }
  return undefined;
}
// the brain's move, then (if he's standing still in a pile) making room
function combatMove(e, d, now, melee, anchor, leash) {
  const mv = drillMove(e, d, now, melee, anchor, leash);
  if (mv && mv.g !== "g_none") return mv;
  const anchored = ["hold", "post", "sentry", "stand"].includes(d.func);
  if (!mv && !anchored) return mv;                                // marching on: spacing is the formation's job
  if (!squads.get(squadKey(e, d))?.known?.size) return idleSpace(e, d, now, anchor, leash) ?? mv;   // (v9.4: no fight: only a man standing on a mate moves)
  return unCrowd(e, d, now, anchor, leash) ?? mv;
}

// ================================================================ v5.5: the glider
// Through stairs, doorways, ladders' surroundings, drops and indoor rooms a soldier is moved by the script itself along
// his planned route, a little every tick (like the ladder climber), facing where he walks. Up a step he rises a third of
// the way across, down a step he drops past the middle, doors and trapdoors are opened as he reaches them. Nothing here
// depends on Minecraft's pathing or on pushes, so he can't get lost, stuck on a stair edge, or pile into the man ahead.
const gliders = new Map(); // id -> { pts, k (index of the point he's heading to), t (last refresh), paused, wait }
const GLIDE_SPEED = 0.21;  // blocks per tick (~4.2 blocks/s: v9.22, a player's walk; was 3.4)
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
          { const r = faceRot(e, b, nb, 22, undefined, g.yaw); g.yaw = r.y; e.teleport({ x: b.x, y: b.y, z: b.z }, { rotation: r }); }
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
      const aimT = gt?.isValid && dist(gt.location, e.location) < 40;
      // (v9.19: he looks where the route goes about 3 blocks on, not at the next grid corner: a staircase of points
      //  turned his head left-right every step; small differences are let be, and he turns at a walking pace)
      let look = gt?.isValid && aimT ? gt.location : undefined;
      if (!look) { let acc = 0, q0 = { x: tx, z: tz }; for (let j = g.k + 1; j < pts.length; j++) { const q = pts[j]; acc += Math.hypot(q.x - q0.x, q.z - q0.z); q0 = q; look = q; if (acc >= 3) break; } }
      if (!look || Math.hypot(look.x - tx, look.z - tz) < 0.3) look = { x: tx + (tx - p.x) * 10, z: tz + (tz - p.z) * 10 };
      let rot = faceRot(e, { x: tx, y, z: tz }, look, aimT ? 22 : 12, aimT ? { x: gt.location.x, y: gt.location.y + 1.4, z: gt.location.z } : undefined, g.yaw);
      if (!aimT && g.yaw !== undefined && Math.abs(((rot.y - g.yaw + 540) % 360) - 180) < 4) rot = { x: rot.x, y: g.yaw };
      g.yaw = rot.y;                                                  // (his heading remembered: no asking the game every step)
      e.teleport({ x: tx, y, z: tz }, { rotation: rot });
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
  const mateLocs = mates.map((m) => m.location);                       // (v8.1: read once, not once per candidate spot: each read is a call into the game)
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
    for (const ml of mateLocs) if (Math.hypot(ml.x - c.x, ml.z - c.z) < 1.6 && Math.abs(ml.y - c.y) < 1.5) crowd++;
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
const learnOn = () => setting("learn", false) === true;   // (v8.2: off unless switched on: experimental)
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

// ================================================================ v9.0: smoke, the wounded dragged to cover, ambushes
// ---- smoke. A canister thrown (lobbed like a grenade) makes a cloud about 7 blocks across and 4 high for ~22 s that
// nobody sees or shoots through: it's checked in the line-of-sight test itself (sighting, aiming, the trigger), so a
// man behind it simply isn't there for the enemy. Two men a step apart inside the same cloud still see each other.
// Thrown to cover a dash: the start of an assault or a flank over open ground, a man going out for a wounded mate, a
// man breaking and running. Each rifleman carries one (another after 2 min); a squad throws one every 25 s at most.
const v9stat = (k, n = 1) => { const S9 = globalThis.__v9; if (S9) S9[k] = (S9[k] ?? 0) + n; };   // (test statistics only)
const SMOKE = { life: 440, grow: 40, r: 3.6, refill: 2400, squadGap: 500, reach: 26 };
const smokeUsed = new Map();   // soldier id -> tick he threw his
function smokeR(s, now) { return SMOKE.r * Math.min(1, 0.35 + (now - s.t0) / SMOKE.grow) * Math.min(1, 0.4 + (s.until - now) / 100); }
function smokeBlocks(dimId, a, b) {
  const now = tick();
  for (const s of SMOKES) {
    if (s.dimId !== dimId || now < s.t0 || now > s.until) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 9) continue;                                                     // a step apart: seen, smoke or not
    let u = L2 ? ((s.x - a.x) * dx + (s.cy - a.y) * dy + (s.z - a.z) * dz) / L2 : 0;
    u = Math.max(0, Math.min(1, u));
    const px = a.x + dx * u - s.x, py = (a.y + dy * u - s.cy) / 0.6, pz = a.z + dz * u - s.z, r = smokeR(s, now);
    if (px * px + py * py + pz * pz < r * r) return true;                      // (a flattened ball: wide, man-high)
  }
  return false;
}
function canSmoke(e, d, now) {
  if (!e?.isValid || downed.has(e.id) || d.surr || d.div === "medic" || isRiding(e) || !GUNS.includes(d.weapon) || held.has(e.id)) return false;
  return now - (smokeUsed.get(e.id) ?? -99999) > SMOKE.refill;
}
// a screen between "us" (at) and "them" (from), `k` blocks out from `at` toward them
function smokeScreen(e, at, from, k, why) {
  const now = tick(), d = sd(e);
  if (!canSmoke(e, d, now)) return false;
  const S = squads.get(squadKey(e, d));
  if (S && now - (S.smokeT ?? -99999) < SMOKE.squadGap) return false;
  const dx = from.x - at.x, dz = from.z - at.z, L = Math.hypot(dx, dz) || 1;
  const p = { x: at.x + (dx / L) * Math.min(k, L * 0.6), y: at.y, z: at.z + (dz / L) * Math.min(k, L * 0.6) };
  if (flat(p, e.location) > SMOKE.reach) return false;
  if (S) S.smokeT = now;
  throwSmoke(e, p, why);
  callout(e, "Smoke out!", { event: true });                    // (v9.5)
  return true;
}
function throwSmoke(e, at, why) {
  const now = tick(), dim = e.dimension, from = headLoc(e), dd = Math.max(2, flat(at, e.location));
  const g = walkableNear(dim, at.x, at.z, at.y) ?? at, T = Math.round(8 + dd * 0.8);
  smokeUsed.set(e.id, now); v9stat(`smoke:${why}`);
  turnTo(e, g, 180);
  try { dim.playSound("random.bow", from, { volume: 0.5, pitch: 0.5 }); } catch {}
  for (let k = 1; k <= T; k += 2) system.runTimeout(() => {
    try { const u = k / T, h = Math.max(2.5, dd * 0.3); dim.spawnParticle("minecraft:basic_smoke_particle", { x: from.x + (g.x - from.x) * u, y: from.y + (g.y + 0.3 - from.y) * u + 4 * h * u * (1 - u), z: from.z + (g.z - from.z) * u }); } catch {}
  }, k);
  system.runTimeout(() => {
    const t0 = tick();
    SMOKES.push({ dimId: dim.id, dim, x: g.x, y: g.y, cy: g.y + 1.4, z: g.z, t0, until: t0 + SMOKE.life });
    if (SMOKES.length > 24) SMOKES.shift();
    try { dim.playSound("random.fizz", g, { volume: 0.9, pitch: 0.6 }); } catch {}
  }, T);
  note(e, `throwing smoke: ${why}`);
  radio(e, `smoke out, ${why}`);
  if (Math.random() < 0.5) callout(e, "Cover me!", { event: true });
}
// the cloud itself: billowing puffs while anyone is near enough to see it
let smokeFxOk = true;
system.runInterval(() => {
  const now = tick();
  for (let i = SMOKES.length - 1; i >= 0; i--) if (now > SMOKES[i].until) SMOKES.splice(i, 1);
  if (!SMOKES.length) return;
  const players = world.getAllPlayers();
  for (const s of SMOKES) {
    if (!players.some((p) => { try { return p.dimension.id === s.dimId && dist(p.location, s) < 112; } catch { return false; } })) continue;
    const r = smokeR(s, now), n = now - s.t0 < 60 ? 5 : 3;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, q = Math.sqrt(Math.random()) * r * 0.8;
      const at = { x: s.x + Math.cos(a) * q, y: s.y + 0.3 + Math.random() * 2.2, z: s.z + Math.sin(a) * q };
      try {
        if (smokeFxOk) s.dim.spawnParticle("war:smoke_cloud", at);
        else s.dim.spawnParticle("minecraft:campfire_tall_smoke_particle", at);
      } catch { smokeFxOk = false; }
    }
  }
}, 6);
// the squad's own use of it: (1) the start of an assault or a flank across open ground they can be shot on; (2) the
// dash at a held building's door; (3) pinned down in the open (most of them under fire where they lie): a screen to
// get out from under it
// v9.2: smoke is for a real firefight, never "because there's a fight somewhere": the squad has SEEN the enemy (not
// only heard of him), the contact is 5 s old or more, and it's under fire now (rounds at its men in the last 3 s).
// when this soldier (or player) last fired: his own gun state, else the gunfire log
function lastFired(id) { const g = gunState.get(id)?.lastShot; if (g !== undefined) return g; for (let i = SHOTS.length - 1; i >= 0; i--) if (SHOTS[i].id === id) return SHOTS[i].t; return undefined; }
const underFire = (ours, now, win = 60) => ours.filter((e) => now - (firedAt.get(e.id)?.t ?? -9999) < win || now - (hurtBy.get(e.id)?.t ?? -9999) < win).length;
function squadSmoke(S, ours, known, now) {
  const prev = S.smokePlan; S.smokePlan = S.plan;
  if (!known.length || now - (S.smokeT ?? -99999) < SMOKE.squadGap) return;
  if (S.contactT < 0 || now - S.contactT < 100 || !known.some((q) => !q.heard && now - q.t < 60) || !underFire(ours, now)) { S.pinN = 0; return; }
  const oc = S.ourC; if (!oc) return;
  const dim = ours[0].dimension, look = known.filter((q) => !q.heard).slice(0, 4);
  let near, nd = 1e9;
  for (const q of known) { const dd = Math.hypot(q.x - oc.x, q.z - oc.z); if (dd < nd) { nd = dd; near = q; } }
  if (!near || nd > 60) return;
  let screenAt, why;
  // (v9.2: no smoke for an assault or a flank any more: only to breach, or to get back to safety)
  if (!screenAt && S.bplan?.kind === "attack" && !S.bplan.smoked && ours.filter((e) => isIndoors(e)).length * 2 < ours.length) {
    const doors = entrances(dim, S.enemyC ?? near).slice().sort((p, q) => flat(p, oc) - flat(q, oc));
    const door = doors[0];
    const watch = known.slice(0, 4);                                          // (inside, they're mostly heard, not seen: where they are is enough)
    if (door && flat(door, oc) >= 8 && flat(door, oc) <= SMOKE.reach + 6 && exposureAt(dim, { x: (oc.x + door.x) / 2, y: oc.y, z: (oc.z + door.z) / 2 }, watch) > 0) {
      S.bplan.smoked = true;
      screenAt = { x: oc.x + (door.x - oc.x) * 0.7, y: door.y, z: oc.z + (door.z - oc.z) * 0.7 }; why = "covering the run to the door";
    }
  }
  // falling back to safety: most of the squad pulling back (retreat order, or broken) with the enemy in sight: a screen
  // between them and the enemy
  if (!screenAt && nd >= 8 && nd <= 40 && ours.filter((e) => sd(e).retreat || shaken.has(e.id)).length * 3 > ours.length && look.length) {   // (v9.19: a third pulling back is enough)
    const L = nd; screenAt = { x: oc.x + ((near.x - oc.x) / L) * 5, y: oc.y, z: oc.z + ((near.z - oc.z) / L) * 5 }; why = "covering the pull-back";
  }
  // v9.5: covering the move: most of the squad is carrying out a fresh order (moving), they're under fire and the enemy is
  // in sight: one screen between them and the enemy, once per order (they still fight their way forward as before:
  // committing to the move under the smoke instead of fighting was tested, and lost the fight)
  if (!screenAt && nd >= 8 && nd <= 45 && look.length) {
    let t0 = -1;
    const movers = ours.filter((e) => { const d = sd(e), t = Number(gdp(e, "war:ordt") ?? -99999); if (now - t < 600 && t > (S.moveSmokedFor ?? -1) && (d.func === "charge" || personal.has(e.id))) { t0 = Math.max(t0, t); return true; } return false; });
    const going = movers.filter((e) => { try { const v = e.getVelocity(); return Math.hypot(v.x, v.z) > 0.06; } catch { return false; } });
    if (movers.length * 2 > ours.length && going.length * 2 >= movers.length && nd >= 16) {      // (they're actually on the way, and it's open ground ahead)
      S.moveSmokedFor = t0;
      const L = nd, k = Math.min(12, nd * 0.45); screenAt = { x: oc.x + ((near.x - oc.x) / L) * k, y: oc.y, z: oc.z + ((near.z - oc.z) / L) * k }; why = "covering the move";   // (ahead of them, on the way: they walk into its cover)
    }
  }
  if (!screenAt) return;
  let who, wd = 1e9;
  for (const e of ours) { const d = sd(e); if (!canSmoke(e, d, now) || (S.plan === "fix" && S.flankers?.has(e.id))) continue; const dd = flat(e.location, screenAt); if (dd < wd && dd <= SMOKE.reach) { wd = dd; who = e; } }
  if (!who) return;
  S.smokeT = now;
  throwSmoke(who, screenAt, why);
  callout(who, "Smoke out!", { event: true });
  if (why === "covering the move") radio(who, "smoke's out, moving under it", true);
}

// ---- v9.2: fire into smoke. A man who lost sight of his enemy in the last 4 s, and it's a smoke cloud between them
// (not a wall), puts short bursts where he last saw him: wider, fewer, and never with a friend in the way. Not the
// sniper (no target, no shot) and not the rocket.
function smokeShot(e, d, spec, st, now) {
  if (d.weapon === "sniper" || d.weapon === "at" || SAFE.has(e.id)) return false;
  const ps = perc.get(e.id), ls = ps?.lastSeen;
  if (!ls || !ps.lostT || now - ps.lostT > 80 || ps.threat?.isValid && !ps.lostT) return false;
  if ((st.smokeN ?? 0) >= 8 && now - (st.smokeT0 ?? 0) < 100) return false;   // (a few bursts, then he waits for it to thin)
  const h = headLoc(e), p = { x: ls.x, y: ls.y + 1.1, z: ls.z };
  const dx = p.x - h.x, dy = p.y - (h.y - 0.2), dz = p.z - h.z, L = Math.hypot(dx, dy, dz);
  if (L < 3 || L > Math.min(spec.fire, 80) || !smokeBlocks(e.dimension.id, h, p)) return false;
  const u = { x: dx / L, y: dy / L, z: dz / L }, from = { x: h.x + u.x * 0.9, y: h.y - 0.2 + u.y * 0.9, z: h.z + u.z * 0.9 };
  try { if (rayHit(e.dimension, from, u, L - 1.2)) return false; } catch { return false; }   // a wall in the way: not the smoke
  if (friendlyInLine(e, d, h, p, undefined)) return false;
  if (aimTurn(e, p, 25) > 30) { st.next = now + 2; return true; }
  if (now - (st.smokeT0 ?? 0) >= 100) { st.smokeT0 = now; st.smokeN = 0; }
  st.smokeN = (st.smokeN ?? 0) + 1;
  const r = () => (Math.random() + Math.random() - 1) * Math.max(0.03, spec.spread * 5);
  const dir = { x: u.x + r(), y: u.y + r() * 0.5, z: u.z + r() };
  if (preciseHits()) hitscan(e, spec, from, dir, Math.min(spec.fire + 20, 220), sd(e).weapon);
  else try { const b = e.dimension.spawnEntity(spec.bullet, from); const pc = b.getComponent("minecraft:projectile"); if (pc) { OURS.add(b.id); pc.owner = e; pc.shoot({ x: dir.x * spec.speed, y: dir.y * spec.speed, z: dir.z * spec.speed }); } } catch {}
  noteShot(e); st.lastShot = now; st.ammo--;
  note(e, "firing into the smoke");
  if (st.ammo > 0) st.next = now + Math.max(3, spec.gap) + 2; else st.next = now + (reloadGun(e, st, spec) ? spec.reload + Math.floor(Math.random() * 8) : 60);
  return true;
}
// ---- v9.2: the right weapon for the moment. Each gunner has his main gun, a sidearm (pistol) and a blade.
// - An enemy right on him (2.5 blocks) and his gun the wrong tool there (jammed, reloading, or a long gun: rifle,
//   sniper, machine gun, launcher; or the enemy has a blade and he can't fire this instant): the sword. An SMG, a
//   pistol, a semi-automatic or a shotgun keeps shooting up close; that's what they're for.
// - A jam (rare: 2 to 8 in a thousand rounds, by weapon) takes 3-7 s to clear: the pistol meanwhile, or the sword if
//   an enemy is within 5 blocks.
// - A rifle or machine gun reloading with an enemy within 6 blocks: a quick draw of the pistol.
// - Otherwise the main gun. What he holds is what he uses; he doesn't swap back and forth by the second.
const ARM = new Map(); // soldier id -> { arm: "main" | "pistol" | "blade", t, jamUntil, mainAmmo }
const JAM = { rifle: 0.003, semi: 0.004, smg: 0.006, mg: 0.008, shotgun: 0.003, pistol: 0.002, sniper: 0.002, at: 0 };
const LONG_GUN = ["rifle", "sniper", "mg", "at"];
function jamGun(e, d, now) {
  const A = ARM.get(e.id) ?? { arm: "main", t: -999 }; ARM.set(e.id, A);
  A.jamUntil = now + 60 + Math.floor(Math.random() * 80);
  note(e, "gun jammed: clearing it");
  if (Math.random() < 0.5) callout(e, "Reloading!");
}
function chooseArm(e, d, now, calm) {
  let A = ARM.get(e.id);
  if (!A) { A = { arm: "main", t: -999, jamUntil: 0 }; ARM.set(e.id, A); }
  const st = gunState.get(e.id), jammed = A.jamUntil > now;
  const reloading = !!st && (st.reloadUntil ?? 0) > now + 10;
  let want = "main";
  if (!calm && !d.surr && !downed.has(e.id) && !ridingNest(e)) {
    const close = closeEnemy(e, d, 2.5);
    const foeBlade = close?.typeId === SOLDIER && !GUNS.includes(sd(close).weapon);
    if (close && (jammed || reloading || LONG_GUN.includes(d.weapon) || (foeBlade && now < (st?.next ?? 0)))) want = "blade";
    else if (jammed) want = closeEnemy(e, d, 5) ? "blade" : d.weapon === "pistol" ? "main" : "pistol";
    else if (reloading && LONG_GUN.includes(d.weapon) && closeEnemy(e, d, 6)) want = "pistol";
    if (want === "main" && A.arm === "blade" && closeEnemy(e, d, 3.5) && (LONG_GUN.includes(d.weapon) || jammed)) want = "blade";   // (still in the melee: the sword stays out)
  }
  if (want === A.arm) return want;
  if (want !== "blade" && now - A.t < 20) return A.arm;                     // (no swapping by the second)
  if (A.arm === "pistol" && st) { st.ammo = A.mainAmmo ?? GUN_SPEC[d.weapon]?.mag ?? 1; }
  if (want === "pistol" && st) { A.mainAmmo = st.ammo; st.ammo = GUN_SPEC.pistol.mag; st.next = Math.max(st.next, now + 8); }   // (the draw takes a moment)
  A.arm = want; A.t = now;
  try { equip(e, want === "blade" ? "iron_sword" : want === "pistol" ? `ww:${gunModel(d.faction, "pistol")}` : weaponItem(e)); } catch {}
  note(e, want === "blade" ? "hand to hand" : want === "pistol" ? "drew his pistol" : "back on his gun");
  return want;
}
// ---- the wounded dragged to cover. A man down where the enemy can see him, with no medic on the way: the nearest
// squad mate (within 16 blocks) goes out for him, throws smoke if he has it, grabs him and drags him back to the
// nearest spot the enemy can't see, then patches him up: ~5 s of first aid and he's back on his feet, weak (4 hearts
// of 20 for most). A man down out of sight gets the same first aid where he lies. A medic coming takes over.
const DRAG = new Map();    // downed id -> { by, phase: "go" | "drag" | "aid", to, t0, phaseT }
// v9.7 (rev.): a wounded man in the open crawls for cover. In the open = any enemy near who can see him, or the
// line of sight from where his squad knows the enemy is. He drags himself (about 0.6 blocks a second, arms pulling)
// to the nearest spot within 6 blocks out of their sight; with none, away from them. Not while someone's dragging
// him or a medic is on the way.
const crawlTo = new Map(); // downed id -> { to, t }
system.runInterval(() => {
  const now = tick(); let n = 0;
  for (const [id] of downed) {
    if (n >= 12) break;
    try {
      const v = world.getEntity(id);
      const stop = () => { crawlTo.delete(id); try { if (v?.isValid) setP(v, "war:crawl", false); } catch {} };
      if (!v?.isValid || FALLS.has(id) || DRAG.has(id) || held.has(id) || pows.has(id) || medicComing(id, now)) { stop(); continue; }
      n++;
      let c = crawlTo.get(id);
      if (!c || now - c.t > 40 || (!c.to && now - c.t > 20)) {
        const d = sd(v), S = squads.get(squadKey(v, d)), eyes = [];
        for (const o of enemiesSeeing(v, d.faction, 48).slice(0, 4)) eyes.push({ x: o.x, y: o.y + 1.6, z: o.z });
        if (S) for (const q of S.known.values()) { if (eyes.length >= 6) break; if (!q.heard && now - q.t < 200 && Math.hypot(q.x - v.location.x, q.z - v.location.z) < 60) eyes.push({ x: q.x, y: q.y + 1.6, z: q.z }); }
        const body = { x: v.location.x, y: v.location.y + 0.4, z: v.location.z };
        if (!eyes.length || !eyes.some((h) => clearShot(v.dimension, h, body))) { stop(); crawlTo.set(id, { to: undefined, t: now }); continue; }
        let best;
        for (const r of [1.5, 3, 4.5, 6]) { for (let k = 0; k < 12 && !best; k++) {
          const a = (k / 12) * Math.PI * 2, w = walkableNear(v.dimension, v.location.x + Math.cos(a) * r, v.location.z + Math.sin(a) * r, v.location.y);
          if (!w || Math.abs(w.y - v.location.y) > 0.6 || dangerNear(v.dimension, w) || !straightReach(v.dimension, v.location, w)) continue;
          if (eyes.every((h) => !clearShot(v.dimension, h, { x: w.x, y: w.y + 0.4, z: w.z }))) best = w;
        } if (best) break; }
        if (!best) {                                                     // (nowhere hidden: away from them)
          const ex = eyes.reduce((t, h) => t + h.x, 0) / eyes.length, ez = eyes.reduce((t, h) => t + h.z, 0) / eyes.length;
          const dx = v.location.x - ex, dz = v.location.z - ez, L = Math.hypot(dx, dz) || 1;
          const w = walkableNear(v.dimension, v.location.x + (dx / L) * 4, v.location.z + (dz / L) * 4, v.location.y);
          if (w && Math.abs(w.y - v.location.y) <= 0.6 && !dangerNear(v.dimension, w) && straightReach(v.dimension, v.location, w)) best = w;
        }
        c = { to: best, t: now }; crawlTo.set(id, c);
        if (best) { note(v, "crawling for cover"); v9stat("crawl"); }
      }
      if (c.to && flat(c.to, v.location) > 0.5) {
        const dx = c.to.x - v.location.x, dz = c.to.z - v.location.z, L = Math.hypot(dx, dz) || 1;
        setP(v, "war:crawl", true);
        if (gore() && now % 20 < 5) try { const l = v.location; v.dimension.spawnParticle("war:bsplat", { x: l.x, y: l.y + 0.05, z: l.z }); } catch {}   // (a trail behind him)
        // (a downed man is far too slowed for a push to move him: he's moved in small checked steps, ~0.6 blocks a second)
        const st = Math.min(0.15, L), to = { x: v.location.x + (dx / L) * st, y: v.location.y, z: v.location.z + (dz / L) * st };
        if (!solidAt(v.dimension, { x: to.x, y: to.y + 0.3, z: to.z }) && solidAt(v.dimension, { x: to.x, y: to.y - 0.2, z: to.z })) { try { v.teleport(to, { keepVelocity: false, checkForBlocks: true }); downPos.set(id, { ...to }); } catch {} }   // (and where he lies pinned moves with him)
        else { c.to = undefined; stop(); }
      } else stop();
    } catch {}
  }
  for (const id of [...crawlTo.keys()]) if (!downed.has(id)) { crawlTo.delete(id); try { const e = world.getEntity(id); if (e?.isValid) setP(e, "war:crawl", false); } catch {} }
}, 5);
const dragOf = new Map();  // rescuer id -> downed id
const dragCool = new Map(); // rescuer id -> tick he may go out again
const enemiesSeeing = (v, f, r = 48) => {
  const out = [];
  for (const c of nearSnap(v.dimension.id, v.location, r)) {
    if (c.down || !c.f || !isHostile(f, c.f) || !c.e.isValid || (c.type !== SOLDIER && c.type !== "minecraft:player")) continue;
    if (c.type === "minecraft:player" && !playerFair(c.e)) continue;
    out.push(c);
  }
  return out.filter((c) => clearShot(v.dimension, { x: c.x, y: c.y + 1.6, z: c.z }, { x: v.location.x, y: v.location.y + 0.4, z: v.location.z })).slice(0, 4);
};
function coverFrom(dim, at, threats, now) {
  let best, bs = 1e9;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + (i % 2) * 0.3, r = 3 + (i % 4) * 2.5;
    const w = walkableNear(dim, at.x + Math.cos(a) * r, at.z + Math.sin(a) * r, at.y);
    if (!w || Math.abs(w.y - at.y) > 1.5 || dangerNear(dim, w)) continue;
    if (threats.some((c) => clearShot(dim, { x: c.x, y: c.y + 1.6, z: c.z }, { x: w.x, y: w.y + 0.6, z: w.z }))) continue;
    const sc = r + threats.reduce((m, c) => m - Math.min(8, Math.hypot(c.x - w.x, c.z - w.z)) * 0.05, 0);
    if (sc < bs) { bs = sc; best = w; }
  }
  return best;
}
const dragEnd = (id) => { const D = DRAG.get(id); if (D) { dragOf.delete(D.by); dragCool.set(D.by, tick() + 300); } DRAG.delete(id); };
system.runInterval(() => {
  const now = tick();
  for (const [id, D] of [...DRAG]) { const r = world.getEntity(D.by); if (!downed.has(id) || !r?.isValid || downed.has(D.by) || now - D.t0 > 900 || medicComing(id, now)) dragEnd(id); }
  for (const [id] of downed) {
    if (DRAG.has(id) || held.has(id) || pows.has(id) || medicComing(id, now) || (downed.get(id) ?? 0) - now < 160) continue;   // (too late to get to him: under 8 s left)
    const v = world.getEntity(id); if (!v?.isValid || v.typeId !== SOLDIER) continue;
    const dv = sd(v); if (!dv.faction || gdp(v, "war:surr")) continue;
    let who, wd = 1e9;
    for (const c of nearSnap(v.dimension.id, v.location, 16)) {
      if (c.type !== SOLDIER || c.down || c.f !== dv.faction || c.id === id || !c.e.isValid || dragOf.has(c.id) || now < (dragCool.get(c.id) ?? 0)) continue;
      const dc = sd(c.e);
      if (dc.surr || dc.div === "medic" || dc.div === "guard" || dc.retreat || isRiding(c.e) || shaken.has(c.id) || held.has(c.id) || pows.has(c.id)) continue;
      if (closeEnemy(c.e, dc, 6)) continue;                                   // fighting for his own life right now
      if (Math.abs(c.y - v.location.y) > 4) continue;
      const eff = c.dd - (gdp(c.e, "war:buddy") === id ? 10 : 0);            // (v9.18: his buddy comes for him first)
      if (eff < wd) { wd = eff; who = c.e; }
    }
    if (!who) continue;
    // (v9.2: nobody runs out into fire. Enemies who can see the wounded man and are shooting: smoke first if he has
    //  it (and he waits for it to bloom), else he waits for a lull; the same for the ground he'd have to cross)
    const threats = enemiesSeeing(v, dv.faction), active = threats.filter((c) => now - (lastFired(c.id) ?? -9999) < 100);
    const blinded = (c, at) => SMOKES.length && smokeBlocks(v.dimension.id, { x: c.x, y: c.y + 1.6, z: c.z }, at);
    const vChest = { x: v.location.x, y: v.location.y + 0.4, z: v.location.z }, mid = { x: (v.location.x + who.location.x) / 2, y: v.location.y + 1, z: (v.location.z + who.location.z) / 2 };
    const exposed = active.filter((c) => !blinded(c, vChest) || clearShot(v.dimension, { x: c.x, y: c.y + 1.6, z: c.z }, mid) && !blinded(c, mid));
    let wait = 0;
    if (exposed.length) continue;                                             // (v9.2: under fire: he waits for a lull; smoke is for breaching and pulling back)
    const wk = squadKey(who, sd(who)), WS = squads.get(wk);
    let busy = 0; for (const [, D2] of DRAG) if (D2.sq === wk) busy++;
    if (busy >= ((WS?.n ?? 0) >= 8 ? 2 : 1) || (WS?.ratio !== undefined && WS.ratio < 0.6 && flat(who.location, v.location) > 6)) continue;   // a squad losing the fight keeps its men in it
    DRAG.set(id, { sq: wk, by: who.id, phase: wait ? "wait" : "go", t0: now, phaseT: now, until: now + wait }); v9stat("rescueGo");
    dragOf.set(who.id, id);
    note(who, wait ? "smoke out, then going for a wounded mate" : "going for a wounded mate");
    if (!wait) callout(who, "Moving up!", { event: true });
  }
}, 20);
function casevacMove(e, d, now) {
  const vid = dragOf.get(e.id); if (!vid) return undefined;
  const D = DRAG.get(vid), v = world.getEntity(vid);
  if (!D || !v?.isValid || !downed.has(vid)) { dragEnd(vid); return undefined; }
  const dd = flat(v.location, e.location), dy = Math.abs(v.location.y - e.location.y);
  if (D.phase === "wait") {
    if (now < D.until) { note(e, "waiting for the smoke"); return { g: "g_none", t: "t_mid", urgent: false }; }
    D.phase = "go"; D.phaseT = now; callout(e, "Moving up!", { event: true });
  }
  if (D.phase === "go" && dd > 3 && now - (firedAt.get(e.id)?.t ?? -9999) < 12 && !(SMOKES.length && SMOKES.some((sm) => now <= sm.until && flat(sm, v.location) < 8))) {
    note(e, "under fire: back to cover"); dragEnd(vid); dragCool.set(e.id, now + 400); return undefined;   // (v9.2: shot at on the way, no smoke: he goes back)
  }
  if (D.phase === "go") {
    if (dd < 1.9 && dy < 1.5) {
      downed.set(vid, Math.max(downed.get(vid) ?? now, now + 500)); try { sdp(v, "war:downed", downed.get(vid)); } catch {}   // pressure on the wound: he holds on
      const seen = enemiesSeeing(v, d.faction);
      const to = seen.length ? coverFrom(e.dimension, v.location, seen, now) : undefined;
      if (to) {
        // v9.19: a short way under fire: dragged, kept low. Farther (or with smoke round him): over the shoulder, quicker
        D.carry = flat(v.location, to) > 9 || !!(SMOKES.length && SMOKES.some((sm) => now <= sm.until && flat(sm, v.location) < 8));
        D.phase = "drag"; D.to = to; D.phaseT = now; v9stat(D.carry ? "carryStart" : "dragStart");
        note(e, D.carry ? "carrying a wounded mate to cover" : "dragging a wounded mate to cover"); radio(e, D.carry ? "carrying a wounded man to cover" : "dragging a wounded man to cover");
      }
      else { D.phase = "aid"; D.phaseT = now; }
    } else {
      if (now - D.phaseT > 300) { dragEnd(vid); return undefined; }         // can't get to him
      note(e, "going for a wounded mate");
      const mv = travel(e, v.location, "medic", now, true);
      return mv ? { ...mv, t: "t_off" } : undefined;
    }
  }
  if (D.phase === "drag") {
    if (flat(e.location, D.to) < 1.4 || now - D.phaseT > 260) {
      D.phase = "aid"; D.phaseT = now;
      if (D.carry) { try { const l = e.location, f = fwdFromYaw(e.getRotation().y), g = { x: l.x + f.x * 0.9, y: l.y, z: l.z + f.z * 0.9 }; const at = standAt(v.dimension, Math.floor(g.x), Math.floor(g.y), Math.floor(g.z)) ? g : { ...l }; downPos.set(vid, at); v.teleport(at); } catch {} }   // (put down in front of him)
    }
    else {
      note(e, D.carry ? "carrying a wounded mate to cover" : "dragging a wounded mate to cover");
      try { if (now % 20 === 0) e.addEffect("slowness", 24, { amplifier: D.carry ? 0 : 1, showParticles: false }); } catch {}
      const mv = travel(e, D.to, "medic", now, true);
      return mv ? { ...mv, t: "t_off" } : undefined;
    }
  }
  // first aid, kneeling beside him
  if (dd > 2.6 || dy > 1.8) { const mv = travel(e, v.location, "medic", now, true); return mv ? { ...mv, t: "t_off" } : undefined; }
  if (!D.aidT) { D.aidT = now; downed.set(vid, Math.max(downed.get(vid) ?? now, now + 400)); try { sdp(v, "war:downed", downed.get(vid)); } catch {} }   // the bleeding's stopped
  note(e, "first aid"); KNEEL.set(e.id, now + 20);
  turnTo(e, v.location, 30);
  if (now - D.aidT >= 100) {
    revive(v, 4); creditSave(e); dragEnd(vid); v9stat("firstAidRevive");
    callout(e, "You're okay!", { event: true }); system.runTimeout(() => { try { if (v.isValid) callout(v, "Thanks!", { event: true }); } catch {} }, 30);
    radio(e, "wounded man patched up, back in the fight");
    return undefined;
  }
  return { g: "g_none", t: "t_off", urgent: false };
}
// the drag itself: the body follows a step behind the man pulling it (every other tick: smooth, a few bodies at most)
system.runInterval(() => {
  for (const [vid, D] of DRAG) {
    if (D.phase !== "drag") continue;
    try {
      const v = world.getEntity(vid), r = world.getEntity(D.by);
      if (!v?.isValid || !r?.isValid) continue;
      const a = r.location;
      if (D.carry) {                                                          // (v9.19: over his shoulder, across it)
        const yaw = r.getRotation().y, f = fwdFromYaw(yaw), p = { x: a.x - f.x * 0.15, y: a.y + 1.15, z: a.z - f.z * 0.15 };
        downPos.set(vid, p); v.teleport(p, { rotation: { x: 0, y: yaw + 90 } }); continue;
      }
      const b = v.location, dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      if (L < 1.25) continue;
      const p = { x: a.x + (dx / L) * 1.1, y: a.y, z: a.z + (dz / L) * 1.1 };
      if (!standAt(v.dimension, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) { p.x = a.x; p.z = a.z; }
      downPos.set(vid, p);
      v.teleport(p);
      if (gore() && tick() % 20 < 2) try { v.dimension.spawnParticle("war:bsplat", { x: p.x, y: p.y + 0.05, z: p.z }); } catch {}   // (v9.19: a trail where he's dragged)
    } catch {}
  }
}, 2);

// ---- the door: attackers about to go into a building the enemy holds on that floor stack up beside the way in (up
// to 3 of them, or 6 s), the first with a grenade throws it into the room at the nearest of them, and when it's gone
// off they all go in together. One grenade per man for this (another after 2 min); never with a friend in the room.
const doorStack = new Map(); // "squad|door cell" -> { t0, frag, go }
const breachFragUsed = new Map();
function stackAtDoor(e, pr, i, now) {
  const d = sd(e), S = squads.get(squadKey(e, d)), l = e.location;
  if (!S?.known?.size || (S.n ?? 0) < 2 || isIndoors(e) || !GUNS.includes(d.weapon)) return false;
  let door = -1;
  for (let k = Math.max(i, 1); k < Math.min(pr.pts.length, i + 5); k++) if (isIndoorsAt(e.dimension, pr.pts[k]) && !isIndoorsAt(e.dimension, pr.pts[k - 1])) { door = k; break; }
  if (door < 0) return false;
  const p = pr.pts[door];
  if (flat(p, l) > 4 || Math.abs(p.y - l.y) > 1.5) return false;
  const inside = [...S.known.values()].filter((q) => Math.abs(q.y - p.y) < 2.5 && flat(q, p) < 16 && isIndoorsAt(e.dimension, q));
  if (!inside.length) return false;
  const key = `${squadKey(e, d)}|${Math.floor(p.x)}|${Math.floor(p.y)}|${Math.floor(p.z)}`;
  let st = doorStack.get(key);
  if (!st || now - st.t0 > 900) { st = { t0: now, frag: 0, go: 0 }; doorStack.set(key, st); if (doorStack.size > 200) doorStack.clear(); }
  if (st.go && now >= st.go) return now - st.go > 200 ? (st.t0 = now - 901, false) : false;   // going in (a stack long gone: a fresh one next time)
  if (st.go) { note(e, "waiting for the grenade"); return true; }
  const mates = nearbyCombatants(e.dimension.id, l, 5).filter((o) => o.typeId === SOLDIER && !downed.has(o.id) && Number(P(o, "war:faction")) === d.faction && sd(o).squad === d.squad);   // (him included)
  if (mates.length < Math.min(3, S.n) && now - st.t0 < 120) return true;   // gathering
  // the stack's ready: a grenade in first (one man, one throw), then go when it's gone off
  if (!st.frag) {
    st.frag = now;
    const q = inside.sort((a, b) => flat(a, p) - flat(b, p))[0];
    const thrower = mates.find((o) => now - (breachFragUsed.get(o.id) ?? -99999) > 2400 && GUNS.includes(sd(o).weapon));
    const tgt = { x: p.x + Math.max(-8, Math.min(8, q.x - p.x)), y: q.y, z: p.z + Math.max(-8, Math.min(8, q.z - p.z)) };
    const friendIn = nearbyCombatants(e.dimension.id, tgt, NADE.safe).some((o) => (o.typeId === SOLDIER || o.typeId === "minecraft:player") && isFriendly(d.faction, factionOf(o)) && !downed.has(o.id));
    if (thrower && !friendIn && flat(tgt, p) >= 2) {
      breachFragUsed.set(thrower.id, now);
      const T = lobGrenade(thrower, tgt);
      st.go = now + T + NADE.fuse + 4;
      v9stat("breachFrag");
      note(thrower, "grenade in the door");
      radio(thrower, "grenade in, then we go", true);
      return true;
    }
  }
  st.go = now; v9stat("breachGo");
  if (Math.random() < 0.5 || !callout(e, "Breaching!", { event: true })) callout(e, "Go, go, go!", { event: true });   // (v9.5)
  radio(e, "going in", true);
  return false;
}
// a grenade lobbed to a spot (the same as a Demolition man's: the arc, the fuse, the warning, the blast)
function lobGrenade(e, at) {
  const dim = e.dimension, from = headLoc(e), dd = Math.max(2, dist(at, e.location)), T = Math.round(10 + dd * 0.9);
  const g = walkableNear(dim, at.x, at.z, at.y) ?? at, by = e;
  turnTo(e, g, 180);
  callout(e, "Grenade!", { event: true });
  try { dim.playSound("random.bow", from, { volume: 0.6, pitch: 0.6 }); } catch {}
  for (let k = 1; k <= T; k += 2) system.runTimeout(() => {
    try { const u = k / T, h = Math.max(1.5, dd * 0.2); dim.spawnParticle("minecraft:basic_smoke_particle", { x: from.x + (g.x - from.x) * u, y: from.y + (g.y + 0.3 - from.y) * u + 4 * h * u * (1 - u), z: from.z + (g.z - from.z) * u }); } catch {}
  }, k);
  system.runTimeout(() => {
    try { dim.playSound("random.fuse", g, { volume: 0.8, pitch: 1.4 }); } catch {}
    liveNades.push({ dim, at: { x: g.x, y: g.y, z: g.z }, boom: tick() + NADE.fuse, by });
  }, T);
  return T;
}
// ---- ambushes. A squad that sees the enemy before the enemy sees it (no man of theirs aware of us, nobody shooting
// at us, nobody closer than 14 blocks) lies in wait: no shot and no shout until it's sprung. It's sprung when most of
// the squad has a man in its sights, when the enemy notices, shoots, or gets within 10 blocks, or after 6 s: then
// every rifle opens up in the same second.
const AMB = { max: 120, close: 10, minD: 14 };
function enemyAware(q, ours, now) {
  const o = q.ent ?? q;
  if (!o?.isValid) return false;
  if (o.typeId === "minecraft:player") return ours.some((e) => now - (shotAtPlayer.get(o.id) ?? -9999) < 200 || attackedRecently(e, o, now, 100)) || ours.some((e) => dist(e.location, o.location) < 18);
  if (o.typeId !== SOLDIER) return true;                                     // (mobs: no ambush, just shoot)
  const ps = perc.get(o.id);
  if (!ps || ps.alert === "calm") return false;
  return !!ps.threat && ours.some((e) => e.id === ps.threat.id) || ps.alert === "combat";
}
function ambushDecide(S, ours, known, now) {
  S.amb = undefined;
  if (ours.length < 2 || String(gdp(ours[0], "war:stance") ?? "aggressive") === "holdfire") return;
  if (ours.some((e) => now - (firedAt.get(e.id)?.t ?? -9999) < 100 || now - (gunState.get(e.id)?.lastShot ?? -9999) < 100)) return;
  const seen = known.filter((q) => !q.heard);
  if (!seen.length || known.some((q) => ours.some((e) => Math.hypot(q.x - e.location.x, q.z - e.location.z) < AMB.minD))) return;
  if (seen.some((q) => enemyAware(q, ours, now))) return;
  S.amb = { t0: now, until: now + AMB.max }; v9stat("ambushSet");
  radio(ours[0], "enemy hasn't seen us, hold your fire");
  callout(ours[Math.floor(Math.random() * ours.length)], "Wait for it...", { event: true });   // (v9.5: whispered)
  for (const e of ours) note(e, "ambush: holding fire");
}
function ambushSprung(S, now, why) {
  if (!S.amb || now >= S.amb.until) return;
  S.amb.until = now; v9stat(`sprung:${why}`);
  const ours = (S.ours ?? []).filter((e) => e.isValid);
  if (ours.length) { const w = ours[Math.floor(Math.random() * ours.length)]; if (!callout(w, "Open fire!", { event: true })) callout(w, "Contact!", { event: true }); radio(ours[0], `ambush sprung (${why})`); }
  for (const e of ours) { const st = gunState.get(e.id); if (st) { st.next = Math.min(st.next, now + 1 + Math.floor(Math.random() * 4)); st.check = now; } }
}
function ambushHold(e, d, t, now) {
  const S = squads.get(squadKey(e, d));
  if (!S?.amb || now >= S.amb.until) return false;
  if (isMob(t)) { ambushSprung(S, now, "mobs"); return false; }
  const ours = (S.ours ?? []).filter((o) => o.isValid && !downed.has(o.id));
  if (!ours.length) return false;
  if (ours.some((o) => now - (firedAt.get(o.id)?.t ?? -9999) < 20 || now - (hurtBy.get(o.id)?.t ?? -9999) < 20)) { ambushSprung(S, now, "they opened fire"); return false; }
  for (const q of S.known.values()) {
    if (ours.some((o) => Math.hypot(q.x - o.location.x, q.z - o.location.z) < AMB.close)) { ambushSprung(S, now, "too close"); return false; }
    if (!q.heard && enemyAware(q, ours, now)) { ambushSprung(S, now, "they've seen us"); return false; }
  }
  // v9.18: a hothead in the squad, now and then, can't wait (decided once per ambush; most ambushes go as planned)
  if (S.amb.hot === undefined) { const h = ours.find((o) => traitOf(o) === "hothead"); S.amb.hot = h && Math.random() < 0.3 ? { id: h.id, at: now + 15 + Math.floor(Math.random() * 30) } : null; }
  if (S.amb.hot && now >= S.amb.hot.at) { const h = world.getEntity(S.amb.hot.id); if (h?.isValid) radio(h, `${soldierName(h)} fired too early!`, "story"); ambushSprung(S, now, "someone fired too early"); return false; }
  const guns = ours.filter((o) => GUNS.includes(sd(o).weapon));
  const ready = guns.filter((o) => gunState.get(o.id)?.target?.isValid).length;
  if (now - S.amb.t0 >= 20 && ready >= Math.max(2, Math.ceil(guns.length * 0.75))) { ambushSprung(S, now, "everyone's set"); return false; }
  note(e, "ambush: holding fire");
  return true;
}
function ambushQuiet(e) {
  try { const S = squads.get(squadKey(e, sd(e))); return !!S?.amb && tick() < S.amb.until; } catch { return false; }
}

// ---- v9.2: the mounted MG (gunboat bow gun, helicopter door gun) fired by a player: a burst per click toward the
// crosshair, precise rounds, the crew and the vehicle itself never hit
const vmgState = new Map(); // vehicle id -> { ammo, next }
function vehicleMG(v, shooter) {
  const now = tick();
  let st = vmgState.get(v.id); if (!st) { st = { ammo: 60, next: 0 }; vmgState.set(v.id, st); }
  if (now < st.next) return;
  const crew = new Set([v.id, ...(v.getComponent("minecraft:rideable")?.getRiders() ?? []).map((r) => r.id)]);
  for (let k = 0; k < 5 && st.ammo > 0; k++, st.ammo--) system.runTimeout(() => {
    try {
      const h = headLoc(shooter), dir = shooter.getViewDirection(), sp = 0.012, rr = () => (Math.random() + Math.random() - 1) * sp;
      const d2 = { x: dir.x + rr(), y: dir.y + rr(), z: dir.z + rr() };
      let from = { x: h.x + d2.x * 1.5, y: h.y - 0.1 + d2.y * 1.5, z: h.z + d2.z * 1.5 };
      for (let t = 0; t < 4; t++) { if (!v.dimension.getEntitiesFromRay(from, d2, { maxDistance: 0.6 }).some((r) => crew.has(r.entity.id))) break; from = { x: from.x + d2.x, y: from.y + d2.y, z: from.z + d2.z }; }
      hitscan(shooter, GUN_SPEC.mg, from, d2, 160, "mg");
      v.dimension.playSound("mg42_shot_mid", v.location, { volume: 2 });
    } catch {}
  }, k * 2);
  st.next = now + 12;
  if (st.ammo <= 0) { st.ammo = 60; st.next = now + 60; try { shooter.onScreenDisplay.setActionBar("§7MG reloading..."); } catch {} }
}
// ---- v9.2: the helicopter. It hovers on its own; W/S fly forward/back, the mouse turns it, looking up or down past
// 20 degrees climbs or descends (the jump key climbs too). The rotor needs ~2 s to spin up before it lifts; with
// nobody at the controls it settles to the ground. Hitting the ground or a wall hard, or being shot down, is a crash.
function heliFly(v, st, pilot, riders, loc, ground) {
  const RAD = Math.PI / 180;
  if (st.rpm === undefined) { st.rpm = 0; st.yaw = v.getRotation().y; st.speed = 0; st.vy = 0; }
  st.rpm = Math.max(0, Math.min(1, st.rpm + (pilot ? 0.025 : -0.01)));
  let wantSp = 0, wantVy = ground ? 0 : -0.12;
  if (pilot) {
    const mv = pilot.inputInfo.getMovementVector();
    st.yaw = turnToward(st.yaw, pilot.getRotation().y, 4);
    const lp = Math.asin(Math.max(-1, Math.min(1, pilot.getViewDirection().y))) / RAD;
    let climb = 0;
    try { if (String(pilot.inputInfo.getButtonState?.("Jump")) === "Pressed") climb = 1; } catch {}
    if (!climb && Math.abs(lp) > 20) climb = Math.max(-1, Math.min(1, (lp - Math.sign(lp) * 20) / 30));
    wantVy = climb * 0.32;
    wantSp = mv.y > 0 ? mv.y * 0.65 : mv.y * 0.2;
    if (st.rpm < 0.7) { wantVy = Math.min(wantVy, ground ? 0 : -0.2); wantSp *= st.rpm; }   // not enough lift yet
    if (loc.y > 300) wantVy = Math.min(wantVy, 0);
    if (st.age % 5 === 0) { try { pilot.onScreenDisplay.setActionBar(`§7Rotor ${Math.round(st.rpm * 100)}% · Speed ${Math.round(st.speed * 72)} km/h · Alt ${Math.round(loc.y)}\n${HUD["war:heli"]}`); } catch {} }
  }
  st.speed += (wantSp - st.speed) * 0.05;
  st.vy += (wantVy - st.vy) * 0.15;
  if (ground && st.vy < 0) {
    if (st.vy < -0.45 && st.age > 20) { crashPlane(v, riders); return; }       // came down hard
    st.vy = 0;
  }
  const f = fwdFromYaw(st.yaw), dir = { x: f.x, y: 0, z: f.z };
  if (st.age > 20 && Math.abs(st.speed) > 0.45 && blockedAhead(v, { x: dir.x * Math.sign(st.speed), y: 0, z: dir.z * Math.sign(st.speed) }, 3, [0.5, 1.5, 2.5])) { crashPlane(v, riders); return; }
  v.setRotation({ x: 0, y: st.yaw });
  v.clearVelocity(); v.applyImpulse({ x: dir.x * st.speed, y: st.vy, z: dir.z * st.speed });
}
// ================================================================ v9.1: riding (vanilla mounts and boats)
// Soldiers ride saddled horses, donkeys, mules, camels, pigs (and skeleton / zombie horses) and boats, never this
// add-on's own vehicles (they have their own crews and menus). An animal only takes a rider of the kinds it allows,
// so for the moment of getting on the soldier counts as a player (a family group added and taken away again); once
// he's on, he stays on. The script rides it for him: toward his leader (Follow / Escort), his spot (Hold / Post), or
// his goal, a straight ride that jumps one-block steps; he fights from the saddle.
// When you ride something, your followers mount whatever's free near them, and get off when you do. Army orders:
// "Mount up" / "Dismount".
const MOUNT_SPEED = { "minecraft:horse": 0.34, "minecraft:donkey": 0.26, "minecraft:mule": 0.26, "minecraft:camel": 0.22, "minecraft:pig": 0.12, "minecraft:skeleton_horse": 0.32, "minecraft:zombie_horse": 0.26, "minecraft:boat": 0.4, "minecraft:chest_boat": 0.4, "minecraft:strider": 0.16 };
const isBoatType = (t) => t === "minecraft:boat" || t === "minecraft:chest_boat";
// v9.3: other add-ons' animals a soldier can ride (World Animals: elephants, big cats, rhinos, giraffes, ostriches...)
// carry the type family "war_mount"; saddled, they're mounts like a horse, at their own walking speed
const ANIMAL_MOUNT = "war_mount";
const isAnimalMount = (m) => { try { return !(m.typeId in MOUNT_SPEED) && !!m.getComponent("minecraft:type_family")?.hasTypeFamily(ANIMAL_MOUNT); } catch { return false; } };
// v9.4: and anything else from any add-on that has a seat and wears a saddle (a soldier only gets on once it's saddled)
const isOtherMount = (m) => { try { const t = m.typeId; return !(t in MOUNT_SPEED) && !t.startsWith("war:") && t !== "minecraft:player" && !!m.hasComponent("minecraft:is_saddled") && !!m.getComponent("minecraft:rideable"); } catch { return false; } };
const isMount = (m) => !!m && (m.typeId in MOUNT_SPEED || isAnimalMount(m) || isOtherMount(m));
function mountSpeed(m) {
  if (m.typeId in MOUNT_SPEED) return MOUNT_SPEED[m.typeId];
  let v = 0.25;
  try { v = m.getComponent("minecraft:movement")?.defaultValue ?? v; } catch {}
  return Math.max(0.15, Math.min(0.36, v));
}
const mountOf = new Map();   // soldier id -> { id (mount), auto (got on because his leader did) }
const MOUNT_HEAD = new Map(); // mount id -> the heading the script is steering it on (v9.17)
system.runInterval(() => { for (const id of [...MOUNT_HEAD.keys()]) if (!world.getEntity(id)) MOUNT_HEAD.delete(id); }, 1200);
const rideTo = new Map();    // soldier id -> where his last order sends him (riding: straight there)
function mountReady(m) {
  try {
    if (!m?.isValid || !(isMount(m) || VEHICLES.includes(m.typeId))) return false;
    const rd = m.getComponent("minecraft:rideable"); if (!rd) return false;
    if (rd.getRiders().length >= rd.seatCount) return false;
    if (isBoatType(m.typeId) || VEHICLES.includes(m.typeId)) return true;   // (v9.2: the add-on's vehicles: on "Mount up", as passengers)
    return !!m.hasComponent?.("minecraft:is_saddled");                     // (saddled ones only)
  } catch { return false; }
}
function mountSoldier(e, m, auto) {
  try {
    e.triggerEvent("war:mount_on");
    system.runTimeout(() => {
      try {
        if (!e.isValid || !m.isValid) return;
        const rd = m.getComponent("minecraft:rideable");
        if (rd?.addRider(e) || e.getComponent("minecraft:riding")?.entityRidingOn?.id === m.id) { mountOf.set(e.id, { id: m.id, auto }); note(e, "mounted"); }
      } catch {}
      system.runTimeout(() => { try { if (e.isValid) e.triggerEvent("war:mount_off"); } catch {} }, 2);
    }, 2);
  } catch {}
}
function mountUp(list, auto) {
  const taken = new Set();
  const walkers = world.getAllPlayers().filter((p) => { try { return !p.getComponent("minecraft:riding")?.entityRidingOn; } catch { return false; } });
  const playerAt = (m) => walkers.some((p) => p.dimension.id === m.dimension.id && dist(p.location, m.location) < 2.5);   // (v9.2: a mount a player is stepping up to is his)
  let n = 0;
  for (const e of list) {
    if (mountOf.has(e.id) || isRiding(e) || downed.has(e.id) || sd(e).surr) continue;
    let best, bd = 1e9;
    const near = [];
    for (const t of [...Object.keys(MOUNT_SPEED), ...(auto ? [] : VEHICLES)]) near.push(...e.dimension.getEntities({ type: t, location: e.location, maxDistance: 16 }));
    try { near.push(...e.dimension.getEntities({ families: [ANIMAL_MOUNT], location: e.location, maxDistance: 16 })); } catch {}
    try { for (const m of e.dimension.getEntities({ location: e.location, maxDistance: 16, excludeTypes: [SOLDIER, HOUND, "minecraft:player", "minecraft:item", "minecraft:xp_orb", ...Object.keys(MOUNT_SPEED), ...VEHICLES] })) if (!near.some((q) => q.id === m.id) && isOtherMount(m)) near.push(m); } catch {}   // (v9.4: any saddled mount)
    for (const m of near) {
      if (!mountReady(m) || playerAt(m)) continue;
      const left = (m.getComponent("minecraft:rideable")?.seatCount ?? 1) - (m.getComponent("minecraft:rideable")?.getRiders().length ?? 0) - (taken.has(m.id) ? 1 : 0);
      if (left <= 0) continue;
      const dd = dist(m.location, e.location); if (dd < bd) { bd = dd; best = m; }
    }
    if (!best) continue;
    taken.add(best.id);
    try { e.teleport({ x: best.location.x, y: best.location.y + 0.4, z: best.location.z }); } catch {}
    mountSoldier(e, best, auto); n++;
  }
  return n;
}
function dismountAll(list) {
  let n = 0;
  for (const e of list) {
    const M = mountOf.get(e.id); if (!M) continue;
    try { world.getEntity(M.id)?.getComponent("minecraft:rideable")?.ejectRider(e); } catch {}
    mountOf.delete(e.id); rideTo.delete(e.id); n++;
  }
  return n;
}
// where a mounted soldier wants to go (and how close is close enough)
function rideDest(e, d) {
  if ((d.func === "follow" || d.func === "escort") && d.leader) { const p = findPlayer(d.leader); if (p && p.dimension.id === e.dimension.id) return { at: p.location, stop: 4 }; }
  const rt = rideTo.get(e.id);
  if (rt) return { at: rt, stop: 4 };
  const an = ["hold", "post", "sentry", "stand"].includes(d.func) ? marker(d.goal) : undefined;
  if (an) return { at: an.location, stop: 3 };
  const g = marker(Number(gdp(e, "war:catchup") ?? 0)) ?? marker(d.goal);
  return g ? { at: g.location, stop: 3 } : undefined;
}
system.runInterval(() => {
  for (const [id, M] of [...mountOf]) {
    try {
      const e = world.getEntity(id), m = world.getEntity(M.id);
      if (!e?.isValid || !m?.isValid || downed.has(id) || e.getComponent("minecraft:riding")?.entityRidingOn?.id !== M.id) { mountOf.delete(id); continue; }
      const rd = m.getComponent("minecraft:rideable")?.getRiders() ?? [];
      if (rd[0]?.id !== id || VEHICLES.includes(m.typeId)) continue;           // (a passenger: whoever's in front steers; the add-on's vehicles drive themselves)
      const d = sd(e), cd = d.div === "cavalier" ? cavDest(e, d) : undefined;
      let want = cd ?? rideDest(e, d);
      if (!cd && want && d.div === "cavalier" && rideTo.has(id)) want = cavLine(e, d, want);
      if (want && !want.strike && !isBoatType(m.typeId)) want = rideRoute(e, m, want);          // (v9.14: round walls, along a planned route)
      if (want?.strike) cavStrike(e, d, m, want);
      const l = m.location, vel = m.getVelocity();
      let tx = 0, tz = 0;
      if (want) {
        const dx = want.at.x - l.x, dz = want.at.z - l.z, L = Math.hypot(dx, dz);
        if (L > want.stop) {
          let sp = mountSpeed(m);
          if (isBoatType(m.typeId)) { let wet = false; try { wet = !!m.dimension.getBlock({ x: l.x, y: l.y - 0.2, z: l.z })?.isLiquid || !!m.dimension.getBlock(l)?.isLiquid; } catch {} if (!wet) sp = 0.04; }
          sp *= want.pace ?? 1;
          if (d.div === "cavalier") { const v0 = Math.hypot(vel.x, vel.z); CAV_STUCK.set(id, L > want.stop + 3 && v0 < 0.04 ? (CAV_STUCK.get(id) ?? 0) + 1 : 0); }   // (v9.14: going nowhere)
          if (want.fast) sp *= 1.15; else if (want.slow) sp *= 0.75; else if (gunState.get(id)?.target?.isValid) sp *= 0.5;   // (firing from the saddle: easy; a charge: flat out)
          if (!want.route) sp *= Math.min(1, (L - want.stop) / 4 + 0.3);                              // (on a route: full pace from point to point)
          // v9.17: a mount goes where its head points. It turns toward the way it wants to go at an animal's pace
          // (tighter when slow, slower in a sharp turn) and is carried only along its own heading, never sideways
          const wantYaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
          const cur = MOUNT_HEAD.get(m.id) ?? m.getRotation().y;
          const off = Math.abs(((wantYaw - cur + 540) % 360) - 180);
          const hd = turnToward(cur, wantYaw, Math.hypot(vel.x, vel.z) < 0.12 ? 20 : 13);
          MOUNT_HEAD.set(m.id, hd);
          sp *= off > 100 ? 0.3 : off > 50 ? 0.6 : 1;
          const hr = hd * Math.PI / 180;
          tx = -Math.sin(hr) * sp; tz = Math.cos(hr) * sp;
          try { m.setRotation({ x: 0, y: hd }); } catch {}                     // (the rider's look: the driver below)
          // a one-block step ahead: jump it (horses and the like)
          if (!isBoatType(m.typeId) && solidAt(m.dimension, { x: l.x, y: l.y - 0.2, z: l.z })) {
            const ahead = { x: l.x + (dx / L) * 1.2, y: l.y + 0.5, z: l.z + (dz / L) * 1.2 };
            if (solidAt(m.dimension, ahead) && !solidAt(m.dimension, { x: ahead.x, y: l.y + 1.5, z: ahead.z })) m.applyImpulse({ x: 0, y: 0.5, z: 0 });
          }
        }
      }
      m.applyImpulse({ x: (tx - vel.x) * 0.8, y: 0, z: (tz - vel.z) * 0.8 });
      if (!tx && !tz) { const h0 = MOUNT_HEAD.get(m.id); if (h0 !== undefined) try { m.setRotation({ x: 0, y: h0 }); } catch {} }   // (stopping: it stays facing the way it came, not the rider's aim)
      RIDE_DRV.set(id, { m, e, tx, tz, t: tick() });
    } catch { mountOf.delete(id); }
  }
}, 2);
// v9.20.3: between the steering's thoughts (every other tick) the mount is held at its pace (left to itself on the off
// tick the game's friction slowed it: a gallop that pulsed fast-slow-fast), and the rider looks one way on every tick:
// at the man he's fighting when that's within ~100 degrees of his horse's line, else ahead. Before, the steering set him
// level and square every other tick and the game's own look-at tipped him at his target on the ticks between: a head
// that snapped back and forth ten times a second.
const RIDE_DRV = new Map();   // rider id -> { m, e, tx, tz, t }
// v9.20.3: the same for a soldier in a vehicle's seat (truck, boat, gunboat, helicopter, plane, tank): one look per tick,
// at the man he's shooting at, else the way the vehicle faces. The game's own look-at tipped him 20-30 degrees down and
// off his aim on the ticks between the gun's turns: a head that nodded and twitched the whole ride.
const VEH_LOOK = new Map();   // soldier id -> { e, m, look }
system.runInterval(() => {
  if (!VEH_LOOK.size) return;
  for (const [id, R] of VEH_LOOK) {
    try {
      const e = R.e, m = R.m;
      if (!e.isValid || !m.isValid || downed.has(id) || e.getComponent("minecraft:riding")?.entityRidingOn?.id !== m.id) { VEH_LOOK.delete(id); continue; }
      const el = e.location, base = m.getRotation().y;
      const t = gunState.get(id)?.target?.isValid ? gunState.get(id).target : perc.get(id)?.threat?.isValid ? perc.get(id).threat : undefined;
      let wantY = base, pitchTo;
      if (t && dist(t.location, el) < 90) { wantY = (Math.atan2(-(t.location.x - el.x), t.location.z - el.z) * 180) / Math.PI; pitchTo = { x: t.location.x, y: t.location.y + 1, z: t.location.z }; }
      const r = faceRot(e, el, { x: el.x - Math.sin(wantY * Math.PI / 180) * 6, z: el.z + Math.cos(wantY * Math.PI / 180) * 6 }, 14, pitchTo, R.look ?? e.getRotation().y);
      R.look = r.y;
      e.setRotation({ x: Math.max(-20, Math.min(20, r.x)), y: r.y });
    } catch { VEH_LOOK.delete(id); }
  }
}, 1);
system.runInterval(() => {
  if (!RIDE_DRV.size) return;
  const now = tick();
  for (const [id, R] of RIDE_DRV) {
    try {
      if (now - R.t > 4 || !R.m.isValid || !R.e.isValid || !mountOf.has(id)) { RIDE_DRV.delete(id); continue; }
      const m = R.m, e = R.e, hd = MOUNT_HEAD.get(m.id) ?? m.getRotation().y;
      if (now !== R.t && (R.tx || R.tz)) { const vel = m.getVelocity(); m.applyImpulse({ x: (R.tx - vel.x) * 0.8, y: 0, z: (R.tz - vel.z) * 0.8 }); try { m.setRotation({ x: 0, y: hd }); } catch {} }
      const t = gunState.get(id)?.target?.isValid ? gunState.get(id).target : perc.get(id)?.threat?.isValid ? perc.get(id).threat : undefined;
      const el = e.location, cur = R.look ?? e.getRotation().y;
      let wantY = hd, pitchTo;
      if (t && dist(t.location, el) < 40) {
        const ty = (Math.atan2(-(t.location.x - el.x), t.location.z - el.z) * 180) / Math.PI, off = ((ty - hd + 540) % 360) - 180;
        if (Math.abs(off) <= (R.onT === t.id ? 120 : 100)) { wantY = ty; pitchTo = { x: t.location.x, y: t.location.y + 1, z: t.location.z }; R.onT = t.id; } else R.onT = undefined;   // (in at 100, out past 120: no flicking at the edge)
      } else R.onT = undefined;
      const r = faceRot(e, el, { x: el.x - Math.sin(wantY * Math.PI / 180) * 6, z: el.z + Math.cos(wantY * Math.PI / 180) * 6 }, 14, pitchTo, cur);
      R.look = r.y;
      e.setRotation({ x: Math.max(-15, Math.min(15, r.x)), y: r.y });
    } catch { RIDE_DRV.delete(id); }
  }
}, 1);
// ================================================================ v9.13: cavalry on real mounts
// A Cavalier is an ordinary soldier on a real, tamed, saddled mount: a horse by default, or whatever saddleable mob was
// picked (vanilla, or World Animals if it's installed). Gunmen (carbine, semi-auto, SMG, shotgun, pistol, crossbow)
// keep 10 to 20 blocks off their target and circle it, shooting from the saddle; sabres and lances charge, strike as
// they pass, ride on and wheel round for another pass. A rider whose mount is killed fights on foot, and gets on any
// free saddled mount nearby. When he dies the mount stays (riderless).
const CAV_MOUNTS = [
  ["minecraft:horse", "Horse", "minecraft:spawn_tame_adult", ["minecraft:horse_saddled"]],
  ["minecraft:donkey", "Donkey", "minecraft:spawn_tame_adult", ["minecraft:donkey_saddled"]],
  ["minecraft:mule", "Mule", "minecraft:spawn_tame_adult", ["minecraft:mule_saddled"]],
  ["minecraft:camel", "Camel", "minecraft:spawn_adult", ["minecraft:camel_saddled"]],
  ["minecraft:skeleton_horse", "Skeleton horse", undefined, []],
  ["minecraft:zombie_horse", "Zombie horse", "minecraft:spawn_tame_adult", ["minecraft:horse_saddled"]],
  ["minecraft:pig", "Pig", "minecraft:spawn_adult", ["minecraft:on_saddled"]],
  ["minecraft:strider", "Strider (lava)", "spawn_adult", ["minecraft:on_saddled"]],
  ...[["african_elephant", "African elephant"], ["asian_elephant", "Asian elephant"], ["mammoth", "Mammoth"], ["rhinoceros", "Rhinoceros"], ["giraffe", "Giraffe"], ["ostrich", "Ostrich"],
    ["lion", "Lion"], ["white_lion", "White lion"], ["tiger", "Tiger"], ["white_tiger", "White tiger"], ["leopard", "Leopard"], ["snow_leopard", "Snow leopard"], ["panther", "Panther"], ["cougar", "Cougar"]]
    .map(([k, n]) => [`worldanimals:${k}`, `${n} (World Animals)`, undefined, ["minecraft:on_tame", "minecraft:on_saddle", "minecraft:on_chest"]]),
];
const CAV_WEAPONS = [["sword", "Sabre"], ["spear", "Lance"], ["rifle", "Carbine rifle"], ["semi", "Semi-auto"], ["smg", "SMG"], ["shotgun", "Shotgun"], ["pistol", "Pistol"], ["crossbow", "Crossbow"]];
const cavMountOf = (e) => CAV_MOUNTS.find((m) => m[0] === String(gdp(e, "war:mount") ?? "")) ?? CAV_MOUNTS[0];
const CAV_TGT = new Map();    // rider id -> { id, t } the man he's riding at
const CAV_PASS = new Map();   // rider id -> { at, until } where he rides on to after a strike
const CAV_HIT = new Map();    // rider id -> tick of his last strike
// v9.14: tamed and saddled the way every game version takes (the spawn events differ between versions: a wild horse
// throws its rider off): the taming component, and a saddle in its own saddle slot
function readyMount(m, saddleEvents) {
  // (tamed FIRST: on a wild horse that's already saddled the taming no longer takes, and a wild horse throws its rider)
  if (!m.hasComponent("minecraft:is_tamed")) {
    try { const tm = m.getComponent("minecraft:tamemount"); if (tm) tm.tame(false); } catch {}
    if (!m.hasComponent("minecraft:is_tamed")) try { m.triggerEvent("minecraft:on_tame"); } catch {}
  }
  for (const s2 of saddleEvents ?? []) { try { m.triggerEvent(s2); } catch {} }
  try { if (!m.hasComponent("minecraft:is_saddled")) { const inv = m.getComponent("minecraft:inventory")?.container; if (inv && inv.size >= 1 && !inv.getItem(0)) inv.setItem(0, new ItemStack("minecraft:saddle", 1)); } } catch {}
}
function spawnCavMount(e) {
  const [type, , ev, saddle] = cavMountOf(e), l = e.location, dim = e.dimension;
  let m;
  for (let k = 0; k < 3 && !m; k++) {
    for (const sev of [ev, "minecraft:spawn_adult", undefined]) {                              // (an event this game version lacks: the next one)
      if (m) break;
      try { m = dim.spawnEntity(type, l, sev ? { spawnEvent: sev, initialPersistence: true } : { initialPersistence: true }); } catch { try { if (!sev) m = dim.spawnEntity(type, l); } catch {} }
    }
    if (!m && type !== "minecraft:horse") { sdp(e, "war:mount", "minecraft:horse"); return spawnCavMount(e); }   // (World Animals not installed: a horse)
    try { if (m?.hasComponent("minecraft:is_baby")) { m.remove(); m = undefined; } } catch {}            // (a grown one, not a foal)
  }
  if (!m) return undefined;
  try { if (!m.hasComponent("minecraft:rideable")) m.triggerEvent("minecraft:spawn_adult"); } catch {}   // (spawned through an event this game version lacks: no make-up at all)
  readyMount(m, saddle);
  try { m.addTag("war_cav"); m.setDynamicProperty("war:cavf", Number(sd(e).faction ?? 0)); } catch {}
  return m;
}
// a saddled war horse of his side with nobody on it and no living owner nearby on foot going for it
function freeCavHorse(e) {
  const f = Number(sd(e).faction ?? 0); let best, bd = 48;
  try {
    for (const h of e.dimension.getEntities({ tags: ["war_cav"], location: e.location, maxDistance: 48 })) {
      if (Number(h.getDynamicProperty("war:cavf") ?? -1) !== f || !mountReady(h) || CAV_CLAIM.get(h.id)?.by !== undefined && CAV_CLAIM.get(h.id).by !== e.id && tick() - CAV_CLAIM.get(h.id).t < 200) continue;
      const dd = dist(h.location, e.location); if (dd < bd) { bd = dd; best = h; }
    }
  } catch {}
  if (best) CAV_CLAIM.set(best.id, { by: e.id, t: tick() });
  return best;
}
const CAV_CLAIM = new Map();   // horse id -> { by, t }: the man walking to it
// v9.15: horses with nobody to ride them (their rider dead or gone) don't pile up: after 5 minutes riderless, gone
const CAV_LONE = new Map();    // horse id -> tick first seen riderless and ownerless
system.runInterval(() => {
  const now = tick(), owners = new Set();
  for (const e of allOf(SOLDIER)) { const mid = gdp(e, "war:mountId"); if (mid !== undefined) owners.add(String(mid)); }
  const seen = new Set();
  for (const dim of ["overworld", "nether", "the_end"]) {
    let hs = []; try { hs = world.getDimension(dim).getEntities({ tags: ["war_cav"] }); } catch {}
    for (const h of hs) {
      try {
        seen.add(h.id);
        if (owners.has(h.id) || (h.getComponent("minecraft:rideable")?.getRiders().length ?? 0) > 0) { CAV_LONE.delete(h.id); continue; }
        if (!CAV_LONE.has(h.id)) CAV_LONE.set(h.id, now);
        else if (now - CAV_LONE.get(h.id) > 6000 && !PLAYERS_LIST.some((p) => p.dimension.id === h.dimension.id && dist(p.location, h.location) < 6)) { CAV_LONE.delete(h.id); h.remove(); }
      } catch {}
    }
  }
  for (const id of [...CAV_LONE.keys()]) if (!seen.has(id)) CAV_LONE.delete(id);
  for (const [id, c] of [...CAV_CLAIM]) if (now - c.t > 400) CAV_CLAIM.delete(id);
}, 600);
// v9.15: stale marker holds are let go on their own every 5 minutes (no "Markers were full" after a long session)
system.runInterval(() => { try { freeSlots(); } catch {} }, 6000);
function cavTick(e, d, now) {
  try {
    if (P(e, "war:cav")) {                                                                    // (a cavalier from before: his old horse body goes)
      setP(e, "war:cav", false); e.triggerEvent("war:body_foot"); equip(e, weaponItem(e));
    }
    if (downed.has(e.id) || d.surr || pows.has(e.id)) return;
    if (!cmMountOK(cavMountOf(e)[0])) {                                                       // (v9.14: not at this content level: a horse instead)
      const om = world.getEntity(String(gdp(e, "war:mountId") ?? ""));
      try { om?.getComponent("minecraft:rideable")?.ejectRider(e); if (om?.hasTag("war_cav")) om.remove(); } catch {}
      mountOf.delete(e.id); sdp(e, "war:mountId", undefined); sdp(e, "war:mountTry", undefined); sdp(e, "war:mount", "minecraft:horse");
    }
    const on = e.getComponent("minecraft:riding")?.entityRidingOn;
    const T0 = CAV_TGT.get(e.id), tgt = T0 && now - T0.t < 60 ? world.getEntity(T0.id) : undefined;
    if (on && tgt?.isValid && !VEHICLES.includes(on.typeId) && ((roofOver(tgt) && dist(tgt.location, e.location) < 24) || (CAV_STUCK.get(e.id) ?? 0) > 30)) {   // (v9.14: indoors, or the horse can't get on: on foot)
      try { on.getComponent("minecraft:rideable")?.ejectRider(e); } catch {}
      mountOf.delete(e.id); CAV_STUCK.delete(e.id); sdp(e, "war:afoot", now); note(e, "dismounted to go in"); return;
    }
    const afoot = gdp(e, "war:afoot");
    if (!on && afoot !== undefined && (tgt?.isValid || now - Number(afoot) < 200)) { /* (fighting on foot: back in the saddle when it's over) */ }
    else if (on) { if (afoot !== undefined) sdp(e, "war:afoot", undefined); if (!mountOf.has(e.id)) mountOf.set(e.id, { id: on.id, auto: false }); }
    else if (now - Number(gdp(e, "war:mountTry") ?? -999) > 60) {
      if (afoot !== undefined) sdp(e, "war:afoot", undefined);
      sdp(e, "war:mountTry", now);
      const mid = gdp(e, "war:mountId"), m = mid ? world.getEntity(String(mid)) : undefined;
      // v9.15: unhorsed, he walks back to his own horse (or a free one of his side's), never pops onto it from afar
      const own = m?.isValid && m.dimension.id === e.dimension.id && dist(m.location, e.location) < 64 && mountReady(m) ? m : undefined;
      const tgtM = own ?? (mid ? freeCavHorse(e) : undefined);
      if (tgtM && dist(tgtM.location, e.location) < 3) { readyMount(tgtM); if (tgtM !== own) sdp(e, "war:mountId", tgtM.id); mountSoldier(e, tgtM, false); note(e, own ? "back in the saddle" : "took a riderless horse"); }
      else if (tgtM) { try { tgtM.clearVelocity?.(); } catch {} planPersonalTo(e, "settle", { ...tgtM.location }, now); sdp(e, "war:mountTry", now - 45); note(e, own ? "going back for his horse" : "going for a riderless horse"); }
      else if (!mid) { const nm = spawnCavMount(e); if (nm) { sdp(e, "war:mountId", nm.id); mountSoldier(e, nm, false); } }
      else if (mountUp([e], false)) note(e, "took a free mount");                             // (his own was killed: any free saddled one near)
    }
    // whom he rides at: the man his gun has, else the nearest enemy he can see within 32
    const g = gunState.get(e.id)?.target;
    if (g?.isValid) { CAV_TGT.set(e.id, { id: g.id, t: now }); return; }
    let best, bd = 32;
    for (const c of nearSnap(e.dimension.id, e.location, 32)) {
      if (c.id === e.id || c.down || (c.type !== SOLDIER && c.type !== "minecraft:player")) continue;
      if (!isHostile(d.faction, c.f)) continue;
      const o = world.getEntity(c.id); if (!o?.isValid || !isTargetFor(e, d, o)) continue;
      const dd = dist(o.location, e.location); if (dd < bd && clearShot(e.dimension, e.getHeadLocation(), chest(o))) { bd = dd; best = o; }
    }
    if (best) CAV_TGT.set(e.id, { id: best.id, t: now }); else CAV_TGT.delete(e.id);
  } catch {}
}
// where a rider goes in a fight (undefined: no fight, follow his orders)
function cavDest(e, d) {
  const T = CAV_TGT.get(e.id), now = tick();
  if (!T || now - T.t > 60) return undefined;
  const t = world.getEntity(T.id); if (!t?.isValid) { CAV_TGT.delete(e.id); return undefined; }
  const l = e.location, tl = t.location, dx = l.x - tl.x, dz = l.z - tl.z, L = Math.hypot(dx, dz) || 1;
  if (isRangedW(d.weapon)) {                                                                     // (keep off, circle, shoot)
    if (L < 9) return { at: { x: tl.x + (dx / L) * 15, y: l.y, z: tl.z + (dz / L) * 15 }, stop: 1, fast: true };
    if (L > 22) return { at: tl, stop: 16 };
    const side = e.id.charCodeAt(e.id.length - 1) % 2 ? 1 : -1, px = (-dz / L) * side, pz = (dx / L) * side;
    return { at: { x: tl.x + (dx / L) * 14 + px * 8, y: l.y, z: tl.z + (dz / L) * 14 + pz * 8 }, stop: 1.5, slow: true };
  }
  const P2 = CAV_PASS.get(e.id);                                                                 // (charge, strike, ride through, wheel round)
  if (P2 && now < P2.until && Math.hypot(l.x - P2.at.x, l.z - P2.at.z) > 2) return { at: P2.at, stop: 1.5, fast: true };
  CAV_PASS.delete(e.id);
  return { at: tl, stop: 0.3, fast: true, strike: t };
}
// v9.14: riders on the same order ride in a line abreast (2.6 blocks apart, nobody crossing), keeping pace with the line
const CAV_LINE = new Map(), CAV_STUCK = new Map();
function cavLine(e, d, want) {
  try {
    const now = tick(), key = `${d.faction}|${d.squad}|${Math.round(want.at.x / 6)}|${Math.round(want.at.z / 6)}`;
    let g = CAV_LINE.get(key);
    if (!g || now - g.t > 20) {
      const mem = [];
      for (const id of mountOf.keys()) {
        const o = world.getEntity(id); if (!o?.isValid) continue;
        const od = sd(o); if (od.div !== "cavalier" || od.faction !== d.faction || od.squad !== d.squad || CAV_TGT.has(id)) continue;
        const rt = rideTo.get(id); if (!rt || Math.hypot(rt.x - want.at.x, rt.z - want.at.z) > 8) continue;
        mem.push(o);
      }
      if (mem.length < 2) { CAV_LINE.set(key, { t: now, ids: [] }); return want; }
      const c = mem.reduce((a, o) => ({ x: a.x + o.location.x / mem.length, z: a.z + o.location.z / mem.length }), { x: 0, z: 0 });
      const dx = want.at.x - c.x, dz = want.at.z - c.z, L = Math.hypot(dx, dz) || 1, dir = { x: dx / L, z: dz / L }, perp = { x: -dir.z, z: dir.x };
      const lat = (o) => (o.location.x - c.x) * perp.x + (o.location.z - c.z) * perp.z, alo = (o) => (o.location.x - c.x) * dir.x + (o.location.z - c.z) * dir.z;
      g = { t: now, ids: mem.sort((a, b) => lat(a) - lat(b)).map((o) => o.id), dir, perp, avg: mem.reduce((a, o) => a + alo(o), 0) / mem.length, c };
      CAV_LINE.set(key, g); if (CAV_LINE.size > 200) CAV_LINE.clear();
    }
    const i = g.ids.indexOf(e.id); if (i < 0 || g.ids.length < 2) return want;
    const side = (i - (g.ids.length - 1) / 2) * 2.6, ahead = (e.location.x - g.c.x) * g.dir.x + (e.location.z - g.c.z) * g.dir.z - g.avg;
    return { ...want, at: { x: want.at.x + g.perp.x * side, y: want.at.y, z: want.at.z + g.perp.z * side }, pace: ahead > 1.5 ? 0.6 : ahead < -1.5 ? 1.15 : 1 };
  } catch { return want; }
}
const roofOver = (o) => { for (let k = 2; k <= 5; k++) if (solidAt(o.dimension, { x: o.location.x, y: o.location.y + k, z: o.location.z })) return true; return false; };
function cavStrike(e, d, m, want) {
  const t = want?.strike; if (!t?.isValid) return;
  const now = tick(); if (now - (CAV_HIT.get(e.id) ?? -99) < 16) return;
  if (dist(chest(t), { x: e.location.x, y: e.location.y + 0.6, z: e.location.z }) > 3.2) return;
  CAV_HIT.set(e.id, now);
  let sp = 0; try { const v = m.getVelocity(); sp = Math.hypot(v.x, v.z); } catch {}
  const dmg = (d.weapon === "spear" ? 8 : 6) + Math.round(sp * 12);                            // (the lance hits hardest, and the faster the harder)
  preHp(t);
  try { t.applyDamage(dmg, { cause: "entityAttack", damagingEntity: e }); } catch {}
  try { t.applyKnockback({ x: (t.location.x - e.location.x) * 0.6, z: (t.location.z - e.location.z) * 0.6 }, 0.25); } catch {}
  const dx = t.location.x - e.location.x, dz = t.location.z - e.location.z, L = Math.hypot(dx, dz) || 1;
  CAV_PASS.set(e.id, { at: { x: t.location.x + (dx / L) * 10, y: t.location.y, z: t.location.z + (dz / L) * 10 }, until: now + 80 });
}
// v9.14: a mounted man rode straight at where he was going and stuck on the first wall; now, when the way isn't plainly
// clear or it's a long way, the route planner works out the way (as it does on foot) and the mount follows it point by
// point, replanning when stuck or when the goal moves. No markers are made for it.
const RIDE_RT = new Map();   // rider id -> { dest, pts, idx, t, job, planning }
function rideRoute(e, m, want) {
  try {
    const now = tick(), l = m.location, id = e.id, far = Math.hypot(want.at.x - l.x, want.at.z - l.z);
    if (far <= want.stop + 1) { RIDE_RT.delete(id); return want; }
    let R = RIDE_RT.get(id);
    const stuck = (CAV_STUCK.get(id) ?? 0) > 12 || (R?.stuckN ?? 0) > 12;
    if (R && (Math.hypot(R.dest.x - want.at.x, R.dest.z - want.at.z) > 6 || now - R.t > 600 || (stuck && now - R.t > 40))) { if (R.job) R.job.cancel = true; RIDE_RT.delete(id); R = undefined; }
    if (!R) {
      const head = { x: l.x, y: l.y + 1.5, z: l.z }, tgt = { x: want.at.x, y: (want.at.y ?? l.y) + 1.5, z: want.at.z };
      if (far < 24 && !stuck && clearShot(m.dimension, head, tgt)) return want;                   // (plainly clear: straight there)
      R = { dest: { ...want.at }, pts: undefined, idx: 0, t: now, planning: true, stuckN: 0 };
      RIDE_RT.set(id, R); if (RIDE_RT.size > 400) RIDE_RT.clear();
      R.job = planRoute(m.dimension, { x: l.x, y: l.y, z: l.z }, { x: want.at.x, y: want.at.y ?? l.y, z: want.at.z }, (pts) => {
          R.planning = false; R.idx = 0;
          // (a horse is wider than a man: each point is moved off the walls next to it, so he doesn't catch the corners)
          R.pts = pts?.map((q) => { let ox = 0, oz = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (solidAt(m.dimension, { x: q.x + dx, y: q.y + 1.2, z: q.z + dz })) { ox -= dx; oz -= dz; } const L = Math.hypot(ox, oz); return L ? { x: q.x + (ox / L) * 0.9, y: q.y, z: q.z + (oz / L) * 0.9 } : q; });
        },
        { max: Math.min(20000, Math.max(3000, Math.round(far * 300))), maxRadius: Math.min(90, far + 30) });
    }
    if (!R.pts?.length) return want;                                                                // (still working it out: straight on meanwhile)
    { let bj = R.idx, bd = Infinity; for (let j = R.idx; j < Math.min(R.pts.length, R.idx + (R.idx === 0 ? R.pts.length : 12)); j++) { const q2 = R.pts[j], dd = Math.hypot(q2.x - l.x, q2.z - l.z) + Math.abs(q2.y - l.y) * 2; if (dd < bd) { bd = dd; bj = j; } } R.idx = bj; }   // (he rode on while it was worked out: from the point he's nearest)
    while (R.idx < R.pts.length - 1 && Math.hypot(R.pts[R.idx].x - l.x, R.pts[R.idx].z - l.z) < 1.8) R.idx++;
    // (look ahead: the furthest of the next few points he can ride straight to)
    let k = R.idx;
    const wide = (q) => { const dx = q.x - l.x, dz = q.z - l.z, L = Math.hypot(dx, dz) || 1, px = (-dz / L) * 0.7, pz = (dx / L) * 0.7;   // (as wide as the horse)
      return [0, 1, -1].every((sg) => clearShot(m.dimension, { x: l.x + px * sg, y: l.y + 1.2, z: l.z + pz * sg }, { x: q.x + px * sg, y: q.y + 1.2, z: q.z + pz * sg })); };
    for (let j = R.idx + 1; j < Math.min(R.pts.length, R.idx + 6); j++) { const q = R.pts[j]; if (Math.abs(q.y - l.y) > 1.2 || !wide(q)) break; k = j; }
    const q = R.pts[k];
    { const dq = Math.hypot(q.x - l.x, q.z - l.z);                                                    // (stuck = no real gain on the point he's riding for in a second)
      if (R.pk !== k || dq < (R.best ?? 1e9) - 0.3) { R.pk = k; R.best = dq; R.bestT = now; R.stuckN = 0; } else if (now - R.bestT > 20) R.stuckN = 9; }
    if (R.idx >= R.pts.length - 1 && Math.hypot(q.x - l.x, q.z - l.z) < 1.8) return want;
    if (R.detour && now < R.detour.until && Math.hypot(R.detour.at.x - l.x, R.detour.at.z - l.z) > 0.5) return { ...want, at: R.detour.at, stop: 0.3, route: true };
    if (R.stuckN > 8) {                                                                             // (wedged on a corner: back off it a little, then on)
      let ox = 0, oz = 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (solidAt(m.dimension, { x: l.x + dx * 0.9, y: l.y + 1.2, z: l.z + dz * 0.9 })) { ox -= dx; oz -= dz; }
      const L = Math.hypot(ox, oz), tx = q.x - l.x, tz = q.z - l.z, TL = Math.hypot(tx, tz) || 1;
      const side = (R.flip = !R.flip) ? 1 : -1, ax = L ? ox / L : (-tz / TL) * side, az = L ? oz / L : (tx / TL) * side;   // (nothing touching: a step to one side, then the other)
      R.detour = { at: { x: l.x + ax * 1.3 + (tx / TL) * 0.4, y: l.y, z: l.z + az * 1.3 + (tz / TL) * 0.4 }, until: now + 20 }; R.stuckN = 0; R.bestT = now + 20; R.best = 1e9; return { ...want, at: R.detour.at, stop: 0.3, route: true };
    }
    return { ...want, at: { x: q.x, y: q.y, z: q.z }, stop: 0.3, pace: want.pace, route: true };
  } catch { return want; }
}
// your followers ride when you do, and get off when you do
const leaderRode = new Map(); // player id -> was riding (non-add-on mount) last check
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      const on = p.getComponent("minecraft:riding")?.entityRidingOn;
      const rides = !!on && !VEHICLES.includes(on.typeId) && on.typeId !== NEST && !on.typeId.startsWith("war:");
      const was = leaderRode.get(p.id) ?? false;
      if (!rides && !was) continue;
      const mine = p.dimension.getEntities({ type: SOLDIER, location: p.location, maxDistance: 32 }).filter((e) => { const d = sd(e); return (d.func === "follow" || d.func === "escort") && d.leader === p.id; });
      if (rides) mountUp(mine.filter((e) => !mountOf.has(e.id) && !isRiding(e)).slice(0, 4), true);   // (a few a second)
      else dismountAll(mine.filter((e) => mountOf.get(e.id)?.auto));
      leaderRode.set(p.id, rides);
    } catch {}
  }
}, 20);
// ================================================================ v9.4: campfires (nobody walks anywhere)
// v9.2 had men walk to seats round a fire, which bunched them up and pulled them off their spots. Now: when two to
// six men of a squad have stood still for a minute WHERE THEY ARE (a post, a hold, a patrol that stopped), within 5
// blocks of each other, with no fight near and a player around, one of them sometimes lights a small fire on a free
// patch of open ground between them. Each one simply sits down on the spot he's standing on, facing it: nobody moves,
// nobody's order or spot changes. Now and then one of them tells a story (only there). Any order, any move, any sign
// of a fight: he stands up and carries on. The fire goes out after 3-5 minutes, or when fewer than two still sit at
// it. Only men near a player are looked at, every 10 s: it costs next to nothing.
const CAMPS = [];               // { id, dimId, at, sq, until, seats: Map(soldier id -> where he sat), story, t0 }
const stillSince = new Map();   // soldier id -> { x, y, z, t }
const campOf = new Map();       // soldier id -> camp id
const seated = new Set();       // soldier ids sitting at a fire
const campQuit = (e, d, S, now) => now - Number(gdp(e, "war:ordt") ?? -99999) < 200 || inFight(e, S, now) || d.retreat || d.surr;
// (his decision while he sits at a fire: stay sitting; the moment there's anything else, he's up)
function campMove(e, now) {
  const cid = campOf.get(e.id); if (!cid) return undefined;
  const c = CAMPS.find((q) => q.id === cid), seat = c?.seats.get(e.id);
  if (!seat) { campOf.delete(e.id); return undefined; }
  const d = sd(e);
  if (campQuit(e, d, squads.get(squadKey(e, d)), now) || flat(e.location, seat) > 1.5) { campLeave(e, c); return undefined; }
  note(e, "sitting by the fire");
  return { g: "g_none", t: "t_mid", urgent: false };
}
function saveCamps() { try { setJSON(world, "war:camps", CAMPS.map((c) => ({ d: c.dimId, x: c.at.x, y: c.at.y, z: c.at.z }))); } catch {} }
system.runTimeout(() => {       // a fire left over from before a reload goes out
  try { for (const c of getJSON(world, "war:camps", [])) { try { const b = world.getDimension(c.d).getBlock(c); if (b?.typeId === "minecraft:campfire") b.setType("minecraft:air"); } catch {} } setJSON(world, "war:camps", []); } catch {}
}, 200);
function campEnd(c) {
  try { const b = world.getDimension(c.dimId).getBlock(c.at); if (b?.typeId === "minecraft:campfire") b.setType("minecraft:air"); } catch {}
  for (const id of c.seats.keys()) { campOf.delete(id); seated.delete(id); const e = world.getEntity(id); if (e?.isValid) { try { setP(e, "war:sit", false); } catch {} } }
  const i = CAMPS.indexOf(c); if (i >= 0) CAMPS.splice(i, 1); saveCamps();
}
function campLeave(e, c) {
  campOf.delete(e.id); c?.seats.delete(e.id); seated.delete(e.id);
  try { setP(e, "war:sit", false); } catch {}
}
system.runInterval(() => {
  const now = tick();
  // the fires: who's still sitting, story time, burning out
  for (const c of [...CAMPS]) {
    for (const [id, seat] of [...c.seats]) {
      const e = world.getEntity(id);
      if (!e?.isValid || downed.has(id) || isRiding(e)) { campLeave(e?.isValid ? e : { id }, c); continue; }
      const d = sd(e);
      if (campQuit(e, d, squads.get(squadKey(e, d)), now) || flat(e.location, seat) > 1.5) { campLeave(e, c); continue; }
      turnTo(e, c.at, 30);
    }
    const sitting = [...c.seats.keys()];
    if (!c.story && now - c.t0 > 400 && sitting.length >= 2 && Math.random() < 0.06) {   // (rare: about one fire in three hears one)
      c.story = true;
      const teller = world.getEntity(sitting[Math.floor(Math.random() * sitting.length)]);
      if (teller?.isValid) { const ks = STORIES.filter((k) => voiceHas(voiceOfMan(teller), k)); callout(teller, "STORY", { key: ks.length ? ks[Math.floor(Math.random() * ks.length)] : "story", event: true }); }   // (v9.5: a recorded story, else your own story.ogg)
    }
    if (now > c.until || c.seats.size < 2) campEnd(c);
  }
  // who's been standing in one place, no fight about, near a player
  const groups = new Map();
  for (const e of allOf(SOLDIER)) {
    try {
      if (campOf.has(e.id)) continue;
      const l = e.location;
      if (!PLAYER_POS.some((p) => p.d === e.dimension.id && Math.hypot(p.x - l.x, p.z - l.z) < 48)) { stillSince.delete(e.id); continue; }
      const d = sd(e);
      if (!d.faction || d.surr || d.retreat || downed.has(e.id) || isRiding(e) || pows.has(e.id) || personal.has(e.id) || d.div === "guard" || d.func === "follow" || d.func === "escort" || isIndoors(e)) { stillSince.delete(e.id); continue; }
      let st = stillSince.get(e.id);
      if (!st || Math.hypot(l.x - st.x, l.z - st.z) > 1 || Math.abs(l.y - st.y) > 1) { stillSince.set(e.id, { x: l.x, y: l.y, z: l.z, t: now }); continue; }
      if (now - st.t < 1200 || inFight(e, squads.get(squadKey(e, d)), now)) continue;
      const k = squadKey(e, d); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e);
    } catch {}
  }
  for (const [k, men] of groups) {
    if (men.length < 2 || CAMPS.length >= 6 || CAMPS.some((c) => c.sq === k) || Math.random() > (globalThis.__campChance ?? 0.12)) continue;   // (__campChance: test kits only)
    // the tightest knot of men already standing near each other (no one walks to it)
    let near = [];
    for (const m of men) { const n = men.filter((o) => o.dimension.id === m.dimension.id && flat(o.location, m.location) <= 5 && Math.abs(o.location.y - m.location.y) < 1.5); if (n.length > near.length) near = n; }
    near = near.slice(0, 6);
    if (near.length < 2) continue;
    const dim = near[0].dimension, c0 = { x: near.reduce((t, e) => t + e.location.x, 0) / near.length, y: near[0].location.y, z: near.reduce((t, e) => t + e.location.z, 0) / near.length };
    const all = allOf(SOLDIER).filter((o) => o.dimension.id === dim.id && flat(o.location, c0) < 8);
    let g;                      // a free patch of ground among them: nobody standing on it or right beside it
    for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const q = walkableNear(dim, c0.x + ox, c0.z + oz, c0.y);
      if (!q || Math.abs(q.y - c0.y) > 1) continue;
      const bx = Math.floor(q.x) + 0.5, bz = Math.floor(q.z) + 0.5;
      if (all.some((o) => Math.hypot(o.location.x - bx, o.location.z - bz) < 1.6 && Math.abs(o.location.y - q.y) < 2)) continue;
      if (near.some((o) => Math.hypot(o.location.x - bx, o.location.z - bz) > 5)) continue;   // (close enough to everyone sitting at it)
      g = q; break;
    }
    if (!g || isIndoorsAt(dim, g) || dangerNear(dim, g)) continue;
    let ok = true;
    try { const b = dim.getBlock({ x: Math.floor(g.x), y: Math.floor(g.y), z: Math.floor(g.z) }), below = dim.getBlock({ x: Math.floor(g.x), y: Math.floor(g.y) - 1, z: Math.floor(g.z) }); ok = !!b?.isAir && !!below && !below.isAir && !below.isLiquid && (tSky(dim, g.x, g.y + 1, g.z) >= 10); if (ok) b.setType("minecraft:campfire"); } catch { ok = false; }
    if (!ok) continue;
    const at = { x: Math.floor(g.x), y: Math.floor(g.y), z: Math.floor(g.z) };
    const camp = { id: `${now}|${k}`, dimId: dim.id, at, sq: k, t0: now, until: now + 3600 + Math.floor(Math.random() * 2400), seats: new Map(), story: false };
    for (const e of near) { camp.seats.set(e.id, { x: e.location.x, y: e.location.y, z: e.location.z }); campOf.set(e.id, camp.id); seated.add(e.id); setP(e, "war:sit", true); turnTo(e, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, 180); }
    CAMPS.push(camp); saveCamps();
    note(near[0], "lit a fire");
  }
}, 200);
// ================================================================ v9.1: neutral zones
// An area (a circle, every height) where nobody fights: think of a UN building. Anyone standing inside it (soldier,
// war dog, player) can't be targeted by soldiers and doesn't target anyone; a stray round doesn't land on him there;
// no grenade goes in or comes out; squads don't hunt men who are inside. Mobs (zombies...) are still fought.
// War Table -> Neutral zones: add one where you stand (name, radius), show the borders, remove one.
const SAFE = new Set();     // ids of everyone inside a zone right now (updated twice a second)
let ZONES = null;           // [{ id, name, dim, x, z, r }]
const getZones = () => (ZONES ??= getJSON(world, "war:zones", []));
const saveZones = () => setJSON(world, "war:zones", ZONES ?? []);
function zoneAt(dimId, loc) { for (const z of getZones()) if (z.dim === dimId && Math.hypot(loc.x - z.x, loc.z - z.z) <= z.r) return z; return undefined; }
system.runInterval(() => {
  try {
    if (!getZones().length) { if (SAFE.size) { for (const id of SAFE) { try { world.getEntity(id)?.removeTag("war_safe"); } catch {} } SAFE.clear(); } return; }
    const now = new Set();
    for (const e of [...allOf(SOLDIER), ...allOf(HOUND), ...world.getAllPlayers()]) {
      try { if (zoneAt(e.dimension.id, e.location)) now.add(e.id); } catch {}
    }
    for (const id of SAFE) if (!now.has(id)) { SAFE.delete(id); try { world.getEntity(id)?.removeTag("war_safe"); } catch {} }
    for (const id of now) if (!SAFE.has(id)) {
      SAFE.add(id);
      try {
        const e = world.getEntity(id); e?.addTag("war_safe");
        const st = gunState.get(id); if (st) { st.target = undefined; st.supp = undefined; }
        const ps = perc.get(id); if (ps) ps.threat = undefined;
      } catch {}
    }
  } catch (err) { oops("neutral zones", err); }
}, 10);
// the border, drawn in particles for a while (from the menu)
function showZone(z, dim, ticks = 200) {
  const n = Math.max(24, Math.min(120, Math.round(z.r * 2)));
  for (let t = 0; t < ticks; t += 20) system.runTimeout(() => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = z.x + Math.cos(a) * z.r, zz = z.z + Math.sin(a) * z.r;
      const g = walkableNear(dim, x, zz, z.y ?? 64);
      try { dim.spawnParticle("minecraft:villager_happy", { x, y: (g?.y ?? z.y ?? 64) + 0.6, z: zz }); } catch {}
    }
  }, t);
}
async function zoneMenu(player) {
  const zones = getZones(), here = player.dimension.id;
  const af = new ActionFormData().title("Neutral zones").body(zones.length ? `${zones.length} zone${zones.length === 1 ? "" : "s"}. Nobody fights inside one.` : "No zones yet. Nobody fights inside one (soldiers, war dogs, players). Mobs are still fought.");
  const opts = [["add", "Add a zone here"]];
  if (zones.some((z) => z.dim === here)) opts.push(["show", "Show the borders (10 s)"]);
  for (const z of zones) opts.push([`del:${z.id}`, `§cRemove: §r${z.name} §8(r ${z.r}${z.dim !== here ? ", other dimension" : `, ${Math.round(Math.hypot(player.location.x - z.x, player.location.z - z.z))} away`})`]);
  for (const o of opts) af.button(o[1]);
  const r = await show(af, player);
  if (!r || r.canceled || r.selection === undefined) return;
  const pick = opts[r.selection][0];
  if (pick === "show") { for (const z of zones) if (z.dim === here) showZone(z, player.dimension); return; }
  if (pick.startsWith("del:")) {
    const id = pick.slice(4), z = zones.find((q) => q.id === id);
    ZONES = zones.filter((q) => q.id !== id); saveZones();
    if (z) { say(`§7Neutral zone §f${z.name}§7 removed.`); chronLog(`${player.name} removed the neutral zone ${z.name}.`); }
    return;
  }
  const mf = new ModalFormData().title("New neutral zone").textField("Name", "UN building", { defaultValue: `Neutral zone ${zones.length + 1}` }).slider("Radius (blocks)", 4, 128, { valueStep: 4, defaultValue: 24 });
  const mr = await show(mf, player);
  if (!mr || mr.canceled || !mr.formValues) return;
  const l = player.location, z = { id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, name: String(mr.formValues[0]).trim().slice(0, 32) || `Neutral zone ${zones.length + 1}`, dim: here, x: Math.round(l.x * 2) / 2, y: Math.floor(l.y), z: Math.round(l.z * 2) / 2, r: Number(mr.formValues[1]) };
  ZONES = [...zones, z]; saveZones();
  say(`§aNeutral zone §f${z.name}§a set up ${placeName(player.dimension, l)} (radius ${z.r}). Nobody fights inside it.`);
  chronLog(`${player.name} set up the neutral zone ${z.name} ${placeName(player.dimension, l)}.`);
  showZone(z, player.dimension);
}
// ================================================================ v8.2: memory housekeeping
// Bedrock gives scripts a fixed amount of memory and stops the game when it's used up ("Exceeded scripting memory
// limit"). Every per-soldier record is dropped once that soldier is gone (dead, removed, unloaded for good), checked
// once a minute; the route searches and the caches have size caps of their own.
system.runInterval(() => {
  try {
    const live = new Set();
    for (const t of [SOLDIER, HOUND]) for (const e of allOf(t)) live.add(e.id);
    for (const p of world.getAllPlayers()) live.add(p.id);
    for (const m of [crawlTo, stillSince, campOf, seated, ARM, breachFragUsed, smokeUsed, dragCool, firedAt, lastPos, noiseFrom, noiseT, alertUntil, modeMemo, propSync, mountedAt, wetTrack, swimGiveUp, breakCool, recentHits, wetMemo, medicCall, lastHp, buildBudget, shotAtPlayer, doorLook, hopT, settleT, flinchT, edgeFearT, kiteT, fleeFire, lastUse, hurtBy, perc, brain, gunState, notes, sweep, marchWatch, forceGlide, glideBan, aimedBy, hpMemo]) {
      if (!m?.size) continue;
      for (const k of [...m.keys()]) if (typeof k === "string" && k.length > 3 && !k.includes(":") && !live.has(k)) m.delete(k);
    }
  } catch (err) { oops("memory sweep", err); }
}, 1200);


// ================================================================ v9.15: shields
// Swordsmen, spearmen and crossbowmen carry a shield in the off hand. Raised (war:block), it stops what comes at it
// from the front: blades, bolts and arrows outright, most of a bullet's force. Lowered, it still catches some.
// Tactics: raised while closing under fire (slower), crossbowmen duck behind it between shots, a shield bash for a man
// pressing too close, and three or more shields in a squad holding ground lock into a wall with the crossbows behind.
const SHIELD_ON = new Map();     // soldier id -> true (has one) / false (cleared)
const SHIELD_HIT = new Map();    // soldier id -> tick his shield last took a hit
const BASH_T = new Map();        // soldier id -> tick of his last bash
const shieldMelee = (d) => d.weapon === "sword" || d.weapon === "spear" || (!d.ranged && !GUNS.includes(d.weapon));
function shieldFit(d) {
  if (setting("shields", true) === false || d.surr || ["medic", "grenadier"].includes(d.div) || GUNS.includes(d.weapon) || ["at", "molotov", "grenade"].includes(d.weapon)) return false;
  return d.weapon === "sword" || d.weapon === "spear" || d.weapon === "crossbow" || !!d.ranged || !d.weapon;
}
const GUARD_BROKEN = new Map();   // v9.19: id -> tick he can raise his shield again
function shieldBlock(v, ev) {
  const cause = String(ev.damageSource?.cause ?? "");
  let fx, fz, bullet = false;
  const lh = lastHit.get(v.id);
  if (lh && tick() - lh.t <= 1 && lh.dir && !cause.includes("xplosion")) { fx = -lh.dir.x; fz = -lh.dir.z; bullet = true; }   // (our own rounds)
  else {
    if (cause !== "entityAttack" && cause !== "projectile") return 0;                // (blasts, fire, falls: a shield is no help)
    const src = ev.damageSource?.damagingProjectile ?? ev.damageSource?.damagingEntity;
    if (!src?.isValid) return 0;
    fx = src.location.x - v.location.x; fz = src.location.z - v.location.z;
    bullet = String(ev.damageSource?.damagingProjectile?.typeId ?? "").startsWith("ww:");
    const shooter = ev.damageSource?.damagingEntity;                                 // (v9.21.3: a player's gun: whatever way the gun pack delivers the hit, it's a round. A raised shield stopped every one of them)
    if (!bullet && shooter?.typeId === "minecraft:player" && (cause !== "entityAttack" || String(mainhand(shooter) ?? "").startsWith("ww:"))) bullet = true;
  }
  const L = Math.hypot(fx, fz); if (L < 0.01) return 0;
  const yaw = v.getRotation().y * Math.PI / 180, cos = (fx * -Math.sin(yaw) + fz * Math.cos(yaw)) / L;
  if (cos < 0.35) return 0;                                                        // (from the side or behind: nothing)
  const raised = !!P(v, "war:block");
  const melee = cause === "entityAttack";
  let r = 0;
  // (v9.17: a bullet goes through a shield: raised, it takes only the edge off a round, lowered nothing at all. At 80%
  //  a swordsman under fire took three times the rounds a rifleman did)
  if (bullet) r = raised ? 0.2 : 0;
  else if (raised) r = 1;
  else if (Math.random() < (melee ? 0.4 : 0.25)) r = 1;
  if (r > 0) {
    SHIELD_HIT.set(v.id, tick());
    system.run(() => { try { v.dimension.playSound("item.shield.block", v.location, { volume: 1 }); } catch {} });
  }
  return r;
}
// the shield in his hand: given or taken as his kit and the setting say
system.runInterval(() => {
  let n = 0;
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e), want = shieldFit(d) && !pows.has(e.id);
      if (SHIELD_ON.get(e.id) === want || n > 30) continue;
      if (!want && !SHIELD_ON.has(e.id) && !shieldFit({ ...d, surr: false }) && setting("shields", true) !== false) { SHIELD_ON.set(e.id, false); continue; }   // (never had one)
      e.runCommand(`replaceitem entity @s slot.weapon.offhand 0 ${want ? "shield" : "air"}`); n++;
      SHIELD_ON.set(e.id, want);
      if (!want) setP(e, "war:block", false);
    } catch {}
  }
  if (tick() % 1200 < 40) { const live = new Set(allOf(SOLDIER).map((q) => q.id)); for (const id of [...SHIELD_ON.keys()]) if (!live.has(id)) { SHIELD_ON.delete(id); SHIELD_HIT.delete(id); BASH_T.delete(id); } }   // (once a minute, no lookups)
}, 40);
// raised or lowered, and the bash
system.runInterval(() => {
  const now = tick();
  for (const [id, has] of SHIELD_ON) {
    if (!has) continue;
    const e = world.getEntity(id);
    if (!e?.isValid) continue;
    try {
      const d = sd(e);
      let up = false;
      const th = perc.get(id)?.threat;
      if (!downed.has(id) && !pows.has(id) && !d.surr && th?.isValid) {
        const dd = dist(th.location, e.location);
        const fired = now - (firedAt.get(id)?.t ?? -999) < 60 || now - (SHIELD_HIT.get(id) ?? -999) < 60 || now - Number(gdp(e, "war:hurt") ?? -999) < 60;
        const shooter = th.typeId === SOLDIER ? (GUNS.includes(sd(th).weapon) || !!sd(th).ranged) : th.typeId === "minecraft:player" || th.typeId === "minecraft:skeleton" || th.typeId === "minecraft:pillager";
        if (shieldMelee(d)) {
          up = dd > 2.6 && (fired || (shooter && dd < 40));                                // (closing in under fire: behind the shield)
          // bash: someone pressing close in front of him, now and then
          if (dd < 2.4 && now - (BASH_T.get(id) ?? -999) > 60 && Math.random() < 0.3 && hittable(th, e)) {
            const yaw = e.getRotation().y * Math.PI / 180, fx = -Math.sin(yaw), fz = Math.cos(yaw), vx = th.location.x - e.location.x, vz = th.location.z - e.location.z, L = Math.hypot(vx, vz) || 1;
            if ((vx * fx + vz * fz) / L > 0.5) {
              BASH_T.set(id, now); up = true;
              try { th.applyKnockback({ x: (vx / L) * 0.9, z: (vz / L) * 0.9 }, 0.25); } catch { try { th.applyKnockback(vx / L, vz / L, 0.9, 0.25); } catch {} }
              try { preHp(th); th.applyDamage(2); } catch {}
              try { th.addEffect("slowness", 30, { amplifier: 2, showParticles: false }); } catch {}
              try { e.dimension.playSound("item.shield.block", e.location, { volume: 1.2, pitch: 0.7 }); } catch {}
              note(e, "shield bash"); v9stat("shieldBash");
              if (th.typeId === SOLDIER && SHIELD_ON.get(th.id)) { GUARD_BROKEN.set(th.id, now + 40); setP(th, "war:block", false); note(th, "guard knocked aside"); }   // (v9.19: his guard's broken for a moment)
            }
          }
        } else {
          // crossbowman: under fire, he ducks behind it between shots (about half the time), and against a man on top of him
          const cyc = (now + id.charCodeAt(id.length - 1) * 7) % 60;
          up = (fired && dd > 5 && cyc < 32) || dd < 2.2;
        }
      }
      if (up && (GUARD_BROKEN.get(id) ?? 0) > now) up = false;
      if (!!P(e, "war:block") !== up) setP(e, "war:block", up);
      if (up) { try { e.addEffect("slowness", 8, { amplifier: 0, showParticles: false }); } catch {} }
    } catch {}
  }
}, 5);
// the shield wall: three or more shields of a squad holding ground against shooters lock into a line facing them,
// the squad's crossbows a step behind
system.runInterval(() => {
  const now = tick();
  for (const [k, S] of squads) {
    try {
      S.wall = undefined;
      if (!S.ours?.length || now - S.t > 40 || !S.known?.size || !S.ourC) continue;
      const ours = S.ours.filter((o) => o.isValid && !downed.has(o.id) && !isRiding(o) && !pows.has(o.id));
      const anch = (o) => ["hold", "post", "stand", "sentry"].includes(sd(o).func);
      const shields = ours.filter((o) => SHIELD_ON.get(o.id) && shieldMelee(sd(o)) && anch(o));
      if (shields.length < 3) continue;
      // the line hangs off where the squad was told to hold (their own markers), not off where the men happen to stand:
      // measured from the men, every step up to the line moved the line forward and the wall walked into the enemy
      let oc = S.ourC;
      { let n = 0, x = 0, y = 0, z = 0; for (const o of shields) { const m = marker(Number(gdp(o, "war:home") ?? gdp(o, "war:goal") ?? 0)); if (m) { x += m.location.x; y += m.location.y; z += m.location.z; n++; } } if (n) oc = { x: x / n, y: y / n, z: z / n }; }
      let q, qd = 1e9; for (const kk of S.known.values()) { const dd = Math.hypot(kk.x - oc.x, kk.z - oc.z); if (dd < qd) { qd = dd; q = kk; } }
      if (!q || qd < 8 || qd > 48) continue;                                          // (too close: a melee, not a wall)
      let ux = (q.x - oc.x) / qd, uz = (q.z - oc.z) / qd;
      const A = S.wallAt;                                                             // (the line stays put while the picture holds: no shuffling)
      if (A && now - A.t < 60 && Math.hypot(A.x - oc.x, A.z - oc.z) < 4 && A.ux * ux + A.uz * uz > 0.85) { oc = A; ux = A.ux; uz = A.uz; }
      S.wallAt = { x: oc.x, y: oc.y, z: oc.z, ux, uz, t: now };   // (kept: its position only changes when the hold point or the enemy's side does)
      const px = -uz, pz = ux;
      const dim = shields[0].dimension, spots = new Map();
      const line = (list, ahead, gap) => {
        list.sort((a, b) => ((a.location.x - oc.x) * px + (a.location.z - oc.z) * pz) - ((b.location.x - oc.x) * px + (b.location.z - oc.z) * pz));
        list.forEach((o, i) => {
          const off = (i - (list.length - 1) / 2) * gap;
          const w = walkableNear(dim, oc.x + ux * ahead + px * off, oc.z + uz * ahead + pz * off, oc.y);
          if (w && Math.abs(w.y - oc.y) < 2.5) spots.set(o.id, { x: w.x, y: w.y, z: w.z });
        });
      };
      line(shields, 3, 1.1);
      const bows = ours.filter((o) => { const d = sd(o); return !shieldMelee(d) && !GUNS.includes(d.weapon) && d.ranged && anch(o) && dist(o.location, oc) < 14; });
      if (bows.length) line(bows, 0.8, 1.4);
      if (spots.size < 3) continue;
      S.wall = { t: now, spots, ux, uz };
      if (now - (S.wallCall ?? -9999) > 1200) { S.wallCall = now; callout(shields[0], "Shields up! Form the wall!", { event: true }); v9stat("shieldWall"); }
    } catch {}
  }
}, 20);
WarAPI.registerBehavior({
  name: "shield wall", when: "first", priority: 90,
  decide(e, d, now) {
    const S = squads.get(squadKey(e, d)), W = S?.wall;
    if (!W || now - W.t > 40) return undefined;
    const sp = W.spots.get(e.id); if (!sp) return undefined;
    const th = perc.get(e.id)?.threat;
    if (th?.isValid && dist(th.location, e.location) < 4) return undefined;               // (someone got through: fight him)
    const t = shieldMelee(d) ? "t_short" : "t_mid";
    if (personal.has(e.id)) { personal.delete(e.id); travelTo.delete(e.id); }               // (his own way forward waits: the line holds)
    if (dist(sp, e.location) < 3.2 && dist(sp, e.location) >= 0.7) push(e, { x: (sp.x - e.location.x) * 0.2, y: 0.02, z: (sp.z - e.location.z) * 0.2 }, 3);
    if (dist(sp, e.location) < 0.7) { try { e.setRotation({ x: 0, y: Math.atan2(-W.ux, W.uz) * 180 / Math.PI }); } catch {} return { g: "g_none", t, urgent: false, note: "holding the shield wall" }; }
    const slot = myMarker(e, sp, "war:mymk", 0.6);
    return slot !== undefined ? { g: "g_wp", slot, t, urgent: true, note: "forming the shield wall" } : undefined;
  },
});

// ================================================================ v9.15: bodyguards
// Guards on "Escort me" work like a protective detail: a diamond around you (tighter indoors, a point man ahead),
// the nearest one steps in between you and a threat while the rest spread on that side and return fire, and when
// you're hit they close in around you. They never chase off: the man is the job.
const OWNER_HURT = new Map();    // player id -> { t, by }
const GUARD_ON = new Map();      // guard id -> tick he last worked the detail
// (on the detail he doesn't go after whoever hits him: no chasing off; the detail decides when he fights)
WarAPI.on("think", (e, d, want, now) => { if (d.div === "guard" && d.func === "escort" && now - (GUARD_ON.get(e.id) ?? -999) < 20) { want.r = "r_off"; if (shieldMelee(d) && !GUNS.includes(d.weapon)) { want.w = "w_none"; want.t = "t_off"; } } });
const DETAIL = new Map();        // player id -> { t, ids, threat, shieldId, callT, hurtCallT }
world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const p = ev.hurtEntity; if (p?.typeId !== "minecraft:player") return;
    let a = ev.damageSource?.damagingEntity; if (!a) a = ev.damageSource?.damagingProjectile?.getComponent?.("minecraft:projectile")?.owner;
    OWNER_HURT.set(p.id, { t: tick(), by: a?.id });
  } catch {}
});
function detailOf(p, now) {
  let D = DETAIL.get(p.id);
  if (D && now - D.t < 10) return D;
  if (!D) D = {};
  D.t = now;
  const ids = [];
  for (const o of p.dimension.getEntities({ type: SOLDIER, location: p.location, maxDistance: 40 })) { try { const d = sd(o); if (d.div === "guard" && d.func === "escort" && d.leader === p.id && !downed.has(o.id)) ids.push(o.id); } catch {} }
  D.ids = ids.sort();
  const f = ids.length ? Number(sd(world.getEntity(ids[0])).faction ?? 0) : 0;
  let th;
  const oh = OWNER_HURT.get(p.id);
  if (oh?.by && now - oh.t < 200) { const a = world.getEntity(oh.by); if (a?.isValid && a.id !== p.id && dist(a.location, p.location) < 40 && !(a.typeId === SOLDIER && downed.has(a.id))) th = a; }
  if (!th) {
    let bd = 18;
    for (const c of nearSnap(p.dimension.id, p.location, 18)) {
      if (c.down || !c.e.isValid || !(c.type === SOLDIER || c.type === HOUND || c.type === "minecraft:player") || !c.f || !isHostile(f, c.f)) continue;
      const dd = dist(c.e.location, p.location); if (dd < bd) { bd = dd; th = c.e; }
    }
  }
  D.threat = th;
  D.shieldId = undefined;
  if (th && ids.length) {
    const ux = th.location.x - p.location.x, uz = th.location.z - p.location.z, L = Math.hypot(ux, uz) || 1;
    let bs = 1e9;
    for (const id of ids) { const o = world.getEntity(id); if (!o) continue; const ox = o.location.x - p.location.x, oz = o.location.z - p.location.z; const sc = Math.hypot(ox - ux / L * 1.5, oz - uz / L * 1.5); if (sc < bs) { bs = sc; D.shieldId = id; } }
    if (now - (D.callT ?? -9999) > 300) { D.callT = now; const g = world.getEntity(D.shieldId); if (g) callout(g, ["Contact! Cover the principal!", "Threat! Get behind me!", "Covering! Stay down!"][Math.floor(Math.random() * 3)], { event: true }); v9stat("guardCover"); }
  }
  if (oh && now - oh.t < 20 && now - (D.hurtCallT ?? -9999) > 200 && ids.length) { D.hurtCallT = now; const g = world.getEntity(ids[ids.length - 1]); if (g) callout(g, "Shots fired! Cover! Cover!", { event: true }); }
  DETAIL.set(p.id, D);
  return D;
}
system.runInterval(() => { const now = tick(); for (const [k, D] of [...DETAIL]) if (now - D.t > 600) DETAIL.delete(k); for (const [k, h] of [...OWNER_HURT]) if (now - h.t > 600) OWNER_HURT.delete(k); for (const [k, t] of [...GUARD_ON]) if (now - t > 600) GUARD_ON.delete(k); }, 200);
// where each man of the detail belongs right now (shared by his decisions and by the driver that keeps him there)
function detailSpot(e, d, p, D, now) {
  const idx = Math.max(0, D.ids.indexOf(e.id)), n = Math.max(1, D.ids.length);
  const melee = shieldMelee(d) && !GUNS.includes(d.weapon);
  const v = D.vel ?? { x: 0, z: 0 };
  const pl = { x: p.location.x + v.x * 5, y: p.location.y, z: p.location.z + v.z * 5 };   // (a step ahead of where you're going)
  let x, z, t = "t_off", what;
  const th = D.threat?.isValid ? D.threat : undefined;
  if (th) {
    const tx = th.location.x - pl.x, tz = th.location.z - pl.z, L = Math.hypot(tx, tz) || 1, ux = tx / L, uz = tz / L;
    if (melee && (L < 7 || dist(th.location, e.location) < 3) && e.id !== D.shieldId) return { engage: th };   // (close: put him down)
    if (e.id === D.shieldId) { x = pl.x + ux * 1.3; z = pl.z + uz * 1.3; what = "shielding you"; }
    else {
      const k = D.ids.filter((id) => id !== D.shieldId).indexOf(e.id), m = Math.max(1, n - 1);
      const ang = m === 1 ? 0.9 : -1.3 + (2.6 * k) / (m - 1), ca = Math.cos(ang), sa = Math.sin(ang);
      x = pl.x + (ux * ca - uz * sa) * 2.0; z = pl.z + (ux * sa + uz * ca) * 2.0; what = "covering you";
    }
    t = melee ? "t_off" : "t_mid";
  } else if (now - (OWNER_HURT.get(p.id)?.t ?? -9999) < 120) {
    const a = (idx / n) * Math.PI * 2; x = pl.x + Math.cos(a) * 1.2; z = pl.z + Math.sin(a) * 1.2; what = "covering you"; t = melee ? "t_off" : "t_mid";
  } else {
    // a tight diamond (more men: a ring) turned to the way you're heading; indoors it draws in, the point man ahead
    const hx = D.head?.x ?? 0, hz = D.head?.z ?? 1, rx = -hz, rz = hx;
    const S = D.inside ? 0.6 : 1;
    const SLOTS = [[2.2, 0], [-1.9, 0], [0, 1.7], [0, -1.7], [1.6, 1.6], [1.6, -1.6], [-1.6, 1.6], [-1.6, -1.6]];
    const [a, b] = SLOTS[idx % SLOTS.length], ring = 1 + Math.floor(idx / SLOTS.length) * 0.6;
    x = pl.x + (hx * a + rx * b) * S * ring; z = pl.z + (hz * a + rz * b) * S * ring;
    what = idx === 0 ? "on point" : "on the detail";
  }
  const w = walkableNear(e.dimension, x, z, pl.y);
  if (!w || Math.abs(w.y - pl.y) > 2.5) return undefined;                                  // (no footing there: plain following)
  return { x, y: w.y, z, t, what };
}
WarAPI.registerBehavior({
  name: "bodyguard", when: "first", priority: 100,
  decide(e, d, now) {
    if (d.div !== "guard" || d.func !== "escort" || !d.leader) return undefined;
    const p = findPlayer(d.leader);
    if (!p || p.dimension.id !== e.dimension.id || isRiding(p) || dist(p.location, e.location) > 40) return undefined;
    const D = detailOf(p, now), sp = detailSpot(e, d, p, D, now);
    if (!sp) return undefined;
    if (sp.engage) { GUARD_ON.set(e.id, -999); return { g: "g_wp", slot: myMarker(e, sp.engage.location, "war:mymk", 0.8), t: "t_short", urgent: true, note: "taking down the threat" }; }
    GUARD_ON.set(e.id, now);
    const gap = Math.hypot(sp.x - e.location.x, sp.z - e.location.z);
    if (gap < 8 && Math.abs(sp.y - e.location.y) < 1.6) return { g: "g_none", t: sp.t, urgent: false, note: sp.what };   // (close: the detail driver holds him on his spot)
    const slot = myMarker(e, { x: sp.x, y: sp.y, z: sp.z }, "war:mymk", 0.8);               // (far or another level: he walks there)
    return slot !== undefined ? { g: "g_wp", slot, t: sp.t, urgent: true, note: sp.what } : undefined;
  },
});
// v9.15.1: the detail driver. Every tick each man near his spot is carried onto it at your pace (a little faster, to
// close up), so the formation moves with you instead of trailing three blocks behind like plain following. He steps
// up a block or down one like the route glider, never into a wall, over a drop, or through you; standing, he faces out.
system.runInterval(() => {
  const now = tick();
  for (const [pid, D] of DETAIL) {
    const p = findPlayer(pid);
    if (!p?.isValid || now - D.t > 200) continue;
    try {
      detailOf(p, now);                                                                    // (kept fresh here: the men think only now and then)
      if (!D.ids?.length) continue;
      // your heading and pace (from how you move, not where you look: the detail doesn't swing round when you glance)
      const pl = p.location, last = D.lastPos;
      D.lastPos = { x: pl.x, y: pl.y, z: pl.z };
      if (last) {
        const vx = pl.x - last.x, vz = pl.z - last.z, sp = Math.hypot(vx, vz);
        D.vel = { x: (D.vel?.x ?? 0) * 0.6 + vx * 0.4, z: (D.vel?.z ?? 0) * 0.6 + vz * 0.4 };
        if (sp > 0.06 && sp < 2) { const hx = (D.head?.x ?? 0) * 0.8 + (vx / sp) * 0.2, hz = (D.head?.z ?? 1) * 0.8 + (vz / sp) * 0.2, L = Math.hypot(hx, hz) || 1; D.head = { x: hx / L, z: hz / L }; }
      }
      if (!D.head) { const yaw = p.getRotation().y * Math.PI / 180; D.head = { x: -Math.sin(yaw), z: Math.cos(yaw) }; }
      if (now % 20 === 0) D.inside = isIndoors(p);
      const pace = Math.hypot(D.vel?.x ?? 0, D.vel?.z ?? 0);
      const maxStep = Math.min(0.42, Math.max(0.2, pace * 1.35));
      for (const id of D.ids) {
        const e = world.getEntity(id);
        if (!e?.isValid || downed.has(id) || isRiding(e) || climbing.has(id) || gliders.has(id) || staggered(id) || e.dimension.id !== p.dimension.id) continue;
        if (now - (GUARD_ON.get(id) ?? -999) > 80) continue;                              // (not on the detail right now: fighting, or far)
        const d = sd(e), sp = detailSpot(e, d, p, D, now);
        if (!sp || sp.engage) continue;
        const l = e.location, dx = sp.x - l.x, dz = sp.z - l.z, L = Math.hypot(dx, dz);
        if (L > 8 || Math.abs(sp.y - l.y) > 1.6) continue;                                 // (his walking gets him there)
        const th = D.threat?.isValid ? D.threat.location : undefined;
        // standing: facing out from you (his sector) or at the threat; walking: the way you're all going
        const faceOut = th ?? { x: l.x + (l.x - pl.x) * 4, z: l.z + (l.z - pl.z) * 4 };
        const faceGo = { x: l.x + (D.head?.x ?? 0) * 6, z: l.z + (D.head?.z ?? 1) * 6 };
        if (L < 0.12) { if (now % 2 === 0) { const r = faceRot(e, l, pace < 0.05 ? faceOut : faceGo, 9); if (Math.abs(((r.y - e.getRotation().y + 540) % 360) - 180) > 1) try { e.setRotation(r); } catch {} } continue; }
        const stp = Math.min(L, maxStep), nx = l.x + (dx / L) * stp, nz = l.z + (dz / L) * stp;
        if (Math.hypot(nx - pl.x, nz - pl.z) < 0.75 && Math.hypot(l.x - pl.x, l.z - pl.z) >= 0.75) continue;   // (never through you)
        let ny;
        for (const yy of [l.y, Math.floor(l.y + 0.01) + 1, Math.floor(l.y + 0.01) + 0.5, l.y - 0.5, Math.floor(l.y + 0.01) - 1]) {
          if (yy > l.y + 1.1) continue;
          if (glideFree(e.dimension, nx, yy, nz) && floorUnder(e.dimension, nx, yy, nz)) { ny = yy; break; }
        }
        if (ny === undefined) continue;                                                     // (a wall or a drop: his walking finds the way)
        if (dangerNear(e.dimension, { x: nx, y: ny, z: nz })) continue;
        const moving = pace > 0.05 || L > 0.6;
        e.teleport({ x: nx, y: ny, z: nz }, { rotation: faceRot(e, { x: nx, y: ny, z: nz }, th ? faceOut : moving ? (L > 1.2 ? { x: nx + dx * 4, z: nz + dz * 4 } : faceGo) : faceOut, 14) });
      }
    } catch {}
  }
}, 1);
// ================================================================ v9.15: officers wear an insignia
// The man running each squad (its sergeant: the one who takes command) shows gold shoulder boards and a badge.
system.runInterval(() => {
  const now = tick(), officers = new Set();
  if (setting("bands", true) !== false) {
    for (const S of squads.values()) {
      try {
        if (!S.ours?.length || now - S.t > 200) continue;
        const live = S.ours.filter((o) => o.isValid && !downed.has(o.id));
        if (live.length < 2) continue;
        let sg = S.sgt ? live.find((o) => o.id === S.sgt) : undefined;
        if (!sg) { sg = live.filter((o) => GUNS.includes(sd(o).weapon)).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? live.sort((a, b) => (a.id < b.id ? -1 : 1))[0]; S.sgt = sg.id; }
        officers.add(sg.id);
      } catch {}
    }
  }
  const was = OFFICER_IDS; OFFICER_IDS = officers;
  for (const e of allOf(SOLDIER)) {
    try {
      const want = officers.has(e.id); if (!!P(e, "war:officer") !== want) setP(e, "war:officer", want);
      const key = `${voiceOfMan(e)}|${rankTier(e)}|${setting("mixnames", false) ? 1 : 0}`;   // (v9.23: a name tag made before the language or rank changed is redone)
      if (NAME_KEY.get(e.id) !== key || was.has(e.id) !== want) { NAME_KEY.set(e.id, key); updateName(e); }
    } catch {}
  }
  if (now % 6000 < 100) { const live = new Set(allOf(SOLDIER).map((q) => q.id)); for (const id of [...NAME_KEY.keys()]) if (!live.has(id)) NAME_KEY.delete(id); }
}, 100);

// ================================================================ v9.15: night battles: illumination flares
// At night a squad in a firefight now and then sends up a flare over the enemy: it climbs, pops, and drifts down for
// ~20 s lighting the ground under it (invisible light blocks in the air, taken away as it moves and when it's out).
const FLARES = [];
let FLARE_LIGHTS = new Map();    // "dim|x|y|z" -> true: light blocks placed
let LIGHT_PERM, LIGHT_TRIED = false;
function lightPerm() {                                                                // (resolved once the world runs; older versions: one block with a level)
  if (LIGHT_TRIED) return LIGHT_PERM;
  LIGHT_TRIED = true;
  for (const f of [() => BlockPermutation.resolve("minecraft:light_block_15"), () => BlockPermutation.resolve("minecraft:light_block", { block_light_level: 15 })]) { try { LIGHT_PERM = f(); if (LIGHT_PERM) break; } catch {} }
  return LIGHT_PERM;
}
function saveFlareLights() { try { setJSON(world, "war:flarelights", [...FLARE_LIGHTS.keys()]); } catch {} }
function unlight(key) {
  const [dm, x, y, z] = key.split("|");
  try { const b = world.getDimension(dm).getBlock({ x: Number(x), y: Number(y), z: Number(z) }); if (b && b.typeId.startsWith("minecraft:light_block")) b.setType("minecraft:air"); } catch {}
}
system.runTimeout(() => { try { for (const k of getJSON(world, "war:flarelights", [])) unlight(k); world.setDynamicProperty("war:flarelights", undefined); } catch {} }, 60);   // (left from a flare when the world closed)
function fireFlare(e, at) {
  const h = headLoc(e);
  FLARES.push({ dim: e.dimension, x: h.x, y: h.y, z: h.z, tx: at.x, tz: at.z, top: h.y + 26, t: 0, lights: new Set(), vx: (Math.random() - 0.5) * 0.03, vz: (Math.random() - 0.5) * 0.03 });
  try { e.dimension.playSound("firework.launch", h, { volume: 3, pitch: 0.8 }); } catch {}
  callout(e, "Flare up!", { event: true }); v9stat("flare");
}
system.runInterval(() => {
  if (!NIGHT || setting("nightfx", true) === false || FLARES.length >= 2) return;
  const now = tick();
  for (const S of squads.values()) {
    try {
      if (!S.ours?.length || now - S.t > 40 || !S.known?.size || !S.ourC || now - (S.flareT ?? -99999) < 900 || Math.random() > 0.3) continue;
      let q, qd = 1e9; for (const kk of S.known.values()) { const dd = Math.hypot(kk.x - S.ourC.x, kk.z - S.ourC.z); if (dd < qd) { qd = dd; q = kk; } }
      if (!q || qd < 12) continue;
      const e = S.ours.find((o) => o.isValid && !downed.has(o.id) && !isIndoors(o) && sd(o).div !== "medic");
      if (!e) continue;
      S.flareT = now; fireFlare(e, { x: (q.x * 2 + S.ourC.x) / 3, z: (q.z * 2 + S.ourC.z) / 3 }); return;
    } catch {}
  }
}, 40);
system.runInterval(() => {
  let changed = false;
  for (let i = FLARES.length - 1; i >= 0; i--) {
    const F = FLARES[i];
    try {
      F.t += 2;
      if (F.t <= 40) { const k = F.t / 40; F.x += (F.tx - F.x) * 0.06; F.z += (F.tz - F.z) * 0.06; F.y += (F.top - F.y) * 0.12 * (1 - k * 0.5); if (F.t % 4 === 0) F.dim.spawnParticle("minecraft:basic_smoke_particle", { x: F.x, y: F.y, z: F.z }); if (F.t === 40) F.dim.playSound("firework.blast", { x: F.x, y: F.y, z: F.z }, { volume: 4 }); }
      else { F.y -= 0.12; F.x += F.vx; F.z += F.vz; F.dim.spawnParticle("war:flare", { x: F.x, y: F.y, z: F.z }); }
      // its light: a few light blocks a little above the ground under it, moved as it drifts (every ~1.5 s)
      if (F.t > 40 && F.t % 30 === 0 && lightPerm()) {
        const want = new Set();
        for (const [ox, oz] of [[0, 0], [9, 0], [-9, 0], [0, 9], [0, -9]]) {
          let top; try { top = F.dim.getTopmostBlock({ x: F.x + ox, z: F.z + oz }); } catch {}
          if (!top || top.location.y + 4 > F.y) continue;
          const y = top.location.y + 4;
          const key = `${F.dim.id}|${Math.floor(F.x + ox)}|${y}|${Math.floor(F.z + oz)}`;
          want.add(key);
          if (!F.lights.has(key)) { try { const b = F.dim.getBlock({ x: Math.floor(F.x + ox), y, z: Math.floor(F.z + oz) }); if (b?.isAir) { b.setPermutation(LIGHT_PERM); F.lights.add(key); FLARE_LIGHTS.set(key, true); changed = true; } } catch {} }
        }
        for (const k of [...F.lights]) if (!want.has(k)) { unlight(k); F.lights.delete(k); FLARE_LIGHTS.delete(k); changed = true; }
      }
      if (F.t > 440 || F.y < -60) { for (const k of F.lights) { unlight(k); FLARE_LIGHTS.delete(k); } changed = true; FLARES.splice(i, 1); }
    } catch { FLARES.splice(i, 1); }
  }
  if (changed) saveFlareLights();
}, 2);

// ================================================================ v9.16: a human look
// (the game's own "look around" tipped heads straight up and down and spun them at random: gone) A man standing with
// nothing to deal with now and then glances along his sector, the head level, at a human pace, and comes back to where
// he was facing; a player walking up close gets a look.
const REST_YAW = new Map();      // id -> the way he settled facing
const GLANCE = new Map();        // id -> { yaw, until, back }
system.runInterval(() => {
  const now = tick();
  if (!PLAYER_POS.length || perfLevel() === "low") return;                          // (v9.19: nobody to see it, or the Low setting)
  for (const e of allOf(SOLDIER)) {
    try {
      const id = e.id;
      if (GLANCE.has(id) || downed.has(id) || pows.has(id) || isRiding(e) || gliders.has(id) || climbing.has(id) || personal.has(id) || now - (GUARD_ON.get(id) ?? -999) < 20 || perc.get(id)?.threat || P(e, "war:sit")) { if (!GLANCE.has(id)) REST_YAW.delete(id); continue; }
      const l0 = e.location;
      if (!PLAYER_POS.some((p) => p.d === e.dimension.id && Math.abs(p.x - l0.x) < 32 && Math.abs(p.z - l0.z) < 32)) continue;   // (nobody near to see him)
      const v = e.getVelocity(); if (Math.hypot(v.x, v.z) > 0.03) { REST_YAW.delete(id); continue; }
      if (!REST_YAW.has(id) && Math.random() > 0.3) continue;
      const cur = e.getRotation().y;
      if (!REST_YAW.has(id)) { REST_YAW.set(id, cur); continue; }
      if (Math.random() > 0.12) continue;                                                // (every few seconds, not in step)
      const rest = REST_YAW.get(id);
      let yaw = rest + (Math.random() * 2 - 1) * 65;
      const pl = PLAYERS_LIST.find((p) => { try { return p.dimension.id === e.dimension.id && dist(p.location, e.location) < 5; } catch { return false; } });
      if (pl && Math.random() < 0.5) yaw = (Math.atan2(-(pl.location.x - e.location.x), pl.location.z - e.location.z) * 180) / Math.PI;
      GLANCE.set(id, { yaw, until: now + 30 + Math.floor(Math.random() * 40), back: rest });
    } catch {}
  }
  if (now % 1200 < 20) { const live = new Set(allOf(SOLDIER).map((q) => q.id)); for (const id of [...REST_YAW.keys()]) if (!live.has(id)) REST_YAW.delete(id); }
}, 20);
system.runInterval(() => {
  const now = tick();
  for (const [id, g] of [...GLANCE]) {
    const e = world.getEntity(id);
    if (!e?.isValid || downed.has(id) || perc.get(id)?.threat || gunState.get(id)?.target || gliders.has(id) || personal.has(id)) { GLANCE.delete(id); continue; }
    try {
      const v = e.getVelocity(); if (Math.hypot(v.x, v.z) > 0.03) { GLANCE.delete(id); continue; }
      const want = now < g.until ? g.yaw : g.back, cur = e.getRotation().y;
      const diff = Math.abs(((want - cur + 540) % 360) - 180);
      if (diff > 1) e.setRotation({ x: 0, y: turnToward(cur, want, 7) });
      else if (now >= g.until) GLANCE.delete(id);
    } catch { GLANCE.delete(id); }
  }
}, 2);

// heads level: nobody to aim at, a head tipped far up or down (the game's walking glancing at a marker at his feet) is
// brought level at once. Only men a player could be watching.
system.runInterval(() => {
  if (!PLAYER_POS.length) return;
  for (const e of allOf(SOLDIER)) {
    try {
      if (gliders.has(e.id)) continue;                                                     // (the glider sets his level every step)
      const l = e.location;
      if (!PLAYER_POS.some((p) => p.d === e.dimension.id && Math.abs(p.x - l.x) < 32 && Math.abs(p.z - l.z) < 32)) continue;   // (close enough to see a head)
      const g = getJSON(e, "war:st", {}).g;                                                // (v9.19: read after the cheap checks)
      if (g !== "g_wp" && g !== "g_post" && g !== "g_owner") continue;                   // (only the game's own walking-to tips heads)
      if (downed.has(e.id) || climbing.has(e.id)) continue;
      const r = e.getRotation();
      if (Math.abs(r.x) <= 20) continue;
      const th = perc.get(e.id)?.threat ?? gunState.get(e.id)?.target;
      if (th?.isValid && (Math.abs(th.location.y - l.y) > 2 || flat(th.location, l) < 6)) continue;   // (aiming up or down at a real man, or one right in front of him: fine)
      e.setRotation({ x: 0, y: r.y });
    } catch {}
  }
}, 4);

// ================================================================ v9.18: who they are
// Every soldier has a surname and a rank in his faction's language (War Table > Settings > Callout language): change
// the language and the names change with it. Rank comes from experience (and the man running the squad is at least a
// sergeant); stripes on the arm show it. Each man also has a temperament, a buddy in his squad, a grudge when his buddy
// is killed, and medals for what he did in a battle.
// ranks: [private, senior private, corporal, sergeant, lieutenant]
// v9.19: a mixed language (American: US English + AAVE) makes each man one or the other, for good: his voice and his
// name follow it. The "Mixed heritage names" setting gives about one man in seven a surname from another culture.
function heritage(e, lang) { const mx = MIXES[lang]; if (!mx) return lang; const r = (Math.floor(idSeed(e) / 1000) % 1000) / 1000; let acc = 0; for (const [k, w] of mx) { acc += w; if (r < acc) return k; } return mx[mx.length - 1][0]; }
function voiceOfMan(e) { try { return heritage(e, groupOf(e, Number(P(e, "war:faction") ?? 0)).lang); } catch { return "en_us"; } }
const CULTURE_KEYS = Object.keys(CULTURE);
const cultureOf = (f) => CULTURE[voiceOf(f)] ?? CULTURE[MIXES[voiceOf(f)]?.[0]?.[0]] ?? CULTURE.en_us;
const cultureOfMan = (e) => CULTURE[voiceOfMan(e)] ?? CULTURE.en_us;      // ("None (silent)" names like US English)
function nameCulture(e) {
  const c = cultureOfMan(e), sd0 = idSeed(e);
  if (setting("mixnames", false) && Math.floor(sd0 / 7) % 7 === 0) return CULTURE[CULTURE_KEYS[Math.floor(sd0 / 49) % CULTURE_KEYS.length]] ?? c;
  return c;
}
const RANK_XP = [0, 4, 10, 20];                                        // xp for pvt / senior pvt / cpl / sgt (veteran)
// v9.19: who he is, in one small saved record ("war:id"): name seed, experience, temperament, nickname, surname shift,
// and the counts that earn a nickname. Men saved before are moved over the first time they're read.
const ID_CACHE = new Map();
const ID_OLD = ["war:nseed", "war:xp", "war:trait", "war:nick", "war:noff", "war:nk_kill", "war:nk_save", "war:nk_lucky"];
function idRec(e) {
  let r = ID_CACHE.get(e.id); if (r) return r;
  try { const raw = gdp(e, "war:id"); if (raw) r = JSON.parse(String(raw)); } catch {}
  if (!r) {
    r = {};
    const o = Object.fromEntries(ID_OLD.map((k) => [k, gdp(e, k)]));
    if (o["war:nseed"] !== undefined) r.s = Number(o["war:nseed"]);
    if (o["war:xp"] !== undefined) r.x = Number(o["war:xp"]);
    if (o["war:trait"] !== undefined) r.t = String(o["war:trait"]);
    if (o["war:nick"]) r.n = String(o["war:nick"]);
    if (o["war:noff"]) r.o = Number(o["war:noff"]);
    for (const k of ["kill", "save", "lucky"]) if (o[`war:nk_${k}`]) (r.c ??= {})[k] = Number(o[`war:nk_${k}`]);
    if (r.s === undefined) r.s = Math.floor(Math.random() * 1000000);
    idSave(e, r);
    for (const k of ID_OLD) if (o[k] !== undefined) try { sdp(e, k, undefined); } catch {}
  }
  ID_CACHE.set(e.id, r);
  return r;
}
function idSave(e, r) { ID_CACHE.set(e.id, r); try { sdp(e, "war:id", JSON.stringify(r)); } catch {} }
system.runInterval(() => { for (const id of [...ID_CACHE.keys()]) if (!world.getEntity(id)) ID_CACHE.delete(id); }, 2400);
function idSeed(e) { return Number(idRec(e).s ?? 0); }
const xpOf = (e) => Number(idRec(e).x ?? 0);
function vetTier(e) { const x = xpOf(e); return x >= RANK_XP[3] ? 3 : x >= RANK_XP[2] ? 2 : x >= RANK_XP[1] ? 1 : 0; }
let OFFICER_IDS = new Set();
const NAME_KEY = new Map();   // id -> the language and rank his name tag was made with
function rankTier(e) { const v = vetTier(e); return OFFICER_IDS.has(e.id) ? (v >= 3 ? 4 : 3) : v; }
function surname(e) { const c = nameCulture(e); return c.names[(idSeed(e) + Number(idRec(e).o ?? 0)) % c.names.length]; }
function firstName(e) { const c = nameCulture(e), f = c.first ?? []; return f.length ? f[Math.floor(idSeed(e) / 997) % f.length] : ""; }
function nickOf(e) { try { return String(idRec(e).n ?? ""); } catch { return ""; } }
function soldierName(e) { try { const c = cultureOfMan(e), nk = nickOf(e); return `${c.ranks[rankTier(e)]} ${nk ? `"${nk}" ` : ""}${surname(e)}`; } catch { return "Soldier"; } }
function fullName(e) { try { const c = cultureOfMan(e), nk = nickOf(e), fn = firstName(e); return `${c.ranks[rankTier(e)]} ${fn ? `${fn} ` : ""}${nk ? `"${nk}" ` : ""}${surname(e)}`; } catch { return "Soldier"; } }
// v9.19: nicknames, earned: the first one he earns sticks
function nickCount(e, k) {
  try {
    if (!e?.isValid || e.typeId !== SOLDIER || nickOf(e)) return;
    const R = idRec(e), n = Number(R.c?.[k] ?? 0) + 1; (R.c ??= {})[k] = n; idSave(e, R);
    const w = sd(e).weapon;
    const nick = k === "save" && n >= 3 ? "Doc" : k === "lucky" && n >= 3 ? "Lucky" : k === "kill" && n >= 8 ? (w === "sniper" ? "Hawkeye" : w === "mg" ? "Buzzsaw" : w === "shotgun" ? "Boom" : !GUNS.includes(w) ? "Butcher" : traitOf(e) === "hothead" ? "Mad Dog" : "Deadeye") : "";
    if (!nick) return;
    R.n = nick; idSave(e, R); NAME_KEY.delete(e.id); updateName(e);
    radio(e, `${surname(e)}'s squad calls him "${nick}" now`, "story");
  } catch {}
}
const TRAITS = { brave: "Brave", cautious: "Cautious", hothead: "Hothead", steady: "Steady" };
function traitOf(e) {
  const R = idRec(e);
  if (R.t === undefined) { const r = Math.random(); R.t = r < 0.18 ? "brave" : r < 0.4 ? "cautious" : r < 0.47 ? "hothead" : "steady"; idSave(e, R); }
  return String(R.t);
}
// how steady he is under stress (subtracted from his stress): veterans and the brave hold; the cautious less so
const nerveOf = (e) => vetTier(e) * 0.7 + ({ brave: 1.5, hothead: 1, cautious: -1 }[traitOf(e)] ?? 0);
// how badly hurt before he pulls back on his own
const retreatHp = (e) => ({ brave: 0.2, hothead: 0.15, cautious: 0.42 }[traitOf(e)] ?? 0.3);
// veterans shoot straighter
const vetAim = (e) => [1, 0.92, 0.84, 0.76][vetTier(e)];
function showRank(e) { try { setP(e, "war:vet", vetTier(e)); updateName(e); } catch {} }
// ---- credit: who hit whom (our own rounds carry no attacker, so they're noted here)
const SHOT_BY = new Map();   // victim id -> { id, t }
const KILLS = new Map(), SAVES = new Map(), WOUNDS = new Map();   // id -> [ticks] (for medals: what he did in this battle)
const logTo = (m, id, now) => { const a = m.get(id) ?? []; a.push(now); m.set(id, a.filter((t) => now - t < 12000)); };
function lastAttacker(v, now) {
  const s = SHOT_BY.get(v.id), h = hurtBy.get(v.id);
  const best = s && (!h || s.t >= h.t) ? s : h;
  return best && now - best.t < 200 ? world.getEntity(best.id) : undefined;
}
function giveXp(e, n) {
  if (!e?.isValid || e.typeId !== SOLDIER) return;
  const before = vetTier(e);
  { const R = idRec(e); R.x = xpOf(e) + n; idSave(e, R); }
  if (vetTier(e) !== before) { showRank(e); radio(e, `${soldierName(e)} has been promoted`, "story"); }
}
function creditSave(e) { if (e?.typeId === SOLDIER) { logTo(SAVES, e.id, tick()); giveXp(e, 1); nickCount(e, "save"); } }
const GRUDGE = new Map();    // id -> { id (the enemy), until }
const GRIEF = new Map();     // id -> tick his grief eases (stress)
world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const v = ev.deadEntity; if (v?.typeId !== SOLDIER) return;
    const now = tick(), k = ev.damageSource?.damagingEntity?.typeId === SOLDIER ? ev.damageSource.damagingEntity : lastAttacker(v, now);
    if (k?.typeId === SOLDIER && k.id !== v.id && isHostile(Number(P(k, "war:faction") ?? 0), Number(P(v, "war:faction") ?? 0))) { logTo(KILLS, k.id, now); giveXp(k, 3); nickCount(k, "kill"); }
    // his buddy: rage (a grudge against the man who did it) or grief
    const bid = gdp(v, "war:buddy"), b = bid ? world.getEntity(String(bid)) : undefined;
    if (b?.isValid && !downed.has(b.id) && dist(b.location, v.location) < 40) {
      const t = traitOf(b);
      if (k?.isValid && (t === "brave" || t === "hothead" || Math.random() < 0.55)) { GRUDGE.set(b.id, { id: k.id, until: now + 2400 }); radio(b, `${soldierName(b)}: they got ${surname(v)}! I'm going after him`, "story"); v9stat("grudge"); }
      else { GRIEF.set(b.id, now + 600); radio(b, `${soldierName(b)} saw his buddy ${surname(v)} go down`, "story"); v9stat("grief"); }
      sdp(b, "war:buddy", undefined);
    }
  } catch {}
});
system.runInterval(() => { const now = tick(); for (const [k, g] of [...GRUDGE]) if (now > g.until || !world.getEntity(g.id)) GRUDGE.delete(k); for (const [k, t] of [...GRIEF]) if (now > t) GRIEF.delete(k); for (const m of [KILLS, SAVES, WOUNDS, SHOT_BY]) if (m.size > 3000) m.clear(); }, 200);
// ---- buddies: pairs in each squad, kept close in mind (he goes for his buddy first when he's hit)
system.runInterval(() => {
  for (const S of squads.values()) {
    try {
      if (!S.ours?.length) continue;
      const live = S.ours.filter((o) => o.isValid && !downed.has(o.id));
      const ids = new Set(live.map((o) => o.id));
      const byId = new Map(live.map((o) => [o.id, o]));
      const free = live.filter((o) => { const b = gdp(o, "war:buddy"); return !b || !ids.has(String(b)) || gdp(byId.get(String(b)), "war:buddy") !== o.id; });
      while (free.length >= 2) {
        const a = free.shift(); let bi = 0, bd = 1e9;
        free.forEach((o, i) => { const dd = dist(o.location, a.location); if (dd < bd) { bd = dd; bi = i; } });
        const b = free.splice(bi, 1)[0];
        sdp(a, "war:buddy", b.id); sdp(b, "war:buddy", a.id);
      }
      // v9.19: no two men in a squad with the same surname: the newer one is somebody else (same heritage)
      const seen = new Set();
      for (const o of S.ours) {
        if (!o.isValid) continue;
        let nm = surname(o);
        if (seen.has(nm)) {
          for (let k = 1; k < 60 && seen.has(nm); k++) { const R = idRec(o); R.o = k * 7; idSave(o, R); nm = surname(o); }   // (only his surname changes: his group, voice and skin stay)
          NAME_KEY.delete(o.id); updateName(o); syncSkin(o);
        }
        seen.add(nm);
      }
    } catch {}
  }
}, 200);
// ---- after a battle: experience for everyone who came through it, and medals for what they did
// medals (bits): 1 Valor (3+ enemies in one fight), 2 Lifesaver (got a wounded man back on his feet or out of the fire),
// 4 Wound (went down and lived)
function afterBattle(S, ours, now) {
  const since = S.contactT >= 0 ? S.contactT : now - 2400;
  // v9.19: the sergeant counts heads on the radio, and the squad closes up on him
  try {
    const sgt = ours.find((o) => OFFICER_IDS.has(o.id)) ?? [...ours].sort((a, b) => rankTier(b) - rankTier(a))[0];
    if (sgt) {
      const n0 = Math.max(S.startN ?? ours.length, ours.length), hurt = (S.ours ?? []).filter((o) => o.isValid && downed.has(o.id)).length, lost = Math.max(0, n0 - ours.length - hurt);
      radio(sgt, `${soldierName(sgt)}: head count, ${ours.length} of ${n0} on their feet${hurt ? `, ${hurt} wounded` : ""}${lost ? `, ${lost} lost` : ""}`, "story");
      const sl = sgt.location; let i = 0;
      for (const o of ours) {
        if (o === sgt || ANCHORED.includes(sd(o).func) || ["charge", "follow", "escort"].includes(sd(o).func) || flat(o.location, sl) < 10) continue;
        const a = (i++ / Math.max(1, ours.length)) * Math.PI * 2, to = walkableNear(o.dimension, sl.x + Math.cos(a) * 3, sl.z + Math.sin(a) * 3, sl.y);
        if (to) planPersonalTo(o, "regroup", to, now);
      }
      if (i) v9stat("regroup");
    }
  } catch {}
  const cnt = (m, id) => (m.get(id) ?? []).filter((t) => t >= since).length;
  for (const e of ours) {
    try {
      if (!e.isValid) continue;
      giveXp(e, 1);
      let m = Number(P(e, "war:medals") ?? 0), got = [];
      if (cnt(KILLS, e.id) >= 3 && !(m & 1)) { m |= 1; got.push("the Valor medal"); }
      if (cnt(SAVES, e.id) >= 1 && !(m & 2)) { m |= 2; got.push("the Lifesaver medal"); }
      if (cnt(WOUNDS, e.id) >= 1 && !(m & 4)) { m |= 4; got.push("the Wound medal"); }
      if (got.length) { setP(e, "war:medals", m); radio(e, `${soldierName(e)} earned ${got.join(" and ")}`, "story"); v9stat("medal", got.length); }
    } catch {}
  }
}
// ---- the unit card: crouch and look at a soldier
system.runInterval(() => {
  for (const p of PLAYERS_LIST) {
    try {
      if (!p.isValid || !p.isSneaking) continue;
      const hit = p.getEntitiesFromViewDirection({ maxDistance: 48 }).find((h) => h.entity.typeId === SOLDIER);
      if (!hit) continue;
      const e = hit.entity, d = sd(e), h = hpOf(e);
      const wpn = GUNS.includes(d.weapon) ? (WEAPONS.find((w) => w[0] === d.weapon)?.[1] ?? d.weapon) : d.weapon === "spear" ? "Spear" : d.ranged ? "Crossbow" : "Sword";
      const med = Number(P(e, "war:medals") ?? 0), meds = [med & 1 ? "§6Valor" : "", med & 2 ? "§aLifesaver" : "", med & 4 ? "§5Wound" : ""].filter(Boolean).join(" ");
      const bud = gdp(e, "war:buddy"), be = bud ? world.getEntity(String(bud)) : undefined;
      const fc = COLORS[(Number(d.faction) || 1) - 1]?.[1] ?? "§7";
      const doing = notes.get(e.id)?.text ?? (downed.has(e.id) ? "wounded" : "standing by");
      const sv = suppB.get(e.id) ?? 0, sup = sv >= 2 ? ` · §6${sv > 14 ? "pinned" : "under fire"} ${"▮".repeat(Math.min(5, Math.ceil(sv / 4)))}§8${"▯".repeat(5 - Math.min(5, Math.ceil(sv / 4)))}§7` : "";
      p.onScreenDisplay.setActionBar(`${fc}${fullName(e)}§r §7${DIV[d.div]?.name ?? "Soldier"} · ${wpn} · §c${Math.ceil(h?.currentValue ?? 0)}/${Math.round(h?.effectiveMax ?? 0)}§7 · ${TRAITS[traitOf(e)]} · ${xpOf(e)} xp${be?.isValid ? ` · buddy ${surname(be)}` : ""}${meds ? ` · ${meds}` : ""}${sup}\n§8${doing}`);
    } catch {}
  }
}, 8);
// ---- hotheads: once in a while (rarely) one charges on his own, against orders
const HOT_CD = new Map();
let hotLastT = -99999;
system.runInterval(() => {
  const now = tick();
  if (now - hotLastT < 3600) return;                                        // (at most one every 3 minutes, all factions)
  for (const S of squads.values()) {
    try {
      if (!S.ours?.length || !S.known?.size || S.contactT < 0 || now - S.contactT < 200) continue;
      for (const e of S.ours) {
        if (!e.isValid || downed.has(e.id) || traitOf(e) !== "hothead" || now < (HOT_CD.get(e.id) ?? 0) || personal.has(e.id) || isRiding(e)) continue;
        const d = sd(e); if (d.func === "post" || d.retreat || d.surr) continue;
        const t = perc.get(e.id)?.threat; if (!t?.isValid || dist(t.location, e.location) > 40) continue;
        if (Math.random() > 0.04) continue;
        HOT_CD.set(e.id, now + 24000); hotLastT = now;
        planPersonalTo(e, "engage", { x: t.location.x, y: t.location.y, z: t.location.z }, now);
        callout(e, "Charge!", { event: true }); radio(e, `${soldierName(e)} is charging on his own!`, "story"); note(e, "charging on his own"); v9stat("hotheadCharge");
        return;
      }
    } catch {}
  }
}, 40);

// ================================================================ v9.19: men who feel it
// Hit reactions (a flinch; a leg hit staggers him and he limps; an arm hit spoils his aim), pinned men keep their heads
// down and fire blind, a beaten squad of green troops can break and run until their sergeant rallies them, the badly
// wounded limp and call their medic by name, surrender is hands up on their knees (a white flag when a squad gives up),
// and a live grenade at a man's feet may come straight back.
const ARM_HIT = new Map();   // id -> tick his arm's better
const LIMP = new Map();      // id -> tick a leg wound eases
const REACT_T = new Map();   // id -> tick the reaction ends
world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const v = ev.hurtEntity; if (v?.typeId !== SOLDIER || !v.isValid || downed.has(v.id) || ev.damage < 1) return;
    const now = tick(), lh = lastHit.get(v.id), fresh = lh && now - lh.t <= 1;
    let kind = 1;
    if (fresh && lh.leg) { kind = 2; LIMP.set(v.id, now + 600); }
    else if (fresh && !lh.head && Math.random() < 0.22) { ARM_HIT.set(v.id, now + 300); }
    setP(v, "war:react", 0); system.run(() => { try { if (v.isValid) setP(v, "war:react", kind); } catch {} });   // (restarted each hit)
    REACT_T.set(v.id, now + (kind === 2 ? 12 : 7));
    if (!isRiding(v)) { const dir = fresh ? lh.dir : hitDir(v, ev.damageSource?.damagingEntity); if (dir) try { v.applyImpulse({ x: dir.x * (kind === 2 ? 0.16 : 0.08), y: 0, z: dir.z * (kind === 2 ? 0.16 : 0.08) }); } catch {} }   // (knocked back a step)
  } catch {}
});
system.runInterval(() => {
  const now = tick();
  for (const [id, t] of [...REACT_T]) if (now >= t) { REACT_T.delete(id); const e = world.getEntity(id); if (e?.isValid) setP(e, "war:react", 0); }
}, 2);
// limping: a leg wound, or simply badly hurt; it eases as he heals
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      if (!LIMP.has(e.id) && !P(e, "war:limp") && now - Number(gdp(e, "war:hurt") ?? -99999) > 2400) continue;   // (never hurt lately: nothing to check)
      const h = hpOf(e), r = h ? h.currentValue / h.effectiveMax : 1;
      if (LIMP.has(e.id) && (r > 0.95 || now > LIMP.get(e.id))) LIMP.delete(e.id);   // (a leg wound: ~30 s, or till he's mended)
      const want = !downed.has(e.id) && !isRiding(e) && (LIMP.has(e.id) || r < 0.35);
      if (!!P(e, "war:limp") !== want) setP(e, "war:limp", want);
      if (want) e.addEffect("slowness", 50, { amplifier: LIMP.has(e.id) ? 1 : 0, showParticles: false });
    } catch {}
  }
  if (now % 1200 < 40) { const live = new Set(allOf(SOLDIER).map((q) => q.id)); for (const m of [ARM_HIT, LIMP]) for (const id of [...m.keys()]) if (!live.has(id)) m.delete(id); }
}, 40);
// calling his medic by name
function callMedic(e) {
  try {
    const f = Number(P(e, "war:faction") ?? 0);
    const m = nearSnap(e.dimension.id, e.location, 40).find((c) => c.type === SOLDIER && !c.down && c.f === f && c.e.isValid && sd(c.e).div === "medic");
    if (m && Math.random() < 0.5) radio(e, `${soldierName(e)}: Medic! ${surname(m.e)}, over here!`, "story");
  } catch {}
}
// ---- breaking as a squad, and the rally
function breakNow(e, d, now) {
  if (shaken.has(e.id)) return false;
  const t = perc.get(e.id)?.threat, p = e.location;
  let spot;
  const rally = nearestFlag(e.dimension, p, (f) => !!P(f, "war:rally") && isFriendly(d.faction, Number(P(f, "war:faction"))), 64);
  if (rally) spot = walkableNear(e.dimension, rally.location.x, rally.location.z, rally.location.y);
  if (!spot && t?.isValid) { const dx = p.x - t.location.x, dz = p.z - t.location.z, L = Math.hypot(dx, dz) || 1; spot = walkableNear(e.dimension, p.x + (dx / L) * 25, p.z + (dz / L) * 25, p.y); }
  if (!spot) return false;
  const slot = makeWaypoint(e.dimension, spot); if (!slot) return false;
  shaken.set(e.id, { slot, at: spot, until: now + 400, key: breakKey(e, d) });
  note(e, "shaken: running");
  return true;
}
system.runInterval(() => {
  const now = tick();
  for (const S of squads.values()) {
    try {
      if (!S.ours?.length || now - S.t > 40) continue;
      const ours = S.ours.filter((o) => o.isValid && !downed.has(o.id) && !sd(o).surr);
      // rout: a squad that's lost half its men and is still losing, with no veterans to steady it
      if (S.known?.size && S.contactT >= 0 && S.routFor !== S.contactT && (S.startN ?? 0) >= 4 && ours.length <= S.startN / 2 && (S.ratio ?? 1) < 0.8) {
        const green = ours.filter((o) => vetTier(o) < 2 && traitOf(o) !== "brave" && !OFFICER_IDS.has(o.id) && sd(o).func !== "post" && sd(o).div !== "guard");   // (the sergeant holds)
        if (green.length >= Math.ceil(ours.length / 2) && Math.random() < 0.35) {
          S.routT = now; S.routFor = S.contactT; S.rallied = false; let n = 0;
          for (const o of green) if (breakNow(o, sd(o), now)) n++;
          if (n) {
            callout(green[0], "Fall back!", { event: true }); radio(green[0], `${squadName(sd(green[0]).faction, sd(green[0]).squad)} is breaking!`, "story"); v9stat("rout");
            try {   // (v9.19: whoever has smoke throws it between them and the enemy as they go)
              const kn = [...S.known.values()][0], sm = ours.find((o) => canSmoke(o, sd(o), now));
              if (kn && sm) { const l = sm.location, dx = kn.x - l.x, dz = kn.z - l.z, L = Math.hypot(dx, dz) || 1, k = Math.min(8, L / 2); throwSmoke(sm, { x: l.x + (dx / L) * k, y: l.y, z: l.z + (dz / L) * k }, "covering the retreat"); callout(sm, "Smoke out!", { event: true }); }
            } catch {}
          }
        }
      }
      // the rally: their sergeant, still standing, calls them back to him
      if (S.routT && S.routFor === S.contactT && now - S.routT > 80 && !S.rallied) {
        const off = ours.find((o) => OFFICER_IDS.has(o.id) && !shaken.has(o.id)) ?? ours.find((o) => (vetTier(o) >= 2 || traitOf(o) === "brave") && !shaken.has(o.id));
        if (off) {
          S.rallied = true; let n = 0;
          for (const o of ours) { const sk = shaken.get(o.id); if (sk && dist(o.location, off.location) < 32) { sk.recoverUntil = now + 10 + Math.floor(Math.random() * 30); n++; } }
          if (n) { callout(off, "Follow me!", { event: true }); radio(off, `${soldierName(off)} rallies the squad`, "story"); v9stat("rally"); }
        }
      }
      if (!S.known?.size) { S.routT = undefined; S.rallied = undefined; S.routFor = undefined; S.whiteFor = undefined; }
      // the white flag: a few men left, hurt, heavily outnumbered and nobody coming
      if (S.known?.size && setting("isosurr", true) && S.whiteFor !== S.contactT && ours.length && ours.length <= 3 && S.known.size >= ours.length * 3) {
        const hr = ours.reduce((t, o) => { const h = hpOf(o); return t + (h ? h.currentValue / h.effectiveMax : 1); }, 0) / ours.length;
        if (hr < 0.55 && !ours.some((o) => traitOf(o) === "brave" && vetTier(o) >= 2) && Math.random() < 0.3) {
          S.whiteFor = S.contactT;
          let near; for (const q of S.known.values()) if (q.ent?.isValid) { near = q.ent; break; }
          const fac = near ? factionOf(near) : 0;
          ours.forEach((o, i) => { isoSurrender(o, fac); if (i === 0) system.runTimeout(() => { try { if (o.isValid) equip(o, "banner 1 15"); } catch {} }, 3); });
          radio(ours[0], `${squadName(sd(ours[0]).faction, sd(ours[0]).squad)} raised a white flag`, "story"); v9stat("whiteFlag");
        }
      }
    } catch {}
  }
}, 40);
// ---- a grenade thrown back: the arc goes from him to the man who threw it, the fuse keeps burning
function throwBack(G, e, now) {
  try {
    if (!e?.isValid || isRiding(e) || shaken.has(e.id)) return false;
    G.tried ??= new Set(); if (G.tried.has(e.id)) return false; G.tried.add(e.id);
    const ef = Number(P(e, "war:faction") ?? 0), bf = G.by?.isValid ? factionOf(G.by) : 0;
    if (!bf || !isHostile(ef, bf)) return false;
    const chance = 0.18 + vetTier(e) * 0.1 + (traitOf(e) === "brave" ? 0.12 : traitOf(e) === "cautious" ? -0.08 : 0);
    if (Math.random() > chance) return false;
    const to = G.by.location, from = headLoc(e), dd = dist(to, e.location);
    if (dd < 6 || dd > 28) return false;
    const g = walkableNear(G.dim, to.x + (Math.random() - 0.5) * 2, to.z + (Math.random() - 0.5) * 2, to.y) ?? to;
    const T = Math.round(8 + dd * 0.6);
    turnTo(e, to, 180);
    G.back = true; G.at = { x: g.x, y: g.y, z: g.z }; G.by = e; G.seen = new Map();
    G.boom = Math.max(G.boom, now + T + 4);
    for (let k = 1; k <= T; k += 2) system.runTimeout(() => { try { const u = k / T, h = Math.max(2.5, dd * 0.3); G.dim.spawnParticle("minecraft:basic_smoke_particle", { x: from.x + (g.x - from.x) * u, y: from.y + (g.y + 0.3 - from.y) * u + 4 * h * u * (1 - u), z: from.z + (g.z - from.z) * u }); } catch {} }, k);
    callout(e, "Grenade!", { event: true });
    radio(e, `${soldierName(e)} threw a grenade back!`, "story"); v9stat("nadeBack");
    return true;
  } catch { return false; }
}

// ================================================================ v9.20: tactics
// ---- ammo: every gunner carries so many rounds besides the ones in his gun. In a long fight he runs low: he asks a
// squad mate (who throws him some), and refills at a friendly truck or rally flag, or from the packs in a quiet spell.
// Out of rounds altogether, he fixes his bayonet. (His pistol has its own ammo: unlimited.)
const AMMO_START = { rifle: 50, semi: 64, smg: 140, mg: 240, shotgun: 30, pistol: 35, sniper: 25, at: 3 };
const RESERVE = new Map();   // id -> rounds carried
const OUT_OF = new Map();    // id -> tick he ran dry
function reserveOf(e) { const w = sd(e).weapon; let r = RESERVE.get(e.id); if (r === undefined) { r = AMMO_START[w] ?? 60; RESERVE.set(e.id, r); } return r; }
function reloadGun(e, st, spec) {
  if (!AMMO_LIMITED || ARM.get(e.id)?.arm === "pistol" || spec === NEST_SPEC) { st.ammo = spec.mag; return true; }   // (v9.21.4: ammo never runs out; the reload still takes its time)
  const r = reserveOf(e);
  if (r <= 0) {
    st.ammo = 0;
    if (!OUT_OF.has(e.id)) { OUT_OF.set(e.id, tick()); note(e, "out of ammo"); radio(e, `${soldierName(e)} is out of ammo`, "story"); v9stat("outOfAmmo"); }
    return false;
  }
  const n = Math.min(spec.mag, r); RESERVE.set(e.id, r - n); st.ammo = n;
  if (r - n <= spec.mag * 2 && !OUT_OF.has(e.id) && Math.random() < 0.3) note(e, "low on ammo");
  return true;
}
function giveAmmo(e, n) { const w = sd(e).weapon, cap = (AMMO_START[w] ?? 60) * 1.2; RESERVE.set(e.id, Math.min(cap, reserveOf(e) + n)); if (OUT_OF.has(e.id)) { OUT_OF.delete(e.id); note(e, "got ammo"); } }
system.runInterval(() => {
  if (!AMMO_LIMITED) { RESERVE.clear(); OUT_OF.clear(); return; }
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e); if (!GUNS.includes(d.weapon) || downed.has(e.id)) continue;
      const start = AMMO_START[d.weapon] ?? 60, r = reserveOf(e), mag = GUN_SPEC[d.weapon]?.mag ?? 1;
      if (r >= start) continue;
      const quiet = now - (gunState.get(e.id)?.lastShot ?? -9999) > 600 && !perc.get(e.id)?.threat;
      const f = d.faction;
      const depot = vehicleList.some((v) => v.typeId === "war:truck" && v.dimension.id === e.dimension.id && dist(v.location, e.location) < 8 && isFriendly(f, vehicleFaction(v))) ||
        !!nearestFlag(e.dimension, e.location, (fl) => isFriendly(f, Number(P(fl, "war:faction"))), 8) || !!crateNear(e);
      if (depot || quiet) { giveAmmo(e, depot ? Math.max(mag, Math.ceil(start / 4)) : Math.ceil(start / 3)); continue; }
      // low: a squad mate within a stone's throw shares
      if (r <= mag && now - (OUT_OF.get(e.id) ?? now) >= 0) {
        for (const c of nearSnap(e.dimension.id, e.location, 10)) {
          if (c.type !== SOLDIER || c.id === e.id || c.down || c.f !== f || !c.e.isValid || sd(c.e).weapon !== d.weapon) continue;
          const cr = reserveOf(c.e); if (cr < mag * 4) continue;
          const n = Math.max(mag, Math.floor(cr / 3)); RESERVE.set(c.id, cr - n); giveAmmo(e, n);
          note(e, `ammo from ${surname(c.e)}`); v9stat("ammoShared"); break;
        }
      }
    } catch {}
  }
  if (now % 1200 < 40) { const live = new Set(allOf(SOLDIER).map((q) => q.id)); for (const id of [...RESERVE.keys()]) if (!live.has(id)) { RESERVE.delete(id); OUT_OF.delete(id); } }
}, 40);
// dry: bayonet
WarAPI.on("think", (e, d, want) => { if (OUT_OF.has(e.id) && GUNS.includes(d.weapon) && !d.surr) { want.w = "w_melee"; want.t = "t_short"; want.r = "r_on"; } });


// ---- formations by the ground: a column on a road or through a narrow way, a line once the enemy is about, a wedge
// across open ground
function chooseShape(m, dim, at, members) {
  const now = tick();
  if (m.shapeT && now - m.shapeT < 100) return m.shapeNow;                   // (no flapping: a shape holds ~5 s)
  let shape = "line";
  { const e0 = members?.[0]; const fs = e0 ? forcedShape(sd(e0).faction, sd(e0).squad || 0) : undefined; if (fs) { m.shapeT = now; m.shapeNow = fs; return fs; } }   // (v9.19: the one you picked)
  try {
    const e0 = members?.[0], S = e0 ? squads.get(squadKey(e0, sd(e0))) : undefined;
    const contact = !!S?.known?.size || (S?.contactT ?? -1) >= 0 && now - (S?.t ?? 0) < 200 && S.known?.size;
    const h = m.heading ?? 0, rx = -Math.sin(h), rz = Math.cos(h);
    let wide = 0; for (const k of [-3, -2, -1, 1, 2, 3]) { const w = walkableNear(dim, at.x + rx * k * 1.5, at.z + rz * k * 1.5, at.y); if (w && Math.abs(w.y - at.y) <= 1) wide++; }
    let road = false; try { const b = dim.getBlock({ x: Math.floor(at.x), y: Math.floor(at.y) - 1, z: Math.floor(at.z) }); road = !!b && /path|gravel|cobblestone|stone_brick|planks|slab/.test(b.typeId); } catch {}
    if (contact) shape = wide >= 4 ? "line" : "column";
    else if (wide <= 2 || road) shape = "column";
    else if ((members?.length ?? 0) >= 4 && wide >= 5) shape = "wedge";
  } catch {}
  m.shapeT = now; m.shapeNow = shape;
  return shape;
}

// ---- snipers: a spot back from the squad with a long view; after a few shots (or once shot at) a new one
const SNIPE = new Map();   // id -> { shots, at, t }
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e); if (d.weapon !== "sniper" || downed.has(e.id) || isRiding(e) || d.func === "post" || d.retreat) continue;
      const st = gunState.get(e.id), t = perc.get(e.id)?.threat ?? st?.target;
      let sn = SNIPE.get(e.id); if (!sn) { sn = { shots: 0, last: st?.lastShot ?? -1, t: 0 }; SNIPE.set(e.id, sn); }
      if (st?.lastShot !== undefined && st.lastShot !== sn.last) { sn.last = st.lastShot; sn.shots++; }
      const shotAtMe = now - (firedAt.get(e.id)?.t ?? -9999) < 40;
      if (!t?.isValid || personal.has(e.id) || now - sn.t < 200) continue;
      if (sn.shots < 3 && !shotAtMe) continue;
      // displace: a few blocks to the side and back, somewhere that still sees the enemy
      const l = e.location, dx = l.x - t.location.x, dz = l.z - t.location.z, L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L;
      let spot;
      for (const [side, back] of [[6, 3], [-6, 3], [9, 5], [-9, 5], [4, 7], [-4, 7]]) {
        const w = walkableNear(e.dimension, l.x + px * side + (dx / L) * back, l.z + pz * side + (dz / L) * back, l.y);
        if (w && Math.abs(w.y - l.y) < 3 && !dangerNear(e.dimension, w) && clearShot(e.dimension, { x: w.x, y: w.y + 1.6, z: w.z }, chest(t))) { spot = w; break; }
      }
      sn.t = now; sn.shots = 0;
      if (spot) { planPersonalTo(e, "settle", spot, now); note(e, "sniper: changing position"); v9stat("sniperMove"); }
    } catch {}
  }
  for (const id of [...SNIPE.keys()]) if (!world.getEntity(id)) SNIPE.delete(id);
}, 20);

// ---- clearing rooms: men going through a building they're attacking call each room clear, and one stays at the foot
// of the stairs watching up them until the squad goes up
const CLEAR_SAID = new Map();   // squad key -> { t, spots: [] }
const STAIR_WATCH = new Map();  // id -> { at, face, until }
system.runInterval(() => {
  const now = tick();
  for (const [k, S] of squads) {
    try {
      if (!S.ours?.length || S.bplan?.kind !== "attack") continue;
      const C = CLEAR_SAID.get(k) ?? { t: -999, spots: [] }; CLEAR_SAID.set(k, C);
      if (now - C.t > 60) for (const e of S.ours) {
        if (!e.isValid || downed.has(e.id) || perc.get(e.id)?.threat || !isIndoors(e)) continue;
        if (C.spots.some((p) => dist(p, e.location) < 6)) continue;
        if (nearSnap(e.dimension.id, e.location, 8).some((c) => !c.down && c.f && isHostile(sd(e).faction, c.f))) continue;
        C.spots.push({ ...e.location }); if (C.spots.length > 30) C.spots.shift();
        C.t = now; callout(e, "Clear!", { event: true }); note(e, "room clear"); v9stat("roomClear"); break;
      }
      // the stair watcher
      const fl = S.ours.filter((o) => o.isValid && !downed.has(o.id));
      if (fl.length < 4 || [...STAIR_WATCH.keys()].some((id) => fl.some((o) => o.id === id))) continue;
      const y0 = Math.min(...fl.map((o) => o.location.y));
      if (fl.some((o) => o.location.y > y0 + 2.5)) continue;                  // (someone's already up: no watch needed now)
      const st = STAIRS.find((q) => q.dimId === fl[0].dimension.id && Math.abs(q.foot.y - y0) < 1.5 && q.top.y > q.foot.y + 2 && fl.some((o) => dist(o.location, q.foot) < 12));
      if (!st) continue;
      const w = fl.filter((o) => !OFFICER_IDS.has(o.id) && GUNS.includes(sd(o).weapon)).sort((a, b) => dist(a.location, st.foot) - dist(b.location, st.foot))[0];
      if (!w) continue;
      const dx = st.foot.x - st.top.x, dz = st.foot.z - st.top.z, L = Math.hypot(dx, dz) || 1;
      const at = walkableNear(w.dimension, st.foot.x + (dx / L) * 2, st.foot.z + (dz / L) * 2, st.foot.y) ?? st.foot;
      STAIR_WATCH.set(w.id, { at, face: st.top, until: now + 600, k });
      note(w, "watching the stairs"); callout(w, "Covering!", { event: true });
    } catch {}
  }
  for (const [id, sw] of [...STAIR_WATCH]) { const S = squads.get(sw.k); const e = world.getEntity(id); if (!e?.isValid || now > sw.until || downed.has(id) || S?.bplan?.kind !== "attack" || (S?.ours ?? []).some((o) => o.isValid && o.location.y > sw.at.y + 2.5)) STAIR_WATCH.delete(id); }
}, 20);
WarAPI.registerBehavior({
  name: "stair watch", when: "first", priority: 80,
  decide(e, d, now) {
    const sw = STAIR_WATCH.get(e.id); if (!sw) return undefined;
    if (perc.get(e.id)?.threat?.isValid) return undefined;                   // (something to shoot: he shoots it)
    if (flat(sw.at, e.location) < 1.2) { turnTo(e, sw.face, 20); return { g: "g_none", t: "t_mid", urgent: false, note: "watching the stairs" }; }
    const slot = myMarker(e, sw.at); if (flat(sw.at, e.location) < 3.2) push(e, { x: (sw.at.x - e.location.x) * 0.2, y: 0.02, z: (sw.at.z - e.location.z) * 0.2 }, 3);
    return slot ? { g: "g_wp", slot, t: "t_mid", urgent: true, note: "watching the stairs" } : undefined;
  },
});

// ---- rearguard: when several of a squad fall back with the enemy in sight, one or two of the steadiest stay a few
// seconds and keep the enemy's heads down while the rest get away, then go themselves
const REARGUARD = new Map();   // id -> until
system.runInterval(() => {
  const now = tick();
  for (const S of squads.values()) {
    try {
      if (!S.ours?.length || !S.known?.size) continue;
      const back = S.ours.filter((o) => o.isValid && !downed.has(o.id) && (sd(o).retreat || shaken.has(o.id)));
      if (back.length < 2 || now - (S.rgT ?? -9999) < 600) continue;
      const cands = S.ours.filter((o) => o.isValid && !downed.has(o.id) && GUNS.includes(sd(o).weapon) && !shaken.has(o.id) && !REARGUARD.has(o.id))
        .map((o) => { const h = hpOf(o); return { o, sc: (h ? h.currentValue / h.effectiveMax : 1) + vetTier(o) * 0.3 + (traitOf(o) === "brave" ? 0.5 : traitOf(o) === "cautious" ? -0.5 : 0) }; })
        .filter((c) => c.sc > 0.6).sort((a, b) => b.sc - a.sc).slice(0, back.length >= 4 ? 2 : 1);
      if (!cands.length) continue;
      S.rgT = now;
      for (const { o } of cands) { REARGUARD.set(o.id, now + 200 + Math.floor(Math.random() * 60)); note(o, "rearguard"); }
      callout(cands[0].o, "I'll cover you!", { event: true }) || callout(cands[0].o, "Covering!", { event: true });
      radio(cands[0].o, `${soldierName(cands[0].o)} stays behind to cover the withdrawal`, "story"); v9stat("rearguard");
    } catch {}
  }
  for (const [id, t] of [...REARGUARD]) if (now > t || !world.getEntity(id)) REARGUARD.delete(id);
}, 40);
WarAPI.registerBehavior({
  name: "rearguard", when: "first", priority: 85,
  decide(e, d, now) {
    if (!REARGUARD.has(e.id) || d.retreat) return undefined;
    if (now > REARGUARD.get(e.id)) { REARGUARD.delete(e.id); return undefined; }
    return { g: "g_none", t: "t_mid", urgent: false, note: "rearguard: covering the withdrawal" };
  },
});

// ---- scouts: a squad on the move with no contact sends one man ~30 blocks ahead. What he sees, the squad only learns
// when he's back with them (so killing him matters); seeing the enemy, he turns back at once.
const SCOUTS = new Map();   // id -> { k, phase, to, intel: Map, t }
function scoutSaw(e, s, now) {
  const sc = SCOUTS.get(e.id); if (!sc) return;
  const ids = new Set([...s.seen.keys()]); if (s.threat?.isValid) ids.add(s.threat.id);
  for (const id of ids) { const o = world.getEntity(id); if (o?.isValid && !isMob(o)) sc.intel.set(id, { ent: o, x: o.location.x, y: o.location.y, z: o.location.z }); }
  if (sc.intel.size && sc.phase === "out") { sc.phase = "back"; sc.t = now; note(e, "scout: spotted them, heading back"); }
}
system.runInterval(() => {
  const now = tick();
  for (const [k, S] of squads) {
    try {
      if (!S.ours?.length) continue;
      // send one
      if (!S.known?.size && S.ours.length >= 4 && now - (S.scoutT ?? -99999) > 2400 && ![...SCOUTS.values()].some((q) => q.k === k)) {
        const lead = S.ours[0], d0 = sd(lead);
        const moving = d0.func === "charge" || (d0.func === "patrol" && d0.radius >= 24) || gdp(lead, "war:catchup") !== undefined;   // (v9.20.3: a small patrol sends nobody 30 blocks off)
        if (moving) {
          const c = S.ourC ?? lead.location, v = lead.getVelocity(), L = Math.hypot(v.x, v.z);
          if (L > 0.05) {
            const to = walkableNear(lead.dimension, c.x + (v.x / L) * 30, c.z + (v.z / L) * 30, c.y);
            const sc = S.ours.filter((o) => o.isValid && !OFFICER_IDS.has(o.id) && GUNS.includes(sd(o).weapon) && sd(o).div !== "medic" && !isRiding(o) && !personal.has(o.id))
              .sort((a, b) => (traitOf(b) === "brave") - (traitOf(a) === "brave"))[0];
            if (to && sc) {
              S.scoutT = now;
              SCOUTS.set(sc.id, { k, phase: "out", to, intel: new Map(), t: now });
              planPersonalTo(sc, "settle", to, now); note(sc, "scouting ahead"); radio(sc, `${soldierName(sc)} goes ahead to scout`, "story"); v9stat("scoutOut");
            }
          }
        }
      }
    } catch {}
  }
  for (const [id, sc] of [...SCOUTS]) {
    const e = world.getEntity(id), S = squads.get(sc.k);
    if (!e?.isValid || downed.has(id) || !S) { SCOUTS.delete(id); if (e?.isValid === false || !e) v9stat("scoutLost"); continue; }
    try {
      const home = S.ourC ?? e.location;
      if (sc.phase === "out" && (flat(e.location, sc.to) < 4 || (!personal.has(id) && now - sc.t > 40) || now - sc.t > 500)) { sc.phase = "back"; sc.t = now; }   // (v9.20.3: as far as his way goes: back now, not after 25 s standing out there)
      if (sc.phase === "back") {
        if (flat(e.location, home) < 10) {
          for (const [oid, q] of sc.intel) S.known.set(oid, { ...q, t: now });
          SCOUTS.delete(id);
          if (sc.intel.size) { const q = [...sc.intel.values()][0]; radio(e, `${soldierName(e)} reports: ${sc.intel.size} enemy ${bearing(home, q)}, about ${Math.round(flat(home, q))} blocks`, "story"); callout(e, "Contact!", { event: true }); v9stat("scoutReport"); }
          else note(e, "scout: all quiet ahead");
          continue;
        }
        const pr = personal.get(id);
        if (!pr || (!pr.planning && (!pr.pts || flat(pr.dest, home) > 8))) { sc.t = now; planPersonalTo(e, "settle", { x: home.x, y: home.y, z: home.z }, now); }   // (v9.20.3: a new route only when the squad's moved off from where his leads: every 5 s he stopped to work one out)
        note(e, "scout: heading back");
      }
      if (now - (sc.t0 ?? (sc.t0 = now)) > 1600) SCOUTS.delete(id);
    } catch { SCOUTS.delete(id); }
  }
}, 20);
// the scout keeps his head down: he doesn't start a fight on his own
WarAPI.on("think", (e, d, want) => { if (SCOUTS.has(e.id) && !(now0() - Number(gdp(e, "war:hurt") ?? -9999) < 60)) { want.t = "t_off"; } });
const now0 = () => tick();

// ---- feints: as the flankers go one way, two of the base of fire shift the other way and make a lot of noise there,
// so the enemy turns to face the wrong side
const FEINT = new Map();   // id -> { at, until }
function startFeint(S, base, oc, flankPt, now) {
  if (base.length < 4 || now - (S.feintT ?? -9999) < 1200) return;
  const dx = flankPt.x - oc.x, dz = flankPt.z - oc.z, L = Math.hypot(dx, dz) || 1;
  const at = walkableNear(base[0].dimension, oc.x - (dx / L) * 10, oc.z - (dz / L) * 10, oc.y);
  if (!at || dangerNear(base[0].dimension, at)) return;
  S.feintT = now;
  const pair = base.filter((e) => !OFFICER_IDS.has(e.id)).slice(-2);
  for (const e of pair) { FEINT.set(e.id, { at, until: now + 500 }); planPersonalTo(e, "settle", at, now); note(e, "feint: drawing their eyes"); }
  if (pair[0]) radio(pair[0], "two men making noise on the other side while the flank goes in", "story");
  v9stat("feint");
}
system.runInterval(() => { const now = tick(); for (const [id, f] of [...FEINT]) if (now > f.until || !world.getEntity(id)) FEINT.delete(id); }, 40);
// the feint fires at whatever it can see, and a lot of it (the noise is the point)
WarAPI.on("think", (e, d, want, now) => { const f = FEINT.get(e.id); if (f && flat(f.at, e.location) < 3) { const st = gunState.get(e.id); if (st && !st.target) { const q = [...(squads.get(squadKey(e, d))?.known?.values() ?? [])][0]; if (q?.ent?.isValid) st.supp = { p: { x: q.x, y: q.y + 1.2, z: q.z }, until: now + 30, ent: q.ent }; } } });

// ---- counterattacks: defenders who've just thrown an attack back (the attackers falling back, or few left) go after
// them for a short while, then return to their positions
system.runInterval(() => {
  const now = tick();
  for (const S of squads.values()) {
    try {
      if (!S.ours?.length || !S.known?.size || S.counter && now - S.counterT < 600) continue;
      const ours = S.ours.filter((o) => o.isValid && !downed.has(o.id) && !shaken.has(o.id));
      if (ours.length < 3 || !ours.every((o) => ["hold", "stand", "sentry"].includes(sd(o).func))) continue;
      const foes = [...S.known.values()].filter((q) => q.ent?.isValid && !downed.has(q.ent.id));
      if (!foes.length) continue;
      const fleeing = foes.filter((q) => q.ent.typeId === SOLDIER && (sd(q.ent).retreat || shaken.has(q.ent.id))).length;
      const beaten = fleeing >= Math.ceil(foes.length / 2) || ours.length >= foes.length * 2.5;
      if (!beaten || now - (S.contactT ?? now) < 300 || now - (S.counterT ?? -99999) < 2400) continue;
      if (Math.random() > 0.5) { S.counterT = now; continue; }
      S.counter = true; S.counterT = now; v9stat("counterattack");
      const q = foes.sort((a, b) => Math.hypot(a.x - (S.ourC?.x ?? 0), a.z - (S.ourC?.z ?? 0)) - Math.hypot(b.x - (S.ourC?.x ?? 0), b.z - (S.ourC?.z ?? 0)))[0];
      const go = ours.filter((o) => sd(o).func !== "post" && sd(o).div !== "medic").slice(0, Math.max(2, Math.ceil(ours.length * 0.6)));
      for (const o of go) { planPersonalTo(o, "engage", { x: q.x, y: q.y, z: q.z }, now); note(o, "counterattack!"); }
      callout(go[0], "Charge!", { event: true }); radio(go[0], "they're breaking, counterattack!", "story");
    } catch {}
  }
  for (const S of squads.values()) if (S.counter && (now - S.counterT > 600 || !S.known?.size)) S.counter = false;
}, 40);

// ---- traps: defenders settled in a building with no fight yet string a tripwire (with a charge) inside a door or two.
// It never breaks blocks; the string is taken away after ~5 minutes. Attackers may spot one and cut it, the better
// soldiers more often.
const TRAPS = [];          // { dim, at, f, until, spotted }
let WIRE;
const wirePerm = () => { if (WIRE !== undefined) return WIRE; for (const id of ["minecraft:trip_wire", "minecraft:tripwire"]) { try { WIRE = BlockPermutation.resolve(id); return WIRE; } catch {} } WIRE = null; return WIRE; };
function unwire(T) { try { const b = world.getDimension(T.dim).getBlock(T.at); if (b && /trip_?wire$/.test(b.typeId)) b.setType("minecraft:air"); } catch {} }
system.runInterval(() => {
  const now = tick();
  if (!wirePerm()) return;
  for (const S of squads.values()) {
    try {
      if (!S.ours?.length || S.known?.size || S.ours.length < 3 || now - (S.trapT ?? -99999) < 3000) continue;
      const e0 = S.ours.find((o) => o.isValid && isIndoors(o) && ["hold", "post", "stand"].includes(sd(o).func) && traitOf(o) !== "hothead");
      if (!e0) continue;
      const f = Number(sd(e0).faction ?? 0);
      if (TRAPS.filter((t) => t.f === f).length >= 4) continue;
      S.trapT = now;
      const dim = e0.dimension, l = e0.location;
      let placed = 0;
      for (let dx = -8; dx <= 8 && placed < 1; dx++) for (let dz = -8; dz <= 8 && placed < 1; dz++) for (const dy of [0, 1, -1]) {
        const b = dim.getBlock({ x: Math.floor(l.x) + dx, y: Math.floor(l.y) + dy, z: Math.floor(l.z) + dz });
        if (!b || !/_door$/.test(b.typeId) || b.typeId.includes("trapdoor")) continue;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = dim.getBlock({ x: b.location.x + ox, y: b.location.y, z: b.location.z + oz }), under = dim.getBlock({ x: b.location.x + ox, y: b.location.y - 1, z: b.location.z + oz });
          if (!c?.isAir || !under || under.isAir || passable(under)) continue;
          let roof = false; for (let k = 2; k <= 6 && !roof; k++) { const rb = dim.getBlock({ x: c.location.x, y: c.location.y + k, z: c.location.z }); if (rb && !rb.isAir && !passable(rb)) roof = true; }
          if (!roof) continue;                                                  // (the inside of the door: a roof over it; daylight through the doorway doesn't count)
          if (S.ours.some((o) => o.isValid && Math.floor(o.location.x) === c.location.x && Math.floor(o.location.z) === c.location.z)) continue;
          c.setPermutation(WIRE);
          const T = { dim: dim.id, at: { ...c.location }, f, until: now + 6000 };
          TRAPS.push(T); restoreList.push({ dim: dim.id, loc: { ...c.location }, typeId: "minecraft:air", placed: c.typeId, at: now + 6100 });
          placed++; note(e0, "rigged a tripwire"); v9stat("trapSet"); break;
        }
        if (placed) break;
      }
    } catch {}
  }
}, 100);
system.runInterval(() => {
  const now = tick();
  for (let i = TRAPS.length - 1; i >= 0; i--) {
    const T = TRAPS[i];
    try {
      if (now > T.until) { unwire(T); TRAPS.splice(i, 1); continue; }
      const c = { x: T.at.x + 0.5, y: T.at.y, z: T.at.z + 0.5 };
      for (const o of nearbyCombatants(T.dim, c, 5)) {
        if (o.typeId !== SOLDIER && !(o.typeId === "minecraft:player" && playerFair(o))) continue;
        const of = factionOf(o); if (!of || !isHostile(T.f, of) || (o.typeId === SOLDIER && downed.has(o.id))) continue;
        const dd = dist(o.location, c);
        if (o.typeId === SOLDIER && !T.spotted && dd < 4.5 && dd > 1.2 && Math.random() < 0.06 + vetTier(o) * 0.05 + (traitOf(o) === "cautious" ? 0.05 : 0)) {
          T.spotted = true; note(o, "spotted a tripwire"); callout(o, "Hold!", { event: true }) || callout(o, "Wait!", { event: true }); radio(o, `${soldierName(o)} found a tripwire and cut it`, "story"); v9stat("trapSpotted");
          unwire(T); TRAPS.splice(i, 1); break;
        }
        if (dd < 0.9 && Math.abs(o.location.y - T.at.y) < 1.2) {
          unwire(T); TRAPS.splice(i, 1);
          explode(world.getDimension(T.dim), { x: c.x, y: c.y + 0.3, z: c.z }, 2.4, { breaksBlocks: false, causesFire: false });
          v9stat("trapSprung"); break;
        }
      }
    } catch { TRAPS.splice(i, 1); }
  }
}, 4);

// ================================================================ v9.21: the world and the command
// ---- weather: rain and storms cut how far a man can make out another
let WEATHER_K = 1;
function setWeatherK(w) { const s = String(w ?? "").toLowerCase(); WEATHER_K = s.includes("thunder") ? 0.55 : s.includes("rain") ? 0.72 : 1; }
try { world.afterEvents.weatherChange.subscribe((ev) => { try { if (String(ev.dimension ?? "overworld").includes("overworld")) setWeatherK(ev.newWeather); } catch {} }); } catch {}
system.runTimeout(() => { try { setWeatherK(world.getDimension("overworld").getWeather?.()); } catch {} }, 40);

// ---- camp life at night: off duty with nothing going on, men sleep where they are, one in three keeps watch (and
// they take turns). The watch shouts at anything; a shot, a hit, an order or daylight and everybody's up.
const SLEEP = new Map();     // id -> tick he lay down
const WATCH = new Map();     // squad key -> { ids: Set, t }
function wake(e) { if (!SLEEP.has(e.id)) return; const b = SLEEP.get(e.id)?.bed; SLEEP.delete(e.id); if (b) BEDS_TAKEN.delete(b); try { setP(e, "war:sleep", false); if (!pows.has(e.id) && !sd(e).surr) equip(e, weaponItem(e)); } catch {} }   // (v9.23: he picks his rifle back up)
const BEDS_TAKEN = new Set();   // "x,y,z" of beds a man is sleeping in or walking to
const GOING_TO_BED = new Map(); // id -> { at, key, t }
function lieDown(o, now, bed) {
  try { if (IDLE.has(o.id)) { IDLE.delete(o.id); setP(o, "war:idle", 0); } } catch {}
  SLEEP.set(o.id, { t: now, bed: bed?.key });
  setP(o, "war:sleep", true); setP(o, "war:gun", 0);                                 // (the rifle laid down beside him, not sticking up out of him)
  try { const at = bed ? { x: bed.x + 0.5, y: bed.y + 0.56, z: bed.z + 0.5 } : o.location; o.teleport(at, { rotation: { x: 0, y: Math.random() * 360 } }); } catch {}   // (each his own way: not lined up)
  note(o, bed ? "asleep in a bed" : "asleep");
}
function findBed(o) {
  const l = o.location;
  for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) for (const dy of [0, 1, -1]) {
    try {
      const b = o.dimension.getBlock({ x: Math.floor(l.x) + dx, y: Math.floor(l.y) + dy, z: Math.floor(l.z) + dz });
      if (!b || b.typeId !== "minecraft:bed") continue;
      const key = `${b.location.x},${b.location.y},${b.location.z}`;
      if (BEDS_TAKEN.has(key)) continue;
      return { x: b.location.x, y: b.location.y, z: b.location.z, key };
    } catch {}
  }
  return undefined;
}
system.runInterval(() => {
  const now = tick();
  if (!NIGHT) { for (const id of [...SLEEP.keys()]) { const e = world.getEntity(id); if (e?.isValid) wake(e); else SLEEP.delete(id); } return; }
  for (const [k, S] of squads) {
    try {
      if (!S.ours?.length) continue;
      const busy = !!S.known?.size || (S.contactT >= 0 && now - S.t < 200 && S.known?.size);
      const men = S.ours.filter((o) => o.isValid && !downed.has(o.id) && !pows.has(o.id) && !isRiding(o));
      if (busy) { for (const o of men) if (SLEEP.has(o.id)) { wake(o); } continue; }
      if (men.length < 2) continue;
      // the watch: a third of them, rotating every ~2 minutes
      let W = WATCH.get(k);
      if (!W || now - W.t > 2400) { const off = W?.ids ?? new Set(); const pool = men.filter((o) => !off.has(o.id)); const n = Math.max(1, Math.ceil(men.length / 3)); W = { ids: new Set((pool.length >= n ? pool : men).slice(0, n).map((o) => o.id)), t: now }; WATCH.set(k, W); for (const id of W.ids) { const o = world.getEntity(id); if (o?.isValid) { wake(o); note(o, "on watch"); } } }
      // (v9.23: a third of them at most asleep at once, a third on watch, the rest awake about the camp)
      const maxAsleep = Math.max(1, Math.floor(men.length / 3));
      let asleep = men.filter((o) => SLEEP.has(o.id) || GOING_TO_BED.has(o.id)).length;
      for (const o of men) {
        if (asleep >= maxAsleep) break;
        if (W.ids.has(o.id) || SLEEP.has(o.id) || GOING_TO_BED.has(o.id)) continue;
        const d = sd(o); if (d.retreat || d.surr || seated.has(o.id) || personal.has(o.id) || now - Number(gdp(o, "war:ordt") ?? -99999) < 600 || now - Number(gdp(o, "war:hurt") ?? -99999) < 600) continue;
        if (["charge", "follow", "escort", "patrol"].includes(d.func) || d.div === "guard") continue;
        const v = o.getVelocity(); if (Math.hypot(v.x, v.z) > 0.02 || Math.random() > 0.2) continue;
        if (!PLAYER_POS.some((p) => p.d === o.dimension.id && Math.abs(p.x - o.location.x) < 64 && Math.abs(p.z - o.location.z) < 64)) continue;   // (nobody to see it: why bother)
        // a bed close by: he goes to it. Otherwise only under a roof, or out in the open on a dry night, never on top of another man
        const bed = findBed(o);
        if (bed) { BEDS_TAKEN.add(bed.key); GOING_TO_BED.set(o.id, { at: bed, key: bed.key, t: now }); planPersonalTo(o, "settle", { x: bed.x + 0.5, y: bed.y, z: bed.z + 0.5 }, now); note(o, "turning in"); asleep++; continue; }
        if (WEATHER_K < 1 && !isIndoors(o)) continue;                                  // (raining: nobody lies down in the wet)
        if (men.some((q) => q.id !== o.id && SLEEP.has(q.id) && flat(q.location, o.location) < 1.8)) continue;
        lieDown(o, now); asleep++;
      }
    } catch {}
  }
}, 100);
// woken by a shot fired near, a hit, an order
world.afterEvents.entityHurt.subscribe((ev) => { try { const v = ev.hurtEntity; if (v?.typeId === SOLDIER && SLEEP.has(v.id)) wake(v); } catch {} });
system.runInterval(() => {
  const now0b = tick();
  for (const [id, G] of [...GOING_TO_BED]) {
    const e = world.getEntity(id);
    if (!e?.isValid || !NIGHT || now0b - G.t > 600 || perc.get(id)?.threat) { BEDS_TAKEN.delete(G.key); GOING_TO_BED.delete(id); continue; }
    if (flat(e.location, { x: G.at.x + 0.5, z: G.at.z + 0.5 }) < 1.6) { GOING_TO_BED.delete(id); personal.delete(id); lieDown(e, now0b, G.at); }
  }
  if (!SLEEP.size) return;
  const now = tick();
  for (const [id] of [...SLEEP]) {
    const e = world.getEntity(id); if (!e?.isValid) { SLEEP.delete(id); continue; }
    try {
      const S = squads.get(squadKey(e, sd(e)));
      if (S?.known?.size || perc.get(id)?.threat || now - Number(gdp(e, "war:ordt") ?? -99999) < 40 || SHOTS.some((sh) => now - sh.t < 20 && Math.hypot(sh.x - e.location.x, sh.z - e.location.z) < 40)) { wake(e); note(e, "woken up"); }
    } catch {}
  }
}, 10);
WarAPI.registerBehavior({ name: "asleep", when: "first", priority: 130, decide(e) { return SLEEP.has(e.id) ? { g: "g_none", t: "t_off", urgent: false, note: "asleep" } : undefined; } });

// ---- the dead, cleared gracefully: at most ~32 bodies; the oldest goes first, from where no player is looking. If
// every old one is in sight, it sinks slowly into the ground instead of vanishing. Bodies older than 10 minutes go too.
const SINKING = new Map();   // corpse id -> ticks left
function bodySeen(c) {
  try {
    const l = c.location;
    for (const p of PLAYERS_LIST) {
      if (!p.isValid || p.dimension.id !== c.dimension.id) continue;
      const dx = l.x - p.location.x, dz = l.z - p.location.z, L = Math.hypot(dx, dz);
      if (L > 48) continue;
      if (L < 12) return true;
      const v = p.getViewDirection(), dot = (v.x * dx + v.z * dz) / (L * (Math.hypot(v.x, v.z) || 1));
      if (dot > 0.5) return true;
    }
  } catch {}
  return false;
}
function pruneBodies() {
  // v9.19: a body is never taken away while a player can see it. Out of sight, the oldest go first once there are more
  // than the cap (or after 10 minutes). Only when there are far too many and they're all in view do the oldest sink,
  // very slowly, into the ground.
  const now = tick(), cap = bodyCap();
  let over = CORPSES.length - cap, looked = 0;
  for (const o of [...CORPSES]) {
    const old = now - o.t > 12000;
    if (over <= 0 && !old) continue;
    if (++looked > 24) break;                                           // (a few at a time: the rest next round)
    if (SINKING.has(o.id)) continue;
    const c = world.getEntity(o.id);
    if (!c?.isValid) { CORPSES.splice(CORPSES.indexOf(o), 1); RD.delete(o.id); over--; continue; }
    if (bodySeen(c)) { if ((over > 24 && now - o.t > 2400) || old) { SINKING.set(o.id, 100); RD.delete(o.id); over--; } continue; }   // (v9.21.1: past 10 minutes, even in view: it sinks away)
    try { c.remove(); } catch {} RD.delete(o.id); CORPSES.splice(CORPSES.indexOf(o), 1); over--;
  }
}
system.runInterval(() => {
  const now = tick();
  if ((CORPSES.length > bodyCap() && now % 40 === 0) || (now % 600 === 0 && CORPSES.length)) pruneBodies();
  if (now % 4) return;
  for (const [id, n] of [...SINKING]) {
    const c = world.getEntity(id);
    if (!c?.isValid || n <= 0) { try { c?.remove(); } catch {} SINKING.delete(id); const i = CORPSES.findIndex((o) => o.id === id); if (i >= 0) CORPSES.splice(i, 1); continue; }
    try { c.teleport({ x: c.location.x, y: c.location.y - 0.012, z: c.location.z }); } catch {}
    SINKING.set(id, n - 1);
  }
}, 1);

// ---- desertion: rare, at night, a beaten man with nothing left in him slips away from his squad and is gone
const DESERT = new Map();    // id -> { at, t }
system.runInterval(() => {
  const now = tick();
  if (NIGHT) for (const [k, S] of squads) {
    try {
      if (!S.ours?.length || S.known?.size || (S.desertNight ?? -1) === Math.floor(now / 24000)) continue;
      const beaten = (squadMorale.get(k)?.m ?? 0) < 0 || (S.startN ?? 0) >= 4 && S.ours.length <= S.startN / 2;
      for (const o of S.ours) {
        if (!o.isValid || downed.has(o.id) || DESERT.has(o.id)) continue;
        const d = sd(o); if (d.surr || d.div === "guard" || d.div === "medic" || OFFICER_IDS.has(o.id) || traitOf(o) === "brave" || vetTier(o) >= 2) continue;
        const h = hpOf(o), low = h && h.currentValue / h.effectiveMax < 0.5;
        const bad = (beaten ? 1 : 0) + (low ? 1 : 0) + ((GRIEF.get(o.id) ?? 0) > now - 6000 ? 1 : 0) + (OUT_OF.has(o.id) ? 1 : 0);
        if (bad < 2 || Math.random() > 0.04) continue;
        const c = S.ourC ?? o.location, ang = Math.random() * Math.PI * 2;
        const at = walkableNear(o.dimension, c.x + Math.cos(ang) * 45, c.z + Math.sin(ang) * 45, c.y);
        if (!at) continue;
        S.desertNight = Math.floor(now / 24000);
        DESERT.set(o.id, { at, t: now }); wake(o); equip(o, "air"); planPersonalTo(o, "settle", at, now);
        radio(o, `${soldierName(o)} deserted during the night`, "story"); v9stat("desertion");
        break;
      }
    } catch {}
  }
  for (const [id, D] of [...DESERT]) {
    const e = world.getEntity(id);
    if (!e?.isValid) { DESERT.delete(id); continue; }
    const far = !PLAYER_POS.some((p) => p.d === e.dimension.id && Math.abs(p.x - e.location.x) < 24 && Math.abs(p.z - e.location.z) < 24);
    if ((flat(e.location, D.at) < 4 || now - D.t > 2400) && far) { DESERT.delete(id); try { e.remove(); } catch {} continue; }   // (gone: nobody saw him go)
    if (!personal.has(id) && now % 200 < 40) planPersonalTo(e, "settle", D.at, now);
  }
}, 40);
WarAPI.registerBehavior({ name: "deserter", when: "first", priority: 140, decide(e) { return DESERT.has(e.id) ? { g: "g_none", t: "t_off", urgent: true, note: "deserting" } : undefined; } });
WarAPI.on("think", (e, d, want) => { if (DESERT.has(e.id) || SLEEP.has(e.id)) { want.w = "w_none"; want.t = "t_off"; want.r = SLEEP.has(e.id) ? "r_off" : want.r; } });

// ---- hand signals: quick orders to your own soldiers around you (within 48 blocks), pointing with your view
function mySoldiers(p, r = 48) {
  const pf = playerFaction(p);
  return p.dimension.getEntities({ type: SOLDIER, location: p.location, maxDistance: r }).filter((e) => { try { const d = sd(e); return !d.surr && !downed.has(e.id) && (gdp(e, "war:cmdr") === p.id || (pf && d.faction === pf)) && d.div !== "medic"; } catch { return false; } });
}
const SIGNALS = ["Suppress where I'm looking", "Attack where I'm looking", "Take cover", "Fall back", "Hold fire", "Open fire", "Follow me", "Regroup on me", "Spread out"];
async function signalMenu(p) {
  const men = mySoldiers(p);
  if (!men.length) { p.onScreenDisplay.setActionBar("§7No soldiers of yours within 48 blocks."); return; }
  const f = new ActionFormData().title(`Hand signals (${men.length} men)`); for (const s of SIGNALS) f.button(s);
  const r = await show(f, p);
  if (!r || r.canceled || r.selection === undefined) return;
  giveSignal(p, r.selection, men);
}
// a man on a post/hold gets his post moved there (or he'd walk straight back); anyone else just goes
function sigMove(e, to, p, now) {
  const func = sd(e).func;
  if (ANCHORED.includes(func) && func !== "patrol") { try { giveFunction(e, func, p, makeWaypoint(e.dimension, to)); } catch {} }
  planPersonalTo(e, "settle", to, now);
}
function giveSignal(p, sel, men = mySoldiers(p)) {
  if (!men.length) { p.onScreenDisplay.setActionBar("§7No soldiers of yours within 48 blocks."); return; }
  const now = tick(), spot = lookedSpot(p, 120);
  try { p.playAnimation("animation.player.attack.rotations", { blendOutTime: 0.2 }); } catch {}
  const enemyAt = (pt) => { let best, bd = 8; for (const c of nearSnap(p.dimension.id, pt, 8)) { if (c.down || !c.f || !c.e.isValid || !isHostile(sd(men[0]).faction, c.f)) continue; if (c.dd < bd) { bd = c.dd; best = c.e; } } return best; };
  if (sel === 0) {
    const en = spot && enemyAt(spot);
    if (!en) { p.onScreenDisplay.setActionBar("§7No enemy there to suppress."); return; }
    let n = 0; for (const e of men) { const st = gunState.get(e.id); if (st && GUNS.includes(sd(e).weapon)) { st.supp = { p: chest(en), until: now + 160, ent: en }; n++; } }
    p.onScreenDisplay.setActionBar(`§aSuppressing: ${n} guns on him.`); callout(men[0], "Suppressing!", { event: true });
  } else if (sel === 1) {
    if (!spot) { p.onScreenDisplay.setActionBar("§7Look at a spot on the ground first."); return; }
    for (const e of men) planPersonalTo(e, "advance", { x: spot.x, y: spot.y, z: spot.z }, now);
    p.onScreenDisplay.setActionBar(`§aAttacking that spot: ${men.length} men.`); callout(men[0], "Go, go, go!", { event: true });
  } else if (sel === 2) {
    let n = 0;
    for (const e of men) { const seen = enemiesSeeing(e, sd(e).faction); const to = seen.length ? coverFrom(e.dimension, e.location, seen, now) : undefined; if (to) { planPersonalTo(e, "settle", to, now); n++; } }
    p.onScreenDisplay.setActionBar(n ? `§aTaking cover: ${n} men.` : "§7Nobody's in anyone's sights: they stay put."); callout(men[0], "Take cover!", { event: true });
  } else if (sel === 3) {
    for (const e of men) {
      const t = perc.get(e.id)?.threat, l = e.location;
      const dx = t?.isValid ? l.x - t.location.x : l.x - p.location.x - (spot ? spot.x - p.location.x : 0), dz = t?.isValid ? l.z - t.location.z : l.z - p.location.z - (spot ? spot.z - p.location.z : 0), L = Math.hypot(dx, dz) || 1;
      const to = walkableNear(e.dimension, l.x + (dx / L) * 20, l.z + (dz / L) * 20, l.y); if (to) planPersonalTo(e, "settle", to, now);
    }
    p.onScreenDisplay.setActionBar(`§aFalling back: ${men.length} men.`); callout(men[0], "Fall back!", { event: true });
  } else if (sel === 4 || sel === 5) {
    const st = sel === 4 ? "holdfire" : "aggressive";
    for (const e of men) { sdp(e, "war:stance", st); if (st === "holdfire") { const g = gunState.get(e.id); if (g) { g.target = undefined; g.supp = undefined; } } }
    p.onScreenDisplay.setActionBar(st === "holdfire" ? "§eHold fire." : "§cOpen fire!"); callout(men[0], st === "holdfire" ? "Hold your fire!" : "Open fire!", { event: true });
  } else if (sel === 6) {
    snapUndo(p, men);
    for (const e of men) { try { personal.delete(e.id); travelTo.delete(e.id); giveFunction(e, "follow", p); } catch {} }
    p.onScreenDisplay.setActionBar(`§aFollowing you: ${men.length} men.`); callout(men[0], "On you!", { event: true });
  } else if (sel === 7) {
    const pl = p.location; let i = 0;
    for (const e of men) { const a = (i++ / men.length) * Math.PI * 2, r = 2 + (i % 3); const to = walkableNear(e.dimension, pl.x + Math.cos(a) * r, pl.z + Math.sin(a) * r, pl.y); if (to) sigMove(e, to, p, now); }
    p.onScreenDisplay.setActionBar(`§aRegrouping on you: ${men.length} men.`); callout(men[0], "Regroup!", { event: true });
  } else if (sel === 8) {
    let cx = 0, cz = 0; for (const e of men) { cx += e.location.x; cz += e.location.z; } cx /= men.length; cz /= men.length;
    for (const e of men) {
      const l = e.location; let dx = l.x - cx, dz = l.z - cz; const L = Math.hypot(dx, dz);
      if (L < 0.5) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); } else { dx /= L; dz /= L; }
      const to = walkableNear(e.dimension, l.x + dx * 5, l.z + dz * 5, l.y); if (to) sigMove(e, to, p, now);
    }
    p.onScreenDisplay.setActionBar(`§aSpreading out: ${men.length} men.`); callout(men[0], "Spread out!", { event: true });
  }
}
// v9.19: the Signal Flag: hold it, sneak and scroll to pick a signal, use it to give it. No menu.
const SIG_SEL = new Map();   // player id -> signal picked
const SIG_SLOT = new Map();  // player id -> hotbar slot the flag is in
function sigBar(p) {
  const n = SIGNALS.length, i = SIG_SEL.get(p.id) ?? 0;
  p.onScreenDisplay.setActionBar(`§7${SIGNALS[(i + n - 1) % n]}  §f« §e§l${SIGNALS[i]}§r§f »  §7${SIGNALS[(i + 1) % n]}\n§8Sneak + scroll to change, use to signal`);
}
system.runInterval(() => {
  const now = tick();
  for (const p of world.getPlayers()) {
    try {
      const slot = p.selectedSlotIndex, last = SIG_SLOT.get(p.id);
      if (last !== undefined && slot !== last && p.isSneaking) {
        const n = SIGNALS.length, dir = ((slot - last + 9) % 9) <= 4 ? 1 : -1;
        SIG_SEL.set(p.id, ((SIG_SEL.get(p.id) ?? 0) + dir + n) % n);
        p.selectedSlotIndex = last; sigBar(p);
        try { p.playSound("random.click", { volume: 0.3, pitch: 1.6 }); } catch {}
        continue;
      }
      const held = p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId === "war:signal_flag";
      if (held) { SIG_SLOT.set(p.id, slot); if (last === undefined || now % 20 === 0) sigBar(p); } else SIG_SLOT.delete(p.id);
    } catch {}
  }
}, 2);
world.afterEvents.playerLeave.subscribe((ev) => { SIG_SEL.delete(ev.playerId); SIG_SLOT.delete(ev.playerId); });

// v9.19: First Aid Kit: use on a soldier to patch him up (and get a downed man on his feet); with nobody there, on yourself
function useOne(p) {
  try { if (p.getGameMode() === GameMode.Creative) return; const inv = p.getComponent("minecraft:inventory")?.container, i = p.selectedSlotIndex, it = inv?.getItem(i); if (!it) return; if (it.amount > 1) { it.amount -= 1; inv.setItem(i, it); } else inv.setItem(i, undefined); } catch {}
}
async function firstAid(p, target) {
  const e = target?.isValid ? target : lookedAt(p, SOLDIER);
  if (e && (e === target || dist(e.location, p.location) < 6)) {
    const h = hpOf(e); if (!h) return;
    if (downed.has(e.id)) revive(e, Math.ceil(h.effectiveMax * 0.6)); else h.setCurrentValue(h.effectiveMax);
    LIMP.delete(e.id); ARM_HIT.delete(e.id);
    try { e.dimension.spawnParticle("minecraft:heart_particle", { x: e.location.x, y: e.location.y + 2, z: e.location.z }); e.dimension.playSound("armor.equip_leather", e.location); } catch {}
    useOne(p); note(e, "patched up"); p.onScreenDisplay.setActionBar(`§aPatched up ${soldierName(e)}.`); return;
  }
  try { p.addEffect("regeneration", 100, { amplifier: 1 }); p.addEffect("instant_health", 1, { amplifier: 0 }); } catch {}
  useOne(p); p.onScreenDisplay.setActionBar("§aYou patch yourself up.");
}

// v9.19: barbed wire (slows and scratches whoever walks into it; soldiers route round it) and ammo crates (soldiers refill there)
const PLACED_KIND = { "war:barbed_wire": "wire", "war:ammo_crate": "crate" };
let placedReg = null, placedDirty = false;   // kind -> Map "dim|x|y|z" -> {dim, x, y, z}
function placed(kind) {
  if (!placedReg) { placedReg = { wire: new Map(), crate: new Map() }; for (const q of getJSON(world, "war:placed", [])) placedReg[q.k]?.set(`${q.dim}|${q.x}|${q.y}|${q.z}`, q); }
  return placedReg[kind];
}
function placedAdd(kind, dim, x, y, z) { placed(kind).set(`${dim}|${x}|${y}|${z}`, { k: kind, dim, x, y, z }); placedDirty = true; }
function placedDel(kind, dim, x, y, z) { if (placed(kind).delete(`${dim}|${x}|${y}|${z}`)) placedDirty = true; }
system.runInterval(() => { if (!placedDirty) return; placedDirty = false; try { setJSON(world, "war:placed", [...placed("wire").values(), ...placed("crate").values()].slice(-2000)); } catch {} }, 200);
try { world.afterEvents.playerPlaceBlock.subscribe((ev) => { try { const b = ev.block, k = PLACED_KIND[b.typeId]; if (k) placedAdd(k, b.dimension.id, b.x, b.y, b.z); } catch {} }); } catch {}
try { world.afterEvents.playerBreakBlock.subscribe((ev) => { try { const k = PLACED_KIND[ev.brokenBlockPermutation?.type?.id]; if (k) placedDel(k, ev.block.dimension.id, ev.block.x, ev.block.y, ev.block.z); } catch {} }); } catch {}
function placedNear(kind, dimId, loc, r) {
  let best, bd = r;
  for (const q of placed(kind).values()) { if (q.dim !== dimId) continue; const d = Math.hypot(q.x + 0.5 - loc.x, q.z + 0.5 - loc.z); if (d < bd && Math.abs(q.y - loc.y) < 4) { bd = d; best = q; } }
  return best;
}
const crateNear = (e, r = 6) => placedNear("crate", e.dimension.id, e.location, r);
system.runInterval(() => {
  const W = placed("wire"); if (!W.size) return;
  const now = tick(), cells = new Map();
  for (const q of W.values()) cells.set(`${q.dim}|${q.x}|${q.y}|${q.z}`, q);
  const who = [...allOf(SOLDIER), ...world.getPlayers()];
  for (const e of who) {
    try {
      const l = e.location, k = `${e.dimension.id}|${Math.floor(l.x)}|${Math.floor(l.y)}|${Math.floor(l.z)}`, q = cells.get(k);
      if (!q) continue;
      if (e.typeId === "minecraft:player" && e.getGameMode() === GameMode.Creative) continue;
      const b = e.dimension.getBlock({ x: q.x, y: q.y, z: q.z }); if (b && b.typeId !== "war:barbed_wire") { placedDel("wire", q.dim, q.x, q.y, q.z); continue; }
      e.addEffect("slowness", 30, { amplifier: 3, showParticles: false });
      if (now % 20 < 10) e.applyDamage(1, { cause: "contact" });
    } catch {}
  }
}, 10);
// v9.19: what the dead carried: a man out of rounds takes them off a body (his own side's or the enemy's)
const BODY_KIT = new Map();   // corpse id -> { dim, at, w, n, t }
function bodyKit(v, cid) {
  try { const w = sd(v).weapon; if (!GUNS.includes(w)) return; const n = RESERVE.get(v.id) ?? AMMO_START[w] ?? 60; if (n < 5) return; BODY_KIT.set(cid, { dim: v.dimension.id, at: { ...v.location }, w, n, t: tick() }); if (BODY_KIT.size > 200) BODY_KIT.delete(BODY_KIT.keys().next().value); } catch {}
}
// a man low on rounds walks over to a crate he can see nearby, or to a body with a gun
system.runInterval(() => {
  if (!AMMO_LIMITED || !OUT_OF.size) return;
  const now = tick();
  for (const [k, b] of [...BODY_KIT]) if (now - b.t > 6000) BODY_KIT.delete(k);
  for (const e of allOf(SOLDIER)) {
    try {
      if (!OUT_OF.has(e.id) || downed.has(e.id) || pows.has(e.id)) continue;
      const c = placed("crate").size ? crateNear(e, 32) : undefined;
      if (c) { if (personal.has(e.id) || dist(c, e.location) < 3) continue; const to = walkableNear(e.dimension, c.x + 0.5, c.z + 1.5, c.y); if (to) { planPersonalTo(e, "settle", to, now); note(e, "going for ammo"); } continue; }
      let best, bd = 20;
      for (const [cid, b] of BODY_KIT) { if (b.dim !== e.dimension.id || Math.abs(b.at.y - e.location.y) > 3) continue; const dd = flat(b.at, e.location); if (dd < bd) { bd = dd; best = cid; } }
      if (!best) continue;
      const b = BODY_KIT.get(best);
      if (bd < 3.2) {                                                               // (v9.20.3: 3, not 2: the walking there stops 3 short, and he stood over the body without taking anything)
        const w = sd(e).weapon, n = b.w === w ? b.n : Math.ceil(b.n / 2);   // (another kind of gun: what fits, or near enough)
        BODY_KIT.delete(best); giveAmmo(e, n); KNEEL.set(e.id, now + 30);
        note(e, "took ammo off the dead"); v9stat("scavenged"); continue;
      }
      if (!personal.has(e.id)) planPersonalTo(e, "settle", b.at, now), note(e, "going for a dead man's ammo");
    } catch {}
  }
}, 30);

// ---- undo: the last order you gave (who it went to, what each was doing and where), put back
const UNDO = new Map();      // player id -> [{ id, func, home, stance, loc }]
function snapUndo(p, pool) {
  UNDO.set(p.id, pool.slice(0, 300).map((e) => { const d = sd(e), h = marker(Number(gdp(e, "war:home") ?? 0)); return { id: e.id, func: d.func, home: h ? { ...h.location } : { ...e.location }, stance: String(gdp(e, "war:stance") ?? "aggressive") }; }));
}
function undoOrder(p) {
  const list = UNDO.get(p.id);
  if (!list?.length) { p.onScreenDisplay.setActionBar("§7No order to undo."); return; }
  let n = 0;
  for (const s of list) {
    const e = world.getEntity(s.id); if (!e?.isValid || downed.has(e.id) || sd(e).surr) continue;
    try {
      personal.delete(e.id); travelTo.delete(e.id);
      sdp(e, "war:stance", s.stance);
      const func = ["hold", "post", "sentry", "stand", "patrol", "follow", "escort", "squad"].includes(s.func) ? s.func : "hold";
      const slot = ANCHORED.includes(func) ? makeWaypoint(e.dimension, s.home) : undefined;
      giveFunction(e, func, p, slot); n++;
    } catch {}
  }
  UNDO.delete(p.id);
  p.onScreenDisplay.setActionBar(`§6Last order undone: ${n} men back to what they were doing.`);
}

// ---- reinforcement waves: a spot that sends a fresh squad every few minutes, marching on a target (a fixed spot, or
// the nearest enemy at the time), for a number of waves or until removed (War Table > Reinforcements)
function getReinf() { return getJSON(world, "war:reinf", []); }
function setReinf(v) { setJSON(world, "war:reinf", v); }
// v9.19: the skin a wave wears: the one picked, or (the default, and for points made before) the one most of that
// faction's men already wear (a skin given with the Unit Wand), else the faction's own
function reinfSkin(R) {
  if (typeof R.skin === "number") return R.skin;
  const n = new Map();
  for (const e of allOf(SOLDIER)) { try { if (Number(P(e, "war:faction") ?? 0) !== R.f) continue; const k = Number(gdp(e, "p_war:skin") ?? 0); if (k) n.set(k, (n.get(k) ?? 0) + 1); } catch {} }
  let best = 0, bn = 0; for (const [k, c] of n) if (c > bn) { bn = c; best = k; }
  return best;
}
const REINF_MIX = [["mixguns", "Mixed guns"], ["rifle", "Rifles"], ["smg", "SMGs"], ["mixmelee", "Swords and crossbows"]];
async function reinfMenu(p) {
  const list = getReinf();
  const f = new ActionFormData().title("Reinforcements").body(list.length ? "Points sending reinforcements:" : "No reinforcement points yet.").button("§aNew point where I'm standing");
  list.forEach((R) => f.button(`${factionLabel(R.f, true)}: ${R.n} men every ${R.every} min\n${R.done}/${R.waves || "∞"} waves · tap to remove`));
  const r = await show(f, p);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection > 0) { list.splice(r.selection - 1, 1); setReinf(list); p.onScreenDisplay.setActionBar("§7Reinforcement point removed."); return; }
  const look = lookedSpot(p, 200);
  const mf = new ModalFormData().title("New reinforcement point")
    .dropdown("Faction", factionList(), { defaultValueIndex: Math.max(0, (playerFaction(p) || 1) - 1) })
    .slider("Men per wave", 2, 20, { valueStep: 1, defaultValue: 6 })
    .dropdown("Weapons", REINF_MIX.map((m) => m[1]), { defaultValueIndex: 0 })
    .slider("Every (minutes)", 1, 10, { valueStep: 1, defaultValue: 3 })
    .slider("Waves (0 = until removed)", 0, 20, { valueStep: 1, defaultValue: 5 })
    .dropdown("Each wave marches on", [look ? "Where I was looking when I opened this" : "(look at a spot first)", "The nearest enemy at the time", "Nowhere: they hold at the point"], { defaultValueIndex: look ? 0 : 1 })
    .dropdown("Skin", ["Same as that faction's men (the one most of them wear)", "Faction uniform", ...skinChoices().map((k) => k.name)], { defaultValueIndex: 0 })
    .dropdown("They arrive", ["Where I'm standing", "At the faction's HQ flag (wherever it is when each wave comes)"], { defaultValueIndex: 0 });
  const fr = await show(mf, p);
  if (!fr || fr.canceled || !fr.formValues) return;
  const v = fr.formValues.map(Number);
  const skins0 = skinChoices(), skinPick = v[6] === 0 ? "same" : v[6] === 1 ? 0 : skins0[v[6] - 2]?.slot ?? 0;
  const R = { atHq: v[7] === 1, skin: skinPick, id: Date.now(), dim: p.dimension.id, at: { x: p.location.x, y: p.location.y, z: p.location.z }, f: v[0] + 1, n: v[1], mix: REINF_MIX[v[2]][0], every: v[3], waves: v[4], to: v[5] === 0 && look ? { x: look.x, y: look.y, z: look.z } : undefined, mode: ["spot", "enemy", "hold"][v[5]], done: 0, next: Date.now() + 5000, owner: p.id, squad: 9 };
  list.push(R); setReinf(list);
  p.onScreenDisplay.setActionBar(`§aReinforcement point set: first wave in a few seconds.`);
}
system.runInterval(() => {
  const list = getReinf(); if (!list.length) return;
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const R = list[i];
    try {
      if (Date.now() < R.next) continue;
      if (R.atHq) { try { const hq = hqFlag(world.getDimension(R.dim), R.at, R.f); if (hq) { R.at = { x: hq.location.x, y: hq.location.y, z: hq.location.z }; R.dim = hq.dimension.id; } } catch {} }   // (v9.19: at the HQ, wherever it is now)
      const dim = world.getDimension(R.dim);
      if (!dim.getBlock(R.at)) continue;                                        // (not loaded: it waits)
      const p = findPlayer(R.owner) ?? PLAYERS_LIST.find((q) => q.isValid && q.dimension.id === R.dim);
      if (!p) continue;
      const pool = [];
      for (let k = 0; k < R.n; k++) {
        const a = (k / R.n) * Math.PI * 2, rr = 1.5 + (k % 3);
        const at = walkableNear(dim, R.at.x + Math.cos(a) * rr, R.at.z + Math.sin(a) * rr, R.at.y) ?? R.at;
        const MIXG = ["rifle", "smg", "semi", "mg"], MIXM = ["sword", "crossbow"];
        const w = R.mix === "mixguns" ? MIXG[k % 4] : R.mix === "mixmelee" ? MIXM[k % 2] : R.mix;
        const e = dim.spawnEntity(SOLDIER, { x: at.x, y: at.y, z: at.z }, { spawnEvent: "war:init" });
        const fin = setupSoldier(e, { faction: R.f, squad: R.squad, weapon: w, ranged: isRangedW(w), div: "foot", radius: 8, func: "__none", owner: p.id, skin: reinfSkin(R) || undefined }, p) ?? e;
        giveFunction(fin, "hold", p, makeWaypoint(dim, at)); pool.push(fin);
      }
      let dest = R.to;
      if (R.mode === "enemy") { let bd = 250; for (const c of nearSnap(R.dim, R.at, 250)) if (!c.down && c.f && isHostile(R.f, c.f) && c.dd < bd) { bd = c.dd; dest = { x: c.x, y: c.y, z: c.z }; } }
      if (dest && R.mode !== "hold") system.runTimeout(() => { try { giveOrderInner(p, { faction: R.f, order: 0, squad: 0, count: 0, radius: 400, stance: "aggressive", ao: 100, free: true, target: 5, cx: Math.floor(dest.x), cz: Math.floor(dest.z), cy: dest.y, then: "hold" }, pool.filter((q) => q.isValid)); } catch {} }, 10);
      R.done++; R.next = Date.now() + R.every * 60000; changed = true;
      for (const q of PLAYERS_LIST) { try { if (isFriendly(playerFaction(q), R.f)) q.sendMessage(`§7[Radio] §e${factionLabel(R.f, true)}§7: reinforcements have arrived (${R.n} men, wave ${R.done}${R.waves ? `/${R.waves}` : ""})`); } catch {} }
      v9stat("reinforcements");
      if (R.waves && R.done >= R.waves) list.splice(i, 1);
    } catch {}
  }
  if (changed) setReinf(list);
}, 100);

// ================================================================ v9.22: performance, huge battles, saved battles, presets
// ---- Performance (War Table > Settings > Performance): Low / Medium / High. It sets how many bodies fall with full
// physics at once and how much time they get, how many bodies stay, and how close a man has to be to a player to get
// full attention. "Huge battle" mode (over 200 soldiers, or Low) thins out the far ones further.
const perfLevel = () => { const v = String(setting("perf", "medium")); return ["low", "medium", "high"].includes(v) ? v : "medium"; };
let SOLDIER_N = 0;
system.runInterval(() => { SOLDIER_N = allOf(SOLDIER).length; }, 40);
const lodOn = () => perfLevel() === "low" || SOLDIER_N > 200;
const FAR_R = () => (perfLevel() === "low" ? 64 : SOLDIER_N > 200 ? 80 : 96);
const bodyCap = () => ({ low: 16, medium: 32, high: 48 }[perfLevel()] ?? 32) - (SOLDIER_N > 250 ? 8 : 0);
const playerNearAt = (dimId, l, r) => PLAYER_POS.some((p) => p.d === dimId && Math.abs(p.x - l.x) < r && Math.abs(p.z - l.z) < r);
async function perfMenu(p) {
  const f = new ModalFormData().title("Performance")
    .dropdown("Level", ["Low (phones, consoles, very big battles)", "Medium (most devices)", "High (strong PC: more falling bodies, more kept)"], { defaultValueIndex: ["low", "medium", "high"].indexOf(perfLevel()) });
  const r = await show(f, p); if (!r || r.canceled || !r.formValues) return;
  sdp(world, "war:set_perf", ["low", "medium", "high"][Number(r.formValues[0])] ?? "medium");
  p.sendMessage(`§aPerformance: ${perfLevel()}.`);
}
// ---- quick presets: many settings at once
const PRESETS = {
  realistic: { name: "Realistic", desc: "Surrender, shields, kneeling, drills, gore; real damage; radio: important only", set: { ammo: true, isosurr: true, shields: true, poses: true, drills: true, gore: true, nightfx: true, commit: true, radio: 1, r_dmg: 100, r_react: 100 } },
  arcade: { name: "Arcade", desc: "No surrender, quicker kills, faster reactions, no gore, quiet radio", set: { ammo: false, isosurr: false, shields: true, poses: false, drills: true, gore: false, nightfx: true, commit: true, radio: 0, r_dmg: 150, r_react: 140 } },
  cinematic: { name: "Cinematic", desc: "Everything that looks good: gore, night flares, kneeling, all radio chatter, more bodies with physics", set: { ammo: true, isosurr: true, shields: true, poses: true, drills: true, gore: true, nightfx: true, commit: true, radio: 2, r_dmg: 100, r_react: 100, perf: "high" } },
};
async function presetMenu(p) {
  const keys = Object.keys(PRESETS);
  const f = new ActionFormData().title("Quick presets").body("Each sets a group of settings at once (you can still change any of them after).");
  for (const k of keys) f.button(`${PRESETS[k].name}\n§8${PRESETS[k].desc.slice(0, 60)}`);
  const r = await show(f, p); if (!r || r.canceled || r.selection === undefined) return;
  const P0 = PRESETS[keys[r.selection]];
  for (const [k, v] of Object.entries(P0.set)) sdp(world, `war:set_${k}`, v);
  p.sendMessage(`§aPreset applied: ${P0.name}. §7${P0.desc}.`);
}

// ---- saving and loading battles (War Table > Save / load battles): every soldier within 200 blocks (who he is, his
// faction and squad, kit, rank, temperament, health, his job and where he stands) into one of five slots; loading puts
// them all back, at the same places
const BSLOTS = 5, BCHUNK = 30000;
function battleSave(p, slot) {
  const men = p.dimension.getEntities({ type: SOLDIER, location: p.location, maxDistance: 200 }).filter((e) => !downed.has(e.id));
  const rows = men.map((e) => {
    const d = sd(e), h = hpOf(e), l = e.location;
    return [Math.round(l.x * 10) / 10, Math.round(l.y * 10) / 10, Math.round(l.z * 10) / 10, d.faction, d.squad, d.div, d.weapon, String(gdp(e, "war:armor") ?? "none"), Number(P(e, "war:skin") ?? 0),
      d.func, String(gdp(e, "war:stance") ?? "aggressive"), h ? Math.round(h.currentValue) : 20, xpOf(e), traitOf(e), idSeed(e), Number(P(e, "war:medals") ?? 0), d.custom ?? "", String(gdp(e, "war:mount") ?? "")];
  });
  const txt = JSON.stringify(rows);
  for (let i = 0; i < 40; i++) world.setDynamicProperty(`war:bsave${slot}_${i}`, undefined);
  for (let i = 0; i * BCHUNK < txt.length; i++) world.setDynamicProperty(`war:bsave${slot}_${i}`, txt.slice(i * BCHUNK, (i + 1) * BCHUNK));
  const meta = getJSON(world, "war:bsaves", {});
  meta[slot] = { n: rows.length, when: new Date().toISOString().slice(0, 16).replace("T", " "), dim: p.dimension.id, by: p.name };
  setJSON(world, "war:bsaves", meta);
  return rows.length;
}
function battleLoad(p, slot, clear) {
  let txt = ""; for (let i = 0; i < 40; i++) { const c = world.getDynamicProperty(`war:bsave${slot}_${i}`); if (c === undefined) break; txt += String(c); }
  if (!txt) return -1;
  const rows = JSON.parse(txt), meta = getJSON(world, "war:bsaves", {})[slot];
  const dim = world.getDimension(meta?.dim ?? p.dimension.id);
  if (clear) for (const e of dim.getEntities({ type: SOLDIER, location: p.location, maxDistance: 200 })) { try { e.remove(); } catch {} }
  let n = 0;
  for (const r of rows) {
    try {
      const [x, y, z, f, squad, div, weapon, armor, skin, func, stance, hp, xp, trait, seed, medals, custom, mount] = r;
      if (!dim.getBlock({ x, y, z })) continue;                                 // (not loaded: skipped)
      const e0 = dim.spawnEntity(SOLDIER, { x, y, z }, { spawnEvent: "war:init" });
      const e = setupSoldier(e0, { faction: f, squad, weapon, ranged: isRangedW(weapon), div, radius: 8, func: "__none", owner: p.id, armor, skin: skin || undefined, custom: custom || undefined, mount: mount || undefined }, p) ?? e0;
      { const R = idRec(e); R.x = Number(xp ?? 0); R.t = trait; if (seed !== undefined) R.s = Number(seed); idSave(e, R); } if (medals) setP(e, "war:medals", medals); setP(e, "war:vet", vetTier(e));
      sdp(e, "war:stance", stance);
      const f2 = ANCHORED.includes(func) || ["follow", "escort", "squad"].includes(func) ? func : "hold";
      giveFunction(e, f2, p, ANCHORED.includes(f2) ? makeWaypoint(dim, { x, y, z }) : undefined);
      system.runTimeout(() => { try { const h = hpOf(e); if (h) h.setCurrentValue(Math.max(1, Math.min(h.effectiveMax, hp))); updateName(e); } catch {} }, 5);
      n++;
    } catch {}
  }
  return n;
}
async function battleSaveMenu(p) {
  const meta = getJSON(world, "war:bsaves", {});
  const f = new ActionFormData().title("Save / load battles").body("Saves every soldier within 200 blocks of you: who they are, their kit, rank, health, job and where they stand.");
  for (let s = 1; s <= BSLOTS; s++) f.button(meta[s] ? `Slot ${s}: ${meta[s].n} soldiers\n§8${meta[s].when}` : `Slot ${s}: empty`);
  const r = await show(f, p); if (!r || r.canceled || r.selection === undefined) return;
  const slot = r.selection + 1;
  const a = new ActionFormData().title(`Slot ${slot}`).button("Save the battle here (overwrites)");
  if (meta[slot]) a.button("Load it (keep the soldiers here now)").button("Load it, removing the soldiers here now").button("§cDelete this save");
  const ar = await show(a, p); if (!ar || ar.canceled || ar.selection === undefined) return;
  if (ar.selection === 0) { const n = battleSave(p, slot); p.sendMessage(`§aSaved ${n} soldiers to slot ${slot}.`); }
  else if (ar.selection === 1 || ar.selection === 2) { const n = battleLoad(p, slot, ar.selection === 2); p.sendMessage(n < 0 ? "§cThat slot is empty." : `§aLoaded ${n} soldiers from slot ${slot}.`); }
  else { for (let i = 0; i < 40; i++) world.setDynamicProperty(`war:bsave${slot}_${i}`, undefined); delete meta[slot]; setJSON(world, "war:bsaves", meta); p.sendMessage(`§7Slot ${slot} deleted.`); }
}

// ---- v9.19: off-duty life. Nothing going on and a player near enough to see: now and then a man checks his rifle,
// stretches, studies a map, eats (or smokes: Settings), or two of them talk, facing each other. Anything happening
// (an enemy, an order, moving off) ends it at once.
const IDLE = new Map();   // id -> { act, until, gun }
const IDLE_ACTS = [1, 2, 3, 4, 5];   // 1 rifle check, 2 stretch, 3 map, 4 eat/smoke, 5 talk
function idleEnd(e) {
  const I = IDLE.get(e.id); if (!I) return; IDLE.delete(e.id);
  try { setP(e, "war:idle", 0); if (I.gun) equip(e, weaponItem(e)); } catch {}
}
system.runInterval(() => {
  const now = tick();
  for (const [id, I] of [...IDLE]) {
    const e = world.getEntity(id);
    if (!e?.isValid) { IDLE.delete(id); continue; }
    try {
      const v = e.getVelocity();
      if (now >= I.until || perc.get(id)?.threat || personal.has(id) || downed.has(id) || Math.hypot(v.x, v.z) > 0.05 || now - Number(gdp(e, "war:ordt") ?? -99999) < 40) { idleEnd(e); continue; }
      if (I.act === 4 && now % 20 === 0) {
        const h = headLoc(e), f = fwdFromYaw(e.getRotation().y);
        if (I.smoke) e.dimension.spawnParticle("minecraft:basic_smoke_particle", { x: h.x + f.x * 0.3, y: h.y - 0.1, z: h.z + f.z * 0.3 });
        else if (Math.random() < 0.5) e.dimension.playSound("random.eat", e.location, { volume: 0.3 });
      }
    } catch { IDLE.delete(id); }
  }
}, 10);
system.runInterval(() => {
  if (!PLAYER_POS.length || perfLevel() === "low") return;
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const id = e.id;
      if (IDLE.has(id) || Math.random() > 0.05) continue;
      const l = e.location;
      if (!PLAYER_POS.some((p) => p.d === e.dimension.id && Math.abs(p.x - l.x) < 24 && Math.abs(p.z - l.z) < 24)) continue;
      const d = sd(e);
      if (downed.has(id) || pows.has(id) || d.surr || SLEEP.has(id) || personal.has(id) || gliders.has(id) || isRiding(e) || perc.get(id)?.threat || squads.get(squadKey(e, d))?.known?.size || P(e, "war:sit")) continue;
      if (now - Number(gdp(e, "war:ordt") ?? -99999) < 200 || ["charge", "escort", "follow"].includes(d.func) || d.div === "guard") continue;
      const v = e.getVelocity(); if (Math.hypot(v.x, v.z) > 0.03) continue;
      let act = IDLE_ACTS[Math.floor(Math.random() * IDLE_ACTS.length)];
      if (WEATHER_K < 1 && !isIndoors(e) && Math.random() < 0.75) act = 6;              // (v9.19: rain: head down, hunched against it)
      if (act === 1 && !GUNS.includes(d.weapon)) act = 2;
      if (act === 5) {   // a mate standing close who's free too
        const m = nearSnap(e.dimension.id, l, 3.5).find((c) => c.type === SOLDIER && c.id !== id && !c.down && c.f === d.faction && c.e.isValid && !IDLE.has(c.id) && !personal.has(c.id) && !perc.get(c.id)?.threat);
        if (!m) act = 3;
        else {
          const until = now + 100 + Math.floor(Math.random() * 80);
          for (const [a, b] of [[e, m.e], [m.e, e]]) {
            IDLE.set(a.id, { act: 5, until }); setP(a, "war:idle", 5);
            GLANCE.set(a.id, { yaw: (Math.atan2(-(b.location.x - a.location.x), b.location.z - a.location.z) * 180) / Math.PI, until, back: REST_YAW.get(a.id) ?? a.getRotation().y });
          }
          if (Math.random() < 0.5) callout(e, "IDLE");
          continue;
        }
      }
      const I = { act, until: now + 60 + Math.floor(Math.random() * 80) };
      if (((act >= 2 && act <= 4) || act === 6) && P(e, "war:gun")) { I.gun = true; setP(e, "war:gun", 0); }   // (the rifle slung for it)
      if (act === 6) I.until += 120;
      if (act === 4) I.smoke = setting("smoking", false) === true && Math.random() < 0.5;
      IDLE.set(id, I); setP(e, "war:idle", act);
    } catch {}
  }
}, 40);
// ---- v9.19: sentries walk a short beat: a few steps one way along their post, a look round, back, the other way
const BEAT = new Map();   // id -> which way next (1 / -1)
system.runInterval(() => {
  const now = tick();
  for (const e of allOf(SOLDIER)) {
    try {
      const d = sd(e); if (d.func !== "sentry" || Math.random() > 0.45) continue;
      if (downed.has(e.id) || personal.has(e.id) || SLEEP.has(e.id) || IDLE.has(e.id) || perc.get(e.id)?.threat || squads.get(squadKey(e, d))?.known?.size) continue;
      const an = marker(Number(gdp(e, "war:goal") ?? 0)); if (!an) continue;
      const side = BEAT.get(e.id) ?? 1; BEAT.set(e.id, -side);
      const yaw = (idSeed(e) % 4) * 90 + 45, f = fwdFromYaw(yaw), k = Math.min(6, Math.max(3, (d.radius ?? 8) / 2)) * side;   // (his own line, the same each time)
      const to = walkableNear(e.dimension, an.location.x + f.x * k, an.location.z + f.z * k, an.location.y);
      if (to && Math.abs(to.y - an.location.y) < 2) { planPersonalTo(e, "patrol", to, now); note(e, "walking his beat"); }
    } catch {}
  }
  if (now % 6000 < 100) { const live = new Set(allOf(SOLDIER).map((q) => q.id)); for (const id of [...BEAT.keys()]) if (!live.has(id)) BEAT.delete(id); }
}, 100);

// ---- v9.19: close combat. A swordsman or spearman facing a blade can parry it (better with experience), and now and
// then answers at once (the riposte). A rider at the gallop hits harder and bowls a man over. Spearmen facing a horse
// stop it dead: the horse is wounded and thrown back, the rider may be unseated. A mount that's hit shies and stops.
const DUEL_W = ["sword", "spear"];
const PARRY_T = new Map();   // id -> last parry tick
function meleeDuel(v, ev) {
  try {
    if (String(ev.damageSource?.cause ?? "") !== "entityAttack") return false;
    const src = ev.damageSource?.damagingEntity; if (!src?.isValid || src.typeId === "minecraft:player" && (() => { try { return src.getGameMode() === GameMode.Creative; } catch { return false; } })()) return false;
    const d = sd(v); if (!DUEL_W.includes(d.weapon) || isRiding(v) || d.surr || pows.has(v.id)) return false;
    if (RIDDEN.has(src.id) || isRiding(src)) return false;                         // (no parrying a horse)
    const now = tick(); if (now - (PARRY_T.get(v.id) ?? -99) < 25) return false;  // (not every blow)
    const fx = src.location.x - v.location.x, fz = src.location.z - v.location.z, L = Math.hypot(fx, fz) || 1, yaw = v.getRotation().y * Math.PI / 180;
    if ((fx * -Math.sin(yaw) + fz * Math.cos(yaw)) / L < 0.5) return false;       // (only what he's facing)
    if (Math.random() > 0.16 + vetTier(v) * 0.05 + (traitOf(v) === "steady" ? 0.05 : 0)) return false;
    PARRY_T.set(v.id, now); v9stat("parry");
    system.run(() => {
      try {
        v.dimension.playSound("random.anvil_land", v.location, { volume: 0.25, pitch: 1.7 }); v.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: v.location.x + fx / L * 0.6, y: v.location.y + 1.3, z: v.location.z + fz / L * 0.6 });
        if (Math.random() < 0.5 && src.isValid) { preHp(src); src.applyDamage(3, { cause: "entityAttack", damagingEntity: v }); note(v, "parry and riposte"); v9stat("riposte"); }
        else note(v, "parried");
      } catch {}
    });
    return true;
  } catch { return false; }
}
const RIDDEN = new Set();   // mounts with a soldier on them (kept by the loop below)
function chargeBlow(src, v, ev) {
  try {
    const m = src.getComponent("minecraft:riding")?.entityRidingOn; if (!m) return;
    const q = m.getVelocity(), sp = Math.hypot(q.x, q.z); if (sp < 0.22) return;
    ev.damage = ev.damage * (1 + Math.min(1, (sp - 0.22) * 4));                     // (up to twice as hard at a full gallop)
    const L = sp || 1; system.run(() => { try { v.applyKnockback({ x: (q.x / L) * 1.1, z: (q.z / L) * 1.1 }, 0.35); } catch { try { v.applyKnockback(q.x / L, q.z / L, 1.1, 0.35); } catch {} } });
    v9stat("chargeHit");
  } catch {}
}
const SHY_T = new Map();
function horseShy(m) {
  try {
    if (!m.isValid) return; const now = tick(); if (now - (SHY_T.get(m.id) ?? -99) < 40) return; SHY_T.set(m.id, now);
    m.dimension.playSound("mob.horse.angry", m.location, { volume: 0.9 });
    const q = m.getVelocity(); m.applyImpulse({ x: -q.x * 0.8, y: 0.25, z: -q.z * 0.8 });   // (rears up and stops)
    m.addEffect("slowness", 30, { amplifier: 3, showParticles: false });
  } catch {}
}
system.runInterval(() => {
  RIDDEN.clear();
  if (!mountOf.size) return;
  const now = tick();
  for (const [sid, mo] of mountOf) {                                  // (only the men known to be in the saddle)
    try {
      const e = world.getEntity(sid), m = mo?.id ? world.getEntity(mo.id) : undefined; if (!e?.isValid || !m?.isValid) continue;
      RIDDEN.add(m.id);
      const q = m.getVelocity(), sp = Math.hypot(q.x, q.z); if (sp < 0.18) continue;
      const f = Number(P(e, "war:faction") ?? 0), ml = m.location;
      for (const c of nearSnap(e.dimension.id, ml, 3.2)) {   // a spearman in his path, facing him
        if (c.type !== SOLDIER || c.down || !c.f || !isHostile(f, c.f) || !c.e.isValid || sd(c.e).weapon !== "spear" || isRiding(c.e)) continue;
        const sl = c.e.location, fx = ml.x - sl.x, fz = ml.z - sl.z, L = Math.hypot(fx, fz) || 1, yaw = c.e.getRotation().y * Math.PI / 180;
        if ((fx * -Math.sin(yaw) + fz * Math.cos(yaw)) / L < 0.4 || (q.x * -fx + q.z * -fz) / (L * sp) < 0.3) continue;   // (facing it, and it's coming at him)
        if (now - (SHY_T.get(m.id) ?? -99) < 40) break;
        preHp(m); try { m.applyDamage(6, { cause: "entityAttack", damagingEntity: c.e }); } catch { try { m.applyDamage(6); } catch {} }
        horseShy(m);
        try { m.applyKnockback({ x: (fx / L) * 1.4, z: (fz / L) * 1.4 }, 0.3); } catch { try { m.applyKnockback(fx / L, fz / L, 1.4, 0.3); } catch {} }
        if (Math.random() < 0.35) { try { m.getComponent("minecraft:rideable")?.ejectRider(e); mountOf.delete(e.id); note(e, "thrown by his horse"); } catch {} }
        note(c.e, "set his spear against a horse"); v9stat("spearStop"); break;
      }
    } catch {}
  }
}, 4);
// ---- v9.19: "Follow me" squads keep a formation behind you (column, line or wedge: picked with the order, or auto),
// turned to the way you're walking; in a fight they fight as before
const FOLLOW = new Map();   // player id -> { ids, head, last, t }
function followFormOf(p, now) {
  let F = FOLLOW.get(p.id);
  if (F && now - F.t < 10) return F;
  F ??= {}; F.t = now;
  const ids = [];
  for (const o of p.dimension.getEntities({ type: SOLDIER, location: p.location, maxDistance: 48 })) { try { const d = sd(o); if (d.func === "follow" && d.leader === p.id && d.div !== "guard" && !downed.has(o.id) && !d.surr) ids.push(o.id); } catch {} }
  F.ids = ids.sort();
  const l = p.location;
  if (F.last) { const vx = l.x - F.last.x, vz = l.z - F.last.z, sp = Math.hypot(vx, vz); if (sp > 0.3 && sp < 20) { const hx = (F.head?.x ?? 0) * 0.5 + (vx / sp) * 0.5, hz = (F.head?.z ?? 1) * 0.5 + (vz / sp) * 0.5, L = Math.hypot(hx, hz) || 1; F.head = { x: hx / L, z: hz / L }; } }
  if (!F.head) { const f = fwdFromYaw(p.getRotation().y); F.head = { x: f.x, z: f.z }; }
  F.last = { x: l.x, y: l.y, z: l.z };
  FOLLOW.set(p.id, F);
  return F;
}
function followSlot(e, d, p, F) {
  const i = Math.max(0, F.ids.indexOf(e.id)), n = Math.max(1, F.ids.length);
  let shape = forcedShape(d.faction, d.squad || 0);
  if (!shape) shape = isIndoors(p) ? "column" : n >= 4 ? "wedge" : "column";
  const hx = F.head.x, hz = F.head.z, rx = -hz, rz = hx, sp = spacingSetting();
  let back, side;
  if (shape === "line") { back = 2.5; side = (i - (n - 1) / 2) * 1.6 * sp; }
  else if (shape === "wedge") { const k = Math.floor(i / 2) + 1; back = 1.2 + k * 1.5 * sp; side = (i % 2 ? 1 : -1) * k * 1.3 * sp; }
  else { back = 2 + Math.floor(i / 2) * 1.7 * sp; side = (i % 2 ? 0.8 : -0.8); }
  const l = p.location, x = l.x - hx * back + rx * side, z = l.z - hz * back + rz * side;
  const w = walkableNear(e.dimension, x, z, l.y);
  if (!w || Math.abs(w.y - l.y) > 2.5) return undefined;
  return { x: w.x, y: w.y, z: w.z, shape };
}
WarAPI.registerBehavior({
  name: "followForm", when: "first", priority: 95,
  decide(e, d, now) {
    if (d.func !== "follow" || d.div === "guard" || !d.leader) return undefined;
    const p = findPlayer(d.leader);
    if (!p || p.dimension.id !== e.dimension.id || isRiding(p) || isRiding(e) || dist(p.location, e.location) > 64) return undefined;
    if (perc.get(e.id)?.threat || squads.get(squadKey(e, d))?.known?.size || downed.has(e.id)) return undefined;   // (a fight: as before)
    const F = followFormOf(p, now), sp = followSlot(e, d, p, F);
    if (!sp) {                                                                    // (no place for him just there (a wall, a drop): he makes for you)
      const pd = flat(p.location, e.location);
      if (pd < 5 && Math.abs(p.location.y - e.location.y) < 1.5) return { g: "g_none", t: "t_mid", urgent: false, note: "with you" };
      const mv = catchUp(e, { x: p.location.x, y: Math.floor(p.location.y + 0.01), z: p.location.z }, p.location, now);
      return mv ? { ...mv, t: "t_mid", s: pd > 14 ? "s_7" : "s_6", urgent: true, note: "catching up" } : undefined;
    }
    const gap = Math.hypot(sp.x - e.location.x, sp.z - e.location.z);
    FOLLOW_ON.set(e.id, now);
    if (gap < 7 && Math.abs(sp.y - e.location.y) < 1.2) {                       // (the driver below keeps him there)
      if (personal.get(e.id)?.kind === "follow") { personal.delete(e.id); travelTo.delete(e.id); }
      return { g: "g_none", t: "t_mid", urgent: false, note: `in ${sp.shape}` };
    }
    const mv = catchUp(e, sp, p.location, now, F.head);                           // (v9.20.3: a straight walk, or a real route round whatever's in the way)
    return mv ? { ...mv, t: "t_mid", s: gap > 14 ? "s_7" : "s_6", urgent: true, note: `falling in (${sp.shape})` } : undefined;   // (quicker than you walk, or he never closes up)
  },
});
system.runInterval(() => { const now = tick(); for (const [k, F] of [...FOLLOW]) if (now - F.t > 600) FOLLOW.delete(k); for (const [k, t] of [...FOLLOW_ON]) if (now - t > 600) FOLLOW_ON.delete(k); for (const [k, t] of [...KICK]) if (now - t > 600) KICK.delete(k); }, 200);
// the follow driver: each tick a man near his place is carried onto it at your pace (like the guard detail), facing
// the way you're going; a wall, a drop or a step too high and his own walking takes over
const FOLLOW_ON = new Map();   // id -> tick he was last on the formation
const KICK = new Map();        // id -> tick he was last made to think at once (you got away from him)
system.runInterval(() => {
  if (!FOLLOW.size) return;
  const now = tick();
  for (const [pid, F] of FOLLOW) {
    const p = findPlayer(pid);
    if (!p?.isValid || now - F.t > 100 || !F.ids?.length) continue;
    try {
      const pl = p.location, last = F.drvLast; F.drvLast = { x: pl.x, z: pl.z };
      const pace = last ? Math.min(0.6, Math.hypot(pl.x - last.x, pl.z - last.z)) : 0;
      const maxStep = Math.min(0.42, Math.max(0.18, pace * 1.3));
      for (const id of F.ids) {
        if (now - (FOLLOW_ON.get(id) ?? -999) > 60) continue;
        const e = world.getEntity(id);
        if (!e?.isValid || downed.has(id) || isRiding(e) || climbing.has(id) || gliders.has(id) || personal.has(id) || staggered(id) || perc.get(id)?.threat) continue;
        const d = sd(e), sp = followSlot(e, d, p, F); if (!sp) continue;
        if (!driveStep(e, sp, maxStep, F.head, pl) && flat(sp, e.location) > 7 && now - (KICK.get(id) ?? -99) > 15) { KICK.set(id, now); try { think(e); } catch {} }   // (you dashed off: he goes now, not at his next thought)
      }
    } catch {}
  }
}, 1);
// ---- v9.19: the watch, day and night. A squad at rest keeps men on watch (a quarter by day, a third at night), each at
// his own post 6 blocks out from the others, facing out; the watch changes every two minutes
const DAYWATCH = new Map();   // squad key -> { ids: [], t }
system.runInterval(() => {
  const now = tick();
  for (const [k, S] of squads) {
    try {
      if (!S.ours?.length || S.known?.size) { DAYWATCH.delete(k); continue; }
      const men = S.ours.filter((o) => o.isValid && !downed.has(o.id) && !pows.has(o.id) && !isRiding(o) && ["hold", "post", "stand"].includes(sd(o).func) && !SLEEP.has(o.id));
      if (men.length < 3) { DAYWATCH.delete(k); continue; }
      let W = DAYWATCH.get(k);
      if (!W || now - W.t > 2400 || W.ids.some((id) => !men.some((o) => o.id === id))) {
        const n = Math.max(1, Math.round(men.length / (NIGHT ? 3 : 4))), off = new Set(W?.ids ?? []);
        const pool = men.filter((o) => !off.has(o.id) && !OFFICER_IDS.has(o.id)), pick = (pool.length >= n ? pool : men).slice(0, n);
        const cx = men.reduce((a, o) => a + o.location.x, 0) / men.length, cz = men.reduce((a, o) => a + o.location.z, 0) / men.length, cy = men[0].location.y;
        W = { ids: pick.map((o) => o.id), t: now, c: { x: cx, y: cy, z: cz } }; DAYWATCH.set(k, W);   // (the camp's middle, fixed for this watch)
        for (const o of pick) note(o, "taking the watch");
      }
    } catch {}
  }
  for (const k of [...DAYWATCH.keys()]) if (!squads.has(k)) DAYWATCH.delete(k);
}, 100);
WarAPI.registerBehavior({
  name: "onWatch", when: "first", priority: 55,
  decide(e, d, now) {
    if (!["hold", "post", "stand"].includes(d.func) || downed.has(e.id) || personal.has(e.id) || SLEEP.has(e.id) || perc.get(e.id)?.threat) return undefined;
    const k = squadKey(e, d), W = DAYWATCH.get(k); if (!W) return undefined;
    const i = W.ids.indexOf(e.id); if (i < 0) return undefined;
    const c = W.c; if (!c) return undefined;
    const base = (idSeed(e) % 360) * Math.PI / 180, a = base + (i / W.ids.length) * Math.PI * 2;
    const want = walkableNear(e.dimension, c.x + Math.cos(a) * 6, c.z + Math.sin(a) * 6, c.y);
    if (!want || Math.abs(want.y - c.y) > 2) return undefined;
    const gap = flat(want, e.location);
    if (gap > 1.3) { const slot = myMarker(e, want, "war:mymk", 0.5); return slot ? { g: gap > 6 ? "g_wp" : "g_post", slot, t: "t_mid", urgent: false, note: "going on watch" } : undefined; }   // (v9.20.3: the last blocks with the walking that stops at a block, not 3: pushed the last steps, he stood 5 blocks out "going on watch")
    if (now % 20 === 0) turnTo(e, { x: e.location.x + Math.cos(a) * 8, z: e.location.z + Math.sin(a) * 8 }, 8);
    return { g: "g_none", t: "t_long", urgent: false, note: "on watch" };
  },
});

// ================================================================ v9.19: missions (War Table > Missions)
// Attack / Defend: one side holds a spot, the other comes for it, against the clock.
// Wave survival: waves of the enemy, bigger each time, come at you from all sides until you fall.
// Escort: get a VIP across the map alive; the enemy waits along the way.
let MISSION;   // { kind, ... } (one at a time; a reload ends it)
const MS_SQ = { att: 8, def: 7, wave: 9, esc: 6, amb: 5 };
function msSpawn(owner, dim, at, f, n, mix, func, squad, spread = 3) {
  const out = [];
  for (let k = 0; k < n; k++) {
    try {
      const a = (k / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.4, rr = 1.5 + (k % 4) * spread * 0.5;
      const pos = walkableNear(dim, at.x + Math.cos(a) * rr, at.z + Math.sin(a) * rr, at.y) ?? at;
      const MIXG = ["rifle", "smg", "semi", "mg", "rifle"], MIXM = ["sword", "crossbow"];
      const w = mix === "mixguns" ? MIXG[k % MIXG.length] : mix === "mixmelee" ? MIXM[k % 2] : mix;
      const e = dim.spawnEntity(SOLDIER, { x: pos.x, y: pos.y, z: pos.z }, { spawnEvent: "war:init" });
      const fin = setupSoldier(e, { faction: f, squad, weapon: w, ranged: isRangedW(w), div: "foot", radius: 8, func: "__none", owner: owner.id, skin: reinfSkin({ f }) || undefined }, owner) ?? e;
      giveFunction(fin, func, owner, ANCHORED.includes(func) ? makeWaypoint(dim, pos) : undefined);
      out.push(fin);
    } catch {}
  }
  return out;
}
function msMarch(owner, pool, f, squad, to) {
  try { giveOrderInner(owner, { faction: f, order: ORDERS.findIndex((o) => o[0] === "charge"), squad, count: 0, radius: 600, stance: "aggressive", ao: 100, free: true, target: 5, cx: Math.floor(to.x), cz: Math.floor(to.z), cy: to.y, then: "hold" }, pool.filter((q) => q.isValid)); } catch {}
}
const msUp = (list) => list.filter((e) => { try { return e.isValid && !downed.has(e.id) && !pows.has(e.id) && !sd(e).surr; } catch { return false; } });
function msHud(text, at, dimId) { for (const p of world.getAllPlayers()) { try { if (p.dimension.id === dimId && dist(p.location, at) < 250) p.onScreenDisplay.setActionBar(text); } catch {} } }
function msEnd(title, sub) {
  const M0 = MISSION; MISSION = undefined; if (!M0) return;
  for (const p of world.getAllPlayers()) { try { if (p.dimension.id === M0.dim) p.onScreenDisplay.setTitle(title, { subtitle: sub, fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20 }); } catch {} }
  chronLog(`Mission over: ${title.replace(/§./g, "")} (${sub.replace(/§./g, "")})`);
}
const mmss = (t) => `${Math.floor(t / 1200)}:${String(Math.floor((t % 1200) / 20)).padStart(2, "0")}`;
const DIRS = [["North", 0, -1], ["East", 1, 0], ["South", 0, 1], ["West", -1, 0]];
async function missionMenu(p) {
  if (MISSION) {
    const r0 = await show(new ActionFormData().title("Missions").body(`A mission is on: ${MISSION.kind}.`).button("§cStop it").button("Leave it running"), p);
    if (r0?.selection === 0) msEnd("§7Mission stopped", ""); return;
  }
  const r = await show(new ActionFormData().title("Missions").button("Attack / Defend\n§8one side holds a spot, the other takes it").button("Wave survival\n§8waves come at you, bigger each time").button("Escort\n§8get a VIP across alive"), p);
  if (!r || r.canceled || r.selection === undefined) return;
  const look = lookedSpot(p, 150) ?? p.location, mixes = REINF_MIX.map((m) => m[1]), fl = factionList(), pf = Math.max(0, (playerFaction(p) || 1) - 1);
  if (r.selection === 0) {
    const f = new ModalFormData().title("Attack / Defend").dropdown("Defenders", fl, { defaultValueIndex: pf }).slider("Defenders: how many", 4, 60, { valueStep: 2, defaultValue: 10 })
      .dropdown("Attackers", fl, { defaultValueIndex: pf === 0 ? 1 : 0 }).slider("Attackers: how many", 4, 80, { valueStep: 2, defaultValue: 16 })
      .dropdown("Weapons", mixes, { defaultValueIndex: 0 }).dropdown("Attackers come from", [...DIRS.map((d) => d[0]), "Anywhere"], { defaultValueIndex: 4 })
      .slider("From how far (blocks)", 30, 150, { valueStep: 10, defaultValue: 60 }).slider("Time limit (minutes)", 2, 20, { valueStep: 1, defaultValue: 6 });
    const fr = await show(f, p); if (!fr || fr.canceled || !fr.formValues) return;
    const v = fr.formValues.map(Number), df = v[0] + 1, af = v[2] + 1;
    if (df === af) { p.sendMessage("§cPick two different factions."); return; }
    setRelPair(df, af, "1", true);
    const dim = p.dimension, obj = { x: look.x, y: look.y, z: look.z };
    const dir = v[5] < 4 ? DIRS[v[5]] : DIRS[Math.floor(Math.random() * 4)], from = walkableNear(dim, obj.x + dir[1] * v[6], obj.z + dir[2] * v[6], obj.y) ?? { x: obj.x + dir[1] * v[6], y: obj.y, z: obj.z + dir[2] * v[6] };
    const defs = msSpawn(p, dim, obj, df, v[1], REINF_MIX[v[4]][0], "hold", MS_SQ.def, 5);
    const atts = msSpawn(p, dim, from, af, v[3], REINF_MIX[v[4]][0], "hold", MS_SQ.att, 3);
    system.runTimeout(() => msMarch(p, atts, af, MS_SQ.att, obj), 40);
    MISSION = { kind: "Attack / Defend", type: "ad", dim: dim.id, obj, defs, atts, df, af, end: tick() + v[7] * 1200, t0: tick() };
    say(`§e${factionLabel(af)}§e attacks, ${factionLabel(df)}§e defends: ${v[7]} minutes. Go!`);
  } else if (r.selection === 1) {
    const f = new ModalFormData().title("Wave survival").dropdown("The enemy", fl, { defaultValueIndex: pf === 0 ? 1 : 0 }).slider("First wave", 2, 20, { valueStep: 1, defaultValue: 4 })
      .slider("More each wave", 1, 10, { valueStep: 1, defaultValue: 2 }).slider("Seconds between waves", 20, 180, { valueStep: 10, defaultValue: 60 }).dropdown("Weapons", mixes, { defaultValueIndex: 0 })
      .slider("They come from (blocks away)", 25, 80, { valueStep: 5, defaultValue: 45 });
    const fr = await show(f, p); if (!fr || fr.canceled || !fr.formValues) return;
    const v = fr.formValues.map(Number), ef = v[0] + 1;
    if (playerFaction(p) && playerFaction(p) !== ef) setRelPair(playerFaction(p), ef, "1", true);
    MISSION = { kind: "Wave survival", type: "wave", dim: p.dimension.id, pid: p.id, ef, n0: v[1], grow: v[2], gap: v[3] * 20, mix: REINF_MIX[v[4]][0], far: v[5], wave: 0, next: tick() + 100, men: [], t0: tick(), kills: 0 };
    say(`§e${p.name} §eholds out against ${factionLabel(ef)}§e. First wave in 5 seconds.`);
  } else {
    const f = new ModalFormData().title("Escort: the VIP walks to where you're looking").dropdown("The VIP's side", fl, { defaultValueIndex: pf }).slider("Escorts", 0, 20, { valueStep: 1, defaultValue: 6 })
      .dropdown("The enemy", fl, { defaultValueIndex: pf === 0 ? 1 : 0 }).slider("Ambushes along the way", 1, 4, { valueStep: 1, defaultValue: 2 }).slider("Men in each ambush", 2, 16, { valueStep: 1, defaultValue: 5 }).dropdown("Weapons", mixes, { defaultValueIndex: 0 });
    const fr = await show(f, p); if (!fr || fr.canceled || !fr.formValues) return;
    const v = fr.formValues.map(Number), vf = v[0] + 1, ef = v[2] + 1;
    if (vf === ef) { p.sendMessage("§cPick two different factions."); return; }
    const dim = p.dimension, A = { ...p.location }, B = { x: look.x, y: look.y, z: look.z }, L = flat(A, B);
    if (L < 40) { p.sendMessage("§cLook at a spot at least 40 blocks away: that's where the VIP has to get to."); return; }
    setRelPair(vf, ef, "1", true);
    const vip = msSpawn(p, dim, A, vf, 1, "sword", "hold", MS_SQ.esc, 1)[0];
    if (!vip) { p.sendMessage("§cCouldn't place the VIP where you're standing. Try open ground."); return; }
    try { sdp(vip, "war:custom", "§6VIP"); vip.triggerEvent("war:hp_60"); updateName(vip); } catch {}
    const esc = msSpawn(p, dim, A, vf, v[1], REINF_MIX[v[5]][0], "hold", MS_SQ.esc, 3);
    const ambs = [];
    for (let i = 1; i <= v[3]; i++) {
      const t = i / (v[3] + 1), side = i % 2 ? 1 : -1, ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
      ambs.push({ at: { x: A.x + (B.x - A.x) * t - uz * side * 14, y: A.y, z: A.z + (B.z - A.z) * t + ux * side * 14 }, road: { x: A.x + (B.x - A.x) * t, y: A.y, z: A.z + (B.z - A.z) * t }, n: v[4], done: false });
    }
    for (const am of ambs) { const g = walkableNear(dim, am.at.x, am.at.z, am.at.y); if (g) am.at = g; am.men = msSpawn(p, dim, am.at, ef, am.n, REINF_MIX[v[5]][0], "hold", MS_SQ.amb, 3); }
    system.runTimeout(() => msMarch(p, [vip, ...esc], vf, MS_SQ.esc, B), 40);
    MISSION = { kind: "Escort", type: "esc", dim: dim.id, vip, esc, ambs, B, vf, ef, t0: tick() };
    say(`§eEscort: get the VIP to (${Math.round(B.x)}, ${Math.round(B.z)}) alive. ${v[3]} ambush${v[3] > 1 ? "es" : ""} wait along the way.`);
  }
}
system.runInterval(() => {
  const M0 = MISSION; if (!M0) return;
  const now = tick();
  try {
    if (M0.type === "ad") {
      const d = msUp(M0.defs), a = msUp(M0.atts), dNear = d.filter((e) => flat(e.location, M0.obj) < 20).length, aNear = a.filter((e) => flat(e.location, M0.obj) < 15).length, left = M0.end - now;
      msHud(`§e${factionLabel(M0.af)}§e attack: §f${a.length}§7  ·  ${factionLabel(M0.df)}§e hold: §f${d.length}§7  ·  §f${mmss(Math.max(0, left))}${aNear ? `  §c${aNear} at the objective` : ""}`, M0.obj, M0.dim);
      if (!a.length) msEnd(`§a${factionLabel(M0.df)}§a held!`, "every attacker is down");
      else if (!dNear && aNear) msEnd(`§c${factionLabel(M0.af)}§c took it!`, `in ${mmss(now - M0.t0)}`);
      else if (left <= 0) msEnd(`§a${factionLabel(M0.df)}§a held!`, "the time ran out for the attack");
    } else if (M0.type === "wave") {
      const p = findPlayer(M0.pid);
      if (!p?.isValid) { msEnd("§7Wave survival over", "the player left"); return; }
      const alive = msUp(M0.men);
      if (now >= M0.next && alive.length < M0.n0 + M0.grow * M0.wave + 6) {
        M0.wave++; M0.next = now + M0.gap;
        const n = M0.n0 + M0.grow * (M0.wave - 1), a = Math.random() * Math.PI * 2, dim = p.dimension, pl = p.location;
        const at = walkableNear(dim, pl.x + Math.cos(a) * M0.far, pl.z + Math.sin(a) * M0.far, pl.y) ?? { x: pl.x + Math.cos(a) * M0.far, y: pl.y, z: pl.z + Math.sin(a) * M0.far };
        const men = msSpawn(p, dim, at, M0.ef, n, M0.mix, "hold", MS_SQ.wave, 3); M0.men.push(...men);
        system.runTimeout(() => msMarch(p, men, M0.ef, MS_SQ.wave, { ...p.location }), 30);
        try { p.onScreenDisplay.setTitle(`§cWave ${M0.wave}`, { subtitle: `${n} coming from the ${["east", "south", "west", "north"][Math.floor(((a + Math.PI / 4) % (Math.PI * 2)) / (Math.PI / 2)) % 4]}`, fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10 }); } catch {}
      }
      if (now % 200 === 0 && alive.length) msMarch(p, alive.filter((e) => flat(e.location, p.location) > 20), M0.ef, MS_SQ.wave, { ...p.location });   // (they keep coming for you)
      M0.men = M0.men.filter((e) => e.isValid);
      msHud(`§cWave ${M0.wave}§7  ·  enemies left: §f${alive.length}§7  ·  next wave: §f${Math.max(0, Math.ceil((M0.next - now) / 20))}s`, p.location, p.dimension.id);
    } else if (M0.type === "esc") {
      const vip = M0.vip;
      if (!vip?.isValid) { msEnd("§cThe VIP is dead", "mission failed"); return; }
      const vl = vip.location, togo = Math.round(flat(vl, M0.B));
      for (const am of M0.ambs) {
        if (!am.done && flat(vl, am.road) < 32) { am.done = true; const p = findPlayer(world.getAllPlayers()[0]?.id) ?? world.getAllPlayers()[0]; if (p) msMarch(p, msUp(am.men), M0.ef, MS_SQ.amb, { ...vl }); }
      }
      msHud(`§6VIP§7: §f${togo}§7 blocks to go  ·  escorts: §f${msUp(M0.esc).length}${downed.has(vip.id) ? "  §c§lVIP DOWN: get a medic or first aid to him!" : ""}`, vl, M0.dim);
      if (togo < 6) msEnd("§aThe VIP made it!", `in ${mmss(now - M0.t0)}`);
    }
  } catch (err) { oops("mission", err); }
}, 20);
world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const M0 = MISSION; if (!M0) return;
    if (M0.type === "wave" && ev.deadEntity?.id === M0.pid) msEnd(`§cYou fell on wave ${M0.wave}`, `you held out ${mmss(tick() - M0.t0)}`);
    if (M0.type === "esc" && ev.deadEntity?.id === M0.vip?.id) msEnd("§cThe VIP is dead", "mission failed");
  } catch {}
});

// ---- v9.19: sound and sight of a battle for the player
// the crack of a round passing close by (within ~2.5 blocks of your head, from 10+ blocks off)
const CRACK_T = new Map();
function bulletCrack(dim, from, u, end, hitE, shooter) {
  if (!PLAYERS_LIST.length) return;
  const now = tick();
  for (const p of PLAYERS_LIST) {
    try {
      if (!p.isValid || p.dimension.id !== dim.id || p === hitE || now - (CRACK_T.get(p.id) ?? -99) < 4) continue;
      const h = { x: p.location.x, y: p.location.y + 1.6, z: p.location.z }, wx = h.x - from.x, wy = h.y - from.y, wz = h.z - from.z;
      const t = wx * u.x + wy * u.y + wz * u.z; if (t < 10 || t > end + 1) continue;
      const cx = from.x + u.x * t - h.x, cy = from.y + u.y * t - h.y, cz = from.z + u.z * t - h.z, dd = Math.hypot(cx, cy, cz);
      if (dd > 2.5) continue;
      CRACK_T.set(p.id, now);
      p.playSound("war.crack", { location: { x: h.x + cx, y: h.y + cy, z: h.z + cz }, volume: 0.9 - dd * 0.2, pitch: 0.9 + Math.random() * 0.25 });
    } catch {}
  }
}
// the rumble of a fight out of sight: lots of shooting 80-300 blocks from you
const RUMBLE_T = new Map();
system.runInterval(() => {
  if (!SHOTS.length) return;
  const now = tick();
  for (const p of PLAYERS_LIST) {
    try {
      if (!p.isValid || now - (RUMBLE_T.get(p.id) ?? -999) < 70) continue;
      const l = p.location; let n = 0, near = 0, sx = 0, sz = 0;
      for (const sh of SHOTS) { if (now - sh.t > 60) continue; const dd = Math.hypot(sh.x - l.x, sh.z - l.z); if (dd < 80) near++; else if (dd < 300) { n++; sx += sh.x; sz += sh.z; } }
      if (n < 6 || near > 2) continue;
      RUMBLE_T.set(p.id, now);
      const dx = sx / n - l.x, dz = sz / n - l.z, L = Math.hypot(dx, dz) || 1;   // (from the battle's direction)
      p.playSound("war.rumble", { location: { x: l.x + (dx / L) * 12, y: l.y + 2, z: l.z + (dz / L) * 12 }, volume: Math.min(0.9, 0.25 + n / 60), pitch: 0.85 + Math.random() * 0.2 });
    } catch {}
  }
}, 20);
// dust kicked up by men running (near a player)
system.runInterval(() => {
  if (!PLAYER_POS.length || perfLevel() === "low" || WEATHER_K < 1) return;
  for (const e of allOf(SOLDIER)) {
    try {
      const l = e.location;
      if (!PLAYER_POS.some((p) => p.d === e.dimension.id && Math.abs(p.x - l.x) < 24 && Math.abs(p.z - l.z) < 24)) continue;
      if (downed.has(e.id) || isRiding(e)) continue;
      const v = e.getVelocity(); if (Math.hypot(v.x, v.z) < 0.2 || Math.abs(v.y) > 0.1) continue;
      e.dimension.spawnParticle("war:dust", { x: l.x, y: l.y + 0.05, z: l.z });
    } catch {}
  }
}, 6);
// a tick in your ear when your shot or blow lands on a soldier or a war dog
world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const v = ev.hurtEntity; if (v?.typeId !== SOLDIER && v?.typeId !== HOUND) return;
    const a = ev.damageSource?.damagingEntity; if (a?.typeId !== "minecraft:player") return;
    a.playSound("war.hitmark", { volume: downed.has(v.id) ? 0.9 : 0.6, pitch: downed.has(v.id) ? 0.8 : 1.15 });
  } catch {}
});

// ---- v9.19: settings to share: every War Engine setting, faction language/skin/people and formations, as one code you
// can copy into another world (or keep). Paste a code back to load it.
const SHARE_KEYS = ["war:vlang", "war:fskins", "war:fgroups", "war:fshape"];
function settingsCode() {
  const o = { v: 1, set: {}, json: {} };
  for (const id of world.getDynamicPropertyIds()) if (id.startsWith("war:set_")) o.set[id.slice(8)] = world.getDynamicProperty(id);
  for (const k of SHARE_KEYS) o.json[k] = getJSON(world, k, undefined);
  const raw = JSON.stringify(o);
  let b64 = ""; try { b64 = btoa(unescape(encodeURIComponent(raw))); } catch { b64 = raw; }
  return "WE1:" + b64;
}
function loadSettingsCode(code) {
  const c = String(code).trim(); if (!c.startsWith("WE1:")) throw new Error("not a War Engine settings code");
  let raw = c.slice(4); try { raw = decodeURIComponent(escape(atob(raw))); } catch {}
  const o = JSON.parse(raw); let n = 0;
  for (const id of world.getDynamicPropertyIds()) if (id.startsWith("war:set_") && !(id.slice(8) in (o.set ?? {}))) sdp(world, id, undefined);   // (not in the code: back to the default)
  for (const [k, v] of Object.entries(o.set ?? {})) { if (/^[a-z_0-9]+$/.test(k) && ["string", "number", "boolean"].includes(typeof v)) { sdp(world, `war:set_${k}`, v); n++; } }
  for (const k of SHARE_KEYS) if (o.json?.[k] !== undefined) { setJSON(world, k, o.json[k]); n++; }
  return n;
}
async function settingsShare(p) {
  const r = await show(new ActionFormData().title("Export / import settings").body("Export gives you a code with every War Engine setting, each faction's languages and skins, and squad formations. Copy it (select the text and copy). Import: paste a code to load it here.").button("Export (show my code)").button("Import (paste a code)"), p);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection === 0) { const code = settingsCode(); await show(new ModalFormData().title("Your settings code").textField("Copy this:", "", { defaultValue: code }), p); console.warn(`War Engine settings code: ${code}`); return; }
  const f = await show(new ModalFormData().title("Import settings").textField("Paste a code (starts with WE1:)", "WE1:..."), p);
  if (!f || f.canceled || !f.formValues) return;
  try { const n = loadSettingsCode(f.formValues[0]); for (const e of allOf(SOLDIER)) { try { syncSkin(e); NAME_KEY.delete(e.id); } catch {} } p.sendMessage(`§aLoaded ${n} settings.`); }
  catch (err) { p.sendMessage(`§cThat code didn't load: ${String(err?.message ?? err).slice(0, 80)}`); }
}
// ---- v9.19: what went wrong lately (script errors, counted and written to the content log as before)
async function problemsMenu(p) {
  const body = ERR_LOG.length ? ERR_LOG.slice().reverse().map((x) => `§7${new Date(x.t).toISOString().slice(11, 19)} §e${x.sys}§r: ${x.msg}`).join("\n\n") : "§aNo script errors since the world loaded.";
  await show(new ActionFormData().title("Recent problems").body(`${body}\n\n§8These help when reporting a bug. The full details are in the content log.`).button("OK"), p);
}

// ---- v9.19: the War Engine Guide (an item): what everything does, in a few pages
async function guideBook(p) {
  while (true) {
    const f = new ActionFormData().title("War Engine Guide").body("Pick a chapter.");
    for (const [t] of GUIDE) f.button(t);
    const r = await show(f, p); if (!r || r.canceled || r.selection === undefined) return;
    const [t, body] = GUIDE[r.selection];
    const r2 = await show(new ActionFormData().title(t).body(body).button("« Chapters").button("Close"), p);
    if (!r2 || r2.canceled || r2.selection !== 0) return;
  }
}

// ---- v9.19: soldiers drive the troop boat, the gunboat and the transport truck themselves when no player has the
// wheel: after the player they follow (anyone aboard on "Follow me" / "Escort", e.g. put aboard with Mount up or
// Board), else to where their order sends them. They slow as they close in and stop a few blocks off; a truck takes
// one-block steps, a boat only goes where there's water.
const CREW_DRIVEN = ["war:boat", "war:gunboat", "war:truck"];
function crewDest(riders, dimId) {
  for (const r of riders) {
    if (r.typeId !== SOLDIER) continue;
    try {
      const d = sd(r);
      if ((d.func === "follow" || d.func === "escort") && d.leader) { const p = findPlayer(d.leader); if (p && p.dimension.id === dimId) return { at: p.location, stop: 6 }; }
      const rt = rideTo.get(r.id); if (rt) return { at: rt, stop: 4 };
    } catch {}
  }
  return undefined;
}
function crewDrive(v, riders, st, loc, vel, boat) {
  const want = crewDest(riders, v.dimension.id); if (!want) return { x: 0, z: 0 };
  const dx = want.at.x - loc.x, dz = want.at.z - loc.z, L = Math.hypot(dx, dz);
  if (L <= want.stop) return { x: 0, z: 0 };
  let inWater = false;
  if (boat) { try { inWater = !!v.dimension.getBlock({ x: loc.x, y: loc.y - 0.1, z: loc.z })?.isLiquid || !!v.dimension.getBlock(loc)?.isLiquid; } catch {} }
  const max = boat ? (inWater ? (v.typeId === "war:gunboat" ? 0.5 : 0.4) : 0.04) : 0.28;
  const wantYaw = (Math.atan2(-dx, dz) * 180) / Math.PI, cur = v.getRotation().y;
  const off = Math.abs(((wantYaw - cur + 540) % 360) - 180);
  const yaw = turnToward(cur, wantYaw, boat ? 5 : 3.5);
  v.setRotation({ x: 0, y: yaw });
  let sp = max * Math.min(1, (L - want.stop) / 8 + 0.25) * (off > 90 ? 0.25 : off > 45 ? 0.6 : 1);
  if (!boat && solidAt(v.dimension, { x: loc.x, y: loc.y - 0.2, z: loc.z })) {      // a one-block step ahead: up it goes
    const f0 = fwdFromYaw(yaw), ahead = { x: loc.x + f0.x * 1.8, y: loc.y + 0.5, z: loc.z + f0.z * 1.8 };
    if (solidAt(v.dimension, ahead) && !solidAt(v.dimension, { x: ahead.x, y: loc.y + 1.5, z: ahead.z }) && !solidAt(v.dimension, { x: ahead.x, y: loc.y + 2.5, z: ahead.z })) { try { v.applyImpulse({ x: 0, y: 0.45, z: 0 }); } catch {} }
    else if (solidAt(v.dimension, ahead)) sp *= 0.3;                                  // (a wall: it eases off and turns)
  }
  if (boat && !inWater) sp = Math.min(sp, 0.04);
  const f = fwdFromYaw(yaw);
  return { x: f.x * sp, z: f.z * sp };
}
