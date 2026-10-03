// Vice Pack: beer, liquor, cigarettes, cigars, cocaine, ketamine, opium.
// Every item is a food you hold to use (drink / eat animation). When the use completes, `consume` runs the
// substance's handler: potion effects, a screen tint (camera fade), camera shake, sounds and particles.
// A one-second loop runs the lasting parts: drunkenness (sway, hiccups, blackout), smoke trailing from a lit
// cigarette/cigar, the cocaine crash, ketamine "k-hole" pulses, opium drowsiness, the HUD line and overdoses.
import { world, system, MolangVariableMap } from "@minecraft/server";

const SEC = 20;

// ---------------------------------------------------------------- per-player state
/** @type {Map<string, any>} */
const states = new Map();
function st(p) {
  let s = states.get(p.id);
  if (!s) {
    s = {
      drunk: 0,            // 0..10, beer +1, liquor +2.5, -1 per 45 s
      smokeUntil: 0,       // tick a lit cigarette/cigar burns out
      smokeKind: "",
      nicotine: [],        // ticks of recent smokes (chain smoking -> coughing)
      cokeUntil: 0, cokeCrash: false,
      kUntil: 0,
      opiumUntil: 0,
      doses: { cocaine: [], ketamine: [], opium: [] },
      odUntil: {},         // per kind: no second overdose of the same kind within 30 s
    };
    states.set(p.id, s);
  }
  return s;
}

// ---------------------------------------------------------------- helpers
const now = () => system.currentTick;
const rand = (a, b) => a + Math.random() * (b - a);

function safe(fn) {
  try { fn(); } catch (e) { /* entity gone, camera API missing, etc. */ }
}
function effect(p, id, seconds, amp = 0, particles = false) {
  safe(() => p.addEffect(id, Math.round(seconds * SEC), { amplifier: amp, showParticles: particles }));
}
function sound(p, id, volume = 1, pitch = 1) {
  safe(() => p.dimension.playSound(id, p.location, { volume, pitch }));
}
/** tint the screen: colour 0..255, times in seconds */
function tint(p, r, g, b, fadeIn, hold, fadeOut) {
  safe(() => p.camera.fade({
    fadeColor: { red: r / 255, green: g / 255, blue: b / 255 },
    fadeTime: { fadeInTime: fadeIn, holdTime: hold, fadeOutTime: fadeOut },
  }));
}
function shake(p, intensity, seconds, type = "rotational") {
  safe(() => p.runCommand(`camerashake add @s ${intensity} ${seconds} ${type}`));
}
function say(p, msg) {
  safe(() => p.sendMessage(msg));
}
/** a point just in front of the face */
function mouth(p, ahead = 0.35, down = 0.12) {
  const h = p.getHeadLocation(), d = p.getViewDirection();
  return { x: h.x + d.x * ahead, y: h.y - down + d.y * ahead, z: h.z + d.z * ahead };
}
function particle(p, id, loc, vars) {
  safe(() => p.dimension.spawnParticle(id, loc, vars));
}
function tintVars(r, g, b) {
  const m = new MolangVariableMap();
  m.setColorRGB("variable.tint", { red: r, green: g, blue: b });
  return m;
}
function exhale(p, strength = 0.6) {
  const m = new MolangVariableMap();
  m.setSpeedAndDirection("variable.puff", strength, p.getViewDirection());
  particle(p, "vice:smoke_puff", mouth(p, 0.3, 0.15), m);
}
/** count of doses of `kind` taken in the last `windowSec` seconds (after adding this one) */
function dose(s, kind, windowSec) {
  const t = now();
  s.doses[kind] = s.doses[kind].filter((x) => t - x < windowSec * SEC);
  s.doses[kind].push(t);
  return s.doses[kind].length;
}

// ---------------------------------------------------------------- overdose
function overdose(p, s, kind) {
  if (now() < (s.odUntil[kind] ?? 0)) return false;
  s.odUntil[kind] = now() + 30 * SEC;
  const msg = {
    cocaine: "§cYour heart is pounding out of your chest... §7(cocaine overdose)",
    ketamine: "§5You can't feel your body anymore... §7(ketamine overdose)",
    opium: "§6Your breathing slows to a crawl... §7(opium overdose)",
    alcohol: "§eYou blacked out. §7(alcohol poisoning)",
  }[kind];
  say(p, msg);
  tint(p, 0, 0, 0, 0.6, 2.5, 2.0);
  shake(p, 0.6, 3);
  effect(p, "blindness", 8);
  effect(p, "nausea", 20);
  effect(p, "slowness", 15, 2);
  effect(p, "poison", 10, 1);
  if (kind !== "alcohol") effect(p, "wither", 6, 1);
  sound(p, "mob.warden.heartbeat", 1, 0.8);
  return true;
}

