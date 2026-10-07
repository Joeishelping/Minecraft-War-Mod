# War Engine changelog

## v9.1 (Grenades that work, smoke and rescues with reasons, the right weapon, stairs, riding, vehicles, neutral zones)

Checked in the simulator (all 10 acceptance checks pass) and on a real Bedrock server.

- **Grenades now hurt.**
  - A soldier's grenade never went off: the game refused him as the explosion's source and the error was swallowed.
  - Men near a live grenade take a moment to notice it, then dive clear. In tests some got away and some were
    caught.
- **Smoke only when it makes sense.**
  - The squad has to have seen the enemy, the fight has to be 5 s old, and they have to be under fire. No more
    smoke the moment they spawn.
  - "Pinned down" means most of the squad suppressed for 3 s running.
  - Men fire short bursts into smoke where an enemy was last seen (not snipers, never with a friend in the way).
- **Rescues don't get men killed for nothing.**
  - Nobody runs to a wounded man while enemies who can see him are firing: smoke first if he has it, else he waits
    for a lull.
  - A rescuer shot at on the way goes back to cover.
- **The right weapon.**
  - Guns jam rarely; while the jam clears he draws his pistol, or his sword if an enemy is within 5 blocks.
  - A rifleman or gunner reloading with an enemy close draws his pistol.
  - The sword comes out only when his gun is the wrong tool at arm's length (a long gun, jammed or reloading).
    SMGs, pistols, semi-autos and shotguns keep shooting up close.
- **Stairs and "working out the way".**
  - Short trips use a fast route search.
  - Staircases are learned from routes and reused, so trips to another floor are put together at once.
  - The first search for a floor gets priority, and anyone waiting switches to the learned stairs.
  - Short orders (40 blocks) give each man his own route instead of a slow march.
  - Reserves move up to the fight; an "advancing" man with no point picks the nearest enemy.
- **Cobwebs.** Routes go round them, and through only if there's no other way. Before, a cobweb was a wall to the
  planner, and short walks went straight into it.
- **Surrender.** It lasts until a player of his own faction rescues him (right-click). He no longer rejoins when the
  enemy leaves, the war ends or his flag goes up again. The same rule covers prisoners.
- **Go-to-flag** checked working. When there's no enemy war flag in reach, it now says so.
- **Neutral zones** (War Table → Neutral zones). An area where nobody fights: think of a UN building.
- **Riding.**
  - Soldiers ride saddled horses, donkeys, mules, camels and pigs, and boats; never this add-on's vehicles.
  - New army orders "Mount up" and "Dismount".
  - Your followers mount up when you ride and get off when you do.
- **New vehicles.**
  - Transport Truck: 10 seats, troops visible in the back.
  - Coast Guard Gunboat: 8 seats, a bow machine gun (a soldier in the gun seat fires it on his own).
  - Transport Helicopter: 8 seats, a door gun. It hovers: W/S fly, the mouse steers, looking up or down climbs or
    descends. It crashes on a hard landing or a wall.
- **Stability.**
  - Placing a marker in an unloaded chunk no longer throws.
  - The waypoint registry stays under the save-size cap.

## v9.0 (Smoke, dragging the wounded, ambushes, breaching doors)

New things soldiers do on their own, each checked in the simulator and on a real Bedrock server.

Real server (BDS 1.26.52), v9.0 against v8.2: **9 of 10 checks** (8 before). Attackers reach the big hall's upper floor
in 46 s (118 s in v8.2; the target is 60 s): smoke on the approach and a grenade through the door before going in.
Still 0 shots at men nobody could see and 0 into cover, both marches and the castle legs arrive, no script errors.
The one still failing: a 90 v 90's first 30 s runs at ~10 ticks a second.

- **Smoke screens.**
  - Riflemen carry a smoke canister (another after 2 min). A squad throws one at most every 25 s: before an assault
    or a flank over open ground, before the run to a held building's door, when pinned down in the open, to cover a
    man going out for a wounded mate, and when a man breaks and runs.
  - The cloud (about 7 blocks across and 4 high, ~22 s) really blocks sight. Nobody can see, aim or shoot through
    it, and two men a step apart inside it still see each other.
  - It's a new particle in the resource pack.
- **Dragging the wounded.**
  - A man down where the enemy can see him, with no medic coming, is reached by the nearest squad mate. He pops
    smoke if he has it, puts pressure on the wound (the bleed-out timer stops), drags him back to a spot the enemy
    can't see, and gives ~5 s of first aid. The wounded man gets back up, weak.
  - One rescue per squad at a time (two for 8 or more). No rescue for a man nearly bled out, and a squad losing
    the fight doesn't send men out far.
- **Ambushes.**
  - A squad that sees the enemy first (no enemy aware of it, nobody shooting at it, nobody within 14 blocks) lies
    in wait: no shot, no shout.
  - It springs when most of the squad has a man in its sights, when the enemy notices, shoots or comes within 10
    blocks, or after 6 s. Then every rifle opens up in the same second.
- **Breaching.**
  - Attackers going through a doorway into a floor the enemy holds stack up beside it (3 men, or 6 s at most).
  - One throws a grenade into the room, never with a friend in blast range. When it goes off they go in together.
- **Saved data and stability.**
  - The busiest soldier records are kept in memory and saved together at most every 30 s. Orders, being down and
    falling back are still saved at once, so a reload never brings back an old state.
  - Placing a marker in an unloaded chunk no longer throws an error.
  - The waypoint registry drops soldiers not seen for an hour of play instead of growing forever, and a record
    unused since v8.2 is deleted.
  - Unused code removed.

## v8.2 (The crash, the lag, the false "out of range", committing in building fights)

Everything below was found and checked on a real Bedrock server.

