# War Engine changelog

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
