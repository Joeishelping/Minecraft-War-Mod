# War Engine changelog

## v6.3.1 (two squads in one spot, the long scan after a fight)

- **Two squads jammed in one spot.** A soldier a little past a route point could get his carried walk (the glider)
  started on the point *behind* him: carried half a block back, his own walking took him forward again, and round
  it went. In a gap or doorway with another squad, that turned into a pile shuffling on one spot. Now he starts on
  the point ahead. Also, a soldier of another squad coming the other way no longer counts as "someone to wait
  behind" (both sides used to wait for each other).
  - Test: two squads of 8 meeting head-on in a 3-wide gap in a wall. Before: they stood stuck up to 21 s, lots of
    shuffling, a pile of 10, through in ~1,200 ticks. Now: the longest stop is 1 s, through in ~930 ticks.
  - The same fix helps stairs and doorways: castle stairs ~7% faster with less bunching.
- **Shorter scan after a fight.**
  - Killed the man they were after: no searching at all. A killed player (who stays a valid entity) now counts as
    gone too.
  - Lost sight of him: a ~5 s search (was 10), 2 s on the march or on a post (was 3).
  - Hunting someone out of sight: given up after 6 s (was 15), and after 2.5 s at the spot he was last seen.
  - Test: after the last enemy goes down, the squad is moving on in 2-3 s.

## v6.3 (knocked into lava, wary of edges, the TP wand)

- **They can be knocked off now.** v6.2's edge safety cancelled every push near a drop or lava, so hitting someone
  in was impossible. Now a hit from an enemy player, an enemy soldier or hound, a mob (arrows included) or an
  explosion staggers him for ~0.7 s. Nothing cancels the knockback, so a good hit by the lava sends him in. Hits from
  your own side or allies never do, and neither do gun bullets (a wall full of riflemen would empty itself). His own
  moves (flinching, dodging, spacing out, walking) still never take him over the edge. Test: enemy punch, mob and
  explosion all knock him into a lava channel; a friendly punch and a bullet don't.
- **They're wary of edges.** Standing by lava or a drop with an enemy player, a melee soldier, a hound or a mob within
  5 blocks, a soldier steps to the nearest safe spot away from him. A man on a post steps back at most 2 blocks: he
  doesn't abandon the wall. On a 1-wide bridge or a narrow wall there may be nowhere to go: then a well-timed hit
  still gets him.
- **TP wand** (new item, next to the Unit Wand):
  - Hit one of your own soldiers with it: he's picked up, with no damage. You can carry up to 10.
  - Carried soldiers are hidden and come with you. They can't be hurt, don't shoot and don't move, and nobody can
    see or target them.
  - Right-click: they're all put down around your feet. Each one lands on his own free cell, never stacked and never
    by lava or a drop, and carries on with what he was doing. A march or a charge re-routes from there; a man on a
    post (hold, post, sentry, stand, patrol) takes the new spot as his post.
  - Only your own faction. Hitting an enemy with the wand is just a hit.
  - If you leave the game or die while carrying soldiers, they're put down where you were. After a reload,
    anyone still marked as carried is put down where he is. Cleanup / repair puts everyone down first.

## v6.2 (long orders that really go the distance, no walking into lava, unsticking, cleanup)

Built on v6.0 (the version you liked). Only the safe parts of v6.1 were kept: the crash fix for long orders, and the
lava and drop safety. New mechanics are on hold: this release only fixes things. Every number below comes from the
test harness running in **Bedrock mode**: script speed like the real game, land unloaded beyond 160 blocks, mobs
frozen beyond 64 blocks, sloppy walking and knockback. v6.0 was tested the same way.