// ---------------------------------------------------------------- substances
const SUBSTANCES = {
  "vice:beer"(p, s) {
    s.drunk = Math.min(10, s.drunk + 1);
    effect(p, "strength", 30, 0);
    sound(p, "random.burp", 0.8, rand(0.9, 1.1));
    tint(p, 255, 190, 60, 0.3, 0.2, 1.2);
    say(p, "§6*gulp* §7Cold one.");
  },
  "vice:liquor"(p, s) {
    s.drunk = Math.min(10, s.drunk + 2.5);
    effect(p, "strength", 45, 1);
    effect(p, "resistance", 30, 0);
    effect(p, "fire_resistance", 20, 0);
    sound(p, "random.burp", 1, 0.7);
    tint(p, 200, 90, 20, 0.2, 0.4, 1.8);
    shake(p, 0.25, 1.5);
    say(p, "§6*cough* §7That burns.");
  },
  "vice:cigarette"(p, s) {
    light(p, s, "cigarette", 40);
    effect(p, "haste", 90, 0);
    s.nicotine = s.nicotine.filter((x) => now() - x < 300 * SEC);
    s.nicotine.push(now());
    if (s.nicotine.length >= 5) {      // chain smoking
      effect(p, "hunger", 15, 0);
      effect(p, "slowness", 8, 0);
      cough(p);
      say(p, "§7*hack* *cough* Maybe slow down on the smokes.");
    }
  },
  "vice:cigar"(p, s) {
    light(p, s, "cigar", 75);
    effect(p, "resistance", 90, 0);
    effect(p, "regeneration", 10, 0);
    effect(p, "haste", 60, 0);
    s.nicotine.push(now());
  },
  "vice:cocaine"(p, s) {
    const n = dose(s, "cocaine", 300);
    particle(p, "vice:powder", mouth(p, 0.25, 0.05), tintVars(1, 1, 1));
    sound(p, "mob.horse.breathe", 1, 1.6);
    sound(p, "random.orb", 0.6, 2);
    tint(p, 255, 255, 255, 0.05, 0.1, 0.8);
    shake(p, 0.35, 2, "positional");
    effect(p, "speed", 45, 2);
    effect(p, "haste", 45, 1);
    effect(p, "jump_boost", 45, 0);
    effect(p, "night_vision", 45, 0);
    s.cokeUntil = now() + 45 * SEC;
    s.cokeCrash = true;
    say(p, n === 1 ? "§f*sniff* §bEverything is sharp. Everything is fast." : "§f*sniff* §bMore. Faster.");
    if (n >= 3) overdose(p, s, "cocaine");
  },
  "vice:ketamine"(p, s) {
    const n = dose(s, "ketamine", 240);
    particle(p, "vice:powder", mouth(p, 0.25, 0.05), tintVars(0.85, 0.8, 1));
    sound(p, "mob.horse.breathe", 1, 1.4);
    sound(p, "mob.endermen.portal", 0.8, 0.5);
    tint(p, 110, 40, 170, 0.8, 1.0, 2.5);
    effect(p, "slowness", 35, 2);
    effect(p, "nausea", 30, 0);
    effect(p, "resistance", 35, 1);
    effect(p, "slow_falling", 35, 0);
    effect(p, "weakness", 35, 1);
    effect(p, "darkness", 6, 0);
    s.kUntil = now() + 35 * SEC;
    say(p, n === 1 ? "§5The world drifts away from you..." : "§5Deeper... into the hole.");
    if (n >= 3) overdose(p, s, "ketamine");
  },
  "vice:opium"(p, s) {
    const n = dose(s, "opium", 360);
    light(p, s, "opium", 12);
    sound(p, "random.fizz", 0.4, 0.6);
    tint(p, 255, 140, 40, 1.0, 0.8, 3.0);
    effect(p, "regeneration", 20, 1);
    effect(p, "resistance", 60, 1);
    effect(p, "slowness", 60, 1);
    effect(p, "weakness", 60, 0);
    effect(p, "nausea", 10, 0);
    s.opiumUntil = now() + 60 * SEC;
    say(p, n === 1 ? "§6A warm, heavy calm washes over you." : "§6So... heavy...");
    if (n >= 3) overdose(p, s, "opium");
  },
};

function light(p, s, kind, seconds) {
  s.smokeUntil = Math.max(s.smokeUntil, now() + seconds * SEC);
  s.smokeKind = kind;
  sound(p, "fire.ignite", 0.6, 1.2);
  particle(p, "vice:ember", mouth(p, 0.45, 0.15));
  system.runTimeout(() => { if (p.isValid) exhale(p, kind === "cigar" ? 1.0 : 0.7); }, 25);
}
function cough(p) {
  sound(p, "mob.horse.breathe", 0.8, 0.6);
  shake(p, 0.4, 0.6, "positional");
  safe(() => exhale(p, 1.2));
}

world.afterEvents.itemCompleteUse.subscribe((ev) => {
  const p = ev.source, item = ev.itemStack;
  if (!p || p.typeId !== "minecraft:player" || !item) return;
  const fn = SUBSTANCES[item.typeId];
  if (fn) safe(() => fn(p, st(p)));
});

// ---------------------------------------------------------------- lasting effects (every second)
function bar(level, max = 10, cells = 5) {
  const full = Math.round((level / max) * cells);
  return "▮".repeat(full) + "▯".repeat(cells - full);
}
const secsLeft = (until) => Math.max(0, Math.ceil((until - now()) / SEC));