- **Fixed the "Exceeded scripting memory limit" crash.** Each route search kept a map of every cell it looked at:
  up to 90,000 per route, with up to 30 routes at once. A soldier hit far from his spot (fight, then back, then stuck,
  then retry) could start a burst of big searches and use up the game's script memory. Now:
  - All route searches together have a size budget (about 160,000 cells); the biggest one gives up first.
  - Each search's size follows its own range, and at most 16 run at once.
  - The block cache is capped as it grows, not every 30 s.
  - The line-of-sight cache counts everything it holds.
  - Every per-soldier record is cleared once that soldier is gone.
- **Lag.** A 90 v 90 on a real server went from ~10 to ~16 ticks a second (20 is full speed):
  - The current tick is read once per tick.
  - Position and "is he alive" checks come from a shared snapshot, not a call per soldier.
  - Saved data in a big battle went from ~5 MB to ~0.4 MB per 30 s. The game warns at 10 MB a minute; a waypoint
    record nothing read was rewritten in full for every new waypoint, and every march was saved twice a second.
  - Walking soldiers' markers move only when it matters.
  - The game's own target scan runs every half second (the game logged a performance warning at a quarter second).
  - When the server falls behind, soldiers look around and think a little less often until it catches up (level of
    detail).
- **No more false "out of range".** A man more than 32 blocks from you who stood still 2 s (waiting his turn at a
  stair) was taken to be out of the game's simulation range and carried by script, teleport by teleport, for the
  rest of the trip. That caused the jerky "tweaking", a lot of lag, and squads bunched where the carrying ended. Now
  he's given a tiny nudge first; if the game moves him, he walks on his own. The distance is 56 blocks, close to the
  game's default simulation range.
- **Creative and spectator players are never enemies.** Before, only the aimed shot skipped them. A creative player
  heard or seen could still be hunted, grenaded or given covering fire.
- **Patrols stop wandering in a fight** ("on the way through", then "patrolling"); the fight decides where they go.
- **Committing in building fights:**
  - Defenders whose house is broken into clear it if they have the numbers (a decided counterattack, not a coin
    toss), and hold the stairheads and windows if they don't.
  - Attackers who are mostly inside all storm; nobody goes back out to "cover the building".

- **Settings audit.** Every switch in War Table → Settings was traced to the code it controls, and every one of
  them works. Battle learning is now **off by default** and marked experimental:
  - It can't crash anything: it's small, bounded and saved as a few numbers per faction.
  - But it judges a whole tactic from one fight's result, which is mostly luck.
  - It also makes a world's soldiers behave differently from the tested ones, so a "they got dumber" report can't
    be told apart from drift.
  - Switch it on if you like the idea; "Reset what every faction has learned" undoes it.
