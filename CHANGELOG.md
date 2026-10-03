# War Engine changelog

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
