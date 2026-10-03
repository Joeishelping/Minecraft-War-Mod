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
arrival spots. A soldier's own
errands are **personal routes** (`planPersonalTo` / `travel`), followed by `followPersonal` and the route driver.

## The decision chain (`think`, every second per soldier, staggered)

In order; the first that returns a move wins:

1. downed / prisoner / surrendered / falling back (wounded) handling
2. `medicMove`, `shakenMove` (rare breaks), `waterExit`, `reflexMove` (under fire: cover / off the line of fire)
3. **extensions, `when: "first"`**
4. `followPersonal` (his current route)
5. `spreadMove` (spreading out / making room)
6. `combatMove`: the squad brain `brainMove` (fire, advance, cover, peek, suppress, flank, position, sandbags, building
   tactics) plus close-combat drills; skipped for ~5 s after a fresh order so orders take effect at once
7. `engagement` (stop to shoot / move for a clear shot / close in)
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
- Anything that teleports a soldier checks the target cell first (`glideFree`): never into a block.

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
```