- **Voice lines.**
  - A man who had just shouted something could swallow a one-off line: a surrender ("Don't shoot!") or "Thanks!"
    after a revive (he'd just yelled "Medic!"). The same went for a squad's decision ("Charge!", "Go, go, go!").
    These events now always get their line; the "no two men say the same line at once" rule still holds.
  - Building plans get fitting lines: storming in "Go, go, go!", a sortie "Charge!", pushing up "Moving up!",
    covering the building "Suppressing!", holding "Hold position!".
  - "Frag out!" comes only from Demolition soldiers (throwing, or when a grenade lands near someone). "You're
    okay!" / "Thanks!" come only when a Medic revives someone.

## v8.1 (Tested in the real game: the "seeing through walls" bug found and fixed)

Run on a real Bedrock Dedicated Server (1.26.52) with the test kit in `tests/bds`, not only the simulator.

- **The cause of "shooting at walls", found.** Bedrock's block ray counts its maximum distance in block cells
  stepped through, not in straight-line distance. A slanted line (up to a window, across a courtyard) steps through
  more cells than its length. So every "can I see him?" check gave up before reaching the wall and answered
  "clear". In the real game, v7.4 and v8.0 attackers put 92–99.9% of their rounds into walls. Every ray now looks
  far enough and measures the true distance to what it hit: 0% into walls in every real-game test. The simulator now
  reproduces this behaviour, so it can't hide again.
- **Routes through buildings finish.** In the real game the route planner managed about 30 steps per tick, and routes
  that soldiers had given up on stayed in the queue: a route through a building took about 80 s, and men stood
  saying "working out the way" / "storming the building". Now:
  - Abandoned searches are cancelled.
  - The planner gets up to 8 ms per tick while the server keeps pace (3 ms when it's struggling).
  - Routes finish in a few seconds, and labels were wrong 0% of the time in the real test.
- **Hits are a chance, not geometry.** With precise hits nearly every shot landed (90%+). Now each shot has a hit
  chance by weapon and range (rifles good at range, SMGs only close), lower when the shooter is wounded or pinned
  and against a moving or kneeling man. A miss flies clear past him on an open side, never into the frame beside
  him. About half the shots hit in a typical fight.
- **Less script work per tick.** The current tick is read once per tick; position and alive checks use the shared
  half-second snapshot; gunfire "hearing" and the friendly-fire check no longer query the game per soldier.
- **Real-game scorecard (one run each, results in `tests/bds/`):**
  - **v8.1, 8 of 10 passed:**
    - no blind shots, and 0% of rounds into walls;
    - defenders on the ground floor at the breach;
    - 30-man and 8-man marches arrive;
    - roam downstairs works;
    - labels truthful;
    - no errors.
  - **v8.1 failed:** attackers took 94 s (not 60 s) to get upstairs in the big hall; 90 v 90 still runs at ~10 ticks
    a second (half speed).
  - **v7.4, 4 of 10 passed** (it fails the shooting, breach and big-hall checks).

## v8.0 (Precise hits, the aim fixed at the muzzle, and a pass/fail test suite)

- **Precise hits (Settings → "Bullets", the new default).** The hit is decided by the script along the exact line of
  the shot, spread included, the way most military shooters handle rifle fire:
  - The first man on the line is hit. If a wall comes first, the round stops in the wall.
  - Nothing flies, so nothing can drop, drift or be moved by the gun pack's own bullet code.
  - A faint tracer and a small puff show the shot; no marks are left on walls.
  - The gun pack still provides the gun models and sounds. Bazookas keep real rockets.
  - "Gun pack's own bullets" in the same menu brings back the old flying bullets.
- **A long-standing aiming bug, fixed.** The aim was worked out from a soldier's eyes, but the round left from his
  muzzle, 0.2 blocks lower. Every shot flew a parallel line just under the one that was checked, enough to clip
  window sills and floor edges when shooting up at a man. This probably explains part of the "shooting at walls" all
  along.
- **Only real shots.** Before firing, a soldier checks four lines at the edges of his spread (high, low, left,
  right). If any of them would hit cover in front of the man, he's half hidden: no shot. The soldier waits or moves
  for a better one. A shot at a man nobody can see was already impossible.
- **The acceptance suite (tests/harness/accept.mjs).** Ten pass/fail checks, each run on three seeds, with dropping
  bullets in the simulator to match the gun pack:
  1. no shots at men nobody can see;
  2. rounds into cover in front of the target at most 8%;
  3. attackers reach the upper floor of a big hall within 60 s;
  4. defenders on the ground floor before the door is breached;
  5. 30 men march 300 blocks;
  6. 8 men in and out of a building;
  7. "roam downstairs" works;
  8. labels tell the truth;
  9. 90 v 90 meets and fights without lag;
  10. no errors.

  v7.4 passes 8 of 10, failing both shooting checks. v8.0 passes 9 or 10 of 10, depending on the run.

## v7.4 (Shot diagnostics, a safer bullet-drop measurement, windows that are windows)

- **New: Settings → "Shot diagnostics".** Turn it on and every round the soldiers fire is drawn: green sparkles along
  where the round really flies, and a flame where it was aimed. Every 5 seconds the chat shows:
  - how many shots the soldiers fired;
  - how many rounds were fired by a soldier but NOT by this add-on's aiming (the gun pack's own script, or the game's
    own attack), shown in red if there are any;
  - the bullet drop the soldiers measured.

  If marks on a wall have no green trail leading to them, the add-on's aiming didn't fire them.
- **Safer bullet-drop measurement.** v7.3 measured drop from the bullet's reported speed. The gun pack may not report
  speed the way the game does, which could lift the aim too high (your marks high above the windows). Now:
  - Drop is measured from where the round actually is, 2 and 4 ticks after the shot.
  - A measurement is only believed if it predicts those positions to within half a block.
  - Rounds that fit no measurement are counted, and while most rounds don't fit, the aim stays straight.
  - The aim is never lifted more than about 6° above the man.
- **"Watching from a window" means a real window.** A man only takes that job at a spot with a real opening (a hole,
  glass, a pane, bars) at head height right beside him, with wall below or above it and open sky beyond. Windows on
  the side facing the enemy are preferred, and spots with a shot first. No such spot: he's "in reserve" and goes
  where the fight is. The label used to say "at the upper windows" for men nowhere near one.
- **Roles that move.** In a fight, a man at a window with no shot from it for 10 s leaves it ("moving to the fight")
  to find a shot or close in. Men covering the doors and stairheads stay: waiting is their job.

## v7.3 (Bullets drop, attackers go up the stairs, every man knows his job)

- **No more bullet marks around the windows.** The gun pack's bullets fall and slow down in flight. A round aimed
  straight at a man in an upper window dipped and hit the wall under it, which is the pattern in your screenshots.
  The test simulator fired perfectly straight bullets, so that check passed there and failed in your game. Now:
  - Each bullet type's drop and drag are measured from real rounds in flight, a few ticks after the shot.
  - The aim is lifted so the curved flight meets the man.
  - The clear-path check follows the curve, not a straight line.
  - Guns not measured yet use the values of the ones that are.
  - In the simulator with dropping bullets, rounds hitting cover in front of the target went from up to 31% to
    about 0–2%.
- **Attackers who break in go upstairs instead of piling up at the door.** Every man worked out his own long route
  through the rooms and up the stairs, all at the same time. The route planner couldn't finish any of them before
  they gave up and asked again, so they stood still saying "storming the building". Also, a route cut short ended
  on the ground floor right under the enemy. Now:
  - Men heading the same way share one route.
  - Long routes get time to finish.
  - A route that can't reach the enemy's floor isn't followed.
  - The stairs nearest the attacker count too, not only those nearest the enemy.
  - In a big three-floor hall test, the first attacker is upstairs in about 35 s instead of 90.
- **Attackers no longer take the defenders' jobs.** Once most of an attacking squad was inside, it decided it was
  the defender ("covering the way in" by the door it came in by). Now the side is decided by the order: a squad
  told to hold a spot inside the building defends it; everyone else attacks it.
- **Jobs stick and fit where each man is.** Jobs used to be dealt out by a fixed list every 25–45 s, so men went up
  and down, and men downstairs said "at the upper windows". Now:
  - The lowest men cover the doors, the next the stairheads, the rest the upper windows (attackers: the men
    furthest back give covering fire, the rest go in).
  - A man keeps his job and his spot through new plans; if someone falls, another man takes over his job.
  - "Upper windows" is never a ground-floor spot.
- **The labels over their heads tell the truth.** On the way: "going to the upper windows", "going to cover the way
  in", "working out the way" (while the route is planned), "looking for a way" (when the route failed and he's
  picking another). "At the upper windows" only once he is there.