- **Long orders.** The real cause of "doesn't take long orders": Minecraft stops moving mobs ~64 blocks from every
  player (the simulation distance). The land is still loaded there, but they just freeze. Now:
  - The script spots a frozen soldier (should be walking, hasn't moved, no player nearby) and carries him along his
    route at walking pace, single file. Back in range, normal walking takes over.
  - Beyond the loaded land (about 10 chunks) nothing can be seen. The squad goes to the edge, spreads out (no pile),
    and your faction gets one message: "waiting at the edge of the loaded land, come closer". It carries on as the
    land loads.
  - Routes over 160 blocks are planned in short legs on a coarse map. At the game's real speed, one 200-block
    block-by-block search took over a minute while the squad stood still.
  - Results at real speed (12 soldiers, cluttered battlefield, player following):

    | Order | v6.0 | v6.2 |
    |---|---|---|
    | 245 blocks | ~3,900 ticks, standing still up to ~80 s at a time | ~2,700 ticks, longest pause ~11 s |
    | 450 blocks | ~8,700 ticks | ~5,100 ticks |

    300- and 330-block detours arrive too. With you standing still, 100 blocks arrives. 150+ blocks waits at the edge
    of the loaded land, with the message.
  - **Hard limit: 500 blocks** (setting `olimit`). A farther order is refused: "Too far: N blocks (limit 500)".
  - Every order says where it's going and how far ("Squad 1 -> (x, z), N blocks"), and says when it arrives
    ("Squad 1 in position"). If no way is found after several tries, they hold where they are and say so.
  - The newest order always replaces the old one.
- **Walls by lava, bridges over lava.** Every fight move now goes through one movement gate. Spots by lava, fire or a
  deadly drop are never picked; a safer cell nearby is used instead. Minecraft's own walking is only used for a plain,
  safe straight walk. Anything else is a planned route, so they use the bridge. Short hops are worked out instantly,
  so fights don't wait on the planner (v6.1's sluggishness).
  - A soldier on a bridge, wall-top or ledge is held still (no drifting, no knockback while waiting his turn) and
    carried along.
  - Test: 16 harsh castle battles with both sides charging, wall-top and lava channel layouts: 0 soldiers in the lava.
- **Doing something stupid.**
  - Pressing into a wall / going nowhere for 3 s: he re-decides (that spot is avoided). Next he gets a fresh route.
    Still stuck about 12 s later (and not in a firefight): teleported next to a squad mate who is making progress.
    He lands at least 1.5 blocks from everyone, never by a drop or lava, never in a pile.
  - Fell into a trench or pit with no steps out: a short route out. If none exists, lifted out. That works even if
    the whole squad is down there, onto a free spot on their route ahead. A route cut short no longer ends at the
    bottom of a pit (a 450-block march used to end in a trench).
  - A guessed straight line (no route found yet) no longer counts as "arrived". It used to say "in position" 100
    blocks short.
- **Fights.** A soldier being shot at returns fire at whatever shows of the shooter, even only a head in a window.
  Before, attackers walked under machine-gun fire without firing a shot. A march only stops to bound (move/cover)
  while someone is actually firing back.
- **Cleanup / repair** (War Table -> "Cleanup / repair"):
  - Repair: clears all marches, routes and stuck memory; everyone holds where they stand.
  - Remove near me: radius 8-160 blocks.
  - Remove a faction, or remove everything from the pack: soldiers, hounds, MG nests, vehicles, flags, markers,
    shells. Things in unloaded land are removed the moment their land loads (each one carries a stamp). Nothing is
    added to the world, no ticking areas.
- **Errors** are no longer silent. Every loop is guarded: an error is logged once with a count (and shown in chat
  with the readout setting on), and the system keeps running.

**Limits (what can't be done, and what happens instead).**
- Nothing in unloaded land can be moved or even seen by a script. Past ~10 chunks from every player, a squad waits at
  the edge (with a message) until someone comes closer.
- Out of simulation range they are carried along the route, but they don't fight there (the game doesn't simulate
  them). Fights happen once a player is near.
- A frozen soldier is detected after ~2 s of standing still when he should be walking, so out-of-range marching
  starts with a short pause.
