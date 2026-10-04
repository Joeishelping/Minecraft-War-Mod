// War Engine extension API (v5.6)
// Extensions live in scripts/extensions/ and are listed in scripts/extensions/index.js. They register here while the
// add-on loads; the core calls them at fixed points. The core's own helpers are on WarAPI.lib once the world runs
// (never touch world data or WarAPI.lib while scripts are still loading: do it inside the callbacks).
export const WarAPI = {
  version: "7.1",
  // decision behaviours: { name, when: "first" | "last", priority, decide(e, d, now, lib) -> move | undefined }
  //   "first": before the combat brain (after medic / shaken / water). "last": only when nothing else wants him.
  //   A move is { g: "g_wp", slot, t: "t_mid", urgent } (walk to a marker slot; lib.myMarker / lib.travel make one)
  //   or { g: "g_none", t: "t_mid" } (stand). Return undefined to pass.
  behaviors: [],
  hooks: {
    think: [],   // (e, d, want, now) after the brain decided: may edit want = { w, t, g, s, d, r } (component groups)
    order: [],   // (player, cfg, soldiers) after an order from the Command Baton was given
    setup: [],   // (e, spec) after a soldier was (re)configured
    tick: [],    // (now) once per tick
  },
  lib: undefined,  // filled by the core: sd, travel, myMarker, note, perc, squads, shotAt, tacSpot, planPersonalTo, ...
  registerBehavior(b) { this.behaviors.push({ priority: 0, when: "first", ...b }); this.behaviors.sort((a, c) => c.priority - a.priority); },
  on(hook, fn) { (this.hooks[hook] ??= []).push(fn); },
};