## v7.2 (Every man marches on his own, a round needs a clear flight, a house is held like a house)

- **Squads no longer stall on long orders.** In earlier versions nobody in a march walked his own route. A shared
  "guide" moved on only as fast as the slower 60% of the squad, and everyone walked to a spot around it. A few men
  snagged on a staircase, a mob in the way or a jam in a doorway, and the whole squad stood still. That is why one
  soldier could make 200 blocks when 30, 60 or 120 couldn't. Any fight, even with a zombie, also froze the guide for
  up to 20 s. Now:
  - Each man follows the squad's route by his own progress.
  - Side by side in the open, single file on stairs and in doorways.
  - Nobody waits for anyone behind him. Only a man far out in front eases off until the squad closes up.
  - Each man has his own watchdog. After 3 s without headway he is carried over the bit he's stuck on; after 6 s he
    works out a fresh route of his own; after 15 s he is put back on the route a few blocks ahead.
  - In the simulator, a 90-man squad that moved about 5 blocks in 20 s now crosses the field. 8- and 30-man squads
    going in and out of buildings and up stepped slopes stand still about half as long.
- **Mobs never stop an order.** On the move, soldiers shoot a zombie or skeleton as they go instead of stopping,
  repositioning or chasing it. Only real enemy soldiers and players halt a march (for up to ~20 s).
- **No more shooting into walls.** Every round now needs a clear flight. The spread of each shot is drawn first and
  that exact line is checked all the way to the man. If it would hit the wall, window frame or parapet in front of
  him, the soldier waits for a better sight picture; after three bad draws he doesn't fire at all. A man showing only
  a sliver behind cover is not a shot. What still hits a wall is a miss that flew past the man into whatever is
  behind him. In the siege test, shots that struck cover in front of the target went from up to 31% to about 0–2%.
  Shooting through walls (wallbang) is gone.
- **A building is held like a building.** Squads no longer pick one plan at random (everyone to the windows, or
  everyone out of the door). They split the jobs:
  - **Holding a house, before anyone shows up:** a few men inside the ground floor covering the ways in, a man on
    each stairhead, the rest spread over the upper windows.
  - **Under attack:** the same jobs. Once the enemy breaks in, the door men (and anyone at a window with no shot)
    fight them on that floor, while the stairheads stay held.
  - **Attacking a building:** a support group shoots at the windows from outside, and an assault group goes in,
    clears the ground floor and goes up every staircase where the enemy is.
  - The shares change a little every time, and with the odds and how long it's been quiet.
  - In the building-assault test, attackers made it upstairs in 2 of 3 fights (none in v7.1).
- **Patrols and roaming cover every floor.**
  - A patrol in a building walks all of it, up and down the stairs.
  - Roam picks spots around the spot you ordered, not around wherever each man stands, so "roam downstairs" brings
    them downstairs.
  - Nobody heads for a spot another man is already going to.

## v7.1 (They see what you see, stairs are stairs, a quiet radio)

- **If you can't see him, they can't shoot him.** They still hear and sense where the enemy is, and use that to move,
  but they only fire at a man in view at that instant. Found and fixed every way they fired at nothing:
  - Covering fire went at where a man was a moment ago, or where he was only heard: bullets into walls, ceilings and
    corners (and, with the occasional bullet going through, hits on men nobody could see). It now only goes at a man
    in view: his chest, or his head in a window.
  - They kept firing at a man for up to a quarter of a second after he went down, the rounds going over him into
    the wall behind. Now they stop the instant he drops.
  - Leading a running man: the shot only goes if he's in view now, not just where he's heading.
  - The muzzle itself must be clear and see him (not round a door frame or a corner).
  - Grenades and molotovs are only thrown at what the thrower can see at that moment.
  - In the test fights, shots fired with no line to any enemy went from as many as 1 in 5 to almost none.
  - Through-the-wall hits are rarer (1 in 10 of the aimed shots that go into a wall) and never come from covering
    fire.
- **Stairs are never avoided.** Routes go round places where soldiers have got stuck or been cut down. That memory
  piled up on staircases (where men get stuck and die most) until every route avoided the stairs, and nobody went up
  or down. Stairs and ladders are now exempt from it, and the old memory is wiped once. Tested on straight,
  switchback, open-sided (along an atrium), slab and stone staircases, up and down.
- **They go to the enemy.** When a squad knows where the enemy is (seen or heard), nobody in it has fired for 15 s,
  and they're free to use judgment, each man closes in along a real route (doors, stairs, round the building). The
  route stops him the moment he has a shot. Not a man holding a roof or wall over them, not one watching a
  stairhead, not a squad badly outnumbered.
- **The radio:**
  - Settings, General, "Radio messages": Off / Important only (the default: contact, area clear, in position, a man
    surrendered) / Everything.
  - The same message from a squad never twice in 30 s, and no more than one message every 3 s to you.
- **No more claims they're not carrying out.** A building plan ("securing the building", "storming the building"...)
  is only reported once half the squad is actually on it. A plan nobody can carry out is dropped within 10 s for
  another.

## v7.0 (The building brain: real fights in and around buildings)