function drunkTick(p, s, t) {
  if (s.drunk <= 0) return;
  if (t % (45 * SEC) < SEC) s.drunk = Math.max(0, s.drunk - 1);
  const d = s.drunk;
  if (d >= 1 && Math.random() < 0.06) sound(p, "random.burp", 0.5, rand(1.3, 1.6));   // hiccup
  if (d >= 3) {
    effect(p, "nausea", 6, 0);
    // stumbling: a small sideways shove now and then
    if (p.isOnGround && Math.random() < 0.15 + d * 0.04) {
      const a = rand(0, Math.PI * 2), f = 0.12 + d * 0.035;
      safe(() => p.applyKnockback({ x: Math.cos(a) * f, z: Math.sin(a) * f }, 0));
    }
    if (Math.random() < 0.1) particle(p, "vice:swirl", { ...p.getHeadLocation(), y: p.getHeadLocation().y + 0.5 }, tintVars(1, 0.85, 0.2));
  }
  if (d >= 5) {
    effect(p, "slowness", 3, 0);
    if (Math.random() < 0.08) { tint(p, 0, 0, 0, 0.4, 0.3, 0.6); effect(p, "blindness", 2); }   // eyes droop
  }
  if (d >= 8 && overdose(p, s, "alcohol")) s.drunk = 5;
}

function smokeTick(p, s, t) {
  if (now() >= s.smokeUntil) return;
  // a wisp off the tip most seconds, a drag (exhale) every few seconds
  particle(p, "vice:smoke_wisp", mouth(p, 0.55, 0.2));
  const every = s.smokeKind === "cigar" ? 5 : 4;
  if ((t / SEC) % every < 1) {
    particle(p, "vice:ember", mouth(p, 0.5, 0.18));
    system.runTimeout(() => { if (p.isValid) exhale(p, s.smokeKind === "cigar" ? 0.9 : 0.6); }, 12);
  }
}

function cokeTick(p, s, t) {
  if (now() < s.cokeUntil) {
    if (Math.random() < 0.25) shake(p, 0.12, 0.5, "positional");        // jitters
    if (Math.random() < 0.2) particle(p, "vice:swirl", p.getHeadLocation(), tintVars(0.6, 0.9, 1));
    if ((t / SEC) % 6 < 1) sound(p, "mob.warden.heartbeat", 0.5, 1.6);
  } else if (s.cokeCrash) {
    s.cokeCrash = false;
    effect(p, "slowness", 30, 1);
    effect(p, "weakness", 30, 0);
    effect(p, "mining_fatigue", 30, 0);
    effect(p, "hunger", 20, 1);
    tint(p, 30, 30, 50, 0.5, 0.5, 2.0);
    say(p, "§8The rush is gone. You feel awful.");
  }
}

function ketTick(p, s, t) {
  if (now() >= s.kUntil) return;
  particle(p, "vice:swirl", p.getHeadLocation(), tintVars(0.7, 0.35, 1));
  if ((t / SEC) % 5 < 1) {
    // the world pulses in and out
    tint(p, rand(60, 140), 20, rand(120, 200), 1.0, 0.5, 1.5);
    shake(p, 0.2, 2, "rotational");
    sound(p, "mob.endermen.portal", 0.4, rand(0.4, 0.7));
  }
}

function opiumTick(p, s, t) {
  if (now() >= s.opiumUntil) return;
  if ((t / SEC) % 7 < 1) {
    tint(p, 20, 10, 0, 1.2, 0.6, 1.2);           // eyelids getting heavy
  }
  if (Math.random() < 0.15) particle(p, "vice:swirl", p.getHeadLocation(), tintVars(1, 0.6, 0.2));
}

function hud(p, s) {
  const parts = [];
  if (s.drunk > 0) parts.push(`§6Drunk ${bar(s.drunk)}`);
  if (now() < s.smokeUntil) parts.push(`§7Smoking ${secsLeft(s.smokeUntil)}s`);
  if (now() < s.cokeUntil) parts.push(`§bWired ${secsLeft(s.cokeUntil)}s`);
  if (now() < s.kUntil) parts.push(`§dK-hole ${secsLeft(s.kUntil)}s`);
  if (now() < s.opiumUntil) parts.push(`§eSedated ${secsLeft(s.opiumUntil)}s`);
  if (parts.length) safe(() => p.onScreenDisplay.setActionBar(parts.join(" §8| ")));
}

system.runInterval(() => {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const s = states.get(p.id);
    if (!s || !p.isValid) continue;
    safe(() => drunkTick(p, s, t));
    safe(() => smokeTick(p, s, t));
    safe(() => cokeTick(p, s, t));
    safe(() => ketTick(p, s, t));
    safe(() => opiumTick(p, s, t));
    safe(() => hud(p, s));
  }
}, SEC);

// a fresh start after death or leaving
world.afterEvents.entityDie.subscribe((ev) => states.delete(ev.deadEntity.id), { entityTypes: ["minecraft:player"] });
world.afterEvents.playerLeave.subscribe((ev) => states.delete(ev.playerId));