- Defenders now man their windows quickly. A squad charging a building with machine guns across ~90 blocks of open
  ground now loses. It used to win only because the defenders were slow to reach their windows. Attack with more
  men, from cover, or from closer.
- In plain normal-speed tests, some marches are a bit slower than v6.0 (245 blocks: ~2,500 vs ~2,150 ticks), because
  they use short legs. At the game's real speed they are much faster (above).

## v6.1 (the crash on longer orders, castles and lava moats)

- **The crash on march orders of ~100-280 blocks.** Orders under 280 blocks were worked out in one search of up to
  120,000 steps, every step stored with text keys. On real terrain that has to detour (a long wall, a river, a
  mountain) that's hundreds of thousands of objects: ~255 MB in the test, enough to bring down the game's script
  engine. v6.0 made it more likely (the "find another way" replans finally worked, each one another big search). Now:
  number keys (several times less memory), orders over 150 blocks (and any order the direct search can't solve) are
  planned on the coarse map in short legs, every search has a hard size cap, at most 30 searches exist at once, and a
  stuck march re-thinks at most every 20 s. Test, a 250-block order around a long wall: 37,000 search steps -> 2,300,
  the squad still gets there.
- **Castles, bridges and lava moats.** Fighting moves (closing in, getting a clear shot, cover, making room, shoot
  and scoot, reflexes) used Minecraft's own walking straight at a spot: across a moat that meant piling up against the
  wall and sliding along it into the lava. Now a fight move only walks straight where that's a safe walk; anything
  else is a planned route (over the bridge, around the lava, up the ladder). No shove (weaving, spacing, flinching,
  dodging) ever pushes anyone over a 2+ block drop or into lava / fire, and the edge guard now covers every soldier
  standing by a drop or lava, not just marching ones. The old "climb assist" no longer teleports a soldier on top of
  a 2-high wall (or lets him build up one) unless his goal is up there and the top isn't beside a drop or lava.
  New test copying the screenshots (wall-top, courtyard and ladder, lava moat, narrow bridge, both sides charging):
  0 falls into the moat or the courtyard, 0 teleports, the fight over in ~900 ticks instead of 1,500-2,000.
- **Rescue never fires for a traffic jam**: a soldier standing on his route at its level is in a queue, not stuck
  (a 200 v 200 test had armies queueing round a building and being teleported forward).

## v6.0 (orders that get there, commit to the fight, rescue, armbands, tougher guards)

- **Orders get there, long ones too.** A new test copies a real battlefield: hills, trenches with only two crossings,
  walls with gaps, a pond, ruined houses, trees and shell craters, 245 and 450 blocks long, 12 soldiers, 9 different
  layouts. v5.9 got the whole squad there in 1 of 3 layouts tested; v6.0 in 9 of 9 (245 blocks) and 4 of 4 (450
  blocks). What was wrong:
  - a soldier switching back from "following the route himself" to his formation place could freeze for good (the
    formation code thought he was fighting). This is probably your "sometimes they get it, sometimes not at all";
  - long orders are split into legs, and at the end of every leg the march waited for the squad to reach a point
    they always stop 3 blocks short of: long marches froze;
  - the "this march is stuck, find another way" check never fired (walking to a formation place counted as fighting);
  - walking to their formation place or along the route, Minecraft's own walking cut straight across trenches, gaps
    and the edges of bridges and fell in. Now soldiers only walk straight where a straight walk is safe; next to a
    drop (a bridge, a ledge, a trench edge, a wall-top) the script carries them along the route;
  - going down into a dip the script lowered them a moment too early (inside the ground), was refused by the no-clip
    check, and they stood there forever; and it could carry them over thin air on a diagonal. Fixed both.
  - going down the house stairs: v5.9 failed 3 of 3 tests; v6.0 3 of 3 arrive.
- **Commit to the fight, then the order.** On a march or patrol, a soldier who engages an enemy soldier or player
  stays on him until he's down or nobody in the squad has seen him for 15 s, hunting his last position if he ducks
  away, and only then goes back to the order. While anyone in the squad is locked in a fight the march holds so the
  squad stays together. A new order from you breaks it at once. If the enemy is AT the destination, marching on is the
  attack. Test (a march past an enemy post): switches between "fighting" and "marching" per soldier 5.8 -> 2.4, the
  enemy post always wiped out (v5.9 sometimes left it). War Table -> Settings to switch off.
- **Bounding under fire.** A marching squad taking fire moves in bounds (~3 s forward, ~3 s down and shooting) instead
  of walking steadily into the guns. Building assault test, 8 layouts: v5.9 attackers won 2, v6.0 won 5.
- **Rescue (last resort, ONLY these cases):** a soldier stuck inside blocks; a soldier cut off and getting nowhere for
  30 s while his squad moves on (not when he's fighting, jammed in a crowd, or near an enemy); a ladder climb that
  failed. He's put on a free spot next to a squad mate who is doing well. At most once a minute per soldier.
  War Table -> Settings to switch off.
- **The "goofy" firing pose** was the prone pose: the gun model can't follow it (it pointed straight up), and since
  v5.9 a soldier could stay lying down after a reload. Prone is gone (kneeling stays), and pose / aiming / firing are
  reset when a world loads.
- **Armbands** show each soldier's type: green foot soldier, white with a red cross medic, blue guard, yellow
  garrison, orange grenadier, brown houndmaster (cavalry none). War Table -> Settings to switch off.
- **Guards** have 40 health (was 18; foot soldiers 16). Guards already in your world get it when the world loads.
- **Lag:** in a 200 v 200 test where the armies actually fight (v5.9's never met in that test), ~6.5-7.5 ms of script
  time per tick on the test PC; in huge battles (300+ soldiers) each soldier checks his nearest 3 targets instead of
  5 and looks around a little less often.

## v5.9 (squads that stay together, no clipping through walls, 200 v 200 without the lag)

- **Squads no longer fall apart.** On a march, up to four soldiers used to share one formation marker and jostle each
  other for it (one soldier alone worked well; a squad didn't). Now every soldier has his own place in the formation
  (line, wedge, skirmish line, extra rows behind for bigger squads, single file along the route on narrow ground and
  indoors), from the first second of the order. The switch between "walk in formation" and "follow the route
  myself" (stairs, doors, ladders, stragglers) has a hold time, so soldiers no longer flip back and forth between
  the two. Formation places are placed with Minecraft's 3-block "close enough" in mind, so nobody stalls short of his
  place. Test results (bunching = pairs of soldiers standing on top of each other, lower is better): long march
  3.05 -> 1.8, hill march 2.68 -> 0.84, open-field battle 1.23 -> 0.52. Arrival times about the same (up the house
  stairs a little slower in the tests, ~450 vs ~420 ticks).
- **No more clipping through walls.** The script that carries soldiers through tight spots (stairs, doors, indoors)
  now checks every step is open at feet and head: it slides along a wall if it can, and if it's really blocked it
  lets go and the soldier works out a new way from where he stands. The ladder climber never moves anyone into a
  ceiling or a shut trapdoor (it opens the trapdoor), and stepping off a ladder is only a short step into open space.
  When no route could be found yet, the straight-line guess is never used to carry anyone. The tests now count
  soldiers inside solid blocks: v5.8 had some in the indoor fight and the building assault; v5.9 has none in any test.
- **Lag (many soldiers, and soldiers far apart).** Sandbags are remembered where they are placed/broken instead of
  scanning thousands of blocks around every soldier (that scan was the lag when soldiers were spread out: 245 -> 35
  block reads per tick with 30 soldiers far apart). Thinking and looking around run as a rotation with a fixed budget
  per tick, so the work per tick doesn't grow in a big battle; soldiers far from every player with nothing going on
  think less often. Perception checks only the nearest few enemies, "can I walk there" answers open ground with a
  straight-line check, and more checks use the shared snapshot of who is where. Script time per tick in the test
  battles (same machine): 40 v 40 2.7 -> 1.4 ms, 100 v 100 5.7 -> 2.7 ms, 200 v 200 11.7 -> 4.9 ms.
- Fixed: soldiers could stop on the last stair below a floor and count themselves "there"; a marker made earlier in
  the same tick could be invisible for half a second (the cause of some confusion when orders were given).

## v5.8 (ladders for every order, no teleports, reflexes, battle learning)

- **Ladders for every order / no more teleporting.** Short "Hold here" / "Patrol here" orders (and Follow) sent soldiers
  with Minecraft's own walking, which can't use ladders; when they got stuck, the stuck-recovery's last resort
  teleported them near the goal (that was the TP onto walls). Now any spot they can't plainly walk to on their level
  is reached by a planned route (ladders, stairs, doors), Follow uses routes when you're on another level, and stuck
  recovery plans a route instead of teleporting. Test: "Hold here" on a wall only a ladder reaches: v5.6.1 3-4 of 5 got
  up in 2 min (one by teleport); v5.8 all 5 by ladder in ~7 s, zero teleports.
- **Instant self-defence.** The moment an enemy hurts a soldier, that enemy is his target, his gun re-aims at once, and
  within arm's reach he fights hand-to-hand right away (it used to wait for his next thought, up to a second).
- **Under-fire reflex.** Hit, or shots coming in (hits or misses), or pinned by fire, while exposed: he immediately takes
  the best cover nearby that still lets him shoot back, or breaks the line of fire sideways. Attackers pushing into a
  building keep pushing (ducking in front of hidden defenders only stalls the attack). Tested in 160 self-play battles
  vs the same brain without it: wins 58%, open-field fights +0.1 strength share on both sides, defenders better, attackers
  unchanged.
- **Battle learning.** Each faction adapts its own tactical weights from its own fights (an evolution strategy): every
  contact, a squad fights with a slightly varied copy of its faction's weights; the outcome (enemies put down vs own
  losses) pulls the faction's weights toward variations that did better than its recent average. Bounded, pulled
  gently back to the tuned defaults, saved in the world. War Table -> Settings: switch off or reset. (It needs many
  fights to show: in 40-battle test runs no change was measurable yet.)
- Skins 13-17 named as asked (Gorgonzolan Army, DRGK, Shlomo Castle, Jeetya, Tout Donner).

## v5.7 (lag for real, ladders fixed, smarter fire and movement)

- **Lag.** v5.6 cut the game calls but the script's own computing barely moved, and Bedrock's script engine is much
  slower than a PC's, so that was the lag you still saw. Profiled and cut: in a steady 40 v 40 fight the add-on's own
  CPU per tick went from ~6.7 ms (v5.6.1; v5.3 ~7.1) to ~2.5 ms (about 2.7x less). How: what each block type means for
  walking is worked out once per type instead of scanning name lists on every check (the single biggest cost); the
  terrain, sky-light and line-of-sight memories use number keys instead of building text; "can I stand here" and
  "can I walk there" answers are shared and remembered; aim, health and light are remembered for a moment; a 32-block
  grid answers "who is near me", with factions pre-read, so perception skips friends without asking the game; the gun
  loop runs every other tick and skips men with nothing to shoot; the tactical evaluator was trimmed; waypoint markers
  no longer have collision, gravity or pathfinding.
- **Ladders.** The real bug: route points are kept every ~2 blocks and approaches are often diagonal, so when the
  ladder became a soldier's next point he was usually more than 1.3 blocks from it; the glider handed him to the
  climber, the climber refused (too far), and he stood at the foot of the ladder forever. Now the glider walks him right
  up to the ladder and starts the climb itself. Tested: up a 6-high wall, out of a 5-deep pit, ladder straight ahead or
  off to either side (v5.6.1: 0 of 6 got out when the ladder was off to the side; v5.7: 6 of 6, ~7 s).
- **Spreading fire.** No more whole squads on one enemy while others shoot freely: past two men on a target, the rest
  pick other targets (self-defence and "he's shooting at me" still come first).
- **Covered routes.** Moving in a fight (to the enemy's floor, closing in, to a spot indoors, falling back, taking
  refuge), routes prefer ground the known enemies can't see: a few extra blocks to stay behind cover.

## v5.6.1

- Creative players are no longer targeted (as before v5.6). Survival/adventure players on a hostile faction still are.

## v5.6 (lag, instant orders, players as targets, tactical positions, extension API)

- **Lag.** A 100 v 100 now costs ~520 game calls per tick (v5.3: ~15,000; v5.5: ~1,300). Light levels remembered per
  spot, soldiers' eye positions computed instead of asked for, entity properties and facing read once, prop re-syncs
  every 10 s instead of every 0.5 s, bookkeeping (stuck checks, pace, heal timers) kept in memory only, the edge guard
  only watches men stepping a route, stuck checks read the shared terrain memory.
- **Orders take effect at once.** For ~5 s after an order nothing stops a soldier to fight (he shoots on the move),
  so a charge, fall back or move starts immediately even under fire. The War Horn counts as an order too.
- ~~**Players on a hostile team are targets in creative too**~~ (reverted in v5.6.1) (testing in creative looked like the enemy ignored you;
  creative still takes no damage). Spectators are never targeted. Players who attack a faction are targeted by it even
  without a faction of their own.
- **Tactical positions.** A new evaluator scores spots around a soldier for cover from every enemy the squad knows
  about, a shot at one of them, ground gained, height, and against crowding, doorways/stairs and long walks. Used for
  bounding forward from cover to cover, taking cover that can still fire back, peeking, and a new "take a firing
  position" choice for defenders. Bounded per tick (no lag).
- **Extension API** (`scripts/api.js`, `scripts/extensions/`): add behaviours and hooks in your own files without
  touching the core. See `DEVELOPING.md` for the full map of the engine and how to add weapons, soldier types, orders.
- Test harness: symmetric field battle, a 6-defender assault, a player-targeting test, and `ab.mjs` (two brains fight).

## v5.5 (stairs, doorways and indoors: the glider)

In-game test of v5.4: still bunching and struggling on a house staircase and on castle wall stairs. Cause: on stairs
and in doorways soldiers were moved by small script pushes on top of Minecraft's own walking; in the real game the two
fight and the pushes are weak, and the single-file queue then waited on a leader who wasn't moving.

- **The glider.** Through any tight stretch (stairs, including outdoor castle stairs, doorways, drops, around ladders,
  indoors) the soldier is now carried by the script along his planned route at walking pace (~3.4 blocks/s), step by
  step, facing where he walks, opening doors and trapdoors as he reaches them. Ladders stay with the ladder climber.
  Nothing there depends on Minecraft's pathing or on pushes.
- Single file with no deadlocks: a man behind a squad mate waits at most 2.5 s, then goes anyway.
- Nobody stops on a staircase to shoot (the men behind need it).
- Indoors, the brain's short moves (cover, peek, spread out, clear shot) are real routes the glider walks.
- New tests copied from the screenshots: castle wall stairs between two walls beside lava, and a fight inside the
  building. Indoor fight: cleared in 244 ticks vs 388 (v5.3), bunching 0.56 vs 2.82 pairs.

## v5.4 (squad behaviour, fighting, lag)

What was wrong in v5.3, and what changed:

**Bunching at stairs and doors.** The march guide stopped at every stair, ladder and door until the *median*
soldier got there, and indoors every lane marker sat on the same spot, so the squad piled up (soldiers aren't
pushable, so they stack). Now the guide keeps ~6 blocks ahead of the front of the group and never waits at a
gate. In tight stretches (indoors, ladders, doors, drops) each soldier follows the route himself on his own marker,
in single file: a man right behind a squad mate who is further along waits a moment instead of walking into him.
Lanes indoors are spread along the route. Stair steps that are a full block are hopped properly.

**Bunching after the stairs ("moving to the enemy's level").** Everyone was routed to the enemy's exact spot and the
route ended at the foot of the stairs. Now the route ends as soon as it reaches the enemy's floor, and each soldier
steps off into the room to his own free spot (not on the stairs, not in a doorway, preferably with a line of sight).
A soldier standing in a pile during a fight makes room.

**Waiting for the downed.** Downed soldiers (30 s to die) counted toward the march pace and the squad's centre, and
the post-fight regroup held everyone. The downed, prisoners and riders no longer set the pace, and the regroup halt
is gone. With 6 of 8 downed mid-march, the two still standing now arrive in 900 ticks instead of 1460.

**"Insubordination" / stuck in orders.** Personal routes (to the enemy's level, out of a building, patrol legs) came
before fighting in the decision chain and could last minutes. Now a route is dropped after 6 s without progress or
when it's far past its time; errands (patrol, reinforce) are dropped when a fight starts; and moving toward the enemy
he stops to take a real shot. Gunners are aimed and moved only by the script: Minecraft's own targeting (which
walked them straight at the enemy, off their route) is off for them. A march route can no longer end on the stair
below the goal floor, and soldiers left on stairs or in a doorway after arriving step onto their own spot.
Every soldier in Hold here / Patrol here / a charge arrival gets his own spot (no two on one marker).

**Shooting far away and at nothing.** Attackers fired from up to 200 blocks and "suppressed" remembered positions
behind walls. Now each gun has a useful range (rifle 70, semi 60, MG 75, SMG 35, pistol 25, shotgun 16, AT 60,
sniper 220); attackers close in to it before they fire, defenders on a position open up a little earlier (x1.4),
returning fire a little more (x1.15). A head in a window or over a wall is a valid target, but only from closer
(head shots at range just hit the wall). Suppression only at a spot an enemy was seen in the last 3 s (covering fire
2 s), in range, with a clear line to it, and it fires at the gun's real rate. No shot from here: he moves to a spot
that has one (up to 8 blocks), goes up/down to the enemy's floor, or follows a real route, never a beeline.

**The route planner / GPS.** Marches start walking at once (outdoors) while the route is worked out, and the
army's routes get planner priority over personal errands. A long charge now starts moving in ~1.5 s instead of ~9.5 s.

**Lag.** Every dynamic property read was a native call (13,000 per tick in a 100 v 100). They are mirrored in memory
now (writes go through; unchanged values aren't rewritten). Bullet noise no longer writes a property on every enemy
soldier within 64 blocks per bullet, calls for help are throttled, riding checks are cached. In the test harness a
100 v 100 battle went from ~15,000 to ~1,300 API calls per tick.

**Self-play.** The squad brain's weights were re-tuned by self-play in the test harness (see below).

## Testing (tests/harness)

A stand-in for `@minecraft/server` runs the real `main.js` against a voxel world: a three-floor building with 1-wide
stairs and a door, a building held from the upper windows, a hill, a stream and a long wall, and big open battles.
Vanilla walking, physics and the gun pack are approximated, so it's a regression and comparison tool, not a
replacement for testing in the game.

```
cd tests/harness
node run.mjs load                         # loads the add-on under Minecraft's load-time rules
node run.mjs stairsDown                   # one scenario (stairsDown, stairsUp, downedMarch, hillMarch, assault, longCharge, field, big)
node bench.mjs stairsDown,assault 6 <old scripts dir> -    # several seeds, old vs current side by side
node selfplay.mjs 14 2                    # self-play tuning of the brain weights
```