- **Squads read the situation and pick a plan.** Every squad in a fight in or around a building works out who's
  inside, who's outside and on which floors, and picks a plan. The choice is weighted by the odds and by chance, so
  the same fight doesn't play out the same way twice. It keeps a plan for 25-45 s, then looks again. Each man gets his
  own part:
  - **Inside, enemy outside or below:**
    - *Man the windows:* each man finds a spot, on any floor, with a clear shot at an enemy.
    - *Secure the building:* spread out over every floor and room, a few blocks apart, near the stairheads and the
      ways in.
    - *Sortie:* half the squad goes out after them while the other half covers from the windows. Only with the
      upper hand, or after a long stalemate. Out the door into their guns isn't a plan.
  - **Inside, enemy on another floor:** *storm it*. The staircases are shared out round the squad, so they go up
    both at once (a real flank). Each group stacks up at the foot of its stairs, then goes.
  - **Outside, enemy inside:** *contain* (spots that see the windows and doors), or *assault* (in through every way
    up).
- **Floors are no prison.** A plan takes a man to any floor. Holding the high ground (a roof, a wall, an upper floor)
  still keeps him there unless his part in the plan is to go down.
- **Awareness:**
  - Squads now know about enemy soldiers within 32 blocks, roughly where they are ("they're in that building").
    Gunfire gives the shooter away up to 64 blocks. Whoever is shooting at one of us is known.
  - Squads of one faction (and its allies) within ~96 blocks share what they know (the radio net).
  - The team upstairs and the team outside now know about each other.
- **Clear shots:**
  - A man with the enemy near, and nothing to shoot at for 3 s, goes and finds a line: out from under the balcony,
    to the rail, to the next window. Before, he stood firing into the ceiling.
  - The gun takes any enemy the man has in view that the bullet can actually reach, when the one he was watching is
    out of reach.
  - It keeps the man he's shooting at while it still can, instead of flip-flopping between targets. Every switch
    reset his aim, so he almost never fired.
  - A man carried along a route faces his target, if he has one, so he can fire on the move.
- **No more bunching.** A man with nothing to do and a mate on top of him spreads out (inside a building).
- **Roam** (a new order, and a "When they arrive" choice): free to go anywhere in the area, any floor, in and out of
  buildings, hunting what they find.
- **Patrol inside a building works.** It walks the rooms of its floor and out through the doors. It used to stand
  still: it looked for points up to 100 blocks off, all outside the building.
- **No jumping off balconies:** routes avoid drops of more than 3 blocks whenever there are stairs.
- **Every list in every menu is in A-Z order:** factions (by their name, once named), coalitions, squads, skins,
  weapons, units, orders, settings pages. "All", "None", "My faction" stay on top; "« Back", "Cancel", "+ Create" at
  the bottom. Lists of 3 or fewer keep their natural order. The per-faction pages (diplomacy, gun loadouts, skins,
  callout language) list the factions A-Z too. There's a switch in Settings, General: "Menus in A-Z order".
- **Creative inventory:** the War Engine items are in A-Z order (Cavalier Egg ... War Plane).

## v6.9.3 (Indoor fights that actually happen, coalition orders, overlapping callouts)

- **No more standing in the hallway.** Inside a building, a soldier who knows of the enemy on his floor within 30
  blocks (seen or heard), and has had nothing to shoot at for 3 s, now goes and engages along a real route: through
  the doorway, round the corner. He stops as soon as he has a shot. Before, a squad holding a hallway beside the room
  the enemy had walked into stood there for the whole fight, and so did the enemy, both "defending the building".
  Exceptions:
  - a man covering a stairhead stays there;
  - nobody chases a man who is coming up the stairs;
  - a squad that is badly outnumbered holds and lets them come.
- **Coalition orders.** The Command Baton's "which faction?" list now has every coalition. An order to a coalition
  goes to the soldiers of all its member factions within range: each faction gets the same order, and its own march
  if it's a march. Squads 1-9 mean that squad in every member faction.
- **Callouts overlap.** Different lines, and the same line from different sides, can now play at the same time. Only
  the same line from the same faction nearby is held back (as before). Up to 6 a second (was 3).
- **Bazookas** never fire at mobs (zombies, creepers...): only at the enemy's army and vehicles.
- **Cavaliers and houndmasters** die outright instead of lying downed. Hounds never had a downed state.
- Checked every test scenario for silently caught errors: none from the war logic.

## v6.9.2 (Staircases, no shooting into cover, coalition spawn, grenade facing)

- **Staircases are choke points.**
  - Defenders holding a floor, with the enemy below, take spots 3-7 blocks from each stairhead on their floor that
    see a man's head as he comes up. With two staircases they split between them, the one nearest the enemy first
    ("covering the stairs").
  - Attackers going up to a floor where the enemy is gather at the foot of the stairs ("stacking up at the stairs"),
    until 3 are together or 6 s pass, then go up together ("Go, go, go!") instead of one at a time.
  - A staircase where men were just cut down is remembered as a killing ground for ~2 min. Routes take another way
    up (the other staircase) if there is one.
- **Soldiers hear what they can't see.** An enemy soldier within 10 blocks, through walls and floors, is known to the
  squad roughly where he is (boots on the stairs, a fight in the room below). That's enough to cover the stairs or
  the door he'll come through. It's never a target to shoot at.
- **No more shooting into cover.** The trigger is only pulled when a fresh line to the target is open at that
  instant. Before, it was checked against a shared memory that worked per block and lasted up to a second, so a man
  who had just stepped behind a wall was shot at through it. Leading a running man is dropped if it would put the
  shot into the wall. Covering fire needs a sighting from the last 1.5 s (was 3 s) and a fresh open line. Only the
  spread of a real shot hits walls now, and only those can go through (up to 3 blocks, as before).
- **A wounded man falling back still fires** at anyone within 20 blocks. Before, he held his fire completely: in a
  building with nowhere to run, he stood and died without a shot.
- **Grenades and molotovs:** the thrower turns to face his target before throwing. Before, it could come out of his
  back, and looked like a throw in the wrong direction.
