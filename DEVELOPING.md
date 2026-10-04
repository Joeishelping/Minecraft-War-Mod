# War Engine: how it works and how to extend it

This is the map of the add-on for adding features without breaking the base AI.

## Files

| Path | What |
|---|---|
| `War Engine BP/scripts/main.js` | The whole engine: soldiers, orders, movement, perception, brain, gunfire, vehicles, menus |
| `War Engine BP/scripts/api.js` | The extension API (`WarAPI`) |
| `War Engine BP/scripts/extensions/` | Your additions: one file each, listed in `extensions/index.js` |
| `War Engine BP/entities/war_soldier.json` | The soldier entity: component groups the script switches (`w_*` weapon, `t_*` targeting, `g_*` movement, `s_*` speed, `r_*`, `d_*`) |
| `War Engine RP/` | Models, animations, skins |
| `tests/harness/` | Headless test world that runs the real `main.js` (see CHANGELOG) |
| `tests/harness/accept.mjs` | The acceptance suite: ten pass/fail checks on several seeds (`node accept.mjs 3 <dirA> [dirB]`) |
| `tools/build_mcaddon.py` | Builds `dist/War_Engine_vX_Y.mcaddon` |

## How a soldier is driven

The script moves soldiers in three ways:

1. **Markers.** A soldier walks (Minecraft's own walking, `g_wp`) to an invisible `war:waypoint` whose row/column tags
   match his goal tags (`setGoal`). Every order, lane, personal spot is a marker slot. `myMarker(e, loc)` is his own
   marker, moved, never re-spawned.
2. **The glider** (`v5.5`). In tight stretches (stairs, doorways, drops, indoors, near ladders) the script carries him
   along his planned route itself, every tick, single file. The ladder climber does the same on ladders.
3. **Pushes** (`push`, the movement arbiter): small impulses for flinches, dodges, stepping off a ledge.

Gunners never use vanilla targeting (`t_off`): the script picks targets, aims (`aimAt`) and fires (`gunTick`).
Melee soldiers and crossbows still use vanilla targeting.

### Routes
`planRoute` is the A* planner (the GPS) over real terrain in 3D: floors, stairs, ladders, doors (iron ones only from
the plate side), avoiding caves, deadly drops and lava; it shares a terrain memory and is time-sliced (no lag spikes).
Armies march on **marches** (`startMarch`): one planned path, a guide that runs ~6 blocks ahead of the front. v5.9: each
member walks to his own formation marker (`placeFormation`, key `war:fmk`, set as `war:catchup`); in tight stretches
or far behind he follows the route himself on his own marker (`war:mymk`, driven by the route driver / glider), with a
hold time before switching back (`driveOn`). The lanes (`m.lanes`) are only the march's shared goal tags and the
arrival spots. v6.0: formation and drive markers are only placed where a straight walk is safe (`straightReach`);
next to a drop (`edgeAt`) the glider carries them; a leg ends when the front is within a few points of its end; the
march holds while a member is locked in a fight (`combatLock`) and bounds while taking fire (`m.fireT`).
**Rescue** ("v6.0: rescue"): the only teleports: inside a block, cut off with no progress for 30 s, a failed ladder. A soldier's own
errands are **personal routes** (`planPersonalTo` / `travel`), followed by `followPersonal` and the route driver.

### v6.2: the movement gate, the danger map, out of range, stuck escalation, cleanup
- **Danger map.** `dangerNear(dim, loc)` is true by lava, fire or a deadly drop (`dropOrHazard`, `hazardCell`).
  Formation spots, lanes, rescue landings and spreading never pick such a cell. A soldier standing on one (a bridge, a
  wall-top, a ledge: "a passage") is never walked by Minecraft: he is held (`g_none`, velocity cleared, also while
  paused in a glider queue) and carried along a route.
- **The movement gate.** Every move a fight decides on goes through `moveTo(e, spot, now, urgent, kind)`. `safeSpot`
  picks the nearest safe, unclaimed cell he hasn't failed to reach lately (`failSpots`). Then he gets either a marker
  (a plain safe straight walk: `straightReach`, which is false over any danger cell) or a route of his own (`travel`).
  Short trips (≤14 blocks, ≤3 up/down) use `shortPath`, an instant BFS, so a fight move never waits on the planner.
  Fix a movement bug here and it is fixed for every system.
- **Out of range.** Beyond the simulation distance (~64 blocks from every player by default) mobs don't move, but
  the land is loaded and scripts run. `trackRemote` / `isRemote` detect a frozen soldier: he wants to walk (`wantsWalk`),
  hasn't moved for ~2 s, and no player is within 32 blocks. The route driver then carries him along his route. At the
  end of the known route `remoteSpread` gives each man his own free cell, then leaves him there (`remoteSettled`, tied
  to the route end). Beyond the loaded land nothing can be read: the route stops at the edge (`frontier`), the faction
  is told once, and the march looks again every 10 s, only planning once the land past the edge is loaded.
- **Long orders.** `orderLimit()` is the hard limit (setting `olimit`, default 500 blocks); orders beyond it are
  refused with a message. Orders over 160 blocks, or when only the last leg of an earlier coarse plan is left, are
  planned on the coarse map first and then in ~28-block fine legs. A route cut short never ends down in a pit.
  A march that can't find a way after 3 wide replans holds at its front and says so.
- **Stuck escalation** (rescue loop, every second). `pressing`: he wants to walk but has gone nowhere for 3 s. 1st:
  re-decide, avoiding that spot. 2nd: a fresh route to his goal. Then, if not fighting: rescue. Below his route with
  no way up (a trench with no steps, `belowRoute`), he gets his own short route; if that keeps failing, he is lifted
  to a squad mate who's making progress (`rescueTo`). If the whole squad is down there with him, he goes onto a free
  spot of his route ahead (`pitOut`). Landings are always 1.5 blocks from everyone and never by a danger cell.
- **Cleanup / repair** (War Table, button "Cleanup / repair"). Every pack entity gets a generation stamp (`war:gen`)
  when it spawns. Removing a faction or everything bumps the generation in `war:purge`. Anything loaded is removed at
  once, and anything with an old stamp is removed when its land loads (a sweep every 5 s). Repair clears marches,
  routes and memory maps, and every soldier holds where he stands.
- **Errors** (`oops`): every loop is wrapped. An error is logged once with a count (and shown in chat when the readout
  setting is on) instead of silently killing a loop.

### v6.3: stagger, edge fear, the TP wand
- **Stagger.** A hit that `knocksOver` counts (an enemy player, soldier or hound melee, a mob, an explosion; never
  friendly and never a soldier's or player's projectile) sets `stagger` for 14 ticks. While `staggered(id)`, the edge
  guards and the glider leave him alone, so the knockback plays out.
- **Edge fear.** Every 10 ticks, a soldier on a `dangerNear` cell with a threat within 5 blocks (an enemy player,
  hound or melee soldier, or a mob) gets a short `settle` route to the best safe cell within 4 blocks (2 on a post).
- **TP wand** (`war:tp_wand`). `held` (soldier id -> carrier) is checked in `allOf(SOLDIER)` and in the combatant
  snapshot, so held men are out of every loop and invisible to everyone. `beforeEvents.entityHurt` cancels all damage
  to them; the wand's hit calls `pickUp`. The entity side:
  - the `war:held` property is synced to the client, where Molang `scale` hides the model;
  - the `war:held` component group gives a tiny collision box and a damage sensor;
  - `war:held_off` removes that group and the body groups, and the script re-adds the right body group.

  `releaseAll` / `letGo` put them down on free safe cells (`dropCell`). A carried man is marked `war:held`, so after a
  reload he's put down where he is.

### v6.4: water, firing slots, trouble memory
- `dryDest` (in `startMarch`) moves an order's destination off water, lava or anything unstandable, to the nearest dry
  spot on the squad's side.
- `swimOn` swims for the route's next land point. `waterExit` gives up a crossing after 10 s without progress
  (`swimGiveUp`), and only exits onto banks within a block of the water surface (`waterSurface`).
- `firingSlot(dim, q)`: a `dangerNear` cell with the drop on one side only and solid cover on both sides (an embrasure,
  a window). `safeSpot` accepts it. Posts with no shot look for one within their reach (`engagement`, "taking a firing
  slot"). Posts are never stuck-rescue teleported.
- `TROUBLE` (dynamic property `war:trouble`): 2x2 cells with a weight 1-8, learned by `noteTrouble` from stuck
  escalations, rescues, pits and swim give-ups. It adds `2.5 x weight` to fine planner steps, `safeSpot` skips weight
  3 and up, it fades by 1 every 5 minutes untouched, and it holds at most 400 cells.

## The decision chain (`think`, every second per soldier, staggered)

In order; the first that returns a move wins:

1. downed / prisoner / surrendered / falling back (wounded) handling
2. `medicMove`, `shakenMove` (rare breaks), `waterExit`, `reflexMove` (under fire: cover / off the line of fire)
3. **extensions, `when: "first"`**
4. `followPersonal` (his current route)
5. `spreadMove` (spreading out / making room)
6. `combatMove`: the squad brain `brainMove` (fire, advance, cover, peek, suppress, flank, position, sandbags, building
   tactics) plus close-combat drills; skipped for ~5 s after a fresh order so orders take effect at once
7. `engagement` (stop to shoot / move for a clear shot / close in; v6.0: `updateLock` commits a marcher to an enemy
   soldier/player until he's down or lost for 15 s, hunting his last position)
8. `reinforceMove` (help a mauled squad nearby), catching up on a march, `patrolSweep`
9. **extensions, `when: "last"`**
10. otherwise: the order itself (hold the spot, march lane, follow...)

Then hooks `think` may adjust the chosen component groups before they're applied.

### Squad brain
Every second each squad (`squadKey`) pools what its members see (`S.known`), works out the force ratio and a plan:
`advance → contact → fix (pin + flank) → assault`, adapts when a flank or assault fails, and picks key terrain. Each
gunner then scores options with the weights `BW` (tuned by self-play) and commits for a moment. Positions come from the
**tactical evaluator** `tacSpot`: candidate spots scored for cover from the known enemies, a shot, ground gained,
height, and against crowding, doorways and long walks.

### Reflexes and learning
An enemy's hit makes him the soldier's target at once (`entityHurt` handler in "v5.8: reflexes") and triggers an
immediate re-think. `reflexMove` gets an exposed man out of incoming fire. Battle learning ("v5.8: battle learning"):
`learnStart`/`learnEnd` around each squad contact, weights in `LEARN_SPACE`, saved under `war:learn`; `bwOf(faction)`
returns the learned weights, `S.bw` the squad's variation during a fight.

### Perception and fire
`perceive` (every ~0.5 s): human reaction times by angle and distance, darkness, sneaking, poses, gunfire giving a
position away; a head in a window counts. `engageRange`: each gun's useful range (attackers close in to it; defenders
x1.4; returning fire x1.15); `shotAt`: the shot he'd really take now. Suppression only at a fresh sighting with a line.

## Performance rules (keep these and it stays lag-free)
- Read entity data through `gdp`/`sdp`/`P` (memory mirror), never `getDynamicProperty` directly. Per-run bookkeeping
  keys go in `TRANSIENT` (memory only).
- Blocks for planning/AI through `tBlock` (shared terrain memory, capped reads per tick), not `dim.getBlock`.
- Line of sight through `clearShot` (cached, capped per tick).
- Expensive choices go through a per-tick budget (`spendDecision`, `tacBudget`, `PLAN_BUDGET`).
- Use `allOf(type)` (once per tick) and `nearbyCombatants` (shared scan), not `getEntities` in loops.
- `headLoc(e)` instead of `e.getHeadLocation()` for soldiers.
- Factions of nearby entities from the shared snapshot (`nearSnap`: `c.f`, `c.down`), not `P(o, "war:faction")` in a loop.
- Thinking (`think`) and perception (`perceive`) are rotations with a fixed budget per tick (`THINK_MAX`, `PERC_MAX`);
  `isHot` decides who may be looked at less often. Don't add per-soldier loops that run every tick for everyone.
- Anything that teleports a soldier checks the target cell first (`glideFree`, `floorUnder`): never into a block, never
  over thin air.

## Armbands
`war:role` (entity property, 0-6) picks the band texture in `controller.render.war_band` (RP); geometry
`geometry.war_band` puts a band on both upper arms (bones named like the player model's, so every animation moves it).
`ROLE_OF` maps a soldier type to its band; add a texture to `textures/entity/war_band/` and the array for a new type.

## Adding things

### A behaviour (no core edits)
```js
// scripts/extensions/my_behaviour.js  (and add  import "./my_behaviour.js";  to extensions/index.js)
import { WarAPI } from "../api.js";
WarAPI.registerBehavior({
  name: "take the high window", when: "first", priority: 5,
  decide(e, d, now, lib) {
    if (d.weapon !== "sniper" || !lib.isIndoors(e)) return undefined;
    // ...pick a spot...
    // return lib.travel(e, spot, "spot", now)   // walk there along a real route (the glider handles stairs)
    return undefined;                            // pass: the normal chain carries on
  },
});
```
`d` is the soldier's data (`sd`): faction, weapon, div, func (the order), squad, goal... `lib` has the core helpers
(listed at the end of `main.js`: `WarAPI.lib`).

### Hooks
`WarAPI.on("order", (player, cfg, soldiers) => ...)`, `"setup"` `(e, spec)`, `"think"` `(e, d, want, now)`,
`"tick"` `(now)`.

### A weapon
Add it to `WEAPONS`, `GUNS`, each loadout in `LOADOUTS` (gun model), `GUN_SPEC` (bullet, ranges, magazine, reload,
speed, spread), `EFFECTIVE` (useful range), and a `war:w_<name>` component group in `war_soldier.json`.

### A soldier type
Add it to `DIV` and `FUNCS` (its orders) in `main.js`, an egg item in `BP/items`, and its menu text.

### An order
Add it to `ORDERS` (Command Baton) and handle it in `giveOrderInner`; give soldiers a function with `giveFunction`.

## Testing a change
```
cd tests/harness
node run.mjs load                                   # loads under Minecraft's load-time rules
node bench.mjs stairsDown,castleStairs,assault 5 <old scripts> -    # old vs new
node ab.mjs '{"tac":true}' '{"tac":false}' 8         # two brains fight each other (weights/flags per side)
node selfplay.mjs 10 5                              # tune BW by self-play
node run.mjs battlefield - bedrock=1 len=450 follow=1 ticks=16000   # a long order at real Bedrock speed
```
Bedrock mode (`bedrock=1`) makes the mock behave like the real game:
- `slow=15` runs the script about 15x slower against the clock, so the planner gets as little done per tick as in
  QuickJS;
- `harsh` cuts corners, wobbles and knocks soldiers back when hit;
- `loadR=160` unloads land beyond 160 blocks from every player (blocks throw, entities vanish);
- `simR=64` stops mobs beyond 64 blocks from moving.

Test long orders and anything near lava in this mode: normal mode is too kind. `lava` in a report counts soldiers
that touched lava, and `errors` lists anything `oops` reported.
