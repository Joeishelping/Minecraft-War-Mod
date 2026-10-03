// Example extension (not loaded; add it to extensions/index.js to try it).
// A soldier holding a post inside a building who sees no enemy faces the nearest doorway, so a defender is always
// looking where trouble comes from. Shows: registerBehavior, the helpers on WarAPI.lib, and returning a move.
import { WarAPI } from "../api.js";

WarAPI.registerBehavior({
  name: "face the door",
  when: "last",           // only when nothing else (fighting, orders, routes) wants him
  priority: 10,
  decide(e, d, now, lib) {
    if (!["hold", "post", "sentry"].includes(d.func) || now % 40 !== 0) return undefined;
    if (lib.perc.get(e.id)?.threat || !lib.isIndoors(e)) return undefined;
    const door = lib.nearestBlock(e, (b) => b.typeId.includes("door"), 8);
    if (door) lib.turnTo(e, door, 30);
    return undefined;     // turning only: he keeps his spot
  },
});

WarAPI.on("order", (player, cfg, soldiers) => {
  // e.g. log every order to the War Chronicle, play a sound, give a radio reply...
});