- **Coalition spawn:** "How many" is now the total, shared out between the member factions and mixed through one
  formation (30 for a 3-faction coalition: 10 each, side by side in the ranks). Before, it spawned 30 for each
  faction.

## v6.9.1 (Squads on Hold use tactics, more callouts, Demolition rework)

- **Squads on Hold now fight like squads on the move.** Before, flanking, charging, "go go go" and cover-and-move
  bounding only ran for squads on Charge / Follow / Patrol. Most squads end up on Hold (every march ends there), so
  those tactics, and their lines, almost never happened. Now a Hold squad counter-attacks when all of these are true:
  - its order is "use judgment";
  - it's out in the open, not holding a building or the high ground (and isn't on Post);
  - it has the upper hand (1.2x the strength);
  - the firefight has gone on ~6 s;
  - the enemy is within 90 blocks.

  It uses the same contact, flank and assault plan, with bounding ("Cover me!", "Moving up!"). It stops when the fight
  ends or turns against it (under 0.8x), and the men go back to their spots.
- **More callouts in a fight:**
  - every new decision gets its line: flanking, suppressing, falling back, taking cover ("Taking fire!"), moving
    up / "Cover me!" when bounding or shifting position, and "Cover me!" when moving to a firing spot;
  - "Taking fire!" when diving for cover under fire;
  - "Enemy spotted!" when eyes first go on a target.
  - Per-man pause between lines: 6 s → 3 s (Normal), 4 s → 1.5 s (A lot), 10 s → 6 s (Less).
  - The same line can be repeated nearby after 5 s (was 8). "Target down!", "I'm hit!" and "Man down!" after 3 s.
- **"Medic!" right away:** a man who goes down calls ~1.5 s later (if no medic is already on his way), then about
  every 10 s. Before, the first call could take up to 18 s, and only half the wounded ever called. Two men down side
  by side still don't both yell it.
- **Demolition:**
  - **No gun.** The Grenades and Molotovs kits carry only what they throw. When an enemy closes inside ~8 blocks,
    the thrower backs off to throwing distance (and punches if cornered). He moves up to about 20 blocks from the
    enemy and throws from there.
  - **Grenades:** 6 carried, a throw every 5 s, one back every 15 s, one per squad every 2 s, up to 24 blocks. A
    bigger blast (power 3.0, was 1.8; still never breaks blocks); never within 6 of a friend.
  - **Molotovs:** 5 carried, a throw every 6 s, one back every 20 s, up to 24 blocks. A bigger fire: a 4-block patch
    (was 2.5) burning 9 s (was 6), setting people alight for 5 s.
  - **Bazooka:** it now fires at soldiers too, not only at vehicles (it never fired with no vehicles around). Never
    at a man within 6 blocks: the blast would take the shooter too.

## v6.9 (Rooftops, medics, shots through walls)

- **Rooftops and wall-tops are used, not feared.** A man who wants a shot down at the enemy now steps up to the edge
  of a roof (or a wall-top with no battlement) and fires from there. The drop must be straight ahead, not a corner, and
  never over lava. He doesn't walk along the edge. If an enemy who could shove him off (a player, a hound, a man with a
  blade) comes within 6 blocks, he backs off as before. Before, the "keep away from the drop" rule held everyone a
  block or more back, where a flat roof hides everything below.
- **A man told to hold a roof, a wall or an upper floor stays up there.** Fights no longer route him down to the
  enemy's level: he holds the high ground. (Retreats and medics still go wherever they need to.)
- **Firing positions:** the spots nearest the enemy (the front edge) are now always considered. Before, the first cut
  ranked them low for the walk, and they were never checked for a shot.
- **Medics:**
  - Fixed: a medic standing next to a downed man could fail to ever revive him. The revive only happened on certain
    ticks of a 2 s clock, and some medics' thoughts never landed on them. He now kneels for 1 s and revives.
  - Reaching a man who lies on a step, a slab or a roof edge counts.
  - A medic who can't get any closer for 15 s gives that man up for 30 s (and says so). The man then calls "Medic!"
    again.
  - Fixed: "Medic!" was never called once any medic had ever been assigned, even one who died or gave up. Now only
    a medic actually on his way counts.
- **No more firing at old spots through walls and ceilings.** Covering fire on a window or doorway stops as soon as
  the shooter no longer has a line to it from where he now stands. Before, a man who kept walking (into a building,
  behind a wall) kept firing at the old spot. The line-of-sight memory no longer reuses an old answer when the
  per-tick budget runs out.
- **Bullets go through walls, by accident.** Nobody aims at a wall, but shots that go into one happen anyway: a miss
  into cover, a burst that clips a window frame, a man who ducks as the trigger is pulled. About 3 in 10 of those
  come out the far side and fly on, slowed. That needs a wall no more than 3 blocks thick, not made of obsidian,
  bedrock, iron, netherite, reinforced deepslate and similar. Rockets never do it. Players can be hit this way
  (never in creative).

## v6.8 (Callouts: more often, never doubled, a test menu)

- **They talk a lot more.** Most triggers fire more often: "Enemy spotted!" (3 in 4), "I'm hit!", "Taking heavy
  fire!", "Dry, cover me!" (reloading), "Cover me!" / "Moving up!" when bounding forward.
- **New triggers:** "Suppressing!" when pinning an enemy or giving covering fire; "Fall back!" when pulling back; a
  medic heading to a downed man calls "Moving up!"; when a grenade lands, the nearest soldier shouts "Frag out! Get
  down!".
- **The squad answers each other:**
  - a man reloading gets a "Suppressing!" from a mate;
  - "Contact!" gets an "Enemy spotted!";
  - "I'm hit!" gets a "Man down!";
  - "Clear!" gets a "Hold position!";
  - idle talk is sometimes answered with another idle line.
- **Never the same line twice at once.** Nobody within 40 blocks repeats a line someone just said, from any squad
  (8 s for most lines, 5 min for idle lines). There are still at most 3 voices a second, and each man pauses
  between lines.
- **Idle talk:** after 40 s of calm, a squad near you says something about every 45-90 s.
- **Callouts menu** (Settings, Callouts):
  - **Soldiers near me each say a line:** each one a different line, with subtitles.
  - **Play EVERY line, one by one:** the nearest soldier says each of the 27 lines in his faction's language, 4 s
    apart. The screen shows the line and when it's used.
  - **Play one line...:** pick any line and any language.
  - **How often they talk** (Less / Normal / A lot) and **subtitles** (the line in English on screen).
- **Spanish, German and Young Jamal (AAVE)** now have all 27 lines. That makes 8 full languages: US English, Greek,
  Korean, Mongolian, Hebrew, Spanish, German, AAVE. The other languages have the 16 base lines.
- Fix: a callout could garble the distances a soldier's target scan was using, in the same tick.

## v6.7 (Demolition unit, real grenades, more callouts, idle talk)

- **The snowball grenadier is now the Demolition unit** (Demolition Egg). It's the only unit with these weapons.
  Pick one of three kits:
  - **Grenades (+ pistol).** Real grenades, no more snowballs. Lobbed at a group of enemies 8-22 blocks away. 3
    carried, 12 s between throws, one back every 90 s, and one per squad every 4 s. Never thrown where a friend
    stands within 5 of the target. It lands, fizzes ~1.5 s (soldiers nearby scramble away from it), then explodes:
    it hurts and throws people about, but it **never breaks blocks**.
  - **Molotovs (+ pistol).** As in v6.6.
  - **Bazooka.** The gun pack's anti-tank weapon (taken off every other unit's weapon list).
  - Old snowball grenadiers in a world are re-kitted to grenades automatically.
- **New callout lines** for US English, Greek, Korean, Mongolian and Hebrew:
  - "Taking heavy fire!": now and then when shot at.
  - "Medic!": only if no medic is on his way, and only about half the wounded.
  - "Thanks!": after a revive.
  - "Don't shoot!": on surrender.
  - "Dry, cover me!": about 1 reload in 3, and only in a fight.
  - "Frag out!": on throwing a grenade or molotov.
- **Idle talk** for the same 5 languages. After a minute with nothing happening (no enemy seen, not marching,
  nobody fighting), one soldier of a squad near you says one of 5 calm or tired lines now and then. At most one
  line per squad every 1.5-2.5 minutes, and one every 30 s anywhere. Any sign of a fight stops it.
- **Gun pace.** The 8-round semi-auto and 7-round pistol from v6.6 now fire at exactly the old pace, both in a
  burst and overall.

## v6.6 (neutral by default, one-page diplomacy, 40 factions, 64 skins, coalition spawns, spear & molotov)

- **Everyone starts neutral.** A new world starts with every faction neutral to every other (it used to be all
  hostile). An existing world keeps its relations.
- **Diplomacy on one page.** War Table -> Diplomacy -> pick a faction: every other faction is listed with its own
  Neutral / Hostile / Ally choice, plus "Set everyone to..." at the top. Save applies them all, and the same page
  comes straight back with the new values. Close it when you're done. One chat message per save, not one per
  faction.
- **40 factions** (was 20): Jet, Quartz, Iron, Netherite, Crimson, Emerald, Lapis, Amber, Coral, Indigo, Forest, Sand,
  Lavender, Rust, Silver, Rose, Mint, Sky, Plum and Khaki. Each has its own uniform, medic, cavalry, hound and flag
  colours (made from the faction 1 textures). Name them in "Name factions" as usual. Existing worlds are upgraded
  with their relations kept, and the new factions start neutral.
- **64 skin slots** (was 32). Slots 33-64 are ready: drop `skin_33.png`... into the resource pack's
  `textures/war_skins/` and give the slot a name in `War Engine BP/scripts/skins.js` (empty names stay hidden).
- **Spawn a whole coalition.** The spawn egg's faction list also offers every coalition with 2 or more factions.
  "How many" is per faction, and each faction's group is placed side by side.
- **Spear** (new weapon): a sword's damage with a much longer reach, a touch slower to close in. In hand: the
  game's spear, or a trident where there is none.
- **Molotovs** (new weapon, with a sword for close fighting):
  - Lobbed at a group of enemies 7-18 blocks away. 3 carried, 15 s between throws, one back every 90 s, and only
    one bottle per squad every 4 s (no volleys).
  - Where it lands, a 2.5-block patch burns for 6 s. Anyone standing in it catches fire, so he never throws where
    a friend is nearby, and soldiers caught in it get out.
  - **No blocks are set alight or broken.**
  - Test: one or two patches at a time, enemies burned, none of their own.
- **Snowball grenadier balance.**
  - Throws only out to 24 blocks (was 32).
  - Never at a man closer than 6, and never where a friend stands within 3 of the target.
  - 12 s between throws (was 10).
  - A snowball comes back every 2 minutes, up to 3. It used to be 3 for life, then a crossbow.
- **Gun rhythm.** The semi-auto now fires an 8-round clip and the pistol a 7-round magazine (they were 3 and 2,
  with constant mini-reloads). The damage per second is the same. The pump shotgun takes 1 s between shots
  (was 0.75 s).
- **More callouts, wired and waiting for recordings:**
  - "Medic!": a wounded man calls about every 18 s, only if no medic is already on his way, and only about half
    of the wounded call at all.
  - "Thanks!": after a revive.
  - "Don't shoot!": on surrender.
  - "Reloading!" and "Grenade!" (molotovs and snowballs).
  - They stay silent until the clips are recorded.

## v6.5.3 (the last 3 callout languages: 18 in all)

- **Chinese (Mandarin), Yucatec Maya and AAVE** added. Chinese's lines recorded in two versions ("Flanking",
  "Man down", "Clear") are used at random. AAVE keeps both sentences of each line as one shout.

## v6.5.2 (5 more callout languages: 15 in all)

- **Italian, Hindi, Igbo, Haitian Creole and Syrian Arabic (mixed with English)** added. Hindi's lines recorded in
  two versions ("Contact", "Charge", "Suppressing") are used at random. Syrian Arabic keeps both halves of its
  two-part lines ("هُجوم! لِتْز غُو!") as one shout.

## v6.5.1 (5 more callout languages)

- **Hebrew, Dutch, German, Mongolian and Russian** callouts added: 10 languages in all. Lines recorded in two
  versions are used at random: Hebrew "Man down!", Mongolian "Contact!" and Russian "Fall back!".

## v6.5 (spoken callouts: test build with 5 languages)

- **Soldiers shout again, in their faction's language.** War Table -> Settings -> Callout language (per faction):
  US English, British English, Greek, Korean, Spanish, or None. Each faction defaults to US English. What you read
  on screen stays English. The recordings are your ElevenLabs takes, cut into separate lines, trimmed, matched in
  volume and converted to .ogg. Each soldier gets his own slightly higher or lower voice, so a squad doesn't sound
  like one man. Korean has two versions of "Clear!" and picks one at random.
- **The 16 lines and when they're shouted:**
  - Enemy spotted: he first sees an enemy.
  - Contact: his squad first makes contact.
  - Flanking: the squad sends men round the side.
  - Charge: the squad assaults.
  - Go, go, go: the flankers are in place.
  - Moving up: he's sent to reinforce.
  - Suppressing: a machine gunner opens up.
  - I'm hit: he's wounded.
  - Man down: a squad mate falls nearby.
  - You're okay: a medic revives someone.
  - Fall back: he's shaken and pulls back.
  - Cover me: (new) he moves while his mates cover him.
  - Target down: (new) the man he shot goes down.
  - Clear: (new) the fight's over.
  - Hold position: (new) the march arrives.
  - Follow me: (new) a march starts.
  - "Reloading", "Grenade" and "On the gun" have no recording, so they stay silent.
- **Never spammy.**
  - One shout per soldier every ~8 s, and squad mates don't yell the same line within 3 s of each other.
  - At most 3 shouts a second in the whole world, and only near a player: heard up to ~32 blocks.
  - In the test fight, a whole battle was about 10 shouts. The volume follows the "Hostile creatures" slider.
- **Test button.** War Table -> Settings -> Callout language -> "Test callouts": every soldier near you shouts a
  random line.

## v6.4 (water, wall-top defenders, learning the map, shaking loose)

- **Water.**
  - **Orders into water.** An order to a spot in a pond (easy to do when you aim at water next to a wall) made the
    whole squad "arrive" in the water. Its formation spots fell back onto that point, and the get-out-of-the-water
    logic and the formation then fought each other. Now an order to water (or lava, or any spot nobody can stand
    on) goes to the nearest dry, safe spot on the squad's side. Test, ordered into a pond at the foot of a wall:
    before, all 8 were in the water for ~90 s. Now, nobody gets wet.
  - **Swimming across.** A squad committed to swimming across pushed every man straight at the final destination,
    even with a wall in the way (your screenshot: a row of them pressed into the wall in the water). Now they swim
    for the next bit of their route that's on land. While the glider is carrying them, there's no extra push.
  - **Getting out.** The "get out of the water" spot is only ever a bank you can climb out onto, never the top of a
    wall. A crossing that gets nowhere for 10 s is given up for the nearest real bank.
  - **Streams with a bank.** The route planner wouldn't plan the step out of the water onto a bank one block above
    its surface, so the route ended in the middle of the stream and the squad waited there, swimming. The glider also
    dragged swimmers along the bottom and then refused to "lift" them onto the bank. Now routes climb out like a
    player does, and swimmers are carried at the surface. Test, a stream across the whole field with a 1-high bank:
    before, 70 s in the water and they never got across. Now, across in ~330 ticks, ~1.5 s wet each.
- **Wall-top defenders.**
  - **Firing slots.** A gap in a battlement (between two merlons) or a window in a wall-walk now counts as a firing
    slot. v6.2's ledge safety had banned every cell next to the drop, so defenders stood back from the merlons,
    saw nothing and "took a firing position" forever. A man on a post with no shot from where he stands takes the
    slot within his post's reach that sees the enemy. A bare wall-top edge is still treated as a ledge.
  - Test, 6 defenders on a battlement against 6 attackers across a moat, 4 runs: v6.3.1 held the wall in 2. v6.4
    holds it in 4 of 4.
  - **Never teleported off a post.** A man on a post (hold, post, sentry, stand) is never stuck-rescue teleported to
    his squad any more. That's how wall-top men ended up on the far side of the wall. If he can't make a move, he
    gives it up and holds where he is.
- **Shaking loose.** You noticed a hit helps a stuck soldier: it does. Now, the first time a soldier is pressing into
  something and getting nowhere, he does what your hit did: a little hop and a step back or aside, then he
  re-decides. Never toward a drop or lava.
- **Learning the map.** The army remembers trouble spots: everywhere a soldier got properly stuck, needed a rescue,
  was trapped below his route or gave up a swim. It's remembered in the world, so it survives a reload. Routes go
  round remembered trouble when there's another way, and fight moves don't pick those spots. A spot that stops
  causing trouble fades from memory after a while. "Remove everything" in Cleanup forgets it all.

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
